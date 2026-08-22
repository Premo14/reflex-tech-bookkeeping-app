import { Link } from "react-router-dom";
import type { BankTransaction } from "../types/models";

interface TransactionListProps {
  transactions: BankTransaction[];
  filter: string;
  searchQuery: string;
  sortField: string;
  sortOrder: "asc" | "desc";
}

export default function TransactionList({ transactions, filter, searchQuery, sortField, sortOrder }: TransactionListProps) {
  
  // local filter
  const filteredTransactions = transactions.filter(tx => {
    // 1. Filter Status
    if (filter !== "ALL" && tx.reconciliationStatus !== filter) return false;
    
    // 2. Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!tx.description.toLowerCase().includes(q) && !Math.abs(tx.amount).toString().includes(q)) {
        return false;
      }
    }
    return true;
  });

  // sort locally
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    let cmp = 0;
    if (sortField === "amount") {
      cmp = Math.abs(a.amount) - Math.abs(b.amount);
    } else if (sortField === "description") {
      cmp = a.description.localeCompare(b.description);
    } else if (sortField === "type") {
      cmp = (a.transactionType || "").localeCompare(b.transactionType || "");
    } else { // default date
      cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
    }
    return sortOrder === "asc" ? cmp : -cmp;
  });

  if (sortedTransactions.length === 0) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-zinc-800 rounded-xl">
        <p className="text-zinc-500">No transactions found matching this criteria.</p>
      </div>
    );
  }

  // format currency
  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="space-y-3">
      {sortedTransactions.map(tx => (
        <Link 
          key={tx.id} 
          to={`/details/transaction/${tx.id}`}
          className="flex items-center justify-between p-4 bg-zinc-800/30 border border-zinc-800 rounded-xl hover:bg-zinc-800/60 transition-colors"
        >
          {/* Left side: Date & Desc */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-white">{tx.description || "Unknown Transaction"}</span>
            <span className="text-xs text-zinc-500">{new Date(tx.date).toLocaleDateString()} &middot; {tx.transactionType}</span>
          </div>

          {/* Right side: Amount & Status */}
          <div className="flex flex-col items-end gap-2">
            <span className={`font-semibold ${tx.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {formatMoney(tx.amount)}
            </span>
            <div className="flex gap-2 items-center">
              {tx.reconciliationStatus === 'UNMATCHED' && tx.suggestedExpenseId && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border bg-blue-500/10 text-blue-400 border-blue-500/20">
                  SUGGESTION FOUND
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase border ${
                tx.reconciliationStatus === 'MATCHED'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20' // UNMATCHED
              }`}>
                {tx.reconciliationStatus || "UNKNOWN"}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
