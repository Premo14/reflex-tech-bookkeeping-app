import type {
  BankTransaction,
  ChartAccount,
  CreateChartAccountInput,
  CreateExpenseInput,
  CreateTransactionInput,
  ExpenseDetailResponse,
  ExpenseFilters,
  FileUploadResponse,
  FlaggedItems,
  FlaggedItemsFilters,
  LedgerSummary,
  LinkExpenseResponse,
  MarkExpenseAsCashResponse,
  ProfitLossReport,
  TransactionDetailResponse,
  TransactionFilters,
  UpdateChartAccountInput,
  Expense,
} from "../types/models";

const API_BASE = "/api";

// ---------------------------------------------------------
// Chart of Accounts
// ---------------------------------------------------------

export async function getChartAccounts(type?: string): Promise<ChartAccount[]> {
  const query = new URLSearchParams();
  if (type) query.append("type", type);

  const res = await fetch(`${API_BASE}/accounts?${query.toString()}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return data.accounts || [];
}

export async function createChartAccount(input: CreateChartAccountInput): Promise<ChartAccount> {
  const res = await fetch(`${API_BASE}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Response status: ${res.status}`);
  }
  const data = await res.json();
  return data.account;
}

export async function updateChartAccount(id: number, updates: UpdateChartAccountInput): Promise<ChartAccount> {
  const res = await fetch(`${API_BASE}/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Response status: ${res.status}`);
  }
  const data = await res.json();
  return data.account;
}

export async function deleteChartAccount(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/accounts/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Response status: ${res.status}`);
  }
}

// ---------------------------------------------------------
// Settings
// ---------------------------------------------------------

export async function getSettings(): Promise<Record<string, string>> {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  return res.json();
}

export async function updateSettings(key: string, value: string): Promise<void> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Response status: ${res.status}`);
  }
}

// ---------------------------------------------------------
// Transactions
// ---------------------------------------------------------

export async function getTransactions(filters: TransactionFilters = {}): Promise<BankTransaction[]> {
  const query = new URLSearchParams();
  if (filters.startDate) query.append("startDate", filters.startDate);
  if (filters.endDate) query.append("endDate", filters.endDate);
  if (filters.accountId) query.append("accountId", filters.accountId.toString());
  if (filters.search) query.append("search", filters.search);

  const res = await fetch(`${API_BASE}/transactions?${query.toString()}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return data.transactions || [];
}

// Returns confirmed and suggested expense links separately for the detail drawer.
export async function getTransactionDetail(id: number): Promise<TransactionDetailResponse> {
  const res = await fetch(`${API_BASE}/transactions/${id}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return {
    transaction: data.transaction,
    confirmedExpenses: data.confirmedExpenses || [],
    suggestedExpenses: data.suggestedExpenses || [],
  };
}

export async function createTransaction(input: CreateTransactionInput): Promise<BankTransaction> {
  const res = await fetch(`${API_BASE}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Response status: ${res.status}`);
  }
  const data = await res.json();
  return data.transaction;
}

export async function updateTransaction(id: number, updates: Partial<BankTransaction>): Promise<BankTransaction> {
  const res = await fetch(`${API_BASE}/transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return data.transaction;
}

export async function deleteTransaction(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/transactions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
}

// ---------------------------------------------------------
// Expenses
// ---------------------------------------------------------

export async function getExpenses(filters: ExpenseFilters = {}): Promise<Expense[]> {
  const query = new URLSearchParams();
  if (filters.startDate) query.append("startDate", filters.startDate);
  if (filters.endDate) query.append("endDate", filters.endDate);
  if (filters.accountId) query.append("accountId", filters.accountId.toString());

  const res = await fetch(`${API_BASE}/expenses?${query.toString()}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return data.expenses || [];
}

// Returns confirmed and suggested transaction links separately for the detail drawer.
export async function getExpenseDetail(id: number): Promise<ExpenseDetailResponse> {
  const res = await fetch(`${API_BASE}/expenses/${id}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return {
    expense: data.expense,
    confirmedTransactions: data.confirmedTransactions || [],
    suggestedTransactions: data.suggestedTransactions || [],
  };
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const res = await fetch(`${API_BASE}/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Response status: ${res.status}`);
  }
  const data = await res.json();
  return data.expense;
}

export async function updateExpense(id: number, updates: Partial<Expense>): Promise<Expense> {
  const res = await fetch(`${API_BASE}/expenses/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return data.expense;
}

export async function deleteExpense(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/expenses/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
}

// ---------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------

export async function getFlaggedItems(filters: FlaggedItemsFilters = {}): Promise<FlaggedItems> {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);

  const res = await fetch(`${API_BASE}/reconciliation/flagged?${params}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  return res.json();
}

export async function linkExpenseToTransaction(expenseId: number, transactionId: number): Promise<LinkExpenseResponse> {
  const res = await fetch(`${API_BASE}/reconciliation/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expenseId, transactionId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Response status: ${res.status}`);
  }
  return res.json();
}

export async function unlinkExpenseFromTransaction(expenseId: number, transactionId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/reconciliation/unlink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // transactionId is required — an expense can link to multiple transactions
    // (split payments), so the backend needs to know which specific link to remove.
    body: JSON.stringify({ expenseId, transactionId }),
  });
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
}

export async function markExpenseAsCash(expenseId: number): Promise<MarkExpenseAsCashResponse> {
  const res = await fetch(`${API_BASE}/reconciliation/cash/${expenseId}`, { method: "PATCH" });
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  return res.json();
}

export async function getUnlinkedItems(): Promise<{ transactions: BankTransaction[]; expenses: Expense[] }> {
  const res = await fetch(`${API_BASE}/reconciliation/unlinked`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------
// File Uploads
// ---------------------------------------------------------

export async function uploadFile(file: File): Promise<FileUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });

  return res.json();
}

// ---------------------------------------------------------
// Summary (Period Totals Bar)
// ---------------------------------------------------------

export async function getSummary(filters: { startDate?: string; endDate?: string; accountId?: number } = {}): Promise<LedgerSummary> {
  const query = new URLSearchParams();
  if (filters.startDate) query.append("startDate", filters.startDate);
  if (filters.endDate)   query.append("endDate", filters.endDate);
  if (filters.accountId) query.append("accountId", filters.accountId.toString());

  const res = await fetch(`${API_BASE}/summary?${query.toString()}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------
// Reports
// ---------------------------------------------------------

export async function getProfitLoss(startDate: string, endDate: string): Promise<ProfitLossReport> {
  const query = new URLSearchParams();
  if (startDate) query.append("startDate", startDate);
  if (endDate)   query.append("endDate", endDate);

  const res = await fetch(`${API_BASE}/reports/pl?${query.toString()}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  return res.json();
}
