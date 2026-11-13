# Reflex Tech Bookkeeping Platform — Relational State & Data Flow Specification

**Document Purpose**: Define the exact ripple effects, cross-system data dependencies, state transitions, and reporting impacts whenever an action occurs in the application.

---

## The Core Problem in Bookkeeping
In bookkeeping software, **no record lives on an island**. A single user click or automated rule (like linking an invoice or matching a receipt) creates a multi-table, multi-report ripple effect across the entire system. If any link in that chain fails, reports become inaccurate, tax liabilities become incorrect, and the books become unbalanced.

---

## 1. Workflow 1: Customer Invoice $\leftrightarrow$ Bank Deposit Linking

### The Action:
User matches an open client invoice (`models.Invoice`) with an incoming bank deposit (`models.BankTransaction`).

### System-Wide Ripple Effect:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. INVOICE STATE TRANSITION                                                 │
│    - AmountPaid increases by deposit amount: AmountPaid = AmountPaid + Dep  │
│    - BalanceDue recalculated: BalanceDue = TotalAmount - AmountPaid         │
│    - Status Transition:                                                      │
│        * If BalanceDue == 0  --> Status = 'PAID'                            │
│        * If BalanceDue > 0   --> Status = 'PARTIALLY_PAID'                  │
│    - PaymentTransactionID is linked to the bank transaction ID              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. BANK TRANSACTION STATE TRANSITION                                        │
│    - AllocationStatus changes from 'UNLINKED' to 'BALANCED'                 │
│    - CategoryAccountID maps to Invoice revenue account (e.g. 4000 Services) │
│    - Disappears from Review Queue ('Needs Attention' count decrements)       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. REPORT PROPAGATION                                                       │
│    - A/R Aging Report: Invoice is removed from overdue brackets (if PAID)   │
│      or drops its balance. Total Receivables drops, DSO recalculates.       │
│    - Profit & Loss (P&L): Cash-basis revenue is recognized on payment date. │
│    - Cash Flow Report: Operational cash inflow reflects cleared deposit.    │
│    - GAAP Trial Balance:                                                    │
│        * Cash / Checking (1010) DEBIT increases                             │
│        * Accounts Receivable (1200) or Revenue (4000) CREDIT increases      │
│        * Total Debits == Total Credits maintained                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. DETAIL DRAWER & UI                                                       │
│    - Deposit view displays linked invoice badge with 1-click preview.       │
│    - Invoice view displays cleared bank date and 1-click [ Unlink Payment ].│
│    - Real-time SSE Broadcast: INVOICES_UPDATED and TRANSACTIONS_UPDATED     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. AUDIT LOG                                                                │
│    - ItemAuditLog records: Action = 'MATCH_INVOICE', Actor = USER,          │
│      InvoiceID, BankTransactionID, Amount, Timestamp.                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Edge Cases & Accounting Rules:
- **Merchant Processing Fees (e.g. Stripe, Square, PayPal)**:
  - When customer pays an invoice for \$1,000 via credit card, Stripe deposits \$971 (deducting \$29 in fees).
  - **Relational Rule**: Deposit (\$971) matches Invoice (\$1,000) $\rightarrow$ System automatically allocates \$971 to Revenue (4000) and splits \$29 to `5030 Bank & Merchant Fees` (EXPENSE). The invoice is marked fully `PAID` (\$1,000), not short-paid!
- **Unlinking Payment**:
  - Clicking `[ Unlink Payment ]` restores invoice to `SENT` or `OVERDUE`, resets `AmountPaid = 0`, resets `BalanceDue = TotalAmount`, and reverts bank deposit to `UNLINKED` / `NEEDS_ATTENTION`.

---

## 2. Workflow 2: Scanned Receipt / Slip $\leftrightarrow$ Bank Debit Outflow Matching

### The Action:
User or automated reconciler pairs a scanned physical receipt (`models.Expense`) with an outgoing bank debit transaction (`models.BankTransaction`).

