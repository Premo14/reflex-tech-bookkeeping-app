import type { ReviewStatusType } from "../../services/api";
import type { BankTransaction, ChartAccount, Expense, Invoice } from "../../types/models";
import { addDaysToISODate } from "../../utils/dateUtils";
import { normalizeAllocationStatus } from "../../utils/ledgerStatus";

export type IssueType =
  | "CLOSED_PERIOD"
  | "UNLINKED"
  | "UNDER_ALLOCATED"
  | "OVER_ALLOCATED"
  | "OVERDUE"
  | "UNPAID"
  | "IGNORED"
  | "WARNINGS_IGNORED"
  | "DELETED";

export interface ReviewRow {
  key: string;
  type: "transaction" | "expense" | "invoice";
  id: number;
  title: string;
  subtitle: string;
  date: string;
  amount: number;
  transactionType?: string;
  reason: string;
  note: string;
  issues: IssueType[];
  hasSuggestions: boolean;
  isLocked: boolean;
  deletedAt?: string;
  daysRemaining?: number;
  bankAccountId?: number;
  bankAccount?: ChartAccount;
  categoryAccountId?: number;
  categoryAccount?: ChartAccount;
  invoiceStatus?: string;
}

export interface ReviewBannerConfig {
  containerClass: string;
  title: string;
  summary: string;
  description: string;
}

export const PAGE_SIZE = 15;

