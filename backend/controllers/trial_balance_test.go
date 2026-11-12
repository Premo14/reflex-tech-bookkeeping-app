package controllers

import (
	"testing"
)

func TestBuildTrialBalanceDataEmptyPeriod(t *testing.T) {
	// Querying a date range with zero transactions must still produce a balanced report
	report, err := BuildTrialBalanceData("1970-01-01", "1970-01-02")
	if err != nil {
		t.Fatalf("BuildTrialBalanceData failed: %v", err)
	}

	if !report.IsBalanced {
		t.Fatalf("Expected empty period to be balanced, got variance: %d cents", report.VarianceCents)
	}

	if report.TotalDebit.Cents != 0 || report.TotalCredit.Cents != 0 {
		t.Fatalf("Expected 0 total debits and credits for empty range, got Dr: %v, Cr: %v", report.TotalDebit, report.TotalCredit)
	}
}
