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
        <p className="text-zinc-500">No expenses found matching this criteria.</p>
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
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 mt-0.5">
                {detailItems.map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span>&middot;</span>}
                    {item}
                  </React.Fragment>
                ))}
              </div>
              {exp.reconciliationStatus === 'MATCHED' && exp.bankTransactions && exp.bankTransactions.length > 0 && (
                <div className="text-xs text-zinc-600 mt-1 truncate">
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
                {exp.reconciliationStatus === 'MATCHED' ? (
                  <Badge variant="success">LINKED</Badge>
                ) : (
                  <Badge variant="danger">UNLINKED</Badge>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
