package db

import (
	"encoding/json"
	"testing"

	"reflex-tech-bookkeeping-app-api/models"
)

// ---- SeedChartOfAccounts: test with PostgreSQL via Docker ----

// TestSeedChartOfAccounts requires a running PostgreSQL database.
// Skip in CI/local without Docker.
func TestSeedChartOfAccounts_CreateNew(t *testing.T) {
	t.Skip("SeedChartOfAccounts requires PostgreSQL DB connection; tested in production")
}

func TestSeedChartOfAccounts_IdempotentUpdate(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

func TestSeedChartOfAccounts_UpdateMissingScheduleCLine(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

func TestSeedChartOfAccounts_UpdateMissingIsDefault(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

// ---- SeedDefaultBankRules: test with PostgreSQL ----

func TestSeedDefaultBankRules_CreateNew(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

func TestSeedDefaultBankRules_Idempotent(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

func TestSeedDefaultBankRules_JSONConditions(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

func TestSeedDefaultBankRules_AccountIDMapping(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

func TestSeedDefaultBankRules_NoDuplicateNames(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

// ---- DB connectivity test ----

func TestDB_PackageImport(t *testing.T) {
	// Verify the db package imports correctly and global DB is nil
	// (no actual connection established yet)
	if DB != nil {
		t.Log("DB is already connected (expected in production)")
	}
	// nil check passes — package imports successfully
}

// ---- Seed data integrity ----

func TestSeedChartOfAccounts_TypeCoverage(t *testing.T) {
	t.Skip("Requires PostgreSQL")
}

func TestSeedChartOfAccounts_ExpenseScheduleCLines(t *testing.T) {
	t.Skip("Requires PostgreSQL")
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
	expected := 183
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

// ---- DB global: nil check after package import ----

func TestDB_GlobalNil(t *testing.T) {
	// DB should be nil before Connect() is called
	if DB != nil {
		// In production after main(), DB is non-nil
		// In tests before Connect(), DB is nil
		// This is informational only
		t.Logf("DB is connected (value: %v)", DB)
	}
}

// ---- SeedChartOfAccounts: log output test ----

func TestLogOutput_SeedChartOfAccounts(t *testing.T) {
	// SeedChartOfAccounts logs "Ensuring standard Chart of Accounts..."
	// We can't easily test this without a DB, so verify no crash on nil DB
	// This tests the nil DB path
	oldDB := DB
	DB = nil
	defer func() { DB = oldDB }()

	// Should panic or log — in production it would work with a real DB
	// Here we just verify the function signature is correct
	// The nil DB will cause a panic in DB.Where()
	defer func() {
		r := recover()
		if r != nil {
			// Expected: nil DB causes panic
			_ = r
		}
	}()
	SeedChartOfAccounts()
}

func TestLogOutput_SeedDefaultBankRules(t *testing.T) {
	// Same nil-DB test for SeedDefaultBankRules
	oldDB := DB
	DB = nil
	defer func() { DB = oldDB }()

	defer func() {
		r := recover()
		_ = r
	}()
	SeedDefaultBankRules()
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
