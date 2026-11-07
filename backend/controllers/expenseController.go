package controllers

import (
	"encoding/json"
	"fmt"
	"math"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

// GetExpense fetches a single Expense and returns confirmed and suggested transaction
// links as separate arrays so the UI can distinguish them without ambiguity.
func GetExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.Preload("Receipts").Preload("ChartAccount").First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	// Load confirmed transactions — these are fully reconciled links.
	var confirmedTransactions []models.BankTransaction
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = ?", expense.ID, "confirmed").
		Preload("ChartAccount").Preload("Category").Preload("Expenses", func(db *gorm.DB) *gorm.DB {
			return db.Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").Where("ebt.status = ?", "confirmed")
		}).
		Find(&confirmedTransactions)

	// Load suggested transactions — these are scoring system guesses awaiting user action.
	var suggestedTransactions []models.BankTransaction
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = ?", expense.ID, "suggested").
		Preload("ChartAccount").Preload("Category").
		Find(&suggestedTransactions)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":                "success",
		"expense":               expense,
		"confirmedTransactions": confirmedTransactions,
		"suggestedTransactions": suggestedTransactions,
	})
}

// ValidateExpenseCategory verifies that an account is active and belongs to EXPENSE.
func ValidateExpenseCategory(acc *models.ChartAccount) error {
	if acc == nil {
		return nil
	}
	if !acc.Active {
		return fmt.Errorf("cannot assign deactivated expense category '%s' (%s)", acc.Name, acc.Code)
	}
	if acc.Type != "EXPENSE" {
		return fmt.Errorf("expense category must be an EXPENSE account (5xxx), but '%s' is an %s account (%s)", acc.Name, acc.Type, acc.Code)
	}
	return nil
}

// CreateExpense creates a manually entered expense (no file upload required).
// Optional chartAccountId can be provided to categorize the expense.
func CreateExpense(c fiber.Ctx) error {
	type createInput struct {
		Timestamp      time.Time `json:"timestamp"`
		Vendor         string    `json:"vendor"`
		Description    string    `json:"description"`
		Amount         float64   `json:"amount"`
		Tender         string    `json:"tender"`
		ChartAccountID *uint     `json:"chartAccountId"`
		Notes          string    `json:"notes"`
	}

	var input createInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Guard against creating expenses in a closed period
	if utils.IsDateInClosedPeriod(input.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot create an expense in a closed accounting period.",
		})
	}

	// Validate chartAccountId if provided: must be an active EXPENSE account (5xxx)
	if input.ChartAccountID != nil {
		var account models.ChartAccount
		if err := db.DB.First(&account, *input.ChartAccountID).Error; err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Category account not found"})
		}
		if err := ValidateExpenseCategory(&account); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
	}

	expense := models.Expense{
		Timestamp:      input.Timestamp,
		Vendor:         input.Vendor,
		Description:    input.Description,
		Amount:         math.Abs(input.Amount), // always store positive amounts for expenses
		Tender:         utils.NormalizeTender(input.Tender),
		ChartAccountID: input.ChartAccountID,
		Notes:          input.Notes,
		IsManual:       true,
		AllocationStatus: "UNLINKED",
		ReviewStatus:     "APPROVED",
	}

	if err := db.DB.Create(&expense).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create expense"})
	}

	utils.RunReconciliation()

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "success", "expense": expense})
}

// GetExpenses fetches all expenses, optionally filtered by period or chart account.
//
// Optional query parameters:
//   - ?periodId=123    filter to expenses within that period's date range
//   - ?accountId=5     filter by ChartAccountID (which expense category)
func GetExpenses(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	accountId := c.Query("accountId")

	var expenses []models.Expense
	query := db.DB.Model(&models.Expense{}).Where("COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')")

	// Filter by date range if provided
	query = ApplyDateRange(query, "timestamp", startDate, endDate)

	if accountId != "" {
		if parsedID, err := strconv.ParseUint(accountId, 10, 32); err == nil {
			accountIDs := GetAccountAndDescendantIDs(uint(parsedID))
			query = query.Where(
				"chart_account_id IN ? OR id IN (SELECT ebt.expense_id FROM expense_bank_transactions ebt JOIN bank_transactions bt ON bt.id = ebt.bank_transaction_id WHERE bt.chart_account_id IN ?)",
				accountIDs, accountIDs,
			)
		} else {
			query = query.Where("chart_account_id = ?", accountId)
		}
	}

	search := strings.TrimSpace(c.Query("search"))
	if search != "" {
		if val, err := strconv.ParseFloat(strings.TrimPrefix(search, "$"), 64); err == nil {
			query = query.Where("vendor ILIKE ? OR description ILIKE ? OR amount = ?", "%"+search+"%", "%"+search+"%", math.Abs(val))
		} else {
			query = query.Where("vendor ILIKE ? OR description ILIKE ?", "%"+search+"%", "%"+search+"%")
		}
	}

	pageStr := c.Query("page", "1")
	limitStr := c.Query("limit", "50")
	page, _ := strconv.Atoi(pageStr)
	limit, _ := strconv.Atoi(limitStr)
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 50
	}
	offset := (page - 1) * limit

	var total int64
	query.Count(&total)

	// Preload BankTransactions so the frontend knows if it's linked
	query.Order("timestamp DESC").Preload("Receipts").Preload("BankTransactions").Preload("BankTransactions.Category").Preload("ChartAccount").Offset(offset).Limit(limit).Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":   "success",
		"expenses": expenses,
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}

