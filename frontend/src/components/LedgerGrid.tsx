import { useState, useEffect } from "react";
import TransactionList from "./TransactionList";
import ReceiptList from "./ReceiptList";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Modal } from "./ui/Modal";
import DetailDrawer from "./DetailDrawer";
import { getTransactions, getExpenses, createTransaction, createExpense, getSummary } from "../services/api";
import type { BankTransaction, Expense, ChartAccount, LedgerSummary } from "../types/models";
import CreateExpenseForm from "./CreateExpenseForm";
import CreateTransactionForm from "./CreateTransactionForm";
import Pagination from "./ui/Pagination";

interface LedgerGridProps {
  startDate: string;
  endDate: string;
  accounts: ChartAccount[];
  activeAccountId: number | null;
  viewUnlinkedTrigger?: number;
}

export default function LedgerGrid({ startDate, endDate, accounts, activeAccountId, viewUnlinkedTrigger }: LedgerGridProps) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);

  const [txFilter, setTxFilter] = useState("ALL");
  const [expFilter, setExpFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [mobileTab, setMobileTab] = useState<"expenses" | "transactions">("expenses");
  const [drawerOffset, setDrawerOffset] = useState(0);
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 768);

  const [drawerConfig, setDrawerConfig] = useState<{ type: "transaction" | "receipt" | null, id: number | null }>({ type: null, id: null });
  const [isLoading, setIsLoading] = useState(true);

  const [showAddTx, setShowAddTx] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [txForm, setTxForm] = useState<Partial<BankTransaction>>({ transactionType: 'DEBIT' });
  const [expenseForm, setExpenseForm] = useState<Partial<Expense>>({ tender: 'card' });

  const [txPage, setTxPage] = useState(1);
  const [txTotalPages, setTxTotalPages] = useState(1);
  const [expPage, setExpPage] = useState(1);
  const [expTotalPages, setExpTotalPages] = useState(1);
  const LIMIT = 50;

  useEffect(() => {
    loadGridData();
  }, [startDate, endDate, activeAccountId, txPage, expPage, searchQuery]);

  useEffect(() => {
    if (viewUnlinkedTrigger && viewUnlinkedTrigger > 0) {
      setTxFilter("UNMATCHED");
      setExpFilter("UNMATCHED");
    }
  }, [viewUnlinkedTrigger]);

  // Reset drawer if resized to desktop
  useEffect(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < 768);
      if (window.innerWidth >= 1024) setDrawerOffset(0);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadGridData = async () => {
    setIsLoading(true);
    try {
      const filters = { 
        startDate, 
        endDate, 
        accountId: activeAccountId === null ? undefined : activeAccountId,
        search: searchQuery
      };
      
      const txFilters = { ...filters, page: txPage, limit: LIMIT };
      const expFilters = { ...filters, page: expPage, limit: LIMIT };

      const [txData, expData, summaryData] = await Promise.all([
        getTransactions(txFilters),
        getExpenses(expFilters),
        getSummary({ startDate, endDate, accountId: activeAccountId === null ? undefined : activeAccountId })
      ]);
      setTransactions(txData.transactions);
      setTxTotalPages(Math.ceil(txData.total / LIMIT));
      
      setExpenses(expData.expenses);
      setExpTotalPages(Math.ceil(expData.total / LIMIT));
      
      setSummary(summaryData);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTransaction = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...txForm,
        description: txForm.description || "Unknown Transaction",
        amount: Number(txForm.amount) || 0,
        date: txForm.date ? new Date(txForm.date).toISOString() : new Date().toISOString()
      };
      await createTransaction(payload as any);
      setShowAddTx(false);
      setTxForm({ transactionType: 'DEBIT' });
      loadGridData();
    } catch { alert("Failed to create transaction"); }
    finally { setIsSaving(false); }
  };

  const handleCreateExpense = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...expenseForm,
        vendor: expenseForm.vendor || "Unknown Vendor",
        description: expenseForm.description || "Expense",
        amount: Number(expenseForm.amount) || 0,
        timestamp: expenseForm.timestamp ? new Date(expenseForm.timestamp).toISOString() : new Date().toISOString()
      };
      await createExpense(payload as any);
      setShowAddExpense(false);
      setExpenseForm({ tender: 'card' });
      loadGridData();
    } catch { alert("Failed to create expense"); }
    finally { setIsSaving(false); }
  };

  const exportCSV = () => {
    const txRows = transactions.map(tx => [
      new Date(tx.date).toLocaleDateString(),
      `"${(tx.description || '').replace(/"/g, '""')}"`,
      tx.amount, tx.transactionType,
      tx.chartAccount?.code || '', `"${tx.chartAccount?.name || ''}"`,
      tx.reconciliationStatus === 'MATCHED' ? 'LINKED' : tx.reconciliationStatus === 'PARTIALLY_MATCHED' ? 'PARTIAL' : tx.reconciliationStatus === 'OVER_ALLOCATED' ? 'OVER-ALLOCATED' : 'UNLINKED',
    ].join(','));
    const expRows = expenses.map(exp => [
      new Date(exp.timestamp).toLocaleDateString(),
      `"${(exp.vendor || '').replace(/"/g, '""')}"`,
      `"${(exp.description || '').replace(/"/g, '""')}"`,
      exp.amount, exp.tender,
      exp.chartAccount?.code || '', `"${exp.chartAccount?.name || ''}"`,
      exp.reconciliationStatus === 'MATCHED' ? 'LINKED' : exp.reconciliationStatus === 'PARTIALLY_MATCHED' ? 'PARTIAL' : exp.reconciliationStatus === 'OVER_ALLOCATED' ? 'OVER-ALLOCATED' : 'UNLINKED',
    ].join(','));
    const content = [
      '=== BANK TRANSACTIONS ===',
      'Date,Description,Amount,Type,Account Code,Account Name,Status',
      ...txRows, '',
      '=== EXPENSES ===',
      'Date,Vendor,Description,Amount,Tender,Category Code,Category Name,Status',
      ...expRows,
    ].join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatMoney = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">

      {/* TOOLBAR */}
      <div className="px-6 py-4 border-b border-white/5 flex flex-wrap gap-4 items-center justify-between bg-[#121212] shrink-0">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Input type="text" placeholder={isNarrow ? "Search txs and exps..." : "Search transactions and expenses..."} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>} />
          </div>
          <Button variant="secondary" onClick={() => {
            setSortField("date"); 
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
          }} title={sortOrder === 'asc' ? 'Sort Ascending' : 'Sort Descending'} className="px-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {sortOrder === 'asc' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
              )}
            </svg>
          </Button>
          <Button variant="secondary" onClick={exportCSV}>
            Export
          </Button>
        </div>
      </div>

      {/* SUMMARY BAR */}
      {summary && (
        <div className="px-6 py-4 border-b border-white/5 bg-[#0e0e10] shrink-0">
          <div className="flex flex-wrap items-center gap-x-4 lg:gap-x-8 gap-y-4 lg:gap-y-6">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Income</span>
              <span className="text-lg xl:text-xl font-black text-emerald-400 tracking-tight">{formatMoney(summary.totalIncome)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Expenses</span>
              <span className="text-lg xl:text-xl font-black text-red-400 tracking-tight">{formatMoney(summary.totalExpenses)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Net Cashflow</span>
              <span className={`text-lg xl:text-xl font-black tracking-tight ${summary.netCashflow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatMoney(summary.netCashflow)}</span>
            </div>
            
            <div className="flex flex-col items-start xl:items-end xl:pl-8 xl:border-l border-white/5 ml-auto max-w-full">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Needs Attention</span>
              {(summary.unlinkedExpCount > 0 || summary.unmatchedTxCount > 0) ? (
                <Button 
                  variant="warning"
                  onClick={() => { setTxFilter('UNMATCHED'); setExpFilter('UNMATCHED'); }}
                  className="max-w-full"
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span className="truncate">{summary.unmatchedTxCount} Unlinked Tx / {summary.unlinkedExpCount} Unlinked Exp</span>
                </Button>
              ) : (
                <span className="flex items-center text-left whitespace-nowrap gap-1.5 text-sm font-bold text-zinc-400 px-3 py-1.5 max-w-full" title="All Caught Up">
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  <span className="truncate hidden xl:inline">All Caught Up</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GRID */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
        </div>
      ) : (
        <div 
          className="flex-1 overflow-hidden flex flex-col relative z-20 bg-[#0a0a0a] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] lg:shadow-none transition-none"
          style={{
            marginTop: `-${drawerOffset}px`
          }}
        >
          {/* Mobile Tabs & Drag Handle */}
          <div 
            className="lg:hidden h-5 w-full bg-[#121212] flex items-center justify-center cursor-row-resize border-t border-white/10 shrink-0 touch-none relative z-10"
            onTouchStart={(e) => {
              const startY = e.touches[0].clientY;
              const startOffset = drawerOffset;
              const onMove = (e: TouchEvent) => setDrawerOffset(Math.min(startOffset + startY - 80, Math.max(0, startOffset + (startY - e.touches[0].clientY))));
              const onEnd = () => { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); };
              document.addEventListener('touchmove', onMove); document.addEventListener('touchend', onEnd);
            }}
            onMouseDown={(e) => {
              const startY = e.clientY;
              const startOffset = drawerOffset;
              const onMove = (e: MouseEvent) => setDrawerOffset(Math.min(startOffset + startY - 80, Math.max(0, startOffset + (startY - e.clientY))));
              const onEnd = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onEnd); };
              document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onEnd);
            }}
          >
            <div className="w-10 h-1.5 rounded-full bg-zinc-600 pointer-events-none" />
          </div>

          <div className="lg:hidden flex border-b border-white/5 shrink-0 bg-[#0e0e10]">
            <button 
              onClick={() => setMobileTab("expenses")} 
              className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${mobileTab === 'expenses' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-zinc-400 hover:text-zinc-300'}`}
            >
              Expenses
            </button>
            <button 
              onClick={() => setMobileTab("transactions")} 
              className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${mobileTab === 'transactions' ? 'border-blue-500 text-blue-400' : 'border-transparent text-zinc-400 hover:text-zinc-300'}`}
            >
              Bank Transactions
            </button>
          </div>

          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/5 relative">
            {/* EXPENSES COLUMN */}
            <div className={`flex-col bg-[#0a0a0a] min-h-0 ${mobileTab === 'expenses' ? 'flex' : 'hidden lg:flex'}`}>
              <div className="px-6 py-4 flex justify-between items-center bg-[#121212] border-b border-white/5 shrink-0">
                <h2 className="text-lg font-bold flex items-center gap-2 text-white tracking-tight">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  Expenses
                </h2>
                <div className="flex gap-2">
                  <Select value={expFilter} onChange={e => setExpFilter(e.target.value)} className="py-1.5! text-xs!">
                    <option value="ALL">All</option>
                    <option value="UNMATCHED">Unlinked</option>
                    <option value="MATCHED">Linked</option>
                  </Select>
                  <Button variant="secondary" onClick={() => setShowAddExpense(true)} title="Add Expense" className="p-1.5!" size="sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24">
                <ReceiptList expenses={expenses} filter={expFilter} searchQuery={searchQuery} sortField={sortField} sortOrder={sortOrder} onSelect={(id) => setDrawerConfig({ type: 'receipt', id })} />
                <Pagination currentPage={expPage} totalPages={expTotalPages} onPageChange={setExpPage} />
              </div>
            </div>

            {/* BANK TRANSACTIONS COLUMN */}
            <div className={`flex-col bg-[#0a0a0a] min-h-0 ${mobileTab === 'transactions' ? 'flex' : 'hidden lg:flex'}`}>
              <div className="px-6 py-4 flex justify-between items-center bg-[#121212] border-b border-white/5 shrink-0">
                <h2 className="text-lg font-bold flex items-center gap-2 text-white tracking-tight">
                  <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
                  Bank Transactions
                </h2>
                <div className="flex gap-2">
                  <Select value={txFilter} onChange={e => setTxFilter(e.target.value)} className="py-1.5! text-xs!">
                    <option value="ALL">All</option>
                    <option value="UNMATCHED">Unlinked</option>
                    <option value="MATCHED">Linked</option>
                  </Select>
                  <Button variant="secondary" onClick={() => setShowAddTx(true)} title="Add Transaction" className="p-1.5!" size="sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24">
                <TransactionList transactions={transactions} filter={txFilter} searchQuery={searchQuery} sortField={sortField} sortOrder={sortOrder} onSelect={(id) => setDrawerConfig({ type: 'transaction', id })} />
                <Pagination currentPage={txPage} totalPages={txTotalPages} onPageChange={setTxPage} />
              </div>
            </div>
        </div>
        </div>
      )}

      <DetailDrawer type={drawerConfig.type} id={drawerConfig.id} onClose={() => { setDrawerConfig({ type: null, id: null }); loadGridData(); }} />

      {/* ADD TRANSACTION MODAL */}
      <Modal isOpen={showAddTx} onClose={() => setShowAddTx(false)} title="Add Transaction" footer={
        <div className="flex gap-3 justify-end w-full">
          <Button variant="ghost" onClick={() => setShowAddTx(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleCreateTransaction} isLoading={isSaving}>Create Transaction</Button>
        </div>
      }>
        <CreateTransactionForm form={txForm} setForm={setTxForm} accounts={accounts} />
      </Modal>

      {/* ADD EXPENSE MODAL */}
      <Modal isOpen={showAddExpense} onClose={() => setShowAddExpense(false)} title="Add Expense" footer={
        <div className="flex gap-3 justify-end w-full">
          <Button variant="ghost" onClick={() => setShowAddExpense(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleCreateExpense} isLoading={isSaving}>Create Expense</Button>
        </div>
      }>
        <CreateExpenseForm form={expenseForm} setForm={setExpenseForm} accounts={accounts} />
      </Modal>
    </div>
  );
}
