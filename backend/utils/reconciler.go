package utils

import (
	"math"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"
	"regexp"
	"strings"
	"sync"
	"time"
)

var reconciliationMutex sync.Mutex

// RunReconciliation links expenses to bank transactions.
// pass 1: exact 1-to-1 matches
// pass 2: recursive subset-sum for split expenses
// pass 3: recalculates status flags
func RunReconciliation() {
	reconciliationMutex.Lock()
	defer reconciliationMutex.Unlock()

	defer func() {
		if r := recover(); r != nil {
			// Catch panic to prevent full app crash
			println("PANIC in RunReconciliation:", r)
		}
	}()

	// Fetch all Expenses that have no confirmed row in the join table.
	// Previously this was "bank_transaction_id IS NULL" — now we check the join table
	// directly, since the FK field no longer exists on the Expense struct.
	var unlinkedExpenses []models.Expense
	// PENDING (closed-period review) and IGNORED (excluded) items never participate in matching.
	db.DB.Where("id NOT IN (?)",
		db.DB.Table("expense_bank_transactions").Select("expense_id").Where("status = ?", "confirmed"),
	).Where("review_status IS NULL OR review_status = '' OR review_status IN (?, ?)", "APPROVED", "WARNINGS_IGNORED").Find(&unlinkedExpenses)

	// Fetch all BankTransactions, then manually load each one's confirmed expenses.
	// We can't use Preload("Expenses") without a status condition here, because that
	// would include suggested links and inflate the sum used for match-checking.
	var allTransactions []models.BankTransaction
	db.DB.Where("review_status IS NULL OR review_status = '' OR review_status IN (?, ?)", "APPROVED", "WARNINGS_IGNORED").Find(&allTransactions)
	for i := range allTransactions {
		db.DB.
			Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
			Where("ebt.bank_transaction_id = ? AND ebt.status = ?", allTransactions[i].ID, "confirmed").
			Find(&allTransactions[i].Expenses)
	}

	// Only consider transactions that are not already fully reconciled and are NOT deposits.
	var availableTransactions []*models.BankTransaction
	for i := range allTransactions {
		tx := &allTransactions[i]
		if tx.Amount > 0 {
			continue
		}
		sum := calculateExpenseSum(tx.Expenses)
		if tx.AllocationStatus == "" || tx.AllocationStatus != "BALANCED" || math.Abs(sum-math.Abs(tx.Amount)) > 0.01 {
			availableTransactions = append(availableTransactions, tx)
		}
	}

	// Track expenses confirmed during this pass so we don't attempt to re-match them.
	confirmedInPass1 := map[uint]bool{}

	// pass 1: direct matches
	for i := range unlinkedExpenses {
		expense := &unlinkedExpenses[i]

		// Skip cash expenses — cash tender never appears on bank statements
		if IsCashTender(expense.Tender) {
			continue
		}

		// Skip if this expense was already confirmed earlier in this same loop.
		if confirmedInPass1[expense.ID] {
			continue
		}

		bestScore := 0
		var bestMatch *models.BankTransaction

		for _, tx := range availableTransactions {
			remaining := math.Abs(tx.Amount) - calculateExpenseSum(tx.Expenses)
			if remaining < expense.Amount-0.01 {
				continue
			}
			score := calculateMatchScore(*expense, *tx)
			if score > bestScore {
				bestScore = score
				bestMatch = tx
			}
		}

		// If we found a confident exact-amount match, link them.
		if bestScore >= 80 && bestMatch != nil {
			// Delete first in case a "suggested" row for this pair already exists,
			// so we don't hit the composite PK constraint on insert.
			db.DB.Where("expense_id = ? AND bank_transaction_id = ?", expense.ID, bestMatch.ID).
				Delete(&models.ExpenseBankTransaction{})
			db.DB.Create(&models.ExpenseBankTransaction{
				ExpenseID:         expense.ID,
				BankTransactionID: bestMatch.ID,
				Status:            "confirmed",
			})

			// Mark in-memory so we don't re-process this expense, and update
			// the in-memory Expenses slice so availability checks stay accurate.
			confirmedInPass1[expense.ID] = true
			bestMatch.Expenses = append(bestMatch.Expenses, *expense)

			// If bank transaction has no category and expense does, sync category to transaction
			if bestMatch.CategoryAccountID == nil && expense.ChartAccountID != nil {
				bestMatch.CategoryAccountID = expense.ChartAccountID
				db.DB.Model(&models.BankTransaction{}).Where("id = ?", bestMatch.ID).Update("category_account_id", expense.ChartAccountID)
			}

		} else if bestScore > 0 && bestMatch != nil {
			// Not confident enough for a hard link — write a suggested row instead.
			// Same delete-first pattern to avoid PK conflicts.
			db.DB.Where("expense_id = ? AND bank_transaction_id = ?", expense.ID, bestMatch.ID).
				Delete(&models.ExpenseBankTransaction{})
			db.DB.Create(&models.ExpenseBankTransaction{
				ExpenseID:         expense.ID,
				BankTransactionID: bestMatch.ID,
				Status:            "suggested",
			})
		}
	}

	// Re-fetch remaining unconfirmed expenses for Pass 2 (since Pass 1 linked some).
	var remainingExpenses []models.Expense
	db.DB.Where("id NOT IN (?)",
		db.DB.Table("expense_bank_transactions").Select("expense_id").Where("status = ?", "confirmed"),
	).Where("review_status IS NULL OR review_status = '' OR review_status = ?", "APPROVED").Find(&remainingExpenses)

	// Track expenses claimed in Pass 2 to prevent double-use across transactions.
	claimedInPass2 := map[uint]bool{}

	// pass 2: split transaction matches
	// find combinations of same-day expenses that equal the tx amount
	for _, tx := range availableTransactions {
		sum := calculateExpenseSum(tx.Expenses)
		targetAmount := math.Abs(tx.Amount)
		remainingAmountNeeded := targetAmount - sum

		if remainingAmountNeeded <= 0.01 {
			continue // It's already balanced or over-allocated
		}

		// Find all remaining unclaimed expenses on the exact same day.
		var sameDayExpenses []models.Expense
		for _, e := range remainingExpenses {
			if IsCashTender(e.Tender) {
				continue
			}
			if !claimedInPass2[e.ID] && daysDifference(e.Timestamp, tx.Date) == 0 {
				if e.ChartAccountID != nil && tx.CategoryAccountID != nil {
					if *e.ChartAccountID != *tx.CategoryAccountID {
						continue
					}
				}
				sameDayExpenses = append(sameDayExpenses, e)
			}
		}

		// Check if any combination of these same-day expenses adds up exactly to the remaining amount.
		matches := findSubsetSum(sameDayExpenses, remainingAmountNeeded)
		if len(matches) > 0 {
			for _, m := range matches {
				// Delete-then-create, same pattern as Pass 1.
				db.DB.Where("expense_id = ? AND bank_transaction_id = ?", m.ID, tx.ID).
					Delete(&models.ExpenseBankTransaction{})
				db.DB.Create(&models.ExpenseBankTransaction{
					ExpenseID:         m.ID,
					BankTransactionID: tx.ID,
					Status:            "suggested",
				})
				// Mark as claimed so we don't assign this expense to the next tx.
				claimedInPass2[m.ID] = true
			}
		}
	}

	// pass 3: calc allocation status
	UpdateAllocationStatuses()
	events.Broadcast("RECONCILIATION_UPDATED", nil)
	events.Broadcast("QUEUE_UPDATED", nil)
}

// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------

func calculateExpenseSum(expenses []models.Expense) float64 {
	sum := 0.0
	for _, e := range expenses {
		sum += e.Amount
	}
	return sum
}

// toCents normalizes floating-point currency to integer cents to prevent IEEE-754 precision issues.
func toCents(amount float64) int64 {
	return int64(math.Round(amount * 100))
}

func daysDifference(date1, date2 time.Time) int {
	d1 := time.Date(date1.Year(), date1.Month(), date1.Day(), 0, 0, 0, 0, date1.Location())
	d2 := time.Date(date2.Year(), date2.Month(), date2.Day(), 0, 0, 0, 0, date2.Location())
	return int(math.Abs(d2.Sub(d1).Hours() / 24))
}

// UpdateAllocationStatuses verifies tx amount equals sum of attached confirmed expenses.
// Positive-amount transactions (deposits/income) are auto-balanced since they need no receipt.
func UpdateAllocationStatuses() {
	// First, prune any suggested links that touch balanced/confirmed items or cash expenses
	db.DB.Exec(`
		DELETE FROM expense_bank_transactions 
		WHERE status = 'suggested' 
		  AND (
		    expense_id IN (SELECT id FROM expenses WHERE allocation_status = 'BALANCED' OR LOWER(tender) = 'cash' OR LOWER(tender) = 'cash / paper')
		    OR bank_transaction_id IN (SELECT id FROM bank_transactions WHERE allocation_status = 'BALANCED' OR amount > 0)
		  )
	`)

	var transactions []models.BankTransaction
	db.DB.Where("COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')").Find(&transactions)

	for i := range transactions {
		tx := &transactions[i]

		// Load only confirmed expenses for this transaction via a direct join.
		db.DB.
			Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
			Where("ebt.bank_transaction_id = ? AND ebt.status = ?", tx.ID, "confirmed").
			Find(&tx.Expenses)

		var status string
		var hasSuggestions bool

		// Deposits (positive amounts) auto-balance — no expense receipt required
		if tx.Amount > 0 {
			status = "BALANCED"
		} else {
			txAmt := math.Abs(tx.Amount)
			expCount := len(tx.Expenses)

			if expCount == 0 {
				status = "UNLINKED"
				var count int64
				db.DB.Model(&models.ExpenseBankTransaction{}).
					Where("bank_transaction_id = ? AND status = ?", tx.ID, "suggested").
					Count(&count)
				if count > 0 {
					hasSuggestions = true
				}
			} else if expCount > 1 {
				// 1:N split: 1 bank transaction split across multiple expenses
				sum := calculateExpenseSum(tx.Expenses)
				diffCents := toCents(txAmt) - toCents(sum)
				if diffCents == 0 {
					status = "BALANCED"
				} else if diffCents > 0 {
					status = "PARTIALLY_ALLOCATED"
				} else {
					status = "OVER_ALLOCATED"
				}
			} else {
				// expCount == 1: Exactly 1 linked expense
				singleExp := tx.Expenses[0]

				// Check if this expense is linked to multiple bank transactions (N:1 split payment)
				var otherTxCount int64
				db.DB.Model(&models.ExpenseBankTransaction{}).
					Where("expense_id = ? AND status = 'confirmed'", singleExp.ID).
					Count(&otherTxCount)

				if otherTxCount > 1 {
					// N:1 split: multiple bank transactions paying for 1 expense
					var sumOtherTx float64
					db.DB.Model(&models.BankTransaction{}).
						Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
						Where("ebt.expense_id = ? AND ebt.status = 'confirmed' AND COALESCE(bank_transactions.review_status, '') NOT IN ('IGNORED', 'DELETED')", singleExp.ID).
						Select("COALESCE(SUM(ABS(bank_transactions.amount)), 0)").Scan(&sumOtherTx)

					if toCents(sumOtherTx) > toCents(singleExp.Amount) {
						status = "OVER_ALLOCATED"
					} else {
						status = "BALANCED"
					}
				} else {
					// 1:1 match or partial
					diffCents := toCents(txAmt) - toCents(singleExp.Amount)
					if diffCents == 0 {
						status = "BALANCED"
					} else if diffCents > 0 {
						status = "PARTIALLY_ALLOCATED"
					} else {
						// txAmt < singleExp.Amount: transaction is fully absorbed by the larger expense
						status = "BALANCED"
					}
				}
			}
		}

		if status == "BALANCED" {
			db.DB.Where("bank_transaction_id = ? AND status = ?", tx.ID, "suggested").Delete(&models.ExpenseBankTransaction{})
			hasSuggestions = false
		}

		if tx.AllocationStatus != status || tx.HasSuggestions != hasSuggestions {
			tx.AllocationStatus = status
			tx.HasSuggestions = hasSuggestions
			db.DB.Model(&models.BankTransaction{}).Where("id = ?", tx.ID).Updates(map[string]interface{}{
				"allocation_status": status,
				"has_suggestions":   hasSuggestions,
			})
		}
	}

	var expenses []models.Expense
	db.DB.Where("COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')").Find(&expenses)
	for i := range expenses {
		exp := &expenses[i]

		var countConfirmed, countSuggested int64
		db.DB.Model(&models.ExpenseBankTransaction{}).
			Where("expense_id = ? AND status = ?", exp.ID, "confirmed").Count(&countConfirmed)

		db.DB.Model(&models.ExpenseBankTransaction{}).
			Where("expense_id = ? AND status = ?", exp.ID, "suggested").Count(&countSuggested)

		status := "UNLINKED"
		hasSuggestions := false

		// Cash expenses need no bank transaction to be balanced
		if IsCashTender(exp.Tender) && countConfirmed == 0 {
			status = "BALANCED"
		} else if countConfirmed == 0 {
			if countSuggested > 0 {
				hasSuggestions = true
			}
		} else if countConfirmed > 1 {
			// N:1 split: multiple bank transactions funding this single expense
			var sumTx float64
			db.DB.Model(&models.BankTransaction{}).
				Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
				Where("ebt.expense_id = ? AND ebt.status = 'confirmed' AND COALESCE(bank_transactions.review_status, '') NOT IN ('IGNORED', 'DELETED')", exp.ID).
				Select("COALESCE(SUM(ABS(bank_transactions.amount)), 0)").Scan(&sumTx)

			diffCents := toCents(exp.Amount) - toCents(sumTx)
			if diffCents == 0 {
				status = "BALANCED"
			} else if diffCents > 0 {
				status = "PARTIALLY_ALLOCATED"
			} else {
				status = "OVER_ALLOCATED"
			}
		} else {
			// countConfirmed == 1: Expense linked to exactly 1 bank transaction
			var link models.ExpenseBankTransaction
			db.DB.Where("expense_id = ? AND status = 'confirmed'", exp.ID).First(&link)

			var tx models.BankTransaction
			if err := db.DB.First(&tx, link.BankTransactionID).Error; err == nil {
				txAmt := math.Abs(tx.Amount)

				// Total confirmed expenses linked to this bank transaction
				var sumExp float64
				db.DB.Model(&models.Expense{}).
					Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
					Where("ebt.bank_transaction_id = ? AND ebt.status = 'confirmed' AND COALESCE(expenses.review_status, '') NOT IN ('IGNORED', 'DELETED')", tx.ID).
					Select("COALESCE(SUM(expenses.amount), 0)").Scan(&sumExp)

				if toCents(exp.Amount) > toCents(txAmt) {
					// Expense is larger than the single bank transaction linked to it
					status = "PARTIALLY_ALLOCATED"
				} else if toCents(sumExp) > toCents(txAmt) {
					// Multiple expenses linked to this transaction exceed its amount
					status = "OVER_ALLOCATED"
				} else {
					// Fully covered by the bank transaction
					status = "BALANCED"
				}
			}
		}

		if status == "BALANCED" {
			db.DB.Where("expense_id = ? AND status = ?", exp.ID, "suggested").Delete(&models.ExpenseBankTransaction{})
			hasSuggestions = false
		}

		if exp.AllocationStatus != status || exp.HasSuggestions != hasSuggestions {
			exp.AllocationStatus = status
			exp.HasSuggestions = hasSuggestions
			db.DB.Model(&models.Expense{}).Where("id = ?", exp.ID).Updates(map[string]interface{}{
				"allocation_status": status,
				"has_suggestions":   hasSuggestions,
			})
		}
	}
}

