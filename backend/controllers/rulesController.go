package controllers

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"

	"github.com/gofiber/fiber/v3"
)

// GetRules lists all bank rules ordered by priority ascending.
func GetRules(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var rules []models.BankRule
	if err := db.DB.Preload("CategoryAccount").Order("priority ASC, id ASC").Find(&rules).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch bank rules"})
	}
	return c.JSON(rules)
}

// GetRule returns a single rule by ID.
func GetRule(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	idParam := c.Params("id")
	id, err := strconv.ParseUint(idParam, 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid rule ID"})
	}

	var rule models.BankRule
	if err := db.DB.Preload("CategoryAccount").First(&rule, id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Rule not found"})
	}
	return c.JSON(rule)
}

func validateRuleConditions(conditions []models.RuleCondition) error {
	for _, c := range conditions {
		op := strings.ToLower(strings.TrimSpace(c.Operator))
		if op == "regex" || op == "matches" {
			if strings.TrimSpace(c.Value) == "" {
				return fmt.Errorf("regex pattern cannot be empty")
			}
			if _, err := regexp.Compile(c.Value); err != nil {
				return fmt.Errorf("invalid regular expression '%s': %v", c.Value, err)
			}
		}
	}
	return nil
}

// validateActiveRuleCategory normalizes an optional CategoryAccountID and verifies it points to an active ChartAccount.
func validateActiveRuleCategory(categoryAccountID *uint) (*uint, error) {
	catID := normalizeOptionalID(categoryAccountID)
	if catID == nil {
		return nil, nil
	}
	var cat models.ChartAccount
	if err := db.DB.Where("id = ? AND active = ?", *catID, true).First(&cat).Error; err != nil {
		return nil, fmt.Errorf("Selected category account does not exist or is inactive")
	}
	return catID, nil
}

// broadcastRuleAppliedUpdates notifies connected clients when rule execution modifies transactions or expenses.
func broadcastRuleAppliedUpdates(appliedCount int) {
	if appliedCount > 0 {
		events.Broadcast("TRANSACTIONS_UPDATED", nil)
		events.Broadcast("EXPENSES_UPDATED", nil)
		events.Broadcast("RECONCILIATION_UPDATED", nil)
		events.Broadcast("SUMMARY_UPDATED", nil)
		events.Broadcast("QUEUE_UPDATED", nil)
	}
}

// CreateRule creates a new automated bank rule.
func CreateRule(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	type CreateRuleReq struct {
		Name              string                 `json:"name"`
		Priority          *int                   `json:"priority"`
		Active            *bool                  `json:"active"`
		MatchLogic        string                 `json:"matchLogic"`
		Conditions        []models.RuleCondition `json:"conditions"`
		CategoryAccountID *uint                  `json:"categoryAccountId"`
		RenamedVendor     string                 `json:"renamedVendor"`
		AutoConfirm       bool                   `json:"autoConfirm"`
		AutoExclude       bool                   `json:"autoExclude"`
		ExclusionReason   string                 `json:"exclusionReason"`
		Notes             string                 `json:"notes"`
		ApplyImmediately  bool                   `json:"applyImmediately"`
	}

	var req CreateRuleReq
	if err := c.Bind().Body(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if strings.TrimSpace(req.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Rule name is required"})
	}

	if len(req.Conditions) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "At least one condition is required"})
	}

	if err := validateRuleConditions(req.Conditions); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	catID, err := validateActiveRuleCategory(req.CategoryAccountID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	conditionsJSON, err := json.Marshal(req.Conditions)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid conditions format"})
	}

	priority := 0
	if req.Priority != nil {
		priority = *req.Priority
	} else {
		// Default priority to bottom of existing rules
		var maxPriority struct{ MaxP int }
		db.DB.Model(&models.BankRule{}).Select("COALESCE(MAX(priority), 0) as max_p").Scan(&maxPriority)
		priority = maxPriority.MaxP + 1
	}

	active := true
	if req.Active != nil {
		active = *req.Active
	}

	matchLogic := "AND"
	if strings.EqualFold(strings.TrimSpace(req.MatchLogic), "OR") {
		matchLogic = "OR"
	}

	rule := models.BankRule{
		Name:              strings.TrimSpace(req.Name),
		Priority:          priority,
		Active:            active,
		MatchLogic:        matchLogic,
		ConditionsJSON:    string(conditionsJSON),
		CategoryAccountID: catID,
		RenamedVendor:     strings.TrimSpace(req.RenamedVendor),
		AutoConfirm:       req.AutoConfirm,
		AutoExclude:       req.AutoExclude,
		ExclusionReason:   req.ExclusionReason,
		Notes:             strings.TrimSpace(req.Notes),
	}

	if err := db.DB.Create(&rule).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create rule"})
	}

	appliedCount := 0
	if req.ApplyImmediately {
		appliedCount, _ = utils.ApplyAllRulesToExisting(db.DB)
		broadcastRuleAppliedUpdates(appliedCount)
	}

	db.DB.Preload("CategoryAccount").First(&rule, rule.ID)
	events.Broadcast("RULES_UPDATED", nil)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"rule":         rule,
		"appliedCount": appliedCount,
	})
}

