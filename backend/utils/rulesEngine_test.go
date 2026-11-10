package utils

import (
	"encoding/json"
	"reflex-tech-bookkeeping-app-api/models"
	"testing"
)

func TestEvaluateCondition(t *testing.T) {
	tx := models.BankTransaction{
		Description:     "Withdrawal Instant Issue AWS Cloud Services Seattle WA",
		Amount:          -145.50,
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
		Amount:          -12.45,
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
}
