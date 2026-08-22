package controllers

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"

	"github.com/gofiber/fiber/v3"
)

// GetFlaggedItems fetches all UNMATCHED or PARTIAL BankTransactions
// and all orphaned Expenses, and returns them as JSON.
// Expects optional query parameters: ?year=2026 & month=8
func GetFlaggedItems(c fiber.Ctx) error {

	year := c.Query("year")
	month := c.Query("month")

	var txs []models.BankTransaction
	txsQuery := db.DB.Model(&models.BankTransaction{})

	txsQuery = txsQuery.Where("reconciliation_status != ?", "MATCHED")

	if year != "" {
		txsQuery = txsQuery.Where("EXTRACT(YEAR FROM date) = ?", year)
	}
	if month != "" {
		txsQuery = txsQuery.Where("EXTRACT(MONTH FROM date) = ?", month)
	}
	txsQuery.Order("date DESC").Preload("Expenses.Receipts").Find(&txs)

	var expenses []models.Expense
	expenseQuery := db.DB.Model(&models.Expense{})

	expenseQuery = expenseQuery.Where("bank_transaction_id IS NULL AND tender != 'cash'")

	if year != "" {
		expenseQuery = expenseQuery.Where("EXTRACT(YEAR FROM timestamp) = ?", year)
	}
	if month != "" {
		expenseQuery = expenseQuery.Where("EXTRACT(MONTH FROM timestamp) = ?", month)
	}
	expenseQuery.Order("timestamp DESC").Preload("Receipts").Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
		"expenses":     expenses,
	})
}

// LinkExpenseToTransaction manually forces an Expense to link to a BankTransaction
func LinkExpenseToTransaction(c fiber.Ctx) error {
	type LinkRequest struct {
		ExpenseID     uint `json:"expenseId"`
		TransactionID uint `json:"transactionId"`
	}

	var req LinkRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	var txToLink models.BankTransaction
	if err := db.DB.Where("id = ?", req.TransactionID).First(&txToLink).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "transaction not found"})
	}

	var expenseToLink models.Expense
	if err := db.DB.Where("id = ?", req.ExpenseID).First(&expenseToLink).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "expense not found"})
	}

	expenseToLink.BankTransactionID = &txToLink.ID
	db.DB.Save(&expenseToLink)

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "successfully linked receipt to expense",
	})
}

// UnlinkExpense unlinks an Expense from a BankTransaction
func UnlinkExpense(c fiber.Ctx) error {
	type UnlinkRequest struct {
		ExpenseID uint `json:"expenseId"`
	}

	var req UnlinkRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	var expenseToUnlink models.Expense
	if err := db.DB.Where("id = ?", req.ExpenseID).First(&expenseToUnlink).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "expense not found"})
	}

	expenseToUnlink.BankTransactionID = nil
	db.DB.Save(&expenseToUnlink)

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "successfully unlinked expense",
	})
}

// MarkExpenseAsCash flags an Expense as "Cash" (e.g. by setting Tender = "cash")
// so it doesn't need to be reconciled to the bank.
func MarkExpenseAsCash(c fiber.Ctx) error {
	id := c.Params("id")

	var expense models.Expense
	result := db.DB.Where("id = ?", id).First(&expense)

	if result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Expense not found",
		})
	}

	expense.Tender = "cash"
	db.DB.Save(&expense)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "successfully marked expense tender as cash",
	})
}

// GetUnlinkedItems fetches all unlinked items across all time,
// useful for populating dropdowns on the manual link UI.
func GetUnlinkedItems(c fiber.Ctx) error {
	var txs []models.BankTransaction
	db.DB.Where("reconciliation_status != ?", "MATCHED").
		Order("date DESC").
		Find(&txs)

	var expenses []models.Expense
	db.DB.Where("bank_transaction_id IS NULL AND tender != 'cash'").
		Order("timestamp DESC").
		Preload("Receipts").
		Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
		"expenses":     expenses,
	})
}

