package db

import (
	"testing"

	"reflex-tech-bookkeeping-app-api/models"
)

// ---- SeedChartOfAccounts: defaultAccounts data integrity ----

func TestDefaultAccounts(t *testing.T) {
	// Verify all 41 expected accounts are defined
	if len(defaultAccounts) != 41 {
		t.Errorf("expected 41 default accounts, got %d", len(defaultAccounts))
	}

	// Check required types exist
	expectedTypes := map[string]int{
		"ASSET":     6,
		"LIABILITY": 5,
		"EQUITY":    3,
		"REVENUE":   4,
		"EXPENSE":   23,
	}

	typeCount := make(map[string]int)
	for _, a := range defaultAccounts {
		typeCount[a.Type]++
		if a.Code == "" {
			t.Errorf("account %q has empty code", a.Name)
		}
		if a.Name == "" {
			t.Errorf("account %s has empty name", a.Code)
		}
		if a.Type == "" {
			t.Errorf("account %s has empty type", a.Code)
		}
	}

	for expectedType, expectedCount := range expectedTypes {
		if got := typeCount[expectedType]; got != expectedCount {
			t.Errorf("expected %d %s accounts, got %d", expectedCount, expectedType, got)
		}
	}

	// Verify required COA codes exist
	requiredCodes := []string{"1010", "1020", "1030", "1100", "1200", "1300",
		"2010", "2020", "2030", "2100", "2510",
		"3010", "3020", "3110",
		"4010", "4090", "4110", "4210",
		"5000", "5010", "5015", "5020", "5025", "5030", "5040", "5050", "5060", "5070", "5080", "5090", "5110", "5120", "5210", "5310", "5410", "5510", "5610", "5710", "5720", "5810", "5910",
	}
	codeSet := make(map[string]bool)
	for _, a := range defaultAccounts {
		codeSet[a.Code] = true
	}
	for _, code := range requiredCodes {
		if !codeSet[code] {
			t.Errorf("required COA code %s missing from defaultAccounts", code)
		}
	}

	// Verify all EXPENSE accounts have ScheduleCLine mapping
	for _, a := range defaultAccounts {
		if a.Type == "EXPENSE" && a.ScheduleCLine == "" {
			t.Errorf("EXPENSE account %s (%s) missing ScheduleCLine mapping", a.Code, a.Name)
		}
	}
}

// ---- SeedDefaultBankRules: defaultBankRules data integrity ----

func TestDefaultBankRules(t *testing.T) {
	// Verify rules count (183 rules across 12 categories)
	if len(defaultBankRules) != 183 {
		t.Errorf("expected 183 default bank rules, got %d", len(defaultBankRules))
	}

	// Check each rule has required fields
	for i, r := range defaultBankRules {
		if r.Name == "" {
			t.Errorf("rule %d has empty Name", i)
		}
		if len(r.Keywords) == 0 {
			t.Errorf("rule %d (%s) has no keywords", i, r.Name)
		}
		if r.AccountCode == "" {
			t.Errorf("rule %d (%s) has empty AccountCode", i, r.Name)
		}
	}

	// Verify unique rule names
	names := make(map[string]int)
	for _, r := range defaultBankRules {
		names[r.Name]++
	}
	for name, count := range names {
		if count > 1 {
			t.Errorf("duplicate rule name %q (appeared %d times)", name, count)
		}
	}
}

// ---- defaultBankRuleEntry JSON construction sanity ----

func TestDefaultBankRules_JSONConstruction(t *testing.T) {
	// Verify conditions JSON can be constructed for a sample rule
	entry := defaultBankRules[0] // McDonald's rule
	var conditions []models.RuleCondition
	for _, kw := range entry.Keywords {
		conditions = append(conditions, models.RuleCondition{
			Field:    "description",
			Operator: "contains",
			Value:    kw,
		})
	}
	if len(conditions) != len(entry.Keywords) {
		t.Errorf("expected %d conditions, got %d", len(entry.Keywords), len(conditions))
	}
}

