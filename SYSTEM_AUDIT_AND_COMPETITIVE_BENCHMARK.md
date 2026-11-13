# Reflex Tech Bookkeeping Platform — Master System Audit & Competitive Benchmark

**Publisher**: Reflex Technologies LLC (Utica, NY)  
**Mission**: Build a 100% private, local-first automated single-entry bookkeeping application that is significantly easier to use, faster, and more auditable than **QuickBooks Online**, **Wave**, and **FreshBooks**, with an evolutionary bridge to double-entry accounting.

---

## 1. Complete Application Architectural Inventory

This registry catalogs **100% of the application surface area** across all 4 architectural tiers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: DATABASE & STORAGE (PostgreSQL 18.4)                                │
│   - Tables: chart_accounts, bank_accounts, bank_transactions, expenses,    │
│             invoices, invoice_items, bank_rules, expense_bank_transactions, │
│             item_audit_logs, app_settings                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: BACKEND CORE BUSINESS LOGIC (Go 1.27 + Fiber v3)                    │
│   - Controllers: account, bank, bookFilters, exclusion, expense, export,    │
│                  invoice, reconciliation, report, review, rules, settings,  │
│                  summary, transaction, upload                                │
│   - Utils: parseCsv, parseOfx, processer, reconciler, rulesEngine            │
│   - Codecs: integer-cent Money API (models.Money)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: OCR & VISION INGESTION MICROSERVICE (Go 1.26.5 + fasthttp)          │
│   - Microservice: file-processor (:8081) with image normalization            │
│   - Local AI: Ollama running qwen2.5vl (vision) & llama3.1 (reasoning)      │
│   - Scanner Share: Samba SMB (/mnt/inbox)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ TIER 4: CLIENT INTERFACE & UI/UX (React 19 + Tailwind v4 + Vite v8)         │
│   - Views: LedgerGrid, InvoiceList, DetailDrawer, ReportsModal (6 tabs),    │
│            ReviewModal, AccountManager, AppSettingsModal, SettingsModal,    │
│            InvoicingModal, BankRulesTab, Header, Sidebar                     │
│   - Design System: GitHub precision + Resend radiance + Financial glows     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Competitive Benchmark: Reflex vs QuickBooks vs Wave vs FreshBooks

| Capability / Dimension | QuickBooks Online (QBO) | Wave Accounting | FreshBooks | Reflex Tech Bookkeeping (Target) |
| :--- | :--- | :--- | :--- | :--- |
| **Pricing & Subscriptions** | \$35–\$200+/month; annual price hikes | Freemium with paywalled bank feeds; paid payroll | \$19–\$60+/month; capped at 5 to 50 clients | **100% Free Forever; Zero monthly SaaS fees; Unlimited clients & transactions** |
| **Data Privacy & Sovereignty** | Cloud hosted; Intuit mines financial data | Cloud hosted; owned by H&R Block | Cloud hosted; third-party data centers | **100% Private & Local-First; Data never leaves your hardware; Full JSON backup** |
| **AI Receipt Scanning** | Cloud OCR; slow; requires mobile app upload | Removed free receipt scanning; paid add-on | Manual receipt attachment; basic OCR | **Direct LAN SMB scanner drops (`/mnt/inbox`); Local private Ollama vision (`qwen2.5vl`)** |
| **Financial Math Precision** | Prone to IEEE-754 float rounding errors | Float rounding discrepancies on split tax | Float rounding issues on multi-line items | **Strict Integer-Cent Arithmetic (`models.Money`), eliminating cent-drift** |
| **User Persona Fit** | Steep learning curve; confusing accounting jargon | Easy for solopreneurs, but lacks deep CPA tools | Great for freelance billing, terrible general ledger | **Dual-persona: Zero-jargon for owners + GAAP rigor & Trial Balance for CPAs** |
| **Receipt Verification** | Simple image attachment | Static attachment | Static attachment | **SHA-256 cryptographic image hashing; automated duplicate detection** |
| **Source Document View** | Separated screens for receipts, bills, and bank | Disconnected bank transactions and receipts | Invoices separated from expenses | **Unified split-screen ledger; Receipts & Client Invoices in one consolidated column** |
| **Tax Preparedness** | Generic reports; CPA export requires accountant seat | Basic CSV download | Basic P&L export | **1-Click CPA Tax Pack (.zip) with CSV registers, Schedule C, and verified receipts** |
| **Audit Defense & Lockout** | Closed-period lock only on advanced tiers | No closed-period lockout | Basic invoice locking | **Closed-Period Lockout (`BooksClosedDate`) + Immutable Audit Trail (`ItemAuditLog`)** |

---

