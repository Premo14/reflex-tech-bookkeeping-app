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

// SweepOverdueInvoices updates any SENT or PARTIALLY_PAID invoice past its due date to OVERDUE.
func SweepOverdueInvoices() int64 {
	res := db.DB.Model(&models.Invoice{}).
		Where("status IN ('SENT', 'PARTIALLY_PAID') AND due_date < ?", time.Now().UTC()).
		Update("status", "OVERDUE")
	if res.RowsAffected > 0 {
		BroadcastEvent("INVOICES_UPDATED", nil)
		BroadcastEvent("SUMMARY_UPDATED", nil)
	}
	return res.RowsAffected
}

func GetInvoices(c fiber.Ctx) error {
	// Automatically sweep overdue statuses before querying
	SweepOverdueInvoices()

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

	// Exact integer-cent summary metrics
	now := time.Now()
	var totalInvoicedCents int64
	var totalPaidCents int64
	var totalUnpaidCents int64
	var overdueCount int64

	var allInvoices []models.Invoice
	db.DB.Find(&allInvoices)
	for _, inv := range allInvoices {
		if inv.Status != "VOID" {
			totalInvoicedCents += inv.TotalAmount.Cents
		}
		if inv.Status == "PAID" {
			totalPaidCents += inv.TotalAmount.Cents
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
			}
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":   "success",
		"invoices": invoices,
		"summary": fiber.Map{
			"totalInvoiced": float64(totalInvoicedCents) / 100.0,
			"totalPaid":     float64(totalPaidCents) / 100.0,
			"totalUnpaid":   float64(totalUnpaidCents) / 100.0,
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
		var subtotal models.Money
		for _, it := range input.Items {
			lineAmt := models.NewMoney(it.Quantity * it.UnitPrice)
			if it.Amount.Cents > 0 {
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
				if tx.Amount.Dollars() >= 0 {
					tx.AllocationStatus = "BALANCED"
				} else {
					tx.AllocationStatus = "UNLINKED"
				}
				tx.ReviewStatus = "APPROVED"
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

	if tx.Amount.Dollars() <= 0 {
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
				if tx.Amount.Dollars() >= 0 {
					tx.AllocationStatus = "BALANCED"
				} else {
					tx.AllocationStatus = "UNLINKED"
				}
				tx.ReviewStatus = "APPROVED"
			}
			db.DB.Save(&tx)
			BroadcastEvent("TRANSACTIONS_UPDATED", nil)
		}
	}

	invoice.BankTransactionID = nil
	invoice.Status = "SENT"
	invoice.PaidDate = nil
	invoice.AmountPaid = models.NewMoney(0)
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
		amtDiffTotal := math.Abs(cand.Amount.Dollars() - invoice.TotalAmount.Dollars())
		targetAmt := invoice.TotalAmount.Dollars()
		if invoice.BalanceDue.Dollars() > 0 && invoice.BalanceDue.Dollars() < invoice.TotalAmount.Dollars() {
			targetAmt = invoice.BalanceDue.Dollars()
		}
		amtDiff := math.Min(amtDiffTotal, math.Abs(cand.Amount.Dollars()-targetAmt))
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
		} else if invoice.TotalAmount.Dollars() > 0 && amtDiff/invoice.TotalAmount.Dollars() < 0.10 {
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
