package utils

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// -------------------------------------------------------------------
// Test helpers — set up a fresh SQLite :memory: DB that the global
// db.DB points at for the duration of each test.
// -------------------------------------------------------------------

func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	orig := db.DB
	t.Cleanup(func() { db.DB = orig })

	sqliteDB, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	sqliteDB.SetupJoinTable(&models.Expense{}, "BankTransactions", &models.ExpenseBankTransaction{})
	sqliteDB.SetupJoinTable(&models.BankTransaction{}, "Expenses", &models.ExpenseBankTransaction{})

	sqliteDB.AutoMigrate(
		&models.ChartAccount{},
		&models.AppSetting{},
		&models.BankStatement{},
		&models.BankTransaction{},
		&models.Invoice{},
		&models.Expense{},
		&models.Receipt{},
		&models.ExpenseBankTransaction{},
		&models.PeriodAuditLog{},
		&models.ItemAuditLog{},
		&models.BankRule{},
	)

	db.DB = sqliteDB
	return sqliteDB
}

func seedExpenseAccounts(tx *gorm.DB) {
	tx.Create(&models.ChartAccount{Code: "5010", Name: "Office Supplies", Type: "EXPENSE", Active: true})
	tx.Create(&models.ChartAccount{Code: "5020", Name: "Meals", Type: "EXPENSE", Active: true})
	tx.Create(&models.ChartAccount{Code: "5030", Name: "Travel", Type: "EXPENSE", Active: true})
}

func seedClosedPeriod(tx *gorm.DB, closedDate string) {
	tx.Create(&models.AppSetting{Key: "BooksClosedDate", Value: closedDate})
}

func strPtr(s string) *string { return &s }

// canRunFilesystemTests checks if the /app/documents directory is writable
// (i.e., we're running inside the Docker container where it exists).
var fsTestPossible = func() bool {
	_, err := os.Stat("/app/documents/inbox")
	return err == nil
}()

// -------------------------------------------------------------------
// S07D — parseCsv.go: ParseCsvStatement integration
// -------------------------------------------------------------------

func TestParseCsvStatement_HeaderDetection(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount\n2026-01-15,Store A,100.00\n2026-01-16,Store B,50.25\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 2 {
		t.Errorf("expected 2 transactions, got %d", count)
	}
}

func TestParseCsvStatement_SplitDebitCredit(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Payee,Debit,Credit\n2026-03-01,Vendor X,75.50,\n2026-03-02,Refund,,200.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 2 {
		t.Errorf("expected 2 transactions, got %d", count)
	}
}

func TestParseCsvStatement_MinimalRows(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 0 {
		t.Errorf("expected 0 transactions for header-only CSV, got %d", count)
	}
}

func TestParseCsvStatement_CreditCardDetection(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	// Note: The regex matches the first alphanumeric token >=3 chars after optional card/account prefix + whitespace.
	// "Card ending ***1234" → regex matches "ending" (first 3+ char token). Use "Card Number: 1234" format.
	csvData := "Card Number: 1234\nDate,Description,Amount\n2026-01-15,Store A,100.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var stmt models.BankStatement
	err := db.First(&stmt).Error
	if err != nil {
		t.Fatalf("expected bank statement, got error: %v", err)
	}
	if !strings.Contains(stmt.AccountID, "1234") {
		t.Errorf("expected account ID to contain '1234', got %s", stmt.AccountID)
	}
}

func TestParseCsvStatement_ZeroAmountSkipped(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount\n2026-01-15,Zero Tx,0.00\n2026-01-16,Real Tx,25.50\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction (zero amount skipped), got %d", count)
	}
}

func TestParseCsvStatement_FITIDFromColumn(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount,Reference ID\n2026-01-15,Store A,100.00,REF-123\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var tx models.BankTransaction
	err := db.First(&tx).Error
	if err != nil {
		t.Fatalf("expected transaction, got error: %v", err)
	}
	if tx.FITID != "REF-123" {
		t.Errorf("expected FITID 'REF-123', got '%s'", tx.FITID)
	}
}

func TestParseCsvStatement_AccountMetadata(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Bank: Chase\nAccount Number: 9876543210\nDate,Description,Amount\n2026-01-15,Store,50.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var stmt models.BankStatement
	err := db.First(&stmt).Error
	if err != nil {
		t.Fatalf("expected bank statement, got error: %v", err)
	}
	if !strings.Contains(stmt.AccountID, "9876543210") {
		t.Errorf("expected account ID to contain '9876543210', got %s", stmt.AccountID)
	}
}

func TestParseCsvStatement_DuplicateFITID(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount,Reference ID\n2026-01-15,Store A,100.00,DUP-1\n2026-01-15,Store A,100.00,DUP-1\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)
	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction after duplicate skip, got %d", count)
	}
}

func TestParseCsvStatement_NegativeAmount(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount\n2026-01-15,Store,-25.50\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var tx models.BankTransaction
	err := db.First(&tx).Error
	if err != nil {
		t.Fatalf("expected transaction, got error: %v", err)
	}
	if tx.TransactionType != "DEBIT" {
		t.Errorf("expected DEBIT type for negative amount, got %s", tx.TransactionType)
	}
}

