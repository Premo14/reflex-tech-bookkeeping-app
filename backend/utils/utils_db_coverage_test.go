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

	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupUtilsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open sqlite db: %v", err)
	}
	if sqlDB, sqlErr := gdb.DB(); sqlErr == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	oldDB := db.DB
	oldHostDir := constants.GetCurrentHostPath()
	tempDir := t.TempDir()
	_, _ = constants.SetDropboxLocation(tempDir)

	db.InitSchemaAndSeed(gdb)

	t.Cleanup(func() {
		db.DB = oldDB
		if oldHostDir != "" {
			_, _ = constants.SetDropboxLocation(oldHostDir)
		}
	})
	return gdb
}

func getAcctID(t *testing.T, gdb *gorm.DB, code string) uint {
	t.Helper()
	var acc models.ChartAccount
	if err := gdb.Where("code = ?", code).First(&acc).Error; err != nil {
		t.Fatalf("account %s not found: %v", code, err)
	}
	return acc.ID
}

func TestIsDateInClosedPeriod_AllBranches(t *testing.T) {
	oldDB := db.DB
	db.DB = nil
	if IsDateInClosedPeriod(time.Now()) {
		t.Errorf("expected false when db.DB is nil")
	}
	db.DB = oldDB

	gdb := setupUtilsTestDB(t)
	d := time.Date(2026, 1, 15, 23, 59, 0, 0, time.FixedZone("EST", -5*3600))
	if IsDateInClosedPeriod(d) {
		t.Errorf("expected false without BooksClosedDate")
	}

	gdb.Create(&models.AppSetting{Key: "BooksClosedDate", Value: ""})
	if IsDateInClosedPeriod(d) {
		t.Errorf("expected false for empty BooksClosedDate")
	}

	gdb.Model(&models.AppSetting{}).Where("key = ?", "BooksClosedDate").Update("value", "not-a-date")
	if IsDateInClosedPeriod(d) {
		t.Errorf("expected false for invalid BooksClosedDate")
	}

	gdb.Model(&models.AppSetting{}).Where("key = ?", "BooksClosedDate").Update("value", "2026-01-31")
	if !IsDateInClosedPeriod(d) {
		t.Errorf("expected 2026-01-15 to be in closed period <= 2026-01-31")
	}
	if !IsDateInClosedPeriod(time.Date(2026, 1, 31, 22, 0, 0, 0, time.UTC)) {
		t.Errorf("expected boundary day 2026-01-31 to be closed")
	}
	if IsDateInClosedPeriod(time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("expected 2026-02-01 to be open")
	}
}

