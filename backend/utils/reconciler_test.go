package utils

import (
	"math"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/models"
)

func TestToCents(t *testing.T) {
	tests := []struct {
		name     string
		amount   float64
		expected int64
	}{
		{"Exact integer", 100.0, 10000},
		{"Two decimals", 60.45, 6045},
		{"Floating point rounding 0.1 + 0.2", 0.1 + 0.2, 30},
		{"Negative amount", -50.25, -5025},
		{"Zero", 0.0, 0},
		{"Sub-cent round up", 10.006, 1001},
		{"Sub-cent round down", 10.004, 1000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := toCents(tt.amount)
			if got != tt.expected {
				t.Errorf("toCents(%f) = %d, expected %d", tt.amount, got, tt.expected)
			}
		})
	}
}

func TestIsCashTender(t *testing.T) {
	tests := []struct {
		tender   string
		expected bool
	}{
		{"CASH", true},
		{"cash", true},
		{"Cash", true},
		{"CASH / PAPER", true},
		{"cash / paper", true},
		{"CARD", false},
		{"credit card", false},
		{"CHECK", false},
		{"ACH", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.tender, func(t *testing.T) {
			got := IsCashTender(tt.tender)
			if got != tt.expected {
				t.Errorf("IsCashTender(%q) = %v, expected %v", tt.tender, got, tt.expected)
			}
		})
	}
}

func TestCalculateExpenseSum(t *testing.T) {
	expenses := []models.Expense{
		{Amount: 60.50},
		{Amount: 39.50},
		{Amount: 100.00},
	}

	sum := calculateExpenseSum(expenses)
	if math.Abs(sum-200.00) > 0.0001 {
		t.Errorf("calculateExpenseSum() = %f, expected 200.00", sum)
	}

	emptySum := calculateExpenseSum([]models.Expense{})
	if emptySum != 0 {
		t.Errorf("calculateExpenseSum([]) = %f, expected 0", emptySum)
	}
}

func TestDaysDifference(t *testing.T) {
	d1 := time.Date(2026, 10, 1, 14, 0, 0, 0, time.UTC)
	d2 := time.Date(2026, 10, 5, 9, 30, 0, 0, time.UTC)

	diff := daysDifference(d1, d2)
	if diff != 4 {
		t.Errorf("daysDifference() = %d, expected 4", diff)
	}

	sameDayDiff := daysDifference(d1, d1)
	if sameDayDiff != 0 {
		t.Errorf("daysDifference() same day = %d, expected 0", sameDayDiff)
	}
}

func TestNormalizeStringWithApostrophes(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"McDonald's", "mcdonalds"},
		{"Wendy’s", "wendys"},
		{"Trader Joe's #123", "trader joes 123"},
		{"Lowe's Home Improvement", "lowes home improvement"},
		{"WAL*MART", "wal mart"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normalizeString(tt.input)
			if got != tt.expected {
				t.Errorf("normalizeString(%q) = %q, expected %q", tt.input, got, tt.expected)
			}
		})
	}

	// Vendor description match test
	if !vendorMatchesDescription("MCDONALDS 01460092243", "McDonald's") {
		t.Errorf("expected MCDONALDS to match McDonald's")
	}
	if !vendorMatchesDescription("WENDYS RESTAURANT #44", "Wendy's") {
		t.Errorf("expected WENDYS to match Wendy's")
	}

	// Advanced POS prefix, alias, and token overlap tests
	if !vendorMatchesDescription("Withdrawal Instant Issue VENMO *Courtney Dumas New York NY Date 07/25/26", "Courtney Dumas") {
		t.Errorf("expected VENMO Courtney Dumas to match Courtney Dumas")
	}
	if !vendorMatchesDescription("SQ *JOES COFFEE NEW YORK NY", "Joe's Coffee LLC") {
		t.Errorf("expected SQ *JOES COFFEE to match Joe's Coffee LLC")
	}
	if !vendorMatchesDescription("WAL-MART #3334", "Walmart #3334") {
		t.Errorf("expected WAL-MART #3334 to match Walmart #3334")
	}
	if !vendorMatchesDescription("AMZN Mktp US*1A2B3C", "Amazon") {
		t.Errorf("expected AMZN Mktp US to match Amazon")
	}
	if vendorMatchesDescription("Withdrawal at ATM #382230 PIT STOP DIN-705743", "Staples #0412") {
		t.Errorf("Staples should NOT match ATM Pit Stop withdrawal")
	}
}

func TestCalculateMatchScoreHardening(t *testing.T) {
	now := time.Now()

	// Case 1: Exact amount + Same day = 80
	tx1 := models.BankTransaction{Amount: -50.00, Date: now, Description: "Walmart #3334"}
	exp1 := models.Expense{Amount: 50.00, Timestamp: now, Vendor: "Walmart #3334"}
	score1 := calculateMatchScore(exp1, tx1)
	if score1 < 80 {
		t.Errorf("expected exact amount + vendor + date score >= 80, got %d", score1)
	}

	// Case 2: Complete mismatch (Staples $49.99 vs ATM -$62.50) must score 0
	txATM := models.BankTransaction{Amount: -62.50, Date: now, Description: "Withdrawal at ATM #382230 PIT STOP"}
	expStaples := models.Expense{Amount: 49.99, Timestamp: now, Vendor: "Staples #0412"}
	scoreATM := calculateMatchScore(expStaples, txATM)
	if scoreATM != 0 {
		t.Errorf("expected mismatch (Staples vs ATM) score == 0, got %d", scoreATM)
	}

	// Case 3: Restaurant tip (receipt $40 vs bank debit -$46 with 15% tip) and matching vendor
	txRest := models.BankTransaction{Amount: -46.00, Date: now, Description: "Bokie's Burgers Malone NY"}
	expRest := models.Expense{Amount: 40.00, Timestamp: now, Vendor: "Bokie's Burgers & Catering"}
	scoreRest := calculateMatchScore(expRest, txRest)
	if scoreRest < 70 {
		t.Errorf("expected tip variance with matching vendor score >= 70, got %d", scoreRest)
	}
}

func TestUnlinkedPairTombstoneMatching(t *testing.T) {
	// Simulate unlinked tombstone pairs
	unlinkedPairs := []models.ExpenseBankTransaction{
		{ExpenseID: 190, BankTransactionID: 217, Status: "unlinked"},
	}

	unlinkedMap := make(map[[2]uint]bool, len(unlinkedPairs))
	for _, p := range unlinkedPairs {
		unlinkedMap[[2]uint{p.ExpenseID, p.BankTransactionID}] = true
	}

	// 1. Specifically unlinked pair must be blocked
	if !unlinkedMap[[2]uint{190, 217}] {
		t.Errorf("expected unlinked pair (190, 217) to be blocked by unlinkedMap")
	}

	// 2. Same expense with a different transaction must NOT be blocked
	if unlinkedMap[[2]uint{190, 218}] {
		t.Errorf("unrelated pair (190, 218) should NOT be blocked")
	}

	// 3. Same transaction with a different expense must NOT be blocked
	if unlinkedMap[[2]uint{191, 217}] {
		t.Errorf("unrelated pair (191, 217) should NOT be blocked")
	}
}