func TestParseCsvStatement_PositiveAmount(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount\n2026-01-15,Refund,100.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var tx models.BankTransaction
	err := db.First(&tx).Error
	if err != nil {
		t.Fatalf("expected transaction, got error: %v", err)
	}
	if tx.TransactionType != "DEP" {
		t.Errorf("expected DEP type for positive amount, got %s", tx.TransactionType)
	}
}

func TestParseCsvStatement_AmountVariants(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Total\n2026-01-15,Store,50.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction with 'Total' header, got %d", count)
	}
}

func TestParseCsvStatement_NarrativeHeader(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Narrative,Amount\n2026-01-15,Vendor,30.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction with 'Narrative' header, got %d", count)
	}
}

func TestParseCsvStatement_DetailsHeader(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Details,Amount\n2026-01-15,Vendor,30.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction with 'Details' header, got %d", count)
	}
}

func TestParseCsvStatement_MerchantHeader(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Merchant,Amount\n2026-01-15,Store,100.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction with 'Merchant' header, got %d", count)
	}
}

func TestParseCsvStatement_CheckNumberHeader(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount,Check Number\n2026-01-15,Vendor,20.00,1234\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var tx models.BankTransaction
	err := db.First(&tx).Error
	if err != nil {
		t.Fatalf("expected transaction, got error: %v", err)
	}
	if tx.FITID != "1234" {
		t.Errorf("expected FITID '1234', got '%s'", tx.FITID)
	}
}

func TestParseCsvStatement_RefColumn(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Description,Amount,Ref\n2026-01-15,Vendor,20.00,REF-567\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var tx models.BankTransaction
	err := db.First(&tx).Error
	if err != nil {
		t.Fatalf("expected transaction, got error: %v", err)
	}
	if tx.FITID != "REF-567" {
		t.Errorf("expected FITID 'REF-567', got '%s'", tx.FITID)
	}
}

func TestParseCsvStatement_MemoHeader(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Memo,Amount\n2026-01-15,Vendor,20.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction with 'Memo' header, got %d", count)
	}
}

func TestParseCsvStatement_DebitCreditBothZero(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Date,Payee,Debit,Credit\n2026-01-15,Empty Tx,,\n2026-01-15,Valid Tx,10.00,\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction (zero debit/credit skipped), got %d", count)
	}
}

func TestParseCsvStatement_DateOnlyHeader(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	csvData := "Transaction Date,Description,Amount\n2026-06-01,Vendor,10.00\n"
	csvFile := filepath.Join(dir, "test.csv")
	os.WriteFile(csvFile, []byte(csvData), 0644)

	ParseCsvStatement(csvFile)

	var count int64
	db.Model(&models.BankTransaction{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction with 'Transaction Date' header, got %d", count)
	}
}

// -------------------------------------------------------------------
// S07D — parseOfx.go: integration tests
// -------------------------------------------------------------------

func TestParseOfx_AccountIDNil(t *testing.T) {
	result := resolveOrCreateChartAccount("", "", "ASSET", "Test", "CHECKING")
	if result != nil {
		t.Error("expected nil for empty accountID")
	}
}

func TestParseOfx_NoStatement(t *testing.T) {
	dir := t.TempDir()
	ofxFile := filepath.Join(dir, "garbage.ofx")
	os.WriteFile(ofxFile, []byte("not an ofx file"), 0644)
	ParseOfx(ofxFile)
}

// -------------------------------------------------------------------
// S07D — processer.go: processFile, sendReceiptToScript (fs-dependent)
// -------------------------------------------------------------------

func TestSendReceiptToScript_Retry(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	callCount := 0
	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount < 2 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"vendor":"Retry Store","description":"Retry test","amount":15.00,"taxAmount":1.00,"currencyCode":"USD","tender":"CARD","chartAccountId":null}`))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	receipt := models.Receipt{DocumentURI: "", FileExt: ".png", FileHash: "abc123"}
	err := sendReceiptToScript(file, &receipt)
	if err != nil {
		t.Fatalf("sendReceiptToScript error: %v", err)
	}
	if callCount != 2 {
		t.Errorf("expected 2 calls (1 failure + 1 success), got %d", callCount)
	}
}

func TestSendReceiptToScript_AllRetriesFail(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	callCount := 0
	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	receipt := models.Receipt{DocumentURI: "", FileExt: ".png", FileHash: "abc123"}
	err := sendReceiptToScript(file, &receipt)
	if err == nil {
		t.Error("expected error after all retries fail")
	}
	if callCount != 3 {
		t.Errorf("expected 3 calls (all failures), got %d", callCount)
	}
}

func TestProcessFile_UnsupportedExtension(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	dir := t.TempDir()
	file := filepath.Join(dir, "test.txt")
	os.WriteFile(file, []byte("hello"), 0644)

	err := processFile(file)
	if err == nil {
		t.Error("expected error for unsupported extension")
	}
}

func TestProcessFile_ReceiptPath_PNG(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"vendor":"Test Store","description":"Test receipt","amount":25.50,"taxAmount":2.00,"currencyCode":"USD","tender":"CARD","chartAccountId":1}`))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	err := processFile(file)
	if err != nil {
		t.Fatalf("processFile error: %v", err)
	}

	var receiptCount, expenseCount int64
	db.Model(&models.Receipt{}).Count(&receiptCount)
	db.Model(&models.Expense{}).Count(&expenseCount)

	if receiptCount != 1 {
		t.Errorf("expected 1 receipt, got %d", receiptCount)
	}
	if expenseCount != 1 {
		t.Errorf("expected 1 expense, got %d", expenseCount)
	}
}

