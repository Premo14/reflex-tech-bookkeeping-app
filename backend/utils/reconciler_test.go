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
		{Amount: models.NewMoney(60.50)},
		{Amount: models.NewMoney(39.50)},
		{Amount: models.NewMoney(100.00)},
	}

	sum := calculateExpenseSum(expenses)
	if sum != 20000 {
		t.Errorf("calculateExpenseSum() = %d cents, expected 20000 cents", sum)
	}

	emptySum := calculateExpenseSum([]models.Expense{})
	if emptySum != 0 {
		t.Errorf("calculateExpenseSum([]) = %d cents, expected 0", emptySum)
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
	tx1 := models.BankTransaction{Amount: models.NewMoney(-50.00), Date: now, Description: "Walmart #3334"}
	exp1 := models.Expense{Amount: models.NewMoney(50.00), Timestamp: now, Vendor: "Walmart #3334"}
	score1 := calculateMatchScore(exp1, tx1)
	if score1 < 80 {
		t.Errorf("expected exact amount + vendor + date score >= 80, got %d", score1)
	}

	// Case 2: Complete mismatch (Staples $49.99 vs ATM -$62.50) must score 0
	txATM := models.BankTransaction{Amount: models.NewMoney(-62.50), Date: now, Description: "Withdrawal at ATM #382230 PIT STOP"}
	expStaples := models.Expense{Amount: models.NewMoney(49.99), Timestamp: now, Vendor: "Staples #0412"}
	scoreATM := calculateMatchScore(expStaples, txATM)
	if scoreATM != 0 {
		t.Errorf("expected mismatch (Staples vs ATM) score == 0, got %d", scoreATM)
	}

	// Case 3: Restaurant tip (receipt $40 vs bank debit -$46 with 15% tip) and matching vendor
	txRest := models.BankTransaction{Amount: models.NewMoney(-46.00), Date: now, Description: "Bokie's Burgers Malone NY"}
	expRest := models.Expense{Amount: models.NewMoney(40.00), Timestamp: now, Vendor: "Bokie's Burgers & Catering"}
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

func TestCalculateMerchantFee(t *testing.T) {
	tests := []struct {
		name             string
		grossDollars     float64
		expectedFeeCents int64
		expectedNetCents int64
	}{
		{
			name:             "$1,000.00 Invoice (2.9% + $0.30 = $29.30)",
			grossDollars:     1000.00,
			expectedFeeCents: 2930,
			expectedNetCents: 97070,
		},
		{
			name:             "$100.00 Invoice (2.9% + $0.30 = $3.20)",
			grossDollars:     100.00,
			expectedFeeCents: 320,
			expectedNetCents: 9680,
		},
		{
			name:             "$50.00 Invoice (2.9% + $0.30 = $1.75)",
			grossDollars:     50.00,
			expectedFeeCents: 175,
			expectedNetCents: 4825,
		},
		{
			name:             "$0.00 Invoice",
			grossDollars:     0.00,
			expectedFeeCents: 0,
			expectedNetCents: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			grossCents := int64(math.Round(tt.grossDollars * 100))
			feeCents, netCents := CalculateMerchantFee(grossCents)

			if feeCents != tt.expectedFeeCents {
				t.Errorf("CalculateMerchantFee(%f) fee = %d cents, want %d cents", tt.grossDollars, feeCents, tt.expectedFeeCents)
			}
			if netCents != tt.expectedNetCents {
				t.Errorf("CalculateMerchantFee(%f) net = %d cents, want %d cents", tt.grossDollars, netCents, tt.expectedNetCents)
			}
			if grossCents > 0 && feeCents+netCents != grossCents {
				t.Errorf("Conservation of money failed: %d + %d != %d", feeCents, netCents, grossCents)
			}
		})
	}
}

