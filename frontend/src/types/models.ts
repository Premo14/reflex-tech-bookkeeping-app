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

export interface Expense {
  id: number;
  timestamp: string;
  vendor: string;
  description: string;
  amount: number;
  tender: string;
  bankTransactionId?: number;
  suggestedTransactionId?: number;
  suggestedTransaction?: BankTransaction;
  receipts?: Receipt[];
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
  expenses?: Expense[];
  suggestedExpenseId?: number;
  suggestedExpense?: Expense;
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