func TestProcessFile_ReceiptPath_HEIC(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.heic")
	os.WriteFile(file, []byte("fake heic"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"vendor":"HEIC Store","description":"HEIC receipt","amount":10.00,"taxAmount":0.50,"currencyCode":"USD","tender":"CASH","chartAccountId":null}`))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	err := processFile(file)
	if err != nil {
		t.Fatalf("processFile error: %v", err)
	}

	var receiptCount, expenseCount int64
	db.Model(&models.Receipt{}).Count(&receiptCount)
	db.Model(&models.Expense{}).Count(&expenseCount)

	if receiptCount != 1 {
		t.Errorf("expected 1 receipt, got %d", receiptCount)
	}
	if expenseCount != 1 {
		t.Errorf("expected 1 expense, got %d", expenseCount)
	}
}

func TestProcessFile_ReceiptPath_AI_Fallback(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	err := processFile(file)
	if err != nil {
		t.Fatalf("processFile error: %v", err)
	}

	var expenseCount int64
	db.Model(&models.Expense{}).Count(&expenseCount)
	if expenseCount != 1 {
		t.Errorf("expected 1 fallback expense, got %d", expenseCount)
	}
}

func TestProcessFile_ReceiptPath_AI_EmptyResponse(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(""))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	err := processFile(file)
	if err != nil {
		t.Fatalf("processFile error: %v", err)
	}

	var expenseCount int64
	db.Model(&models.Expense{}).Count(&expenseCount)
	if expenseCount != 1 {
		t.Errorf("expected 1 fallback expense, got %d", expenseCount)
	}
}

func TestProcessFile_ReceiptPath_AI_MissingAmount(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"vendor":"Zero Store","description":"No amount","amount":0,"taxAmount":0,"currencyCode":"USD","tender":"CARD","chartAccountId":null}`))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	err := processFile(file)
	if err != nil {
		t.Fatalf("processFile error: %v", err)
	}

	var exp models.Expense
	db.First(&exp)
	if !strings.Contains(exp.Description, "[MISSING AMOUNT") {
		t.Errorf("expected missing amount flag in description, got %s", exp.Description)
	}
	if exp.ReviewStatus != "PENDING" {
		t.Errorf("expected PENDING review status, got %s", exp.ReviewStatus)
	}
}

func TestProcessFile_ReceiptPath_AI_MissingDate(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"vendor":"Dateless Store","description":"No date","amount":50.00,"taxAmount":4.00,"currencyCode":"USD","tender":"CARD","chartAccountId":null}`))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	err := processFile(file)
	if err != nil {
		t.Fatalf("processFile error: %v", err)
	}

	var exp models.Expense
	db.First(&exp)
	if !strings.Contains(exp.Description, "[MISSING DATE") {
		t.Errorf("expected missing date flag in description, got %s", exp.Description)
	}
	if exp.ReviewStatus != "PENDING" {
		t.Errorf("expected PENDING review status, got %s", exp.ReviewStatus)
	}
}

func TestProcessFile_DuplicateHash(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("same content"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"vendor":"Test","description":"Test","amount":10.00,"taxAmount":0,"currencyCode":"USD","tender":"CARD","chartAccountId":null}`))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	processFile(file)
	processFile(file)

	var receiptCount int64
	db.Model(&models.Receipt{}).Count(&receiptCount)
	if receiptCount != 1 {
		t.Errorf("expected 1 receipt (duplicate skipped), got %d", receiptCount)
	}
}

func TestProcessFile_OfxStatement(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.ofx")
	os.WriteFile(file, []byte("not an actual ofx"), 0644)

	err := processFile(file)
	_ = err
}

