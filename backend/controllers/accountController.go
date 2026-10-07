package controllers

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

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
		Code        string `json:"code"`
		Name        string `json:"name"`
		Type        string `json:"type"`
		ParentID    *uint  `json:"parentId"`
		Description string `json:"description"`
	}

	var input createInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	// Validate required fields
	if input.Code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "code is required"})
	}
	if input.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
	}

	validTypes := map[string]bool{
		"ASSET": true, "LIABILITY": true, "EQUITY": true, "REVENUE": true, "EXPENSE": true,
	}
	if !validTypes[input.Type] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "type must be one of: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE",
		})
	}

	// Validate parent exists if provided
	if input.ParentID != nil {
		var parent models.ChartAccount
		if err := db.DB.First(&parent, input.ParentID).Error; err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parent account not found"})
		}
	}

	// Check code uniqueness
	var existing models.ChartAccount
	if err := db.DB.Where("code = ?", input.Code).First(&existing).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "an account with this code already exists",
		})
	}

	account := models.ChartAccount{
		Code:        input.Code,
		Name:        input.Name,
		Type:        input.Type,
		ParentID:    input.ParentID,
		Description: input.Description,
		Active:      true,
	}

	if err := db.DB.Create(&account).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create account",
		})
	}

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
		Code        *string `json:"code"`
		Name        *string `json:"name"`
		Type        *string `json:"type"`
		ParentID    *uint   `json:"parentId"`
		Description *string `json:"description"`
		Active      *bool   `json:"active"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
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

		var txCount, expCount int64
		db.DB.Model(&models.BankTransaction{}).Where("chart_account_id = ? OR category_account_id = ?", account.ID, account.ID).Count(&txCount)
		db.DB.Model(&models.Expense{}).Where("chart_account_id = ?", account.ID).Count(&expCount)
		if txCount > 0 || expCount > 0 {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "cannot change type — this account has existing transactions or expenses linked to it",
			})
		}
		account.Type = *input.Type
	}

	// If changing code, ensure uniqueness
	if input.Code != nil && *input.Code != account.Code {
		var existing models.ChartAccount
		if err := db.DB.Where("code = ? AND id != ?", *input.Code, account.ID).First(&existing).Error; err == nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "an account with this code already exists",
			})
		}
		account.Code = *input.Code
	}

	if input.Name != nil {
		account.Name = *input.Name
	}
	if input.Description != nil {
		account.Description = *input.Description
	}
	if input.Active != nil {
		account.Active = *input.Active
	}
	// ParentID update (allow setting to nil to make top-level)
	if input.ParentID != nil {
		account.ParentID = input.ParentID
	}

	if err := db.DB.Save(&account).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update account"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"account": account,
	})
}

// DeleteChartAccount deletes an account only if no transactions or expenses reference it.
// If references exist, returns a 409 Conflict with a count breakdown.
// For accounts with history, use UpdateChartAccount to set active=false instead.
func DeleteChartAccount(c fiber.Ctx) error {
	id := c.Params("id")

	var account models.ChartAccount
	if err := db.DB.First(&account, id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "account not found"})
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

	if txCount > 0 || expCount > 0 || stmtCount > 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "cannot delete account — it has linked records. Deactivate it instead (set active=false).",
			"linkedTransactions": txCount,
			"linkedExpenses":     expCount,
			"linkedStatements":   stmtCount,
		})
	}

	if err := db.DB.Delete(&account).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete account"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
