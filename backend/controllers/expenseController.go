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
			return db.Where("expenses.id IN (SELECT expense_id FROM expense_bank_transactions WHERE status = ?)", "confirmed").
				Order("expenses.timestamp ASC, expenses.id ASC")
		}).Preload("Expenses.Receipts").Preload("Expenses.ChartAccount").
		Order("bank_transactions.date ASC, bank_transactions.id ASC").
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
		Date           *string `json:"date"`
		Timestamp      *string `json:"timestamp"`
		Vendor         string  `json:"vendor"`
		Description    string  `json:"description"`
		Amount         float64 `json:"amount"`
		TaxAmount      float64 `json:"taxAmount"`
		Tender         string  `json:"tender"`
		ChartAccountID *uint   `json:"chartAccountId"`
		Notes          string  `json:"notes"`
	}

	var input createInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var expenseTime time.Time
	dateStr := ""
	if input.Timestamp != nil && *input.Timestamp != "" {
		dateStr = *input.Timestamp
	} else if input.Date != nil && *input.Date != "" {
		dateStr = *input.Date
	}

	if dateStr != "" {
		if t, err := time.Parse(time.RFC3339, dateStr); err == nil {
			expenseTime = t
		} else if t, err := time.Parse("2006-01-02", dateStr); err == nil {
			expenseTime = t
		}
	}
	if expenseTime.IsZero() {
		expenseTime = time.Now().UTC()
	}

	// Guard against creating expenses in a closed period
	if utils.IsDateInClosedPeriod(expenseTime) {
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

	normTender := utils.NormalizeTender(input.Tender)
	initialAllocation := "UNLINKED"
	if utils.IsCashTender(normTender) {
		initialAllocation = "BALANCED"
	}

	expense := models.Expense{
		Timestamp:        expenseTime,
		Vendor:           input.Vendor,
		Description:      input.Description,
		Amount:           math.Abs(input.Amount), // always store positive amounts for expenses
		TaxAmount:        math.Abs(input.TaxAmount),
		Tender:           normTender,
		ChartAccountID:   input.ChartAccountID,
		Notes:            input.Notes,
		IsManual:         true,
		AllocationStatus: initialAllocation,
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
				"chart_account_id IN ? OR id IN (SELECT ebt.expense_id FROM expense_bank_transactions ebt JOIN bank_transactions bt ON bt.id = ebt.bank_transaction_id WHERE ebt.status = 'confirmed' AND bt.chart_account_id IN ?)",
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

	statusFilter := strings.ToUpper(strings.TrimSpace(c.Query("status")))
	switch statusFilter {
	case "NEEDS_ATTENTION":
		query = query.Where(notCashClause).Where(needsAttentionClause)
	case "UNLINKED":
		query = query.Where(notCashClause).Where("allocation_status IS NULL OR allocation_status = '' OR allocation_status = 'UNLINKED'")
	case "BALANCED":
		query = query.Where("allocation_status = 'BALANCED' OR LOWER(COALESCE(tender, '')) = 'cash'")
	case "PARTIALLY_ALLOCATED":
		query = query.Where("allocation_status = 'PARTIALLY_ALLOCATED'")
	case "OVER_ALLOCATED":
		query = query.Where("allocation_status = 'OVER_ALLOCATED'")
	case "UNCATEGORIZED":
		query = query.Where("chart_account_id IS NULL")
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

	sortBy := strings.ToLower(strings.TrimSpace(c.Query("sortBy", "date")))
	sortOrder := strings.ToUpper(strings.TrimSpace(c.Query("sortOrder", "desc")))
	if sortOrder != "ASC" {
		sortOrder = "DESC"
	}
	secondaryOrder := "timestamp " + sortOrder

	priorityOrder := `CASE
		WHEN COALESCE(review_status, '') IN ('WARNINGS_IGNORED', 'IGNORED') THEN 5
		WHEN COALESCE(allocation_status, 'UNLINKED') = 'UNLINKED' AND has_suggestions = true THEN 0
		WHEN allocation_status = 'OVER_ALLOCATED' THEN 1
		WHEN allocation_status = 'PARTIALLY_ALLOCATED' THEN 2
		WHEN LOWER(COALESCE(tender, '')) != 'cash' AND COALESCE(allocation_status, 'UNLINKED') = 'UNLINKED' THEN 3
		ELSE 4
	END ASC, ` + secondaryOrder

	orderClause := priorityOrder
	if sortBy == "amount" {
		orderClause = "amount " + sortOrder + ", timestamp DESC"
	} else if sortOrder == "ASC" {
		orderClause = "timestamp ASC"
	}

	// Preload confirmed BankTransactions so the frontend knows if it's linked
	query.Order(orderClause).Preload("Receipts").Preload("BankTransactions", func(db *gorm.DB) *gorm.DB {
		return db.Where("bank_transactions.id IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = ?)", "confirmed")
	}).Preload("BankTransactions.Category").Preload("ChartAccount").Offset(offset).Limit(limit).Find(&expenses)

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
		normTender := utils.NormalizeTender(*input.Tender)
		updates["tender"] = normTender
		if utils.IsCashTender(normTender) {
			updates["allocation_status"] = "BALANCED"
			db.DB.Where("expense_id = ?", expense.ID).Delete(&models.ExpenseBankTransaction{})
		} else if utils.IsCashTender(expense.Tender) {
			// Changed from cash to non-cash: becomes UNLINKED
			updates["allocation_status"] = "UNLINKED"
		}
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

			// Sync category to linked bank transactions (1:1 or N:1) as long as the transaction isn't a 1:N split across multiple expenses
			var parentTxIDs []uint
			db.DB.Model(&models.ExpenseBankTransaction{}).
				Where("expense_id = ? AND status = 'confirmed'", expense.ID).
				Pluck("bank_transaction_id", &parentTxIDs)
			for _, parentTxID := range parentTxIDs {
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
			var parentTxIDs []uint
			db.DB.Model(&models.ExpenseBankTransaction{}).
				Where("expense_id = ? AND status = 'confirmed'", expense.ID).
				Pluck("bank_transaction_id", &parentTxIDs)
			for _, parentTxID := range parentTxIDs {
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

type SplitLineInput struct {
	Amount          float64 `json:"amount"`
	ChartAccountID  *uint   `json:"chartAccountId"`
	Description     string  `json:"description"`
	Vendor          string  `json:"vendor"`
	IsPersonal      bool    `json:"isPersonal"`
	ExclusionReason string  `json:"exclusionReason"`
}

type SplitExpenseInput struct {
	Splits []SplitLineInput `json:"splits"`
}

// SplitExpense splits an existing expense (receipt) into multiple distinct items (e.g. for co-mingled personal/business purchases).
func SplitExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.Preload("Receipts").First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	if utils.IsDateInClosedPeriod(expense.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot split an expense in a closed accounting period.",
		})
	}

	var input SplitExpenseInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if len(input.Splits) < 2 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "A receipt split requires at least two lines",
		})
	}

	var totalSplit float64
	for i, s := range input.Splits {
		if s.Amount <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Split line %d must have an amount greater than 0", i+1),
			})
		}
		totalSplit += s.Amount
	}

	if math.Abs(totalSplit-expense.Amount) > 0.015 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Total of split lines ($%.2f) does not match receipt total ($%.2f)", totalSplit, expense.Amount),
		})
	}

	// Begin DB transaction
	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Check if this expense is already linked to bank transactions
	var existingLinks []models.ExpenseBankTransaction
	tx.Where("expense_id = ?", expense.ID).Find(&existingLinks)

	originalTotal := expense.Amount
	originalTax := expense.TaxAmount

	// Pre-calculate tax distribution across splits so the sum matches originalTax to the exact cent
	splitTaxes := make([]float64, len(input.Splits))
	if originalTotal > 0 && originalTax != 0 {
		var allocatedTaxSum float64
		for i := 0; i < len(input.Splits)-1; i++ {
			t := roundCents((input.Splits[i].Amount / originalTotal) * originalTax)
			splitTaxes[i] = t
			allocatedTaxSum += t
		}
		// Remainder allocated to the final line to avoid penny drift
		splitTaxes[len(input.Splits)-1] = roundCents(originalTax - allocatedTaxSum)
	}

	// 1. Update the original expense to become Split Line 1
	first := input.Splits[0]
	expense.Amount = first.Amount
	if first.Description != "" {
		expense.Description = strings.TrimSpace(first.Description)
	}
	if first.Vendor != "" {
		expense.Vendor = strings.TrimSpace(first.Vendor)
	}
	expense.ChartAccountID = first.ChartAccountID
	expense.TaxAmount = splitTaxes[0]

	if first.IsPersonal {
		expense.ReviewStatus = "IGNORED"
		expense.ExclusionReason = "PERSONAL"
		expense.ExclusionNote = "Personal portion of split receipt"
	}

	if err := tx.Save(&expense).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update primary expense line"})
	}

	var createdExpenses []models.Expense

	// 2. Create child expenses for the remaining splits
	for i := 1; i < len(input.Splits); i++ {
		split := input.Splits[i]
		vendor := split.Vendor
		if vendor == "" {
			vendor = expense.Vendor
		}
		desc := split.Description
		if desc == "" {
			desc = fmt.Sprintf("%s (split item %d)", expense.Description, i+1)
		}

		child := models.Expense{
			IsManual:         false,
			Timestamp:        expense.Timestamp,
			Vendor:           vendor,
			Description:      desc,
			Amount:           split.Amount,
			TaxAmount:        splitTaxes[i],
			CurrencyCode:     expense.CurrencyCode,
			Tender:           expense.Tender,
			ChartAccountID:   split.ChartAccountID,
			AllocationStatus: expense.AllocationStatus,
			ReviewStatus:     "APPROVED",
			Notes:            fmt.Sprintf("Split from Expense #%d", expense.ID),
		}

		if split.IsPersonal {
			child.ReviewStatus = "IGNORED"
			child.ExclusionReason = "PERSONAL"
			child.ExclusionNote = "Personal portion of split receipt"
		}

		if err := tx.Create(&child).Error; err != nil {
			tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create child expense split"})
		}

		// Propagate bank transaction link so bank debit remains balanced
		for _, l := range existingLinks {
			childLink := models.ExpenseBankTransaction{
				ExpenseID:         child.ID,
				BankTransactionID: l.BankTransactionID,
				Status:            l.Status,
			}
			if err := tx.Create(&childLink).Error; err != nil {
				tx.Rollback()
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to link split item to bank transaction"})
			}
		}

		// Attach shared receipt files so user can view original receipt image from child expense
		for _, r := range expense.Receipts {
			sharedReceipt := models.Receipt{
				ExpenseID:   &child.ID,
				DocumentURI: r.DocumentURI,
				FileExt:     r.FileExt,
				FileHash:    r.FileHash,
			}
			if err := tx.Create(&sharedReceipt).Error; err != nil {
				tx.Rollback()
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to link receipt to split item"})
			}
		}

		createdExpenses = append(createdExpenses, child)
	}

	if err := tx.Commit().Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to commit expense split"})
	}

	BroadcastEvent("EXPENSES_UPDATED", nil)
	BroadcastEvent("SUMMARY_UPDATED", nil)
	utils.RunReconciliation()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":          "success",
		"originalExpense": expense,
		"createdExpenses": createdExpenses,
		"message":         fmt.Sprintf("Successfully split receipt into %d lines", len(input.Splits)),
	})
}
