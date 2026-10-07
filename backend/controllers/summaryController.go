package controllers

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
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

	type amtResult struct{ Total float64 }

	// Income: sum of positive bank transaction amounts (deposits/credits)
	var totalIncome amtResult
	incQ := db.DB.Model(&models.BankTransaction{}).Select("COALESCE(SUM(amount), 0) as total").Where("amount > 0").Where(inBooksClause)
	if startDate != "" { incQ = incQ.Where("date >= ?", startDate) }
	if endDate != ""   { incQ = incQ.Where("date <= ?", endDate) }
	if accountId != "" { incQ = incQ.Where("chart_account_id = ? OR category_account_id = ?", accountId, accountId) }
	incQ.Scan(&totalIncome)

	// Debits: sum of negative bank transaction amounts (payments/debits)
	var totalDebits amtResult
	debQ := db.DB.Model(&models.BankTransaction{}).Select("COALESCE(SUM(amount), 0) as total").Where("amount < 0").Where(inBooksClause)
	if startDate != "" { debQ = debQ.Where("date >= ?", startDate) }
	if endDate != ""   { debQ = debQ.Where("date <= ?", endDate) }
	if accountId != "" { debQ = debQ.Where("chart_account_id = ? OR category_account_id = ?", accountId, accountId) }
	debQ.Scan(&totalDebits)

	// Total transaction count
	var txCount int64
	txQ := db.DB.Model(&models.BankTransaction{}).Where(inBooksClause)
	if startDate != "" { txQ = txQ.Where("date >= ?", startDate) }
	if endDate != ""   { txQ = txQ.Where("date <= ?", endDate) }
	if accountId != "" { txQ = txQ.Where("chart_account_id = ? OR category_account_id = ?", accountId, accountId) }
	txQ.Count(&txCount)

	// Unmatched transaction count
	var unmatchedCount int64
	umQ := db.DB.Model(&models.BankTransaction{}).Where("reconciliation_status != ?", "MATCHED").Where(inBooksClause)
	if startDate != "" { umQ = umQ.Where("date >= ?", startDate) }
	if endDate != ""   { umQ = umQ.Where("date <= ?", endDate) }
	umQ.Count(&unmatchedCount)

	// Expense total (expenses stored as positive amounts)
	var totalExpenses amtResult
	expQ := db.DB.Model(&models.Expense{}).Select("COALESCE(SUM(amount), 0) as total").Where(inBooksClause)
	if startDate != "" { expQ = expQ.Where("timestamp >= ?", startDate) }
	if endDate != ""   { expQ = expQ.Where("timestamp <= ?", endDate) }
	expQ.Scan(&totalExpenses)

	// Expense count
	var expCount int64
	ecQ := db.DB.Model(&models.Expense{}).Where(inBooksClause)
	if startDate != "" { ecQ = ecQ.Where("timestamp >= ?", startDate) }
	if endDate != ""   { ecQ = ecQ.Where("timestamp <= ?", endDate) }
	ecQ.Count(&expCount)

	// Unlinked expense count
	var unlinkedExpCount int64
	ulQ := db.DB.Model(&models.Expense{}).Where("reconciliation_status != ?", "MATCHED").Where(inBooksClause)
	if startDate != "" { ulQ = ulQ.Where("timestamp >= ?", startDate) }
	if endDate != ""   { ulQ = ulQ.Where("timestamp <= ?", endDate) }
	ulQ.Count(&unlinkedExpCount)

	netCashflow := totalIncome.Total + totalDebits.Total

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":           "success",
		"totalIncome":      totalIncome.Total,
		"totalDebits":      totalDebits.Total,
		"totalExpenses":    totalExpenses.Total,
		"netCashflow":      netCashflow,
		"transactionCount": txCount,
		"expenseCount":     expCount,
		"unmatchedTxCount": unmatchedCount,
		"unlinkedExpCount": unlinkedExpCount,
	})
}
