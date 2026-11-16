package controllers

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

const booksClosedDateKey = "BooksClosedDate"

// resolveSafeProcessedReceiptPath validates that uri resolves strictly inside constants.GetProcessedPath()
// so path-traversal attempts (e.g. "../../etc/passwd") are blocked before filesystem reads or deletes.
func resolveSafeProcessedReceiptPath(uri string) (string, bool) {
	if strings.TrimSpace(uri) == "" {
		return "", false
	}
	cleaned := filepath.Clean(uri)
	processedDir := filepath.Clean(constants.GetProcessedPath())
	if processedDir == "" || processedDir == "." {
		return "", false
	}
	absFile, err1 := filepath.Abs(cleaned)
	absDir, err2 := filepath.Abs(processedDir)
	if err1 != nil || err2 != nil {
		return "", false
	}
	rel, err := filepath.Rel(absDir, absFile)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return "", false
	}
	return absFile, true
}

// removeUnreferencedReceiptFile removes a physical receipt file if no database record
// references it and its path stays safely inside the processed storage directory.
func removeUnreferencedReceiptFile(uri string) {
	if uri == "" || db.DB == nil {
		return
	}
	var remainingCount int64
	db.DB.Model(&models.Receipt{}).Where("document_uri = ?", uri).Count(&remainingCount)
	if remainingCount > 0 {
		return
	}
	safePath, ok := resolveSafeProcessedReceiptPath(uri)
	if !ok {
		fmt.Printf("Warning: refusing to delete receipt file outside processed dir: %s\n", uri)
		return
	}
	if err := os.Remove(safePath); err != nil && !os.IsNotExist(err) {
		fmt.Printf("Warning: failed to delete physical receipt file %s: %v\n", safePath, err)
	}
}

// getBooksClosedDate returns the current BooksClosedDate, or ok=false when no period is locked.
func getBooksClosedDate(tx *gorm.DB) (closed time.Time, raw string, ok bool) {
	var setting models.AppSetting
	if err := tx.Where("key = ?", booksClosedDateKey).First(&setting).Error; err != nil || setting.Value == "" {
		return time.Time{}, "", false
	}
	parsed, err := time.Parse("2006-01-02", setting.Value)
	if err != nil {
		return time.Time{}, "", false
	}
	return parsed, setting.Value, true
}

// GetReviewQueueCounts returns integer counts for all review queues.
// Used by the sidebar to display badges without transferring the entire transaction graph.
func GetReviewQueueCounts(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}

	var pendingTxCount int64
	var pendingExpCount int64
	var pendingInvCount int64

	db.DB.Model(&models.BankTransaction{}).
		Where("deleted_at IS NULL AND ((review_status = 'PENDING') OR ((allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')))").
		Count(&pendingTxCount)

	db.DB.Model(&models.Expense{}).
		Where("deleted_at IS NULL AND ((review_status = 'PENDING') OR ("+notCashClause+" AND (allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')))").
		Count(&pendingExpCount)

	db.DB.Model(&models.Invoice{}).
		Where("deleted_at IS NULL AND ((review_status = 'PENDING') OR (status IN ('SENT', 'OVERDUE', 'PARTIALLY_PAID') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')))").
		Count(&pendingInvCount)

	var ignoredTxCount, ignoredExpCount, ignoredInvCount int64
	db.DB.Model(&models.BankTransaction{}).Where("review_status = 'IGNORED'").Count(&ignoredTxCount)
	db.DB.Model(&models.Expense{}).Where("review_status = 'IGNORED'").Count(&ignoredExpCount)
	db.DB.Model(&models.Invoice{}).Where("review_status = 'IGNORED'").Count(&ignoredInvCount)

	var warnTxCount, warnExpCount, warnInvCount int64
	db.DB.Model(&models.BankTransaction{}).Where("review_status = 'WARNINGS_IGNORED'").Count(&warnTxCount)
	db.DB.Model(&models.Expense{}).Where("review_status = 'WARNINGS_IGNORED'").Count(&warnExpCount)
	db.DB.Model(&models.Invoice{}).Where("review_status = 'WARNINGS_IGNORED'").Count(&warnInvCount)

	var delTxCount, delExpCount, delInvCount int64
	db.DB.Model(&models.BankTransaction{}).Where("review_status = 'DELETED'").Count(&delTxCount)
	db.DB.Model(&models.Expense{}).Where("review_status = 'DELETED'").Count(&delExpCount)
	db.DB.Model(&models.Invoice{}).Where("review_status = 'DELETED'").Count(&delInvCount)

	return c.JSON(fiber.Map{
		"pending":         pendingTxCount + pendingExpCount + pendingInvCount,
		"excluded":        ignoredTxCount + ignoredExpCount + ignoredInvCount,
		"warningsIgnored": warnTxCount + warnExpCount + warnInvCount,
		"deleted":         delTxCount + delExpCount + delInvCount,
	})
}

