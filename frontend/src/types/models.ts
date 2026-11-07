// ChartAccount represents a single entry in the Chart of Accounts.
// Uses standard 5-type structure: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
export interface ChartAccount {
  id: number;
  code: string;        // e.g. "1010" — unique identifier
  name: string;        // e.g. "Checking Account"
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentId?: number;   // optional: nil = top-level, set = sub-account
  description: string;
  ofxAccountId?: string;
  active: boolean;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
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
  // "confirmed" = manually linked or auto-linked with high confidence
  status: "suggested" | "confirmed";
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: number;
  isManual: boolean;
  timestamp: string;
  vendor: string;
  description: string;
  amount: number;
  taxAmount: number;
  currencyCode: string;
  tender: string;
  notes?: string;
  status?: string;
  chartAccountId?: number;
  chartAccount?: ChartAccount;
  bankTransactions?: BankTransaction[];
  receipts?: Receipt[];
  reconciliationStatus?: string;
  allocationStatus?: string;
  linkStatus?: string;
  reviewStatus?: string;
  exclusionReason?: string;
  exclusionNote?: string;
  hasSuggestions?: boolean;
  deletedAt?: string;
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
  isManual: boolean;
  bankStatementId?: number;
  chartAccountId?: number;
  chartAccount?: ChartAccount;
  categoryAccountId?: number;
  category?: ChartAccount;
  date: string;
  description: string;
  amount: number;
  transactionType: string;
  fitId: string;
  allocationStatus?: string;
  linkStatus?: string;
  reconciliationStatus?: string;
  reviewStatus: string;
  exclusionReason?: string;
  exclusionNote?: string;
  hasSuggestions?: boolean;
  deletedAt?: string;
  notes?: string;
  expenses?: Expense[];
}

export interface BankStatement {
  id: number;
  documentUri: string;
  fileExt: string;
  accountId: string;
  bankId: string;
  startDate: string;
  endDate: string;
  endingBalance?: number;
  balanceAsOf?: string;
  chartAccountId?: number;
  chartAccount?: ChartAccount;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerSummary {
  totalIncome: number;
  totalDeposits?: number;
  totalDebits: number;
  totalExpenses: number;
  netCashflow: number;
  netIncome?: number;
  totalTax?: number;
  transactionCount: number;
  expenseCount: number;
  unlinkedTxCount: number;
  unlinkedExpCount: number;
}

export interface PLLine {
  accountCode: string;
  accountName: string;
  total: number;
}

export interface ProfitLossReport {
  startDate: string;
  endDate: string;
  revenue: PLLine[];
  totalRevenue: number;
  expenses: PLLine[];
  totalExpenses: number;
  netIncome: number;
  totalTax?: number;
  uncategorizedTxCount: number;
  uncategorizedExpCount: number;
  excludedTxCount: number;
  excludedTxTotal: number;
  excludedExpCount: number;
  excludedExpTotal: number;
}

// Input for creating a new expense manually (no file upload)
export interface CreateExpenseInput {
  timestamp: string;      // ISO datetime string
  vendor: string;
  description: string;
  amount: number;
  tender: string;
  chartAccountId?: number; // optional COA category
  notes?: string;          // optional notes
}

// Input for creating a new bank transaction manually (no OFX import)
export interface CreateTransactionInput {
  date: string;                // ISO datetime string
  description: string;
  amount: number;
  transactionType: string;
  chartAccountId: number;      // Required Bank/Card account (ASSET or LIABILITY)
  categoryAccountId?: number;  // Optional category (EXPENSE or REVENUE)
  notes?: string;              // optional notes
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
  startDate?: string;
  endDate?: string;
  accountId?: number;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ExpenseFilters {
  startDate?: string;
  endDate?: string;
  accountId?: number;
  page?: number;
  limit?: number;
}

export interface FlaggedItems {
  transactions: BankTransaction[]
  expenses: Expense[]
}

export interface FlaggedItemsFilters {
  startDate?: string;
  endDate?: string;
}

export interface FileUploadResponse {
  status: string
}

// Input for creating a new ChartAccount entry
export interface CreateChartAccountInput {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentId?: number;
  description?: string;
}

// Input for updating a ChartAccount entry (all fields optional)
export interface UpdateChartAccountInput {
  code?: string;
  name?: string;
  type?: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentId?: number | null;
  description?: string;
  active?: boolean;
}
export interface PeriodAuditLog {
  id: number;
  action: string;
  previousDate: string;
  newDate: string;
  reason: string;
  createdAt: string;
}

// One member of a link group (a bank transaction or an expense) affected by exclude/restore.
export interface GroupItem {
  type: "transaction" | "expense";
  id: number;
  label: string;
  date: string;
  amount: number;
  reviewStatus: string;
}

export interface ExcludePreview {
  items: GroupItem[];
  blocked: boolean;
  blockedReason: string;
}

export type ExclusionReason = "DUPLICATE" | "PERSONAL" | "CLOSED_PERIOD" | "OTHER";

export interface ClosePreflight {
  date: string;
  canClose: boolean;
  unlinkedTxCount: number;
  unlinkedExpCount: number;
  pendingCount: number;
  unlinkedTxSamples: GroupItem[];
  unlinkedExpSamples: GroupItem[];
  earliestBlockerDate: string;
  excludedTxCount: number;
  excludedExpCount: number;
  excludedTxTotal: number;
  excludedExpTotal: number;
  uncategorizedTxCount: number;
  uncategorizedExpCount: number;
}
