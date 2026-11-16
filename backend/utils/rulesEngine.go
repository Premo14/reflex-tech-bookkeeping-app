package utils

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"

	"gorm.io/gorm"
)

// EvaluateCondition tests a single condition against a BankTransaction.
func EvaluateCondition(cond models.RuleCondition, tx models.BankTransaction) bool {
	field := strings.ToLower(strings.TrimSpace(cond.Field))
	op := strings.ToLower(strings.TrimSpace(cond.Operator))
	targetVal := strings.TrimSpace(cond.Value)

	switch field {
	case "description", "vendor", "payee":
		val := tx.Description
		return evaluateStringOperator(val, op, targetVal)

	case "amount":
		txAmt := tx.Amount.Abs().Cents
		targetFloat, err := strconv.ParseFloat(strings.ReplaceAll(targetVal, "$", ""), 64)
		if err != nil {
			return false
		}
		targetCents := int64(math.Round(math.Abs(targetFloat * 100)))

		switch op {
		case "equals", "equals_amount", "eq", "==":
			return txAmt == targetCents
		case "greater_than", "gt", ">":
			return txAmt > targetCents
		case "greater_than_or_equal", "gte", ">=":
			return txAmt >= targetCents
		case "less_than", "lt", "<":
			return txAmt < targetCents
		case "less_than_or_equal", "lte", "<=":
			return txAmt <= targetCents
		default:
			return false
		}

	case "transaction_type", "type":
		val := tx.TransactionType
		return evaluateStringOperator(val, op, targetVal)

	case "chart_account_id", "account_id":
		if tx.ChartAccountID == nil {
			return false
		}
		targetID, err := strconv.ParseUint(targetVal, 10, 64)
		if err != nil {
			return false
		}
		if op == "not_equals" || op == "!=" {
			return uint(targetID) != *tx.ChartAccountID
		}
		return uint(targetID) == *tx.ChartAccountID

	default:
		// Default to testing against Description
		return evaluateStringOperator(tx.Description, op, targetVal)
	}
}

func evaluateStringOperator(val, op, target string) bool {
	lowerVal := strings.ToLower(val)
	lowerTarget := strings.ToLower(target)

	switch op {
	case "contains":
		return strings.Contains(lowerVal, lowerTarget)
	case "not_contains":
		return !strings.Contains(lowerVal, lowerTarget)
	case "equals", "eq", "==":
		return strings.EqualFold(strings.TrimSpace(val), target)
	case "not_equals", "neq", "!=":
		return !strings.EqualFold(strings.TrimSpace(val), target)
	case "starts_with":
		return strings.HasPrefix(lowerVal, lowerTarget)
	case "ends_with":
		return strings.HasSuffix(lowerVal, lowerTarget)
	case "regex", "matches":
		re, err := regexp.Compile("(?i)" + target)
		if err != nil {
			return false
		}
		return re.MatchString(val)
	default:
		return strings.Contains(lowerVal, lowerTarget)
	}
}

// EvaluateRule tests whether all (AND) or any (OR) conditions of a rule match a transaction.
func EvaluateRule(rule models.BankRule, tx models.BankTransaction) bool {
	if !rule.Active {
		return false
	}

	var conditions []models.RuleCondition
	if err := json.Unmarshal([]byte(rule.ConditionsJSON), &conditions); err != nil {
		return false
	}

	if len(conditions) == 0 {
		return false
	}

	isOr := strings.EqualFold(strings.TrimSpace(rule.MatchLogic), "OR")

	if isOr {
		for _, cond := range conditions {
			if EvaluateCondition(cond, tx) {
				return true
			}
		}
		return false
	}

	// Default is AND
	for _, cond := range conditions {
		if !EvaluateCondition(cond, tx) {
			return false
		}
	}
	return true
}

// appendRawNote preserves an original raw vendor/description label once in notes when renaming.
func appendRawNote(existingNotes, rawLabel string) (string, bool) {
	rawTrimmed := strings.TrimSpace(rawLabel)
	if rawTrimmed == "" || strings.Contains(existingNotes, "Raw: ") {
		return existingNotes, false
	}
	if strings.TrimSpace(existingNotes) == "" {
		return "Raw: " + rawTrimmed, true
	}
	return existingNotes + "\nRaw: " + rawTrimmed, true
}

