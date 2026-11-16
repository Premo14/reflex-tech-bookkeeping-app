package utils

import (
	"fmt"
	"log"
	"math"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	reconciliationMutex   sync.Mutex
	reconcilStateMu       sync.Mutex
	reconciliationRunning bool
	reconciliationLastRun time.Time
)

// IsReconciliationRunning reports whether a reconciliation pass is currently active.
func IsReconciliationRunning() bool {
	reconcilStateMu.Lock()
	defer reconcilStateMu.Unlock()
	return reconciliationRunning
}

// SetReconciliationRunningForTest toggles the shared running flag for controller unit tests.
func SetReconciliationRunningForTest(running bool) {
	reconcilStateMu.Lock()
	defer reconcilStateMu.Unlock()
	reconciliationRunning = running
}

// TryTriggerReconciliation launches an asynchronous reconciliation run unless one is already running.
func TryTriggerReconciliation(onComplete func()) (started bool, prevRun time.Time) {
	reconcilStateMu.Lock()
	prevRun = reconciliationLastRun
	if reconciliationRunning {
		reconcilStateMu.Unlock()
		return false, prevRun
	}
	reconciliationRunning = true
	reconcilStateMu.Unlock()

	go func() {
		defer func() {
			reconcilStateMu.Lock()
			reconciliationRunning = false
			reconciliationLastRun = time.Now()
			reconcilStateMu.Unlock()
		}()
		runReconciliationLocked()
		if onComplete != nil {
			onComplete()
		}
	}()
	return true, prevRun
}

// RunReconciliation links expenses to bank transactions.
// pass 1: exact 1-to-1 matches
// pass 2: subset-sum suggestions for split expenses
// pass 3: recalculates status flags
// pass 4: automated invoice deposit matching
func RunReconciliation() {
	if db.DB == nil {
		return
	}
	reconcilStateMu.Lock()
	alreadyRunning := reconciliationRunning
	if !alreadyRunning {
		reconciliationRunning = true
	}
	reconcilStateMu.Unlock()

	defer func() {
		if !alreadyRunning {
			reconcilStateMu.Lock()
			reconciliationRunning = false
			reconciliationLastRun = time.Now()
			reconcilStateMu.Unlock()
		}
	}()

	runReconciliationLocked()
}

