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
	api.Post("/accounting-periods", controllers.CreateAccountingPeriod)
	api.Post("/accounting-periods/close", controllers.CloseAccountingPeriod)
	api.Post("/accounting-periods/reopen", controllers.ReopenAccountingPeriod)
	
	api.Get("/pending-closed-items", controllers.GetPendingClosedItems)

	// General Browsing
	api.Get("/transactions", controllers.GetTransactions)
	api.Post("/transactions", controllers.CreateTransaction) // manual entry
	api.Get("/transactions/:id", controllers.GetTransaction)
	api.Patch("/transactions/:id", controllers.UpdateTransaction)
	api.Delete("/transactions/:id", controllers.DeleteTransaction)

	api.Get("/expenses", controllers.GetExpenses) // fetch all expenses for ledger
	api.Post("/expenses", controllers.CreateExpense) // manual entry
	api.Get("/expenses/:id", controllers.GetExpense)
	api.Patch("/expenses/:id", controllers.UpdateExpense)
	api.Delete("/expenses/:id", controllers.DeleteExpense)

	// Mark Expense as Cash
	api.Patch("/expenses/:id/cash", controllers.MarkExpenseAsCash)
	
	// Unlinked items for manual linking
	api.Get("/reconciliation/unlinked", controllers.GetUnlinkedItems)
	
	// Unlink Expense
	api.Post("/reconciliation/unlink", controllers.UnlinkExpense)
}