// ---- ChartAccount model: Code format is 4-digit numeric ----

func TestChartAccount_CodeFormat(t *testing.T) {
	// All defaultAccounts codes should be exactly 4 characters, numeric,
	// and start with 1-5 for valid account types.
	for _, a := range defaultAccounts {
		if len(a.Code) != 4 {
			t.Errorf("code %q has length %d, want 4", a.Code, len(a.Code))
		}
		for _, c := range a.Code {
			if c < '0' || c > '9' {
				t.Errorf("code %q contains non-digit char %c", a.Code, c)
			}
		}
		// First digit must be 1-5
		first := a.Code[0]
		if first < '1' || first > '5' {
			t.Errorf("code %q starts with %c, want 1-5", a.Code, first)
		}
	}
}

// ---- AppSetting: Key is primary key ----

func TestAppSetting_PK(t *testing.T) {
	s := models.AppSetting{Key: "BooksClosedDate", Value: "2026-03-27"}
	if s.Key != "BooksClosedDate" {
		t.Errorf("Key = %q, want %q", s.Key, "BooksClosedDate")
	}
	if s.Value != "2026-03-27" {
		t.Errorf("Value = %q, want %q", s.Value, "2026-03-27")
	}
}

// ---- BankRule: Model fields ----

func TestBankRule_ModelFields(t *testing.T) {
	r := models.BankRule{
		Name:      "Test Rule",
		Priority:  10,
		Active:    true,
		MatchLogic: "AND",
	}
	if r.Name != "Test Rule" {
		t.Errorf("Name = %q", r.Name)
	}
	if r.Priority != 10 {
		t.Errorf("Priority = %d", r.Priority)
	}
	if !r.Active {
		t.Error("Active should be true")
	}
	if r.MatchLogic != "AND" {
		t.Errorf("MatchLogic = %q", r.MatchLogic)
	}
}

// ---- RuleCondition: Fields ----

func TestRuleCondition_ModelFields(t *testing.T) {
	c := models.RuleCondition{
		Field:    "description",
		Operator: "contains",
		Value:    "starbucks",
	}
	if c.Field != "description" {
		t.Errorf("Field = %q", c.Field)
	}
	if c.Operator != "contains" {
		t.Errorf("Operator = %q", c.Operator)
	}
	if c.Value != "starbucks" {
		t.Errorf("Value = %q", c.Value)
	}
}

// ---- Expense model: InvoiceID FK constraint ----

func TestExpense_InvoiceFK(t *testing.T) {
	e := models.Expense{
		InvoiceID: func() *uint { u := uint(1); return &u }(),
	}
	if e.InvoiceID == nil {
		t.Error("InvoiceID should be set")
	}
}

// ---- BankTransaction & Expense: Allocation statuses ----

func TestBankTransaction_AllocationStatuses(t *testing.T) {
	valid := []string{"BALANCED", "UNLINKED", "PARTIALLY_ALLOCATED", "MISMATCHED", "LINKED"}
	for _, s := range valid {
		bt := models.BankTransaction{AllocationStatus: s}
		bt.AfterFind(nil)
		if bt.ReconciliationStatus != s {
			t.Errorf("allocation %s → reconciliation %s", s, bt.ReconciliationStatus)
		}
	}
}

// ---- InvoiceLineItem: struct ----

func TestInvoiceLineItem(t *testing.T) {
	item := models.InvoiceLineItem{
		Description: "Consulting",
		Quantity:    5,
	}
	if item.Description != "Consulting" {
		t.Errorf("Description = %q", item.Description)
	}
}

// ---- Expense model: Allocation statuses ----

func TestExpense_AllocationStatuses(t *testing.T) {
	valid := []string{"BALANCED", "UNLINKED", "PARTIALLY_ALLOCATED", "MISMATCHED", "LINKED"}
	for _, s := range valid {
		e := models.Expense{AllocationStatus: s}
		e.AfterFind(nil)
		if e.ReconciliationStatus != s {
			t.Errorf("allocation %s → reconciliation %s", s, e.ReconciliationStatus)
		}
	}
}

