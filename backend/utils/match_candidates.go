package utils

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
)

// MaxMatchCandidates caps the number of ranked match candidates returned per item.
const MaxMatchCandidates = 8

// Shared SQL review-status filter matching controllers/bookFilters.go.
const InBooksReviewSQL = "(review_status IS NULL OR review_status = '' OR review_status = 'APPROVED' OR review_status = 'WARNINGS_IGNORED')"

// ScoredExpenseCandidate pairs a candidate expense with its computed match score and reasons.
type ScoredExpenseCandidate struct {
	Expense models.Expense `json:"expense"`
	Score   int            `json:"score"`
	Reason  string         `json:"reason"`
}

// ScoredTransactionCandidate pairs a candidate bank transaction with its computed match score and reasons.
type ScoredTransactionCandidate struct {
	Transaction models.BankTransaction `json:"transaction"`
	Score       int                    `json:"score"`
	Reason      string                 `json:"reason"`
}

// PairScoreContext bundles everything needed by ScoreExpenseTxCandidate so candidate
// scoring uses exact integer cents and shared rules in both directions.
type PairScoreContext struct {
	Expense              models.Expense
	Transaction          models.BankTransaction
	ExpRemainingCents    int64
	TxRemainingCents     int64
	ExpHasConfirmedLinks bool
	TxHasConfirmedLinks  bool
	IsPersistedSuggested bool
}

// TransactionMatchInputs supplies preloaded records and relationship sets for pure ranking/filtering tests.
type TransactionMatchInputs struct {
	Target                models.BankTransaction
	ConfirmedExpenses     []models.Expense
	PersistedSuggested    []models.Expense
	PoolExpenses          []models.Expense
	UnlinkedExpenseIDs    map[uint]bool
	ExpenseConfirmedCents map[uint]int64
	ExpenseConfirmedCount map[uint]int
}

// ExpenseMatchInputs supplies preloaded records and relationship sets for pure ranking/filtering tests.
type ExpenseMatchInputs struct {
	Target                models.Expense
	ConfirmedTransactions []models.BankTransaction
	PersistedSuggested    []models.BankTransaction
	PoolTransactions      []models.BankTransaction
	UnlinkedTxIDs         map[uint]bool
	TxConfirmedCents      map[uint]int64
	TxConfirmedCount      map[uint]int
	BalanceSheetAccounts  map[uint]bool
}

type reconcilerMatch struct {
	Tx    *models.BankTransaction
	Score int
	Days  int
}

// IsReviewStatusInBooks reports whether an entity's review status belongs in active accounting books.
func IsReviewStatusInBooks(status string) bool {
	s := strings.TrimSpace(status)
	return s == "" || s == "APPROVED" || s == "WARNINGS_IGNORED"
}

// IsOpenAllocationStatus reports whether an entity still needs or can accept additional allocations.
func IsOpenAllocationStatus(status string) bool {
	return status != "BALANCED" && status != "OVER_ALLOCATED"
}

func absInt64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func sumExpenseAbsCents(expenses []models.Expense) int64 {
	var total int64
	for _, exp := range expenses {
		total += exp.Amount.Abs().Cents
	}
	return total
}

func sumTransactionAbsCents(txs []models.BankTransaction) int64 {
	var total int64
	for _, tx := range txs {
		total += tx.Amount.Abs().Cents
	}
	return total
}

func pairDaysDistance(expTime, txDate time.Time) int {
	if expTime.IsZero() || txDate.IsZero() {
		return 999999
	}
	return daysDifference(expTime, txDate)
}

// mergeCandidateLists combines persisted suggested rows and general open pool items without duplicates,
// tracking which entity IDs came from persisted suggestions.
func mergeCandidateLists[T any](persisted, pool []T, idOf func(T) uint) ([]T, map[uint]bool) {
	persistedSet := make(map[uint]bool, len(persisted))
	seen := make(map[uint]bool, len(persisted)+len(pool))
	combined := make([]T, 0, len(persisted)+len(pool))

	for _, item := range persisted {
		id := idOf(item)
		persistedSet[id] = true
		if !seen[id] {
			seen[id] = true
			combined = append(combined, item)
		}
	}
	for _, item := range pool {
		id := idOf(item)
		if !seen[id] {
			seen[id] = true
			combined = append(combined, item)
		}
	}
	return combined, persistedSet
}

