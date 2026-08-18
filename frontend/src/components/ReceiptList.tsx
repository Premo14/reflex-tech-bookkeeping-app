import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { BankTransaction, Expense } from "../types/models";

interface ReceiptListProps {
  transactions: BankTransaction[];
  orphanedExpenses: Expense[];
  filter: string; // "ALL", "LINKED", "UNLINKED"
  searchQuery: string;
  sortField: string;
  sortOrder: "asc" | "desc";
}

export default function ReceiptList({ transactions, orphanedExpenses, filter, searchQuery, sortField, sortOrder }: ReceiptListProps) {

  // flatten expenses to find linked ones
  const allReceipts = useMemo(() => {
    
    // 1. Get all linked expenses
    const linked = transactions.flatMap(tx => 
      (tx.expenses || []).map((exp: Expense) => ({
        ...exp,
        isLinked: true,
        linkedTxDesc: tx.description
      }))
    );

    // 2. Format unlinked expenses to match the shape
    const unlinked = orphanedExpenses.map(exp => ({
      ...exp,
      isLinked: false,
      linkedTxDesc: null
    }));

    // 3. Combine and filter
    let combined = [...linked, ...unlinked];
    
    // 3a. Status Filter
    if (filter === "LINKED") {
      combined = combined.filter(exp => exp.isLinked);
    } else if (filter === "UNLINKED") {
      combined = combined.filter(exp => !exp.isLinked);
    }

    // 3b. Search Filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      combined = combined.filter(exp => 
        (exp.vendor?.toLowerCase() || "").includes(q) ||
        (exp.description?.toLowerCase() || "").includes(q) ||
        Math.abs(exp.amount).toString().includes(q)
      );
    }

    // 4. Sort locally
    return combined.sort((a, b) => {
      let cmp = 0;
      if (sortField === "amount") {
        cmp = Math.abs(a.amount) - Math.abs(b.amount);
      } else if (sortField === "description") {
        const nameA = a.vendor || a.description || "";
        const nameB = b.vendor || b.description || "";
        cmp = nameA.localeCompare(nameB);
      } else { // default date
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

  }, [transactions, orphanedExpenses, filter, searchQuery, sortField, sortOrder]);

  if (allReceipts.length === 0) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-zinc-800 rounded-xl">
        <p className="text-zinc-500">No receipts found matching this criteria.</p>
      </div>
    );
  }

  // format currency
  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="space-y-3">
      {allReceipts.map(receipt => (
        <Link 
          key={receipt.id} 
          to={`/details/receipt/${receipt.id}`}
          className="flex items-center justify-between p-4 bg-zinc-800/30 border border-zinc-800 rounded-xl hover:bg-zinc-800/60 transition-colors"
        >
          {/* Left side: Date & Vendor */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{receipt.vendor || "Unknown Vendor"}</span>
              {/* Optional tiny indicator if it's a cash receipt */}
              {receipt.tender?.toLowerCase() === 'cash' && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-700 text-[9px] font-bold uppercase text-zinc-300">CASH</span>
              )}
            </div>
            
            <span className="text-xs text-zinc-500">
              {new Date(receipt.timestamp).toLocaleDateString()}
              {receipt.isLinked && receipt.linkedTxDesc && (
                <span className="text-zinc-400"> &middot; Linked to: {receipt.linkedTxDesc}</span>
              )}
            </span>
          </div>

          {/* Right side: Amount & Status */}
          <div className="flex flex-col items-end gap-2">
            <span className="font-semibold text-white">
              {formatMoney(receipt.amount)}
            </span>
            <div className="flex gap-2 items-center">
              {!receipt.isLinked && receipt.suggestedTransactionId && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border bg-blue-500/10 text-blue-400 border-blue-500/20">
                  SUGGESTION FOUND
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase border ${
                receipt.isLinked
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-zinc-800/50 text-zinc-400 border-zinc-700'
              }`}>
                {receipt.isLinked ? "LINKED" : "UNLINKED"}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
