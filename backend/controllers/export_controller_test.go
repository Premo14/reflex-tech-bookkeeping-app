package controllers

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
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
)

func setupExportRoutes(app *fiber.App) {
	api := app.Group("/api")
	api.Get("/transactions/export", ExportTransactionsCSV)
	api.Get("/expenses/export", ExportExpensesCSV)
	api.Get("/reports/tax-pack", ExportTaxPackZip)
	api.Get("/reports/trial-balance/export", ExportTrialBalanceCSV)
	api.Get("/system/backup/export", ExportSystemBackupJSON)
	api.Post("/system/backup/restore", RestoreSystemBackupJSON)
}

func TestExportSanitizersAndNilDBGuards(t *testing.T) {
	csvCases := map[string]string{
		"":              "",
		"Normal Text":   "Normal Text",
		"=CMD|'/C calc'": "'=CMD|'/C calc'",
		"  =SUM(A1:A2)": "'  =SUM(A1:A2)",
		"+1+1":          "'+1+1",
		"-2+3":          "'-2+3",
		"@SUM(1,2)":     "'@SUM(1,2)",
		"\t=1+1":        "'\t=1+1",
		"\r=1+1":        "'\r=1+1",
	}
	for in, want := range csvCases {
		if got := sanitizeCSVCell(in); got != want {
			t.Errorf("sanitizeCSVCell(%q) = %q, want %q", in, got, want)
		}
	}

	if got := sanitizePathSegment("  "); got != "uncategorized" {
		t.Fatalf("expected uncategorized for blank segment, got %q", got)
	}
	if got := sanitizePathSegment("../../etc/passwd"); strings.Contains(got, "/") || got == ".." {
		t.Fatalf("expected path traversal characters neutralized, got %q", got)
	}

	origDB := db.DB
	db.DB = nil
	defer func() { db.DB = origDB }()

	app := fiber.New()
	setupExportRoutes(app)

	for _, ep := range [][2]string{
		{"GET", "/api/transactions/export"},
		{"GET", "/api/expenses/export"},
		{"GET", "/api/reports/tax-pack"},
	} {
		code, _ := doJSONMap(t, app, ep[0], ep[1], nil)
		if code != http.StatusInternalServerError {
			t.Errorf("%s %s with nil DB: expected 500, got %d", ep[0], ep[1], code)
		}
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/system/backup/restore", map[string]interface{}{"format": "reflex_tech_bookkeeping_full_backup"}); code != http.StatusInternalServerError {
		t.Errorf("POST /api/system/backup/restore valid format with nil DB: expected 500, got %d", code)
	}

	// Trial balance & System backup export degrade gracefully without panicking on nil DB
	if code, _ := doJSONMap(t, app, "GET", "/api/reports/trial-balance/export", nil); code != 200 {
		t.Fatalf("expected 200 trial balance export on nil DB, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "GET", "/api/system/backup/export", nil); code != 200 {
		t.Fatalf("expected 200 backup export on nil DB, got %d", code)
	}
}

func TestCSVExportsTransactionsExpensesAndTrialBalance(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB()

	app := fiber.New()
	setupExportRoutes(app)

	testDB.Create(&models.AppSetting{Key: "CompanyName", Value: "=HYPERLINK(\"http://evil\",\"Co\")"})
	bank := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	rev := models.ChartAccount{Code: "4010", Name: "Revenue", Type: "REVENUE", Active: true}
	expCat := models.ChartAccount{Code: "5050", Name: "Office Supplies", Type: "EXPENSE", Active: true}
	testDB.Create(&bank)
	testDB.Create(&rev)
	testDB.Create(&expCat)

	d := time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC)
	txIn := models.BankTransaction{
		Date: d, Description: "+Acme Client Payment", Amount: models.NewMoney(500.00),
		TransactionType: "DEP", FITID: "EXP-TX-1", ChartAccountID: &bank.ID, CategoryAccountID: &rev.ID,
		ReviewStatus: "APPROVED", Notes: "=1+1",
	}
	txOut := models.BankTransaction{
		Date: d, Description: "-Evil Formula Vendor", Amount: models.NewMoney(-42.50),
		TransactionType: "DEBIT", FITID: "EXP-TX-2", ChartAccountID: &bank.ID, CategoryAccountID: &expCat.ID,
		ReviewStatus: "APPROVED", Notes: "@danger",
	}
	testDB.Create(&txIn)
	testDB.Create(&txOut)

	expCash := models.Expense{
		Timestamp: d, Vendor: "=BadVendor", Description: "Paper", Amount: models.NewMoney(42.50),
		TaxAmount: models.NewMoney(3.40), Tender: "cash", ChartAccountID: &expCat.ID,
		ReviewStatus: "APPROVED", Notes: "+cash",
	}
	testDB.Create(&expCash)

	// Invalid accountId -> 400 on both CSV routes
	if code, _ := doJSONMap(t, app, "GET", "/api/transactions/export?accountId=notanint", nil); code != 400 {
		t.Fatalf("expected 400 invalid accountId on tx CSV, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "GET", "/api/expenses/export?accountId=notanint", nil); code != 400 {
		t.Fatalf("expected 400 invalid accountId on exp CSV, got %d", code)
	}

	// Transactions CSV with numeric amount search & account filter
	req := httptest.NewRequest("GET", "/api/transactions/export?accountId="+itoa(bank.ID)+"&search=$42.50", nil)
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("expected 200 tx CSV numeric search, got err=%v code=%v", err, resp)
	}
	bodyBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.HasPrefix(bodyBytes, []byte("\xEF\xBB\xBF")) {
		t.Fatal("expected UTF-8 BOM prefix on CSV")
	}
	bodyStr := string(bytes.TrimPrefix(bodyBytes, []byte("\xEF\xBB\xBF")))
	records, _ := csv.NewReader(strings.NewReader(bodyStr)).ReadAll()
	if len(records) != 2 || records[1][1] != "'-Evil Formula Vendor" || records[1][10] != "'@danger" {
		t.Fatalf("unexpected tx CSV records (formula neutralization failed): %v", records)
	}

	// Transactions CSV with text search (case-insensitive fit_id)
	reqTxt := httptest.NewRequest("GET", "/api/transactions/export?search=exp-tx-1", nil)
	respTxt, _ := app.Test(reqTxt)
	txtBytes, _ := io.ReadAll(respTxt.Body)
	respTxt.Body.Close()
	if !strings.Contains(string(txtBytes), "'+Acme Client Payment") {
		t.Fatalf("expected tx CSV text search to find +Acme Client Payment sanitized, got %s", string(txtBytes))
	}

	// Expenses CSV with account filter & search + formula escaping
	reqExp := httptest.NewRequest("GET", "/api/expenses/export?accountId="+itoa(expCat.ID)+"&search=badvendor", nil)
	respExp, _ := app.Test(reqExp)
	expBytes, _ := io.ReadAll(respExp.Body)
	respExp.Body.Close()
	if respExp.StatusCode != 200 || !strings.Contains(string(expBytes), "'=BadVendor") || !strings.Contains(string(expBytes), "'+cash") {
		t.Fatalf("unexpected expenses CSV output: code=%d body=%s", respExp.StatusCode, string(expBytes))
	}

	// Trial Balance CSV with CompanyName formula escaping & balanced verification
	reqTB := httptest.NewRequest("GET", "/api/reports/trial-balance/export?startDate=2026-01-01&endDate=2026-12-31", nil)
	respTB, _ := app.Test(reqTB)
	tbBytes, _ := io.ReadAll(respTB.Body)
	respTB.Body.Close()
	tbStr := string(tbBytes)
	if respTB.StatusCode != 200 || !strings.Contains(tbStr, "'=HYPERLINK") || !strings.Contains(tbStr, "BALANCED: Debits = Credits") {
		t.Fatalf("unexpected Trial Balance CSV: code=%d body=%s", respTB.StatusCode, tbStr)
	}
}

