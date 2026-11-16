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

var (
	DB *gorm.DB

	openGormDB = func(dsn string) (*gorm.DB, error) {
		return gorm.Open(postgres.Open(dsn), &gorm.Config{})
	}
	fatalConnect = log.Fatal
)

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

	DB, err = openGormDB(dsn)
	if err != nil {
		fatalConnect("Failed to connect to database.", err)
		return
	}

	InitSchemaAndSeed(DB)
}

// InitSchemaAndSeed sets up GORM join tables, migrates models, runs idempotent
// schema/data migrations, creates ledger indexes, and seeds default COA + rules.
func InitSchemaAndSeed(database *gorm.DB) {
	if database == nil {
		return
	}
	DB = database
	isPostgres := database.Dialector != nil && database.Dialector.Name() == "postgres"

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
		&models.Invoice{},
		&models.Expense{},
		&models.Receipt{},
		&models.ExpenseBankTransaction{},
		&models.PeriodAuditLog{},
		&models.ItemAuditLog{},
		&models.BankRule{},
	)

	// Drop legacy unique constraint on receipts.file_hash so shared receipts (allowDuplicate=true)
	// and re-uploads of receipts from soft-deleted expenses do not fail with SQLSTATE 23505.
	if isPostgres {
		DB.Exec(`ALTER TABLE receipts DROP CONSTRAINT IF EXISTS uni_receipts_file_hash`)
	}
	DB.Exec(`DROP INDEX IF EXISTS uni_receipts_file_hash`)

	// Migration: bank transactions used to store their category (REVENUE/EXPENSE account)
	// in chart_account_id, which is meant to hold the bank account. Move those values into
	// category_account_id. Idempotent: once moved, chart_account_id no longer points at a
	// REVENUE/EXPENSE account, so re-running touches nothing.
	DB.Exec(`UPDATE bank_transactions
		SET category_account_id = chart_account_id, chart_account_id = NULL
		WHERE category_account_id IS NULL
		AND chart_account_id IN (SELECT id FROM chart_accounts WHERE type IN ('REVENUE', 'EXPENSE'))`)

	// Migration: clean up any items erroneously marked PENDING that do not fall in a closed period,
	// while preserving open-period receipts flagged for missing amount/date or manual OCR review.
	const openExpenseWarningClause = "review_status = 'PENDING' AND COALESCE(description, '') NOT LIKE '%[MISSING AMOUNT%' AND COALESCE(description, '') NOT LIKE '%[MISSING DATE%' AND COALESCE(description, '') NOT LIKE '%AI extraction unavailable%'"
	var closedSetting models.AppSetting
	if err := DB.Where("key = ?", "BooksClosedDate").First(&closedSetting).Error; err == nil && closedSetting.Value != "" {
		if closedDate, err := time.Parse("2006-01-02", closedSetting.Value); err == nil {
			endOfClosedDay := closedDate.Add(24 * time.Hour)
			DB.Exec(`UPDATE bank_transactions SET review_status = 'APPROVED' WHERE review_status = 'PENDING' AND date >= ?`, endOfClosedDay)
			DB.Exec(`UPDATE expenses SET review_status = 'APPROVED' WHERE `+openExpenseWarningClause+` AND timestamp >= ?`, endOfClosedDay)
			DB.Exec(`UPDATE invoices SET review_status = 'APPROVED' WHERE review_status = 'PENDING' AND issue_date >= ?`, endOfClosedDay)
		}
	} else {
		DB.Exec(`UPDATE bank_transactions SET review_status = 'APPROVED' WHERE review_status = 'PENDING'`)
		DB.Exec(`UPDATE expenses SET review_status = 'APPROVED' WHERE ` + openExpenseWarningClause)
		DB.Exec(`UPDATE invoices SET review_status = 'APPROVED' WHERE review_status = 'PENDING'`)
	}
	DB.Exec(`UPDATE invoices SET review_status = 'APPROVED' WHERE review_status IS NULL OR review_status = ''`)

	// Migration: rename reconciliation_status column to allocation_status and migrate status values
	if isPostgres {
		DB.Exec(`DO $$ 
		BEGIN 
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_transactions' AND column_name = 'reconciliation_status') THEN
				ALTER TABLE bank_transactions RENAME COLUMN reconciliation_status TO allocation_status;
			END IF;
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'reconciliation_status') THEN
				ALTER TABLE expenses RENAME COLUMN reconciliation_status TO allocation_status;
			END IF;
		END $$;`)
	}

	DB.Exec(`UPDATE bank_transactions SET allocation_status = 'BALANCED' WHERE allocation_status LIKE 'M%' OR allocation_status = 'LINKED'`)
	DB.Exec(`UPDATE bank_transactions SET allocation_status = 'UNLINKED' WHERE allocation_status LIKE 'UNM%'`)
	DB.Exec(`UPDATE bank_transactions SET allocation_status = 'PARTIALLY_ALLOCATED' WHERE allocation_status LIKE 'PARTIAL%M%' OR allocation_status = 'PARTIALLY_LINKED'`)

	DB.Exec(`UPDATE expenses SET allocation_status = 'BALANCED' WHERE allocation_status LIKE 'M%' OR allocation_status = 'LINKED'`)
	DB.Exec(`UPDATE expenses SET allocation_status = 'UNLINKED' WHERE allocation_status LIKE 'UNM%'`)
	DB.Exec(`UPDATE expenses SET allocation_status = 'PARTIALLY_ALLOCATED' WHERE allocation_status LIKE 'PARTIAL%M%' OR allocation_status = 'PARTIALLY_LINKED'`)

	// Migration: canonicalize tender casing & repair cash expenses that were left UNLINKED
	// (unless flagged with missing-field warnings requiring review).
	DB.Exec(`UPDATE expenses SET tender = LOWER(TRIM(tender)) WHERE tender IS NOT NULL AND tender != LOWER(TRIM(tender))`)
	DB.Exec(`UPDATE expenses SET allocation_status = 'BALANCED'
		WHERE LOWER(TRIM(tender)) IN ('cash', 'cash / paper', 'cash/paper', 'currency', 'paper')
		AND (allocation_status IS NULL OR allocation_status = 'UNLINKED')
		AND COALESCE(description, '') NOT LIKE '%[MISSING AMOUNT%'
		AND COALESCE(description, '') NOT LIKE '%[MISSING DATE%'
		AND id NOT IN (SELECT expense_id FROM expense_bank_transactions WHERE status = 'confirmed')`)

	// Migration: clean up any expenses erroneously categorized to non-EXPENSE accounts (e.g. 1xxx Asset accounts)
	DB.Exec(`UPDATE expenses SET chart_account_id = NULL WHERE chart_account_id IN (SELECT id FROM chart_accounts WHERE type != 'EXPENSE')`)

	// Seed the chart of accounts if the table is empty (first boot or fresh DB).
	SeedChartOfAccounts()

	// Migration: renumber chart of accounts to abide by standard sub-category code ranges.
	// Order is critical to avoid violating the unique constraint on code:
	// - 5110 Software moves to 5210 before 5100 Professional Services can take 5110.
	// - 2030 Bank Loan moves to 2510 before 2035 Line of Credit can take 2030.
	DB.Exec(`UPDATE chart_accounts SET code = '2510' WHERE code = '2030' AND LOWER(name) LIKE '%loan%'`)

	// Performance & Scalability Indexes for Enterprise Ledgers
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_bt_review_status_date ON bank_transactions(review_status, date)`)
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_exp_review_status_time ON expenses(review_status, timestamp)`)
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_bt_accounts ON bank_transactions(chart_account_id, category_account_id)`)
	DB.Exec(`UPDATE chart_accounts SET code = '2030' WHERE code = '2035' AND LOWER(name) LIKE '%credit%'`)
	DB.Exec(`UPDATE chart_accounts SET code = '3110' WHERE code = '3030' AND LOWER(name) LIKE '%draw%'`)
	DB.Exec(`UPDATE chart_accounts SET code = '4110' WHERE code = '4020' AND (LOWER(name) LIKE '%service%' OR LOWER(name) LIKE '%fee%')`)
	DB.Exec(`UPDATE chart_accounts SET code = '4210' WHERE code = '4030' AND LOWER(name) LIKE '%interest%'`)
	DB.Exec(`UPDATE chart_accounts SET code = '5310' WHERE code = '5040' AND (LOWER(name) LIKE '%advertising%' OR LOWER(name) LIKE '%marketing%')`)
	DB.Exec(`UPDATE chart_accounts SET code = '5410' WHERE code = '5060' AND (LOWER(name) LIKE '%travel%' OR LOWER(name) LIKE '%transportation%')`)
	DB.Exec(`UPDATE chart_accounts SET code = '5910' WHERE code = '5070' AND (LOWER(name) LIKE '%bank%' OR LOWER(name) LIKE '%fee%')`)

	// Migration: ensure standard default accounts have is_default = true
	defaultCodes := []string{
		"1010", "1020", "1030", "1100", "1200", "1300",
		"2010", "2020", "2030", "2100", "2510",
		"3010", "3020", "3110",
		"4010", "4090", "4110", "4210",
		"5000", "5010", "5015", "5020", "5025", "5030", "5040", "5050", "5060", "5070", "5080", "5090", "5110", "5120", "5210", "5310", "5410", "5510", "5610", "5710", "5720", "5810", "5910",
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

	// Migration: backfill ofx_account_id on chart_accounts from bank_statements (portable correlated subquery)
	DB.Exec(`UPDATE chart_accounts
		SET ofx_account_id = (
			SELECT bs.account_id
			FROM bank_statements bs
			WHERE bs.chart_account_id = chart_accounts.id
			ORDER BY bs.id
			LIMIT 1
		)
		WHERE (ofx_account_id IS NULL OR ofx_account_id = '')
		AND EXISTS (SELECT 1 FROM bank_statements bs WHERE bs.chart_account_id = chart_accounts.id)`)

	// Set OFX ID description only on adopted legacy statement accounts matching those exact IDs
	DB.Exec(`UPDATE chart_accounts
		SET description = 'OFX ID: 5137'
		WHERE code = '2020' AND (description = '5137' OR ofx_account_id = '5137')`)
	DB.Exec(`UPDATE chart_accounts
		SET description = 'OFX ID: 50106954S:05'
		WHERE code = '1010' AND (description = '50106954S:05' OR ofx_account_id = '50106954S:05')`)

	// Migration: Backfill default Schedule C tax line mappings on standard accounts if empty
	defaultScheduleCMapping := map[string]string{
		"4010": "Line 1 - Gross receipts or sales",
		"4090": "Line 2 - Returns and allowances",
		"4110": "Line 1 - Gross receipts or sales",
		"4210": "Line 6 - Other income",
		"5000": "Line 4 - Cost of goods sold",
		"5010": "Line 20b - Rent or lease (other business property)",
		"5015": "Line 20a - Rent or lease (vehicles, machinery, and equipment)",
		"5020": "Line 26 - Wages",
		"5025": "Line 14 - Employee benefit programs",
		"5030": "Line 25 - Utilities",
		"5040": "Line 21 - Repairs and maintenance",
		"5050": "Line 18 - Office expense",
		"5060": "Line 22 - Supplies",
		"5070": "Line 30 - Expenses for business use of your home",
		"5080": "Line 15 - Insurance (other than health)",
		"5090": "Line 24b - Deductible meals (50%)",
		"5110": "Line 17 - Legal and professional services",
		"5120": "Line 11 - Contract labor",
		"5210": "Line 27a - Other expenses (Software & online services)",
		"5310": "Line 8 - Advertising",
		"5410": "Line 24a - Travel",
		"5510": "Line 9 - Car and truck expenses",
		"5610": "Line 23 - Taxes and licenses",
		"5710": "Line 16b - Other interest",
		"5720": "Line 13 - Depreciation and section 179 expense deduction",
		"5810": "Line 10 - Commissions and fees",
		"5910": "Line 27a - Other expenses (Bank & merchant fees)",
	}
	for code, schedLine := range defaultScheduleCMapping {
		DB.Exec(`UPDATE chart_accounts SET schedule_c_line = ? WHERE code = ? AND (schedule_c_line IS NULL OR schedule_c_line = '')`, schedLine, code)
	}

	// Seed default automated bank categorization rules
	SeedDefaultBankRules()
}
