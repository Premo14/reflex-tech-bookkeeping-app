package db

import (
	"log"
	"reflex-tech-bookkeeping-app-api/models"
)

// seedEntry is a helper struct for defining the default COA seed data.
type seedEntry struct {
	Code          string
	Name          string
	Type          string
	Description   string
	ScheduleCLine string
}

// defaultAccounts is the standard small-business chart of accounts that gets seeded
// on first boot. Users can add, rename, or deactivate accounts after setup —
// these are sensible starting defaults, not enforced structure.
//
// Numbering follows the standard convention:
//
//	1xxx = Assets       (things the business owns)
//	2xxx = Liabilities  (things the business owes)
//	3xxx = Equity       (owner's stake)
//	4xxx = Revenue      (money brought in)
//	5xxx = Expenses     (costs to run the business)
var defaultAccounts = []seedEntry{
	// Assets
	{Code: "1010", Name: "Checking Account", Type: "ASSET", Description: "Primary business checking account"},
	{Code: "1020", Name: "Savings Account", Type: "ASSET", Description: "Business savings account"},
	{Code: "1030", Name: "Cash on Hand", Type: "ASSET", Description: "Physical cash held by the business"},
	{Code: "1100", Name: "Accounts Receivable", Type: "ASSET", Description: "Money owed to the business by customers"},
	{Code: "1200", Name: "Inventory", Type: "ASSET", Description: "Goods held for sale"},
	{Code: "1300", Name: "Equipment", Type: "ASSET", Description: "Business equipment and tools"},

	// Liabilities
	{Code: "2010", Name: "Accounts Payable", Type: "LIABILITY", Description: "Money the business owes to vendors"},
	{Code: "2020", Name: "Credit Card", Type: "LIABILITY", Description: "Business credit card balance"},
	{Code: "2030", Name: "Line of Credit", Type: "LIABILITY", Description: "Revolving business line of credit"},
	{Code: "2100", Name: "Accrued Wages", Type: "LIABILITY", Description: "Wages earned but not yet paid"},
	{Code: "2510", Name: "Bank Loan", Type: "LIABILITY", Description: "Outstanding loan balances"},

	// Equity
	{Code: "3010", Name: "Owner's Capital", Type: "EQUITY", Description: "Owner's investment in the business"},
	{Code: "3020", Name: "Retained Earnings", Type: "EQUITY", Description: "Cumulative profit kept in the business"},
	{Code: "3110", Name: "Owner's Draw", Type: "EQUITY", Description: "Distributions and withdrawals by owner"},

	// Revenue (IRS Schedule C Form 1040 Part I)
	{Code: "4010", Name: "Sales Revenue", Type: "REVENUE", Description: "Income from product sales", ScheduleCLine: "Line 1 - Gross receipts or sales"},
	{Code: "4110", Name: "Service Fees", Type: "REVENUE", Description: "Income from services rendered", ScheduleCLine: "Line 1 - Gross receipts or sales"},
	{Code: "4210", Name: "Interest Income", Type: "REVENUE", Description: "Interest earned on accounts", ScheduleCLine: "Line 6 - Other income"},

	// Expenses (IRS Schedule C Form 1040 Part II)
	{Code: "5010", Name: "Rent", Type: "EXPENSE", Description: "Office or workspace rent", ScheduleCLine: "Line 20b - Rent or lease (other business property)"},
	{Code: "5020", Name: "Payroll", Type: "EXPENSE", Description: "Employee wages and salaries", ScheduleCLine: "Line 26 - Wages"},
	{Code: "5030", Name: "Utilities", Type: "EXPENSE", Description: "Electricity, water, internet, etc.", ScheduleCLine: "Line 25 - Utilities"},
	{Code: "5050", Name: "Office Supplies", Type: "EXPENSE", Description: "Stationery, printer supplies, etc.", ScheduleCLine: "Line 18 - Office expense"},
	{Code: "5080", Name: "Insurance", Type: "EXPENSE", Description: "Business insurance premiums", ScheduleCLine: "Line 15 - Insurance (other than health)"},
	{Code: "5090", Name: "Meals & Entertainment", Type: "EXPENSE", Description: "Client meals and business entertainment", ScheduleCLine: "Line 24b - Deductible meals (50%)"},
	{Code: "5110", Name: "Professional Services", Type: "EXPENSE", Description: "Accountant, lawyer, consultant fees", ScheduleCLine: "Line 17 - Legal and professional services"},
	{Code: "5210", Name: "Software & Subscriptions", Type: "EXPENSE", Description: "SaaS tools, software licenses", ScheduleCLine: "Line 27a - Other expenses (Software & online services)"},
	{Code: "5310", Name: "Advertising", Type: "EXPENSE", Description: "Marketing and advertising costs", ScheduleCLine: "Line 8 - Advertising"},
	{Code: "5410", Name: "Travel", Type: "EXPENSE", Description: "Business travel and transportation", ScheduleCLine: "Line 24a - Travel"},
	{Code: "5910", Name: "Bank Fees", Type: "EXPENSE", Description: "Bank service charges and fees", ScheduleCLine: "Line 27a - Other expenses (Bank & merchant fees)"},
}

// SeedChartOfAccounts inserts the default accounts only when the chart_accounts table
// is completely empty. This is safe to call on every startup — it no-ops if data exists.
func SeedChartOfAccounts() {
	var count int64
	DB.Model(&models.ChartAccount{}).Count(&count)
	if count > 0 {
		return // already seeded, do nothing
	}

	log.Println("Seeding default Chart of Accounts...")
	for _, entry := range defaultAccounts {
		account := models.ChartAccount{
			Code:          entry.Code,
			Name:          entry.Name,
			Type:          entry.Type,
			Description:   entry.Description,
			ScheduleCLine: entry.ScheduleCLine,
			Active:        true,
			IsDefault:     true,
		}
		if err := DB.Create(&account).Error; err != nil {
			log.Printf("Failed to seed account %s (%s): %v\n", entry.Code, entry.Name, err)
		}
	}
	log.Printf("Seeded %d default chart of accounts entries.\n", len(defaultAccounts))
}