// ApplyBankRulesToTransaction checks all active rules in priority order against a transaction.
// If a match is found, the transaction is mutated in-memory with the rule's actions.
// Returns the matched rule and whether any fields were modified.
func ApplyBankRulesToTransaction(tx *models.BankTransaction, db *gorm.DB) (*models.BankRule, bool) {
	if db == nil {
		return nil, false
	}
	var rules []models.BankRule
	if err := db.Where("active = true").Order("priority ASC, id ASC").Find(&rules).Error; err != nil {
		return nil, false
	}

	for i := range rules {
		rule := &rules[i]
		if EvaluateRule(*rule, *tx) {
			modified := false

			// Category Assignment
			if rule.CategoryAccountID != nil {
				tx.CategoryAccountID = rule.CategoryAccountID
				modified = true
			}

			// Clean Vendor Renaming
			if strings.TrimSpace(rule.RenamedVendor) != "" {
				renamed := strings.TrimSpace(rule.RenamedVendor)
				if tx.Description != renamed {
					if strings.TrimSpace(tx.Notes) == "" {
						tx.Notes = "Raw: " + tx.Description
					} else if !strings.Contains(tx.Notes, "Raw: ") {
						tx.Notes = tx.Notes + "\nRaw: " + tx.Description
					}
					tx.Description = renamed
					modified = true
				}
			}

			// Notes / Annotation
			if strings.TrimSpace(rule.Notes) != "" {
				if strings.TrimSpace(tx.Notes) == "" {
					tx.Notes = strings.TrimSpace(rule.Notes)
				} else if !strings.Contains(tx.Notes, rule.Notes) {
					tx.Notes = tx.Notes + "\n" + strings.TrimSpace(rule.Notes)
				}
				modified = true
			}

			// Auto-Exclude (e.g. personal expenses, owner draws)
			if rule.AutoExclude {
				tx.ReviewStatus = "IGNORED"
				if strings.TrimSpace(rule.ExclusionReason) != "" {
					tx.ExclusionReason = rule.ExclusionReason
				} else {
					tx.ExclusionReason = "PERSONAL"
				}
				modified = true
			} else if rule.AutoConfirm {
				// Auto-Confirm (pre-approves without manual intervention)
				if tx.ReviewStatus == "" || tx.ReviewStatus == "PENDING" {
					tx.ReviewStatus = "APPROVED"
					modified = true
				}
			}

			if modified {
				now := time.Now().UTC()
				db.Model(&models.BankRule{}).Where("id = ?", rule.ID).Updates(map[string]interface{}{
					"apply_count":     gorm.Expr("apply_count + 1"),
					"last_applied_at": now,
				})
			}

			return rule, modified
		}
	}

	return nil, false
}

// EvaluateConditionForExpense tests a single condition against an Expense.
func EvaluateConditionForExpense(cond models.RuleCondition, exp models.Expense) bool {
	field := strings.ToLower(strings.TrimSpace(cond.Field))
	op := strings.ToLower(strings.TrimSpace(cond.Operator))
	targetVal := strings.TrimSpace(cond.Value)

	switch field {
	case "description", "vendor", "payee":
		if evaluateStringOperator(exp.Vendor, op, targetVal) {
			return true
		}
		if exp.Description != "" && evaluateStringOperator(exp.Description, op, targetVal) {
			return true
		}
		return false

	case "amount":
		expAmt := exp.Amount.Abs().Cents
		targetFloat, err := strconv.ParseFloat(strings.ReplaceAll(targetVal, "$", ""), 64)
		if err != nil {
			return false
		}
		targetCents := int64(math.Round(math.Abs(targetFloat * 100)))

		switch op {
		case "equals", "equals_amount", "eq", "==":
			return expAmt == targetCents
		case "greater_than", "gt", ">":
			return expAmt > targetCents
		case "greater_than_or_equal", "gte", ">=":
			return expAmt >= targetCents
		case "less_than", "lt", "<":
			return expAmt < targetCents
		case "less_than_or_equal", "lte", "<=":
			return expAmt <= targetCents
		default:
			return false
		}

	case "chart_account_id", "account_id", "category_account_id":
		if exp.ChartAccountID == nil {
			return false
		}
		targetID, err := strconv.ParseUint(targetVal, 10, 64)
		if err != nil {
			return false
		}
		if op == "not_equals" || op == "!=" {
			return uint(targetID) != *exp.ChartAccountID
		}
		return uint(targetID) == *exp.ChartAccountID

	default:
		if evaluateStringOperator(exp.Vendor, op, targetVal) {
			return true
		}
		if exp.Description != "" && evaluateStringOperator(exp.Description, op, targetVal) {
			return true
		}
		return false
	}
}

