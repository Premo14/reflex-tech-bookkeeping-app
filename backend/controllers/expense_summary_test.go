package controllers

import (
	"bytes"
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

func seedExpenseSummaryFixtures(t *testing.T) (checking, card, revAcc, expParent, expChild, eqAcc models.ChartAccount) {
	t.Helper()
	checking = models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	card = models.ChartAccount{Code: "2020", Name: "Corporate Card", Type: "LIABILITY", Active: true}
	revAcc = models.ChartAccount{Code: "4000", Name: "Sales Revenue", Type: "REVENUE", Active: true}
	expParent = models.ChartAccount{Code: "5000", Name: "Operating Expenses", Type: "EXPENSE", Active: true}
	eqAcc = models.ChartAccount{Code: "3110", Name: "Owner Draw", Type: "EQUITY", Active: true}

	require.NoError(t, db.DB.Create(&checking).Error)
	require.NoError(t, db.DB.Create(&card).Error)
	require.NoError(t, db.DB.Create(&revAcc).Error)
	require.NoError(t, db.DB.Create(&expParent).Error)
	require.NoError(t, db.DB.Create(&eqAcc).Error)

	expChild = models.ChartAccount{Code: "5010", Name: "Office Supplies", Type: "EXPENSE", Active: true, ParentID: &expParent.ID}
	require.NoError(t, db.DB.Create(&expChild).Error)
	return
}

func TestGetSummary_NilDBAndInvalidAccount(t *testing.T) {
	db.DB = nil
	app := newTestApp()
	app.Get("/summary", GetSummary)

	req := httptest.NewRequest(http.MethodGet, "/summary", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusInternalServerError, resp.StatusCode)

	setupTestDB(t)
	defer teardownTestDB()

	reqBad := httptest.NewRequest(http.MethodGet, "/summary?accountId=notanint", nil)
	respBad, err := app.Test(reqBad)
	require.NoError(t, err)
	require.Equal(t, http.StatusBadRequest, respBad.StatusCode)
}

func TestGetSummary_ComprehensiveAccounting(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	checking, card, revAcc, expParent, expChild, _ := seedExpenseSummaryFixtures(t)
	d1 := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
	dOutOfRange := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)

	// 1. Categorized REVENUE deposit ($1000.00)
	txRev := models.BankTransaction{
		FITID: "SUM-REV-1", Date: d1, Description: "Client Invoice Payment",
		Amount: models.NewMoney(1000.00), TransactionType: "CREDIT",
		ChartAccountID: &checking.ID, CategoryAccountID: &revAcc.ID,
		AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	// 2. Uncategorized deposit on ASSET checking ($250.25) -> counts in operating income
	txUncatDep := models.BankTransaction{
		FITID: "SUM-DEP-2", Date: d1, Description: "Wire Deposit",
		Amount: models.NewMoney(250.25), TransactionType: "CREDIT",
		ChartAccountID: &checking.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	// 3. Uncategorized payment on LIABILITY card ($400.00) -> must NOT count as operating revenue
	txCardPayment := models.BankTransaction{
		FITID: "SUM-CCPAY-3", Date: d1, Description: "Card Payment Thank You",
		Amount: models.NewMoney(400.00), TransactionType: "CREDIT",
		ChartAccountID: &card.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	// 4. Unlinked bank debit categorized under child expense (-$120.50)
	txUnlinkedExp := models.BankTransaction{
		FITID: "SUM-EXP-4", Date: d1, Description: "Staples Paper",
		Amount: models.NewMoney(-120.50), TransactionType: "DEBIT",
		ChartAccountID: &checking.ID, CategoryAccountID: &expChild.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	// 5. Unlinked uncategorized debit (-$50.00) -> counts as expense (Suspense)
	txUncatDeb := models.BankTransaction{
		FITID: "SUM-UNC-5", Date: d1, Description: "Unknown ATM",
		Amount: models.NewMoney(-50.00), TransactionType: "DEBIT",
		ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	// 6. Partially allocated debit (-$100.00) with $40 confirmed receipt ($60 remainder)
	txPartial := models.BankTransaction{
		FITID: "SUM-PART-6", Date: d1, Description: "Target Split Debit",
		Amount: models.NewMoney(-100.00), TransactionType: "DEBIT",
		ChartAccountID: &checking.ID, CategoryAccountID: &expChild.ID,
		AllocationStatus: "PARTIALLY_ALLOCATED", ReviewStatus: "APPROVED",
	}
	// 7. Excluded & out-of-range transactions (must not count inside May window)
	txIgnored := models.BankTransaction{
		FITID: "SUM-IGN-7", Date: d1, Description: "Duplicate Ignored",
		Amount: models.NewMoney(999.00), TransactionType: "CREDIT",
		ChartAccountID: &checking.ID, AllocationStatus: "BALANCED", ReviewStatus: "IGNORED",
	}
	txOld := models.BankTransaction{
		FITID: "SUM-OLD-8", Date: dOutOfRange, Description: "Jan Prior Period",
		Amount: models.NewMoney(500.00), TransactionType: "CREDIT",
		ChartAccountID: &checking.ID, CategoryAccountID: &revAcc.ID,
		AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	for _, tx := range []*models.BankTransaction{&txRev, &txUncatDep, &txCardPayment, &txUnlinkedExp, &txUncatDeb, &txPartial, &txIgnored, &txOld} {
		require.NoError(t, db.DB.Create(tx).Error)
	}

	// Cash expense ($29.50) -> counts in expenses without bank link
	expCash := models.Expense{
		Timestamp: d1, Vendor: "Local Diner", Description: "Cash Lunch",
		Amount: models.NewMoney(29.50), Tender: "cash", ChartAccountID: &expChild.ID,
		AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	// Confirmed partial receipt ($40.00) linked to txPartial
	expPartial := models.Expense{
		Timestamp: d1, Vendor: "Target", Description: "Printer Ink",
		Amount: models.NewMoney(40.00), Tender: "debit", ChartAccountID: &expChild.ID,
		AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	// Unlinked non-cash expense ($75.00) -> counts in unlinkedExpCount, not P&L totalExpenses yet
	expUnlinked := models.Expense{
		Timestamp: d1, Vendor: "Home Depot", Description: "Pending Receipt",
		Amount: models.NewMoney(75.00), Tender: "credit card", ChartAccountID: &expChild.ID,
		AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED",
	}
	for _, e := range []*models.Expense{&expCash, &expPartial, &expUnlinked} {
		require.NoError(t, db.DB.Create(e).Error)
	}
	require.NoError(t, db.DB.Create(&models.ExpenseBankTransaction{
		ExpenseID: expPartial.ID, BankTransactionID: txPartial.ID, Status: "confirmed",
	}).Error)

	app := newTestApp()
	app.Get("/summary", GetSummary)

	req := httptest.NewRequest(http.MethodGet, "/summary?startDate=2026-05-01&endDate=2026-05-31", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))

	// Income = 1000.00 + 250.25 = 1250.25 (card payment ignored as revenue)
	require.InDelta(t, 1250.25, body["totalIncome"], 0.001)
	// Deposits = 1000 + 250.25 + 400 = 1650.25
	require.InDelta(t, 1650.25, body["totalDeposits"], 0.001)
	// Debits = -120.50 - 50.00 - 100.00 = -270.50
	require.InDelta(t, -270.50, body["totalDebits"], 0.001)
	// Expenses = (29.50 + 40.00) + 120.50 + 50.00 + 60.00 = 300.00
	require.InDelta(t, 300.00, body["totalExpenses"], 0.001)
	require.InDelta(t, 1379.75, body["netCashflow"], 0.001)
	require.InDelta(t, 950.25, body["netIncome"], 0.001)

	// Hierarchical parent account filter should include child expense 5010
	reqAcc := httptest.NewRequest(http.MethodGet, "/summary?startDate=2026-05-01&endDate=2026-05-31&accountId="+itoa(expParent.ID), nil)
	respAcc, err := app.Test(reqAcc)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, respAcc.StatusCode)
	var bodyAcc map[string]interface{}
	require.NoError(t, json.NewDecoder(respAcc.Body).Decode(&bodyAcc))
	// Expenses under 5000 hierarchy: cash(29.50) + confirmed(40.00) + unlinkedExp(120.50) + partialRem(60.00) = 250.00
	require.InDelta(t, 250.00, bodyAcc["totalExpenses"], 0.001)
}

func TestExpenseControllers_CRUDAndFilters(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	checking, _, revAcc, expParent, expChild, _ := seedExpenseSummaryFixtures(t)
	// Lock period through 2026-02-28
	require.NoError(t, db.DB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-02-28"}).Error)

	// ValidateExpenseCategory unit checks
	require.NoError(t, ValidateExpenseCategory(nil))
	require.Error(t, ValidateExpenseCategory(&revAcc))
	inactiveExp := models.ChartAccount{Code: "5099", Name: "Inactive", Type: "EXPENSE", Active: false}
	require.Error(t, ValidateExpenseCategory(&inactiveExp))
	require.NoError(t, ValidateExpenseCategory(&expChild))

	app := newTestApp()
	app.Get("/expenses", GetExpenses)
	app.Get("/expenses/:id", GetExpense)
	app.Post("/expenses", CreateExpense)
	app.Patch("/expenses/:id", UpdateExpense)
	app.Delete("/expenses/:id", DeleteExpense)

	// Nil-DB checks first? Save and restore or use dedicated test. Test closed period Create (403)
	closedPayload := `{"date":"2026-02-15","vendor":"Acme","description":"Locked","amount":25.50}`
	resp, err := app.Test(httptest.NewRequest(http.MethodPost, "/expenses", strings.NewReader(closedPayload)))
	require.NoError(t, err)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)

	// Bad JSON (400)
	badReq := httptest.NewRequest(http.MethodPost, "/expenses", strings.NewReader("{bad"))
	badReq.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(badReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	// Non-EXPENSE category (400)
	nonExpReq := httptest.NewRequest(http.MethodPost, "/expenses", bytes.NewBufferString(
		`{"timestamp":"2026-06-01T10:00:00Z","vendor":"Coffee","description":"Latte","amount":-6.25,"taxAmount":-0.50,"tender":"cash","chartAccountId":`+itoa(revAcc.ID)+`}`,
	))
	nonExpReq.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(nonExpReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	// Non-existent category (400)
	missingCatReq := httptest.NewRequest(http.MethodPost, "/expenses", bytes.NewBufferString(
		`{"vendor":"Coffee","amount":6.25,"chartAccountId":999999}`,
	))
	missingCatReq.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(missingCatReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	// Valid cash expense creation (201, BALANCED, Abs amount)
	validCashReq := httptest.NewRequest(http.MethodPost, "/expenses", bytes.NewBufferString(
		`{"timestamp":"2026-06-01T10:00:00Z","vendor":"Corner Cafe","description":"Team Bagels","amount":-24.75,"taxAmount":-1.25,"tender":"Cash / Paper","chartAccountId":`+itoa(expChild.ID)+`,"notes":"meeting"}`,
	))
	validCashReq.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(validCashReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var createRes struct {
		Expense models.Expense `json:"expense"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&createRes))
	require.Equal(t, int64(2475), createRes.Expense.Amount.Cents)
	require.Equal(t, "BALANCED", createRes.Expense.AllocationStatus)

	// Create non-cash card expense with YYYY-MM-DD date & link to a bank tx for search/update/get tests
	expCardReq := httptest.NewRequest(http.MethodPost, "/expenses", bytes.NewBufferString(
		`{"date":"2026-06-02","vendor":"Amazon Web Services","description":"Hosting","amount":150.00,"tender":"credit","notes":"server bill"}`,
	))
	expCardReq.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(expCardReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var cardRes struct {
		Expense models.Expense `json:"expense"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&cardRes))
	require.Equal(t, "UNLINKED", cardRes.Expense.AllocationStatus)

	txLinked := models.BankTransaction{
		FITID: "EXP-LINK-1", Date: time.Date(2026, 6, 2, 0, 0, 0, 0, time.UTC),
		Description: "AWS Cloud", Amount: models.NewMoney(-150.00), TransactionType: "DEBIT",
		ChartAccountID: &checking.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	require.NoError(t, db.DB.Create(&txLinked).Error)
	require.NoError(t, db.DB.Create(&models.ExpenseBankTransaction{
		ExpenseID: cardRes.Expense.ID, BankTransactionID: txLinked.ID, Status: "confirmed",
	}).Error)

	// GetExpense 404 & 200
	resp, _ = app.Test(httptest.NewRequest(http.MethodGet, "/expenses/99999", nil))
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp, _ = app.Test(httptest.NewRequest(http.MethodGet, "/expenses/"+itoa(cardRes.Expense.ID), nil))
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// GetExpenses: invalid accountId (400), search text + dollar search, statuses, sort, pagination clamp
	resp, _ = app.Test(httptest.NewRequest(http.MethodGet, "/expenses?accountId=bad", nil))
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	for _, url := range []string{
		"/expenses?search=bagels",
		"/expenses?search=$150.00",
		"/expenses?status=NEEDS_ATTENTION&sortBy=amount&sortOrder=asc",
		"/expenses?status=UNLINKED",
		"/expenses?status=BALANCED",
		"/expenses?status=PARTIALLY_ALLOCATED",
		"/expenses?status=OVER_ALLOCATED",
		"/expenses?status=UNCATEGORIZED&sortOrder=asc&page=0&limit=999",
		"/expenses?accountId=" + itoa(expParent.ID),
	} {
		r, testErr := app.Test(httptest.NewRequest(http.MethodGet, url, nil))
		require.NoError(t, testErr)
		require.Equal(t, http.StatusOK, r.StatusCode, "failed url: %s", url)
	}

	// UpdateExpense: 404, bad JSON, invalid category, closed date (403), category sync to linked tx, clear category, tender cash<->credit
	resp, _ = app.Test(httptest.NewRequest(http.MethodPatch, "/expenses/99999", strings.NewReader(`{}`)))
	require.Equal(t, http.StatusNotFound, resp.StatusCode)

	updReq := httptest.NewRequest(http.MethodPatch, "/expenses/"+itoa(cardRes.Expense.ID), strings.NewReader("{bad"))
	resp, _ = app.Test(updReq)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	closedUpd := httptest.NewRequest(http.MethodPatch, "/expenses/"+itoa(cardRes.Expense.ID), strings.NewReader(`{"timestamp":"2026-01-10"}`))
	closedUpd.Header.Set("Content-Type", "application/json")
	resp, _ = app.Test(closedUpd)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)

	badCatUpd := httptest.NewRequest(http.MethodPatch, "/expenses/"+itoa(cardRes.Expense.ID), strings.NewReader(`{"chartAccountId":`+itoa(revAcc.ID)+`}`))
	badCatUpd.Header.Set("Content-Type", "application/json")
	resp, _ = app.Test(badCatUpd)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	goodUpd := httptest.NewRequest(http.MethodPatch, "/expenses/"+itoa(cardRes.Expense.ID), strings.NewReader(
		`{"vendor":"AWS Inc","description":"Cloud","amount":150.50,"taxAmount":5.00,"currencyCode":"USD","notes":"updated","timestamp":"2026-06-03","chartAccountId":`+itoa(expChild.ID)+`}`,
	))
	goodUpd.Header.Set("Content-Type", "application/json")
	resp, _ = app.Test(goodUpd)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// Verify 1:1 linked tx received synced categoryAccountId
	var reloadedTx models.BankTransaction
	require.NoError(t, db.DB.First(&reloadedTx, txLinked.ID).Error)
	require.NotNil(t, reloadedTx.CategoryAccountID)
	require.Equal(t, expChild.ID, *reloadedTx.CategoryAccountID)

	// Clear category via chartAccountId: null (syncs to linked tx), then switch tender -> cash & cash -> credit
	clearCat := httptest.NewRequest(http.MethodPatch, "/expenses/"+itoa(cardRes.Expense.ID), strings.NewReader(`{"chartAccountId":null}`))
	clearCat.Header.Set("Content-Type", "application/json")
	resp, _ = app.Test(clearCat)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, db.DB.First(&reloadedTx, txLinked.ID).Error)
	require.Nil(t, reloadedTx.CategoryAccountID)

	switchCash := httptest.NewRequest(http.MethodPatch, "/expenses/"+itoa(cardRes.Expense.ID), strings.NewReader(`{"tender":"cash"}`))
	switchCash.Header.Set("Content-Type", "application/json")
	resp, _ = app.Test(switchCash)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	switchCredit := httptest.NewRequest(http.MethodPatch, "/expenses/"+itoa(createRes.Expense.ID), strings.NewReader(`{"tender":"Visa"}`))
	switchCredit.Header.Set("Content-Type", "application/json")
	resp, _ = app.Test(switchCredit)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// Closed-period expense blocks Update (403) and Delete (403)
	lockedExp := models.Expense{
		Timestamp: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), Vendor: "Locked",
		Amount: models.NewMoney(10.00), ReviewStatus: "APPROVED", AllocationStatus: "UNLINKED",
	}
	require.NoError(t, db.DB.Create(&lockedExp).Error)
	resp, _ = app.Test(httptest.NewRequest(http.MethodPatch, "/expenses/"+itoa(lockedExp.ID), strings.NewReader(`{"vendor":"X"}`)))
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	resp, _ = app.Test(httptest.NewRequest(http.MethodDelete, "/expenses/"+itoa(lockedExp.ID), nil))
	require.Equal(t, http.StatusForbidden, resp.StatusCode)

	// DeleteExpense 404 & 200
	resp, _ = app.Test(httptest.NewRequest(http.MethodDelete, "/expenses/99999", nil))
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp, _ = app.Test(httptest.NewRequest(http.MethodDelete, "/expenses/"+itoa(createRes.Expense.ID), nil))
	require.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestSplitExpense_AndNilDBGuards(t *testing.T) {
	// Verify all expense nil-DB guards first
	db.DB = nil
	appNil := newTestApp()
	appNil.Get("/expenses", GetExpenses)
	appNil.Get("/expenses/:id", GetExpense)
	appNil.Post("/expenses", CreateExpense)
	appNil.Patch("/expenses/:id", UpdateExpense)
	appNil.Delete("/expenses/:id", DeleteExpense)
	appNil.Post("/expenses/:id/split", SplitExpense)

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/expenses"},
		{http.MethodGet, "/expenses/1"},
		{http.MethodPost, "/expenses"},
		{http.MethodPatch, "/expenses/1"},
		{http.MethodDelete, "/expenses/1"},
		{http.MethodPost, "/expenses/1/split"},
	} {
		r, err := appNil.Test(httptest.NewRequest(tc.method, tc.path, nil))
		require.NoError(t, err)
		require.Equal(t, http.StatusInternalServerError, r.StatusCode)
	}

	setupTestDB(t)
	defer teardownTestDB()

	checking, _, revAcc, _, expChild, _ := seedExpenseSummaryFixtures(t)
	inactiveAcc := models.ChartAccount{Code: "5088", Name: "Old Expense", Type: "EXPENSE", Active: false}
	require.NoError(t, db.DB.Create(&inactiveAcc).Error)
	require.NoError(t, db.DB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-02-28"}).Error)

	app := newTestApp()
	app.Post("/expenses/:id/split", SplitExpense)

	// 404
	resp, _ := app.Test(httptest.NewRequest(http.MethodPost, "/expenses/99999/split", strings.NewReader(`{}`)))
	require.Equal(t, http.StatusNotFound, resp.StatusCode)

	// Closed period (403) & Deleted expense (400)
	lockedExp := models.Expense{Timestamp: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), Vendor: "L", Amount: models.NewMoney(10), ReviewStatus: "APPROVED"}
	deletedExp := models.Expense{Timestamp: time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC), Vendor: "D", Amount: models.NewMoney(10), ReviewStatus: "DELETED"}
	require.NoError(t, db.DB.Create(&lockedExp).Error)
	require.NoError(t, db.DB.Create(&deletedExp).Error)

	resp, _ = app.Test(httptest.NewRequest(http.MethodPost, "/expenses/"+itoa(lockedExp.ID)+"/split", strings.NewReader(`{}`)))
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	resp, _ = app.Test(httptest.NewRequest(http.MethodPost, "/expenses/"+itoa(deletedExp.ID)+"/split", strings.NewReader(`{}`)))
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	// Parent open expense with $10.00 and $0.05 tax (odd penny tax!) + bank link + receipt
	parent := models.Expense{
		Timestamp: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
		Vendor: "Target", Description: "Target Mixed Cart",
		Amount: models.NewMoney(10.00), TaxAmount: models.NewMoney(0.05),
		Tender: "debit", ChartAccountID: &expChild.ID,
		AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	require.NoError(t, db.DB.Create(&parent).Error)
	tx := models.BankTransaction{
		FITID: "SPL-TX-1", Date: parent.Timestamp, Description: "TARGET 001",
		Amount: models.NewMoney(-10.00), TransactionType: "DEBIT",
		ChartAccountID: &checking.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED",
	}
	require.NoError(t, db.DB.Create(&tx).Error)
	require.NoError(t, db.DB.Create(&models.ExpenseBankTransaction{ExpenseID: parent.ID, BankTransactionID: tx.ID, Status: "confirmed"}).Error)
	require.NoError(t, db.DB.Create(&models.Receipt{ExpenseID: &parent.ID, DocumentURI: "/processed/r.png", FileExt: ".png", FileHash: "abc"}).Error)

	splitURL := "/expenses/" + itoa(parent.ID) + "/split"
	// Validation errors: bad JSON, <2 lines, <=0 line, unknown account, inactive account, non-EXPENSE account, sum mismatch
	for _, payload := range []string{
		`{bad`,
		`{"splits":[{"amount":10.00}]}`,
		`{"splits":[{"amount":10.00},{"amount":0}]}`,
		`{"splits":[{"amount":5.00,"chartAccountId":999999},{"amount":5.00}]}`,
		`{"splits":[{"amount":5.00,"chartAccountId":` + itoa(inactiveAcc.ID) + `},{"amount":5.00}]}`,
		`{"splits":[{"amount":5.00,"chartAccountId":` + itoa(revAcc.ID) + `},{"amount":5.00}]}`,
		`{"splits":[{"amount":4.00},{"amount":5.00}]}`,
	} {
		req := httptest.NewRequest(http.MethodPost, splitURL, strings.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		r, err := app.Test(req)
		require.NoError(t, err)
		require.Equal(t, http.StatusBadRequest, r.StatusCode, "payload: %s", payload)
	}

	// Happy path 3-way split ($3.33 + $3.33 + $3.34 = $10.00), one personal line + remainder tax verification
	goodSplit := `{
		"splits": [
			{"amount": 3.33, "chartAccountId": ` + itoa(expChild.ID) + `, "vendor": "Target Biz", "description": "Paper"},
			{"amount": 3.33, "chartAccountId": ` + itoa(expChild.ID) + `},
			{"amount": 3.34, "isPersonal": true, "description": "Groceries"}
		]
	}`
	reqGood := httptest.NewRequest(http.MethodPost, splitURL, strings.NewReader(goodSplit))
	reqGood.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(reqGood)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var splitOut struct {
		OriginalExpense models.Expense   `json:"originalExpense"`
		CreatedExpenses []models.Expense `json:"createdExpenses"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&splitOut))
	require.Len(t, splitOut.CreatedExpenses, 2)
	require.Equal(t, "IGNORED", splitOut.CreatedExpenses[1].ReviewStatus)
	require.Equal(t, "PERSONAL", splitOut.CreatedExpenses[1].ExclusionReason)

	// Exact penny tax conservation: original + child1 + child2 tax == 5 cents!
	totalTaxCents := splitOut.OriginalExpense.TaxAmount.Cents +
		splitOut.CreatedExpenses[0].TaxAmount.Cents +
		splitOut.CreatedExpenses[1].TaxAmount.Cents
	require.Equal(t, int64(5), totalTaxCents)

	// Child splits must inherit bank link & receipt
	var linksCount, recCount int64
	db.DB.Model(&models.ExpenseBankTransaction{}).Where("bank_transaction_id = ?", tx.ID).Count(&linksCount)
	db.DB.Model(&models.Receipt{}).Where("file_hash = ?", "abc").Count(&recCount)
	require.Equal(t, int64(3), linksCount)
	require.Equal(t, int64(3), recCount)
}

func itoa(v uint) string {
	b, _ := json.Marshal(v)
	return string(b)
}
