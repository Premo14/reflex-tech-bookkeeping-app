package controllers

import (
	"fmt"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

var validExclusionReasons = map[string]bool{
	"DUPLICATE": true,
	"PERSONAL":  true,
	"ERROR":     true,
	"OTHER":     true,
}

// GroupItem is a compact description of one member of a link group.
type GroupItem struct {
	Type         string    `json:"type"` // "transaction" or "expense"
	ID           uint      `json:"id"`
	Label        string    `json:"label"`
	Date         time.Time `json:"date"`
	Amount       float64   `json:"amount"`
	ReviewStatus string    `json:"reviewStatus"`
}

// collectLinkGroup returns the connected component (through confirmed expense<->transaction
// links) that contains the given starting item. Covers one-to-many splits in either direction.
func collectLinkGroup(tx *gorm.DB, itemType string, id uint) (txIDs []uint, expIDs []uint) {
	seenTx := map[uint]bool{}
	seenExp := map[uint]bool{}

	type node struct {
		isTx bool
		id   uint
	}
	queue := []node{{itemType == "transaction", id}}
	if itemType == "transaction" {
		seenTx[id] = true
	} else {
		seenExp[id] = true
	}

	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]

		var links []models.ExpenseBankTransaction
		if n.isTx {
			tx.Where("bank_transaction_id = ? AND status = ?", n.id, "confirmed").Find(&links)
			for _, l := range links {
				if !seenExp[l.ExpenseID] {
					seenExp[l.ExpenseID] = true
					queue = append(queue, node{false, l.ExpenseID})
				}
			}
		} else {
			tx.Where("expense_id = ? AND status = ?", n.id, "confirmed").Find(&links)
			for _, l := range links {
				if !seenTx[l.BankTransactionID] {
					seenTx[l.BankTransactionID] = true
					queue = append(queue, node{true, l.BankTransactionID})
				}
			}
		}
	}

	for id := range seenTx {
		txIDs = append(txIDs, id)
	}
	for id := range seenExp {
		expIDs = append(expIDs, id)
	}
	return
}

// expandToLinkGroups returns the union of the link groups of every supplied item.
func expandToLinkGroups(tx *gorm.DB, txIDs, expIDs []uint) ([]uint, []uint) {
	allTx := map[uint]bool{}
	allExp := map[uint]bool{}
	for _, id := range txIDs {
		if allTx[id] {
			continue
		}
		t, e := collectLinkGroup(tx, "transaction", id)
		for _, x := range t {
			allTx[x] = true
		}
		for _, x := range e {
			allExp[x] = true
		}
	}
	for _, id := range expIDs {
		if allExp[id] {
			continue
		}
		t, e := collectLinkGroup(tx, "expense", id)
		for _, x := range t {
			allTx[x] = true
		}
		for _, x := range e {
			allExp[x] = true
		}
	}
	var outTx, outExp []uint
	for id := range allTx {
		outTx = append(outTx, id)
	}
	for id := range allExp {
		outExp = append(outExp, id)
	}
	return outTx, outExp
}

func loadGroupItems(tx *gorm.DB, txIDs, expIDs []uint) []GroupItem {
	items := []GroupItem{}
	if len(txIDs) > 0 {
		var txs []models.BankTransaction
		tx.Where("id IN ?", txIDs).Order("date ASC").Find(&txs)
		for _, t := range txs {
			items = append(items, GroupItem{"transaction", t.ID, t.Description, t.Date, t.Amount, t.ReviewStatus})
		}
	}
	if len(expIDs) > 0 {
		var exps []models.Expense
		tx.Where("id IN ?", expIDs).Order("timestamp ASC").Find(&exps)
		for _, e := range exps {
			items = append(items, GroupItem{"expense", e.ID, strings.TrimSpace(e.Vendor + " " + e.Description), e.Timestamp, e.Amount, e.ReviewStatus})
		}
	}
	return items
}

// groupLockedItem returns the first group item that sits in a locked period (ignoring
// PENDING items, which by definition were flagged because they fall in a closed period).
func groupLockedItem(items []GroupItem) *GroupItem {
	for i := range items {
		if items[i].ReviewStatus == "PENDING" {
			continue
		}
		if utils.IsDateInClosedPeriod(items[i].Date) {
			return &items[i]
		}
	}
	return nil
}