// GetReviewQueue returns the items for one of the review lists:
//   - PENDING: items awaiting a decision because they fall in a closed period
//   - IGNORED: items that were excluded from the books
//   - WARNINGS_IGNORED: items that are in the books but whose warnings were silenced
//   - DELETED: items soft-deleted from the books, held for 30 days before permanent purge
func GetReviewQueue(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	status := c.Query("status", "PENDING")
	if status != "PENDING" && status != "IGNORED" && status != "WARNINGS_IGNORED" && status != "DELETED" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "status must be PENDING, IGNORED, WARNINGS_IGNORED or DELETED"})
	}

	_, closedRaw, _ := getBooksClosedDate(db.DB)

	if status == "DELETED" {
		// Auto-purge items that have been in the trash for longer than 30 days
		purgeThreshold := time.Now().Add(-30 * 24 * time.Hour)
		var oldTxIDs []uint
		db.DB.Model(&models.BankTransaction{}).Where("review_status = ? AND deleted_at < ?", "DELETED", purgeThreshold).Pluck("id", &oldTxIDs)
		if len(oldTxIDs) > 0 {
			db.DB.Where("bank_transaction_id IN ?", oldTxIDs).Delete(&models.ExpenseBankTransaction{})
			db.DB.Where("id IN ?", oldTxIDs).Delete(&models.BankTransaction{})
		}
		var oldExpIDs []uint
		db.DB.Model(&models.Expense{}).Where("review_status = ? AND deleted_at < ?", "DELETED", purgeThreshold).Pluck("id", &oldExpIDs)
		if len(oldExpIDs) > 0 {
			var oldReceipts []models.Receipt
			db.DB.Where("expense_id IN ?", oldExpIDs).Find(&oldReceipts)

			db.DB.Where("expense_id IN ?", oldExpIDs).Delete(&models.ExpenseBankTransaction{})
			db.DB.Where("expense_id IN ?", oldExpIDs).Delete(&models.Receipt{})
			db.DB.Where("id IN ?", oldExpIDs).Delete(&models.Expense{})

			// Remove physical files if no other receipt references them
			for _, r := range oldReceipts {
				removeUnreferencedReceiptFile(r.DocumentURI)
			}
		}

		var oldInvIDs []uint
		db.DB.Model(&models.Invoice{}).Where("review_status = ? AND deleted_at < ?", "DELETED", purgeThreshold).Pluck("id", &oldInvIDs)
		if len(oldInvIDs) > 0 {
			db.DB.Where("id IN ?", oldInvIDs).Delete(&models.Invoice{})
		}
	}

	// Initialize base queries for transactions, expenses, and invoices.
	queryTx := db.DB
	queryExp := db.DB
	queryInv := db.DB

	// PENDING means items needing review:
	//   1. Items awaiting review (imported into a closed period OR open-period receipts missing amount/date)
	//   2. Active items in the books (review_status in NULL, '', 'APPROVED') with allocation_status != 'BALANCED'
	//   3. Invoices in a closed period or unpaid/overdue/unmatched invoices needing attention
	// Mirroring the counts logic exactly.
	if status == "PENDING" {
		queryTx = queryTx.Where("deleted_at IS NULL AND ((review_status = 'PENDING') OR ((allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')))")
		queryExp = queryExp.Where("deleted_at IS NULL AND ((review_status = 'PENDING') OR ("+notCashClause+" AND (allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')))")
		queryInv = queryInv.Where("deleted_at IS NULL AND ((review_status = 'PENDING') OR (status IN ('SENT', 'OVERDUE', 'PARTIALLY_PAID') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')))")
	} else {
		queryTx = queryTx.Where("review_status = ?", status)
		queryExp = queryExp.Where("review_status = ?", status)
		queryInv = queryInv.Where("review_status = ?", status)
	}

	orderTx := "date DESC"
	orderExp := "timestamp DESC"
	orderInv := "issue_date DESC"
	if status == "DELETED" {
		orderTx = "COALESCE(deleted_at, updated_at) DESC, date DESC"
		orderExp = "COALESCE(deleted_at, updated_at) DESC, timestamp DESC"
		orderInv = "COALESCE(deleted_at, updated_at) DESC, issue_date DESC"
	}

	txs := []models.BankTransaction{}
	if err := queryTx.Preload("ChartAccount").Preload("Category").Order(orderTx).Find(&txs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load transactions"})
	}

	exps := []models.Expense{}
	if err := queryExp.Preload("ChartAccount").Preload("BankTransactions.ChartAccount").Order(orderExp).Find(&exps).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load expenses"})
	}

	invs := []models.Invoice{}
	if err := queryInv.Preload("CategoryAccount").Preload("BankTransaction").Preload("BankTransaction.ChartAccount").Order(orderInv).Find(&invs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load invoices"})
	}

	return c.JSON(fiber.Map{
		"status":          "success",
		"transactions":    txs,
		"expenses":        exps,
		"invoices":        invs,
		"booksClosedDate": closedRaw,
	})
}

