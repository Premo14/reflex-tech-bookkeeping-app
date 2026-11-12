package controllers

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

func roundCents(v float64) float64 {
	return math.Round(v*100) / 100
}

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

	// Uncategorized deposits on ASSET accounts (amount > 0, category_account_id IS NULL).
	// Exclude LIABILITY (Credit Card) accounts so card bill payments and merchant refunds
	// are not misclassified as Uncategorized Business Revenue.
	var uncatDeposits amtResult
	uncatDepQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(bt.amount), 0) as total").
		Joins("LEFT JOIN chart_accounts bank_ca ON bank_ca.id = bt.chart_account_id").
		Where("bt.amount > 0").
		Where("bt.category_account_id IS NULL").
		Where("COALESCE(bank_ca.type, '') != ?", "LIABILITY").
		Where(inBooksClauseBT)
	uncatDepQ = ApplyDateRange(uncatDepQ, "bt.date", startDate, endDate)
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

	for i := range revenueLines {
		revenueLines[i].Total = roundCents(revenueLines[i].Total)
	}

	sort.Slice(revenueLines, func(i, j int) bool {
		return revenueLines[i].AccountCode < revenueLines[j].AccountCode
	})

	var totalRevenue float64
	for _, line := range revenueLines {
		totalRevenue += line.Total
	}
	totalRevenue = roundCents(totalRevenue)

	// --- EXPENSES ---
	expenseMap := make(map[string]*AccountLine)

	// 1. From confirmed Expense records
	var expFromReceipts []AccountLine
	expQ := db.DB.Table("expenses e").
		Select("ca.code as account_code, ca.name as account_name, COALESCE(SUM(e.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = e.chart_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where(inBooksClauseExpAS).
		Where("(LOWER(COALESCE(e.tender, '')) = 'cash' OR e.review_status = 'WARNINGS_IGNORED' OR e.id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))").
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
		Where("(LOWER(COALESCE(tender, '')) = 'cash' OR review_status = 'WARNINGS_IGNORED' OR id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))")
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

	type partialDebitLine struct {
		AccountCode *string
		AccountName *string
		AccountType *string
		Total       float64
	}
	var partialDebitLines []partialDebitLine
	partQ := db.DB.Table("bank_transactions bt").
		Select("ca.code as account_code, ca.name as account_name, ca.type as account_type, COALESCE(SUM(ABS(bt.amount) - sub.allocated), 0) as total").
		Joins("JOIN (SELECT bank_transaction_id, SUM(e.amount) as allocated FROM expense_bank_transactions ebt JOIN expenses e ON e.id = ebt.expense_id WHERE ebt.status = 'confirmed' GROUP BY bank_transaction_id) sub ON sub.bank_transaction_id = bt.id").
		Joins("LEFT JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("bt.amount < 0").
		Where("bt.allocation_status = 'PARTIALLY_ALLOCATED'").
		Where(inBooksClauseBT).
		Group("ca.id, ca.code, ca.name, ca.type")
	partQ = ApplyDateRange(partQ, "bt.date", startDate, endDate)
	if err := partQ.Scan(&partialDebitLines).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to calculate partial debit remainders"})
	}

	var partialUncatRemainder float64
	for _, pl := range partialDebitLines {
		if pl.AccountCode != nil && pl.AccountType != nil && *pl.AccountType == "EXPENSE" {
			code := *pl.AccountCode
			name := ""
			if pl.AccountName != nil {
				name = *pl.AccountName
			}
			if existing, ok := expenseMap[code]; ok {
				existing.Total += pl.Total
			} else {
				expenseMap[code] = &AccountLine{
					AccountCode: code,
					AccountName: name,
					Total:       pl.Total,
				}
			}
		} else if pl.AccountCode == nil || pl.AccountType == nil {
			partialUncatRemainder += pl.Total
		}
	}

	totalUncatExpenses := uncatExpTotal.Total + uncatDebitTotal.Total + partialUncatRemainder
	if totalUncatExpenses > 0 {
		if existing, ok := expenseMap["9999"]; ok {
			existing.Total += totalUncatExpenses
		} else {
			expenseMap["9999"] = &AccountLine{
				AccountCode: "9999",
				AccountName: "Uncategorized Expenses / Suspense",
				Total:       totalUncatExpenses,
			}
		}
	}

	var expenseLines []AccountLine
	for _, line := range expenseMap {
		line.Total = roundCents(line.Total)
		expenseLines = append(expenseLines, *line)
	}
	sort.Slice(expenseLines, func(i, j int) bool {
		return expenseLines[i].AccountCode < expenseLines[j].AccountCode
	})

	var totalExpenses float64
	for _, line := range expenseLines {
		totalExpenses += line.Total
	}
	totalExpenses = roundCents(totalExpenses)

	// Also count uncategorized transactions and expenses for completeness (excluding confirmed-linked split transactions and LIABILITY card payment credits)
	var uncategorizedTxCount int64
	uncatTxQ := db.DB.Model(&models.BankTransaction{}).
		Where(inBooksClause).
		Where("category_account_id IS NULL").
		Where("id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where("NOT (amount > 0 AND chart_account_id IN (SELECT id FROM chart_accounts WHERE type = 'LIABILITY'))")
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

	netIncome := roundCents(totalRevenue - totalExpenses)

	// Convert slice to a serializable format
	type PLLine struct {
		AccountCode string `json:"accountCode"`
		AccountName string `json:"accountName"`
		Total       models.Money  `json:"total"`
	}
	revLines := make([]PLLine, len(revenueLines))
	for i, l := range revenueLines {
		revLines[i] = PLLine{l.AccountCode, l.AccountName, models.NewMoney(roundCents(l.Total))}
	}
	expLines := make([]PLLine, len(expenseLines))
	for i, l := range expenseLines {
		expLines[i] = PLLine{l.AccountCode, l.AccountName, models.NewMoney(roundCents(l.Total))}
	}

	var salesTaxTotal amtResult
	stQ := db.DB.Model(&models.Expense{}).
		Select("COALESCE(SUM(tax_amount), 0) as total").
		Where(inBooksClause).
		Where("(LOWER(COALESCE(tender, '')) = 'cash' OR review_status = 'WARNINGS_IGNORED' OR id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))")
	stQ = ApplyDateRange(stQ, "timestamp", startDate, endDate)
	stQ.Scan(&salesTaxTotal)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":                "success",
		"startDate":             startDate,
		"endDate":               endDate,
		"revenue":               revLines,
		"totalRevenue":          models.NewMoney(roundCents(totalRevenue)),
		"expenses":              expLines,
		"totalExpenses":         models.NewMoney(roundCents(totalExpenses)),
		"netIncome":             models.NewMoney(netIncome),
		"totalTax":              models.NewMoney(roundCents(salesTaxTotal.Total)),
		"uncategorizedTxCount":  uncategorizedTxCount,
		"uncategorizedExpCount": uncategorizedExpCount,
		"excludedTxCount":       exclTx.Count,
		"excludedTxTotal":       models.NewMoney(roundCents(exclTx.Total)),
		"excludedExpCount":      exclExp.Count,
		"excludedExpTotal":      models.NewMoney(roundCents(exclExp.Total)),
	})
}

type ScheduleCAccountDetail struct {
	AccountID   uint  `json:"accountId"`
	AccountCode string `json:"accountCode"`
	AccountName string `json:"accountName"`
	Total       models.Money  `json:"total"`
}

type ScheduleCExpenseLine struct {
	LineNumber        string                   `json:"lineNumber"`
	LineName          string                   `json:"lineName"`
	GrossAmount       models.Money                    `json:"grossAmount"`
	DeductiblePercent float64                  `json:"deductiblePercent"`
	DeductibleAmount  models.Money                    `json:"deductibleAmount"`
	Accounts          []ScheduleCAccountDetail `json:"accounts"`
}

