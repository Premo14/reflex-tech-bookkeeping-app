package controllers

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

// GetSummary returns aggregate totals for the given date range and optional account filter.
// Used by the frontend summary bar to display period totals.
//
// Optional query parameters:
//   - ?startDate=2026-01-01
//   - ?endDate=2026-12-31
//   - ?accountId=5
func GetSummary(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}

	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	accountId := c.Query("accountId")

	var accountIDs []uint
	if accountId != "" {
		parsedID, err := strconv.ParseUint(accountId, 10, 32)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid accountId"})
		}
		accountIDs = GetAccountAndDescendantIDs(uint(parsedID))
	}

	type amtResult struct {
		Total models.Money `gorm:"column:total"`
	}

	applyTxAccountFilter := func(q *gorm.DB) *gorm.DB {
		if len(accountIDs) > 0 {
			return q.Where("chart_account_id IN ? OR category_account_id IN ?", accountIDs, accountIDs)
		}
		return q
	}

	applyJoinedTxAccountFilter := func(q *gorm.DB) *gorm.DB {
		if len(accountIDs) > 0 {
			return q.Where("bt.chart_account_id IN ? OR bt.category_account_id IN ?", accountIDs, accountIDs)
		}
		return q
	}

	applyExpAccountFilter := func(q *gorm.DB) *gorm.DB {
		if len(accountIDs) > 0 {
			return q.Where(
				"expenses.chart_account_id IN ? OR expenses.id IN (SELECT ebt.expense_id FROM expense_bank_transactions ebt JOIN bank_transactions bt ON bt.id = ebt.bank_transaction_id WHERE ebt.status = 'confirmed' AND bt.chart_account_id IN ?)",
				accountIDs, accountIDs,
			)
		}
		return q
	}

	// 1. Operating Income / Revenue:
	// Matches P&L: bank transactions categorized as REVENUE + uncategorized bank deposits on ASSET accounts.
	var revCategorized amtResult
	revCatQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "REVENUE").
		Where(inBooksClauseBT)
	revCatQ = applyJoinedTxAccountFilter(revCatQ)
	revCatQ = ApplyDateRange(revCatQ, "bt.date", startDate, endDate)
	_ = revCatQ.Scan(&revCategorized)

	var uncatDeposits amtResult
	uncatDepQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(bt.amount), 0) as total").
		Joins("LEFT JOIN chart_accounts bank_ca ON bank_ca.id = bt.chart_account_id").
		Where("bt.amount > 0").
		Where("bt.category_account_id IS NULL").
		Where("COALESCE(bank_ca.type, '') != ?", "LIABILITY").
		Where(inBooksClauseBT)
	uncatDepQ = applyJoinedTxAccountFilter(uncatDepQ)
	uncatDepQ = ApplyDateRange(uncatDepQ, "bt.date", startDate, endDate)
	_ = uncatDepQ.Scan(&uncatDeposits)

	totalIncome := revCategorized.Total.Add(uncatDeposits.Total)

	// 2. Bank Cash Flow (Deposits & Debits):
	var totalDeposits amtResult
	depQ := db.DB.Model(&models.BankTransaction{}).Select("COALESCE(SUM(amount), 0) as total").Where("amount > 0").Where(inBooksClause)
	depQ = applyTxAccountFilter(depQ)
	depQ = ApplyDateRange(depQ, "date", startDate, endDate)
	_ = depQ.Scan(&totalDeposits)

	var totalDebits amtResult
	debQ := db.DB.Model(&models.BankTransaction{}).Select("COALESCE(SUM(amount), 0) as total").Where("amount < 0").Where(inBooksClause)
	debQ = applyTxAccountFilter(debQ)
	debQ = ApplyDateRange(debQ, "date", startDate, endDate)
	_ = debQ.Scan(&totalDebits)

	depositsMoney := totalDeposits.Total
	debitsMoney := totalDebits.Total

	// 3. Operating Expenses (matches P&L sources a–d):
	var expFromReceipts amtResult
	expQ := db.DB.Table("expenses").
		Select("COALESCE(SUM(expenses.amount), 0) as total").
		Joins("LEFT JOIN chart_accounts ca ON ca.id = expenses.chart_account_id").
		Where("expenses.deleted_at IS NULL AND (expenses.review_status IS NULL OR expenses.review_status = '' OR expenses.review_status = 'APPROVED' OR expenses.review_status = 'WARNINGS_IGNORED')").
		Where("(ca.type = 'EXPENSE' OR expenses.chart_account_id IS NULL)").
		Where("(LOWER(TRIM(COALESCE(expenses.tender, ''))) IN ('cash', 'cash / paper', 'cash/paper', 'currency', 'paper') OR expenses.review_status = 'WARNINGS_IGNORED' OR expenses.id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))")
	expQ = applyExpAccountFilter(expQ)
	expQ = ApplyDateRange(expQ, "expenses.timestamp", startDate, endDate)
	_ = expQ.Scan(&expFromReceipts)

	var unlinkedExpDebits amtResult
	unlinkedDebQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(-bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where("bt.id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where(inBooksClauseBT)
	unlinkedDebQ = applyJoinedTxAccountFilter(unlinkedDebQ)
	unlinkedDebQ = ApplyDateRange(unlinkedDebQ, "bt.date", startDate, endDate)
	_ = unlinkedDebQ.Scan(&unlinkedExpDebits)

	var uncatDebitTotal amtResult
	udQ := db.DB.Model(&models.BankTransaction{}).
		Select("COALESCE(SUM(ABS(amount)), 0) as total").
		Where("amount < 0").
		Where("category_account_id IS NULL").
		Where("id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where(inBooksClause)
	udQ = applyTxAccountFilter(udQ)
	udQ = ApplyDateRange(udQ, "date", startDate, endDate)
	_ = udQ.Scan(&uncatDebitTotal)

	var partialDebitRemainder amtResult
	partQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(ABS(bt.amount) - sub.allocated), 0) as total").
		Joins("JOIN (SELECT bank_transaction_id, SUM(e.amount) as allocated FROM expense_bank_transactions ebt JOIN expenses e ON e.id = ebt.expense_id WHERE ebt.status = 'confirmed' AND e.deleted_at IS NULL GROUP BY bank_transaction_id) sub ON sub.bank_transaction_id = bt.id").
		Joins("LEFT JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("bt.amount < 0").
		Where("bt.allocation_status IN ('PARTIALLY_ALLOCATED', 'PARTIAL')").
		Where("ABS(bt.amount) > sub.allocated").
		Where("(ca.type = 'EXPENSE' OR bt.category_account_id IS NULL)").
		Where(inBooksClauseBT)
	partQ = applyJoinedTxAccountFilter(partQ)
	partQ = ApplyDateRange(partQ, "bt.date", startDate, endDate)
	_ = partQ.Scan(&partialDebitRemainder)

	totalExpenses := expFromReceipts.Total.
		Add(unlinkedExpDebits.Total).
		Add(uncatDebitTotal.Total).
		Add(partialDebitRemainder.Total)

	// Total transaction count
	var txCount int64
	txQ := db.DB.Model(&models.BankTransaction{}).Where(inBooksClause)
	txQ = applyTxAccountFilter(txQ)
	txQ = ApplyDateRange(txQ, "date", startDate, endDate)
	txQ.Count(&txCount)

	// Unlinked transaction count (needs attention)
	var unlinkedTxCount int64
	umQ := db.DB.Model(&models.BankTransaction{}).Where(needsAttentionClause)
	umQ = applyTxAccountFilter(umQ)
	umQ = ApplyDateRange(umQ, "date", startDate, endDate)
	umQ.Count(&unlinkedTxCount)

	// Expense count
	var expCount int64
	ecQ := db.DB.Model(&models.Expense{}).Where(inBooksClause)
	ecQ = applyExpAccountFilter(ecQ)
	ecQ = ApplyDateRange(ecQ, "timestamp", startDate, endDate)
	ecQ.Count(&expCount)

	// Unlinked expense count (needs attention)
	var unlinkedExpCount int64
	ulQ := db.DB.Model(&models.Expense{}).Where(notCashClause).Where(needsAttentionClause)
	ulQ = applyExpAccountFilter(ulQ)
	ulQ = ApplyDateRange(ulQ, "timestamp", startDate, endDate)
	ulQ.Count(&unlinkedExpCount)

	netCashflow := depositsMoney.Add(debitsMoney)
	netIncome := totalIncome.Sub(totalExpenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":           "success",
		"totalIncome":      totalIncome,
		"totalDeposits":    depositsMoney,
		"totalDebits":      debitsMoney,
		"totalExpenses":    totalExpenses,
		"netCashflow":      netCashflow,
		"netIncome":        netIncome,
		"transactionCount": txCount,
		"expenseCount":     expCount,
		"unlinkedTxCount":  unlinkedTxCount,
		"unlinkedExpCount": unlinkedExpCount,
	})
}