type ResolveRequest struct {
	TransactionIDs []uint `json:"transactionIds"`
	ExpenseIDs     []uint `json:"expenseIds"`
	InvoiceIDs     []uint `json:"invoiceIds"`
	// Action is one of:
	//   "allow"            - approve PENDING items (reopens the books back to the oldest one)
	//   "pending"          - send excluded items that sit in a closed period back to the queue
	//   "ignore_warnings"  - keep an item in the books but silence its warnings
	//   "restore_warnings" - turn warnings back on for an item whose warnings were ignored
	// Excluding items goes through the exclusion endpoints (reason required).
	Action string `json:"action"`
}

// resolveError carries an HTTP status out of the transaction closure.
type resolveError struct {
	status int
	msg    string
}

func (e *resolveError) Error() string { return e.msg }

func newResolveError(status int, msg string) *resolveError {
	return &resolveError{status: status, msg: msg}
}

func splitItemIDs(items []GroupItem) (txIDs []uint, expIDs []uint, invIDs []uint) {
	for _, it := range items {
		switch it.Type {
		case "transaction":
			txIDs = append(txIDs, it.ID)
		case "expense":
			expIDs = append(expIDs, it.ID)
		case "invoice":
			invIDs = append(invIDs, it.ID)
		}
	}
	return
}

func isNormalReviewStatus(s string) bool {
	return s == "" || s == "APPROVED"
}

func applyReviewStatus(tx *gorm.DB, txIDs, expIDs, invIDs []uint, fields map[string]interface{}) error {
	if len(txIDs) > 0 {
		if err := tx.Model(&models.BankTransaction{}).Where("id IN ?", txIDs).Updates(fields).Error; err != nil {
			return err
		}
	}
	if len(expIDs) > 0 {
		if err := tx.Model(&models.Expense{}).Where("id IN ?", expIDs).Updates(fields).Error; err != nil {
			return err
		}
	}
	if len(invIDs) > 0 {
		if err := tx.Model(&models.Invoice{}).Where("id IN ?", invIDs).Updates(fields).Error; err != nil {
			return err
		}
	}
	return nil
}

func writeReviewAudit(tx *gorm.DB, items []GroupItem, action, reason, note, groupID string) error {
	for _, it := range items {
		if err := tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: action, Reason: reason, Note: note, GroupID: groupID}).Error; err != nil {
			return err
		}
	}
	return nil
}

