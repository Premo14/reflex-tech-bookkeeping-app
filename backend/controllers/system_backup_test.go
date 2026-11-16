package controllers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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

func TestExportSystemBackupJSON(t *testing.T) {
	app := fiber.New()
	app.Get("/api/system/backup", ExportSystemBackupJSON)

	req := httptest.NewRequest("GET", "/api/system/backup", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to execute test request: %v", err)
	}

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("Expected status 200 OK, got %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType != "application/json; charset=utf-8" {
		t.Errorf("Expected Content-Type application/json; charset=utf-8, got %s", contentType)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response JSON: %v", err)
	}

	if result["company"] != "Reflex Technologies LLC (Utica, NY)" {
		t.Errorf("Expected company 'Reflex Technologies LLC (Utica, NY)', got %v", result["company"])
	}

	if result["version"] == nil {
		t.Errorf("Expected backup version to be set")
	}

	if result["data"] == nil {
		t.Errorf("Expected backup data map to be present")
	}

	if result["counts"] == nil {
		t.Errorf("Expected backup counts map to be present")
	}
}

func TestRestoreSystemBackupJSON_InvalidFormat(t *testing.T) {
	app := fiber.New()
	app.Post("/api/system/backup/restore", RestoreSystemBackupJSON)

	// Test with invalid format
	invalidPayload := map[string]interface{}{
		"format":  "invalid_format",
		"version": "1.0",
		"data":    map[string]interface{}{},
	}
	body, _ := json.Marshal(invalidPayload)

	req := httptest.NewRequest("POST", "/api/system/backup/restore", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to execute test request: %v", err)
	}

	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("Expected status 400 Bad Request for invalid format, got %d", resp.StatusCode)
	}
}

func TestGetSystemHealth(t *testing.T) {
	app := fiber.New()
	app.Get("/api/health", GetSystemHealth)

	req := httptest.NewRequest("GET", "/api/health", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to execute test request: %v", err)
	}

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("Expected status 200 OK, got %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode health response: %v", err)
	}

	if result["status"] == nil {
		t.Errorf("Expected health status field")
	}
	if result["company"] == nil {
		t.Errorf("Expected company name in health response")
	}
	if result["database"] == nil {
		t.Errorf("Expected database status in health response")
	}
	if result["storage"] == nil {
		t.Errorf("Expected storage status in health response")
	}
}

