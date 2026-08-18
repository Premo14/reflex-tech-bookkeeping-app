package controllers

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

// GetAccountingPeriods fetches all AccountingPeriods from the database
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

// CloseAccountingPeriod attempts to close a month if there are no flagged items
func CloseAccountingPeriod(c fiber.Ctx) error {
	type CloseRequest struct {
		PeriodID uint `json:"periodId"`
	}

	var req CloseRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	//  Fetch the Accounting Period so we know which month/year to check
	var period models.AccountingPeriod
	if err := db.DB.Where("id = ?", req.PeriodID).First(&period).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "accounting period not found"})
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
		Where("bank_transaction_id IS NULL AND tender != 'cash'").
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
