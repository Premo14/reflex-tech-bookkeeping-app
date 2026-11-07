import React from "react";
import type { BankTransaction } from "../types/models";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { formatDate } from "../utils/dateUtils";

interface TransactionListProps {
  transactions: BankTransaction[];
  filter: string;
  searchQuery: string;
  sortField: string;
  sortOrder: "asc" | "desc";
  onSelect: (id: number) => void;
}

export default function TransactionList({ transactions, filter, searchQuery, sortField, sortOrder, onSelect }: TransactionListProps) {
  
  const filteredTransactions = transactions.filter(tx => {
    const s = tx.allocationStatus || tx.linkStatus || (tx.amount > 0 ? "BALANCED" : "UNLINKED");
    if (filter !== "ALL") {
      if (filter === "NEEDS_ATTENTION") {
        if (s === "BALANCED" || s === "LINKED" || tx.reviewStatus === "WARNINGS_IGNORED" || tx.reviewStatus === "IGNORED") return false;
      } else {
        if (filter === "UNLINKED" && s !== "UNLINKED") return false;
        if (filter === "BALANCED" && s !== "BALANCED" && s !== "LINKED") return false;
        if (filter === "PARTIALLY_ALLOCATED" && s !== "PARTIALLY_ALLOCATED") return false;
        if (filter === "OVER_ALLOCATED" && s !== "OVER_ALLOCATED") return false;
      }
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const numQuery = parseFloat(q.replace(/^\$/, ''));
      const matchesAmount = !isNaN(numQuery) && Math.abs(Math.abs(tx.amount) - numQuery) < 0.001;
      const formattedAmt = Math.abs(tx.amount).toFixed(2);
      if (!tx.description.toLowerCase().includes(q) && 
          !tx.amount.toString().includes(q) && 
          !formattedAmt.includes(q) && 
          !matchesAmount) {
        return false;
      }
    }
    return true;
  });

  const getProblemPriority = (tx: BankTransaction) => {
    if (tx.reviewStatus === 'WARNINGS_IGNORED' || tx.reviewStatus === 'IGNORED') return 5;
    const s = tx.allocationStatus || tx.linkStatus || (tx.amount > 0 ? "BALANCED" : "UNLINKED");
    if (s === 'UNLINKED' && tx.hasSuggestions) return 0; // Highest urgency: suggestions waiting
    if (s === 'OVER_ALLOCATED') return 1;
    if (s === 'PARTIALLY_ALLOCATED') return 2;
    if (s === 'UNLINKED') return 3;
    return 4; // BALANCED
  };

  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    // Problem items always sorted first by default
    const pDiff = getProblemPriority(a) - getProblemPriority(b);
    if (pDiff !== 0) return pDiff;

    let cmp = 0;
    if (sortField === "amount") {
      cmp = a.amount - b.amount;
    } else if (sortField === "description") {
      cmp = a.description.localeCompare(b.description);
    } else if (sortField === "type") {
      cmp = (a.transactionType || "").localeCompare(b.transactionType || "");
    } else {
      cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
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

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="space-y-3">
      {sortedTransactions.map((tx, index) => {
        const s = tx.allocationStatus || tx.linkStatus || (tx.amount > 0 ? "BALANCED" : "UNLINKED");
        const detailItems = [];
        detailItems.push(<span>{formatDate(tx.date)}</span>);
        if (tx.transactionType) {
          detailItems.push(<span>{tx.transactionType}</span>);
        }
        if (tx.chartAccount && tx.chartAccount.id) {
          const lastDigits = tx.chartAccount.ofxAccountId
            ? ` (...${tx.chartAccount.ofxAccountId.slice(-4)})`
            : '';
          detailItems.push(
            <span className="flex items-center gap-1.5" title={`Bank/Source Account: ${tx.chartAccount.code} — ${tx.chartAccount.name}${lastDigits}${!tx.chartAccount.active ? ' (Archived)' : ''}`}>
              <span className="text-emerald-400 font-mono tracking-tight">{tx.chartAccount.code}</span>
              <span className="text-zinc-300 truncate max-w-[150px]">
                {tx.chartAccount.name}{lastDigits}
              </span>
              {!tx.chartAccount.active && (
                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 whitespace-nowrap" title="This account category has been archived in Chart of Accounts. Historical records are preserved.">
                  Archived
                </span>
              )}
            </span>
          );
        } else {
          detailItems.push(
            <span className="text-red-400/80 italic text-[11px]" title="No bank/card account assigned">
              No Bank Account
            </span>
          );
        }

        if (tx.category && tx.category.id) {
          detailItems.push(
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20" title={`Category: ${tx.category.code} — ${tx.category.name}${!tx.category.active ? ' (Archived)' : ''}`}>
              <span className="font-mono text-purple-400">{tx.category.code}</span>
              <span className="truncate max-w-[140px]">{tx.category.name}</span>
              {!tx.category.active && (
                <span className="inline-flex items-center px-1 py-0.2 rounded text-[8px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 whitespace-nowrap" title="This account category has been archived in Chart of Accounts. Historical records are preserved.">
                  Archived
                </span>
              )}
            </span>
          );
        } else {
          detailItems.push(
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/60 italic" title="Uncategorized transaction">
              Uncategorized
            </span>
          );
        }

        return (
          <Card 
            key={tx.id} 
            onClick={() => onSelect(tx.id)}
            className="animate-card-cascade flex-col items-stretch gap-2.5 p-3.5"
            style={{ animationDelay: `${index * 120}ms` }}
          >
            {/* Row 1: Dedicated Title with Amount */}
            <div className="flex items-start justify-between gap-3 w-full min-w-0">
              <span className="text-sm font-semibold text-zinc-100 leading-snug line-clamp-2 break-words flex-1 min-w-0">
                {tx.description || "Unknown Transaction"}
              </span>
              <span className={`font-bold text-sm shrink-0 whitespace-nowrap pl-2 ${tx.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {formatMoney(tx.amount)}
              </span>
            </div>

            {/* Row 2: Metadata (Date, Account, Category) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400 min-w-0">
              {detailItems.map((item, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-zinc-600">&middot;</span>}
                  {item}
                </React.Fragment>
              ))}
            </div>

            {/* Row 3: Metadata Badges on Left, Allocation Status on Right */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5 w-full min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                {(tx.isManual || (tx.fitId && tx.fitId.startsWith("MANUAL-"))) && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-orange-500/20 text-orange-400 border border-orange-500/30 tracking-wider">
                    Manual
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 items-center shrink-0">
                {tx.reviewStatus === 'WARNINGS_IGNORED' ? (
                  <Badge variant="neutral" size="sm">WARNINGS SILENCED</Badge>
                ) : (
                  <>
                    {s === 'UNLINKED' && tx.hasSuggestions && (
                      <Badge variant="info" size="sm">SUGGESTION FOUND</Badge>
                    )}
                    {(s === 'BALANCED' || s === 'LINKED') && <Badge variant="success">BALANCED</Badge>}
                    {s === 'PARTIALLY_ALLOCATED' && <Badge variant="warning">UNDER-ALLOCATED</Badge>}
                    {s === 'OVER_ALLOCATED' && <Badge variant="danger">OVER-ALLOCATED</Badge>}
                    {s === 'UNLINKED' && <Badge variant="neutral">UNLINKED</Badge>}
                  </>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