// Backward-compatible alias
func UpdateReconciliationStatuses() {
	UpdateAllocationStatuses()
}

// findSubsetSum explores combinations of expenses to find a subset that equals the target amount.
func findSubsetSum(expenses []models.Expense, target float64) []models.Expense {
	if len(expenses) == 0 {
		return nil
	}

	targetInt := int(math.Round(target * 100))
	if targetInt <= 0 {
		return nil
	}

	// DP array size limit: 50,000,000 cents ($500,000.00).
	// If the transaction amount is > $500k, DP array would consume too much memory (>400MB), 
	// so we fall back to a safely capped DFS.
	if targetInt > 50000000 {
		return findSubsetSumDFS(expenses, target)
	}

	// dp[sum] stores the index of the expense that reached this sum.
	// -1 means unreachable. -2 is the base case for sum 0.
	dp := make([]int, targetInt+1)
	for i := range dp {
		dp[i] = -1
	}
	dp[0] = -2

	for expIdx, exp := range expenses {
		expInt := int(math.Round(exp.Amount * 100))
		if expInt <= 0 {
			continue
		}

		// Traverse backwards so we don't reuse the same expense multiple times
		for sum := targetInt; sum >= expInt; sum-- {
			if dp[sum-expInt] != -1 && dp[sum] == -1 {
				dp[sum] = expIdx
			}
		}

		// Early exit if we found a match
		if dp[targetInt] != -1 {
			break
		}
	}

	if dp[targetInt] == -1 {
		return nil
	}

	// Backtrack to build the result
	var result []models.Expense
	curr := targetInt
	for curr > 0 {
		idx := dp[curr]
		result = append(result, expenses[idx])
		curr -= int(math.Round(expenses[idx].Amount * 100))
	}
	return result
}

