package controllers

import (
	"encoding/json"
	"fmt"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
)

func parseDateFlexible(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, fmt.Errorf("empty date")
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	if len(s) >= 10 {
		prefix := s[:10]
		if t, err := time.Parse("2006-01-02", prefix); err == nil {
			return t, nil
		}
	}
	return time.Parse("2006-01-02", s)
}

func calculateDueDate(issueDate time.Time, terms string, explicitDueDate string) time.Time {
	if explicitDueDate != "" {
		if t, err := parseDateFlexible(explicitDueDate); err == nil {
			return t
		}
	}
	switch strings.ToLower(strings.TrimSpace(terms)) {
	case "due on receipt":
		return issueDate
	case "net 15":
		return issueDate.AddDate(0, 0, 15)
	case "net 60":
		return issueDate.AddDate(0, 0, 60)
	default:
		return issueDate.AddDate(0, 0, 30) // Net 30 default
	}
}

// SweepOverdueInvoices updates any SENT or PARTIALLY_PAID invoice past its due date to OVERDUE.
func SweepOverdueInvoices() int64 {
	if db.DB == nil {
		return 0
	}
	res := db.DB.Model(&models.Invoice{}).
		Where("status IN ('SENT', 'PARTIALLY_PAID') AND due_date < ?", time.Now().UTC()).
		Update("status", "OVERDUE")
	if res.RowsAffected > 0 {
		events.Broadcast("INVOICES_UPDATED", nil)
		events.Broadcast("SUMMARY_UPDATED", nil)
	}
	return res.RowsAffected
}

func GetInvoices(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	// Automatically sweep overdue statuses before querying
	SweepOverdueInvoices()

	status := strings.TrimSpace(c.Query("status"))
	search := strings.TrimSpace(c.Query("search"))
	yearStr := strings.TrimSpace(c.Query("year"))

	query := db.DB.Model(&models.Invoice{}).Where("COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')")

	if status != "" && status != "ALL" {
		query = query.Where("status = ?", status)
	}

	if search != "" {
		searchLike := "%" + strings.ToLower(search) + "%"
		query = query.Where("LOWER(invoice_number) LIKE ? OR LOWER(client_name) LIKE ? OR LOWER(client_email) LIKE ?", searchLike, searchLike, searchLike)
	}

	if yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			start := time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC)
			end := start.AddDate(1, 0, 0)
			query = query.Where("issue_date >= ? AND issue_date < ?", start, end)
		}
	}

	var invoices []models.Invoice
	if err := query.Order("issue_date DESC, id DESC").
		Preload("CategoryAccount").
		Preload("BankTransaction").
		Preload("BankTransaction.ChartAccount").
		Preload("LinkedExpenses").
		Preload("LinkedExpenses.Receipts").
		Preload("LinkedExpenses.ChartAccount").
		Find(&invoices).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch invoices"})
	}

	// Exact integer-cent summary metrics
	now := time.Now()
	var totalInvoicedCents int64
	var totalPaidCents int64
	var totalUnpaidCents int64
	var overdueCount int64
	var activeInvoiceCount int

	statusCounts := map[string]int{
		"ALL":     0,
		"SENT":    0,
		"PAID":    0,
		"OVERDUE": 0,
		"DRAFT":   0,
	}

	var allInvoices []models.Invoice
	db.DB.Where("deleted_at IS NULL AND COALESCE(review_status, '') NOT IN ('DELETED', 'IGNORED')").Find(&allInvoices)
	for _, inv := range allInvoices {
		if inv.Status != "VOID" {
			totalInvoicedCents += inv.TotalAmount.Cents
			activeInvoiceCount++
			statusCounts["ALL"]++
		}
		if inv.Status == "PAID" {
			totalPaidCents += inv.TotalAmount.Cents
			statusCounts["PAID"]++
		} else {
			totalPaidCents += inv.AmountPaid.Cents
			unpaidCents := inv.BalanceDue.Cents
			if unpaidCents <= 0 && inv.TotalAmount.Cents > inv.AmountPaid.Cents {
				unpaidCents = inv.TotalAmount.Cents - inv.AmountPaid.Cents
			}
			if inv.Status != "VOID" {
				totalUnpaidCents += unpaidCents
			}
			if (inv.Status == "SENT" || inv.Status == "OVERDUE" || inv.Status == "PARTIALLY_PAID") && inv.DueDate.Before(now) {
				overdueCount++
				statusCounts["OVERDUE"]++
			} else if inv.Status == "SENT" || inv.Status == "PARTIALLY_PAID" {
				statusCounts["SENT"]++
			} else if inv.Status == "DRAFT" {
				statusCounts["DRAFT"]++
			}
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":   "success",
		"invoices": invoices,
		"summary": fiber.Map{
			"totalInvoiced": models.Money{Cents: totalInvoicedCents},
			"totalPaid":     models.Money{Cents: totalPaidCents},
			"totalUnpaid":   models.Money{Cents: totalUnpaidCents},
			"overdueCount":  overdueCount,
			"invoiceCount":  activeInvoiceCount,
			"statusCounts":  statusCounts,
		},
	})
}

