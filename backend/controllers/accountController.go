package controllers

import (
	"encoding/json"
	"fmt"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"strings"

	"github.com/gofiber/fiber/v3"
)

// GetChartAccounts returns all chart of accounts entries.
// Supports optional ?type= filter to fetch only accounts of a specific type
// (e.g. ?type=EXPENSE to populate an expense category picker).
// Returns a flat list sorted by code. The frontend builds any tree structure it needs.
func GetChartAccounts(c fiber.Ctx) error {
	accountType := c.Query("type")

	var accounts []models.ChartAccount
	query := db.DB.Model(&models.ChartAccount{})

	if accountType != "" {
		query = query.Where("type = ?", accountType)
	}

	if err := query.Order("code ASC").Find(&accounts).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch chart of accounts",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":   "success",
		"accounts": accounts,
	})
}

// CreateChartAccount creates a new account in the chart of accounts.
func CreateChartAccount(c fiber.Ctx) error {
	type createInput struct {
		Code          string `json:"code"`
		Name          string `json:"name"`
		Type          string `json:"type"`
		ParentID      *uint  `json:"parentId"`
		Description   string `json:"description"`
		ScheduleCLine string `json:"scheduleCLine"`
	}

	var input createInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	input.Code = strings.TrimSpace(input.Code)
	input.Name = strings.TrimSpace(input.Name)

	// Validate required fields
	if input.Code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Account code is required"})
	}
	if !isNumericOnly(input.Code) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Account code must contain numbers only"})
	}
	if input.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Account name is required"})
	}

	validTypes := map[string]bool{
		"ASSET": true, "LIABILITY": true, "EQUITY": true, "REVENUE": true, "EXPENSE": true,
	}
	if !validTypes[input.Type] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "type must be one of: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE",
		})
	}

	// Validate code length and prefix matching the type (1xxx, 2xxx, 3xxx, 4xxx, 5xxx)
	if err := validateAccountCode(input.Code, input.Type); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	// Validate parent exists and has matching type if provided
	if input.ParentID != nil {
		var parent models.ChartAccount
		if err := db.DB.First(&parent, input.ParentID).Error; err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parent account not found"})
		}
		if !parent.Active {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cannot assign an inactive account as a parent"})
		}
		if parent.Type != input.Type {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("parent account type (%s) must match sub-account type (%s)", parent.Type, input.Type),
			})
		}
	}

	// Check code uniqueness
	var existingCode models.ChartAccount
	if err := db.DB.Where("code = ?", input.Code).First(&existingCode).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": fmt.Sprintf("An account with code %s already exists (%s)", input.Code, existingCode.Name),
		})
	}

	// Check name uniqueness (case-insensitive)
	var existingName models.ChartAccount
	if err := db.DB.Where("LOWER(TRIM(name)) = LOWER(?)", input.Name).First(&existingName).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": fmt.Sprintf("An account with name '%s' already exists (code %s)", input.Name, existingName.Code),
		})
	}

	account := models.ChartAccount{
		Code:          input.Code,
		Name:          input.Name,
		Type:          input.Type,
		ParentID:      input.ParentID,
		Description:   strings.TrimSpace(input.Description),
		ScheduleCLine: strings.TrimSpace(input.ScheduleCLine),
		Active:        true,
	}

	if err := db.DB.Create(&account).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create account",
		})
	}

	BroadcastEvent("ACCOUNTS_UPDATED", nil)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"status":  "success",
		"account": account,
	})
}

