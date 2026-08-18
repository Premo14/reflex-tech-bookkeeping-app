import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getTransactions, getFlaggedItems } from "../services/api";
import type { BankTransaction, Expense } from "../types/models";

import TransactionList from "../components/TransactionList";
import ReceiptList from "../components/ReceiptList";

export default function MonthLedger() {
  // get year/month from url
  const { year, month } = useParams<{ year: string, month: string }>();

  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  
  // orphaned + linked expenses
  const [orphanedExpenses, setOrphanedExpenses] = useState<Expense[]>([]);
  
  const [activeTab, setActiveTab] = useState<'transactions' | 'receipts'>('transactions');
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [sortField, setSortField] = useState("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isLoading, setIsLoading] = useState(true);

  // load data
  useEffect(() => {
    if (!year || !month) return;

    setIsLoading(true);

    // fetch everything, search/sort happens locally
    Promise.all([
      getTransactions({ year: Number(year), month: Number(month) }),
      getFlaggedItems({ year: Number(year), month: Number(month) })
    ])
      .then(([txData, flaggedData]) => {
        setTransactions(txData || []);
        setOrphanedExpenses(flaggedData?.expenses || []);
      })
      .catch(err => console.error("Failed to load ledger data", err))
      .finally(() => setIsLoading(false));

  }, [year, month]); // re-run on url change

  // reset filter on tab switch
  const handleTabChange = (tab: 'transactions' | 'receipts') => {
    setActiveTab(tab);
    setFilter("ALL");
  };

  // get month name
  const monthName = month ? new Date(2000, Number(month) - 1).toLocaleString('default', { month: 'long' }) : "";

  return (
    <div className="flex h-screen bg-zinc-900 font-sans text-zinc-100 selection:bg-zinc-700 overflow-y-auto w-full">
      <main className="flex-1 flex flex-col w-full max-w-7xl mx-auto">
        
        {/* HEADER */}
        <header className="p-6 md:p-8 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-4 mb-4">
            <Link 
              to="/" 
              className="p-2 -ml-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Back to Dashboard"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            </Link>
            <div>
              <p className="text-sm font-medium text-zinc-400 mb-1">Monthly Ledger</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{monthName} {year}</h1>
            </div>
          </div>

          {/* CONTROLS: Tabs, Search, Filter */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-end mt-8">
            
            {/* TABS */}
            <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800 self-stretch md:self-auto">
              <button 
                onClick={() => handleTabChange('transactions')}
                className={`flex-1 md:flex-none px-6 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'transactions' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                Transactions
              </button>
              <button 
                onClick={() => handleTabChange('receipts')}
                className={`flex-1 md:flex-none px-6 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'receipts' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                Receipts
              </button>
            </div>

            {/* SEARCH, SORT, & FILTER */}
            <div className="flex flex-wrap gap-3 w-full md:w-auto">
              {/* SEARCH */}
              <div className="relative flex-1 min-w-50 md:w-64">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input 
                  type="text" 
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
                />
              </div>

              {/* SORT FIELD */}
              <select 
                value={sortField}
                onChange={(e) => setSortField(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
              >
                <option value="date">Sort by Date</option>
                <option value="amount">Sort by Amount</option>
                <option value="description">Sort by Name</option>
                {activeTab === 'transactions' && <option value="type">Sort by Type</option>}
              </select>

              {/* SORT ORDER */}
              <button
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-400 hover:text-white transition-all flex items-center justify-center"
                title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>

              {/* FILTER DROPDOWN */}
              <select 
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
              >
                <option value="ALL">All Statuses</option>
                {activeTab === 'transactions' ? (
                  <>
                    <option value="MATCHED">Matched</option>
                    <option value="UNMATCHED">Unmatched</option>
                  </>
                ) : (
                  <>
                    <option value="LINKED">Linked</option>
                    <option value="UNLINKED">Unlinked</option>
                  </>
                )}
              </select>
            </div>

          </div>
        </header>

        {/* CONTENT */}
        <div className="p-6 md:p-8">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <svg className="w-8 h-8 text-zinc-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : (
            <>
              {activeTab === 'transactions' && (
                <TransactionList transactions={transactions} filter={filter} searchQuery={searchQuery} sortField={sortField} sortOrder={sortOrder} />
              )}
              {activeTab === 'receipts' && (
                <ReceiptList transactions={transactions} orphanedExpenses={orphanedExpenses} filter={filter} searchQuery={searchQuery} sortField={sortField} sortOrder={sortOrder} />
              )}
            </>
          )}
        </div>

      </main>
    </div>
  );
}
