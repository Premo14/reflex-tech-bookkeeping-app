package controllers

import (
	"strconv"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

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
	startDate := c.Query("startDate")
	endDate   := c.Query("endDate")
	accountId := c.Query("accountId")

	var accountIDs []uint
	if accountId != "" {
		if parsedID, err := strconv.ParseUint(accountId, 10, 32); err == nil {
			accountIDs = GetAccountAndDescendantIDs(uint(parsedID))
		}
	}

	type amtResult struct{ Total float64 }

	applyTxAccountFilter := func(q *gorm.DB) *gorm.DB {
		if len(accountIDs) > 0 {
			return q.Where("chart_account_id IN ? OR category_account_id IN ?", accountIDs, accountIDs)
		} else if accountId != "" {
			return q.Where("chart_account_id = ? OR category_account_id = ?", accountId, accountId)
		}
		return q
	}

	applyExpAccountFilter := func(q *gorm.DB) *gorm.DB {
		if len(accountIDs) > 0 {
			return q.Where(
				"chart_account_id IN ? OR id IN (SELECT ebt.expense_id FROM expense_bank_transactions ebt JOIN bank_transactions bt ON bt.id = ebt.bank_transaction_id WHERE bt.chart_account_id IN ?)",
				accountIDs, accountIDs,
			)
		} else if accountId != "" {
			return q.Where("chart_account_id = ?", accountId)
		}
		return q
	}

	// 1. Operating Income / Revenue:
	// Matches P&L: bank transactions categorized as REVENUE + uncategorized bank deposits.
	var revCategorized amtResult
	revCatQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "REVENUE").
		Where(inBooksClauseBT)
	if len(accountIDs) > 0 {
		revCatQ = revCatQ.Where("bt.chart_account_id IN ? OR bt.category_account_id IN ?", accountIDs, accountIDs)
	} else if accountId != "" {
		revCatQ = revCatQ.Where("bt.chart_account_id = ? OR bt.category_account_id = ?", accountId, accountId)
	}
	revCatQ = ApplyDateRange(revCatQ, "bt.date", startDate, endDate)
	_ = revCatQ.Scan(&revCategorized)

	var uncatDeposits amtResult
	uncatDepQ := db.DB.Model(&models.BankTransaction{}).
		Select("COALESCE(SUM(amount), 0) as total").
		Where("amount > 0").
		Where("category_account_id IS NULL").
		Where(inBooksClause)
	uncatDepQ = applyTxAccountFilter(uncatDepQ)
	uncatDepQ = ApplyDateRange(uncatDepQ, "date", startDate, endDate)
	_ = uncatDepQ.Scan(&uncatDeposits)

	totalIncome := revCategorized.Total + uncatDeposits.Total

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

	// 3. Operating Expenses:
	// Matches P&L:
	//   a) Confirmed Expense records (e.g. receipts/invoices)
	//   b) Unlinked bank transactions categorized under EXPENSE accounts (net -bt.amount for debits and refunds)
	//   c) Unlinked uncategorized bank debits (Suspense)
	var expFromReceipts amtResult
	expQ := db.DB.Model(&models.Expense{}).
		Select("COALESCE(SUM(amount), 0) as total").
		Where(inBooksClause).
		Where("LOWER(COALESCE(tender, '')) = 'cash' OR id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed')")
	expQ = applyExpAccountFilter(expQ)
	expQ = ApplyDateRange(expQ, "timestamp", startDate, endDate)
	_ = expQ.Scan(&expFromReceipts)

	var unlinkedExpDebits amtResult
	unlinkedDebQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(-bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where("bt.id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where(inBooksClauseBT)
	if len(accountIDs) > 0 {
		unlinkedDebQ = unlinkedDebQ.Where("bt.chart_account_id IN ? OR bt.category_account_id IN ?", accountIDs, accountIDs)
	} else if accountId != "" {
		unlinkedDebQ = unlinkedDebQ.Where("bt.chart_account_id = ? OR bt.category_account_id = ?", accountId, accountId)
	}
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

	totalExpenses := expFromReceipts.Total + unlinkedExpDebits.Total + uncatDebitTotal.Total

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

	netCashflow := totalDeposits.Total + totalDebits.Total
	netIncome := totalIncome - totalExpenses

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":           "success",
		"totalIncome":      totalIncome,
		"totalDeposits":    totalDeposits.Total,
		"totalDebits":      totalDebits.Total,
		"totalExpenses":    totalExpenses,
		"netCashflow":      netCashflow,
		"netIncome":        netIncome,
		"transactionCount": txCount,
		"expenseCount":     expCount,
		"unlinkedTxCount":  unlinkedTxCount,
		"unlinkedExpCount": unlinkedExpCount,
	})
}
