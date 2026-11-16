# Reflex Tech Bookkeeping Platform — Accounting Domain Specification & Feature Blueprint

**Target Application**: Reflex Tech Bookkeeping Platform (`/Users/aj/Code/reflex/reflex-tech-bookkeeping-app`)  
**Publisher**: Reflex Technologies LLC (Utica, NY)  
**System Architecture**: Local-first single-entry ledger engineered with GAAP rigor, preparing for seamless evolution into double-entry accounting.

---

## 1. Product Vision & Target Personas

### Persona 1: The Non-Financial Business Owner
- **Primary Need**: Painless bookkeeping, zero confusing accounting jargon, maximum automation, clarity on profit and cash flow.
- **Workflow**: Drop receipts on a network office scanner (`/mnt/inbox`) or drag-and-drop bank statements. See clear status badges (`BALANCED`, `NEEDS_ATTENTION`, `UNLINKED`), plain-English revenue vs expense summaries, and real-time estimated quarterly tax liabilities without hiring an in-house bookkeeper.

### Persona 2: The Experienced CPA / Tax Accountant
- **Primary Need**: Mathematical certainty, strict GAAP Chart of Accounts (COA), exact IRS Schedule C tax mapping, 1099-NEC contractor compliance, closed-period lockouts, and immutable audit logs.
- **Workflow**: 1-Click CPA Tax Pack (.zip) export containing balanced CSV registers, IRS Schedule C summary, Trial Balance verification, and SHA-256 cryptographically verified receipt images.

---

## 2. Ingestion & Document Processing Pipeline

### 2.1 Bank Statement Ingestion (CSV & OFX/QFX)
- **File Codecs**: High-speed RFC 4180 CSV parser (`backend/utils/parseCsv.go`) and standard OFX 1.0–2.2 parser (`backend/utils/parseOfx.go`).
- **Initial Status Rules**:
  - Deposits ($\text{Amount} \ge 0$): Initialized as `AllocationStatus: "BALANCED"` (since deposits represent verified bank inflows) or flagged as candidates to pair against open client invoices.
  - Outflows ($\text{Amount} < 0$): Initialized as `AllocationStatus: "UNLINKED"` requiring categorization or receipt matching.
- **Deduplication**: Deduplicated via the financial institution transaction identifier (`FITID`) or a composite SHA-256 hash of `AccountID + Date + Amount + Description`.
- **Searchability**: Full-text indexing across `description`, `vendor`, `notes`, and `fit_id`.

### 2.2 Scanned Receipt & Bill Ingestion (Samba LAN Drops & Web Upload)
- **LAN Scanner Integration**: SMB network share (`/mnt/inbox`) running Samba (`dperson/samba`). Office network scanners drop physical paper receipts directly to the share without manual upload steps.
- **Debounce Safety**: `fsnotify` watcher monitors write completion, waiting for file size stability before OCR dispatch to prevent reading partial scanner drops.
- **OCR & Vision Intelligence**: Processed via the `file-processor` microservice (port `8081`) utilizing Ollama hosting `qwen2.5vl` vision. Extracts: Vendor, Date, Total Amount, Tax, Line Items, and Payment Method / Tender.
- **SHA-256 Deduplication**: Cryptographic hash computed upon file write. Duplicate receipts are flagged immediately to prevent double-counting expenses.
- **Cash Receipts & Petty Cash Handling**: Receipts extracted with payment tender of `cash` or `cash / paper` will **never** appear on a bank statement. Therefore, they are initialized with `AllocationStatus: "BALANCED"`, tracking out-of-pocket cash spend without blocking reconciliation.

---

## 3. Transaction Lifecycle, Linking Logic & State Transitions

### 3.1 Status Hierarchy & Meanings
- `BALANCED`: Fully accounted for, reconciled, categorized, or matched to a corresponding source document. No further action needed.
- `NEEDS_ATTENTION`: Has ambiguous data, multiple match candidates, or pending review rules.
- `UNLINKED`: A banking debit outflow that has not been matched to a receipt or categorized into an expense account.
- `EXCLUDED`: Explicitly removed from P&L calculations (e.g. personal expenses, owner draws, internal transfers).

### 3.2 Outflow Reconciliation (Bank Debit $\leftrightarrow$ Receipt/Expense)
- **Confidence Scoring Algorithm** (`0–100%`):
  - **Amount Match (40 pts)**: Exact integer-cent match (`abs(tx.Amount.Cents) == expense.Amount.Cents`).
  - **Date Match (30 pts)**: Exact same day (30 pts), $\pm 1$ day (25 pts), $\pm 3$ days (15 pts), $\pm 7$ days (5 pts).
  - **Vendor Match (30 pts)**: Normalized alphanumeric string comparison (stripping `LLC`, `INC`, store numbers, punctuation) with Levenshtein distance fallback.
- **Reconciliation Thresholds**:
  - Score $\ge 90\%$: High confidence match. Auto-suggested or 1-click confirmed.
  - Score $70\%–89\%$: Moderate confidence. Displayed in candidate list in Detail Drawer.
  - Score $< 70\%$: Low confidence. Requires manual user search.

