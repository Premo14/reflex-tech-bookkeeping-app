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

	// An expense is "orphaned" if it has no confirmed row in the join table and is not cash.
	expenseQuery = expenseQuery.
		Where("tender != 'cash'").
		Where("id NOT IN (?)", db.DB.Table("expense_bank_transactions").Select("expense_id").Where("status = ?", "confirmed"))

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

	if utils.IsMonthClosed(txToLink.Date.Year(), int(txToLink.Date.Month())) || utils.IsMonthClosed(expenseToLink.Timestamp.Year(), int(expenseToLink.Timestamp.Month())) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot modify links for items in a closed accounting period."})
	}

	// Constraint: an expense with multiple receipt files may only link to one transaction.
	// Allowing more would create a many-receipts ↔ many-transactions web, which we explicitly prevent.
	var receiptCount int64
	db.DB.Model(&models.Receipt{}).Where("expense_id = ?", req.ExpenseID).Count(&receiptCount)
	if receiptCount > 1 {
		var confirmedLinkCount int64
		db.DB.Model(&models.ExpenseBankTransaction{}).
			Where("expense_id = ? AND status = ?", req.ExpenseID, "confirmed").
			Count(&confirmedLinkCount)
		if confirmedLinkCount >= 1 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "this expense has multiple receipt files and is already linked to a transaction — split-payment links are only allowed for single-receipt expenses",
			})
		}
	}

	// Delete any existing row for this pair first (could be a prior "suggested" entry)
	// to avoid hitting the composite primary key constraint on the insert below.
	db.DB.Where("expense_id = ? AND bank_transaction_id = ?", req.ExpenseID, req.TransactionID).
		Delete(&models.ExpenseBankTransaction{})

	// Create the confirmed link in the join table.
	// Previously this set expense.BankTransactionID — that field no longer exists.
	db.DB.Create(&models.ExpenseBankTransaction{
		ExpenseID:         req.ExpenseID,
		BankTransactionID: req.TransactionID,
		Status:            "confirmed",
	})

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "successfully linked receipt to expense",
	})
}

// UnlinkExpense removes a specific confirmed link between an Expense and a BankTransaction
func UnlinkExpense(c fiber.Ctx) error {
	type UnlinkRequest struct {
		ExpenseID uint `json:"expenseId"`
		// TransactionID is required because an expense can be linked to multiple
		// transactions (split payments), so we need to know which specific link to remove.
		TransactionID uint `json:"transactionId"`
	}

	var req UnlinkRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	var tx models.BankTransaction
	if err := db.DB.First(&tx, req.TransactionID).Error; err == nil {
		if utils.IsMonthClosed(tx.Date.Year(), int(tx.Date.Month())) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot unlink items in a closed accounting period."})
		}
	}

	var exp models.Expense
	if err := db.DB.First(&exp, req.ExpenseID).Error; err == nil {
		if utils.IsMonthClosed(exp.Timestamp.Year(), int(exp.Timestamp.Month())) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot unlink items in a closed accounting period."})
		}
	}

	// Delete the specific join row for this expense+transaction pair.
	result := db.DB.Where("expense_id = ? AND bank_transaction_id = ?", req.ExpenseID, req.TransactionID).
		Delete(&models.ExpenseBankTransaction{})

	if result.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "link not found"})
	}

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

	if utils.IsMonthClosed(expense.Timestamp.Year(), int(expense.Timestamp.Month())) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot modify an expense in a closed accounting period."})
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
	// Same join-table approach as GetFlaggedItems — no confirmed link and not cash.
	db.DB.Where("tender != 'cash'").
		Where("id NOT IN (?)", db.DB.Table("expense_bank_transactions").Select("expense_id").Where("status = ?", "confirmed")).
		Order("timestamp DESC").
		Preload("Receipts").
		Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
		"expenses":     expenses,
	})
}