// GetInvoice returns a single invoice by ID.
func GetInvoice(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.Preload("CategoryAccount").
		Preload("BankTransaction").
		Preload("BankTransaction.ChartAccount").
		Preload("LinkedExpenses").
		Preload("LinkedExpenses.Receipts").
		Preload("LinkedExpenses.ChartAccount").
		First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
	})
}

type CreateInvoiceInput struct {
	InvoiceNumber     string                   `json:"invoiceNumber"`
	ClientName        string                   `json:"clientName"`
	ClientEmail       string                   `json:"clientEmail"`
	ClientAddress     string                   `json:"clientAddress"`
	IssueDate         string                   `json:"issueDate"`
	DueDate           string                   `json:"dueDate"`
	Items             []models.InvoiceLineItem `json:"items"`
	TaxRate           float64                  `json:"taxRate"`
	Notes             string                   `json:"notes"`
	PaymentTerms      string                   `json:"paymentTerms"`
	Status            string                   `json:"status"`
	CategoryAccountID *uint                    `json:"categoryAccountId"`
}

// CreateInvoice generates a new client invoice.
func CreateInvoice(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var input CreateInvoiceInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid payload"})
	}

	input.ClientName = strings.TrimSpace(input.ClientName)
	if input.ClientName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Client name is required"})
	}

	// Issue & Due Dates
	issueDate := time.Now()
	if input.IssueDate != "" {
		if t, err := parseDateFlexible(input.IssueDate); err == nil {
			issueDate = t
		}
	}
	dueDate := calculateDueDate(issueDate, input.PaymentTerms, input.DueDate)
	if dueDate.Before(issueDate) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Due date cannot be earlier than issue date"})
	}

	// Invoice Number generation if not provided
	invoiceNumber := strings.TrimSpace(input.InvoiceNumber)
	if invoiceNumber == "" {
		year := issueDate.Year()
		prefix := fmt.Sprintf("INV-%d-", year)
		var existingNumbers []string
		db.DB.Model(&models.Invoice{}).Where("invoice_number LIKE ?", prefix+"%").Pluck("invoice_number", &existingNumbers)
		maxSeq := 0
		for _, num := range existingNumbers {
			var seq int
			if _, err := fmt.Sscanf(num, prefix+"%d", &seq); err == nil {
				if seq > maxSeq {
					maxSeq = seq
				}
			}
		}
		invoiceNumber = fmt.Sprintf("INV-%d-%03d", year, maxSeq+1)
	}

	// Calculate Line Items and Totals using exact integer-cent Money arithmetic
	var subtotal models.Money
	for _, it := range input.Items {
		lineAmt := models.NewMoney(it.Quantity * it.UnitPrice)
		if it.Amount.Cents > 0 {
			lineAmt = it.Amount
		}
		subtotal = subtotal.Add(lineAmt)
	}

	var taxAmount models.Money
	if input.TaxRate > 0 {
		taxAmount = subtotal.PercentOf(input.TaxRate)
	}
	totalAmount := subtotal.Add(taxAmount)

	itemsJSON, _ := json.Marshal(input.Items)

	status := strings.ToUpper(strings.TrimSpace(input.Status))
	if status == "" {
		status = "DRAFT"
	}

	// Category revenue account validation or default (4010)
	catID := normalizeOptionalID(input.CategoryAccountID)
	if catID != nil {
		var catAcc models.ChartAccount
		if err := db.DB.First(&catAcc, *catID).Error; err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Category account not found"})
		}
		if !catAcc.Active {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot assign an inactive category account"})
		}
	} else {
		var revAccount models.ChartAccount
		if err := db.DB.Where("code = '4010'").First(&revAccount).Error; err == nil {
			catID = &revAccount.ID
		}
	}

	paymentTerms := input.PaymentTerms
	if paymentTerms == "" {
		paymentTerms = "Net 30"
	}

	invoice := models.Invoice{
		InvoiceNumber:     invoiceNumber,
		ClientName:        input.ClientName,
		ClientEmail:       strings.TrimSpace(input.ClientEmail),
		ClientAddress:     strings.TrimSpace(input.ClientAddress),
		IssueDate:         issueDate,
		DueDate:           dueDate,
		Items:             string(itemsJSON),
		Subtotal:          subtotal,
		TaxRate:           input.TaxRate,
		TaxAmount:         taxAmount,
		TotalAmount:       totalAmount,
		AmountPaid:        models.NewMoney(0),
		BalanceDue:        totalAmount,
		Notes:             strings.TrimSpace(input.Notes),
		PaymentTerms:      paymentTerms,
		Status:            status,
		CategoryAccountID: catID,
	}
	if status == "PAID" {
		invoice.AmountPaid = invoice.TotalAmount
		invoice.BalanceDue = models.NewMoney(0)
		nowUTC := time.Now().UTC()
		invoice.PaidDate = &nowUTC
	}

	if err := db.DB.Create(&invoice).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create invoice: " + err.Error()})
	}

	db.DB.Preload("CategoryAccount").First(&invoice, invoice.ID)

	events.Broadcast("INVOICES_UPDATED", nil)
	if invoice.Status == "SENT" || invoice.Status == "OVERDUE" || invoice.Status == "PARTIALLY_PAID" {
		utils.RunReconciliation()
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
	})
}

