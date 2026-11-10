package utils

import (
	"encoding/json"
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
		txAmt := math.Abs(tx.Amount)
		targetAmt, err := strconv.ParseFloat(strings.ReplaceAll(targetVal, "$", ""), 64)
		if err != nil {
			return false
		}
		targetAmt = math.Abs(targetAmt)

		switch op {
		case "equals", "equals_amount", "eq", "==":
			return math.Abs(txAmt-targetAmt) < 0.005
		case "greater_than", "gt", ">":
			return txAmt > targetAmt
		case "greater_than_or_equal", "gte", ">=":
			return txAmt >= targetAmt-0.005
		case "less_than", "lt", "<":
			return txAmt < targetAmt
		case "less_than_or_equal", "lte", "<=":
			return txAmt <= targetAmt+0.005
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

// ApplyBankRulesToTransaction checks all active rules in priority order against a transaction.
// If a match is found, the transaction is mutated in-memory with the rule's actions.
// Returns the matched rule and whether any fields were modified.
func ApplyBankRulesToTransaction(tx *models.BankTransaction, db *gorm.DB) (*models.BankRule, bool) {
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

// ApplyAllRulesToExisting runs active rules against all unlinked or uncategorized bank transactions
// in open accounting periods.
func ApplyAllRulesToExisting(db *gorm.DB) (int, error) {
	var rules []models.BankRule
	if err := db.Where("active = true").Order("priority ASC, id ASC").Find(&rules).Error; err != nil {
		return 0, err
	}
	if len(rules) == 0 {
		return 0, nil
	}

	// Query open transactions that are uncategorized, unlinked, or pending
	var transactions []models.BankTransaction
	if err := db.Where("COALESCE(review_status, '') NOT IN ('DELETED', 'IGNORED')").Find(&transactions).Error; err != nil {
		return 0, err
	}

	updatedCount := 0

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
				}

				if strings.TrimSpace(rule.RenamedVendor) != "" && tx.Description != strings.TrimSpace(rule.RenamedVendor) {
					tx.Description = strings.TrimSpace(rule.RenamedVendor)
					updates["description"] = tx.Description
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
				} else if rule.AutoConfirm && tx.ReviewStatus != "APPROVED" {
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
				break // Applied the highest priority matching rule
			}
		}
	}

	if updatedCount > 0 {
		UpdateAllocationStatuses()
		events.Broadcast("TRANSACTIONS_UPDATED", nil)
		events.Broadcast("RECONCILIATION_UPDATED", nil)
		events.Broadcast("QUEUE_UPDATED", nil)
	}

	return updatedCount, nil
}

// TestRulePreview tests a rule against existing transactions and returns the count and up to 10 sample matches.
func TestRulePreview(rule models.BankRule, db *gorm.DB) (int, []models.BankTransaction, error) {
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
