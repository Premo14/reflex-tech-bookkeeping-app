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
	// ── 1. Tools, Hardware, Building Supplies & Maintenance (5060 / 5040) ────
	{Name: "The Home Depot", RenamedVendor: "The Home Depot", AccountCode: "5060", Keywords: []string{"home depot", "homedepot", "homedepot.com", "thd store", "the home depot", "thd #"}},
	{Name: "Lowe's", RenamedVendor: "Lowe's", AccountCode: "5060", Keywords: []string{"lowes", "lowe's", "lowes.com", "lowes #"}},
	{Name: "Menards", RenamedVendor: "Menards", AccountCode: "5060", Keywords: []string{"menards", "menards.com", "menard"}},
	{Name: "Ace Hardware", RenamedVendor: "Ace Hardware", AccountCode: "5060", Keywords: []string{"ace hardware", "ace hdwe", "acehardware.com"}},
	{Name: "Harbor Freight Tools", RenamedVendor: "Harbor Freight Tools", AccountCode: "5060", Keywords: []string{"harbor freight", "harbor freight tools", "harborfreight.com", "hft store"}},
	{Name: "Tractor Supply", RenamedVendor: "Tractor Supply", AccountCode: "5060", Keywords: []string{"tractor supply", "tsc store", "tractorsupply.com"}},
	{Name: "Grainger", RenamedVendor: "Grainger", AccountCode: "5060", Keywords: []string{"grainger", "w.w. grainger", "ww grainger", "grainger.com"}},
	{Name: "McMaster-Carr", RenamedVendor: "McMaster-Carr", AccountCode: "5060", Keywords: []string{"mcmaster", "mcmaster-carr", "mcmaster carr", "mcmaster.com"}},
	{Name: "Fastenal", RenamedVendor: "Fastenal", AccountCode: "5060", Keywords: []string{"fastenal", "fastenal company", "fastenal.com"}},
	{Name: "Northern Tool + Equipment", RenamedVendor: "Northern Tool", AccountCode: "5060", Keywords: []string{"northern tool", "northern tool + equipment", "northerntool.com"}},
	{Name: "MSC Industrial Supply", RenamedVendor: "MSC Industrial", AccountCode: "5060", Keywords: []string{"msc industrial", "msc direct", "mscdirect.com", "sid tool"}},
	{Name: "Ferguson Enterprises", RenamedVendor: "Ferguson", AccountCode: "5060", Keywords: []string{"ferguson", "ferguson enterprises", "ferguson plumbing", "ferguson.com"}},
	{Name: "ABC Supply Co.", RenamedVendor: "ABC Supply", AccountCode: "5060", Keywords: []string{"abc supply", "abc supply co", "abcsupply.com"}},
	{Name: "Sherwin-Williams", RenamedVendor: "Sherwin-Williams", AccountCode: "5060", Keywords: []string{"sherwin-williams", "sherwin williams", "sherwin-will"}},
	{Name: "Rockler Woodworking", RenamedVendor: "Rockler", AccountCode: "5060", Keywords: []string{"rockler", "rockler woodworking", "rockler.com"}},
	{Name: "Woodcraft", RenamedVendor: "Woodcraft", AccountCode: "5060", Keywords: []string{"woodcraft", "woodcraft supply", "woodcraft.com"}},
	{Name: "Global Industrial", RenamedVendor: "Global Industrial", AccountCode: "5060", Keywords: []string{"global industrial", "globalequipment", "systemax"}},
	{Name: "Build.com", RenamedVendor: "Build.com", AccountCode: "5060", Keywords: []string{"build.com", "build with ferguson"}},

	// ── 2. Major Retailers, Supercenters & Wholesale Clubs (5060 Supplies) ────
	{Name: "Walmart", RenamedVendor: "Walmart", AccountCode: "5060", Keywords: []string{"wal-mart", "walmart", "wm supercenter", "wmt store", "wmt.com", "walmart.com", "wal-mart #"}},
	{Name: "Target", RenamedVendor: "Target", AccountCode: "5060", Keywords: []string{"target.com", "target t-", "tgt store", "target corp", "target", "target super"}},
	{Name: "Costco", RenamedVendor: "Costco", AccountCode: "5060", Keywords: []string{"costco whse", "costco wholesale", "costco.com", "costco", "costco gas"}},
	{Name: "Sam's Club", RenamedVendor: "Sam's Club", AccountCode: "5060", Keywords: []string{"sam's club", "sams club", "samsclub", "samsclub.com", "sam's club #"}},
	{Name: "BJ's Wholesale Club", RenamedVendor: "BJ's Wholesale Club", AccountCode: "5060", Keywords: []string{"bj's wholesale", "bjs wholesale", "bjs club", "bjs.com"}},
	{Name: "Walgreens", RenamedVendor: "Walgreens", AccountCode: "5060", Keywords: []string{"walgreens", "walgreen", "walgreen co"}},
	{Name: "CVS Pharmacy", RenamedVendor: "CVS", AccountCode: "5060", Keywords: []string{"cvs/pharmacy", "cvs pharmacy", "cvs", "cvs store"}},
	{Name: "Dollar General", RenamedVendor: "Dollar General", AccountCode: "5060", Keywords: []string{"dollar general", "dg retail", "dollar-general"}},
	{Name: "Dollar Tree", RenamedVendor: "Dollar Tree", AccountCode: "5060", Keywords: []string{"dollar tree", "family dollar", "dollartree.com"}},
	{Name: "Kroger", RenamedVendor: "Kroger", AccountCode: "5060", Keywords: []string{"kroger"}},
	{Name: "ALDI", RenamedVendor: "ALDI", AccountCode: "5060", Keywords: []string{"aldi"}},
	{Name: "Trader Joe's", RenamedVendor: "Trader Joe's", AccountCode: "5060", Keywords: []string{"trader joe's", "trader joes"}},
	{Name: "Whole Foods", RenamedVendor: "Whole Foods", AccountCode: "5060", Keywords: []string{"whole foods", "wholefoods"}},
	{Name: "Publix", RenamedVendor: "Publix", AccountCode: "5060", Keywords: []string{"publix"}},
	{Name: "Wegmans", RenamedVendor: "Wegmans", AccountCode: "5060", Keywords: []string{"wegmans"}},
	{Name: "H-E-B", RenamedVendor: "H-E-B", AccountCode: "5060", Keywords: []string{"h-e-b", "heb grocery"}},
	{Name: "Meijer", RenamedVendor: "Meijer", AccountCode: "5060", Keywords: []string{"meijer"}},

	// ── 3. Office Supplies, Packaging, Shipping & Electronics (5050 Office) ───
	{Name: "Amazon", RenamedVendor: "Amazon", AccountCode: "5050", Keywords: []string{"amzn", "amazon.com", "amazon prime", "amazon mktp", "amazon retail", "amzn mktp"}},
	{Name: "Staples", RenamedVendor: "Staples", AccountCode: "5050", Keywords: []string{"staples", "staples.com", "staples direct", "staples store"}},
	{Name: "Office Depot", RenamedVendor: "Office Depot", AccountCode: "5050", Keywords: []string{"office depot", "officedepot", "officemax", "office max", "officedepot.com"}},
	{Name: "Uline", RenamedVendor: "Uline", AccountCode: "5050", Keywords: []string{"uline", "uline shipping", "uline.com", "uline corp"}},
	{Name: "USPS Postage", RenamedVendor: "USPS", AccountCode: "5050", Keywords: []string{"usps", "us postal service", "post office", "usps.com", "stamps post"}},
	{Name: "FedEx Shipping", RenamedVendor: "FedEx", AccountCode: "5050", Keywords: []string{"fedex", "fedex freight", "federal express", "fedex ground", "fedex express", "fedex.com"}},
	{Name: "The UPS Store", RenamedVendor: "The UPS Store", AccountCode: "5050", Keywords: []string{"ups store", "the ups store", "united parcel svc", "ups freight", "ups shipping", "ups.com"}},
	{Name: "DHL Express", RenamedVendor: "DHL Express", AccountCode: "5050", Keywords: []string{"dhl express", "dhl supply", "dhl.com", "dhl parcel"}},
	{Name: "Pirate Ship", RenamedVendor: "Pirate Ship", AccountCode: "5050", Keywords: []string{"pirate ship", "pirateship", "pirateship.com"}},
	{Name: "Stamps.com", RenamedVendor: "Stamps.com", AccountCode: "5050", Keywords: []string{"stamps.com"}},
	{Name: "ShipStation", RenamedVendor: "ShipStation", AccountCode: "5050", Keywords: []string{"shipstation", "shipstation.com"}},
	{Name: "Pitney Bowes", RenamedVendor: "Pitney Bowes", AccountCode: "5050", Keywords: []string{"pitney bowes", "pitneybowes"}},
	{Name: "Best Buy", RenamedVendor: "Best Buy", AccountCode: "5050", Keywords: []string{"best buy", "bestbuy.com", "bby #", "best buy geek"}},
	{Name: "B&H Photo Video", RenamedVendor: "B&H Photo Video", AccountCode: "5050", Keywords: []string{"b&h photo", "bh photo", "bhphotovideo", "b&h photo video"}},
	{Name: "Micro Center", RenamedVendor: "Micro Center", AccountCode: "5050", Keywords: []string{"micro center", "microcenter", "microcenter.com"}},
	{Name: "Newegg", RenamedVendor: "Newegg", AccountCode: "5050", Keywords: []string{"newegg", "newegg.com"}},
	{Name: "CDW Direct", RenamedVendor: "CDW Direct", AccountCode: "5050", Keywords: []string{"cdw direct", "cdw.com", "cdw logistics"}},
	{Name: "Dell Technologies", RenamedVendor: "Dell", AccountCode: "5050", Keywords: []string{"dell", "dell technologies", "dell.com"}},
	{Name: "HP Inc", RenamedVendor: "HP", AccountCode: "5050", Keywords: []string{"hp inc", "hewlett-packard", "hp.com"}},
	{Name: "Apple Retail", RenamedVendor: "Apple", AccountCode: "5050", Keywords: []string{"apple store", "apple retail"}},

	// ── 4. Cloud Infrastructure, Developer Tools & SaaS (5210 Software) ───────
	// Specific cloud services precede broader accounts
	{Name: "Amazon Web Services (AWS)", RenamedVendor: "Amazon Web Services (AWS)", AccountCode: "5210", Keywords: []string{"aws.amazon", "amazon web services", "aws cloud", "aws charge", "aws*"}},
	{Name: "Google Cloud Platform", RenamedVendor: "Google Cloud", AccountCode: "5210", Keywords: []string{"google cloud", "google*cloud", "gcp cloud", "g.co/cloud"}},
	{Name: "Google Workspace", RenamedVendor: "Google Workspace", AccountCode: "5210", Keywords: []string{"google workspace", "google*workspace", "google services", "google storage", "gsuite", "google*gsuite"}},
	{Name: "Microsoft Azure", RenamedVendor: "Microsoft Azure", AccountCode: "5210", Keywords: []string{"msft azure", "msft*azure", "microsoft azure", "azure cloud"}},
	{Name: "Microsoft 365", RenamedVendor: "Microsoft", AccountCode: "5210", Keywords: []string{"microsoft 365", "microsoft*365", "msft office", "msft*office", "microsoft store", "microsoft payments"}},
	{Name: "GitHub", RenamedVendor: "GitHub", AccountCode: "5210", Keywords: []string{"github", "github.com", "github inc"}},
	{Name: "GitLab", RenamedVendor: "GitLab", AccountCode: "5210", Keywords: []string{"gitlab", "gitlab.com"}},
	{Name: "Docker", RenamedVendor: "Docker", AccountCode: "5210", Keywords: []string{"docker", "docker inc", "docker.com"}},
	{Name: "OpenAI ChatGPT", RenamedVendor: "OpenAI", AccountCode: "5210", Keywords: []string{"openai", "chatgpt subscription", "chatgpt", "openai*chatgpt"}},
	{Name: "Anthropic Claude", RenamedVendor: "Anthropic", AccountCode: "5210", Keywords: []string{"anthropic", "claude.ai", "anthropic direct"}},
	{Name: "Vercel", RenamedVendor: "Vercel", AccountCode: "5210", Keywords: []string{"vercel", "vercel inc", "vercel.com"}},
	{Name: "Netlify", RenamedVendor: "Netlify", AccountCode: "5210", Keywords: []string{"netlify", "netlify inc"}},
	{Name: "Cloudflare", RenamedVendor: "Cloudflare", AccountCode: "5210", Keywords: []string{"cloudflare", "cloudflare inc", "cloudflare.com"}},
	{Name: "DigitalOcean", RenamedVendor: "DigitalOcean", AccountCode: "5210", Keywords: []string{"digitalocean", "digital ocean", "digitalocean.com"}},
	{Name: "Heroku", RenamedVendor: "Heroku", AccountCode: "5210", Keywords: []string{"heroku", "salesforce heroku"}},
	{Name: "Supabase", RenamedVendor: "Supabase", AccountCode: "5210", Keywords: []string{"supabase", "supabase inc"}},
	{Name: "MongoDB Atlas", RenamedVendor: "MongoDB Atlas", AccountCode: "5210", Keywords: []string{"mongodb", "mongodb atlas", "mongodbatlas"}},
	{Name: "Datadog", RenamedVendor: "Datadog", AccountCode: "5210", Keywords: []string{"datadog", "datadoghq"}},
	{Name: "Sentry", RenamedVendor: "Sentry", AccountCode: "5210", Keywords: []string{"sentry.io", "functional software"}},
	{Name: "Postman", RenamedVendor: "Postman", AccountCode: "5210", Keywords: []string{"postman", "postman inc"}},
	{Name: "Slack", RenamedVendor: "Slack", AccountCode: "5210", Keywords: []string{"slack technologies", "slack.com", "slack"}},
	{Name: "Zoom", RenamedVendor: "Zoom Video Communications", AccountCode: "5210", Keywords: []string{"zoom.us", "zoom video", "zoom communication"}},
	{Name: "Atlassian", RenamedVendor: "Atlassian", AccountCode: "5210", Keywords: []string{"atlassian", "jira", "confluence", "trello"}},
	{Name: "Notion", RenamedVendor: "Notion", AccountCode: "5210", Keywords: []string{"notion labs", "notion.so"}},
	{Name: "Linear", RenamedVendor: "Linear", AccountCode: "5210", Keywords: []string{"linear.app", "linear orbit"}},
	{Name: "Asana", RenamedVendor: "Asana", AccountCode: "5210", Keywords: []string{"asana", "asana.com"}},
	{Name: "Monday.com", RenamedVendor: "Monday.com", AccountCode: "5210", Keywords: []string{"monday.com", "dapulse"}},
	{Name: "Basecamp", RenamedVendor: "Basecamp", AccountCode: "5210", Keywords: []string{"basecamp", "37signals"}},
	{Name: "Figma", RenamedVendor: "Figma", AccountCode: "5210", Keywords: []string{"figma", "figma.com"}},
	{Name: "Adobe Creative Cloud", RenamedVendor: "Adobe", AccountCode: "5210", Keywords: []string{"adobe creative", "adobe*creative", "adobe systems", "adobe inc", "adobe.com"}},
	{Name: "Canva", RenamedVendor: "Canva", AccountCode: "5210", Keywords: []string{"canva", "canva pty", "canva.com"}},
	{Name: "Intuit QuickBooks", RenamedVendor: "Intuit QuickBooks", AccountCode: "5210", Keywords: []string{"quickbooks", "quickbooks online", "qbo", "intuit payroll", "intuit"}},
	{Name: "FreshBooks", RenamedVendor: "FreshBooks", AccountCode: "5210", Keywords: []string{"freshbooks", "2ndsite"}},
	{Name: "Xero", RenamedVendor: "Xero", AccountCode: "5210", Keywords: []string{"xero", "xero.com", "xero accounting"}},
	{Name: "1Password", RenamedVendor: "1Password", AccountCode: "5210", Keywords: []string{"1password", "agilebits"}},
	{Name: "Bitwarden", RenamedVendor: "Bitwarden", AccountCode: "5210", Keywords: []string{"bitwarden", "bitwarden inc"}},
	{Name: "LastPass", RenamedVendor: "LastPass", AccountCode: "5210", Keywords: []string{"lastpass", "logmein"}},
	{Name: "DocuSign", RenamedVendor: "DocuSign", AccountCode: "5210", Keywords: []string{"docusign", "docusign inc"}},
	{Name: "PandaDoc", RenamedVendor: "PandaDoc", AccountCode: "5210", Keywords: []string{"pandadoc"}},
	{Name: "Dropbox", RenamedVendor: "Dropbox", AccountCode: "5210", Keywords: []string{"dropbox", "dropbox.com"}},
	{Name: "Box.com", RenamedVendor: "Box", AccountCode: "5210", Keywords: []string{"box inc", "box.com"}},
	{Name: "HubSpot", RenamedVendor: "HubSpot", AccountCode: "5210", Keywords: []string{"hubspot", "hubspot inc"}},
	{Name: "Salesforce", RenamedVendor: "Salesforce", AccountCode: "5210", Keywords: []string{"salesforce", "salesforce.com"}},
	{Name: "Mailchimp", RenamedVendor: "Mailchimp", AccountCode: "5210", Keywords: []string{"mailchimp", "the rocket science group"}},
	{Name: "Klaviyo", RenamedVendor: "Klaviyo", AccountCode: "5210", Keywords: []string{"klaviyo"}},
	{Name: "Twilio", RenamedVendor: "Twilio", AccountCode: "5210", Keywords: []string{"twilio", "sendgrid"}},
	{Name: "GoDaddy", RenamedVendor: "GoDaddy", AccountCode: "5210", Keywords: []string{"godaddy", "godaddy.com"}},
	{Name: "Namecheap", RenamedVendor: "Namecheap", AccountCode: "5210", Keywords: []string{"namecheap", "name-cheap"}},
	{Name: "Shopify", RenamedVendor: "Shopify", AccountCode: "5210", Keywords: []string{"shopify", "shopify fee"}},
	{Name: "Squarespace", RenamedVendor: "Squarespace", AccountCode: "5210", Keywords: []string{"squarespace", "squarespace.com"}},
	{Name: "Wix", RenamedVendor: "Wix", AccountCode: "5210", Keywords: []string{"wix.com", "wixcom"}},
	{Name: "WordPress", RenamedVendor: "WordPress", AccountCode: "5210", Keywords: []string{"wordpress.com", "automattic"}},
	{Name: "Loom", RenamedVendor: "Loom", AccountCode: "5210", Keywords: []string{"loom inc", "loom.com"}},
	{Name: "Grammarly", RenamedVendor: "Grammarly", AccountCode: "5210", Keywords: []string{"grammarly"}},
	{Name: "Apple Services", RenamedVendor: "Apple", AccountCode: "5210", Keywords: []string{"apple.com/bill", "itunes.com/bill", "apple developer"}},
	{Name: "JetBrains", RenamedVendor: "JetBrains", AccountCode: "5210", Keywords: []string{"jetbrains", "jetbrains s.r.o."}},
	{Name: "Zendesk", RenamedVendor: "Zendesk", AccountCode: "5210", Keywords: []string{"zendesk", "zendesk inc"}},

	// ── 5. Telecom, Internet & Office Utilities (5030 Utilities) ──────────────
	{Name: "Verizon", RenamedVendor: "Verizon", AccountCode: "5030", Keywords: []string{"verizon wireless", "vzw wireless", "verizon", "verizon business"}},
	{Name: "AT&T", RenamedVendor: "AT&T", AccountCode: "5030", Keywords: []string{"att wireless", "att*wireless", "at&t", "att bill payment", "att direct"}},
	{Name: "T-Mobile", RenamedVendor: "T-Mobile", AccountCode: "5030", Keywords: []string{"t-mobile", "tmobile", "t-mobile bill"}},
	{Name: "Comcast Xfinity", RenamedVendor: "Comcast Xfinity", AccountCode: "5030", Keywords: []string{"comcast", "xfinity", "comcast business"}},
	{Name: "Spectrum Internet", RenamedVendor: "Spectrum", AccountCode: "5030", Keywords: []string{"spectrum", "charter comm", "charter spectrum"}},
	{Name: "Cox Communications", RenamedVendor: "Cox Communications", AccountCode: "5030", Keywords: []string{"cox comm", "cox cable", "cox business"}},
	{Name: "National Grid", RenamedVendor: "National Grid", AccountCode: "5030", Keywords: []string{"national grid", "natgrid"}},
	{Name: "Con Edison", RenamedVendor: "Con Edison", AccountCode: "5030", Keywords: []string{"con edison", "coned", "consolidated edison"}},
	{Name: "Duke Energy", RenamedVendor: "Duke Energy", AccountCode: "5030", Keywords: []string{"duke energy", "duke power"}},
	{Name: "PG&E", RenamedVendor: "PG&E", AccountCode: "5030", Keywords: []string{"pacific gas & electric", "pg&e", "pge bill"}},
	{Name: "Florida Power & Light", RenamedVendor: "Florida Power & Light", AccountCode: "5030", Keywords: []string{"fpl", "florida power light"}},
	{Name: "Southern California Edison", RenamedVendor: "Southern California Edison", AccountCode: "5030", Keywords: []string{"so cal edison", "sce bill"}},
	{Name: "Waste Management", RenamedVendor: "Waste Management", AccountCode: "5030", Keywords: []string{"waste management", "wm corporate"}},
	{Name: "Optimum", RenamedVendor: "Optimum", AccountCode: "5030", Keywords: []string{"optimum", "altice"}},
	{Name: "CenturyLink", RenamedVendor: "CenturyLink", AccountCode: "5030", Keywords: []string{"centurylink", "lumen tech"}},

	// ── 6. Vehicle Fuel, Auto Maintenance & Fleet (5510 Vehicle & Mileage) ────
	{Name: "Shell Fuel", RenamedVendor: "Shell", AccountCode: "5510", Keywords: []string{"shell oil", "shell service", "shell food", "shell"}},
	{Name: "ExxonMobil Fuel", RenamedVendor: "ExxonMobil", AccountCode: "5510", Keywords: []string{"exxon", "mobil", "exxonmobil"}},
	{Name: "Chevron Fuel", RenamedVendor: "Chevron", AccountCode: "5510", Keywords: []string{"chevron", "texaco"}},
	{Name: "BP Fuel", RenamedVendor: "BP", AccountCode: "5510", Keywords: []string{"bp gas", "bp oil", "bp connect"}},
	{Name: "Sunoco Fuel", RenamedVendor: "Sunoco", AccountCode: "5510", Keywords: []string{"sunoco", "sunoco fuel"}},
	{Name: "Speedway Fuel", RenamedVendor: "Speedway", AccountCode: "5510", Keywords: []string{"speedway"}},
	{Name: "Wawa Fuel & Food", RenamedVendor: "Wawa", AccountCode: "5510", Keywords: []string{"wawa", "wawa store"}},
	{Name: "Buc-ee's", RenamedVendor: "Buc-ee's", AccountCode: "5510", Keywords: []string{"buc-ee's", "bucees"}},
	{Name: "Love's Travel Stops", RenamedVendor: "Love's Travel Stops", AccountCode: "5510", Keywords: []string{"love's travel", "loves travel", "love's country"}},
	{Name: "Pilot Flying J", RenamedVendor: "Pilot Flying J", AccountCode: "5510", Keywords: []string{"pilot flying j", "pilot travel", "flying j"}},
	{Name: "QuikTrip", RenamedVendor: "QuikTrip", AccountCode: "5510", Keywords: []string{"quiktrip", "qt #"}},
	{Name: "Circle K", RenamedVendor: "Circle K", AccountCode: "5510", Keywords: []string{"circle k"}},
	{Name: "7-Eleven", RenamedVendor: "7-Eleven", AccountCode: "5510", Keywords: []string{"7-eleven", "7 eleven", "seven eleven"}},
	{Name: "Phillips 66", RenamedVendor: "Phillips 66", AccountCode: "5510", Keywords: []string{"phillips 66", "conoco"}},
	{Name: "Marathon", RenamedVendor: "Marathon", AccountCode: "5510", Keywords: []string{"marathon petro", "marathon oil"}},
	{Name: "Valero", RenamedVendor: "Valero", AccountCode: "5510", Keywords: []string{"valero"}},
	{Name: "Casey's", RenamedVendor: "Casey's", AccountCode: "5510", Keywords: []string{"casey's general", "caseys"}},
	{Name: "AutoZone", RenamedVendor: "AutoZone", AccountCode: "5510", Keywords: []string{"autozone", "autozone store"}},
	{Name: "O'Reilly Auto Parts", RenamedVendor: "O'Reilly Auto Parts", AccountCode: "5510", Keywords: []string{"o'reilly auto", "oreilly auto", "o'reilly parts"}},
	{Name: "Advance Auto Parts", RenamedVendor: "Advance Auto Parts", AccountCode: "5510", Keywords: []string{"advance auto parts", "advance auto", "carquest"}},
	{Name: "NAPA Auto Parts", RenamedVendor: "NAPA Auto Parts", AccountCode: "5510", Keywords: []string{"napa auto parts", "napa auto"}},
	{Name: "Valvoline", RenamedVendor: "Valvoline", AccountCode: "5510", Keywords: []string{"valvoline", "valvoline instant"}},
	{Name: "Jiffy Lube", RenamedVendor: "Jiffy Lube", AccountCode: "5510", Keywords: []string{"jiffy lube"}},

	// ── 7. Advertising & Digital Marketing (5310 Advertising) ─────────────────
	{Name: "Google Ads", RenamedVendor: "Google Ads", AccountCode: "5310", Keywords: []string{"google ads", "google*ads", "google adwords"}},
	{Name: "Meta Ads", RenamedVendor: "Meta Ads", AccountCode: "5310", Keywords: []string{"fb.me/ads", "facebook ads", "meta platforms", "meta ads"}},
	{Name: "LinkedIn Marketing", RenamedVendor: "LinkedIn", AccountCode: "5310", Keywords: []string{"linkedin", "linkedin corp", "linkedin ads"}},
	{Name: "X Ads", RenamedVendor: "X Ads", AccountCode: "5310", Keywords: []string{"twitter online ads", "x corp ads", "twitter ads"}},
	{Name: "TikTok Ads", RenamedVendor: "TikTok Ads", AccountCode: "5310", Keywords: []string{"tiktok ads", "bytedance"}},
	{Name: "Microsoft Advertising", RenamedVendor: "Microsoft Advertising", AccountCode: "5310", Keywords: []string{"msft bing ads", "bing ads", "microsoft advertising"}},
	{Name: "Yelp Advertising", RenamedVendor: "Yelp Advertising", AccountCode: "5310", Keywords: []string{"yelp inc", "yelp advertise"}},
	{Name: "Pinterest Ads", RenamedVendor: "Pinterest Ads", AccountCode: "5310", Keywords: []string{"pinterest ads"}},

	// ── 8. Payroll, Legal & Professional Services (5020 Payroll / 5110 Legal) ─
	{Name: "Gusto Payroll", RenamedVendor: "Gusto", AccountCode: "5020", Keywords: []string{"gusto", "gusto payroll", "zenpayroll"}},
	{Name: "ADP Payroll", RenamedVendor: "ADP", AccountCode: "5020", Keywords: []string{"adp payroll", "adp direct deposit", "adp tax", "automatic data proc"}},
	{Name: "Paychex", RenamedVendor: "Paychex", AccountCode: "5020", Keywords: []string{"paychex", "paychex payroll"}},
	{Name: "Rippling", RenamedVendor: "Rippling", AccountCode: "5020", Keywords: []string{"rippling", "rippling payroll"}},
	{Name: "Deel", RenamedVendor: "Deel", AccountCode: "5120", Keywords: []string{"letsdeel", "deel inc"}},
	{Name: "LegalZoom", RenamedVendor: "LegalZoom", AccountCode: "5110", Keywords: []string{"legalzoom", "legal zoom"}},
	{Name: "Rocket Lawyer", RenamedVendor: "Rocket Lawyer", AccountCode: "5110", Keywords: []string{"rocket lawyer", "rocketlawyer"}},

	// ── 9. Payment Processing & Merchant Fees (5810) / Bank Fees (5910) ───────
	{Name: "Stripe Fees", RenamedVendor: "Stripe", AccountCode: "5810", Keywords: []string{"stripe fee", "stripe payments", "stripe payout", "stripe inc"}},
	{Name: "Square Processing Fees", RenamedVendor: "Square", AccountCode: "5810", Keywords: []string{"squareup", "square inc fee", "square fee", "sq *"}},
	{Name: "PayPal Processing Fees", RenamedVendor: "PayPal", AccountCode: "5810", Keywords: []string{"paypal fee", "paypal partner"}},
	{Name: "Toast", RenamedVendor: "Toast", AccountCode: "5810", Keywords: []string{"toast tab", "toast inc", "toast pos"}},
	{Name: "Clover", RenamedVendor: "Clover", AccountCode: "5810", Keywords: []string{"clover network", "clover", "clover pos"}},
	{Name: "Authorize.Net", RenamedVendor: "Authorize.Net", AccountCode: "5810", Keywords: []string{"authorize.net", "authnet"}},
	{Name: "Chase Paymentech", RenamedVendor: "Chase Paymentech", AccountCode: "5810", Keywords: []string{"chase paymentech", "chase merchant"}},
	{Name: "Bank of America Service Fee", RenamedVendor: "Bank of America", AccountCode: "5910", Keywords: []string{"bofa wire fee", "boa monthly fee", "bofa fee", "bofa service charge"}},
	{Name: "Wells Fargo Service Fee", RenamedVendor: "Wells Fargo", AccountCode: "5910", Keywords: []string{"wells fargo fee", "wf monthly service", "wells service fee"}},
	{Name: "JPMorgan Chase Fee", RenamedVendor: "JPMorgan Chase", AccountCode: "5910", Keywords: []string{"chase service fee", "jpmorgan chase fee", "chase wire fee"}},
	{Name: "Citibank Service Fee", RenamedVendor: "Citibank", AccountCode: "5910", Keywords: []string{"citibank fee", "citi monthly service"}},

	// ── 10. Travel, Airlines, Rideshare & Lodging (5410 Travel) ───────────────
	{Name: "Uber Rides", RenamedVendor: "Uber", AccountCode: "5410", Keywords: []string{"uber trip", "uber*trip", "uber ride", "uber*ride"}},
	{Name: "Lyft Rides", RenamedVendor: "Lyft", AccountCode: "5410", Keywords: []string{"lyft ride", "lyft*ride", "lyft trip"}},
	{Name: "Delta Air Lines", RenamedVendor: "Delta Air Lines", AccountCode: "5410", Keywords: []string{"delta air", "delta.com", "delta airlines"}},
	{Name: "United Airlines", RenamedVendor: "United Airlines", AccountCode: "5410", Keywords: []string{"united air", "united.com", "united airlines"}},
	{Name: "American Airlines", RenamedVendor: "American Airlines", AccountCode: "5410", Keywords: []string{"american air", "aa.com", "american airlines"}},
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
	{Name: "Airbnb", RenamedVendor: "Airbnb", AccountCode: "5410", Keywords: []string{"airbnb", "airbnb inc"}},
	{Name: "VRBO", RenamedVendor: "VRBO", AccountCode: "5410", Keywords: []string{"vrbo"}},

	// ── 11. Business Insurance (5080 Insurance) ───────────────────────────────
	{Name: "State Farm Insurance", RenamedVendor: "State Farm", AccountCode: "5080", Keywords: []string{"state farm", "state farm insurance"}},
	{Name: "Progressive Insurance", RenamedVendor: "Progressive", AccountCode: "5080", Keywords: []string{"progressive ins", "progressive commercial"}},
	{Name: "GEICO Insurance", RenamedVendor: "GEICO", AccountCode: "5080", Keywords: []string{"geico", "geico insurance"}},
	{Name: "Travelers Insurance", RenamedVendor: "Travelers", AccountCode: "5080", Keywords: []string{"travelers insurance", "the travelers"}},
	{Name: "The Hartford", RenamedVendor: "The Hartford", AccountCode: "5080", Keywords: []string{"the hartford", "hartford insurance"}},
	{Name: "Hiscox Insurance", RenamedVendor: "Hiscox", AccountCode: "5080", Keywords: []string{"hiscox", "hiscox insurance"}},
	{Name: "Next Insurance", RenamedVendor: "Next Insurance", AccountCode: "5080", Keywords: []string{"next insurance", "next insurance inc"}},

	// ── 12. Meals & Dining (5090 Meals & Entertainment) ───────────────────────
	// Placed at the end with lower evaluation priority than core business purchases
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
}

// SeedDefaultBankRules inserts default automated bank categorization rules if not already present.
func SeedDefaultBankRules() {
	if DB == nil {
		return
	}

	// 1. Clean up legacy duplicate if present
	DB.Where("name = ?", "McDonalds Fast Food").Delete(&models.BankRule{})

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

		priority := (idx + 1) * 10

		var existing models.BankRule
		if err := DB.Where("name = ?", entry.Name).First(&existing).Error; err == nil {
			// Preserve user customizations on existing rules across restarts.
			continue
		}

		rule := models.BankRule{
			Name:              entry.Name,
			Priority:          priority,
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
		log.Printf("Seeded %d new default rules.\n", seeded)
	}
}