func TestUpdateAllocationStatuses_ExactCentsAndSplits(t *testing.T) {
	oldDB := db.DB
	db.DB = nil
	UpdateAllocationStatuses() // must not panic
	db.DB = oldDB

	gdb := setupUtilsTestDB(t)
	checkingID := getAcctID(t, gdb, "1010")
	drawID := getAcctID(t, gdb, "3110")
	expID := getAcctID(t, gdb, "5050")
	day := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)

	// Deposit + Balance-sheet transfer auto-balance
	deposit := models.BankTransaction{Date: day, Description: "Client Wire", Amount: models.NewMoney(500), FITID: "U-DEP", ChartAccountID: &checkingID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	drawTx := models.BankTransaction{Date: day, Description: "Owner Draw", Amount: models.NewMoney(-200), FITID: "U-DRAW", ChartAccountID: &checkingID, CategoryAccountID: &drawID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}

	// Cash expense auto-balances and prunes stale suggestions
	cashExp := models.Expense{Timestamp: day, Vendor: "Petty Cash", Amount: models.NewMoney(18.75), Tender: "cash", ChartAccountID: &expID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}

	// N:1 split payment ($100.50 expense funded by two $50.25 transactions — tests exact-cent SUM fix)
	expN1 := models.Expense{Timestamp: day, Vendor: "Split Vendor", Amount: models.NewMoney(100.50), Tender: "card", ChartAccountID: &expID, AllocationStatus: "UNLINKED", ReviewStatus: "APPROVED"}
	txN1a := models.BankTransaction{Date: day, Description: "Split Part 1", Amount: models.NewMoney(-50.25), FITID: "U-N1A", ChartAccountID: &checkingID, CategoryAccountID: &expID, ReviewStatus: "APPROVED"}
	txN1b := models.BankTransaction{Date: day, Description: "Split Part 2", Amount: models.NewMoney(-50.25), FITID: "U-N1B", ChartAccountID: &checkingID, CategoryAccountID: &expID, ReviewStatus: "APPROVED"}

	// 1:N over-allocated ($100.00 tx linked to $60 + $50 expenses)
	txOver := models.BankTransaction{Date: day, Description: "Over Tx", Amount: models.NewMoney(-100.00), FITID: "U-OVR", ChartAccountID: &checkingID, CategoryAccountID: &expID, ReviewStatus: "APPROVED"}
	expOvr1 := models.Expense{Timestamp: day, Vendor: "Part A", Amount: models.NewMoney(60.00), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}
	expOvr2 := models.Expense{Timestamp: day, Vendor: "Part B", Amount: models.NewMoney(50.00), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}

	// 1:1 partial where expense ($120) > tx ($75)
	txSmall := models.BankTransaction{Date: day, Description: "Partial Tx", Amount: models.NewMoney(-75.00), FITID: "U-SM", ChartAccountID: &checkingID, CategoryAccountID: &expID, ReviewStatus: "APPROVED"}
	expBig := models.Expense{Timestamp: day, Vendor: "Big Inv", Amount: models.NewMoney(120.00), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}

	// Unlinked with suggestion
	txSug := models.BankTransaction{Date: day, Description: "Unlinked Sug", Amount: models.NewMoney(-33.00), FITID: "U-SUG", ChartAccountID: &checkingID, CategoryAccountID: &expID, ReviewStatus: "APPROVED"}
	expSug := models.Expense{Timestamp: day, Vendor: "Sug Exp", Amount: models.NewMoney(34.00), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}

	for _, rec := range []interface{}{&deposit, &drawTx, &cashExp, &expN1, &txN1a, &txN1b, &txOver, &expOvr1, &expOvr2, &txSmall, &expBig, &txSug, &expSug} {
		gdb.Create(rec)
	}
	gdb.Create(&models.ExpenseBankTransaction{ExpenseID: cashExp.ID, BankTransactionID: txSug.ID, Status: "suggested"})
	gdb.Create(&models.ExpenseBankTransaction{ExpenseID: expN1.ID, BankTransactionID: txN1a.ID, Status: "confirmed"})
	gdb.Create(&models.ExpenseBankTransaction{ExpenseID: expN1.ID, BankTransactionID: txN1b.ID, Status: "confirmed"})
	gdb.Create(&models.ExpenseBankTransaction{ExpenseID: expOvr1.ID, BankTransactionID: txOver.ID, Status: "confirmed"})
	gdb.Create(&models.ExpenseBankTransaction{ExpenseID: expOvr2.ID, BankTransactionID: txOver.ID, Status: "confirmed"})
	gdb.Create(&models.ExpenseBankTransaction{ExpenseID: expBig.ID, BankTransactionID: txSmall.ID, Status: "confirmed"})
	gdb.Create(&models.ExpenseBankTransaction{ExpenseID: expSug.ID, BankTransactionID: txSug.ID, Status: "suggested"})

	UpdateReconciliationStatuses()

	checkTx := func(tx models.BankTransaction, wantStatus string, wantSug bool) {
		var got models.BankTransaction
		gdb.First(&got, tx.ID)
		if got.AllocationStatus != wantStatus || got.HasSuggestions != wantSug {
			t.Errorf("tx %s status/sug = (%s, %v), want (%s, %v)", got.FITID, got.AllocationStatus, got.HasSuggestions, wantStatus, wantSug)
		}
	}
	checkExp := func(exp models.Expense, wantStatus string, wantSug bool) {
		var got models.Expense
		gdb.First(&got, exp.ID)
		if got.AllocationStatus != wantStatus || got.HasSuggestions != wantSug {
			t.Errorf("exp %s status/sug = (%s, %v), want (%s, %v)", got.Vendor, got.AllocationStatus, got.HasSuggestions, wantStatus, wantSug)
		}
	}

	checkTx(deposit, "BALANCED", false)
	checkTx(drawTx, "BALANCED", false)
	checkTx(txN1a, "BALANCED", false)
	checkTx(txN1b, "BALANCED", false)
	checkTx(txOver, "OVER_ALLOCATED", false)
	checkTx(txSmall, "BALANCED", false)
	checkTx(txSug, "UNLINKED", true)

	checkExp(cashExp, "BALANCED", false)
	checkExp(expN1, "BALANCED", false)
	checkExp(expOvr1, "OVER_ALLOCATED", false)
	checkExp(expBig, "PARTIALLY_ALLOCATED", false)
	checkExp(expSug, "UNLINKED", true)

	// Stale suggestion on cash expense must be pruned
	var cashSugCount int64
	gdb.Model(&models.ExpenseBankTransaction{}).Where("expense_id = ? AND status = 'suggested'", cashExp.ID).Count(&cashSugCount)
	if cashSugCount != 0 {
		t.Errorf("expected stale suggestion on cash expense to be pruned, got %d", cashSugCount)
	}
}

