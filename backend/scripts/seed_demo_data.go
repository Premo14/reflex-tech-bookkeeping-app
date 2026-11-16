package main

import (
	"log"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/utils"
)

var (
	connectDBFn        = db.Connect
	resetDemoDatasetFn = utils.ResetDemoDataset
	fatalfFn           = log.Fatalf
)

func main() {
	connectDBFn()
	log.Println("🌱 Running comprehensive Jan–Nov 2026 Demo Dataset Seeder...")
	status, err := resetDemoDatasetFn()
	if err != nil {
		fatalfFn("❌ Failed to seed demo dataset: %v", err)
		return
	}
	log.Printf("✅ Demo data ready: %d statements, %d transactions, %d expenses, %d receipts, %d invoices",
		status.Counts.Statements,
		status.Counts.Transactions,
		status.Counts.Expenses,
		status.Counts.Receipts,
		status.Counts.Invoices,
	)
}
