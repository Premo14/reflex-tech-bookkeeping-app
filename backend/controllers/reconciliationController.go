package controllers

import (
	"github.com/gofiber/fiber/v3"
)

// GetFlaggedItems fetches all UNMATCHED or PARTIAL BankTransactions
// and all orphaned Expenses, and returns them as JSON.
func GetFlaggedItems(c fiber.Ctx) error {
	// TODO: Query db.DB for flagged BankTransactions
	// TODO: Query db.DB for orphaned Expenses
	// TODO: Return JSON map containing both arrays

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "not implemented",
	})
}

// LinkExpenseToTransaction manually forces an Expense to link to a BankTransaction
func LinkExpenseToTransaction(c fiber.Ctx) error {
	// TODO: Parse the JSON body to get bank_transaction_id and expense_id
	// TODO: Fetch them from DB, link them, and Save()
	// TODO: Run utils.UpdateReconciliationStatuses() to recalculate the math

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "not implemented",
	})
}

// MarkExpenseAsCash flags an Expense as "Cash" (e.g. by setting Tender = "cash")
// so it doesn't need to be reconciled to the bank.
func MarkExpenseAsCash(c fiber.Ctx) error {
	// TODO: Get Expense ID from c.Params("id")
	// TODO: Update Expense.Tender = "cash" and Save()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "not implemented",
	})
}