func TestRunReconciliation_DirectSplitAndInvoicePaths(t *testing.T) {
	oldDB := db.DB
	db.DB = nil
	RunReconciliation()
	RunInvoiceReconciliation()
	db.DB = oldDB

	gdb := setupUtilsTestDB(t)
	checkingID := getAcctID(t, gdb, "1010")
	expID := getAcctID(t, gdb, "5050")
	revID := getAcctID(t, gdb, "4110")
	day := time.Date(2026, 4, 10, 12, 0, 0, 0, time.UTC)

	// 1. Direct confident match: Starbucks $14.75 -> auto-confirmed + category synced to tx
	txDirect := models.BankTransaction{Date: day, Description: "STARBUCKS STORE 0412", Amount: models.NewMoney(-14.75), FITID: "REC-DIR", ChartAccountID: &checkingID, ReviewStatus: "APPROVED"}
	expDirect := models.Expense{Timestamp: day, Vendor: "Starbucks", Amount: models.NewMoney(14.75), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}

	// 2. Weak suggestion (< 80): amount off by $1.00, no vendor match
	txWeak := models.BankTransaction{Date: day, Description: "UNKNOWN POS 999", Amount: models.NewMoney(-42.00), FITID: "REC-WEAK", ChartAccountID: &checkingID, CategoryAccountID: &expID, ReviewStatus: "APPROVED"}
	expWeak := models.Expense{Timestamp: day.AddDate(0, 0, 2), Vendor: "Alpha Boutique", Amount: models.NewMoney(41.00), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}

	// 3. Tombstone unlinked pair — must never link or suggest
	txTomb := models.BankTransaction{Date: day, Description: "DELTA AIR LINES", Amount: models.NewMoney(-320.00), FITID: "REC-TOMB", ChartAccountID: &checkingID, ReviewStatus: "APPROVED"}
	expTomb := models.Expense{Timestamp: day, Vendor: "Delta Air", Amount: models.NewMoney(320.00), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}

	// 4. Pass 2 split sunset: $75.00 debit matched by same-day $25 + $50 expenses
	txSplit := models.BankTransaction{Date: day.AddDate(0, 0, -5), Description: "OFFICE BUNDLE", Amount: models.NewMoney(-75.00), FITID: "REC-SPL", ChartAccountID: &checkingID, CategoryAccountID: &expID, ReviewStatus: "APPROVED"}
	expSplit1 := models.Expense{Timestamp: day.AddDate(0, 0, -5), Vendor: "Pens", Amount: models.NewMoney(25.00), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}
	expSplit2 := models.Expense{Timestamp: day.AddDate(0, 0, -5), Vendor: "Paper", Amount: models.NewMoney(50.00), Tender: "card", ChartAccountID: &expID, ReviewStatus: "APPROVED"}

	// 5. Pass 4 Invoice reconciliation: exact deposit & net Stripe deposit
	invExact := models.Invoice{InvoiceNumber: "INV-2026-10", ClientName: "Mohawk Valley", IssueDate: day.AddDate(0, 0, -10), DueDate: day.AddDate(0, 0, 20), TotalAmount: models.NewMoney(1200.00), BalanceDue: models.NewMoney(1200.00), Status: "SENT", CategoryAccountID: &revID}
	invFee := models.Invoice{InvoiceNumber: "INV-2026-11", ClientName: "Adirondack Co", IssueDate: day.AddDate(0, 0, -5), DueDate: day.AddDate(0, 0, 25), TotalAmount: models.NewMoney(100.00), BalanceDue: models.NewMoney(100.00), Status: "SENT", CategoryAccountID: &revID}
	depExact := models.BankTransaction{Date: day, Description: "ACH MOHAWK VALLEY INV-2026-10", Amount: models.NewMoney(1200.00), FITID: "REC-INV1", ChartAccountID: &checkingID, ReviewStatus: "APPROVED"}
	// 100 - (2.90 + 0.30) = 96.80
	depFee := models.BankTransaction{Date: day, Description: "STRIPE ADIRONDACK CO", Amount: models.NewMoney(96.80), FITID: "REC-INV2", ChartAccountID: &checkingID, ReviewStatus: "APPROVED"}

	for _, rec := range []interface{}{&txDirect, &expDirect, &txWeak, &expWeak, &txTomb, &expTomb, &txSplit, &expSplit1, &expSplit2, &invExact, &invFee, &depExact, &depFee} {
		gdb.Create(rec)
	}
	gdb.Create(&models.ExpenseBankTransaction{ExpenseID: expTomb.ID, BankTransactionID: txTomb.ID, Status: "unlinked"})

	RunReconciliation()

	var confirmedCount int64
	gdb.Model(&models.ExpenseBankTransaction{}).Where("expense_id = ? AND bank_transaction_id = ? AND status = 'confirmed'", expDirect.ID, txDirect.ID).Count(&confirmedCount)
	if confirmedCount != 1 {
		t.Errorf("expected direct match confirmed link, got count=%d", confirmedCount)
	}

	var refreshedDirect models.BankTransaction
	gdb.First(&refreshedDirect, txDirect.ID)
	if refreshedDirect.CategoryAccountID == nil || *refreshedDirect.CategoryAccountID != expID {
		t.Errorf("expected category %d synced onto txDirect, got %v", expID, refreshedDirect.CategoryAccountID)
	}

	var tombCount int64
	gdb.Model(&models.ExpenseBankTransaction{}).Where("expense_id = ? AND bank_transaction_id = ? AND status != 'unlinked'", expTomb.ID, txTomb.ID).Count(&tombCount)
	if tombCount != 0 {
		t.Errorf("tombstone pair must not be confirmed or suggested")
	}

	var splitSugCount int64
	gdb.Model(&models.ExpenseBankTransaction{}).Where("bank_transaction_id = ? AND status = 'suggested'", txSplit.ID).Count(&splitSugCount)
	if splitSugCount != 2 {
		t.Errorf("expected 2 Pass 2 split suggestions for txSplit, got %d", splitSugCount)
	}

	var gotInv1, gotInv2 models.Invoice
	gdb.First(&gotInv1, invExact.ID)
	gdb.First(&gotInv2, invFee.ID)
	if gotInv1.Status != "PAID" || gotInv1.BankTransactionID == nil || *gotInv1.BankTransactionID != depExact.ID {
		t.Errorf("expected exact invoice auto-paid by depExact, got status=%s tx=%v", gotInv1.Status, gotInv1.BankTransactionID)
	}
	if gotInv2.Status != "PAID" || gotInv2.BankTransactionID == nil || *gotInv2.BankTransactionID != depFee.ID {
		t.Errorf("expected fee invoice auto-paid by depFee, got status=%s tx=%v", gotInv2.Status, gotInv2.BankTransactionID)
	}

	// Verify DB candidate finders work end-to-end too
	scoredExps, expList := FindTransactionMatchCandidates(gdb, txWeak, nil)
	if len(scoredExps) == 0 || len(expList) == 0 {
		t.Errorf("expected FindTransactionMatchCandidates to find open expense candidates")
	}
	scoredTxs, txList := FindExpenseMatchCandidates(gdb, expWeak, nil)
	if len(scoredTxs) == 0 || len(txList) == 0 {
		t.Errorf("expected FindExpenseMatchCandidates to find open tx candidates")
	}

	// Nil DB / ineligible target guards
	if s1, _ := FindTransactionMatchCandidates(nil, txWeak, nil); len(s1) != 0 {
		t.Errorf("expected empty candidates on nil db")
	}
	if s2, _ := FindExpenseMatchCandidates(nil, expWeak, nil); len(s2) != 0 {
		t.Errorf("expected empty candidates on nil db")
	}
}

