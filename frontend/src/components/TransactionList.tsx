import React from "react";
import type { BankTransaction } from "../types/models";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { formatDate } from "../utils/dateUtils";
import { extractCleanVendor } from "../utils/vendorUtils";
import { formatCurrency, toCents } from "../utils/formatCurrency";
import { AllocationStatusBadge } from "./AllocationStatusBadge";
import {
  getAllocationProblemPriority,
  matchesAmountQuery,
  matchesLedgerFilter,
  normalizeAllocationStatus,
} from "../utils/ledgerStatus";
import ReceiptThumbnailBadge from "./ReceiptThumbnailBadge";

interface TransactionListProps {
  transactions: BankTransaction[];
  filter: string;
  searchQuery: string;
  sortField: string;
  sortOrder: "asc" | "desc";
  onSelect: (id: number) => void;
}

export default function TransactionList({
  transactions,
  filter,
  searchQuery,
  sortField,
  sortOrder,
  onSelect,
}: TransactionListProps) {
  const filteredTransactions = transactions.filter((tx) => {
    const status = normalizeAllocationStatus(
      tx.allocationStatus,
      tx.linkStatus,
      tx.amount >= 0
    );
    if (!matchesLedgerFilter(filter, status, tx.reviewStatus)) {
      return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const cleanVendor = extractCleanVendor(tx.description).toLowerCase();
      const matchesText =
        tx.description.toLowerCase().includes(q) ||
        cleanVendor.includes(q) ||
        (tx.notes || "").toLowerCase().includes(q) ||
        (tx.fitId || "").toLowerCase().includes(q) ||
        (tx.chartAccount?.name || "").toLowerCase().includes(q) ||
        (tx.category?.name || "").toLowerCase().includes(q);
      if (!matchesText && !matchesAmountQuery(tx.amount, q)) {
        return false;
      }
    }
    return true;
  });

  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    const statusA = normalizeAllocationStatus(
      a.allocationStatus,
      a.linkStatus,
      a.amount >= 0
    );
    const statusB = normalizeAllocationStatus(
      b.allocationStatus,
      b.linkStatus,
      b.amount >= 0
    );
    const pDiff =
      getAllocationProblemPriority(statusA, a.hasSuggestions, a.reviewStatus) -
      getAllocationProblemPriority(statusB, b.hasSuggestions, b.reviewStatus);
    if (pDiff !== 0) return pDiff;

    let cmp: number;
    if (sortField === "amount") {
      cmp = toCents(a.amount) - toCents(b.amount);
    } else if (sortField === "description") {
      cmp = a.description.localeCompare(b.description);
    } else if (sortField === "type") {
      cmp = (a.transactionType || "").localeCompare(b.transactionType || "");
    } else {
      cmp = (new Date(a.date).getTime() || 0) - (new Date(b.date).getTime() || 0);
    }
    return sortOrder === "asc" ? cmp : -cmp;
  });

  if (sortedTransactions.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
        <p className="text-zinc-400">No transactions found matching this criteria.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedTransactions.map((tx, index) => {
        const status = normalizeAllocationStatus(
          tx.allocationStatus,
          tx.linkStatus,
          tx.amount >= 0
        );
        const detailItems: { key: string; node: React.ReactNode }[] = [
          { key: "date", node: <span>{formatDate(tx.date)}</span> },
        ];

        if (tx.transactionType) {
          detailItems.push({
            key: "type",
            node: <span>{tx.transactionType}</span>,
          });
        }

        if (tx.chartAccount && tx.chartAccount.id) {
          const suffix = tx.chartAccount.ofxAccountId
            ? `(...${tx.chartAccount.ofxAccountId.slice(-4)})`
            : "";
          const lastDigits =
            suffix && !tx.chartAccount.name.includes(suffix) ? ` ${suffix}` : "";
          detailItems.push({
            key: "account",
            node: (
              <span
                className="flex items-center gap-1.5"
                title={`Bank/Source Account: ${tx.chartAccount.code} — ${tx.chartAccount.name}${lastDigits}${!tx.chartAccount.active ? " (Archived)" : ""}`}
              >
                <span className="text-emerald-400 font-mono tracking-tight">
                  {tx.chartAccount.code}
                </span>
                <span className="text-zinc-300 truncate max-w-[150px]">
                  {tx.chartAccount.name}
                  {lastDigits}
                </span>
                {!tx.chartAccount.active && (
                  <Badge variant="danger" size="sm">
                    Archived
                  </Badge>
                )}
              </span>
            ),
          });
        } else {
          detailItems.push({
            key: "no-account",
            node: (
              <span
                className="text-red-400/80 italic text-[11px]"
                title="No bank/card account assigned"
              >
                No Bank Account
              </span>
            ),
          });
        }

        if (tx.expenses && tx.expenses.length > 1) {
          detailItems.push({
            key: "split",
            node: (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                title={`Split across ${tx.expenses.length} linked expenses`}
              >
                Split ({tx.expenses.length} items)
              </span>
            ),
          });
        } else if (tx.category && tx.category.id) {
          detailItems.push({
            key: "category",
            node: (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20"
                title={`Category: ${tx.category.code} — ${tx.category.name}${!tx.category.active ? " (Archived)" : ""}`}
              >
                <span className="font-mono text-purple-400">{tx.category.code}</span>
                <span className="truncate max-w-[140px]">{tx.category.name}</span>
                {!tx.category.active && (
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
                title="Uncategorized transaction"
              >
                Uncategorized
              </span>
            ),
          });
        }

        const linkedReceipts = tx.expenses
          ? tx.expenses.flatMap((e) => e.receipts || [])
          : [];
        const clean = extractCleanVendor(tx.description);
        const isCleanDiff =
          clean && clean.toLowerCase() !== tx.description.toLowerCase().trim();

        return (
          <Card
            key={tx.id}
            glowColor="emerald"
            className="relative animate-card-cascade motion-reduce:animate-none flex-col items-stretch gap-2.5 p-3.5 group hover:border-emerald-500/35 motion-safe:hover:-translate-y-0.5"
            style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
          >
            {/* Row 1: Dedicated Title (stretched focus/click target) with Amount */}
            <div className="flex items-start justify-between gap-3 w-full min-w-0">
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelect(tx.id)}
                  className="text-left w-full flex flex-col min-w-0 cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] after:content-[''] after:absolute after:inset-0 after:rounded-2xl"
                >
                  <span className="text-sm font-semibold text-zinc-100 group-hover:text-white leading-snug line-clamp-1 break-words transition-colors">
                    {clean || tx.description || "Unknown Transaction"}
                  </span>
                  {isCleanDiff && (
                    <span
                      className="text-[11px] text-zinc-400 font-mono truncate max-w-full"
                      title={tx.description}
                    >
                      {tx.description}
                    </span>
                  )}
                </button>
              </div>
              <span
                className={`font-bold text-sm font-mono tabular-nums shrink-0 whitespace-nowrap pl-2 ${
                  tx.amount < 0 ? "text-red-400" : "text-emerald-400"
                }`}
              >
                {formatCurrency(tx.amount)}
              </span>
            </div>

            {/* Row 2: Metadata (Date, Account, Category) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400 min-w-0">
              {detailItems.map((item, i) => (
                <React.Fragment key={item.key}>
                  {i > 0 && <span className="text-zinc-500">&middot;</span>}
                  {item.node}
                </React.Fragment>
              ))}
            </div>

            {/* Row 3: Metadata Badges on Left, Allocation Status on Right */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5 w-full min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                {(tx.isManual || (tx.fitId && tx.fitId.startsWith("MANUAL-"))) && (
                  <Badge variant="warning" size="sm">
                    Manual
                  </Badge>
                )}
                {linkedReceipts.length > 0 && (
                  <div className="relative z-10">
                    <ReceiptThumbnailBadge receipts={linkedReceipts} />
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 items-center shrink-0 ml-auto sm:ml-0">
                <AllocationStatusBadge
                  status={status}
                  hasSuggestions={tx.hasSuggestions}
                  reviewStatus={tx.reviewStatus}
                />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