// EvaluateRuleForExpense tests whether all (AND) or any (OR) conditions of a rule match an Expense.
func EvaluateRuleForExpense(rule models.BankRule, exp models.Expense) bool {
	if !rule.Active {
		return false
	}

	var conditions []models.RuleCondition
	if err := json.Unmarshal([]byte(rule.ConditionsJSON), &conditions); err != nil {
		return false
	}

	if len(conditions) == 0 {
		return false
	}

	isOr := strings.EqualFold(strings.TrimSpace(rule.MatchLogic), "OR")

	if isOr {
		for _, cond := range conditions {
			if EvaluateConditionForExpense(cond, exp) {
				return true
			}
		}
		return false
	}

	// Default is AND
	for _, cond := range conditions {
		if !EvaluateConditionForExpense(cond, exp) {
			return false
		}
	}
	return true
}

// ApplyBankRulesToExpense checks all active rules in priority order against an expense.
// If a match is found, the expense is mutated in-memory with the rule's actions.
// Returns the matched rule and whether any fields were modified.
func ApplyBankRulesToExpense(exp *models.Expense, db *gorm.DB) (*models.BankRule, bool) {
	if db == nil {
		return nil, false
	}
	var rules []models.BankRule
	if err := db.Where("active = true").Order("priority ASC, id ASC").Find(&rules).Error; err != nil {
		return nil, false
	}

	for i := range rules {
		rule := &rules[i]
		if EvaluateRuleForExpense(*rule, *exp) {
			modified := false

			// Category Assignment (if currently unassigned)
			if rule.CategoryAccountID != nil && exp.ChartAccountID == nil {
				exp.ChartAccountID = rule.CategoryAccountID
				modified = true
			}

			// Clean Vendor Renaming
			if strings.TrimSpace(rule.RenamedVendor) != "" {
				renamed := strings.TrimSpace(rule.RenamedVendor)
				if strings.TrimSpace(exp.Vendor) != renamed {
					if strings.TrimSpace(exp.Notes) == "" {
						exp.Notes = "Raw: " + exp.Vendor
					} else if !strings.Contains(exp.Notes, "Raw: ") {
						exp.Notes = exp.Notes + "\nRaw: " + exp.Vendor
					}
					exp.Vendor = renamed
					modified = true
				}
			}

			// Notes / Annotation
			if strings.TrimSpace(rule.Notes) != "" {
				if strings.TrimSpace(exp.Notes) == "" {
					exp.Notes = strings.TrimSpace(rule.Notes)
				} else if !strings.Contains(exp.Notes, rule.Notes) {
					exp.Notes = exp.Notes + "\n" + strings.TrimSpace(rule.Notes)
				}
				modified = true
			}

			// Auto-Exclude
			if rule.AutoExclude {
				exp.ReviewStatus = "IGNORED"
				modified = true
			} else if rule.AutoConfirm {
				if exp.ReviewStatus == "" || exp.ReviewStatus == "PENDING" {
					exp.ReviewStatus = "APPROVED"
					modified = true
				}
			}

			if modified {
				now := time.Now().UTC()
				db.Model(&models.BankRule{}).Where("id = ?", rule.ID).Updates(map[string]interface{}{
					"apply_count":     gorm.Expr("apply_count + 1"),
					"last_applied_at": now,
				})
			}

			return rule, modified
		}
	}

	return nil, false
}

