package controllers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

func setupInvoiceRulesRoutes(app *fiber.App) {
	api := app.Group("/api")
	// Invoices
	api.Get("/invoices", GetInvoices)
	api.Post("/invoices", CreateInvoice)
	api.Get("/invoices/:id", GetInvoice)
	api.Patch("/invoices/:id", UpdateInvoice)
	api.Delete("/invoices/:id", DeleteInvoice)
	api.Post("/invoices/:id/match-payment", MatchInvoicePayment)
	api.Post("/invoices/:id/pay-cash", MarkInvoicePaidCash)
	api.Post("/invoices/:id/unmatch-payment", UnmatchInvoicePayment)
	api.Get("/invoices/:id/candidates", GetMatchingDeposits)
	// Rules
	api.Get("/rules", GetRules)
	api.Get("/rules/suggestions", GetRuleSuggestions)
	api.Post("/rules", CreateRule)
	api.Get("/rules/:id", GetRule)
	api.Patch("/rules/:id", UpdateRule)
	api.Delete("/rules/:id", DeleteRule)
	api.Post("/rules/reorder", ReorderRules)
	api.Post("/rules/apply-all", ApplyAllRules)
	api.Post("/rules/preview", TestRulePreview)
}

func doJSONMap(t *testing.T, app *fiber.App, method, path string, body interface{}) (int, map[string]interface{}) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if raw, ok := body.(string); ok {
			buf.WriteString(raw)
		} else if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode request body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("%s %s failed: %v", method, path, err)
	}
	defer resp.Body.Close()

	var out map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestInvoiceDateAndOverdueHelpers(t *testing.T) {
	if _, err := parseDateFlexible("   "); err == nil {
		t.Fatal("expected error for empty date")
	}
	if _, err := parseDateFlexible("not-a-date"); err == nil {
		t.Fatal("expected error for malformed date")
	}
	parsedRFC, err := parseDateFlexible("2026-04-10T15:30:00Z")
	if err != nil || parsedRFC.Day() != 10 {
		t.Fatalf("unexpected RFC3339 parse: %v %v", parsedRFC, err)
	}
	parsedShort, err := parseDateFlexible("2026-05-01 extra")
	if err != nil || parsedShort.Month() != 5 {
		t.Fatalf("unexpected short date parse: %v %v", parsedShort, err)
	}

	base := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	if got := calculateDueDate(base, "Net 30", "2026-03-12"); got.Day() != 12 {
		t.Fatalf("expected explicit due date 12th, got %v", got)
	}
	if got := calculateDueDate(base, "Due on Receipt", ""); !got.Equal(base) {
		t.Fatalf("expected Due on Receipt to match base date, got %v", got)
	}
	if got := calculateDueDate(base, "Net 15", ""); !got.Equal(base.AddDate(0, 0, 15)) {
		t.Fatalf("expected +15 days, got %v", got)
	}
	if got := calculateDueDate(base, "Net 60", ""); !got.Equal(base.AddDate(0, 0, 60)) {
		t.Fatalf("expected +60 days, got %v", got)
	}
	if got := calculateDueDate(base, "", ""); !got.Equal(base.AddDate(0, 0, 30)) {
		t.Fatalf("expected default +30 days, got %v", got)
	}

	// Nil DB check on SweepOverdueInvoices
	origDB := db.DB
	db.DB = nil
	if count := SweepOverdueInvoices(); count != 0 {
		db.DB = origDB
		t.Fatalf("expected 0 from SweepOverdueInvoices with nil DB, got %d", count)
	}
	db.DB = origDB

	testDB := setupTestDB(t)
	defer teardownTestDB()

	past := time.Now().UTC().AddDate(0, 0, -5)
	future := time.Now().UTC().AddDate(0, 0, 10)
	testDB.Create(&models.Invoice{InvoiceNumber: "INV-PAST-1", ClientName: "A", IssueDate: past.AddDate(0, 0, -30), DueDate: past, TotalAmount: models.NewMoney(100), BalanceDue: models.NewMoney(100), Status: "SENT"})
	testDB.Create(&models.Invoice{InvoiceNumber: "INV-PAST-2", ClientName: "B", IssueDate: past.AddDate(0, 0, -30), DueDate: past, TotalAmount: models.NewMoney(100), BalanceDue: models.NewMoney(50), Status: "PARTIALLY_PAID"})
	testDB.Create(&models.Invoice{InvoiceNumber: "INV-FUT-1", ClientName: "C", IssueDate: time.Now().UTC(), DueDate: future, TotalAmount: models.NewMoney(100), BalanceDue: models.NewMoney(100), Status: "SENT"})

	if updated := SweepOverdueInvoices(); updated != 2 {
		t.Fatalf("expected 2 invoices swept to OVERDUE, got %d", updated)
	}
}

func TestInvoiceAndRulesNilDBGuards(t *testing.T) {
	origDB := db.DB
	db.DB = nil
	defer func() { db.DB = origDB }()

	app := fiber.New()
	setupInvoiceRulesRoutes(app)

	endpoints := [][2]string{
		{"GET", "/api/invoices"},
		{"GET", "/api/invoices/1"},
		{"POST", "/api/invoices"},
		{"PATCH", "/api/invoices/1"},
		{"DELETE", "/api/invoices/1"},
		{"POST", "/api/invoices/1/match-payment"},
		{"POST", "/api/invoices/1/pay-cash"},
		{"POST", "/api/invoices/1/unmatch-payment"},
		{"GET", "/api/invoices/1/candidates"},
		{"GET", "/api/rules"},
		{"GET", "/api/rules/1"},
		{"POST", "/api/rules"},
		{"PATCH", "/api/rules/1"},
		{"DELETE", "/api/rules/1"},
		{"POST", "/api/rules/reorder"},
		{"POST", "/api/rules/apply-all"},
		{"POST", "/api/rules/preview"},
		{"GET", "/api/rules/suggestions"},
	}

	for _, ep := range endpoints {
		code, _ := doJSONMap(t, app, ep[0], ep[1], nil)
		if code != http.StatusInternalServerError {
			t.Errorf("%s %s with nil DB: expected 500, got %d", ep[0], ep[1], code)
		}
	}
}

