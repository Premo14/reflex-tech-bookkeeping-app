package controllers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
	"github.com/stretchr/testify/require"
)

func buildReviewExclusionApp() *fiber.App {
	app := newTestApp()
	app.Get("/review/counts", GetReviewQueueCounts)
	app.Get("/review", GetReviewQueue)
	app.Post("/review/resolve", ResolveQueueItems)
	app.Post("/review/batch-categorize", BatchCategorizeItems)
	app.Post("/exclude/preview", ExcludePreview)
	app.Post("/exclude", ExcludeItem)
	app.Post("/exclude/restore", RestoreItem)
	app.Post("/exclude/restore-bulk", RestoreBulk)
	app.Post("/exclude/bulk-preview", ExcludeBulkPreview)
	app.Post("/exclude/bulk", ExcludeBulk)
	app.Post("/delete/bulk", DeleteBulk)
	app.Post("/delete/restore-bulk", RestoreDeletedBulk)
	app.Post("/delete/move-excluded-bulk", MoveDeletedToExcludedBulk)
	app.Post("/delete/permanent-bulk", DeletePermanentBulk)
	return app
}

func doJSONReq(t *testing.T, app *fiber.App, method, path, body string) *http.Response {
	t.Helper()
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	resp, err := app.Test(r)
	require.NoError(t, err)
	return resp
}

func TestReviewExclusion_NilDBGuards(t *testing.T) {
	orig := db.DB
	db.DB = nil
	defer func() { db.DB = orig }()

	app := buildReviewExclusionApp()
	routes := [][2]string{
		{http.MethodGet, "/review/counts"},
		{http.MethodGet, "/review"},
		{http.MethodPost, "/review/resolve"},
		{http.MethodPost, "/review/batch-categorize"},
		{http.MethodPost, "/exclude/preview"},
		{http.MethodPost, "/exclude"},
		{http.MethodPost, "/exclude/restore"},
		{http.MethodPost, "/exclude/restore-bulk"},
		{http.MethodPost, "/exclude/bulk-preview"},
		{http.MethodPost, "/exclude/bulk"},
		{http.MethodPost, "/delete/bulk"},
		{http.MethodPost, "/delete/restore-bulk"},
		{http.MethodPost, "/delete/move-excluded-bulk"},
		{http.MethodPost, "/delete/permanent-bulk"},
	}
	for _, rt := range routes {
		resp := doJSONReq(t, app, rt[0], rt[1], `{}`)
		require.Equal(t, http.StatusInternalServerError, resp.StatusCode, rt[1])
	}
}