// RankAndCapCandidates sorts items descending by score (using lessTie on equal scores)
// and slices to at most maxResults items when maxResults > 0.
func RankAndCapCandidates[T any](
	items []T,
	scoreOf func(T) int,
	lessTie func(a, b T) bool,
	maxResults int,
) []T {
	sort.SliceStable(items, func(i, j int) bool {
		si, sj := scoreOf(items[i]), scoreOf(items[j])
		if si != sj {
			return si > sj
		}
		if lessTie != nil {
			return lessTie(items[i], items[j])
		}
		return false
	})
	if maxResults > 0 && len(items) > maxResults {
		return items[:maxResults]
	}
	return items
}

// collectReconcilerMatches scores all eligible transactions against expense for Pass 1 auto-reconciliation,
// keeping every match with calculateMatchScore > 0 sorted best-first up to MaxMatchCandidates.
func collectReconcilerMatches(
	expense models.Expense,
	availableTransactions []*models.BankTransaction,
	unlinkedMap map[[2]uint]bool,
) []reconcilerMatch {
	expAbsCents := expense.Amount.Abs().Cents
	var matches []reconcilerMatch

	for _, tx := range availableTransactions {
		if unlinkedMap[[2]uint{expense.ID, tx.ID}] {
			continue
		}

		txRemainingCents := tx.Amount.Abs().Cents - sumExpenseAbsCents(tx.Expenses)
		if txRemainingCents < expAbsCents-1 {
			continue
		}

		score := calculateMatchScore(expense, *tx)
		if score > 0 {
			matches = append(matches, reconcilerMatch{
				Tx:    tx,
				Score: score,
				Days:  pairDaysDistance(expense.Timestamp, tx.Date),
			})
		}
	}

	return RankAndCapCandidates(
		matches,
		func(m reconcilerMatch) int { return m.Score },
		func(a, b reconcilerMatch) bool {
			if a.Days != b.Days {
				return a.Days < b.Days
			}
			return a.Tx.ID < b.Tx.ID
		},
		MaxMatchCandidates,
	)
}

// persistReconcilerSuggestions writes "suggested" rows for all ranked Pass 1 candidate transactions.
func persistReconcilerSuggestions(expenseID uint, matches []reconcilerMatch) {
	for _, m := range matches {
		db.DB.Where("expense_id = ? AND bank_transaction_id = ?", expenseID, m.Tx.ID).
			Delete(&models.ExpenseBankTransaction{})
		db.DB.Create(&models.ExpenseBankTransaction{
			ExpenseID:         expenseID,
			BankTransactionID: m.Tx.ID,
			Status:            "suggested",
		})
	}
}

// isTransactionTargetOrCandidateOpen checks common bank transaction eligibility rules.
func isTransactionEligibleForExpenseMatching(tx models.BankTransaction, confirmedCount int, balanceSheetIDs map[uint]bool) bool {
	if tx.DeletedAt != nil || tx.Amount.Cents >= 0 {
		return false
	}
	if !IsReviewStatusInBooks(tx.ReviewStatus) || !IsOpenAllocationStatus(tx.AllocationStatus) {
		return false
	}
	if confirmedCount == 0 && tx.CategoryAccountID != nil && balanceSheetIDs[*tx.CategoryAccountID] {
		return false
	}
	return true
}

// isExpenseEligibleForTransactionMatching checks common expense eligibility rules.
func isExpenseEligibleForTransactionMatching(exp models.Expense) bool {
	if exp.DeletedAt != nil || exp.Amount.Cents <= 0 {
		return false
	}
	if IsCashTender(exp.Tender) {
		return false
	}
	return IsReviewStatusInBooks(exp.ReviewStatus) && IsOpenAllocationStatus(exp.AllocationStatus)
}

