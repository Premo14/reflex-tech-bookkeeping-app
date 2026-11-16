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
	Type         string       `json:"type"` // "transaction", "expense", or "invoice"
	ID           uint         `json:"id"`
	Label        string       `json:"label"`
	Date         time.Time    `json:"date"`
	Amount       models.Money `json:"amount"`
	ReviewStatus string       `json:"reviewStatus"`
}

// collectLinkGroup returns the connected component (through confirmed expense<->transaction
// links and invoice<->bank_transaction payment links) that contains the given starting item.
func collectLinkGroup(tx *gorm.DB, itemType string, id uint) (txIDs []uint, expIDs []uint, invIDs []uint) {
	seenTx := map[uint]bool{}
	seenExp := map[uint]bool{}
	seenInv := map[uint]bool{}

	type node struct {
		kind string // "transaction", "expense", "invoice"
		id   uint
	}
	queue := []node{{itemType, id}}
	switch itemType {
	case "transaction":
		seenTx[id] = true
	case "expense":
		seenExp[id] = true
	case "invoice":
		seenInv[id] = true
	}

	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]

		switch n.kind {
		case "transaction":
			var links []models.ExpenseBankTransaction
			tx.Where("bank_transaction_id = ? AND status = ?", n.id, "confirmed").Find(&links)
			for _, l := range links {
				if !seenExp[l.ExpenseID] {
					seenExp[l.ExpenseID] = true
					queue = append(queue, node{"expense", l.ExpenseID})
				}
			}
			var invs []models.Invoice
			tx.Where("bank_transaction_id = ?", n.id).Find(&invs)
			for _, iv := range invs {
				if !seenInv[iv.ID] {
					seenInv[iv.ID] = true
					queue = append(queue, node{"invoice", iv.ID})
				}
			}
		case "expense":
			var links []models.ExpenseBankTransaction
			tx.Where("expense_id = ? AND status = ?", n.id, "confirmed").Find(&links)
			for _, l := range links {
				if !seenTx[l.BankTransactionID] {
					seenTx[l.BankTransactionID] = true
					queue = append(queue, node{"transaction", l.BankTransactionID})
				}
			}
		case "invoice":
			var iv models.Invoice
			if err := tx.First(&iv, n.id).Error; err == nil && iv.BankTransactionID != nil {
				if !seenTx[*iv.BankTransactionID] {
					seenTx[*iv.BankTransactionID] = true
					queue = append(queue, node{"transaction", *iv.BankTransactionID})
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
	for id := range seenInv {
		invIDs = append(invIDs, id)
	}
	return
}

// expandToLinkGroups returns the union of the link groups of every supplied item.
func expandToLinkGroups(tx *gorm.DB, txIDs, expIDs, invIDs []uint) ([]uint, []uint, []uint) {
	allTx := map[uint]bool{}
	allExp := map[uint]bool{}
	allInv := map[uint]bool{}
	for _, id := range txIDs {
		if allTx[id] {
			continue
		}
		t, e, iv := collectLinkGroup(tx, "transaction", id)
		for _, x := range t {
			allTx[x] = true
		}
		for _, x := range e {
			allExp[x] = true
		}
		for _, x := range iv {
			allInv[x] = true
		}
	}
	for _, id := range expIDs {
		if allExp[id] {
			continue
		}
		t, e, iv := collectLinkGroup(tx, "expense", id)
		for _, x := range t {
			allTx[x] = true
		}
		for _, x := range e {
			allExp[x] = true
		}
		for _, x := range iv {
			allInv[x] = true
		}
	}
	for _, id := range invIDs {
		if allInv[id] {
			continue
		}
		t, e, iv := collectLinkGroup(tx, "invoice", id)
		for _, x := range t {
			allTx[x] = true
		}
		for _, x := range e {
			allExp[x] = true
		}
		for _, x := range iv {
			allInv[x] = true
		}
	}
	var outTx, outExp, outInv []uint
	for id := range allTx {
		outTx = append(outTx, id)
	}
	for id := range allExp {
		outExp = append(outExp, id)
	}
	for id := range allInv {
		outInv = append(outInv, id)
	}
	return outTx, outExp, outInv
}

func loadGroupItems(tx *gorm.DB, txIDs, expIDs, invIDs []uint) []GroupItem {
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
	if len(invIDs) > 0 {
		var invs []models.Invoice
		tx.Where("id IN ?", invIDs).Order("issue_date ASC").Find(&invs)
		for _, iv := range invs {
			items = append(items, GroupItem{"invoice", iv.ID, strings.TrimSpace(iv.InvoiceNumber + " " + iv.ClientName), iv.IssueDate, iv.TotalAmount, iv.ReviewStatus})
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
	Type       string `json:"type"` // "transaction", "expense", or "invoice"
	ID         uint   `json:"id"`
	Reason     string `json:"reason"`
	Note       string `json:"note"`
	UnlinkOnly bool   `json:"unlinkOnly"`
}

func parseExclusionInput(c fiber.Ctx) (exclusionInput, error) {
	var in exclusionInput
	if err := c.Bind().JSON(&in); err != nil {
		return in, fmt.Errorf("invalid input")
	}
	if in.Type != "transaction" && in.Type != "expense" && in.Type != "invoice" {
		return in, fmt.Errorf("type must be 'transaction', 'expense', or 'invoice'")
	}
	if in.ID == 0 {
		return in, fmt.Errorf("id is required")
	}
	return in, nil
}

// ExcludePreview describes everything that would be affected by excluding or restoring an
// item, so the UI can warn the user before they confirm.
func ExcludePreview(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	in, err := parseExclusionInput(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	txIDs, expIDs, invIDs := collectLinkGroup(db.DB, in.Type, in.ID)
	items := loadGroupItems(db.DB, txIDs, expIDs, invIDs)

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
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
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

	var txIDs, expIDs, invIDs []uint
	if in.UnlinkOnly {
		switch in.Type {
		case "transaction":
			txIDs = []uint{in.ID}
		case "expense":
			expIDs = []uint{in.ID}
		case "invoice":
			invIDs = []uint{in.ID}
		}
	} else {
		txIDs, expIDs, invIDs = collectLinkGroup(tx, in.Type, in.ID)
	}
	items := loadGroupItems(tx, txIDs, expIDs, invIDs)
	if len(items) == 0 {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Item not found."})
	}

	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "This item (or an item linked to it) is in a locked accounting period. Unlock the books first."})
	}
	for _, it := range items {
		if it.ReviewStatus == "IGNORED" || it.ReviewStatus == "DELETED" {
			tx.Rollback()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "This item is already excluded or deleted."})
		}
	}

	if in.UnlinkOnly {
		if in.Type == "transaction" {
			tx.Where("bank_transaction_id = ?", in.ID).Delete(&models.ExpenseBankTransaction{})
		} else if in.Type == "expense" {
			tx.Where("expense_id = ?", in.ID).Delete(&models.ExpenseBankTransaction{})
		} else if in.Type == "invoice" {
			tx.Model(&models.Invoice{}).Where("id = ?", in.ID).Updates(map[string]interface{}{"bank_transaction_id": nil})
		}
	}

	fields := map[string]interface{}{"review_status": "IGNORED", "exclusion_reason": in.Reason, "exclusion_note": in.Note}
	if len(txIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", txIDs).Updates(fields)
		tx.Where("bank_transaction_id IN ? AND status = ?", txIDs, "suggested").Delete(&models.ExpenseBankTransaction{})
	}
	if len(expIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", expIDs).Updates(fields)
		tx.Where("expense_id IN ? AND status = ?", expIDs, "suggested").Delete(&models.ExpenseBankTransaction{})
	}
	if len(invIDs) > 0 {
		tx.Model(&models.Invoice{}).Where("id IN ?", invIDs).Updates(fields)
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "EXCLUDED", Reason: in.Reason, Note: in.Note, GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to exclude item"})
	}

	utils.RunReconciliation()
	broadcastReconciliationSync()

	return c.JSON(fiber.Map{"status": "success", "affected": items})
}