## 3. The 8 Master System Modules (100% Coverage Checklist)

Every component of Reflex is mapped into one of these 8 self-contained modules. Reviewing all 8 modules guarantees **100% inspection of all code, database queries, logic, and UI/UX**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MODULE 1: Bank Feeds & Ingestion (CSV / OFX / QFX)                          │
│   - DB: bank_accounts, bank_transactions                                    │
│   - Backend: parseCsv.go, parseOfx.go, uploadController.go                  │
│   - Frontend: FileUploader.tsx, UploadModal.tsx                             │
│   - Audit: Deduplication via FITID/hash, date timezone safety, deposit      │
│            auto-balancing, and transfer detection.                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ MODULE 2: Network Scanner & Local AI Receipt Vision                         │
│   - DB: expenses, expense_bank_transactions                                 │
│   - Backend: processer.go, file-processor/main.go, main.go fsnotify inbox   │
│   - Local AI: Ollama qwen2.5vl vision dispatch, SHA-256 duplicate hashing   │
│   - Frontend: ReceiptThumbnailBadge.tsx, ReceiptList.tsx                    │
│   - Audit: Scanner write debouncing, cash tender auto-balancing, partial    │
│            OCR error handling, and memory-efficient image resizing.         │
├─────────────────────────────────────────────────────────────────────────────┤
│ MODULE 3: Reconciliation Engine & Confidence Scoring                        │
│   - DB: expense_bank_transactions, item_audit_logs                          │
│   - Backend: reconciler.go, reconciliationController.go                     │
│   - Frontend: ReviewModal.tsx, LedgerGrid.tsx toolbar                       │
│   - Audit: Amount/date/vendor scoring math (0–100%), 1-click auto-match,    │
│            partial allocation math, batch categorization, and SSE updates.  │
├─────────────────────────────────────────────────────────────────────────────┤
│ MODULE 4: Client Invoicing, A/R & Bank Deposit Matching                     │
│   - DB: invoices, invoice_items, bank_transactions (inflows)                │
│   - Backend: invoiceController.go, ar_aging_test.go                         │
│   - Frontend: InvoiceList.tsx, InvoicingModal.tsx, ReportsModal (A/R tab)   │
│   - Audit: Due-date aging calculation, DSO metric, payment status lifecycle │
│            (DRAFT/SENT/PAID/PARTIALLY_PAID), and merchant fee splits.       │
├─────────────────────────────────────────────────────────────────────────────┤
│ MODULE 5: Automated Bank Rules & User Overrides                             │
│   - DB: bank_rules                                                          │
│   - Backend: rulesEngine.go, rulesController.go                             │
│   - Frontend: BankRulesTab.tsx, BankRulesModal.tsx                          │
│   - Audit: If-then criteria matching (contains, equals, amount ranges),     │
│            execution priority, and user manual override preservation.       │
├─────────────────────────────────────────────────────────────────────────────┤
│ MODULE 6: The 7 Core Financial & Tax Reports                                │
│   - Backend: reportController.go, profit_loss_test.go                       │
│   - Frontend: ReportsModal.tsx across all 6 tabs                            │
│   - Audit:                                                                  │
│     * Tab 1 (P&L): Gross revenue, COGS, GAAP expenses, net margin %         │
│     * Tab 2 (Cash Flow): Monthly burn, runway in months, savings rate       │
│     * Tab 3 (Vendor Spend): Payee analytics, 1099-NEC $600 threshold alert  │
│     * Tab 4 (A/R Aging): 0/30/60/90 buckets, DSO selector, deep linking    │
│     * Tab 5 (Schedule C): Lines 1–31, 1040-ES quarterly vouchers, mileage   │
│     * Tab 6 (Trial Balance): Double-entry equality proof, active accounts   │
├─────────────────────────────────────────────────────────────────────────────┤
│ MODULE 7: Unified Slide-Over Detail Drawer & Visual Canvas                  │
│   - Frontend: DetailDrawer.tsx (all modes: transaction, invoice, receipt)   │
│   - Audit: High-resolution image canvas (zoom/pan/rotate), bank metadata,   │
│            interactive deposit-invoice matching, and split transaction view.│
├─────────────────────────────────────────────────────────────────────────────┤
│ MODULE 8: Business Settings, Chart of Accounts & Closed-Period Lockout      │
│   - DB: chart_accounts, app_settings                                        │
│   - Backend: accountController.go, settingsController.go, exportController  │
│   - Frontend: AccountManager.tsx, AppSettingsModal.tsx, SettingsModal.tsx   │
│   - Audit: GAAP 1xxx–5xxx hierarchy, relational deletion protection,        │
│            closed books lockout enforcement, and full JSON backup/restore.  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Competitive Gap Analysis & Action Matrix