func runReconciliationLocked() {
	if db.DB == nil {
		return
	}
	reconciliationMutex.Lock()
	defer reconciliationMutex.Unlock()

	defer func() {
		if r := recover(); r != nil {
			// Catch panic to prevent full app crash
			println("PANIC in RunReconciliation:", r)
		}
	}()

	// Fetch all open-period active Expenses that have no confirmed row in the join table.
	// PENDING, IGNORED, DELETED, and closed-period items never auto-match or alter links.
	var rawUnlinkedExpenses []models.Expense
	db.DB.Where("deleted_at IS NULL").
		Where("id NOT IN (?)",
			db.DB.Table("expense_bank_transactions").Select("expense_id").Where("status = ?", "confirmed"),
		).Where("review_status IS NULL OR review_status = '' OR review_status IN (?, ?)", "APPROVED", "WARNINGS_IGNORED").Find(&rawUnlinkedExpenses)

	var unlinkedExpenses []models.Expense
	for i := range rawUnlinkedExpenses {
		if !IsDateInClosedPeriod(rawUnlinkedExpenses[i].Timestamp) {
			unlinkedExpenses = append(unlinkedExpenses, rawUnlinkedExpenses[i])
		}
	}

	// Fetch active BankTransactions and load only active confirmed expenses.
	var allTransactions []models.BankTransaction
	db.DB.Where("deleted_at IS NULL").
		Where("review_status IS NULL OR review_status = '' OR review_status IN (?, ?)", "APPROVED", "WARNINGS_IGNORED").Find(&allTransactions)
	for i := range allTransactions {
		db.DB.
			Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
			Where("ebt.bank_transaction_id = ? AND ebt.status = ? AND expenses.deleted_at IS NULL AND COALESCE(expenses.review_status, '') NOT IN ('IGNORED', 'DELETED')", allTransactions[i].ID, "confirmed").
			Find(&allTransactions[i].Expenses)
	}

	// Lookup active Balance Sheet accounts (ASSET, LIABILITY, EQUITY).
	// Negative bank transactions categorized to these accounts do not require expense receipts.
	balanceSheetAccountIDs := getBalanceSheetAccountIDs()

	// Only consider open-period debit transactions not already fully reconciled or balance-sheet transfers.
	var availableTransactions []*models.BankTransaction
	for i := range allTransactions {
		tx := &allTransactions[i]
		if tx.Amount.Cents >= 0 || IsDateInClosedPeriod(tx.Date) {
			continue
		}
		if len(tx.Expenses) == 0 && tx.CategoryAccountID != nil && balanceSheetAccountIDs[*tx.CategoryAccountID] {
			continue
		}
		sum := calculateExpenseSum(tx.Expenses)
		if tx.AllocationStatus == "" || tx.AllocationStatus != "BALANCED" || sum != tx.Amount.Abs().Cents {
			availableTransactions = append(availableTransactions, tx)
		}
	}

	// Clear previous unconfirmed suggestions so Pass 1 and Pass 2 compute fresh matches.
	db.DB.Where("status = ?", "suggested").Delete(&models.ExpenseBankTransaction{})

	// Fetch all explicitly unlinked pairs so the reconciler never automatically re-links or re-suggests them.
	var unlinkedPairs []models.ExpenseBankTransaction
	db.DB.Where("status = ?", "unlinked").Find(&unlinkedPairs)
	unlinkedMap := make(map[[2]uint]bool, len(unlinkedPairs))
	for _, p := range unlinkedPairs {
		unlinkedMap[[2]uint{p.ExpenseID, p.BankTransactionID}] = true
	}

	// Track expenses confirmed during this pass so we don't attempt to re-match them.
	confirmedInPass1 := map[uint]bool{}

	// pass 1: exact-amount 1-to-1 direct matches
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

		matches := collectReconcilerMatches(*expense, availableTransactions, unlinkedMap)
		bestScore := 0
		var bestMatch *models.BankTransaction
		if len(matches) > 0 {
			bestScore = matches[0].Score
			bestMatch = matches[0].Tx
		}

		// Auto-confirm strictly when exact 1:1 amount matches with no prior confirmed splits on tx
		if bestScore >= 80 && bestMatch != nil && len(bestMatch.Expenses) == 0 && expense.Amount.Abs().Cents == bestMatch.Amount.Abs().Cents {
			db.DB.Where("expense_id = ? AND bank_transaction_id = ?", expense.ID, bestMatch.ID).
				Delete(&models.ExpenseBankTransaction{})
			db.DB.Create(&models.ExpenseBankTransaction{
				ExpenseID:         expense.ID,
				BankTransactionID: bestMatch.ID,
				Status:            "confirmed",
			})

			confirmedInPass1[expense.ID] = true
			bestMatch.Expenses = append(bestMatch.Expenses, *expense)

			// If bank transaction has no category and expense does, sync category to transaction
			if bestMatch.CategoryAccountID == nil && expense.ChartAccountID != nil {
				bestMatch.CategoryAccountID = expense.ChartAccountID
				db.DB.Model(&models.BankTransaction{}).Where("id = ?", bestMatch.ID).Update("category_account_id", expense.ChartAccountID)
			}

		} else if len(matches) > 0 {
			// Variance pairs or split candidates — write suggested rows for user confirmation.
			persistReconcilerSuggestions(expense.ID, matches)
		}
	}

	// Re-fetch remaining open-period unconfirmed expenses for Pass 2.
	var rawRemaining []models.Expense
	db.DB.Where("deleted_at IS NULL").
		Where("id NOT IN (?)",
			db.DB.Table("expense_bank_transactions").Select("expense_id").Where("status = ?", "confirmed"),
		).Where("review_status IS NULL OR review_status = '' OR review_status IN (?, ?)", "APPROVED", "WARNINGS_IGNORED").Find(&rawRemaining)

	var remainingExpenses []models.Expense
	for i := range rawRemaining {
		if !IsDateInClosedPeriod(rawRemaining[i].Timestamp) {
			remainingExpenses = append(remainingExpenses, rawRemaining[i])
		}
	}

	// Track expenses claimed in Pass 2 to prevent double-use across transactions.
	claimedInPass2 := map[uint]bool{}

	// pass 2: split transaction matches
	for _, tx := range availableTransactions {
		sum := calculateExpenseSum(tx.Expenses)
		targetCents := tx.Amount.Abs().Cents
		remainingCents := targetCents - sum

		if remainingCents <= 1 {
			continue // It's already balanced or over-allocated
		}

		// Find remaining unclaimed expenses on the exact same day (Priority A).
		// Allow differing categories on splits when tx already has confirmed links or expense is strictly smaller than remaining.
		var sameDayExpenses []models.Expense
		for _, e := range remainingExpenses {
			if IsCashTender(e.Tender) || unlinkedMap[[2]uint{e.ID, tx.ID}] || claimedInPass2[e.ID] {
				continue
			}
			if daysDifference(e.Timestamp, tx.Date) == 0 {
				isSplitCandidate := len(tx.Expenses) > 0 || e.Amount.Abs().Cents < remainingCents
				if !isSplitCandidate && e.ChartAccountID != nil && tx.CategoryAccountID != nil && *e.ChartAccountID != *tx.CategoryAccountID {
					continue
				}
				sameDayExpenses = append(sameDayExpenses, e)
			}
		}

		matches := findSubsetSumForTx(*tx, sameDayExpenses, remainingCents)

		// Priority B: 1-3 day settlement clearing window
		if len(matches) == 0 {
			var windowExpenses []models.Expense
			for _, e := range remainingExpenses {
				if IsCashTender(e.Tender) || unlinkedMap[[2]uint{e.ID, tx.ID}] || claimedInPass2[e.ID] {
					continue
				}
				diff := daysDifference(e.Timestamp, tx.Date)
				if diff > 0 && diff <= 3 {
					isSplitCandidate := len(tx.Expenses) > 0 || e.Amount.Abs().Cents < remainingCents
					if !isSplitCandidate && e.ChartAccountID != nil && tx.CategoryAccountID != nil && *e.ChartAccountID != *tx.CategoryAccountID {
						continue
					}
					windowExpenses = append(windowExpenses, e)
				}
			}
			matches = findSubsetSumForTx(*tx, windowExpenses, remainingCents)
		}
		if len(matches) > 0 {
			for _, m := range matches {
				db.DB.Where("expense_id = ? AND bank_transaction_id = ?", m.ID, tx.ID).
					Delete(&models.ExpenseBankTransaction{})
				db.DB.Create(&models.ExpenseBankTransaction{
					ExpenseID:         m.ID,
					BankTransactionID: tx.ID,
					Status:            "suggested",
				})
				claimedInPass2[m.ID] = true
			}
		}
	}

	// pass 3: calc allocation status
	UpdateAllocationStatuses()
	events.Broadcast("RECONCILIATION_UPDATED", nil)
	events.Broadcast("QUEUE_UPDATED", nil)

	// pass 4: automated inflow reconciliation (matching deposits to client invoices)
	RunInvoiceReconciliation()
}