type ScheduleCIncomeLine struct {
	LineNumber string                   `json:"lineNumber"`
	LineName   string                   `json:"lineName"`
	Amount     models.Money                    `json:"amount"`
	Accounts   []ScheduleCAccountDetail `json:"accounts"`
}

type QuarterlyTaxDeadline struct {
	Quarter   string       `json:"quarter"`   // "Q1", "Q2", "Q3", "Q4"
	Period    string       `json:"period"`    // e.g. "Jan 1 – Mar 31"
	DueDate   string       `json:"dueDate"`   // e.g. "April 15, 2026"
	AmountDue models.Money `json:"amountDue"` // Estimated quarterly payment
	IsPast    bool         `json:"isPast"`
}

type ScheduleCReportData struct {
	StartDate                  string                 `json:"startDate"`
	EndDate                    string                 `json:"endDate"`
	Year                       int                    `json:"year"`
	GrossReceipts              models.Money                  `json:"grossReceipts"`
	ReturnsAndAllowances       models.Money                  `json:"returnsAndAllowances"`
	NetReceipts                models.Money                  `json:"netReceipts"`
	CostOfGoodsSold            models.Money                  `json:"costOfGoodsSold"`
	GrossProfit                models.Money                  `json:"grossProfit"`
	OtherIncome                models.Money                  `json:"otherIncome"`
	GrossIncome                models.Money                  `json:"grossIncome"`
	IncomeLines                []ScheduleCIncomeLine  `json:"incomeLines"`
	ExpenseLines               []ScheduleCExpenseLine `json:"expenseLines"`
	TotalExpensesGross         models.Money                  `json:"totalExpensesGross"`
	TotalExpensesDeductible    models.Money                  `json:"totalExpensesDeductible"`
	NondeductibleMeals         models.Money                  `json:"nondeductibleMeals"`
	NetProfitOrLoss            models.Money                  `json:"netProfitOrLoss"`
	UncategorizedExpenseAmount models.Money                  `json:"uncategorizedExpenseAmount"`
	UncategorizedIncomeAmount  models.Money                  `json:"uncategorizedIncomeAmount"`
	UncategorizedTxCount       int64                  `json:"uncategorizedTxCount"`
	UncategorizedExpCount      int64                  `json:"uncategorizedExpCount"`
	SelfEmploymentTax           models.Money           `json:"selfEmploymentTax"`
	DeductibleSelfEmploymentTax models.Money           `json:"deductibleSelfEmploymentTax"`
	EstimatedIncomeTax          models.Money           `json:"estimatedIncomeTax"`
	TotalEstimatedTax           models.Money           `json:"totalEstimatedTax"`
	EstimatedQuarterlyTax       models.Money           `json:"estimatedQuarterlyTax"`
	QuarterlyDeadlines          []QuarterlyTaxDeadline `json:"quarterlyDeadlines"`
}

var scheduleCLineOrder = map[string]int{
	"Line 8": 80, "Line 9": 90, "Line 10": 100, "Line 11": 110, "Line 12": 120,
	"Line 13": 130, "Line 14": 140, "Line 15": 150, "Line 16a": 160, "Line 16b": 165,
	"Line 17": 170, "Line 18": 180, "Line 19": 190, "Line 20a": 200, "Line 20b": 205,
	"Line 21": 210, "Line 22": 220, "Line 23": 230, "Line 24a": 240, "Line 24b": 245,
	"Line 25": 250, "Line 26": 260, "Line 27a": 270, "Line 30": 300, "Suspense": 999,
}

func resolveScheduleCLine(acc models.ChartAccount) (lineNum string, lineName string, dedPct float64) {
	raw := strings.TrimSpace(acc.ScheduleCLine)
	if raw == "" {
		if acc.Type == "REVENUE" {
			if strings.Contains(strings.ToLower(acc.Name), "interest") {
				return "Line 6", "Other income", 100.0
			}
			return "Line 1", "Gross receipts or sales", 100.0
		}
		lower := strings.ToLower(acc.Name)
		code := acc.Code
		switch {
		case code == "5090" || strings.Contains(lower, "meal"):
			return "Line 24b", "Deductible meals (50%)", 50.0
		case code == "5020" || strings.Contains(lower, "payroll") || strings.Contains(lower, "wage"):
			return "Line 26", "Wages", 100.0
		case code == "5010" || strings.Contains(lower, "rent"):
			return "Line 20b", "Rent or lease (other business property)", 100.0
		case code == "5030" || strings.Contains(lower, "utilit"):
			return "Line 25", "Utilities", 100.0
		case strings.Contains(lower, "home office"):
			return "Line 30", "Expenses for business use of your home", 100.0
		case code == "5050" || strings.Contains(lower, "office"):
			return "Line 18", "Office expense", 100.0
		case code == "5060" || strings.Contains(lower, "suppl"):
			return "Line 22", "Supplies", 100.0
		case code == "5040" || strings.Contains(lower, "repair") || strings.Contains(lower, "maintenance"):
			return "Line 21", "Repairs and maintenance", 100.0
		case code == "5080" || strings.Contains(lower, "insur"):
			return "Line 15", "Insurance (other than health)", 100.0
		case code == "5110" || strings.Contains(lower, "profession") || strings.Contains(lower, "legal") || strings.Contains(lower, "accounting"):
			return "Line 17", "Legal and professional services", 100.0
		case code == "5310" || strings.Contains(lower, "advertis") || strings.Contains(lower, "market"):
			return "Line 8", "Advertising", 100.0
		case code == "5410" || strings.Contains(lower, "travel") || strings.Contains(lower, "flight") || strings.Contains(lower, "hotel") || strings.Contains(lower, "lodging"):
			return "Line 24a", "Travel", 100.0
		case strings.HasPrefix(code, "55") || strings.Contains(lower, "vehicle") || strings.Contains(lower, "auto") || strings.Contains(lower, "car") || strings.Contains(lower, "truck") || strings.Contains(lower, "gas") || strings.Contains(lower, "mileage") || strings.Contains(lower, "parking") || strings.Contains(lower, "toll"):
			return "Line 9", "Car and truck expenses", 100.0
		case strings.HasPrefix(code, "56") || strings.Contains(lower, "tax") || strings.Contains(lower, "license") || strings.Contains(lower, "permit") || strings.Contains(lower, "registration"):
			return "Line 23", "Taxes and licenses", 100.0
		case strings.HasPrefix(code, "57") || strings.Contains(lower, "depreciation") || strings.Contains(lower, "amortization") || strings.Contains(lower, "sec 179") || strings.Contains(lower, "section 179"):
			return "Line 13", "Depreciation and section 179 expense deduction", 100.0
		case strings.Contains(lower, "contractor") || strings.Contains(lower, "subcontract") || strings.Contains(lower, "freelance"):
			return "Line 11", "Contract labor", 100.0
		case strings.Contains(lower, "commission"):
			return "Line 10", "Commissions and fees", 100.0
		case strings.Contains(lower, "interest") || strings.Contains(lower, "finance charge"):
			return "Line 16b", "Other interest", 100.0
		case strings.Contains(lower, "benefit") || strings.Contains(lower, "pension"):
			return "Line 14", "Employee benefit programs", 100.0
		default:
			return "Line 27a", "Other expenses", 100.0
		}
	}

	parts := strings.SplitN(raw, "-", 2)
	lineNum = strings.TrimSpace(parts[0])
	if len(parts) > 1 {
		lineName = strings.TrimSpace(parts[1])
	} else {
		lineName = lineNum
	}

	dedPct = 100.0
	if strings.Contains(strings.ToLower(lineNum), "24b") || strings.Contains(strings.ToLower(lineName), "50%") {
		dedPct = 50.0
	}
	return lineNum, lineName, dedPct
}