### System-Wide Ripple Effect:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. EXPENSE & TRANSACTION STATE                                              │
│    - Expense AllocationStatus = 'BALANCED'                                  │
│    - Bank Transaction AllocationStatus = 'BALANCED'                         │
│    - Record inserted into join table expense_bank_transactions:             │
│        (expense_id, bank_transaction_id, status='confirmed')                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. DEDUPLICATION ON FINANCIAL REPORTS (CRUCIAL!)                            │
│    - In single-entry bookkeeping, both the bank debit (-$100) and the       │
│      receipt ($100) exist in the database.                                  │
│    - RELATIONAL LAW: P&L and Schedule C must count the expense EXACTLY ONCE.│
│    - Once matched in expense_bank_transactions, the bank debit's raw debit  │
│      is suppressed from P&L so the verified receipt item takes precedence.  │
│    - Result: Net profit is NOT double-penalized.                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. TAX & SCHEDULE C REPORTING                                               │
│    - Expense tax line (e.g. Schedule C Line 18 Office Expense) is populated.│
│    - Extracted sales tax amount updates "Cumulative Sales Tax Paid" metric. │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. TRIAL BALANCE & DOUBLE-ENTRY EQUALITY                                    │
│    - DEBIT: Operating Expense Account (e.g. 5100 Office Supplies)           │
│    - CREDIT: Cash / Bank Account (1010 Operating Checking)                  │
│    - Debits == Credits preserved to the exact integer cent.                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. DETAIL DRAWER & REVIEW QUEUE                                             │
│    - Transaction card shows receipt thumbnail with zoom/pan modal.          │
│    - Both items clear out of Review Queue.                                  │
│    - SSE Broadcast: EXPENSES_UPDATED and RECONCILIATION_UPDATED.            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Workflow 3: Split Transactions (Single Bank Debit $\rightarrow$ Multiple Categories)

### The Action:
A single credit card or bank charge (e.g. \$145.50 at Target) covers items across multiple business categories (e.g. \$45.50 Office Supplies + \$100.00 Computer Hardware).

### System-Wide Ripple Effect:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. INTEGER-CENT CONSERVATION (THE FUNDAMENTAL LAW)                          │
│    - Total Split Cents == Parent Transaction Cents                          │
│    - 4550 cents (Supplies) + 10000 cents (Equipment) == 14550 cents (Target)│
│    - If sum != parent, transaction is strictly rejected by API (HTTP 422). │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. TAX & GAAP ALLOCATION                                                    │
│    - Line 1 ($45.50) maps to 5100 Office Supplies -> Schedule C Line 22.    │
│    - Line 2 ($100.00) maps to 1300 Equipment (CapEx) -> Asset on Balance    │
│      Sheet, Depreciation on Schedule C Line 13.                             │
│    - P&L recognizes $45.50 as an operating expense today, NOT $145.50!       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. PARTIAL ALLOCATION REMAINDERS (EDGE CASE)                                │
│    - If only $100 of a $145.50 debit is categorized and $45.50 is unknown:  │
│    - Status = 'PARTIALLY_ALLOCATED'.                                        │
│    - Unallocated remainder ($45.50) is automatically routed to Account 9999 │
│      (Suspense) on P&L so financial statements remain completely honest.    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Workflow 4: Internal Transfers & Owner's Equity (Zero P&L Impact)

### The Action:
- Moving \$2,000 from Checking to Savings.
- Paying off a \$1,500 company credit card from Checking.
- Owner withdrawing \$3,000 for personal use (`Owner's Draw`).
- Owner depositing \$5,000 of personal funds into the business (`Owner's Capital`).

