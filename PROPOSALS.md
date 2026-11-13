# Architectural & UX Proposals Registry

This document is automatically managed by the autonomous hardening agent (Hermes).  
**Rules of Engagement**:
1. All items listed here are **proposals only** — no code has been modified in the codebase for these items.
2. The user will review each proposal, discuss it, and decide whether to **APPROVE**, **MODIFY**, or **REJECT** it before any implementation begins.

---

<!-- New proposals will be appended below by Hermes in the standard RFC template -->

---

## PROPOSAL 2026-11-12-01: Migrate invoice write-path money math to integer cents

- **Status:** IMPLEMENTED (Pass 16, 2026-11-13)
- **Raised:** Pass 11 (A/R Aging & Invoices Report vertical slice), 2026-11-12
- **Area:** `backend/controllers/invoiceController.go` (create/update/payment-match paths)
- **Resolution:** Replaced all `roundCents` float64 operations across `CreateInvoice`, `UpdateInvoice`, `MatchInvoicePayment`, and `GetInvoices` summary metrics with exact integer-cent `models.Money` arithmetic (`.Add()`, `.Sub()`, `.PercentOf()`). Added `SweepOverdueInvoices()` and verified with `TestInvoiceWritePathMoneyArithmetic`.

---

### Problem

The Pass 11 report layer was hardened to exact integer-cent arithmetic
(`models.Money.Cents`, `.Add()`, `.Sub()`), but the **invoice write path still
round-trips through float64 dollars**:

- `invoiceController.go:361` — `BalanceDue = NewMoney(roundCents(invoice.TotalAmount.Dollars() - invoice.AmountPaid.Dollars()))`
- `invoiceController.go:367-368` — same pattern on the zero-paid branch
- `invoiceController.go:473-479` — payment-match path: `newPaid := roundCents(invoice.AmountPaid.Dollars() + paymentAmt)`
- `invoiceController.go:119` — summary fallback uses the same `.Dollars()` round-trip

`Dollars()` converts integer cents to float64 dollars; `roundCents` converts
back. For balances below ~$9e13 this is usually lossless, but it is the exact
bug class (float precision on money) that motivated the Pass 11 refactor, and it
is one refactor away from a real cent-drift bug (e.g. repeated partial payments
on large invoices).

### Proposed change (work items)

1. Replace every `roundCents(x.Dollars() ± y.Dollars())` on the invoice write
   path with the integer-cent Money API: `TotalAmount.Sub(AmountPaid)`,
   `AmountPaid.Add(paymentMoney)`, `GreaterThan()`, `IsPositive()` — mirroring
   the hardened `BuildARAgingData` / `arReceivableFor` pattern.
2. Add a regression test: repeated partial payments (e.g. $0.10 x 3 against a
   $0.30 invoice) must land on exactly `BalanceDue = 0.00` with no float drift.
3. Optional data-integrity audit script: for all open invoices verify
   `BalanceDue == TotalAmount - AmountPaid`; report violations (would catch any
   historical drift from the old float path).

### Risk / effort

- Effort: S (one file, ~8 call sites, all mechanical; pattern already proven in the report layer).
- Risk: Low — behavior-preserving for all values where the float path is lossless;
  strictly more precise otherwise. Requires a backend rebuild + `go test ./...`.
- Wire format unchanged: `models.Money` still marshals as a 2-decimal JSON number.

### Decision

**APPROVED & IMPLEMENTED** (Committed as `commit d67ceb3`, Pass 16).

---

## PROPOSAL 2026-11-13-01: System Snapshot Restoration & Disaster Recovery Engine

- **Status:** PROPOSED
- **Raised:** Pass 19 (Settings, COA & Backup Audit), 2026-11-13
- **Area:** `backend/controllers/exportController.go` & `frontend/src/components/AppSettingsModal.tsx`
- **Scope:** Disaster Recovery & Data Mobility

### Problem
Reflex provides 1-click JSON backup export (`GET /api/system/backup/export`), bundling company settings, accounts, transactions, receipts, invoices, bank rules, and audit logs into a single portable, 100% private JSON snapshot. However, there is currently no corresponding restore endpoint (`POST /api/system/backup/restore`) or UI workflow to import and restore the database from a backup file if a user migrates to a new machine, recovers from disk failure, or spins up a fresh container.

### Proposed Architecture & Solution
1. **Backend Restore Handler (`POST /api/system/backup/restore`)**:
   - Accepts multipart/form-data or JSON payload containing the backup file.
   - Preflight Verification: Validates schema version (`v1.0`), entity integrity, and checksum before altering existing tables.
   - Atomic Transaction (`db.Transaction`):
     - Clears or merges historical records.
     - Inserts Chart of Accounts (preserving IDs and hierarchies).
     - Inserts Bank Transactions, Invoices, Expenses, Receipts, and Bank Rules.
     - Restores Company App Settings and BooksClosedDate.
     - If any foreign key violation or constraint error occurs, executes an immediate `tx.Rollback()`.
   - Audit Log: Emits `PeriodAuditLog` with action `SYSTEM_RESTORED` detailing timestamp, record counts, and user agent.
   - Event Broadcast: Broadcasts `RELOAD_ALL` / `SETTINGS_UPDATED` SSE events to refresh connected clients immediately.
2. **Frontend Restore UI (`AppSettingsModal.tsx`)**:
   - In the "Local Data Sovereignty & Full Backup" section, add a matching `[ Restore from Backup (.json) ]` file picker.
   - Confirmation dialog warning the user that restoring will replace or merge database state, requiring explicit typed confirmation (`RESTORE`).
   - Progress and success toast with automated dashboard reload.

### Risk / Effort
- **Effort:** M (~1 day)
- **Risk:** Medium (destructive operation if mishandled; strictly mitigated by running inside an atomic DB transaction with schema validation).

### Decision
AWAITING USER REVIEW — APPROVE / MODIFY / REJECT