// UpdateExpense allows updating fields on an expense, including its COA category.
func UpdateExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	if utils.IsDateInClosedPeriod(expense.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot update an expense in a closed accounting period.",
		})
	}

	type updateInput struct {
		Vendor         *string  `json:"vendor"`
		Description    *string  `json:"description"`
		Amount         *float64 `json:"amount"`
		TaxAmount      *float64 `json:"taxAmount"`
		CurrencyCode   *string  `json:"currencyCode"`
		Tender         *string  `json:"tender"`
		Timestamp      *string  `json:"timestamp"`
		ChartAccountID *uint    `json:"chartAccountId"`
		Notes          *string  `json:"notes"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var raw map[string]interface{}
	_ = json.Unmarshal(c.Body(), &raw)

	updates := map[string]interface{}{}
	if input.Vendor != nil {
		updates["vendor"] = *input.Vendor
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.Amount != nil {
		updates["amount"] = math.Abs(*input.Amount)
	}
	if input.TaxAmount != nil {
		updates["tax_amount"] = math.Abs(*input.TaxAmount)
	}
	if input.CurrencyCode != nil {
		updates["currency_code"] = *input.CurrencyCode
	}
	if input.Tender != nil {
		updates["tender"] = utils.NormalizeTender(*input.Tender)
	}
	if input.Notes != nil {
		updates["notes"] = *input.Notes
	}

	// Validate chartAccountId if provided, or support un-categorizing
	if _, exists := raw["chartAccountId"]; exists {
		if input.ChartAccountID != nil && *input.ChartAccountID > 0 {
			var account models.ChartAccount
			if err := db.DB.First(&account, *input.ChartAccountID).Error; err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Category account not found"})
			}
			if err := ValidateExpenseCategory(&account); err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
			}
			updates["chart_account_id"] = input.ChartAccountID

			// Sync category to linked bank transaction ONLY if it's a 1:1 link (not part of a 1:N split)
			var parentTxID uint
			err := db.DB.Model(&models.ExpenseBankTransaction{}).
				Where("expense_id = ? AND status = 'confirmed'", expense.ID).
				Select("bank_transaction_id").Row().Scan(&parentTxID)
			if err == nil && parentTxID > 0 {
				var siblingsCount int64
				db.DB.Model(&models.ExpenseBankTransaction{}).
					Where("bank_transaction_id = ? AND status = 'confirmed'", parentTxID).
					Count(&siblingsCount)
				if siblingsCount <= 1 {
					db.DB.Exec("UPDATE bank_transactions SET category_account_id = ? WHERE id = ?", input.ChartAccountID, parentTxID)
				}
			}
		} else {
			// Explicit null or 0 clears category
			updates["chart_account_id"] = nil
			var parentTxID uint
			err := db.DB.Model(&models.ExpenseBankTransaction{}).
				Where("expense_id = ? AND status = 'confirmed'", expense.ID).
				Select("bank_transaction_id").Row().Scan(&parentTxID)
			if err == nil && parentTxID > 0 {
				var siblingsCount int64
				db.DB.Model(&models.ExpenseBankTransaction{}).
					Where("bank_transaction_id = ? AND status = 'confirmed'", parentTxID).
					Count(&siblingsCount)
				if siblingsCount <= 1 {
					db.DB.Exec("UPDATE bank_transactions SET category_account_id = NULL WHERE id = ?", parentTxID)
				}
			}
		}
	}

	if input.Timestamp != nil && *input.Timestamp != "" {
		var newDate time.Time
		if t, err := time.Parse(time.RFC3339, *input.Timestamp); err == nil {
			newDate = t
		} else if t, err := time.Parse("2006-01-02", *input.Timestamp); err == nil {
			newDate = t
		}

		if !newDate.IsZero() {
			if utils.IsDateInClosedPeriod(newDate) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "Cannot change expense date into a closed accounting period.",
				})
			}
			updates["timestamp"] = newDate
		}
	}

	db.DB.Model(&expense).Updates(updates)

	utils.RunReconciliation()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "expense": expense})
}

// DeleteExpense soft-deletes an expense, unlinks it, and moves it to Deleted Items.
func DeleteExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	// Guard against deleting in a closed period
	if utils.IsDateInClosedPeriod(expense.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot delete an expense in a closed accounting period.",
		})
	}

	// Delete join table relationships so it is unlinked from active books
	db.DB.Where("expense_id = ?", id).Delete(&models.ExpenseBankTransaction{})

	now := time.Now()
	if err := db.DB.Model(&expense).Updates(map[string]interface{}{
		"review_status": "DELETED",
		"deleted_at":    now,
	}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete expense"})
	}

	db.DB.Create(&models.ItemAuditLog{
		ItemType: "expense",
		ItemID:   expense.ID,
		Action:   "DELETED",
		GroupID:  fmt.Sprintf("G%d", time.Now().UnixNano()),
	})

	utils.RunReconciliation()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