// ScoreExpenseTxCandidate computes a 0-100 confidence score and human-readable reason string
// for pairing an eligible expense and bank transaction using exact integer cents.
func ScoreExpenseTxCandidate(ctx PairScoreContext) (int, string) {
	exp := ctx.Expense
	tx := ctx.Transaction

	// Guard against conflicting COA categories on unsplit pairs; allow multi-category 1:N splits.
	if !ctx.TxHasConfirmedLinks && exp.ChartAccountID != nil && tx.CategoryAccountID != nil {
		if *exp.ChartAccountID != *tx.CategoryAccountID {
			return 0, ""
		}
	}

	expAbsCents := exp.Amount.Abs().Cents
	txAbsCents := tx.Amount.Abs().Cents

	targetExpCents := ctx.ExpRemainingCents
	if targetExpCents <= 0 {
		targetExpCents = expAbsCents
	}
	targetTxCents := ctx.TxRemainingCents
	if targetTxCents <= 0 {
		targetTxCents = txAbsCents
	}

	diffCents := absInt64(targetExpCents - targetTxCents)
	maxTargetCents := maxInt64(targetExpCents, targetTxCents)
	isRemainingComparison := ctx.ExpHasConfirmedLinks || ctx.TxHasConfirmedLinks

	score := 10 // Base score for eligible open counterparty (mirrors invoice candidate ranking)
	var reasons []string

	switch {
	case diffCents == 0 || (!isRemainingComparison && expAbsCents == txAbsCents):
		score += 45
		if isRemainingComparison && diffCents == 0 {
			reasons = append(reasons, "Exact remaining match")
		} else {
			reasons = append(reasons, "Exact amount match")
		}
	case diffCents <= 200:
		score += 30
		reasons = append(reasons, fmt.Sprintf("Within $%.2f", float64(diffCents)/100.0))
	case maxTargetCents > 0 && diffCents*100 <= maxTargetCents*15:
		score += 20
		reasons = append(reasons, "Similar amount")
	case ctx.IsPersistedSuggested && expAbsCents < targetTxCents:
		score += 25
		reasons = append(reasons, "Part of split match")
	case targetExpCents < targetTxCents:
		score += 10
		reasons = append(reasons, "Partial amount fits")
	}

	if vendorMatchesDescription(tx.Description, exp.Vendor) {
		score += 35
		reasons = append(reasons, "Vendor match")
	}

	if !exp.Timestamp.IsZero() && !tx.Date.IsZero() {
		days := daysDifference(exp.Timestamp, tx.Date)
		switch {
		case days == 0:
			score += 15
			reasons = append(reasons, "Same day")
		case days == 1:
			score += 15
			reasons = append(reasons, "Within 1 day")
		case days <= 3:
			score += 10
			reasons = append(reasons, fmt.Sprintf("%d days apart", days))
		case days <= 7:
			score += 5
			reasons = append(reasons, fmt.Sprintf("%d days apart", days))
		case days <= 30:
			score += 3
		}
	}

	if exp.ChartAccountID != nil && tx.CategoryAccountID != nil && *exp.ChartAccountID == *tx.CategoryAccountID {
		score += 5
		reasons = append(reasons, "Same category")
	}

	if ctx.IsPersistedSuggested && len(reasons) == 0 {
		reasons = append(reasons, "Suggested by reconciler")
	}

	if score > 100 {
		score = 100
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "Open unlinked item")
	}

	return score, strings.Join(reasons, ", ")
}

