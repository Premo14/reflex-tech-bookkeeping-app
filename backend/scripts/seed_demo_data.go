package main

import (
	"log"
	"math/rand"
	"time"

	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
)

func main() {
	db.Connect()
	// 2. Ensure Chart of Accounts is seeded
	db.SeedChartOfAccounts()
	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())



	// 4. Fetch some accounts to use
	var checking, officeSupplies, sales, cash models.ChartAccount
	db.DB.Where("code = ?", "1010").First(&checking)
	db.DB.Where("code = ?", "5050").First(&officeSupplies)
	db.DB.Where("code = ?", "4010").First(&sales)
	db.DB.Where("code = ?", "1030").First(&cash)

	// Helper to generate a unique FITID
	generateFITID := func() string {
		return "DEMO-" + time.Now().Format("20060102150405") + "-" + string(rune(rand.Intn(10000)))
	}

	log.Println("Seeding Scenario 1: Exact Link (Amount + Date)")
	// Score: 50 (Amount) + 30 (Date) = 80 -> Auto Linked
	matchDate := startOfMonth.AddDate(0, 0, 2)
	db.DB.Create(&models.BankTransaction{
		FITID:                generateFITID(),
		Date:                 matchDate,
		Description:          "STAPLES STORE 1234",
		Amount:               -145.50,
		TransactionType:      "DEBIT",
		AllocationStatus:     "UNLINKED", // Engine will update
		CategoryAccountID:    &officeSupplies.ID,
	})
	db.DB.Create(&models.Expense{
		Timestamp:            matchDate,
		Vendor:               "Staples",
		Description:          "Printer Ink",
		Amount:               145.50,
		Tender:               "card",
		AllocationStatus:     "UNLINKED",
		ChartAccountID:       &officeSupplies.ID,
	})

	log.Println("Seeding Scenario 2: Subset Sum (One Tx, Multiple Receipts)")
	subsetDate := startOfMonth.AddDate(0, 0, 4)
	db.DB.Create(&models.BankTransaction{
		FITID:                generateFITID(),
		Date:                 subsetDate,
		Description:          "HOME DEPOT",
		Amount:               -300.00,
		TransactionType:      "DEBIT",
		AllocationStatus:     "UNLINKED",
	})
	db.DB.Create(&models.Expense{
		Timestamp:            subsetDate,
		Vendor:               "Home Depot",
		Description:          "Lumber",
		Amount:               200.00,
		Tender:               "card",
		AllocationStatus:     "UNLINKED",
	})
	db.DB.Create(&models.Expense{
		Timestamp:            subsetDate,
		Vendor:               "Home Depot",
		Description:          "Tools",
		Amount:               100.00,
		Tender:               "card",
		AllocationStatus:     "UNLINKED",
	})

	log.Println("Seeding Scenario 3: Suggested Link (Exact Amount, Off by 2 days)")
	// Score: 50 (Amount) + 10 (Date) = 60 -> Suggested Link
	suggTxDate := startOfMonth.AddDate(0, 0, 10)
	suggExpDate := startOfMonth.AddDate(0, 0, 8) // E.g., bought on weekend, cleared on Tuesday
	db.DB.Create(&models.BankTransaction{
		FITID:                generateFITID(),
		Date:                 suggTxDate,
		Description:          "SQ *LOCAL COFFEE SHOP",
		Amount:               -12.75,
		TransactionType:      "DEBIT",
		AllocationStatus:     "UNLINKED",
	})
	db.DB.Create(&models.Expense{
		Timestamp:            suggExpDate,
		Vendor:               "Local Coffee Shop",
		Description:          "Client Meeting",
		Amount:               12.75,
		Tender:               "card",
		AllocationStatus:     "UNLINKED",
	})

	log.Println("Seeding Scenario 4: Fully Unlinked Transaction")
	unmTxDate := startOfMonth.AddDate(0, 0, 15)
	db.DB.Create(&models.BankTransaction{
		FITID:                generateFITID(),
		Date:                 unmTxDate,
		Description:          "TARGET T-123",
		Amount:               -89.99,
		TransactionType:      "DEBIT",
		AllocationStatus:     "UNLINKED",
	})

	log.Println("Seeding Scenario 5: Fully Unlinked Receipt")
	unmExpDate := startOfMonth.AddDate(0, 0, 18)
	db.DB.Create(&models.Expense{
		Timestamp:            unmExpDate,
		Vendor:               "Best Buy",
		Description:          "Keyboard",
		Amount:               120.00,
		Tender:               "card",
		AllocationStatus:     "UNLINKED",
	})

	log.Println("Seeding Scenario 6: Deposit/Income (Auto-Balanced)")
	depDate := startOfMonth.AddDate(0, 0, 20)
	db.DB.Create(&models.BankTransaction{
		FITID:                generateFITID(),
		Date:                 depDate,
		Description:          "STRIPE TRANSFER",
		Amount:               1500.00,
		TransactionType:      "DEP",
		AllocationStatus:     "UNLINKED", // Engine will set to BALANCED
		CategoryAccountID:    &sales.ID,
	})

	log.Println("Seeding Scenario 7: Cash Receipt (No Bank Tx Needed)")
	cashDate := startOfMonth.AddDate(0, 0, 22)
	db.DB.Create(&models.Expense{
		Timestamp:            cashDate,
		Vendor:               "Post Office",
		Description:          "Stamps",
		Amount:               11.00,
		Tender:               "cash",
		AllocationStatus:     "UNLINKED", // Engine ignores for close checks, UI flags as unlinked but safe
		ChartAccountID:       &cash.ID,
	})

	log.Println("Running Reconciliation Engine...")
	utils.RunReconciliation()

	log.Println("Seed complete! You can now view these scenarios in the dashboard.")
}
