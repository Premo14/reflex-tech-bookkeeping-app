import React from "react";
import type { BankTransaction } from "../types/models";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";

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
    if (filter !== "ALL" && tx.reconciliationStatus !== filter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!tx.description.toLowerCase().includes(q) && !tx.amount.toString().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
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
        <p className="text-zinc-500">No transactions found matching this criteria.</p>
      </div>
    );
  }

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="space-y-3">
      {sortedTransactions.map((tx, index) => {
        const detailItems = [];
        detailItems.push(<span>{new Date(tx.date).toLocaleDateString()}</span>);
        if (tx.transactionType) {
          detailItems.push(<span>{tx.transactionType}</span>);
        }
        if (tx.chartAccount && tx.chartAccount.id) {
          detailItems.push(
            <span className="flex items-center gap-1.5">
              <span className="text-emerald-400 font-mono tracking-tight">{tx.chartAccount.code}</span>
              <span className="text-zinc-400 truncate max-w-[150px]">{tx.chartAccount.name}</span>
            </span>
          );
        }

        return (
          <Card 
            key={tx.id} 
            onClick={() => onSelect(tx.id)}
            className="animate-card-cascade"
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <div className="flex flex-col gap-1 min-w-0 pr-4">
              <span className="text-sm font-semibold text-zinc-100 truncate">{tx.description || "Unknown Transaction"}</span>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                {detailItems.map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span>&middot;</span>}
                    {item}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className={`font-bold ${tx.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {formatMoney(tx.amount)}
              </span>
              <div className="flex gap-2 items-center">
                {tx.reconciliationStatus === 'UNMATCHED' && tx.hasSuggestions && (
                  <Badge variant="info" size="sm">SUGGESTION FOUND</Badge>
                )}
                {tx.reconciliationStatus === 'MATCHED' ? (
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