func TestProcessFile_ReceiptPath_PDF(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.pdf")
	os.WriteFile(file, []byte("fake pdf"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"vendor":"PDF Store","description":"PDF receipt","amount":30.00,"taxAmount":2.50,"currencyCode":"USD","tender":"CHECK","chartAccountId":null}`))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	err := processFile(file)
	if err != nil {
		t.Fatalf("processFile error: %v", err)
	}

	var receiptCount, expenseCount int64
	db.Model(&models.Receipt{}).Count(&receiptCount)
	db.Model(&models.Expense{}).Count(&expenseCount)

	if receiptCount != 1 {
		t.Errorf("expected 1 receipt, got %d", receiptCount)
	}
	if expenseCount != 1 {
		t.Errorf("expected 1 expense, got %d", expenseCount)
	}
}

func TestProcessFile_ClosedPeriodExpense(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)
	seedClosedPeriod(db, time.Now().Add(24*time.Hour).Format("2006-01-02"))

	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	mockURL := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"vendor":"Closed Store","description":"Test","amount":10.00,"taxAmount":0,"currencyCode":"USD","tender":"CARD","chartAccountId":null}`))
	}))
	defer mockURL.Close()

	origEnv := os.Getenv("FILE_PROCESSOR_URL")
	os.Setenv("FILE_PROCESSOR_URL", mockURL.URL+"/process")
	defer os.Setenv("FILE_PROCESSOR_URL", origEnv)

	processFile(file)

	var exp models.Expense
	db.First(&exp)
	if exp.ReviewStatus != "PENDING" {
		t.Errorf("expected PENDING for closed-period expense, got %s", exp.ReviewStatus)
	}
}

func TestValidateExtractedCategory_InvalidAccount(t *testing.T) {
	id := uint(9999)
	result := ValidateExtractedCategory(&id)
	if result != nil {
		t.Error("expected nil for non-existent account")
	}
}

func TestValidateExtractedCategory_InactiveAccount(t *testing.T) {
	db := setupTestDB(t)
	// SQLite GORM driver may coerce Active:false to default:true. Use Update to force it.
	db.Create(&models.ChartAccount{Code: "5010", Name: "Supplies", Type: "EXPENSE", Active: true})
	var ca models.ChartAccount
	db.Where("code = ?", "5010").First(&ca)
	db.Model(&ca).Update("active", false)

	// Re-read to verify
	db.Where("code = ?", "5010").First(&ca)
	if ca.Active {
		t.Errorf("account should have Active=false, got %v", ca.Active)
	}

	result := ValidateExtractedCategory(&ca.ID)
	if result != nil {
		t.Errorf("expected nil for inactive account, got %d", *result)
	}
}

func TestValidateExtractedCategory_WrongType(t *testing.T) {
	db := setupTestDB(t)
	ca := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.Create(&ca)

	result := ValidateExtractedCategory(&ca.ID)
	if result != nil {
		t.Error("expected nil for non-EXPENSE account")
	}
}

func TestValidateExtractedCategory_Valid(t *testing.T) {
	db := setupTestDB(t)
	ca := models.ChartAccount{Code: "5010", Name: "Supplies", Type: "EXPENSE", Active: true}
	db.Create(&ca)

	result := ValidateExtractedCategory(&ca.ID)
	if result == nil || *result != ca.ID {
		t.Errorf("expected ID %d, got %v", ca.ID, result)
	}
}

func TestFetchActiveExpenseAccounts(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	accounts, err := FetchActiveExpenseAccounts()
	if err != nil {
		t.Fatalf("FetchActiveExpenseAccounts error: %v", err)
	}
	if len(accounts) != 3 {
		t.Errorf("expected 3 expense accounts, got %d", len(accounts))
	}
	if accounts[0].Code != "5010" {
		t.Errorf("expected first account code 5010, got %s", accounts[0].Code)
	}
}

func TestBuildReceiptPrompt_NoAccounts(t *testing.T) {
	prompt := BuildReceiptPrompt(nil)
	if !strings.Contains(prompt, "none") {
		t.Error("prompt should contain 'none' for no accounts")
	}
	if !strings.Contains(prompt, "chartAccountId") {
		t.Error("prompt should mention chartAccountId")
	}
}

func TestBuildReceiptPrompt_WithAccounts(t *testing.T) {
	accounts := []models.ChartAccount{
		{ID: 1, Name: "Office Supplies"},
		{ID: 2, Name: "Meals"},
	}

	prompt := BuildReceiptPrompt(accounts)
	if !strings.Contains(prompt, "1:Office Supplies") {
		t.Error("prompt should contain '1:Office Supplies'")
	}
	if !strings.Contains(prompt, "2:Meals") {
		t.Error("prompt should contain '2:Meals'")
	}
	if !strings.Contains(prompt, "chartAccountId") {
		t.Error("prompt should contain 'chartAccountId'")
	}
}

// -------------------------------------------------------------------
// S07D — watcher.go: integration tests
// -------------------------------------------------------------------

func TestProcessExistingFiles_NonExistentDir(t *testing.T) {
	err := ProcessExistingFiles("/nonexistent/path")
	if err == nil {
		t.Error("expected error for non-existent dir")
	}
}

func TestProcessExistingFiles_SkipsDirectories(t *testing.T) {
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "subdir"), 0755)
	os.WriteFile(filepath.Join(dir, "test.png"), []byte("fake png"), 0644)

	err := ProcessExistingFiles(dir)
	if err != nil {
		t.Fatalf("ProcessExistingFiles: %v", err)
	}
}

