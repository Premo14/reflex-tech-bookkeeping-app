package controllers

import (
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/models"
)

func TestBuildCashFlowData_MultiMonthFlows(t *testing.T) {
	tJan := time.Date(2026, 1, 15, 10, 0, 0, 0, time.UTC)
	tFeb := time.Date(2026, 2, 10, 10, 0, 0, 0, time.UTC)
	tMar := time.Date(2026, 3, 5, 10, 0, 0, 0, time.UTC)

	txs := []CashFlowRawTx{
		// Jan: Inflow $5,000.00, Outflow $2,000.00 -> Net $3,000.00
		{Date: tJan, Amount: models.Money{Cents: 500000}},
		{Date: tJan.Add(24 * time.Hour), Amount: models.Money{Cents: -200000}},

		// Feb: Inflow $3,000.00, Outflow $3,500.00 -> Net -$500.00
		{Date: tFeb, Amount: models.Money{Cents: 300000}},
		{Date: tFeb.Add(24 * time.Hour), Amount: models.Money{Cents: -350000}},

		// Mar: Inflow $2,000.00, Outflow $500.00 -> Net $1,500.00
		{Date: tMar, Amount: models.Money{Cents: 200000}},
		{Date: tMar.Add(24 * time.Hour), Amount: models.Money{Cents: -50000}},
	}

	report := BuildCashFlowData(CashFlowBuilderInput{
		StartDate:    "2026-01-01",
		EndDate:      "2026-03-31",
		Transactions: txs,
	})

	// Total cash in: 5000 + 3000 + 2000 = 10,000.00 (1000000 cents)
	if report.TotalCashIn.Cents != 1000000 {
		t.Errorf("Expected TotalCashIn 1000000, got %d", report.TotalCashIn.Cents)
	}
	// Total cash out: 2000 + 3500 + 500 = 6,000.00 (600000 cents)
	if report.TotalCashOut.Cents != 600000 {
		t.Errorf("Expected TotalCashOut 600000, got %d", report.TotalCashOut.Cents)
	}
	// Net cash flow: 10,000 - 6,000 = 4,000.00 (400000 cents)
	if report.NetCashFlow.Cents != 400000 {
		t.Errorf("Expected NetCashFlow 400000, got %d", report.NetCashFlow.Cents)
	}

	// 3 months
	if len(report.Periods) != 3 {
		t.Fatalf("Expected 3 periods, got %d", len(report.Periods))
	}

	// Jan period:
	jan := report.Periods[0]
	if jan.Period != "2026-01" || jan.CashIn.Cents != 500000 || jan.CashOut.Cents != 200000 || jan.NetCashFlow.Cents != 300000 {
		t.Errorf("Jan period mismatch: %+v", jan)
	}
	if jan.RunningCashTotal.Cents != 300000 {
		t.Errorf("Jan running cash total expected 300000, got %d", jan.RunningCashTotal.Cents)
	}

	// Feb period:
	feb := report.Periods[1]
	if feb.Period != "2026-02" || feb.CashIn.Cents != 300000 || feb.CashOut.Cents != 350000 || feb.NetCashFlow.Cents != -50000 {
		t.Errorf("Feb period mismatch: %+v", feb)
	}
	// Running cash total: 300000 + (-50000) = 250000
	if feb.RunningCashTotal.Cents != 250000 {
		t.Errorf("Feb running cash total expected 250000, got %d", feb.RunningCashTotal.Cents)
	}

	// Mar period:
	mar := report.Periods[2]
	if mar.Period != "2026-03" || mar.CashIn.Cents != 200000 || mar.CashOut.Cents != 50000 || mar.NetCashFlow.Cents != 150000 {
		t.Errorf("Mar period mismatch: %+v", mar)
	}
	// Running cash total: 250000 + 150000 = 400000
	if mar.RunningCashTotal.Cents != 400000 {
		t.Errorf("Mar running cash total expected 400000, got %d", mar.RunningCashTotal.Cents)
	}

	// Averages across 3 months:
	// Avg monthly in: 1000000 / 3 = 333333 cents
	if report.AvgMonthlyInflow.Cents != 333333 {
		t.Errorf("Expected AvgMonthlyInflow 333333, got %d", report.AvgMonthlyInflow.Cents)
	}
	// Avg monthly out: 600000 / 3 = 200000 cents
	if report.AvgMonthlyOutflow.Cents != 200000 {
		t.Errorf("Expected AvgMonthlyOutflow 200000, got %d", report.AvgMonthlyOutflow.Cents)
	}

	// Savings rate: 4,000 / 10,000 * 100 = 40.0%
	if report.SavingsRatePercent != 40.0 {
		t.Errorf("Expected SavingsRatePercent 40.0, got %f", report.SavingsRatePercent)
	}
}

func TestBuildCashFlowData_Empty(t *testing.T) {
	report := BuildCashFlowData(CashFlowBuilderInput{
		StartDate:    "2026-01-01",
		EndDate:      "2026-12-31",
		Transactions: nil,
	})

	if report.TotalCashIn.Cents != 0 {
		t.Errorf("Expected TotalCashIn 0, got %d", report.TotalCashIn.Cents)
	}
	if report.TotalCashOut.Cents != 0 {
		t.Errorf("Expected TotalCashOut 0, got %d", report.TotalCashOut.Cents)
	}
	if report.NetCashFlow.Cents != 0 {
		t.Errorf("Expected NetCashFlow 0, got %d", report.NetCashFlow.Cents)
	}
	if report.SavingsRatePercent != 0.0 {
		t.Errorf("Expected SavingsRatePercent 0.0, got %f", report.SavingsRatePercent)
	}
	if report.Periods == nil {
		t.Errorf("Expected non-nil empty Periods slice, got nil")
	}
	if len(report.Periods) != 0 {
		t.Errorf("Expected 0 periods, got %d", len(report.Periods))
	}
}

func TestBuildCashFlowData_SkipsZeroAmountMemos(t *testing.T) {
	tJan := time.Date(2026, 1, 15, 10, 0, 0, 0, time.UTC)
	tFeb := time.Date(2026, 2, 10, 10, 0, 0, 0, time.UTC)

	txs := []CashFlowRawTx{
		{Date: tJan, Amount: models.Money{Cents: 100000}},
		{Date: tJan, Amount: models.Money{Cents: -40000}},
		// Feb only has a $0.00 bank memo — must NOT create a ghost month or dilute monthly averages
		{Date: tFeb, Amount: models.Money{Cents: 0}},
	}

	report := BuildCashFlowData(CashFlowBuilderInput{
		StartDate:    "2026-01-01",
		EndDate:      "2026-02-28",
		Transactions: txs,
	})

	if len(report.Periods) != 1 {
		t.Fatalf("Expected 1 active period (Feb $0 memo skipped), got %d", len(report.Periods))
	}
	if report.AvgMonthlyInflow.Cents != 100000 || report.AvgMonthlyOutflow.Cents != 40000 {
		t.Errorf("Expected averages not diluted by $0 memo month, got avgIn=%d avgOut=%d",
			report.AvgMonthlyInflow.Cents, report.AvgMonthlyOutflow.Cents)
	}
}
