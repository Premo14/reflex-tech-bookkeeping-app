import type {
  ARAgingReport,
  BankRule,
  BankTransaction,
  CashFlowReport,
  ChartAccount,
  ClosePreflight,
  CreateChartAccountInput,
  CreateExpenseInput,
  CreateInvoiceInput,
  CreateTransactionInput,
  ExcludePreview,
  ExclusionReason,
  Expense,
  ExpenseDetailResponse,
  ExpenseFilters,
  FileUploadResponse,
  FlaggedItems,
  FlaggedItemsFilters,
  GroupItem,
  Invoice,
  InvoicesResponse,
  LedgerSummary,
  LinkExpenseResponse,
  MarkExpenseAsCashResponse,
  PeriodAuditLog,
  ProfitLossReport,
  RuleCondition,
  RulePreviewResult,
  ScheduleCReport,
  ScoredDepositCandidate,
  TransactionDetailResponse,
  TransactionFilters,
  TrialBalanceReport,
  UpdateChartAccountInput,
  VendorSpendReport,
} from "../types/models";

const API_BASE = "/api";
const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 600_000;

export class ApiError extends Error {
  readonly status: number;
  readonly data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function buildUrl(path: string, query?: URLSearchParams): string {
  const qs = query?.toString();
  return qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  if (init.signal || typeof AbortController === "undefined" || timeoutMs <= 0) {
    return fetch(url, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 408);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJSON<T>(
  path: string,
  init?: RequestInit,
  options?: { fallbackError?: string; timeoutMs?: number }
): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    init,
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const msg =
      (typeof errData.error === "string" && errData.error) ||
      (typeof errData.message === "string" && errData.message) ||
      options?.fallbackError ||
      `Response status: ${res.status}`;
    throw new ApiError(msg, res.status, errData);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

function getJSON<T>(path: string, fallbackError?: string): Promise<T> {
  return requestJSON<T>(path, undefined, fallbackError ? { fallbackError } : undefined);
}

function postJSON<T>(path: string, body: unknown, fallbackError?: string): Promise<T> {
  return requestJSON<T>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    fallbackError ? { fallbackError } : undefined
  );
}

function patchJSON<T>(path: string, body?: unknown, fallbackError?: string): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method: "PATCH" }
      : {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  return requestJSON<T>(path, init, fallbackError ? { fallbackError } : undefined);
}

function deleteJSON<T>(path: string, fallbackError?: string): Promise<T> {
  return requestJSON<T>(path, { method: "DELETE" }, fallbackError ? { fallbackError } : undefined);
}

// ---------------------------------------------------------
// Chart of Accounts
// ---------------------------------------------------------

export async function getChartAccounts(type?: string): Promise<ChartAccount[]> {
  const query = new URLSearchParams();
  if (type) query.append("type", type);
  const path = query.toString() ? `/accounts?${query.toString()}` : "/accounts";
  const data = await getJSON<{ accounts?: ChartAccount[] }>(path);
  return data.accounts || [];
}

export async function createChartAccount(input: CreateChartAccountInput): Promise<ChartAccount> {
  const data = await postJSON<{ account: ChartAccount }>("/accounts", input);
  return data.account;
}

export async function updateChartAccount(
  id: number,
  updates: UpdateChartAccountInput
): Promise<ChartAccount> {
  const data = await patchJSON<{ account: ChartAccount }>(`/accounts/${id}`, updates);
  return data.account;
}

export async function deleteChartAccount(id: number): Promise<void> {
  await deleteJSON<unknown>(`/accounts/${id}`);
}

// ---------------------------------------------------------
// Settings
// ---------------------------------------------------------

export function getSettings(): Promise<Record<string, string>> {
  return getJSON<Record<string, string>>("/settings");
}

export async function updateSettings(key: string, value: string): Promise<void> {
  await postJSON<unknown>("/settings", { key, value });
}

export interface BrowseDirectoriesResponse {
  currentPath: string;
  parentPath: string;
  directories: string[];
}

export function browseHostDirectories(path?: string): Promise<BrowseDirectoriesResponse> {
  const query = new URLSearchParams();
  if (path) query.append("path", path);
  const urlPath = query.toString() ? `/settings/directories?${query.toString()}` : "/settings/directories";
  return getJSON<BrowseDirectoriesResponse>(urlPath, "Failed to browse directory");
}

// ---------------------------------------------------------
// Transactions
// ---------------------------------------------------------

export async function getTransactions(
  filters: TransactionFilters = {}
): Promise<{ transactions: BankTransaction[]; total: number }> {
  const query = new URLSearchParams();
  if (filters.startDate) query.append("startDate", filters.startDate);
  if (filters.endDate) query.append("endDate", filters.endDate);
  if (filters.accountId) query.append("accountId", filters.accountId.toString());
  if (filters.search) query.append("search", filters.search);
  if (filters.status && filters.status !== "ALL") query.append("status", filters.status);
  if (filters.sortBy) query.append("sortBy", filters.sortBy);
  if (filters.sortOrder) query.append("sortOrder", filters.sortOrder);
  if (filters.page) query.append("page", filters.page.toString());
  if (filters.limit) query.append("limit", filters.limit.toString());

  const path = query.toString() ? `/transactions?${query.toString()}` : "/transactions";
  const data = await getJSON<{ transactions?: BankTransaction[]; total?: number }>(path);
  return { transactions: data.transactions || [], total: data.total || 0 };
}

// Returns confirmed and suggested expense links separately for the detail drawer, plus linked invoice for deposits.
export async function getTransactionDetail(id: number): Promise<TransactionDetailResponse> {
  const data = await getJSON<Partial<TransactionDetailResponse> & { transaction: BankTransaction }>(
    `/transactions/${id}`
  );
  return {
    transaction: data.transaction,
    confirmedExpenses: data.confirmedExpenses || [],
    suggestedExpenses: data.suggestedExpenses || [],
    suggestedExpenseCandidates: data.suggestedExpenseCandidates || [],
    linkedInvoice: data.linkedInvoice || null,
    suggestedInvoices: data.suggestedInvoices || [],
  };
}

export async function createTransaction(input: CreateTransactionInput): Promise<BankTransaction> {
  const data = await postJSON<{ transaction: BankTransaction }>("/transactions", input);
  return data.transaction;
}

export async function updateTransaction(
  id: number,
  updates: Omit<Partial<BankTransaction>, "chartAccountId" | "categoryAccountId"> & {
    chartAccountId?: number | null;
    categoryAccountId?: number | null;
  }
): Promise<BankTransaction> {
  const data = await patchJSON<{ transaction: BankTransaction }>(`/transactions/${id}`, updates);
  return data.transaction;
}

export async function deleteTransaction(id: number): Promise<void> {
  await deleteJSON<unknown>(`/transactions/${id}`);
}

// ---------------------------------------------------------
// Expenses
// ---------------------------------------------------------

export async function getExpenses(
  filters: ExpenseFilters = {}
): Promise<{ expenses: Expense[]; total: number }> {
  const query = new URLSearchParams();
  if (filters.startDate) query.append("startDate", filters.startDate);
  if (filters.endDate) query.append("endDate", filters.endDate);
  if (filters.accountId) query.append("accountId", filters.accountId.toString());
  if (filters.search) query.append("search", filters.search);
  if (filters.status && filters.status !== "ALL") query.append("status", filters.status);
  if (filters.sortBy) query.append("sortBy", filters.sortBy);
  if (filters.sortOrder) query.append("sortOrder", filters.sortOrder);
  if (filters.page) query.append("page", filters.page.toString());
  if (filters.limit) query.append("limit", filters.limit.toString());

  const path = query.toString() ? `/expenses?${query.toString()}` : "/expenses";
  const data = await getJSON<{ expenses?: Expense[]; total?: number }>(path);
  return { expenses: data.expenses || [], total: data.total || 0 };
}

// Returns confirmed and suggested transaction links separately for the detail drawer.
export async function getExpenseDetail(id: number): Promise<ExpenseDetailResponse> {
  const data = await getJSON<Partial<ExpenseDetailResponse> & { expense: Expense }>(
    `/expenses/${id}`
  );
  return {
    expense: data.expense,
    confirmedTransactions: data.confirmedTransactions || [],
    suggestedTransactions: data.suggestedTransactions || [],
    suggestedTransactionCandidates: data.suggestedTransactionCandidates || [],
  };
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const data = await postJSON<{ expense: Expense }>("/expenses", input);
  return data.expense;
}

export async function updateExpense(
  id: number,
  updates: Omit<Partial<Expense>, "chartAccountId"> & { chartAccountId?: number | null }
): Promise<Expense> {
  const data = await patchJSON<{ expense: Expense }>(`/expenses/${id}`, updates);
  return data.expense;
}

export async function deleteExpense(id: number): Promise<void> {
  await deleteJSON<unknown>(`/expenses/${id}`);
}

export interface SplitLineInput {
  amount: number;
  chartAccountId?: number | null;
  description: string;
  vendor?: string;
  isPersonal?: boolean;
}

export function splitExpense(
  id: number,
  splits: SplitLineInput[]
): Promise<{
  originalExpense: Expense;
  createdExpenses: Expense[];
  message: string;
}> {
  return postJSON(`/expenses/${id}/split`, { splits });
}

// ---------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------

export function getFlaggedItems(filters: FlaggedItemsFilters = {}): Promise<FlaggedItems> {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  const path = params.toString() ? `/reconciliation/flagged?${params}` : "/reconciliation/flagged";
  return getJSON<FlaggedItems>(path);
}

export function linkExpenseToTransaction(
  expenseId: number,
  transactionId: number,
  overrideChartAccountId?: number,
  force?: boolean
): Promise<LinkExpenseResponse> {
  return postJSON<LinkExpenseResponse>("/reconciliation/link", {
    expenseId,
    transactionId,
    overrideChartAccountId,
    force,
  });
}

export interface CreateAndLinkInput {
  type: "transaction" | "receipt" | "expense";
  targetId: number;
  date?: string;
  amount?: number;
  description?: string;
  vendor?: string;
  notes?: string;
  chartAccountId?: number;
  categoryAccountId?: number;
  overrideChartAccountId?: number;
  force?: boolean;
  [key: string]: unknown;
}

export async function createAndLink(input: CreateAndLinkInput): Promise<void> {
  await postJSON<unknown>("/reconciliation/create-and-link", input);
}

export async function unlinkExpenseFromTransaction(
  expenseId: number,
  transactionId: number
): Promise<void> {
  // transactionId is required — an expense can link to multiple transactions
  // (split payments), so the backend needs to know which specific link to remove.
  await postJSON<unknown>("/reconciliation/unlink", { expenseId, transactionId });
}

export function markExpenseAsCash(expenseId: number): Promise<MarkExpenseAsCashResponse> {
  return patchJSON<MarkExpenseAsCashResponse>(`/expenses/${expenseId}/cash`);
}

export interface UnlinkedItemsResponse {
  transactions: BankTransaction[];
  expenses: Expense[];
  totalTxs?: number;
  totalExpenses?: number;
}

export function getUnlinkedItems(params?: {
  search?: string;
  page?: number;
  limit?: number;
  targetAmount?: number;
  targetDate?: string;
  startDate?: string;
  endDate?: string;
}): Promise<UnlinkedItemsResponse> {
  const query = new URLSearchParams();
  if (params?.search) query.append("search", params.search);
  if (params?.page) query.append("page", params.page.toString());
  if (params?.limit) query.append("limit", params.limit.toString());
  if (params?.targetAmount !== undefined) {
    query.append("targetAmount", params.targetAmount.toString());
  }
  if (params?.targetDate) query.append("targetDate", params.targetDate);
  if (params?.startDate) query.append("startDate", params.startDate);
  if (params?.endDate) query.append("endDate", params.endDate);

  const path = query.toString()
    ? `/reconciliation/unlinked?${query.toString()}`
    : "/reconciliation/unlinked";
  return getJSON<UnlinkedItemsResponse>(path);
}

// ---------------------------------------------------------
// File Uploads
// ---------------------------------------------------------

export function uploadFile(file: File): Promise<FileUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  return requestJSON<FileUploadResponse>(
    "/upload",
    {
      method: "POST",
      body: formData,
    },
    { timeoutMs: UPLOAD_TIMEOUT_MS }
  );
}

