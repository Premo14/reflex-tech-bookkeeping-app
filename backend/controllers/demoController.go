package controllers

import (
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/utils"

	"github.com/gofiber/fiber/v3"
)

func broadcastDemoDataRefresh() {
	events.Broadcast("ACCOUNTS_UPDATED", nil)
	events.Broadcast("SETTINGS_UPDATED", nil)
	events.Broadcast("TRANSACTIONS_UPDATED", nil)
	events.Broadcast("EXPENSES_UPDATED", nil)
	events.Broadcast("INVOICES_UPDATED", nil)
	events.Broadcast("RECONCILIATION_UPDATED", nil)
	events.Broadcast("QUEUE_UPDATED", nil)
}

// GetDemoStatus returns whether demo records exist along with record counts.
func GetDemoStatus(c fiber.Ctx) error {
	status, err := utils.GetDemoDatasetStatus()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to check demo data status: " + err.Error()})
	}
	return c.Status(fiber.StatusOK).JSON(status)
}

// SeedDemoData populates the comprehensive multi-month demo dataset cleanly.
func SeedDemoData(c fiber.Ctx) error {
	status, err := utils.SeedDemoDataset()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to seed demo data: " + err.Error()})
	}
	broadcastDemoDataRefresh()
	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"demo":   status,
	})
}

// ResetDemoData removes existing demo records and re-seeds a fresh demo dataset without touching user records.
func ResetDemoData(c fiber.Ctx) error {
	status, err := utils.ResetDemoDataset()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to reset demo data: " + err.Error()})
	}
	broadcastDemoDataRefresh()
	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"demo":   status,
	})
}

// RemoveDemoData removes all seeded demo records and demo receipt files while preserving real user data.
func RemoveDemoData(c fiber.Ctx) error {
	status, err := utils.RemoveDemoDataset()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to remove demo data: " + err.Error()})
	}
	broadcastDemoDataRefresh()
	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"demo":   status,
	})
}