// CalculateMerchantFee computes standard merchant processing fees (2.9% + $0.30)
// and returns expected fee in cents and net deposit in cents.
// Uses exact integer arithmetic: fee = (grossCents * 29 + 30000) / 1000.
func CalculateMerchantFee(grossCents int64) (feeCents int64, netCents int64) {
	if grossCents <= 0 {
		return 0, 0
	}
	// 2.9% of grossCents, plus 30 cents fee, rounded to nearest cent.
	// Equivalent to: math.Round(grossCents*0.029 + 30) but pure integer.
	feeCents = (grossCents*29 + 30000 + 500) / 1000
	netCents = grossCents - feeCents
	return feeCents, netCents
}

var invoiceProcessorTokens = []string{
	"stripe", "square", "sq *", "paypal", "pypl", "venmo", "clover", "toast", "intuit", "quickbooks",
}

func clientNameMatchesDeposit(cleanTxDesc, clientName string) bool {
	cleanClient := strings.TrimSpace(normalizeString(clientName))
	if cleanClient == "" {
		return false
	}
	if len(cleanClient) >= 4 && !commonStopWords[cleanClient] && strings.Contains(cleanTxDesc, cleanClient) {
		return true
	}
	for _, tok := range strings.Fields(cleanClient) {
		if len(tok) >= 4 && !commonStopWords[tok] && strings.Contains(cleanTxDesc, tok) {
			return true
		}
	}
	return false
}

func descriptionHasProcessorSignal(cleanTxDesc string) bool {
	for _, tok := range invoiceProcessorTokens {
		if strings.Contains(cleanTxDesc, tok) {
			return true
		}
	}
	return false
}

