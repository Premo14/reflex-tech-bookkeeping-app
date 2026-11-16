package utils

import (
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/models"
)

// ── isTransactionEligibleForExpenseMatching ─────────────────────────────

func TestIsTransactionEligibleForExpenseMatching(t *testing.T) {
	officeCat := uint(5010)
	assetCat := uint(1010)

	t.Run("Negative amount, open, reviewed → eligible", func(t *testing.T) {
		tx := models.BankTransaction{
			Amount:           models.NewMoney(-50.00),
			AllocationStatus: "UNLINKED",
			ReviewStatus:     "APPROVED",
		}
		if !isTransactionEligibleForExpenseMatching(tx, 0, nil) {
			t.Error("expected eligible")
		}
	})

	t.Run("Positive amount (deposit) → not eligible", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(100.00)}
		if isTransactionEligibleForExpenseMatching(tx, 0, nil) {
			t.Error("deposit should not be eligible for expense matching")
		}
	})

	t.Run("Deleted transaction → not eligible", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00)}
		now := time.Now()
		tx.DeletedAt = &now
		if isTransactionEligibleForExpenseMatching(tx, 0, nil) {
			t.Error("deleted should not be eligible")
		}
	})

	t.Run("BALANCED status → not eligible", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00), AllocationStatus: "BALANCED"}
		if isTransactionEligibleForExpenseMatching(tx, 0, nil) {
			t.Error("balanced should not be eligible")
		}
	})

	t.Run("OVER_ALLOCATED status → not eligible", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00), AllocationStatus: "OVER_ALLOCATED"}
		if isTransactionEligibleForExpenseMatching(tx, 0, nil) {
			t.Error("over-allocated should not be eligible")
		}
	})

	t.Run("IGNORED review status → not eligible", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00), ReviewStatus: "IGNORED"}
		if isTransactionEligibleForExpenseMatching(tx, 0, nil) {
			t.Error("ignored should not be eligible")
		}
	})

	t.Run("DELETED review status → not eligible", func(t *testing.T) {
		tx := models.BankTransaction{Amount: models.NewMoney(-50.00), ReviewStatus: "DELETED"}
		if isTransactionEligibleForExpenseMatching(tx, 0, nil) {
			t.Error("deleted-review should not be eligible")
		}
	})

	t.Run("Balance-sheet account with 0 confirmed → not eligible", func(t *testing.T) {
		tx := models.BankTransaction{
			Amount:            models.NewMoney(-50.00),
			CategoryAccountID: &assetCat,
			AllocationStatus:  "UNLINKED",
		}
		if isTransactionEligibleForExpenseMatching(tx, 0, map[uint]bool{assetCat: true}) {
			t.Error("balance-sheet with no confirmed expenses should not be eligible")
		}
	})

	t.Run("Balance-sheet account with 1 confirmed → eligible", func(t *testing.T) {
		tx := models.BankTransaction{
			Amount:            models.NewMoney(-50.00),
			CategoryAccountID: &assetCat,
			AllocationStatus:  "UNLINKED",
		}
		if !isTransactionEligibleForExpenseMatching(tx, 1, map[uint]bool{assetCat: true}) {
			t.Error("balance-sheet with confirmed expenses should be eligible")
		}
	})

	t.Run("Regular account with balance-sheet ID → eligible", func(t *testing.T) {
		tx := models.BankTransaction{
			Amount:            models.NewMoney(-50.00),
			CategoryAccountID: &officeCat,
			AllocationStatus:  "UNLINKED",
		}
		// officeCat (5010) is NOT a balance-sheet account
		if !isTransactionEligibleForExpenseMatching(tx, 0, map[uint]bool{assetCat: true}) {
			t.Error("non-balance-sheet account should be eligible")
		}
	})
}

// ── isExpenseEligibleForTransactionMatching ─────────────────────────────