func TestRulesEngine_AllOperatorsAndPersistence(t *testing.T) {
	if _, err := ApplyAllRulesToExisting(nil); err == nil {
		t.Errorf("expected error for nil db in ApplyAllRulesToExisting")
	}
	if _, _, err := TestRulePreview(models.BankRule{}, nil); err == nil {
		t.Errorf("expected error for nil db in TestRulePreview")
	}
	if r, mod := ApplyBankRulesToTransaction(&models.BankTransaction{}, nil); r != nil || mod {
		t.Errorf("expected nil, false on nil db")
	}

	gdb := setupUtilsTestDB(t)
	checkingID := getAcctID(t, gdb, "1010")
	softID := getAcctID(t, gdb, "5210")

	// Exercise all operators in EvaluateCondition
	txProbe := models.BankTransaction{Description: "Adobe Creative Cloud", Amount: models.NewMoney(-59.99), TransactionType: "DEBIT", ChartAccountID: &checkingID}
	condCases := []struct {
		field, op, val string
		want           bool
	}{
		{"vendor", "starts_with", "adobe", true},
		{"payee", "ends_with", "cloud", true},
		{"description", "equals", "Adobe Creative Cloud", true},
		{"description", "not_equals", "Other", true},
		{"description", "not_contains", "微软", true},
		{"description", "regex", "creative.*cloud", true},
		{"description", "regex", "[invalid", false},
		{"description", "unknown_op", "adobe", true},
		{"amount", "eq", "$59.99", true},
		{"amount", "gt", "50", true},
		{"amount", "gte", "59.99", true},
		{"amount", "lt", "60", true},
		{"amount", "lte", "59.99", true},
		{"amount", "bad_op", "59.99", false},
		{"amount", "eq", "NaN-bad", false},
		{"transaction_type", "equals", "DEBIT", true},
		{"chart_account_id", "equals", fmt.Sprintf("%d", checkingID), true},
		{"chart_account_id", "not_equals", "999999", true},
		{"chart_account_id", "equals", "abc", false},
		{"other_field", "contains", "Adobe", true},
	}
	for _, tc := range condCases {
		got := EvaluateCondition(models.RuleCondition{Field: tc.field, Operator: tc.op, Value: tc.val}, txProbe)
		if got != tc.want {
			t.Errorf("EvaluateCondition(%s, %s, %s) = %v, want %v", tc.field, tc.op, tc.val, got, tc.want)
		}
	}

	// Custom high-priority rules: AND rule + OR auto-exclude rule
	ruleAND := models.BankRule{
		Name:              "Adobe Software Priority",
		Priority:          1,
		Active:            true,
		MatchLogic:        "AND",
		ConditionsJSON:    `[{"field":"description","operator":"contains","value":"ADOBE"},{"field":"amount","operator":"lt","value":"100"}]`,
		CategoryAccountID: &softID,
		RenamedVendor:     "Adobe",
		Notes:             "SaaS License",
		AutoConfirm:       true,
	}
	ruleORExclude := models.BankRule{
		Name:           "Personal Transfer Exclude",
		Priority:       2,
		Active:         true,
		MatchLogic:     "OR",
		ConditionsJSON: `[{"field":"description","operator":"contains","value":"PERSONAL ATM"}]`,
		AutoExclude:    true,
	}
	gdb.Create(&ruleAND)
	gdb.Create(&ruleORExclude)

	txOpen1 := models.BankTransaction{Date: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC), Description: "ADOBE *CREATIVE CLOUD", Amount: models.NewMoney(-59.99), FITID: "RL-1", ChartAccountID: &checkingID, ReviewStatus: "PENDING"}
	txOpen2 := models.BankTransaction{Date: time.Date(2026, 5, 2, 0, 0, 0, 0, time.UTC), Description: "PERSONAL ATM WITHDRAWAL", Amount: models.NewMoney(-80.00), FITID: "RL-2", ChartAccountID: &checkingID, ReviewStatus: "PENDING"}
	gdb.Create(&txOpen1)
	gdb.Create(&txOpen2)

	// Closed date item must be skipped by ApplyAllRulesToExisting
	gdb.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2026-04-30"})
	txClosed := models.BankTransaction{Date: time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC), Description: "ADOBE OLD", Amount: models.NewMoney(-20.00), FITID: "RL-3", ChartAccountID: &checkingID, ReviewStatus: "PENDING"}
	gdb.Create(&txClosed)

	// In-memory ApplyBankRulesToTransaction
	memTx := models.BankTransaction{Description: "ADOBE *ACROBAT", Amount: models.NewMoney(-19.99), ChartAccountID: &checkingID, ReviewStatus: "PENDING"}
	matched, changed := ApplyBankRulesToTransaction(&memTx, gdb)
	if !changed || matched == nil || memTx.Description != "Adobe" || !strings.Contains(memTx.Notes, "Raw: ADOBE *ACROBAT") || memTx.ReviewStatus != "APPROVED" {
		t.Errorf("ApplyBankRulesToTransaction failed: matched=%v changed=%v desc=%q notes=%q review=%q", matched, changed, memTx.Description, memTx.Notes, memTx.ReviewStatus)
	}

	// Preview before ApplyAll
	cnt, samples, err := TestRulePreview(ruleAND, gdb)
	if err != nil || cnt < 2 || len(samples) < 2 {
		t.Errorf("TestRulePreview got cnt=%d samples=%d err=%v", cnt, len(samples), err)
	}

	updated, err := ApplyAllRulesToExisting(gdb)
	if err != nil || updated < 2 {
		t.Fatalf("ApplyAllRulesToExisting got updated=%d err=%v", updated, err)
	}

	var got1, got2, gotClosed models.BankTransaction
	gdb.First(&got1, txOpen1.ID)
	gdb.First(&got2, txOpen2.ID)
	gdb.First(&gotClosed, txClosed.ID)
	if got1.CategoryAccountID == nil || *got1.CategoryAccountID != softID || got1.Description != "Adobe" || got1.ReviewStatus != "APPROVED" {
		t.Errorf("txOpen1 rule apply failed: %+v", got1)
	}
	if got2.ReviewStatus != "IGNORED" || got2.ExclusionReason != "PERSONAL" {
		t.Errorf("txOpen2 exclude rule failed: review=%q reason=%q", got2.ReviewStatus, got2.ExclusionReason)
	}
	if gotClosed.ReviewStatus != "PENDING" {
		t.Errorf("closed tx should not be modified, got review=%q", gotClosed.ReviewStatus)
	}
}

