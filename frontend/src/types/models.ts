export interface AccountingPeriod {
  id: number;
  year: number;
  month: number;
  status: string; // "OPEN" or "CLOSED"
}

export interface CloseAccountingPeriodResponse {
  status: string
}

export interface Receipt {
  id: number;
  expenseId?: number;
  documentUri: string;
  fileExt: string;
  createdAt: string;
}

export interface ExpenseBankTransaction {
  expenseId: number;
  bankTransactionId: number;
  // "suggested" = scoring system's best guess, not yet accepted by the user
  // "confirmed" = manually linked or auto-matched with high confidence
  status: "suggested" | "confirmed";
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: number;
  timestamp: string;
  vendor: string;
  description: string;
  amount: number;
  tender: string;
  // An expense can link to multiple bank transactions (split payments),
  // so this is an array of the full transaction objects via the join table.
  bankTransactions?: BankTransaction[];
  receipts?: Receipt[];
  reconciliationStatus?: string;
  hasSuggestions?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkExpenseResponse {
  status: string
}

export interface MarkExpenseAsCashResponse {
  status: string
}

export interface BankTransaction {
  id: number;
  bankStatementId: number;
  date: string;
  description: string;
  amount: number;
  transactionType: string;
  fitId: string;
  reconciliationStatus: string;
  hasSuggestions?: boolean;
  // One transaction can link to multiple expenses (e.g. one purchase, multiple receipts).
  // suggestedExpenseId / suggestedExpense removed — suggestions live as join table rows.
  expenses?: Expense[];
}

export interface CreateExpenseInput {
  timestamp: string; // ISO datetime string
  vendor: string;
  description: string;
  amount: number;
  tender: string;
  year: number;  // sent from URL context for server-side month validation
  month: number;
}

export interface CreateTransactionInput {
  date: string; // ISO datetime string
  description: string;
  amount: number;
  transactionType: string;
  year: number;  // sent from URL context for server-side month validation
  month: number;
}

// Returned by GET /transactions/:id — separates confirmed from suggested expense links
export interface TransactionDetailResponse {
  transaction: BankTransaction;
  confirmedExpenses: Expense[];
  suggestedExpenses: Expense[];
}

// Returned by GET /expenses/:id — separates confirmed from suggested transaction links
export interface ExpenseDetailResponse {
  expense: Expense;
  confirmedTransactions: BankTransaction[];
  suggestedTransactions: BankTransaction[];
}

export interface TransactionFilters {
  year?: number
  month?: number
  search?: string
}

export interface FlaggedItems {
  transactions: BankTransaction[]
  expenses: Expense[]
}

export interface FlaggedItemsFilters {
  year?: number
  month?: number
}

export interface FileUploadResponse {
  status: string
}