// EvaluateInvoiceDepositMatch checks whether an incoming bank deposit reconciles against an open invoice
// via exact balance match (Pass 1) or standard merchant fee net deposit match (Pass 2).
func EvaluateInvoiceDepositMatch(inv *models.Invoice, tx *models.BankTransaction, openInvoiceCount int) (matched bool, isMerchantFee bool, feeDollars float64) {
	if inv == nil || tx == nil || inv.Status == "PAID" || inv.Status == "VOID" || inv.Status == "DRAFT" ||
		inv.DeletedAt != nil || inv.ReviewStatus == "DELETED" || inv.ReviewStatus == "IGNORED" ||
		inv.BalanceDue.Cents <= 0 || tx.Amount.Cents <= 0 {
		return false, false, 0
	}
	if inv.DeclinedTxIDs != "" && strings.Contains(inv.DeclinedTxIDs, fmt.Sprintf(",%d,", tx.ID)) {
		return false, false, 0
	}

	// Proximity check: deposit date within [-5, 90] days of invoice issue date
	daysSinceIssue := tx.Date.Sub(inv.IssueDate).Hours() / 24
	if daysSinceIssue < -5 || daysSinceIssue > 90 {
		return false, false, 0
	}

	cleanTxDesc := normalizeString(tx.Description)
	cleanInvNum := strings.ToLower(strings.TrimSpace(inv.InvoiceNumber))

	hasNameMatch := clientNameMatchesDeposit(cleanTxDesc, inv.ClientName)
	hasNumMatch := cleanInvNum != "" && strings.Contains(strings.ToLower(tx.Description), cleanInvNum)
	hasProcessorMatch := descriptionHasProcessorSignal(cleanTxDesc)

	// PASS 1: Exact Balance Match
	if tx.Amount.Cents == inv.BalanceDue.Cents && (hasNameMatch || hasNumMatch || openInvoiceCount == 1) {
		return true, false, 0
	}

	// PASS 2: Merchant Processing Fee Net Deposit (Stripe / Square 2.9% + $0.30)
	// Require positive identifying signal (client token, invoice number, known processor, or sole open invoice within 7 days).
	grossCents := inv.BalanceDue.Cents
	if grossCents > 500 { // Only consider balances > $5.00
		feeCents, expectedNetCents := CalculateMerchantFee(grossCents)
		diffCents := tx.Amount.Cents - expectedNetCents
		if diffCents < 0 {
			diffCents = -diffCents
		}
		if diffCents <= 150 && (hasNameMatch || hasNumMatch || hasProcessorMatch || (openInvoiceCount == 1 && daysSinceIssue >= 0 && daysSinceIssue <= 7)) {
			return true, true, float64(feeCents) / 100.0
		}
	}

	return false, false, 0
}

// RunInvoiceReconciliation automatically reconciles incoming bank deposits (credits) with open customer invoices.
// Pass 1: High-confidence exact match: Deposit amount matches open invoice BalanceDue within 90 days,
//         AND client name or invoice number appears in bank description (or is sole open invoice). Auto-marks PAID.
// Pass 2: Merchant processing fee match: Deposit matches open invoice balance minus standard Stripe/Square fee (2.9% + $0.30),
//         with customer/invoice/processor reference or sole open invoice within 7 days. Auto-marks PAID with fee notation.
func RunInvoiceReconciliation() {
	if db.DB == nil {
		return
	}

	// 1. Fetch all active open invoices (SENT, UNPAID, PARTIALLY_PAID, OVERDUE) with balance due > 0
	var openInvoices []models.Invoice
	if err := db.DB.Where("deleted_at IS NULL AND COALESCE(review_status, '') NOT IN ('DELETED', 'IGNORED') AND status IN ('SENT', 'UNPAID', 'PARTIALLY_PAID', 'OVERDUE') AND balance_due > 0").
		Order("due_date ASC").Find(&openInvoices).Error; err != nil || len(openInvoices) == 0 {
		return
	}

	// 2. Fetch all linked deposit IDs from non-deleted invoices to exclude already-matched bank transactions
	var linkedTxIDs []uint
	db.DB.Model(&models.Invoice{}).
		Where("bank_transaction_id IS NOT NULL AND deleted_at IS NULL AND COALESCE(review_status, '') != 'DELETED'").
		Pluck("bank_transaction_id", &linkedTxIDs)
	linkedMap := make(map[uint]bool, len(linkedTxIDs))
	for _, id := range linkedTxIDs {
		linkedMap[id] = true
	}

	// 3. Fetch candidate active in-books incoming deposits (amount > 0)
	var deposits []models.BankTransaction
	query := db.DB.Where("deleted_at IS NULL AND amount > 0 AND COALESCE(review_status, '') NOT IN ('DELETED', 'IGNORED', 'PENDING')")
	if len(linkedTxIDs) > 0 {
		query = query.Where("id NOT IN (?)", linkedTxIDs)
	}
	if err := query.Order("date ASC").Find(&deposits).Error; err != nil || len(deposits) == 0 {
		return
	}

	invoicesUpdated := false
	transactionsUpdated := false

	// Match loop
	for i := range deposits {
		tx := &deposits[i]
		if linkedMap[tx.ID] || IsDateInClosedPeriod(tx.Date) {
			continue
		}

		// Check candidates among open invoices
		for j := range openInvoices {
			inv := &openInvoices[j]
			matched, isMerchantFee, feeDollars := EvaluateInvoiceDepositMatch(inv, tx, len(openInvoices))
			if !matched {
				continue
			}

			origBalanceCents := inv.BalanceDue.Cents
			inv.AmountPaid = inv.TotalAmount
			inv.BalanceDue = models.NewMoney(0)
			inv.Status = "PAID"
			inv.BankTransactionID = &tx.ID
			inv.PaidDate = &tx.Date
			db.DB.Save(inv)

			if inv.CategoryAccountID != nil {
				tx.CategoryAccountID = inv.CategoryAccountID
			}
			tx.AllocationStatus = "BALANCED"
			if tx.ReviewStatus == "" {
				tx.ReviewStatus = "APPROVED"
			}
			if isMerchantFee {
				actualFee := float64(origBalanceCents-tx.Amount.Cents) / 100.0
				if actualFee <= 0 {
					actualFee = feeDollars
				}
				tx.Notes = fmt.Sprintf("Payment for Invoice %s (%s) [Net of $%.2f merchant fee]",
					inv.InvoiceNumber, inv.ClientName, actualFee)
				log.Printf("✅ Inflow Reconciler: auto-matched merchant deposit $%.2f to Invoice %s ($%.2f fee deducted)",
					tx.Amount.Dollars(), inv.InvoiceNumber, actualFee)
			} else {
				tx.Notes = fmt.Sprintf("Payment for Invoice %s (%s)", inv.InvoiceNumber, inv.ClientName)
				log.Printf("✅ Inflow Reconciler: auto-matched deposit $%.2f (%s) to Invoice %s (%s)",
					tx.Amount.Dollars(), tx.Description, inv.InvoiceNumber, inv.ClientName)
			}
			db.DB.Save(tx)

			linkedMap[tx.ID] = true
			invoicesUpdated = true
			transactionsUpdated = true
			break
		}
	}

	if invoicesUpdated {
		events.Broadcast("INVOICES_UPDATED", nil)
		events.Broadcast("SUMMARY_UPDATED", nil)
	}
	if transactionsUpdated {
		events.Broadcast("TRANSACTIONS_UPDATED", nil)
	}
}

// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------

// calculateExpenseSum returns the sum of expense amounts in exact integer cents.
func calculateExpenseSum(expenses []models.Expense) int64 {
	var sum int64
	for _, e := range expenses {
		sum += e.Amount.Abs().Cents
	}
	return sum
}

// toCents normalizes floating-point currency to integer cents to prevent IEEE-754 precision issues.
func toCents(amount float64) int64 {
	return int64(math.Round(amount * 100))
}

func daysDifference(date1, date2 time.Time) int {
	u1 := date1.UTC()
	u2 := date2.UTC()
	d1 := time.Date(u1.Year(), u1.Month(), u1.Day(), 0, 0, 0, 0, time.UTC)
	d2 := time.Date(u2.Year(), u2.Month(), u2.Day(), 0, 0, 0, 0, time.UTC)
	return int(math.Abs(d2.Sub(d1).Hours() / 24))
}

func getBalanceSheetAccountIDs() map[uint]bool {
	ids := map[uint]bool{}
	var accounts []models.ChartAccount
	db.DB.Where("type IN (?, ?, ?) AND active = ?", "ASSET", "LIABILITY", "EQUITY", true).Find(&accounts)
	for _, a := range accounts {
		ids[a.ID] = true
	}
	return ids
}

// sumConfirmedTxAbsCentsForExpense sums exact integer cents across all non-deleted confirmed
// bank transactions linked to expenseID (avoiding raw SQL SUM float/cents mismatch).
func sumConfirmedTxAbsCentsForExpense(expenseID uint) int64 {
	var txs []models.BankTransaction
	db.DB.Select("bank_transactions.id, bank_transactions.amount").
		Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = 'confirmed' AND COALESCE(bank_transactions.review_status, '') NOT IN ('IGNORED', 'DELETED')", expenseID).
		Find(&txs)
	return sumTransactionAbsCents(txs)
}

// sumConfirmedExpenseAbsCentsForTx sums exact integer cents across all non-deleted confirmed
// expenses linked to txID (avoiding raw SQL SUM float/cents mismatch).
func sumConfirmedExpenseAbsCentsForTx(txID uint) int64 {
	var exps []models.Expense
	db.DB.Select("expenses.id, expenses.amount").
		Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
		Where("ebt.bank_transaction_id = ? AND ebt.status = 'confirmed' AND COALESCE(expenses.review_status, '') NOT IN ('IGNORED', 'DELETED')", txID).
		Find(&exps)
	return sumExpenseAbsCents(exps)
}

