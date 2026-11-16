package controllers

import (
	"encoding/json"
	"fmt"
	"math"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
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
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}

	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.Preload("Receipts").Preload("ChartAccount").Preload("Invoice").Preload("Invoice.CategoryAccount").First(&expense, "id = ?", id).Error; err != nil {
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

	// Load ranked suggested transactions (persisted reconciler guesses + scored open debit candidates).
	suggestedTransactionCandidates, suggestedTransactions := utils.FindExpenseMatchCandidates(db.DB, expense, confirmedTransactions)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":                         "success",
		"expense":                        expense,
		"confirmedTransactions":          confirmedTransactions,
		"suggestedTransactions":          suggestedTransactions,
		"suggestedTransactionCandidates": suggestedTransactionCandidates,
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
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}

	type createInput struct {
		Date           *string `json:"date"`
		Timestamp      *string `json:"timestamp"`
		Vendor         string  `json:"vendor"`
		Description    string  `json:"description"`
		Amount         models.Money   `json:"amount"`
		TaxAmount      models.Money   `json:"taxAmount"`
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
		Amount:           input.Amount.Abs(),
		TaxAmount:        input.TaxAmount.Abs(),
		Tender:           normTender,
		ChartAccountID:   input.ChartAccountID,
		Notes:            input.Notes,
		IsManual:         true,
		AllocationStatus: initialAllocation,
		ReviewStatus:     "APPROVED",
	}

	// Auto-evaluate bank rules for category, vendor normalization, and notes
	utils.ApplyBankRulesToExpense(&expense, db.DB)

	if err := db.DB.Create(&expense).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create expense"})
	}

	utils.RunReconciliation()
	events.Broadcast("EXPENSES_UPDATED", nil)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	events.Broadcast("RECONCILIATION_UPDATED", nil)
	events.Broadcast("SUMMARY_UPDATED", nil)
	events.Broadcast("QUEUE_UPDATED", nil)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "success", "expense": expense})
}

// GetExpenses fetches all expenses, optionally filtered by period or chart account.
//
// Optional query parameters:
//   - ?periodId=123    filter to expenses within that period's date range
//   - ?accountId=5     filter by ChartAccountID (which expense category)
func GetExpenses(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}

	startDate := c.Query("startDate")
	endDate := c.Query("endDate")
	accountId := c.Query("accountId")

	var expenses []models.Expense
	query := db.DB.Model(&models.Expense{}).Where("COALESCE(review_status, '') NOT IN ('IGNORED', 'DELETED')")

	// Filter by date range if provided
	query = ApplyDateRange(query, "timestamp", startDate, endDate)

	if accountId != "" {
		parsedID, err := strconv.ParseUint(accountId, 10, 32)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid accountId"})
		}
		accountIDs := GetAccountAndDescendantIDs(uint(parsedID))
		query = query.Where(
			"chart_account_id IN ? OR id IN (SELECT ebt.expense_id FROM expense_bank_transactions ebt JOIN bank_transactions bt ON bt.id = ebt.bank_transaction_id WHERE ebt.status = 'confirmed' AND bt.chart_account_id IN ?)",
			accountIDs, accountIDs,
		)
	}

	search := strings.TrimSpace(c.Query("search"))
	if search != "" {
		lowerSearch := "%" + strings.ToLower(search) + "%"
		if val, err := strconv.ParseFloat(strings.TrimPrefix(search, "$"), 64); err == nil {
			query = query.Where("LOWER(vendor) LIKE ? OR LOWER(description) LIKE ? OR LOWER(notes) LIKE ? OR amount = ?", lowerSearch, lowerSearch, lowerSearch, math.Abs(val))
		} else {
			query = query.Where("LOWER(vendor) LIKE ? OR LOWER(description) LIKE ? OR LOWER(notes) LIKE ?", lowerSearch, lowerSearch, lowerSearch)
		}
	}

	statusFilter := strings.ToUpper(strings.TrimSpace(c.Query("status")))
	switch statusFilter {
	case "NEEDS_ATTENTION":
		query = query.Where(notCashClause).Where(needsAttentionClause)
	case "UNLINKED":
		query = query.Where(notCashClause).Where("allocation_status IS NULL OR allocation_status = '' OR allocation_status = 'UNLINKED'")
	case "BALANCED":
		query = query.Where("allocation_status = 'BALANCED' OR " + isCashClause)
	case "PARTIALLY_ALLOCATED", "PARTIAL":
		query = query.Where("allocation_status IN ('PARTIALLY_ALLOCATED', 'PARTIAL')")
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
	if limit > 200 {
		limit = 200
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
		WHEN allocation_status IN ('PARTIALLY_ALLOCATED', 'PARTIAL') THEN 2
		WHEN ` + notCashClause + ` AND COALESCE(allocation_status, 'UNLINKED') = 'UNLINKED' THEN 3
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
	}).Preload("BankTransactions.Category").Preload("ChartAccount").Preload("Invoice").Offset(offset).Limit(limit).Find(&expenses)

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
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}

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
		Amount         *models.Money   `json:"amount"`
		TaxAmount      *models.Money   `json:"taxAmount"`
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
		updates["amount"] = input.Amount.Abs()
	}
	if input.TaxAmount != nil {
		updates["tax_amount"] = input.TaxAmount.Abs()
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

	effectiveAmtCents := expense.Amount.Abs().Cents
	if input.Amount != nil {
		effectiveAmtCents = input.Amount.Abs().Cents
	}
	effectiveTimestamp := expense.Timestamp
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
			effectiveTimestamp = newDate
		}
	}

	// Promote open-period PENDING missing-data receipts once edited with a valid non-zero amount.
	if expense.ReviewStatus == "PENDING" && !utils.IsDateInClosedPeriod(effectiveTimestamp) && effectiveAmtCents > 0 {
		updates["review_status"] = "APPROVED"
	}

	if err := db.DB.Model(&expense).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update expense"})
	}

	utils.RunReconciliation()
	events.Broadcast("EXPENSES_UPDATED", nil)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	events.Broadcast("RECONCILIATION_UPDATED", nil)
	events.Broadcast("SUMMARY_UPDATED", nil)
	events.Broadcast("QUEUE_UPDATED", nil)

	_ = db.DB.Preload("Receipts").Preload("ChartAccount").Preload("Invoice").First(&expense, "id = ?", expense.ID)
	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "expense": expense})
}

