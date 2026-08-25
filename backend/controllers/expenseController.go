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

	if err := db.DB.Preload("Receipts").First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	// Load confirmed transactions — these are fully reconciled links.
	var confirmedTransactions []models.BankTransaction
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = ?", expense.ID, "confirmed").
		Find(&confirmedTransactions)

	// Load suggested transactions — these are scoring system guesses awaiting user action.
	var suggestedTransactions []models.BankTransaction
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = ?", expense.ID, "suggested").
		Find(&suggestedTransactions)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":                "success",
		"expense":               expense,
		"confirmedTransactions": confirmedTransactions,
		"suggestedTransactions": suggestedTransactions,
	})
}

// CreateExpense creates a manually entered expense (no file upload required).
// The date is validated server-side to ensure it falls within the year/month
// supplied by the caller (enforced on the frontend via the URL context).
func CreateExpense(c fiber.Ctx) error {
	type createInput struct {
		Timestamp   time.Time `json:"timestamp"`
		Vendor      string    `json:"vendor"`
		Description string    `json:"description"`
		Amount      float64   `json:"amount"`
		Tender      string    `json:"tender"`
		// Year/Month are sent by the frontend from the URL params so the backend
		// can validate the date falls within the correct accounting period.
		Year  int `json:"year"`
		Month int `json:"month"`
	}

	var input createInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Validate the date falls within the requested year/month.
	if input.Year > 0 && input.Month > 0 {
		if input.Timestamp.Year() != input.Year || int(input.Timestamp.Month()) != input.Month {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "The expense date must be within the selected month",
			})
		}

		if utils.IsMonthClosed(input.Year, input.Month) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot create an expense in a closed accounting period."})
		}
	} else {
		if utils.IsMonthClosed(input.Timestamp.Year(), int(input.Timestamp.Month())) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot create an expense in a closed accounting period."})
		}
	}

	expense := models.Expense{
		Timestamp:   input.Timestamp,
		Vendor:      input.Vendor,
		Description: input.Description,
		Amount:      math.Abs(input.Amount),
		Tender:      input.Tender,
	}

	if err := db.DB.Create(&expense).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create expense"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "success", "expense": expense})
}

// GetExpenses fetches all expenses, optionally filtered by year/month
func GetExpenses(c fiber.Ctx) error {
	year := c.Query("year")
	month := c.Query("month")

	var expenses []models.Expense
	query := db.DB.Model(&models.Expense{}).Where("status != ?", "PENDING_CLOSED")

	if year != "" {
		query = query.Where("EXTRACT(YEAR FROM timestamp) = ?", year)
	}
	if month != "" {
		query = query.Where("EXTRACT(MONTH FROM timestamp) = ?", month)
	}

	// Preload BankTransactions so the frontend knows if it's linked
	query.Order("timestamp DESC").Preload("Receipts").Preload("BankTransactions").Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":   "success",
		"expenses": expenses,
	})
}

func UpdateExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	if expense.Status != "PENDING_CLOSED" && utils.IsMonthClosed(expense.Timestamp.Year(), int(expense.Timestamp.Month())) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot update an expense in a closed accounting period."})
	}

	type updateInput struct {
		Vendor      string  `json:"vendor"`
		Description string  `json:"description"`
		Amount      float64 `json:"amount"`
		Tender      string  `json:"tender"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Enforce positive amount for receipts
	db.DB.Model(&expense).Updates(map[string]interface{}{
		"vendor":      input.Vendor,
		"description": input.Description,
		"amount":      math.Abs(input.Amount),
		"tender":      input.Tender,
	})

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "expense": expense})
}

// DeleteExpense deletes an expense and its physical receipt records
func DeleteExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	// Allow deleting if PENDING_CLOSED so user can clear out waiting area
	if expense.Status != "PENDING_CLOSED" && utils.IsMonthClosed(expense.Timestamp.Year(), int(expense.Timestamp.Month())) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot delete an expense in a closed accounting period."})
	}

	// Delete join table relationships first to prevent foreign key constraint violations
	db.DB.Where("expense_id = ?", id).Delete(&models.ExpenseBankTransaction{})

	// Delete physical receipts
	db.DB.Where("expense_id = ?", id).Delete(&models.Receipt{})

	if err := db.DB.Delete(&expense).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete expense"})
	}

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