func TestExportTaxPackZipWithReceiptsManifestAndTraversalGuard(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB()

	origHost := constants.GetCurrentHostPath()
	_, _ = constants.SetDropboxLocation(t.TempDir())
	t.Cleanup(func() { _, _ = constants.SetDropboxLocation(origHost) })
	processedDir := constants.GetProcessedPath()
	if err := os.MkdirAll(processedDir, 0o755); err != nil {
		t.Fatalf("mkdir processed: %v", err)
	}

	app := fiber.New()
	setupExportRoutes(app)

	checking := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	rev := models.ChartAccount{Code: "4010", Name: "Consulting", Type: "REVENUE", Active: true}
	expMeals := models.ChartAccount{Code: "5090", Name: "Meals", Type: "EXPENSE", ScheduleCLine: "=Line 24b - Meals 50%", Active: true}
	testDB.Create(&checking)
	testDB.Create(&rev)
	testDB.Create(&expMeals)

	d := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	testDB.Create(&models.BankTransaction{
		Date: d, Description: "BIG CLIENT RETAINER", Amount: models.NewMoney(5000.00),
		FITID: "TP-1", ChartAccountID: &checking.ID, CategoryAccountID: &rev.ID, ReviewStatus: "APPROVED",
	})
	testDB.Create(&models.BankTransaction{
		Date: d, Description: "UNCAT DEP", Amount: models.NewMoney(50.00),
		FITID: "TP-2", ChartAccountID: &checking.ID, ReviewStatus: "APPROVED",
	})
	testDB.Create(&models.BankTransaction{
		Date: d, Description: "UNCAT EXP", Amount: models.NewMoney(-25.00),
		FITID: "TP-3", ChartAccountID: &checking.ID, ReviewStatus: "APPROVED",
	})

	expMulti := models.Expense{
		Timestamp: d, Vendor: "Bistro / Utica", Description: "Lunch", Amount: models.NewMoney(120.00),
		Tender: "cash", ChartAccountID: &expMeals.ID, ReviewStatus: "APPROVED",
	}
	testDB.Create(&expMulti)

	safeContent := []byte("fake-pdf-receipt-bytes-12345")
	safePath := filepath.Join(processedDir, "lunch_part1.pdf")
	if err := os.WriteFile(safePath, safeContent, 0o644); err != nil {
		t.Fatalf("write safe receipt: %v", err)
	}
	missingSafePath := filepath.Join(processedDir, "missing.png")

	testDB.Create(&models.Receipt{ExpenseID: &expMulti.ID, DocumentURI: safePath, FileExt: ".pdf"})
	testDB.Create(&models.Receipt{ExpenseID: &expMulti.ID, DocumentURI: missingSafePath, FileExt: ".png"})
	testDB.Create(&models.Receipt{ExpenseID: &expMulti.ID, DocumentURI: "/etc/passwd", FileExt: ".txt"})

	req := httptest.NewRequest("GET", "/api/reports/tax-pack?startDate=2026-01-01&endDate=2026-12-31", nil)
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("expected 200 ExportTaxPackZip, got err=%v code=%v", err, resp)
	}
	zipBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		t.Fatalf("invalid zip returned: %v", err)
	}

	expectedSum := sha256.Sum256(safeContent)
	expectedHex := hex.EncodeToString(expectedSum[:])

	var foundSummary, foundTxCSV, foundManifest, foundReceipt bool
	for _, f := range zr.File {
		rc, _ := f.Open()
		content, _ := io.ReadAll(rc)
		rc.Close()
		s := string(content)

		switch {
		case strings.HasPrefix(f.Name, "Schedule_C_Tax_Summary_"):
			foundSummary = true
			if !strings.Contains(s, "Schedule SE") || !strings.Contains(s, "Suspense 9999") || !strings.Contains(s, "'=Line 24b") {
				t.Fatalf("unexpected Schedule C CSV in tax pack: %s", s)
			}
		case strings.HasPrefix(f.Name, "All_Transactions_"):
			foundTxCSV = true
		case f.Name == "Receipts/README_MANIFEST.txt":
			foundManifest = true
			if !strings.Contains(s, "sha256: "+expectedHex) || !strings.Contains(s, "[SKIPPED - INVALID PATH]") || !strings.Contains(s, "[MISSING]") {
				t.Fatalf("expected manifest with sha256 hash, [SKIPPED - INVALID PATH], and [MISSING]; got:\n%s", s)
			}
		case strings.HasPrefix(f.Name, "Receipts/") && strings.HasSuffix(f.Name, ".pdf"):
			foundReceipt = true
			if !bytes.Equal(content, safeContent) {
				t.Fatalf("archived receipt bytes mismatch")
			}
		}
		if strings.Contains(s, "root:x:0:0") {
			t.Fatal("path traversal leaked /etc/passwd into tax pack zip")
		}
	}

	if !foundSummary || !foundTxCSV || !foundManifest || !foundReceipt {
		t.Fatalf("missing expected zip entries: summary=%v tx=%v manifest=%v receipt=%v", foundSummary, foundTxCSV, foundManifest, foundReceipt)
	}
}

