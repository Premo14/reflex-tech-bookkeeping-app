package controllers

import (
	"encoding/json"
	"errors"
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

// GetTransactions fetches all BankTransactions along with their linked
// Expenses and the physical Receipts, so the frontend can display them.
//
// Optional query parameters:
//   - ?periodId=123     filter to transactions within that period's date range
//   - ?accountId=5      filter by ChartAccountID (which bank account)
//   - ?search=walmart   ILIKE search on description
func GetTransactions(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	accountId := c.Query("accountId")
	search := c.Query("search")

	var txs []models.BankTransaction
	query := db.DB.Model(&models.BankTransaction{}).Where("COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')")

	// Filter by date range if provided
	query = ApplyDateRange(query, "date", startDate, endDate)

	if accountId != "" {
		if parsedID, err := strconv.ParseUint(accountId, 10, 32); err == nil {
			accountIDs := GetAccountAndDescendantIDs(uint(parsedID))
			query = query.Where("chart_account_id IN ? OR category_account_id IN ?", accountIDs, accountIDs)
		} else {
			query = query.Where("chart_account_id = ? OR category_account_id = ?", accountId, accountId)
		}
	}

	search = strings.TrimSpace(search)
	if search != "" {
		if val, err := strconv.ParseFloat(strings.TrimPrefix(search, "$"), 64); err == nil {
			query = query.Where("description ILIKE ? OR ABS(amount) = ?", "%"+search+"%", math.Abs(val))
		} else {
			query = query.Where("description ILIKE ?", "%"+search+"%")
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

	query.Order("date DESC").Preload("Expenses.Receipts").Preload("ChartAccount").Preload("Category").Offset(offset).Limit(limit).Find(&txs)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
		"total":        total,
		"page":         page,
		"limit":        limit,
	})
}

// GetTransaction fetches a single BankTransaction and returns confirmed and suggested
// expense links as separate arrays so the UI can distinguish them without ambiguity.
func GetTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.Preload("ChartAccount").Preload("Category").First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	// Load confirmed expenses with their physical receipt files.
	var confirmedExpenses []models.Expense
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
		Where("ebt.bank_transaction_id = ? AND ebt.status = ?", tx.ID, "confirmed").
		Preload("Receipts").Preload("ChartAccount").Preload("BankTransactions", func(db *gorm.DB) *gorm.DB {
			return db.Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").Where("ebt.status = ?", "confirmed")
		}).
		Find(&confirmedExpenses)

	// Load suggested expenses — scoring system guesses awaiting user action.
	var suggestedExpenses []models.Expense
	db.DB.Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
		Where("ebt.bank_transaction_id = ? AND ebt.status = ?", tx.ID, "suggested").
		Preload("ChartAccount").
		Find(&suggestedExpenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":            "success",
		"transaction":       tx,
		"confirmedExpenses": confirmedExpenses,
		"suggestedExpenses": suggestedExpenses,
	})
}

// ValidateBankAccount verifies that an account is active and belongs to ASSET or LIABILITY.
func ValidateBankAccount(acc *models.ChartAccount) error {
	if acc == nil {
		return errors.New("bank account is required")
	}
	if !acc.Active {
		return fmt.Errorf("cannot assign deactivated bank account '%s' (%s)", acc.Name, acc.Code)
	}
	if acc.Type != "ASSET" && acc.Type != "LIABILITY" {
		return fmt.Errorf("bank account must be an ASSET or LIABILITY account (e.g. Checking or Credit Card), but '%s' is an %s account (%s)", acc.Name, acc.Type, acc.Code)
	}
	return nil
}

// ValidateTransactionCategory verifies that an account is active and belongs to a valid account type.
func ValidateTransactionCategory(acc *models.ChartAccount) error {
	if acc == nil {
		return nil
	}
	if !acc.Active {
		return fmt.Errorf("cannot assign deactivated category '%s' (%s)", acc.Name, acc.Code)
	}
	validTypes := map[string]bool{
		"EXPENSE":   true,
		"REVENUE":   true,
		"EQUITY":    true,
		"ASSET":     true,
		"LIABILITY": true,
	}
	if !validTypes[acc.Type] {
		return fmt.Errorf("transaction category must be a valid account type, but '%s' is an unknown %s account (%s)", acc.Name, acc.Type, acc.Code)
	}
	return nil
}

