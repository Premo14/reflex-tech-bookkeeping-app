package controllers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/stretchr/testify/require"
)

func seedReconciliationFixtures(t *testing.T) (checking, revAcc, expA, expB, inactiveExp models.ChartAccount) {
	t.Helper()
	checking = models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	revAcc = models.ChartAccount{Code: "4000", Name: "Revenue", Type: "REVENUE", Active: true}
	expA = models.ChartAccount{Code: "5010", Name: "Office Supplies", Type: "EXPENSE", Active: true}
	expB = models.ChartAccount{Code: "5020", Name: "Software", Type: "EXPENSE", Active: true}
	inactiveExp = models.ChartAccount{Code: "5099", Name: "Old Category", Type: "EXPENSE", Active: false}

	require.NoError(t, db.DB.Create(&checking).Error)
	require.NoError(t, db.DB.Create(&revAcc).Error)
	require.NoError(t, db.DB.Create(&expA).Error)
	require.NoError(t, db.DB.Create(&expB).Error)
	require.NoError(t, db.DB.Create(&inactiveExp).Error)
	require.NoError(t, db.DB.Model(&inactiveExp).Update("active", false).Error)
	return
}

func TestReconciliationControllers_NilDBGuards(t *testing.T) {
	origDB := db.DB
	db.DB = nil
	defer func() { db.DB = origDB }()

	app := newTestApp()
	app.Post("/reconcile", TriggerReconciliation)
	app.Get("/reconcile/flagged", GetFlaggedItems)
	app.Post("/reconcile/link", LinkExpenseToTransaction)
	app.Post("/reconcile/unlink", UnlinkExpense)
	app.Post("/expenses/:id/cash", MarkExpenseAsCash)
	app.Get("/reconcile/unlinked", GetUnlinkedItems)
	app.Post("/reconcile/create-link", CreateAndLink)
	app.Post("/reconcile/link-invoice", LinkExpenseToInvoice)
	app.Post("/reconcile/unlink-invoice", UnlinkExpenseFromInvoice)

	cases := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/reconcile"},
		{http.MethodGet, "/reconcile/flagged"},
		{http.MethodPost, "/reconcile/link"},
		{http.MethodPost, "/reconcile/unlink"},
		{http.MethodPost, "/expenses/1/cash"},
		{http.MethodGet, "/reconcile/unlinked"},
		{http.MethodPost, "/reconcile/create-link"},
		{http.MethodPost, "/reconcile/link-invoice"},
		{http.MethodPost, "/reconcile/unlink-invoice"},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		require.NoError(t, err)
		require.Equal(t, http.StatusInternalServerError, resp.StatusCode, tc.path)
	}
}

