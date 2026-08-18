package controllers

import (
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/db"

	"github.com/gofiber/fiber/v3"
)

// GetExpense fetches a single Expense by ID
func GetExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.Preload("Receipts").Preload("SuggestedTransaction").First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "expense": expense})
}

// UpdateExpense allows updating fields on an expense
func UpdateExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	type updateInput struct {
		Vendor      string  `json:"vendor"`
		Description string  `json:"description"`
		Amount      float64 `json:"amount"`
		Tender      string  `json:"tender"`
	}

	var input updateInput
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	db.DB.Model(&expense).Updates(models.Expense{
		Vendor:      input.Vendor,
		Description: input.Description,
		Amount:      input.Amount,
		Tender:      input.Tender,
	})

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success", "expense": expense})
}

// DeleteExpense deletes an expense and its physical receipt records
func DeleteExpense(c fiber.Ctx) error {
	id := c.Params("id")
	var expense models.Expense

	if err := db.DB.First(&expense, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Expense not found"})
	}

	db.DB.Where("expense_id = ?", id).Delete(&models.Receipt{})

	if err := db.DB.Delete(&expense).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete expense"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "success"})
}
