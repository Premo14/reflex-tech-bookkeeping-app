package controllers

import (
	"fmt"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"

	"github.com/gofiber/fiber/v3"
)

func GetReviewQueue(c fiber.Ctx) error {
	status := c.Query("status", "PENDING") // PENDING or IGNORED

	var txs []models.BankTransaction
	db.DB.Where("review_status = ?", status).Order("date DESC").Find(&txs)

	var exps []models.Expense
	db.DB.Where("review_status = ?", status).Order("timestamp DESC").Find(&exps)

	return c.JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
		"expenses":     exps,
	})
}

type ResolveRequest struct {
	TransactionIDs []uint `json:"transactionIds"`
	ExpenseIDs     []uint `json:"expenseIds"`
	Action         string `json:"action"` // "allow" or "ignore" or "pending"
}

func ResolveQueueItems(c fiber.Ctx) error {
	var req ResolveRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	newStatus := "PENDING"
	switch req.Action {
	case "allow":
		newStatus = "APPROVED"
	case "ignore":
		newStatus = "IGNORED"
	}

	tx := db.DB.Begin()

	// Linked items always move together, so an excluded item is never linked to a
	// non-excluded one.
	req.TransactionIDs, req.ExpenseIDs = expandToLinkGroups(tx, req.TransactionIDs, req.ExpenseIDs)

	fields := map[string]interface{}{"review_status": newStatus, "exclusion_reason": "", "exclusion_note": ""}
	if newStatus == "IGNORED" {
		fields["exclusion_reason"] = "CLOSED_PERIOD"
		fields["exclusion_note"] = "Declined from the Review Queue (item fell in a closed period)."
	}

	if len(req.TransactionIDs) > 0 {
		tx.Model(&models.BankTransaction{}).Where("id IN ?", req.TransactionIDs).Updates(fields)
		if newStatus == "IGNORED" {
			tx.Where("bank_transaction_id IN ? AND status = ?", req.TransactionIDs, "suggested").Delete(&models.ExpenseBankTransaction{})
		}
		for _, id := range req.TransactionIDs {
			tx.Create(&models.ItemAuditLog{ItemType: "transaction", ItemID: id, Action: reviewAuditAction(newStatus), Reason: fmt.Sprint(fields["exclusion_reason"]), Note: "Review Queue"})
		}
	}

	if len(req.ExpenseIDs) > 0 {
		tx.Model(&models.Expense{}).Where("id IN ?", req.ExpenseIDs).Updates(fields)
		if newStatus == "IGNORED" {
			tx.Where("expense_id IN ? AND status = ?", req.ExpenseIDs, "suggested").Delete(&models.ExpenseBankTransaction{})
		}
		for _, id := range req.ExpenseIDs {
			tx.Create(&models.ItemAuditLog{ItemType: "expense", ItemID: id, Action: reviewAuditAction(newStatus), Reason: fmt.Sprint(fields["exclusion_reason"]), Note: "Review Queue"})
		}
	}

	// If allowing, we must move BooksClosedDate back to the oldest date of the allowed items
	if req.Action == "allow" {
		var oldestDate time.Time
		foundOldest := false

		if len(req.TransactionIDs) > 0 {
			var btxs []models.BankTransaction
			tx.Where("id IN ?", req.TransactionIDs).Order("date ASC").First(&btxs)
			if len(btxs) > 0 {
				oldestDate = btxs[0].Date
				foundOldest = true
			}
		}

		if len(req.ExpenseIDs) > 0 {
			var exps []models.Expense
			tx.Where("id IN ?", req.ExpenseIDs).Order("timestamp ASC").First(&exps)
			if len(exps) > 0 {
				if !foundOldest || exps[0].Timestamp.Before(oldestDate) {
					oldestDate = exps[0].Timestamp
					foundOldest = true
				}
			}
		}

		if foundOldest {
			// Get current closed date
			var setting models.AppSetting
			if err := tx.Where("key = ?", "BooksClosedDate").First(&setting).Error; err == nil && setting.Value != "" {
				currentClosed, err := time.Parse("2006-01-02", setting.Value)
				// If the allowed items are older than the closed date, open the books past them!
				// Actually, if we allow ANY items, the user specifically said "if any items are allowed, it should open the books back up to the furthest date of the allowed expense/transaction"
				// So if oldest allowed item is Jan 1st, and books are closed Jan 31st, we must move books back to BEFORE Jan 1st.
				// For safety, let's just move it to 1 day before the oldestDate so that date is technically "open".
				if err == nil {
					targetOpenDate := oldestDate.AddDate(0, 0, -1)
					if targetOpenDate.Before(currentClosed) {
						prevValue := setting.Value
						newValue := targetOpenDate.Format("2006-01-02")
						setting.Value = newValue
						tx.Save(&setting)

						auditLog := models.PeriodAuditLog{
							Action:       "ROLLED_BACK",
							PreviousDate: prevValue,
							NewDate:      newValue,
							Reason:       "Review Queue Auto-Resolution",
						}
						tx.Create(&auditLog)
					}
				}
			}
		}
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Trigger RunReconciliation asynchronously if we allowed things
	if req.Action == "allow" {
		go utils.RunReconciliation()
	}

	return c.JSON(fiber.Map{"status": "success"})
}

func reviewAuditAction(newStatus string) string {
	switch newStatus {
	case "IGNORED":
		return "EXCLUDED"
	case "APPROVED":
		return "APPROVED"
	}
	return "SENT_TO_REVIEW"
}