func TestParseOfx_CheckingCreditCardAndErrors(t *testing.T) {
	oldDB := db.DB
	db.DB = nil
	ParseOfx("nonexistent.ofx")
	db.DB = oldDB

	gdb := setupUtilsTestDB(t)
	ParseOfx(filepath.Join(t.TempDir(), "missing.ofx")) // missing file safe return

	badPath := filepath.Join(t.TempDir(), "bad.ofx")
	_ = os.WriteFile(badPath, []byte("not an ofx file"), 0644)
	ParseOfx(badPath) // invalid OFX safe return

	// Valid Checking OFX (OFX 1.0 SGML format supported by ofxgo)
	checkingOFX := `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20260601120000
<LANGUAGE>ENG
<FI><ORG>Chase<FID>10898</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>021000021
<ACCTID>50106954S:05
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260501
<DTEND>20260531
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260510
<TRNAMT>-42.50
<FITID>OFX-CHK-1
<NAME>AMAZON MKTP
<MEMO>OFFICE SUPPLIES
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260515
<TRNAMT>1500.00
<FITID>OFX-CHK-2
<NAME>CLIENT ACH DEPOSIT
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>4200.55
<DTASOF>20260531
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`
	chkPath := filepath.Join(constants.GetInboxPath(), "checking.ofx")
	_ = os.WriteFile(chkPath, []byte(checkingOFX), 0644)
	if err := processFile(chkPath); err != nil {
		t.Fatalf("processFile(.ofx) failed: %v", err)
	}

	var txDebit, txDeposit models.BankTransaction
	if err := gdb.Where("fit_id = ?", "OFX-CHK-1").First(&txDebit).Error; err != nil {
		t.Fatalf("expected OFX debit tx imported: %v", err)
	}
	if txDebit.AllocationStatus != "UNLINKED" {
		t.Errorf("expected debit AllocationStatus UNLINKED, got %s", txDebit.AllocationStatus)
	}
	if err := gdb.Where("amount = ?", models.NewMoney(1500.00)).First(&txDeposit).Error; err != nil {
		t.Fatalf("expected synthetic FITID deposit imported: %v", err)
	}
	if txDeposit.AllocationStatus != "BALANCED" {
		t.Errorf("expected deposit AllocationStatus BALANCED, got %s", txDeposit.AllocationStatus)
	}

	// Credit Card OFX
	ccOFX := `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20260601120000
<LANGUAGE>ENG
<FI><ORG>CapitalOne<FID>1001</FI>
</SONRS>
</SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<TRNUID>1
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<CCSTMTRS>
<CURDEF>USD
<CCACCTFROM>
<ACCTID>5137
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260501
<DTEND>20260531
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260512
<TRNAMT>-19.95
<FITID>OFX-CC-1
<NAME>SHELL OIL
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-512.30
<DTASOF>20260531
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`
	ccPath := filepath.Join(constants.GetInboxPath(), "card.qfx")
	_ = os.WriteFile(ccPath, []byte(ccOFX), 0644)
	ParseOfx(ccPath)

	var ccTx models.BankTransaction
	if err := gdb.Where("fit_id = ?", "OFX-CC-1").First(&ccTx).Error; err != nil {
		t.Fatalf("expected CC OFX tx imported: %v", err)
	}
}