export const QUEUE_TABS: { id: ReviewStatusType; label: string; badgeColor: string }[] = [
  { id: "PENDING", label: "Action Required", badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  { id: "IGNORED", label: "Excluded Items", badgeColor: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  { id: "WARNINGS_IGNORED", label: "Warnings Ignored", badgeColor: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  { id: "DELETED", label: "Deleted Items", badgeColor: "text-red-400 bg-red-500/10 border-red-500/20" },
];

/** Extracts a readable error message from an unknown thrown error. */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

/** Normalizes backend allocation statuses ("PARTIAL" or legacy "PARTIALLY_ALLOCATED") into queue issues. */
export function resolveAllocationIssue(allocationStatus?: string, linkStatus?: string): IssueType {
  const normalized = normalizeAllocationStatus(allocationStatus, linkStatus);
  if (normalized === "PARTIAL") return "UNDER_ALLOCATED";
  if (normalized === "OVER_ALLOCATED") return "OVER_ALLOCATED";
  return "UNLINKED";
}

/** Computes remaining days inside the 30-day deleted-item retention window. */
export function computeDaysRemaining(deletedAt?: string, nowMs: number = Date.now()): number {
  if (!deletedAt) return 30;
  const parsedMs = new Date(deletedAt).getTime();
  if (Number.isNaN(parsedMs)) return 30;
  const daysPassed = Math.floor((nowMs - parsedMs) / (1000 * 60 * 60 * 24));
  return Math.max(0, 30 - daysPassed);
}

/**
 * Computes the target reopen date string (YYYY-MM-DD, the day before the oldest
 * closed-period selected item) using timezone-safe ISO calendar arithmetic.
 */
export function computeTargetReopenDate(selectedRows: ReviewRow[]): string | null {
  const closedRows = selectedRows.filter((r) => r.issues.includes("CLOSED_PERIOD") && r.date);
  if (closedRows.length === 0) return null;

  let oldestIso = closedRows[0].date.split("T")[0];
  for (const row of closedRows) {
    const rowIso = row.date.split("T")[0];
    if (rowIso && rowIso < oldestIso) {
      oldestIso = rowIso;
    }
  }
  return oldestIso ? addDaysToISODate(oldestIso, -1) : null;
}

/** Returns explanatory banner copy and styles for the active review queue tab. */
export function getBannerConfig(activeTab: ReviewStatusType): ReviewBannerConfig {
  switch (activeTab) {
    case "PENDING":
      return {
        containerClass: "bg-amber-500/10 border-amber-500/20 text-amber-300",
        title: "About Action Required Items",
        summary: "Items needing attention before reconciliation can be approved.",
        description:
          "These items have not yet been approved or reconciled. They may have been imported inside a closed period, lack links, or have allocation mismatches. Open them to resolve via the Detail Drawer, allow closed-period items, or exclude items from your books.",
      };
    case "IGNORED":
      return {
        containerClass: "bg-purple-500/10 border-purple-500/20 text-purple-300",
        title: "About Excluded Items",
        summary: "Kept for records but omitted from reports, totals, and reconciliation.",
        description:
          "Excluded items are kept for your records but are left out of reports, totals and linking. Restore puts them (and anything linked to them) back in your books. Items in a locked period can't be restored directly; you can send those to the Review Queue instead.",
      };
    case "WARNINGS_IGNORED":
      return {
        containerClass: "bg-blue-500/10 border-blue-500/20 text-blue-300",
        title: "About Warnings Ignored",
        summary: "Included in books with reconciliation warnings silenced.",
        description:
          "These items are included in your books, but their reconciliation warnings have been silenced so you can close your books without errors. You can turn warnings back on (Restore Warnings) or exclude items if needed.",
      };
    case "DELETED":
      return {
        containerClass: "bg-red-500/10 border-red-500/20 text-red-300",
        title: "About 30-Day Deleted Retention",
        summary: "Held in retention for 30 days before permanent automatic purge.",
        description:
          "Deleted items are kept for 30 days before being permanently removed. They are not included in your books or reports. You can restore them to active books, move them to Excluded Items, or delete them permanently.",
      };
  }
}

interface UpsertExtra {
  bankAccountId?: number;
  bankAccount?: ChartAccount;
  categoryAccountId?: number;
  categoryAccount?: ChartAccount;
  deletedAt?: string;
  daysRemaining?: number;
}

/** Returns true when itemDate falls on or before closedDate (YYYY-MM-DD calendar check). */
export function isItemDateClosed(closedDate: string, itemDate?: string): boolean {
  if (!closedDate || !itemDate) return false;
  const dateStr = itemDate.split("T")[0];
  return Boolean(dateStr && dateStr <= closedDate);
}

/** Merges a queue item into a deduplicated ReviewRow map keyed by `<type>-<id>`. */
export function upsertReviewRow(
  rowMap: Map<string, ReviewRow>,
  closedDate: string,
  params: {
    type: "transaction" | "expense" | "invoice";
    id: number;
    title: string;
    subtitle: string;
    date: string;
    amount: number;
    transactionType?: string;
    invoiceStatus?: string;
    reason: string;
    note: string;
    issue: IssueType;
    hasSuggestions: boolean;
    extra?: UpsertExtra;
  }
): void {
  const key = `${params.type}-${params.id}`;
  const isLocked = isItemDateClosed(closedDate, params.date);

  const bankAccount =
    params.extra?.bankAccount && params.extra.bankAccount.id > 0 ? params.extra.bankAccount : undefined;
  const bankAccountId =
    bankAccount && bankAccount.id > 0
      ? bankAccount.id
      : params.extra?.bankAccountId && params.extra.bankAccountId > 0
      ? params.extra.bankAccountId
      : undefined;

  const categoryAccount =
    params.extra?.categoryAccount && params.extra.categoryAccount.id > 0
      ? params.extra.categoryAccount
      : undefined;
  const categoryAccountId =
    categoryAccount && categoryAccount.id > 0
      ? categoryAccount.id
      : params.extra?.categoryAccountId && params.extra.categoryAccountId > 0
      ? params.extra.categoryAccountId
      : undefined;

  const existing = rowMap.get(key);
  if (existing) {
    if (!existing.issues.includes(params.issue)) {
      existing.issues.push(params.issue);
    }
    if (params.hasSuggestions) existing.hasSuggestions = true;
    if (params.extra?.deletedAt) existing.deletedAt = params.extra.deletedAt;
    if (params.extra?.daysRemaining !== undefined) existing.daysRemaining = params.extra.daysRemaining;
    if (bankAccountId && !existing.bankAccountId) {
      existing.bankAccountId = bankAccountId;
      existing.bankAccount = bankAccount;
    }
    if (categoryAccountId && !existing.categoryAccountId) {
      existing.categoryAccountId = categoryAccountId;
      existing.categoryAccount = categoryAccount;
    }
    return;
  }

  rowMap.set(key, {
    key,
    type: params.type,
    id: params.id,
    title: params.title,
    subtitle: params.subtitle,
    date: params.date,
    amount: params.amount,
    transactionType: params.transactionType,
    invoiceStatus: params.invoiceStatus,
    reason: params.reason,
    note: params.note,
    issues: [params.issue],
    hasSuggestions: params.hasSuggestions,
    isLocked,
    deletedAt: params.extra?.deletedAt,
    daysRemaining: params.extra?.daysRemaining,
    bankAccountId,
    bankAccount,
    categoryAccountId,
    categoryAccount,
  });
}

/** Appends a BankTransaction entry with one or more issue tags to rowMap. */
export function appendTransactionRow(
  rowMap: Map<string, ReviewRow>,
  closedDate: string,
  tx: BankTransaction,
  issues: IssueType[],
  options?: { deletedAt?: string; daysRemaining?: number; clearReason?: boolean }
): void {
  const hasSuggestions = Boolean(tx.suggestedExpenseId || tx.hasSuggestions);
  const extra: UpsertExtra = {
    bankAccountId: tx.chartAccountId || undefined,
    bankAccount: tx.chartAccount || undefined,
    categoryAccountId: tx.categoryAccountId || undefined,
    categoryAccount: tx.category || undefined,
    deletedAt: options?.deletedAt,
    daysRemaining: options?.daysRemaining,
  };

  for (const issue of issues) {
    upsertReviewRow(rowMap, closedDate, {
      type: "transaction",
      id: tx.id,
      title: tx.description,
      subtitle: tx.transactionType,
      date: tx.date,
      amount: tx.amount,
      transactionType: tx.transactionType,
      reason: options?.clearReason ? "" : tx.exclusionReason || "",
      note: options?.clearReason ? "" : tx.exclusionNote || "",
      issue,
      hasSuggestions,
      extra,
    });
  }
}

/** Appends an Expense entry with one or more issue tags to rowMap. */
export function appendExpenseRow(
  rowMap: Map<string, ReviewRow>,
  closedDate: string,
  exp: Expense,
  issues: IssueType[],
  options?: { deletedAt?: string; daysRemaining?: number; clearReason?: boolean }
): void {
  const extra: UpsertExtra = {
    bankAccountId: (exp.bankTransactions && exp.bankTransactions[0]?.chartAccountId) || undefined,
    bankAccount: (exp.bankTransactions && exp.bankTransactions[0]?.chartAccount) || undefined,
    categoryAccountId: exp.chartAccountId || undefined,
    categoryAccount: exp.chartAccount || undefined,
    deletedAt: options?.deletedAt,
    daysRemaining: options?.daysRemaining,
  };

  const title = exp.vendor
    ? `${exp.vendor}${exp.description ? ` – ${exp.description}` : ""}`
    : exp.description || "Untitled Expense";
  for (const issue of issues) {
    upsertReviewRow(rowMap, closedDate, {
      type: "expense",
      id: exp.id,
      title,
      subtitle: exp.tender,
      date: exp.timestamp,
      amount: exp.amount,
      reason: options?.clearReason ? "" : exp.exclusionReason || "",
      note: options?.clearReason ? "" : exp.exclusionNote || "",
      issue,
      hasSuggestions: Boolean(exp.hasSuggestions),
      extra,
    });
  }
}

/** Appends an Invoice entry with one or more issue tags to rowMap. */
export function appendInvoiceRow(
  rowMap: Map<string, ReviewRow>,
  closedDate: string,
  inv: Invoice,
  issues: IssueType[],
  options?: { deletedAt?: string; daysRemaining?: number; clearReason?: boolean }
): void {
  const extra: UpsertExtra = {
    bankAccountId: inv.bankTransaction?.chartAccountId || undefined,
    bankAccount: inv.bankTransaction?.chartAccount || undefined,
    categoryAccountId: inv.categoryAccountId || undefined,
    categoryAccount: inv.categoryAccount || undefined,
    deletedAt: options?.deletedAt || inv.deletedAt,
    daysRemaining: options?.daysRemaining,
  };

  const title = `${inv.invoiceNumber || `INV-${inv.id}`} – ${inv.clientName}`;
  const subtitle = inv.paymentTerms || "Net 30";
  const amount = (inv.balanceDue !== undefined && inv.balanceDue > 0) ? inv.balanceDue : inv.totalAmount;

  for (const issue of issues) {
    upsertReviewRow(rowMap, closedDate, {
      type: "invoice",
      id: inv.id,
      title,
      subtitle,
      date: inv.issueDate,
      amount,
      invoiceStatus: inv.status,
      reason: options?.clearReason ? "" : inv.exclusionReason || "",
      note: options?.clearReason ? "" : inv.exclusionNote || "",
      issue,
      hasSuggestions: false,
      extra,
    });
  }
}