// BuildTransactionExpenseCandidates merges persisted suggestions with open candidate expenses,
// enforces M:N, tombstone, cash, status, and remaining-balance guards, scores them, and returns
// the ranked top-N scored candidates along with the ordered Expense slice.
func BuildTransactionExpenseCandidates(in TransactionMatchInputs) ([]ScoredExpenseCandidate, []models.Expense) {
	tx := in.Target
	if tx.DeletedAt != nil || tx.Amount.Cents >= 0 || !IsReviewStatusInBooks(tx.ReviewStatus) || !IsOpenAllocationStatus(tx.AllocationStatus) {
		return []ScoredExpenseCandidate{}, []models.Expense{}
	}

	txConfirmedCount := len(in.ConfirmedExpenses)
	txRemainingCents := tx.Amount.Abs().Cents - sumExpenseAbsCents(in.ConfirmedExpenses)
	if txRemainingCents <= 0 {
		return []ScoredExpenseCandidate{}, []models.Expense{}
	}

	confirmedIDs := make(map[uint]bool, len(in.ConfirmedExpenses))
	for _, exp := range in.ConfirmedExpenses {
		confirmedIDs[exp.ID] = true
	}

	combined, persistedSet := mergeCandidateLists(
		in.PersistedSuggested,
		in.PoolExpenses,
		func(e models.Expense) uint { return e.ID },
	)

	targetHasConfirmed := txConfirmedCount > 0
	var candidates []ScoredExpenseCandidate

	for _, exp := range combined {
		if confirmedIDs[exp.ID] || (in.UnlinkedExpenseIDs != nil && in.UnlinkedExpenseIDs[exp.ID]) {
			continue
		}
		if !isExpenseEligibleForTransactionMatching(exp) {
			continue
		}

		expConfirmedCount := in.ExpenseConfirmedCount[exp.ID]
		candHasConfirmed := expConfirmedCount > 0
		if targetHasConfirmed && candHasConfirmed {
			continue // Never suggest true N:M links
		}

		expRemainingCents := exp.Amount.Abs().Cents - in.ExpenseConfirmedCents[exp.ID]
		if expRemainingCents <= 0 {
			continue
		}
		// Once a bank transaction already carries confirmed split items, only suggest expenses
		// that fit within its remaining unallocated balance (with $1 rounding leeway).
		if targetHasConfirmed && expRemainingCents > txRemainingCents+100 {
			continue
		}

		score, reason := ScoreExpenseTxCandidate(PairScoreContext{
			Expense:              exp,
			Transaction:          tx,
			ExpRemainingCents:    expRemainingCents,
			TxRemainingCents:     txRemainingCents,
			ExpHasConfirmedLinks: candHasConfirmed,
			TxHasConfirmedLinks:  targetHasConfirmed,
			IsPersistedSuggested: persistedSet[exp.ID],
		})
		if score <= 0 {
			continue
		}

		candidates = append(candidates, ScoredExpenseCandidate{
			Expense: exp,
			Score:   score,
			Reason:  reason,
		})
	}

	candidates = RankAndCapCandidates(
		candidates,
		func(c ScoredExpenseCandidate) int { return c.Score },
		func(a, b ScoredExpenseCandidate) bool {
			pa, pb := persistedSet[a.Expense.ID], persistedSet[b.Expense.ID]
			if pa != pb {
				return pa
			}
			da := pairDaysDistance(a.Expense.Timestamp, tx.Date)
			db := pairDaysDistance(b.Expense.Timestamp, tx.Date)
			if da != db {
				return da < db
			}
			return a.Expense.ID < b.Expense.ID
		},
		MaxMatchCandidates,
	)

	expenses := make([]models.Expense, len(candidates))
	for i, c := range candidates {
		expenses[i] = c.Expense
	}
	return candidates, expenses
}

