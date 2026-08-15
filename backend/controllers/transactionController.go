package controllers

import (
	"github.com/gofiber/fiber/v3"
)

// GetTransactions fetches all BankTransactions along with their linked
// Expenses and the physical Receipts, so the frontend can display them.
func GetTransactions(c fiber.Ctx) error {
	// TODO: Fetch from db.DB.Preload("Expenses.Receipts").Find(&transactions)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "not implemented",
	})
}