// RestoreItem restores an excluded item and its entire link group to the books.
func RestoreItem(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	in, err := parseExclusionInput(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	tx := db.DB.Begin()

	txIDs, expIDs, invIDs := collectLinkGroup(tx, in.Type, in.ID)
	items := loadGroupItems(tx, txIDs, expIDs, invIDs)
	if len(items) == 0 {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Item not found."})
	}

	for _, it := range items {
		if it.ReviewStatus != "IGNORED" && it.ReviewStatus != "WARNINGS_IGNORED" {
			tx.Rollback()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "This item is not currently excluded."})
		}
	}
	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "This item (or an item linked to it) falls in a locked accounting period. Unlock the books first, or send it to the Review Queue."})
	}

	fields := map[string]interface{}{"review_status": "APPROVED", "exclusion_reason": "", "exclusion_note": "", "deleted_at": nil}
	if len(txIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", txIDs).Updates(fields)
	}
	if len(expIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", expIDs).Updates(fields)
	}
	if len(invIDs) > 0 {
		tx.Model(&models.Invoice{}).Where("id IN ?", invIDs).Updates(fields)
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "RESTORED", GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to restore item"})
	}

	utils.RunReconciliation()
	broadcastReconciliationSync()

	return c.JSON(fiber.Map{"status": "success", "affected": items})
}

