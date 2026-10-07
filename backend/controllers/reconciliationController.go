package controllers

import (
	"errors"
	"math"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"fmt"
	"time"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

// GetFlaggedItems fetches all UNMATCHED BankTransactions and all orphaned Expenses.
//
// Optional query parameters:
//   - ?periodId=123    filter to items within that period's date range
func GetFlaggedItems(c fiber.Ctx) error {
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")

	var txs []models.BankTransaction
	txsQuery := db.DB.Model(&models.BankTransaction{}).
		Where("reconciliation_status != ?", "MATCHED")

	var expenses []models.Expense
	expenseQuery := db.DB.Model(&models.Expense{}).
		Where("tender != 'cash'").
		Where("reconciliation_status != ?", "MATCHED")

	// Filter by date range if provided
	if startDate != "" {
		txsQuery = txsQuery.Where("date >= ?", startDate)
		expenseQuery = expenseQuery.Where("timestamp >= ?", startDate)
	}
	if endDate != "" {
		txsQuery = txsQuery.Where("date <= ?", endDate)
		expenseQuery = expenseQuery.Where("timestamp <= ?", endDate)
	}

	txsQuery.Order("date DESC").Preload("Expenses.Receipts").Find(&txs)
	expenseQuery.Order("timestamp DESC").Preload("Receipts").Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
		"expenses":     expenses,
	})
}