func TestProcessFile_AIExtractionWarningsAndDuplicate(t *testing.T) {
	if err := processFile("bad.txt"); err == nil {
		t.Errorf("expected unsupported ext or nil DB error")
	}

	gdb := setupUtilsTestDB(t)
	if err := processFile(filepath.Join(constants.GetInboxPath(), "note.txt")); err == nil {
		t.Errorf("expected unsupported .txt extension error")
	}

	mealsID := getAcctID(t, gdb, "5090")
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			// Full cash receipt response
			_, _ = w.Write([]byte(fmt.Sprintf("```json\n{\"vendor\":\"Local Bakery\",\"description\":\"Team snacks\",\"amount\":24.50,\"taxAmount\":1.80,\"timestamp\":\"2026-05-10\",\"tender\":\"cash\",\"chartAccountId\":%d}\n```", mealsID)))
			return
		}
		// Missing amount & missing date -> triggers warning flags + PENDING review
		_, _ = w.Write([]byte(`{"vendor":"Blurry Receipt","description":"Scan","amount":0,"timestamp":"","tender":"VISA","chartAccountId":999999}`))
	}))
	defer srv.Close()
	t.Setenv("FILE_PROCESSOR_URL", srv.URL)

	// 1. Valid cash receipt PNG
	pngPath1 := filepath.Join(constants.GetInboxPath(), "r1.png")
	_ = os.WriteFile(pngPath1, []byte("\x89PNG\r\n\x1a\nfirst-receipt-bytes"), 0644)
	if err := processFile(pngPath1); err != nil {
		t.Fatalf("processFile cash receipt failed: %v", err)
	}
	time.Sleep(25 * time.Millisecond)

	var cashExp models.Expense
	if err := gdb.Where("vendor = ?", "Local Bakery").First(&cashExp).Error; err != nil {
		t.Fatalf("expected Local Bakery expense created: %v", err)
	}
	if cashExp.AllocationStatus != "BALANCED" || cashExp.Tender != "cash" || cashExp.Amount.Cents != 2450 || cashExp.ChartAccountID == nil || *cashExp.ChartAccountID != mealsID {
		t.Errorf("unexpected cash expense fields: %+v", cashExp)
	}

	// 2. Duplicate hash upload -> rejected cleanly without creating 2nd expense
	dupPath := filepath.Join(constants.GetInboxPath(), "r1_dup.png")
	_ = os.WriteFile(dupPath, []byte("\x89PNG\r\n\x1a\nfirst-receipt-bytes"), 0644)
	if err := processFile(dupPath); err != nil {
		t.Fatalf("duplicate processFile returned unexpected error: %v", err)
	}
	var count int64
	gdb.Model(&models.Expense{}).Where("vendor = ?", "Local Bakery").Count(&count)
	if count != 1 {
		t.Errorf("expected duplicate file upload not to create 2nd expense, got count=%d", count)
	}

	// 3. Blurry receipt (0 amount + empty timestamp -> PENDING + warning tags)
	pngPath2 := filepath.Join(constants.GetInboxPath(), "r2.png")
	_ = os.WriteFile(pngPath2, []byte("\x89PNG\r\n\x1a\nsecond-receipt-bytes"), 0644)
	if err := processFile(pngPath2); err != nil {
		t.Fatalf("processFile blurry receipt failed: %v", err)
	}
	time.Sleep(25 * time.Millisecond)
	var blurry models.Expense
	if err := gdb.Where("vendor = ?", "Blurry Receipt").First(&blurry).Error; err != nil {
		t.Fatalf("expected Blurry Receipt expense created: %v", err)
	}
	if blurry.ReviewStatus != "PENDING" || !strings.Contains(blurry.Description, "[MISSING AMOUNT") || !strings.Contains(blurry.Description, "[MISSING DATE") {
		t.Errorf("expected PENDING + missing warnings, got status=%q desc=%q", blurry.ReviewStatus, blurry.Description)
	}
}