// RestoreBulk restores multiple excluded items and their link groups to the books atomically.
func RestoreBulk(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var in struct {
		Items []bulkItemRef `json:"items"`
	}
	if err := c.Bind().JSON(&in); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body."})
	}
	txIDs, expIDs, invIDs, err := parseBulkItems(in.Items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	tx := db.DB.Begin()

	allTxIDs, allExpIDs, allInvIDs := expandToLinkGroups(tx, txIDs, expIDs, invIDs)
	items := loadGroupItems(tx, allTxIDs, allExpIDs, allInvIDs)
	if len(items) == 0 {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Selected items not found."})
	}

	for _, it := range items {
		if it.ReviewStatus != "IGNORED" && it.ReviewStatus != "WARNINGS_IGNORED" {
			tx.Rollback()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": fmt.Sprintf("Item '%s' is not currently excluded.", it.Label)})
		}
	}
	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "This selection (or an item linked to it) falls in a locked accounting period. Unlock the books first, or send it to the Review Queue."})
	}

	fields := map[string]interface{}{"review_status": "APPROVED", "exclusion_reason": "", "exclusion_note": "", "deleted_at": nil}
	if len(allTxIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", allTxIDs).Updates(fields)
	}
	if len(allExpIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", allExpIDs).Updates(fields)
	}
	if len(allInvIDs) > 0 {
		tx.Model(&models.Invoice{}).Where("id IN ?", allInvIDs).Updates(fields)
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "RESTORED", GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to restore items"})
	}

	utils.RunReconciliation()
	broadcastReconciliationSync()

	return c.JSON(fiber.Map{"status": "success", "affected": items})
}

type bulkItemRef struct {
	Type string `json:"type"` // "transaction", "expense", or "invoice"
	ID   uint   `json:"id"`
}

type bulkExclusionInput struct {
	Items      []bulkItemRef `json:"items"`
	Reason     string        `json:"reason"`
	Note       string        `json:"note"`
	UnlinkOnly bool          `json:"unlinkOnly"`
}

func parseBulkItems(items []bulkItemRef) (txIDs []uint, expIDs []uint, invIDs []uint, err error) {
	if len(items) == 0 {
		return nil, nil, nil, fmt.Errorf("no items provided")
	}
	for _, it := range items {
		if it.Type != "transaction" && it.Type != "expense" && it.Type != "invoice" {
			return nil, nil, nil, fmt.Errorf("item type must be 'transaction', 'expense', or 'invoice'")
		}
		if it.ID == 0 {
			return nil, nil, nil, fmt.Errorf("item id is required")
		}
		switch it.Type {
		case "transaction":
			txIDs = append(txIDs, it.ID)
		case "expense":
			expIDs = append(expIDs, it.ID)
		case "invoice":
			invIDs = append(invIDs, it.ID)
		}
	}
	return txIDs, expIDs, invIDs, nil
}

