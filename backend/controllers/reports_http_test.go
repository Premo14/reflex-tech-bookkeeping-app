package controllers

import (
	"net/http"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

func setupReportRoutes(app *fiber.App) {
	api := app.Group("/api/reports")
	api.Get("/pl", GetProfitLoss)
	api.Get("/schedule-c", GetScheduleCReport)
	api.Get("/cash-flow", GetCashFlowSummary)
	api.Get("/vendor-spend", GetVendorSpendReport)
	api.Get("/ar-aging", GetARAgingReport)
	api.Get("/trial-balance", GetTrialBalance)
}

func TestReportsNilDBGuards(t *testing.T) {
	origDB := db.DB
	db.DB = nil
	defer func() { db.DB = origDB }()

	app := fiber.New()
	setupReportRoutes(app)

	for _, path := range []string{
		"/api/reports/pl",
		"/api/reports/schedule-c",
		"/api/reports/cash-flow",
		"/api/reports/vendor-spend",
		"/api/reports/ar-aging",
		"/api/reports/trial-balance",
	} {
		code, _ := doJSONMap(t, app, "GET", path, nil)
		if code != http.StatusInternalServerError {
			t.Errorf("GET %s with nil DB: expected 500, got %d", path, code)
		}
	}

	if _, err := BuildScheduleCData("2025-01-01", "2025-12-31", 0); err == nil {
		t.Fatal("expected BuildScheduleCData to error when DB is nil")
	}
}

func TestResolveScheduleCLineComprehensive(t *testing.T) {
	cases := []struct {
		acc      models.ChartAccount
		wantLine string
		wantPct  float64
	}{
		// Revenue fallbacks
		{models.ChartAccount{Code: "4090", Name: "Customer Refunds", Type: "REVENUE"}, "Line 2", 100},
		{models.ChartAccount{Code: "4210", Name: "Bank Interest Earned", Type: "REVENUE"}, "Line 6", 100},
		{models.ChartAccount{Code: "4010", Name: "Advisory Fees", Type: "REVENUE"}, "Line 1", 100},
		// Explicit standard codes 5000-5910
		{models.ChartAccount{Code: "5000", Name: "COGS", Type: "EXPENSE"}, "Line 4", 100},
		{models.ChartAccount{Code: "5010", Name: "Office Rent", Type: "EXPENSE"}, "Line 20b", 100},
		{models.ChartAccount{Code: "5015", Name: "Equipment Lease", Type: "EXPENSE"}, "Line 20a", 100},
		{models.ChartAccount{Code: "5020", Name: "Payroll", Type: "EXPENSE"}, "Line 26", 100},
		{models.ChartAccount{Code: "5025", Name: "Benefits", Type: "EXPENSE"}, "Line 14", 100},
		{models.ChartAccount{Code: "5030", Name: "Utilities", Type: "EXPENSE"}, "Line 25", 100},
		{models.ChartAccount{Code: "5040", Name: "Repairs", Type: "EXPENSE"}, "Line 21", 100},
		{models.ChartAccount{Code: "5050", Name: "Office Exp", Type: "EXPENSE"}, "Line 18", 100},
		{models.ChartAccount{Code: "5060", Name: "Supplies", Type: "EXPENSE"}, "Line 22", 100},
		{models.ChartAccount{Code: "5070", Name: "Home Office", Type: "EXPENSE"}, "Line 30", 100},
		{models.ChartAccount{Code: "5080", Name: "Insurance", Type: "EXPENSE"}, "Line 15", 100},
		{models.ChartAccount{Code: "5090", Name: "Meals", Type: "EXPENSE"}, "Line 24b", 50},
		{models.ChartAccount{Code: "5110", Name: "Legal", Type: "EXPENSE"}, "Line 17", 100},
		{models.ChartAccount{Code: "5120", Name: "Contractors", Type: "EXPENSE"}, "Line 11", 100},
		{models.ChartAccount{Code: "5210", Name: "SaaS", Type: "EXPENSE"}, "Line 27a", 100},
		{models.ChartAccount{Code: "5310", Name: "Ads", Type: "EXPENSE"}, "Line 8", 100},
		{models.ChartAccount{Code: "5410", Name: "Travel", Type: "EXPENSE"}, "Line 24a", 100},
		{models.ChartAccount{Code: "5510", Name: "Vehicle", Type: "EXPENSE"}, "Line 9", 100},
		{models.ChartAccount{Code: "5610", Name: "Licenses", Type: "EXPENSE"}, "Line 23", 100},
		{models.ChartAccount{Code: "5710", Name: "Interest", Type: "EXPENSE"}, "Line 16b", 100},
		{models.ChartAccount{Code: "5720", Name: "Depreciation", Type: "EXPENSE"}, "Line 13", 100},
		{models.ChartAccount{Code: "5810", Name: "Commissions", Type: "EXPENSE"}, "Line 10", 100},
		{models.ChartAccount{Code: "5910", Name: "Bank Fees", Type: "EXPENSE"}, "Line 27a", 100},
		// Custom account keyword fallbacks
		{models.ChartAccount{Code: "5991", Name: "Equipment Rent", Type: "EXPENSE"}, "Line 20a", 100},
		{models.ChartAccount{Code: "5991", Name: "Warehouse Lease", Type: "EXPENSE"}, "Line 20b", 100},
		{models.ChartAccount{Code: "5991", Name: "Employee Pension Plan", Type: "EXPENSE"}, "Line 14", 100},
		{models.ChartAccount{Code: "5991", Name: "General Liability Insurance", Type: "EXPENSE"}, "Line 15", 100},
		{models.ChartAccount{Code: "5991", Name: "Direct COGS Materials", Type: "EXPENSE"}, "Line 4", 100},
		{models.ChartAccount{Code: "5991", Name: "Freelance Design", Type: "EXPENSE"}, "Line 11", 100},
		{models.ChartAccount{Code: "5991", Name: "Accounting CPA", Type: "EXPENSE"}, "Line 17", 100},
		{models.ChartAccount{Code: "5991", Name: "Section 179 Writeoff", Type: "EXPENSE"}, "Line 13", 100},
		{models.ChartAccount{Code: "5991", Name: "Loan Interest", Type: "EXPENSE"}, "Line 16b", 100},
		{models.ChartAccount{Code: "5991", Name: "Stripe Processing Fee", Type: "EXPENSE"}, "Line 10", 100},
		{models.ChartAccount{Code: "5991", Name: "Wire Fee", Type: "EXPENSE"}, "Line 27a", 100},
		{models.ChartAccount{Code: "5991", Name: "Cloud Infrastructure", Type: "EXPENSE"}, "Line 27a", 100},
		{models.ChartAccount{Code: "5991", Name: "Office Supplies", Type: "EXPENSE"}, "Line 18", 100},
		{models.ChartAccount{Code: "5991", Name: "Art Materials", Type: "EXPENSE"}, "Line 22", 100},
		{models.ChartAccount{Code: "5991", Name: "HVAC Maintenance", Type: "EXPENSE"}, "Line 21", 100},
		{models.ChartAccount{Code: "5991", Name: "Social Marketing", Type: "EXPENSE"}, "Line 8", 100},
		{models.ChartAccount{Code: "5991", Name: "Hotel Lodging", Type: "EXPENSE"}, "Line 24a", 100},
		{models.ChartAccount{Code: "5991", Name: "Parking & Tolls", Type: "EXPENSE"}, "Line 9", 100},
		{models.ChartAccount{Code: "5991", Name: "City Business Permit", Type: "EXPENSE"}, "Line 23", 100},
		{models.ChartAccount{Code: "5991", Name: "Fiber Internet", Type: "EXPENSE"}, "Line 25", 100},
		{models.ChartAccount{Code: "5991", Name: "Miscellaneous", Type: "EXPENSE"}, "Line 27a", 100},
		{models.ChartAccount{Code: "5992", Name: "Custom No Hyphen", Type: "EXPENSE", ScheduleCLine: "Line 24b"}, "Line 24b", 50},
	}

	for _, tc := range cases {
		gotLine, _, gotPct := resolveScheduleCLine(tc.acc)
		if gotLine != tc.wantLine || gotPct != tc.wantPct {
			t.Errorf("resolveScheduleCLine(%s %q) = (%q, %.0f), want (%q, %.0f)", tc.acc.Code, tc.acc.Name, gotLine, gotPct, tc.wantLine, tc.wantPct)
		}
	}
}

func TestReportsHTTPEndpointsFullIntegration(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB()

	app := fiber.New()
	setupReportRoutes(app)

	checking := models.ChartAccount{Code: "1010", Name: "Operating Checking", Type: "ASSET", Active: true}
	cashAcc := models.ChartAccount{Code: "1030", Name: "Cash on Hand", Type: "ASSET", Active: true}
	cardAcc := models.ChartAccount{Code: "2010", Name: "Business Card", Type: "LIABILITY", Active: true}
	revSales := models.ChartAccount{Code: "4010", Name: "Consulting Revenue", Type: "REVENUE", Active: true}
	revRefund := models.ChartAccount{Code: "4090", Name: "Returns", Type: "REVENUE", Active: true}
	revInterest := models.ChartAccount{Code: "4210", Name: "Interest", Type: "REVENUE", Active: true}
	expCOGS := models.ChartAccount{Code: "5000", Name: "COGS", Type: "EXPENSE", Active: true}
	expMeals := models.ChartAccount{Code: "5090", Name: "Client Meals", Type: "EXPENSE", Active: true}
	expSoft := models.ChartAccount{Code: "5210", Name: "Cloud SaaS", Type: "EXPENSE", Active: true}
	expArchived := models.ChartAccount{Code: "5988", Name: "Legacy Archival", Type: "EXPENSE", Active: false}
	for _, a := range []*models.ChartAccount{&checking, &cashAcc, &cardAcc, &revSales, &revRefund, &revInterest, &expCOGS, &expMeals, &expSoft, &expArchived} {
		testDB.Create(a)
	}

	d1 := time.Date(2026, 3, 5, 0, 0, 0, 0, time.UTC)
	d2 := time.Date(2026, 3, 18, 0, 0, 0, 0, time.UTC)
	d3 := time.Date(2026, 4, 2, 0, 0, 0, 0, time.UTC)

	// 1. Bank deposits (Revenue 4010, Returns 4090, Interest 4210, Uncategorized deposit, Card payment excluded from uncat revenue, Asset transfer excluded from cash flow)
	revTx := models.BankTransaction{Date: d1, Description: "CLIENT WIRE ACME", Amount: models.NewMoney(200000.00), FITID: "REP-1", ChartAccountID: &checking.ID, CategoryAccountID: &revSales.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	retTx := models.BankTransaction{Date: d1, Description: "CLIENT REFUND", Amount: models.NewMoney(-100.00), FITID: "REP-2", ChartAccountID: &checking.ID, CategoryAccountID: &revRefund.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	intTx := models.BankTransaction{Date: d2, Description: "SAVINGS INTEREST", Amount: models.NewMoney(50.00), FITID: "REP-3", ChartAccountID: &checking.ID, CategoryAccountID: &revInterest.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	uncatDep := models.BankTransaction{Date: d2, Description: "MYSTERY DEPOSIT", Amount: models.NewMoney(25.00), FITID: "REP-4", ChartAccountID: &checking.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	cardPay := models.BankTransaction{Date: d2, Description: "CC PAYMENT", Amount: models.NewMoney(300.00), FITID: "REP-5", ChartAccountID: &cardAcc.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	assetXfer := models.BankTransaction{Date: d2, Description: "INTERNAL XFER", Amount: models.NewMoney(-500.00), FITID: "REP-6", ChartAccountID: &checking.ID, CategoryAccountID: &cashAcc.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	ignoredTx := models.BankTransaction{Date: d2, Description: "PERSONAL COFFEE", Amount: models.NewMoney(-12.00), FITID: "REP-7", ChartAccountID: &checking.ID, ReviewStatus: "IGNORED"}

	// 2. Debits & expenses (confirmed linked expense + cash meals expense + archived unlinked debit + partial debit + uncat debit)
	linkedDebit := models.BankTransaction{Date: d1, Description: "AWS HOSTING", Amount: models.NewMoney(-1200.00), FITID: "REP-8", ChartAccountID: &checking.ID, CategoryAccountID: &expSoft.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	unlinkedCOGS := models.BankTransaction{Date: d2, Description: "HARDWARE PARTS", Amount: models.NewMoney(-300.00), FITID: "REP-9", ChartAccountID: &checking.ID, CategoryAccountID: &expCOGS.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	archivedDebit := models.BankTransaction{Date: d2, Description: "LEGACY FEE", Amount: models.NewMoney(-40.00), FITID: "REP-10", ChartAccountID: &checking.ID, CategoryAccountID: &expArchived.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	partialDebit := models.BankTransaction{Date: d3, Description: "PARTIAL ORDER", Amount: models.NewMoney(-100.00), FITID: "REP-11", ChartAccountID: &checking.ID, CategoryAccountID: &expSoft.ID, AllocationStatus: "PARTIALLY_ALLOCATED", ReviewStatus: "APPROVED"}
	uncatDebit := models.BankTransaction{Date: d3, Description: "UNKNOWN CHARGE", Amount: models.NewMoney(-35.00), FITID: "REP-12", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}

	for _, bt := range []*models.BankTransaction{&revTx, &retTx, &intTx, &uncatDep, &cardPay, &assetXfer, &ignoredTx, &linkedDebit, &unlinkedCOGS, &archivedDebit, &partialDebit, &uncatDebit} {
		testDB.Create(bt)
	}

	confirmedExp := models.Expense{Timestamp: d1, Vendor: "Amazon Web Services", Description: "AWS", Amount: models.NewMoney(1200.00), TaxAmount: models.NewMoney(96.00), Tender: "card", ChartAccountID: &expSoft.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	partialExp := models.Expense{Timestamp: d3, Vendor: "Vendor Part", Description: "Part 1", Amount: models.NewMoney(60.00), Tender: "card", ChartAccountID: &expSoft.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	cashMeal := models.Expense{Timestamp: d2, Vendor: "Bistro Dinner", Description: "Client meal", Amount: models.NewMoney(80.00), Tender: "cash", ChartAccountID: &expMeals.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	uncatCashExp := models.Expense{Timestamp: d3, Vendor: "NoCat", Description: "Misc cash", Amount: models.NewMoney(15.00), Tender: "cash", AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	ignoredExp := models.Expense{Timestamp: d3, Vendor: "IgnoredExp", Description: "Dup", Amount: models.NewMoney(20.00), Tender: "cash", ReviewStatus: "IGNORED"}
	for _, e := range []*models.Expense{&confirmedExp, &partialExp, &cashMeal, &uncatCashExp, &ignoredExp} {
		testDB.Create(e)
	}
	testDB.Create(&models.ExpenseBankTransaction{ExpenseID: confirmedExp.ID, BankTransactionID: linkedDebit.ID, Status: "confirmed"})
	testDB.Create(&models.ExpenseBankTransaction{ExpenseID: partialExp.ID, BankTransactionID: partialDebit.ID, Status: "confirmed"})

	// Open invoices for A/R aging
	invOpen := models.Invoice{
		InvoiceNumber: "INV-AR-1", ClientName: "Utica Bank", IssueDate: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC),
		DueDate: time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC), TotalAmount: models.NewMoney(1500.00),
		BalanceDue: models.NewMoney(1500.00), Status: "OVERDUE",
	}
	testDB.Create(&invOpen)

	// 1. GetProfitLoss
	code, plResp := doJSONMap(t, app, "GET", "/api/reports/pl?startDate=2026-01-01&endDate=2026-12-31", nil)
	if code != 200 || plResp["excludedTxCount"].(float64) != 1 || plResp["excludedExpCount"].(float64) != 1 {
		t.Fatalf("unexpected GetProfitLoss response: code=%d resp=%v", code, plResp)
	}
	if plResp["totalTax"].(float64) != 96.0 {
		t.Fatalf("expected sales tax 96.0, got %v", plResp["totalTax"])
	}

	// 2. GetScheduleCReport (without explicit year param -> extracts year 2026 from startDate; net profit exceeds SS wage cap!)
	code, scResp := doJSONMap(t, app, "GET", "/api/reports/schedule-c?startDate=2026-01-01&endDate=2026-12-31", nil)
	if code != 200 {
		t.Fatalf("expected 200 GetScheduleCReport, got %d %v", code, scResp)
	}
	scReport := scResp["report"].(map[string]interface{})
	if int(scReport["year"].(float64)) != 2026 {
		t.Fatalf("expected year 2026 extracted from startDate, got %v", scReport["year"])
	}
	if scReport["nondeductibleMeals"].(float64) != 40.0 {
		t.Fatalf("expected 50%% nondeductible meals = 40.0, got %v", scReport["nondeductibleMeals"])
	}
	if scReport["selfEmploymentTax"].(float64) <= 0 || scReport["estimatedQuarterlyTax"].(float64) <= 0 {
		t.Fatalf("expected positive SE & quarterly tax for profitable business: %v", scReport)
	}
	// Unsupported revenue line error check in BuildScheduleCData
	badRev := models.ChartAccount{Code: "4888", Name: "BadSchedC", Type: "REVENUE", ScheduleCLine: "Line 99 - Invalid", Active: true}
	testDB.Create(&badRev)
	testDB.Create(&models.BankTransaction{Date: d1, Description: "BAD LINE", Amount: models.NewMoney(10.0), FITID: "BAD-1", ChartAccountID: &checking.ID, CategoryAccountID: &badRev.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"})
	if code, _ = doJSONMap(t, app, "GET", "/api/reports/schedule-c?year=2026", nil); code != 500 {
		t.Fatalf("expected 500 for unsupported Schedule C revenue line, got %d", code)
	}
	testDB.Unscoped().Where("fit_id = ?", "BAD-1").Delete(&models.BankTransaction{})

	// 3. GetCashFlowSummary
	code, cfResp := doJSONMap(t, app, "GET", "/api/reports/cash-flow?startDate=2026-01-01&endDate=2026-12-31", nil)
	if code != 200 {
		t.Fatalf("expected 200 GetCashFlowSummary, got %d", code)
	}
	cfReport := cfResp["report"].(map[string]interface{})
	// Card payment & internal asset transfer excluded; total inflows = 200000 + 50 + 25 = 200075
	if cfReport["totalCashIn"].(float64) != 200075.0 {
		t.Fatalf("expected cashIn=200075.0, got %v", cfReport["totalCashIn"])
	}

	// 4. GetVendorSpendReport
	code, vsResp := doJSONMap(t, app, "GET", "/api/reports/vendor-spend?startDate=2026-01-01&endDate=2026-12-31", nil)
	if code != 200 {
		t.Fatalf("expected 200 GetVendorSpendReport, got %d", code)
	}
	vsReport := vsResp["report"].(map[string]interface{})
	if int(vsReport["contractorsOver600"].(float64)) != 1 {
		t.Fatalf("expected 1 contractor >= $600 (AWS $1200), got %v", vsReport["contractorsOver600"])
	}

	// 5. GetARAgingReport
	code, arResp := doJSONMap(t, app, "GET", "/api/reports/ar-aging?asOfDate=2026-04-15&salesDays=60", nil)
	if code != 200 {
		t.Fatalf("expected 200 GetARAgingReport, got %d", code)
	}
	arReport := arResp["report"].(map[string]interface{})
	if arReport["totalOverdue"].(float64) != 1500.0 || int(arReport["salesDays"].(float64)) != 60 {
		t.Fatalf("unexpected GetARAgingReport result: %v", arReport)
	}

	// 6. GetTrialBalance -> double-entry invariant check including archived account & cash expenses!
	code, tbResp := doJSONMap(t, app, "GET", "/api/reports/trial-balance?startDate=2026-01-01&endDate=2026-12-31", nil)
	if code != 200 {
		t.Fatalf("expected 200 GetTrialBalance, got %d", code)
	}
	tbReport := tbResp["report"].(map[string]interface{})
	if tbReport["isBalanced"] != true || int64(tbReport["varianceCents"].(float64)) != 0 {
		t.Fatalf("Trial Balance MUST balance across archived accounts & cash expenses! got balanced=%v variance=%v totalDebit=%v totalCredit=%v",
			tbReport["isBalanced"], tbReport["varianceCents"], tbReport["totalDebit"], tbReport["totalCredit"])
	}
}