func TestDemoSeeder_SeedResetAndRemove(t *testing.T) {
	gdb := setupUtilsTestDB(t)
	checkingID := getAcctID(t, gdb, "1010")
	expID := getAcctID(t, gdb, "5050")

	// Pre-existing user records that RemoveDemoDataset must preserve
	userTx := models.BankTransaction{Date: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), Description: "REAL USER TX", Amount: models.NewMoney(-12.34), FITID: "USER-KEEP-1", ChartAccountID: &checkingID, ReviewStatus: "APPROVED"}
	userExp := models.Expense{Timestamp: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), Vendor: "Real Vendor", Amount: models.NewMoney(12.34), Tender: "card", ChartAccountID: &expID, Notes: "Keep me", ReviewStatus: "APPROVED"}
	gdb.Create(&userTx)
	gdb.Create(&userExp)

	status, err := SeedDemoDataset()
	if err != nil {
		t.Fatalf("SeedDemoDataset failed: %v", err)
	}
	if !status.Active || status.Counts.Transactions == 0 || status.Counts.Expenses == 0 || status.Counts.Invoices == 0 || status.Counts.Receipts == 0 || status.Counts.Statements == 0 {
		t.Errorf("expected populated demo counts, got %+v", status)
	}

	// Reset must remain clean and active
	resetStatus, err := ResetDemoDataset()
	if err != nil || !resetStatus.Active {
		t.Fatalf("ResetDemoDataset failed: status=%+v err=%v", resetStatus, err)
	}

	// Remove must clear all demo records and preserve user data
	cleared, err := RemoveDemoDataset()
	if err != nil {
		t.Fatalf("RemoveDemoDataset failed: %v", err)
	}
	if cleared.Active {
		t.Errorf("expected Active == false after removal, got %+v", cleared)
	}

	var keepTx, keepExp int64
	gdb.Model(&models.BankTransaction{}).Where("fit_id = ?", "USER-KEEP-1").Count(&keepTx)
	gdb.Model(&models.Expense{}).Where("vendor = ?", "Real Vendor").Count(&keepExp)
	if keepTx != 1 || keepExp != 1 {
		t.Errorf("expected real user data preserved (tx=%d exp=%d)", keepTx, keepExp)
	}
}