type exclusionInput struct {
	Type   string `json:"type"` // "transaction" or "expense"
	ID     uint   `json:"id"`
	Reason string `json:"reason"`
	Note   string `json:"note"`
}

func parseExclusionInput(c fiber.Ctx) (exclusionInput, error) {
	var in exclusionInput
	if err := c.Bind().JSON(&in); err != nil {
		return in, fmt.Errorf("invalid input")
	}
	if in.Type != "transaction" && in.Type != "expense" {
		return in, fmt.Errorf("type must be 'transaction' or 'expense'")
	}
	if in.ID == 0 {
		return in, fmt.Errorf("id is required")
	}
	return in, nil
}

// ExcludePreview describes everything that would be affected by excluding or restoring an
// item, so the UI can warn the user before they confirm.
func ExcludePreview(c fiber.Ctx) error {
	in, err := parseExclusionInput(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	txIDs, expIDs := collectLinkGroup(db.DB, in.Type, in.ID)
	items := loadGroupItems(db.DB, txIDs, expIDs)

	resp := fiber.Map{"items": items, "blocked": false, "blockedReason": ""}
	if locked := groupLockedItem(items); locked != nil {
		resp["blocked"] = true
		if locked.Type == in.Type && locked.ID == in.ID {
			resp["blockedReason"] = "This item falls in a locked accounting period. Unlock the books (Lock Books) before changing it."
		} else {
			resp["blockedReason"] = fmt.Sprintf("A linked item (%s, %s) falls in a locked accounting period, and linked items must be handled together. Unlock the books first.", locked.Label, locked.Date.Format("Jan 2, 2006"))
		}
	}
	return c.JSON(resp)
}

// ExcludeItem excludes an item and its entire link group from the books.
func ExcludeItem(c fiber.Ctx) error {
	in, err := parseExclusionInput(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	in.Reason = strings.ToUpper(strings.TrimSpace(in.Reason))
	in.Note = strings.TrimSpace(in.Note)
	if !validExclusionReasons[in.Reason] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "A valid exclusion reason is required."})
	}
	if in.Reason == "OTHER" && in.Note == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "A note is required when the reason is 'Other'."})
	}

	tx := db.DB.Begin()

	txIDs, expIDs := collectLinkGroup(tx, in.Type, in.ID)
	items := loadGroupItems(tx, txIDs, expIDs)

	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "This item (or an item linked to it) is in a locked accounting period. Unlock the books first."})
	}
	for _, it := range items {
		if it.ReviewStatus == "IGNORED" {
			tx.Rollback()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "This item is already excluded."})
		}
	}

	fields := map[string]interface{}{"review_status": "IGNORED", "exclusion_reason": in.Reason, "exclusion_note": in.Note}
	if len(txIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", txIDs).Updates(fields)
		// Drop any suggestions that involve an excluded item.
		tx.Where("bank_transaction_id IN ? AND status = ?", txIDs, "suggested").Delete(&models.ExpenseBankTransaction{})
	}
	if len(expIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", expIDs).Updates(fields)
		tx.Where("expense_id IN ? AND status = ?", expIDs, "suggested").Delete(&models.ExpenseBankTransaction{})
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "EXCLUDED", Reason: in.Reason, Note: in.Note, GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to exclude item"})
	}

	// Refresh suggestion flags for the items that were suggested against the excluded ones.
	utils.UpdateReconciliationStatuses()

	return c.JSON(fiber.Map{"status": "success", "affected": items})
}

// RestoreItem restores an excluded item and its entire link group to the books.
func RestoreItem(c fiber.Ctx) error {
	in, err := parseExclusionInput(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	tx := db.DB.Begin()

	txIDs, expIDs := collectLinkGroup(tx, in.Type, in.ID)
	items := loadGroupItems(tx, txIDs, expIDs)

	for _, it := range items {
		if it.ReviewStatus != "IGNORED" {
			tx.Rollback()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "This item is not currently excluded."})
		}
	}
	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "This item (or an item linked to it) falls in a locked accounting period. Unlock the books first, or send it to the Review Queue."})
	}

	fields := map[string]interface{}{"review_status": "APPROVED", "exclusion_reason": "", "exclusion_note": ""}
	if len(txIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", txIDs).Updates(fields)
	}
	if len(expIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", expIDs).Updates(fields)
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "RESTORED", GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to restore item"})
	}

	utils.RunReconciliation()

	return c.JSON(fiber.Map{"status": "success", "affected": items})
}