// Fallback to DFS with a hard cap for absurdly massive transaction amounts (>$500k)
func findSubsetSumDFS(expenses []models.Expense, target float64) []models.Expense {
	if len(expenses) > 15 {
		expenses = expenses[:15]
	}

	// Calculate suffix sums for pruning
	suffixSum := make([]float64, len(expenses))
	sum := 0.0
	for i := len(expenses) - 1; i >= 0; i-- {
		sum += expenses[i].Amount
		suffixSum[i] = sum
	}

	var bestMask uint64 = 0
	found := false

	var search func(index int, currentSum float64, currentMask uint64) bool
	search = func(index int, currentSum float64, currentMask uint64) bool {
		// 1. Base case: Check if we hit the target
		if math.Abs(currentSum-target) < 0.01 && currentMask > 0 {
			bestMask = currentMask
			found = true
			return true
		}

		// 2. Pruning rules
		if index >= len(expenses) {
			return false
		}
		if currentSum-0.01 > target { // Exceeded target (expenses are always positive)
			return false
		}
		if currentSum+suffixSum[index]+0.01 < target { // Even taking all remaining won't reach target
			return false
		}

		// 3. Try WITH the current expense
		if search(index+1, currentSum+expenses[index].Amount, currentMask|(1<<index)) {
			return true
		}

		// 4. Try WITHOUT the current expense
		if search(index+1, currentSum, currentMask) {
			return true
		}

		return false
	}

	search(0, 0, 0)

	var result []models.Expense
	if found {
		for i := 0; i < len(expenses); i++ {
			if (bestMask & (1 << i)) != 0 {
				result = append(result, expenses[i])
			}
		}
	}
	return result
}

