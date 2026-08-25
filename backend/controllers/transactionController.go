package controllers

import (
	"fmt"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"

	"github.com/gofiber/fiber/v3"
)

// GetTransactions fetches all BankTransactions along with their linked
// Expenses and the physical Receipts, so the frontend can display them.
// Expects optional query parameters: ?year=2026 & month=8 & search=walmart
func GetTransactions(c fiber.Ctx) error {
	year := c.Query("year")
	month := c.Query("month")
	search := c.Query("search")

	var txs []models.BankTransaction
	query := db.DB.Model(&models.BankTransaction{})

	if year != "" {
		query = query.Where("EXTRACT(YEAR FROM date) = ?", year)
	}
	if month != "" {
		query = query.Where("EXTRACT(MONTH FROM date) = ?", month)
	}
	if search != "" {
		query = query.Where("description ILIKE ?", "%"+search+"%")
	}

	query.Order("date DESC").Preload("Expenses.Receipts").Find(&txs)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
	})
}

// GetTransaction fetches a single BankTransaction and returns confirmed and suggested
// expense links as separate arrays so the UI can distinguish them without ambiguity.
func GetTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	// Load confirmed expenses with their physical receipt files.
	var confirmedExpenses []models.Expense
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
		Where("ebt.bank_transaction_id = ? AND ebt.status = ?", tx.ID, "confirmed").
		Preload("Receipts").
		Find(&confirmedExpenses)

	// Load suggested expenses — scoring system guesses awaiting user action.
	var suggestedExpenses []models.Expense
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
		Where("ebt.bank_transaction_id = ? AND ebt.status = ?", tx.ID, "suggested").
		Find(&suggestedExpenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":            "success",
		"transaction":       tx,
		"confirmedExpenses": confirmedExpenses,
		"suggestedExpenses": suggestedExpenses,
	})
}

// CreateTransaction creates a manually entered bank transaction (no OFX import required).
// bankStatementId is intentionally left null for manual entries.
// The FITID is auto-generated to satisfy the unique constraint.
func CreateTransaction(c fiber.Ctx) error {
	type createInput struct {
		Date            time.Time `json:"date"`
		Description     string    `json:"description"`
		Amount          float64   `json:"amount"`
		TransactionType string    `json:"transactionType"`
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
		if input.Date.Year() != input.Year || int(input.Date.Month()) != input.Month {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "The transaction date must be within the selected month",
			})
		}

		if utils.IsMonthClosed(input.Year, input.Month) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot create a transaction in a closed accounting period."})
		}
	} else {
		if utils.IsMonthClosed(input.Date.Year(), int(input.Date.Month())) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot create a transaction in a closed accounting period."})
		}
	}

	tx := models.BankTransaction{
		Date:            input.Date,
		Description:     input.Description,
		Amount:          input.Amount,
		TransactionType: input.TransactionType,
		// Synthetic FITID satisfies the unique constraint on manually entered rows.
		FITID: fmt.Sprintf("MANUAL-%d", time.Now().UnixNano()),
		// BankStatementID left nil — manual entries don't belong to an imported statement.
	}

	if err := db.DB.Create(&tx).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create transaction"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "success", "transaction": tx})
}

// UpdateTransaction allows updating fields on a transaction
func UpdateTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	if tx.ReconciliationStatus != "PENDING_CLOSED" && utils.IsMonthClosed(tx.Date.Year(), int(tx.Date.Month())) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot update a transaction in a closed accounting period."})
	}

	type updateInput struct {
		Description string  `json:"description"`
		Amount      float64 `json:"amount"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	db.DB.Model(&tx).Updates(map[string]interface{}{
		"description": input.Description,
		"amount":      input.Amount,
	})

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "transaction": tx})
}

// DeleteTransaction deletes a transaction and nullifies the BankTransactionID on its linked expenses
func DeleteTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	if tx.ReconciliationStatus != "PENDING_CLOSED" && utils.IsMonthClosed(tx.Date.Year(), int(tx.Date.Month())) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot delete a transaction in a closed accounting period."})
	}

	// Delete all join table rows for this transaction before deleting the transaction itself.
	// This covers both confirmed and suggested links so nothing is left dangling.
	db.DB.Where("bank_transaction_id = ?", id).Delete(&models.ExpenseBankTransaction{})

	if err := db.DB.Delete(&tx).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete transaction"})
	}

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