// ResolveQueueItems applies a review decision to a set of items atomically.
func ResolveQueueItems(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var req ResolveRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid input"})
	}
	if len(req.TransactionIDs) == 0 && len(req.ExpenseIDs) == 0 && len(req.InvoiceIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No items were selected."})
	}

	switch req.Action {
	case "allow", "pending", "ignore_warnings", "restore_warnings", "delete":
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unknown action."})
	}

	resp := fiber.Map{"status": "success"}

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		requested := loadGroupItems(tx, req.TransactionIDs, req.ExpenseIDs, req.InvoiceIDs)
		if len(requested) == 0 {
			return newResolveError(fiber.StatusNotFound, "The selected items no longer exist.")
		}
		groupID := fmt.Sprintf("G%d", time.Now().UnixNano())

		switch req.Action {

		case "allow":
			for _, it := range requested {
				if it.ReviewStatus != "PENDING" {
					return newResolveError(fiber.StatusConflict, "Some of the selected items are no longer awaiting review. Refresh and try again.")
				}
			}
			// Linked items always move together.
			txIDs, expIDs, invIDs := expandToLinkGroups(tx, req.TransactionIDs, req.ExpenseIDs, req.InvoiceIDs)
			var allowed []GroupItem
			for _, it := range loadGroupItems(tx, txIDs, expIDs, invIDs) {
				if it.ReviewStatus == "PENDING" {
					allowed = append(allowed, it)
				}
			}
			allowTx, allowExp, allowInv := splitItemIDs(allowed)
			if err := applyReviewStatus(tx, allowTx, allowExp, allowInv, map[string]interface{}{"review_status": "APPROVED", "exclusion_reason": "", "exclusion_note": ""}); err != nil {
				return err
			}
			if err := writeReviewAudit(tx, allowed, "APPROVED", "", "Review Queue", groupID); err != nil {
				return err
			}
			rolledBack, newClosed, autoApproved, err := reopenBooksForAllowedItems(tx, allowed, groupID)
			if err != nil {
				return err
			}
			resp["rolledBack"] = rolledBack
			resp["booksClosedDate"] = newClosed
			resp["autoApproved"] = autoApproved
			resp["affected"] = allowed

		case "pending":
			closedDate, _, hasClosed := getBooksClosedDate(tx)
			for _, it := range requested {
				if it.ReviewStatus != "IGNORED" {
					return newResolveError(fiber.StatusConflict, "Only excluded items can be sent to the Review Queue.")
				}
				if !hasClosed || it.Date.After(closedDate) {
					return newResolveError(fiber.StatusConflict, "Only items in a locked period can be sent to the Review Queue. Restore the others directly.")
				}
			}
			txIDs, expIDs, invIDs := expandToLinkGroups(tx, req.TransactionIDs, req.ExpenseIDs, req.InvoiceIDs)
			var moved []GroupItem
			for _, it := range loadGroupItems(tx, txIDs, expIDs, invIDs) {
				if it.ReviewStatus == "IGNORED" {
					moved = append(moved, it)
				}
			}
			moveTx, moveExp, moveInv := splitItemIDs(moved)
			if err := applyReviewStatus(tx, moveTx, moveExp, moveInv, map[string]interface{}{"review_status": "PENDING", "exclusion_reason": "", "exclusion_note": ""}); err != nil {
				return err
			}
			if err := writeReviewAudit(tx, moved, "SENT_TO_REVIEW", "", "Review Queue", groupID); err != nil {
				return err
			}
			resp["affected"] = moved

		case "ignore_warnings":
			closedDate, _, hasClosed := getBooksClosedDate(tx)
			endOfClosed := closedDate.Add(24 * time.Hour)
			for _, it := range requested {
				isOpenPending := it.ReviewStatus == "PENDING" && (!hasClosed || !it.Date.Before(endOfClosed))
				if !isNormalReviewStatus(it.ReviewStatus) && !isOpenPending {
					return newResolveError(fiber.StatusConflict, "Warnings can only be ignored on items that are in the books or open-period warning items.")
				}
			}
			txIDs, expIDs, invIDs := splitItemIDs(requested)
			if err := applyReviewStatus(tx, txIDs, expIDs, invIDs, map[string]interface{}{"review_status": "WARNINGS_IGNORED", "exclusion_reason": "", "exclusion_note": ""}); err != nil {
				return err
			}
			if err := writeReviewAudit(tx, requested, "WARNINGS_IGNORED", "", "Review Queue", groupID); err != nil {
				return err
			}
			resp["affected"] = requested

		case "restore_warnings":
			for _, it := range requested {
				if it.ReviewStatus != "WARNINGS_IGNORED" {
					return newResolveError(fiber.StatusConflict, "Warnings are not currently ignored on some of the selected items.")
				}
			}
			txIDs, expIDs, invIDs := splitItemIDs(requested)
			if err := applyReviewStatus(tx, txIDs, expIDs, invIDs, map[string]interface{}{"review_status": "APPROVED"}); err != nil {
				return err
			}
			if err := writeReviewAudit(tx, requested, "WARNINGS_RESTORED", "", "Review Queue", groupID); err != nil {
				return err
			}
			resp["affected"] = requested

		case "delete":
			if locked := groupLockedItem(requested); locked != nil {
				return newResolveError(fiber.StatusForbidden, "Cannot delete items from a locked accounting period. Unlock the books first.")
			}
			txIDs, expIDs, invIDs := splitItemIDs(requested)
			now := time.Now()
			if len(txIDs) > 0 {
				tx.Where("bank_transaction_id IN ?", txIDs).Delete(&models.ExpenseBankTransaction{})
			}
			if len(expIDs) > 0 {
				tx.Where("expense_id IN ?", expIDs).Delete(&models.ExpenseBankTransaction{})
			}
			if len(invIDs) > 0 {
				tx.Model(&models.Invoice{}).Where("id IN ?", invIDs).Updates(map[string]interface{}{"bank_transaction_id": nil})
			}
			if err := applyReviewStatus(tx, txIDs, expIDs, invIDs, map[string]interface{}{"review_status": "DELETED", "deleted_at": now}); err != nil {
				return err
			}
			if err := writeReviewAudit(tx, requested, "DELETED", "", "Review Queue", groupID); err != nil {
				return err
			}
			resp["affected"] = requested
		}
		return nil
	})

	if err != nil {
		var re *resolveError
		if errors.As(err, &re) {
			return c.Status(re.status).JSON(fiber.Map{"error": re.msg})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update items"})
	}

	// Allowing or (un)ignoring warnings changes which items are flagged.
	utils.RunReconciliation()
	broadcastReconciliationSync()

	return c.JSON(resp)
}

