package utils

import (
	"bytes"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"testing"
	"time"
)

func TestCreateDemoReceiptPNGAndHelpers(t *testing.T) {
	tmpDir := t.TempDir()
	processedDir := filepath.Join(tmpDir, "processed")
	inboxDir := filepath.Join(tmpDir, "inbox")
	if err := os.MkdirAll(processedDir, 0777); err != nil {
		t.Fatalf("mkdir processed: %v", err)
	}
	if err := os.MkdirAll(inboxDir, 0777); err != nil {
		t.Fatalf("mkdir inbox: %v", err)
	}

	origPath := constants.GetCurrentHostPath()
	defer func() {
		_, _ = constants.SetDropboxLocation(origPath)
	}()

	// Write directly to temporary processed path by overriding resolved location if possible,
	// or test wrapLine + PNG rendering on active processed path cleanly and remove temporary artifact.
	spec := DemoReceiptSpec{
		ReceiptID:    999991,
		Vendor:       "Walmart Supercenter #3334",
		Date:         "2026-08-24",
		Description:  "LaserJet toner cartridge and copy paper",
		Subtotal:     "$152.59",
		Tax:          "$12.21",
		Total:        "$164.80",
		Tender:       "card",
		AccountLabel: "5050 Office Supplies",
	}

	outPath, hash, err := CreateDemoReceiptPNGToDir(spec, processedDir)
	if err != nil {
		t.Fatalf("CreateDemoReceiptPNG failed: %v", err)
	}
	defer os.Remove(outPath)

	if len(hash) != 64 {
		t.Errorf("expected 64-char sha256 hash, got %d (%q)", len(hash), hash)
	}

	data, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("failed to read created receipt PNG: %v", err)
	}
	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	if !bytes.HasPrefix(data, pngHeader) {
		t.Errorf("created file is not a valid PNG image")
	}

	lines := wrapLine("LaserJet toner cartridge and copy paper for Utica office", 24)
	if len(lines) < 2 || len(lines) > 3 {
		t.Errorf("expected 2-3 wrapped lines, got %d: %v", len(lines), lines)
	}
}

func TestGetDemoDatasetStatus_NilDBSafe(t *testing.T) {
	status, err := GetDemoDatasetStatus()
	if err != nil {
		t.Fatalf("expected nil error on nil DB, got %v", err)
	}
	if status.Active {
		t.Errorf("expected Active=false on nil DB")
	}
}

func TestRemoveDemoDataset_NilDB(t *testing.T) {
	_, err := RemoveDemoDataset()
	if err == nil {
		t.Fatal("expected error from RemoveDemoDataset with nil DB")
	}
}

func TestResetDemoDataset_NilDB(t *testing.T) {
	_, err := ResetDemoDataset()
	if err == nil {
		t.Fatal("expected error from ResetDemoDataset with nil DB")
	}
}

func TestSeedDemoDataset_NilDB(t *testing.T) {
	_, err := SeedDemoDataset()
	if err == nil {
		t.Fatal("expected error from SeedDemoDataset with nil DB")
	}
}

func TestDemoDatasetCounts(t *testing.T) {
	// Verify DemoDatasetCounts struct fields match expectations
	counts := DemoDatasetCounts{Statements: 1, Transactions: 2, Expenses: 3, Receipts: 4, Invoices: 5}
	if counts.Statements != 1 || counts.Transactions != 2 || counts.Expenses != 3 || counts.Receipts != 4 || counts.Invoices != 5 {
		t.Fatalf("DemoDatasetCounts mismatch: %+v", counts)
	}
}

func TestDemoDatasetStatusStruct(t *testing.T) {
	status := DemoDatasetStatus{Active: true, Counts: DemoDatasetCounts{Statements: 1}}
	if !status.Active || status.Counts.Statements != 1 {
		t.Fatalf("DemoDatasetStatus struct mismatch: %+v", status)
	}
}

func TestRemoveDemoDataset_PreservesRealExtractionUnavailable(t *testing.T) {
	setupUtilsTestDB(t)
	var expAcc models.ChartAccount
	db.DB.Where("code = ?", "5010").First(&expAcc)

	realExp := models.Expense{
		IsManual:         false,
		Timestamp:        time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		Vendor:           "Corner Cafe",
		Description:      "AI extraction unavailable — please enter receipt details",
		Amount:           models.NewMoney(0),
		ChartAccountID:   &expAcc.ID,
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "PENDING",
	}
	if err := db.DB.Create(&realExp).Error; err != nil {
		t.Fatalf("create real expense: %v", err)
	}
	realRec := models.Receipt{
		ExpenseID:   &realExp.ID,
		DocumentURI: "/tmp/non-demo-real-receipt-001.png",
		FileHash:    "realhash001",
	}
	if err := db.DB.Create(&realRec).Error; err != nil {
		t.Fatalf("create real receipt: %v", err)
	}

	if _, err := RemoveDemoDataset(); err != nil {
		t.Fatalf("RemoveDemoDataset: %v", err)
	}

	var count int64
	db.DB.Model(&models.Expense{}).Where("id = ?", realExp.ID).Count(&count)
	if count != 1 {
		t.Fatalf("expected real 'AI extraction unavailable' expense to survive RemoveDemoDataset, count=%d", count)
	}
}