// UpdateInvoice updates an existing invoice.
func UpdateInvoice(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}
	if invoice.DeletedAt != nil || invoice.ReviewStatus == "DELETED" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot update a deleted invoice"})
	}
	if utils.IsDateInClosedPeriod(invoice.IssueDate) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot update an invoice in a closed accounting period."})
	}

	var input CreateInvoiceInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid payload"})
	}

	if input.ClientName != "" {
		invoice.ClientName = strings.TrimSpace(input.ClientName)
	}
	if input.ClientEmail != "" {
		invoice.ClientEmail = strings.TrimSpace(input.ClientEmail)
	}
	if input.ClientAddress != "" {
		invoice.ClientAddress = strings.TrimSpace(input.ClientAddress)
	}
	if input.IssueDate != "" {
		if t, err := parseDateFlexible(input.IssueDate); err == nil {
			if utils.IsDateInClosedPeriod(t) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot move an invoice into a closed accounting period."})
			}
			invoice.IssueDate = t
		}
	}
	if input.DueDate != "" {
		if t, err := parseDateFlexible(input.DueDate); err == nil {
			invoice.DueDate = t
		}
	}
	if invoice.DueDate.Before(invoice.IssueDate) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Due date cannot be earlier than issue date"})
	}
	if input.Notes != "" {
		invoice.Notes = strings.TrimSpace(input.Notes)
	}
	if input.PaymentTerms != "" {
		invoice.PaymentTerms = strings.TrimSpace(input.PaymentTerms)
	}
	if input.Status != "" {
		invoice.Status = strings.ToUpper(strings.TrimSpace(input.Status))
	}
	if input.CategoryAccountID != nil {
		catID := normalizeOptionalID(input.CategoryAccountID)
		if catID != nil {
			var catAcc models.ChartAccount
			if err := db.DB.First(&catAcc, *catID).Error; err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Category account not found"})
			}
			if !catAcc.Active {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot assign an inactive category account"})
			}
		}
		invoice.CategoryAccountID = catID
	}

	if len(input.Items) > 0 {
		var subtotal models.Money
		for _, it := range input.Items {
			lineAmt := models.NewMoney(it.Quantity * it.UnitPrice)
			if it.Amount.Cents != 0 {
				lineAmt = it.Amount
			}
			subtotal = subtotal.Add(lineAmt)
		}
		invoice.Subtotal = subtotal
		invoice.TaxRate = input.TaxRate
		var taxAmount models.Money
		if input.TaxRate > 0 {
			taxAmount = subtotal.PercentOf(input.TaxRate)
		}
		invoice.TaxAmount = taxAmount
		invoice.TotalAmount = subtotal.Add(taxAmount)
		itemsJSON, _ := json.Marshal(input.Items)
		invoice.Items = string(itemsJSON)
	}

	if invoice.Status == "PAID" {
		invoice.AmountPaid = invoice.TotalAmount
		invoice.BalanceDue = models.NewMoney(0)
		if invoice.PaidDate == nil {
			nowUTC := time.Now().UTC()
			invoice.PaidDate = &nowUTC
		}
	} else if invoice.AmountPaid.Cents > 0 {
		invoice.BalanceDue = invoice.TotalAmount.Sub(invoice.AmountPaid)
		if invoice.BalanceDue.Cents <= 0 {
			invoice.Status = "PAID"
			invoice.BalanceDue = models.NewMoney(0)
		}
	} else {
		invoice.AmountPaid = models.NewMoney(0)
		invoice.BalanceDue = invoice.TotalAmount
	}

	if err := db.DB.Save(&invoice).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update invoice"})
	}

	db.DB.Preload("CategoryAccount").Preload("BankTransaction").Preload("BankTransaction.ChartAccount").Preload("LinkedExpenses").Preload("LinkedExpenses.Receipts").Preload("LinkedExpenses.ChartAccount").First(&invoice, invoice.ID)
	events.Broadcast("INVOICES_UPDATED", nil)
	if invoice.BalanceDue.Cents > 0 && (invoice.Status == "SENT" || invoice.Status == "OVERDUE" || invoice.Status == "PARTIALLY_PAID") {
		utils.RunReconciliation()
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
	})
}