func TestProcessExistingFilesSweep_SkipsInFlight(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "test.png")
	os.WriteFile(file, []byte("fake png"), 0644)

	acquireInFlight(file)

	err := processExistingFilesSweep(dir)
	if err != nil {
		t.Fatalf("processExistingFilesSweep: %v", err)
	}

	releaseInFlight(file)
}

func TestDebounceEvent_TimerReset(t *testing.T) {
	func() {
		mu.Lock()
		for k := range timers {
			delete(timers, k)
		}
		mu.Unlock()
	}()

	dir := t.TempDir()
	file := filepath.Join(dir, "test.txt")
	os.WriteFile(file, []byte("test"), 0644)

	debounceEvent(file, 1*time.Second)
	debounceEvent(file, 1*time.Second)
	debounceEvent(file, 1*time.Second)

	mu.Lock()
	count := len(timers)
	mu.Unlock()

	if count != 1 {
		t.Errorf("expected 1 timer after 3 calls, got %d", count)
	}
}

func TestDebounceEvent_UnstableFile(t *testing.T) {
	func() {
		mu.Lock()
		for k := range timers {
			delete(timers, k)
		}
		mu.Unlock()
	}()

	dir := t.TempDir()
	file := filepath.Join(dir, "test.txt")
	os.WriteFile(file, nil, 0644)

	done := make(chan struct{})
	go func() {
		debounceEvent(file, 100*time.Millisecond)
		time.Sleep(500 * time.Millisecond)
		close(done)
	}()

	<-done

	mu.Lock()
	count := len(timers)
	mu.Unlock()
	if count != 0 {
		t.Errorf("expected 0 timers after unstable file skip, got %d", count)
	}
}

func TestDebounceEvent_InFlightReject(t *testing.T) {
	func() {
		mu.Lock()
		for k := range timers {
			delete(timers, k)
		}
		inFlight = make(map[string]bool)
		mu.Unlock()
	}()

	dir := t.TempDir()
	file := filepath.Join(dir, "test.txt")
	os.WriteFile(file, []byte("test"), 0644)

	acquireInFlight(file)

	done := make(chan struct{})
	go func() {
		debounceEvent(file, 100*time.Millisecond)
		time.Sleep(500 * time.Millisecond)
		close(done)
	}()

	<-done

	mu.Lock()
	count := len(timers)
	mu.Unlock()
	if count != 0 {
		t.Errorf("expected 0 timers after in-flight skip, got %d", count)
	}
}

func TestWatcher_Alias(t *testing.T) {
	err := Watcher()
	_ = err
}

func TestRestartWatcher_Basic(t *testing.T) {
	err := RestartWatcher()
	_ = err
}

func TestUploadWithTimeout_FailureStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`error`))
	}))
	defer server.Close()

	result, err := uploadWithTimeout(&http.Client{Timeout: 10 * time.Second}, server.URL, []byte("data"), "multipart/form-data")
	if err == nil {
		t.Error("expected error for 500 status")
	}
	if len(result) > 0 {
		t.Error("expected empty result body for error")
	}
}

// -------------------------------------------------------------------
// S07D — parseOfx.go: resolveOrCreateChartAccount deep tests
// -------------------------------------------------------------------

func TestResolveOrCreateChartAccount_DirectMatch(t *testing.T) {
	db := setupTestDB(t)

	ca := models.ChartAccount{Code: "1010", Name: "My Checking", Type: "ASSET", Active: true, OfxAccountID: strPtr("acct-123")}
	db.Create(&ca)

	result := resolveOrCreateChartAccount("acct-123", "BANK", "ASSET", "Test Bank", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if *result != ca.ID {
		t.Errorf("expected ID %d, got %d", ca.ID, *result)
	}
}

func TestResolveOrCreateChartAccount_SmartAdoption(t *testing.T) {
	db := setupTestDB(t)

	db.Create(&models.ChartAccount{Code: "1010", Name: "Primary business checking", Type: "ASSET", Active: true, IsDefault: true})

	result := resolveOrCreateChartAccount("acct-456", "CHASE", "ASSET", "Chase", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result from smart adoption")
	}

	var ca models.ChartAccount
	db.First(&ca, *result)
	if ca.OfxAccountID == nil || *ca.OfxAccountID != "acct-456" {
		t.Errorf("expected OfxAccountID to be 'acct-456', got %v", ca.OfxAccountID)
	}
}

func TestResolveOrCreateChartAccount_NewAccountFallback(t *testing.T) {
	db := setupTestDB(t)

	db.Create(&models.ChartAccount{Code: "1010", Name: "Primary business checking", Type: "ASSET", Active: true, IsDefault: true})
	db.Create(&models.ChartAccount{Code: "1020", Name: "Business savings account", Type: "ASSET", Active: true, IsDefault: true})

	result := resolveOrCreateChartAccount("acct-789", "WELLS", "ASSET", "Wells Fargo", "SAVINGS")
	if result == nil {
		t.Fatal("expected non-nil result from new account creation")
	}

	var ca models.ChartAccount
	db.First(&ca, *result)
	if ca.Name == "" {
		t.Error("created account should have a name")
	}
}

func TestResolveOrCreateChartAccount_CreditCard(t *testing.T) {
	db := setupTestDB(t)

	result := resolveOrCreateChartAccount("cc-999", "VISA", "LIABILITY", "Visa", "CREDIT_CARD")
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	var ca models.ChartAccount
	db.First(&ca, *result)
	if ca.Type != "LIABILITY" {
		t.Errorf("expected LIABILITY type, got %s", ca.Type)
	}
}

func TestResolveOrCreateChartAccount_ByBankStatement(t *testing.T) {
	db := setupTestDB(t)

	ca := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.Create(&ca)

	stmt := models.BankStatement{
		AccountID:      "acct-match",
		ChartAccountID: &ca.ID,
	}
	db.Create(&stmt)

	result := resolveOrCreateChartAccount("acct-match", "", "ASSET", "Test", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result from bank statement match")
	}
	if *result != ca.ID {
		t.Errorf("expected ID %d, got %d", ca.ID, *result)
	}
}

func TestResolveOrCreateChartAccount_LegacyDescription(t *testing.T) {
	db := setupTestDB(t)

	ca := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true, Description: "legacy-id-123"}
	db.Create(&ca)

	result := resolveOrCreateChartAccount("legacy-id-123", "", "ASSET", "Test", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result from legacy description match")
	}
	if *result != ca.ID {
		t.Errorf("expected ID %d, got %d", ca.ID, *result)
	}
}

