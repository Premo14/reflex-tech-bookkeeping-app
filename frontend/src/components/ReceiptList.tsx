import React from "react";
import type { Expense } from "../types/models";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { getSubClassForAccount } from "../utils/accountHierarchy";
import { formatDate } from "../utils/dateUtils";

interface ReceiptListProps {
  expenses: Expense[];
  filter: string;
  searchQuery: string;
  sortField: string;
  sortOrder: "asc" | "desc";
  onSelect: (id: number) => void;
}

export default function ReceiptList({ expenses, filter, searchQuery, sortField, sortOrder, onSelect }: ReceiptListProps) {
  
  const filteredExpenses = expenses.filter(exp => {
    const s = exp.allocationStatus || exp.linkStatus || (exp.tender?.toLowerCase() === "cash" ? "BALANCED" : "UNLINKED");
    if (filter !== "ALL") {
      if (filter === "NEEDS_ATTENTION") {
        if (s === "BALANCED" || s === "LINKED" || exp.reviewStatus === "WARNINGS_IGNORED" || exp.reviewStatus === "IGNORED") return false;
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
      const matchesAmount = !isNaN(numQuery) && Math.abs(Math.abs(exp.amount || 0) - numQuery) < 0.001;
      const formattedAmt = (exp.amount || 0).toFixed(2);
      if (!(exp.vendor || "").toLowerCase().includes(q) && 
          !(exp.description || "").toLowerCase().includes(q) && 
          !(exp.amount || 0).toString().includes(q) &&
          !formattedAmt.includes(q) &&
          !matchesAmount) {
        return false;
      }
    }
    return true;
  });

  const getProblemPriority = (exp: Expense) => {
    if (exp.reviewStatus === 'WARNINGS_IGNORED' || exp.reviewStatus === 'IGNORED') return 5;
    const s = exp.allocationStatus || exp.linkStatus || (exp.tender?.toLowerCase() === "cash" ? "BALANCED" : "UNLINKED");
    if (s === 'UNLINKED' && exp.hasSuggestions) return 0; // Highest urgency: suggestions waiting
    if (s === 'OVER_ALLOCATED') return 1;
    if (s === 'PARTIALLY_ALLOCATED') return 2;
    if (s === 'UNLINKED') return 3;
    return 4; // BALANCED
  };

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    // Problem items always sorted first by default
    const pDiff = getProblemPriority(a) - getProblemPriority(b);
    if (pDiff !== 0) return pDiff;

    let cmp = 0;
    if (sortField === "amount") {
      cmp = a.amount - b.amount;
    } else if (sortField === "vendor") {
      cmp = (a.description || a.vendor || "").localeCompare(b.description || b.vendor || "");
    } else if (sortField === "tender") {
      cmp = (a.tender || "").localeCompare(b.tender || "");
    } else {
      cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
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

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="space-y-3">
      {sortedExpenses.map((exp, index) => {
        const s = exp.allocationStatus || exp.linkStatus || (exp.tender?.toLowerCase() === "cash" ? "BALANCED" : "UNLINKED");
        const detailItems = [];
        detailItems.push(<span>{formatDate(exp.timestamp)}</span>);
        
        if (exp.description && exp.description !== exp.vendor) {
          detailItems.push(<span className="text-zinc-400 truncate max-w-[180px]">{exp.description}</span>);
        }

        if (exp.chartAccount && exp.chartAccount.id) {
          const subClass = getSubClassForAccount(exp.chartAccount.type, exp.chartAccount.code);
          detailItems.push(
            <span className="flex items-center gap-1.5 flex-wrap" title={`Category: ${exp.chartAccount.code} — ${exp.chartAccount.name}${subClass ? ` (${subClass.name})` : ''}${!exp.chartAccount.active ? ' (Archived)' : ''}`}>
              <span className="text-emerald-400 font-mono tracking-tight">{exp.chartAccount.code}</span>
              <span className="text-zinc-300 truncate max-w-[150px]">{exp.chartAccount.name}</span>
              {subClass && (
                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 whitespace-nowrap">
                  {subClass.name}
                </span>
              )}
              {!exp.chartAccount.active && (
                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 whitespace-nowrap" title="This account category has been archived in Chart of Accounts. Historical records are preserved.">
                  Archived
                </span>
              )}
            </span>
          );
        } else {
          detailItems.push(
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/60 italic" title="Uncategorized expense">
              Uncategorized
            </span>
          );
        }

        return (
          <Card 
            key={exp.id} 
            onClick={() => onSelect(exp.id)}
            className="animate-card-cascade flex-col items-stretch gap-2.5 p-3.5"
            style={{ animationDelay: `${index * 120}ms` }}
          >
            {/* Row 1: Dedicated Title with Amount */}
            <div className="flex items-start justify-between gap-3 w-full min-w-0">
              <span className="text-sm font-semibold text-zinc-100 leading-snug line-clamp-2 break-words flex-1 min-w-0">
                {exp.vendor || exp.description || "Unknown Expense"}
              </span>
              <span className="font-bold text-sm shrink-0 whitespace-nowrap pl-2 text-white">
                {formatMoney(exp.amount)}
              </span>
            </div>

            {/* Row 2: Metadata (Date, Description, Category) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400 min-w-0">
              {detailItems.map((item, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-zinc-600">&middot;</span>}
                  {item}
                </React.Fragment>
              ))}
            </div>
            {(exp.allocationStatus === 'BALANCED' || exp.linkStatus === 'LINKED') && exp.bankTransactions && exp.bankTransactions.length > 0 && (
              <div className="text-xs text-zinc-400 truncate w-full">
                Linked to: {exp.bankTransactions.map(t => t.description).join(", ")}
              </div>
            )}

            {/* Row 3: Metadata Badges on Left, Allocation Status on Right */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5 w-full min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-zinc-800 text-zinc-400 border border-zinc-700 tracking-wider">
                  {exp.tender}
                </span>
                {exp.isManual && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-orange-500/20 text-orange-400 border border-orange-500/30 tracking-wider">
                    Manual
                  </span>
                )}
                {(!exp.receipts || exp.receipts.length === 0) && (
                  <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded border border-red-400/20" title="No physical receipt attached">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    No Receipt
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 items-center shrink-0">
                {exp.reviewStatus === 'WARNINGS_IGNORED' ? (
                  <Badge variant="neutral" size="sm">WARNINGS SILENCED</Badge>
                ) : (
                  <>
                    {s === 'UNLINKED' && exp.hasSuggestions && (
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