func TestReviewQueue_CountsFetchResolveAndBatchCategorize(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	// Point processed storage at a temp dir so auto-purge safe removal can be verified.
	origHost := constants.GetCurrentHostPath()
	_, _ = constants.SetDropboxLocation(t.TempDir())
	t.Cleanup(func() { _, _ = constants.SetDropboxLocation(origHost) })
	require.NoError(t, os.MkdirAll(constants.GetProcessedPath(), 0o755))

	safeReceiptPath := filepath.Join(constants.GetProcessedPath(), "old-receipt.pdf")
	require.NoError(t, os.WriteFile(safeReceiptPath, []byte("pdf"), 0o644))

	checking := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	revAcc := models.ChartAccount{Code: "4000", Name: "Sales", Type: "REVENUE", Active: true}
	expCat := models.ChartAccount{Code: "5010", Name: "Supplies", Type: "EXPENSE", Active: true}
	inactiveCat := models.ChartAccount{Code: "5099", Name: "Archived", Type: "EXPENSE", Active: false}
	for _, acc := range []*models.ChartAccount{&checking, &revAcc, &expCat, &inactiveCat} {
		require.NoError(t, db.DB.Create(acc).Error)
	}
	require.NoError(t, db.DB.Model(&inactiveCat).Update("active", false).Error)

	app := buildReviewExclusionApp()

	// Seed open-period pending, ignored, warnings-ignored, deleted, and >30d old deleted items
	dMay := time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC)
	dMayLater := time.Date(2026, 5, 18, 0, 0, 0, 0, time.UTC)
	dJune := time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC)
	oldDeletedAt := time.Now().Add(-35 * 24 * time.Hour)
	recentDeletedAt := time.Now().Add(-2 * 24 * time.Hour)

	txPendingOld := models.BankTransaction{FITID: "RQ-1", Date: dMay, Description: "PendingOld", Amount: models.NewMoney(-45.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "PENDING"}
	txPendingAuto := models.BankTransaction{FITID: "RQ-2", Date: dMayLater, Description: "PendingLater", Amount: models.NewMoney(-55.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "PENDING"}
	txIgnored := models.BankTransaction{FITID: "RQ-3", Date: dMay, Description: "IgnoredClosed", Amount: models.NewMoney(-20.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "IGNORED"}
	txWarn := models.BankTransaction{FITID: "RQ-4", Date: dJune, Description: "ApprovedTx", Amount: models.NewMoney(-30.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	txPurge := models.BankTransaction{FITID: "RQ-5", Date: dJune, Description: "OldTrashTx", Amount: models.NewMoney(-10.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "DELETED", DeletedAt: &oldDeletedAt}
	txKeepTrash := models.BankTransaction{FITID: "RQ-6", Date: dJune, Description: "RecentTrashTx", Amount: models.NewMoney(-12.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "DELETED", DeletedAt: &recentDeletedAt}
	for _, r := range []*models.BankTransaction{&txPendingOld, &txPendingAuto, &txIgnored, &txWarn, &txPurge, &txKeepTrash} {
		require.NoError(t, db.DB.Create(r).Error)
	}

	expPending := models.Expense{Timestamp: dMay, Vendor: "OldVendor", Amount: models.NewMoney(45.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "PENDING"}
	expWarn := models.Expense{Timestamp: dJune, Vendor: "WarnVendor", Amount: models.NewMoney(30.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	expPurge := models.Expense{Timestamp: dJune, Vendor: "OldTrashExp", Amount: models.NewMoney(19.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "DELETED", DeletedAt: &oldDeletedAt}
	for _, r := range []*models.Expense{&expPending, &expWarn, &expPurge} {
		require.NoError(t, db.DB.Create(r).Error)
	}
	require.NoError(t, db.DB.Create(&models.Receipt{ExpenseID: &expPurge.ID, DocumentURI: safeReceiptPath, FileExt: ".pdf"}).Error)
	require.NoError(t, db.DB.Create(&models.Receipt{ExpenseID: &expPurge.ID, DocumentURI: "/etc/passwd", FileExt: ".pdf"}).Error)
	// Confirm link between txWarn <-> expWarn and txPendingOld <-> expPending
	require.NoError(t, db.DB.Create(&models.ExpenseBankTransaction{ExpenseID: expPending.ID, BankTransactionID: txPendingOld.ID, Status: "confirmed"}).Error)
	require.NoError(t, db.DB.Create(&models.ExpenseBankTransaction{ExpenseID: expWarn.ID, BankTransactionID: txWarn.ID, Status: "confirmed"}).Error)

	// Counts & Queue without closed date first
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodGet, "/review/counts", "").StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodGet, "/review?status=PENDING", "").StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodGet, "/review?status=BOGUS", "").StatusCode)

	// DELETED auto-purge removes txPurge + expPurge + safeReceiptPath while preserving txKeepTrash and /etc/passwd!
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodGet, "/review?status=DELETED", "").StatusCode)
	_, err := os.Stat(safeReceiptPath)
	require.True(t, os.IsNotExist(err))

	// Now close books through 2026-05-31
	require.NoError(t, db.DB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-05-31"}).Error)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodGet, "/review/counts", "").StatusCode)
	for _, st := range []string{"PENDING", "IGNORED", "WARNINGS_IGNORED"} {
		require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodGet, "/review?status="+st, "").StatusCode)
	}

	// ResolveQueueItems error cases
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{bad`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"action":"allow"}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[1],"action":"bogus"}`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[99999],"action":"allow"}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txWarn.ID)+`],"action":"allow"}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txWarn.ID)+`],"action":"pending"}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txPendingOld.ID)+`],"action":"ignore_warnings"}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txWarn.ID)+`],"action":"restore_warnings"}`).StatusCode)

	// Allow txPendingOld -> expands linked expPending, rolls back BooksClosedDate to 2026-05-09, auto-approves txPendingAuto!
	resp := doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txPendingOld.ID)+`],"action":"allow"}`)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var allowOut struct {
		RolledBack      bool   `json:"rolledBack"`
		BooksClosedDate string `json:"booksClosedDate"`
		AutoApproved    int    `json:"autoApproved"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&allowOut))
	require.True(t, allowOut.RolledBack)
	require.Equal(t, "2026-05-09", allowOut.BooksClosedDate)
	require.GreaterOrEqual(t, allowOut.AutoApproved, 1)

	// Send closed IGNORED tx back to pending -> wait txIgnored is on 2026-05-10 which is now open after rollback! Expect 409; re-lock 2026-05-31 then send pending -> 200
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txIgnored.ID)+`],"action":"pending"}`).StatusCode)
	require.NoError(t, db.DB.Model(&models.AppSetting{}).Where("key = ?", "BooksClosedDate").Update("value", "2026-05-31").Error)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txIgnored.ID)+`],"action":"pending"}`).StatusCode)

	// ignore_warnings -> restore_warnings -> delete (closed blocked 403, open 200)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txWarn.ID)+`],"expenseIds":[`+itoa(expWarn.ID)+`],"action":"ignore_warnings"}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txWarn.ID)+`],"expenseIds":[`+itoa(expWarn.ID)+`],"action":"restore_warnings"}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txPendingOld.ID)+`],"action":"delete"}`).StatusCode)

	// BatchCategorizeItems validation & happy path syncing 1:1 linked tx <-> expense
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{bad`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{"categoryId":1}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{"transactionIds":[1],"categoryId":0}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{"transactionIds":[1],"categoryId":99999}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{"transactionIds":[1],"categoryId":`+itoa(inactiveCat.ID)+`}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{"expenseIds":[`+itoa(expWarn.ID)+`],"categoryId":`+itoa(revAcc.ID)+`}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{"transactionIds":[`+itoa(txPendingOld.ID)+`],"categoryId":`+itoa(expCat.ID)+`}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{"expenseIds":[`+itoa(expPending.ID)+`],"categoryId":`+itoa(expCat.ID)+`}`).StatusCode)

	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/review/batch-categorize", `{"transactionIds":[`+itoa(txWarn.ID)+`],"expenseIds":[`+itoa(expWarn.ID)+`],"categoryId":`+itoa(expCat.ID)+`}`).StatusCode)

	// Delete open-period item via ResolveQueueItems
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"transactionIds":[`+itoa(txWarn.ID)+`],"expenseIds":[`+itoa(expWarn.ID)+`],"action":"delete"}`).StatusCode)
}

func TestExclusionAndBulkLifecycle(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	origHost := constants.GetCurrentHostPath()
	_, _ = constants.SetDropboxLocation(t.TempDir())
	t.Cleanup(func() { _, _ = constants.SetDropboxLocation(origHost) })
	require.NoError(t, os.MkdirAll(constants.GetProcessedPath(), 0o755))

	safeFile := filepath.Join(constants.GetProcessedPath(), "perm-del.pdf")
	require.NoError(t, os.WriteFile(safeFile, []byte("pdf"), 0o644))

	checking := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	require.NoError(t, db.DB.Create(&checking).Error)
	require.NoError(t, db.DB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-03-31"}).Error)

	dLocked := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	dOpen := time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC)

	txLocked := models.BankTransaction{FITID: "EX-L", Date: dLocked, Description: "LockedTx", Amount: models.NewMoney(-10.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	txOpen1 := models.BankTransaction{FITID: "EX-O1", Date: dOpen, Description: "OpenTx1", Amount: models.NewMoney(-25.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	txOpen2 := models.BankTransaction{FITID: "EX-O2", Date: dOpen, Description: "OpenTx2", Amount: models.NewMoney(-35.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	for _, r := range []*models.BankTransaction{&txLocked, &txOpen1, &txOpen2} {
		require.NoError(t, db.DB.Create(r).Error)
	}

	expOpen1 := models.Expense{Timestamp: dOpen, Vendor: "OpenExp1", Amount: models.NewMoney(25.00), Tender: "card", AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	expLinkedLocked := models.Expense{Timestamp: dOpen, Vendor: "LinkedLocked", Amount: models.NewMoney(10.00), Tender: "card", AllocationStatus: "BALANCED", ReviewStatus: "APPROVED"}
	for _, r := range []*models.Expense{&expOpen1, &expLinkedLocked} {
		require.NoError(t, db.DB.Create(r).Error)
	}
	require.NoError(t, db.DB.Create(&models.Receipt{ExpenseID: &expOpen1.ID, DocumentURI: safeFile, FileExt: ".pdf"}).Error)
	require.NoError(t, db.DB.Create(&models.ExpenseBankTransaction{ExpenseID: expOpen1.ID, BankTransactionID: txOpen1.ID, Status: "confirmed"}).Error)
	require.NoError(t, db.DB.Create(&models.ExpenseBankTransaction{ExpenseID: expLinkedLocked.ID, BankTransactionID: txLocked.ID, Status: "confirmed"}).Error)

	app := buildReviewExclusionApp()

	// Preview checks (bad input, direct locked, linked locked, unlocked)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/preview", `{"type":"bad","id":1}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/preview", `{"type":"transaction","id":0}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/exclude/preview", `{"type":"transaction","id":`+itoa(txLocked.ID)+`}`).StatusCode)
	respLinked := doJSONReq(t, app, http.MethodPost, "/exclude/preview", `{"type":"expense","id":`+itoa(expLinkedLocked.ID)+`}`)
	require.Equal(t, http.StatusOK, respLinked.StatusCode)
	var prevOut struct {
		Blocked bool `json:"blocked"`
	}
	require.NoError(t, json.NewDecoder(respLinked.Body).Decode(&prevOut))
	require.True(t, prevOut.Blocked)

	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/bulk-preview", `{bad`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/bulk-preview", `{"items":[]}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/bulk-preview", `{"items":[{"type":"bad","id":1}]}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/bulk-preview", `{"items":[{"type":"expense","id":0}]}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/exclude/bulk-preview", `{"items":[{"type":"expense","id":`+itoa(expLinkedLocked.ID)+`}]}`).StatusCode)

	// ExcludeItem validation & lifecycle
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude", `{"type":"transaction","id":`+itoa(txOpen2.ID)+`,"reason":"BAD"}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude", `{"type":"transaction","id":`+itoa(txOpen2.ID)+`,"reason":"OTHER"}`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/exclude", `{"type":"transaction","id":99999,"reason":"DUPLICATE"}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/exclude", `{"type":"transaction","id":`+itoa(txLocked.ID)+`,"reason":"DUPLICATE"}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/exclude", `{"type":"transaction","id":`+itoa(txOpen1.ID)+`,"reason":"DUPLICATE","unlinkOnly":true}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/exclude", `{"type":"transaction","id":`+itoa(txOpen1.ID)+`,"reason":"DUPLICATE"}`).StatusCode)

	// Unit check resolveError.Error() + locked restore branches
	require.Equal(t, "boom", (&resolveError{status: 400, msg: "boom"}).Error())

	txLockedIgnored := models.BankTransaction{FITID: "EX-LI", Date: dLocked, Description: "LockedIgn", Amount: models.NewMoney(-15.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "IGNORED"}
	txLockedDeleted := models.BankTransaction{FITID: "EX-LD", Date: dLocked, Description: "LockedDel", Amount: models.NewMoney(-16.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "DELETED"}
	expLockedDeleted := models.Expense{Timestamp: dLocked, Vendor: "LockedDelExp", Amount: models.NewMoney(16.00), Tender: "card", AllocationStatus: "UNLINKED", ReviewStatus: "DELETED"}
	require.NoError(t, db.DB.Create(&txLockedIgnored).Error)
	require.NoError(t, db.DB.Create(&txLockedDeleted).Error)
	require.NoError(t, db.DB.Create(&expLockedDeleted).Error)

	// RestoreItem (bad json, not found, conflict, locked, success)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/restore", `{bad`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/exclude/restore", `{"type":"transaction","id":99999}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/exclude/restore", `{"type":"transaction","id":`+itoa(txOpen2.ID)+`}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/exclude/restore", `{"type":"transaction","id":`+itoa(txLockedIgnored.ID)+`}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/exclude/restore", `{"type":"transaction","id":`+itoa(txOpen1.ID)+`}`).StatusCode)

	txUnrelated := models.BankTransaction{FITID: "EX-UNR", Date: dOpen, Description: "UnrelatedTx", Amount: models.NewMoney(-77.00), TransactionType: "DEBIT", ChartAccountID: &checking.ID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	require.NoError(t, db.DB.Create(&txUnrelated).Error)

	// ExcludeBulk + RestoreBulk
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/bulk", `{bad`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/bulk", `{"items":[],"reason":"PERSONAL"}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`}],"reason":"OTHER"}`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/exclude/bulk", `{"items":[{"type":"transaction","id":99999}],"reason":"PERSONAL"}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/exclude/bulk", `{"items":[{"type":"transaction","id":`+itoa(txLocked.ID)+`}],"reason":"PERSONAL"}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/exclude/bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`},{"type":"expense","id":`+itoa(expOpen1.ID)+`}],"reason":"PERSONAL"}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/exclude/bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`}],"reason":"ERROR"}`).StatusCode)

	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/exclude/restore-bulk", `{bad`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/exclude/restore-bulk", `{"items":[{"type":"transaction","id":99999}]}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/exclude/restore-bulk", `{"items":[{"type":"transaction","id":`+itoa(txLockedIgnored.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/exclude/restore-bulk", `{"items":[{"type":"transaction","id":`+itoa(txUnrelated.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/exclude/restore-bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`},{"type":"expense","id":`+itoa(expOpen1.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/exclude/bulk", `{"items":[{"type":"transaction","id":`+itoa(txUnrelated.ID)+`}],"reason":"DUPLICATE","unlinkOnly":true}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/exclude/restore-bulk", `{"items":[{"type":"transaction","id":`+itoa(txUnrelated.ID)+`}]}`).StatusCode)

	// DeleteBulk -> RestoreDeletedBulk -> DeleteBulk -> MoveDeletedToExcludedBulk -> DeleteBulk -> DeletePermanentBulk
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/delete/bulk", `{bad`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/delete/bulk", `{"items":[]}`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/delete/bulk", `{"items":[{"type":"transaction","id":99999}]}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/delete/bulk", `{"items":[{"type":"transaction","id":`+itoa(txLocked.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/delete/bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`},{"type":"expense","id":`+itoa(expOpen1.ID)+`}]}`).StatusCode)

	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/delete/restore-bulk", `{bad`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/delete/restore-bulk", `{"items":[{"type":"transaction","id":99999}]}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/delete/restore-bulk", `{"items":[{"type":"transaction","id":`+itoa(txLockedDeleted.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/delete/restore-bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen1.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/delete/restore-bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`},{"type":"expense","id":`+itoa(expOpen1.ID)+`}]}`).StatusCode)

	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/delete/bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`},{"type":"expense","id":`+itoa(expOpen1.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/delete/move-excluded-bulk", `{bad`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/delete/move-excluded-bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`}],"reason":"BOGUS"}`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/delete/move-excluded-bulk", `{"items":[{"type":"transaction","id":99999}]}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/delete/move-excluded-bulk", `{"items":[{"type":"expense","id":`+itoa(expLockedDeleted.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusConflict, doJSONReq(t, app, http.MethodPost, "/delete/move-excluded-bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen1.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/delete/move-excluded-bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen2.ID)+`},{"type":"expense","id":`+itoa(expOpen1.ID)+`}]}`).StatusCode)

	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/delete/permanent-bulk", `{bad`).StatusCode)
	require.Equal(t, http.StatusBadRequest, doJSONReq(t, app, http.MethodPost, "/delete/permanent-bulk", `{"items":[]}`).StatusCode)
	require.Equal(t, http.StatusForbidden, doJSONReq(t, app, http.MethodPost, "/delete/permanent-bulk", `{"items":[{"type":"transaction","id":`+itoa(txLocked.ID)+`}]}`).StatusCode)
	require.Equal(t, http.StatusNotFound, doJSONReq(t, app, http.MethodPost, "/delete/permanent-bulk", `{"items":[{"type":"expense","id":99999}]}`).StatusCode)
	require.Equal(t, http.StatusOK, doJSONReq(t, app, http.MethodPost, "/delete/permanent-bulk", `{"items":[{"type":"transaction","id":`+itoa(txOpen1.ID)+`},{"type":"expense","id":`+itoa(expOpen1.ID)+`}]}`).StatusCode)

	_, err := os.Stat(safeFile)
	require.True(t, os.IsNotExist(err))
}

