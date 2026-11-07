package controllers

import (
	"errors"
	"fmt"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

const booksClosedDateKey = "BooksClosedDate"

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
	closedDate, _, hasClosed := getBooksClosedDate(db.DB)

	var pendingTxCount int64
	var pendingExpCount int64

	if hasClosed {
		endOfClosed := closedDate.Add(24 * time.Hour)
		db.DB.Model(&models.BankTransaction{}).
			Where("(review_status = 'PENDING' AND date < ?) OR ((allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED'))", endOfClosed).
			Count(&pendingTxCount)

		db.DB.Model(&models.Expense{}).
			Where("(review_status = 'PENDING' AND timestamp < ?) OR (LOWER(COALESCE(tender, '')) != 'cash' AND (allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED'))", endOfClosed).
			Count(&pendingExpCount)
	} else {
		db.DB.Model(&models.BankTransaction{}).
			Where("(allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')").
			Count(&pendingTxCount)

		db.DB.Model(&models.Expense{}).
			Where("LOWER(COALESCE(tender, '')) != 'cash' AND (allocation_status IS NULL OR allocation_status != 'BALANCED') AND (review_status IS NULL OR review_status = '' OR review_status = 'APPROVED')").
			Count(&pendingExpCount)
	}

	var ignoredTxCount, ignoredExpCount int64
	db.DB.Model(&models.BankTransaction{}).Where("review_status = 'IGNORED'").Count(&ignoredTxCount)
	db.DB.Model(&models.Expense{}).Where("review_status = 'IGNORED'").Count(&ignoredExpCount)

	var warnTxCount, warnExpCount int64
	db.DB.Model(&models.BankTransaction{}).Where("review_status = 'WARNINGS_IGNORED'").Count(&warnTxCount)
	db.DB.Model(&models.Expense{}).Where("review_status = 'WARNINGS_IGNORED'").Count(&warnExpCount)

	var delTxCount, delExpCount int64
	db.DB.Model(&models.BankTransaction{}).Where("review_status = 'DELETED'").Count(&delTxCount)
	db.DB.Model(&models.Expense{}).Where("review_status = 'DELETED'").Count(&delExpCount)

	return c.JSON(fiber.Map{
		"pending":         pendingTxCount + pendingExpCount,
		"excluded":        ignoredTxCount + ignoredExpCount,
		"warningsIgnored": warnTxCount + warnExpCount,
		"deleted":         delTxCount + delExpCount,
	})
}

// GetReviewQueue returns the items for one of the review lists:
//   - PENDING: items awaiting a decision because they fall in a closed period
//   - IGNORED: items that were excluded from the books
//   - WARNINGS_IGNORED: items that are in the books but whose warnings were silenced
//   - DELETED: items soft-deleted from the books, held for 30 days before permanent purge
func GetReviewQueue(c fiber.Ctx) error {
	status := c.Query("status", "PENDING")
	if status != "PENDING" && status != "IGNORED" && status != "WARNINGS_IGNORED" && status != "DELETED" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "status must be PENDING, IGNORED, WARNINGS_IGNORED or DELETED"})
	}

	closedDate, closedRaw, hasClosed := getBooksClosedDate(db.DB)

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
			db.DB.Where("expense_id IN ?", oldExpIDs).Delete(&models.ExpenseBankTransaction{})
			db.DB.Where("expense_id IN ?", oldExpIDs).Delete(&models.Receipt{})
			db.DB.Where("id IN ?", oldExpIDs).Delete(&models.Expense{})
		}
	}

	queryTx := db.DB.Where("review_status = ?", status)
	queryExp := db.DB.Where("review_status = ?", status)

	if status == "PENDING" {
		if !hasClosed {
			return c.JSON(fiber.Map{
				"status":          "success",
				"transactions":    []models.BankTransaction{},
				"expenses":        []models.Expense{},
				"booksClosedDate": closedRaw,
			})
		}
		endOfClosed := closedDate.Add(24 * time.Hour)
		queryTx = queryTx.Where("date < ?", endOfClosed)
		queryExp = queryExp.Where("timestamp < ?", endOfClosed)
	}

	orderTx := "date DESC"
	orderExp := "timestamp DESC"
	if status == "DELETED" {
		orderTx = "COALESCE(deleted_at, updated_at) DESC, date DESC"
		orderExp = "COALESCE(deleted_at, updated_at) DESC, timestamp DESC"
	}

	txs := []models.BankTransaction{}
	if err := queryTx.Preload("ChartAccount").Preload("Category").Order(orderTx).Find(&txs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load transactions"})
	}

	exps := []models.Expense{}
	if err := queryExp.Preload("ChartAccount").Order(orderExp).Find(&exps).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load expenses"})
	}

	return c.JSON(fiber.Map{
		"status":          "success",
		"transactions":    txs,
		"expenses":        exps,
		"booksClosedDate": closedRaw,
	})
}