// BuildExpenseTransactionCandidates merges persisted suggestions with open candidate transactions,
// enforces M:N, tombstone, deposit, balance-sheet, status, and remaining-balance guards, scores them,
// and returns the ranked top-N scored candidates along with the ordered BankTransaction slice.
func BuildExpenseTransactionCandidates(in ExpenseMatchInputs) ([]ScoredTransactionCandidate, []models.BankTransaction) {
	exp := in.Target
	if !isExpenseEligibleForTransactionMatching(exp) {
		return []ScoredTransactionCandidate{}, []models.BankTransaction{}
	}

	expConfirmedCount := len(in.ConfirmedTransactions)
	expRemainingCents := exp.Amount.Abs().Cents - sumTransactionAbsCents(in.ConfirmedTransactions)
	if expRemainingCents <= 0 {
		return []ScoredTransactionCandidate{}, []models.BankTransaction{}
	}

	confirmedIDs := make(map[uint]bool, len(in.ConfirmedTransactions))
	for _, tx := range in.ConfirmedTransactions {
		confirmedIDs[tx.ID] = true
	}

	combined, persistedSet := mergeCandidateLists(
		in.PersistedSuggested,
		in.PoolTransactions,
		func(t models.BankTransaction) uint { return t.ID },
	)

	targetHasConfirmed := expConfirmedCount > 0
	var candidates []ScoredTransactionCandidate

	for _, tx := range combined {
		if confirmedIDs[tx.ID] || (in.UnlinkedTxIDs != nil && in.UnlinkedTxIDs[tx.ID]) {
			continue
		}

		txConfirmedCount := in.TxConfirmedCount[tx.ID]
		if !isTransactionEligibleForExpenseMatching(tx, txConfirmedCount, in.BalanceSheetAccounts) {
			continue
		}

		candHasConfirmed := txConfirmedCount > 0
		if targetHasConfirmed && candHasConfirmed {
			continue // Never suggest true N:M links
		}

		txRemainingCents := tx.Amount.Abs().Cents - in.TxConfirmedCents[tx.ID]
		if txRemainingCents <= 0 {
			continue
		}

		score, reason := ScoreExpenseTxCandidate(PairScoreContext{
			Expense:              exp,
			Transaction:          tx,
			ExpRemainingCents:    expRemainingCents,
			TxRemainingCents:     txRemainingCents,
			ExpHasConfirmedLinks: targetHasConfirmed,
			TxHasConfirmedLinks:  candHasConfirmed,
			IsPersistedSuggested: persistedSet[tx.ID],
		})
		if score <= 0 {
			continue
		}

		candidates = append(candidates, ScoredTransactionCandidate{
			Transaction: tx,
			Score:       score,
			Reason:      reason,
		})
	}

	candidates = RankAndCapCandidates(
		candidates,
		func(c ScoredTransactionCandidate) int { return c.Score },
		func(a, b ScoredTransactionCandidate) bool {
			pa, pb := persistedSet[a.Transaction.ID], persistedSet[b.Transaction.ID]
			if pa != pb {
				return pa
			}
			da := pairDaysDistance(exp.Timestamp, a.Transaction.Date)
			db := pairDaysDistance(exp.Timestamp, b.Transaction.Date)
			if da != db {
				return da < db
			}
			return a.Transaction.ID < b.Transaction.ID
		},
		MaxMatchCandidates,
	)

	txs := make([]models.BankTransaction, len(candidates))
	for i, c := range candidates {
		txs[i] = c.Transaction
	}
	return candidates, txs
}

