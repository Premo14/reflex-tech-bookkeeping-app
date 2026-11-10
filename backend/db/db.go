package db

import (
	"fmt"
	"log"
	"os"
	"time"
	"reflex-tech-bookkeeping-app-api/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect() {
	var err error

	dbHost := os.Getenv("POSTGRES_HOST")
	if dbHost == "" {
		dbHost = "postgres"
	}

	dbUser := os.Getenv("POSTGRES_USER")
	if dbUser == "" {
		dbUser = "user"
	}

	dbPass := os.Getenv("POSTGRES_PASSWORD")
	if dbPass == "" {
		dbPass = "pass"
	}

	dbName := os.Getenv("POSTGRES_DB")
	if dbName == "" {
		dbName = "reflex-tech-bookkeeping-app-postgres-db"
	}

	dbPort := os.Getenv("POSTGRES_PORT")
	if dbPort == "" {
		dbPort = "5432"
	}

	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC", dbHost, dbUser, dbPass, dbName, dbPort)

	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database.", err)
	}

	// Tell GORM to use the custom join table struct for both sides of the many2many.
	// This must happen before AutoMigrate so that GORM creates the join table with
	// the Status column rather than a plain pivot table with just the two FK columns.
	DB.SetupJoinTable(&models.Expense{}, "BankTransactions", &models.ExpenseBankTransaction{})
	DB.SetupJoinTable(&models.BankTransaction{}, "Expenses", &models.ExpenseBankTransaction{})

	// ChartAccount must migrate before the tables that reference it via FK
	// (BankStatement, BankTransaction, Expense), so it goes first.
	DB.AutoMigrate(
		&models.ChartAccount{},
		&models.AppSetting{},
		&models.BankStatement{},
		&models.BankTransaction{},
		&models.Expense{},
		&models.Receipt{},
		&models.ExpenseBankTransaction{},
		&models.PeriodAuditLog{},
		&models.ItemAuditLog{},
		&models.BankRule{},
		&models.Invoice{},
	)

	// Drop legacy unique constraint on receipts.file_hash so shared receipts (allowDuplicate=true)
	// and re-uploads of receipts from soft-deleted expenses do not fail with SQLSTATE 23505.
	DB.Exec(`ALTER TABLE receipts DROP CONSTRAINT IF EXISTS uni_receipts_file_hash`)
	DB.Exec(`DROP INDEX IF EXISTS uni_receipts_file_hash`)

	// Migration: bank transactions used to store their category (REVENUE/EXPENSE account)
	// in chart_account_id, which is meant to hold the bank account. Move those values into
	// category_account_id. Idempotent: once moved, chart_account_id no longer points at a
	// REVENUE/EXPENSE account, so re-running touches nothing.
	DB.Exec(`UPDATE bank_transactions
		SET category_account_id = chart_account_id, chart_account_id = NULL
		WHERE category_account_id IS NULL
		AND chart_account_id IN (SELECT id FROM chart_accounts WHERE type IN ('REVENUE', 'EXPENSE'))`)

	// Migration: clean up any items erroneously marked PENDING that do not fall in a closed period.
	var closedSetting models.AppSetting
	if err := DB.Where("key = ?", "BooksClosedDate").First(&closedSetting).Error; err == nil && closedSetting.Value != "" {
		if closedDate, err := time.Parse("2006-01-02", closedSetting.Value); err == nil {
			endOfClosedDay := closedDate.Add(24 * time.Hour)
			DB.Exec(`UPDATE bank_transactions SET review_status = 'APPROVED' WHERE review_status = 'PENDING' AND date >= ?`, endOfClosedDay)
			DB.Exec(`UPDATE expenses SET review_status = 'APPROVED' WHERE review_status = 'PENDING' AND timestamp >= ?`, endOfClosedDay)
		}
	} else {
		DB.Exec(`UPDATE bank_transactions SET review_status = 'APPROVED' WHERE review_status = 'PENDING'`)
		DB.Exec(`UPDATE expenses SET review_status = 'APPROVED' WHERE review_status = 'PENDING'`)
	}

	// Migration: rename reconciliation_status column to allocation_status and migrate status values
	DB.Exec(`DO $$ 
	BEGIN 
		IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_transactions' AND column_name = 'reconciliation_status') THEN
			ALTER TABLE bank_transactions RENAME COLUMN reconciliation_status TO allocation_status;
		END IF;
		IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'reconciliation_status') THEN
			ALTER TABLE expenses RENAME COLUMN reconciliation_status TO allocation_status;
		END IF;
	END $$;`)

	DB.Exec(`UPDATE bank_transactions SET allocation_status = 'BALANCED' WHERE allocation_status LIKE 'M%' OR allocation_status = 'LINKED'`)
	DB.Exec(`UPDATE bank_transactions SET allocation_status = 'UNLINKED' WHERE allocation_status LIKE 'UNM%'`)
	DB.Exec(`UPDATE bank_transactions SET allocation_status = 'PARTIALLY_ALLOCATED' WHERE allocation_status LIKE 'PARTIAL%M%' OR allocation_status = 'PARTIALLY_LINKED'`)

	DB.Exec(`UPDATE expenses SET allocation_status = 'BALANCED' WHERE allocation_status LIKE 'M%' OR allocation_status = 'LINKED'`)
	DB.Exec(`UPDATE expenses SET allocation_status = 'UNLINKED' WHERE allocation_status LIKE 'UNM%'`)
	DB.Exec(`UPDATE expenses SET allocation_status = 'PARTIALLY_ALLOCATED' WHERE allocation_status LIKE 'PARTIAL%M%' OR allocation_status = 'PARTIALLY_LINKED'`)

	// Migration: tender is compared case-sensitively against "cash" throughout the backend, but
	// the UI and AI extraction used to write upper-case values (e.g. "CASH"). Normalize all stored
	// values to lower-case, then repair cash expenses that were left flagged as UNLINKED.
	DB.Exec(`UPDATE expenses SET tender = LOWER(TRIM(tender)) WHERE tender IS NOT NULL AND tender != LOWER(TRIM(tender))`)
	DB.Exec(`UPDATE expenses SET allocation_status = 'BALANCED'
		WHERE tender = 'cash' AND (allocation_status IS NULL OR allocation_status = 'UNLINKED')
		AND id NOT IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed')`)

	// Migration: clean up any expenses erroneously categorized to non-EXPENSE accounts (e.g. 1xxx Asset accounts)
	DB.Exec(`UPDATE expenses SET chart_account_id = NULL WHERE chart_account_id IN (SELECT id FROM chart_accounts WHERE type != 'EXPENSE')`)

	// Seed the chart of accounts if the table is empty (first boot or fresh DB).
	SeedChartOfAccounts()

	// Migration: renumber chart of accounts to abide by standard sub-category code ranges.
	// Order is critical to avoid violating the unique constraint on code:
	// - 5110 Software moves to 5210 before 5100 Professional Services can take 5110.
	// - 2030 Bank Loan moves to 2510 before 2035 Line of Credit can take 2030.
	DB.Exec(`UPDATE chart_accounts SET code = '2510' WHERE code = '2030' AND name ILIKE '%Loan%'`)

	// Performance & Scalability Indexes for Enterprise Ledgers
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_bt_review_status_date ON bank_transactions(review_status, date)`)
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_exp_review_status_time ON expenses(review_status, timestamp)`)
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_bt_accounts ON bank_transactions(chart_account_id, category_account_id)`)
	DB.Exec(`UPDATE chart_accounts SET code = '2030' WHERE code = '2035' AND name ILIKE '%Credit%'`)
	DB.Exec(`UPDATE chart_accounts SET code = '3110' WHERE code = '3030' AND name ILIKE '%Draw%'`)
	DB.Exec(`UPDATE chart_accounts SET code = '4110' WHERE code = '4020' AND (name ILIKE '%Service%' OR name ILIKE '%Fee%')`)
	DB.Exec(`UPDATE chart_accounts SET code = '4210' WHERE code = '4030' AND name ILIKE '%Interest%'`)
	DB.Exec(`UPDATE chart_accounts SET code = '5310' WHERE code = '5040' AND (name ILIKE '%Advertising%' OR name ILIKE '%Marketing%')`)
	DB.Exec(`UPDATE chart_accounts SET code = '5410' WHERE code = '5060' AND (name ILIKE '%Travel%' OR name ILIKE '%Transportation%')`)
	DB.Exec(`UPDATE chart_accounts SET code = '5910' WHERE code = '5070' AND (name ILIKE '%Bank%' OR name ILIKE '%Fee%')`)

	// Migration: ensure standard default accounts have is_default = true
	defaultCodes := []string{
		"1010", "1020", "1030", "1100", "1200", "1300",
		"2010", "2020", "2030", "2100", "2510",
		"3010", "3020", "3110",
		"4010", "4110", "4210",
		"5010", "5020", "5030", "5050", "5080", "5090", "5110", "5210", "5310", "5410", "5910",
	}
	DB.Model(&models.ChartAccount{}).Where("code IN ?", defaultCodes).Update("is_default", true)

	// Ensure 3110 Owner's Draw is seeded if missing
	var drawCount int64
	DB.Model(&models.ChartAccount{}).Where("code = ?", "3110").Count(&drawCount)
	if drawCount == 0 {
		DB.Create(&models.ChartAccount{
			Code:        "3110",
			Name:        "Owner's Draw",
			Type:        "EQUITY",
			Description: "Distributions and withdrawals by owner",
			Active:      true,
			IsDefault:   true,
		})
	}

	// Ensure 2030 Line of Credit is seeded if missing
	var locCount int64
	DB.Model(&models.ChartAccount{}).Where("code = ?", "2030").Count(&locCount)
	if locCount == 0 {
		DB.Create(&models.ChartAccount{
			Code:        "2030",
			Name:        "Line of Credit",
			Type:        "LIABILITY",
			Description: "Revolving business line of credit",
			Active:      true,
			IsDefault:   true,
		})
	}

	// Ensure 2510 Bank Loan is seeded if missing
	var loanCount int64
	DB.Model(&models.ChartAccount{}).Where("code = ?", "2510").Count(&loanCount)
	if loanCount == 0 {
		DB.Create(&models.ChartAccount{
			Code:        "2510",
			Name:        "Bank Loan",
			Type:        "LIABILITY",
			Description: "Outstanding loan balances",
			Active:      true,
			IsDefault:   true,
		})
	}

	// Migration: Merge redundant auto-created 2040 Credit Card into default 2020 Credit Card
	var redundantCC models.ChartAccount
	if err := DB.Where("code = ? AND description = ?", "2040", "5137").First(&redundantCC).Error; err == nil {
		var defaultCC models.ChartAccount
		if err := DB.Where("code = ?", "2020").First(&defaultCC).Error; err == nil {
			// Reassign bank statements, bank transactions, and expenses to defaultCC
			DB.Model(&models.BankStatement{}).Where("chart_account_id = ?", redundantCC.ID).Update("chart_account_id", defaultCC.ID)
			DB.Model(&models.BankTransaction{}).Where("chart_account_id = ?", redundantCC.ID).Update("chart_account_id", defaultCC.ID)
			DB.Model(&models.Expense{}).Where("chart_account_id = ?", redundantCC.ID).Update("chart_account_id", defaultCC.ID)

			// Adopt 2020: set name and description
			defaultCC.Name = "Credit Card (...5137)"
			defaultCC.Description = "Business credit card"
			ofxID := "5137"
			defaultCC.OfxAccountID = &ofxID
			DB.Save(&defaultCC)

			// Delete redundant 2040 account
			DB.Delete(&redundantCC)
			log.Printf("Successfully merged redundant account 2040 (ID %d) into 2020 (ID %d)\n", redundantCC.ID, defaultCC.ID)
		}
	}

	// Migration: backfill ofx_account_id on chart_accounts from bank_statements
	DB.Exec(`UPDATE chart_accounts ca
		SET ofx_account_id = bs.account_id
		FROM bank_statements bs
		WHERE bs.chart_account_id = ca.id
		AND (ca.ofx_account_id IS NULL OR ca.ofx_account_id = '')`)

	// Set OFX ID description on adopted statement accounts
	DB.Exec(`UPDATE chart_accounts
		SET description = 'OFX ID: 5137'
		WHERE code = '2020' AND (description = '5137' OR description = 'Business credit card')`)
	DB.Exec(`UPDATE chart_accounts
		SET description = 'OFX ID: 50106954S:05'
		WHERE code = '1010' AND (description = '50106954S:05' OR description = 'Business checking account')`)

	// Migration: Backfill default Schedule C tax line mappings on standard accounts if empty
	defaultScheduleCMapping := map[string]string{
		"4010": "Line 1 - Gross receipts or sales",
		"4110": "Line 1 - Gross receipts or sales",
		"4210": "Line 6 - Other income",
		"5010": "Line 20b - Rent or lease (other business property)",
		"5020": "Line 26 - Wages",
		"5030": "Line 25 - Utilities",
		"5050": "Line 18 - Office expense",
		"5080": "Line 15 - Insurance (other than health)",
		"5090": "Line 24b - Deductible meals (50%)",
		"5110": "Line 17 - Legal and professional services",
		"5210": "Line 27a - Other expenses (Software & online services)",
		"5310": "Line 8 - Advertising",
		"5410": "Line 24a - Travel",
		"5910": "Line 27a - Other expenses (Bank & merchant fees)",
	}
	for code, schedLine := range defaultScheduleCMapping {
		DB.Exec(`UPDATE chart_accounts SET schedule_c_line = ? WHERE code = ? AND (schedule_c_line IS NULL OR schedule_c_line = '')`, schedLine, code)
	}
}