// scheduleCIncomeTreatmentForLine maps only valid Schedule C income lines.
// Exact matching prevents labels such as "Line 21" from being interpreted as
// returns and allowances merely because they contain the digit 2.
func scheduleCIncomeTreatmentForLine(lineNum string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(lineNum))
	normalized = strings.TrimPrefix(normalized, "line ")
	switch normalized {
	case "1":
		return "gross_receipts", true
	case "2":
		return "returns_and_allowances", true
	case "4":
		return "cost_of_goods_sold", true
	case "6":
		return "other_income", true
	default:
		return "", false
	}
}

// BuildScheduleCData compiles the IRS Schedule C tax numbers for a given period.
func BuildScheduleCData(startDate, endDate string, year int) (*ScheduleCReportData, error) {
	if year == 0 {
		year = time.Now().Year()
	}
	if startDate == "" && endDate == "" {
		startDate = fmt.Sprintf("%d-01-01", year)
		endDate = fmt.Sprintf("%d-12-31", year)
	} else if startDate != "" && year == 0 {
		if t, err := time.Parse("2006-01-02", startDate); err == nil {
			year = t.Year()
		}
	}

	// Fetch all chart accounts into memory map
	var allAccounts []models.ChartAccount
	if err := db.DB.Find(&allAccounts).Error; err != nil {
		return nil, err
	}
	accMap := make(map[uint]models.ChartAccount)
	for _, a := range allAccounts {
		accMap[a.ID] = a
	}

	type rawAccSum struct {
		AccountID uint    `gorm:"column:account_id"`
		Total     float64 `gorm:"column:total"`
	}

	// --- 1. REVENUE ---
	var revSums []rawAccSum
	revQ := db.DB.Table("bank_transactions bt").
		Select("ca.id as account_id, COALESCE(SUM(bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "REVENUE").
		Where(inBooksClauseBT).
		Group("ca.id")
	revQ = ApplyDateRange(revQ, "bt.date", startDate, endDate)
	if err := revQ.Scan(&revSums).Error; err != nil {
		return nil, err
	}

	// Uncategorized deposits
	type amtResult struct{ Total float64 }
	var uncatDeposits amtResult
	uncatDepQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(bt.amount), 0) as total").
		Joins("LEFT JOIN chart_accounts bank_ca ON bank_ca.id = bt.chart_account_id").
		Where("bt.amount > 0").
		Where("bt.category_account_id IS NULL").
		Where("COALESCE(bank_ca.type, '') != ?", "LIABILITY").
		Where(inBooksClauseBT)
	uncatDepQ = ApplyDateRange(uncatDepQ, "bt.date", startDate, endDate)
	_ = uncatDepQ.Scan(&uncatDeposits)

	// --- 2. EXPENSES ---
	expByAccount := make(map[uint]float64)

	// 2a. Confirmed Expenses
	var expReceiptSums []rawAccSum
	expQ := db.DB.Table("expenses e").
		Select("ca.id as account_id, COALESCE(SUM(e.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = e.chart_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where(inBooksClauseExpAS).
		Where("(LOWER(COALESCE(e.tender, '')) = 'cash' OR e.review_status = 'WARNINGS_IGNORED' OR e.id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))").
		Group("ca.id")
	expQ = ApplyDateRange(expQ, "e.timestamp", startDate, endDate)
	if err := expQ.Scan(&expReceiptSums).Error; err != nil {
		return nil, err
	}
	for _, s := range expReceiptSums {
		expByAccount[s.AccountID] += s.Total
	}

	// 2b. Unlinked bank debits categorized under EXPENSE
	var debitSums []rawAccSum
	debitQ := db.DB.Table("bank_transactions bt").
		Select("ca.id as account_id, COALESCE(SUM(-bt.amount), 0) as total").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where("bt.id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where(inBooksClauseBT).
		Group("ca.id")
	debitQ = ApplyDateRange(debitQ, "bt.date", startDate, endDate)
	if err := debitQ.Scan(&debitSums).Error; err != nil {
		return nil, err
	}
	for _, s := range debitSums {
		expByAccount[s.AccountID] += s.Total
	}

	// 2c. Uncategorized expenses & unlinked debits
	var uncatExpTotal amtResult
	ueQ := db.DB.Model(&models.Expense{}).
		Select("COALESCE(SUM(amount), 0) as total").
		Where("chart_account_id IS NULL").
		Where(inBooksClause).
		Where("(LOWER(COALESCE(tender, '')) = 'cash' OR review_status = 'WARNINGS_IGNORED' OR id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))")
	ueQ = ApplyDateRange(ueQ, "timestamp", startDate, endDate)
	_ = ueQ.Scan(&uncatExpTotal)

	var uncatDebitTotal amtResult
	udQ := db.DB.Model(&models.BankTransaction{}).
		Select("COALESCE(SUM(ABS(amount)), 0) as total").
		Where("amount < 0").
		Where("category_account_id IS NULL").
		Where("id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where(inBooksClause)
	udQ = ApplyDateRange(udQ, "date", startDate, endDate)
	_ = udQ.Scan(&uncatDebitTotal)

	var partialDebitRemainder amtResult
	partQ := db.DB.Table("bank_transactions bt").
		Select("COALESCE(SUM(ABS(bt.amount) - sub.allocated), 0) as total").
		Joins("JOIN (SELECT bank_transaction_id, SUM(e.amount) as allocated FROM expense_bank_transactions ebt JOIN expenses e ON e.id = ebt.expense_id WHERE ebt.status = 'confirmed' GROUP BY bank_transaction_id) sub ON sub.bank_transaction_id = bt.id").
		Where("bt.amount < 0").
		Where("bt.allocation_status = 'PARTIALLY_ALLOCATED'").
		Where(inBooksClauseBT)
	partQ = ApplyDateRange(partQ, "bt.date", startDate, endDate)
	_ = partQ.Scan(&partialDebitRemainder)

	totalUncatExp := uncatExpTotal.Total + uncatDebitTotal.Total + partialDebitRemainder.Total

	// Aggregate into Income Lines
	var grossReceipts float64
	var returnsAndAllowances float64
	var cogs float64
	var otherIncome float64
	incomeLineMap := make(map[string]*ScheduleCIncomeLine)

	for _, s := range revSums {
		acc, ok := accMap[s.AccountID]
		if !ok {
			continue
		}
		lineNum, lineName, _ := resolveScheduleCLine(acc)
		treatment, ok := scheduleCIncomeTreatmentForLine(lineNum)
		if !ok {
			return nil, fmt.Errorf("revenue account %q is mapped to unsupported Schedule C income line %q; choose Line 1, 2, 4, or 6", acc.Name, lineNum)
		}
		key := lineNum + " - " + lineName
		if _, exists := incomeLineMap[key]; !exists {
			incomeLineMap[key] = &ScheduleCIncomeLine{
				LineNumber: lineNum,
				LineName:   lineName,
				Amount:     models.NewMoney(0),
				Accounts:   []ScheduleCAccountDetail{},
			}
		}
		incomeLineMap[key].Amount = incomeLineMap[key].Amount.Add(models.NewMoney(roundCents(s.Total)))
		incomeLineMap[key].Accounts = append(incomeLineMap[key].Accounts, ScheduleCAccountDetail{
			AccountID:   acc.ID,
			AccountCode: acc.Code,
			AccountName: acc.Name,
			Total:       models.NewMoney(roundCents(s.Total)),
		})

		switch treatment {
		case "gross_receipts":
			grossReceipts += s.Total
		case "returns_and_allowances":
			returnsAndAllowances += s.Total
		case "cost_of_goods_sold":
			cogs += s.Total
		case "other_income":
			otherIncome += s.Total
		}
	}

	if uncatDeposits.Total > 0 {
		key := "Suspense - Uncategorized Income"
		incomeLineMap[key] = &ScheduleCIncomeLine{
			LineNumber: "Suspense",
			LineName:   "Uncategorized Income",
			Amount:     models.NewMoney(roundCents(uncatDeposits.Total)),
			Accounts: []ScheduleCAccountDetail{
				{AccountID: 0, AccountCode: "9998", AccountName: "Uncategorized Income / Suspense", Total: models.NewMoney(roundCents(uncatDeposits.Total))},
			},
		}
		otherIncome += uncatDeposits.Total
	}

	var incomeLines []ScheduleCIncomeLine
	for _, l := range incomeLineMap {
		l.Amount = models.NewMoney(roundCents(l.Amount.Dollars()))
		incomeLines = append(incomeLines, *l)
	}
	sort.Slice(incomeLines, func(i, j int) bool {
		return incomeLines[i].LineNumber < incomeLines[j].LineNumber
	})

	netReceipts := grossReceipts - returnsAndAllowances
	grossProfit := netReceipts - cogs
	grossIncome := grossProfit + otherIncome

	// Aggregate Expenses into Schedule C Expense Lines
	expenseLineMap := make(map[string]*ScheduleCExpenseLine)

	for accID, total := range expByAccount {
		acc, ok := accMap[accID]
		if !ok || total == 0 {
			continue
		}
		lineNum, lineName, dedPct := resolveScheduleCLine(acc)
		key := lineNum + " - " + lineName
		if _, exists := expenseLineMap[key]; !exists {
			expenseLineMap[key] = &ScheduleCExpenseLine{
				LineNumber:        lineNum,
				LineName:          lineName,
				GrossAmount:       models.NewMoney(0),
				DeductiblePercent: dedPct,
				DeductibleAmount:  models.NewMoney(0),
				Accounts:          []ScheduleCAccountDetail{},
			}
		}
		line := expenseLineMap[key]
		line.GrossAmount = line.GrossAmount.Add(models.NewMoney(roundCents(total)))
		line.Accounts = append(line.Accounts, ScheduleCAccountDetail{
			AccountID:   acc.ID,
			AccountCode: acc.Code,
			AccountName: acc.Name,
			Total:       models.NewMoney(roundCents(total)),
		})
	}

	if totalUncatExp > 0 {
		key := "Suspense - Uncategorized Expenses"
		expenseLineMap[key] = &ScheduleCExpenseLine{
			LineNumber:        "Suspense",
			LineName:          "Uncategorized Expenses (Suspense 9999)",
			GrossAmount:       models.NewMoney(roundCents(totalUncatExp)),
			DeductiblePercent: 100.0,
			DeductibleAmount:  models.NewMoney(roundCents(totalUncatExp)),
			Accounts: []ScheduleCAccountDetail{
				{AccountID: 0, AccountCode: "9999", AccountName: "Uncategorized Expenses / Suspense", Total: models.NewMoney(roundCents(totalUncatExp))},
			},
		}
	}

	var expenseLines []ScheduleCExpenseLine
	var totalGrossExp float64
	var totalDedExp float64
	var nondeductibleMeals float64

	for _, l := range expenseLineMap {
		l.GrossAmount = models.NewMoney(roundCents(l.GrossAmount.Dollars()))
		l.DeductibleAmount = models.NewMoney(roundCents(l.GrossAmount.Dollars() * (l.DeductiblePercent / 100.0)))
		totalGrossExp += l.GrossAmount.Dollars()
		totalDedExp += l.DeductibleAmount.Dollars()

		if l.DeductiblePercent < 100.0 {
			nondeductibleMeals += roundCents(l.GrossAmount.Dollars() - l.DeductibleAmount.Dollars())
		}

		sort.Slice(l.Accounts, func(i, j int) bool {
			return l.Accounts[i].AccountCode < l.Accounts[j].AccountCode
		})
		expenseLines = append(expenseLines, *l)
	}

	sort.Slice(expenseLines, func(i, j int) bool {
		orderI := scheduleCLineOrder[expenseLines[i].LineNumber]
		if orderI == 0 {
			orderI = 500
		}
		orderJ := scheduleCLineOrder[expenseLines[j].LineNumber]
		if orderJ == 0 {
			orderJ = 500
		}
		if orderI != orderJ {
			return orderI < orderJ
		}
		return expenseLines[i].LineName < expenseLines[j].LineName
	})

	netProfitOrLoss := grossIncome - totalDedExp

	// Count uncategorized items
	var uncategorizedTxCount int64
	uncatTxQ := db.DB.Model(&models.BankTransaction{}).
		Where(inBooksClause).
		Where("category_account_id IS NULL").
		Where("id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')").
		Where("NOT (amount > 0 AND chart_account_id IN (SELECT id FROM chart_accounts WHERE type = 'LIABILITY'))")
	uncatTxQ = ApplyDateRange(uncatTxQ, "date", startDate, endDate)
	uncatTxQ.Count(&uncategorizedTxCount)

	var uncategorizedExpCount int64
	uncatExpQ := db.DB.Model(&models.Expense{}).Where(inBooksClause).Where("chart_account_id IS NULL")
	uncatExpQ = ApplyDateRange(uncatExpQ, "timestamp", startDate, endDate)
	uncatExpQ.Count(&uncategorizedExpCount)

	// IRS Self-Employment Tax (Schedule SE) & Form 1040-ES Quarterly Estimates
	// Net profit is subject to SE tax if >= $400.
	// Net SE earnings = 92.35% of Net Profit (Line 31).
	// SE tax rate = 15.3% (12.4% Social Security up to wage cap + 2.9% Medicare with no cap).
	// 50% of SE tax is deductible above-the-line on Form 1040 Schedule 1 (Line 15).
	var seTax float64
	var dedSETax float64
	var estIncomeTax float64
	var totalEstTax float64
	var qtrTax float64

	if netProfitOrLoss >= 400.0 {
		netSEEarnings := netProfitOrLoss * 0.9235
		// Cap Social Security at $176,100 for 2026/2025 wage limits
		ssEarnings := math.Min(netSEEarnings, 176100.0)
		seTax = roundCents((ssEarnings * 0.124) + (netSEEarnings * 0.029))
		dedSETax = roundCents(seTax * 0.50)

		// Effective income tax estimation for sole proprietor (~15% bracket on net profit after SE deduction)
		taxableIncomeEstimate := math.Max(0, netProfitOrLoss-dedSETax)
		estIncomeTax = roundCents(taxableIncomeEstimate * 0.15)

		totalEstTax = roundCents(seTax + estIncomeTax)
		qtrTax = roundCents(totalEstTax / 4.0)
	}

	deadlines := []QuarterlyTaxDeadline{
		{
			Quarter:   "Q1",
			Period:    "Jan 1 – Mar 31",
			DueDate:   fmt.Sprintf("April 15, %d", year),
			AmountDue: models.NewMoney(qtrTax),
			IsPast:    time.Now().After(time.Date(year, time.April, 15, 23, 59, 59, 0, time.Local)),
		},
		{
			Quarter:   "Q2",
			Period:    "Apr 1 – May 31",
			DueDate:   fmt.Sprintf("June 15, %d", year),
			AmountDue: models.NewMoney(qtrTax),
			IsPast:    time.Now().After(time.Date(year, time.June, 15, 23, 59, 59, 0, time.Local)),
		},
		{
			Quarter:   "Q3",
			Period:    "Jun 1 – Aug 31",
			DueDate:   fmt.Sprintf("September 15, %d", year),
			AmountDue: models.NewMoney(qtrTax),
			IsPast:    time.Now().After(time.Date(year, time.September, 15, 23, 59, 59, 0, time.Local)),
		},
		{
			Quarter:   "Q4",
			Period:    "Sep 1 – Dec 31",
			DueDate:   fmt.Sprintf("January 15, %d", year+1),
			AmountDue: models.NewMoney(qtrTax),
			IsPast:    time.Now().After(time.Date(year+1, time.January, 15, 23, 59, 59, 0, time.Local)),
		},
	}

	return &ScheduleCReportData{
		StartDate:                   startDate,
		EndDate:                     endDate,
		Year:                        year,
		GrossReceipts:               models.NewMoney(roundCents(grossReceipts)),
		ReturnsAndAllowances:        models.NewMoney(roundCents(returnsAndAllowances)),
		NetReceipts:                 models.NewMoney(roundCents(netReceipts)),
		CostOfGoodsSold:             models.NewMoney(roundCents(cogs)),
		GrossProfit:                 models.NewMoney(roundCents(grossProfit)),
		OtherIncome:                 models.NewMoney(roundCents(otherIncome)),
		GrossIncome:                 models.NewMoney(roundCents(grossIncome)),
		IncomeLines:                 incomeLines,
		ExpenseLines:                expenseLines,
		TotalExpensesGross:          models.NewMoney(roundCents(totalGrossExp)),
		TotalExpensesDeductible:     models.NewMoney(roundCents(totalDedExp)),
		NondeductibleMeals:          models.NewMoney(roundCents(nondeductibleMeals)),
		NetProfitOrLoss:             models.NewMoney(roundCents(netProfitOrLoss)),
		UncategorizedExpenseAmount:  models.NewMoney(roundCents(totalUncatExp)),
		UncategorizedIncomeAmount:   models.NewMoney(roundCents(uncatDeposits.Total)),
		UncategorizedTxCount:        uncategorizedTxCount,
		UncategorizedExpCount:       uncategorizedExpCount,
		SelfEmploymentTax:           models.NewMoney(seTax),
		DeductibleSelfEmploymentTax: models.NewMoney(dedSETax),
		EstimatedIncomeTax:          models.NewMoney(estIncomeTax),
		TotalEstimatedTax:           models.NewMoney(totalEstTax),
		EstimatedQuarterlyTax:       models.NewMoney(qtrTax),
		QuarterlyDeadlines:          deadlines,
	}, nil
}

// GetScheduleCReport returns structured IRS Form 1040 Schedule C calculations.
func GetScheduleCReport(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	yearStr := c.Query("year")

	var year int
	if yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			year = y
		}
	}

	data, err := BuildScheduleCData(startDate, endDate, year)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to compile Schedule C tax report: " + err.Error(),
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"report": data,
	})
}