// FindTransactionMatchCandidates loads persisted suggested expenses and open eligible candidates from DB,
// returning a ranked top-N list for Transaction Details without mutating persisted suggestions.
func FindTransactionMatchCandidates(
	database *gorm.DB,
	tx models.BankTransaction,
	confirmedExpenses []models.Expense,
) ([]ScoredExpenseCandidate, []models.Expense) {
	if database == nil {
		return []ScoredExpenseCandidate{}, []models.Expense{}
	}

	balanceSheetIDs := loadBalanceSheetAccountIDs(database)
	if !isTransactionEligibleForExpenseMatching(tx, len(confirmedExpenses), balanceSheetIDs) {
		return []ScoredExpenseCandidate{}, []models.Expense{}
	}

	var persisted []models.Expense
	database.Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
		Where("ebt.bank_transaction_id = ? AND ebt.status = ?", tx.ID, "suggested").
		Preload("ChartAccount").Preload("Receipts").
		Find(&persisted)

	openExpenseQuery := database.Model(&models.Expense{}).
		Where("deleted_at IS NULL AND "+InBooksReviewSQL+" AND (allocation_status IS NULL OR allocation_status NOT IN ('BALANCED', 'OVER_ALLOCATED')) AND LOWER(COALESCE(tender, '')) NOT IN ('cash', 'cash / paper', 'cash/paper', 'currency', 'paper')").
		Preload("ChartAccount").Preload("Receipts")

	var pool []models.Expense
	openExpenseQuery.Session(&gorm.Session{}).Order("timestamp DESC").Limit(150).Find(&pool)

	// Ensure exact-amount matches aren't missed if the ledger holds >150 open expenses.
	var exactPool []models.Expense
	openExpenseQuery.Session(&gorm.Session{}).Where("amount = ?", tx.Amount.Abs()).Limit(25).Find(&exactPool)
	pool = append(pool, exactPool...)

	var pairLinks []models.ExpenseBankTransaction
	database.Where("bank_transaction_id = ? AND status = ?", tx.ID, "unlinked").Find(&pairLinks)
	unlinkedExpIDs := make(map[uint]bool, len(pairLinks))
	for _, l := range pairLinks {
		unlinkedExpIDs[l.ExpenseID] = true
	}

	allExpIDs := collectUniqueIDs(func(e models.Expense) uint { return e.ID }, persisted, pool)
	expConfirmedCents, expConfirmedCount := batchLoadConfirmedStats(
		database,
		"expense_id",
		allExpIDs,
		func(l models.ExpenseBankTransaction) (uint, uint) { return l.ExpenseID, l.BankTransactionID },
		func(dbConn *gorm.DB, ids []uint) map[uint]int64 {
			return loadAbsCentsByID(
				dbConn,
				ids,
				func(t models.BankTransaction) uint { return t.ID },
				func(t models.BankTransaction) int64 { return t.Amount.Abs().Cents },
			)
		},
	)

	return BuildTransactionExpenseCandidates(TransactionMatchInputs{
		Target:                tx,
		ConfirmedExpenses:     confirmedExpenses,
		PersistedSuggested:    persisted,
		PoolExpenses:          pool,
		UnlinkedExpenseIDs:    unlinkedExpIDs,
		ExpenseConfirmedCents: expConfirmedCents,
		ExpenseConfirmedCount: expConfirmedCount,
	})
}

// FindExpenseMatchCandidates loads persisted suggested transactions and open eligible candidates from DB,
// returning a ranked top-N list for Expense Details without mutating persisted suggestions.
func FindExpenseMatchCandidates(
	database *gorm.DB,
	expense models.Expense,
	confirmedTransactions []models.BankTransaction,
) ([]ScoredTransactionCandidate, []models.BankTransaction) {
	if database == nil {
		return []ScoredTransactionCandidate{}, []models.BankTransaction{}
	}
	if !isExpenseEligibleForTransactionMatching(expense) {
		return []ScoredTransactionCandidate{}, []models.BankTransaction{}
	}

	var persisted []models.BankTransaction
	database.Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = ?", expense.ID, "suggested").
		Preload("ChartAccount").Preload("Category").
		Find(&persisted)

	openTxQuery := database.Model(&models.BankTransaction{}).
		Where("deleted_at IS NULL AND "+InBooksReviewSQL+" AND (allocation_status IS NULL OR allocation_status NOT IN ('BALANCED', 'OVER_ALLOCATED')) AND amount < 0").
		Preload("ChartAccount").Preload("Category")

	var pool []models.BankTransaction
	openTxQuery.Session(&gorm.Session{}).Order("date DESC").Limit(150).Find(&pool)

	// Ensure exact-amount debit matches aren't missed if the ledger holds >150 open debits.
	var exactPool []models.BankTransaction
	openTxQuery.Session(&gorm.Session{}).Where("amount = ?", expense.Amount.Abs().Neg()).Limit(25).Find(&exactPool)
	pool = append(pool, exactPool...)

	var pairLinks []models.ExpenseBankTransaction
	database.Where("expense_id = ? AND status = ?", expense.ID, "unlinked").Find(&pairLinks)
	unlinkedTxIDs := make(map[uint]bool, len(pairLinks))
	for _, l := range pairLinks {
		unlinkedTxIDs[l.BankTransactionID] = true
	}

	allTxIDs := collectUniqueIDs(func(t models.BankTransaction) uint { return t.ID }, persisted, pool)
	txConfirmedCents, txConfirmedCount := batchLoadConfirmedStats(
		database,
		"bank_transaction_id",
		allTxIDs,
		func(l models.ExpenseBankTransaction) (uint, uint) { return l.BankTransactionID, l.ExpenseID },
		func(dbConn *gorm.DB, ids []uint) map[uint]int64 {
			return loadAbsCentsByID(
				dbConn,
				ids,
				func(e models.Expense) uint { return e.ID },
				func(e models.Expense) int64 { return e.Amount.Abs().Cents },
			)
		},
	)
	balanceSheetIDs := loadBalanceSheetAccountIDs(database)

	return BuildExpenseTransactionCandidates(ExpenseMatchInputs{
		Target:                expense,
		ConfirmedTransactions: confirmedTransactions,
		PersistedSuggested:    persisted,
		PoolTransactions:      pool,
		UnlinkedTxIDs:         unlinkedTxIDs,
		TxConfirmedCents:      txConfirmedCents,
		TxConfirmedCount:      txConfirmedCount,
		BalanceSheetAccounts:  balanceSheetIDs,
	})
}

