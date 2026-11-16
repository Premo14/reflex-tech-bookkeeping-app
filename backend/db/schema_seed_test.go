package db

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	return gdb
}

// ---- Nil DB safety ----

func TestDB_NilGuards(t *testing.T) {
	oldDB := DB
	DB = nil
	defer func() { DB = oldDB }()

	InitSchemaAndSeed(nil)
	SeedChartOfAccounts()
	SeedDefaultBankRules()
}

// ---- Fresh schema migration + idempotent seeding ----

func TestInitSchemaAndSeed_FreshAndIdempotent(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	gdb := openTestDB(t)
	InitSchemaAndSeed(gdb)

	var accounts []models.ChartAccount
	if err := gdb.Find(&accounts).Error; err != nil {
		t.Fatalf("failed to query chart_accounts: %v", err)
	}
	if len(accounts) != len(defaultAccounts) {
		t.Fatalf("seeded %d chart accounts, want %d", len(accounts), len(defaultAccounts))
	}

	var rules []models.BankRule
	if err := gdb.Find(&rules).Error; err != nil {
		t.Fatalf("failed to query bank_rules: %v", err)
	}
	if len(rules) != len(defaultBankRules) {
		t.Fatalf("seeded %d bank rules, want %d", len(rules), len(defaultBankRules))
	}
	for _, r := range rules {
		if r.CategoryAccountID == nil || *r.CategoryAccountID == 0 {
			t.Errorf("rule %q missing mapped CategoryAccountID", r.Name)
		}
		var conds []models.RuleCondition
		if err := json.Unmarshal([]byte(r.ConditionsJSON), &conds); err != nil || len(conds) == 0 {
			t.Errorf("rule %q has invalid conditions JSON: %v", r.Name, err)
		}
	}

	// Second run must remain strictly idempotent
	InitSchemaAndSeed(gdb)
	var afterAccounts, afterRules int64
	gdb.Model(&models.ChartAccount{}).Count(&afterAccounts)
	gdb.Model(&models.BankRule{}).Count(&afterRules)
	if int(afterAccounts) != len(defaultAccounts) {
		t.Errorf("idempotent re-seed accounts = %d, want %d", afterAccounts, len(defaultAccounts))
	}
	if int(afterRules) != len(defaultBankRules) {
		t.Errorf("idempotent re-seed rules = %d, want %d", afterRules, len(defaultBankRules))
	}
}

func TestSeedChartOfAccounts_UpdatesMissingMetadata(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	gdb := openTestDB(t)
	gdb.AutoMigrate(&models.ChartAccount{})
	gdb.Create(&models.ChartAccount{
		Code:          "5050",
		Name:          "Office Supplies",
		Type:          "EXPENSE",
		ScheduleCLine: "",
		IsDefault:     false,
		Active:        true,
	})
	DB = gdb

	SeedChartOfAccounts()

	var updated models.ChartAccount
	if err := gdb.Where("code = ?", "5050").First(&updated).Error; err != nil {
		t.Fatalf("failed to load updated account: %v", err)
	}
	if updated.ScheduleCLine == "" {
		t.Errorf("expected empty ScheduleCLine on 5050 to be backfilled")
	}
	if !updated.IsDefault {
		t.Errorf("expected IsDefault on 5050 to be updated to true")
	}
}