// ExcludeBulkPreview describes everything that would be affected by excluding multiple items
// along with their link groups.
func ExcludeBulkPreview(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var in struct {
		Items []bulkItemRef `json:"items"`
	}
	if err := c.Bind().JSON(&in); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid input"})
	}
	txIDs, expIDs, invIDs, err := parseBulkItems(in.Items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	selectedItems := loadGroupItems(db.DB, txIDs, expIDs, invIDs)

	expandedTxIDs, expandedExpIDs, expandedInvIDs := expandToLinkGroups(db.DB, txIDs, expIDs, invIDs)
	items := loadGroupItems(db.DB, expandedTxIDs, expandedExpIDs, expandedInvIDs)

	resp := fiber.Map{
		"items":         items,
		"selectedItems": selectedItems,
		"blocked":       false,
		"blockedReason": "",
	}
	if locked := groupLockedItem(items); locked != nil {
		resp["blocked"] = true
		resp["blockedReason"] = fmt.Sprintf("A linked item (%s, %s) falls in a locked accounting period, and linked items must be handled together. Unlock the books first.", locked.Label, locked.Date.Format("Jan 2, 2006"))
	}
	return c.JSON(resp)
}

// ExcludeBulk excludes multiple items and their entire link groups from the books.
func ExcludeBulk(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var in bulkExclusionInput
	if err := c.Bind().JSON(&in); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid input"})
	}
	in.Reason = strings.ToUpper(strings.TrimSpace(in.Reason))
	in.Note = strings.TrimSpace(in.Note)
	if !validExclusionReasons[in.Reason] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "A valid exclusion reason is required."})
	}
	if in.Reason == "OTHER" && in.Note == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "A note is required when the reason is 'Other'."})
	}
	txIDs, expIDs, invIDs, err := parseBulkItems(in.Items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	tx := db.DB.Begin()

	var allTxIDs, allExpIDs, allInvIDs []uint
	if in.UnlinkOnly {
		allTxIDs = txIDs
		allExpIDs = expIDs
		allInvIDs = invIDs
	} else {
		allTxIDs, allExpIDs, allInvIDs = expandToLinkGroups(tx, txIDs, expIDs, invIDs)
	}
	items := loadGroupItems(tx, allTxIDs, allExpIDs, allInvIDs)
	if len(items) == 0 {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Selected items not found."})
	}

	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "This selection (or an item linked to it) is in a locked accounting period. Unlock the books first."})
	}
	for _, it := range items {
		if it.ReviewStatus == "IGNORED" || it.ReviewStatus == "DELETED" {
			tx.Rollback()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": fmt.Sprintf("Item '%s' is already excluded or deleted.", it.Label)})
		}
	}

	if in.UnlinkOnly {
		if len(allTxIDs) > 0 {
			tx.Where("bank_transaction_id IN ?", allTxIDs).Delete(&models.ExpenseBankTransaction{})
		}
		if len(allExpIDs) > 0 {
			tx.Where("expense_id IN ?", allExpIDs).Delete(&models.ExpenseBankTransaction{})
		}
		if len(allInvIDs) > 0 {
			tx.Model(&models.Invoice{}).Where("id IN ?", allInvIDs).Updates(map[string]interface{}{"bank_transaction_id": nil})
		}
	}

	fields := map[string]interface{}{"review_status": "IGNORED", "exclusion_reason": in.Reason, "exclusion_note": in.Note}
	if len(allTxIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", allTxIDs).Updates(fields)
		tx.Where("bank_transaction_id IN ? AND status = ?", allTxIDs, "suggested").Delete(&models.ExpenseBankTransaction{})
	}
	if len(allExpIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", allExpIDs).Updates(fields)
		tx.Where("expense_id IN ? AND status = ?", allExpIDs, "suggested").Delete(&models.ExpenseBankTransaction{})
	}
	if len(allInvIDs) > 0 {
		tx.Model(&models.Invoice{}).Where("id IN ?", allInvIDs).Updates(fields)
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "EXCLUDED", Reason: in.Reason, Note: in.Note, GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to exclude items"})
	}

	utils.RunReconciliation()
	broadcastReconciliationSync()

	return c.JSON(fiber.Map{"status": "success", "affected": items})
}