// UpdateAllocationStatuses verifies tx amount equals sum of attached confirmed expenses.
// Positive/zero-amount transactions (deposits/income/memos) and balance-sheet transfers auto-balance.
func UpdateAllocationStatuses() {
	if db.DB == nil {
		return
	}
	balanceSheetAccountIDs := getBalanceSheetAccountIDs()

	// First, prune any suggested links that touch balanced/confirmed items or cash expenses
	db.DB.Exec(`
		DELETE FROM expense_bank_transactions
		WHERE status = 'suggested'
		  AND (
		    expense_id IN (SELECT id FROM expenses WHERE allocation_status = 'BALANCED' OR LOWER(TRIM(tender)) IN ('cash', 'cash / paper', 'cash/paper', 'currency', 'paper'))
		    OR bank_transaction_id IN (SELECT id FROM bank_transactions WHERE allocation_status = 'BALANCED' OR amount >= 0)
		  )
	`)

	var transactions []models.BankTransaction
	db.DB.Where("deleted_at IS NULL AND COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')").Find(&transactions)

	for i := range transactions {
		tx := &transactions[i]

		// Load only active confirmed expenses for this transaction via a direct join.
		db.DB.
			Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
			Where("ebt.bank_transaction_id = ? AND ebt.status = ? AND expenses.deleted_at IS NULL AND COALESCE(expenses.review_status, '') NOT IN ('IGNORED', 'DELETED')", tx.ID, "confirmed").
			Find(&tx.Expenses)

		var status string
		var hasSuggestions bool

		// Deposits/zero-amount memos (amount >= 0) and unlinked Balance Sheet transfers/payments auto-balance
		if tx.Amount.Cents >= 0 || (len(tx.Expenses) == 0 && tx.CategoryAccountID != nil && balanceSheetAccountIDs[*tx.CategoryAccountID]) {
			status = "BALANCED"
		} else {
			txCents := tx.Amount.Abs().Cents
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
				// All integer cents comparison — no float64 money math.
				sumCents := calculateExpenseSum(tx.Expenses)
				if sumCents == txCents {
					status = "BALANCED"
				} else if sumCents < txCents {
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
					sumOtherCents := sumConfirmedTxAbsCentsForExpense(singleExp.ID)

					if sumOtherCents > singleExp.Amount.Abs().Cents {
						status = "OVER_ALLOCATED"
					} else {
						status = "BALANCED"
					}
				} else {
					// 1:1 match or partial — use integer cents throughout.
					diffCents := txCents - singleExp.Amount.Abs().Cents
					if diffCents == 0 {
						status = "BALANCED"
					} else if diffCents > 0 {
						status = "PARTIALLY_ALLOCATED"
					} else {
						// txCents < singleExp.Amount: transaction is fully absorbed by the larger expense
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
	db.DB.Where("deleted_at IS NULL AND COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')").Find(&expenses)
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
			sumTxCents := sumConfirmedTxAbsCentsForExpense(exp.ID)

			expCents := exp.Amount.Abs().Cents
			if expCents == sumTxCents {
				status = "BALANCED"
			} else if expCents > sumTxCents {
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
				txCents := tx.Amount.Abs().Cents
				expCents := exp.Amount.Abs().Cents

				sumExpCents := sumConfirmedExpenseAbsCentsForTx(tx.ID)

				if expCents > txCents {
					// Expense is larger than the single bank transaction linked to it
					status = "PARTIALLY_ALLOCATED"
				} else if sumExpCents > txCents {
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

	// Final consistency pass: clear stale has_suggestions flags if counterparty expense balancing deleted suggested links.
	db.DB.Exec(`
		UPDATE bank_transactions
		SET has_suggestions = false
		WHERE has_suggestions = true
		  AND id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'suggested')
	`)
	db.DB.Exec(`
		UPDATE expenses
		SET has_suggestions = false
		WHERE has_suggestions = true
		  AND id NOT IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'suggested')
	`)
}

// Backward-compatible alias
func UpdateReconciliationStatuses() {
	UpdateAllocationStatuses()
}

// findSubsetSumForTx prioritizes vendor-matching candidates stably before running subset-sum matching.
func findSubsetSumForTx(tx models.BankTransaction, expenses []models.Expense, targetCents int64) []models.Expense {
	if len(expenses) == 0 || targetCents <= 0 {
		return nil
	}
	ordered := make([]models.Expense, len(expenses))
	copy(ordered, expenses)
	sort.SliceStable(ordered, func(i, j int) bool {
		mi := vendorMatchesDescription(tx.Description, ordered[i].Vendor)
		mj := vendorMatchesDescription(tx.Description, ordered[j].Vendor)
		return mi && !mj
	})
	return findSubsetSum(ordered, targetCents)
}

// findSubsetSum explores combinations of expenses to find a subset that equals the target amount (in cents).
// Uses bounded knapsack DP up to $2,000 (200,000 cents) and falls back to DFS above that to keep memory flat.
func findSubsetSum(expenses []models.Expense, targetCents int64) []models.Expense {
	if len(expenses) == 0 {
		return nil
	}

	if targetCents <= 0 {
		return nil
	}

	// DP array size limit: 200,000 cents ($2,000.00) -> <= ~1.6MB slice.
	// Larger targets fall back to pruned DFS without allocating multi-hundred-MB arrays.
	if targetCents > 200000 {
		return findSubsetSumDFS(expenses, targetCents)
	}

	targetInt := int(targetCents)

	// dp[sum] stores the index of the expense that reached this sum.
	// -1 means unreachable. -2 is the base case for sum 0.
	dp := make([]int, targetInt+1)
	for i := range dp {
		dp[i] = -1
	}
	dp[0] = -2

	for expIdx, exp := range expenses {
		expCents := exp.Amount.Abs().Cents
		if expCents <= 0 {
			continue
		}

		// Traverse backwards so we don't reuse the same expense multiple times
		for sum := targetInt; sum >= int(expCents); sum-- {
			if dp[sum-int(expCents)] != -1 && dp[sum] == -1 {
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
		curr -= int(expenses[idx].Amount.Abs().Cents)
	}
	return result
}

// findSubsetSumDFS is a fallback DFS with hard cap for target amounts > $2,000.
// Uses integer cents throughout to avoid IEEE-754 precision issues.
func findSubsetSumDFS(expenses []models.Expense, targetCents int64) []models.Expense {
	if len(expenses) > 20 {
		expenses = expenses[:20]
	}

	// Calculate suffix sums (in cents) for pruning
	suffixSum := make([]int64, len(expenses))
	sum := int64(0)
	for i := len(expenses) - 1; i >= 0; i-- {
		sum += expenses[i].Amount.Abs().Cents
		suffixSum[i] = sum
	}

	var bestMask uint64 = 0
	var found bool

	var search func(index int, currentSum int64, currentMask uint64) bool
	search = func(index int, currentSum int64, currentMask uint64) bool {
		// 1. Base case: Check if we hit the target exactly
		if currentSum == targetCents && currentMask > 0 {
			bestMask = currentMask
			found = true
			return true
		}

		// 2. Pruning rules
		if index >= len(expenses) {
			return false
		}
		if currentSum > targetCents { // Exceeded target (expenses are always positive)
			return false
		}
		if currentSum+suffixSum[index] < targetCents { // Even taking all remaining won't reach target
			return false
		}

		// 3. Try WITH the current expense
		if search(index+1, currentSum+expenses[index].Amount.Abs().Cents, currentMask|(1<<index)) {
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
	// Guard against conflicting categories on 1:1 matches; allow multi-category 1:N splits when tx already holds confirmed links.
	if len(bankTx.Expenses) == 0 && expense.ChartAccountID != nil && bankTx.CategoryAccountID != nil {
		if *expense.ChartAccountID != *bankTx.CategoryAccountID {
			return 0
		}
	}

	expCents := expense.Amount.Abs().Cents
	txCents := bankTx.Amount.Abs().Cents
	exactAmount := expCents == txCents
	vendorMatch := vendorMatchesDescription(bankTx.Description, expense.Vendor)

	// Hardening: In single-entry bookkeeping, if NEITHER the amount nor the vendor matches,
	// the pair has zero correlation and must NEVER produce a suggested match.
	if !exactAmount && !vendorMatch {
		return 0
	}

	score := 0

	// A. Amount Matching (+50 for exact, +30 for small tip/tax variance if vendor matches)
	if exactAmount {
		score += 50
	} else if vendorMatch && expCents > 0 {
		diffCents := math.Abs(float64(txCents - expCents))
		// If vendor matches and amount variance is within 15% (e.g. restaurant tip or sales tax delta)
		if (diffCents / float64(expCents)) <= 0.15 {
			score += 30
		}
	}

	// B. Date Proximity
	daysDiff := daysDifference(expense.Timestamp, bankTx.Date)
	switch {
	case daysDiff == 0:
		score += 30
	case daysDiff == 1:
		score += 20
	case daysDiff >= 2 && daysDiff <= 4:
		score += 10
	}

	// C. Vendor Match (+20)
	if vendorMatch {
		score += 20
	}

	return score
}

var nonAlphaNumRegex = regexp.MustCompile(`[^a-zA-Z0-9]+`)

// Strips special characters while removing apostrophes without inserting spaces (e.g. McDonald's -> mcdonalds)
func normalizeString(s string) string {
	cleaned := strings.ReplaceAll(s, "'", "")
	cleaned = strings.ReplaceAll(cleaned, "\u2019", "")
	return strings.ToLower(
		strings.TrimSpace(
			nonAlphaNumRegex.ReplaceAllString(cleaned, " "),
		),
	)
}

// POS/Processor prefixes commonly found in bank descriptions
var posPrefixes = []string{
	"withdrawal instant issue ",
	"withdrawal at atm ",
	"withdrawal debit ",
	"withdrawal pos ",
	"withdrawal ",
	"pos debit ",
	"pos purchase ",
	"debit purchase ",
	"debit card ",
	"checkcard ",
	"sq *",
	"square *",
	"tst *",
	"toast *",
	"sp *",
	"shopify *",
	"paypal *",
	"pypl *",
	"venmo *",
}

// Legal entity suffixes to strip from vendor names for accurate matching
var legalSuffixes = []string{
	" incorporated",
	" inc",
	" llc",
	" corporation",
	" corp",
	" company",
	" co",
	" limited",
	" ltd",
}

// Common merchant alias mappings
var merchantAliases = map[string]string{
	"amzn":          "amazon",
	"wmt":           "walmart",
	"mcd":           "mcdonalds",
	"sbux":          "starbucks",
	"hd":            "home depot",
	"tgt":           "target",
	"dd":            "dunkin",
}

var commonStopWords = map[string]bool{
	"and": true, "the": true, "for": true, "with": true, "new": true,
	"york": true, "state": true, "highway": true, "route": true,
	"store": true, "restaurant": true, "cafe": true,
}

// cleanForVendorMatch cleans and normalizes a string by stripping POS prefixes, legal suffixes, and expanding aliases.
func cleanForVendorMatch(s string) string {
	cleaned := normalizeString(s)

	for _, prefix := range posPrefixes {
		cleanedPrefix := normalizeString(prefix)
		if strings.HasPrefix(cleaned, cleanedPrefix) {
			cleaned = strings.TrimSpace(strings.TrimPrefix(cleaned, cleanedPrefix))
			break
		}
	}

	for _, suffix := range legalSuffixes {
		cleanedSuffix := normalizeString(suffix)
		if strings.HasSuffix(cleaned, cleanedSuffix) {
			cleaned = strings.TrimSpace(strings.TrimSuffix(cleaned, cleanedSuffix))
			break
		}
	}

	cleaned = strings.ReplaceAll(cleaned, "wm supercenter", "walmart")
	cleaned = strings.ReplaceAll(cleaned, "wal mart", "walmart")
	cleaned = strings.ReplaceAll(cleaned, "dunkin donuts", "dunkin")

	words := strings.Fields(cleaned)
	for i, w := range words {
		if canon, ok := merchantAliases[w]; ok {
			words[i] = canon
		}
	}
	cleaned = strings.Join(words, " ")

	return cleaned
}

func vendorMatchesDescription(description, vendor string) bool {
	cleanDesc := cleanForVendorMatch(description)
	cleanVend := cleanForVendorMatch(vendor)

	if cleanDesc == "" || cleanVend == "" {
		return false
	}

	// 1. Direct substring check in either direction
	if strings.Contains(cleanDesc, cleanVend) || strings.Contains(cleanVend, cleanDesc) {
		return true
	}

	// 2. Token overlap matching: test if meaningful vendor words appear in bank description
	vendTokens := strings.Fields(cleanVend)
	descTokens := strings.Fields(cleanDesc)
	descTokenSet := make(map[string]bool, len(descTokens))
	for _, dt := range descTokens {
		descTokenSet[dt] = true
	}

	matchCount := 0
	meaningfulCount := 0

	for _, vt := range vendTokens {
		if commonStopWords[vt] || len(vt) < 3 {
			continue
		}
		meaningfulCount++

		// Exact token match or token substring
		if descTokenSet[vt] {
			matchCount++
			continue
		}
		for dt := range descTokenSet {
			if len(dt) >= 4 && (strings.Contains(dt, vt) || strings.Contains(vt, dt)) {
				matchCount++
				break
			}
		}
	}

	// If at least one distinctive token (>= 5 chars) matches, or >= 50% of meaningful tokens match
	if meaningfulCount > 0 && float64(matchCount)/float64(meaningfulCount) >= 0.5 {
		return true
	}

	return false
}