func TestIsExpenseEligibleForTransactionMatching(t *testing.T) {
	t.Run("Negative amount → not eligible", func(t *testing.T) {
		exp := models.Expense{Amount: models.NewMoney(-50.00), Tender: "card"}
		if isExpenseEligibleForTransactionMatching(exp) {
			t.Error("negative amount expense should not be eligible")
		}
	})

	t.Run("Zero amount → not eligible", func(t *testing.T) {
		exp := models.Expense{Amount: models.NewMoney(0), Tender: "card"}
		if isExpenseEligibleForTransactionMatching(exp) {
			t.Error("zero amount expense should not be eligible")
		}
	})

	t.Run("Cash tender → not eligible", func(t *testing.T) {
		exp := models.Expense{Amount: models.NewMoney(50.00), Tender: "Cash / Paper"}
		if isExpenseEligibleForTransactionMatching(exp) {
			t.Error("cash tender should not be eligible")
		}
	})

	t.Run("BALANCED status → not eligible", func(t *testing.T) {
		exp := models.Expense{Amount: models.NewMoney(50.00), Tender: "card", AllocationStatus: "BALANCED"}
		if isExpenseEligibleForTransactionMatching(exp) {
			t.Error("balanced expense should not be eligible")
		}
	})

	t.Run("OVER_ALLOCATED status → not eligible", func(t *testing.T) {
		exp := models.Expense{Amount: models.NewMoney(50.00), Tender: "card", AllocationStatus: "OVER_ALLOCATED"}
		if isExpenseEligibleForTransactionMatching(exp) {
			t.Error("over-allocated expense should not be eligible")
		}
	})

	t.Run("IGNORED review status → not eligible", func(t *testing.T) {
		exp := models.Expense{Amount: models.NewMoney(50.00), Tender: "card", ReviewStatus: "IGNORED"}
		if isExpenseEligibleForTransactionMatching(exp) {
			t.Error("ignored expense should not be eligible")
		}
	})

	t.Run("Valid expense → eligible", func(t *testing.T) {
		exp := models.Expense{Amount: models.NewMoney(50.00), Tender: "card", AllocationStatus: "UNLINKED"}
		if !isExpenseEligibleForTransactionMatching(exp) {
			t.Error("valid expense should be eligible")
		}
	})

	t.Run("Deleted expense → not eligible", func(t *testing.T) {
		now := time.Now()
		exp := models.Expense{Amount: models.NewMoney(50.00), Tender: "card"}
		exp.DeletedAt = &now
		if isExpenseEligibleForTransactionMatching(exp) {
			t.Error("deleted expense should not be eligible")
		}
	})
}

// ── mergeCandidateLists ────────────────────────────────────────────────

func TestMergeCandidateLists(t *testing.T) {
	t.Run("No duplicates", func(t *testing.T) {
		persisted := []models.Expense{{ID: 1}, {ID: 2}}
		pool := []models.Expense{{ID: 3}, {ID: 4}}
		combined, ps := mergeCandidateLists(persisted, pool, func(e models.Expense) uint { return e.ID })
		if len(combined) != 4 {
			t.Fatalf("expected 4 combined, got %d", len(combined))
		}
		if len(ps) != 2 {
			t.Fatalf("expected 2 persisted IDs, got %d", len(ps))
		}
		if !ps[1] || !ps[2] {
			t.Error("persisted set should contain IDs 1 and 2")
		}
	})

	t.Run("With duplicates", func(t *testing.T) {
		persisted := []models.Expense{{ID: 1}, {ID: 2}}
		pool := []models.Expense{{ID: 2}, {ID: 3}}
		combined, ps := mergeCandidateLists(persisted, pool, func(e models.Expense) uint { return e.ID })
		if len(combined) != 3 {
			t.Fatalf("expected 3 combined (deduped), got %d", len(combined))
		}
		if len(ps) != 2 {
			t.Fatalf("expected 2 persisted, got %d", len(ps))
		}
	})

	t.Run("Empty lists", func(t *testing.T) {
		combined, ps := mergeCandidateLists([]models.Expense{}, []models.Expense{}, func(e models.Expense) uint { return e.ID })
		if len(combined) != 0 {
			t.Fatalf("expected 0 combined, got %d", len(combined))
		}
		if len(ps) != 0 {
			t.Fatalf("expected 0 persisted, got %d", len(ps))
		}
	})

	t.Run("Only persisted", func(t *testing.T) {
		persisted := []models.Expense{{ID: 1}, {ID: 2}}
		combined, ps := mergeCandidateLists(persisted, []models.Expense{}, func(e models.Expense) uint { return e.ID })
		if len(combined) != 2 || len(ps) != 2 {
			t.Fatalf("expected 2 combined and 2 persisted, got %d/%d", len(combined), len(ps))
		}
	})
}

