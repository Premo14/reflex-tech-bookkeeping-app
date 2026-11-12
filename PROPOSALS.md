# Architectural & UX Proposals Registry

This document is automatically managed by the autonomous hardening agent (Hermes).  
**Rules of Engagement**:
1. All items listed here are **proposals only** — no code has been modified in the codebase for these items.
2. The user will review each proposal, discuss it, and decide whether to **APPROVE**, **MODIFY**, or **REJECT** it before any implementation begins.

---

<!-- New proposals will be appended below by Hermes in the standard RFC template -->

---

## PROPOSAL 2026-11-12-01: Migrate invoice write-path money math to integer cents

- **Status:** PROPOSED (not implemented)
- **Raised:** Pass 11 (A/R Aging & Invoices Report vertical slice), 2026-11-12
- **Area:** `backend/controllers/invoiceController.go` (create/update/payment-match paths)

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

AWAITING USER REVIEW — APPROVE / MODIFY / REJECT