func calculateMatchScore(expense models.Expense, bankTx models.BankTransaction) int {
	// Guard against conflicting categories
	if expense.ChartAccountID != nil && bankTx.CategoryAccountID != nil {
		if *expense.ChartAccountID != *bankTx.CategoryAccountID {
			return 0
		}
	}

	score := 0

	// A. Exact Amount (+50)
	// Normalized integer cents comparison
	if toCents(expense.Amount) == toCents(math.Abs(bankTx.Amount)) {
		score += 50
	}

	// B. Date Window
	// Same calendar day = +30
	// 1 calendar day apart = +20
	// 2-4 calendar days apart = +30

	daysDiff := daysDifference(expense.Timestamp, bankTx.Date)

	switch {
	case daysDiff == 0:
		score += 30
	case daysDiff == 1:
		score += 20
	case daysDiff >= 2 && daysDiff <= 4:
		score += 10
	}

	// C. String Similarity (+20)
	if vendorMatchesDescription(bankTx.Description, expense.Vendor) {
		score += 20
	}

	return score
}

// Strips special characters while removing apostrophes without inserting spaces (e.g. McDonald's -> mcdonalds)
func normalizeString(s string) string {
	var nonAlphaNum = regexp.MustCompile(`[^a-zA-Z0-9]+`)

	cleaned := strings.ReplaceAll(s, "'", "")
	cleaned = strings.ReplaceAll(cleaned, "’", "")
	return strings.ToLower(
		strings.TrimSpace(
			nonAlphaNum.ReplaceAllString(cleaned, " "),
		),
	)
}

func vendorMatchesDescription(description, vendor string) bool {
	description = normalizeString(description)
	vendor = normalizeString(vendor)

	if description == "" || vendor == "" {
		return false
	}

	// Just check if the full normalized vendor name is inside the description
	return strings.Contains(description, vendor)
}
