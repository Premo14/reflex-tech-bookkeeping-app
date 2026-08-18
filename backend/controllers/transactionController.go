package controllers

import (
	"reflex-tech-bookkeeping-app-api/models"

	"reflex-tech-bookkeeping-app-api/db"

	"github.com/gofiber/fiber/v3"
)

// GetTransactions fetches all BankTransactions along with their linked
// Expenses and the physical Receipts, so the frontend can display them.
// Expects optional query parameters: ?year=2026 & month=8 & search=walmart
func GetTransactions(c fiber.Ctx) error {
	year := c.Query("year")
	month := c.Query("month")
	search := c.Query("search")

	var txs []models.BankTransaction
	query := db.DB.Model(&models.BankTransaction{})

	if year != "" {
		query = query.Where("EXTRACT(YEAR FROM date) = ?", year)
	}
	if month != "" {
		query = query.Where("EXTRACT(MONTH FROM date) = ?", month)
	}
	if search != "" {
		query = query.Where("description ILIKE ?", "%"+search+"%")
	}

	query.Order("date DESC").Preload("Expenses.Receipts").Find(&txs)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":       "success",
		"transactions": txs,
	})
}

// GetTransaction fetches a single BankTransaction by ID
func GetTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.Preload("Expenses.Receipts").Preload("SuggestedExpense").First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "transaction": tx})
}

// UpdateTransaction allows updating fields on a transaction
func UpdateTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	type updateInput struct {
		Description string  `json:"description"`
		Amount      float64 `json:"amount"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	db.DB.Model(&tx).Updates(models.BankTransaction{
		Description: input.Description,
		Amount:      input.Amount,
	})

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "transaction": tx})
}

// DeleteTransaction deletes a transaction and nullifies the BankTransactionID on its linked expenses
func DeleteTransaction(c fiber.Ctx) error {
	id := c.Params("id")
	var tx models.BankTransaction

	if err := db.DB.First(&tx, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Transaction not found"})
	}

	// Unlink expenses
	db.DB.Model(&models.Expense{}).Where("bank_transaction_id = ?", id).Update("bank_transaction_id", nil)

	if err := db.DB.Delete(&tx).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete transaction"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
