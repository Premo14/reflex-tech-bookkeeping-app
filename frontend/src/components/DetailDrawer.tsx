import { useEffect, useState, useRef } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import Pagination from "./ui/Pagination";
import ReactDOM from "react-dom";
import ExcludeItemModal from "./ExcludeItemModal";
import {
  getTransactionDetail, getExpenseDetail,
  updateTransaction, updateExpense,
  deleteTransaction, deleteExpense,
  markExpenseAsCash, getUnlinkedItems,
  linkExpenseToTransaction, unlinkExpenseFromTransaction,
  createAndLink, uploadReceiptToExpense, deleteReceipt,
  getSettings, getChartAccounts
} from "../services/api";
import type { BankTransaction, Expense, ChartAccount } from "../types/models";
import CreateExpenseForm from "./CreateExpenseForm";
import CreateTransactionForm from "./CreateTransactionForm";

interface DetailDrawerProps {
  type: "transaction" | "receipt" | null;
  id: number | null;
  onClose: () => void;
}

export default function DetailDrawer({ type, id, onClose }: DetailDrawerProps) {
  const [tx, setTx] = useState<BankTransaction | null>(null);
  const [expense, setExpense] = useState<Expense | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);

  const [confirmedExpenses, setConfirmedExpenses] = useState<Expense[]>([]);
  const [suggestedExpenses, setSuggestedExpenses] = useState<Expense[]>([]);
  const [confirmedTransactions, setConfirmedTransactions] = useState<BankTransaction[]>([]);
  const [suggestedTransactions, setSuggestedTransactions] = useState<BankTransaction[]>([]);

  const [activeLinkedIdx, setActiveLinkedIdx] = useState(0);

  const [isEditingRoot, setIsEditingRoot] = useState(false);
  const [rootForm, setRootForm] = useState<any>({});

  const [isEditingLinked, setIsEditingLinked] = useState(false);
  const [linkedForm, setLinkedForm] = useState<any>({});

  const [unlinked, setUnlinked] = useState<{ transactions: BankTransaction[], expenses: Expense[] }>({ transactions: [], expenses: [] });
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
  const [showLinkPanel, setShowLinkPanel] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [activeReceiptIdx, setActiveReceiptIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isClosed, setIsClosed] = useState(false);
  const [showExcludeModal, setShowExcludeModal] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [conflictModalData, setConflictModalData] = useState<any>(null);
  const [overAllocatedModalData, setOverAllocatedModalData] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [linkSearch, setLinkSearch] = useState("");
  const [linkStartDate, setLinkStartDate] = useState("");
  const [linkEndDate, setLinkEndDate] = useState("");
  const [linkPage, setLinkPage] = useState(1);
  const [unlinkedTotalPages, setUnlinkedTotalPages] = useState(1);
  const LINK_LIMIT = 20;

  const handleUploadReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const targetExpenseId = type === "receipt" ? expense?.id : currentLinkedExpense?.id;
    if (!targetExpenseId) return;

    try {
      setIsSaving(true);
      await uploadReceiptToExpense(targetExpenseId, file);
      loadData(); // reload to show new receipt
    } catch (err: any) {
      alert("Failed to upload receipt: " + err.message);
    } finally {
      setIsSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteReceipt = async (receiptId: number) => {
    if (!confirm("Are you sure? Deleting a receipt completely removes the physical file from the system and cannot be undone.")) return;
    try {
      setIsSaving(true);
      await deleteReceipt(receiptId);
      loadData(); // reload
    } catch (err: any) {
      alert("Failed to delete receipt: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const currentLinkedExpense = type === "transaction" && confirmedExpenses.length > 0 ? confirmedExpenses[activeLinkedIdx] : null;
  const currentLinkedTx = type === "receipt" && confirmedTransactions.length > 0 ? confirmedTransactions[activeLinkedIdx] : null;
  const totalLinked = type === "transaction" ? confirmedExpenses.length : confirmedTransactions.length;

  const isDeposit = type === "transaction" && tx && tx.amount > 0;

  const formatMoney = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  const expenseReceiptCount = expense?.receipts?.length ?? 0;
  const canAddMoreTransactions = !(expenseReceiptCount > 1 && confirmedTransactions.length >= 1);

  useEffect(() => {
    if (type && id) requestAnimationFrame(() => setIsVisible(true));
  }, [type, id]);

  useEffect(() => {
    if (!id || !type) return;
    loadData(true);
  }, [id, type]);

  useEffect(() => {
    setIsEditingLinked(false);
    if (type === "transaction" && confirmedExpenses[activeLinkedIdx]) {
      const e = confirmedExpenses[activeLinkedIdx];
      setLinkedForm({ vendor: e.vendor, description: e.description, amount: e.amount, tender: e.tender, notes: e.notes || '', chartAccountId: e.chartAccountId || '' });
    } else if (type === "receipt" && confirmedTransactions[activeLinkedIdx]) {
      const t = confirmedTransactions[activeLinkedIdx];
      setLinkedForm({ description: t.description, amount: t.amount, notes: t.notes || '', chartAccountId: t.chartAccountId || '' });
    }
  }, [activeLinkedIdx, confirmedExpenses, confirmedTransactions, type]);

  useEffect(() => {
    if (showLinkPanel) loadUnlinkedData();
  }, [linkSearch, linkStartDate, linkEndDate, linkPage, showLinkPanel]);

  const loadUnlinkedData = async () => {
    try {
      const rootAmount = type === "transaction" ? tx?.amount : expense?.amount;
      const rootDate = type === "transaction" ? tx?.date : expense?.timestamp;
      const data = await getUnlinkedItems({
        search: linkSearch,
        startDate: linkStartDate,
        endDate: linkEndDate,
        page: linkPage,
        limit: LINK_LIMIT,
        targetAmount: rootAmount ? Math.abs(rootAmount) : undefined,
        targetDate: rootDate ? new Date(rootDate).toISOString() : undefined
      });
      setUnlinked(data);
      const totals = type === "transaction" ? data.totalExpenses : data.totalTxs;
      setUnlinkedTotalPages(Math.ceil((totals || 0) / LINK_LIMIT));
    } catch (err) {
      console.error(err);
    }
  };

  const loadData = async (resetIdx = false) => {
    setIsLoading(true);
    if (resetIdx) setActiveLinkedIdx(0);
    setIsEditingRoot(false);
    setIsEditingLinked(false);
    setShowLinkPanel(false);

    let loadedDate = "";
    let loadedReview = "";
    try {
      const accs = await getChartAccounts();
      setAccounts(accs);

      if (type === "transaction") {
        const data = await getTransactionDetail(Number(id));
        loadedDate = data.transaction.date;
        loadedReview = data.transaction.reviewStatus;
        setTx(data.transaction);
        setRootForm({ description: data.transaction.description, amount: data.transaction.amount, notes: data.transaction.notes || '', chartAccountId: data.transaction.chartAccountId || '' });
        setConfirmedExpenses(data.confirmedExpenses);
        setSuggestedExpenses(data.suggestedExpenses);
        
        setActiveLinkedIdx(prev => {
          const maxIdx = Math.max(0, data.confirmedExpenses.length - 1);
          return Math.min(prev, maxIdx);
        });

      } else if (type === "receipt") {
        const data = await getExpenseDetail(Number(id));
        loadedDate = data.expense.timestamp;
        loadedReview = data.expense.reviewStatus || "";
        setExpense(data.expense);
        setRootForm({ vendor: data.expense.vendor, description: data.expense.description, amount: data.expense.amount, tender: data.expense.tender, notes: data.expense.notes || '', chartAccountId: data.expense.chartAccountId || '' });
        setConfirmedTransactions(data.confirmedTransactions);
        setSuggestedTransactions(data.suggestedTransactions);
        
        setActiveLinkedIdx(prev => {
          const maxIdx = Math.max(0, data.confirmedTransactions.length - 1);
          return Math.min(prev, maxIdx);
        });
      }

      // unlinked data loaded separately

      const settings = await getSettings();
      const targetDate: Date | null = loadedDate ? new Date(loadedDate) : null;
      let closed = false;
      if (targetDate && settings["BooksClosedDate"]) {
        const closedDate = new Date(settings["BooksClosedDate"]);
        targetDate.setHours(0, 0, 0, 0);
        closedDate.setHours(0, 0, 0, 0);
        closed = targetDate <= closedDate;
      }
      // Items awaiting review or already excluded are read-only here.
      if (loadedReview === 'PENDING' || loadedReview === 'IGNORED') closed = true;
      setIsClosed(closed);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose(), 300);
  };

  const handleSaveRoot = async () => {
    try {
      if (type === "transaction" && tx) {
        await updateTransaction(tx.id, { description: rootForm.description, amount: Number(rootForm.amount), notes: rootForm.notes, chartAccountId: rootForm.chartAccountId ? Number(rootForm.chartAccountId) : undefined });
      } else if (type === "receipt" && expense) {
        await updateExpense(expense.id, { vendor: rootForm.vendor, description: rootForm.description, amount: Number(rootForm.amount), tender: rootForm.tender, notes: rootForm.notes, chartAccountId: rootForm.chartAccountId ? Number(rootForm.chartAccountId) : undefined });
      }
      setIsEditingRoot(false);
      loadData();
    } catch { alert("Failed to save"); }
  };

  const handleSaveLinked = async () => {
    try {
      if (type === "transaction" && currentLinkedExpense) {
        await updateExpense(currentLinkedExpense.id, { vendor: linkedForm.vendor, description: linkedForm.description, amount: Number(linkedForm.amount), tender: linkedForm.tender, notes: linkedForm.notes, chartAccountId: linkedForm.chartAccountId ? Number(linkedForm.chartAccountId) : undefined });
      } else if (type === "receipt" && currentLinkedTx) {
        await updateTransaction(currentLinkedTx.id, { description: linkedForm.description, amount: Number(linkedForm.amount), notes: linkedForm.notes, chartAccountId: linkedForm.chartAccountId ? Number(linkedForm.chartAccountId) : undefined });
      }
      setIsEditingLinked(false);
      loadData();
    } catch { alert("Failed to save"); }
  };

  const handleDeleteRoot = async () => {
    if (!confirm("Are you sure you want to delete this? This cannot be undone.")) return;
    try {
      if (type === "transaction" && tx) await deleteTransaction(tx.id);
      else if (type === "receipt" && expense) await deleteExpense(expense.id);
      handleClose();
    } catch { alert("Failed to delete"); }
  };

  const handleDeleteLinked = async () => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    try {
      if (type === "transaction" && currentLinkedExpense) await deleteExpense(currentLinkedExpense.id);
      else if (type === "receipt" && currentLinkedTx) await deleteTransaction(currentLinkedTx.id);
      setActiveLinkedIdx(Math.max(0, activeLinkedIdx - 1));
      loadData();
    } catch { alert("Failed to delete"); }
  };

  const handleUnlinkLinked = async () => {
    if (!confirm("Remove this link?")) return;
    try {
      if (type === "transaction" && tx && currentLinkedExpense) await unlinkExpenseFromTransaction(currentLinkedExpense.id, tx.id);
      else if (type === "receipt" && expense && currentLinkedTx) await unlinkExpenseFromTransaction(expense.id, currentLinkedTx.id);
      setActiveLinkedIdx(Math.max(0, activeLinkedIdx - 1));
      loadData();
    } catch { alert("Failed to unlink"); }
  };

  const executeLink = async (expId: number, txId: number, overrideChartAccountId?: number, force: boolean = false) => {
    try {
      await linkExpenseToTransaction(expId, txId, overrideChartAccountId, force);
      setSelectedLinkId(null);
      setShowLinkPanel(false);
      setConflictModalData(null);
      setOverAllocatedModalData(null);
      loadData();
    } catch (err: any) {
      if (err.data?.error === "CATEGORY_MISMATCH") {
        setConflictModalData({
          expenseId: expId,
          transactionId: txId,
          txCategory: err.data.transactionCategory,
          expCategory: err.data.expenseCategory
        });
      } else if (err.data?.error === "OVER_ALLOCATED") {
        setOverAllocatedModalData({
          expenseId: expId,
          transactionId: txId,
          overrideChartAccountId,
          message: err.data.message || err.message
        });
      } else {
        alert(err.message || "Failed to link");
      }
    }
  };

  const executeCreateAndLink = async (payload: any, overrideChartAccountId?: number, force: boolean = false) => {
    try {
      if (overrideChartAccountId !== undefined) {
        payload.overrideChartAccountId = overrideChartAccountId;
      }
      if (force) {
        payload.force = true;
      }
      await createAndLink(payload);
      setConflictModalData(null);
      setOverAllocatedModalData(null);
      setShowCreateModal(false);
      loadData();
    } catch (err: any) {
      if (err.data?.error === "CATEGORY_MISMATCH") {
        setConflictModalData({
          isCreateMode: true,
          createPayload: payload,
          txCategory: err.data.transactionCategory,
          expCategory: err.data.expenseCategory
        });
      } else if (err.data?.error === "OVER_ALLOCATED") {
        setOverAllocatedModalData({
          isCreateMode: true,
          createPayload: payload,
          overrideChartAccountId,
          message: err.data.message || err.message
        });
      } else {
        alert(err.message || "Failed to create and link");
      }
    }
  };

  const handleLink = async () => {
    if (selectedLinkId === null) return;
    if (type === "transaction" && tx) await executeLink(selectedLinkId, tx.id);
    else if (expense) await executeLink(expense.id, selectedLinkId);
  };

  const handleMarkCash = async () => {
    if (!expense) return;
    try { await markExpenseAsCash(expense.id); loadData(); }
    catch { alert("Failed to mark as cash"); }
  };

  const handleApproveSuggestedExpense = async (expId: number) => {
    if (!tx) return;
    await executeLink(expId, tx.id);
  };

  const handleApproveSuggestedTx = async (txId: number) => {
    if (!expense) return;
    await executeLink(expense.id, txId);
  };

  const handleCreate = async () => {
    setIsSaving(true);
    try {
      if (type === "transaction" && tx) {
        const payload: any = { type: "transaction", targetId: tx.id, ...createForm, amount: Number(createForm.amount) };
        if (createForm.timestamp) payload.timestamp = new Date(createForm.timestamp).toISOString();
        if (createForm.chartAccountId) payload.chartAccountId = Number(createForm.chartAccountId);
        await executeCreateAndLink(payload);
      } else if (type === "receipt" && expense) {
        if (!canAddMoreTransactions) return alert("This expense has multiple receipt files and is already linked to a transaction.");
        const payload: any = { type: "receipt", targetId: expense.id, ...createForm, amount: Number(createForm.amount) };
        if (createForm.date) payload.date = new Date(createForm.date).toISOString();
        if (createForm.chartAccountId) payload.chartAccountId = Number(createForm.chartAccountId);
        await executeCreateAndLink(payload);
      }
      setCreateForm({});
    } finally { setIsSaving(false); }
  };

  const goToPrev = () => setActiveLinkedIdx(prev => Math.max(0, prev - 1));
  const goToNext = () => setActiveLinkedIdx(prev => Math.min(totalLinked - 1, prev + 1));

  const inputCls = "w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-white focus:outline-none focus:border-zinc-500 transition-colors";
  const labelCls = "block text-xs font-medium text-zinc-400 mb-1";
  const btnSmGray = "text-xs text-zinc-400 hover:text-zinc-200 transition";
  const btnSmBlue = "text-xs text-blue-400 hover:text-blue-300 transition";
  const btnSmGreen = "text-xs text-emerald-400 hover:text-emerald-300 transition";

  const CarouselNav = () => totalLinked > 1 ? (
    <div className="flex items-center justify-center gap-2 mb-4 py-2">
      <Button variant="ghost" onClick={goToPrev} disabled={activeLinkedIdx === 0} className="!p-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition">‹</Button>
      <span className="text-xs text-zinc-400 font-medium px-1">{activeLinkedIdx + 1} / {totalLinked}</span>
      {Array.from({ length: totalLinked }).map((_, i) => (
        <button key={i} onClick={() => { setActiveLinkedIdx(i); setIsEditingLinked(false); }} className={`w-2 h-2 rounded-full transition ${i === activeLinkedIdx ? 'bg-white' : 'bg-zinc-600 hover:bg-zinc-400'}`} />
      ))}
      <Button variant="ghost" onClick={goToNext} disabled={activeLinkedIdx === totalLinked - 1} className="!p-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition">›</Button>
    </div>
  ) : null;

  const itemReviewStatus = type === "transaction" ? tx?.reviewStatus : expense?.reviewStatus;
  const itemAwaitingReview = itemReviewStatus === 'PENDING';
  const canExclude = !isLoading && !isClosed && (type === "transaction" ? !!tx : !!expense);

  if (!type || !id) return null;

  return ReactDOM.createPortal(
    <>
      <div className={`fixed inset-0 z-[60] bg-black/60 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`} onClick={handleClose} />
      <div className={`fixed inset-y-0 right-0 z-[70] w-full lg:w-[85vw] lg:max-w-5xl bg-zinc-950/90 backdrop-blur-3xl border-l border-white/10 flex flex-col shadow-2xl transform transition-transform duration-300 ease-out ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <h2 className="text-lg font-bold text-white">{type === "transaction" ? "Transaction Details" : "Expense Details"}</h2>
          <Button variant="ghost" onClick={handleClose} className="!p-0 w-8 h-8 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 text-zinc-400">Loading…</div>
          ) : (
            <>
              {itemAwaitingReview && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 p-4 rounded-2xl text-sm">
                  <span className="font-bold block mb-1">Needs Review</span>
                  This item falls in a closed accounting period. It must be allowed or excluded from the Review Queue before it can be edited or linked.
                </div>
              )}
              {isClosed && !itemAwaitingReview && itemReviewStatus !== 'IGNORED' && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 p-4 rounded-2xl text-sm">
                  <span className="font-bold block mb-1">Period Closed</span>
                  This item falls within a locked accounting period, so it can't be changed. Unlock the books under Lock Books if you need to adjust it.
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* EXPENSE COLUMN */}
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 backdrop-blur-md shadow-lg flex flex-col">
                  {isDeposit ? (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-400 text-center h-full">
                      <svg className="w-12 h-12 mb-3 opacity-20 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <h3 className="text-lg font-bold text-emerald-400/50 mb-2">Income Categorization</h3>
                      <p className="max-w-xs text-sm">Deposits don't require expense receipts. Edit the transaction details to assign a Revenue Account.</p>
                      {!isEditingRoot && !tx?.chartAccountId && (
                        <Button variant="primary" onClick={() => setIsEditingRoot(true)} className="mt-4">Categorize Deposit</Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-zinc-800 pb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          <h2 className="text-xl font-bold">Expense Details</h2>
                          {(() => {
                            const item = type === "receipt" ? expense : currentLinkedExpense;
                            if (!item) return null;
                            return <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${item.isManual ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}`}>{item.isManual ? "Manual" : "AI Extracted"}</span>
                          })()}
                          {type === "transaction" && totalLinked > 1 && <span className="text-xs text-zinc-400 ml-1 whitespace-nowrap">{activeLinkedIdx + 1} of {totalLinked}</span>}
                        </div>
                        {type === "receipt" && expense && (
                          isEditingRoot ? (
                            <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingRoot(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveRoot} >Save</Button></div>
                          ) : (
                            !isClosed && (<div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingRoot(true)} className={btnSmGreen}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteRoot} >Delete</Button></div>)
                          )
                        )}
                        {type === "transaction" && currentLinkedExpense && (
                          isEditingLinked ? (
                            <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingLinked(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveLinked} >Save</Button></div>
                          ) : (
                            !isClosed && (<div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingLinked(true)} className={btnSmGreen}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteLinked} >Delete</Button><Button variant="secondary" size="sm" onClick={handleUnlinkLinked} >Unlink</Button></div>)
                          )
                        )}
                      </div>

                      {totalLinked > 1 && <CarouselNav />}

                      {(() => {
                        const item = type === "receipt" ? expense : currentLinkedExpense;
                        const form = type === "receipt" ? rootForm : linkedForm;
                        const setForm = type === "receipt" ? setRootForm : setLinkedForm;
                        const editing = type === "receipt" ? isEditingRoot : isEditingLinked;
                        const isLinked = type === "receipt" ? currentLinkedTx !== null : (currentLinkedExpense !== null && tx !== null);
                        if (!item) return <div className="py-12 text-zinc-400 text-center">No Expense Linked</div>;

                        const e = item as Expense;
                        return (
                          <div className="space-y-4 flex-1">
                            <div><label className={labelCls}>Amount</label>{editing ? <Input type="number" step="0.01" value={form.amount} onChange={ev => setForm({ ...form, amount: ev.target.value })} /> : <p className="text-xl font-semibold">{formatMoney(e.amount)}</p>}</div>
                            <div><label className={labelCls}>Vendor</label>{editing ? <Input type="text" value={form.vendor} onChange={ev => setForm({ ...form, vendor: ev.target.value })} /> : <p className="text-zinc-300">{e.vendor || "Unknown"}</p>}</div>
                            <div><label className={labelCls}>Description</label>{editing ? <Input type="text" value={form.description} onChange={ev => setForm({ ...form, description: ev.target.value })} /> : <p className="text-zinc-300">{e.description}</p>}</div>
                            <div className="flex gap-6">
                              <div><label className={labelCls}>Date</label><p className="text-zinc-300">{new Date(e.timestamp).toLocaleDateString()}</p></div>
                              <div><label className={labelCls}>Tender</label>{editing ? <Input type="text" value={form.tender} onChange={ev => setForm({ ...form, tender: ev.target.value })} /> : <p className="text-zinc-300 uppercase">{e.tender}</p>}</div>
                            </div>
                            <div>
                              <label className={labelCls}>Category</label>
                              {editing ? (
                                <Select value={form.chartAccountId || ''} onChange={ev => setForm({ ...form, chartAccountId: ev.target.value })}>
                                  <option value="">None</option>
                                  {accounts.filter(a => a.type === 'EXPENSE').map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                                </Select>
                              ) : e.chartAccount ? (
                                <p className="text-zinc-300 text-sm">{e.chartAccount.code} — {e.chartAccount.name}</p>
                              ) : <p className="text-zinc-400 italic text-sm">Uncategorized</p>}
                            </div>
                            <div><label className={labelCls}>Notes</label>{editing ? <textarea className={inputCls} rows={3} value={form.notes} onChange={ev => setForm({ ...form, notes: ev.target.value })} /> : <p className="text-zinc-300 whitespace-pre-wrap">{e.notes || <span className="text-zinc-400 italic">No notes</span>}</p>}</div>
                            
                            <div className="pt-2 flex flex-col gap-2">
                              {e.receipts && e.receipts.length > 0 ? (
                                <div className="flex gap-2">
                                  <Button variant="ghost" onClick={() => { setShowReceiptModal(true); setActiveReceiptIdx(0); }} className="flex-1 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center gap-2 text-sm">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                    View Receipt
                                  </Button>
                                  <Button variant="ghost" onClick={() => fileInputRef.current?.click()} className="bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center text-sm px-3" title="Upload another receipt">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                  </Button>
                                </div>
                              ) : (
                                <Button variant="ghost" onClick={() => fileInputRef.current?.click()} className="w-full px-4 py-2 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center gap-2 text-sm">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                  Upload Receipt
                                </Button>
                              )}
                              <input type="file" ref={fileInputRef} className="hidden" accept=".jpg,.jpeg,.png,.pdf,.heic" onChange={handleUploadReceipt} />
                              {!editing && e.tender !== "cash" && !isLinked && (
                                <Button variant="ghost" size="sm"  onClick={handleMarkCash} >Mark as Cash Expense (No Tx Needed)</Button>
                              )}
                              {!editing && e.tender === "cash" && (
                                <Button variant="ghost" onClick={() => setIsEditingLinked(true)} className="text-xs text-zinc-400 hover:text-white transition">Change payment method</Button>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {type === "transaction" && !isClosed && (
                        <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-wrap gap-2">
                          <Button variant="secondary" size="sm" onClick={() => { setShowLinkPanel(p => !p); setSelectedLinkId(null); }}>Link Existing Expense</Button>
                          <Button variant="ghost" onClick={() => { setShowCreateModal(true); setCreateForm({ timestamp: '', vendor: '', description: '', amount: '', tender: 'card' }); }} className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md text-white transition">Create New Expense</Button>
                        </div>
                      )}

                      {type === "receipt" && expense && confirmedTransactions.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-zinc-800">
                          {(() => {
                            const allocated = confirmedTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
                            const total = expense.amount;
                            const remaining = total - allocated;
                            const pct = Math.min(100, Math.max(0, (allocated / total) * 100));
                            return (
                              <div className="space-y-2">
                                <div className="flex justify-between text-xs font-semibold">
                                  <span className="text-zinc-400">Reconciled: {formatMoney(allocated)}</span>
                                  <span className="text-white">{formatMoney(total)} Total</span>
                                </div>
                                <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                                  <div className={`h-full transition-all ${tx?.reconciliationStatus === "OVER_ALLOCATED" ? "bg-red-500" : tx?.reconciliationStatus === "PARTIALLY_MATCHED" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                                </div>
                                {remaining > 0.01 && (
                                  <p className="text-amber-500 text-xs font-medium">⚠️ {formatMoney(remaining)} remaining to allocate.</p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {/* BANK TRANSACTION COLUMN */}
                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 backdrop-blur-md shadow-lg flex flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-zinc-800 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <svg className="w-5 h-5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      <h2 className="text-xl font-bold">Bank Transaction</h2>
                      {(() => {
                        const item = type === "transaction" ? tx : currentLinkedTx;
                        if (!item) return null;
                        const isManual = item.isManual || (item.fitId && item.fitId.startsWith("MANUAL-"));
                        return <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${isManual ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}`}>{isManual ? "Manual" : "Bank Import"}</span>
                      })()}
                    </div>
                    {type === "transaction" && tx && (
                      isEditingRoot ? (
                        <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingRoot(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveRoot} >Save</Button></div>
                      ) : (
                        !isClosed && (<div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingRoot(true)} className={btnSmBlue}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteRoot} >Delete</Button></div>)
                      )
                    )}
                    {type === "receipt" && currentLinkedTx && (
                      isEditingLinked ? (
                        <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingLinked(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveLinked} >Save</Button></div>
                      ) : (
                        !isClosed && (<div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingLinked(true)} className={btnSmBlue}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteLinked} >Delete</Button><Button variant="secondary" size="sm" onClick={handleUnlinkLinked} >Unlink</Button></div>)
                      )
                    )}
                  </div>

                  {(() => {
                    const item = type === "transaction" ? tx : currentLinkedTx;
                    const form = type === "transaction" ? rootForm : linkedForm;
                    const setForm = type === "transaction" ? setRootForm : setLinkedForm;
                    const editing = type === "transaction" ? isEditingRoot : isEditingLinked;
                    if (!item) return <div className="py-12 text-zinc-400 text-center">No Bank Transaction Linked</div>;

                    return (
                      <div className="space-y-4 flex-1">
                        <div><label className={labelCls}>Amount</label>{editing ? <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /> : <p className="text-xl font-semibold">{formatMoney(item.amount)}</p>}</div>
                        <div><label className={labelCls}>Description</label>{editing ? <Input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /> : <p className="text-zinc-300">{item.description}</p>}</div>
                        <div><label className={labelCls}>Date</label><p className="text-zinc-300">{new Date(item.date).toLocaleDateString()}</p></div>
                        <div><label className={labelCls}>Type</label><p className="text-zinc-300">{item.transactionType}</p></div>
                        {(() => {
                          const isOutgoingTx = item.transactionType === 'DEBIT' || item.transactionType === 'PAYMENT';
                          const filteredTxAccounts = accounts.filter(a => isOutgoingTx ? a.type === 'EXPENSE' : a.type === 'REVENUE');
                          return (
                            <div>
                              <label className={labelCls}>Category</label>
                              {editing ? (
                                <Select value={form.chartAccountId || ''} onChange={e => setForm({ ...form, chartAccountId: e.target.value })}>
                                  <option value="">None</option>
                                  {(filteredTxAccounts.length > 0 ? filteredTxAccounts : accounts).map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                                </Select>
                              ) : item.chartAccount ? (
                                <p className="text-zinc-300 text-sm">{item.chartAccount.code} — {item.chartAccount.name}</p>
                              ) : <p className="text-zinc-400 italic text-sm">Uncategorized</p>}
                            </div>
                          );
                        })()}
                        <div><label className={labelCls}>Notes</label>{editing ? <textarea className={inputCls} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /> : <p className="text-zinc-300 whitespace-pre-wrap">{item.notes || <span className="text-zinc-400 italic">No notes</span>}</p>}</div>
                      </div>
                    );
                  })()}

                  {type === "receipt" && !isClosed && (
                    <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => { setShowLinkPanel(p => !p); setSelectedLinkId(null); }}>Link Existing Transaction</Button>
                      <Button variant="ghost" onClick={() => { setShowCreateModal(true); setCreateForm({ date: '', description: '', amount: '', transactionType: 'DEBIT' }); }} className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md text-white transition" disabled={!canAddMoreTransactions}>Create New Transaction</Button>
                    </div>
                  )}

                  {type === "transaction" && tx && confirmedExpenses.length > 0 && (
                    <div className="mt-5 pt-4 border-t border-zinc-800">
                      {(() => {
                        const allocated = confirmedExpenses.reduce((sum, e) => sum + e.amount, 0);
                        const total = Math.abs(tx.amount);
                        const remaining = total - allocated;
                        const pct = Math.min(100, Math.max(0, (allocated / total) * 100));
                        return (
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs font-semibold">
                              <span className="text-zinc-400">Reconciled: {formatMoney(allocated)}</span>
                              <span className="text-white">{formatMoney(total)} Total</span>
                            </div>
                            <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                              <div className={`h-full transition-all ${expense?.reconciliationStatus === "OVER_ALLOCATED" ? "bg-red-500" : expense?.reconciliationStatus === "PARTIALLY_MATCHED" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                            </div>
                            {remaining > 0.01 && (
                              <p className="text-amber-500 text-xs font-medium">⚠️ {formatMoney(remaining)} remaining to allocate.</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

              </div>

              {/* SUGGESTED MATCHES */}
              {type === "transaction" && suggestedExpenses.length > 0 && (
                <div className="border border-blue-900/50 bg-blue-900/10 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    <h3 className="text-lg font-bold text-blue-400">Suggested Match{suggestedExpenses.length > 1 ? 'es' : ''} Found</h3>
                  </div>
                  <p className="text-zinc-300 text-sm mb-4">Our scoring system found {suggestedExpenses.length > 1 ? 'these likely matches' : 'a likely match'} for this transaction. Review and approve if correct.</p>
                  <div className="space-y-3">
                    {suggestedExpenses.map(e => (
                      <div key={e.id} className="border border-blue-900/30 bg-black rounded-lg p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                        <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1 flex-1 min-w-0">
                          <div><span className="text-zinc-400">Amount:</span> <span className="font-bold">{formatMoney(e.amount)}</span></div>
                          <div><span className="text-zinc-400">Date:</span> {new Date(e.timestamp).toLocaleDateString()}</div>
                          <div className="col-span-2 truncate"><span className="text-zinc-400">Vendor:</span> {e.vendor}</div>
                          <div className="col-span-2 truncate text-zinc-400">{e.description}</div>
                        </div>
                        <Button variant="ghost" onClick={() => handleApproveSuggestedExpense(e.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition text-sm font-bold shrink-0">Approve Match</Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {type === "receipt" && suggestedTransactions.length > 0 && (
                <div className="border border-blue-900/50 bg-blue-900/10 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    <h3 className="text-lg font-bold text-blue-400">Suggested Match{suggestedTransactions.length > 1 ? 'es' : ''} Found</h3>
                  </div>
                  <p className="text-zinc-300 text-sm mb-4">Our scoring system found {suggestedTransactions.length > 1 ? 'these likely matches' : 'a likely match'} for this expense.</p>
                  <div className="space-y-3">
                    {suggestedTransactions.map(t => (
                      <div key={t.id} className="border border-blue-900/30 bg-black rounded-lg p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                        <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1 flex-1 min-w-0">
                          <div><span className="text-zinc-400">Amount:</span> <span className="font-bold">{formatMoney(t.amount)}</span></div>
                          <div><span className="text-zinc-400">Date:</span> {new Date(t.date).toLocaleDateString()}</div>
                          <div className="col-span-2 truncate"><span className="text-zinc-400">Desc:</span> {t.description}</div>
                        </div>
                        <Button variant="ghost" onClick={() => handleApproveSuggestedTx(t.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition text-sm font-bold shrink-0">Approve Match</Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LINK PICKER PANEL */}
              {showLinkPanel && (
                <div className="border border-white/5 bg-white/[0.02] rounded-2xl p-6 backdrop-blur-md mt-4">
                  <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-4 border-b border-zinc-800 pb-2 gap-3">
                    <h2 className="text-lg font-bold">Link Existing {type === "transaction" ? "Expense" : "Transaction"}</h2>
                    <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400 font-medium uppercase tracking-wider">From</span>
                        <Input type="date" value={linkStartDate} onChange={(e) => { setLinkStartDate(e.target.value); setLinkPage(1); }} className="text-sm py-1.5 w-36" title="Start Date" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400 font-medium uppercase tracking-wider">To</span>
                        <Input type="date" value={linkEndDate} onChange={(e) => { setLinkEndDate(e.target.value); setLinkPage(1); }} className="text-sm py-1.5 w-36" title="End Date" />
                      </div>
                      <Input type="text" placeholder="Search Amount / Text..." value={linkSearch} onChange={(e) => { setLinkSearch(e.target.value); setLinkPage(1); }} className="w-full sm:w-48 text-sm py-1.5 flex-1" />
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto border border-zinc-800 rounded-md bg-zinc-900 mb-4">
                    {((type === "transaction" && unlinked.expenses.length === 0) || (type === "receipt" && unlinked.transactions.length === 0)) ? (
                      <div className="p-8 text-center text-zinc-400">No unlinked items available.</div>
                    ) : (
                      <ul className="divide-y divide-zinc-800">
                        {type === "transaction" && unlinked.expenses.map(e => (
                          <li key={e.id}>
  <Card active={selectedLinkId === e.id} onClick={() => setSelectedLinkId(e.id)} className="!flex-col !items-start gap-1">
    <div className="w-full flex justify-between items-center">
      <span className="font-semibold text-white">{formatMoney(e.amount)}</span>
      <span className="text-xs text-zinc-400">{new Date(e.timestamp).toLocaleDateString()}</span>
    </div>
    <div className="text-sm text-zinc-400 truncate w-full">{e.vendor} — {e.description}</div>
  </Card>
</li>
                        ))}
                        {type === "receipt" && unlinked.transactions.map(t => (
                          <li key={t.id}>
  <Card active={selectedLinkId === t.id} onClick={() => setSelectedLinkId(t.id)} className="!flex-col !items-start gap-1">
    <div className="w-full flex justify-between items-center">
      <span className="font-semibold text-white">{formatMoney(t.amount)}</span>
      <span className="text-xs text-zinc-400">{new Date(t.date).toLocaleDateString()}</span>
    </div>
    <div className="text-sm text-zinc-400 truncate w-full">{t.description}</div>
  </Card>
</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mb-4">
                    <Pagination currentPage={linkPage} totalPages={unlinkedTotalPages} onPageChange={setLinkPage} />
                  </div>
                  {selectedLinkId !== null && (
                    <div className="flex justify-end gap-3"><Button variant="ghost" onClick={() => { setShowLinkPanel(false); setSelectedLinkId(null); }}>Cancel</Button><Button variant="info" onClick={handleLink}>Confirm Link</Button></div>
                  )}
                </div>
              )}

              {canExclude && (
                <div className="border border-red-500/10 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 bg-red-500/[0.03]">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-300">Exclude from books</p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      For duplicates, personal spending or data errors only. Removes this item (and anything linked to it) from reports and totals.
                    </p>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => setShowExcludeModal(true)}>Exclude…</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* RECEIPT IMAGE MODAL */}
      {showReceiptModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-4xl w-full flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-zinc-700 flex justify-between items-center">
              <h3 className="font-bold text-lg">Physical Receipt</h3>
              <Button variant="ghost" onClick={() => setShowReceiptModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </Button>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-zinc-950 min-h-[50vh]">
              {(() => {
                const receipts = (type === "receipt" ? expense : currentLinkedExpense)?.receipts;
                return receipts && receipts.length > 0 ? (
                    <div className="w-full flex flex-col items-center py-4 relative">
                      {receipts.length > 1 && (
                        <div className="flex w-full justify-between px-4 absolute top-1/2 -translate-y-1/2 z-10">
                          <Button variant="ghost" className="bg-black/50 text-white rounded-full p-2 hover:bg-black/70" onClick={() => setActiveReceiptIdx(Math.max(0, activeReceiptIdx - 1))} disabled={activeReceiptIdx === 0}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                          </Button>
                          <Button variant="ghost" className="bg-black/50 text-white rounded-full p-2 hover:bg-black/70" onClick={() => setActiveReceiptIdx(Math.min(receipts.length - 1, activeReceiptIdx + 1))} disabled={activeReceiptIdx === receipts.length - 1}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                          </Button>
                        </div>
                      )}
                      
                      {(() => {
                        const receipt = receipts[activeReceiptIdx];
                        if (!receipt) {
                          if (activeReceiptIdx > 0) setTimeout(() => setActiveReceiptIdx(0), 0);
                          return null;
                        }
                        const filename = receipt.documentUri.split('/').pop();
                        const fileUrl = `/api/images/${filename}`;
                        const isPdf = receipt.fileExt.toLowerCase() === '.pdf';
                        return (
                          <div key={receipt.id} className="w-full flex flex-col items-center">
                            {isPdf ? (
                              <iframe src={fileUrl} className="w-full h-[75vh] rounded-md bg-white border border-zinc-700" title={`Receipt ${receipt.id}`} />
                            ) : (
                              <img src={fileUrl} alt={`Receipt ${receipt.id}`} className="max-w-full max-h-[75vh] object-contain rounded-md border border-zinc-700" />
                            )}
                            <p className="text-zinc-400 text-xs mt-4 mb-2">{filename}</p>
                            {receipts.length > 1 && (
                              <p className="text-zinc-500 text-xs font-semibold">Image {activeReceiptIdx + 1} of {receipts.length}</p>
                            )}
                            <div className="mt-4">
                              <Button variant="danger" size="sm" onClick={() => handleDeleteReceipt(receipt.id)} disabled={isSaving}>
                                {isSaving ? "Deleting..." : "Delete Receipt"}
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-400 min-h-[50vh]">
                    <p>No physical receipt attached.</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* CREATE & LINK MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-lg">Create & Link {type === "transaction" ? "Expense" : "Transaction"}</h3>
              <Button variant="ghost" onClick={() => setShowCreateModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </Button>
            </div>
            <div className="p-5 space-y-4">
              {type === "transaction" ? (
                <CreateExpenseForm form={createForm} setForm={setCreateForm} accounts={accounts} />
              ) : (
                <CreateTransactionForm form={createForm} setForm={setCreateForm} accounts={accounts} />
              )}
            </div>
            <div className="p-5 border-t border-zinc-800 flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button variant="ghost" onClick={handleCreate} disabled={isSaving} className="px-5 py-2 bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {isSaving ? 'Saving…' : 'Create & Link'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {type && id && (
        <ExcludeItemModal
          isOpen={showExcludeModal}
          onClose={() => setShowExcludeModal(false)}
          itemType={type === "transaction" ? "transaction" : "expense"}
          itemId={Number(id)}
          onExcluded={() => { setShowExcludeModal(false); handleClose(); }}
        />
      )}

      {conflictModalData && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="font-bold text-lg text-white">Category Mismatch</h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">The items you are trying to link have conflicting categories. Which category should both items use?</p>
            </div>
            <div className="p-5 space-y-3">
              <button 
                className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors"
                onClick={() => {
                  if (conflictModalData.isCreateMode) {
                    executeCreateAndLink(conflictModalData.createPayload, conflictModalData.txCategory.id);
                  } else {
                    executeLink(conflictModalData.expenseId, conflictModalData.transactionId, conflictModalData.txCategory.id);
                  }
                }}
              >
                <div className="font-medium text-white">{conflictModalData.txCategory.code} — {conflictModalData.txCategory.name}</div>
                <div className="text-xs text-zinc-400 mt-1">Use the Bank Transaction's category</div>
              </button>
              
              <button 
                className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors"
                onClick={() => {
                  if (conflictModalData.isCreateMode) {
                    executeCreateAndLink(conflictModalData.createPayload, conflictModalData.expCategory.id);
                  } else {
                    executeLink(conflictModalData.expenseId, conflictModalData.transactionId, conflictModalData.expCategory.id);
                  }
                }}
              >
                <div className="font-medium text-white">{conflictModalData.expCategory.code} — {conflictModalData.expCategory.name}</div>
                <div className="text-xs text-zinc-400 mt-1">Use the Expense's category</div>
              </button>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end bg-zinc-800/50">
              <Button variant="ghost" onClick={() => setConflictModalData(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {overAllocatedModalData && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="font-bold text-lg text-white">Amount Mismatch</h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{overAllocatedModalData.message}</p>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-800/50">
              <Button variant="ghost" onClick={() => setOverAllocatedModalData(null)}>Cancel</Button>
              <Button 
                variant="primary" 
                onClick={() => {
                  if (overAllocatedModalData.isCreateMode) {
                    executeCreateAndLink(overAllocatedModalData.createPayload, overAllocatedModalData.overrideChartAccountId, true);
                  } else {
                    executeLink(overAllocatedModalData.expenseId, overAllocatedModalData.transactionId, overAllocatedModalData.overrideChartAccountId, true);
                  }
                }}
              >
                Link Anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
