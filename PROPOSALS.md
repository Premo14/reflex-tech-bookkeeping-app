# Reflex Tech Bookkeeping Platform — Competitive & Product Proposals

Grounded in the audited codebase (`backend/`, `file-processor/`, `frontend/`) and evaluated against **QuickBooks Online**, **FreshBooks**, **Ramp**, and **Wave**.

---

## 1. Where Reflex Already Leads

1. **Zero-Friction Local-First Performance**: Single-LAN Docker stack with SSE live sync (`events.Broadcast` + `useLiveSync`), no auth wall on trusted local servers, and instant keyboard-first navigation (`DetailDrawer`, `ReceiptCanvasPane` hotkeys).
2. **Private Local AI + Physical Scanner Pipeline**: `file-processor` pairs `pdftotext` + `tesseract` + Ollama (`qwen2.5vl` / `llama3.1`) with the Samba `/mnt/inbox` dropbox watcher (`EXDEV`-safe `SafeMove`, file-stability polling), keeping sensitive financial PDFs and receipts strictly on-prem.
3. **Single-Entry UX Backed by Double-Entry Math Verification**: Users operate a fast single-entry ledger (`BankTransaction` ↔ `Expense` ↔ `Invoice`) while `TrialBalanceTab` verifies Debits = Credits (`varianceCents == 0`) with exact integer-cent `models.Money` arithmetic (`toCents` / `fromCents`).
4. **CPA-Ready Tax & Recovery Tooling**: `ScheduleCTab` calculates IRS Lines 1–31, 50% meal limits (`Line 24b`), Form 1040-ES / Schedule SE quarterly estimates, §162 mileage vs actual & §280A home-office optimizers, `VendorSpendTab` flags `$600+` 1099-NEC contractors, and `ExportTaxPackZip` + `ExportSystemBackupJSON` provide 1-click tax handoff and full portability.
5. **Defensive Reconciliation Safeguards**: Closed-period preflight & write locks (`BooksClosedDate`), `Invoice.DeclinedTxIDs` memory preventing unwanted auto-rematch, and multi-receipt allocation progress tracking (`BALANCED`, `PARTIAL`, `OVER_ALLOCATED`, `UNLINKED`).

---

## 2. Prioritized Feature & UX Proposals

### P1 — Monthly Bank Statement Reconciliation Workspace (vs QuickBooks / Wave)
- **Gap**: Users can upload statements via `/api/upload` and lock closed periods via `SettingsModal`, yet there is no dedicated statement ending-balance reconciliation workflow comparing cleared ledger transactions against a statement's opening/ending balance.
- **Proposal**: Store parsed statement opening/ending balance & statement period metadata, add a **Reconcile Statement** view showing `Cleared Balance - Statement Ending Balance = $0.00` difference, and optionally integrate a passed statement reconciliation check into `computeClosePreflight` before advancing `BooksClosedDate`.

### P1 — Recurring Invoices, Retainers & AR Follow-Up History (vs FreshBooks / Wave)
- **Gap**: `InvoicingModal` and `InvoiceEditorModal` handle single invoices, `Net 15`/`Net 30` due dates, partial payments, and printouts (`InvoicePrintModal`), and `SweepOverdueInvoices` transitions overdue statuses every 15m, but recurring client billing and follow-up tracking are manual.
- **Proposal**: Add a `RecurringTemplate` schedule (Monthly / Quarterly / Custom cadence) that auto-drafts or marks `SENT` invoices on schedule, plus a lightweight per-invoice reminder note / copy-to-clipboard / `mailto:` dunning action inside `ARAgingTab` so overdue collections are traceable directly from aging buckets.

### P1 — 1099-NEC Contractor Profiles & Dedicated Filing Packet (vs QuickBooks / Gusto / Wave)
- **Gap**: `VendorSpendTab` surfaces `contractorsOver600`, `total1099Spend`, and `requires1099` badges, yet vendor records lack W-9 collection status, legal business name, address, and masked TIN metadata.
- **Proposal**: Add an optional local Vendor / Contractor Directory table (W-9 on file toggle, entity type, address, masked TIN) and include a `1099-NEC_Summary.csv` inside `ExportTaxPackZip` for vendors meeting the `$600` non-employee compensation threshold.

### P2 — Automatic Credit-Card Payment & Inter-Account Transfer Pairing (vs Ramp / Wave)
- **Gap**: Payments from a checking account to an internal business credit card appear as an outflow in checking and an inflow in the card feed unless manually excluded via `/api/items/exclude`.
- **Proposal**: Detect equal-and-opposite cross-account transactions within a configurable ±3-day window and offer a 1-click **Link as Internal Transfer** action (excluding both legs symmetrically without distorting revenue or expense totals).

### P2 — Percentage/Formula Split Templates in Bank Rules (vs Ramp)
- **Gap**: `SplitExpenseModal` and `/api/expenses/:id/split` split an individual expense after import, whereas automated rules (`/api/rules`) apply a single category/action per transaction.
- **Proposal**: Extend `BankRulesModal` actions with multi-line percentage split templates (e.g., `60% Business Internet / 40% Personal Owner's Draw 3110`) evaluated via `PercentOf` exact-cent remainder allocation, plus a dry-run count pill alongside `/api/rules/preview`.

### P2 — Budgeting vs Actuals & 90-Day Cash Runway Forecasting (vs Ramp)
- **Gap**: `CashFlowTab` summarizes historical monthly cash in/out and savings rate, and `ARAgingTab` tracks open receivables, but neither projects forward cash runway.
- **Proposal**: Add optional monthly per-account budget caps and a 30/60/90-day forward cash projection combining current liquid cash (`1010`/`1030`), expected A/R collections weighted by aging bucket, and trailing recurring vendor outflows.

### P3 — Duplicate Receipt Perceptual Hash & Line-Item Split OCR (vs Ramp / Expensify)
- **Gap**: `file-processor` runs Ollama vision + Tesseract OCR cleanly for totals/dates/vendors, but scanning the same paper receipt twice across `/mnt/inbox` and manual upload can create duplicate unlinked expenses.
- **Proposal**: Store SHA-256 content hashes (and optional image dHash) on `Receipt` records to surface a non-blocking "Possible duplicate of Receipt #..." badge in `ReviewModal` and `DetailDrawer`.

### P3 — Frontend Bundle Code-Splitting & Native Control Polish
- **Observed Metric**: `vite build` currently emits a single `~700 kB` JS bundle warning (`> 500 kB` after minification).
- **Proposal**: Lazy-load heavy modals (`ReportsModal`, `ReviewModal`, `DetailDrawer`, `InvoicingModal`, `SettingsModal`) with `React.lazy` + `Suspense` and split `pdfjs-dist` into an async Rollup chunk (`manualChunks`) so initial Ledger Time-to-Interactive stays fast on low-power LAN machines. Also upgrade the remaining compact `<select>` elements in `ARAgingTab` (`DSO Window`) and `ScheduleCTab` (`Tax Year`, `Tax Rate Year`) to use an accessible unified dropdown primitive.