When auditing each module, compare Reflex against the big three competitors:

### Where Reflex Currently Leads (Protect & Polish):
1. **Zero Privacy Risk**: Local Ollama AI extracts receipts without sending financial records to Intuit or third-party servers.
2. **Scanner Drop Simplicity**: Drop paper on an office scanner; receipt lands in the ledger automatically via Samba SMB.
3. **Exact Cents Engine**: Integer cents eliminate float rounding errors present in web-based competitors.
4. **GAAP Trial Balance Verification**: Math proves that debits equal credits, giving solopreneurs instant CPA credibility.

### Where Reflex Must Close Gaps to Surpass Competitors:
1. **Invoice Payment Terms & Reminders** (vs FreshBooks): Provide automated overdue email copy and clear Net 15/30/60 term options.
2. **Merchant Fee Auto-Splits** (vs QuickBooks): When a \$1,000 deposit arrives for a \$1,030 invoice due to Stripe fees, auto-allocate \$30 to `5030 Bank & Merchant Fees` with 1 click.
3. **Recurring Expense & Rule Preview** (vs QuickBooks): Let users preview which historical transactions match a rule before saving it.
4. **Mobile Polish** (vs Wave): Guarantee that every modal, drawer, and ledger view functions seamlessly on phone screens (390px) with zero horizontal scroll leaks.


---

## 5. Automation Architecture & SDLC Completeness Matrix

A critical component of the audit is evaluating whether workflows are automated in the background or forced into manual user actions. Bookkeeping software lives or dies by its background intelligence:

| Automation Domain | Current State in Reflex | QuickBooks Online | Wave / FreshBooks | Target Reflex Architecture |
| :--- | :--- | :--- | :--- | :--- |
| **Outflow Reconciliation** (Receipts $\leftrightarrow$ Debits) | **Automated** (`RunReconciliation`): 3-pass matching, subset-sum for splits, auto-balancing. | Automated rule execution & candidate suggestions. | Basic manual match with suggested list. | **Gold Standard**: Keep private local matching with exact integer cents. |
| **Inflow Reconciliation** (Invoices $\leftrightarrow$ Deposits) | ❌ **100% Manual**: `reconciler.go:61` skips deposits (`tx.Amount >= 0`). Candidate scoring only runs on drawer click. | Automated matching against open invoices by customer and amount. | Basic invoice matching. | **CRITICAL GAP**: Add background `RunInvoiceReconciliation()` that automatically links deposits and marks invoices `PAID`. |
| **Merchant Fee Splitting** (Stripe / Square net deposits) | ❌ **Fails to Match**: Net deposit ($971) fails exact match on gross invoice ($1,000). | Supports "Resolve Difference" fee allocation line. | Requires manual transaction split or manual fee entry. | **CRITICAL GAP**: Automated fee recognition: match deposit if $Amt = Total - (Total \times 2.9\% + \$0.30)$, auto-split difference to `5030 Merchant Fees`. |
| **Multi-Invoice Settlement** (1 deposit for 2+ invoices) | ❌ **Blocked by Schema**: `invoice.BankTransactionID` is a 1-to-1 foreign key. | Supports batch payment application across multiple invoices. | Supports batch payment per customer. | **ARCHITECTURAL PROPOSAL**: Migrate to join table or invoice payment ledger allowing 1-to-many and many-to-1 settlements. |
| **Overdue Status Sweeper** | ⚠️ **Passive Only**: Status evaluated only when `GetInvoices` query runs. | Nightly scheduled sweep + automated reminder emails. | Daily sweep + overdue notices. | Add scheduled/event-driven sweeper so overdue counts, badges, and A/R reports are always fresh without user page loads. |
| **Bank Rule Creation** | ⚠️ **Manual Only**: User must hand-craft conditions and regexes from scratch. | Suggests rules after repeated manual categorizations. | Manual rule creation. | **Self-Learning Heuristic**: Suggest auto-rule creation when the same payee is manually categorized 3 times to the same account. |
| **1099-NEC Threshold Sentinel** | ⚠️ **Report Only**: Metric visible only when inspecting the Vendor Spend report tab. | Proactive year-end 1099 filing warnings and W-9 trackers. | Basic vendor totals. | **Proactive Notification**: Surface a high-priority banner when any contractor spend crosses \$600 in the current tax year. |
| **Scanner Drop Ingestion** | ⚠️ **Basic Watcher**: `fsnotify` detects file creation immediately. | N/A (Cloud mobile app only). | N/A (Receipt scanning add-on). | Add 2-second debounce to ensure scanner has finished writing large TIFF/PDF files, plus an Ollama worker retry queue. |