// -------------------------------------------------------------
// Additional Standard Reports for Single-Entry & Solopreneurs
// -------------------------------------------------------------

var (
	prefixRegex   = regexp.MustCompile(`(?i)^(withdrawal\s+(instant\s+issue|debit|ach|pos)?\s*#?\d*|deposit\s+(mobile|atm|ach|branch)?\s*#?\d*|debit\s+card\s+(purchase|recurring)?\s*|pos\s+(purchase|debit)?\s*|checkcard\s*|recurring\s+payment\s*|ach\s+(debit|credit|payment|transfer)\s*|online\s+(banking\s+)?transfer\s*(to|from)?\s*)`)
	terminalRegex = regexp.MustCompile(`\b\d{10,}\s*\d*\b`)
	dateRegex     = regexp.MustCompile(`(?i)\bdate\s+\d{1,2}/\d{1,2}(/\d{2,4})?\b`)
	storeRegex    = regexp.MustCompile(`(?i)(#\s*\d+|\bstore\s*#?\s*\d+)`)
	spaceRegex    = regexp.MustCompile(`\s{2,}`)
)

func cleanVendorDescription(s string) string {
	cleaned := strings.TrimSpace(s)
	if cleaned == "" {
		return "Unknown Vendor"
	}
	cleaned = prefixRegex.ReplaceAllString(cleaned, "")
	cleaned = terminalRegex.ReplaceAllString(cleaned, "")
	cleaned = dateRegex.ReplaceAllString(cleaned, "")
	cleaned = storeRegex.ReplaceAllString(cleaned, "")
	cleaned = spaceRegex.ReplaceAllString(cleaned, " ")
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return strings.TrimSpace(s)
	}
	return cleaned
}