// DeleteInvoice voids or deletes an invoice.
// detachInvoiceBankTransaction detaches a linked bank transaction (or marks a synthetic CASH-INV
// deposit for hard deletion after the invoice FK is cleared/deleted). Returns a non-nil error response
// code/message via error when the transaction is in a closed accounting period.
func detachInvoiceBankTransaction(invoice *models.Invoice, recordDecline bool) (*uint, error) {
	if invoice.BankTransactionID == nil {
		return nil, nil
	}
	var tx models.BankTransaction
	if err := db.DB.First(&tx, "id = ?", *invoice.BankTransactionID).Error; err != nil {
		return nil, nil
	}
	if utils.IsDateInClosedPeriod(tx.Date) {
		return nil, fmt.Errorf("closed_period")
	}

	if tx.IsManual && strings.HasPrefix(tx.FITID, "CASH-INV-") {
		idCopy := tx.ID
		return &idCopy, nil
	}

	if recordDecline {
		// Record manual decline so 24/7 auto-reconciliation does not immediately re-link the same deposit
		token := fmt.Sprintf(",%d,", tx.ID)
		if !strings.Contains(invoice.DeclinedTxIDs, token) {
			if invoice.DeclinedTxIDs == "" {
				invoice.DeclinedTxIDs = token
			} else {
				invoice.DeclinedTxIDs = strings.TrimRight(invoice.DeclinedTxIDs, ",") + token
			}
		}
	}

	if strings.HasPrefix(tx.Notes, fmt.Sprintf("Payment for Invoice %s", invoice.InvoiceNumber)) {
		tx.Notes = ""
	}
	var expCount int64
	db.DB.Table("expense_bank_transactions").Where("bank_transaction_id = ?", tx.ID).Count(&expCount)
	if expCount == 0 {
		if tx.Amount.Cents >= 0 {
			tx.AllocationStatus = "BALANCED"
		} else {
			tx.AllocationStatus = "UNLINKED"
		}
		tx.ReviewStatus = "APPROVED"
	}
	db.DB.Save(&tx)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	return nil, nil
}

