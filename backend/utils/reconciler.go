package utils

import (
	"math"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"regexp"
	"strings"
	"time"
)

// RunReconciliation links expenses to bank transactions.
// pass 1: exact 1-to-1 matches
// pass 2: recursive subset-sum for split expenses
// pass 3: recalculates status flags
func RunReconciliation() {
	// Fetch all Expenses that have no confirmed row in the join table.
	// Previously this was "bank_transaction_id IS NULL" — now we check the join table
	// directly, since the FK field no longer exists on the Expense struct.
	var unmatchedExpenses []models.Expense
	db.DB.Where("id NOT IN (?)",
		db.DB.Table("expense_bank_transactions").Select("expense_id").Where("status = ?", "confirmed"),
	).Find(&unmatchedExpenses)

	// Fetch all BankTransactions, then manually load each one's confirmed expenses.
	// We can't use Preload("Expenses") without a status condition here, because that
	// would include suggested links and inflate the sum used for match-checking.
	var allTransactions []models.BankTransaction
	db.DB.Find(&allTransactions)
	for i := range allTransactions {
		db.DB.
			Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
			Where("ebt.bank_transaction_id = ? AND ebt.status = ?", allTransactions[i].ID, "confirmed").
			Find(&allTransactions[i].Expenses)
	}

	// Only consider transactions that are not already fully reconciled.
	var availableTransactions []*models.BankTransaction
	for i := range allTransactions {
		tx := &allTransactions[i]
		sum := calculateExpenseSum(tx.Expenses)
		if tx.ReconciliationStatus == "" || math.Abs(sum-math.Abs(tx.Amount)) > 0.01 {
			availableTransactions = append(availableTransactions, tx)
		}
	}

	// Track expenses confirmed during this pass so we don't attempt to re-match them.
	confirmedInPass1 := map[uint]bool{}

	// pass 1: direct matches
	for i := range unmatchedExpenses {
		expense := &unmatchedExpenses[i]

		// Skip if this expense was already confirmed earlier in this same loop.
		if confirmedInPass1[expense.ID] {
			continue
		}

		bestScore := 0
		var bestMatch *models.BankTransaction

		for _, tx := range availableTransactions {
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
	).Find(&remainingExpenses)

	// Track expenses claimed in Pass 2 to prevent double-use across transactions.
	claimedInPass2 := map[uint]bool{}

	// pass 2: split transaction matches
	// find combinations of same-day expenses that equal the tx amount
	for _, tx := range availableTransactions {
		sum := calculateExpenseSum(tx.Expenses)
		targetAmount := math.Abs(tx.Amount)
		remainingAmountNeeded := targetAmount - sum

		if remainingAmountNeeded <= 0.01 {
			continue // It's already matched or overmatched
		}

		// Find all remaining unclaimed expenses on the exact same day.
		var sameDayExpenses []models.Expense
		for _, e := range remainingExpenses {
			if !claimedInPass2[e.ID] && daysDifference(e.Timestamp, tx.Date) == 0 {
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
					Status:            "confirmed",
				})
				// Mark as claimed so we don't assign this expense to the next tx.
				claimedInPass2[m.ID] = true
			}
		}
	}

	// pass 3: calc reconciliation status
	UpdateReconciliationStatuses()
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

func daysDifference(date1, date2 time.Time) int {
	d1 := time.Date(date1.Year(), date1.Month(), date1.Day(), 0, 0, 0, 0, date1.Location())
	d2 := time.Date(date2.Year(), date2.Month(), date2.Day(), 0, 0, 0, 0, date2.Location())
	return int(math.Abs(d2.Sub(d1).Hours() / 24))
}

