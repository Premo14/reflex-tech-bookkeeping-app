package utils

import (
	"fmt"
	"math"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"regexp"
	"strings"
	"time"
)

/*
RunReconciliation is the core matching engine of the application.
It runs completely autonomously in two main passes to link AI-extracted Expenses to BankTransactions.
- Pass 1: Sweeps for exact 1-to-1 matches (highest priority).
- Pass 2: Uses a recursive subset-sum algorithm to find combinations of split expenses on the same day that equal the bank transaction.
Finally, it recalculates the ReconciliationStatus for every transaction to flag mathematical imbalances.
*/
func RunReconciliation() {
	// 1. Deduplicate identical expenses before trying to match anything
	DeduplicateExpenses()

	// 2. Fetch all Expenses that have NO associated BankTransaction
	var unmatchedExpenses []models.Expense
	db.DB.Where("bank_transaction_id IS NULL").Find(&unmatchedExpenses)

	// 3. Fetch all BankTransactions
	var allTransactions []models.BankTransaction
	db.DB.Preload("Expenses").Find(&allTransactions)

	// We only want to try matching against transactions that are NOT already fully matched
	// (So we filter for UNMATCHED or PARTIAL)
	var availableTransactions []*models.BankTransaction
	for i := range allTransactions {
		tx := &allTransactions[i]
		sum := calculateExpenseSum(tx.Expenses)
		// We use 0.01 for safe float comparison
		if tx.ReconciliationStatus == "" || math.Abs(sum-tx.Amount) > 0.01 {
			availableTransactions = append(availableTransactions, tx)
		}
	}

	// ==========================================
	// PASS 1: Single Transaction Matches (Highest Priority)
	// ==========================================
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
			bestMatch.Expenses = append(bestMatch.Expenses, *expense)

			// Update expense in DB
			db.DB.Save(expense)
		}
	}

	// Re-fetch unmatched expenses for Pass 2 (since Pass 1 linked some)
	var remainingExpenses []models.Expense
	db.DB.Where("bank_transaction_id IS NULL").Find(&remainingExpenses)

	// ==========================================
	// PASS 2: Split Transaction Matches
	// ==========================================
	// Here we look for combinations of expenses on the exact same day that add up perfectly to the bank transaction
	for _, tx := range availableTransactions {
		sum := calculateExpenseSum(tx.Expenses)
		remainingAmountNeeded := tx.Amount - sum

		if math.Abs(remainingAmountNeeded) <= 0.01 {
			continue // It's already matched
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

	// ==========================================
	// PASS 3: Calculate and Update Reconciliation Status
	// ==========================================
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

/*
UpdateReconciliationStatuses iterates through every BankTransaction and verifies that the sum
of all attached Expenses exactly equals the BankTransaction Amount.
It assigns one of four statuses:
- "MATCHED": The math balances perfectly.
- "PARTIAL": The attached expenses don't add up to the total transaction amount yet.
- "OVERMATCHED": The attached expenses exceed the bank transaction amount (requires user review).
- "UNMATCHED": No expenses are attached.
*/
func UpdateReconciliationStatuses() {
	var transactions []models.BankTransaction
	db.DB.Preload("Expenses").Find(&transactions)

	for _, tx := range transactions {
		sum := calculateExpenseSum(tx.Expenses)
		
		status := "UNMATCHED"
		if len(tx.Expenses) > 0 {
			diff := tx.Amount - sum
			if math.Abs(diff) < 0.01 {
				status = "MATCHED"
			} else if math.Abs(sum) < math.Abs(tx.Amount) {
				// E.g. Sum is -50, Amount is -100
				status = "PARTIAL"
			} else {
				// E.g. Sum is -150, Amount is -100
				status = "OVERMATCHED"
			}
		}

		if tx.ReconciliationStatus != status {
			tx.ReconciliationStatus = status
			db.DB.Save(&tx)
		}
	}
}

/*
DeduplicateExpenses defends against users uploading the exact same receipt multiple times.
Before attempting to match any expenses to the bank, it groups unmatched expenses by a unique
signature (Vendor + Amount + Date). If it finds identical duplicates, it safely deletes the
redundant expense rows, but transfers their physical Receipt files over to the survivor to
ensure no image data is ever lost.
*/
func DeduplicateExpenses() {
	var expenses []models.Expense
	db.DB.Where("bank_transaction_id IS NULL").Preload("Receipts").Find(&expenses)

	// We use a map to group expenses by a unique signature: "Vendor_Amount_YYYY-MM-DD"
	seen := make(map[string]*models.Expense)

	for i := range expenses {
		e := &expenses[i]
		dateStr := e.Timestamp.Format("2006-01-02")
		amountStr := fmt.Sprintf("%.2f", e.Amount)
		// E.g. "walmart_-9.45_2026-08-14"
		signature := normalizeString(e.Vendor) + "_" + amountStr + "_" + dateStr

		if survivor, exists := seen[signature]; exists {
			// It's a duplicate! Move its physical receipts over to the survivor
			for _, receipt := range e.Receipts {
				receipt.ExpenseID = &survivor.ID
				db.DB.Save(&receipt)
			}
			// Delete the duplicate expense row
			db.DB.Delete(e)
		} else {
			seen[signature] = e
		}
	}
}

/*
findSubsetSum is a recursive algorithm that explores combinations of expenses to solve the "Split Receipt" problem.
For example, if a BankTransaction is $100, but the user uploaded two $50 receipts, this function finds that
the specific combination of those two receipts matches the $100 target perfectly.
*/
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
	if math.Abs(expense.Amount-bankTx.Amount) < 0.01 {
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
