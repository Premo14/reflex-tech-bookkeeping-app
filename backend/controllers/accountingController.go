package controllers

import (
	"github.com/gofiber/fiber/v3"
)

// GetAccountingPeriods fetches all AccountingPeriods from the database
func GetAccountingPeriods(c fiber.Ctx) error {
	// TODO: Fetch from db.DB
	
	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "not implemented",
	})
}

// CloseAccountingPeriod attempts to close a month if there are no flagged items
func CloseAccountingPeriod(c fiber.Ctx) error {
	// TODO: Get period_id from JSON payload
	// TODO: Verify that ALL BankTransactions and Expenses in that month's date range are matched
	// TODO: If they are, update the period Status to "CLOSED"

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "not implemented",
	})
}
