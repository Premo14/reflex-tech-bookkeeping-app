import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAccountingPeriods, getPendingClosedItems, reopenAccountingPeriod, deleteTransaction, deleteExpense } from "../services/api";
import type { AccountingPeriod, BankTransaction, Expense } from "../types/models";

import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import FileUploader from "../components/FileUploader";

export default function Dashboard() {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [pendingTransactions, setPendingTransactions] = useState<BankTransaction[]>([]);
  const [pendingExpenses, setPendingExpenses] = useState<Expense[]>([]);

  // extracted so we can call it on load and after uploads
  const fetchPeriods = () => {
    getAccountingPeriods()
      .then(data => {
        setPeriods(data || []);
      })
      .catch(err => {
        console.error("Failed to load accounting periods:", err);
      });
  };

  const fetchPendingItems = () => {
    getPendingClosedItems()
      .then(data => {
        setPendingTransactions(data.transactions || []);
        setPendingExpenses(data.expenses || []);
      })
      .catch(err => {
        console.error("Failed to load pending items:", err);
      });
  };

  const refreshAll = () => {
    fetchPeriods();
    fetchPendingItems();
  }

  // fetch data on mount
  useEffect(() => {
    refreshAll();
  }, []);

  const handleOpenMonth = async (dateStr: string) => {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    try {
      await reopenAccountingPeriod(year, month);
      refreshAll();
    } catch (e) {
      console.error(e);
      alert("Failed to reopen month");
    }
  };

  const handleDeleteTransaction = async (id: number) => {
    try {
      await deleteTransaction(id);
      refreshAll();
    } catch (e) {
      console.error(e);
      alert("Failed to delete transaction");
    }
  };

  const handleDeleteExpense = async (id: number) => {
    try {
      await deleteExpense(id);
      refreshAll();
    } catch (e) {
      console.error(e);
      alert("Failed to delete expense");
    }
  };

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const unclosedPastPeriods = periods
    .filter(p => {
      if (p.status === "CLOSED") return false;
      if (p.year < currentYear) return true;
      if (p.year === currentYear && p.month < currentMonth) return true;
      return false;
    })
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

  const getMonthName = (monthNumber: number) => {
    const date = new Date();
    date.setMonth(monthNumber - 1);
    return date.toLocaleString('default', { month: 'long' });
  };

  return (
    <div className="flex h-screen bg-zinc-900 font-sans text-zinc-100 selection:bg-zinc-700 overflow-hidden relative">
      
      {/* The Sidebar gets the periods data and controls its own mobile state */}
      <Sidebar 
        periods={periods} 
        isSidebarOpen={isSidebarOpen} 
        setIsSidebarOpen={setIsSidebarOpen} 
        refreshPeriods={refreshAll}
      />

      <main className="flex-1 flex flex-col overflow-y-auto w-full">
        <Header setIsSidebarOpen={setIsSidebarOpen} />

        {/* The Dashboard Content */}
        <div className="p-6 md:p-8 pt-4 md:pt-8 max-w-5xl space-y-6 md:space-y-8">
          
          {/* Pending Items Banner */}
          {(pendingTransactions.length > 0 || pendingExpenses.length > 0) && (
            <div className="bg-amber-950/40 border border-amber-900/50 rounded-xl p-4 space-y-4">
              <h2 className="text-amber-500 font-semibold flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Action Required: Items in Closed Months
              </h2>
              
              <div className="space-y-3">
                {pendingTransactions.map(tx => (
                  <div key={`tx-${tx.id}`} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-black/20 p-3 rounded-lg border border-white/5">
                    <div className="mb-3 sm:mb-0">
                      <p className="text-zinc-200 font-medium">There is a pending item awaiting processing, but the date on that transaction is in a month that is closed.</p>
                      <p className="text-sm text-zinc-400 mt-1">Transaction: {tx.description} ({new Date(tx.date).toLocaleDateString()}) - ${tx.amount.toFixed(2)}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button 
                        onClick={() => handleDeleteTransaction(tx.id)}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-sm transition"
                      >
                        Delete Item
                      </button>
                      <button 
                        onClick={() => handleOpenMonth(tx.date)}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm transition font-medium"
                      >
                        Open Month
                      </button>
                    </div>
                  </div>
                ))}

                {pendingExpenses.map(ex => (
                  <div key={`ex-${ex.id}`} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-black/20 p-3 rounded-lg border border-white/5">
                    <div className="mb-3 sm:mb-0">
                      <p className="text-zinc-200 font-medium">There is a pending item awaiting processing, but the date on that receipt is in a month that is closed.</p>
                      <p className="text-sm text-zinc-400 mt-1">Receipt: {ex.vendor || 'Unknown'} ({new Date(ex.timestamp).toLocaleDateString()}) - ${ex.amount.toFixed(2)}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button 
                        onClick={() => handleDeleteExpense(ex.id)}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-sm transition"
                      >
                        Delete Item
                      </button>
                      <button 
                        onClick={() => handleOpenMonth(ex.timestamp)}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm transition font-medium"
                      >
                        Open Month
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Pass the fetch function down so the Uploader can trigger a refresh */}
            <FileUploader onUploadSuccess={refreshAll} />
          </div>

          {unclosedPastPeriods.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white">Unclosed Past Months</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {unclosedPastPeriods.map(p => (
                  <Link
                    key={p.id}
                    to={`/ledger/${p.year}/${p.month}`}
                    className="p-4 bg-zinc-950 border border-zinc-800 hover:border-amber-900/50 hover:bg-zinc-900 rounded-xl transition flex justify-between items-center group shadow-sm"
                  >
                    <div>
                      <h3 className="font-semibold text-zinc-100">{getMonthName(p.month)} {p.year}</h3>
                      <p className="text-sm text-zinc-500 group-hover:text-zinc-400">Needs Reconciliation</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase border ${
                      p.status === "CLOSED"
                        ? "bg-zinc-800/50 text-zinc-500 border-zinc-800"
                        : p.status === "OPEN"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    }`}>
                      {p.status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>

    </div>
  );
}