// LinkExpenseToTransaction manually forces an Expense to link to a BankTransaction.
func LinkExpenseToTransaction(c fiber.Ctx) error {
	type LinkRequest struct {
		ExpenseID              uint  `json:"expenseId"`
		TransactionID          uint  `json:"transactionId"`
		OverrideChartAccountID *uint `json:"overrideChartAccountId"`
		Force                  bool  `json:"force"`
	}

	var req LinkRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	var txToLink models.BankTransaction
	if err := db.DB.Where("id = ?", req.TransactionID).Preload("Expenses").First(&txToLink).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "transaction not found"})
	}

	var expenseToLink models.Expense
	if err := db.DB.Where("id = ?", req.ExpenseID).Preload("BankTransactions").First(&expenseToLink).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "expense not found"})
	}

	// Guard: pending/ignored
	if txToLink.ReviewStatus == "PENDING" || txToLink.ReviewStatus == "IGNORED" || expenseToLink.ReviewStatus == "PENDING" || expenseToLink.ReviewStatus == "IGNORED" {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot link items that are pending review or ignored."})
	}

	// Guard: neither side can be in a closed period
	if utils.IsDateInClosedPeriod(txToLink.Date) || utils.IsDateInClosedPeriod(expenseToLink.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot modify links for items in a closed accounting period."})
	}

	// Guard: cash expenses
	if expenseToLink.Tender == "cash" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot link a cash expense to a bank transaction."})
	}

	// Guard: deposits
	if txToLink.Amount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot link an expense to a deposit/income transaction."})
	}

	// Check if already linked
	isAlreadyLinked := false
	for _, e := range txToLink.Expenses {
		if e.ID == req.ExpenseID {
			isAlreadyLinked = true
			break
		}
	}
	if isAlreadyLinked {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "already linked"})
	}

	// Guard: M:N web. An expense linked to multiple transactions cannot link to a transaction linked to multiple expenses.
	// If the expense is already linked to a transaction, and the target transaction is already linked to an expense, reject.
	var txLinkCount int64
	db.DB.Model(&models.ExpenseBankTransaction{}).Where("bank_transaction_id = ? AND status = 'confirmed'", req.TransactionID).Count(&txLinkCount)
	var expLinkCount int64
	db.DB.Model(&models.ExpenseBankTransaction{}).Where("expense_id = ? AND status = 'confirmed'", req.ExpenseID).Count(&expLinkCount)
	
	if txLinkCount > 0 && expLinkCount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot link this expense and transaction because both are already linked to other items. This would create a many-to-many relationship."})
	}

	// Constraint: an expense with multiple receipt files may only link to one transaction.
	var receiptCount int64
	db.DB.Model(&models.Receipt{}).Where("expense_id = ?", req.ExpenseID).Count(&receiptCount)
	if receiptCount > 1 && expLinkCount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "this expense has multiple receipt files and is already linked to a transaction — split-payment links are only allowed for single-receipt expenses",
		})
	}

	if !req.Force {
	// Guard: over-allocation of the transaction.
	var currentlyLinkedSum float64
	db.DB.Model(&models.Expense{}).
		Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
		Where("ebt.bank_transaction_id = ? AND ebt.status = 'confirmed'", req.TransactionID).
		Select("COALESCE(SUM(expenses.amount), 0)").Scan(&currentlyLinkedSum)
	
	txAmount := math.Abs(txToLink.Amount)
	if currentlyLinkedSum+expenseToLink.Amount > txAmount+0.01 { // allow 1 cent floating point rounding
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "OVER_ALLOCATED",
			"message": "This link would over-allocate the transaction. The transaction amount is less than the sum of the linked expenses.",
		})
	}

	// Guard: over-allocation of the expense.
	var currentlyLinkedTxSum float64
	db.DB.Model(&models.BankTransaction{}).
		Joins("JOIN expense_bank_transactions ebt ON ebt.bank_transaction_id = bank_transactions.id").
		Where("ebt.expense_id = ? AND ebt.status = 'confirmed'", req.ExpenseID).
		Select("COALESCE(SUM(ABS(bank_transactions.amount)), 0)").Scan(&currentlyLinkedTxSum)

	if currentlyLinkedTxSum+txAmount > expenseToLink.Amount+0.01 { // allow 1 cent floating point rounding
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "OVER_ALLOCATED",
			"message": "This link would over-allocate the expense. The expense amount is less than the sum of the linked bank transactions.",
		})
	}
	}


	// Wrap in a DB transaction
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		// Delete any existing row for this pair first (e.g. "suggested")
		tx.Where("expense_id = ? AND bank_transaction_id = ?", req.ExpenseID, req.TransactionID).
			Delete(&models.ExpenseBankTransaction{})

		// Ensure categories match. Split transactions allow different categories on the expenses, 
		// but if it's a 1:1 link or the first link, or if the user provides an override, we apply it.
		// For 1:many (1 Tx -> Many Expenses), the Tx's category might not match the new Expense,
		// but since it's a split, we allow it UNLESS the Expense has NO category.
		if req.OverrideChartAccountID != nil {
			txToLink.CategoryAccountID = req.OverrideChartAccountID
			expenseToLink.ChartAccountID = req.OverrideChartAccountID
			tx.Save(&txToLink)
			tx.Save(&expenseToLink)
		} else if txLinkCount == 0 && expLinkCount == 0 { // 1:1 linking rules
			if txToLink.CategoryAccountID != nil && expenseToLink.ChartAccountID != nil {
				if *txToLink.CategoryAccountID != *expenseToLink.ChartAccountID {
					// We return a specific error that the handler checks to return the 400 response
					return errors.New("CATEGORY_MISMATCH")
				}
			} else if txToLink.CategoryAccountID != nil && expenseToLink.ChartAccountID == nil {
				expenseToLink.ChartAccountID = txToLink.CategoryAccountID
				tx.Save(&expenseToLink)
			} else if expenseToLink.ChartAccountID != nil && txToLink.CategoryAccountID == nil {
				txToLink.CategoryAccountID = expenseToLink.ChartAccountID
				tx.Save(&txToLink)
			}
		} else if txLinkCount > 0 { // Split transaction (1 Tx -> Many Exp)
			// Expense must have a category if it's part of a split
			if expenseToLink.ChartAccountID == nil {
				if txToLink.CategoryAccountID != nil {
					expenseToLink.ChartAccountID = txToLink.CategoryAccountID
					tx.Save(&expenseToLink)
				}
			}
			// If it has a category, we let it be different (Split)
		} else if expLinkCount > 0 { // Split expense (1 Exp -> Many Tx)
			// Tx must have a category if it's part of a split
			if txToLink.CategoryAccountID == nil {
				if expenseToLink.ChartAccountID != nil {
					txToLink.CategoryAccountID = expenseToLink.ChartAccountID
					tx.Save(&txToLink)
				}
			}
			// Strict category match for 1 Exp -> Many Tx, since an expense represents one receipt
			if txToLink.CategoryAccountID != nil && expenseToLink.ChartAccountID != nil {
				if *txToLink.CategoryAccountID != *expenseToLink.ChartAccountID {
					return errors.New("CATEGORY_MISMATCH")
				}
			}
		}

		// Create the confirmed link
		if err := tx.Create(&models.ExpenseBankTransaction{
			ExpenseID:         req.ExpenseID,
			BankTransactionID: req.TransactionID,
			Status:            "confirmed",
		}).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		if err.Error() == "CATEGORY_MISMATCH" {
			var txAcc, expAcc models.ChartAccount
			db.DB.First(&txAcc, *txToLink.CategoryAccountID)
			db.DB.First(&expAcc, *expenseToLink.ChartAccountID)
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":               "CATEGORY_MISMATCH",
				"message":             "The Bank Transaction and Expense have different categories. Which one should both items use?",
				"transactionCategory": txAcc,
				"expenseCategory":     expAcc,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to link items: " + err.Error()})
	}

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "successfully linked receipt to expense",
	})
}

