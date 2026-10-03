package routes

import (
	"reflex-tech-bookkeeping-app-api/controllers"
	"time"

	"github.com/gofiber/fiber/v3"
)

func SetupRoutes(app *fiber.App) {
	api := app.Group("/api")

	// Health Check
	app.Get("/health", func(c fiber.Ctx) error {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status":    "success",
			"message":   "Service is up and running",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// Frontend File Upload
	api.Post("/upload", controllers.UploadFile)

	// Chart of Accounts
	api.Get("/accounts", controllers.GetChartAccounts)
	api.Post("/accounts", controllers.CreateChartAccount)
	api.Patch("/accounts/:id", controllers.UpdateChartAccount)
	api.Delete("/accounts/:id", controllers.DeleteChartAccount)

	// Global Settings (Books Closed Date)
	api.Get("/settings", controllers.GetSettings)
	api.Post("/settings", controllers.UpdateSettings)
	// Bank Transactions
	api.Get("/transactions", controllers.GetTransactions)
	api.Post("/transactions", controllers.CreateTransaction) // manual entry
	api.Get("/transactions/:id", controllers.GetTransaction)
	api.Patch("/transactions/:id", controllers.UpdateTransaction)
	api.Delete("/transactions/:id", controllers.DeleteTransaction)

	// Expenses & Receipts
	api.Get("/expenses", controllers.GetExpenses)
	api.Post("/expenses", controllers.CreateExpense) // manual entry
	api.Get("/expenses/:id", controllers.GetExpense)
	api.Patch("/expenses/:id", controllers.UpdateExpense)
	api.Delete("/expenses/:id", controllers.DeleteExpense)

	// Mark Expense as Cash (bypasses reconciliation requirement)
	api.Patch("/expenses/:id/cash", controllers.MarkExpenseAsCash)

	// Reconciliation
	api.Get("/reconciliation/flagged", controllers.GetFlaggedItems)
	api.Post("/reconciliation/link", controllers.LinkExpenseToTransaction)
	api.Post("/reconciliation/unlink", controllers.UnlinkExpense)
	api.Get("/reconciliation/unlinked", controllers.GetUnlinkedItems)

	// Period Summary (totals bar)
	api.Get("/summary", controllers.GetSummary)

	// Reports
	api.Get("/reports/pl", controllers.GetProfitLoss)
}