type ResolveRequest struct {
	TransactionIDs []uint `json:"transactionIds"`
	ExpenseIDs     []uint `json:"expenseIds"`
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

func splitItemIDs(items []GroupItem) (txIDs []uint, expIDs []uint) {
	for _, it := range items {
		if it.Type == "transaction" {
			txIDs = append(txIDs, it.ID)
		} else {
			expIDs = append(expIDs, it.ID)
		}
	}
	return
}

func isNormalReviewStatus(s string) bool {
	return s == "" || s == "APPROVED"
}

func applyReviewStatus(tx *gorm.DB, txIDs, expIDs []uint, fields map[string]interface{}) error {
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
	var req ResolveRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid input"})
	}
	if len(req.TransactionIDs) == 0 && len(req.ExpenseIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No items were selected."})
	}

	switch req.Action {
	case "allow", "pending", "ignore_warnings", "restore_warnings", "delete":
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unknown action."})
	}

	resp := fiber.Map{"status": "success"}

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		requested := loadGroupItems(tx, req.TransactionIDs, req.ExpenseIDs)
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
			txIDs, expIDs := expandToLinkGroups(tx, req.TransactionIDs, req.ExpenseIDs)
			var allowed []GroupItem
			for _, it := range loadGroupItems(tx, txIDs, expIDs) {
				if it.ReviewStatus == "PENDING" {
					allowed = append(allowed, it)
				}
			}
			allowTx, allowExp := splitItemIDs(allowed)
			if err := applyReviewStatus(tx, allowTx, allowExp, map[string]interface{}{"review_status": "APPROVED", "exclusion_reason": "", "exclusion_note": ""}); err != nil {
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
			txIDs, expIDs := expandToLinkGroups(tx, req.TransactionIDs, req.ExpenseIDs)
			var moved []GroupItem
			for _, it := range loadGroupItems(tx, txIDs, expIDs) {
				if it.ReviewStatus == "IGNORED" {
					moved = append(moved, it)
				}
			}
			moveTx, moveExp := splitItemIDs(moved)
			if err := applyReviewStatus(tx, moveTx, moveExp, map[string]interface{}{"review_status": "PENDING", "exclusion_reason": "", "exclusion_note": ""}); err != nil {
				return err
			}
			if err := writeReviewAudit(tx, moved, "SENT_TO_REVIEW", "", "Review Queue", groupID); err != nil {
				return err
			}
			resp["affected"] = moved

		case "ignore_warnings":
			for _, it := range requested {
				if !isNormalReviewStatus(it.ReviewStatus) {
					return newResolveError(fiber.StatusConflict, "Warnings can only be ignored on items that are in the books and not already excluded or awaiting review.")
				}
			}
			txIDs, expIDs := splitItemIDs(requested)
			if err := applyReviewStatus(tx, txIDs, expIDs, map[string]interface{}{"review_status": "WARNINGS_IGNORED", "exclusion_reason": "", "exclusion_note": ""}); err != nil {
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
			txIDs, expIDs := splitItemIDs(requested)
			if err := applyReviewStatus(tx, txIDs, expIDs, map[string]interface{}{"review_status": "APPROVED"}); err != nil {
				return err
			}
			if err := writeReviewAudit(tx, requested, "WARNINGS_RESTORED", "", "Review Queue", groupID); err != nil {
				return err
			}
			resp["affected"] = requested

		case "delete":
			txIDs, expIDs := splitItemIDs(requested)
			now := time.Now()
			if len(txIDs) > 0 {
				tx.Where("bank_transaction_id IN ?", txIDs).Delete(&models.ExpenseBankTransaction{})
			}
			if len(expIDs) > 0 {
				tx.Where("expense_id IN ?", expIDs).Delete(&models.ExpenseBankTransaction{})
			}
			if err := applyReviewStatus(tx, txIDs, expIDs, map[string]interface{}{"review_status": "DELETED", "deleted_at": now}); err != nil {
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
	BroadcastEvent("QUEUE_UPDATED", nil)
	BroadcastEvent("TRANSACTIONS_UPDATED", nil)
	BroadcastEvent("EXPENSES_UPDATED", nil)

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
	if err = tx.Where("review_status = ? AND timestamp >= ?", "PENDING", endOfClosed).Find(&exps).Error; err != nil {
		return
	}
	for _, e := range exps {
		others = append(others, GroupItem{Type: "expense", ID: e.ID, Label: e.Vendor, Date: e.Timestamp, Amount: e.Amount, ReviewStatus: e.ReviewStatus})
	}
	if len(others) > 0 {
		otherTx, otherExp := splitItemIDs(others)
		if err = applyReviewStatus(tx, otherTx, otherExp, map[string]interface{}{"review_status": "APPROVED"}); err != nil {
			return
		}
		if err = writeReviewAudit(tx, others, "APPROVED", "", "Auto-approved: books were reopened past this item", groupID); err != nil {
			return
		}
		autoApproved = len(others)
	}
	return
}