// DeleteBulk soft-deletes items and unlinks them from active books.
func DeleteBulk(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var in struct {
		Items []bulkItemRef `json:"items"`
	}
	if err := c.Bind().JSON(&in); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body."})
	}
	txIDs, expIDs, invIDs, err := parseBulkItems(in.Items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	tx := db.DB.Begin()
	items := loadGroupItems(tx, txIDs, expIDs, invIDs)
	if len(items) == 0 {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Selected items not found."})
	}

	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": fmt.Sprintf("Cannot delete %s from a locked period. Unlock the period first.", locked.Label),
		})
	}

	if len(txIDs) > 0 {
		tx.Where("bank_transaction_id IN ?", txIDs).Delete(&models.ExpenseBankTransaction{})
	}
	if len(expIDs) > 0 {
		tx.Where("expense_id IN ?", expIDs).Delete(&models.ExpenseBankTransaction{})
	}
	if len(invIDs) > 0 {
		tx.Model(&models.Invoice{}).Where("id IN ?", invIDs).Updates(map[string]interface{}{"bank_transaction_id": nil})
	}

	now := time.Now()
	fields := map[string]interface{}{"review_status": "DELETED", "deleted_at": now}
	if len(txIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", txIDs).Updates(fields)
	}
	if len(expIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", expIDs).Updates(fields)
	}
	if len(invIDs) > 0 {
		tx.Model(&models.Invoice{}).Where("id IN ?", invIDs).Updates(fields)
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "DELETED", GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete items"})
	}

	utils.RunReconciliation()
	broadcastReconciliationSync()
	return c.JSON(fiber.Map{"status": "success", "affected": items})
}

// RestoreDeletedBulk restores soft-deleted items back to active books (APPROVED).
func RestoreDeletedBulk(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var in struct {
		Items []bulkItemRef `json:"items"`
	}
	if err := c.Bind().JSON(&in); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body."})
	}
	txIDs, expIDs, invIDs, err := parseBulkItems(in.Items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	tx := db.DB.Begin()
	items := loadGroupItems(tx, txIDs, expIDs, invIDs)
	if len(items) == 0 {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Selected items not found."})
	}
	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": fmt.Sprintf("Cannot restore %s into a locked period. Unlock the period first.", locked.Label),
		})
	}
	for _, it := range items {
		if it.ReviewStatus != "DELETED" {
			tx.Rollback()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": fmt.Sprintf("Item '%s' is not in Deleted Items.", it.Label)})
		}
	}

	fields := map[string]interface{}{"review_status": "APPROVED", "deleted_at": nil}
	if len(txIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", txIDs).Updates(fields)
	}
	if len(expIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", expIDs).Updates(fields)
	}
	if len(invIDs) > 0 {
		tx.Model(&models.Invoice{}).Where("id IN ?", invIDs).Updates(fields)
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "RESTORED", GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to restore deleted items"})
	}

	utils.RunReconciliation()
	broadcastReconciliationSync()
	return c.JSON(fiber.Map{"status": "success", "affected": items})
}

