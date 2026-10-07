package controllers

import (
	"fmt"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"
	"strconv"

	"github.com/gofiber/fiber/v3"
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
	query := db.DB.Model(&models.BankTransaction{}).Where("review_status != ?", "IGNORED")

	// Filter by date range if provided
	if startDate != "" {
		query = query.Where("date >= ?", startDate)
	}
	if endDate != "" {
		query = query.Where("date <= ?", endDate)
	}

	if accountId != "" {
		query = query.Where("chart_account_id = ?", accountId)
	}

	if search != "" {
		query = query.Where("description ILIKE ?", "%"+search+"%")
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
		Preload("Receipts").Preload("ChartAccount").
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

// CreateTransaction creates a manually entered bank transaction (no OFX import required).
// BankStatementID is intentionally left null for manual entries.
// The FITID is auto-generated to satisfy the unique constraint.
// Optional chartAccountId can be provided to categorize the transaction.
func CreateTransaction(c fiber.Ctx) error {
	type createInput struct {
		Date            time.Time `json:"date"`
		Description     string    `json:"description"`
		Amount          float64   `json:"amount"`
		TransactionType string    `json:"transactionType"`
		ChartAccountID  *uint     `json:"chartAccountId"`
		Notes           string    `json:"notes"`
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

	tx := models.BankTransaction{
		Date:            input.Date,
		Description:     input.Description,
		Amount:          input.Amount,
		TransactionType: input.TransactionType,
		CategoryAccountID: input.ChartAccountID, // Mapped to CategoryAccountID
		Notes:           input.Notes,
		// Synthetic FITID satisfies the unique constraint on manually entered rows.
		FITID: fmt.Sprintf("MANUAL-%d", time.Now().UnixNano()),
		IsManual: true,
		// BankStatementID left nil — manual entries don't belong to an imported statement.
	}

	if err := db.DB.Create(&tx).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create transaction"})
	}

	go utils.RunReconciliation()

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
		Description    string  `json:"description"`
		Amount         float64 `json:"amount"`
		ChartAccountID *uint   `json:"chartAccountId"`
		Notes          string  `json:"notes"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	db.DB.Model(&tx).Updates(map[string]interface{}{
		"description":         input.Description,
		"amount":              input.Amount,
		"category_account_id": input.ChartAccountID,
		"notes":               input.Notes,
	})

	go utils.RunReconciliation()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "transaction": tx})
}

// DeleteTransaction deletes a transaction and all its join table rows.
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

	if tx.BankStatementID != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot delete a bank transaction that was imported from an OFX file. Please exclude/ignore the transaction instead.",
		})
	}

	// Delete all join table rows for this transaction before deleting the transaction itself.
	// This covers both confirmed and suggested links so nothing is left dangling.
	db.DB.Where("bank_transaction_id = ?", id).Delete(&models.ExpenseBankTransaction{})

	if err := db.DB.Delete(&tx).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete transaction"})
	}

	utils.UpdateReconciliationStatuses()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