export interface UploadReceiptResponse {
  status: string;
  receipt?: {
    id: number;
    filePath: string;
    fileName?: string;
  };
  [key: string]: unknown;
}

export function uploadReceiptToExpense(
  expenseId: number,
  file: File,
  allowDuplicate: boolean = false
): Promise<UploadReceiptResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (allowDuplicate) {
    formData.append("allowDuplicate", "true");
  }

  return requestJSON<UploadReceiptResponse>(
    `/expenses/${expenseId}/receipt`,
    {
      method: "POST",
      body: formData,
    },
    { timeoutMs: UPLOAD_TIMEOUT_MS }
  );
}

export function deleteReceipt(receiptId: number): Promise<{ status: string; message?: string }> {
  return deleteJSON<{ status: string; message?: string }>(`/receipts/${receiptId}`);
}

// ---------------------------------------------------------
// Summary (Period Totals Bar)
// ---------------------------------------------------------

export function getSummary(
  filters: { startDate?: string; endDate?: string; accountId?: number } = {}
): Promise<LedgerSummary> {
  const query = new URLSearchParams();
  if (filters.startDate) query.append("startDate", filters.startDate);
  if (filters.endDate) query.append("endDate", filters.endDate);
  if (filters.accountId) query.append("accountId", filters.accountId.toString());

  const path = query.toString() ? `/summary?${query.toString()}` : "/summary";
  return getJSON<LedgerSummary>(path);
}