// UnlinkExpense removes a specific confirmed link between an Expense and a BankTransaction.
func UnlinkExpense(c fiber.Ctx) error {
	type UnlinkRequest struct {
		ExpenseID uint `json:"expenseId"`
		// TransactionID is required because an expense can be linked to multiple
		// transactions (split payments), so we need to know which specific link to remove.
		TransactionID uint `json:"transactionId"`
	}

	var req UnlinkRequest
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	var tx models.BankTransaction
	if err := db.DB.First(&tx, req.TransactionID).Error; err == nil {
		if utils.IsDateInClosedPeriod(tx.Date) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "Cannot unlink items in a closed accounting period.",
			})
		}
	}

	var exp models.Expense
	if err := db.DB.First(&exp, req.ExpenseID).Error; err == nil {
		if utils.IsDateInClosedPeriod(exp.Timestamp) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "Cannot unlink items in a closed accounting period.",
			})
		}
	}

	// Delete the specific join row for this expense+transaction pair.
	result := db.DB.Where("expense_id = ? AND bank_transaction_id = ?", req.ExpenseID, req.TransactionID).
		Delete(&models.ExpenseBankTransaction{})

	if result.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "link not found"})
	}

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "successfully unlinked expense",
	})
}

// MarkExpenseAsCash flags an Expense's tender as "cash" so it doesn't need reconciliation.
func MarkExpenseAsCash(c fiber.Ctx) error {
	id := c.Params("id")

	var expense models.Expense
	result := db.DB.Where("id = ?", id).First(&expense)

	if result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Expense not found",
		})
	}

	if utils.IsDateInClosedPeriod(expense.Timestamp) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot modify an expense in a closed accounting period.",
		})
	}

	expense.Tender = "cash"
	db.DB.Save(&expense)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "successfully marked expense tender as cash",
	})
}