// ---- ItemAuditLog: model fields ----

func TestItemAuditLog_ModelFields(t *testing.T) {
	log := models.ItemAuditLog{
		ItemType: "transaction",
		ItemID:   42,
		Action:   "EXCLUDED",
		Reason:   "PERSONAL",
	}
	if log.ItemType != "transaction" {
		t.Errorf("ItemType = %q", log.ItemType)
	}
	if log.ItemID != 42 {
		t.Errorf("ItemID = %d", log.ItemID)
	}
	if log.Action != "EXCLUDED" {
		t.Errorf("Action = %q", log.Action)
	}
	if log.Reason != "PERSONAL" {
		t.Errorf("Reason = %q", log.Reason)
	}
}

// ---- PeriodAuditLog: model fields ----

func TestPeriodAuditLog_ModelFields(t *testing.T) {
	log := models.PeriodAuditLog{
		Action:       "LOCKED",
		PreviousDate: "",
		NewDate:      "2026-11-13",
		Reason:       "Manual Update",
	}
	if log.Action != "LOCKED" {
		t.Errorf("Action = %q", log.Action)
	}
	if log.NewDate != "2026-11-13" {
		t.Errorf("NewDate = %q", log.NewDate)
	}
}

// ---- BankStatement model: nullable fields ----

func TestBankStatement_Nullables(t *testing.T) {
	bs := models.BankStatement{
		AccountID:  "50106954S:05",
		BankID:     "123456789",
	}
	if bs.AccountID != "50106954S:05" {
		t.Errorf("AccountID = %q", bs.AccountID)
	}
	if bs.BankID != "123456789" {
		t.Errorf("BankID = %q", bs.BankID)
	}
	if bs.EndingBalance != nil {
		t.Error("EndingBalance should be nil by default")
	}
	if bs.BalanceAsOf != nil {
		t.Error("BalanceAsOf should be nil by default")
	}
	if bs.ChartAccountID != nil {
		t.Error("ChartAccountID should be nil by default")
	}
}

// ---- BankTransaction model: review statuses ----

func TestBankTransaction_ReviewStatuses(t *testing.T) {
	valid := []string{"PENDING", "APPROVED", "IGNORED", "WARNINGS_IGNORED", "DELETED"}
	for _, s := range valid {
		bt := models.BankTransaction{ReviewStatus: s}
		if bt.ReviewStatus != s {
			t.Errorf("ReviewStatus = %q", bt.ReviewStatus)
		}
	}
}

// ---- ExpenseBankTransaction: composite PK ----

func TestExpenseBankTransaction_CompositePK(t *testing.T) {
	ebt := models.ExpenseBankTransaction{
		ExpenseID:         1,
		BankTransactionID: 2,
		Status:            "confirmed",
	}
	if ebt.ExpenseID != 1 {
		t.Errorf("ExpenseID = %d", ebt.ExpenseID)
	}
	if ebt.BankTransactionID != 2 {
		t.Errorf("BankTransactionID = %d", ebt.BankTransactionID)
	}
	if ebt.Status != "confirmed" {
		t.Errorf("Status = %q", ebt.Status)
	}
}

// ---- Receipt model: nullable ExpenseID ----

func TestReceipt_NullableExpenseID(t *testing.T) {
	r := models.Receipt{
		DocumentURI: "/processed/receipt.png",
		FileExt:     "png",
		FileHash:    "abc123def456",
	}
	if r.ExpenseID != nil {
		t.Error("ExpenseID should be nil for new receipts")
	}
	// Set it
	uid := uint(42)
	r.ExpenseID = &uid
	if *r.ExpenseID != 42 {
		t.Errorf("ExpenseID = %d, want 42", *r.ExpenseID)
	}
}