// CashFlowPeriod holds monthly cash metrics
type CashFlowPeriod struct {
	Period           string `json:"period"`           // e.g. "2026-08"
	PeriodLabel      string `json:"periodLabel"`      // e.g. "Aug 2026"
	CashIn           models.Money  `json:"cashIn"`           // Total deposits (amount > 0)
	CashOut          models.Money  `json:"cashOut"`          // Total debits (amount < 0)
	NetCashFlow      models.Money  `json:"netCashFlow"`      // CashIn - CashOut
	RunningCashTotal models.Money  `json:"runningCashTotal"` // Cumulative net cash flow
	InflowCount      int64  `json:"inflowCount"`
	OutflowCount     int64  `json:"outflowCount"`
}

type CashFlowReportData struct {
	StartDate          string           `json:"startDate"`
	EndDate            string           `json:"endDate"`
	TotalCashIn        models.Money            `json:"totalCashIn"`
	TotalCashOut       models.Money            `json:"totalCashOut"`
	NetCashFlow        models.Money            `json:"netCashFlow"`
	AvgMonthlyInflow   models.Money            `json:"avgMonthlyInflow"`
	AvgMonthlyOutflow  models.Money            `json:"avgMonthlyOutflow"`
	SavingsRatePercent float64          `json:"savingsRatePercent"`
	Periods            []CashFlowPeriod `json:"periods"`
}

// GetCashFlowSummary calculates monthly cash inflows vs outflows and liquidity trends.
// Excludes LIABILITY accounts (e.g. credit cards) and internal transfers between ASSET accounts
// so that only true Cash and Cash Equivalent flows are measured without double-counting.
func GetCashFlowSummary(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")

	query := db.DB.Table("bank_transactions bt").
		Select("bt.*").
		Joins("LEFT JOIN chart_accounts bank_ca ON bank_ca.id = bt.chart_account_id").
		Joins("LEFT JOIN chart_accounts cat_ca ON cat_ca.id = bt.category_account_id").
		Where(inBooksClauseBT).
		Where("COALESCE(bank_ca.type, 'ASSET') != 'LIABILITY'").
		Where("COALESCE(cat_ca.type, '') != 'ASSET'")
	query = ApplyDateRange(query, "bt.date", startDate, endDate)

	var txs []models.BankTransaction
	if err := query.Order("bt.date ASC").Scan(&txs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch cash flow data"})
	}

	monthMap := make(map[string]*CashFlowPeriod)
	var monthKeys []string

	for _, tx := range txs {
		mKey := tx.Date.Format("2006-01")
		period, exists := monthMap[mKey]
		if !exists {
			period = &CashFlowPeriod{
				Period:      mKey,
				PeriodLabel: tx.Date.Format("Jan 2006"),
			}
			monthMap[mKey] = period
			monthKeys = append(monthKeys, mKey)
		}

		if tx.Amount.Dollars() > 0 {
			period.CashIn = period.CashIn.Add(models.NewMoney(roundCents(tx.Amount.Dollars())))
			period.InflowCount++
		} else if tx.Amount.Dollars() < 0 {
			period.CashOut = period.CashOut.Add(models.NewMoney(roundCents(math.Abs(tx.Amount.Dollars()))))
			period.OutflowCount++
		}
	}

	sort.Strings(monthKeys)

	var periods []CashFlowPeriod
	var totalIn, totalOut float64
	var runningTotal float64

	for _, k := range monthKeys {
		p := monthMap[k]
		p.CashIn = models.NewMoney(roundCents(p.CashIn.Dollars()))
		p.CashOut = models.NewMoney(roundCents(p.CashOut.Dollars()))
		p.NetCashFlow = models.NewMoney(roundCents(p.CashIn.Dollars() - p.CashOut.Dollars()))
		runningTotal += p.NetCashFlow.Dollars()
		p.RunningCashTotal = models.NewMoney(roundCents(runningTotal))

		totalIn += p.CashIn.Dollars()
		totalOut += p.CashOut.Dollars()
		periods = append(periods, *p)
	}

	totalIn = roundCents(totalIn)
	totalOut = roundCents(totalOut)
	netCash := roundCents(totalIn - totalOut)

	avgIn := 0.0
	avgOut := 0.0
	if len(periods) > 0 {
		avgIn = roundCents(totalIn / float64(len(periods)))
		avgOut = roundCents(totalOut / float64(len(periods)))
	}

	savingsRate := 0.0
	if totalIn > 0 {
		savingsRate = roundCents((netCash / totalIn) * 100.0)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"report": CashFlowReportData{
			StartDate:          startDate,
			EndDate:            endDate,
			TotalCashIn:        models.NewMoney(totalIn),
			TotalCashOut:       models.NewMoney(totalOut),
			NetCashFlow:        models.NewMoney(netCash),
			AvgMonthlyInflow:   models.NewMoney(roundCents(avgIn)),
			AvgMonthlyOutflow:  models.NewMoney(roundCents(avgOut)),
			SavingsRatePercent: savingsRate,
			Periods:            periods,
		},
	})
}