### 3.3 Inflow Reconciliation (Bank Deposit $\leftrightarrow$ Client Invoice)
- **Bidirectional Relationship**:
  - Viewing a bank deposit shows matching open invoices by client name and exact balance due.
  - Viewing an invoice shows candidate bank deposits received around the payment date.
- **1-Click Match & Mark Paid**: Pairing a deposit with an invoice transitions invoice status to `PAID`, sets `AmountPaid = Total`, and associates `PaymentTransactionID`.
- **Partial Payments**: When a deposit is less than the invoice balance, user can record a partial payment; the invoice remains in `PARTIALLY_PAID` with remaining balance tracked.
- **Merchant Fee Handling**: When bank deposit is slightly less than invoice amount due to credit card processing fees (e.g. Stripe/Square 2.9% + 30¢), system splits the fee to an `EXPENSE: Bank & Merchant Fees` line while fully clearing the invoice.

### 3.4 Split Expenses (Integer-Cent Conservation)
- Single bank debit split across multiple expense categories or Schedule C lines (e.g., Walmart receipt split into Office Supplies + Computer Hardware).
- **Mathematical Law**: $\sum \text{Split Lines (Cents)} \equiv \text{Original Transaction (Cents)}$.
- Every split line validates category account existence and active status.

### 3.5 Internal Transfers & Equity Exclusions
- **Internal Account Transfers**: Moving money between business checking and business savings, or paying off a company credit card. Must be categorized as `TRANSFER` so neither leg counts as revenue or expense.
- **Owner's Equity**: Owner's Capital Contribution (deposit) or Owner's Draw (withdrawal) must map to 3xxx `EQUITY` accounts, bypassing the P&L statement entirely.

### 3.6 Absolute Manual Override Guarantee
- Automation proposes; the user disposes. The user MUST always be able to:
  - Unlink any matched transaction with 1 click.
  - Manually search and pair any receipt or invoice.
  - Override automated categorization at will.
  - Move items back into the Review Queue.

---

## 4. Screen-by-Screen Accounting Data Requirements

### 4.1 Accounts Receivable (A/R) Aging Report
- **Accounting Purpose**: Measures the liquidity and health of customer credit. Crucial for identifying bad debt risk and managing cash collection timelines.
- **Core Principle**: Aging MUST be computed strictly from the **Invoice Due Date** (NOT the invoice issue date), because an invoice is not delinquent until its contractual payment terms (e.g. Net 30) have expired.
- **Required Metric Cards**:
  1. `Total Receivables`: Total outstanding uncollected balance across all open invoices.
  2. `Current (Within Terms)`: Invoices where today $\le$ Due Date (healthy, expected cash).
  3. `Total Overdue`: Invoices where today $>$ Due Date (at risk, collection follow-up required).
  4. `Average Days Sales Outstanding (DSO)`: $\frac{\text{Total Receivables}}{\text{Total Credit Sales}} \times \text{Days in Period}$. Tells the owner how many days it typically takes to get paid.
  5. `Delinquency Rate %`: $\frac{\text{Total Overdue}}{\text{Total Receivables}} \times 100$.
- **Required Aging Buckets**:
  - `Current`: Not yet due.
  - `1–30 Days Past Due`: Mild delay (courtesy email reminder).
  - `31–60 Days Past Due`: Moderate delay (phone call, late fee warning).
  - `61–90 Days Past Due`: Severe delinquency (formal demand, stop work).
  - `90+ Days Past Due`: Critical bad debt risk (potential write-off or collection agency).
- **Required Invoices Table Columns**:
  - `Invoice #`: Unique identifier.
  - `Client Name`: Customer paying.
  - `Issue Date` & `Due Date`: Contractual timeline.
  - `Days Past Due`: Exact integer count of delinquent days.
  - `Total Amount`: Original invoice face value.
  - `Amount Paid`: Any recorded partial payments.
  - `Balance Due`: Remaining uncollected amount.
  - `Status Badge`: `SENT`, `PARTIALLY_PAID`, `OVERDUE`.
  - `Actions`: 1-Click view in drawer, 1-Click match candidate deposit.

### 4.2 Profit & Loss Statement (Income Statement)
- **Accounting Purpose**: Calculates the true operational profitability of the enterprise over a specified time period.
- **Required Structure**:
  - **Operating Revenue**: Total client invoice payments + direct bank deposits (excluding transfers and owner contributions).
  - **Cost of Goods Sold (COGS)**: Direct materials and subcontractor costs directly tied to revenue delivery.
  - **Gross Profit (Gross Margin)**: $\text{Operating Revenue} - \text{COGS}$.
  - **Operating Expenses**: Categorized strictly into GAAP 5xxx accounts (Advertising, Insurance, Legal/Professional, Office, Rent, Repairs, Software/Subscriptions, Taxes/Licenses, Travel, Meals [50% deductible], Utilities).
  - **Net Operating Income (Net Profit)**: $\text{Gross Profit} - \text{Operating Expenses}$.