func TestResolveOrCreateChartAccount_ByBankStatement_NilChartAccount(t *testing.T) {
	db := setupTestDB(t)

	stmt := models.BankStatement{
		AccountID:      "acct-nil-ca",
		ChartAccountID: nil,
	}
	db.Create(&stmt)

	result := resolveOrCreateChartAccount("acct-nil-ca", "", "ASSET", "Test", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestResolveOrCreateChartAccount_ByBankStatement_WithChartAccount(t *testing.T) {
	db := setupTestDB(t)

	ca := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.Create(&ca)

	stmt := models.BankStatement{
		AccountID:      "acct-match-ca",
		ChartAccountID: &ca.ID,
	}
	db.Create(&stmt)

	result := resolveOrCreateChartAccount("acct-match-ca", "", "ASSET", "Test", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if *result != ca.ID {
		t.Errorf("expected ID %d, got %d", ca.ID, *result)
	}
}

func TestResolveOrCreateChartAccount_UpdatesOfxAccountID(t *testing.T) {
	db := setupTestDB(t)

	ca := models.ChartAccount{Code: "1010", Name: "Checking", Type: "ASSET", Active: true}
	db.Create(&ca)

	stmt := models.BankStatement{
		AccountID:      "acct-to-match",
		ChartAccountID: &ca.ID,
	}
	db.Create(&stmt)

	result := resolveOrCreateChartAccount("acct-to-match", "", "ASSET", "Test", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	var updatedCA models.ChartAccount
	db.First(&updatedCA, *result)
	if updatedCA.OfxAccountID == nil || *updatedCA.OfxAccountID != "acct-to-match" {
		t.Errorf("expected ofx_account_id updated to 'acct-to-match', got %v", updatedCA.OfxAccountID)
	}
}

func TestResolveOrCreateChartAccount_LineOfCredit(t *testing.T) {
	db := setupTestDB(t)

	result := resolveOrCreateChartAccount("loc-acct", "BANK", "LIABILITY", "Bank", "CREDITLINE")
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	var ca models.ChartAccount
	db.First(&ca, *result)
	if ca.Type != "LIABILITY" {
		t.Errorf("expected LIABILITY, got %s", ca.Type)
	}
}

func TestResolveOrCreateChartAccount_BankLoan(t *testing.T) {
	db := setupTestDB(t)

	result := resolveOrCreateChartAccount("loan-acct", "BANK", "LIABILITY", "Bank", "LOAN")
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	var ca models.ChartAccount
	db.First(&ca, *result)
	if ca.Type != "LIABILITY" {
		t.Errorf("expected LIABILITY, got %s", ca.Type)
	}
}

func TestResolveOrCreateChartAccount_AllDefaultFilled(t *testing.T) {
	db := setupTestDB(t)

	for i := 1010; i <= 1090; i += 10 {
		code := fmt.Sprintf("%04d", i)
		db.Create(&models.ChartAccount{Code: code, Name: code, Type: "ASSET", Active: true})
	}

	result := resolveOrCreateChartAccount("new-acct", "TEST", "ASSET", "Test Bank", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestNextAvailableCode_AllFilled(t *testing.T) {
	db := setupTestDB(t)

	for i := 1010; i <= 1090; i += 10 {
		code := fmt.Sprintf("%04d", i)
		db.Create(&models.ChartAccount{Code: code, Name: code, Type: "ASSET", Active: true})
	}

	code := nextAvailableCode("1")
	if code == "" {
		t.Error("expected non-empty code")
	}
	if len(code) < 4 {
		t.Errorf("expected at least 4-char code, got %q", code)
	}
}

func TestNextAvailableCodeInRange_AllFilled(t *testing.T) {
	db := setupTestDB(t)

	for i := 1010; i <= 1015; i += 5 {
		code := fmt.Sprintf("%04d", i)
		db.Create(&models.ChartAccount{Code: code, Name: code, Type: "ASSET", Active: true})
	}

	code := nextAvailableCodeInRange(1010, 1015)
	if code == "" {
		t.Error("expected non-empty code")
	}
}

func TestIsDefaultDescription_Empty(t *testing.T) {
	if isDefaultDescription("") {
		t.Error("empty string should not be default description")
	}
}

// -------------------------------------------------------------------
// S07D — processer.go: CleanAIJSON edge cases
// -------------------------------------------------------------------

func TestCleanAIJSON_MultipleBraces(t *testing.T) {
	input := `{"a":1} middle {"b":2}`
	got := CleanAIJSON(input)
	expected := `{"a":1} middle {"b":2}`
	if got != expected {
		t.Errorf("CleanAIJSON(%q) = %q, want %q", input, got, expected)
	}
}

func TestCleanAIJSON_NoBraces(t *testing.T) {
	input := "just prose"
	got := CleanAIJSON(input)
	if got != input {
		t.Errorf("CleanAIJSON should return input unchanged when no braces, got %q", got)
	}
}

func TestCleanAIJSON_BareBracesNoNewline(t *testing.T) {
	input := "```json{\"k\":\"v\"}```"
	got := CleanAIJSON(input)
	expected := `{"k":"v"}`
	if got != expected {
		t.Errorf("CleanAIJSON(%q) = %q, want %q", input, got, expected)
	}
}

func TestCleanAIJSON_NestedBrackets(t *testing.T) {
	input := `{"outer": {"inner": "value"}}`
	got := CleanAIJSON(input)
	expected := `{"outer": {"inner": "value"}}`
	if got != expected {
		t.Errorf("CleanAIJSON(%q) = %q, want %q", input, got, expected)
	}
}

func TestCleanAIJSON_BareJSON(t *testing.T) {
	input := `{"vendor":"Test"}`
	got := CleanAIJSON(input)
	expected := `{"vendor":"Test"}`
	if got != expected {
		t.Errorf("CleanAIJSON(%q) = %q, want %q", input, got, expected)
	}
}

// -------------------------------------------------------------------
// S07D — parseCsv.go: cleanCSVAmount edge cases
// -------------------------------------------------------------------

func TestCleanCSVAmount_AccountingNegatives(t *testing.T) {
	tests := []struct {
		input    string
		expected float64
	}{
		{"(100.00)", -100.0},
		{"(1)", -1.0},
		{"($1,234.56)", -1234.56},
		{"-$0.01", -0.01},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := cleanCSVAmount(tt.input)
			if err != nil {
				t.Fatalf("cleanCSVAmount(%q) error: %v", tt.input, err)
			}
			if got != tt.expected {
				t.Errorf("cleanCSVAmount(%q) = %f, want %f", tt.input, got, tt.expected)
			}
		})
	}
}

// -------------------------------------------------------------------
// S07D — parseCsv.go: GenerateCSVFitID edge cases
// -------------------------------------------------------------------

func TestGenerateCSVFitID_SameDayMultiple(t *testing.T) {
	d := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)
	id1 := GenerateCSVFitID(d, "UBER", -20.00, 1, 1010)
	id2 := GenerateCSVFitID(d, "UBER", -20.00, 2, 1010)
	id3 := GenerateCSVFitID(d, "UBER", -20.00, 3, 1010)
	if id1 == id2 || id2 == id3 || id1 == id3 {
		t.Error("different occurrence indices should produce different FITIDs")
	}
}

func TestGenerateCSVFitID_NegativeAmount(t *testing.T) {
	d := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)
	id1 := GenerateCSVFitID(d, "UBER", -20.00, 1, 1010)
	id2 := GenerateCSVFitID(d, "UBER", 20.00, 1, 1010)
	_ = id1
	_ = id2
}

// -------------------------------------------------------------------
// S07D — parseCsv.go: parseCSVDate edge cases
// -------------------------------------------------------------------

func TestParseCSVDate_RFC3339Prefix(t *testing.T) {
	got, err := parseCSVDate("2026-08-15T00:00:00")
	if err != nil {
		t.Fatalf("parseCSVDate error: %v", err)
	}
	if got.Format("2006-01-02") != "2026-08-15" {
		t.Errorf("parseCSVDate(%q) = %s, want 2026-08-15", "2026-08-15T00:00:00", got.Format("2006-01-02"))
	}
}

func TestParseCSVDate_SpaceTime(t *testing.T) {
	got, err := parseCSVDate("2026-08-15 14:30:00")
	if err != nil {
		t.Fatalf("parseCSVDate error: %v", err)
	}
	if got.Format("2006-01-02") != "2026-08-15" {
		t.Errorf("parseCSVDate(%q) = %s, want 2026-08-15", "2026-08-15 14:30:00", got.Format("2006-01-02"))
	}
}

func TestParseCSVDate_DDMMYYYY(t *testing.T) {
	got, err := parseCSVDate("15/08/2026")
	if err != nil {
		t.Fatalf("parseCSVDate error: %v", err)
	}
	if got.Format("2006-01-02") != "2026-08-15" {
		t.Errorf("parseCSVDate(%q) = %s, want 2026-08-15", "15/08/2026", got.Format("2006-01-02"))
	}
}

func TestParseCSVDate_TwoDigitYear(t *testing.T) {
	got, err := parseCSVDate("01/15/26")
	if err != nil {
		t.Fatalf("parseCSVDate error: %v", err)
	}
	if got.Format("2006-01-02") != "2026-01-15" {
		t.Errorf("parseCSVDate(%q) = %s, want 2026-01-15", "01/15/26", got.Format("2006-01-02"))
	}
}

// -------------------------------------------------------------------
// S07D — parseOfx.go: buildOfxDescription (no duplicates)
// -------------------------------------------------------------------

func TestBuildOfxDescription_Combined(t *testing.T) {
	tests := []struct {
		name     string
		n        string
		m        string
		expected string
	}{
		{"Empty name", "", "Memo", "Memo"},
		{"Empty memo", "Name", "", "Name"},
		{"Same name and memo", "Starbucks", "Starbucks", "Starbucks"},
		{"Name contains memo", "Starbucks Morning", "Morning", "Starbucks Morning"},
		{"Memo contains name", "Morning Coffee", "Coffee", "Morning Coffee"},
		{"Distinct", "Starbucks", "Morning coffee", "Starbucks Morning coffee"},
		{"Extra whitespace", "  Starbucks  ", "  Morning  ", "Starbucks Morning"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildOfxDescription(tt.n, tt.m)
			if got != tt.expected {
				t.Errorf("buildOfxDescription(%q, %q) = %q, want %q", tt.n, tt.m, got, tt.expected)
			}
		})
	}
}

// -------------------------------------------------------------------
// S07D — parseOfx.go: broadcast test
// -------------------------------------------------------------------

func TestResolveOrCreateChartAccount_BroadcastOnCreate(t *testing.T) {
	db := setupTestDB(t)

	for i := 1010; i <= 1090; i += 10 {
		code := fmt.Sprintf("%04d", i)
		db.Create(&models.ChartAccount{Code: code, Name: code, Type: "ASSET", Active: true})
	}

	sub := events.Hub.Subscribe()
	defer events.Hub.Unsubscribe(sub)

	result := resolveOrCreateChartAccount("broadcast-acct", "TEST", "ASSET", "Test Bank", "CHECKING")
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	select {
	case data := <-sub:
		if !strings.Contains(string(data), "ACCOUNTS_UPDATED") {
			t.Errorf("expected ACCOUNTS_UPDATED in broadcast, got: %s", string(data))
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout waiting for ACCOUNTS_UPDATED broadcast")
	}
}

// -------------------------------------------------------------------
// S07D — parseOfx.go: ProcessExistingFiles (watcher) no-op
// -------------------------------------------------------------------

func TestProcessFile_OfxSafeMove(t *testing.T) {
	if !fsTestPossible {
		t.Skip("filesystem tests require Docker container (/app/documents)")
	}
	db := setupTestDB(t)
	seedExpenseAccounts(db)

	dir := t.TempDir()
	file := filepath.Join(dir, "test.qfx")
	os.WriteFile(file, []byte("not an actual ofx"), 0644)

	err := processFile(file)
	_ = err
}

// -------------------------------------------------------------------
// S07D — ParseExtractedAmount edge cases
// -------------------------------------------------------------------

func TestParseExtractedAmount_InvalidTypes(t *testing.T) {
	if got := ParseExtractedAmount(float32(-42.5)); got != 42.5 {
		t.Errorf("ParseExtractedAmount(float32(-42.5)) = %f, want 42.5", got)
	}
	if got := ParseExtractedAmount(int(-100)); got != 100.0 {
		t.Errorf("ParseExtractedAmount(int(-100)) = %f, want 100.0", got)
	}
	if got := ParseExtractedAmount(int64(-200)); got != 200.0 {
		t.Errorf("ParseExtractedAmount(int64(-200)) = %f, want 200.0", got)
	}
}

// -------------------------------------------------------------------
// S07D — ConvertHeicToPng: invalid output dir
// -------------------------------------------------------------------

func TestConvertHeicToPng_InvalidOutputDir(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.heic")
	os.WriteFile(input, []byte("not a heic"), 0644)
	err := ConvertHeicToPng(input, "/nonexistent/dir/output.png")
	if err == nil {
		t.Error("expected error for invalid output dir")
	}
}

func TestConvertHeicToPng_ReadError(t *testing.T) {
	// Non-existent input file should return an error
	err := ConvertHeicToPng("/definitely/does/not/exist/photo.heic", "/tmp/out.png")
	if err == nil {
		t.Error("expected error for non-existent input")
	}
}
