package controllers

import (
	"testing"

	"reflex-tech-bookkeeping-app-api/models"
)

// strPtr is a test helper for string pointers.
func strPtr(s string) *string {
	return &s
}

// TestBuildProfitLossData_Balanced verifies standard revenue and expense aggregation with net margin.
func TestBuildProfitLossData_Balanced(t *testing.T) {
	input := PLBuilderInput{
		StartDate: "2026-01-01",
		EndDate:   "2026-12-31",
		RevenueLines: []PLRawAccountLine{
			{AccountCode: "4000", AccountName: "Consulting Income", Total: models.NewMoney(8000.00)},
			{AccountCode: "4100", AccountName: "Product Sales", Total: models.NewMoney(2000.00)},
		},
		ReceiptExpenses: []PLRawAccountLine{
			{AccountCode: "5000", AccountName: "Advertising", Total: models.NewMoney(1500.00)},
			{AccountCode: "5100", AccountName: "Software", Total: models.NewMoney(1500.00)},
		},
		DebitExpenses: []PLRawAccountLine{
			{AccountCode: "5200", AccountName: "Rent", Total: models.NewMoney(3000.00)},
		},
	}

	report := BuildProfitLossData(input)

	if report.TotalRevenue.Cents != 1000000 { // $10,000.00
		t.Fatalf("expected TotalRevenue 1000000 cents, got %d", report.TotalRevenue.Cents)
	}
	if report.TotalExpenses.Cents != 600000 { // $6,000.00
		t.Fatalf("expected TotalExpenses 600000 cents, got %d", report.TotalExpenses.Cents)
	}
	if report.NetIncome.Cents != 400000 { // $4,000.00
		t.Fatalf("expected NetIncome 400000 cents, got %d", report.NetIncome.Cents)
	}
	if report.NetMarginPercent != 40.0 {
		t.Fatalf("expected NetMarginPercent 40.0, got %f", report.NetMarginPercent)
	}
	if len(report.Revenue) != 2 {
		t.Fatalf("expected 2 revenue lines, got %d", len(report.Revenue))
	}
	if len(report.Expenses) != 3 {
		t.Fatalf("expected 3 expense lines, got %d", len(report.Expenses))
	}
}

// TestBuildProfitLossData_NetLoss verifies expense excess and negative net margin.
func TestBuildProfitLossData_NetLoss(t *testing.T) {
	input := PLBuilderInput{
		StartDate: "2026-01-01",
		EndDate:   "2026-01-31",
		RevenueLines: []PLRawAccountLine{
			{AccountCode: "4000", AccountName: "Consulting", Total: models.NewMoney(2000.00)},
		},
		DebitExpenses: []PLRawAccountLine{
			{AccountCode: "5200", AccountName: "Rent", Total: models.NewMoney(3000.00)},
		},
	}

	report := BuildProfitLossData(input)

	if report.TotalRevenue.Cents != 200000 {
		t.Fatalf("expected TotalRevenue 200000 cents, got %d", report.TotalRevenue.Cents)
	}
	if report.TotalExpenses.Cents != 300000 {
		t.Fatalf("expected TotalExpenses 300000 cents, got %d", report.TotalExpenses.Cents)
	}
	if report.NetIncome.Cents != -100000 {
		t.Fatalf("expected NetIncome -100000 cents, got %d", report.NetIncome.Cents)
	}
	if report.NetMarginPercent != -50.0 {
		t.Fatalf("expected NetMarginPercent -50.0, got %f", report.NetMarginPercent)
	}
}

// TestBuildProfitLossData_ZeroRevenue verifies division-by-zero safety when revenue is zero.
func TestBuildProfitLossData_ZeroRevenue(t *testing.T) {
	input := PLBuilderInput{
		StartDate: "2026-01-01",
		EndDate:   "2026-01-31",
		DebitExpenses: []PLRawAccountLine{
			{AccountCode: "5100", AccountName: "Software", Total: models.NewMoney(500.00)},
		},
	}

	report := BuildProfitLossData(input)

	if report.TotalRevenue.Cents != 0 {
		t.Fatalf("expected TotalRevenue 0, got %d", report.TotalRevenue.Cents)
	}
	if report.TotalExpenses.Cents != 50000 {
		t.Fatalf("expected TotalExpenses 50000, got %d", report.TotalExpenses.Cents)
	}
	if report.NetIncome.Cents != -50000 {
		t.Fatalf("expected NetIncome -50000, got %d", report.NetIncome.Cents)
	}
	if report.NetMarginPercent != 0.0 {
		t.Fatalf("expected NetMarginPercent 0.0 on zero revenue, got %f", report.NetMarginPercent)
	}
}

