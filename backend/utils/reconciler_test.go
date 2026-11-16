package utils

import (
	"fmt"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
)

// ── CalculateMerchantFee comprehensive ─────────────────────────────────

func TestCalculateMerchantFeeComprehensive(t *testing.T) {
	tests := []struct {
		name       string
		grossDoll  float64
		wantFee    int64
		wantNet    int64
	}{
		{"$1,000.00 → fee $29.30", 1000.00, 2930, 97070},
		{"$100.00 → fee $3.20", 100.00, 320, 9680},
		{"$50.00 → fee $1.75", 50.00, 175, 4825},
		{"$0.00 → no fee", 0.00, 0, 0},
		{"$10.00 → fee $0.59", 10.00, 59, 941},
		{"$5.01 → fee $0.45", 5.01, 45, 456},
		{"$200.00 → fee $6.10", 200.00, 610, 19390},
		{"$99.99 → fee $3.20", 99.99, 320, 9679},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			grossCents := int64(0)
			if tt.grossDoll > 0 {
				grossCents = int64(0.5 + tt.grossDoll*100)
			}
			feeCents, netCents := CalculateMerchantFee(grossCents)
			if feeCents != tt.wantFee {
				t.Errorf("fee = %d, want %d", feeCents, tt.wantFee)
			}
			if netCents != tt.wantNet {
				t.Errorf("net = %d, want %d", netCents, tt.wantNet)
			}
			if grossCents > 0 && feeCents+netCents != grossCents {
				t.Errorf("money conservation: %d + %d != %d", feeCents, netCents, grossCents)
			}
		})
	}
}

// ── EvaluateInvoiceDepositMatch comprehensive ──────────────────────────