func DeleteInvoice(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}

	syntheticCashTxID, err := detachInvoiceBankTransaction(&invoice, false)
	if err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot delete invoice linked to a transaction in a closed accounting period.",
		})
	}

	now := time.Now()
	if err := db.DB.Model(&invoice).Updates(map[string]interface{}{
		"bank_transaction_id": nil,
		"review_status":       "DELETED",
		"deleted_at":          now,
	}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete invoice"})
	}

	db.DB.Create(&models.ItemAuditLog{
		ItemType: "invoice",
		ItemID:   invoice.ID,
		Action:   "DELETED",
		GroupID:  fmt.Sprintf("G%d", time.Now().UnixNano()),
	})

	if syntheticCashTxID != nil {
		db.DB.Unscoped().Delete(&models.BankTransaction{}, *syntheticCashTxID)
		events.Broadcast("TRANSACTIONS_UPDATED", nil)
	}

	events.Broadcast("INVOICES_UPDATED", nil)
	events.Broadcast("SUMMARY_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}

// MatchInvoicePayment matches an incoming bank transaction deposit (credit) to an invoice.
// Automatically updates the invoice to PAID, records the paid date, and marks the bank transaction as revenue.
func MatchInvoicePayment(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}
	if invoice.Status == "VOID" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot record payment on a VOID invoice"})
	}

	type matchInput struct {
		BankTransactionID uint `json:"bankTransactionId"`
	}
	var input matchInput
	if err := c.Bind().JSON(&input); err != nil || input.BankTransactionID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "bankTransactionId is required"})
	}

	if invoice.BankTransactionID != nil && *invoice.BankTransactionID == input.BankTransactionID {
		db.DB.Preload("CategoryAccount").Preload("BankTransaction").Preload("BankTransaction.ChartAccount").Preload("LinkedExpenses").First(&invoice, invoice.ID)
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status":  "success",
			"invoice": invoice,
			"message": fmt.Sprintf("Invoice %s is already linked to this bank deposit.", invoice.InvoiceNumber),
		})
	}

	var tx models.BankTransaction
	if err := db.DB.First(&tx, "id = ?", input.BankTransactionID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Bank transaction not found"})
	}

	if tx.Amount.Cents <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot match invoice payment to a debit/withdrawal. Incoming deposits only."})
	}

	if utils.IsDateInClosedPeriod(tx.Date) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot match payment to a bank transaction in a closed accounting period.",
		})
	}

	// Begin DB transaction
	dbTx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			dbTx.Rollback()
		}
	}()

	// 1. Update Invoice using exact integer-cent Money API
	newPaid := invoice.AmountPaid.Add(tx.Amount)
	if newPaid.Cents >= invoice.TotalAmount.Cents {
		invoice.AmountPaid = invoice.TotalAmount
		invoice.BalanceDue = models.NewMoney(0)
		invoice.Status = "PAID"
	} else {
		invoice.AmountPaid = newPaid
		invoice.BalanceDue = invoice.TotalAmount.Sub(newPaid)
		invoice.Status = "PARTIALLY_PAID"
	}
	invoice.BankTransactionID = &tx.ID
	invoice.PaidDate = &tx.Date
	if invoice.DeclinedTxIDs != "" {
		invoice.DeclinedTxIDs = strings.ReplaceAll(invoice.DeclinedTxIDs, fmt.Sprintf(",%d,", tx.ID), ",")
		if strings.Trim(invoice.DeclinedTxIDs, ",") == "" {
			invoice.DeclinedTxIDs = ""
		}
	}
	if err := dbTx.Save(&invoice).Error; err != nil {
		dbTx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update invoice payment"})
	}

	// 2. Update Bank Transaction to Category Revenue
	if invoice.CategoryAccountID != nil {
		tx.CategoryAccountID = invoice.CategoryAccountID
	}
	tx.AllocationStatus = "BALANCED"
	tx.ReviewStatus = "APPROVED"
	tx.Notes = fmt.Sprintf("Payment for Invoice %s (%s)", invoice.InvoiceNumber, invoice.ClientName)

	if err := dbTx.Save(&tx).Error; err != nil {
		dbTx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update transaction category"})
	}

	if err := dbTx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to commit payment match"})
	}

	db.DB.Preload("CategoryAccount").Preload("BankTransaction").Preload("BankTransaction.ChartAccount").Preload("LinkedExpenses").First(&invoice, invoice.ID)

	events.Broadcast("INVOICES_UPDATED", nil)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	events.Broadcast("SUMMARY_UPDATED", nil)

	var msg string
	if invoice.Status == "PAID" {
		msg = fmt.Sprintf("Invoice %s marked as PAID and linked to bank deposit $%.2f", invoice.InvoiceNumber, tx.Amount.Dollars())
	} else {
		msg = fmt.Sprintf("Payment of $%.2f applied to Invoice %s. Remaining balance: $%.2f", tx.Amount.Dollars(), invoice.InvoiceNumber, invoice.BalanceDue.Dollars())
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
		"message": msg,
	})
}

