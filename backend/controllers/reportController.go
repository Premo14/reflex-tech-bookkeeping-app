package controllers

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

// GetProfitLoss returns a structured Profit & Loss report for a given date range.
//
// Logic:
//   - REVENUE lines: sum of BankTransaction amounts grouped by ChartAccountID
//     where the ChartAccount type = REVENUE, filtered by date range.
//   - EXPENSE lines: sum of Expense amounts grouped by ChartAccountID
//     where the ChartAccount type = EXPENSE, filtered by date range.
//
// This avoids double-counting (expenses are tracked on the Expense record,
// income/deposits are tracked on BankTransaction records).
func GetProfitLoss(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")

	// --- REVENUE: from BankTransactions linked to REVENUE-type accounts ---
	type AccountLine struct {
		AccountCode string
		AccountName string
		Total       float64
	}

	var revenueLines []AccountLine
	revQ := db.DB.Table("bank_transactions bt").
		Select("ca.code as account_code, ca.name as account_name, COALESCE(SUM(bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.chart_account_id").
		Where("ca.type = ?", "REVENUE").
		Group("ca.id, ca.code, ca.name").
		Order("ca.code ASC")
	if startDate != "" {
		revQ = revQ.Where("bt.date >= ?", startDate)
	}
	if endDate != "" {
		revQ = revQ.Where("bt.date <= ?", endDate)
	}
	revQ.Scan(&revenueLines)

	// Total revenue
	var totalRevenue float64
	for _, line := range revenueLines {
		totalRevenue += line.Total
	}

	// --- EXPENSES: from Expense records linked to EXPENSE-type accounts ---
	var expenseLines []AccountLine
	expQ := db.DB.Table("expenses e").
		Select("ca.code as account_code, ca.name as account_name, COALESCE(SUM(e.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = e.chart_account_id").
		Where("ca.type = ?", "EXPENSE").
		Group("ca.id, ca.code, ca.name").
		Order("ca.code ASC")
	if startDate != "" {
		expQ = expQ.Where("e.timestamp >= ?", startDate)
	}
	if endDate != "" {
		expQ = expQ.Where("e.timestamp <= ?", endDate)
	}
	expQ.Scan(&expenseLines)

	// Total expenses
	var totalExpenses float64
	for _, line := range expenseLines {
		totalExpenses += line.Total
	}

	// Also count uncategorized transactions and expenses for completeness
	var uncategorizedTxCount int64
	uncatTxQ := db.DB.Model(&models.BankTransaction{}).Where("chart_account_id IS NULL OR chart_account_id NOT IN (?)",
		db.DB.Table("chart_accounts").Select("id").Where("type IN ?", []string{"REVENUE", "EXPENSE"}))
	if startDate != "" { uncatTxQ = uncatTxQ.Where("date >= ?", startDate) }
	if endDate != ""   { uncatTxQ = uncatTxQ.Where("date <= ?", endDate) }
	uncatTxQ.Count(&uncategorizedTxCount)

	var uncategorizedExpCount int64
	uncatExpQ := db.DB.Model(&models.Expense{}).Where("chart_account_id IS NULL")
	if startDate != "" { uncatExpQ = uncatExpQ.Where("timestamp >= ?", startDate) }
	if endDate != ""   { uncatExpQ = uncatExpQ.Where("timestamp <= ?", endDate) }
	uncatExpQ.Count(&uncategorizedExpCount)

	netIncome := totalRevenue - totalExpenses

	// Convert slice to a serializable format
	type PLLine struct {
		AccountCode string  `json:"accountCode"`
		AccountName string  `json:"accountName"`
		Total       float64 `json:"total"`
	}
	revLines := make([]PLLine, len(revenueLines))
	for i, l := range revenueLines {
		revLines[i] = PLLine{l.AccountCode, l.AccountName, l.Total}
	}
	expLines := make([]PLLine, len(expenseLines))
	for i, l := range expenseLines {
		expLines[i] = PLLine{l.AccountCode, l.AccountName, l.Total}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":                  "success",
		"startDate":               startDate,
		"endDate":                 endDate,
		"revenue":                 revLines,
		"totalRevenue":            totalRevenue,
		"expenses":                expLines,
		"totalExpenses":           totalExpenses,
		"netIncome":               netIncome,
		"uncategorizedTxCount":    uncategorizedTxCount,
		"uncategorizedExpCount":   uncategorizedExpCount,
	})
}