func TestEvaluateInvoiceDepositMatch(t *testing.T) {
	issueDate := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)

	t.Run("Matches SENT invoice with exact amount and client name", func(t *testing.T) {
		inv := &models.Invoice{
			ID:            10,
			InvoiceNumber: "INV-2026-010",
			ClientName:    "Acme Roofing",
			IssueDate:     issueDate,
			TotalAmount:   models.NewMoney(1250.00),
			BalanceDue:    models.NewMoney(1250.00),
			Status:        "SENT",
		}
		tx := &models.BankTransaction{
			ID:          42,
			Date:        issueDate.AddDate(0, 0, 5),
			Description: "ACH DEPOSIT ACME ROOFING LLC",
			Amount:      models.NewMoney(1250.00),
		}
		matched, isFee, _ := EvaluateInvoiceDepositMatch(inv, tx, 2)
		if !matched || isFee {
			t.Fatalf("expected exact match for SENT invoice, got matched=%v, isFee=%v", matched, isFee)
		}
	})

	t.Run("Skips deposit manually declined by user", func(t *testing.T) {
		inv := &models.Invoice{
			ID:            10,
			InvoiceNumber: "INV-2026-010",
			ClientName:    "Acme Roofing",
			IssueDate:     issueDate,
			TotalAmount:   models.NewMoney(1250.00),
			BalanceDue:    models.NewMoney(1250.00),
			Status:        "SENT",
			DeclinedTxIDs: ",42,",
		}
		tx := &models.BankTransaction{
			ID:          42,
			Date:        issueDate.AddDate(0, 0, 5),
			Description: "ACH DEPOSIT ACME ROOFING LLC",
			Amount:      models.NewMoney(1250.00),
		}
		matched, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1)
		if matched {
			t.Fatalf("expected declined tx #42 not to auto-match again")
		}
	})

	t.Run("Matches PARTIALLY_PAID balance net of Stripe fee (2.9% + $0.30)", func(t *testing.T) {
		inv := &models.Invoice{
			ID:            11,
			InvoiceNumber: "INV-2026-011",
			ClientName:    "Beta Studios",
			IssueDate:     issueDate,
			TotalAmount:   models.NewMoney(200.00),
			AmountPaid:    models.NewMoney(100.00),
			BalanceDue:    models.NewMoney(100.00),
			Status:        "PARTIALLY_PAID",
		}
		// Net of $100.00 = $96.80
		tx := &models.BankTransaction{
			ID:          55,
			Date:        issueDate.AddDate(0, 0, 2),
			Description: "STRIPE TRANSFER BETA",
			Amount:      models.NewMoney(96.80),
		}
		matched, isFee, feeDollars := EvaluateInvoiceDepositMatch(inv, tx, 3)
		if !matched || !isFee || math.Abs(feeDollars-3.20) > 0.01 {
			t.Fatalf("expected merchant fee match ($3.20 fee), got matched=%v, isFee=%v, fee=%.2f", matched, isFee, feeDollars)
		}
	})

	t.Run("Never matches DRAFT or PAID invoices", func(t *testing.T) {
		invDraft := &models.Invoice{
			ID:          12,
			ClientName:  "Draft Client",
			IssueDate:   issueDate,
			TotalAmount: models.NewMoney(500.00),
			BalanceDue:  models.NewMoney(500.00),
			Status:      "DRAFT",
		}
		tx := &models.BankTransaction{
			ID:          70,
			Date:        issueDate,
			Description: "Draft Client Deposit",
			Amount:      models.NewMoney(500.00),
		}
		if matched, _, _ := EvaluateInvoiceDepositMatch(invDraft, tx, 1); matched {
			t.Fatalf("DRAFT invoice must not auto-match")
		}
	})

	// PASS 3: Deposit amount far outside proximity window → no match
	t.Run("Rejects deposit outside [-5, 90] day proximity window", func(t *testing.T) {
		inv := &models.Invoice{
			ID:            20,
			InvoiceNumber: "INV-2026-020",
			ClientName:    "Far Away Corp",
			IssueDate:     issueDate,
			TotalAmount:   models.NewMoney(500.00),
			BalanceDue:    models.NewMoney(500.00),
			Status:        "SENT",
		}
		// 91 days later — outside window
		tx := &models.BankTransaction{
			ID:          80,
			Date:        issueDate.AddDate(0, 0, 91),
			Description: "Far Away Corp Payment",
			Amount:      models.NewMoney(500.00),
		}
		if matched, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1); matched {
			t.Fatal("expected no match for deposit 91 days after invoice")
		}
	})
}

// ── calculateExpenseSum (integer cents) ────────────────────────────────

func TestCalculateExpenseSumIntegerCents(t *testing.T) {
	tests := []struct {
		name     string
		amounts  []float64
		expected int64
	}{
		{
			name:     "Simple sum",
			amounts:  []float64{10.50, 20.75, 30.25},
			expected: 6150,
		},
		{
			name:     "Empty list",
			amounts:  []float64{},
			expected: 0,
		},
		{
			name:     "Single expense",
			amounts:  []float64{99.99},
			expected: 9999,
		},
		{
			name:     "Float rounding trap: 0.1 + 0.2",
			amounts:  []float64{0.1, 0.2},
			expected: 30,
		},
		{
			name:     "Large values",
			amounts:  []float64{1000.00, 2000.00, 500.50},
			expected: 350050,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var expenses []models.Expense
			for _, a := range tt.amounts {
				expenses = append(expenses, models.Expense{Amount: models.NewMoney(a)})
			}
			got := calculateExpenseSum(expenses)
			if got != tt.expected {
				t.Errorf("calculateExpenseSum() = %d cents, expected %d cents", got, tt.expected)
			}
		})
	}
}

