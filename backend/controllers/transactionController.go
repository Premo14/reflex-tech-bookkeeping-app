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