// UpdateRule updates an existing bank rule.
func UpdateRule(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	idParam := c.Params("id")
	id, err := strconv.ParseUint(idParam, 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid rule ID"})
	}

	var rule models.BankRule
	if err := db.DB.First(&rule, id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Rule not found"})
	}

	type UpdateRuleReq struct {
		Name              *string                 `json:"name"`
		Priority          *int                    `json:"priority"`
		Active            *bool                   `json:"active"`
		MatchLogic        *string                 `json:"matchLogic"`
		Conditions        *[]models.RuleCondition `json:"conditions"`
		CategoryAccountID *uint                   `json:"categoryAccountId"`
		ClearCategory     bool                    `json:"clearCategory"`
		RenamedVendor     *string                 `json:"renamedVendor"`
		AutoConfirm       *bool                   `json:"autoConfirm"`
		AutoExclude       *bool                   `json:"autoExclude"`
		ExclusionReason   *string                 `json:"exclusionReason"`
		Notes             *string                 `json:"notes"`
		ApplyImmediately  bool                    `json:"applyImmediately"`
	}

	var req UpdateRuleReq
	if err := c.Bind().Body(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	updates := map[string]interface{}{}

	if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
		updates["name"] = strings.TrimSpace(*req.Name)
	}
	if req.Priority != nil {
		updates["priority"] = *req.Priority
	}
	if req.Active != nil {
		updates["active"] = *req.Active
	}
	if req.MatchLogic != nil {
		ml := "AND"
		if strings.EqualFold(strings.TrimSpace(*req.MatchLogic), "OR") {
			ml = "OR"
		}
		updates["match_logic"] = ml
	}
	if req.Conditions != nil {
		if len(*req.Conditions) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "At least one condition is required"})
		}
		if err := validateRuleConditions(*req.Conditions); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		cj, err := json.Marshal(*req.Conditions)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid conditions format"})
		}
		updates["conditions_json"] = string(cj)
	}
	if req.ClearCategory {
		updates["category_account_id"] = nil
	} else if req.CategoryAccountID != nil {
		catID, err := validateActiveRuleCategory(req.CategoryAccountID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		updates["category_account_id"] = catID
	}
	if req.RenamedVendor != nil {
		updates["renamed_vendor"] = strings.TrimSpace(*req.RenamedVendor)
	}
	if req.AutoConfirm != nil {
		updates["auto_confirm"] = *req.AutoConfirm
	}
	if req.AutoExclude != nil {
		updates["auto_exclude"] = *req.AutoExclude
	}
	if req.ExclusionReason != nil {
		updates["exclusion_reason"] = *req.ExclusionReason
	}
	if req.Notes != nil {
		updates["notes"] = strings.TrimSpace(*req.Notes)
	}

	if len(updates) > 0 {
		if err := db.DB.Model(&rule).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update rule"})
		}
	}

	appliedCount := 0
	if req.ApplyImmediately {
		appliedCount, _ = utils.ApplyAllRulesToExisting(db.DB)
		broadcastRuleAppliedUpdates(appliedCount)
	}

	db.DB.Preload("CategoryAccount").First(&rule, rule.ID)
	events.Broadcast("RULES_UPDATED", nil)

	return c.JSON(fiber.Map{
		"rule":         rule,
		"appliedCount": appliedCount,
	})
}

// DeleteRule deletes a rule by ID.
func DeleteRule(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	idParam := c.Params("id")
	id, err := strconv.ParseUint(idParam, 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid rule ID"})
	}

	res := db.DB.Delete(&models.BankRule{}, id)
	if res.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete rule"})
	}
	if res.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Rule not found"})
	}

	events.Broadcast("RULES_UPDATED", nil)
	return c.JSON(fiber.Map{"status": "success", "message": "Rule deleted"})
}

// ReorderRules updates rule priorities based on an array of rule IDs in the desired order.
func ReorderRules(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	var ruleIDs []uint
	if err := c.Bind().Body(&ruleIDs); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Expected array of rule IDs"})
	}

	tx := db.DB.Begin()
	for priority, ruleID := range ruleIDs {
		if err := tx.Model(&models.BankRule{}).Where("id = ?", ruleID).Update("priority", priority).Error; err != nil {
			tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to reorder rules"})
		}
	}
	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to commit rule order"})
	}

	events.Broadcast("RULES_UPDATED", nil)
	return c.JSON(fiber.Map{"status": "success", "message": "Rules reordered"})
}

// ApplyAllRules triggers evaluation of all active bank rules across open-period transactions.
func ApplyAllRules(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	count, err := utils.ApplyAllRulesToExisting(db.DB)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to apply bank rules: " + err.Error()})
	}
	broadcastRuleAppliedUpdates(count)
	return c.JSON(fiber.Map{
		"status":       "success",
		"appliedCount": count,
		"message":      strconv.Itoa(count) + " transactions updated by rules",
	})
}