// UpdateChartAccount updates an existing chart of accounts entry.
// The Type field cannot be changed if the account has existing transactions or expenses.
func UpdateChartAccount(c fiber.Ctx) error {
	id := c.Params("id")

	var account models.ChartAccount
	if err := db.DB.First(&account, id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "account not found"})
	}

	type updateInput struct {
		Code          *string `json:"code"`
		Name          *string `json:"name"`
		Type          *string `json:"type"`
		ParentID      *uint   `json:"parentId"`
		Description   *string `json:"description"`
		ScheduleCLine *string `json:"scheduleCLine"`
		OfxAccountID  *string `json:"ofxAccountId"`
		Active        *bool   `json:"active"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	var raw map[string]interface{}
	hasExplicitParent := false
	if err := json.Unmarshal(c.Body(), &raw); err == nil {
		if _, exists := raw["parentId"]; exists {
			hasExplicitParent = true
		}
	}

	// If account is a default account, prevent changing its Type
	if account.IsDefault && input.Type != nil && *input.Type != account.Type {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cannot change type on a default account",
		})
	}

	// If changing type, ensure no transactions or expenses reference this account
	if input.Type != nil && *input.Type != account.Type {
		validTypes := map[string]bool{
			"ASSET": true, "LIABILITY": true, "EQUITY": true, "REVENUE": true, "EXPENSE": true,
		}
		if !validTypes[*input.Type] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "type must be one of: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE",
			})
		}

		var txCount, expCount, stmtCount int64
		db.DB.Model(&models.BankTransaction{}).Where("chart_account_id = ? OR category_account_id = ?", account.ID, account.ID).Count(&txCount)
		db.DB.Model(&models.Expense{}).Where("chart_account_id = ?", account.ID).Count(&expCount)
		db.DB.Model(&models.BankStatement{}).Where("chart_account_id = ?", account.ID).Count(&stmtCount)
		if txCount > 0 || expCount > 0 || stmtCount > 0 {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "cannot change type — this account has existing transactions, expenses, or statements linked to it",
			})
		}
		account.Type = *input.Type
	}

	// Validate effective code against effective type
	effectiveType := account.Type
	effectiveCode := account.Code
	if input.Code != nil {
		cleanCode := strings.TrimSpace(*input.Code)
		if cleanCode == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Account code cannot be empty"})
		}
		if !isNumericOnly(cleanCode) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Account code must contain numbers only"})
		}
		if cleanCode != account.Code {
			var existingCode models.ChartAccount
			if err := db.DB.Where("code = ? AND id != ?", cleanCode, account.ID).First(&existingCode).Error; err == nil {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{
					"error": fmt.Sprintf("An account with code %s already exists (%s)", cleanCode, existingCode.Name),
				})
			}
		}
		effectiveCode = cleanCode
	}

	if err := validateAccountCode(effectiveCode, effectiveType); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	account.Code = effectiveCode

	if input.Name != nil {
		cleanName := strings.TrimSpace(*input.Name)
		if cleanName == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Account name cannot be empty"})
		}
		if !strings.EqualFold(cleanName, account.Name) {
			var existingName models.ChartAccount
			if err := db.DB.Where("LOWER(TRIM(name)) = LOWER(?) AND id != ?", cleanName, account.ID).First(&existingName).Error; err == nil {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{
					"error": fmt.Sprintf("An account with name '%s' already exists (code %s)", cleanName, existingName.Code),
				})
			}
			account.Name = cleanName
		}
	}

	if input.Description != nil {
		account.Description = strings.TrimSpace(*input.Description)
	}
	if input.ScheduleCLine != nil {
		account.ScheduleCLine = strings.TrimSpace(*input.ScheduleCLine)
	}
	if input.OfxAccountID != nil {
		cleanOfx := strings.TrimSpace(*input.OfxAccountID)
		if cleanOfx == "" {
			account.OfxAccountID = nil
		} else {
			account.OfxAccountID = &cleanOfx
		}
	}
	if input.Active != nil {
		if !*input.Active && account.Active {
			// Check if account has unlinked or pending review transactions
			var unlinkedCount int64
			db.DB.Model(&models.BankTransaction{}).Where("(chart_account_id = ? OR category_account_id = ?) AND (allocation_status = 'UNLINKED' OR review_status = 'PENDING')", account.ID, account.ID).Count(&unlinkedCount)

			// Check if account has unlinked or pending review expenses
			var unlinkedExpCount int64
			db.DB.Model(&models.Expense{}).Where("chart_account_id = ? AND (allocation_status = 'UNLINKED' OR review_status = 'PENDING')", account.ID).Count(&unlinkedExpCount)

			if unlinkedCount > 0 || unlinkedExpCount > 0 {
				var msgs []string
				if unlinkedCount > 0 {
					msgs = append(msgs, fmt.Sprintf("%d unlinked or pending transaction(s)", unlinkedCount))
				}
				if unlinkedExpCount > 0 {
					msgs = append(msgs, fmt.Sprintf("%d unlinked or pending expense(s)", unlinkedExpCount))
				}
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{
					"error": fmt.Sprintf("cannot deactivate account — it has %s. Please allocate or resolve them first.", strings.Join(msgs, " and ")),
					"unlinkedTransactions": unlinkedCount,
					"unlinkedExpenses":     unlinkedExpCount,
				})
			}

			// Check for active child sub-accounts
			var activeChildren int64
			db.DB.Model(&models.ChartAccount{}).Where("parent_id = ? AND active = ?", account.ID, true).Count(&activeChildren)
			if activeChildren > 0 {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{
					"error": fmt.Sprintf("cannot deactivate account — it has %d active sub-account(s). Please deactivate or reassign them first.", activeChildren),
					"activeSubAccounts": activeChildren,
				})
			}
		}
		account.Active = *input.Active
	}
	// ParentID update (allow setting to nil/0 to make top-level)
	if hasExplicitParent {
		if raw["parentId"] == nil || (input.ParentID != nil && *input.ParentID == 0) {
			account.ParentID = nil
		} else if input.ParentID != nil && *input.ParentID > 0 {
			if *input.ParentID == account.ID {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "an account cannot be its own parent",
				})
			}
			var parent models.ChartAccount
			if err := db.DB.First(&parent, input.ParentID).Error; err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parent account not found"})
			}
			if !parent.Active {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cannot assign an inactive account as a parent"})
			}
			if parent.Type != effectiveType {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": fmt.Sprintf("parent account type (%s) must match account type (%s)", parent.Type, effectiveType),
				})
			}

			// Prevent circular hierarchy
			currID := parent.ParentID
			for currID != nil {
				if *currID == account.ID {
					return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
						"error": "circular parent-child relationship detected",
					})
				}
				var p models.ChartAccount
				if err := db.DB.Select("id, parent_id").First(&p, *currID).Error; err != nil {
					break
				}
				currID = p.ParentID
			}
			account.ParentID = input.ParentID
		}
	}

	if err := db.DB.Select("*").Save(&account).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update account"})
	}

	BroadcastEvent("ACCOUNTS_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"account": account,
	})
}

// DeleteChartAccount deletes an account only if no transactions or expenses reference it.
// Default accounts cannot be deleted.
// If references exist, returns a 409 Conflict with a count breakdown.
// For accounts with history or defaults, use UpdateChartAccount to set active=false instead.
func DeleteChartAccount(c fiber.Ctx) error {
	id := c.Params("id")

	var account models.ChartAccount
	if err := db.DB.First(&account, id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "account not found"})
	}

	if account.IsDefault {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "default system accounts cannot be deleted. You can deactivate them instead (set active=false).",
		})
	}

	// Check for linked transactions
	var txCount int64
	db.DB.Model(&models.BankTransaction{}).Where("chart_account_id = ? OR category_account_id = ?", account.ID, account.ID).Count(&txCount)

	// Check for linked expenses
	var expCount int64
	db.DB.Model(&models.Expense{}).Where("chart_account_id = ?", account.ID).Count(&expCount)

	// Check for linked statements
	var stmtCount int64
	db.DB.Model(&models.BankStatement{}).Where("chart_account_id = ?", account.ID).Count(&stmtCount)

	// Check for sub-accounts
	var childCount int64
	db.DB.Model(&models.ChartAccount{}).Where("parent_id = ?", account.ID).Count(&childCount)

	if txCount > 0 || expCount > 0 || stmtCount > 0 || childCount > 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "cannot delete account — it has linked records or sub-accounts. Deactivate it instead (set active=false).",
			"linkedTransactions": txCount,
			"linkedExpenses":     expCount,
			"linkedStatements":   stmtCount,
			"childAccounts":      childCount,
		})
	}

	if err := db.DB.Delete(&account).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete account"})
	}

	BroadcastEvent("ACCOUNTS_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}

// isNumericOnly checks that a string contains only ASCII digits 0-9
func isNumericOnly(s string) bool {
	if len(s) == 0 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ValidSubcategoryPrefixes maps each account type to its allowed 2-digit sub-category prefixes.
var ValidSubcategoryPrefixes = map[string][]string{
	"ASSET":     {"10", "11", "12", "13", "14", "15"},
	"LIABILITY": {"20", "21", "22", "25"},
	"EQUITY":    {"30", "31"},
	"REVENUE":   {"40", "41", "42"},
	"EXPENSE":   {"50", "51", "52", "53", "54", "55", "56", "57", "59"},
}

// ValidateAccountCode enforces standard 4-digit numeric code, 1st digit type matching,
// and 2-digit sub-category prefix matching:
// ASSET -> 10xx-15xx, LIABILITY -> 20xx-22xx, 25xx, EQUITY -> 30xx-31xx, REVENUE -> 40xx-42xx, EXPENSE -> 50xx-57xx, 59xx
func ValidateAccountCode(code, accountType string) error {
	if !isNumericOnly(code) {
		return fmt.Errorf("Account code must contain numbers only")
	}
	if len(code) != 4 {
		return fmt.Errorf("Account code must be exactly 4 digits (e.g. %s000-%s999)", getPrefixForType(accountType), getPrefixForType(accountType))
	}
	expectedPrefix := getPrefixForType(accountType)
	if expectedPrefix == "" {
		return fmt.Errorf("invalid account type: %s", accountType)
	}
	if !strings.HasPrefix(code, expectedPrefix) {
		return fmt.Errorf("Account code for %s must start with %s (e.g. %s000-%s999)", accountType, expectedPrefix, expectedPrefix, expectedPrefix)
	}

	prefixes, ok := ValidSubcategoryPrefixes[accountType]
	if !ok || len(prefixes) == 0 {
		return fmt.Errorf("invalid account type: %s", accountType)
	}
	prefix2 := code[:2]
	matched := false
	for _, p := range prefixes {
		if prefix2 == p {
			matched = true
			break
		}
	}
	if !matched {
		return fmt.Errorf("Account code %s has an invalid sub-category prefix (%s) for %s. Valid sub-category prefixes: %s",
			code, prefix2, accountType, strings.Join(prefixes, ", "))
	}
	return nil
}

func validateAccountCode(code, accountType string) error {
	return ValidateAccountCode(code, accountType)
}

func getPrefixForType(accountType string) string {
	switch accountType {
	case "ASSET":
		return "1"
	case "LIABILITY":
		return "2"
	case "EQUITY":
		return "3"
	case "REVENUE":
		return "4"
	case "EXPENSE":
		return "5"
	default:
		return ""
	}
}

// GetAccountAndDescendantIDs returns rootID and all recursive child sub-account IDs.
func GetAccountAndDescendantIDs(rootID uint) []uint {
	result := []uint{rootID}
	visited := map[uint]bool{rootID: true}
	queue := []uint{rootID}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		var childIDs []uint
		db.DB.Model(&models.ChartAccount{}).Where("parent_id = ?", curr).Pluck("id", &childIDs)
		for _, cid := range childIDs {
			if !visited[cid] {
				visited[cid] = true
				result = append(result, cid)
				queue = append(queue, cid)
			}
		}
	}
	return result
}