func TestTriggerFlaggedAndUnlinkedEndpoints(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	checking, _, expA, _, _ := seedReconciliationFixtures(t)
	d1 := time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)
	d2 := time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC) // >170d apart so reconciler leaves both unlinked

	tx1 := models.BankTransaction{
		FITID: "REC-TX-1", Date: d1, Description: "STAPLES #104", Amount: models.NewMoney(-150.00),
		TransactionType: "DEBIT", ChartAccountID: &checking.ID, CategoryAccountID: &expA.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	exp1 := models.Expense{
		Timestamp: d2, Vendor: "Staples", Description: "Paper & Toner", Amount: models.NewMoney(150.00),
		Tender: "credit", ChartAccountID: &expA.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	expCash := models.Expense{
		Timestamp: d2, Vendor: "Cash Coffee", Amount: models.NewMoney(5.00),
		Tender: "cash", AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	require.NoError(t, db.DB.Create(&tx1).Error)
	require.NoError(t, db.DB.Create(&exp1).Error)
	require.NoError(t, db.DB.Create(&expCash).Error)

	app := newTestApp()
	app.Post("/reconcile", TriggerReconciliation)
	app.Get("/reconcile/flagged", GetFlaggedItems)
	app.Get("/reconcile/unlinked", GetUnlinkedItems)

	// Concurrency guard (409) when already running, then start (200)
	reconciliationMutex.Lock()
	reconciliationRunning = true
	reconciliationMutex.Unlock()
	resp, err := app.Test(httptest.NewRequest(http.MethodPost, "/reconcile", nil))
	require.NoError(t, err)
	require.Equal(t, http.StatusConflict, resp.StatusCode)

	reconciliationMutex.Lock()
	reconciliationRunning = false
	reconciliationMutex.Unlock()
	resp, err = app.Test(httptest.NewRequest(http.MethodPost, "/reconcile", nil))
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	// Wait briefly for background goroutine to finish before teardownTestDB
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		reconciliationMutex.Lock()
		done := !reconciliationRunning
		reconciliationMutex.Unlock()
		if done {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Flagged items with date range
	resp, err = app.Test(httptest.NewRequest(http.MethodGet, "/reconcile/flagged?startDate=2026-06-01&endDate=2026-06-30", nil))
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// Unlinked items: pagination clamp, numeric dollar search (cents!), text search, score sort
	urls := []string{
		"/reconcile/unlinked?page=0&limit=500",
		"/reconcile/unlinked?search=$150.00",
		"/reconcile/unlinked?search=staples",
		"/reconcile/unlinked?targetAmount=-150.00&targetDate=2026-06-11",
		"/reconcile/unlinked?targetAmount=150.00&targetDate=2026-06-11T00:00:00Z",
		"/reconcile/unlinked?targetAmount=150.00",
		"/reconcile/unlinked?startDate=2026-06-01&endDate=2026-06-30",
	}
	for _, u := range urls {
		r, e := app.Test(httptest.NewRequest(http.MethodGet, u, nil))
		require.NoError(t, e)
		require.Equal(t, http.StatusOK, r.StatusCode, u)
		var out map[string]interface{}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&out))
		require.Equal(t, "success", out["status"], u)
	}
	// Verify numeric amount search actually matched the $150.00 unlinked tx and exp
	r, err := app.Test(httptest.NewRequest(http.MethodGet, "/reconcile/unlinked?search=$150.00", nil))
	require.NoError(t, err)
	var searchOut struct {
		TotalTxs      int64 `json:"totalTxs"`
		TotalExpenses int64 `json:"totalExpenses"`
	}
	require.NoError(t, json.NewDecoder(r.Body).Decode(&searchOut))
	require.GreaterOrEqual(t, searchOut.TotalTxs, int64(1))
	require.GreaterOrEqual(t, searchOut.TotalExpenses, int64(1))
}

func TestLinkUnlinkMarkCashAndSplits(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	checking, revAcc, expA, expB, _ := seedReconciliationFixtures(t)
	require.NoError(t, db.DB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-02-28"}).Error)

	dJune := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	dClosed := time.Date(2026, 2, 10, 0, 0, 0, 0, time.UTC)

	tx100 := models.BankTransaction{
		FITID: "REC-100", Date: dJune, Description: "Split Target", Amount: models.NewMoney(-100.00),
		TransactionType: "DEBIT", ChartAccountID: &checking.ID, CategoryAccountID: &expA.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	txDeposit := models.BankTransaction{
		FITID: "REC-DEP", Date: dJune, Description: "Customer Deposit", Amount: models.NewMoney(100.00),
		TransactionType: "CREDIT", ChartAccountID: &checking.ID,
		AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	txPending := models.BankTransaction{
		FITID: "REC-PEND", Date: dJune, Description: "Pending", Amount: models.NewMoney(-25.00),
		TransactionType: "DEBIT", ChartAccountID: &checking.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "PENDING",
	}
	txClosed := models.BankTransaction{
		FITID: "REC-CL", Date: dClosed, Description: "Closed", Amount: models.NewMoney(-25.00),
		TransactionType: "DEBIT", ChartAccountID: &checking.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	tx60 := models.BankTransaction{
		FITID: "REC-60", Date: dJune, Description: "Split Tx 1", Amount: models.NewMoney(-60.00),
		TransactionType: "DEBIT", ChartAccountID: &checking.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	tx50 := models.BankTransaction{
		FITID: "REC-50", Date: dJune, Description: "Split Tx 2", Amount: models.NewMoney(-50.00),
		TransactionType: "DEBIT", ChartAccountID: &checking.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	tx40 := models.BankTransaction{
		FITID: "REC-40", Date: dJune.AddDate(0, 1, 0), Description: "Split Tx 3", Amount: models.NewMoney(-40.00),
		TransactionType: "DEBIT", ChartAccountID: &checking.ID, CategoryAccountID: &expB.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	for _, rec := range []*models.BankTransaction{&tx100, &txDeposit, &txPending, &txClosed, &tx60, &tx50, &tx40} {
		require.NoError(t, db.DB.Create(rec).Error)
	}

	expCash := models.Expense{Timestamp: dJune, Vendor: "Cash", Amount: models.NewMoney(10.00), Tender: "cash", AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	expDeleted := models.Expense{Timestamp: dJune, Vendor: "Del", Amount: models.NewMoney(10.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "DELETED"}
	exp60B := models.Expense{Timestamp: dJune, Vendor: "Part 1", Amount: models.NewMoney(60.00), Tender: "card", ChartAccountID: &expB.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	exp50Nil := models.Expense{Timestamp: dJune.AddDate(0, 2, 0), Vendor: "Part 2", Amount: models.NewMoney(50.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	exp40Nil := models.Expense{Timestamp: dJune, Vendor: "Part 3", Amount: models.NewMoney(40.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	exp100A := models.Expense{Timestamp: dJune, Vendor: "Nto1Exp", Amount: models.NewMoney(100.00), Tender: "card", ChartAccountID: &expA.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	expMultiRec := models.Expense{Timestamp: dJune.AddDate(0, 3, 0), Vendor: "MultiRec", Amount: models.NewMoney(100.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	for _, rec := range []*models.Expense{&expCash, &expDeleted, &exp60B, &exp50Nil, &exp40Nil, &exp100A, &expMultiRec} {
		require.NoError(t, db.DB.Create(rec).Error)
	}
	require.NoError(t, db.DB.Create(&models.Receipt{ExpenseID: &expMultiRec.ID, DocumentURI: "r1.pdf", FileExt: ".pdf"}).Error)
	require.NoError(t, db.DB.Create(&models.Receipt{ExpenseID: &expMultiRec.ID, DocumentURI: "r2.pdf", FileExt: ".pdf"}).Error)

	app := newTestApp()
	app.Post("/reconcile/link", LinkExpenseToTransaction)
	app.Post("/reconcile/unlink", UnlinkExpense)
	app.Post("/expenses/:id/cash", MarkExpenseAsCash)

	postJSON := func(path, body string) int {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		require.NoError(t, err)
		return resp.StatusCode
	}

	// Guard tests for LinkExpenseToTransaction
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{bad`))
	require.Equal(t, http.StatusNotFound, postJSON("/reconcile/link", `{"expenseId":1,"transactionId":99999}`))
	require.Equal(t, http.StatusNotFound, postJSON("/reconcile/link", `{"expenseId":99999,"transactionId":`+itoa(tx100.ID)+`}`))
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp60B.ID)+`,"transactionId":`+itoa(tx100.ID)+`,"overrideChartAccountId":99999}`))
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp60B.ID)+`,"transactionId":`+itoa(tx100.ID)+`,"overrideChartAccountId":`+itoa(revAcc.ID)+`}`))
	require.Equal(t, http.StatusForbidden, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp60B.ID)+`,"transactionId":`+itoa(txPending.ID)+`}`))
	require.Equal(t, http.StatusForbidden, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp60B.ID)+`,"transactionId":`+itoa(txClosed.ID)+`}`))
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(expCash.ID)+`,"transactionId":`+itoa(tx100.ID)+`}`))
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp60B.ID)+`,"transactionId":`+itoa(txDeposit.ID)+`}`))

	// Category mismatch (400 CATEGORY_MISMATCH), then overrideChartAccountId resolves (200), then idempotent already-linked (200)
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp60B.ID)+`,"transactionId":`+itoa(tx100.ID)+`}`))
	require.Equal(t, http.StatusOK, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp60B.ID)+`,"transactionId":`+itoa(tx100.ID)+`,"overrideChartAccountId":`+itoa(expA.ID)+`}`))
	require.Equal(t, http.StatusOK, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp60B.ID)+`,"transactionId":`+itoa(tx100.ID)+`}`))

	// 1:N exact-cent over-allocation guard ($60 + $50 > $100 -> 400 OVER_ALLOCATED), valid $40 split succeeds (200)
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp50Nil.ID)+`,"transactionId":`+itoa(tx100.ID)+`}`))
	require.Equal(t, http.StatusOK, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp40Nil.ID)+`,"transactionId":`+itoa(tx100.ID)+`}`))

	// M:N guard: exp60B already linked to tx100, so linking exp60B to a tx that is linked would fail; link exp100A <-> tx60 first
	require.Equal(t, http.StatusOK, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp100A.ID)+`,"transactionId":`+itoa(tx60.ID)+`}`))
	// Now both exp100A and tx100 have links -> M:N guard (400)
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp100A.ID)+`,"transactionId":`+itoa(tx100.ID)+`}`))
	// N:1 over-allocation guard ($60 + $50 > $100 -> 400), category mismatch on N:1 (tx40 has expB != expA -> 400), force=true succeeds
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp100A.ID)+`,"transactionId":`+itoa(tx50.ID)+`}`))
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp100A.ID)+`,"transactionId":`+itoa(tx40.ID)+`}`))
	require.Equal(t, http.StatusOK, postJSON("/reconcile/link", `{"expenseId":`+itoa(exp100A.ID)+`,"transactionId":`+itoa(tx50.ID)+`,"force":true}`))

	// Multi-receipt expense cannot split across multiple txs (400)
	require.Equal(t, http.StatusOK, postJSON("/reconcile/link", `{"expenseId":`+itoa(expMultiRec.ID)+`,"transactionId":`+itoa(tx40.ID)+`,"force":true}`))
	txExtra := models.BankTransaction{FITID: "REC-EXT", Date: dJune, Description: "Extra", Amount: models.NewMoney(-10.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	require.NoError(t, db.DB.Create(&txExtra).Error)
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/link", `{"expenseId":`+itoa(expMultiRec.ID)+`,"transactionId":`+itoa(txExtra.ID)+`,"force":true}`))

	// Unlink guards & success
	require.Equal(t, http.StatusBadRequest, postJSON("/reconcile/unlink", `{bad`))
	require.Equal(t, http.StatusNotFound, postJSON("/reconcile/unlink", `{"expenseId":99999,"transactionId":99999}`))
	require.Equal(t, http.StatusForbidden, postJSON("/reconcile/unlink", `{"expenseId":`+itoa(exp100A.ID)+`,"transactionId":`+itoa(txClosed.ID)+`}`))
	require.Equal(t, http.StatusOK, postJSON("/reconcile/unlink", `{"expenseId":`+itoa(exp40Nil.ID)+`,"transactionId":`+itoa(tx100.ID)+`}`))

	// MarkExpenseAsCash guards & success
	require.Equal(t, http.StatusNotFound, postJSON("/expenses/99999/cash", ""))
	require.Equal(t, http.StatusBadRequest, postJSON("/expenses/"+itoa(expDeleted.ID)+"/cash", ""))
	expLocked := models.Expense{Timestamp: dClosed, Vendor: "Old", Amount: models.NewMoney(10.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	require.NoError(t, db.DB.Create(&expLocked).Error)
	require.Equal(t, http.StatusForbidden, postJSON("/expenses/"+itoa(expLocked.ID)+"/cash", ""))
	require.Equal(t, http.StatusOK, postJSON("/expenses/"+itoa(expMultiRec.ID)+"/cash", ""))
}

func TestCreateAndLink_AndInvoiceExpenseLinks(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	checking, revAcc, expA, expB, _ := seedReconciliationFixtures(t)
	require.NoError(t, db.DB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-02-28"}).Error)
	dJune := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	dClosed := time.Date(2026, 2, 10, 0, 0, 0, 0, time.UTC)

	tx100 := models.BankTransaction{
		FITID: "CAL-TX-1", Date: dJune, Description: "Host Bill", Amount: models.NewMoney(-100.00),
		TransactionType: "DEBIT", ChartAccountID: &checking.ID, CategoryAccountID: &expA.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	txDep := models.BankTransaction{FITID: "CAL-DEP", Date: dJune, Description: "Dep", Amount: models.NewMoney(50.00), TransactionType: "CREDIT", ChartAccountID: &checking.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	txPend := models.BankTransaction{FITID: "CAL-PND", Date: dJune, Description: "Pnd", Amount: models.NewMoney(-50.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "PENDING"}
	txCl := models.BankTransaction{FITID: "CAL-CL", Date: dClosed, Description: "Cl", Amount: models.NewMoney(-50.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	for _, r := range []*models.BankTransaction{&tx100, &txDep, &txPend, &txCl} {
		require.NoError(t, db.DB.Create(r).Error)
	}

	exp100 := models.Expense{Timestamp: dJune, Vendor: "Hardware", Amount: models.NewMoney(100.00), Tender: "card", ChartAccountID: &expA.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	expCash := models.Expense{Timestamp: dJune, Vendor: "Cash", Amount: models.NewMoney(20.00), Tender: "cash", AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	expPend := models.Expense{Timestamp: dJune, Vendor: "Pend", Amount: models.NewMoney(20.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "PENDING"}
	expDel := models.Expense{Timestamp: dJune, Vendor: "Del", Amount: models.NewMoney(20.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "DELETED"}
	expCl := models.Expense{Timestamp: dClosed, Vendor: "Cl", Amount: models.NewMoney(20.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	for _, r := range []*models.Expense{&exp100, &expCash, &expPend, &expDel, &expCl} {
		require.NoError(t, db.DB.Create(r).Error)
	}

	invActive := models.Invoice{InvoiceNumber: "INV-2001", ClientName: "Acme", IssueDate: dJune, DueDate: dJune.AddDate(0, 0, 30), TotalAmount: models.NewMoney(500.00), BalanceDue: models.NewMoney(500.00), Status: "SENT"}
	invVoid := models.Invoice{InvoiceNumber: "INV-2002", ClientName: "VoidCo", IssueDate: dJune, DueDate: dJune.AddDate(0, 0, 30), TotalAmount: models.NewMoney(100.00), BalanceDue: models.NewMoney(0), Status: "VOID"}
	require.NoError(t, db.DB.Create(&invActive).Error)
	require.NoError(t, db.DB.Create(&invVoid).Error)

	app := newTestApp()
	app.Post("/reconcile/create-link", CreateAndLink)
	app.Post("/reconcile/link-invoice", LinkExpenseToInvoice)
	app.Post("/reconcile/unlink-invoice", UnlinkExpenseFromInvoice)

	post := func(path, body string) int {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		require.NoError(t, err)
		return resp.StatusCode
	}

	// CreateAndLink input validation
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{bad`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"other","targetId":1,"amount":10}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"transaction","targetId":0,"amount":10}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"transaction","targetId":1,"amount":0}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(tx100.ID)+`,"amount":10,"chartAccountId":`+itoa(revAcc.ID)+`}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(exp100.ID)+`,"amount":-10}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(exp100.ID)+`,"amount":-10,"chartAccountId":`+itoa(expA.ID)+`}`))

	// CreateAndLink type="transaction" domain errors + category mismatch + happy path split
	require.Equal(t, http.StatusNotFound, post("/reconcile/create-link", `{"type":"transaction","targetId":99999,"amount":10,"timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusForbidden, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(txPend.ID)+`,"amount":10,"timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusForbidden, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(txCl.ID)+`,"amount":10,"timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(tx100.ID)+`,"amount":10,"tender":"cash","timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(txDep.ID)+`,"amount":10,"tender":"card","timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(tx100.ID)+`,"amount":150,"tender":"card","timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(tx100.ID)+`,"amount":50,"tender":"card","chartAccountId":`+itoa(expB.ID)+`,"timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusOK, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(tx100.ID)+`,"amount":60,"vendor":"Sub1","tender":"card","timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusOK, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(tx100.ID)+`,"amount":40,"vendor":"Sub2","tender":"card","overrideChartAccountId":`+itoa(expB.ID)+`,"timestamp":"2026-06-15T00:00:00Z"}`))

	// CreateAndLink type="receipt" domain errors + category mismatch + happy path
	require.Equal(t, http.StatusNotFound, post("/reconcile/create-link", `{"type":"receipt","targetId":99999,"amount":-10,"chartAccountId":`+itoa(checking.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusForbidden, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(expPend.ID)+`,"amount":-10,"chartAccountId":`+itoa(checking.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusForbidden, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(expCl.ID)+`,"amount":-10,"chartAccountId":`+itoa(checking.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(expCash.ID)+`,"amount":-10,"chartAccountId":`+itoa(checking.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(exp100.ID)+`,"amount":10,"chartAccountId":`+itoa(checking.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(exp100.ID)+`,"amount":-150,"chartAccountId":`+itoa(checking.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(exp100.ID)+`,"amount":-40,"chartAccountId":`+itoa(checking.ID)+`,"categoryAccountId":`+itoa(expB.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusOK, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(exp100.ID)+`,"amount":-40,"description":"Part 1","chartAccountId":`+itoa(checking.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusOK, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(exp100.ID)+`,"amount":-60,"description":"Part 2","chartAccountId":`+itoa(checking.ID)+`,"overrideChartAccountId":`+itoa(expB.ID)+`,"date":"2026-06-15T00:00:00Z"}`))

	// Extra category inheritance + zero ID normalization + multi-receipt split block in CreateAndLink
	txUncat := models.BankTransaction{FITID: "CAL-UC", Date: dJune.AddDate(0, 1, 0), Description: "UncatTx", Amount: models.NewMoney(-70.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	require.NoError(t, db.DB.Create(&txUncat).Error)
	require.Equal(t, http.StatusOK, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(txUncat.ID)+`,"amount":35,"vendor":"CatSync","tender":"card","chartAccountId":`+itoa(expA.ID)+`,"overrideChartAccountId":0,"timestamp":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusOK, post("/reconcile/create-link", `{"type":"transaction","targetId":`+itoa(txUncat.ID)+`,"amount":35,"vendor":"Inherit","tender":"card","timestamp":"2026-06-15T00:00:00Z"}`))

	expMulti := models.Expense{Timestamp: dJune.AddDate(0, 2, 0), Vendor: "Multi", Amount: models.NewMoney(80.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	require.NoError(t, db.DB.Create(&expMulti).Error)
	require.NoError(t, db.DB.Create(&models.Receipt{ExpenseID: &expMulti.ID, DocumentURI: "a.pdf", FileExt: ".pdf"}).Error)
	require.NoError(t, db.DB.Create(&models.Receipt{ExpenseID: &expMulti.ID, DocumentURI: "b.pdf", FileExt: ".pdf"}).Error)
	require.Equal(t, http.StatusOK, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(expMulti.ID)+`,"amount":-40,"description":"Half 1","chartAccountId":`+itoa(checking.ID)+`,"categoryAccountId":`+itoa(expA.ID)+`,"date":"2026-06-15T00:00:00Z"}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/create-link", `{"type":"receipt","targetId":`+itoa(expMulti.ID)+`,"amount":-40,"description":"Half 2","chartAccountId":`+itoa(checking.ID)+`,"date":"2026-06-15T00:00:00Z"}`))

	// LinkExpenseToInvoice & UnlinkExpenseFromInvoice
	require.Equal(t, http.StatusBadRequest, post("/reconcile/link-invoice", `{"expenseId":0}`))
	require.Equal(t, http.StatusNotFound, post("/reconcile/link-invoice", `{"expenseId":99999,"invoiceId":`+itoa(invActive.ID)+`}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/link-invoice", `{"expenseId":`+itoa(expDel.ID)+`,"invoiceId":`+itoa(invActive.ID)+`}`))
	require.Equal(t, http.StatusForbidden, post("/reconcile/link-invoice", `{"expenseId":`+itoa(expCl.ID)+`,"invoiceId":`+itoa(invActive.ID)+`}`))
	require.Equal(t, http.StatusNotFound, post("/reconcile/link-invoice", `{"expenseId":`+itoa(exp100.ID)+`,"invoiceId":99999}`))
	require.Equal(t, http.StatusBadRequest, post("/reconcile/link-invoice", `{"expenseId":`+itoa(exp100.ID)+`,"invoiceId":`+itoa(invVoid.ID)+`}`))
	require.Equal(t, http.StatusOK, post("/reconcile/link-invoice", `{"expenseId":`+itoa(exp100.ID)+`,"invoiceId":`+itoa(invActive.ID)+`}`))

	require.Equal(t, http.StatusBadRequest, post("/reconcile/unlink-invoice", `{"expenseId":0}`))
	require.Equal(t, http.StatusNotFound, post("/reconcile/unlink-invoice", `{"expenseId":99999}`))
	require.Equal(t, http.StatusForbidden, post("/reconcile/unlink-invoice", `{"expenseId":`+itoa(expCl.ID)+`}`))
	require.Equal(t, http.StatusOK, post("/reconcile/unlink-invoice", `{"expenseId":`+itoa(exp100.ID)+`}`))
}