- **Critical Sanity Checks**:
  - Owner's Draws (Account 3110) MUST NEVER appear as an expense.
  - Internal transfers between checking and savings MUST NEVER appear as revenue or expense.
  - 50% IRS limitation on business meals must be clearly disclosed or mapped.

### 4.3 Cash Flow & Liquidity Report
- **Accounting Purpose**: Cash is oxygen. A profitable business can still go bankrupt if cash collections lag behind expense outflows.
- **Required Metrics**:
  - `Total Cash Inflow`: Actual money deposited into bank accounts.
  - `Total Cash Outflow`: Actual money withdrawn or spent.
  - `Net Cash Change (Burn or Surplus)`: $\text{Inflows} - \text{Outflows}$.
  - `Average Monthly Burn Rate`: Trailing 3-month average outflow.
  - `Cash Runway`: $\frac{\text{Total Liquid Cash Balance}}{\text{Average Monthly Burn Rate}}$ in months.
  - `Reinvestment / Savings Rate %`: $\frac{\text{Net Cash Change}}{\text{Total Inflow}} \times 100$.
- **Monthly Trailing Comparison**: Month-by-month bars/rows showing cash momentum over time.

### 4.4 Vendor Spend & 1099-NEC Contractor Compliance
- **Accounting Purpose**: Tracks operational spend per vendor and enforces IRS 1099-NEC reporting compliance.
- **Required Metrics & Columns**:
  - `Payee / Vendor Name`: Normalized entity name.
  - `Total Spend`: Cumulative spend in the selected date window.
  - `Transaction Count`: Number of payments made.
  - `Average Payment`: Spend divided by count.
  - `Top 5 Vendor Concentration %`: Percentage of total spend concentrated in the 5 largest vendors (flags supplier risk).
  - `1099-NEC Status`: If vendor is a non-employee contractor and cumulative calendar spend $\ge \$600$, display an amber **"Requires 1099-NEC"** badge.
  - `Tax ID & W-9 Status`: Indicates whether a W-9 form is on file.

### 4.5 IRS Schedule C Tax Summary & Form 1040-ES
- **Accounting Purpose**: Maps every dollar directly to IRS Form 1040 Schedule C for solopreneurs and single-member LLCs, eliminating tax season scrambles.
- **Required Lines (1–31)**: Exact IRS categorization without "miscellaneous" dumping.
- **Form 1040-ES Quarterly Estimated Tax Vouchers**:
  - Calculates annual projected profit.
  - Self-Employment Tax (Schedule SE): $15.3\%$ on $92.35\%$ of net business profit ($12.4\%$ Social Security + $2.9\%$ Medicare).
  - Projected Federal Income Tax: Calculated based on solopreneur tax brackets.
  - 4 Quarterly Vouchers: Due April 15, June 15, September 15, January 15.
- **Solopreneur Optimizers**:
  - Standard Mileage (IRC § 162) vs Actual Expenses.
  - Simplified Home Office Deduction (IRC § 280A): \$5/sq ft up to 300 sq ft (\$1,500).

### 4.6 GAAP Trial Balance & 1-Click CPA Tax Pack
- **Accounting Purpose**: Mathematical proof that every financial transaction has equal debit and credit legs. The bridge to double-entry accounting.
- **Required Elements**:
  - Total Debits, Total Credits, Net Variance ($0.00).
  - Complete list of active accounts grouped by GAAP type (Asset, Liability, Equity, Revenue, Expense).
  - 1-Click CPA Tax Pack (.zip): Bundles CSV registers, Schedule C summary, Trial Balance CSV, and all SHA-256 verified receipt images into an audit-ready zip archive.

### 4.7 Detail Drawer & Source Document Linking
- **For Bank Outflows**: Cleared date, description, amount, category account, bank reference FITID, matched receipt image with zoom/pan, or candidate receipt list with match scores.
- **For Bank Inflows**: Cleared date, description, amount, paired client invoice, or candidate invoice list with balance matching.
- **For Client Invoices**: Invoice #, client name/email/address, issue date, due date, payment terms, itemized line items table, subtotal, tax rate, total, amount paid, balance due, linked deposit transaction ID, and candidate deposits.
- **For Receipts**: Interactive image canvas, vendor, date, category, tax amount, total amount, tender (`cash`, `credit`, `debit`), SHA-256 hash, and paired bank debit.

---

## 5. System Configuration & Business Settings

- **Company Profile**: Legal entity name, DBA, EIN/SSN (masked), business address, fiscal year end, accounting basis (Cash vs Accrual).
- **Chart of Accounts (COA)**: GAAP 1xxx–5xxx hierarchy with relational integrity guards (preventing deletion of accounts tied to active items).
- **Automated Bank Rules**: User-defined if-then rules where manual user categorizations always take precedence.
- **Closed-Period Lockout (`BooksClosedDate`)**: Protects historical filed tax years from tampering with HTTP 403 Forbidden.
- **Immutable Audit Trail (`ItemAuditLog`)**: Logs every change with timestamp, previous state, new state, actor, and reason.
- **Data Sovereignty**: 1-Click full system JSON backup/restore for 100% offline privacy with zero vendor lock-in.
