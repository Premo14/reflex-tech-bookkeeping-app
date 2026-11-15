package db

import (
	"encoding/json"
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

// defaultAccounts is the comprehensive, GAAP-conforming small-business Chart of Accounts
// covering all IRS Form 1040 Schedule C Part I (Income) and Part II (Expenses) tax lines.
var defaultAccounts = []seedEntry{
	// ── 1xxx Assets ───────────────────────────────────────────────────────────
	{Code: "1010", Name: "Checking Account", Type: "ASSET", Description: "Primary business checking account"},
	{Code: "1020", Name: "Savings Account", Type: "ASSET", Description: "Business savings account"},
	{Code: "1030", Name: "Cash on Hand", Type: "ASSET", Description: "Physical cash held by the business"},
	{Code: "1100", Name: "Accounts Receivable", Type: "ASSET", Description: "Money owed to the business by customers"},
	{Code: "1200", Name: "Inventory", Type: "ASSET", Description: "Goods held for sale"},
	{Code: "1300", Name: "Equipment", Type: "ASSET", Description: "Business equipment and tools"},

	// ── 2xxx Liabilities ──────────────────────────────────────────────────────
	{Code: "2010", Name: "Accounts Payable", Type: "LIABILITY", Description: "Money the business owes to vendors"},
	{Code: "2020", Name: "Credit Card", Type: "LIABILITY", Description: "Business credit card balance"},
	{Code: "2030", Name: "Line of Credit", Type: "LIABILITY", Description: "Revolving business line of credit"},
	{Code: "2100", Name: "Accrued Wages", Type: "LIABILITY", Description: "Wages earned but not yet paid"},
	{Code: "2510", Name: "Bank Loan", Type: "LIABILITY", Description: "Outstanding loan balances"},

	// ── 3xxx Equity ───────────────────────────────────────────────────────────
	{Code: "3010", Name: "Owner's Capital", Type: "EQUITY", Description: "Owner's investment in the business"},
	{Code: "3020", Name: "Retained Earnings", Type: "EQUITY", Description: "Cumulative profit kept in the business"},
	{Code: "3110", Name: "Owner's Draw", Type: "EQUITY", Description: "Distributions and withdrawals by owner"},

	// ── 4xxx Revenue (IRS Schedule C Form 1040 Part I) ─────────────────────────
	{Code: "4010", Name: "Sales Revenue", Type: "REVENUE", Description: "Income from product sales", ScheduleCLine: "Line 1 - Gross receipts or sales"},
	{Code: "4090", Name: "Returns & Allowances", Type: "REVENUE", Description: "Customer refunds, sales returns, and discounts", ScheduleCLine: "Line 2 - Returns and allowances"},
	{Code: "4110", Name: "Service Fees", Type: "REVENUE", Description: "Income from services rendered", ScheduleCLine: "Line 1 - Gross receipts or sales"},
	{Code: "4210", Name: "Interest Income", Type: "REVENUE", Description: "Interest earned on accounts", ScheduleCLine: "Line 6 - Other income"},

	// ── 5xxx Expenses (IRS Schedule C Form 1040 Part II) ───────────────────────
	{Code: "5000", Name: "Cost of Goods Sold (COGS)", Type: "EXPENSE", Description: "Direct inventory costs and materials for sold goods", ScheduleCLine: "Line 4 - Cost of goods sold"},
	{Code: "5010", Name: "Rent", Type: "EXPENSE", Description: "Office or workspace rent", ScheduleCLine: "Line 20b - Rent or lease (other business property)"},
	{Code: "5015", Name: "Equipment Rental & Lease", Type: "EXPENSE", Description: "Rental of machinery, tools, vehicles, and equipment", ScheduleCLine: "Line 20a - Rent or lease (vehicles, machinery, and equipment)"},
	{Code: "5020", Name: "Payroll", Type: "EXPENSE", Description: "Employee wages and salaries", ScheduleCLine: "Line 26 - Wages"},
	{Code: "5025", Name: "Employee Benefits", Type: "EXPENSE", Description: "Staff health insurance, education, and employee wellness programs", ScheduleCLine: "Line 14 - Employee benefit programs"},
	{Code: "5030", Name: "Utilities", Type: "EXPENSE", Description: "Electricity, water, internet, etc.", ScheduleCLine: "Line 25 - Utilities"},
	{Code: "5040", Name: "Repairs & Maintenance", Type: "EXPENSE", Description: "Building, computer, and equipment repairs", ScheduleCLine: "Line 21 - Repairs and maintenance"},
	{Code: "5050", Name: "Office Supplies", Type: "EXPENSE", Description: "Stationery, printer supplies, and office materials", ScheduleCLine: "Line 18 - Office expense"},
	{Code: "5060", Name: "Supplies & Materials", Type: "EXPENSE", Description: "Operational supplies, shipping, packaging, and non-inventory goods", ScheduleCLine: "Line 22 - Supplies"},
	{Code: "5070", Name: "Home Office Expenses", Type: "EXPENSE", Description: "Simplified or actual home office business deduction (IRC § 280A)", ScheduleCLine: "Line 30 - Expenses for business use of your home"},
	{Code: "5080", Name: "Insurance", Type: "EXPENSE", Description: "Business insurance premiums", ScheduleCLine: "Line 15 - Insurance (other than health)"},
	{Code: "5090", Name: "Meals & Entertainment", Type: "EXPENSE", Description: "Client meals and business entertainment", ScheduleCLine: "Line 24b - Deductible meals (50%)"},
	{Code: "5110", Name: "Professional Services", Type: "EXPENSE", Description: "Accountant, lawyer, consultant fees", ScheduleCLine: "Line 17 - Legal and professional services"},
	{Code: "5120", Name: "Contract Labor", Type: "EXPENSE", Description: "1099-NEC subcontractors and freelance workers", ScheduleCLine: "Line 11 - Contract labor"},
	{Code: "5210", Name: "Software & Subscriptions", Type: "EXPENSE", Description: "SaaS tools, software licenses", ScheduleCLine: "Line 27a - Other expenses (Software & online services)"},
	{Code: "5310", Name: "Advertising", Type: "EXPENSE", Description: "Marketing and advertising costs", ScheduleCLine: "Line 8 - Advertising"},
	{Code: "5410", Name: "Travel", Type: "EXPENSE", Description: "Business travel and transportation", ScheduleCLine: "Line 24a - Travel"},
	{Code: "5510", Name: "Vehicle & Mileage", Type: "EXPENSE", Description: "Fuel, auto repairs, parking, tolls, business vehicle expenses", ScheduleCLine: "Line 9 - Car and truck expenses"},
	{Code: "5610", Name: "Taxes & Licenses", Type: "EXPENSE", Description: "Business licenses, state registration, permits, and property taxes", ScheduleCLine: "Line 23 - Taxes and licenses"},
	{Code: "5710", Name: "Interest Expense", Type: "EXPENSE", Description: "Business credit card interest, loan interest, and financing fees", ScheduleCLine: "Line 16b - Other interest"},
	{Code: "5720", Name: "Depreciation & Amortization", Type: "EXPENSE", Description: "Asset depreciation and Section 179 expense write-offs", ScheduleCLine: "Line 13 - Depreciation and section 179 expense deduction"},
	{Code: "5810", Name: "Merchant & Processing Fees", Type: "EXPENSE", Description: "Credit card processing, Stripe, Square, and PayPal fees", ScheduleCLine: "Line 10 - Commissions and fees"},
	{Code: "5910", Name: "Bank Fees", Type: "EXPENSE", Description: "Bank service charges and fees", ScheduleCLine: "Line 27a - Other expenses (Bank & merchant fees)"},
}

// SeedChartOfAccounts inserts or updates the default accounts idempotently.
// If an account already exists, it ensures schedule_c_line and is_default are kept up to date.
func SeedChartOfAccounts() {
	if DB == nil {
		return
	}
	log.Println("Ensuring standard Chart of Accounts & Schedule C tax lines...")
	seeded := 0
	for _, entry := range defaultAccounts {
		var existing models.ChartAccount
		if err := DB.Where("code = ?", entry.Code).First(&existing).Error; err != nil {
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
			} else {
				seeded++
			}
		} else {
			// Update schedule_c_line or is_default if missing
			updates := make(map[string]interface{})
			if existing.ScheduleCLine == "" && entry.ScheduleCLine != "" {
				updates["schedule_c_line"] = entry.ScheduleCLine
			}
			if !existing.IsDefault {
				updates["is_default"] = true
			}
			if len(updates) > 0 {
				DB.Model(&existing).Updates(updates)
			}
		}
	}
	if seeded > 0 {
		log.Printf("Seeded %d new chart of accounts entries.\n", seeded)
	}
}