// UpdateReconciliationStatuses verifies tx amount equals sum of attached confirmed expenses.
// Positive-amount transactions (deposits/income) are auto-matched since they need no receipt.
func UpdateReconciliationStatuses() {
	var transactions []models.BankTransaction
	db.DB.Find(&transactions)

	for i := range transactions {
		tx := &transactions[i]

		// Load only confirmed expenses for this transaction via a direct join.
		db.DB.
			Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
			Where("ebt.bank_transaction_id = ? AND ebt.status = ?", tx.ID, "confirmed").
			Find(&tx.Expenses)

		if tx.ReconciliationStatus == "PENDING_CLOSED" {
			continue // Do not update PENDING_CLOSED items until month is reopened
		}

		var status string
		var hasSuggestions bool

		// Deposits (positive amounts) auto-match — no expense receipt required
		if tx.Amount > 0 {
			status = "MATCHED"
		} else {
			sum := calculateExpenseSum(tx.Expenses)
			status = "UNMATCHED"
			if len(tx.Expenses) > 0 {
				diff := math.Abs(tx.Amount) - sum
				if math.Abs(diff) < 0.01 {
					status = "MATCHED"
				}
			}

			if status == "UNMATCHED" {
				var count int64
				db.DB.Model(&models.ExpenseBankTransaction{}).
					Where("bank_transaction_id = ? AND status = ?", tx.ID, "suggested").
					Count(&count)
				if count > 0 {
					hasSuggestions = true
				}
			}
		}

		if tx.ReconciliationStatus != status || tx.HasSuggestions != hasSuggestions {
			tx.ReconciliationStatus = status
			tx.HasSuggestions = hasSuggestions
			db.DB.Save(tx)
		}

		if status == "MATCHED" {
			db.DB.Where("bank_transaction_id = ? AND status = ?", tx.ID, "suggested").Delete(&models.ExpenseBankTransaction{})
		}
	}

	var expenses []models.Expense
	db.DB.Find(&expenses)
	for i := range expenses {
		exp := &expenses[i]

		if exp.Status == "PENDING_CLOSED" {
			continue
		}

		var countConfirmed, countSuggested int64
		db.DB.Model(&models.ExpenseBankTransaction{}).
			Where("expense_id = ? AND status = ?", exp.ID, "confirmed").Count(&countConfirmed)

		db.DB.Model(&models.ExpenseBankTransaction{}).
			Where("expense_id = ? AND status = ?", exp.ID, "suggested").Count(&countSuggested)

		status := "UNMATCHED"
		hasSuggestions := false
		if countConfirmed > 0 {
			status = "MATCHED"
		} else if countSuggested > 0 {
			hasSuggestions = true
		}

		if exp.ReconciliationStatus != status || exp.HasSuggestions != hasSuggestions {
			exp.ReconciliationStatus = status
			exp.HasSuggestions = hasSuggestions
			db.DB.Save(exp)
		}

		if status == "MATCHED" {
			db.DB.Where("expense_id = ? AND status = ?", exp.ID, "suggested").Delete(&models.ExpenseBankTransaction{})
		}
	}
}

// findSubsetSum explores combinations of expenses to find a subset that equals the target amount.
func findSubsetSum(expenses []models.Expense, target float64) []models.Expense {
	var bestSubset []models.Expense

	var search func(index int, currentSum float64, currentSubset []models.Expense) bool
	search = func(index int, currentSum float64, currentSubset []models.Expense) bool {
		// Base case: check if we hit the target
		if math.Abs(currentSum-target) < 0.01 && len(currentSubset) > 0 {
			bestSubset = append([]models.Expense{}, currentSubset...)
			return true
		}

		// If we reached the end of the array, stop
		if index >= len(expenses) {
			return false
		}

		// 1. Try WITH the current expense
		if search(index+1, currentSum+expenses[index].Amount, append(currentSubset, expenses[index])) {
			return true
		}

		// 2. Try WITHOUT the current expense
		if search(index+1, currentSum, currentSubset) {
			return true
		}

		return false
	}

	search(0, 0, []models.Expense{})
	return bestSubset
}

func calculateMatchScore(expense models.Expense, bankTx models.BankTransaction) int {
	score := 0

	// A. Exact Amount (+50)
	// Be careful with float comparison! It's usually safer to compare differences less than 0.01
	if math.Abs(expense.Amount-math.Abs(bankTx.Amount)) < 0.01 {
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

// Strips special characters
func normalizeString(s string) string {
	var nonAlphaNum = regexp.MustCompile(`[^a-zA-Z0-9]+`)

	return strings.ToLower(
		strings.TrimSpace(
			nonAlphaNum.ReplaceAllString(s, " "),
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
