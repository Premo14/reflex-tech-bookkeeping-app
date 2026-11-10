package controllers

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"

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
func GetInvoices(c fiber.Ctx) error {
	status := strings.TrimSpace(c.Query("status"))
	search := strings.TrimSpace(c.Query("search"))
	yearStr := strings.TrimSpace(c.Query("year"))

	query := db.DB.Model(&models.Invoice{})

	if status != "" && status != "ALL" {
		query = query.Where("status = ?", status)
	}

	if search != "" {
		searchLike := "%" + search + "%"
		query = query.Where("invoice_number ILIKE ? OR client_name ILIKE ? OR client_email ILIKE ?", searchLike, searchLike, searchLike)
	}

	if yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			start := fmt.Sprintf("%d-01-01", y)
			end := fmt.Sprintf("%d-12-31", y)
			query = query.Where("issue_date >= ? AND issue_date <= ?", start, end)
		}
	}

	var invoices []models.Invoice
	if err := query.Order("issue_date DESC, id DESC").
		Preload("CategoryAccount").
		Preload("BankTransaction").
		Find(&invoices).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch invoices"})
	}

	// Update overdue statuses dynamically if dueDate < now and status is SENT or PARTIALLY_PAID (never DRAFT)
	now := time.Now()
	for i := range invoices {
		if (invoices[i].Status == "SENT" || invoices[i].Status == "PARTIALLY_PAID") && invoices[i].DueDate.Before(now) {
			invoices[i].Status = "OVERDUE"
			db.DB.Model(&models.Invoice{}).Where("id = ?", invoices[i].ID).Update("status", "OVERDUE")
		}
	}

	// Summary metrics
	type sumResult struct {
		TotalInvoiced float64
		TotalPaid     float64
		TotalUnpaid   float64
		OverdueCount  int64
	}

	var totalInvoiced float64
	var totalPaid float64
	var totalUnpaid float64
	var overdueCount int64

	var allInvoices []models.Invoice
	db.DB.Find(&allInvoices)
	for _, inv := range allInvoices {
		if inv.Status != "VOID" {
			totalInvoiced += inv.TotalAmount
		}
		if inv.Status == "PAID" {
			totalPaid += inv.TotalAmount
		} else {
			totalPaid += inv.AmountPaid
			unpaidBal := inv.BalanceDue
			if unpaidBal <= 0 && inv.TotalAmount > inv.AmountPaid {
				unpaidBal = roundCents(inv.TotalAmount - inv.AmountPaid)
			}
			if inv.Status != "VOID" {
				totalUnpaid += unpaidBal
			}
			if (inv.Status == "SENT" || inv.Status == "OVERDUE" || inv.Status == "PARTIALLY_PAID") && inv.DueDate.Before(now) {
				overdueCount++
			}
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":   "success",
		"invoices": invoices,
		"summary": fiber.Map{
			"totalInvoiced": roundCents(totalInvoiced),
			"totalPaid":     roundCents(totalPaid),
			"totalUnpaid":   roundCents(totalUnpaid),
			"overdueCount":  overdueCount,
			"invoiceCount":  len(invoices),
		},
	})
}

// GetInvoice returns a single invoice by ID.
func GetInvoice(c fiber.Ctx) error {
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.Preload("CategoryAccount").Preload("BankTransaction").First(&invoice, "id = ?", id).Error; err != nil {
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

	// Calculate Line Items and Totals
	var subtotal float64
	for _, it := range input.Items {
		lineAmt := it.Quantity * it.UnitPrice
		if it.Amount > 0 {
			lineAmt = it.Amount
		}
		subtotal += lineAmt
	}

	taxAmount := 0.0
	if input.TaxRate > 0 {
		taxAmount = roundCents(subtotal * (input.TaxRate / 100.0))
	}
	totalAmount := roundCents(subtotal + taxAmount)

	itemsJSON, _ := json.Marshal(input.Items)

	status := strings.ToUpper(strings.TrimSpace(input.Status))
	if status == "" {
		status = "DRAFT"
	}

	// Category revenue account default (4010)
	catID := input.CategoryAccountID
	if catID == nil || *catID == 0 {
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
		Subtotal:          roundCents(subtotal),
		TaxRate:           input.TaxRate,
		TaxAmount:         taxAmount,
		TotalAmount:       totalAmount,
		AmountPaid:        0,
		BalanceDue:        totalAmount,
		Notes:             strings.TrimSpace(input.Notes),
		PaymentTerms:      paymentTerms,
		Status:            status,
		CategoryAccountID: catID,
	}
	if status == "PAID" {
		invoice.AmountPaid = totalAmount
		invoice.BalanceDue = 0
	}

	if err := db.DB.Create(&invoice).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create invoice: " + err.Error()})
	}

	db.DB.Preload("CategoryAccount").First(&invoice, invoice.ID)

	BroadcastEvent("INVOICES_UPDATED", nil)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
	})
}