func TestExportAndRestoreSystemBackupJSON_RoundTripRemapping(t *testing.T) {
	origHost := constants.GetCurrentHostPath()
	t.Cleanup(func() {
		if origHost != "" {
			_, _ = constants.SetDropboxLocation(origHost)
		}
		teardownTestDB()
	})

	// 1. Source DB with accounts at IDs 1, 2
	setupTestDB(t)
	srcDropbox := t.TempDir()
	_, _ = constants.SetDropboxLocation(srcDropbox)

	srcBank := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	srcExpCat := models.ChartAccount{Code: "5050", Name: "Office Supplies", Type: "EXPENSE", Active: true}
	require.NoError(t, db.DB.Create(&srcBank).Error)
	require.NoError(t, db.DB.Create(&srcExpCat).Error)

	txDate := time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC)
	srcStmt := models.BankStatement{
		AccountID:      "ACCT-01",
		FileExt:        ".ofx",
		StartDate:      txDate,
		EndDate:        txDate,
		DocumentURI:    "/old-host/document-data/processed/2026/06/stmt.ofx",
		ChartAccountID: &srcBank.ID,
	}
	require.NoError(t, db.DB.Create(&srcStmt).Error)

	srcTx := models.BankTransaction{
		ChartAccountID:    &srcBank.ID,
		CategoryAccountID: &srcExpCat.ID,
		Date:              txDate,
		Description:       "STAPLES #100",
		Amount:            models.NewMoney(-45.00),
		FITID:             "FIT-BACKUP-1",
		AllocationStatus:  "BALANCED",
		ReviewStatus:      "APPROVED",
	}
	require.NoError(t, db.DB.Create(&srcTx).Error)

	srcExp := models.Expense{
		ChartAccountID:   &srcExpCat.ID,
		Timestamp:        txDate,
		Vendor:           "Staples",
		Description:      "Paper",
		Amount:           models.NewMoney(45.00),
		Tender:           "card",
		AllocationStatus: "BALANCED",
		ReviewStatus:     "APPROVED",
	}
	require.NoError(t, db.DB.Create(&srcExp).Error)

	srcRec := models.Receipt{
		ExpenseID:   &srcExp.ID,
		DocumentURI: "/legacy-mount/processed/2026/06/receipt-45.png",
		FileHash:    "rechash01",
	}
	require.NoError(t, db.DB.Create(&srcRec).Error)

	require.NoError(t, db.DB.Create(&models.ExpenseBankTransaction{
		ExpenseID:         srcExp.ID,
		BankTransactionID: srcTx.ID,
		Status:            "confirmed",
	}).Error)

	require.NoError(t, db.DB.Create(&models.PeriodAuditLog{
		Action:       "LOCKED",
		PreviousDate: "",
		NewDate:      "2026-01-31",
		Reason:       "Manual Update",
	}).Error)

	app := newTestApp()
	app.Get("/api/system/backup", ExportSystemBackupJSON)
	app.Post("/api/system/backup/restore", RestoreSystemBackupJSON)

	exportResp, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/system/backup", nil))
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, exportResp.StatusCode)
	backupBytes, err := io.ReadAll(exportResp.Body)
	require.NoError(t, err)
	require.True(t, strings.Contains(string(backupBytes), `"periodAuditLogs"`))

	// 2. Fresh target DB where target 1010/5050 receive DIFFERENT primary keys (10, 20)
	teardownTestDB()
	setupTestDB(t)
	dstDropbox := t.TempDir()
	_, _ = constants.SetDropboxLocation(dstDropbox)

	dstBank := models.ChartAccount{ID: 10, Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	dstExpCat := models.ChartAccount{ID: 20, Code: "5050", Name: "Office Supplies", Type: "EXPENSE", Active: true}
	require.NoError(t, db.DB.Create(&dstBank).Error)
	require.NoError(t, db.DB.Create(&dstExpCat).Error)

	restoreReq := httptest.NewRequest(http.MethodPost, "/api/system/backup/restore", bytes.NewReader(backupBytes))
	restoreReq.Header.Set("Content-Type", "application/json")
	restoreResp, err := app.Test(restoreReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, restoreResp.StatusCode)

	var auditCount int64
	require.NoError(t, db.DB.Model(&models.PeriodAuditLog{}).Where("action = ? AND new_date = ?", "LOCKED", "2026-01-31").Count(&auditCount).Error)
	require.Equal(t, int64(1), auditCount)

	var restoredTx models.BankTransaction
	require.NoError(t, db.DB.First(&restoredTx, "fit_id = ?", "FIT-BACKUP-1").Error)
	require.NotNil(t, restoredTx.ChartAccountID)
	require.Equal(t, uint(10), *restoredTx.ChartAccountID)
	require.NotNil(t, restoredTx.CategoryAccountID)
	require.Equal(t, uint(20), *restoredTx.CategoryAccountID)

	var restoredExp models.Expense
	require.NoError(t, db.DB.First(&restoredExp).Error)
	require.NotNil(t, restoredExp.ChartAccountID)
	require.Equal(t, uint(20), *restoredExp.ChartAccountID)

	var restoredRec models.Receipt
	require.NoError(t, db.DB.First(&restoredRec, "file_hash = ?", "rechash01").Error)
	expectedPrefix := filepath.Clean(constants.GetProcessedPath())
	require.True(t, strings.HasPrefix(restoredRec.DocumentURI, expectedPrefix), "expected %q to be rebased under %q", restoredRec.DocumentURI, expectedPrefix)

	var linkCount int64
	require.NoError(t, db.DB.Model(&models.ExpenseBankTransaction{}).
		Where("expense_id = ? AND bank_transaction_id = ? AND status = 'confirmed'", restoredExp.ID, restoredTx.ID).
		Count(&linkCount).Error)
	require.Equal(t, int64(1), linkCount)
}