// VendorSpendItem represents aggregated spending per vendor
type VendorSpendItem struct {
	VendorName          string       `json:"vendorName"`
	TotalSpend          models.Money `json:"totalSpend"`
	TransactionCount    int64        `json:"transactionCount"`
	AverageSpend        models.Money `json:"averageSpend"`
	PercentOfTotal      float64      `json:"percentOfTotal"`
	PrimaryCategoryCode string       `json:"primaryCategoryCode"`
	PrimaryCategoryName string       `json:"primaryCategoryName"`
	LastDate            string       `json:"lastDate"`
	Requires1099        bool         `json:"requires1099"` // True if total annual spend >= $600 (IRS Form 1099-NEC threshold)
}

type VendorSpendReportData struct {
	StartDate          string            `json:"startDate"`
	EndDate            string            `json:"endDate"`
	TotalSpend         models.Money      `json:"totalSpend"`
	TotalVendors       int               `json:"totalVendors"`
	Top5Percent        float64           `json:"top5Percent"`
	Vendors            []VendorSpendItem `json:"vendors"`
	ContractorsOver600 int               `json:"contractorsOver600"` // Number of vendors crossing $600 IRS 1099 threshold
	Total1099Spend     models.Money      `json:"total1099Spend"`     // Total spend across all 1099-reportable vendors
}

// GetVendorSpendReport analyzes expense and debit spending grouped and ranked by payee/vendor.
func GetVendorSpendReport(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")

	type rawExpense struct {
		Vendor       string
		Description  string
		Amount       float64
		Timestamp    time.Time
		CategoryCode string
		CategoryName string
	}

	var exps []rawExpense
	expQ := db.DB.Table("expenses e").
		Select("e.vendor, e.description, e.amount, e.timestamp, ca.code as category_code, ca.name as category_name").
		Joins("JOIN chart_accounts ca ON ca.id = e.chart_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where(inBooksClauseExpAS).
		Where("(LOWER(COALESCE(e.tender, '')) = 'cash' OR e.review_status = 'WARNINGS_IGNORED' OR e.id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed'))")
	expQ = ApplyDateRange(expQ, "e.timestamp", startDate, endDate)
	_ = expQ.Scan(&exps)

	var debits []rawExpense
	debQ := db.DB.Table("bank_transactions bt").
		Select("bt.description as vendor, bt.description, ABS(bt.amount) as amount, bt.date as timestamp, ca.code as category_code, ca.name as category_name").
		Joins("JOIN chart_accounts ca ON ca.id = bt.category_account_id").
		Where("ca.type = ?", "EXPENSE").
		Where("bt.amount < 0").
		Where(inBooksClauseBT).
		Where("bt.id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed')")
	debQ = ApplyDateRange(debQ, "bt.date", startDate, endDate)
	_ = debQ.Scan(&debits)

	type vendorAgg struct {
		VendorName string
		TotalSpend float64
		Count      int64
		Categories map[string]int // "Code|Name" -> count
		MostRecent time.Time
	}

	aggMap := make(map[string]*vendorAgg)
	allItems := append(exps, debits...)
	var grandTotal float64

	for _, item := range allItems {
		name := strings.TrimSpace(item.Vendor)
		if name == "" {
			name = strings.TrimSpace(item.Description)
		}
		cleanName := cleanVendorDescription(name)
		if cleanName == "" {
			cleanName = "Other Expenses"
		}

		key := strings.ToUpper(cleanName)
		agg, exists := aggMap[key]
		if !exists {
			agg = &vendorAgg{
				VendorName: cleanName,
				Categories: make(map[string]int),
			}
			aggMap[key] = agg
		}

		agg.TotalSpend += item.Amount
		agg.Count++
		grandTotal += item.Amount
		if item.Timestamp.After(agg.MostRecent) {
			agg.MostRecent = item.Timestamp
		}

		catKey := fmt.Sprintf("%s|%s", item.CategoryCode, item.CategoryName)
		agg.Categories[catKey]++
	}

	var vendorList []VendorSpendItem
	for _, agg := range aggMap {
		bestCatCode := ""
		bestCatName := ""
		bestCount := -1
		for ck, count := range agg.Categories {
			if count > bestCount {
				bestCount = count
				parts := strings.SplitN(ck, "|", 2)
				bestCatCode = parts[0]
				if len(parts) > 1 {
					bestCatName = parts[1]
				}
			}
		}

		totalSpend := roundCents(agg.TotalSpend)
		avgSpend := roundCents(totalSpend / float64(agg.Count))
		pct := 0.0
		if grandTotal > 0 {
			pct = roundCents((totalSpend / grandTotal) * 100.0)
		}

		vendorList = append(vendorList, VendorSpendItem{
			VendorName:          agg.VendorName,
			TotalSpend:          models.NewMoney(totalSpend),
			TransactionCount:    agg.Count,
			AverageSpend:        models.NewMoney(avgSpend),
			PercentOfTotal:      pct,
			PrimaryCategoryCode: bestCatCode,
			PrimaryCategoryName: bestCatName,
			LastDate:            agg.MostRecent.Format("2006-01-02"),
			Requires1099:        totalSpend >= 600.0,
		})
	}

	sort.Slice(vendorList, func(i, j int) bool {
		return vendorList[i].TotalSpend.Dollars() > vendorList[j].TotalSpend.Dollars()
	})

	top5Spend := 0.0
	contractorsOver600 := 0
	total1099Spend := 0.0
	for i, v := range vendorList {
		if i < 5 {
			top5Spend += v.TotalSpend.Dollars()
		}
		if v.Requires1099 {
			contractorsOver600++
			total1099Spend += v.TotalSpend.Dollars()
		}
	}
	top5Pct := 0.0
	if grandTotal > 0 {
		top5Pct = roundCents((top5Spend / grandTotal) * 100.0)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"report": VendorSpendReportData{
			StartDate:          startDate,
			EndDate:            endDate,
			TotalSpend:         models.NewMoney(roundCents(grandTotal)),
			TotalVendors:       len(vendorList),
			Top5Percent:        top5Pct,
			Vendors:            vendorList,
			ContractorsOver600: contractorsOver600,
			Total1099Spend:     models.NewMoney(roundCents(total1099Spend)),
		},
	})
}

// ARAgingInvoiceItem represents a single invoice in aging buckets
type ARAgingInvoiceItem struct {
	ID            uint    `json:"id"`
	InvoiceNumber string  `json:"invoiceNumber"`
	ClientName    string  `json:"clientName"`
	ClientEmail   string  `json:"clientEmail"`
	IssueDate     string  `json:"issueDate"`
	DueDate       string  `json:"dueDate"`
	TotalAmount   models.Money   `json:"totalAmount"`
	AmountPaid    models.Money   `json:"amountPaid"`
	BalanceDue    models.Money   `json:"balanceDue"`
	DaysOverdue   int     `json:"daysOverdue"`
	Status        string  `json:"status"`
}

