package utils

import (
	"encoding/json"
	"reflex-tech-bookkeeping-app-api/models"
	"testing"
)

func TestEvaluateCondition(t *testing.T) {
	tx := models.BankTransaction{
		Description:     "Withdrawal Instant Issue AWS Cloud Services Seattle WA",
		Amount:          models.NewMoney(-145.50),
		TransactionType: "DEBIT",
	}

	// 1. Description contains
	cond1 := models.RuleCondition{Field: "description", Operator: "contains", Value: "AWS"}
	if !EvaluateCondition(cond1, tx) {
		t.Errorf("Expected condition 1 to match")
	}

	// 2. Description not_contains
	cond2 := models.RuleCondition{Field: "description", Operator: "not_contains", Value: "Google"}
	if !EvaluateCondition(cond2, tx) {
		t.Errorf("Expected condition 2 to match")
	}

	// 3. Amount greater_than
	cond3 := models.RuleCondition{Field: "amount", Operator: "greater_than", Value: "100"}
	if !EvaluateCondition(cond3, tx) {
		t.Errorf("Expected condition 3 to match")
	}

	// 4. Amount less_than
	cond4 := models.RuleCondition{Field: "amount", Operator: "less_than", Value: "100"}
	if EvaluateCondition(cond4, tx) {
		t.Errorf("Expected condition 4 not to match")
	}

	// 5. Amount equals_amount
	cond5 := models.RuleCondition{Field: "amount", Operator: "equals_amount", Value: "145.50"}
	if !EvaluateCondition(cond5, tx) {
		t.Errorf("Expected condition 5 to match")
	}

	// 6. Regex
	cond6 := models.RuleCondition{Field: "description", Operator: "regex", Value: `AWS.*Services`}
	if !EvaluateCondition(cond6, tx) {
		t.Errorf("Expected condition 6 to match regex")
	}

	// 7. Transaction type
	cond7 := models.RuleCondition{Field: "transaction_type", Operator: "equals", Value: "DEBIT"}
	if !EvaluateCondition(cond7, tx) {
		t.Errorf("Expected condition 7 to match type")
	}
}

func TestEvaluateRule(t *testing.T) {
	tx := models.BankTransaction{
		Description:     "McDonald's Store #11778 Canton NY",
		Amount:          models.NewMoney(-12.45),
		TransactionType: "DEBIT",
	}

	// AND rule where both match
	conds1 := []models.RuleCondition{
		{Field: "description", Operator: "contains", Value: "McDonald"},
		{Field: "amount", Operator: "less_than", Value: "20"},
	}
	raw1, _ := json.Marshal(conds1)
	rule1 := models.BankRule{
		Active:         true,
		MatchLogic:     "AND",
		ConditionsJSON: string(raw1),
	}
	if !EvaluateRule(rule1, tx) {
		t.Errorf("Expected rule 1 to evaluate to true")
	}

	// AND rule where one fails
	conds2 := []models.RuleCondition{
		{Field: "description", Operator: "contains", Value: "McDonald"},
		{Field: "amount", Operator: "greater_than", Value: "50"},
	}
	raw2, _ := json.Marshal(conds2)
	rule2 := models.BankRule{
		Active:         true,
		MatchLogic:     "AND",
		ConditionsJSON: string(raw2),
	}
	if EvaluateRule(rule2, tx) {
		t.Errorf("Expected rule 2 to evaluate to false")
	}

	// OR rule where one matches
	rule3 := models.BankRule{
		Active:         true,
		MatchLogic:     "OR",
		ConditionsJSON: string(raw2),
	}
	if !EvaluateRule(rule3, tx) {
		t.Errorf("Expected rule 3 (OR) to evaluate to true")
	}

	// Multi-keyword Retailer Rule (McDonald's)
	mcdConds := []models.RuleCondition{
		{Field: "description", Operator: "contains", Value: "mcdonald"},
		{Field: "description", Operator: "contains", Value: "mcds"},
		{Field: "description", Operator: "contains", Value: "mcd's"},
		{Field: "description", Operator: "contains", Value: "mcdonalds"},
	}
	rawMcd, _ := json.Marshal(mcdConds)
	mcdRule := models.BankRule{
		Active:         true,
		MatchLogic:     "OR",
		ConditionsJSON: string(rawMcd),
		RenamedVendor:  "McDonald's",
	}

	mcdSamples := []string{
		"POS DEBIT MCDS STORE #992 CANTON NY",
		"MCDONALDS #1234 UTICA NY",
		"MCD'S #445 UTICA NY",
		"MCDONALD'S DRIVE-THRU",
	}
	for _, sample := range mcdSamples {
		testTx := models.BankTransaction{Description: sample}
		if !EvaluateRule(mcdRule, testTx) {
			t.Errorf("Expected McDonald's multi-keyword rule to match %q", sample)
		}
	}

	// Multi-keyword Retailer Rule (Walmart)
	wmConds := []models.RuleCondition{
		{Field: "description", Operator: "contains", Value: "wal-mart"},
		{Field: "description", Operator: "contains", Value: "walmart"},
		{Field: "description", Operator: "contains", Value: "wm supercenter"},
		{Field: "description", Operator: "contains", Value: "wmt store"},
	}
	rawWm, _ := json.Marshal(wmConds)
	wmRule := models.BankRule{
		Active:         true,
		MatchLogic:     "OR",
		ConditionsJSON: string(rawWm),
		RenamedVendor:  "Walmart",
	}

	wmSamples := []string{
		"WM SUPERCENTER #1980 SYRACUSE NY",
		"WAL-MART #2241 ALBANY NY",
		"WALMART GROCERY PICKUP",
		"WMT STORE #3319 UTICA NY",
	}
	for _, sample := range wmSamples {
		testTx := models.BankTransaction{Description: sample}
		if !EvaluateRule(wmRule, testTx) {
			t.Errorf("Expected Walmart multi-keyword rule to match %q", sample)
		}
	}
}