// CreateTransaction creates a manually entered bank transaction (no OFX import required).
// BankStatementID is intentionally left null for manual entries.
// The FITID is auto-generated to satisfy the unique constraint.
// chartAccountId specifies the financial bank/credit card account (ASSET or LIABILITY).
// categoryAccountId optionally specifies the transaction category (EXPENSE or REVENUE).
func CreateTransaction(c fiber.Ctx) error {
	type createInput struct {
		Date              time.Time `json:"date"`
		Description       string    `json:"description"`
		Amount            float64   `json:"amount"`
		TransactionType   string    `json:"transactionType"`
		ChartAccountID    *uint     `json:"chartAccountId"`
		CategoryAccountID *uint     `json:"categoryAccountId"`
		Notes             string    `json:"notes"`
	}

	var input createInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Guard against creating transactions in a closed period
	if utils.IsDateInClosedPeriod(input.Date) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot create a transaction in a closed accounting period.",
		})
	}

	// Validate bank/source account (must be active ASSET or LIABILITY)
	if input.ChartAccountID == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Bank / Card account is required for transactions",
		})
	}
	var bankAccount models.ChartAccount
	if err := db.DB.First(&bankAccount, *input.ChartAccountID).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bank account not found"})
	}
	if err := ValidateBankAccount(&bankAccount); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	// Validate category account if provided: must be active EXPENSE (5xxx) or REVENUE (4xxx)
	if input.CategoryAccountID != nil {
		var catAccount models.ChartAccount
		if err := db.DB.First(&catAccount, *input.CategoryAccountID).Error; err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Category account not found"})
		}
		if err := ValidateTransactionCategory(&catAccount); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
	}

	allocationStatus := "UNLINKED"
	if input.Amount > 0 {
		allocationStatus = "BALANCED"
	}

	tx := models.BankTransaction{
		Date:              input.Date,
		Description:       input.Description,
		Amount:            input.Amount,
		TransactionType:   input.TransactionType,
		ChartAccountID:    input.ChartAccountID,
		CategoryAccountID: input.CategoryAccountID,
		Notes:             input.Notes,
		// Synthetic FITID satisfies the unique constraint on manually entered rows.
		FITID:            fmt.Sprintf("MANUAL-%d", time.Now().UnixNano()),
		IsManual:         true,
		AllocationStatus: allocationStatus,
		ReviewStatus:     "APPROVED",
		// BankStatementID left nil — manual entries don't belong to an imported statement.
	}

	if err := db.DB.Create(&tx).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create transaction"})
	}

	utils.RunReconciliation()

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "success", "transaction": tx})
}