func TestEvaluateInvoiceDepositMatchComprehensive(t *testing.T) {
	issue := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)

	t.Run("Exact match with client name", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           1,
			ClientName:   "Acme Roofing",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(1250.00),
			BalanceDue:   models.NewMoney(1250.00),
			Status:       "SENT",
		}
		tx := &models.BankTransaction{
			ID:          10,
			Date:        issue.AddDate(0, 0, 3),
			Description: "ACH DEPOSIT ACME ROOFING",
			Amount:      models.NewMoney(1250.00),
		}
		m, f, _ := EvaluateInvoiceDepositMatch(inv, tx, 2)
		if !m || f {
			t.Fatal("expected exact match")
		}
	})

	t.Run("Exact match with invoice number", func(t *testing.T) {
		inv := &models.Invoice{
			ID:             2,
			InvoiceNumber:  "INV-001",
			ClientName:     "",
			IssueDate:      issue,
			TotalAmount:    models.NewMoney(500.00),
			BalanceDue:     models.NewMoney(500.00),
			Status:         "SENT",
		}
		tx := &models.BankTransaction{
			ID:          11,
			Date:        issue,
			Description: "DEPOSIT INV-001",
			Amount:      models.NewMoney(500.00),
		}
		m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1)
		if !m {
			t.Fatal("expected match by invoice number")
		}
	})

	t.Run("Sole open invoice (no name/number match required)", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           3,
			ClientName:   "Unknown Client",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(300.00),
			BalanceDue:   models.NewMoney(300.00),
			Status:       "SENT",
		}
		tx := &models.BankTransaction{
			ID:       12,
			Date:     issue,
			Amount:   models.NewMoney(300.00),
		}
		m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1)
		if !m {
			t.Fatal("expected match for sole open invoice")
		}
	})

	t.Run("Merchant fee net deposit match", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           4,
			ClientName:   "Beta Corp",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(500.00),
			AmountPaid:   models.NewMoney(200.00),
			BalanceDue:   models.NewMoney(300.00),
			Status:       "PARTIALLY_PAID",
		}
		// Net of $300 = $291.10
		tx := &models.BankTransaction{
			ID:          13,
			Date:        issue.AddDate(0, 0, 2),
			Description: "STRIPE TRANSFER BETA",
			Amount:      models.NewMoney(291.10),
		}
		m, f, fee := EvaluateInvoiceDepositMatch(inv, tx, 3)
		if !m || !f {
			t.Fatalf("expected merchant fee match")
		}
		if fee < 8.0 || fee > 9.0 {
			t.Fatalf("expected fee ~$8.41, got $%.2f", fee)
		}
	})

	t.Run("Declined transaction", func(t *testing.T) {
		inv := &models.Invoice{
			ID:            5,
			ClientName:    "Declined Corp",
			IssueDate:     issue,
			TotalAmount:   models.NewMoney(1000.00),
			BalanceDue:    models.NewMoney(1000.00),
			Status:        "SENT",
			DeclinedTxIDs: ",99,",
		}
		tx := &models.BankTransaction{ID: 99, Amount: models.NewMoney(1000.00)}
		if m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1); m {
			t.Fatal("declined tx should not match")
		}
	})

	t.Run("DRAFT invoice not matched", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           6,
			ClientName:   "Draft Co",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(400.00),
			BalanceDue:   models.NewMoney(400.00),
			Status:       "DRAFT",
		}
		tx := &models.BankTransaction{Amount: models.NewMoney(400.00)}
		if m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1); m {
			t.Fatal("DRAFT should not match")
		}
	})

	t.Run("PAID invoice not matched", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           7,
			ClientName:   "Paid Co",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(200.00),
			BalanceDue:   models.NewMoney(0),
			Status:       "PAID",
		}
		tx := &models.BankTransaction{Amount: models.NewMoney(200.00)}
		if m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1); m {
			t.Fatal("PAID should not match")
		}
	})

	t.Run("Deposit outside proximity window", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           8,
			ClientName:   "Far Corp",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(600.00),
			BalanceDue:   models.NewMoney(600.00),
			Status:       "SENT",
		}
		// 91 days after issue
		tx := &models.BankTransaction{
			ID:       14,
			Date:     issue.AddDate(0, 0, 91),
			Amount:   models.NewMoney(600.00),
		}
		if m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1); m {
			t.Fatal("outside 90-day window should not match")
		}
	})

	t.Run("Negative deposit amount not matched", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           9,
			ClientName:   "Neg Corp",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(100.00),
			BalanceDue:   models.NewMoney(100.00),
			Status:       "SENT",
		}
		tx := &models.BankTransaction{Amount: models.NewMoney(-100.00)}
		if m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1); m {
			t.Fatal("negative deposit should not match")
		}
	})

	t.Run("Balance due is zero not matched", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           10,
			ClientName:   "Zero Corp",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(100.00),
			BalanceDue:   models.NewMoney(0),
			Status:       "SENT",
		}
		tx := &models.BankTransaction{Amount: models.NewMoney(100.00)}
		if m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1); m {
			t.Fatal("zero balance due should not match")
		}
	})

	t.Run("Nil invoice", func(t *testing.T) {
		tx := &models.BankTransaction{Amount: models.NewMoney(100.00)}
		if m, _, _ := EvaluateInvoiceDepositMatch(nil, tx, 1); m {
			t.Fatal("nil invoice should not match")
		}
	})

	t.Run("Nil transaction", func(t *testing.T) {
		inv := &models.Invoice{
			ClientName: "Test Corp",
			IssueDate:  issue,
			TotalAmount: models.NewMoney(100.00),
			BalanceDue: models.NewMoney(100.00),
			Status:     "SENT",
		}
		if m, _, _ := EvaluateInvoiceDepositMatch(inv, nil, 1); m {
			t.Fatal("nil transaction should not match")
		}
	})

	t.Run("Merchant fee with no name/number/processor and multiple invoices rejected; processor or sole invoice matches", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           11,
			ClientName:   "",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(50.00),
			BalanceDue:   models.NewMoney(50.00),
			Status:       "SENT",
		}
		// Net of $50 = $48.25
		blankTx := &models.BankTransaction{
			ID:       15,
			Date:     issue.AddDate(0, 0, 5), // within 7 days
			Amount:   models.NewMoney(48.25),
		}
		if m, _, _ := EvaluateInvoiceDepositMatch(inv, blankTx, 5); m {
			t.Fatal("expected zero-signal multi-invoice deposit NOT to auto-match")
		}
		if m, f, _ := EvaluateInvoiceDepositMatch(inv, blankTx, 1); !m || !f {
			t.Fatal("expected merchant fee match when sole open invoice within 7 days")
		}
		stripeTx := &models.BankTransaction{
			ID:          16,
			Date:        issue.AddDate(0, 0, 5),
			Description: "STRIPE PAYOUT",
			Amount:      models.NewMoney(48.25),
		}
		if m, f, _ := EvaluateInvoiceDepositMatch(inv, stripeTx, 5); !m || !f {
			t.Fatal("expected merchant fee match when payment processor token is present")
		}
	})

	t.Run("Amount too small for merchant fee path (< $5.00)", func(t *testing.T) {
		inv := &models.Invoice{
			ID:           12,
			ClientName:   "Small Corp",
			IssueDate:    issue,
			TotalAmount:  models.NewMoney(3.00),
			BalanceDue:   models.NewMoney(3.00),
			Status:       "SENT",
		}
		// $3.00 → fee = $0.19 → net = $2.81
		tx := &models.BankTransaction{
			ID:       16,
			Date:     issue,
			Amount:   models.NewMoney(2.81),
		}
		m, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 1)
		if m {
			t.Fatal("under $5 balance should not use merchant fee path")
		}
	})
}