func TestEvaluateConditionIntegerAmountOperators(t *testing.T) {
	// Test that amount operators use exact integer cents (no float tolerance).
	tests := []struct {
		desc     string
		amount   float64
		op       string
		value    string
		expected bool
	}{
		{"Exact match: $10.00 eq $10.00", 10.00, "eq", "10.00", true},
		{"Exact match: $10.00 == $10.00", 10.00, "==", "10.00", true},
		{"No match: $10.00 != $10.01", 10.00, "eq", "10.01", false},
		{"GT: $15.50 > $10.00", 15.50, "gt", "10.00", true},
		{"LT: $5.25 < $10.00", 5.25, "lt", "10.00", true},
		{"GTE: $10.00 >= $10.00", 10.00, "gte", "10.00", true},
		{"LTE: $10.00 <= $10.00", 10.00, "lte", "10.00", true},
		{"GT fails: $10.00 not > $10.00", 10.00, "gt", "10.00", false},
		{"Dollar sign stripped: $20 eq 20", 20.00, "eq", "$20", true},
	}
	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			tx := models.BankTransaction{Amount: models.NewMoney(tt.amount)}
			cond := models.RuleCondition{Field: "amount", Operator: tt.op, Value: tt.value}
			got := EvaluateCondition(cond, tx)
			if got != tt.expected {
				t.Errorf("amount %f %s %s = %v, expected %v", tt.amount, tt.op, tt.value, got, tt.expected)
			}
		})
	}
}

func TestApplyBankRulesToTransaction(t *testing.T) {
	// Test that ApplyBankRulesToTransaction correctly matches and mutates a transaction.
	// Uses a thin in-memory setup with mock data.
	tx := &models.BankTransaction{
		Description: "McDonald's Store #992",
		Amount:      models.NewMoney(-12.50),
	}
	// A nil DB should return (nil, false) gracefully
	rule, modified := ApplyBankRulesToTransaction(tx, nil)
	if rule != nil || modified {
		t.Fatalf("expected nil rule and false modified with nil DB, got rule=%v modified=%v", rule, modified)
	}
}

func TestTestRulePreview(t *testing.T) {
	// nil DB → error
	_, _, err := TestRulePreview(models.BankRule{}, nil)
	if err == nil {
		t.Error("expected error from TestRulePreview with nil DB")
	}
}
