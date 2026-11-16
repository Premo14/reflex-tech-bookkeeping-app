import { formatFixedDollars, toCents } from "./formatCurrency";

export type NormalizedAllocationStatus =
  | "BALANCED"
  | "PARTIAL"
  | "OVER_ALLOCATED"
  | "UNLINKED";

/**
 * Normalizes backend ("PARTIAL", "BALANCED", "UNLINKED", "OVER_ALLOCATED")
 * and legacy ("LINKED", "PARTIALLY_ALLOCATED") status values into one canonical status.
 */
export function normalizeAllocationStatus(
  allocationStatus?: string,
  linkStatus?: string,
  defaultBalanced = false
): NormalizedAllocationStatus {
  const raw = (allocationStatus || linkStatus || (defaultBalanced ? "BALANCED" : "UNLINKED"))
    .toUpperCase()
    .trim();
  if (raw === "BALANCED" || raw === "LINKED") return "BALANCED";
  if (raw === "PARTIAL" || raw === "PARTIALLY_ALLOCATED") return "PARTIAL";
  if (raw === "OVER_ALLOCATED") return "OVER_ALLOCATED";
  return "UNLINKED";
}

/**
 * Shared ledger filter predicate across transactions and expenses.
 */
export function matchesLedgerFilter(
  filter: string,
  status: NormalizedAllocationStatus,
  reviewStatus?: string
): boolean {
  if (filter === "ALL") return true;
  if (filter === "NEEDS_ATTENTION") {
    return (
      status !== "BALANCED" &&
      reviewStatus !== "WARNINGS_IGNORED" &&
      reviewStatus !== "IGNORED"
    );
  }
  if (filter === "BALANCED") return status === "BALANCED";
  if (filter === "PARTIAL" || filter === "PARTIALLY_ALLOCATED") {
    return status === "PARTIAL";
  }
  if (filter === "OVER_ALLOCATED") return status === "OVER_ALLOCATED";
  if (filter === "UNLINKED") return status === "UNLINKED";
  return true;
}

/**
 * Shared urgency ranking: lower numbers appear first in ledger lists.
 */
export function getAllocationProblemPriority(
  status: NormalizedAllocationStatus,
  hasSuggestions?: boolean,
  reviewStatus?: string
): number {
  if (reviewStatus === "WARNINGS_IGNORED" || reviewStatus === "IGNORED") return 5;
  if (status === "UNLINKED" && hasSuggestions) return 0;
  if (status === "OVER_ALLOCATED") return 1;
  if (status === "PARTIAL") return 2;
  if (status === "UNLINKED") return 3;
  return 4;
}

/**
 * Exact integer-cent & substring monetary query matcher for ledger search boxes.
 */
export function matchesAmountQuery(amount: number, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const cleaned = q.replace(/^\$/, "").trim();
  const parsed = cleaned !== "" ? Number(cleaned) : NaN;
  const absAmount = Math.abs(amount || 0);
  const matchesExactCents =
    Number.isFinite(parsed) && toCents(absAmount) === Math.abs(toCents(parsed));
  const formattedAmt = formatFixedDollars(absAmount);
  return (
    matchesExactCents ||
    formattedAmt.includes(cleaned || q) ||
    String(amount || 0).includes(q)
  );
}

/**
 * Human-readable labels for ledger item exclusion reasons.
 */
export const EXCLUSION_REASON_LABELS: Record<string, string> = {
  DUPLICATE: "Duplicate entry",
  PERSONAL: "Personal expense",
  CLOSED_PERIOD: "Declined during review",
  OTHER: "Other",
};