// MarkInvoicePaidCash marks an open or partially-paid invoice as PAID via Cash.
// Creates a balanced manual deposit entry on Cash on Hand (1030) so P&L, Schedule C,
// Cash Flow, and Trial Balance reflect the cash revenue cleanly.
func MarkInvoicePaidCash(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}
	if invoice.Status == "PAID" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invoice is already marked as PAID"})
	}
	if invoice.Status == "VOID" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot record payment on a VOID invoice"})
	}

	type cashPayInput struct {
		PaidDate string `json:"paidDate"`
		Notes    string `json:"notes"`
	}
	var input cashPayInput
	_ = c.Bind().JSON(&input)

	paidDate := time.Now().UTC()
	if strings.TrimSpace(input.PaidDate) != "" {
		if parsed, err := parseDateFlexible(input.PaidDate); err == nil {
			paidDate = parsed
		} else {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid paidDate format"})
		}
	}

	if utils.IsDateInClosedPeriod(paidDate) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot record cash payment in a closed accounting period.",
		})
	}

	cashAmount := invoice.BalanceDue
	if cashAmount.Cents <= 0 {
		cashAmount = invoice.TotalAmount
	}

	// Find Cash on Hand (1030) or fallback asset cash account
	var cashAccount models.ChartAccount
	var cashAccountID *uint
	if err := db.DB.Where("code = ? AND active = ?", "1030", true).First(&cashAccount).Error; err == nil {
		cashAccountID = &cashAccount.ID
	} else if err := db.DB.Where("type = ? AND LOWER(name) LIKE ? AND active = ?", "ASSET", "%cash%", true).Order("code ASC").First(&cashAccount).Error; err == nil {
		cashAccountID = &cashAccount.ID
	} else if err := db.DB.Where("code = ? AND active = ?", "1010", true).First(&cashAccount).Error; err == nil {
		cashAccountID = &cashAccount.ID
	}

	// Determine revenue category account
	revCatID := invoice.CategoryAccountID
	if revCatID == nil {
		var revAcc models.ChartAccount
		if err := db.DB.Where("code = ? AND active = ?", "4010", true).First(&revAcc).Error; err == nil {
			revCatID = &revAcc.ID
		} else if err := db.DB.Where("type = ? AND active = ?", "REVENUE", true).Order("code ASC").First(&revAcc).Error; err == nil {
			revCatID = &revAcc.ID
		}
	}

	cashNote := strings.TrimSpace(input.Notes)
	if cashNote == "" {
		cashNote = fmt.Sprintf("Paid in Cash — Invoice %s (%s)", invoice.InvoiceNumber, invoice.ClientName)
	}

	dbTx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			dbTx.Rollback()
		}
	}()

	cashTx := models.BankTransaction{
		Date:              paidDate,
		Description:       fmt.Sprintf("Cash Payment — %s (%s)", invoice.InvoiceNumber, invoice.ClientName),
		Amount:            cashAmount,
		TransactionType:   "DEP",
		FITID:             fmt.Sprintf("CASH-INV-%d-%d", invoice.ID, time.Now().UnixNano()),
		IsManual:          true,
		ChartAccountID:    cashAccountID,
		CategoryAccountID: revCatID,
		AllocationStatus:  "BALANCED",
		ReviewStatus:      "APPROVED",
		Notes:             cashNote,
	}
	if err := dbTx.Create(&cashTx).Error; err != nil {
		dbTx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to record cash payment transaction"})
	}

	invoice.BankTransactionID = &cashTx.ID
	invoice.PaidDate = &paidDate
	invoice.AmountPaid = invoice.TotalAmount
	invoice.BalanceDue = models.NewMoney(0)
	invoice.Status = "PAID"
	if err := dbTx.Save(&invoice).Error; err != nil {
		dbTx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update invoice cash payment status"})
	}

	if err := dbTx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to commit cash payment"})
	}

	db.DB.Preload("CategoryAccount").Preload("BankTransaction").Preload("BankTransaction.ChartAccount").Preload("LinkedExpenses").First(&invoice, invoice.ID)

	events.Broadcast("INVOICES_UPDATED", nil)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	events.Broadcast("SUMMARY_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
		"message": fmt.Sprintf("Invoice %s marked as PAID IN CASH ($%.2f recorded to Cash on Hand)", invoice.InvoiceNumber, cashAmount.Dollars()),
	})
}