// UpdateTransaction allows updating fields on a transaction.
func UpdateTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	if utils.IsDateInClosedPeriod(tx.Date) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot update a transaction in a closed accounting period.",
		})
	}

	type updateInput struct {
		Date              *string  `json:"date"`
		Description       *string  `json:"description"`
		Amount            *float64 `json:"amount"`
		ChartAccountID    *uint    `json:"chartAccountId"`
		CategoryAccountID *uint    `json:"categoryAccountId"`
		Notes             *string  `json:"notes"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var raw map[string]interface{}
	_ = json.Unmarshal(c.Body(), &raw)

	updates := map[string]interface{}{}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.Notes != nil {
		updates["notes"] = *input.Notes
	}

	// For imported transactions, prevent tampering with statement data (amount, date, source account)
	if !tx.IsManual {
		if input.Amount != nil && *input.Amount != tx.Amount {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Cannot modify amount of an imported bank statement transaction",
			})
		}
		if input.ChartAccountID != nil && (tx.ChartAccountID == nil || *input.ChartAccountID != *tx.ChartAccountID) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Cannot modify source bank account of an imported bank statement transaction",
			})
		}
	} else {
		if input.Amount != nil {
			updates["amount"] = *input.Amount
		}
	}

	// Validate bank/source account if provided (must be active ASSET or LIABILITY)
	if tx.IsManual && input.ChartAccountID != nil {
		var bankAccount models.ChartAccount
		if err := db.DB.First(&bankAccount, *input.ChartAccountID).Error; err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bank account not found"})
		}
		if err := ValidateBankAccount(&bankAccount); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		updates["chart_account_id"] = input.ChartAccountID
	}

	// Validate category account or support clearing category to Uncategorized
	if _, exists := raw["categoryAccountId"]; exists {
		if input.CategoryAccountID != nil && *input.CategoryAccountID > 0 {
			var catAccount models.ChartAccount
			if err := db.DB.First(&catAccount, *input.CategoryAccountID).Error; err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Category account not found"})
			}
			if err := ValidateTransactionCategory(&catAccount); err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
			}
			updates["category_account_id"] = input.CategoryAccountID

			// Sync category to linked expenses ONLY if it's a 1:1 link (not a split)
			var linkedExpCount int64
			db.DB.Model(&models.ExpenseBankTransaction{}).Where("bank_transaction_id = ? AND status = 'confirmed'", tx.ID).Count(&linkedExpCount)
			if linkedExpCount == 1 {
				db.DB.Exec("UPDATE expenses SET chart_account_id = ? WHERE id IN (SELECT expense_id FROM expense_bank_transactions WHERE bank_transaction_id = ? AND status = 'confirmed')", input.CategoryAccountID, tx.ID)
			}
		} else {
			// Explicit null or 0 means un-categorize
			updates["category_account_id"] = nil
			var linkedExpCount int64
			db.DB.Model(&models.ExpenseBankTransaction{}).Where("bank_transaction_id = ? AND status = 'confirmed'", tx.ID).Count(&linkedExpCount)
			if linkedExpCount == 1 {
				db.DB.Exec("UPDATE expenses SET chart_account_id = NULL WHERE id IN (SELECT expense_id FROM expense_bank_transactions WHERE bank_transaction_id = ? AND status = 'confirmed')", tx.ID)
			}
		}
	}

	if input.Date != nil && *input.Date != "" {
		var newDate time.Time
		if t, err := time.Parse(time.RFC3339, *input.Date); err == nil {
			newDate = t
		} else if t, err := time.Parse("2006-01-02", *input.Date); err == nil {
			newDate = t
		}

		if !newDate.IsZero() {
			if !tx.IsManual && !newDate.Equal(tx.Date) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Cannot modify date of an imported bank statement transaction",
				})
			}
			if utils.IsDateInClosedPeriod(newDate) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "Cannot change transaction date into a closed accounting period.",
				})
			}
			updates["date"] = newDate
		}
	}

	db.DB.Model(&tx).Updates(updates)

	utils.RunReconciliation()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "transaction": tx})
}

// DeleteTransaction soft-deletes a transaction, unlinks it, and moves it to Deleted Items.
func DeleteTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	if utils.IsDateInClosedPeriod(tx.Date) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot delete a transaction in a closed accounting period.",
		})
	}

	// Delete all join table rows for this transaction so it's unlinked from active books
	db.DB.Where("bank_transaction_id = ?", id).Delete(&models.ExpenseBankTransaction{})

	now := time.Now()
	if err := db.DB.Model(&tx).Updates(map[string]interface{}{
		"review_status": "DELETED",
		"deleted_at":    now,
	}).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete transaction"})
	}

	db.DB.Create(&models.ItemAuditLog{
		ItemType: "transaction",
		ItemID:   tx.ID,
		Action:   "DELETED",
		GroupID:  fmt.Sprintf("G%d", time.Now().UnixNano()),
	})

	utils.RunReconciliation()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