// defaultBankRuleEntry defines the template for common retailer/payee automated rules.
type defaultBankRuleEntry struct {
	Name          string
	RenamedVendor string
	AccountCode   string
	Keywords      []string
}

var defaultBankRules = []defaultBankRuleEntry{
	// ── 1. Fast Food, Coffee & Casual Dining (5090 Meals & Entertainment) ─────
	{Name: "McDonald's", RenamedVendor: "McDonald's", AccountCode: "5090", Keywords: []string{"mcdonald", "mcds", "mcd's", "mcdonalds"}},
	{Name: "Starbucks", RenamedVendor: "Starbucks", AccountCode: "5090", Keywords: []string{"starbucks", "sbux"}},
	{Name: "Dunkin'", RenamedVendor: "Dunkin'", AccountCode: "5090", Keywords: []string{"dunkin", "dnkn", "dunkin donuts"}},
	{Name: "Subway", RenamedVendor: "Subway", AccountCode: "5090", Keywords: []string{"subway"}},
	{Name: "Chipotle", RenamedVendor: "Chipotle", AccountCode: "5090", Keywords: []string{"chipotle", "chipotle mexican grill"}},
	{Name: "Panera Bread", RenamedVendor: "Panera Bread", AccountCode: "5090", Keywords: []string{"panera", "panera bread"}},
	{Name: "Wendy's", RenamedVendor: "Wendy's", AccountCode: "5090", Keywords: []string{"wendy's", "wendys"}},
	{Name: "Burger King", RenamedVendor: "Burger King", AccountCode: "5090", Keywords: []string{"burger king", "bk store", "bk #"}},
	{Name: "Taco Bell", RenamedVendor: "Taco Bell", AccountCode: "5090", Keywords: []string{"taco bell", "tacobell"}},
	{Name: "Chick-fil-A", RenamedVendor: "Chick-fil-A", AccountCode: "5090", Keywords: []string{"chick-fil-a", "chickfila", "cfa"}},
	{Name: "Domino's Pizza", RenamedVendor: "Domino's Pizza", AccountCode: "5090", Keywords: []string{"domino's", "dominos pizza", "dominos"}},
	{Name: "Pizza Hut", RenamedVendor: "Pizza Hut", AccountCode: "5090", Keywords: []string{"pizza hut"}},
	{Name: "Papa John's", RenamedVendor: "Papa John's", AccountCode: "5090", Keywords: []string{"papa john's", "papajohns"}},
	{Name: "KFC", RenamedVendor: "KFC", AccountCode: "5090", Keywords: []string{"kfc", "kentucky fried chicken"}},
	{Name: "Popeyes", RenamedVendor: "Popeyes", AccountCode: "5090", Keywords: []string{"popeyes", "popeyes chicken"}},
	{Name: "Panda Express", RenamedVendor: "Panda Express", AccountCode: "5090", Keywords: []string{"panda express"}},
	{Name: "Five Guys", RenamedVendor: "Five Guys", AccountCode: "5090", Keywords: []string{"five guys"}},
	{Name: "In-N-Out Burger", RenamedVendor: "In-N-Out Burger", AccountCode: "5090", Keywords: []string{"in-n-out", "innout"}},
	{Name: "Shake Shack", RenamedVendor: "Shake Shack", AccountCode: "5090", Keywords: []string{"shake shack"}},
	{Name: "Jimmy John's", RenamedVendor: "Jimmy John's", AccountCode: "5090", Keywords: []string{"jimmy john's", "jimmy johns"}},
	{Name: "Jersey Mike's", RenamedVendor: "Jersey Mike's", AccountCode: "5090", Keywords: []string{"jersey mike's", "jersey mikes"}},
	{Name: "Arby's", RenamedVendor: "Arby's", AccountCode: "5090", Keywords: []string{"arby's", "arbys"}},
	{Name: "Sonic Drive-In", RenamedVendor: "Sonic Drive-In", AccountCode: "5090", Keywords: []string{"sonic drive-in", "sonic drive in"}},
	{Name: "Dairy Queen", RenamedVendor: "Dairy Queen", AccountCode: "5090", Keywords: []string{"dairy queen", "dq grill"}},
	{Name: "Jack in the Box", RenamedVendor: "Jack in the Box", AccountCode: "5090", Keywords: []string{"jack in the box"}},
	{Name: "DoorDash", RenamedVendor: "DoorDash", AccountCode: "5090", Keywords: []string{"doordash", "drdsh"}},
	{Name: "Uber Eats", RenamedVendor: "Uber Eats", AccountCode: "5090", Keywords: []string{"uber eats", "ubereats"}},
	{Name: "Grubhub", RenamedVendor: "Grubhub", AccountCode: "5090", Keywords: []string{"grubhub", "seamless"}},
	{Name: "Instacart", RenamedVendor: "Instacart", AccountCode: "5090", Keywords: []string{"instacart"}},

	// ── 2. Major Retailers, Supercenters & Wholesale (5060 Supplies / 5050 Office)
	{Name: "Walmart", RenamedVendor: "Walmart", AccountCode: "5060", Keywords: []string{"wal-mart", "walmart", "wm supercenter", "wmt store", "wmt.com"}},
	{Name: "Target", RenamedVendor: "Target", AccountCode: "5060", Keywords: []string{"target.com", "target t-", "tgt store", "target corp", "target"}},
	{Name: "Costco", RenamedVendor: "Costco", AccountCode: "5060", Keywords: []string{"costco whse", "costco wholesale", "costco.com", "costco"}},
	{Name: "Sam's Club", RenamedVendor: "Sam's Club", AccountCode: "5060", Keywords: []string{"sam's club", "sams club", "samsclub"}},
	{Name: "BJ's Wholesale Club", RenamedVendor: "BJ's Wholesale Club", AccountCode: "5060", Keywords: []string{"bj's wholesale", "bjs wholesale"}},
	{Name: "Walgreens", RenamedVendor: "Walgreens", AccountCode: "5060", Keywords: []string{"walgreens", "walgreen"}},
	{Name: "CVS Pharmacy", RenamedVendor: "CVS", AccountCode: "5060", Keywords: []string{"cvs/pharmacy", "cvs pharmacy", "cvs"}},
	{Name: "Kroger", RenamedVendor: "Kroger", AccountCode: "5060", Keywords: []string{"kroger"}},
	{Name: "ALDI", RenamedVendor: "ALDI", AccountCode: "5060", Keywords: []string{"aldi"}},
	{Name: "Trader Joe's", RenamedVendor: "Trader Joe's", AccountCode: "5060", Keywords: []string{"trader joe's", "trader joes"}},
	{Name: "Whole Foods", RenamedVendor: "Whole Foods", AccountCode: "5060", Keywords: []string{"whole foods", "wholefoods"}},
	{Name: "Publix", RenamedVendor: "Publix", AccountCode: "5060", Keywords: []string{"publix"}},
	{Name: "Dollar General", RenamedVendor: "Dollar General", AccountCode: "5060", Keywords: []string{"dollar general", "dg retail"}},
	{Name: "Dollar Tree", RenamedVendor: "Dollar Tree", AccountCode: "5060", Keywords: []string{"dollar tree"}},
	{Name: "Wegmans", RenamedVendor: "Wegmans", AccountCode: "5060", Keywords: []string{"wegmans"}},
	{Name: "H-E-B", RenamedVendor: "H-E-B", AccountCode: "5060", Keywords: []string{"h-e-b", "heb grocery"}},
	{Name: "Meijer", RenamedVendor: "Meijer", AccountCode: "5060", Keywords: []string{"meijer"}},
	{Name: "Amazon", RenamedVendor: "Amazon", AccountCode: "5050", Keywords: []string{"amzn", "amazon.com", "amazon prime", "amazon mktp", "amazon"}},
	{Name: "Staples", RenamedVendor: "Staples", AccountCode: "5050", Keywords: []string{"staples", "staples.com", "staples direct"}},
	{Name: "Office Depot", RenamedVendor: "Office Depot", AccountCode: "5050", Keywords: []string{"office depot", "officedepot", "officemax"}},
	{Name: "Best Buy", RenamedVendor: "Best Buy", AccountCode: "5050", Keywords: []string{"best buy", "bestbuy.com", "bby #"}},

	// ── 3. Home Improvement, Facilities & Maintenance (5040 Repairs & Maintenance)
	{Name: "The Home Depot", RenamedVendor: "The Home Depot", AccountCode: "5040", Keywords: []string{"home depot", "homedepot", "thd store"}},
	{Name: "Lowe's", RenamedVendor: "Lowe's", AccountCode: "5040", Keywords: []string{"lowes", "lowe's"}},
	{Name: "Menards", RenamedVendor: "Menards", AccountCode: "5040", Keywords: []string{"menards"}},
	{Name: "Ace Hardware", RenamedVendor: "Ace Hardware", AccountCode: "5040", Keywords: []string{"ace hardware", "ace hdwe"}},
	{Name: "Harbor Freight Tools", RenamedVendor: "Harbor Freight Tools", AccountCode: "5040", Keywords: []string{"harbor freight"}},
	{Name: "Tractor Supply", RenamedVendor: "Tractor Supply", AccountCode: "5040", Keywords: []string{"tractor supply", "tsc store"}},

	// ── 4. Vehicle Fuel, Auto Maintenance & Fleet (5510 Vehicle & Mileage) ────
	{Name: "Shell Fuel", RenamedVendor: "Shell", AccountCode: "5510", Keywords: []string{"shell oil", "shell service", "shell food", "shell"}},
	{Name: "ExxonMobil Fuel", RenamedVendor: "ExxonMobil", AccountCode: "5510", Keywords: []string{"exxon", "mobil", "exxonmobil"}},
	{Name: "Chevron Fuel", RenamedVendor: "Chevron", AccountCode: "5510", Keywords: []string{"chevron", "texaco"}},
	{Name: "BP Fuel", RenamedVendor: "BP", AccountCode: "5510", Keywords: []string{"bp gas", "bp oil", "bp connect"}},
	{Name: "Speedway Fuel", RenamedVendor: "Speedway", AccountCode: "5510", Keywords: []string{"speedway"}},
	{Name: "Wawa Fuel & Food", RenamedVendor: "Wawa", AccountCode: "5510", Keywords: []string{"wawa", "wawa store"}},
	{Name: "Sunoco Fuel", RenamedVendor: "Sunoco", AccountCode: "5510", Keywords: []string{"sunoco"}},
	{Name: "7-Eleven", RenamedVendor: "7-Eleven", AccountCode: "5510", Keywords: []string{"7-eleven", "7 eleven", "seven eleven"}},
	{Name: "Circle K", RenamedVendor: "Circle K", AccountCode: "5510", Keywords: []string{"circle k"}},
	{Name: "QuikTrip", RenamedVendor: "QuikTrip", AccountCode: "5510", Keywords: []string{"quiktrip", "qt #"}},
	{Name: "Love's Travel Stops", RenamedVendor: "Love's Travel Stops", AccountCode: "5510", Keywords: []string{"love's travel", "loves travel"}},
	{Name: "Pilot Flying J", RenamedVendor: "Pilot Flying J", AccountCode: "5510", Keywords: []string{"pilot flying j", "pilot travel"}},
	{Name: "Buc-ee's", RenamedVendor: "Buc-ee's", AccountCode: "5510", Keywords: []string{"buc-ee's", "bucees"}},
	{Name: "Casey's", RenamedVendor: "Casey's", AccountCode: "5510", Keywords: []string{"casey's general", "caseys"}},
	{Name: "Phillips 66", RenamedVendor: "Phillips 66", AccountCode: "5510", Keywords: []string{"phillips 66", "conoco"}},
	{Name: "Marathon", RenamedVendor: "Marathon", AccountCode: "5510", Keywords: []string{"marathon petro", "marathon oil"}},
	{Name: "Valero", RenamedVendor: "Valero", AccountCode: "5510", Keywords: []string{"valero"}},
	{Name: "AutoZone", RenamedVendor: "AutoZone", AccountCode: "5510", Keywords: []string{"autozone"}},
	{Name: "O'Reilly Auto Parts", RenamedVendor: "O'Reilly Auto Parts", AccountCode: "5510", Keywords: []string{"o'reilly auto", "oreilly auto"}},
	{Name: "Advance Auto Parts", RenamedVendor: "Advance Auto Parts", AccountCode: "5510", Keywords: []string{"advance auto parts", "advance auto"}},
	{Name: "NAPA Auto Parts", RenamedVendor: "NAPA Auto Parts", AccountCode: "5510", Keywords: []string{"napa auto parts", "napa auto"}},
	{Name: "Valvoline", RenamedVendor: "Valvoline", AccountCode: "5510", Keywords: []string{"valvoline"}},
	{Name: "Jiffy Lube", RenamedVendor: "Jiffy Lube", AccountCode: "5510", Keywords: []string{"jiffy lube"}},

	// ── 5. Software, Cloud & SaaS Subscriptions (5210 Software & Subscriptions)
	{Name: "Google Workspace", RenamedVendor: "Google Workspace", AccountCode: "5210", Keywords: []string{"google workspace", "google*workspace", "google cloud", "google*cloud", "google services", "google storage", "gsuite"}},
	{Name: "Microsoft 365", RenamedVendor: "Microsoft", AccountCode: "5210", Keywords: []string{"microsoft 365", "microsoft*365", "msft azure", "msft*azure", "microsoft store", "msft office", "msft*office"}},
	{Name: "Adobe Creative Cloud", RenamedVendor: "Adobe", AccountCode: "5210", Keywords: []string{"adobe creative", "adobe*creative", "adobe systems", "adobe inc"}},
	{Name: "GitHub", RenamedVendor: "GitHub", AccountCode: "5210", Keywords: []string{"github", "github.com"}},
	{Name: "Slack", RenamedVendor: "Slack", AccountCode: "5210", Keywords: []string{"slack technologies", "slack.com", "slack"}},
	{Name: "Zoom", RenamedVendor: "Zoom Video Communications", AccountCode: "5210", Keywords: []string{"zoom.us", "zoom video"}},
	{Name: "Intuit QuickBooks", RenamedVendor: "Intuit QuickBooks", AccountCode: "5210", Keywords: []string{"quickbooks", "quickbooks online", "qbo", "intuit payroll", "intuit"}},
	{Name: "OpenAI ChatGPT", RenamedVendor: "OpenAI", AccountCode: "5210", Keywords: []string{"openai", "chatgpt subscription", "chatgpt"}},
	{Name: "Anthropic Claude", RenamedVendor: "Anthropic", AccountCode: "5210", Keywords: []string{"anthropic", "claude.ai"}},
	{Name: "Amazon Web Services (AWS)", RenamedVendor: "Amazon Web Services (AWS)", AccountCode: "5210", Keywords: []string{"aws.amazon", "amazon web services", "aws cloud"}},
	{Name: "Apple Services", RenamedVendor: "Apple", AccountCode: "5210", Keywords: []string{"apple.com/bill", "apple store", "apple retail"}},
	{Name: "Dropbox", RenamedVendor: "Dropbox", AccountCode: "5210", Keywords: []string{"dropbox", "dropbox.com"}},
	{Name: "Box.com", RenamedVendor: "Box", AccountCode: "5210", Keywords: []string{"box inc", "box.com"}},
	{Name: "Notion", RenamedVendor: "Notion", AccountCode: "5210", Keywords: []string{"notion labs", "notion.so"}},
	{Name: "Atlassian", RenamedVendor: "Atlassian", AccountCode: "5210", Keywords: []string{"atlassian", "jira", "confluence", "trello"}},
	{Name: "Figma", RenamedVendor: "Figma", AccountCode: "5210", Keywords: []string{"figma", "figma.com"}},
	{Name: "Canva", RenamedVendor: "Canva", AccountCode: "5210", Keywords: []string{"canva", "canva pty"}},
	{Name: "HubSpot", RenamedVendor: "HubSpot", AccountCode: "5210", Keywords: []string{"hubspot", "hubspot inc"}},
	{Name: "Salesforce", RenamedVendor: "Salesforce", AccountCode: "5210", Keywords: []string{"salesforce", "salesforce.com"}},
	{Name: "Mailchimp", RenamedVendor: "Mailchimp", AccountCode: "5210", Keywords: []string{"mailchimp", "the rocket science group"}},
	{Name: "GoDaddy", RenamedVendor: "GoDaddy", AccountCode: "5210", Keywords: []string{"godaddy", "godaddy.com"}},
	{Name: "Namecheap", RenamedVendor: "Namecheap", AccountCode: "5210", Keywords: []string{"namecheap", "name-cheap"}},
	{Name: "Cloudflare", RenamedVendor: "Cloudflare", AccountCode: "5210", Keywords: []string{"cloudflare", "cloudflare inc"}},
	{Name: "DigitalOcean", RenamedVendor: "DigitalOcean", AccountCode: "5210", Keywords: []string{"digitalocean", "digital ocean"}},
	{Name: "Heroku", RenamedVendor: "Heroku", AccountCode: "5210", Keywords: []string{"heroku"}},
	{Name: "Vercel", RenamedVendor: "Vercel", AccountCode: "5210", Keywords: []string{"vercel", "vercel inc"}},
	{Name: "Netlify", RenamedVendor: "Netlify", AccountCode: "5210", Keywords: []string{"netlify"}},
	{Name: "1Password", RenamedVendor: "1Password", AccountCode: "5210", Keywords: []string{"1password", "agilebits"}},
	{Name: "LastPass", RenamedVendor: "LastPass", AccountCode: "5210", Keywords: []string{"lastpass"}},
	{Name: "DocuSign", RenamedVendor: "DocuSign", AccountCode: "5210", Keywords: []string{"docusign", "docusign inc"}},
	{Name: "Zendesk", RenamedVendor: "Zendesk", AccountCode: "5210", Keywords: []string{"zendesk"}},
	{Name: "Shopify", RenamedVendor: "Shopify", AccountCode: "5210", Keywords: []string{"shopify", "shopify fee"}},
	{Name: "Squarespace", RenamedVendor: "Squarespace", AccountCode: "5210", Keywords: []string{"squarespace"}},
	{Name: "Wix", RenamedVendor: "Wix", AccountCode: "5210", Keywords: []string{"wix.com", "wixcom"}},
	{Name: "WordPress", RenamedVendor: "WordPress", AccountCode: "5210", Keywords: []string{"wordpress.com", "automattic"}},
	{Name: "Loom", RenamedVendor: "Loom", AccountCode: "5210", Keywords: []string{"loom inc", "loom.com"}},
	{Name: "Grammarly", RenamedVendor: "Grammarly", AccountCode: "5210", Keywords: []string{"grammarly"}},

	// ── 6. Shipping, Packing & Logistics (5050 Office Supplies) ───────────────
	{Name: "USPS Postage", RenamedVendor: "USPS", AccountCode: "5050", Keywords: []string{"usps", "us postal service", "post office"}},
	{Name: "FedEx Shipping", RenamedVendor: "FedEx", AccountCode: "5050", Keywords: []string{"fedex", "fedex freight", "federal express"}},
	{Name: "The UPS Store", RenamedVendor: "The UPS Store", AccountCode: "5050", Keywords: []string{"ups store", "united parcel svc", "the ups store"}},
	{Name: "DHL Express", RenamedVendor: "DHL Express", AccountCode: "5050", Keywords: []string{"dhl express", "dhl supply"}},
	{Name: "Stamps.com", RenamedVendor: "Stamps.com", AccountCode: "5050", Keywords: []string{"stamps.com"}},
	{Name: "Pirate Ship", RenamedVendor: "Pirate Ship", AccountCode: "5050", Keywords: []string{"pirate ship", "pirateship"}},
	{Name: "ShipStation", RenamedVendor: "ShipStation", AccountCode: "5050", Keywords: []string{"shipstation"}},
	{Name: "Pitney Bowes", RenamedVendor: "Pitney Bowes", AccountCode: "5050", Keywords: []string{"pitney bowes"}},

	// ── 7. Travel, Airlines, Rideshare & Lodging (5410 Travel) ────────────────
	{Name: "Uber Rides", RenamedVendor: "Uber", AccountCode: "5410", Keywords: []string{"uber trip", "uber*trip", "uber ride", "uber*ride"}},
	{Name: "Lyft Rides", RenamedVendor: "Lyft", AccountCode: "5410", Keywords: []string{"lyft ride", "lyft*ride", "lyft trip"}},
	{Name: "Delta Air Lines", RenamedVendor: "Delta Air Lines", AccountCode: "5410", Keywords: []string{"delta air", "delta.com"}},
	{Name: "United Airlines", RenamedVendor: "United Airlines", AccountCode: "5410", Keywords: []string{"united air", "united.com"}},
	{Name: "American Airlines", RenamedVendor: "American Airlines", AccountCode: "5410", Keywords: []string{"american air", "aa.com"}},
	{Name: "Southwest Airlines", RenamedVendor: "Southwest Airlines", AccountCode: "5410", Keywords: []string{"southwest air", "southwest airlines", "wn air"}},
	{Name: "JetBlue", RenamedVendor: "JetBlue", AccountCode: "5410", Keywords: []string{"jetblue", "jetblue airways"}},
	{Name: "Alaska Airlines", RenamedVendor: "Alaska Airlines", AccountCode: "5410", Keywords: []string{"alaska air", "alaska airlines"}},
	{Name: "Enterprise Rent-A-Car", RenamedVendor: "Enterprise Rent-A-Car", AccountCode: "5410", Keywords: []string{"enterprise rent-a-car", "enterprise rent a car"}},
	{Name: "Hertz", RenamedVendor: "Hertz", AccountCode: "5410", Keywords: []string{"hertz rent-a-car", "hertz toll", "hertz"}},
	{Name: "Avis", RenamedVendor: "Avis", AccountCode: "5410", Keywords: []string{"avis rent a car", "avis.com"}},
	{Name: "Budget Rent A Car", RenamedVendor: "Budget Rent A Car", AccountCode: "5410", Keywords: []string{"budget rent a car", "budget rent-a-car"}},
	{Name: "National Car Rental", RenamedVendor: "National Car Rental", AccountCode: "5410", Keywords: []string{"national car rental"}},
	{Name: "Amtrak", RenamedVendor: "Amtrak", AccountCode: "5410", Keywords: []string{"amtrak"}},
	{Name: "Marriott", RenamedVendor: "Marriott", AccountCode: "5410", Keywords: []string{"marriott", "courtyard by marriott", "residence inn", "springhill suites"}},
	{Name: "Hilton", RenamedVendor: "Hilton", AccountCode: "5410", Keywords: []string{"hilton", "hampton inn", "doubletree", "embassy suites", "garden inn"}},
	{Name: "Hyatt", RenamedVendor: "Hyatt", AccountCode: "5410", Keywords: []string{"hyatt", "hyatt place", "hyatt regency"}},
	{Name: "Holiday Inn", RenamedVendor: "Holiday Inn", AccountCode: "5410", Keywords: []string{"holiday inn", "ihg hotels", "crowne plaza"}},
	{Name: "Best Western", RenamedVendor: "Best Western", AccountCode: "5410", Keywords: []string{"best western"}},
	{Name: "Airbnb", RenamedVendor: "Airbnb", AccountCode: "5410", Keywords: []string{"airbnb"}},
	{Name: "VRBO", RenamedVendor: "VRBO", AccountCode: "5410", Keywords: []string{"vrbo"}},

	// ── 8. Telecom, Internet & Office Utilities (5030 Utilities) ──────────────
	{Name: "Verizon", RenamedVendor: "Verizon", AccountCode: "5030", Keywords: []string{"verizon wireless", "vzw wireless", "verizon"}},
	{Name: "AT&T", RenamedVendor: "AT&T", AccountCode: "5030", Keywords: []string{"att wireless", "att*wireless", "at&t", "att bill payment"}},
	{Name: "T-Mobile", RenamedVendor: "T-Mobile", AccountCode: "5030", Keywords: []string{"t-mobile", "tmobile"}},
	{Name: "Comcast Xfinity", RenamedVendor: "Comcast Xfinity", AccountCode: "5030", Keywords: []string{"comcast", "xfinity"}},
	{Name: "Spectrum Internet", RenamedVendor: "Spectrum", AccountCode: "5030", Keywords: []string{"spectrum", "charter comm"}},
	{Name: "Cox Communications", RenamedVendor: "Cox Communications", AccountCode: "5030", Keywords: []string{"cox comm", "cox cable"}},
	{Name: "Optimum", RenamedVendor: "Optimum", AccountCode: "5030", Keywords: []string{"optimum", "altice"}},
	{Name: "CenturyLink", RenamedVendor: "CenturyLink", AccountCode: "5030", Keywords: []string{"centurylink", "lumen tech"}},
	{Name: "Duke Energy", RenamedVendor: "Duke Energy", AccountCode: "5030", Keywords: []string{"duke energy"}},
	{Name: "National Grid", RenamedVendor: "National Grid", AccountCode: "5030", Keywords: []string{"national grid"}},
	{Name: "Con Edison", RenamedVendor: "Con Edison", AccountCode: "5030", Keywords: []string{"con edison", "coned"}},
	{Name: "PG&E", RenamedVendor: "PG&E", AccountCode: "5030", Keywords: []string{"pacific gas & electric", "pg&e", "pge bill"}},
	{Name: "Southern California Edison", RenamedVendor: "Southern California Edison", AccountCode: "5030", Keywords: []string{"so cal edison", "sce bill"}},
	{Name: "Florida Power & Light", RenamedVendor: "Florida Power & Light", AccountCode: "5030", Keywords: []string{"fpl", "florida power light"}},
	{Name: "Waste Management", RenamedVendor: "Waste Management", AccountCode: "5030", Keywords: []string{"waste management", "wm corporate"}},

	// ── 9. Advertising & Digital Marketing (5310 Advertising) ─────────────────
	{Name: "Google Ads", RenamedVendor: "Google Ads", AccountCode: "5310", Keywords: []string{"google ads", "google*ads", "google adwords"}},
	{Name: "Meta Ads", RenamedVendor: "Meta Ads", AccountCode: "5310", Keywords: []string{"fb.me/ads", "facebook ads", "meta platforms"}},
	{Name: "LinkedIn Marketing", RenamedVendor: "LinkedIn", AccountCode: "5310", Keywords: []string{"linkedin", "linkedin corp"}},
	{Name: "X Ads", RenamedVendor: "X Ads", AccountCode: "5310", Keywords: []string{"twitter online ads", "x corp ads"}},
	{Name: "TikTok Ads", RenamedVendor: "TikTok Ads", AccountCode: "5310", Keywords: []string{"tiktok ads", "bytedance"}},
	{Name: "Yelp Advertising", RenamedVendor: "Yelp Advertising", AccountCode: "5310", Keywords: []string{"yelp inc", "yelp advertise"}},
	{Name: "Microsoft Advertising", RenamedVendor: "Microsoft Advertising", AccountCode: "5310", Keywords: []string{"msft bing ads", "bing ads"}},
	{Name: "Pinterest Ads", RenamedVendor: "Pinterest Ads", AccountCode: "5310", Keywords: []string{"pinterest ads"}},

	// ── 10. Payroll, Legal & Professional Services (5020 Payroll / 5110 Legal) 
	{Name: "Gusto Payroll", RenamedVendor: "Gusto", AccountCode: "5020", Keywords: []string{"gusto", "gusto payroll"}},
	{Name: "ADP Payroll", RenamedVendor: "ADP", AccountCode: "5020", Keywords: []string{"adp payroll", "adp direct deposit", "adp tax"}},
	{Name: "Paychex", RenamedVendor: "Paychex", AccountCode: "5020", Keywords: []string{"paychex"}},
	{Name: "LegalZoom", RenamedVendor: "LegalZoom", AccountCode: "5110", Keywords: []string{"legalzoom", "legal zoom"}},
	{Name: "Rocket Lawyer", RenamedVendor: "Rocket Lawyer", AccountCode: "5110", Keywords: []string{"rocket lawyer"}},

	// ── 11. Payment Processing & Merchant Fees (5810 Merchant & Processing Fees)
	{Name: "Stripe Fees", RenamedVendor: "Stripe", AccountCode: "5810", Keywords: []string{"stripe fee", "stripe payments", "stripe payout"}},
	{Name: "Square Processing Fees", RenamedVendor: "Square", AccountCode: "5810", Keywords: []string{"squareup", "square inc fee", "square fee", "sq *"}},
	{Name: "PayPal Processing Fees", RenamedVendor: "PayPal", AccountCode: "5810", Keywords: []string{"paypal fee", "paypal partner"}},
	{Name: "Authorize.Net", RenamedVendor: "Authorize.Net", AccountCode: "5810", Keywords: []string{"authorize.net", "authnet"}},
	{Name: "Clover", RenamedVendor: "Clover", AccountCode: "5810", Keywords: []string{"clover network", "clover"}},
	{Name: "Toast", RenamedVendor: "Toast", AccountCode: "5810", Keywords: []string{"toast tab", "toast inc"}},
	{Name: "Chase Paymentech", RenamedVendor: "Chase Paymentech", AccountCode: "5810", Keywords: []string{"chase paymentech", "chase merchant"}},

	// ── 12. Bank Service Charges & Fees (5910 Bank Fees) ──────────────────────
	{Name: "Bank of America Service Fee", RenamedVendor: "Bank of America", AccountCode: "5910", Keywords: []string{"bofa wire fee", "boa monthly fee", "bofa fee"}},
	{Name: "Wells Fargo Service Fee", RenamedVendor: "Wells Fargo", AccountCode: "5910", Keywords: []string{"wells fargo fee", "wf monthly service"}},
	{Name: "JPMorgan Chase Fee", RenamedVendor: "JPMorgan Chase", AccountCode: "5910", Keywords: []string{"chase service fee", "jpmorgan chase fee"}},
}