func TestSystemBackupExportAndAtomicRestore(t *testing.T) {
	testDB := setupTestDB(t)
	defer teardownTestDB()

	app := fiber.New()
	setupExportRoutes(app)

	testDB.Create(&models.AppSetting{Key: "CompanyName", Value: "Reflex Tech LLC"})
	bank := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	expCat := models.ChartAccount{Code: "5010", Name: "Rent", Type: "EXPENSE", Active: true}
	testDB.Create(&bank)
	testDB.Create(&expCat)

	d := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	testDB.Create(&models.BankRule{Name: "Rent Rule", Active: true, ConditionsJSON: "[]", CategoryAccountID: &expCat.ID})
	testDB.Create(&models.Invoice{InvoiceNumber: "INV-BKP-1", ClientName: "Acme", IssueDate: d, DueDate: d.AddDate(0, 0, 30), TotalAmount: models.NewMoney(300), BalanceDue: models.NewMoney(300), Status: "SENT"})
	testDB.Create(&models.BankStatement{ChartAccountID: &bank.ID, DocumentURI: "/tmp/may.ofx", FileExt: ".ofx", StartDate: d, EndDate: d})
	bt := models.BankTransaction{Date: d, Description: "RENT CHECK", Amount: models.NewMoney(-1500), FITID: "BKP-TX-1", ChartAccountID: &bank.ID, CategoryAccountID: &expCat.ID, ReviewStatus: "APPROVED", AllocationStatus: "BALANCED"}
	testDB.Create(&bt)
	exp := models.Expense{Timestamp: d, Vendor: "Landlord", Description: "May Rent", Amount: models.NewMoney(1500), Tender: "card", ChartAccountID: &expCat.ID, ReviewStatus: "APPROVED", AllocationStatus: "BALANCED"}
	testDB.Create(&exp)
	testDB.Create(&models.Receipt{ExpenseID: &exp.ID, DocumentURI: "/tmp/nonexistent.png", FileExt: ".png"})
	testDB.Create(&models.ExpenseBankTransaction{ExpenseID: exp.ID, BankTransactionID: bt.ID, Status: "confirmed"})
	testDB.Create(&models.ItemAuditLog{ItemType: "expense", ItemID: exp.ID, Action: "EXCLUDED", Reason: "DUPLICATE"})

	// Export backup JSON
	req := httptest.NewRequest("GET", "/api/system/backup/export", nil)
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("expected 200 backup export, got err=%v code=%v", err, resp)
	}
	backupBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	// Bad restore inputs
	if code, _ := doJSONMap(t, app, "POST", "/api/system/backup/restore", ""); code != 400 {
		t.Fatalf("expected 400 empty backup, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/system/backup/restore", "{bad"); code != 400 {
		t.Fatalf("expected 400 invalid JSON, got %d", code)
	}
	if code, _ := doJSONMap(t, app, "POST", "/api/system/backup/restore", map[string]interface{}{"format": "wrong"}); code != 400 {
		t.Fatalf("expected 400 wrong format, got %d", code)
	}

	// Modify data & verify raw JSON restore overwrites + preserves counts including auditLogs
	testDB.Model(&models.AppSetting{}).Where("key = ?", "CompanyName").Update("value", "Tampered Name")
	code, restoreResp := doJSONMap(t, app, "POST", "/api/system/backup/restore", string(backupBytes))
	if code != 200 {
		t.Fatalf("expected 200 raw restore, got %d %v", code, restoreResp)
	}
	restoredCounts := restoreResp["restored"].(map[string]interface{})
	if int(restoredCounts["auditLogs"].(float64)) != 1 || int(restoredCounts["transactions"].(float64)) != 1 {
		t.Fatalf("expected restored counts with 1 auditLog & 1 transaction, got %v", restoredCounts)
	}
	var setting models.AppSetting
	testDB.Where("key = ?", "CompanyName").First(&setting)
	if setting.Value != "Reflex Tech LLC" {
		t.Fatalf("expected setting restored to 'Reflex Tech LLC', got %q", setting.Value)
	}

	// Test multipart upload restore on empty/re-seeded rows
	testDB.Unscoped().Delete(&models.ItemAuditLog{}, "1 = 1")
	var mpBuf bytes.Buffer
	mw := multipart.NewWriter(&mpBuf)
	fw, _ := mw.CreateFormFile("backup", "backup.json")
	_, _ = fw.Write(backupBytes)
	mw.Close()

	mpReq := httptest.NewRequest("POST", "/api/system/backup/restore", &mpBuf)
	mpReq.Header.Set("Content-Type", mw.FormDataContentType())
	mpResp, err := app.Test(mpReq)
	if err != nil || mpResp.StatusCode != 200 {
		t.Fatalf("expected 200 multipart backup restore, got err=%v code=%d", err, mpResp.StatusCode)
	}
	mpResp.Body.Close()
	var alCount int64
	testDB.Model(&models.ItemAuditLog{}).Count(&alCount)
	if alCount != 1 {
		t.Fatalf("expected 1 audit log recreated via multipart restore, got %d", alCount)
	}

	// Test atomic rollback when an item write in the transaction fails mid-flight
	var badPayload SystemBackupRestorePayload
	_ = json.Unmarshal(backupBytes, &badPayload)
	badPayload.Data.Settings = []models.AppSetting{{Key: "RollbackCheck", Value: "ShouldNotPersist"}}
	badPayload.Data.AuditLogs = append(badPayload.Data.AuditLogs, models.ItemAuditLog{
		ItemType: "expense", ItemID: 1, Action: "EXCLUDED",
	})
	testDB.Exec(`CREATE TEMP TRIGGER fail_restore_audit BEFORE INSERT ON item_audit_logs BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`)
	badBytes, _ := json.Marshal(badPayload)
	if code, _ = doJSONMap(t, app, "POST", "/api/system/backup/restore", string(badBytes)); code != 500 {
		t.Fatalf("expected 500 on simulated DB write failure atomic rollback, got %d", code)
	}
	testDB.Exec(`DROP TRIGGER IF EXISTS fail_restore_audit;`)
	var rbSettingCount int64
	testDB.Model(&models.AppSetting{}).Where("key = ?", "RollbackCheck").Count(&rbSettingCount)
	if rbSettingCount != 0 {
		t.Fatalf("expected atomic transaction rollback to prevent RollbackCheck setting from persisting, count=%d", rbSettingCount)
	}
}
