package controllers

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"

	"github.com/gofiber/fiber/v3"
)

func GetAccountingPeriods(c fiber.Ctx) error {
	var accountingPeriods []models.AccountingPeriod
	if result := db.DB.Find(&accountingPeriods); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch accounting periods",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"accountPeriods": accountingPeriods,
	})
}

func CloseAccountingPeriod(c fiber.Ctx) error {
	type CloseRequest struct {
		PeriodID uint `json:"periodId"`
	}

	var req CloseRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	// Fetch the Accounting Period so we know which month/year to check
	var period models.AccountingPeriod
	if err := db.DB.Where("id = ?", req.PeriodID).First(&period).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "accounting period not found"})
	}

	if period.Status == "CLOSED" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Accounting period is already closed."})
	}

	// Verify that the period is either a past month or today is the last day of this month
	now := time.Now()
	currentYear := now.Year()
	currentMonth := int(now.Month())

	isFutureMonth := period.Year > currentYear || (period.Year == currentYear && period.Month > currentMonth)
	if isFutureMonth {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot close a future accounting period."})
	}

	if period.Year == currentYear && period.Month == currentMonth {
		// Calculate the last day of current month
		// Go trick: Date for Day 0 of next month is the last day of current month
		lastDayOfMonth := time.Date(currentYear, time.Month(currentMonth+1), 0, 0, 0, 0, 0, now.Location()).Day()
		if now.Day() < lastDayOfMonth {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "A current month can only be closed on or after the last day of the month.",
			})
		}
	}

	//  Verify that all BankTransactions in that specific month/year are MATCHED
	var unmatchedTxCount int64
	db.DB.Model(&models.BankTransaction{}).
		Where("EXTRACT(month FROM date) = ? AND EXTRACT(year FROM date) = ?", period.Month, period.Year).
		Where("reconciliation_status != ?", "MATCHED").
		Count(&unmatchedTxCount)

	if unmatchedTxCount > 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"conflict": "There are bank transactions in this period that are not fully matched.",
		})
	}

	// Verify that all Expenses in that specific month/year are linked
	var orphanedExpenseCount int64
	db.DB.Model(&models.Expense{}).
		Where("EXTRACT(month FROM timestamp) = ? AND EXTRACT(year FROM timestamp) = ?", period.Month, period.Year).
		Where("id NOT IN (?)", db.DB.Table("expense_bank_transactions").Select("expense_id").Where("status = ?", "confirmed")).
		Where("tender != 'cash'").
		Count(&orphanedExpenseCount)

	if orphanedExpenseCount > 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"conflict": "There are orphaned expenses in this period that need to be linked or marked as cash.",
		})
	}

	// Close period and save to DB.
	period.Status = "CLOSED"
	db.DB.Save(&period)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "Successfully closed accounting period",
	})
}

func CreateAccountingPeriod(c fiber.Ctx) error {
	type CreateRequest struct {
		Year  int `json:"year"`
		Month int `json:"month"`
	}

	var req CreateRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	currentYear := time.Now().Year()

	if req.Year > currentYear {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot create an accounting period in the future."})
	}
	if req.Year < currentYear-10 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot create an accounting period more than 10 years in the past."})
	}
	if req.Month < 1 || req.Month > 12 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid month."})
	}

	var existing models.AccountingPeriod
	if err := db.DB.Where("year = ? AND month = ?", req.Year, req.Month).First(&existing).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "This accounting period already exists."})
	}

	period := models.AccountingPeriod{
		Year:   req.Year,
		Month:  req.Month,
		Status: "OPEN",
	}

	if err := db.DB.Create(&period).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create accounting period"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "success", "period": period})
}

func ReopenAccountingPeriod(c fiber.Ctx) error {
	type ReopenRequest struct {
		Year  int `json:"year"`
		Month int `json:"month"`
	}

	var req ReopenRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var period models.AccountingPeriod
	if err := db.DB.Where("year = ? AND month = ?", req.Year, req.Month).First(&period).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Accounting period not found"})
	}

	period.Status = "OPEN"
	if err := db.DB.Save(&period).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to reopen period"})
	}

	// Upgrade BankTransactions
	db.DB.Model(&models.BankTransaction{}).
		Where("EXTRACT(YEAR FROM date) = ? AND EXTRACT(MONTH FROM date) = ? AND reconciliation_status = ?", req.Year, req.Month, "PENDING_CLOSED").
		Update("reconciliation_status", "UNMATCHED")

	// Upgrade Expenses
	db.DB.Model(&models.Expense{}).
		Where("EXTRACT(YEAR FROM timestamp) = ? AND EXTRACT(MONTH FROM timestamp) = ? AND status = ?", req.Year, req.Month, "PENDING_CLOSED").
		Update("status", "OPEN")

	// Run reconciliation to link up newly opened items
	utils.RunReconciliation()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
	})
}

func GetPendingClosedItems(c fiber.Ctx) error {
	var txs []models.BankTransaction
	db.DB.Model(&models.BankTransaction{}).
		Where("reconciliation_status = ?", "PENDING_CLOSED").
		Order("date DESC").
		Preload("Expenses.Receipts").
		Find(&txs)

	var expenses []models.Expense
	db.DB.Model(&models.Expense{}).
		Where("status = ?", "PENDING_CLOSED").
		Order("timestamp DESC").
		Preload("Receipts").Preload("BankTransactions").
		Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
		"expenses":     expenses,
	})
}