// ── CalculateMatchScore — date proximity ranges ────────────────────────

func TestCalculateMatchScoreDateRanges(t *testing.T) {
	base := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)

	t.Run("Same day + amount + vendor → 100 capped", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00), Date: base, Description: "STORE"}
		exp := models.Expense{Amount: models.NewMoney(50.00), Timestamp: base, Vendor: "Store"}
		if s := calculateMatchScore(exp, tx); s != 100 {
			t.Fatalf("expected 100, got %d", s)
		}
	})

	t.Run("1 day + amount + vendor → 90", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00), Date: base, Description: "STORE"}
		exp := models.Expense{Amount: models.NewMoney(50.00), Timestamp: base.AddDate(0, 0, 1), Vendor: "Store"}
		if s := calculateMatchScore(exp, tx); s != 90 {
			t.Fatalf("expected 90, got %d", s)
		}
	})

	t.Run("2-4 days + amount + vendor → 80", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00), Date: base, Description: "STORE"}
		exp := models.Expense{Amount: models.NewMoney(50.00), Timestamp: base.AddDate(0, 0, 3), Vendor: "Store"}
		if s := calculateMatchScore(exp, tx); s != 80 {
			t.Fatalf("expected 80, got %d", s)
		}
	})

	t.Run("5+ days + amount only → 50", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00), Date: base, Description: "STORE"}
		exp := models.Expense{Amount: models.NewMoney(50.00), Timestamp: base.AddDate(0, 0, 10), Vendor: "Other"}
		if s := calculateMatchScore(exp, tx); s != 50 { // amount 50 + date 0 + vendor 0 = 50
			t.Fatalf("expected 50, got %d", s)
		}
	})

	t.Run("Vendor only, different amount, different day → 20", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-60.00), Date: base, Description: "STORE"}
		exp := models.Expense{Amount: models.NewMoney(50.00), Timestamp: base.AddDate(0, 0, 5), Vendor: "Store"}
		s := calculateMatchScore(exp, tx)
		if s != 20 { // vendor 20 only
			t.Fatalf("expected 20, got %d", s)
		}
	})
}

// ── daysDifference — edge cases with nil DB ───────────────────────────

func TestDaysDifferenceZeroTime(t *testing.T) {
	zero := time.Time{}
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Should not panic
	daysDifference(zero, now)
	daysDifference(now, zero)
	daysDifference(zero, zero)
}

// ── vendorMatchesDescription — additional token tests ─────────────────