// TestBuildProfitLossData_IntegerCentPrecision verifies that fractional/odd cents do not drift.
func TestBuildProfitLossData_IntegerCentPrecision(t *testing.T) {
	input := PLBuilderInput{
		RevenueLines: []PLRawAccountLine{
			{AccountCode: "4000", AccountName: "Line A", Total: models.Money{Cents: 10001}}, // $100.01
			{AccountCode: "4000", AccountName: "Line A", Total: models.Money{Cents: 20002}}, // $200.02
		},
		DebitExpenses: []PLRawAccountLine{
			{AccountCode: "5000", AccountName: "Expense A", Total: models.Money{Cents: 5001}}, // $50.01
		},
	}

	report := BuildProfitLossData(input)

	if report.TotalRevenue.Cents != 30003 { // $300.03 exactly
		t.Fatalf("expected TotalRevenue 30003, got %d", report.TotalRevenue.Cents)
	}
	if report.TotalExpenses.Cents != 5001 {
		t.Fatalf("expected TotalExpenses 5001, got %d", report.TotalExpenses.Cents)
	}
	if report.NetIncome.Cents != 25002 { // $250.02 exactly
		t.Fatalf("expected NetIncome 25002, got %d", report.NetIncome.Cents)
	}
}

// TestBuildProfitLossData_SuspenseRouting verifies that uncategorized items land in 9998/9999.
func TestBuildProfitLossData_SuspenseRouting(t *testing.T) {
	input := PLBuilderInput{
		UncategorizedDeposits: models.NewMoney(500.00),
		UncategorizedExpenses: models.NewMoney(120.00),
		UncategorizedDebits:   models.NewMoney(80.00),
		PartialDebitRemainders: []PLPartialDebitRemainder{
			{
				AccountCode: nil,
				AccountType: nil,
				Total:       models.NewMoney(50.00),
			},
			{
				AccountCode: strPtr("5410"),
				AccountName: strPtr("Travel"),
				AccountType: strPtr("EXPENSE"),
				Total:       models.NewMoney(75.00),
			},
		},
	}

	report := BuildProfitLossData(input)

	// Revenue: 9998 = $500
	if len(report.Revenue) != 1 || report.Revenue[0].AccountCode != "9998" {
		t.Fatalf("expected 9998 in revenue, got %+v", report.Revenue)
	}
	if report.Revenue[0].Total.Cents != 50000 {
		t.Fatalf("expected 9998 total 50000, got %d", report.Revenue[0].Total.Cents)
	}

	// Expenses: 5410 Travel = $75.00, 9999 Suspense = $120 + $80 + $50 = $250.00
	if len(report.Expenses) != 2 {
		t.Fatalf("expected 2 expense lines, got %d", len(report.Expenses))
	}

	var foundTravel, foundSuspense bool
	for _, exp := range report.Expenses {
		if exp.AccountCode == "5410" {
			foundTravel = true
			if exp.Total.Cents != 7500 {
				t.Fatalf("expected Travel total 7500, got %d", exp.Total.Cents)
			}
		}
		if exp.AccountCode == "9999" {
			foundSuspense = true
			if exp.Total.Cents != 25000 {
				t.Fatalf("expected Suspense total 25000, got %d", exp.Total.Cents)
			}
		}
	}
	if !foundTravel || !foundSuspense {
		t.Fatalf("expected Travel and Suspense in expenses, got %+v", report.Expenses)
	}
}

// TestBuildProfitLossData_OffsettingDebits verifies contra-expense handling (vendor rebates).
func TestBuildProfitLossData_OffsettingDebits(t *testing.T) {
	input := PLBuilderInput{
		ReceiptExpenses: []PLRawAccountLine{
			{AccountCode: "5100", AccountName: "Supplies", Total: models.NewMoney(300.00)},
		},
		DebitExpenses: []PLRawAccountLine{
			{AccountCode: "5100", AccountName: "Supplies", Total: models.NewMoney(-50.00)}, // $50 rebate
		},
	}

	report := BuildProfitLossData(input)

	if len(report.Expenses) != 1 {
		t.Fatalf("expected 1 netted expense line, got %d", len(report.Expenses))
	}
	if report.Expenses[0].Total.Cents != 25000 { // $250.00 netted
		t.Fatalf("expected netted total 25000, got %d", report.Expenses[0].Total.Cents)
	}
}

// TestBuildProfitLossData_EmptySlicesNonNil verifies that empty revenue/expenses slices are non-nil for JSON [] serialization.
func TestBuildProfitLossData_EmptySlicesNonNil(t *testing.T) {
	report := BuildProfitLossData(PLBuilderInput{
		StartDate: "2026-01-01",
		EndDate:   "2026-01-31",
	})
	if report.Revenue == nil {
		t.Fatal("expected non-nil Revenue slice when empty")
	}
	if report.Expenses == nil {
		t.Fatal("expected non-nil Expenses slice when empty")
	}
}
