import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getTransactions, getExpenses, createTransaction, createExpense, getAccountingPeriods, closeAccountingPeriod } from "../services/api";
import type { BankTransaction, Expense, AccountingPeriod } from "../types/models";

import TransactionList from "../components/TransactionList";
import ReceiptList from "../components/ReceiptList";

export default function MonthLedger() {
  const { year, month } = useParams<{ year: string, month: string }>();

  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [currentPeriod, setCurrentPeriod] = useState<AccountingPeriod | null>(null);
  const [activeTab, setActiveTab] = useState<'transactions' | 'receipts'>('receipts');
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [sortField, setSortField] = useState("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isLoading, setIsLoading] = useState(true);

  // Create modals & actions
  const [showAddTx, setShowAddTx] = useState(false);
  const [showAddReceipt, setShowAddReceipt] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClosingPeriod, setIsClosingPeriod] = useState(false);

  // Compute date bounds for the current month (used by date pickers)
  const yearNum = Number(year);
  const monthNum = Number(month);
  const monthPad = String(monthNum).padStart(2, '0');
  const lastDay = year && month ? new Date(yearNum, monthNum, 0).getDate() : 31;
  const dateMin = `${year}-${monthPad}-01`;
  const dateMax = `${year}-${monthPad}-${String(lastDay).padStart(2, '0')}`;

  // New transaction form state
  const [txForm, setTxForm] = useState({ date: dateMin, description: '', amount: '', transactionType: 'DEBIT' });
  // New receipt/expense form state
  const [receiptForm, setReceiptForm] = useState({ timestamp: dateMin, vendor: '', description: '', amount: '', tender: 'card' });

  const loadData = () => {
    if (!year || !month) return;
    setIsLoading(true);
    Promise.all([
      getTransactions({ year: yearNum, month: monthNum }),
      getExpenses({ year: yearNum, month: monthNum }),
      getAccountingPeriods()
    ])
      .then(([txData, expensesData, periodsData]) => {
        setTransactions(txData || []);
        setExpenses(expensesData || []);
        const matchingPeriod = (periodsData || []).find(
          (p) => p.year === yearNum && p.month === monthNum
        );
        setCurrentPeriod(matchingPeriod || null);
      })
      .catch(err => console.error("Failed to load ledger data", err))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { loadData(); }, [year, month]);

  const handleTabChange = (tab: 'transactions' | 'receipts') => {
    setActiveTab(tab);
    setFilter("ALL");
  };

  // -------------------------------------------------------------
  // Validation for Closing Month:
  // 1. Must be past month OR last day of current month.
  // 2. All transactions matched.
  // 3. All non-cash receipts linked.
  // -------------------------------------------------------------
  const now = new Date();
  const currentActualYear = now.getFullYear();
  const currentActualMonth = now.getMonth() + 1;
  const currentActualDay = now.getDate();

  const isPastMonth =
    yearNum < currentActualYear ||
    (yearNum === currentActualYear && monthNum < currentActualMonth);

  const isCurrentMonthLastDay =
    yearNum === currentActualYear &&
    monthNum === currentActualMonth &&
    currentActualDay >= new Date(currentActualYear, currentActualMonth, 0).getDate();

  const isDateEligible = isPastMonth || isCurrentMonthLastDay;

  const hasUnmatchedTransactions = transactions.some(
    (tx) => tx.reconciliationStatus !== "MATCHED"
  );

  const hasUnlinkedReceipts = expenses.some(
    (exp) =>
      exp.tender?.toLowerCase() !== "cash" &&
      exp.reconciliationStatus !== "MATCHED"
  );

  const isAlreadyClosed = currentPeriod?.status === "CLOSED";

  const canCloseMonth =
    isDateEligible &&
    !hasUnmatchedTransactions &&
    !hasUnlinkedReceipts &&
    !isAlreadyClosed &&
    !!currentPeriod;

  // Compute disabled tooltip reason
  const getDisabledReason = () => {
    if (isAlreadyClosed) return "This month is already closed.";
    if (!currentPeriod) return "Accounting period not found.";
    if (!isDateEligible) {
      return "A month cannot be closed until its last day or once it has passed.";
    }
    if (hasUnmatchedTransactions || hasUnlinkedReceipts) {
      const unmatchedTxs = transactions.filter(tx => tx.reconciliationStatus !== "MATCHED").length;
      const unlinkedExps = expenses.filter(exp => exp.tender?.toLowerCase() !== "cash" && exp.reconciliationStatus !== "MATCHED").length;
      return `There are items that need review before the month can be closed (${unmatchedTxs} unmatched transactions, ${unlinkedExps} unlinked non-cash receipts).`;
    }
    return "";
  };

  const handleCloseMonth = async () => {
    if (!currentPeriod || !canCloseMonth) return;
    if (!window.confirm(`Are you sure you want to close ${monthName} ${year}? This action will lock the period.`)) {
      return;
    }
    setIsClosingPeriod(true);
    try {
      await closeAccountingPeriod(currentPeriod.id);
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to close accounting period");
    } finally {
      setIsClosingPeriod(false);
    }
  };

  const handleCreateTransaction = async () => {
    if (!txForm.date || !txForm.description || !txForm.amount) return;
    setIsSaving(true);
    try {
      await createTransaction({
        date: new Date(txForm.date).toISOString(),
        description: txForm.description,
        amount: Number(txForm.amount),
        transactionType: txForm.transactionType,
        year: yearNum,
        month: monthNum,
      });
      setShowAddTx(false);
      setTxForm({ date: dateMin, description: '', amount: '', transactionType: 'DEBIT' });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create transaction');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateReceipt = async () => {
    if (!receiptForm.timestamp || !receiptForm.vendor || !receiptForm.amount) return;
    setIsSaving(true);
    try {
      await createExpense({
        timestamp: new Date(receiptForm.timestamp).toISOString(),
        vendor: receiptForm.vendor,
        description: receiptForm.description,
        amount: Number(receiptForm.amount),
        tender: receiptForm.tender,
        year: yearNum,
        month: monthNum,
      });
      setShowAddReceipt(false);
      setReceiptForm({ timestamp: dateMin, vendor: '', description: '', amount: '', tender: 'card' });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create receipt');
    } finally {
      setIsSaving(false);
    }
  };

  const monthName = month ? new Date(2000, monthNum - 1).toLocaleString('default', { month: 'long' }) : "";
  const inputCls = "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all";
  const labelCls = "block text-xs font-medium text-zinc-400 mb-1";

  return (
    <div className="flex h-screen bg-zinc-900 font-sans text-zinc-100 selection:bg-zinc-700 overflow-y-auto w-full">
      <main className="flex-1 flex flex-col w-full max-w-7xl mx-auto">

        {/* HEADER */}
        <header className="p-6 md:p-8 pb-4 border-b border-zinc-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-4">
              <Link to="/" className="p-2 -ml-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" title="Back to Dashboard">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
              </Link>
              <div>
                <p className="text-sm font-medium text-zinc-400 mb-1">Monthly Ledger</p>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl sm:text-3xl font-bold text-white">{monthName} {year}</h1>
                  {currentPeriod && (
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wider uppercase border ${
                      currentPeriod.status === "CLOSED"
                        ? "bg-zinc-800/50 text-zinc-500 border-zinc-800"
                        : currentPeriod.status === "OPEN"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    }`}>
                      {currentPeriod.status}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* CLOSE MONTH BUTTON WITH TOOLTIP */}
            <div className="flex items-center">
              <div className="relative group">
                <button
                  onClick={handleCloseMonth}
                  disabled={!canCloseMonth || isClosingPeriod}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                    isAlreadyClosed
                      ? "bg-zinc-800/50 text-zinc-500 border border-zinc-800 cursor-not-allowed"
                      : canCloseMonth
                        ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40 cursor-pointer"
                        : "bg-zinc-800/60 text-zinc-500 border border-zinc-800/80 cursor-not-allowed"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {isClosingPeriod ? "Closing..." : isAlreadyClosed ? "Month Closed" : "Close Month"}
                </button>

                {/* Hover Tooltip when Disabled */}
                {!canCloseMonth && !isAlreadyClosed && (
                  <div className="absolute right-0 top-full mt-2 hidden group-hover:flex w-72 p-3 bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl text-xs text-zinc-300 z-50 pointer-events-none flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center gap-1.5 font-semibold text-amber-400">
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Cannot Close Month
                    </div>
                    <p className="text-zinc-400 leading-relaxed">
                      {getDisabledReason()}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* CONTROLS */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-end mt-8">

            {/* TABS */}
            <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800 self-stretch md:self-auto">
              <button onClick={() => handleTabChange('receipts')} className={`flex-1 md:flex-none px-6 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'receipts' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}>
                Receipts
              </button>
              <button onClick={() => handleTabChange('transactions')} className={`flex-1 md:flex-none px-6 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'transactions' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}>
                Transactions
              </button>
            </div>

            {/* SEARCH, SORT, FILTER, ADD */}
            <div className="flex flex-wrap gap-3 w-full md:w-auto">

              {/* SEARCH */}
              <div className="relative flex-1 min-w-50 md:w-64">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all" />
              </div>

              {/* SORT FIELD */}
              <select value={sortField} onChange={(e) => setSortField(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all">
                <option value="date">Sort by Date</option>
                <option value="amount">Sort by Amount</option>
                <option value="description">Sort by Name</option>
                {activeTab === 'transactions' && <option value="type">Sort by Type</option>}
              </select>

              {/* SORT ORDER */}
              <button onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-400 hover:text-white transition-all flex items-center justify-center" title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}>
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>

              {/* FILTER */}
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all">
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

              {/* ADD BUTTON — changes label based on active tab */}
              {!isAlreadyClosed && (
                <button
                  onClick={() => activeTab === 'transactions' ? setShowAddTx(true) : setShowAddReceipt(true)}
                  className="flex items-center gap-2 bg-zinc-100 text-zinc-900 hover:bg-white px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  {activeTab === 'transactions' ? 'Add Transaction' : 'Add Receipt'}
                </button>
              )}
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
                <ReceiptList expenses={expenses} filter={filter} searchQuery={searchQuery} sortField={sortField} sortOrder={sortOrder} />
              )}
            </>
          )}
        </div>
      </main>

      {/* ADD TRANSACTION MODAL */}
      {showAddTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-lg">Add Transaction</h3>
              <button onClick={() => setShowAddTx(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>Date <span className="text-zinc-600">({monthName} {year} only)</span></label>
                <input type="date" min={dateMin} max={dateMax} value={txForm.date} onChange={e => setTxForm({ ...txForm, date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input type="text" placeholder="e.g. Office Supplies — Staples" value={txForm.description} onChange={e => setTxForm({ ...txForm, description: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Amount</label>
                <input type="number" step="0.01" placeholder="0.00" value={txForm.amount} onChange={e => setTxForm({ ...txForm, amount: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select value={txForm.transactionType} onChange={e => setTxForm({ ...txForm, transactionType: e.target.value })} className={inputCls}>
                  <option value="DEBIT">Debit</option>
                  <option value="DEP">Deposit</option>
                  <option value="PAYMENT">Payment</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
            <div className="p-5 border-t border-zinc-800 flex gap-3 justify-end">
              <button onClick={() => setShowAddTx(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition">Cancel</button>
              <button onClick={handleCreateTransaction} disabled={isSaving} className="px-5 py-2 bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {isSaving ? 'Saving…' : 'Create Transaction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD RECEIPT MODAL */}
      {showAddReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-lg">Add Receipt</h3>
              <button onClick={() => setShowAddReceipt(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>Date <span className="text-zinc-600">({monthName} {year} only)</span></label>
                <input type="date" min={dateMin} max={dateMax} value={receiptForm.timestamp} onChange={e => setReceiptForm({ ...receiptForm, timestamp: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Vendor</label>
                <input type="text" placeholder="e.g. Staples" value={receiptForm.vendor} onChange={e => setReceiptForm({ ...receiptForm, vendor: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input type="text" placeholder="e.g. Office supplies" value={receiptForm.description} onChange={e => setReceiptForm({ ...receiptForm, description: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Amount</label>
                <input type="number" step="0.01" placeholder="0.00" value={receiptForm.amount} onChange={e => setReceiptForm({ ...receiptForm, amount: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Tender</label>
                <select value={receiptForm.tender} onChange={e => setReceiptForm({ ...receiptForm, tender: e.target.value })} className={inputCls}>
                  <option value="card">Card</option>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="p-5 border-t border-zinc-800 flex gap-3 justify-end">
              <button onClick={() => setShowAddReceipt(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition">Cancel</button>
              <button onClick={handleCreateReceipt} disabled={isSaving} className="px-5 py-2 bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {isSaving ? 'Saving…' : 'Create Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