// TestRulePreview evaluates a draft rule against recent transactions without saving changes.
func TestRulePreview(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	type TestReq struct {
		MatchLogic string                 `json:"matchLogic"`
		Conditions []models.RuleCondition `json:"conditions"`
	}

	var req TestReq
	if err := c.Bind().Body(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if len(req.Conditions) == 0 {
		return c.JSON(fiber.Map{"matchCount": 0, "sampleMatches": []interface{}{}})
	}

	if err := validateRuleConditions(req.Conditions); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	conditionsJSON, err := json.Marshal(req.Conditions)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid conditions format"})
	}

	draftRule := models.BankRule{
		Active:         true,
		MatchLogic:     req.MatchLogic,
		ConditionsJSON: string(conditionsJSON),
	}

	count, samples, err := utils.TestRulePreview(draftRule, db.DB)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to preview rule matches"})
	}

	return c.JSON(fiber.Map{
		"matchCount":    count,
		"sampleMatches": samples,
	})
}

// GetRuleSuggestions detects recurring payee categorizations that do not yet have an automated BankRule.
func GetRuleSuggestions(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}
	// Query top payees with >= 2 transactions categorized to the same category
	type candidateRow struct {
		CategoryAccountID uint   `json:"categoryAccountId"`
		Count             int64  `json:"count"`
		SampleDesc        string `json:"sampleDesc"`
	}

	var candidates []candidateRow
	db.DB.Raw(`
		SELECT category_account_id, COUNT(*) as count, MIN(description) as sample_desc
		FROM bank_transactions
		WHERE category_account_id IS NOT NULL 
		  AND COALESCE(review_status, '') NOT IN ('DELETED', 'IGNORED')
		  AND TRIM(description) != ''
		GROUP BY category_account_id, LOWER(TRIM(description))
		HAVING COUNT(*) >= 2
		ORDER BY count DESC
		LIMIT 50
	`).Scan(&candidates)

	var expCandidates []candidateRow
	db.DB.Raw(`
		SELECT chart_account_id as category_account_id, COUNT(*) as count, MIN(vendor) as sample_desc
		FROM expenses
		WHERE chart_account_id IS NOT NULL 
		  AND COALESCE(review_status, '') NOT IN ('DELETED', 'IGNORED')
		  AND TRIM(vendor) != ''
		GROUP BY chart_account_id, LOWER(TRIM(vendor))
		HAVING COUNT(*) >= 2
		ORDER BY count DESC
		LIMIT 50
	`).Scan(&expCandidates)

	// Combine candidates by (category_account_id, normalized payee/description) so identical payees
	// mapped to different categories remain distinct suggestions.
	combinedMap := make(map[string]candidateRow)
	for _, cand := range candidates {
		key := fmt.Sprintf("%d|%s", cand.CategoryAccountID, strings.ToLower(strings.TrimSpace(cand.SampleDesc)))
		combinedMap[key] = cand
	}
	for _, cand := range expCandidates {
		key := fmt.Sprintf("%d|%s", cand.CategoryAccountID, strings.ToLower(strings.TrimSpace(cand.SampleDesc)))
		if existing, ok := combinedMap[key]; ok {
			existing.Count += cand.Count
			combinedMap[key] = existing
		} else {
			combinedMap[key] = cand
		}
	}

	var mergedCandidates []candidateRow
	for _, cand := range combinedMap {
		mergedCandidates = append(mergedCandidates, cand)
	}

	// Fetch existing active rules to filter out already-automated descriptions
	var activeRules []models.BankRule
	db.DB.Where("active = ?", true).Find(&activeRules)

	var suggestions []fiber.Map
	for _, cand := range mergedCandidates {
		// Check if any rule already matches this sample description
		alreadyCovered := false
		dummyTx := models.BankTransaction{Description: cand.SampleDesc}
		dummyExp := models.Expense{Vendor: cand.SampleDesc, Description: cand.SampleDesc}
		for _, rule := range activeRules {
			if utils.EvaluateRule(rule, dummyTx) || utils.EvaluateRuleForExpense(rule, dummyExp) {
				alreadyCovered = true
				break
			}
		}

		if !alreadyCovered && cand.CategoryAccountID > 0 {
			var cat models.ChartAccount
			if err := db.DB.Where("id = ? AND active = ?", cand.CategoryAccountID, true).First(&cat).Error; err == nil {
				cleanKeyword := strings.TrimSpace(cand.SampleDesc)
				runes := []rune(cleanKeyword)
				if len(runes) > 24 {
					cleanKeyword = string(runes[:24])
				}
				suggestions = append(suggestions, fiber.Map{
					"payeeKeyword":      cleanKeyword,
					"suggestedName":     fmt.Sprintf("Auto-categorize %s to %s", cleanKeyword, cat.Name),
					"categoryAccountId": cat.ID,
					"categoryName":      cat.Name,
					"categoryCode":      cat.Code,
					"matchingTxCount":   cand.Count,
					"sampleDescription": cand.SampleDesc,
				})
			}
		}
	}

	return c.JSON(fiber.Map{
		"suggestions": suggestions,
	})
}