func TestReviewQueue_OpenPeriodPendingMissingData(t *testing.T) {
	setupTestDB(t)
	defer teardownTestDB()

	require.NoError(t, db.DB.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-01-31"}).Error)
	expAcct := models.ChartAccount{Code: "5010", Name: "Supplies", Type: "EXPENSE", Active: true}
	require.NoError(t, db.DB.Create(&expAcct).Error)

	expOpenPending1 := models.Expense{
		Timestamp:        time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC),
		Vendor:           "[MISSING VENDOR]",
		Description:      "[MISSING AMOUNT] Low-res scan",
		Amount:           models.NewMoney(0),
		ChartAccountID:   &expAcct.ID,
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "PENDING",
	}
	expOpenPending2 := models.Expense{
		Timestamp:        time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC),
		Vendor:           "[MISSING VENDOR]",
		Description:      "[MISSING AMOUNT] Needs edit",
		Amount:           models.NewMoney(0),
		ChartAccountID:   &expAcct.ID,
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "PENDING",
	}
	require.NoError(t, db.DB.Create(&expOpenPending1).Error)
	require.NoError(t, db.DB.Create(&expOpenPending2).Error)

	app := buildReviewExclusionApp()
	app.Patch("/expenses/:id", UpdateExpense)

	// 1. Counts & Queue both surface open-period PENDING missing-data receipts even when BooksClosedDate is set
	cntResp := doJSONReq(t, app, http.MethodGet, "/review/counts", "")
	require.Equal(t, http.StatusOK, cntResp.StatusCode)
	var counts map[string]int64
	require.NoError(t, json.NewDecoder(cntResp.Body).Decode(&counts))
	require.Equal(t, int64(2), counts["pending"])

	qResp := doJSONReq(t, app, http.MethodGet, "/review?status=PENDING", "")
	require.Equal(t, http.StatusOK, qResp.StatusCode)
	var qBody struct {
		Expenses []models.Expense `json:"expenses"`
	}
	require.NoError(t, json.NewDecoder(qResp.Body).Decode(&qBody))
	require.Len(t, qBody.Expenses, 2)

	// 2. ignore_warnings succeeds on open-period PENDING item
	resResp := doJSONReq(t, app, http.MethodPost, "/review/resolve", `{"action":"ignore_warnings","expenseIds":[`+itoa(expOpenPending1.ID)+`]}`)
	require.Equal(t, http.StatusOK, resResp.StatusCode)
	var exp1After models.Expense
	require.NoError(t, db.DB.First(&exp1After, expOpenPending1.ID).Error)
	require.Equal(t, "WARNINGS_IGNORED", exp1After.ReviewStatus)

	// 3. Editing open-period PENDING item to positive amount auto-approves it
	editResp := doJSONReq(t, app, http.MethodPatch, "/expenses/"+itoa(expOpenPending2.ID), `{"amount":42.50,"vendor":"Target","description":"Paper towels"}`)
	require.Equal(t, http.StatusOK, editResp.StatusCode)
	var exp2After models.Expense
	require.NoError(t, db.DB.First(&exp2After, expOpenPending2.ID).Error)
	require.Equal(t, int64(4250), exp2After.Amount.Cents)
	require.Equal(t, "APPROVED", exp2After.ReviewStatus)
}