// UpdateInvoice updates an existing invoice.
func UpdateInvoice(c fiber.Ctx) error {
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
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
		invoice.CategoryAccountID = input.CategoryAccountID
	}

	if len(input.Items) > 0 {
		var subtotal float64
		for _, it := range input.Items {
			lineAmt := it.Quantity * it.UnitPrice
			if it.Amount > 0 {
				lineAmt = it.Amount
			}
			subtotal += lineAmt
		}
		invoice.Subtotal = roundCents(subtotal)
		invoice.TaxRate = input.TaxRate
		invoice.TaxAmount = roundCents(subtotal * (input.TaxRate / 100.0))
		invoice.TotalAmount = roundCents(invoice.Subtotal + invoice.TaxAmount)
		itemsJSON, _ := json.Marshal(input.Items)
		invoice.Items = string(itemsJSON)
	}

	if invoice.Status == "PAID" {
		invoice.AmountPaid = invoice.TotalAmount
		invoice.BalanceDue = 0
	} else if invoice.AmountPaid > 0 {
		invoice.BalanceDue = roundCents(invoice.TotalAmount - invoice.AmountPaid)
		if invoice.BalanceDue <= 0 {
			invoice.Status = "PAID"
			invoice.BalanceDue = 0
		}
	} else {
		invoice.AmountPaid = 0
		invoice.BalanceDue = invoice.TotalAmount
	}

	if err := db.DB.Save(&invoice).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update invoice"})
	}

	db.DB.Preload("CategoryAccount").Preload("BankTransaction").First(&invoice, invoice.ID)
	BroadcastEvent("INVOICES_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
	})
}

// DeleteInvoice voids or deletes an invoice.
func DeleteInvoice(c fiber.Ctx) error {
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}

	// If linked to a transaction, safely detach
	if invoice.BankTransactionID != nil {
		var tx models.BankTransaction
		if err := db.DB.First(&tx, "id = ?", *invoice.BankTransactionID).Error; err == nil {
			if utils.IsDateInClosedPeriod(tx.Date) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "Cannot delete invoice linked to a transaction in a closed accounting period.",
				})
			}
			if strings.HasPrefix(tx.Notes, fmt.Sprintf("Payment for Invoice %s", invoice.InvoiceNumber)) {
				tx.Notes = ""
			}
			var expCount int64
			db.DB.Table("expense_bank_transactions").Where("bank_transaction_id = ?", tx.ID).Count(&expCount)
			if expCount == 0 {
				tx.AllocationStatus = "UNALLOCATED"
				tx.ReviewStatus = "PENDING"
			}
			db.DB.Save(&tx)
			BroadcastEvent("TRANSACTIONS_UPDATED", nil)
		}
	}

	if err := db.DB.Delete(&invoice).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete invoice"})
	}

	BroadcastEvent("INVOICES_UPDATED", nil)
	BroadcastEvent("SUMMARY_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}

// MatchInvoicePayment matches an incoming bank transaction deposit (credit) to an invoice.
// Automatically updates the invoice to PAID, records the paid date, and marks the bank transaction as revenue.
func MatchInvoicePayment(c fiber.Ctx) error {
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}

	type matchInput struct {
		BankTransactionID uint `json:"bankTransactionId"`
	}
	var input matchInput
	if err := c.Bind().JSON(&input); err != nil || input.BankTransactionID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "bankTransactionId is required"})
	}

	var tx models.BankTransaction
	if err := db.DB.First(&tx, "id = ?", input.BankTransactionID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Bank transaction not found"})
	}

	if tx.Amount <= 0 {
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

	// 1. Update Invoice
	paymentAmt := tx.Amount
	newPaid := roundCents(invoice.AmountPaid + paymentAmt)
	if newPaid >= invoice.TotalAmount {
		invoice.AmountPaid = invoice.TotalAmount
		invoice.BalanceDue = 0.0
		invoice.Status = "PAID"
	} else {
		invoice.AmountPaid = newPaid
		invoice.BalanceDue = roundCents(invoice.TotalAmount - newPaid)
		invoice.Status = "PARTIALLY_PAID"
	}
	invoice.BankTransactionID = &tx.ID
	invoice.PaidDate = &tx.Date
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

	BroadcastEvent("INVOICES_UPDATED", nil)
	BroadcastEvent("TRANSACTIONS_UPDATED", nil)
	BroadcastEvent("SUMMARY_UPDATED", nil)

	var msg string
	if invoice.Status == "PAID" {
		msg = fmt.Sprintf("Invoice %s marked as PAID and linked to bank deposit $%.2f", invoice.InvoiceNumber, tx.Amount)
	} else {
		msg = fmt.Sprintf("Payment of $%.2f applied to Invoice %s. Remaining balance: $%.2f", tx.Amount, invoice.InvoiceNumber, invoice.BalanceDue)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
		"message": msg,
	})
}