// UnmatchInvoicePayment removes the link between an invoice and bank transaction (or synthetic cash payment).
func UnmatchInvoicePayment(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}

	// Guard: if invoice has a paid date in a closed period, do not allow unmatch
	if invoice.PaidDate != nil && utils.IsDateInClosedPeriod(*invoice.PaidDate) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot unmatch payment for an invoice paid in a closed accounting period.",
		})
	}

	syntheticCashTxID, err := detachInvoiceBankTransaction(&invoice, true)
	if err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot unmatch payment for a transaction in a closed accounting period.",
		})
	}

	invoice.BankTransactionID = nil
	invoice.Status = "SENT"
	invoice.PaidDate = nil
	invoice.AmountPaid = models.NewMoney(0)
	invoice.BalanceDue = invoice.TotalAmount

	if err := db.DB.Save(&invoice).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to unmatch invoice"})
	}

	// Clean up synthetic cash payment transaction after FK on invoice is cleared
	if syntheticCashTxID != nil {
		db.DB.Unscoped().Delete(&models.BankTransaction{}, *syntheticCashTxID)
		events.Broadcast("TRANSACTIONS_UPDATED", nil)
	}

	events.Broadcast("INVOICES_UPDATED", nil)
	events.Broadcast("SUMMARY_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
	})
}

// GetMatchingDeposits finds candidate bank deposits that match this invoice.
func GetMatchingDeposits(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}

	// 1. Exclude bank transactions already matched to any other active invoice
	var matchedTxIDs []uint
	db.DB.Model(&models.Invoice{}).
		Where("bank_transaction_id IS NOT NULL AND id != ? AND deleted_at IS NULL AND COALESCE(review_status, '') != 'DELETED'", invoice.ID).
		Pluck("bank_transaction_id", &matchedTxIDs)

	// 2. Query credit deposits (amount > 0)
	query := db.DB.Where(inBooksClause).Where("amount > 0")
	if len(matchedTxIDs) > 0 {
		query = query.Where("id NOT IN (?)", matchedTxIDs)
	}

	var candidates []models.BankTransaction
	query.Order("date DESC").
		Limit(25).
		Preload("ChartAccount").
		Preload("Category").
		Find(&candidates)

	type ScoredCandidate struct {
		Transaction models.BankTransaction `json:"transaction"`
		Score       int                    `json:"score"`
		Reason      string                 `json:"reason"`
	}

	clientTokens := strings.Fields(strings.ToLower(invoice.ClientName))

	var results []ScoredCandidate
	for _, cand := range candidates {
		score := 40
		var reasons []string

		// Amount match checks using exact integer-cent arithmetic
		diffTotalCents := cand.Amount.Sub(invoice.TotalAmount).Abs().Cents
		targetMoney := invoice.TotalAmount
		if invoice.BalanceDue.Cents > 0 && invoice.BalanceDue.Cents < invoice.TotalAmount.Cents {
			targetMoney = invoice.BalanceDue
		}
		diffTargetCents := cand.Amount.Sub(targetMoney).Abs().Cents
		amtDiffCents := diffTotalCents
		if diffTargetCents < amtDiffCents {
			amtDiffCents = diffTargetCents
		}
		if amtDiffCents <= 1 {
			score += 45
			if diffTotalCents <= 1 {
				reasons = append(reasons, "Exact amount match")
			} else {
				reasons = append(reasons, "Exact remaining balance match")
			}
		} else if amtDiffCents < 200 {
			score += 25
			reasons = append(reasons, "Close amount match (within $2)")
		} else if invoice.TotalAmount.Cents > 0 && amtDiffCents*10 < invoice.TotalAmount.Cents {
			score += 15
			reasons = append(reasons, "Similar amount (~10%)")
		}

		// Client name check in description
		descLower := strings.ToLower(cand.Description)
		nameMatched := false
		for _, token := range clientTokens {
			if len(token) >= 3 && strings.Contains(descLower, token) {
				nameMatched = true
				break
			}
		}
		if nameMatched {
			score += 25
			reasons = append(reasons, "Client name in transaction description")
		}

		// Date proximity
		if !cand.Date.Before(invoice.IssueDate) {
			score += 10
		}

		if len(reasons) == 0 {
			reasons = append(reasons, "Recent incoming bank deposit")
		}

		results = append(results, ScoredCandidate{
			Transaction: cand,
			Score:       score,
			Reason:      strings.Join(reasons, " • "),
		})
	}

	// Sort candidates by highest match score descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	// Return top 8 best candidates
	if len(results) > 8 {
		results = results[:8]
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":     "success",
		"candidates": results,
	})
}
