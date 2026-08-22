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
	// 1. Fetch all Expenses that have NO associated BankTransaction
	var unmatchedExpenses []models.Expense
	db.DB.Where("bank_transaction_id IS NULL").Find(&unmatchedExpenses)

	// 3. Fetch all BankTransactions
	var allTransactions []models.BankTransaction
	db.DB.Preload("Expenses").Find(&allTransactions)

	// We only want to try matching against transactions that are NOT already fully matched
	// (So we filter for UNMATCHED)
	var availableTransactions []*models.BankTransaction
	for i := range allTransactions {
		tx := &allTransactions[i]
		sum := calculateExpenseSum(tx.Expenses)
		// We use 0.01 for safe float comparison
		if tx.ReconciliationStatus == "" || math.Abs(sum-tx.Amount) > 0.01 {
			availableTransactions = append(availableTransactions, tx)
		}
	}

	// pass 1: direct matches
	for i := range unmatchedExpenses {
		expense := &unmatchedExpenses[i]
		// Skip if it got matched during the loop
		if expense.BankTransactionID != nil {
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

		// If we found a confident exact-amount match, link them!
		if bestScore >= 80 && bestMatch != nil {
			expense.BankTransactionID = &bestMatch.ID
			expense.SuggestedTransactionID = nil // clear suggestion
			bestMatch.SuggestedExpenseID = nil
			bestMatch.Expenses = append(bestMatch.Expenses, *expense)

			// Update expense and tx in DB (Omit associations to prevent GORM duplicating expenses)
			db.DB.Omit("Receipts").Save(expense)
			db.DB.Omit("Expenses").Save(bestMatch)
		} else if bestScore > 0 && bestMatch != nil {
			// Not confident enough for a hard link, but we have a best guess (Soft Link)
			expense.SuggestedTransactionID = &bestMatch.ID
			bestMatch.SuggestedExpenseID = &expense.ID

			db.DB.Omit("Receipts").Save(expense)
			db.DB.Omit("Expenses").Save(bestMatch)
		}
	}

	// Re-fetch unmatched expenses for Pass 2 (since Pass 1 linked some)
	var remainingExpenses []models.Expense
	db.DB.Where("bank_transaction_id IS NULL").Find(&remainingExpenses)

	// pass 2: split transaction matches
	// find combinations of same-day expenses that equal the tx amount
	for _, tx := range availableTransactions {
		sum := calculateExpenseSum(tx.Expenses)
		targetAmount := math.Abs(tx.Amount)
		remainingAmountNeeded := targetAmount - sum

		if remainingAmountNeeded <= 0.01 {
			continue // It's already matched or overmatched
		}

		// Find all remaining expenses on the exact same day
		var sameDayExpenses []models.Expense
		for _, e := range remainingExpenses {
			if e.BankTransactionID == nil && daysDifference(e.Timestamp, tx.Date) == 0 {
				sameDayExpenses = append(sameDayExpenses, e)
			}
		}

		// Check if any combination of these same-day expenses adds up exactly to the remaining amount
		matches := findSubsetSum(sameDayExpenses, remainingAmountNeeded)
		if len(matches) > 0 {
			for _, m := range matches {
				m.BankTransactionID = &tx.ID
				db.DB.Save(&m)

				// Mark as claimed so we don't use it for the next tx
				for k := range remainingExpenses {
					if remainingExpenses[k].ID == m.ID {
						remainingExpenses[k].BankTransactionID = &tx.ID
					}
				}
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

// UpdateReconciliationStatuses verifies tx amount equals sum of attached expenses.
// Positive-amount transactions (deposits/income) are auto-matched since they need no receipt.
func UpdateReconciliationStatuses() {
	var transactions []models.BankTransaction
	db.DB.Preload("Expenses").Find(&transactions)

	for _, tx := range transactions {
		var status string

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
		}

		if tx.ReconciliationStatus != status {
			tx.ReconciliationStatus = status
			db.DB.Save(&tx)
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