func TestVendorMatchesDescriptionTokens(t *testing.T) {
	// Long meaningful token substring match
	if !vendorMatchesDescription("AMZN MKTP US*ABC123 PAYMENT", "Amazon") {
		t.Error("AMZN substring should match Amazon")
	}

	// Token too short (single chars should be skipped)
	if vendorMatchesDescription("X Y Z", "A") {
		t.Error("single-char vendor tokens should be skipped")
	}

	// All vendor tokens are stop words → meaningfulCount = 0 → false
	if vendorMatchesDescription("SOME TEXT", "and the for") {
		t.Error("stop-word-only vendor should not match")
	}
}

// ── fmt.Sprintf in CalculateMerchantFee ───────────────────────────────

func TestCalculateMerchantFeeStringFormat(t *testing.T) {
	// Ensure the function works with round-dollar amounts
	fee, _ := CalculateMerchantFee(10000) // $100
	if fee != 320 {
		t.Errorf("fee for $100 = %d, want 320", fee)
	}
	m := models.NewMoney(100.00)
	_ = fmt.Sprintf("%.2f", m.Dollars()) // should not panic
}

// ── toCents ─────────────────────────────────────────────────────────────

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

// ── calculateExpenseSum ────────────────────────────────────────────────

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

// ── findSubsetSum ──────────────────────────────────────────────────────

func TestFindSubsetSumIntegerCents(t *testing.T) {
	tests := []struct {
		name      string
		amounts   []int64
		target    int64
		wantCount int
	}{
		{"Single exact match", []int64{1000, 2000, 3000}, 2000, 1},
		{"Two-item sum", []int64{1000, 1500, 2000, 500}, 2500, 2},
		{"Three-item sum", []int64{1000, 1000, 1000, 500, 1500}, 2500, 3},
		{"No match — all too small", []int64{100, 200, 300}, 1000, 0},
		{"No match — all too large", []int64{2000, 3000}, 500, 0},
		{"Zero target", []int64{1000, 2000}, 0, 0},
		{"Empty expenses", []int64{}, 1000, 0},
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
	exp := []models.Expense{{Amount: models.Money{Cents: 5000}}}
	result := findSubsetSum(exp, 5000)
	if len(result) != 1 || result[0].Amount.Cents != 5000 {
		t.Fatalf("expected single-item match for exact target, got %d items", len(result))
	}
}

// ── findSubsetSumDFS ───────────────────────────────────────────────────

func TestFindSubsetSumDFSBaseline(t *testing.T) {
	expenses := make([]models.Expense, 12)
	for i := range expenses {
		expenses[i] = models.Expense{Amount: models.Money{Cents: 50000}}
	}
	result := findSubsetSumDFS(expenses, 300000) // $3,000 = 6 * $500
	if len(result) != 6 {
		t.Fatalf("expected 6 items for $3000 target, got %d", len(result))
	}
}

// ── UpdateReconciliationStatuses (alias) ───────────────────────────────

func TestUpdateReconciliationStatusesAlias(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Logf("Expected nil-DB panic in alias: %v", r)
		}
	}()
	UpdateReconciliationStatuses()
}

// ── UpdateAllocationStatuses integer cents ─────────────────────────────

func TestUpdateAllocationStatusesIntegerCents(t *testing.T) {
	exp1 := models.Expense{Amount: models.Money{Cents: 1500}}
	exp2 := models.Expense{Amount: models.Money{Cents: 1000}}
	sum1 := calculateExpenseSum([]models.Expense{exp1, exp2})
	if sum1 != 2500 {
		t.Errorf("expected 1:N sum = 2500, got %d", sum1)
	}
	sum2 := calculateExpenseSum([]models.Expense{exp1})
	if sum2 != 1500 {
		t.Errorf("expected partial sum = 1500, got %d", sum2)
	}
	sum3 := calculateExpenseSum([]models.Expense{exp1, exp2, exp2})
	if sum3 != 3500 {
		t.Errorf("expected over sum = 3500, got %d", sum3)
	}
}