// ── collectUniqueIDs ───────────────────────────────────────────────────

func TestCollectUniqueIDs(t *testing.T) {
	a := []models.Expense{{ID: 1}, {ID: 2}, {ID: 3}}
	b := []models.Expense{{ID: 2}, {ID: 4}, {ID: 5}}
	ids := collectUniqueIDs(func(e models.Expense) uint { return e.ID }, a, b)
	if len(ids) != 5 {
		t.Fatalf("expected 5 unique IDs, got %d: %v", len(ids), ids)
	}
}

// ── IsReviewStatusInBooks ──────────────────────────────────────────────

func TestIsReviewStatusInBooks(t *testing.T) {
	tests := []struct {
		status string
		want   bool
	}{
		{"", true},
		{"APPROVED", true},
		{"WARNINGS_IGNORED", true},
		{"PENDING", false},
		{"IGNORED", false},
		{"DELETED", false},
		{"UNKNOWN", false},
		{" approved ", false},  // not lowercased by the function
		{"  APPROVED  ", true},  // whitespace trimmed, exact match
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			got := IsReviewStatusInBooks(tt.status)
			if got != tt.want {
				t.Errorf("IsReviewStatusInBooks(%q) = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

// ── IsOpenAllocationStatus ─────────────────────────────────────────────

func TestIsOpenAllocationStatus(t *testing.T) {
	tests := []struct {
		status string
		want   bool
	}{
		{"UNLINKED", true},
		{"PARTIALLY_ALLOCATED", true},
		{"OVER_ALLOCATED", false},
		{"BALANCED", false},
		{"", true}, // empty is considered open
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			got := IsOpenAllocationStatus(tt.status)
			if got != tt.want {
				t.Errorf("IsOpenAllocationStatus(%q) = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

// ── absInt64 & maxInt64 ────────────────────────────────────────────────

func TestAbsInt64AndMaxInt64(t *testing.T) {
	if absInt64(-100) != 100 || absInt64(100) != 100 || absInt64(0) != 0 {
		t.Error("absInt64 failed")
	}
	if maxInt64(100, 50) != 100 || maxInt64(50, 100) != 100 || maxInt64(0, 0) != 0 {
		t.Error("maxInt64 failed")
	}
}

// ── sumExpenseAbsCents & sumTransactionAbsCents ────────────────────────

func TestSumHelpers(t *testing.T) {
	expenses := []models.Expense{
		{Amount: models.NewMoney(50.00)},
		{Amount: models.NewMoney(30.00)},
	}
	if got := sumExpenseAbsCents(expenses); got != 8000 {
		t.Errorf("sumExpenseAbsCents = %d, want 8000", got)
	}
	if got := sumExpenseAbsCents(nil); got != 0 {
		t.Errorf("sumExpenseAbsCents(nil) = %d, want 0", got)
	}
	if got := sumExpenseAbsCents([]models.Expense{}); got != 0 {
		t.Errorf("sumExpenseAbsCents([]) = %d, want 0", got)
	}

	txs := []models.BankTransaction{
		{Amount: models.NewMoney(-50.00)},
		{Amount: models.NewMoney(-30.00)},
	}
	if got := sumTransactionAbsCents(txs); got != 8000 {
		t.Errorf("sumTransactionAbsCents = %d, want 8000", got)
	}
}

// ── pairDaysDistance ───────────────────────────────────────────────────

func TestPairDaysDistance(t *testing.T) {
	base := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)

	if d := pairDaysDistance(base, base); d != 0 {
		t.Errorf("same time = %d, expected 0", d)
	}
	if d := pairDaysDistance(base, base.AddDate(0, 0, 3)); d != 3 {
		t.Errorf("3 days apart = %d, expected 3", d)
	}
	if d := pairDaysDistance(base, time.Time{}); d != 999999 {
		t.Errorf("zero time = %d, expected 999999", d)
	}
	if d := pairDaysDistance(time.Time{}, base); d != 999999 {
		t.Errorf("zero expense time = %d, expected 999999", d)
	}
}

func TestScoreExpenseTxCandidate_SplitAndPartialAllocation(t *testing.T) {
	catSupplies := uint(5010)
	catTravel := uint(5020)
	now := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)

	// 1:N multi-category split: transaction already has confirmed links on another category,
	// so TxHasConfirmedLinks=true with ExpHasConfirmedLinks=false and equal remaining cents must still score.
	splitScore, splitReason := ScoreExpenseTxCandidate(PairScoreContext{
		Expense: models.Expense{
			Vendor:         "Amazon",
			Amount:         models.NewMoney(40.00),
			Timestamp:      now,
			ChartAccountID: &catTravel,
		},
		Transaction: models.BankTransaction{
			Description:       "AMAZON MKTPLACE",
			Amount:            models.NewMoney(-100.00),
			Date:              now,
			CategoryAccountID: &catSupplies,
		},
		ExpRemainingCents:    4000,
		TxRemainingCents:     4000,
		ExpHasConfirmedLinks: false,
		TxHasConfirmedLinks:  true,
	})
	if splitScore <= 0 {
		t.Fatalf("expected positive score for 1:N split candidate, got %d (%q)", splitScore, splitReason)
	}

	// Unsplit mismatched categories (TxHasConfirmedLinks=false) must be rejected with score 0.
	mismatchedUnsplitScore, _ := ScoreExpenseTxCandidate(PairScoreContext{
		Expense:              models.Expense{Amount: models.NewMoney(40.00), Timestamp: now, ChartAccountID: &catTravel},
		Transaction:          models.BankTransaction{Amount: models.NewMoney(-100.00), Date: now, CategoryAccountID: &catSupplies},
		ExpRemainingCents:    4000,
		TxRemainingCents:     4000,
		ExpHasConfirmedLinks: false,
		TxHasConfirmedLinks:  false,
	})
	if mismatchedUnsplitScore != 0 {
		t.Fatalf("expected unsplit mismatched-category pair score 0, got %d", mismatchedUnsplitScore)
	}

	// Partial remaining match ($60 remaining on $100 expense matching -$60 tx) must label
	// "Exact remaining match" rather than misleading "Exact amount match".
	partialScore, partialReason := ScoreExpenseTxCandidate(PairScoreContext{
		Expense: models.Expense{
			Vendor:    "Staples",
			Amount:    models.NewMoney(100.00),
			Timestamp: now,
		},
		Transaction: models.BankTransaction{
			Description: "STAPLES #123",
			Amount:      models.NewMoney(-60.00),
			Date:        now,
		},
		ExpRemainingCents:    6000,
		TxRemainingCents:     6000,
		ExpHasConfirmedLinks: true,
		TxHasConfirmedLinks:  false,
	})
	if partialScore <= 0 {
		t.Fatalf("expected positive score for remaining partial match, got %d", partialScore)
	}
	if partialReason == "" || containsSubstring(partialReason, "Exact amount match") || !containsSubstring(partialReason, "Exact remaining match") {
		t.Fatalf("expected 'Exact remaining match' without 'Exact amount match', got %q", partialReason)
	}
}

func containsSubstring(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