// DeleteExpense soft-deletes an expense, unlinks it, and moves it to Deleted Items.
func DeleteExpense(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}

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

	now := time.Now()
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		// Delete join table relationships so it is unlinked from active books
		if err := tx.Where("expense_id = ?", id).Delete(&models.ExpenseBankTransaction{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&expense).Updates(map[string]interface{}{
			"review_status": "DELETED",
			"deleted_at":    now,
		}).Error; err != nil {
			return err
		}
		return tx.Create(&models.ItemAuditLog{
			ItemType: "expense",
			ItemID:   expense.ID,
			Action:   "DELETED",
			GroupID:  fmt.Sprintf("G%d", time.Now().UnixNano()),
		}).Error
	}); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete expense"})
	}

	utils.RunReconciliation()
	events.Broadcast("EXPENSES_UPDATED", nil)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	events.Broadcast("RECONCILIATION_UPDATED", nil)
	events.Broadcast("SUMMARY_UPDATED", nil)
	events.Broadcast("QUEUE_UPDATED", nil)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}

type SplitLineInput struct {
	Amount          models.Money `json:"amount"`
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
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database not initialized"})
	}

	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.Preload("Receipts").First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	if expense.ReviewStatus == "DELETED" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Cannot split a deleted expense.",
		})
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

	var totalSplitCents int64
	for i := range input.Splits {
		s := &input.Splits[i]
		if s.Amount.Cents <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Split line %d must have an amount greater than 0", i+1),
			})
		}
		if s.ChartAccountID != nil && *s.ChartAccountID == 0 {
			s.ChartAccountID = nil
		}
		// Validate chart account if provided: must exist, be active, and be EXPENSE (5xxx)
		if s.ChartAccountID != nil {
			var acc models.ChartAccount
			if err := db.DB.Select("id, code, name, active, type").First(&acc, *s.ChartAccountID).Error; err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": fmt.Sprintf("Split line %d chart account not found", i+1),
				})
			}
			if err := ValidateExpenseCategory(&acc); err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": fmt.Sprintf("Split line %d: %s", i+1, err.Error()),
				})
			}
		}
		totalSplitCents += s.Amount.Cents
	}

	if totalSplitCents != expense.Amount.Cents {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Total of split lines ($%.2f) does not match receipt total ($%.2f)", float64(totalSplitCents)/100, expense.Amount.Dollars()),
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

	origCents := expense.Amount.Cents
	origTaxCents := expense.TaxAmount.Cents

	// Pre-calculate tax distribution across splits in exact integer cents
	splitTaxCents := make([]int64, len(input.Splits))
	if origCents > 0 && origTaxCents != 0 {
		var allocatedTaxSum int64
		for i := 0; i < len(input.Splits)-1; i++ {
			t := (input.Splits[i].Amount.Cents * origTaxCents) / origCents
			splitTaxCents[i] = t
			allocatedTaxSum += t
		}
		// Remainder allocated to the final line to avoid any penny drift
		splitTaxCents[len(input.Splits)-1] = origTaxCents - allocatedTaxSum
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
	expense.TaxAmount = models.Money{Cents: splitTaxCents[0]}

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
			TaxAmount:        models.Money{Cents: splitTaxCents[i]},
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

	events.Broadcast("EXPENSES_UPDATED", nil)
	events.Broadcast("SUMMARY_UPDATED", nil)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	events.Broadcast("RECONCILIATION_UPDATED", nil)
	events.Broadcast("QUEUE_UPDATED", nil)
	utils.RunReconciliation()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":          "success",
		"originalExpense": expense,
		"createdExpenses": createdExpenses,
		"message":         fmt.Sprintf("Successfully split receipt into %d lines", len(input.Splits)),
	})
}