type ARAgingBucket struct {
	BucketName  string               `json:"bucketName"`
	TotalAmount float64              `json:"totalAmount"`
	Count       int64                `json:"count"`
	Invoices    []ARAgingInvoiceItem `json:"invoices"`
}

type ARClientSummary struct {
	ClientName       string  `json:"clientName"`
	TotalOutstanding float64 `json:"totalOutstanding"`
	CurrentAmount    float64 `json:"currentAmount"`
	OverdueAmount    float64 `json:"overdueAmount"`
	OldestDueDate    string  `json:"oldestDueDate"`
	InvoiceCount     int     `json:"invoiceCount"`
}

type ARAgingReportData struct {
	AsOfDate         string            `json:"asOfDate"`
	TotalReceivables float64           `json:"totalReceivables"`
	TotalCurrent     float64           `json:"totalCurrent"`
	TotalOverdue     float64           `json:"totalOverdue"`
	InvoiceCount     int               `json:"invoiceCount"`
	Buckets          []ARAgingBucket   `json:"buckets"`
	Clients          []ARClientSummary `json:"clients"`
}

// GetARAgingReport compiles Accounts Receivable aging metrics across 30/60/90+ day buckets.
func GetARAgingReport(c fiber.Ctx) error {
	asOfStr := c.Query("asOfDate")
	asOf := time.Now()
	if asOfStr != "" {
		if t, err := parseDateFlexible(asOfStr); err == nil {
			asOf = t
		}
	}

	var invoices []models.Invoice
	if err := db.DB.Where("status IN ('SENT', 'OVERDUE', 'PARTIALLY_PAID')").
		Order("due_date ASC, id ASC").
		Find(&invoices).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch invoices for aging report"})
	}

	currentBucket := &ARAgingBucket{BucketName: "Current (Not Due)", Invoices: []ARAgingInvoiceItem{}}
	b1_30 := &ARAgingBucket{BucketName: "1 - 30 Days Overdue", Invoices: []ARAgingInvoiceItem{}}
	b31_60 := &ARAgingBucket{BucketName: "31 - 60 Days Overdue", Invoices: []ARAgingInvoiceItem{}}
	b61_90 := &ARAgingBucket{BucketName: "61 - 90 Days Overdue", Invoices: []ARAgingInvoiceItem{}}
	b90plus := &ARAgingBucket{BucketName: "90+ Days Overdue", Invoices: []ARAgingInvoiceItem{}}

	clientMap := make(map[string]*ARClientSummary)

	var totalReceivables float64
	var totalCurrent float64
	var totalOverdue float64

	for _, inv := range invoices {
		receivableAmt := inv.BalanceDue.Dollars()
		if receivableAmt <= 0 && inv.TotalAmount.Dollars() > inv.AmountPaid.Dollars() {
			receivableAmt = roundCents(inv.TotalAmount.Dollars() - inv.AmountPaid.Dollars())
		}
		if receivableAmt <= 0 && inv.Status != "PAID" {
			receivableAmt = inv.TotalAmount.Dollars()
		}

		totalReceivables += receivableAmt

		daysOverdue := 0
		if asOf.After(inv.DueDate) {
			daysOverdue = int(math.Floor(asOf.Sub(inv.DueDate).Hours() / 24.0))
		}

		item := ARAgingInvoiceItem{
			ID:            inv.ID,
			InvoiceNumber: inv.InvoiceNumber,
			ClientName:    inv.ClientName,
			ClientEmail:   inv.ClientEmail,
			IssueDate:     inv.IssueDate.Format("2006-01-02"),
			DueDate:       inv.DueDate.Format("2006-01-02"),
			TotalAmount:   models.NewMoney(roundCents(inv.TotalAmount.Dollars())),
			AmountPaid:    models.NewMoney(roundCents(inv.AmountPaid.Dollars())),
			BalanceDue:    models.NewMoney(roundCents(receivableAmt)),
			DaysOverdue:   daysOverdue,
			Status:        inv.Status,
		}

		if daysOverdue <= 0 {
			currentBucket.TotalAmount += receivableAmt
			currentBucket.Count++
			currentBucket.Invoices = append(currentBucket.Invoices, item)
			totalCurrent += receivableAmt
		} else {
			totalOverdue += receivableAmt
			if daysOverdue <= 30 {
				b1_30.TotalAmount += receivableAmt
				b1_30.Count++
				b1_30.Invoices = append(b1_30.Invoices, item)
			} else if daysOverdue <= 60 {
				b31_60.TotalAmount += receivableAmt
				b31_60.Count++
				b31_60.Invoices = append(b31_60.Invoices, item)
			} else if daysOverdue <= 90 {
				b61_90.TotalAmount += receivableAmt
				b61_90.Count++
				b61_90.Invoices = append(b61_90.Invoices, item)
			} else {
				b90plus.TotalAmount += receivableAmt
				b90plus.Count++
				b90plus.Invoices = append(b90plus.Invoices, item)
			}
		}

		cKey := strings.ToUpper(strings.TrimSpace(inv.ClientName))
		cs, exists := clientMap[cKey]
		if !exists {
			cs = &ARClientSummary{
				ClientName:    inv.ClientName,
				OldestDueDate: inv.DueDate.Format("2006-01-02"),
			}
			clientMap[cKey] = cs
		}
		cs.TotalOutstanding += receivableAmt
		cs.InvoiceCount++
		if daysOverdue <= 0 {
			cs.CurrentAmount += receivableAmt
		} else {
			cs.OverdueAmount += receivableAmt
		}
		if inv.DueDate.Before(asOf) && inv.DueDate.Format("2006-01-02") < cs.OldestDueDate {
			cs.OldestDueDate = inv.DueDate.Format("2006-01-02")
		}
	}

	currentBucket.TotalAmount = roundCents(currentBucket.TotalAmount)
	b1_30.TotalAmount = roundCents(b1_30.TotalAmount)
	b31_60.TotalAmount = roundCents(b31_60.TotalAmount)
	b61_90.TotalAmount = roundCents(b61_90.TotalAmount)
	b90plus.TotalAmount = roundCents(b90plus.TotalAmount)

	buckets := []ARAgingBucket{*currentBucket, *b1_30, *b31_60, *b61_90, *b90plus}

	var clients []ARClientSummary
	for _, cs := range clientMap {
		cs.TotalOutstanding = roundCents(cs.TotalOutstanding)
		cs.CurrentAmount = roundCents(cs.CurrentAmount)
		cs.OverdueAmount = roundCents(cs.OverdueAmount)
		clients = append(clients, *cs)
	}

	sort.Slice(clients, func(i, j int) bool {
		return clients[i].TotalOutstanding > clients[j].TotalOutstanding
	})

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"report": ARAgingReportData{
			AsOfDate:         asOf.Format("2006-01-02"),
			TotalReceivables: roundCents(totalReceivables),
			TotalCurrent:     roundCents(totalCurrent),
			TotalOverdue:     roundCents(totalOverdue),
			InvoiceCount:     len(invoices),
			Buckets:          buckets,
			Clients:          clients,
		},
	})
}

// TrialBalanceAccountLine represents an account row in the Trial Balance report
type TrialBalanceAccountLine struct {
	AccountID   uint         `json:"accountId"`
	AccountCode string       `json:"accountCode"`
	AccountName string       `json:"accountName"`
	AccountType string       `json:"accountType"` // ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
	GrossDebit  models.Money `json:"grossDebit"`
	GrossCredit models.Money `json:"grossCredit"`
	NetDebit    models.Money `json:"netDebit"`
	NetCredit   models.Money `json:"netCredit"`
}

// TrialBalanceReportData encapsulates the full Trial Balance report with double-entry balance verification
type TrialBalanceReportData struct {
	StartDate     string                    `json:"startDate"`
	EndDate       string                    `json:"endDate"`
	Accounts      []TrialBalanceAccountLine `json:"accounts"`
	TotalDebit    models.Money              `json:"totalDebit"`
	TotalCredit   models.Money              `json:"totalCredit"`
	IsBalanced    bool                      `json:"isBalanced"`
	VarianceCents int64                     `json:"varianceCents"`
}

