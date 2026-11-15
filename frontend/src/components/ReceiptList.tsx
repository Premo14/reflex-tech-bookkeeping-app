import React from "react";
import type { Expense } from "../types/models";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { getSubClassForAccount } from "../utils/accountHierarchy";
import { formatDate } from "../utils/dateUtils";
import { formatCurrency, toCents } from "../utils/formatCurrency";
import { AllocationStatusBadge } from "./AllocationStatusBadge";
import {
  getAllocationProblemPriority,
  matchesAmountQuery,
  matchesLedgerFilter,
  normalizeAllocationStatus,
} from "../utils/ledgerStatus";
import ReceiptThumbnailBadge from "./ReceiptThumbnailBadge";

interface ReceiptListProps {
  expenses: Expense[];
  filter: string;
  searchQuery: string;
  sortField: string;
  sortOrder: "asc" | "desc";
  onSelect: (id: number) => void;
}

export default function ReceiptList({
  expenses,
  filter,
  searchQuery,
  sortField,
  sortOrder,
  onSelect,
}: ReceiptListProps) {
  const filteredExpenses = expenses.filter((exp) => {
    const status = normalizeAllocationStatus(
      exp.allocationStatus,
      exp.linkStatus,
      exp.tender?.toLowerCase() === "cash"
    );
    if (!matchesLedgerFilter(filter, status, exp.reviewStatus)) {
      return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const matchesText =
        (exp.vendor || "").toLowerCase().includes(q) ||
        (exp.description || "").toLowerCase().includes(q) ||
        (exp.notes || "").toLowerCase().includes(q) ||
        (exp.chartAccount?.name || "").toLowerCase().includes(q);
      if (!matchesText && !matchesAmountQuery(exp.amount || 0, q)) {
        return false;
      }
    }
    return true;
  });

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    const statusA = normalizeAllocationStatus(
      a.allocationStatus,
      a.linkStatus,
      a.tender?.toLowerCase() === "cash"
    );
    const statusB = normalizeAllocationStatus(
      b.allocationStatus,
      b.linkStatus,
      b.tender?.toLowerCase() === "cash"
    );
    const pDiff =
      getAllocationProblemPriority(statusA, a.hasSuggestions, a.reviewStatus) -
      getAllocationProblemPriority(statusB, b.hasSuggestions, b.reviewStatus);
    if (pDiff !== 0) return pDiff;

    let cmp: number;
    if (sortField === "amount") {
      cmp = toCents(a.amount) - toCents(b.amount);
    } else if (sortField === "vendor") {
      cmp = (a.description || a.vendor || "").localeCompare(
        b.description || b.vendor || ""
      );
    } else if (sortField === "tender") {
      cmp = (a.tender || "").localeCompare(b.tender || "");
    } else {
      cmp =
        (new Date(a.timestamp).getTime() || 0) -
        (new Date(b.timestamp).getTime() || 0);
    }
    return sortOrder === "asc" ? cmp : -cmp;
  });

  if (sortedExpenses.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
        <p className="text-zinc-400">No expenses found matching this criteria.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedExpenses.map((exp, index) => {
        const status = normalizeAllocationStatus(
          exp.allocationStatus,
          exp.linkStatus,
          exp.tender?.toLowerCase() === "cash"
        );
        const detailItems: { key: string; node: React.ReactNode }[] = [
          { key: "date", node: <span>{formatDate(exp.timestamp)}</span> },
        ];

        if (exp.description && exp.description !== exp.vendor) {
          detailItems.push({
            key: "desc",
            node: (
              <span className="text-zinc-400 truncate max-w-[180px]">
                {exp.description}
              </span>
            ),
          });
        }

        if (exp.taxAmount && exp.taxAmount > 0) {
          const taxFormatted = formatCurrency(exp.taxAmount);
          detailItems.push({
            key: "tax",
            node: (
              <span className="text-zinc-400" title={`Sales tax: ${taxFormatted}`}>
                Tax:{" "}
                <span className="text-zinc-300 font-medium font-mono tabular-nums">
                  {taxFormatted}
                </span>
              </span>
            ),
          });
        }

        if (exp.chartAccount && exp.chartAccount.id) {
          const subClass = getSubClassForAccount(
            exp.chartAccount.type,
            exp.chartAccount.code
          );
          detailItems.push({
            key: "account",
            node: (
              <span
                className="flex items-center gap-1.5 flex-wrap"
                title={`Category: ${exp.chartAccount.code} — ${exp.chartAccount.name}${subClass ? ` (${subClass.name})` : ""}${!exp.chartAccount.active ? " (Archived)" : ""}`}
              >
                <span className="text-emerald-400 font-mono tracking-tight">
                  {exp.chartAccount.code}
                </span>
                <span className="text-zinc-300 truncate max-w-[150px]">
                  {exp.chartAccount.name}
                </span>
                {subClass && (
                  <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 whitespace-nowrap">
                    {subClass.name}
                  </span>
                )}
                {!exp.chartAccount.active && (
                  <Badge variant="danger" size="sm">
                    Archived
                  </Badge>
                )}
              </span>
            ),
          });
        } else {
          detailItems.push({
            key: "uncategorized",
            node: (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/60 italic"
                title="Uncategorized expense"
              >
                Uncategorized
              </span>
            ),
          });
        }

        return (
          <Card
            key={exp.id}
            glowColor="emerald"
            className="relative animate-card-cascade motion-reduce:animate-none flex-col items-stretch gap-2.5 p-3.5 group hover:border-emerald-500/35 motion-safe:hover:-translate-y-0.5"
            style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
          >
            {/* Row 1: Dedicated Title (stretched focus/click target) with Amount */}
            <div className="flex items-start justify-between gap-3 w-full min-w-0">
              <button
                type="button"
                onClick={() => onSelect(exp.id)}
                className="text-left flex-1 min-w-0 cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] after:content-[''] after:absolute after:inset-0 after:rounded-2xl"
              >
                <span className="text-sm font-semibold text-zinc-100 group-hover:text-white leading-snug line-clamp-2 break-words transition-colors">
                  {exp.vendor || exp.description || "Unknown Expense"}
                </span>
              </button>
              <span className="font-bold text-sm font-mono tabular-nums shrink-0 whitespace-nowrap pl-2 text-white">
                {formatCurrency(exp.amount)}
              </span>
            </div>

            {/* Row 2: Metadata (Date, Description, Tax, Category) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400 min-w-0">
              {detailItems.map((item, i) => (
                <React.Fragment key={item.key}>
                  {i > 0 && <span className="text-zinc-500">&middot;</span>}
                  {item.node}
                </React.Fragment>
              ))}
            </div>
            {status === "BALANCED" &&
              exp.bankTransactions &&
              exp.bankTransactions.length > 0 && (
                <div className="text-xs text-zinc-400 truncate w-full">
                  Linked to:{" "}
                  {exp.bankTransactions.map((t) => t.description).join(", ")}
                </div>
              )}

            {/* Row 3: Metadata Badges on Left, Allocation Status on Right */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5 w-full min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-zinc-800 text-zinc-400 border border-zinc-700 tracking-wider">
                  {exp.tender}
                </span>
                {exp.isManual && (
                  <Badge variant="warning" size="sm">
                    Manual
                  </Badge>
                )}
                {exp.receipts && exp.receipts.length > 0 ? (
                  <div className="relative z-10">
                    <ReceiptThumbnailBadge receipts={exp.receipts} />
                  </div>
                ) : (
                  <span
                    className="flex items-center gap-1 text-[10px] uppercase font-bold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded border border-red-400/20"
                    title="No physical receipt attached"
                  >
                    <svg
                      aria-hidden="true"
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                      />
                    </svg>
                    No Receipt
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 items-center shrink-0 ml-auto sm:ml-0">
                <AllocationStatusBadge
                  status={status}
                  hasSuggestions={exp.hasSuggestions}
                  reviewStatus={exp.reviewStatus}
                />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