// SeedDefaultBankRules inserts default automated bank categorization rules if not already present.
func SeedDefaultBankRules() {
	if DB == nil {
		return
	}
	var accounts []models.ChartAccount
	if err := DB.Find(&accounts).Error; err != nil {
		log.Printf("⚠️ SeedDefaultBankRules: failed to load accounts: %v\n", err)
		return
	}

	codeToID := make(map[string]uint)
	for _, acc := range accounts {
		codeToID[acc.Code] = acc.ID
	}

	seeded := 0
	for idx, entry := range defaultBankRules {
		var existing models.BankRule
		if err := DB.Where("name = ?", entry.Name).First(&existing).Error; err == nil {
			continue // Already seeded
		}

		targetAccountID, ok := codeToID[entry.AccountCode]
		var catIDPtr *uint
		if ok {
			catIDPtr = &targetAccountID
		}

		var conditions []models.RuleCondition
		for _, kw := range entry.Keywords {
			conditions = append(conditions, models.RuleCondition{
				Field:    "description",
				Operator: "contains",
				Value:    kw,
			})
		}

		condsJSON, err := json.Marshal(conditions)
		if err != nil {
			continue
		}

		rule := models.BankRule{
			Name:              entry.Name,
			Priority:          (idx + 1) * 10,
			Active:            true,
			MatchLogic:        "OR",
			ConditionsJSON:    string(condsJSON),
			CategoryAccountID: catIDPtr,
			RenamedVendor:     entry.RenamedVendor,
			AutoConfirm:       false,
		}

		if err := DB.Create(&rule).Error; err != nil {
			log.Printf("Failed to seed bank rule %s: %v\n", entry.Name, err)
		} else {
			seeded++
		}
	}

	if seeded > 0 {
		log.Printf("Seeded %d default bank categorization rules.\n", seeded)
	}
}