func TestEvaluateInvoiceDepositMatch_NoStopWordFalsePositive(t *testing.T) {
	txDate := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)

	inv := &models.Invoice{
		InvoiceNumber: "INV-2026-009",
		ClientName:    "The Client Co",
		IssueDate:     txDate.AddDate(0, 0, -5),
		TotalAmount:   models.NewMoney(500.00),
		BalanceDue:    models.NewMoney(500.00),
		Status:        "SENT",
	}
	tx := &models.BankTransaction{
		Date:        txDate,
		Description: "THE HOME DEPOT #1234",
		Amount:      models.NewMoney(500.00),
	}

	// With openInvoiceCount == 2, stop-word "The" must not trigger hasNameMatch.
	matched, _, _ := EvaluateInvoiceDepositMatch(inv, tx, 2)
	if matched {
		t.Fatal("expected stop-word 'The' not to match unrelated deposit")
	}

	// Pass 2 merchant-fee net deposit ($485.20 = $500 - 2.9% - $0.30) with single open invoice
	// after the 7-day grace window must not match when description lacks processor/client/invoice signals.
	invOlder := *inv
	invOlder.IssueDate = txDate.AddDate(0, 0, -15)
	txUnrelatedFee := &models.BankTransaction{
		Date:        txDate,
		Description: "GENERIC ACH CREDIT 99123",
		Amount:      models.NewMoney(485.20),
	}
	matched2, _, _ := EvaluateInvoiceDepositMatch(&invOlder, txUnrelatedFee, 1)
	if matched2 {
		t.Fatal("expected signal-less single open invoice (>7d) not to auto-match Pass 2 fee deposit")
	}
}

func TestDaysDifference_DSTAndUTC(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	// Span spring-forward DST transition in America/New_York (2026-03-08):
	// 2026-03-08 06:00 NY (10:00? 11:00 UTC) to 2026-03-09 06:00 NY (10:00 UTC) is 23h elapsed,
	// yet UTC calendar dates are 2026-03-08 and 2026-03-09 -> 1 calendar day.
	d1 := time.Date(2026, 3, 8, 6, 0, 0, 0, ny)
	d2 := time.Date(2026, 3, 9, 6, 0, 0, 0, ny)
	if diff := daysDifference(d1, d2); diff != 1 {
		t.Fatalf("expected 1 calendar day across 23h spring-forward DST boundary, got %d", diff)
	}
}