func TestInvoiceCRUDFiltersAndDelete(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB()

	app := fiber.New()
	setupInvoiceRulesRoutes(app)

	// Seed ChartAccounts
	rev := models.ChartAccount{Code: "4010", Name: "Service Revenue", Type: "REVENUE", Active: true}
	inactiveRev := models.ChartAccount{Code: "4099", Name: "Old Revenue", Type: "REVENUE", Active: false}
	testDB.Create(&rev)
	testDB.Create(&inactiveRev)

	// Bad JSON & missing clientName & invalid dueDate & inactive/missing category
	if code, _ := doJSONMap(t, app, "POST", "/api/invoices", "{bad"); code != 400 {
		t.Fatalf("expected 400 invalid JSON, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/invoices", map[string]interface{}{"clientName": "  "}); code != 400 {
		t.Fatalf("expected 400 empty client, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/invoices", map[string]interface{}{
		"clientName": "Acme Corp", "issueDate": "2026-04-10", "dueDate": "2026-04-01",
	}); code != 400 {
		t.Fatalf("expected 400 dueDate before issueDate, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/invoices", map[string]interface{}{
		"clientName": "Acme Corp", "categoryAccountId": 999999,
	}); code != 400 {
		t.Fatalf("expected 400 unknown category, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/invoices", map[string]interface{}{
		"clientName": "Acme Corp", "categoryAccountId": inactiveRev.ID,
	}); code != 400 {
		t.Fatalf("expected 400 inactive category, got %d", code)
	}

	// Create first invoice with quantity*unitPrice + explicit Amount + TaxRate -> auto number INV-2026-001
	code, created1 := doJSONMap(t, app, "POST", "/api/invoices", map[string]interface{}{
		"clientName":   "Northstar Labs",
		"clientEmail":  "billing@northstar.test",
		"issueDate":    "2026-04-05",
		"paymentTerms": "Net 15",
		"taxRate":      8.0,
		"status":       "SENT",
		"items": []map[string]interface{}{
			{"description": "Consulting", "quantity": 2, "unitPrice": 500.0},
			{"description": "Setup Fee", "amount": 250.0},
		},
	})
	if code != 201 {
		t.Fatalf("expected 201 create invoice, got %d: %v", code, created1)
	}
	inv1 := created1["invoice"].(map[string]interface{})
	inv1ID := uint(inv1["id"].(float64))
	if inv1["invoiceNumber"] != "INV-2026-001" {
		t.Fatalf("expected INV-2026-001, got %v", inv1["invoiceNumber"])
	}
	// 1250 + 8% (100) = 1350
	if inv1["totalAmount"].(float64) != 1350.0 {
		t.Fatalf("expected total 1350.0, got %v", inv1["totalAmount"])
	}

	// Second auto-numbered invoice in 2026 marked PAID on creation + VOID invoice
	code, created2 := doJSONMap(t, app, "POST", "/api/invoices", map[string]interface{}{
		"clientName": "Beta Builders",
		"issueDate":  "2026-04-12",
		"status":     "PAID",
		"items":      []map[string]interface{}{{"description": "Sprint", "quantity": 1, "unitPrice": 400.0}},
	})
	if code != 201 {
		t.Fatalf("expected 201 create second invoice, got %d", code)
	}
	inv2 := created2["invoice"].(map[string]interface{})
	inv2ID := uint(inv2["id"].(float64))
	if inv2["invoiceNumber"] != "INV-2026-002" {
		t.Fatalf("expected INV-2026-002, got %v", inv2["invoiceNumber"])
	}

	// Third VOID invoice in 2025
	code, _ = doJSONMap(t, app, "POST", "/api/invoices", map[string]interface{}{
		"invoiceNumber": "INV-VOID-1",
		"clientName":    "Voided LLC",
		"issueDate":     "2025-11-15",
		"dueDate":       "2025-11-30",
		"status":        "VOID",
		"items":         []map[string]interface{}{{"description": "Canceled", "amount": 999.0}},
	})
	if code != 201 {
		t.Fatalf("expected 201 VOID invoice, got %d", code)
	}

	// List all + summary checks (VOID excluded from totalInvoiced & totalUnpaid)
	code, listResp := doJSONMap(t, app, "GET", "/api/invoices", nil)
	if code != 200 {
		t.Fatalf("expected 200 GET /invoices, got %d", code)
	}
	summary := listResp["summary"].(map[string]interface{})
	if summary["totalInvoiced"].(float64) != 1750.0 || summary["totalPaid"].(float64) != 400.0 || summary["totalUnpaid"].(float64) != 1350.0 {
		t.Fatalf("unexpected invoice summary: %v", summary)
	}

	// Filters: status (SweepOverdueInvoices transitions past-due SENT -> OVERDUE), search, year
	code, filtered := doJSONMap(t, app, "GET", "/api/invoices?status=OVERDUE&search=northstar&year=2026", nil)
	if code != 200 || len(filtered["invoices"].([]interface{})) != 1 {
		t.Fatalf("expected 1 filtered overdue invoice, got code=%d resp=%v", code, filtered)
	}

	// GetInvoice 200 & 404
	if code, _ = doJSONMap(t, app, "GET", "/api/invoices/"+itoa(inv1ID), nil); code != 200 {
		t.Fatalf("expected 200 GetInvoice, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "GET", "/api/invoices/999999", nil); code != 404 {
		t.Fatalf("expected 404 missing invoice, got %d", code)
	}

	// UpdateInvoice validations & recalculations
	if code, _ = doJSONMap(t, app, "PATCH", "/api/invoices/999999", map[string]interface{}{}); code != 404 {
		t.Fatalf("expected 404 UpdateInvoice missing, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/invoices/"+itoa(inv1ID), "{bad"); code != 400 {
		t.Fatalf("expected 400 UpdateInvoice bad JSON, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/invoices/"+itoa(inv1ID), map[string]interface{}{
		"dueDate": "2026-01-01",
	}); code != 400 {
		t.Fatalf("expected 400 UpdateInvoice dueDate < issueDate, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/invoices/"+itoa(inv1ID), map[string]interface{}{
		"categoryAccountId": inactiveRev.ID,
	}); code != 400 {
		t.Fatalf("expected 400 UpdateInvoice inactive category, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/invoices/"+itoa(inv1ID), map[string]interface{}{
		"categoryAccountId": 999999,
	}); code != 400 {
		t.Fatalf("expected 400 UpdateInvoice missing category, got %d", code)
	}

	// Partial paid update then shrinking total so Paid >= Total transitions to PAID
	testDB.Model(&models.Invoice{}).Where("id = ?", inv1ID).Update("amount_paid", 600.0)
	code, updated := doJSONMap(t, app, "PATCH", "/api/invoices/"+itoa(inv1ID), map[string]interface{}{
		"clientName":        "Northstar Labs LLC",
		"clientEmail":       "ap@northstar.test",
		"clientAddress":     "123 Utica Ave",
		"issueDate":         "2026-04-06",
		"dueDate":           "2026-04-20",
		"notes":             "Updated terms",
		"paymentTerms":      "Net 15",
		"categoryAccountId": 0, // clears category cleanly
		"taxRate":           0,
		"items": []map[string]interface{}{
			{"description": "Reduced Scope", "amount": 500.0},
		},
	})
	if code != 200 || updated["invoice"].(map[string]interface{})["status"] != "PAID" {
		t.Fatalf("expected shrinking total below amountPaid to transition to PAID, got %d %v", code, updated)
	}

	// Update draft invoice to SENT (and increase items on existing invoice)
	code, createdDraft := doJSONMap(t, app, "POST", "/api/invoices", map[string]interface{}{
		"clientName": "Gamma Draft Co",
		"issueDate":  "2026-11-10",
		"dueDate":    "2026-12-10",
		"status":     "DRAFT",
		"items":      []map[string]interface{}{{"description": "Setup", "quantity": 1, "unitPrice": 200.0}},
	})
	if code != 201 {
		t.Fatalf("expected 201 create draft invoice, got %d", code)
	}
	draftID := uint(createdDraft["invoice"].(map[string]interface{})["id"].(float64))
	code, updated2 := doJSONMap(t, app, "PATCH", "/api/invoices/"+itoa(draftID), map[string]interface{}{
		"status": "SENT",
	})
	if code != 200 || updated2["invoice"].(map[string]interface{})["status"] != "SENT" {
		t.Fatalf("expected 200 UpdateInvoice status=SENT, got %d %v", code, updated2)
	}

	// DeleteInvoice on normal & 404
	if code, _ = doJSONMap(t, app, "DELETE", "/api/invoices/999999", nil); code != 404 {
		t.Fatalf("expected 404 DeleteInvoice missing, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "DELETE", "/api/invoices/"+itoa(inv2ID), nil); code != 200 {
		t.Fatalf("expected 200 DeleteInvoice, got %d", code)
	}
}

func TestInvoicePaymentMatchCashUnmatchAndCandidates(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB()

	app := fiber.New()
	setupInvoiceRulesRoutes(app)

	bankAcc := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	cashAcc := models.ChartAccount{Code: "1030", Name: "Cash on Hand", Type: "ASSET", Active: true}
	revAcc := models.ChartAccount{Code: "4010", Name: "Consulting Revenue", Type: "REVENUE", Active: true}
	testDB.Create(&bankAcc)
	testDB.Create(&cashAcc)
	testDB.Create(&revAcc)

	// Closed accounting period <= 2026-02-28
	testDB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-02-28"})

	issueDate := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	inv := models.Invoice{
		InvoiceNumber:     "INV-PAY-1",
		ClientName:        "Mohawk Valley Co",
		IssueDate:         issueDate,
		DueDate:           issueDate.AddDate(0, 0, 30),
		TotalAmount:       models.NewMoney(1000.00),
		BalanceDue:        models.NewMoney(1000.00),
		Status:            "SENT",
		CategoryAccountID: &revAcc.ID,
		DeclinedTxIDs:     ",888,",
	}
	voidInv := models.Invoice{
		InvoiceNumber: "INV-VOID-PAY",
		ClientName:    "Void Client",
		IssueDate:     issueDate,
		DueDate:       issueDate.AddDate(0, 0, 30),
		TotalAmount:   models.NewMoney(100.00),
		BalanceDue:    models.NewMoney(100.00),
		Status:        "VOID",
	}
	testDB.Create(&inv)
	testDB.Create(&voidInv)

	// Bank txs: debit, closed-period deposit, partial deposit, remaining balance deposit, extra deposits for scoring/ranking
	debitTx := models.BankTransaction{Date: time.Date(2026, 3, 5, 0, 0, 0, 0, time.UTC), Description: "BANK FEE", Amount: models.NewMoney(-25.00), FITID: "F-DEB", ChartAccountID: &bankAcc.ID}
	closedTx := models.BankTransaction{Date: time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC), Description: "OLD DEP", Amount: models.NewMoney(1000.00), FITID: "F-CLS", ChartAccountID: &bankAcc.ID}
	partialTx := models.BankTransaction{Date: time.Date(2026, 3, 6, 0, 0, 0, 0, time.UTC), Description: "MOHAWK PARTIAL ACH", Amount: models.NewMoney(400.00), FITID: "F-PART", ChartAccountID: &bankAcc.ID}
	remainderTx := models.BankTransaction{Date: time.Date(2026, 3, 8, 0, 0, 0, 0, time.UTC), Description: "MOHAWK VALLEY FINAL", Amount: models.NewMoney(600.00), FITID: "F-REM", ChartAccountID: &bankAcc.ID}
	closeAmtTx := models.BankTransaction{Date: time.Date(2026, 3, 9, 0, 0, 0, 0, time.UTC), Description: "ACH DEP", Amount: models.NewMoney(999.00), FITID: "F-CLOSE", ChartAccountID: &bankAcc.ID}
	pct10Tx := models.BankTransaction{Date: time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC), Description: "WIRE DEP", Amount: models.NewMoney(950.00), FITID: "F-PCT10", ChartAccountID: &bankAcc.ID}
	otherMatchedTx := models.BankTransaction{Date: time.Date(2026, 3, 11, 0, 0, 0, 0, time.UTC), Description: "TAKEN DEP", Amount: models.NewMoney(500.00), FITID: "F-TAKEN", ChartAccountID: &bankAcc.ID}
	testDB.Create(&debitTx)
	testDB.Create(&closedTx)
	testDB.Create(&partialTx)
	testDB.Create(&remainderTx)
	testDB.Create(&closeAmtTx)
	testDB.Create(&pct10Tx)
	testDB.Create(&otherMatchedTx)

	// Extra invoices to occupy otherMatchedTx + test >8 truncation
	testDB.Create(&models.Invoice{
		InvoiceNumber: "INV-TAKEN", ClientName: "Taken", IssueDate: issueDate, DueDate: issueDate.AddDate(0, 0, 30),
		TotalAmount: models.NewMoney(500), BankTransactionID: &otherMatchedTx.ID, Status: "PAID",
	})
	for i := 0; i < 6; i++ {
		testDB.Create(&models.BankTransaction{
			Date: time.Date(2026, 3, 2, 0, 0, 0, 0, time.UTC), Description: fmt.Sprintf("MISC DEP %d", i),
			Amount: models.NewMoney(50.00 + float64(i)), FITID: fmt.Sprintf("F-EXTRA-%d", i), ChartAccountID: &bankAcc.ID,
		})
	}

	// Candidate scoring checks (404 + ranked list capped at 8, excluding otherMatchedTx)
	if code, _ := doJSONMap(t, app, "GET", "/api/invoices/999999/candidates", nil); code != 404 {
		t.Fatalf("expected 404 GetMatchingDeposits, got %d", code)
	}
	code, candResp := doJSONMap(t, app, "GET", "/api/invoices/"+itoa(inv.ID)+"/candidates", nil)
	if code != 200 {
		t.Fatalf("expected 200 candidates, got %d", code)
	}
	cands := candResp["candidates"].([]interface{})
	if len(cands) != 8 {
		t.Fatalf("expected top 8 candidates, got %d", len(cands))
	}
	for _, raw := range cands {
		txObj := raw.(map[string]interface{})["transaction"].(map[string]interface{})
		if uint(txObj["id"].(float64)) == otherMatchedTx.ID {
			t.Fatal("candidate list should exclude deposits already matched to other invoices")
		}
	}

	// Match validations
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/999999/match-payment", map[string]interface{}{"bankTransactionId": partialTx.ID}); code != 404 {
		t.Fatalf("expected 404 match missing invoice, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(voidInv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": partialTx.ID}); code != 400 {
		t.Fatalf("expected 400 match VOID invoice, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": 0}); code != 400 {
		t.Fatalf("expected 400 zero tx id, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": 999999}); code != 404 {
		t.Fatalf("expected 404 missing tx, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": debitTx.ID}); code != 400 {
		t.Fatalf("expected 400 debit tx, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": closedTx.ID}); code != 403 {
		t.Fatalf("expected 403 closed period tx, got %d", code)
	}

	// Partial match $400 -> PARTIALLY_PAID, BalanceDue $600
	code, partResp := doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": partialTx.ID})
	if code != 200 || partResp["invoice"].(map[string]interface{})["status"] != "PARTIALLY_PAID" {
		t.Fatalf("expected PARTIALLY_PAID, got %d %v", code, partResp)
	}

	// Idempotent duplicate match on partialTx -> stays $400 paid without double-counting
	code, dupResp := doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": partialTx.ID})
	if code != 200 || dupResp["invoice"].(map[string]interface{})["amountPaid"].(float64) != 400.0 {
		t.Fatalf("expected idempotent 200 without double-counting, got %d %v", code, dupResp)
	}

	// Candidate scoring should now recognize remainderTx ($600) as exact remaining balance
	code, candResp2 := doJSONMap(t, app, "GET", "/api/invoices/"+itoa(inv.ID)+"/candidates", nil)
	if code != 200 {
		t.Fatalf("expected 200 second candidates check, got %d", code)
	}
	topCand := candResp2["candidates"].([]interface{})[0].(map[string]interface{})
	if !strings.Contains(topCand["reason"].(string), "Exact remaining balance match") {
		t.Fatalf("expected top candidate reason to include exact remaining balance match, got %v", topCand["reason"])
	}

	// Complete match with remainderTx ($600) -> PAID
	testDB.Model(&models.Invoice{}).Where("id = ?", inv.ID).Update("declined_tx_ids", fmt.Sprintf(",%d,", remainderTx.ID))
	code, fullResp := doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": remainderTx.ID})
	if code != 200 || fullResp["invoice"].(map[string]interface{})["status"] != "PAID" {
		t.Fatalf("expected PAID after remainder match, got %d %v", code, fullResp)
	}

	// Unmatch in closed period blocked
	closedPaid := time.Date(2026, 2, 10, 0, 0, 0, 0, time.UTC)
	testDB.Model(&models.Invoice{}).Where("id = ?", inv.ID).Update("paid_date", &closedPaid)
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/unmatch-payment", nil); code != 403 {
		t.Fatalf("expected 403 unmatch closed paidDate, got %d", code)
	}
	openPaid := time.Date(2026, 3, 8, 0, 0, 0, 0, time.UTC)
	testDB.Model(&models.Invoice{}).Where("id = ?", inv.ID).Update("paid_date", &openPaid)

	// Valid unmatch appends DeclinedTxIDs & clears notes
	code, unmatched := doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/unmatch-payment", nil)
	if code != 200 || unmatched["invoice"].(map[string]interface{})["status"] != "SENT" {
		t.Fatalf("expected 200 unmatch to SENT, got %d %v", code, unmatched)
	}
	var refreshedInv models.Invoice
	testDB.First(&refreshedInv, inv.ID)
	if !strings.Contains(refreshedInv.DeclinedTxIDs, fmt.Sprintf(",%d,", remainderTx.ID)) {
		t.Fatalf("expected DeclinedTxIDs to contain ,%d,, got %q", remainderTx.ID, refreshedInv.DeclinedTxIDs)
	}

	// Second deposit match + Unmatch appending to existing DeclinedTxIDs + DeleteInvoice cleanup
	testDB.Model(&models.Invoice{}).Where("id = ?", inv.ID).Update("status", "SENT")
	doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/match-payment", map[string]interface{}{"bankTransactionId": partialTx.ID})
	doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/unmatch-payment", nil)
	testDB.First(&refreshedInv, inv.ID)
	if !strings.Contains(refreshedInv.DeclinedTxIDs, fmt.Sprintf(",%d,", partialTx.ID)) {
		t.Fatalf("expected DeclinedTxIDs to record second declined tx, got %q", refreshedInv.DeclinedTxIDs)
	}

	// MarkInvoicePaidCash validation & happy path
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/999999/pay-cash", map[string]interface{}{}); code != 404 {
		t.Fatalf("expected 404 pay-cash missing, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(voidInv.ID)+"/pay-cash", map[string]interface{}{}); code != 400 {
		t.Fatalf("expected 400 pay-cash VOID, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/pay-cash", map[string]interface{}{"paidDate": "bad-date"}); code != 400 {
		t.Fatalf("expected 400 pay-cash invalid date, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/pay-cash", map[string]interface{}{"paidDate": "2026-02-20"}); code != 403 {
		t.Fatalf("expected 403 pay-cash closed date, got %d", code)
	}

	code, cashResp := doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/pay-cash", map[string]interface{}{
		"paidDate": "2026-03-15",
		"notes":    "Cash envelope",
	})
	if code != 200 || cashResp["invoice"].(map[string]interface{})["status"] != "PAID" {
		t.Fatalf("expected 200 pay-cash, got %d %v", code, cashResp)
	}
	cashTxID := uint(cashResp["invoice"].(map[string]interface{})["bankTransactionId"].(float64))

	// Already PAID check
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/pay-cash", map[string]interface{}{}); code != 400 {
		t.Fatalf("expected 400 pay-cash already PAID, got %d", code)
	}

	// Unmatch synthetic cash payment deletes synthetic BankTransaction
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/unmatch-payment", nil); code != 200 {
		t.Fatalf("expected 200 unmatch synthetic cash, got %d", code)
	}
	var count int64
	testDB.Model(&models.BankTransaction{}).Where("id = ?", cashTxID).Count(&count)
	if count != 0 {
		t.Fatalf("expected synthetic cash tx %d to be deleted on unmatch, count=%d", cashTxID, count)
	}

	// Re-pay in cash then DeleteInvoice cleans up synthetic cash tx too
	code, cashResp2 := doJSONMap(t, app, "POST", "/api/invoices/"+itoa(inv.ID)+"/pay-cash", map[string]interface{}{"paidDate": "2026-03-16"})
	if code != 200 {
		t.Fatalf("expected 200 second pay-cash, got %d", code)
	}
	cashTx2ID := uint(cashResp2["invoice"].(map[string]interface{})["bankTransactionId"].(float64))
	if code, _ = doJSONMap(t, app, "DELETE", "/api/invoices/"+itoa(inv.ID), nil); code != 200 {
		t.Fatalf("expected 200 delete cash-paid invoice, got %d", code)
	}
	testDB.Model(&models.BankTransaction{}).Where("id = ?", cashTx2ID).Count(&count)
	if count != 0 {
		t.Fatalf("expected synthetic cash tx %d to be deleted on DeleteInvoice, count=%d", cashTx2ID, count)
	}

	// Unmatch 404 check
	if code, _ = doJSONMap(t, app, "POST", "/api/invoices/999999/unmatch-payment", nil); code != 404 {
		t.Fatalf("expected 404 unmatch missing invoice, got %d", code)
	}
}

func TestRulesControllerFullLifecycle(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB()

	app := fiber.New()
	setupInvoiceRulesRoutes(app)

	expCat := models.ChartAccount{Code: "5010", Name: "Software & SaaS", Type: "EXPENSE", Active: true}
	inactiveCat := models.ChartAccount{Code: "5099", Name: "Retired Cat", Type: "EXPENSE", Active: false}
	bankAcc := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	testDB.Create(&expCat)
	testDB.Create(&inactiveCat)
	testDB.Create(&bankAcc)

	// Create unmatched transactions + recurring categorized payee (including long unicode description)
	txDate := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
	testDB.Create(&models.BankTransaction{Date: txDate, Description: "VERCEL PRO PLAN", Amount: models.NewMoney(-20.00), FITID: "R-1", ChartAccountID: &bankAcc.ID, ReviewStatus: "PENDING", AllocationStatus: "UNLINKED"})
	testDB.Create(&models.BankTransaction{Date: txDate, Description: "VERCEL HOBBY", Amount: models.NewMoney(-10.00), FITID: "R-2", ChartAccountID: &bankAcc.ID, ReviewStatus: "PENDING", AllocationStatus: "UNLINKED"})

	longPayee := "SUPER LONG CLOUD INFRASTRUCTURE VENDOR NAME EXCEEDING 24 CHARS"
	testDB.Create(&models.BankTransaction{Date: txDate, Description: longPayee, Amount: models.NewMoney(-99.00), FITID: "S-1", ChartAccountID: &bankAcc.ID, CategoryAccountID: &expCat.ID, ReviewStatus: "APPROVED"})
	testDB.Create(&models.BankTransaction{Date: txDate, Description: longPayee, Amount: models.NewMoney(-99.00), FITID: "S-2", ChartAccountID: &bankAcc.ID, CategoryAccountID: &expCat.ID, ReviewStatus: "APPROVED"})

	// CreateRule validation errors
	if code, _ := doJSONMap(t, app, "POST", "/api/rules", "{bad"); code != 400 {
		t.Fatalf("expected 400 bad JSON, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/rules", map[string]interface{}{"name": " ", "conditions": []models.RuleCondition{{Field: "description", Operator: "contains", Value: "x"}}}); code != 400 {
		t.Fatalf("expected 400 empty name, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/rules", map[string]interface{}{"name": "EmptyCond"}); code != 400 {
		t.Fatalf("expected 400 no conditions, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/rules", map[string]interface{}{
		"name":       "EmptyRegex",
		"conditions": []models.RuleCondition{{Field: "description", Operator: "regex", Value: "  "}},
	}); code != 400 {
		t.Fatalf("expected 400 empty regex, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/rules", map[string]interface{}{
		"name":       "BadRegex",
		"conditions": []models.RuleCondition{{Field: "description", Operator: "regex", Value: "[unclosed"}},
	}); code != 400 {
		t.Fatalf("expected 400 invalid regex, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/rules", map[string]interface{}{
		"name":              "InactiveCat",
		"conditions":        []models.RuleCondition{{Field: "description", Operator: "contains", Value: "VERCEL"}},
		"categoryAccountId": inactiveCat.ID,
	}); code != 400 {
		t.Fatalf("expected 400 inactive category, got %d", code)
	}

	// CreateRule with OR logic + applyImmediately
	code, cr1 := doJSONMap(t, app, "POST", "/api/rules", map[string]interface{}{
		"name":              "Vercel Hosting",
		"matchLogic":        "OR",
		"conditions":        []models.RuleCondition{{Field: "description", Operator: "contains", Value: "VERCEL"}},
		"categoryAccountId": expCat.ID,
		"renamedVendor":     "Vercel Inc.",
		"autoConfirm":       true,
		"notes":             "Cloud hosting",
		"applyImmediately":  true,
	})
	if code != 201 {
		t.Fatalf("expected 201 CreateRule, got %d %v", code, cr1)
	}
	if cr1["appliedCount"].(float64) < 1 {
		t.Fatalf("expected appliedCount >= 1, got %v", cr1["appliedCount"])
	}
	rule1ID := uint(cr1["rule"].(map[string]interface{})["id"].(float64))

	// Create second rule with explicit priority & active=false
	prio := 5
	actFalse := false
	code, cr2 := doJSONMap(t, app, "POST", "/api/rules", map[string]interface{}{
		"name":       "Secondary Rule",
		"priority":   &prio,
		"active":     &actFalse,
		"conditions": []models.RuleCondition{{Field: "description", Operator: "regex", Value: "^ACME.*"}},
	})
	if code != 201 {
		t.Fatalf("expected 201 second rule, got %d", code)
	}
	rule2ID := uint(cr2["rule"].(map[string]interface{})["id"].(float64))

	// GetRules & GetRule (200, 400, 404)
	req := httptest.NewRequest("GET", "/api/rules", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200 GET /rules, got %d", resp.StatusCode)
	}
	resp.Body.Close()
	if code, _ = doJSONMap(t, app, "GET", "/api/rules/abc", nil); code != 400 {
		t.Fatalf("expected 400 non-numeric GetRule, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "GET", "/api/rules/999999", nil); code != 404 {
		t.Fatalf("expected 404 missing GetRule, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "GET", "/api/rules/"+itoa(rule1ID), nil); code != 200 {
		t.Fatalf("expected 200 GetRule, got %d", code)
	}

	// UpdateRule errors & full patch + clearCategory + applyImmediately
	if code, _ = doJSONMap(t, app, "PATCH", "/api/rules/abc", map[string]interface{}{}); code != 400 {
		t.Fatalf("expected 400 bad id, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/rules/999999", map[string]interface{}{}); code != 404 {
		t.Fatalf("expected 404 missing rule, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/rules/"+itoa(rule1ID), "{bad"); code != 400 {
		t.Fatalf("expected 400 bad JSON update, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/rules/"+itoa(rule1ID), map[string]interface{}{"conditions": []models.RuleCondition{}}); code != 400 {
		t.Fatalf("expected 400 empty conditions update, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/rules/"+itoa(rule1ID), map[string]interface{}{"conditions": []models.RuleCondition{{Field: "description", Operator: "regex", Value: "("}}}); code != 400 {
		t.Fatalf("expected 400 invalid regex update, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "PATCH", "/api/rules/"+itoa(rule1ID), map[string]interface{}{"categoryAccountId": inactiveCat.ID}); code != 400 {
		t.Fatalf("expected 400 inactive category update, got %d", code)
	}

	actTrue := true
	newPrio := 2
	code, upd := doJSONMap(t, app, "PATCH", "/api/rules/"+itoa(rule1ID), map[string]interface{}{
		"name":             "Vercel Updated",
		"priority":         &newPrio,
		"active":           &actTrue,
		"matchLogic":       "AND",
		"conditions":       []models.RuleCondition{{Field: "description", Operator: "contains", Value: "VERCEL"}},
		"clearCategory":    true,
		"renamedVendor":    "Vercel Cloud",
		"autoConfirm":      false,
		"autoExclude":      false,
		"exclusionReason":  "",
		"notes":            "Updated note",
		"applyImmediately": true,
	})
	if code != 200 || upd["rule"].(map[string]interface{})["name"] != "Vercel Updated" {
		t.Fatalf("expected 200 UpdateRule, got %d %v", code, upd)
	}
	// Restore category via PATCH
	if code, _ = doJSONMap(t, app, "PATCH", "/api/rules/"+itoa(rule1ID), map[string]interface{}{"categoryAccountId": expCat.ID}); code != 200 {
		t.Fatalf("expected 200 UpdateRule categoryAccountId, got %d", code)
	}

	// ReorderRules
	if code, _ = doJSONMap(t, app, "POST", "/api/rules/reorder", "{bad"); code != 400 {
		t.Fatalf("expected 400 ReorderRules bad body, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/rules/reorder", []uint{rule2ID, rule1ID}); code != 200 {
		t.Fatalf("expected 200 ReorderRules, got %d", code)
	}
	var checkRule models.BankRule
	testDB.First(&checkRule, rule2ID)
	if checkRule.Priority != 0 {
		t.Fatalf("expected rule2 priority=0 after reorder, got %d", checkRule.Priority)
	}

	// ApplyAllRules
	testDB.Create(&models.BankTransaction{Date: txDate, Description: "VERCEL TEAM", Amount: models.NewMoney(-40.00), FITID: "R-3", ChartAccountID: &bankAcc.ID, ReviewStatus: "PENDING", AllocationStatus: "UNLINKED"})
	if code, applyResp := doJSONMap(t, app, "POST", "/api/rules/apply-all", nil); code != 200 || applyResp["appliedCount"].(float64) < 1 {
		t.Fatalf("expected ApplyAllRules >= 1 match, got %d %v", code, applyResp)
	}

	// TestRulePreview (bad JSON, empty conditions, invalid regex, valid match)
	if code, _ = doJSONMap(t, app, "POST", "/api/rules/preview", "{bad"); code != 400 {
		t.Fatalf("expected 400 preview bad JSON, got %d", code)
	}
	if code, emptyPrev := doJSONMap(t, app, "POST", "/api/rules/preview", map[string]interface{}{"conditions": []models.RuleCondition{}}); code != 200 || emptyPrev["matchCount"].(float64) != 0 {
		t.Fatalf("expected 0 matchCount on empty conditions, got %d %v", code, emptyPrev)
	}
	if code, _ = doJSONMap(t, app, "POST", "/api/rules/preview", map[string]interface{}{
		"conditions": []models.RuleCondition{{Field: "description", Operator: "regex", Value: "["}},
	}); code != 400 {
		t.Fatalf("expected 400 preview invalid regex, got %d", code)
	}
	if code, validPrev := doJSONMap(t, app, "POST", "/api/rules/preview", map[string]interface{}{
		"matchLogic": "AND",
		"conditions": []models.RuleCondition{{Field: "description", Operator: "contains", Value: "VERCEL"}},
	}); code != 200 || validPrev["matchCount"].(float64) < 2 {
		t.Fatalf("expected >= 2 matches in TestRulePreview, got %d %v", code, validPrev)
	}

	// GetRuleSuggestions (suggests longPayee truncated to 24 runes, skips VERCEL covered by active rule)
	code, suggResp := doJSONMap(t, app, "GET", "/api/rules/suggestions", nil)
	if code != 200 {
		t.Fatalf("expected 200 suggestions, got %d", code)
	}
	suggs := suggResp["suggestions"].([]interface{})
	if len(suggs) == 0 {
		t.Fatalf("expected at least 1 rule suggestion, got %v", suggResp)
	}
	firstSugg := suggs[0].(map[string]interface{})
	if len([]rune(firstSugg["payeeKeyword"].(string))) != 24 {
		t.Fatalf("expected 24-rune truncated keyword, got %q", firstSugg["payeeKeyword"])
	}

	// DeleteRule checks (400, 404, 200)
	if code, _ = doJSONMap(t, app, "DELETE", "/api/rules/abc", nil); code != 400 {
		t.Fatalf("expected 400 DeleteRule bad id, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "DELETE", "/api/rules/999999", nil); code != 404 {
		t.Fatalf("expected 404 DeleteRule missing, got %d", code)
	}
	if code, _ = doJSONMap(t, app, "DELETE", "/api/rules/"+itoa(rule2ID), nil); code != 200 {
		t.Fatalf("expected 200 DeleteRule, got %d", code)
	}
}

func TestInvoiceAndRules_AuditRegressions(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB()

	testDB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-01-31"})
	bankAcc := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	revAcc := models.ChartAccount{Code: "4010", Name: "Sales", Type: "INCOME", Active: true}
	cat1 := models.ChartAccount{Code: "5010", Name: "Cloud", Type: "EXPENSE", Active: true}
	cat2 := models.ChartAccount{Code: "5020", Name: "Security", Type: "EXPENSE", Active: true}
	testDB.Create(&bankAcc)
	testDB.Create(&revAcc)
	testDB.Create(&cat1)
	testDB.Create(&cat2)

	app := newTestApp()
	setupInvoiceRulesRoutes(app)

	openDate := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	dep := models.BankTransaction{
		ChartAccountID:   &bankAcc.ID,
		Date:             openDate,
		Description:      "ACH CLIENT PAY",
		Amount:           models.NewMoney(100.00),
		FITID:            "INV-DEL-TX-1",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	testDB.Create(&dep)

	invToDelete := models.Invoice{
		InvoiceNumber:     "INV-DEL-LINK",
		ClientName:        "Client A",
		IssueDate:         openDate,
		DueDate:           openDate.AddDate(0, 0, 30),
		TotalAmount:       models.NewMoney(100.00),
		AmountPaid:        models.NewMoney(100.00),
		BalanceDue:        models.NewMoney(0),
		Status:            "PAID",
		BankTransactionID: &dep.ID,
		CategoryAccountID: &revAcc.ID,
		ReviewStatus:      "APPROVED",
	}
	testDB.Create(&invToDelete)

	// 1. DeleteInvoice clears BankTransactionID on soft-deleted invoice
	if code, _ := doJSONMap(t, app, "DELETE", "/api/invoices/"+itoa(invToDelete.ID), nil); code != 200 {
		t.Fatalf("expected 200 DeleteInvoice, got %d", code)
	}
	var deletedInv models.Invoice
	if err := testDB.Unscoped().First(&deletedInv, invToDelete.ID).Error; err != nil {
		t.Fatalf("load deleted invoice: %v", err)
	}
	if deletedInv.BankTransactionID != nil || deletedInv.DeletedAt == nil {
		t.Fatalf("expected deleted invoice BankTransactionID nil and DeletedAt set, got tx=%v del=%v", deletedInv.BankTransactionID, deletedInv.DeletedAt)
	}

	// 2. UpdateInvoice blocks closed-period issueDate & accepts negative discount line items
	invOpen := models.Invoice{
		InvoiceNumber:     "INV-DISC-01",
		ClientName:        "Client B",
		IssueDate:         openDate,
		DueDate:           openDate.AddDate(0, 0, 30),
		TotalAmount:       models.NewMoney(100.00),
		BalanceDue:        models.NewMoney(100.00),
		Status:            "SENT",
		CategoryAccountID: &revAcc.ID,
		ReviewStatus:      "APPROVED",
	}
	testDB.Create(&invOpen)

	if code, _ := doJSONMap(t, app, "PATCH", "/api/invoices/"+itoa(invOpen.ID), map[string]interface{}{
		"issueDate": "2026-01-15",
	}); code != 403 {
		t.Fatalf("expected 403 moving open invoice into closed period, got %d", code)
	}

	if code, updResp := doJSONMap(t, app, "PATCH", "/api/invoices/"+itoa(invOpen.ID), map[string]interface{}{
		"items": []map[string]interface{}{
			{"description": "Consulting", "quantity": 1, "unitPrice": 100.00},
			{"description": "Loyalty Discount", "quantity": 1, "unitPrice": -15.00},
		},
	}); code != 200 {
		t.Fatalf("expected 200 updating invoice with negative discount item, got %d (%v)", code, updResp)
	}
	var updatedInv models.Invoice
	testDB.First(&updatedInv, invOpen.ID)
	if updatedInv.Subtotal.Cents != 8500 || updatedInv.TotalAmount.Cents != 8500 {
		t.Fatalf("expected discounted subtotal/total 8500 cents, got sub=%d total=%d", updatedInv.Subtotal.Cents, updatedInv.TotalAmount.Cents)
	}

	// 3. CreateRule rejects invalid regex on "matches" operator
	if code, _ := doJSONMap(t, app, "POST", "/api/rules", map[string]interface{}{
		"name":       "Bad Matches Regex",
		"matchLogic": "AND",
		"conditions": []models.RuleCondition{{Field: "description", Operator: "matches", Value: "["}},
	}); code != 400 {
		t.Fatalf("expected 400 for invalid 'matches' regex, got %d", code)
	}

	// 4. GetRuleSuggestions separates suggestions by (category, payee)
	for i := 0; i < 2; i++ {
		testDB.Create(&models.BankTransaction{
			ChartAccountID:    &bankAcc.ID,
			CategoryAccountID: &cat1.ID,
			Date:              openDate,
			Description:       "CLOUDFLARE",
			Amount:            models.NewMoney(-20.00),
			FITID:             fmt.Sprintf("CF-CAT1-%d", i),
			AllocationStatus:  "UNLINKED",
			ReviewStatus:      "APPROVED",
		})
		testDB.Create(&models.BankTransaction{
			ChartAccountID:    &bankAcc.ID,
			CategoryAccountID: &cat2.ID,
			Date:              openDate,
			Description:       "CLOUDFLARE",
			Amount:            models.NewMoney(-25.00),
			FITID:             fmt.Sprintf("CF-CAT2-%d", i),
			AllocationStatus:  "UNLINKED",
			ReviewStatus:      "APPROVED",
		})
	}
	code, suggResp := doJSONMap(t, app, "GET", "/api/rules/suggestions", nil)
	if code != 200 {
		t.Fatalf("expected 200 GetRuleSuggestions, got %d", code)
	}
	suggs := suggResp["suggestions"].([]interface{})
	cfCount := 0
	for _, rawS := range suggs {
		s := rawS.(map[string]interface{})
		if strings.EqualFold(fmt.Sprint(s["payeeKeyword"]), "CLOUDFLARE") {
			cfCount++
		}
	}
	if cfCount != 2 {
		t.Fatalf("expected 2 distinct category suggestions for CLOUDFLARE, got %d (%v)", cfCount, suggs)
	}
}