// ---------------------------------------------------------
// Reports & Exports
// ---------------------------------------------------------

export function getProfitLoss(startDate: string, endDate: string): Promise<ProfitLossReport> {
  const query = new URLSearchParams();
  if (startDate) query.append("startDate", startDate);
  if (endDate) query.append("endDate", endDate);

  const path = query.toString() ? `/reports/pl?${query.toString()}` : "/reports/pl";
  return getJSON<ProfitLossReport>(path);
}

export async function getScheduleCReport(params?: {
  startDate?: string;
  endDate?: string;
  year?: number;
}): Promise<ScheduleCReport> {
  const query = new URLSearchParams();
  if (params?.startDate) query.append("startDate", params.startDate);
  if (params?.endDate) query.append("endDate", params.endDate);
  if (params?.year) query.append("year", String(params.year));

  const path = query.toString() ? `/reports/schedule-c?${query.toString()}` : "/reports/schedule-c";
  const data = await getJSON<{ report: ScheduleCReport }>(path);
  return data.report;
}

export function getTaxPackDownloadUrl(params?: {
  startDate?: string;
  endDate?: string;
  year?: number;
}): string {
  const query = new URLSearchParams();
  if (params?.startDate) query.append("startDate", params.startDate);
  if (params?.endDate) query.append("endDate", params.endDate);
  if (params?.year) query.append("year", String(params.year));
  return buildUrl("/reports/tax-pack", query);
}