### System-Wide Ripple Effect:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. THE GOLDEN ACCOUNTING LAW: ZERO P&L IMPACT                               │
│    - Internal transfers and owner equity flows MUST NEVER APPEAR ON P&L.    │
│    - If an owner draw of $3,000 appeared on P&L, it would fraudulently      │
│      inflate business expenses and evade federal income taxes.              │
│    - If an owner capital contribution of $5,000 appeared on P&L, it would   │
│      artificially inflate business revenue and trigger phantom tax debt.    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. LEDGER ROUTING                                                           │
│    - Internal Account Transfer: Categorized as 'TRANSFER'. Both debit on    │
│      Checking and credit on Savings balance each other out completely.      │
│    - Owner's Draw: Maps to Account 3110 (EQUITY: Owner's Draw).             │
│    - Owner's Contribution: Maps to Account 3010 (EQUITY: Owner's Capital).  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. TRIAL BALANCE IMPACT                                                     │
│    - Checking Account (1010) decreases (Credit).                            │
│    - Owner's Equity (3110) decreases (Debit).                               │
│    - Mathematical balance preserved without touching Revenue or Expenses.   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Workflow 5: Cash Tender Slips & Petty Cash Ingestion

### The Action:
Ingesting physical paper receipts where payment was made in cash (e.g. \$24.00 parking, \$15.00 hardware supplies).

### System-Wide Ripple Effect:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. AUTO-BALANCING LOGIC                                                     │
│    - Cash receipts will NEVER appear on a bank statement feed.              │
│    - RELATIONAL RULE: When tender is 'cash' or 'cash / paper', system       │
│      automatically initializes AllocationStatus = 'BALANCED'.              │
│    - They never get trapped in the Review Queue waiting for a bank feed.    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. TAX & EXPENSE RECOGNITION                                                │
│    - The $24 parking and $15 hardware are immediately recognized on P&L and │
│      Schedule C (Line 24a Travel and Line 22 Supplies).                     │
│    - Ensures out-of-pocket cash spend is never lost as a deductible expense.│
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. DOUBLE-ENTRY DESTINATION                                                 │
│    - DEBIT: 5xxx Operating Expense.                                         │
│    - CREDIT: 3010 Owner's Contribution (since owner paid with cash on hand).│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Workflow 6: Closed-Period Lockout (`BooksClosedDate`)

### The Action:
User closes the books through a filed tax year (e.g. `BooksClosedDate = 2025-12-31`).

### System-Wide Ripple Effect:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. GLOBAL IMMUTABILITY BARRIER                                              │
│    - Any POST, PUT, PATCH, or DELETE request attempting to alter a          │
│      transaction, expense, invoice, split, or match dated <= BooksClosedDate│
│      is immediately rejected with HTTP 403 Forbidden.                       │
│    - Error Envelope:                                                        │
│        { "error": "Books are locked through 2025-12-31 for tax integrity" }│
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. AFFECTED MODULES                                                         │
│    - Invoicing: Cannot edit or delete 2025 invoices.                        │
│    - Banking: Cannot categorize, split, or exclude 2025 bank transactions.  │
│    - Receipts: Cannot delete or re-allocate 2025 receipts.                  │
│    - COA: Cannot delete accounts that were active in 2025.                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. AUDIT RECOVERY                                                           │
│    - Unlocking the books requires an explicit password/confirmation and     │
│      creates a permanent entry in ItemAuditLog explaining the reason.       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary: The Relational Health Checklist for Every Audit

When auditing any feature, screen, or controller, verify these **6 Relational Questions**:
1. When this item changes, does the **paired record** update its status automatically?
2. Does this action update the **Review Queue** badge count in real time?
3. Does this change reflect accurately in the **7 Reports** (P&L, Cash Flow, A/R Aging, Trial Balance, Schedule C)?
4. Does this action prevent **double-counting** between bank transactions and receipts?
5. Does the **Detail Drawer** allow bidirectional navigation and 1-click unlinking?
6. Is an immutable **Audit Log** entry created capturing what changed, who changed it, and why?
