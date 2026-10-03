package controllers

import (
	"math"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"

	"github.com/gofiber/fiber/v3"
)

// GetExpense fetches a single Expense and returns confirmed and suggested transaction
// links as separate arrays so the UI can distinguish them without ambiguity.
func GetExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.Preload("Receipts").Preload("ChartAccount").First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	// Load confirmed transactions — these are fully reconciled links.
	var confirmedTransactions []models.BankTransaction
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = ?", expense.ID, "confirmed").
		Preload("ChartAccount").
		Find(&confirmedTransactions)

	// Load suggested transactions — these are scoring system guesses awaiting user action.
	var suggestedTransactions []models.BankTransaction
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = ?", expense.ID, "suggested").
		Preload("ChartAccount").
		Find(&suggestedTransactions)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":                "success",
		"expense":               expense,
		"confirmedTransactions": confirmedTransactions,
		"suggestedTransactions": suggestedTransactions,
	})
}

// CreateExpense creates a manually entered expense (no file upload required).
// Optional chartAccountId can be provided to categorize the expense.
func CreateExpense(c fiber.Ctx) error {
	type createInput struct {
		Timestamp      time.Time `json:"timestamp"`
		Vendor         string    `json:"vendor"`
		Description    string    `json:"description"`
		Amount         float64   `json:"amount"`
		Tender         string    `json:"tender"`
		ChartAccountID *uint     `json:"chartAccountId"`
	}

	var input createInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Guard against creating expenses in a closed period
	if utils.IsDateInClosedPeriod(input.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot create an expense in a closed accounting period.",
		})
	}

	expense := models.Expense{
		Timestamp:      input.Timestamp,
		Vendor:         input.Vendor,
		Description:    input.Description,
		Amount:         math.Abs(input.Amount), // always store positive amounts for expenses
		Tender:         input.Tender,
		ChartAccountID: input.ChartAccountID,
	}

	if err := db.DB.Create(&expense).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create expense"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "success", "expense": expense})
}

// GetExpenses fetches all expenses, optionally filtered by period or chart account.
//
// Optional query parameters:
//   - ?periodId=123    filter to expenses within that period's date range
//   - ?accountId=5     filter by ChartAccountID (which expense category)
func GetExpenses(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	accountId := c.Query("accountId")

	var expenses []models.Expense
	query := db.DB.Model(&models.Expense{})

	// Filter by date range if provided
	if startDate != "" {
		query = query.Where("timestamp >= ?", startDate)
	}
	if endDate != "" {
		query = query.Where("timestamp <= ?", endDate)
	}

	if accountId != "" {
		query = query.Where("chart_account_id = ?", accountId)
	}

	// Preload BankTransactions so the frontend knows if it's linked
	query.Order("timestamp DESC").Preload("Receipts").Preload("BankTransactions").Preload("ChartAccount").Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":   "success",
		"expenses": expenses,
	})
}

// UpdateExpense allows updating fields on an expense, including its COA category.
func UpdateExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	if utils.IsDateInClosedPeriod(expense.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot update an expense in a closed accounting period.",
		})
	}

	type updateInput struct {
		Vendor         string  `json:"vendor"`
		Description    string  `json:"description"`
		Amount         float64 `json:"amount"`
		Tender         string  `json:"tender"`
		ChartAccountID *uint   `json:"chartAccountId"`
		Notes          string  `json:"notes"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Enforce positive amount for receipts
	db.DB.Model(&expense).Updates(map[string]interface{}{
		"vendor":           input.Vendor,
		"description":      input.Description,
		"amount":           math.Abs(input.Amount),
		"tender":           input.Tender,
		"chart_account_id": input.ChartAccountID,
		"notes":            input.Notes,
	})

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "expense": expense})
}

// DeleteExpense deletes an expense and its physical receipt records.
func DeleteExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	// Guard against deleting in a closed period
	if utils.IsDateInClosedPeriod(expense.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot delete an expense in a closed accounting period.",
		})
	}

	// Delete join table relationships first to prevent foreign key constraint violations
	db.DB.Where("expense_id = ?", id).Delete(&models.ExpenseBankTransaction{})

	// Delete physical receipt records
	db.DB.Where("expense_id = ?", id).Delete(&models.Receipt{})

	if err := db.DB.Delete(&expense).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete expense"})
	}

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