// MoveDeletedToExcludedBulk moves soft-deleted items into Excluded Items (IGNORED).
func MoveDeletedToExcludedBulk(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var in struct {
		Items  []bulkItemRef `json:"items"`
		Reason string        `json:"reason"`
		Note   string        `json:"note"`
	}
	if err := c.Bind().JSON(&in); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body."})
	}
	in.Reason = strings.ToUpper(strings.TrimSpace(in.Reason))
	in.Note = strings.TrimSpace(in.Note)
	if in.Reason == "" {
		in.Reason = "OTHER"
	}
	if !validExclusionReasons[in.Reason] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "A valid exclusion reason is required."})
	}
	txIDs, expIDs, invIDs, err := parseBulkItems(in.Items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	tx := db.DB.Begin()
	items := loadGroupItems(tx, txIDs, expIDs, invIDs)
	if len(items) == 0 {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Selected items not found."})
	}
	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": fmt.Sprintf("Cannot exclude %s from a locked period. Unlock the period first.", locked.Label),
		})
	}
	for _, it := range items {
		if it.ReviewStatus != "DELETED" {
			tx.Rollback()
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": fmt.Sprintf("Item '%s' is not in Deleted Items.", it.Label)})
		}
	}

	fields := map[string]interface{}{
		"review_status":    "IGNORED",
		"exclusion_reason": in.Reason,
		"exclusion_note":   in.Note,
		"deleted_at":       nil,
	}
	if len(txIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", txIDs).Updates(fields)
	}
	if len(expIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", expIDs).Updates(fields)
	}
	if len(invIDs) > 0 {
		tx.Model(&models.Invoice{}).Where("id IN ?", invIDs).Updates(fields)
	}

	groupID := fmt.Sprintf("G%d", time.Now().UnixNano())
	for _, it := range items {
		tx.Create(&models.ItemAuditLog{ItemType: it.Type, ItemID: it.ID, Action: "EXCLUDED", Reason: in.Reason, Note: in.Note, GroupID: groupID})
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to move items to excluded"})
	}

	utils.RunReconciliation()
	broadcastReconciliationSync()
	return c.JSON(fiber.Map{"status": "success", "affected": items})
}

// DeletePermanentBulk hard-deletes items permanently from the database.
func DeletePermanentBulk(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var in struct {
		Items []bulkItemRef `json:"items"`
	}
	if err := c.Bind().JSON(&in); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body."})
	}
	txIDs, expIDs, invIDs, err := parseBulkItems(in.Items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	tx := db.DB.Begin()
	items := loadGroupItems(tx, txIDs, expIDs, invIDs)
	if len(items) == 0 {
		tx.Rollback()
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Selected items not found."})
	}
	if locked := groupLockedItem(items); locked != nil {
		tx.Rollback()
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": fmt.Sprintf("Cannot permanently delete %s from a locked period. Unlock the period first.", locked.Label),
		})
	}

	if len(txIDs) > 0 {
		tx.Where("bank_transaction_id IN ?", txIDs).Delete(&models.ExpenseBankTransaction{})
		if err := tx.Where("id IN ?", txIDs).Delete(&models.BankTransaction{}).Error; err != nil {
			tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to permanently delete transactions"})
		}
	}

	var fileURIsToCheck []string
	if len(expIDs) > 0 {
		var receipts []models.Receipt
		tx.Where("expense_id IN ?", expIDs).Find(&receipts)
		for _, r := range receipts {
			if r.DocumentURI != "" {
				fileURIsToCheck = append(fileURIsToCheck, r.DocumentURI)
			}
		}

		tx.Where("expense_id IN ?", expIDs).Delete(&models.ExpenseBankTransaction{})
		tx.Where("expense_id IN ?", expIDs).Delete(&models.Receipt{})
		if err := tx.Where("id IN ?", expIDs).Delete(&models.Expense{}).Error; err != nil {
			tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to permanently delete expenses"})
		}
	}

	if len(invIDs) > 0 {
		if err := tx.Where("id IN ?", invIDs).Delete(&models.Invoice{}).Error; err != nil {
			tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to permanently delete invoices"})
		}
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to permanently delete items"})
	}

	// Clean up physical receipt files safely inside processed dir
	for _, uri := range fileURIsToCheck {
		removeUnreferencedReceiptFile(uri)
	}

	utils.RunReconciliation()
	broadcastReconciliationSync()
	return c.JSON(fiber.Map{"status": "success"})
}