// GetUnlinkedItems fetches unlinked items with pagination, search, and "best match" sorting.
func GetUnlinkedItems(c fiber.Ctx) error {
	type QueryParam struct {
		Search       string  `query:"search"`
		Page         int     `query:"page"`
		Limit        int     `query:"limit"`
		TargetAmount float64 `query:"targetAmount"`
		TargetDate   string  `query:"targetDate"`
		StartDate    string  `query:"startDate"`
		EndDate      string  `query:"endDate"`
	}
	var params QueryParam
	if err := c.Bind().Query(&params); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid query params"})
	}

	page := params.Page
	if page < 1 {
		page = 1
	}
	limit := params.Limit
	if limit < 1 {
		limit = 50
	}
	offset := (page - 1) * limit

	// Base queries
	txQuery := db.DB.Model(&models.BankTransaction{}).Where("reconciliation_status != ?", "MATCHED")
	expQuery := db.DB.Model(&models.Expense{}).Where("tender != 'cash'").
		Where("reconciliation_status != ?", "MATCHED")

	// Date Range
	if params.StartDate != "" {
		txQuery = txQuery.Where("date >= ?", params.StartDate)
		expQuery = expQuery.Where("timestamp >= ?", params.StartDate)
	}
	if params.EndDate != "" {
		txQuery = txQuery.Where("date <= ?", params.EndDate)
		expQuery = expQuery.Where("timestamp <= ?", params.EndDate)
	}

	// Search
	if params.Search != "" {
		searchStr := strings.TrimSpace(params.Search)
		// if search is a number, allow searching by exact absolute amount as well
		if val, err := strconv.ParseFloat(strings.TrimPrefix(searchStr, "$"), 64); err == nil {
			txQuery = txQuery.Where("description ILIKE ? OR ABS(amount) = ?", "%"+searchStr+"%", math.Abs(val))
			expQuery = expQuery.Where("vendor ILIKE ? OR description ILIKE ? OR ABS(amount) = ?", "%"+searchStr+"%", "%"+searchStr+"%", math.Abs(val))
		} else {
			txQuery = txQuery.Where("description ILIKE ?", "%"+searchStr+"%")
			expQuery = expQuery.Where("vendor ILIKE ? OR description ILIKE ?", "%"+searchStr+"%", "%"+searchStr+"%")
		}
	}

	// Counts
	var totalTxs int64
	var totalExps int64
	txQuery.Count(&totalTxs)
	expQuery.Count(&totalExps)

	// Sorting: Sort by match score if target amounts/dates are provided.
	// Highest score = lowest distance.
	if params.TargetAmount != 0 || params.TargetDate != "" {
		amountClause := "0"
		if params.TargetAmount != 0 {
			// e.g. difference in amounts
			amountClause = fmt.Sprintf("ABS(ABS(amount) - ABS(%f))", params.TargetAmount)
		}
		
		txDateClause := "0"
		expDateClause := "0"
		if params.TargetDate != "" {
			// date difference in days. PostgreSQL EXTRACT(EPOCH FROM (date1 - date2)) / 86400
			txDateClause = fmt.Sprintf("ABS(EXTRACT(EPOCH FROM (date - '%s'::timestamp)) / 86400.0)", params.TargetDate)
			expDateClause = fmt.Sprintf("ABS(EXTRACT(EPOCH FROM (timestamp - '%s'::timestamp)) / 86400.0)", params.TargetDate)
		}

		// Weight: amount diff * 100 + date diff in days.
		txScore := fmt.Sprintf("(%s * 100) + %s", amountClause, txDateClause)
		expScore := fmt.Sprintf("(%s * 100) + %s", amountClause, expDateClause)

		txQuery = txQuery.Order(fmt.Sprintf("%s ASC", txScore))
		expQuery = expQuery.Order(fmt.Sprintf("%s ASC", expScore))
	} else {
		txQuery = txQuery.Order("date DESC")
		expQuery = expQuery.Order("timestamp DESC")
	}

	// Fetch
	var txs []models.BankTransaction
	txQuery.Preload("ChartAccount").Offset(offset).Limit(limit).Find(&txs)

	var expenses []models.Expense
	expQuery.Preload("Receipts").Preload("ChartAccount").Offset(offset).Limit(limit).Find(&expenses)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":          "success",
		"transactions":    txs,
		"totalTxs":        totalTxs,
		"expenses":        expenses,
		"totalExpenses":   totalExps,
		"page":            page,
		"limit":           limit,
	})
}