func TestInitSchemaAndSeed_LegacyMigrationsAndClosedDates(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	gdb := openTestDB(t)
	gdb.SetupJoinTable(&models.Expense{}, "BankTransactions", &models.ExpenseBankTransaction{})
	gdb.SetupJoinTable(&models.BankTransaction{}, "Expenses", &models.ExpenseBankTransaction{})
	gdb.AutoMigrate(
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

	// Seed legacy account codes & redundant 2040/5137 account
	bankAcc := models.ChartAccount{Code: "1010", Name: "Business Checking", Type: "ASSET", Description: "Business checking account", Active: true}
	cc2020 := models.ChartAccount{Code: "2020", Name: "Business Credit Card", Type: "LIABILITY", Description: "5137", Active: true}
	cc2040 := models.ChartAccount{Code: "2040", Name: "Old CC", Type: "LIABILITY", Description: "5137", Active: true}
	expAcc := models.ChartAccount{Code: "5060", Name: "Travel & Meals", Type: "EXPENSE", Active: true}
	gdb.Create(&bankAcc)
	gdb.Create(&cc2020)
	gdb.Create(&cc2040)
	gdb.Create(&expAcc)
	// Legacy renumbered codes (only those that don't clash with SeedChartOfAccounts codes or get migrated cleanly)
	gdb.Create(&models.ChartAccount{Code: "2035", Name: "Business Line of Credit", Type: "LIABILITY", Active: true})
	gdb.Create(&models.ChartAccount{Code: "3030", Name: "Owner Draw", Type: "EQUITY", Active: true})
	gdb.Create(&models.ChartAccount{Code: "4020", Name: "Consulting Service Fee", Type: "REVENUE", Active: true})
	gdb.Create(&models.ChartAccount{Code: "4030", Name: "Bank Interest Income", Type: "REVENUE", Active: true})

	// BooksClosedDate at 2025-12-31
	gdb.Create(&models.AppSetting{Key: "BooksClosedDate", Value: "2025-12-31"})

	// Bank statement referencing 2040 so 2040->2020 merge & ofx_account_id backfill both trigger
	stmt := models.BankStatement{AccountID: "5137", BankID: "Chase", DocumentURI: "processed/s.ofx", FileExt: ".ofx", ChartAccountID: &cc2040.ID}
	gdb.Create(&stmt)

	// Transactions: legacy expense-as-bank account, closed vs open PENDING, legacy allocation statuses
	closedDate := time.Date(2025, 12, 15, 0, 0, 0, 0, time.UTC)
	openDate := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	tx1 := models.BankTransaction{Date: closedDate, Description: "Closed Pending", Amount: models.NewMoney(-10), FITID: "M-1", ChartAccountID: &expAcc.ID, ReviewStatus: "PENDING", AllocationStatus: "MATCHED"}
	tx2 := models.BankTransaction{Date: openDate, Description: "Open Pending", Amount: models.NewMoney(-20), FITID: "M-2", ChartAccountID: &cc2040.ID, ReviewStatus: "PENDING", AllocationStatus: "PARTIALLY_LINKED"}
	tx3 := models.BankTransaction{Date: openDate, Description: "Unmatched", Amount: models.NewMoney(-30), FITID: "M-3", ChartAccountID: &bankAcc.ID, AllocationStatus: "UNMATCHED"}
	gdb.Create(&tx1)
	gdb.Create(&tx2)
	gdb.Create(&tx3)

	// Expenses: uppercase tender, invalid asset chart_account_id, open PENDING
	exp1 := models.Expense{Timestamp: openDate, Vendor: "Coffee", Amount: models.NewMoney(5), Tender: " CASH ", ChartAccountID: &bankAcc.ID, ReviewStatus: "PENDING", AllocationStatus: "UNLINKED"}
	exp2 := models.Expense{Timestamp: closedDate, Vendor: "Old", Amount: models.NewMoney(12), Tender: "card", ChartAccountID: &cc2040.ID, ReviewStatus: "PENDING", AllocationStatus: "PARTIAL MATCH"}
	gdb.Create(&exp1)
	gdb.Create(&exp2)

	InitSchemaAndSeed(gdb)

	var gotTx1, gotTx2, gotTx3 models.BankTransaction
	gdb.First(&gotTx1, tx1.ID)
	gdb.First(&gotTx2, tx2.ID)
	gdb.First(&gotTx3, tx3.ID)
	if gotTx1.CategoryAccountID == nil || *gotTx1.CategoryAccountID != expAcc.ID || gotTx1.ChartAccountID != nil {
		t.Errorf("tx1 legacy category migration failed: chart=%v cat=%v", gotTx1.ChartAccountID, gotTx1.CategoryAccountID)
	}
	if gotTx1.ReviewStatus != "PENDING" || gotTx1.AllocationStatus != "BALANCED" {
		t.Errorf("tx1 closed/status = (%s, %s), want (PENDING, BALANCED)", gotTx1.ReviewStatus, gotTx1.AllocationStatus)
	}
	if gotTx2.ReviewStatus != "APPROVED" || gotTx2.AllocationStatus != "PARTIALLY_ALLOCATED" {
		t.Errorf("tx2 open/status = (%s, %s), want (APPROVED, PARTIALLY_ALLOCATED)", gotTx2.ReviewStatus, gotTx2.AllocationStatus)
	}
	if gotTx2.ChartAccountID == nil || *gotTx2.ChartAccountID != cc2020.ID {
		t.Errorf("tx2 should be reassigned from 2040 to 2020 (%d), got %v", cc2020.ID, gotTx2.ChartAccountID)
	}
	if gotTx3.AllocationStatus != "UNLINKED" {
		t.Errorf("tx3 status = %s, want UNLINKED", gotTx3.AllocationStatus)
	}

	var gotExp1, gotExp2 models.Expense
	gdb.First(&gotExp1, exp1.ID)
	gdb.First(&gotExp2, exp2.ID)
	if gotExp1.Tender != "cash" || gotExp1.AllocationStatus != "BALANCED" || gotExp1.ReviewStatus != "APPROVED" || gotExp1.ChartAccountID != nil {
		t.Errorf("exp1 normalization failed: tender=%q alloc=%q review=%q acct=%v", gotExp1.Tender, gotExp1.AllocationStatus, gotExp1.ReviewStatus, gotExp1.ChartAccountID)
	}
	if gotExp2.ReviewStatus != "PENDING" || gotExp2.AllocationStatus != "PARTIALLY_ALLOCATED" {
		t.Errorf("exp2 migration failed: review=%q alloc=%q", gotExp2.ReviewStatus, gotExp2.AllocationStatus)
	}

	var migrated2020, migratedLOC, migratedDraw, migratedSvc, migratedInt models.ChartAccount
	gdb.First(&migrated2020, cc2020.ID)
	if migrated2020.OfxAccountID == nil || *migrated2020.OfxAccountID != "5137" || migrated2020.Description != "OFX ID: 5137" {
		t.Errorf("2020 OFX backfill failed: ofx=%v desc=%q", migrated2020.OfxAccountID, migrated2020.Description)
	}
	for code, target := range map[string]*models.ChartAccount{
		"2030": &migratedLOC, "3110": &migratedDraw, "4110": &migratedSvc, "4210": &migratedInt,
	} {
		if err := gdb.Where("code = ?", code).First(target).Error; err != nil {
			t.Errorf("expected migrated code %s to exist: %v", code, err)
		}
	}
}

func TestSeedChartOfAccounts_UniqueCodes(t *testing.T) {
	// Verify all defaultAccounts codes are unique (data-level check)
	codeCount := make(map[string]int)
	for _, entry := range defaultAccounts {
		codeCount[entry.Code]++
	}
	for code, count := range codeCount {
		if count > 1 {
			t.Errorf("Duplicate COA code %q (%d times in data)", code, count)
		}
	}
}

// ---- SeedDefaultBankRules: data integrity ----

func TestSeedDefaultBankRules_KeywordValidation(t *testing.T) {
	for i, entry := range defaultBankRules {
		if len(entry.Keywords) == 0 {
			t.Errorf("Rule %d (%s) has no keywords", i, entry.Name)
		}
		if entry.RenamedVendor == "" {
			t.Errorf("Rule %d (%s) has empty RenamedVendor", i, entry.Name)
		}
	}
}

func TestSeedDefaultBankRules_ValidAccountCodes(t *testing.T) {
	accountCodes := make(map[string]bool)
	for _, entry := range defaultAccounts {
		accountCodes[entry.Code] = true
	}

	for _, rule := range defaultBankRules {
		if !accountCodes[rule.AccountCode] {
			t.Errorf("Rule %q references non-existent account code %s", rule.Name, rule.AccountCode)
		}
	}
}

// ---- Seed data counts ----

func TestDefaultAccounts_Count(t *testing.T) {
	if len(defaultAccounts) == 0 {
		t.Fatal("defaultAccounts is empty")
	}
	expected := 41
	if len(defaultAccounts) != expected {
		t.Errorf("defaultAccounts count = %d, want %d", len(defaultAccounts), expected)
	}
}

func TestDefaultBankRules_Count(t *testing.T) {
	if len(defaultBankRules) == 0 {
		t.Fatal("defaultBankRules is empty")
	}
	expected := 233
	if len(defaultBankRules) != expected {
		t.Errorf("defaultBankRules count = %d, want %d", len(defaultBankRules), expected)
	}
}

// ---- Seed data categories ----

func TestDefaultBankRules_Categories(t *testing.T) {
	for _, entry := range defaultBankRules {
		found := false
		for _, acct := range defaultAccounts {
			if acct.Code == entry.AccountCode {
				found = true
				if acct.Type != "EXPENSE" {
					t.Errorf("Rule %q maps to non-expense account %s (%s)", entry.Name, entry.AccountCode, acct.Type)
				}
			}
		}
		if !found {
			t.Errorf("Rule %q references non-existent account code %s", entry.Name, entry.AccountCode)
		}
	}
}

// ---- DB global check ----

func TestDB_GlobalInit(t *testing.T) {
	if DB != nil {
		t.Logf("DB is connected (value: %v)", DB)
	}
}

// ---- seedEntry struct verification ----

func TestSeedEntry_Struct(t *testing.T) {
	entry := seedEntry{
		Code:          "1010",
		Name:          "Checking",
		Type:          "ASSET",
		Description:   "Primary checking",
		ScheduleCLine: "",
	}
	if entry.Code != "1010" {
		t.Errorf("Code = %q", entry.Code)
	}
	if entry.Type != "ASSET" {
		t.Errorf("Type = %q", entry.Type)
	}
}

// ---- defaultBankRuleEntry struct verification ----

func TestDefaultBankRuleEntry_Struct(t *testing.T) {
	entry := defaultBankRuleEntry{
		Name:          "Test",
		RenamedVendor: "Test Vendor",
		AccountCode:   "5050",
		Keywords:      []string{"test"},
	}
	if entry.Name != "Test" {
		t.Errorf("Name = %q", entry.Name)
	}
	if len(entry.Keywords) != 1 {
		t.Errorf("Keywords len = %d", len(entry.Keywords))
	}
}

// ---- seedEntry: all fields populated ----

func TestSeedEntry_AllFields(t *testing.T) {
	for _, entry := range defaultAccounts {
		if entry.Code == "" {
			t.Errorf("Empty code for %s", entry.Name)
		}
		if entry.Name == "" {
			t.Errorf("Empty name for code %s", entry.Code)
		}
		if entry.Type == "" {
			t.Errorf("Empty type for %s", entry.Code)
		}
		if entry.Description == "" {
			t.Errorf("Empty description for %s", entry.Code)
		}
	}
}

// ---- JSON condition construction for bank rules ----

func TestBankRules_JSONConstruction(t *testing.T) {
	// Verify conditions JSON can be constructed for all rules
	for idx, entry := range defaultBankRules {
		var conditions []models.RuleCondition
		for _, kw := range entry.Keywords {
			conditions = append(conditions, models.RuleCondition{
				Field:    "description",
				Operator: "contains",
				Value:    kw,
			})
		}
		condsJSON, err := json.Marshal(conditions)
		if err != nil {
			t.Errorf("Rule %d (%s): failed to marshal conditions: %v", idx, entry.Name, err)
			continue
		}
		// Verify it can be unmarshaled back
		var decoded []models.RuleCondition
		if err := json.Unmarshal(condsJSON, &decoded); err != nil {
			t.Errorf("Rule %d (%s): failed to unmarshal: %v", idx, entry.Name, err)
		}
		if len(decoded) != len(entry.Keywords) {
			t.Errorf("Rule %d (%s): decoded %d conditions, want %d", idx, entry.Name, len(decoded), len(entry.Keywords))
		}
	}
}

// ---- defaultAccounts: all types accounted for ----

func TestDefaultAccounts_Types(t *testing.T) {
	types := make(map[string]int)
	for _, entry := range defaultAccounts {
		types[entry.Type]++
	}
	expectedTypes := map[string]int{"ASSET": 6, "LIABILITY": 5, "EQUITY": 3, "REVENUE": 4, "EXPENSE": 23}
	for wantType, wantCount := range expectedTypes {
		if got := types[wantType]; got != wantCount {
			t.Errorf("Type %s count = %d, want %d", wantType, got, wantCount)
		}
	}
}

// ---- defaultAccounts: all have ScheduleCLine ----

func TestDefaultAccounts_ScheduleCLines(t *testing.T) {
	revenueAndExpense := 0
	for _, entry := range defaultAccounts {
		if entry.Type == "REVENUE" || entry.Type == "EXPENSE" {
			revenueAndExpense++
			if entry.ScheduleCLine == "" {
				t.Errorf("Account %s (%s) missing ScheduleCLine", entry.Code, entry.Name)
			}
		}
	}
	if revenueAndExpense != 27 {
		t.Errorf("Expected 27 REVENUE+EXPENSE accounts, got %d", revenueAndExpense)
	}
}

// ---- defaultAccounts: valid COA code format ----

func TestDefaultAccounts_CodeFormat(t *testing.T) {
	for _, entry := range defaultAccounts {
		if len(entry.Code) != 4 {
			t.Errorf("Code %q for %s is not 4 digits", entry.Code, entry.Name)
		}
		for _, c := range entry.Code {
			if c < '0' || c > '9' {
				t.Errorf("Code %q contains non-digit for %s", entry.Code, entry.Name)
			}
		}
	}
}

// ---- defaultBankRules: all rules have unique names ----

func TestDefaultBankRules_UniqueNames(t *testing.T) {
	nameCount := make(map[string]int)
	for _, entry := range defaultBankRules {
		nameCount[entry.Name]++
	}
	for name, count := range nameCount {
		if count > 1 {
			t.Errorf("Duplicate bank rule name %q (%d times)", name, count)
		}
	}
}

// ---- defaultBankRules: all keywords are non-empty ----

func TestDefaultBankRules_NoEmptyKeywords(t *testing.T) {
	for i, entry := range defaultBankRules {
		for j, kw := range entry.Keywords {
			if kw == "" {
				t.Errorf("Rule %d (%s) has empty keyword at index %d", i, entry.Name, j)
			}
		}
	}
}

// ---- seedEntry: verify all 41 accounts ----

func TestDefaultAccounts_AllPresent(t *testing.T) {
	expectedCodes := []string{
		"1010", "1020", "1030", "1100", "1200", "1300",
		"2010", "2020", "2030", "2100", "2510",
		"3010", "3020", "3110",
		"4010", "4090", "4110", "4210",
		"5000", "5010", "5015", "5020", "5025", "5030", "5040", "5050", "5060", "5070", "5080", "5090",
		"5110", "5120", "5210", "5310", "5410", "5510", "5610", "5710", "5720", "5810", "5910",
	}
	codeMap := make(map[string]bool)
	for _, entry := range defaultAccounts {
		codeMap[entry.Code] = true
	}
	for _, wantCode := range expectedCodes {
		if !codeMap[wantCode] {
			t.Errorf("Missing expected COA code %s", wantCode)
		}
	}
}

// ---- defaultBankRules: asset/liability/equity accounts have no ScheduleC mapping ----

func TestDefaultAccounts_NonTaxAccountsNoScheduleC(t *testing.T) {
	for _, entry := range defaultAccounts {
		if entry.Type == "ASSET" || entry.Type == "LIABILITY" || entry.Type == "EQUITY" {
			if entry.ScheduleCLine != "" {
				t.Errorf("Account %s (%s) is %s but has ScheduleCLine: %s",
					entry.Code, entry.Name, entry.Type, entry.ScheduleCLine)
			}
		}
	}
}

// ---- defaultBankRules: account codes span valid ranges ----

func TestDefaultBankRules_AccountCodeRanges(t *testing.T) {
	// Bank rules should only reference expense accounts (5xxx)
	expenseCodes := make(map[string]bool)
	for _, entry := range defaultAccounts {
		if entry.Type == "EXPENSE" {
			expenseCodes[entry.Code] = true
		}
	}
	for _, rule := range defaultBankRules {
		if !expenseCodes[rule.AccountCode] {
			t.Errorf("Rule %q references non-expense account code %s", rule.Name, rule.AccountCode)
		}
	}
}

func TestConnect_DefaultAndCustomEnv(t *testing.T) {
	origOpen := openGormDB
	origFatal := fatalConnect
	defer func() {
		openGormDB = origOpen
		fatalConnect = origFatal
	}()

	var capturedDSN string
	openGormDB = func(dsn string) (*gorm.DB, error) {
		capturedDSN = dsn
		return gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	}

	// 1. Default env vars
	t.Setenv("POSTGRES_HOST", "")
	t.Setenv("POSTGRES_USER", "")
	t.Setenv("POSTGRES_PASSWORD", "")
	t.Setenv("POSTGRES_DB", "")
	t.Setenv("POSTGRES_PORT", "")

	Connect()
	wantDefault := "host=postgres user=user password=pass dbname=reflex-tech-bookkeeping-app-postgres-db port=5432 sslmode=disable TimeZone=UTC"
	if capturedDSN != wantDefault {
		t.Errorf("default DSN = %q, want %q", capturedDSN, wantDefault)
	}

	// 2. Custom env vars
	t.Setenv("POSTGRES_HOST", "db.local")
	t.Setenv("POSTGRES_USER", "admin")
	t.Setenv("POSTGRES_PASSWORD", "secret")
	t.Setenv("POSTGRES_DB", "books")
	t.Setenv("POSTGRES_PORT", "5433")

	Connect()
	wantCustom := "host=db.local user=admin password=secret dbname=books port=5433 sslmode=disable TimeZone=UTC"
	if capturedDSN != wantCustom {
		t.Errorf("custom DSN = %q, want %q", capturedDSN, wantCustom)
	}

	// 3. Error branch triggers fatalConnect
	fatalCalled := false
	fatalConnect = func(v ...interface{}) {
		fatalCalled = true
	}
	openGormDB = func(dsn string) (*gorm.DB, error) {
		return nil, fmt.Errorf("connection refused")
	}
	Connect()
	if !fatalCalled {
		t.Error("expected fatalConnect to be called when openGormDB fails")
	}
}

func TestInitSchemaAndSeed_NoClosedDateAndNilDB(t *testing.T) {
	// Nil DB early return
	InitSchemaAndSeed(nil)
	DB = nil
	SeedChartOfAccounts()
	SeedDefaultBankRules()

	// Fresh DB without BooksClosedDate (hits else branch approving all PENDING items)
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	InitSchemaAndSeed(gdb)
}

func TestSeedDefaultBankRules_PreservesUserCustomizations(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	gdb := openTestDB(t)
	InitSchemaAndSeed(gdb)

	var amazon models.BankRule
	if err := gdb.Where("name = ?", "Amazon").First(&amazon).Error; err != nil {
		t.Fatalf("failed to find seeded Amazon rule: %v", err)
	}
	if err := gdb.Model(&amazon).Updates(map[string]interface{}{
		"priority":       999,
		"renamed_vendor": "Custom Amazon Co",
		"active":         false,
	}).Error; err != nil {
		t.Fatalf("failed to customize Amazon rule: %v", err)
	}

	// Re-running SeedDefaultBankRules must NOT clobber user edits.
	SeedDefaultBankRules()

	var reloaded models.BankRule
	if err := gdb.First(&reloaded, amazon.ID).Error; err != nil {
		t.Fatalf("failed to reload Amazon rule: %v", err)
	}
	if reloaded.Priority != 999 || reloaded.RenamedVendor != "Custom Amazon Co" || reloaded.Active {
		t.Fatalf("SeedDefaultBankRules overwrote user customization: %+v", reloaded)
	}
}

func TestInitSchemaAndSeed_PreservesOpenMissingDataReceiptsAndCleanAccountDesc(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	gdb := openTestDB(t)
	gdb.AutoMigrate(
		&models.ChartAccount{}, &models.AppSetting{}, &models.BankStatement{},
		&models.BankTransaction{}, &models.Invoice{}, &models.Expense{},
		&models.Receipt{}, &models.ExpenseBankTransaction{},
		&models.PeriodAuditLog{}, &models.ItemAuditLog{}, &models.BankRule{},
	)
	DB = gdb
	SeedChartOfAccounts()

	openDate := time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC)
	missingExp := models.Expense{
		Timestamp:        openDate,
		Vendor:           "Receipt 1",
		Description:      "[MISSING AMOUNT - AI could not read receipt total]",
		Tender:           "cash / paper",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "PENDING",
	}
	fallbackExp := models.Expense{
		Timestamp:        openDate,
		Vendor:           "Receipt 2",
		Description:      "Receipt uploaded; AI extraction unavailable. Please enter details manually.",
		Tender:           "card",
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "PENDING",
	}
	gdb.Create(&missingExp)
	gdb.Create(&fallbackExp)

	InitSchemaAndSeed(gdb)

	var gotMissing, gotFallback models.Expense
	gdb.First(&gotMissing, missingExp.ID)
	gdb.First(&gotFallback, fallbackExp.ID)
	if gotMissing.ReviewStatus != "PENDING" || gotMissing.AllocationStatus != "UNLINKED" {
		t.Errorf("expected missing-amount cash receipt to stay (PENDING, UNLINKED), got (%s, %s)", gotMissing.ReviewStatus, gotMissing.AllocationStatus)
	}
	if gotFallback.ReviewStatus != "PENDING" {
		t.Errorf("expected AI-unavailable fallback receipt to stay PENDING, got %s", gotFallback.ReviewStatus)
	}

	var checking models.ChartAccount
	gdb.Where("code = ?", "1010").First(&checking)
	if checking.Description == "OFX ID: 50106954S:05" {
		t.Errorf("fresh 1010 checking description polluted with hardcoded personal OFX ID")
	}
}

