import React from "react";
import type { Expense } from "../types/models";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";

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
    if (filter !== "ALL" && exp.reconciliationStatus !== filter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(exp.vendor || "").toLowerCase().includes(q) && 
          !(exp.description || "").toLowerCase().includes(q) && 
          !(exp.amount || 0).toString().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    let cmp = 0;
    if (sortField === "amount") {
      cmp = a.amount - b.amount;
    } else if (sortField === "vendor") {
      cmp = (a.description || "").localeCompare(b.description || "");
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
        const detailItems = [];
        detailItems.push(<span>{new Date(exp.timestamp).toLocaleDateString()}</span>);
        
        if (exp.chartAccount && exp.chartAccount.id) {
          detailItems.push(
            <span className="flex items-center gap-1.5">
              <span className="text-emerald-400 font-mono tracking-tight">{exp.chartAccount.code}</span>
              <span className="text-zinc-400 truncate max-w-[150px]">{exp.chartAccount.name}</span>
            </span>
          );
        } else if (exp.description) {
          detailItems.push(<span className="truncate max-w-[200px]">{exp.description}</span>);
        }

        return (
          <Card 
            key={exp.id} 
            onClick={() => onSelect(exp.id)}
            className="animate-card-cascade"
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <div className="flex flex-col gap-1 min-w-0 pr-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-100 truncate">{exp.vendor || "Unknown Vendor"}</span>
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
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400 mt-0.5">
                {detailItems.map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span>&middot;</span>}
                    {item}
                  </React.Fragment>
                ))}
              </div>
              {exp.reconciliationStatus === 'MATCHED' && exp.bankTransactions && exp.bankTransactions.length > 0 && (
                <div className="text-xs text-zinc-400 mt-1 truncate">
                  Linked to: {exp.bankTransactions.map(t => t.description).join(", ")}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className="font-bold text-white">
                {formatMoney(exp.amount)}
              </span>
              <div className="flex gap-2 items-center">
                {exp.reconciliationStatus === 'UNMATCHED' && exp.hasSuggestions && (
                  <Badge variant="info" size="sm">SUGGESTION FOUND</Badge>
                )}
                {exp.reconciliationStatus === 'MATCHED' && <Badge variant="success">LINKED</Badge>}
                {exp.reconciliationStatus === 'PARTIALLY_MATCHED' && <Badge variant="warning">PARTIAL</Badge>}
                {exp.reconciliationStatus === 'OVER_ALLOCATED' && <Badge variant="danger">OVER-ALLOCATED</Badge>}
                {exp.reconciliationStatus === 'UNMATCHED' && <Badge variant="neutral">UNLINKED</Badge>}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