// CreateAndLink creates a new Transaction or Expense and immediately links it.
// If any step fails, the creation is rolled back (atomic).
func CreateAndLink(c fiber.Ctx) error {
	type createLinkReq struct {
		Type                   string    `json:"type"` // "transaction" or "receipt"
		TargetID               uint      `json:"targetId"` // The ID of the item being linked to
		OverrideChartAccountID *uint     `json:"overrideChartAccountId"`
		// Payload for the new item
		Timestamp       time.Time `json:"timestamp"` // for expense
		Date            time.Time `json:"date"`      // for transaction
		Vendor          string    `json:"vendor"`
		Description     string    `json:"description"`
		Amount          float64   `json:"amount"`
		Tender          string    `json:"tender"`
		TransactionType string    `json:"transactionType"`
		Notes           string    `json:"notes"`
		ChartAccountID  *uint     `json:"chartAccountId"` // category
		Force           bool      `json:"force"`
	}

	var req createLinkReq
	if err := c.Bind().JSON(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload"})
	}

	var newExpenseID, newTxID uint

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if req.Type == "transaction" {
			// Creating an expense to link to an existing transaction
			var existingTx models.BankTransaction
			if err := tx.Preload("Expenses").First(&existingTx, req.TargetID).Error; err != nil {
				return errors.New("TARGET_NOT_FOUND")
			}
			if existingTx.ReviewStatus == "PENDING" || existingTx.ReviewStatus == "IGNORED" {
				return errors.New("TARGET_INVALID_STATUS")
			}
			if utils.IsDateInClosedPeriod(existingTx.Date) || utils.IsDateInClosedPeriod(req.Timestamp) {
				return errors.New("CLOSED_PERIOD")
			}
			if req.Tender == "cash" {
				return errors.New("NO_CASH_LINKS")
			}
			if existingTx.Amount > 0 {
				return errors.New("NO_DEPOSIT_LINKS")
			}

			// Validate allocation
			var linkedSum float64
			tx.Model(&models.Expense{}).
				Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
				Where("ebt.bank_transaction_id = ? AND ebt.status = 'confirmed'", req.TargetID).
				Select("COALESCE(SUM(expenses.amount), 0)").Scan(&linkedSum)
			if !req.Force && linkedSum+req.Amount > math.Abs(existingTx.Amount)+0.01 {
				return errors.New("OVER_ALLOCATED")
			}

			expense := models.Expense{
				Timestamp:            req.Timestamp,
				Vendor:               req.Vendor,
				Description:          req.Description,
				Amount:               math.Abs(req.Amount),
				Tender:               req.Tender,
				ChartAccountID:       req.ChartAccountID,
				Notes:                req.Notes,
				ReconciliationStatus: "UNMATCHED",
				ReviewStatus:         "APPROVED",
			}
			if err := tx.Create(&expense).Error; err != nil {
				return err
			}
			newExpenseID = expense.ID
			newTxID = req.TargetID
			
			// Category logic for 1:Many (Split transaction)
			var txLinkCount int64
			tx.Model(&models.ExpenseBankTransaction{}).Where("bank_transaction_id = ? AND status = 'confirmed'", req.TargetID).Count(&txLinkCount)
			
			if req.OverrideChartAccountID != nil {
				existingTx.CategoryAccountID = req.OverrideChartAccountID
				expense.ChartAccountID = req.OverrideChartAccountID
				tx.Save(&existingTx)
				tx.Save(&expense)
			} else if txLinkCount == 0 { // 1:1
				if existingTx.CategoryAccountID != nil && expense.ChartAccountID != nil {
					if *existingTx.CategoryAccountID != *expense.ChartAccountID {
						return errors.New("CATEGORY_MISMATCH")
					}
				} else if existingTx.CategoryAccountID != nil && expense.ChartAccountID == nil {
					expense.ChartAccountID = existingTx.CategoryAccountID
					tx.Save(&expense)
				} else if expense.ChartAccountID != nil && existingTx.CategoryAccountID == nil {
					existingTx.CategoryAccountID = expense.ChartAccountID
					tx.Save(&existingTx)
				}
			} else { // 1:Many split
				if expense.ChartAccountID == nil && existingTx.CategoryAccountID != nil {
					expense.ChartAccountID = existingTx.CategoryAccountID
					tx.Save(&expense)
				}
			}

		} else if req.Type == "receipt" {
			// Creating a transaction to link to an existing expense
			var existingExp models.Expense
			if err := tx.Preload("BankTransactions").First(&existingExp, req.TargetID).Error; err != nil {
				return errors.New("TARGET_NOT_FOUND")
			}
			if existingExp.ReviewStatus == "PENDING" || existingExp.ReviewStatus == "IGNORED" {
				return errors.New("TARGET_INVALID_STATUS")
			}
			if utils.IsDateInClosedPeriod(existingExp.Timestamp) || utils.IsDateInClosedPeriod(req.Date) {
				return errors.New("CLOSED_PERIOD")
			}
			if existingExp.Tender == "cash" {
				return errors.New("NO_CASH_LINKS")
			}
			if req.Amount > 0 { // req.Amount is the amount of the transaction being created
				return errors.New("NO_DEPOSIT_LINKS") // can't create a deposit to link to an expense
			}
			
			// Constraint: an expense with multiple receipt files may only link to one transaction.
			var expLinkCount int64
			tx.Model(&models.ExpenseBankTransaction{}).Where("expense_id = ? AND status = 'confirmed'", req.TargetID).Count(&expLinkCount)
			
			var receiptCount int64
			tx.Model(&models.Receipt{}).Where("expense_id = ?", req.TargetID).Count(&receiptCount)
			if receiptCount > 1 && expLinkCount > 0 {
				return errors.New("MULTI_RECEIPT_SPLIT")
			}
			
			bankTx := models.BankTransaction{
				Date:                 req.Date,
				Description:          req.Description,
				Amount:               req.Amount, // frontend passes it as positive or negative, but we need negative for DEBIT. We'll enforce this below.
				TransactionType:      req.TransactionType,
				CategoryAccountID:    req.ChartAccountID,
				Notes:                req.Notes,
				FITID:                fmt.Sprintf("MANUAL-%d", time.Now().UnixNano()),
				ReconciliationStatus: "UNMATCHED",
				ReviewStatus:         "APPROVED",
			}
			if bankTx.TransactionType == "DEBIT" || bankTx.TransactionType == "PAYMENT" {
				bankTx.Amount = -math.Abs(req.Amount)
			} else if bankTx.TransactionType == "DEP" {
				bankTx.Amount = math.Abs(req.Amount)
			}
			
			if bankTx.Amount > 0 {
				return errors.New("NO_DEPOSIT_LINKS")
			}

			// Validate allocation
			var linkedSum float64
			tx.Model(&models.Expense{}).
				Joins("JOIN expense_bank_transactions ebt ON ebt.expense_id = expenses.id").
				Where("ebt.bank_transaction_id = ? AND ebt.status = 'confirmed'", bankTx.ID). // bankTx ID doesn't exist yet, but existing links would be 0
				Select("COALESCE(SUM(expenses.amount), 0)").Scan(&linkedSum)
				
			// Since we're creating the transaction, it has no other links, but the expense might be linked to other transactions.
			// The transaction amount we create must be AT LEAST the size of the expense being linked.
			if !req.Force && existingExp.Amount > math.Abs(bankTx.Amount)+0.01 {
				return errors.New("OVER_ALLOCATED_EXPENSE")
			}

			if err := tx.Create(&bankTx).Error; err != nil {
				return err
			}
			newTxID = bankTx.ID
			newExpenseID = req.TargetID

			if req.OverrideChartAccountID != nil {
				bankTx.CategoryAccountID = req.OverrideChartAccountID
				existingExp.ChartAccountID = req.OverrideChartAccountID
				tx.Save(&bankTx)
				tx.Save(&existingExp)
			} else if expLinkCount == 0 { // 1:1
				if bankTx.CategoryAccountID != nil && existingExp.ChartAccountID != nil {
					if *bankTx.CategoryAccountID != *existingExp.ChartAccountID {
						return errors.New("CATEGORY_MISMATCH")
					}
				} else if bankTx.CategoryAccountID != nil && existingExp.ChartAccountID == nil {
					existingExp.ChartAccountID = bankTx.CategoryAccountID
					tx.Save(&existingExp)
				} else if existingExp.ChartAccountID != nil && bankTx.CategoryAccountID == nil {
					bankTx.CategoryAccountID = existingExp.ChartAccountID
					tx.Save(&bankTx)
				}
			} else { // 1 Exp -> Many Tx (Split expense)
				if bankTx.CategoryAccountID == nil && existingExp.ChartAccountID != nil {
					bankTx.CategoryAccountID = existingExp.ChartAccountID
					tx.Save(&bankTx)
				}
				if bankTx.CategoryAccountID != nil && existingExp.ChartAccountID != nil && *bankTx.CategoryAccountID != *existingExp.ChartAccountID {
					return errors.New("CATEGORY_MISMATCH")
				}
			}
		}

		// Delete any existing row (e.g. "suggested")
		tx.Where("expense_id = ? AND bank_transaction_id = ?", newExpenseID, newTxID).
			Delete(&models.ExpenseBankTransaction{})

		if err := tx.Create(&models.ExpenseBankTransaction{
			ExpenseID:         newExpenseID,
			BankTransactionID: newTxID,
			Status:            "confirmed",
		}).Error; err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		switch err.Error() {
		case "TARGET_NOT_FOUND":
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Target item not found"})
		case "TARGET_INVALID_STATUS":
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot link to an item that is pending review or ignored"})
		case "CLOSED_PERIOD":
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot modify items in a closed accounting period"})
		case "NO_CASH_LINKS":
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot link a cash expense to a bank transaction"})
		case "NO_DEPOSIT_LINKS":
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot link an expense to a deposit/income transaction"})
		case "MULTI_RECEIPT_SPLIT":
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "This expense has multiple receipt files and is already linked to a transaction. Split-payment links are only allowed for single-receipt expenses."})
		case "OVER_ALLOCATED":
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "OVER_ALLOCATED",
				"message": "This link would over-allocate the transaction. The transaction amount is less than the sum of the linked expenses.",
			})
		case "OVER_ALLOCATED_EXPENSE":
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "OVER_ALLOCATED",
				"message": "The transaction amount you are creating is smaller than the expense you are linking it to.",
			})
		case "CATEGORY_MISMATCH":
			var txAcc, expAcc models.ChartAccount
			if req.Type == "transaction" {
				var tx models.BankTransaction
				var exp models.Expense
				// Re-fetch using standard DB, not the transaction that was rolled back
				db.DB.First(&tx, req.TargetID)
				db.DB.First(&exp, newExpenseID) // newExpenseID might not exist due to rollback, but we have req.ChartAccountID
				if tx.CategoryAccountID != nil { db.DB.First(&txAcc, *tx.CategoryAccountID) }
				if req.ChartAccountID != nil { db.DB.First(&expAcc, *req.ChartAccountID) }
			} else {
				var exp models.Expense
				db.DB.First(&exp, req.TargetID)
				if req.ChartAccountID != nil { db.DB.First(&txAcc, *req.ChartAccountID) }
				if exp.ChartAccountID != nil { db.DB.First(&expAcc, *exp.ChartAccountID) }
			}
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":               "CATEGORY_MISMATCH",
				"message":             "The Bank Transaction and Expense have different categories. Which one should both items use?",
				"transactionCategory": txAcc,
				"expenseCategory":     expAcc,
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create and link items: " + err.Error()})
		}
	}

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "successfully created and linked",
		"expenseId": newExpenseID,
		"transactionId": newTxID,
	})
}