// reopenBooksForAllowedItems moves BooksClosedDate back to the day before the oldest allowed
// item (an allowed item must sit in an open period), then approves every other pending item
// that is no longer in a closed period as a result.
func reopenBooksForAllowedItems(tx *gorm.DB, allowed []GroupItem, groupID string) (rolledBack bool, newClosedDate string, autoApproved int, err error) {
	closedDate, closedRaw, hasClosed := getBooksClosedDate(tx)
	newClosedDate = closedRaw
	if !hasClosed || len(allowed) == 0 {
		return
	}

	oldest := allowed[0].Date
	for _, it := range allowed {
		if it.Date.Before(oldest) {
			oldest = it.Date
		}
	}

	// Compare on calendar days so a time-of-day component never changes the outcome.
	oldestDay := time.Date(oldest.Year(), oldest.Month(), oldest.Day(), 0, 0, 0, 0, time.UTC)
	target := oldestDay.AddDate(0, 0, -1)
	if target.Before(closedDate) {
		newValue := target.Format("2006-01-02")
		if err = tx.Model(&models.AppSetting{}).Where("key = ?", booksClosedDateKey).Update("value", newValue).Error; err != nil {
			return
		}
		if err = tx.Create(&models.PeriodAuditLog{
			Action:       "ROLLED_BACK",
			PreviousDate: closedRaw,
			NewDate:      newValue,
			Reason:       "Review Queue: items allowed back into the books",
		}).Error; err != nil {
			return
		}
		rolledBack = true
		newClosedDate = newValue
		closedDate = target
	}

	// Every other pending item that is now outside the closed period must not stay in the queue.
	endOfClosed := closedDate.Add(24 * time.Hour)
	var others []GroupItem

	var txs []models.BankTransaction
	if err = tx.Where("review_status = ? AND date >= ?", "PENDING", endOfClosed).Find(&txs).Error; err != nil {
		return
	}
	for _, t := range txs {
		others = append(others, GroupItem{Type: "transaction", ID: t.ID, Label: t.Description, Date: t.Date, Amount: t.Amount, ReviewStatus: t.ReviewStatus})
	}
	var exps []models.Expense
	if err = tx.Where("review_status = ? AND timestamp >= ? AND COALESCE(description, '') NOT LIKE '%[MISSING AMOUNT%' AND COALESCE(description, '') NOT LIKE '%[MISSING DATE%' AND COALESCE(description, '') NOT LIKE '%AI extraction unavailable%'", "PENDING", endOfClosed).Find(&exps).Error; err != nil {
		return
	}
	for _, e := range exps {
		others = append(others, GroupItem{Type: "expense", ID: e.ID, Label: e.Vendor, Date: e.Timestamp, Amount: e.Amount, ReviewStatus: e.ReviewStatus})
	}
	var invs []models.Invoice
	if err = tx.Where("review_status = ? AND issue_date >= ?", "PENDING", endOfClosed).Find(&invs).Error; err != nil {
		return
	}
	for _, iv := range invs {
		others = append(others, GroupItem{Type: "invoice", ID: iv.ID, Label: strings.TrimSpace(iv.InvoiceNumber + " " + iv.ClientName), Date: iv.IssueDate, Amount: iv.TotalAmount, ReviewStatus: iv.ReviewStatus})
	}
	if len(others) > 0 {
		otherTx, otherExp, otherInv := splitItemIDs(others)
		if err = applyReviewStatus(tx, otherTx, otherExp, otherInv, map[string]interface{}{"review_status": "APPROVED"}); err != nil {
			return
		}
		if err = writeReviewAudit(tx, others, "APPROVED", "", "Auto-approved: books were reopened past this item", groupID); err != nil {
			return
		}
		autoApproved = len(others)
	}
	return
}

