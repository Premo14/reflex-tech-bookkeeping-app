package controllers

import (
	"sort"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

// GetProfitLoss returns a structured Profit & Loss report for a given date range.
//
// Logic:
//   - REVENUE lines: sum of BankTransaction amounts grouped by ChartAccountID
//     where ChartAccount type = REVENUE (plus any uncategorized deposits under Suspense).
//   - EXPENSE lines:
//     1. sum of Expense amounts where ChartAccount type = EXPENSE.
//     2. sum of unlinked BankTransaction debits categorized under EXPENSE accounts.
//     3. uncategorized expenses and unlinked uncategorized debits grouped under Suspense (9999).
func GetProfitLoss(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")

	type AccountLine struct {
		AccountCode string
		AccountName string
		Total       float64
	}

	type amtResult struct{ Total float64 }

	// --- REVENUE ---
	var revenueLines []AccountLine
	revQ := db.DB.Table("bank_transactions bt").
		Select("ca.code as account_code, ca.name as account_name, COALESCE(SUM(bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "REVENUE").
		Where(inBooksClauseBT).
		Group("ca.id, ca.code, ca.name").
		Order("ca.code ASC")
	revQ = ApplyDateRange(revQ, "bt.date", startDate, endDate)
	if err := revQ.Scan(&revenueLines).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to calculate revenue lines"})
	}

	// Uncategorized deposits (amount > 0, category_account_id IS NULL)
	var uncatDeposits amtResult
	uncatDepQ := db.DB.Model(&models.BankTransaction{}).
		Select("COALESCE(SUM(amount), 0) as total").
		Where("amount > 0").
		Where("category_account_id IS NULL").
		Where(inBooksClause)
	uncatDepQ = ApplyDateRange(uncatDepQ, "date", startDate, endDate)
	if err := uncatDepQ.Scan(&uncatDeposits).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to calculate uncategorized deposits"})
	}

	if uncatDeposits.Total > 0 {
		revenueLines = append(revenueLines, AccountLine{
			AccountCode: "9998",
			AccountName: "Uncategorized Income / Suspense",
			Total:       uncatDeposits.Total,
		})
	}

	sort.Slice(revenueLines, func(i, j int) bool {
		return revenueLines[i].AccountCode < revenueLines[j].AccountCode
	})

	var totalRevenue float64
	for _, line := range revenueLines {
		totalRevenue += line.Total
	}

	// --- EXPENSES ---
	expenseMap := make(map[string]*AccountLine)

	// 1. From confirmed Expense records
	var expFromReceipts []AccountLine
	expQ := db.DB.Table("expenses e").
		Select("ca.code as account_code, ca.name as account_name, COALESCE(SUM(e.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = e.chart_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where(inBooksClauseExpAS).
		Where("(LOWER(COALESCE(e.tender, '')) = 'cash' OR e.id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))").
		Group("ca.id, ca.code, ca.name")
	expQ = ApplyDateRange(expQ, "e.timestamp", startDate, endDate)
	if err := expQ.Scan(&expFromReceipts).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to calculate expense records"})
	}
	for _, line := range expFromReceipts {
		l := line
		expenseMap[line.AccountCode] = &l
	}

	// 2. From unlinked Bank Transactions categorized under EXPENSE accounts.
	// Netting `-bt.amount` properly includes debits (-amount > 0) and vendor refunds/rebates (+amount, so -amount < 0 contra-expense).
	var expFromDebits []AccountLine
	debitQ := db.DB.Table("bank_transactions bt").
		Select("ca.code as account_code, ca.name as account_name, COALESCE(SUM(-bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where("bt.id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where(inBooksClauseBT).
		Group("ca.id, ca.code, ca.name")
	debitQ = ApplyDateRange(debitQ, "bt.date", startDate, endDate)
	if err := debitQ.Scan(&expFromDebits).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to calculate expense debits"})
	}
	for _, line := range expFromDebits {
		if existing, ok := expenseMap[line.AccountCode]; ok {
			existing.Total += line.Total
		} else {
			l := line
			expenseMap[line.AccountCode] = &l
		}
	}

	// 3. Uncategorized Expenses and unlinked uncategorized Bank Debits
	var uncatExpTotal amtResult
	ueQ := db.DB.Model(&models.Expense{}).
		Select("COALESCE(SUM(amount), 0) as total").
		Where("chart_account_id IS NULL").
		Where(inBooksClause).
		Where("(LOWER(COALESCE(tender, '')) = 'cash' OR id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))")
	ueQ = ApplyDateRange(ueQ, "timestamp", startDate, endDate)
	if err := ueQ.Scan(&uncatExpTotal).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to calculate uncategorized expenses"})
	}

	var uncatDebitTotal amtResult
	udQ := db.DB.Model(&models.BankTransaction{}).
		Select("COALESCE(SUM(ABS(amount)), 0) as total").
		Where("amount < 0").
		Where("category_account_id IS NULL").
		Where("id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where(inBooksClause)
	udQ = ApplyDateRange(udQ, "date", startDate, endDate)
	if err := udQ.Scan(&uncatDebitTotal).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to calculate uncategorized bank debits"})
	}

	totalUncatExpenses := uncatExpTotal.Total + uncatDebitTotal.Total
	if totalUncatExpenses > 0 {
		expenseMap["9999"] = &AccountLine{
			AccountCode: "9999",
			AccountName: "Uncategorized Expenses / Suspense",
			Total:       totalUncatExpenses,
		}
	}

	var expenseLines []AccountLine
	for _, line := range expenseMap {
		expenseLines = append(expenseLines, *line)
	}
	sort.Slice(expenseLines, func(i, j int) bool {
		return expenseLines[i].AccountCode < expenseLines[j].AccountCode
	})

	var totalExpenses float64
	for _, line := range expenseLines {
		totalExpenses += line.Total
	}

	// Also count uncategorized transactions and expenses for completeness
	var uncategorizedTxCount int64
	uncatTxQ := db.DB.Model(&models.BankTransaction{}).Where(inBooksClause).Where("category_account_id IS NULL OR category_account_id NOT IN (?)",
		db.DB.Table("chart_accounts").Select("id").Where("active = true"))
	uncatTxQ = ApplyDateRange(uncatTxQ, "date", startDate, endDate)
	uncatTxQ.Count(&uncategorizedTxCount)

	var uncategorizedExpCount int64
	uncatExpQ := db.DB.Model(&models.Expense{}).Where(inBooksClause).Where("chart_account_id IS NULL")
	uncatExpQ = ApplyDateRange(uncatExpQ, "timestamp", startDate, endDate)
	uncatExpQ.Count(&uncategorizedExpCount)

	// Disclosure: items excluded from the books in this date range (not counted above).
	type exclAgg struct {
		Count int64
		Total float64
	}
	var exclTx, exclExp exclAgg
	exTxQ := db.DB.Model(&models.BankTransaction{}).Select("COUNT(*) as count, COALESCE(SUM(ABS(amount)), 0) as total").Where("review_status = ?", "IGNORED")
	exTxQ = ApplyDateRange(exTxQ, "date", startDate, endDate)
	exTxQ.Scan(&exclTx)
	exExpQ := db.DB.Model(&models.Expense{}).Select("COUNT(*) as count, COALESCE(SUM(amount), 0) as total").Where("review_status = ?", "IGNORED")
	exExpQ = ApplyDateRange(exExpQ, "timestamp", startDate, endDate)
	exExpQ.Scan(&exclExp)

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

	var salesTaxTotal amtResult
	stQ := db.DB.Model(&models.Expense{}).
		Select("COALESCE(SUM(tax_amount), 0) as total").
		Where(inBooksClause)
	stQ = ApplyDateRange(stQ, "timestamp", startDate, endDate)
	stQ.Scan(&salesTaxTotal)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":                  "success",
		"startDate":               startDate,
		"endDate":                 endDate,
		"revenue":                 revLines,
		"totalRevenue":            totalRevenue,
		"expenses":                expLines,
		"totalExpenses":           totalExpenses,
		"netIncome":               netIncome,
		"totalTax":                salesTaxTotal.Total,
		"uncategorizedTxCount":    uncategorizedTxCount,
		"uncategorizedExpCount":   uncategorizedExpCount,
		"excludedTxCount":         exclTx.Count,
		"excludedTxTotal":         exclTx.Total,
		"excludedExpCount":        exclExp.Count,
		"excludedExpTotal":        exclExp.Total,
	})
}