func loadBalanceSheetAccountIDs(database *gorm.DB) map[uint]bool {
	ids := make(map[uint]bool)
	if database == nil {
		return ids
	}
	var accounts []models.ChartAccount
	database.Select("id").Where("type IN ?", []string{"ASSET", "LIABILITY", "EQUITY"}).Find(&accounts)
	for _, acc := range accounts {
		ids[acc.ID] = true
	}
	return ids
}

func collectUniqueIDs[T any](idOf func(T) uint, groups ...[]T) []uint {
	seen := make(map[uint]bool)
	var ids []uint
	for _, group := range groups {
		for _, item := range group {
			id := idOf(item)
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func loadAbsCentsByID[T any](
	database *gorm.DB,
	ids []uint,
	idOf func(T) uint,
	centsOf func(T) int64,
) map[uint]int64 {
	amounts := make(map[uint]int64, len(ids))
	if len(ids) == 0 {
		return amounts
	}
	var rows []T
	database.Select("id, amount").Where("id IN ?", ids).Find(&rows)
	for _, row := range rows {
		amounts[idOf(row)] = centsOf(row)
	}
	return amounts
}

func batchLoadConfirmedStats(
	database *gorm.DB,
	filterCol string,
	targetIDs []uint,
	extractPair func(models.ExpenseBankTransaction) (targetID, counterpartyID uint),
	loadAmounts func(*gorm.DB, []uint) map[uint]int64,
) (map[uint]int64, map[uint]int) {
	centsByTarget := make(map[uint]int64)
	countByTarget := make(map[uint]int)
	if len(targetIDs) == 0 {
		return centsByTarget, countByTarget
	}

	var links []models.ExpenseBankTransaction
	database.Where(filterCol+" IN ? AND status = ?", targetIDs, "confirmed").Find(&links)
	if len(links) == 0 {
		return centsByTarget, countByTarget
	}

	counterSet := make(map[uint]bool, len(links))
	var counterIDs []uint
	for _, l := range links {
		_, cid := extractPair(l)
		if !counterSet[cid] {
			counterSet[cid] = true
			counterIDs = append(counterIDs, cid)
		}
	}

	amountByCounter := loadAmounts(database, counterIDs)
	for _, l := range links {
		tid, cid := extractPair(l)
		countByTarget[tid]++
		centsByTarget[tid] += amountByCounter[cid]
	}
	return centsByTarget, countByTarget
}