// ApplyAllRulesToExisting runs active rules against all unlinked or uncategorized bank transactions
// and expenses in open accounting periods.
func ApplyAllRulesToExisting(db *gorm.DB) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("nil database")
	}
	var rules []models.BankRule
	if err := db.Where("active = true").Order("priority ASC, id ASC").Find(&rules).Error; err != nil {
		return 0, err
	}
	if len(rules) == 0 {
		return 0, nil
	}

	updatedCount := 0

	// 1. Process open transactions
	var transactions []models.BankTransaction
	if err := db.Where("COALESCE(review_status, '') NOT IN ('DELETED', 'IGNORED')").Find(&transactions).Error; err != nil {
		return 0, err
	}

	for i := range transactions {
		tx := &transactions[i]

		// Skip if in closed period
		if IsDateInClosedPeriod(tx.Date) {
			continue
		}

		for _, rule := range rules {
			if EvaluateRule(rule, *tx) {
				updates := map[string]interface{}{}

				if rule.CategoryAccountID != nil && tx.CategoryAccountID == nil {
					tx.CategoryAccountID = rule.CategoryAccountID
					updates["category_account_id"] = rule.CategoryAccountID
					var linkedExpIDs []uint
					db.Model(&models.ExpenseBankTransaction{}).
						Where("bank_transaction_id = ? AND status = 'confirmed'", tx.ID).
						Pluck("expense_id", &linkedExpIDs)
					if len(linkedExpIDs) == 1 {
						var catAcc models.ChartAccount
						if db.First(&catAcc, *rule.CategoryAccountID).Error == nil && catAcc.Type == "EXPENSE" {
							db.Model(&models.Expense{}).
								Where("id = ? AND chart_account_id IS NULL", linkedExpIDs[0]).
								Update("chart_account_id", *rule.CategoryAccountID)
						}
					}
				}

				if strings.TrimSpace(rule.RenamedVendor) != "" && tx.Description != strings.TrimSpace(rule.RenamedVendor) {
					origDesc := tx.Description
					tx.Description = strings.TrimSpace(rule.RenamedVendor)
					updates["description"] = tx.Description
					if nextNotes, changed := appendRawNote(tx.Notes, origDesc); changed {
						tx.Notes = nextNotes
						updates["notes"] = tx.Notes
					}
				}

				if strings.TrimSpace(rule.Notes) != "" {
					if strings.TrimSpace(tx.Notes) == "" {
						tx.Notes = strings.TrimSpace(rule.Notes)
						updates["notes"] = tx.Notes
					} else if !strings.Contains(tx.Notes, rule.Notes) {
						tx.Notes = tx.Notes + "\n" + strings.TrimSpace(rule.Notes)
						updates["notes"] = tx.Notes
					}
				}

				if rule.AutoExclude && tx.ReviewStatus != "IGNORED" {
					tx.ReviewStatus = "IGNORED"
					reason := rule.ExclusionReason
					if strings.TrimSpace(reason) == "" {
						reason = "PERSONAL"
					}
					tx.ExclusionReason = reason
					updates["review_status"] = "IGNORED"
					updates["exclusion_reason"] = reason
				} else if rule.AutoConfirm && (tx.ReviewStatus == "" || tx.ReviewStatus == "PENDING") {
					tx.ReviewStatus = "APPROVED"
					updates["review_status"] = "APPROVED"
				}

				if len(updates) > 0 {
					if err := db.Model(&models.BankTransaction{}).Where("id = ?", tx.ID).Updates(updates).Error; err == nil {
						updatedCount++
						now := time.Now().UTC()
						db.Model(&models.BankRule{}).Where("id = ?", rule.ID).Updates(map[string]interface{}{
							"apply_count":     gorm.Expr("apply_count + 1"),
							"last_applied_at": now,
						})
					}
				}
				break // Applied highest priority matching rule
			}
		}
	}

	// 2. Process open expenses
	var expenses []models.Expense
	if err := db.Where("COALESCE(review_status, '') NOT IN ('DELETED', 'IGNORED')").Find(&expenses).Error; err == nil {
		for i := range expenses {
			exp := &expenses[i]

			if IsDateInClosedPeriod(exp.Timestamp) {
				continue
			}

			for _, rule := range rules {
				if EvaluateRuleForExpense(rule, *exp) {
					updates := map[string]interface{}{}

					if rule.CategoryAccountID != nil && exp.ChartAccountID == nil {
						exp.ChartAccountID = rule.CategoryAccountID
						updates["chart_account_id"] = rule.CategoryAccountID
						var parentTxIDs []uint
						db.Model(&models.ExpenseBankTransaction{}).
							Where("expense_id = ? AND status = 'confirmed'", exp.ID).
							Pluck("bank_transaction_id", &parentTxIDs)
						for _, parentTxID := range parentTxIDs {
							var siblings int64
							db.Model(&models.ExpenseBankTransaction{}).
								Where("bank_transaction_id = ? AND status = 'confirmed'", parentTxID).
								Count(&siblings)
							if siblings == 1 {
								db.Model(&models.BankTransaction{}).
									Where("id = ? AND category_account_id IS NULL", parentTxID).
									Update("category_account_id", *rule.CategoryAccountID)
							}
						}
					}

					if strings.TrimSpace(rule.RenamedVendor) != "" && strings.TrimSpace(exp.Vendor) != strings.TrimSpace(rule.RenamedVendor) {
						origVendor := exp.Vendor
						exp.Vendor = strings.TrimSpace(rule.RenamedVendor)
						updates["vendor"] = exp.Vendor
						if nextNotes, changed := appendRawNote(exp.Notes, origVendor); changed {
							exp.Notes = nextNotes
							updates["notes"] = exp.Notes
						}
					}

					if strings.TrimSpace(rule.Notes) != "" {
						if strings.TrimSpace(exp.Notes) == "" {
							exp.Notes = strings.TrimSpace(rule.Notes)
							updates["notes"] = exp.Notes
						} else if !strings.Contains(exp.Notes, rule.Notes) {
							exp.Notes = exp.Notes + "\n" + strings.TrimSpace(rule.Notes)
							updates["notes"] = exp.Notes
						}
					}

					if rule.AutoExclude && exp.ReviewStatus != "IGNORED" {
						exp.ReviewStatus = "IGNORED"
						updates["review_status"] = "IGNORED"
					} else if rule.AutoConfirm && (exp.ReviewStatus == "" || exp.ReviewStatus == "PENDING") &&
						exp.Amount.Cents > 0 && !strings.Contains(exp.Description, "[MISSING") {
						exp.ReviewStatus = "APPROVED"
						updates["review_status"] = "APPROVED"
					}

					if len(updates) > 0 {
						if err := db.Model(&models.Expense{}).Where("id = ?", exp.ID).Updates(updates).Error; err == nil {
							updatedCount++
							now := time.Now().UTC()
							db.Model(&models.BankRule{}).Where("id = ?", rule.ID).Updates(map[string]interface{}{
								"apply_count":     gorm.Expr("apply_count + 1"),
								"last_applied_at": now,
							})
						}
					}
					break // Applied highest priority matching rule
				}
			}
		}
	}

	if updatedCount > 0 {
		UpdateAllocationStatuses()
		events.Broadcast("TRANSACTIONS_UPDATED", nil)
		events.Broadcast("EXPENSES_UPDATED", nil)
		events.Broadcast("RECONCILIATION_UPDATED", nil)
		events.Broadcast("QUEUE_UPDATED", nil)
		events.Broadcast("SUMMARY_UPDATED", nil)
	}

	return updatedCount, nil
}

// TestRulePreview tests a rule against existing transactions and returns the count and up to 10 sample matches.
func TestRulePreview(rule models.BankRule, db *gorm.DB) (int, []models.BankTransaction, error) {
	if db == nil {
		return 0, nil, fmt.Errorf("nil database")
	}
	var transactions []models.BankTransaction
	if err := db.Where("COALESCE(review_status, '') != 'DELETED'").Order("date DESC").Limit(500).Find(&transactions).Error; err != nil {
		return 0, nil, err
	}

	totalMatches := 0
	var sampleMatches []models.BankTransaction

	for _, tx := range transactions {
		if EvaluateRule(rule, tx) {
			totalMatches++
			if len(sampleMatches) < 10 {
				sampleMatches = append(sampleMatches, tx)
			}
		}
	}

	return totalMatches, sampleMatches, nil
}
