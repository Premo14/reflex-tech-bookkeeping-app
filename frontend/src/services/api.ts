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
  ClosePreflight,
  ExcludePreview,
  ExclusionReason,
  GroupItem,
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

export interface BrowseDirectoriesResponse {
  currentPath: string;
  parentPath: string;
  directories: string[];
}

export async function browseHostDirectories(path?: string): Promise<BrowseDirectoriesResponse> {
  const query = new URLSearchParams();
  if (path) query.append("path", path);
  const res = await fetch(`${API_BASE}/settings/directories?${query.toString()}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to browse directory: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------
// Transactions
// ---------------------------------------------------------

export async function getTransactions(filters: TransactionFilters = {}): Promise<{ transactions: BankTransaction[], total: number }> {
  const query = new URLSearchParams();
  if (filters.startDate) query.append("startDate", filters.startDate);
  if (filters.endDate) query.append("endDate", filters.endDate);
  if (filters.accountId) query.append("accountId", filters.accountId.toString());
  if (filters.search) query.append("search", filters.search);
  if (filters.page) query.append("page", filters.page.toString());
  if (filters.limit) query.append("limit", filters.limit.toString());

  const res = await fetch(`${API_BASE}/transactions?${query.toString()}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return { transactions: data.transactions || [], total: data.total || 0 };
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

export async function getExpenses(filters: ExpenseFilters = {}): Promise<{ expenses: Expense[], total: number }> {
  const query = new URLSearchParams();
  if (filters.startDate) query.append("startDate", filters.startDate);
  if (filters.endDate) query.append("endDate", filters.endDate);
  if (filters.accountId) query.append("accountId", filters.accountId.toString());
  if (filters.page) query.append("page", filters.page.toString());
  if (filters.limit) query.append("limit", filters.limit.toString());

  const res = await fetch(`${API_BASE}/expenses?${query.toString()}`);
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  const data = await res.json();
  return { expenses: data.expenses || [], total: data.total || 0 };
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

export async function linkExpenseToTransaction(expenseId: number, transactionId: number, overrideChartAccountId?: number, force?: boolean): Promise<LinkExpenseResponse> {
  const res = await fetch(`${API_BASE}/reconciliation/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expenseId, transactionId, overrideChartAccountId, force }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const errorObj = new Error(err.error || err.message || `Response status: ${res.status}`);
    (errorObj as any).data = err;
    throw errorObj;
  }
  return res.json();
}

export async function createAndLink(input: any): Promise<void> {
  const res = await fetch(`${API_BASE}/reconciliation/create-and-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const errorObj = new Error(err.error || err.message || `Response status: ${res.status}`);
    (errorObj as any).data = err;
    throw errorObj;
  }
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
  const res = await fetch(`${API_BASE}/expenses/${expenseId}/cash`, { method: "PATCH" });
  if (!res.ok) throw new Error(`Response status: ${res.status}`);
  return res.json();
}

export async function getUnlinkedItems(params?: { search?: string; page?: number; limit?: number; targetAmount?: number; targetDate?: string; startDate?: string; endDate?: string }): Promise<any> {
  const query = new URLSearchParams();
  if (params?.search) query.append("search", params.search);
  if (params?.page) query.append("page", params.page.toString());
  if (params?.limit) query.append("limit", params.limit.toString());
  if (params?.targetAmount !== undefined) query.append("targetAmount", params.targetAmount.toString());
  if (params?.targetDate) query.append("targetDate", params.targetDate);
  if (params?.startDate) query.append("startDate", params.startDate);
  if (params?.endDate) query.append("endDate", params.endDate);

  const res = await fetch(`${API_BASE}/reconciliation/unlinked?${query.toString()}`);
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

export async function uploadReceiptToExpense(expenseId: number, file: File, allowDuplicate: boolean = false): Promise<any> {
  const formData = new FormData();
  formData.append("file", file);
  if (allowDuplicate) {
    formData.append("allowDuplicate", "true");
  }

  const res = await fetch(`${API_BASE}/expenses/${expenseId}/receipt`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw { message: err.error || `Response status: ${res.status}`, status: res.status, data: err };
  }
  return res.json();
}

export async function deleteReceipt(receiptId: number): Promise<any> {
  const res = await fetch(`${API_BASE}/receipts/${receiptId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Response status: ${res.status}`);
  }
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


// Review Queue API
export type ReviewStatusType = 'PENDING' | 'IGNORED' | 'WARNINGS_IGNORED' | 'DELETED';

export interface ReviewQueueCounts {
  pending: number;
  excluded: number;
  warningsIgnored: number;
  deleted: number;
}

export const getReviewQueueCounts = async (): Promise<ReviewQueueCounts> => {
  const res = await fetch(`${API_BASE}/review-queue/counts`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to fetch review queue counts");
  }
  return res.json();
};

export const getReviewQueue = async (
  status: ReviewStatusType = 'PENDING'
): Promise<{
  status: string;
  transactions: BankTransaction[];
  expenses: Expense[];
  booksClosedDate?: string;
}> => {
  const res = await fetch(`${API_BASE}/review-queue?status=${status}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to fetch review queue");
  }
  return res.json();
};

export const resolveReviewItems = async (
  action: 'allow' | 'pending' | 'ignore_warnings' | 'restore_warnings' | 'delete',
  transactionIds: number[],
  expenseIds: number[]
): Promise<{
  status: string;
  rolledBack?: boolean;
  booksClosedDate?: string;
  autoApproved?: number;
  affected?: GroupItem[];
}> => {
  const res = await fetch(`${API_BASE}/review-queue/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, transactionIds, expenseIds }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to resolve items");
  }
  return res.json();
};

export const getAuditLogs = async () => {
  const res = await fetch(`${API_BASE}/settings/audit-logs`);
  if (!res.ok) throw new Error("Failed to fetch audit logs");
  return res.json();
};

// ---------------------------------------------------------
// Closing readiness & item exclusion
// ---------------------------------------------------------

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Response status: ${res.status}`);
  }
  return res.json();
}

export async function getClosePreflight(date: string): Promise<ClosePreflight> {
  const res = await fetch(`${API_BASE}/settings/close-preflight?date=${encodeURIComponent(date)}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Response status: ${res.status}`);
  }
  return res.json();
}

export function previewExclusion(type: "transaction" | "expense", id: number): Promise<ExcludePreview> {
  return postJSON("/items/exclude-preview", { type, id });
}

export function excludeItem(
  type: "transaction" | "expense",
  id: number,
  reason: ExclusionReason,
  note: string,
  unlinkOnly?: boolean
): Promise<{ status: string; affected: GroupItem[] }> {
  return postJSON("/items/exclude", { type, id, reason, note, unlinkOnly });
}

export function restoreItem(
  type: "transaction" | "expense",
  id: number
): Promise<{ status: string; affected: GroupItem[] }> {
  return postJSON("/items/restore", { type, id });
}

export function restoreItems(
  items: Array<{ type: "transaction" | "expense"; id: number }>
): Promise<{ status: string; affected: GroupItem[] }> {
  return postJSON("/items/restore-bulk", { items });
}

export function previewBulkExclusion(
  items: Array<{ type: "transaction" | "expense"; id: number }>
): Promise<ExcludePreview> {
  return postJSON("/items/exclude-bulk-preview", { items });
}

export function excludeItems(
  items: Array<{ type: "transaction" | "expense"; id: number }>,
  reason: ExclusionReason,
  note: string,
  unlinkOnly?: boolean
): Promise<{ status: string; affected: GroupItem[] }> {
  return postJSON("/items/exclude-bulk", { items, reason, note, unlinkOnly });
}

export function deleteItemsBulk(
  items: Array<{ type: "transaction" | "expense"; id: number }>
): Promise<{ status: string; deletedCount: number; affected: GroupItem[] }> {
  return postJSON("/items/delete-bulk", { items });
}

export function restoreDeletedItems(
  items: Array<{ type: "transaction" | "expense"; id: number }>
): Promise<{ status: string; restoredCount: number; affected: GroupItem[] }> {
  return postJSON("/items/restore-deleted", { items });
}

export function moveDeletedToExcluded(
  items: Array<{ type: "transaction" | "expense"; id: number }>,
  reason: ExclusionReason,
  note: string
): Promise<{ status: string; movedCount: number; affected: GroupItem[] }> {
  return postJSON("/items/move-to-excluded", { items, reason, note });
}

export function deleteItemsPermanent(
  items: Array<{ type: "transaction" | "expense"; id: number }>
): Promise<{ status: string; deletedCount: number }> {
  return postJSON("/items/delete-permanent", { items });
}