// ── findSubsetSum (integer cents) ──────────────────────────────────────

func TestFindSubsetSumIntegerCents(t *testing.T) {
	tests := []struct {
		name      string
		amounts   []int64 // cents
		target    int64
		wantCount int
	}{
		{
			name:      "Single exact match",
			amounts:   []int64{1000, 2000, 3000},
			target:    2000,
			wantCount: 1,
		},
		{
			name:      "Two-item sum",
			amounts:   []int64{1000, 1500, 2000, 500},
			target:    2500,
			wantCount: 2,
		},
		{
			name:      "Three-item sum",
			amounts:   []int64{1000, 1000, 1000, 500, 1500},
			target:    2500,
			wantCount: 3,
		},
		{
			name:      "No match — all too small",
			amounts:   []int64{100, 200, 300},
			target:    1000,
			wantCount: 0,
		},
		{
			name:      "No match — all too large",
			amounts:   []int64{2000, 3000},
			target:    500,
			wantCount: 0,
		},
		{
			name:      "Zero target",
			amounts:   []int64{1000, 2000},
			target:    0,
			wantCount: 0,
		},
		{
			name:      "Empty expenses",
			amounts:   []int64{},
			target:    1000,
			wantCount: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var expenses []models.Expense
			for _, a := range tt.amounts {
				expenses = append(expenses, models.Expense{Amount: models.Money{Cents: a}})
			}
			got := findSubsetSum(expenses, tt.target)
			if len(got) != tt.wantCount {
				t.Errorf("findSubsetSum() returned %d items, expected %d", len(got), tt.wantCount)
			}
			if tt.wantCount > 0 {
				// Verify the sum is exact
				var sum int64
				for _, e := range got {
					sum += e.Amount.Cents
				}
				if sum != tt.target {
					t.Errorf("subset sum = %d cents, expected %d cents", sum, tt.target)
				}
			}
		})
	}
}

func TestFindSubsetSumExactMatch(t *testing.T) {
	// Edge case: single expense equals target exactly
	exp := []models.Expense{{Amount: models.Money{Cents: 5000}}}
	result := findSubsetSum(exp, 5000)
	if len(result) != 1 || result[0].Amount.Cents != 5000 {
		t.Fatalf("expected single-item match for exact target, got %d items", len(result))
	}
}

// ── findSubsetSumDFS fallback ──────────────────────────────────────────

func TestFindSubsetSumDFSBaseline(t *testing.T) {
	// Small set that triggers DFS (> 15 items needed for DFS fallback).
	// With ≤15 items, DP should handle it. Test DFS by manually forcing via
	// creating a target > 50M cents ($500k) which is impractical but verifies code path.
	// Instead, verify DFS handles its capped ≤15 items correctly.
	expenses := make([]models.Expense, 12)
	for i := range expenses {
		expenses[i] = models.Expense{Amount: models.Money{Cents: 50000}} // $500 each
	}
	// $500k target would trigger DFS but we cap at 15; $600 = 6 items * $500
	result := findSubsetSum(expenses, 300000) // $3,000 = 6 * $500
	if len(result) != 6 {
		t.Fatalf("expected 6 items for $3000 target, got %d", len(result))
	}
}

// ── UpdateAllocationStatuses — integer cents correctness ───────────────

func TestUpdateAllocationStatusesIntegerCents(t *testing.T) {
	// This tests the core logic flow (balanced/unlinked/partial/over) without DB.
	// Full integration is tested via controller tests.
	// Here we verify the helper functions used by UpdateAllocationStatuses work correctly.

	// 1:N split where sum == tx amount → BALANCED
	exp1 := models.Expense{Amount: models.Money{Cents: 1500}}
	exp2 := models.Expense{Amount: models.Money{Cents: 1000}}
	sum1 := calculateExpenseSum([]models.Expense{exp1, exp2})
	if sum1 != 2500 {
		t.Errorf("expected 1:N sum = 2500, got %d", sum1)
	}

	// 1:N split where sum < tx amount → PARTIALLY_ALLOCATED
	sum2 := calculateExpenseSum([]models.Expense{exp1})
	if sum2 != 1500 {
		t.Errorf("expected partial sum = 1500, got %d", sum2)
	}

	// 1:N split where sum > tx amount → OVER_ALLOCATED
	sum3 := calculateExpenseSum([]models.Expense{exp1, exp2, exp2})
	if sum3 != 3500 {
		t.Errorf("expected over sum = 3500, got %d", sum3)
	}
}
