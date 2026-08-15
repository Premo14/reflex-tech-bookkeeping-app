package routes

import (
	"reflex-tech-bookkeeping-app-api/controllers"
	"time"

	"github.com/gofiber/fiber/v3"
)

func SetupRoutes(app *fiber.App) {
	api := app.Group("/api")

	// Health Check
	api.Get("/", func(c fiber.Ctx) error {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status":    "success",
			"message":   "Service is up and running",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// Frontend File Upload
	api.Post("/upload", controllers.UploadFile)

	// The Reconciliation Inbox ("Action Required")
	api.Get("/reconciliation/flagged", controllers.GetFlaggedItems)

	// Manually Link Expenses to Transactions
	api.Post("/reconciliation/link", controllers.LinkExpenseToTransaction)

	// Month Close
	api.Get("/accounting-periods", controllers.GetAccountingPeriods)
	api.Post("/accounting-periods/close", controllers.CloseAccountingPeriod)

	// General Browsing
	api.Get("/transactions", controllers.GetTransactions)
	
	// Mark Expense as Cash
	api.Patch("/expenses/:id/cash", controllers.MarkExpenseAsCash)
}