export async function getCashFlowReport(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<CashFlowReport> {
  const query = new URLSearchParams();
  if (params?.startDate) query.append("startDate", params.startDate);
  if (params?.endDate) query.append("endDate", params.endDate);

  const path = query.toString() ? `/reports/cash-flow?${query.toString()}` : "/reports/cash-flow";
  const data = await getJSON<{ report: CashFlowReport }>(path);
  return data.report;
}

export async function getVendorSpendReport(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<VendorSpendReport> {
  const query = new URLSearchParams();
  if (params?.startDate) query.append("startDate", params.startDate);
  if (params?.endDate) query.append("endDate", params.endDate);

  const path = query.toString()
    ? `/reports/vendor-spend?${query.toString()}`
    : "/reports/vendor-spend";
  const data = await getJSON<{ report: VendorSpendReport }>(path);
  return data.report;
}

export async function getARAgingReport(params?: {
  asOfDate?: string;
  salesDays?: number;
}): Promise<ARAgingReport> {
  const query = new URLSearchParams();
  if (params?.asOfDate) query.append("asOfDate", params.asOfDate);
  if (params?.salesDays) query.append("salesDays", String(params.salesDays));

  const path = query.toString() ? `/reports/ar-aging?${query.toString()}` : "/reports/ar-aging";
  const data = await getJSON<{ report: ARAgingReport }>(path);
  return data.report;
}

export async function getTrialBalance(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<TrialBalanceReport> {
  const query = new URLSearchParams();
  if (params?.startDate) query.append("startDate", params.startDate);
  if (params?.endDate) query.append("endDate", params.endDate);

  const path = query.toString()
    ? `/reports/trial-balance?${query.toString()}`
    : "/reports/trial-balance";
  const data = await getJSON<{ report: TrialBalanceReport }>(path);
  return data.report;
}

export function getTrialBalanceExportUrl(params?: {
  startDate?: string;
  endDate?: string;
}): string {
  const query = new URLSearchParams();
  if (params?.startDate) query.append("startDate", params.startDate);
  if (params?.endDate) query.append("endDate", params.endDate);
  return buildUrl("/reports/trial-balance/export", query);
}

export function getSystemBackupDownloadUrl(): string {
  return `${API_BASE}/system/backup/export`;
}

export interface SystemHealthData {
  status: string;
  company: string;
  timestamp: string;
  database: { status: string; error?: string };
  fileProcessor: { status: string; code?: number; error?: string };
  aiEngine: {
    status: string;
    ready: boolean;
    models?: string[];
    hasVision?: boolean;
    hasTextModel?: boolean;
  };
  storage: {
    inboxPath: string;
    processedPath: string;
    inboxWritable: boolean;
    processedWritable: boolean;
    status: string;
  };
}

export function getSystemHealth(): Promise<SystemHealthData> {
  return getJSON<SystemHealthData>("/health", "Failed to fetch system health");
}

export function restoreSystemBackup(
  file: File
): Promise<{ status: string; message: string; restored: Record<string, number> }> {
  const formData = new FormData();
  formData.append("backup", file);
  return requestJSON<{ status: string; message: string; restored: Record<string, number> }>(
    "/system/backup/restore",
    {
      method: "POST",
      body: formData,
    },
    { fallbackError: "Failed to restore backup", timeoutMs: UPLOAD_TIMEOUT_MS }
  );
}

// ---------------------------------------------------------
// Review Queue API
// ---------------------------------------------------------

export type ReviewStatusType = "PENDING" | "IGNORED" | "WARNINGS_IGNORED" | "DELETED";

export interface ReviewQueueCounts {
  pending: number;
  excluded: number;
  warningsIgnored: number;
  deleted: number;
}

export const getReviewQueueCounts = (): Promise<ReviewQueueCounts> => {
  return getJSON<ReviewQueueCounts>("/review-queue/counts", "Failed to fetch review queue counts");
};

export const getReviewQueue = (
  status: ReviewStatusType = "PENDING"
): Promise<{
  status: string;
  transactions: BankTransaction[];
  expenses: Expense[];
  invoices?: Invoice[];
  booksClosedDate?: string;
}> => {
  return getJSON(
    `/review-queue?status=${encodeURIComponent(status)}`,
    "Failed to fetch review queue"
  );
};

export const resolveReviewItems = (
  action: "allow" | "pending" | "ignore_warnings" | "restore_warnings" | "delete",
  transactionIds: number[],
  expenseIds: number[],
  invoiceIds: number[] = []
): Promise<{
  status: string;
  rolledBack?: boolean;
  booksClosedDate?: string;
  autoApproved?: number;
  affected?: GroupItem[];
}> => {
  return postJSON(
    "/review-queue/resolve",
    { action, transactionIds, expenseIds, invoiceIds },
    "Failed to resolve items"
  );
};

export const batchCategorizeItems = (
  transactionIds: number[],
  expenseIds: number[],
  categoryId: number,
  invoiceIds: number[] = []
): Promise<{ status: string; message?: string; count: number }> => {
  return postJSON(
    "/review-queue/batch-categorize",
    { transactionIds, expenseIds, invoiceIds, categoryId },
    "Failed to batch categorize items"
  );
};

export const getAuditLogs = (): Promise<PeriodAuditLog[]> => {
  return getJSON<PeriodAuditLog[]>("/settings/audit-logs", "Failed to fetch audit logs");
};

// ---------------------------------------------------------
// Closing readiness & item exclusion
// ---------------------------------------------------------

export function getClosePreflight(date: string): Promise<ClosePreflight> {
  return getJSON<ClosePreflight>(`/settings/close-preflight?date=${encodeURIComponent(date)}`);
}

export function previewExclusion(
  type: "transaction" | "expense" | "invoice",
  id: number
): Promise<ExcludePreview> {
  return postJSON("/items/exclude-preview", { type, id });
}

export function excludeItem(
  type: "transaction" | "expense" | "invoice",
  id: number,
  reason: ExclusionReason,
  note: string,
  unlinkOnly?: boolean
): Promise<{ status: string; affected: GroupItem[] }> {
  return postJSON("/items/exclude", { type, id, reason, note, unlinkOnly });
}

export function restoreItem(
  type: "transaction" | "expense" | "invoice",
  id: number
): Promise<{ status: string; affected: GroupItem[] }> {
  return postJSON("/items/restore", { type, id });
}

export function restoreItems(
  items: Array<{ type: "transaction" | "expense" | "invoice"; id: number }>
): Promise<{ status: string; affected: GroupItem[] }> {
  return postJSON("/items/restore-bulk", { items });
}

export function previewBulkExclusion(
  items: Array<{ type: "transaction" | "expense" | "invoice"; id: number }>
): Promise<ExcludePreview> {
  return postJSON("/items/exclude-bulk-preview", { items });
}

export function excludeItems(
  items: Array<{ type: "transaction" | "expense" | "invoice"; id: number }>,
  reason: ExclusionReason,
  note: string,
  unlinkOnly?: boolean
): Promise<{ status: string; affected: GroupItem[] }> {
  return postJSON("/items/exclude-bulk", { items, reason, note, unlinkOnly });
}

export function deleteItemsBulk(
  items: Array<{ type: "transaction" | "expense" | "invoice"; id: number }>
): Promise<{ status: string; deletedCount: number; affected: GroupItem[] }> {
  return postJSON("/items/delete-bulk", { items });
}

export function restoreDeletedItems(
  items: Array<{ type: "transaction" | "expense" | "invoice"; id: number }>
): Promise<{ status: string; restoredCount: number; affected: GroupItem[] }> {
  return postJSON("/items/restore-deleted", { items });
}

export function moveDeletedToExcluded(
  items: Array<{ type: "transaction" | "expense" | "invoice"; id: number }>,
  reason: ExclusionReason,
  note: string
): Promise<{ status: string; movedCount: number; affected: GroupItem[] }> {
  return postJSON("/items/move-to-excluded", { items, reason, note });
}

export function deleteItemsPermanent(
  items: Array<{ type: "transaction" | "expense" | "invoice"; id: number }>
): Promise<{ status: string; deletedCount: number }> {
  return postJSON("/items/delete-permanent", { items });
}

// ---------------------------------------------------------
// Automated Bank Rules
// ---------------------------------------------------------

export function getBankRules(): Promise<BankRule[]> {
  return getJSON("/rules");
}

export interface RuleSuggestion {
  payeeKeyword: string;
  suggestedName: string;
  categoryAccountId: number;
  categoryName: string;
  categoryCode: string;
  matchingTxCount: number;
  sampleDescription: string;
}

export function getBankRuleSuggestions(): Promise<{ suggestions: RuleSuggestion[] }> {
  return getJSON("/rules/suggestions");
}

export function getBankRule(id: number): Promise<BankRule> {
  return getJSON(`/rules/${id}`);
}

export function createBankRule(data: {
  name: string;
  priority?: number;
  active?: boolean;
  matchLogic?: "AND" | "OR";
  conditions: RuleCondition[];
  categoryAccountId?: number | null;
  renamedVendor?: string;
  autoConfirm?: boolean;
  autoExclude?: boolean;
  exclusionReason?: string;
  notes?: string;
  applyImmediately?: boolean;
}): Promise<{ rule: BankRule; appliedCount: number }> {
  return postJSON("/rules", data);
}

export function updateBankRule(
  id: number,
  data: {
    name?: string;
    priority?: number;
    active?: boolean;
    matchLogic?: "AND" | "OR";
    conditions?: RuleCondition[];
    categoryAccountId?: number | null;
    clearCategory?: boolean;
    renamedVendor?: string;
    autoConfirm?: boolean;
    autoExclude?: boolean;
    exclusionReason?: string;
    notes?: string;
    applyImmediately?: boolean;
  }
): Promise<{ rule: BankRule; appliedCount: number }> {
  return patchJSON(`/rules/${id}`, data);
}

export function deleteBankRule(id: number): Promise<{ status: string; message: string }> {
  return deleteJSON(`/rules/${id}`);
}

export function reorderBankRules(ruleIds: number[]): Promise<{ status: string; message: string }> {
  return postJSON("/rules/reorder", ruleIds);
}

export function applyAllBankRules(): Promise<{
  status: string;
  appliedCount: number;
  message: string;
}> {
  return postJSON("/rules/apply-all", {});
}

export function previewBankRule(data: {
  matchLogic: "AND" | "OR";
  conditions: RuleCondition[];
}): Promise<RulePreviewResult> {
  return postJSON("/rules/preview", data);
}

// ---------------------------------------------------------
// Invoicing & Receivable Matching
// ---------------------------------------------------------

export function getInvoices(params?: {
  status?: string;
  search?: string;
  year?: number;
}): Promise<InvoicesResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.append("status", params.status);
  if (params?.search) query.append("search", params.search);
  if (params?.year) query.append("year", String(params.year));
  const path = query.toString() ? `/invoices?${query.toString()}` : "/invoices";
  return getJSON<InvoicesResponse>(path);
}

export function getInvoice(id: number): Promise<{ status: string; invoice: Invoice }> {
  return getJSON(`/invoices/${id}`);
}

export function createInvoice(
  input: CreateInvoiceInput
): Promise<{ status: string; invoice: Invoice }> {
  return postJSON("/invoices", input);
}

export function updateInvoice(
  id: number,
  input: Partial<CreateInvoiceInput>
): Promise<{ status: string; invoice: Invoice }> {
  return patchJSON(`/invoices/${id}`, input);
}

export function deleteInvoice(id: number): Promise<{ status: string }> {
  return deleteJSON(`/invoices/${id}`);
}

export function matchInvoicePayment(
  invoiceId: number,
  bankTransactionId: number
): Promise<{ status: string; invoice: Invoice; message: string }> {
  return postJSON(`/invoices/${invoiceId}/match-payment`, { bankTransactionId });
}

export function markInvoicePaidCash(
  invoiceId: number,
  payload?: { paidDate?: string; notes?: string }
): Promise<{ status: string; invoice: Invoice; message: string }> {
  return postJSON(`/invoices/${invoiceId}/pay-cash`, payload || {});
}

export function linkExpenseToInvoice(
  expenseId: number,
  invoiceId: number
): Promise<{ status: string; expenseId: number; invoiceId: number }> {
  return postJSON("/reconciliation/link-expense-invoice", { expenseId, invoiceId });
}

export function unlinkExpenseFromInvoice(
  expenseId: number
): Promise<{ status: string; expenseId: number }> {
  return postJSON("/reconciliation/unlink-expense-invoice", { expenseId });
}

export function unmatchInvoicePayment(
  invoiceId: number
): Promise<{ status: string; invoice: Invoice }> {
  return postJSON(`/invoices/${invoiceId}/unmatch-payment`, {});
}

export function getInvoiceCandidates(
  invoiceId: number
): Promise<{ status: string; candidates: ScoredDepositCandidate[] }> {
  return getJSON(`/invoices/${invoiceId}/candidates`);
}

// ---------------------------------------------------------
// Client Demo Sandbox Controls
// ---------------------------------------------------------

export interface DemoDatasetStatus {
  active: boolean;
  counts: {
    statements: number;
    transactions: number;
    expenses: number;
    receipts: number;
    invoices: number;
  };
}

export function getDemoStatus(): Promise<DemoDatasetStatus> {
  return getJSON("/demo/status");
}

export function seedDemoData(): Promise<{ status: string; demo: DemoDatasetStatus }> {
  return postJSON("/demo/seed", {});
}

export function resetDemoData(): Promise<{ status: string; demo: DemoDatasetStatus }> {
  return postJSON("/demo/reset", {});
}

export function removeDemoData(): Promise<{ status: string; demo: DemoDatasetStatus }> {
  return postJSON("/demo/remove", {});
}