// BatchCategorizeRequest defines the payload for batch assigning a category
type BatchCategorizeRequest struct {
	TransactionIDs []uint `json:"transactionIds"`
	ExpenseIDs     []uint `json:"expenseIds"`
	InvoiceIDs     []uint `json:"invoiceIds"`
	CategoryID     uint   `json:"categoryId"`
}

// BatchCategorizeItems updates the category on multiple transactions, expenses, and invoices in a single atomic transaction.
func BatchCategorizeItems(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var req BatchCategorizeRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if len(req.TransactionIDs) == 0 && len(req.ExpenseIDs) == 0 && len(req.InvoiceIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No items were selected."})
	}

	if req.CategoryID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Category account is required."})
	}

	var catAccount models.ChartAccount
	if err := db.DB.First(&catAccount, req.CategoryID).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Category account not found"})
	}

	if !catAccount.Active {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot assign an archived or inactive category."})
	}

	if len(req.ExpenseIDs) > 0 && catAccount.Type != "EXPENSE" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Expenses may only be categorized under EXPENSE accounts."})
	}

	groupID := fmt.Sprintf("BATCH_CAT_%d", time.Now().UnixNano())

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		// Check for closed period violations
		if len(req.TransactionIDs) > 0 {
			var txs []models.BankTransaction
			if err := tx.Where("id IN ?", req.TransactionIDs).Find(&txs).Error; err != nil {
				return err
			}
			for _, t := range txs {
				if utils.IsDateInClosedPeriod(t.Date) {
					return fmt.Errorf("transaction %d is in a closed accounting period", t.ID)
				}
			}

			// Update transaction category
			if err := tx.Model(&models.BankTransaction{}).
				Where("id IN ?", req.TransactionIDs).
				Update("category_account_id", req.CategoryID).Error; err != nil {
				return err
			}

			// If category is EXPENSE, sync to 1:1 linked expenses
			if catAccount.Type == "EXPENSE" {
				for _, tID := range req.TransactionIDs {
					var linkedExpCount int64
					tx.Model(&models.ExpenseBankTransaction{}).
						Where("bank_transaction_id = ? AND status = 'confirmed'", tID).
						Count(&linkedExpCount)
					if linkedExpCount == 1 {
						tx.Exec("UPDATE expenses SET chart_account_id = ? WHERE id IN (SELECT expense_id FROM expense_bank_transactions WHERE bank_transaction_id = ? AND status = 'confirmed')", req.CategoryID, tID)
					}
				}
			}

			// Audit logs
			for _, tID := range req.TransactionIDs {
				_ = tx.Create(&models.ItemAuditLog{
					ItemType: "transaction",
					ItemID:   tID,
					Action:   "BATCH_CATEGORIZE",
					Reason:   fmt.Sprintf("Category set to %s - %s", catAccount.Code, catAccount.Name),
					GroupID:  groupID,
				})
			}
		}

		if len(req.ExpenseIDs) > 0 {
			var exps []models.Expense
			if err := tx.Where("id IN ?", req.ExpenseIDs).Find(&exps).Error; err != nil {
				return err
			}
			for _, e := range exps {
				if utils.IsDateInClosedPeriod(e.Timestamp) {
					return fmt.Errorf("expense %d is in a closed accounting period", e.ID)
				}
			}

			// Update expense category
			if err := tx.Model(&models.Expense{}).
				Where("id IN ?", req.ExpenseIDs).
				Update("chart_account_id", req.CategoryID).Error; err != nil {
				return err
			}

			// Sync to 1:1 linked bank transactions
			for _, eID := range req.ExpenseIDs {
				var parentTxIDs []uint
				tx.Model(&models.ExpenseBankTransaction{}).
					Where("expense_id = ? AND status = 'confirmed'", eID).
					Pluck("bank_transaction_id", &parentTxIDs)
				for _, parentID := range parentTxIDs {
					var siblingCount int64
					tx.Model(&models.ExpenseBankTransaction{}).
						Where("bank_transaction_id = ? AND status = 'confirmed'", parentID).
						Count(&siblingCount)
					if siblingCount == 1 {
						tx.Model(&models.BankTransaction{}).
							Where("id = ?", parentID).
							Update("category_account_id", req.CategoryID)
					}
				}
			}

			// Audit logs
			for _, eID := range req.ExpenseIDs {
				_ = tx.Create(&models.ItemAuditLog{
					ItemType: "expense",
					ItemID:   eID,
					Action:   "BATCH_CATEGORIZE",
					Reason:   fmt.Sprintf("Category set to %s - %s", catAccount.Code, catAccount.Name),
					GroupID:  groupID,
				})
			}
		}

		if len(req.InvoiceIDs) > 0 {
			var invs []models.Invoice
			if err := tx.Where("id IN ?", req.InvoiceIDs).Find(&invs).Error; err != nil {
				return err
			}
			for _, iv := range invs {
				if utils.IsDateInClosedPeriod(iv.IssueDate) {
					return fmt.Errorf("invoice %d is in a closed accounting period", iv.ID)
				}
			}

			if err := tx.Model(&models.Invoice{}).
				Where("id IN ?", req.InvoiceIDs).
				Update("category_account_id", req.CategoryID).Error; err != nil {
				return err
			}

			for _, ivID := range req.InvoiceIDs {
				_ = tx.Create(&models.ItemAuditLog{
					ItemType: "invoice",
					ItemID:   ivID,
					Action:   "BATCH_CATEGORIZE",
					Reason:   fmt.Sprintf("Category set to %s - %s", catAccount.Code, catAccount.Name),
					GroupID:  groupID,
				})
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	totalUpdated := len(req.TransactionIDs) + len(req.ExpenseIDs) + len(req.InvoiceIDs)
	utils.RunReconciliation()
	broadcastReconciliationSync()
	events.Broadcast("INVOICES_UPDATED", nil)

	return c.JSON(fiber.Map{
		"status":  "success",
		"message": fmt.Sprintf("Successfully categorized %d items as %s - %s", totalUpdated, catAccount.Code, catAccount.Name),
		"count":   totalUpdated,
	})
}