// UnmatchInvoicePayment removes the link between an invoice and bank transaction.
func UnmatchInvoicePayment(c fiber.Ctx) error {
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}

	if invoice.BankTransactionID != nil {
		var tx models.BankTransaction
		if err := db.DB.First(&tx, "id = ?", *invoice.BankTransactionID).Error; err == nil {
			if utils.IsDateInClosedPeriod(tx.Date) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "Cannot unmatch payment for a transaction in a closed accounting period.",
				})
			}
			if strings.HasPrefix(tx.Notes, fmt.Sprintf("Payment for Invoice %s", invoice.InvoiceNumber)) {
				tx.Notes = ""
			}
			var expCount int64
			db.DB.Table("expense_bank_transactions").Where("bank_transaction_id = ?", tx.ID).Count(&expCount)
			if expCount == 0 {
				tx.AllocationStatus = "UNALLOCATED"
				tx.ReviewStatus = "PENDING"
			}
			db.DB.Save(&tx)
			BroadcastEvent("TRANSACTIONS_UPDATED", nil)
		}
	}

	invoice.BankTransactionID = nil
	invoice.Status = "SENT"
	invoice.PaidDate = nil
	invoice.AmountPaid = 0
	invoice.BalanceDue = invoice.TotalAmount

	if err := db.DB.Save(&invoice).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to unmatch invoice"})
	}

	BroadcastEvent("INVOICES_UPDATED", nil)
	BroadcastEvent("SUMMARY_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"invoice": invoice,
	})
}

// GetMatchingDeposits finds candidate bank deposits that match this invoice.
func GetMatchingDeposits(c fiber.Ctx) error {
	id := c.Params("id")
	var invoice models.Invoice

	if err := db.DB.First(&invoice, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Invoice not found"})
	}

	// 1. Exclude bank transactions already matched to any other active invoice
	var matchedTxIDs []uint
	db.DB.Model(&models.Invoice{}).
		Where("bank_transaction_id IS NOT NULL AND id != ?", invoice.ID).
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

		// Amount match checks
		amtDiffTotal := math.Abs(cand.Amount - invoice.TotalAmount)
		targetAmt := invoice.TotalAmount
		if invoice.BalanceDue > 0 && invoice.BalanceDue < invoice.TotalAmount {
			targetAmt = invoice.BalanceDue
		}
		amtDiff := math.Min(amtDiffTotal, math.Abs(cand.Amount-targetAmt))
		if amtDiff < 0.01 {
			score += 45
			if amtDiffTotal < 0.01 {
				reasons = append(reasons, "Exact amount match")
			} else {
				reasons = append(reasons, "Exact remaining balance match")
			}
		} else if amtDiff < 2.0 {
			score += 25
			reasons = append(reasons, "Close amount match (within $2)")
		} else if invoice.TotalAmount > 0 && amtDiff/invoice.TotalAmount < 0.10 {
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