// BuildTrialBalanceData compiles the complete Trial Balance across all ledger accounts.
// Every transaction is represented as a balanced double-entry pair:
//   - Bank debit/credit to source account (1xxx / 2xxx)
//   - Offsetting debit/credit to destination category account (4xxx / 5xxx / 1xxx / 3xxx)
func BuildTrialBalanceData(startDate, endDate string) (*TrialBalanceReportData, error) {
	if db.DB == nil {
		return &TrialBalanceReportData{
			StartDate:  startDate,
			EndDate:    endDate,
			IsBalanced: true,
		}, nil
	}

	var accounts []models.ChartAccount
	if err := db.DB.Where("active = true").Order("code ASC").Find(&accounts).Error; err != nil {
		return nil, err
	}

	type accAccumulator struct {
		account     models.ChartAccount
		debitCents  int64
		creditCents int64
	}

	accMap := make(map[uint]*accAccumulator)
	for i := range accounts {
		accMap[accounts[i].ID] = &accAccumulator{account: accounts[i]}
	}

	// Find default cash/equity account for cash tender offsetting credit
	var cashAccountID uint
	for _, acc := range accounts {
		if acc.Type == "ASSET" && (acc.Code == "1050" || strings.Contains(strings.ToLower(acc.Name), "cash")) {
			cashAccountID = acc.ID
			break
		}
	}
	if cashAccountID == 0 {
		// Fallback to checking (1010) or owner equity (3010)
		for _, acc := range accounts {
			if acc.Code == "1010" || acc.Code == "3010" {
				cashAccountID = acc.ID
				break
			}
		}
	}

	// Suspense accumulators for uncategorized entries
	var suspenseIncDebit, suspenseIncCredit int64
	var suspenseExpDebit, suspenseExpCredit int64

	// 1. Process Bank Transactions
	var txs []models.BankTransaction
	txQ := db.DB.Model(&models.BankTransaction{}).Where("COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')")
	txQ = ApplyDateRange(txQ, "date", startDate, endDate)
	if err := txQ.Find(&txs).Error; err != nil {
		return nil, err
	}

	for _, tx := range txs {
		amtCents := tx.Amount.Cents
		if amtCents == 0 {
			continue
		}

		// Source Bank Account
		if tx.ChartAccountID != nil {
			if bAcc, ok := accMap[*tx.ChartAccountID]; ok {
				if amtCents > 0 {
					// Deposit increases bank asset -> Debit
					bAcc.debitCents += amtCents
				} else {
					// Disbursement decreases bank asset -> Credit
					bAcc.creditCents += -amtCents
				}
			}
		}

		// Offsetting Category Account
		if tx.CategoryAccountID != nil {
			if cAcc, ok := accMap[*tx.CategoryAccountID]; ok {
				if amtCents > 0 {
					// Incoming revenue -> Credit
					cAcc.creditCents += amtCents
				} else {
					// Expense / Draw / Capital Asset payment -> Debit
					cAcc.debitCents += -amtCents
				}
			}
		} else {
			// Uncategorized suspense
			if amtCents > 0 {
				suspenseIncCredit += amtCents
			} else {
				suspenseExpDebit += -amtCents
			}
		}
	}

	// 2. Process Cash Expenses (paid in cash, never appeared on bank statements)
	var cashExps []models.Expense
	cashQ := db.DB.Model(&models.Expense{}).
		Where("COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')").
		Where("LOWER(COALESCE(tender, '')) = 'cash' OR LOWER(COALESCE(tender, '')) = 'cash / paper'")
	cashQ = ApplyDateRange(cashQ, "timestamp", startDate, endDate)
	if err := cashQ.Find(&cashExps).Error; err == nil {
		for _, e := range cashExps {
			eCents := e.Amount.Cents
			if eCents <= 0 {
				continue
			}

			// Expense Category -> Debit
			if e.ChartAccountID != nil {
				if cAcc, ok := accMap[*e.ChartAccountID]; ok {
					cAcc.debitCents += eCents
				}
			} else {
				suspenseExpDebit += eCents
			}

			// Cash on Hand / Owner Capital -> Credit
			if cashAccountID > 0 {
				if cAcc, ok := accMap[cashAccountID]; ok {
					cAcc.creditCents += eCents
				}
			}
		}
	}

	// Build output lines
	var lines []TrialBalanceAccountLine
	var totalNetDebitCents int64
	var totalNetCreditCents int64

	for _, acc := range accounts {
		accum := accMap[acc.ID]
		gDebit := accum.debitCents
		gCredit := accum.creditCents

		// Only include accounts with activity or liquid anchor accounts
		if gDebit == 0 && gCredit == 0 {
			continue
		}

		var nDebitCents int64
		var nCreditCents int64

		if gDebit > gCredit {
			nDebitCents = gDebit - gCredit
		} else if gCredit > gDebit {
			nCreditCents = gCredit - gDebit
		}

		totalNetDebitCents += nDebitCents
		totalNetCreditCents += nCreditCents

		lines = append(lines, TrialBalanceAccountLine{
			AccountID:   acc.ID,
			AccountCode: acc.Code,
			AccountName: acc.Name,
			AccountType: acc.Type,
			GrossDebit:  models.Money{Cents: gDebit},
			GrossCredit: models.Money{Cents: gCredit},
			NetDebit:    models.Money{Cents: nDebitCents},
			NetCredit:   models.Money{Cents: nCreditCents},
		})
	}

	// Add Suspense rows if uncategorized activity exists
	if suspenseIncCredit > 0 || suspenseIncDebit > 0 {
		var nCredit int64
		if suspenseIncCredit > suspenseIncDebit {
			nCredit = suspenseIncCredit - suspenseIncDebit
		}
		totalNetCreditCents += nCredit
		lines = append(lines, TrialBalanceAccountLine{
			AccountCode: "9998",
			AccountName: "Uncategorized Income (Suspense)",
			AccountType: "REVENUE",
			GrossDebit:  models.Money{Cents: suspenseIncDebit},
			GrossCredit: models.Money{Cents: suspenseIncCredit},
			NetDebit:    models.Money{Cents: 0},
			NetCredit:   models.Money{Cents: nCredit},
		})
	}

	if suspenseExpDebit > 0 || suspenseExpCredit > 0 {
		var nDebit int64
		if suspenseExpDebit > suspenseExpCredit {
			nDebit = suspenseExpDebit - suspenseExpCredit
		}
		totalNetDebitCents += nDebit
		lines = append(lines, TrialBalanceAccountLine{
			AccountCode: "9999",
			AccountName: "Uncategorized Expense (Suspense)",
			AccountType: "EXPENSE",
			GrossDebit:  models.Money{Cents: suspenseExpDebit},
			GrossCredit: models.Money{Cents: suspenseExpCredit},
			NetDebit:    models.Money{Cents: nDebit},
			NetCredit:   models.Money{Cents: 0},
		})
	}

	// Sort lines by Account Code ascending
	sort.Slice(lines, func(i, j int) bool {
		return lines[i].AccountCode < lines[j].AccountCode
	})

	variance := totalNetDebitCents - totalNetCreditCents
	isBalanced := variance == 0

	return &TrialBalanceReportData{
		StartDate:     startDate,
		EndDate:       endDate,
		Accounts:      lines,
		TotalDebit:    models.Money{Cents: totalNetDebitCents},
		TotalCredit:   models.Money{Cents: totalNetCreditCents},
		IsBalanced:    isBalanced,
		VarianceCents: variance,
	}, nil
}

// GetTrialBalance delivers the Trial Balance report API endpoint
func GetTrialBalance(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")

	report, err := BuildTrialBalanceData(startDate, endDate)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to compile trial balance: " + err.Error(),
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"report": report,
	})
}