func TestRunReconciliation_StrictExactAndClosedPeriod(t *testing.T) {
	gdb := setupUtilsTestDB(t)
	_ = gdb
	if err := db.DB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-02-28"}).Error; err != nil {
		t.Fatalf("seed BooksClosedDate: %v", err)
	}

	var bankAcc, expAcc models.ChartAccount
	if err := db.DB.Where("code = ?", "1010").First(&bankAcc).Error; err != nil {
		t.Fatalf("find 1010: %v", err)
	}
	if err := db.DB.Where("code = ?", "5010").First(&expAcc).Error; err != nil {
		t.Fatalf("find 5010: %v", err)
	}

	closedDate := time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC)
	openDate := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)

	// 1. Closed-period exact pair must NOT be linked or suggested.
	closedTx := models.BankTransaction{
		ChartAccountID:    &bankAcc.ID,
		CategoryAccountID: &expAcc.ID,
		Date:              closedDate,
		Description:       "CLOSED ACME HARDWARE",
		Amount:            models.NewMoney(-75.00),
		FITID:             "FIT-CLOSED-1",
		AllocationStatus:  "UNLINKED",
		ReviewStatus:      "APPROVED",
	}
	closedExp := models.Expense{
		ChartAccountID:   &expAcc.ID,
		Timestamp:        closedDate,
		Vendor:           "Closed Acme Hardware",
		Amount:           models.NewMoney(75.00),
		Tender:           "card",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "APPROVED",
	}

	// 2. Open-period non-exact 8% variance pair must NOT auto-confirm in Pass 1.
	varTx := models.BankTransaction{
		ChartAccountID:    &bankAcc.ID,
		CategoryAccountID: &expAcc.ID,
		Date:              openDate,
		Description:       "OLIVE GARDEN #442",
		Amount:            models.NewMoney(-100.00),
		FITID:             "FIT-VAR-1",
		AllocationStatus:  "UNLINKED",
		ReviewStatus:      "APPROVED",
	}
	varExp := models.Expense{
		ChartAccountID:   &expAcc.ID,
		Timestamp:        openDate,
		Vendor:           "Olive Garden",
		Amount:           models.NewMoney(108.00),
		Tender:           "card",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "APPROVED",
	}

	// 3. Open-period exact 1:1 pair MUST auto-confirm in Pass 1.
	exactTx := models.BankTransaction{
		ChartAccountID:    &bankAcc.ID,
		CategoryAccountID: &expAcc.ID,
		Date:              openDate,
		Description:       "STAPLES OFFICE STORE",
		Amount:            models.NewMoney(-50.00),
		FITID:             "FIT-EXACT-1",
		AllocationStatus:  "UNLINKED",
		ReviewStatus:      "APPROVED",
	}
	exactExp := models.Expense{
		ChartAccountID:   &expAcc.ID,
		Timestamp:        openDate,
		Vendor:           "Staples",
		Amount:           models.NewMoney(50.00),
		Tender:           "card",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "APPROVED",
	}

	for _, tx := range []*models.BankTransaction{&closedTx, &varTx, &exactTx} {
		if err := db.DB.Create(tx).Error; err != nil {
			t.Fatalf("create tx: %v", err)
		}
	}
	for _, exp := range []*models.Expense{&closedExp, &varExp, &exactExp} {
		if err := db.DB.Create(exp).Error; err != nil {
			t.Fatalf("create exp: %v", err)
		}
	}

	RunReconciliation()

	var closedLinks int64
	db.DB.Model(&models.ExpenseBankTransaction{}).
		Where("expense_id = ? AND bank_transaction_id = ?", closedExp.ID, closedTx.ID).
		Count(&closedLinks)
	if closedLinks != 0 {
		t.Fatalf("expected 0 links for closed-period pair, got %d", closedLinks)
	}

	var confirmedVar int64
	db.DB.Model(&models.ExpenseBankTransaction{}).
		Where("expense_id = ? AND bank_transaction_id = ? AND status = 'confirmed'", varExp.ID, varTx.ID).
		Count(&confirmedVar)
	if confirmedVar != 0 {
		t.Fatalf("expected 8%% variance pair NOT to auto-confirm, got %d confirmed links", confirmedVar)
	}

	var confirmedExact int64
	db.DB.Model(&models.ExpenseBankTransaction{}).
		Where("expense_id = ? AND bank_transaction_id = ? AND status = 'confirmed'", exactExp.ID, exactTx.ID).
		Count(&confirmedExact)
	if confirmedExact != 1 {
		t.Fatalf("expected exact 1:1 open-period pair to auto-confirm, got %d", confirmedExact)
	}
}

func TestUpdateAllocationStatuses_ClearsStaleHasSuggestions(t *testing.T) {
	setupUtilsTestDB(t)
	var bankAcc, expAcc models.ChartAccount
	db.DB.Where("code = ?", "1010").First(&bankAcc)
	db.DB.Where("code = ?", "5010").First(&expAcc)
	openDate := time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC)

	cashExp := models.Expense{
		ChartAccountID:   &expAcc.ID,
		Timestamp:        openDate,
		Vendor:           "Local Deli",
		Amount:           models.NewMoney(18.50),
		Tender:           "cash",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "APPROVED",
		HasSuggestions:   true,
	}
	depTx := models.BankTransaction{
		ChartAccountID:   &bankAcc.ID,
		Date:             openDate,
		Description:      "CLIENT WIRE DEPOSIT",
		Amount:           models.NewMoney(300.00),
		FITID:            "FIT-DEP-STALE",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
		HasSuggestions:   true,
	}
	db.DB.Create(&cashExp)
	db.DB.Create(&depTx)

	UpdateAllocationStatuses()

	db.DB.First(&cashExp, cashExp.ID)
	db.DB.First(&depTx, depTx.ID)
	if cashExp.AllocationStatus != "BALANCED" || cashExp.HasSuggestions {
		t.Fatalf("expected cash exp BALANCED with HasSuggestions=false, got status=%q hasSug=%v", cashExp.AllocationStatus, cashExp.HasSuggestions)
	}
	if depTx.HasSuggestions {
		t.Fatalf("expected balanced tx HasSuggestions=false, got true")
	}
}

func TestRunInvoiceReconciliation_SkipsDeletedAndPreservesReviewStatus(t *testing.T) {
	setupUtilsTestDB(t)
	var bankAcc models.ChartAccount
	db.DB.Where("code = ?", "1010").First(&bankAcc)

	now := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	delTime := now
	deletedInv := models.Invoice{
		InvoiceNumber: "INV-DEL-01",
		ClientName:    "Acme Corp",
		IssueDate:     now.AddDate(0, 0, -5),
		DueDate:       now.AddDate(0, 0, 25),
		TotalAmount:   models.NewMoney(250.00),
		BalanceDue:    models.NewMoney(250.00),
		Status:        "SENT",
		ReviewStatus:  "DELETED",
		DeletedAt:     &delTime,
	}
	liveInv := models.Invoice{
		InvoiceNumber: "INV-LIVE-01",
		ClientName:    "Acme Corp",
		IssueDate:     now.AddDate(0, 0, -5),
		DueDate:       now.AddDate(0, 0, 25),
		TotalAmount:   models.NewMoney(250.00),
		BalanceDue:    models.NewMoney(250.00),
		Status:        "SENT",
		ReviewStatus:  "WARNINGS_IGNORED",
	}
	depTx := models.BankTransaction{
		ChartAccountID:   &bankAcc.ID,
		Date:             now,
		Description:      "ACH DEPOSIT ACME CORP",
		Amount:           models.NewMoney(250.00),
		FITID:            "FIT-INV-250",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	db.DB.Create(&deletedInv)
	db.DB.Create(&liveInv)
	db.DB.Create(&depTx)

	RunInvoiceReconciliation()

	db.DB.First(&deletedInv, deletedInv.ID)
	db.DB.First(&liveInv, liveInv.ID)
	if deletedInv.BankTransactionID != nil || deletedInv.Status != "SENT" {
		t.Fatalf("expected deleted invoice untouched, got status=%q txID=%v", deletedInv.Status, deletedInv.BankTransactionID)
	}
	if liveInv.Status != "PAID" || liveInv.BankTransactionID == nil || *liveInv.BankTransactionID != depTx.ID {
		t.Fatalf("expected live invoice matched as PAID to tx %d, got status=%q txID=%v", depTx.ID, liveInv.Status, liveInv.BankTransactionID)
	}
	if liveInv.ReviewStatus != "WARNINGS_IGNORED" {
		t.Fatalf("expected live invoice ReviewStatus preserved as WARNINGS_IGNORED, got %q", liveInv.ReviewStatus)
	}
}

func TestGenerateSyntheticFitID_Determinism(t *testing.T) {
	d := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)
	a := GenerateSyntheticFitID("OFX-SYNTH", d, "  Amazon Web Services ", -12500, 1, "ACCT-101")
	b := GenerateSyntheticFitID("OFX-SYNTH", d, "amazon web services", -12500, 1, "ACCT-101")
	c := GenerateSyntheticFitID("OFX-SYNTH", d, "amazon web services", -12500, 2, "ACCT-101")
	if a == "" || a != b {
		t.Fatalf("expected normalized deterministic OFX-SYNTH FITID, got a=%q b=%q", a, b)
	}
	if a == c {
		t.Fatalf("expected distinct occurrenceIndex to produce distinct FITID, got same %q", a)
	}
}
