import { useEffect, useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import ReactDOM from "react-dom";
import {
  getTransactionDetail, getExpenseDetail,
  updateTransaction, updateExpense,
  deleteTransaction, deleteExpense,
  markExpenseAsCash, getUnlinkedItems,
  linkExpenseToTransaction, unlinkExpenseFromTransaction,
  createExpense, createTransaction,
  getSettings, getChartAccounts
} from "../services/api";
import type { BankTransaction, Expense, ChartAccount } from "../types/models";

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
  const [isLoading, setIsLoading] = useState(true);
  const [isClosed, setIsClosed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

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
    loadData();
  }, [id, type]);

  useEffect(() => {
    setIsEditingLinked(false);
    if (type === "transaction" && confirmedExpenses[activeLinkedIdx]) {
      const e = confirmedExpenses[activeLinkedIdx];
      setLinkedForm({ vendor: e.vendor, description: e.description, amount: e.amount, tender: e.tender, notes: e.notes || '' });
    } else if (type === "receipt" && confirmedTransactions[activeLinkedIdx]) {
      const t = confirmedTransactions[activeLinkedIdx];
      setLinkedForm({ description: t.description, amount: t.amount, notes: t.notes || '' });
    }
  }, [activeLinkedIdx, confirmedExpenses, confirmedTransactions, type]);

  const loadData = async () => {
    setIsLoading(true);
    setActiveLinkedIdx(0);
    setIsEditingRoot(false);
    setIsEditingLinked(false);
    setShowLinkPanel(false);

    try {
      const accs = await getChartAccounts();
      setAccounts(accs);

      if (type === "transaction") {
        const data = await getTransactionDetail(Number(id));
        setTx(data.transaction);
        setRootForm({ description: data.transaction.description, amount: data.transaction.amount, notes: data.transaction.notes || '', chartAccountId: data.transaction.chartAccountId || '' });
        setConfirmedExpenses(data.confirmedExpenses);
        setSuggestedExpenses(data.suggestedExpenses);
        if (data.confirmedExpenses.length > 0) {
          const e = data.confirmedExpenses[0];
          setLinkedForm({ vendor: e.vendor, description: e.description, amount: e.amount, tender: e.tender, notes: e.notes || '' });
        }
      } else if (type === "receipt") {
        const data = await getExpenseDetail(Number(id));
        setExpense(data.expense);
        setRootForm({ vendor: data.expense.vendor, description: data.expense.description, amount: data.expense.amount, tender: data.expense.tender, notes: data.expense.notes || '' });
        setConfirmedTransactions(data.confirmedTransactions);
        setSuggestedTransactions(data.suggestedTransactions);
        if (data.confirmedTransactions.length > 0) {
          const t = data.confirmedTransactions[0];
          setLinkedForm({ description: t.description, amount: t.amount, notes: t.notes || '' });
        }
      }

      const unlinkedData = await getUnlinkedItems();
      setUnlinked(unlinkedData);

      const settings = await getSettings();
      let targetDate: Date | null = null;
      if (type === "transaction") {
        const txData = await getTransactionDetail(Number(id));
        targetDate = new Date(txData.transaction.date);
      } else if (type === "receipt") {
        const exData = await getExpenseDetail(Number(id));
        targetDate = new Date(exData.expense.timestamp);
      }
      if (targetDate && settings["BooksClosedDate"]) {
        const closedDate = new Date(settings["BooksClosedDate"]);
        targetDate.setHours(0, 0, 0, 0);
        closedDate.setHours(0, 0, 0, 0);
        setIsClosed(targetDate <= closedDate);
      } else {
        setIsClosed(false);
      }
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
        await updateExpense(expense.id, { vendor: rootForm.vendor, description: rootForm.description, amount: Number(rootForm.amount), tender: rootForm.tender, notes: rootForm.notes });
      }
      setIsEditingRoot(false);
      loadData();
    } catch { alert("Failed to save"); }
  };

  const handleSaveLinked = async () => {
    try {
      if (type === "transaction" && currentLinkedExpense) {
        await updateExpense(currentLinkedExpense.id, { vendor: linkedForm.vendor, description: linkedForm.description, amount: Number(linkedForm.amount), tender: linkedForm.tender, notes: linkedForm.notes });
      } else if (type === "receipt" && currentLinkedTx) {
        await updateTransaction(currentLinkedTx.id, { description: linkedForm.description, amount: Number(linkedForm.amount), notes: linkedForm.notes });
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

  const handleLink = async () => {
    if (selectedLinkId === null) return;
    try {
      if (type === "transaction" && tx) await linkExpenseToTransaction(selectedLinkId, tx.id);
      else if (expense) await linkExpenseToTransaction(expense.id, selectedLinkId);
      setSelectedLinkId(null);
      setShowLinkPanel(false);
      loadData();
    } catch (err: any) { alert(err.message || "Failed to link"); }
  };

  const handleMarkCash = async () => {
    if (!expense) return;
    try { await markExpenseAsCash(expense.id); loadData(); }
    catch { alert("Failed to mark as cash"); }
  };

  const handleApproveSuggestedExpense = async (expId: number) => {
    if (!tx) return;
    try { await linkExpenseToTransaction(expId, tx.id); loadData(); }
    catch (err: any) { alert(err.message || "Failed to approve"); }
  };

  const handleApproveSuggestedTx = async (txId: number) => {
    if (!expense) return;
    try { await linkExpenseToTransaction(expense.id, txId); loadData(); }
    catch (err: any) { alert(err.message || "Failed to approve"); }
  };

  const handleCreate = async () => {
    setIsSaving(true);
    try {
      if (type === "transaction" && tx) {
        const payload: any = { ...createForm, amount: Number(createForm.amount) };
        if (createForm.timestamp) payload.timestamp = new Date(createForm.timestamp).toISOString();
        const newExp = await createExpense(payload);
        await linkExpenseToTransaction(newExp.id, tx.id);
      } else if (type === "receipt" && expense) {
        if (!canAddMoreTransactions) return alert("This expense has multiple receipt files and is already linked to a transaction.");
        const payload: any = { ...createForm, amount: Number(createForm.amount) };
        if (createForm.date) payload.date = new Date(createForm.date).toISOString();
        const newTx = await createTransaction(payload);
        await linkExpenseToTransaction(expense.id, newTx.id);
      }
      setShowCreateModal(false);
      setCreateForm({});
      loadData();
    } catch (err: any) { alert(err.message || "Failed to create and link"); }
    finally { setIsSaving(false); }
  };

  const goToPrev = () => setActiveLinkedIdx(prev => Math.max(0, prev - 1));
  const goToNext = () => setActiveLinkedIdx(prev => Math.min(totalLinked - 1, prev + 1));

  const inputCls = "w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-white focus:outline-none focus:border-zinc-500 transition-colors";
  const labelCls = "block text-xs font-medium text-zinc-500 mb-1";
  const btnSmGray = "text-xs text-zinc-400 hover:text-zinc-200 transition";
  const btnSmBlue = "text-xs text-blue-400 hover:text-blue-300 transition";
  const btnSmGreen = "text-xs text-emerald-400 hover:text-emerald-300 transition";

  const CarouselNav = () => totalLinked > 1 ? (
    <div className="flex items-center justify-center gap-2 mb-4 py-2">
      <Button variant="ghost" onClick={goToPrev} disabled={activeLinkedIdx === 0} className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition">‹</Button>
      <span className="text-xs text-zinc-500 font-medium px-1">{activeLinkedIdx + 1} / {totalLinked}</span>
      {Array.from({ length: totalLinked }).map((_, i) => (
        <button key={i} onClick={() => { setActiveLinkedIdx(i); setIsEditingLinked(false); }} className={`w-2 h-2 rounded-full transition ${i === activeLinkedIdx ? 'bg-white' : 'bg-zinc-600 hover:bg-zinc-400'}`} />
      ))}
      <Button variant="ghost" onClick={goToNext} disabled={activeLinkedIdx === totalLinked - 1} className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition">›</Button>
    </div>
  ) : null;

  if (!type || !id) return null;

  return ReactDOM.createPortal(
    <>
      <div className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`} onClick={handleClose} />
      <div className={`fixed inset-y-0 right-0 z-50 w-full lg:w-[85vw] lg:max-w-5xl bg-zinc-900 border-l border-zinc-800 flex flex-col shadow-2xl transform transition-transform duration-300 ease-out ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <h2 className="text-lg font-bold text-white">{type === "transaction" ? "Transaction Details" : "Expense Details"}</h2>
          <Button variant="ghost" onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 text-zinc-500">Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* LEFT COLUMN */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      <h2 className="text-xl font-bold">Bank Transaction</h2>
                    </div>
                    {type === "transaction" && tx && (
                      isEditingRoot ? (
                        <div className="flex gap-3"><Button variant="ghost" onClick={() => setIsEditingRoot(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveRoot} >Save</Button></div>
                      ) : (
                        !isClosed && (<div className="flex gap-3"><Button variant="ghost" onClick={() => setIsEditingRoot(true)} className={btnSmBlue}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteRoot} >Delete</Button></div>)
                      )
                    )}
                    {type === "receipt" && currentLinkedTx && (
                      isEditingLinked ? (
                        <div className="flex gap-3"><Button variant="ghost" onClick={() => setIsEditingLinked(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveLinked} >Save</Button></div>
                      ) : (
                        !isClosed && (<div className="flex gap-3"><Button variant="ghost" onClick={() => setIsEditingLinked(true)} className={btnSmBlue}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteLinked} >Delete</Button><Button variant="secondary" size="sm" onClick={handleUnlinkLinked} >Unlink</Button></div>)
                      )
                    )}
                  </div>

                  {(() => {
                    const item = type === "transaction" ? tx : currentLinkedTx;
                    const form = type === "transaction" ? rootForm : linkedForm;
                    const setForm = type === "transaction" ? setRootForm : setLinkedForm;
                    const editing = type === "transaction" ? isEditingRoot : isEditingLinked;
                    if (!item) return <div className="py-12 text-zinc-500 text-center">No Bank Transaction Linked</div>;

                    return (
                      <div className="space-y-4 flex-1">
                        <div><label className={labelCls}>Amount</label>{editing ? <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /> : <p className="text-xl font-semibold">{formatMoney(item.amount)}</p>}</div>
                        <div><label className={labelCls}>Description</label>{editing ? <Input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /> : <p className="text-zinc-300">{item.description}</p>}</div>
                        <div><label className={labelCls}>Date</label><p className="text-zinc-300">{new Date(item.date).toLocaleDateString()}</p></div>
                        <div><label className={labelCls}>Type</label><p className="text-zinc-300">{item.transactionType}</p></div>
                        {isDeposit && editing ? (
                          <div>
                            <label className={labelCls}>Revenue Account</label>
                            <Select value={form.chartAccountId || ''} onChange={e => setForm({ ...form, chartAccountId: e.target.value })}>
                              <option value="">None</option>
                              {accounts.filter(a => a.type === 'REVENUE').map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                            </Select>
                          </div>
                        ) : item.chartAccount && (
                          <div><label className={labelCls}>Account</label><p className="text-zinc-300 text-sm">{item.chartAccount.code} — {item.chartAccount.name}</p></div>
                        )}
                        <div><label className={labelCls}>Notes</label>{editing ? <textarea className={inputCls} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /> : <p className="text-zinc-300 whitespace-pre-wrap">{item.notes || <span className="text-zinc-600 italic">No notes</span>}</p>}</div>
                      </div>
                    );
                  })()}

                  {type === "receipt" && !isClosed && (
                    <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => { setShowLinkPanel(p => !p); setSelectedLinkId(null); }}>Link Existing Transaction</Button>
                      <Button variant="ghost" onClick={() => { setShowCreateModal(true); setCreateForm({ date: '', description: '', amount: '', transactionType: 'DEBIT' }); }} className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md text-white transition" disabled={!canAddMoreTransactions}>Create New Transaction</Button>
                    </div>
                  )}
                </div>

                {/* RIGHT COLUMN */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col">
                  {isDeposit ? (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-500 text-center h-full">
                      <svg className="w-12 h-12 mb-3 opacity-20 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <h3 className="text-lg font-bold text-emerald-400/50 mb-2">Income Categorization</h3>
                      <p className="max-w-xs text-sm">Deposits don't require expense receipts. Edit the transaction details to assign a Revenue Account.</p>
                      {!isEditingRoot && !tx?.chartAccountId && (
                        <Button variant="primary" onClick={() => setIsEditingRoot(true)} className="mt-4">Categorize Deposit</Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
                        <div className="flex items-center gap-2">
                          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          <h2 className="text-xl font-bold">Expense Details</h2>
                          {type === "transaction" && totalLinked > 1 && <span className="text-xs text-zinc-500 ml-1">{activeLinkedIdx + 1} of {totalLinked}</span>}
                        </div>
                        {type === "receipt" && expense && (
                          isEditingRoot ? (
                            <div className="flex gap-3"><Button variant="ghost" onClick={() => setIsEditingRoot(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveRoot} >Save</Button></div>
                          ) : (
                            !isClosed && (<div className="flex gap-3"><Button variant="ghost" onClick={() => setIsEditingRoot(true)} className={btnSmGreen}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteRoot} >Delete</Button></div>)
                          )
                        )}
                        {type === "transaction" && currentLinkedExpense && (
                          isEditingLinked ? (
                            <div className="flex gap-3"><Button variant="ghost" onClick={() => setIsEditingLinked(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveLinked} >Save</Button></div>
                          ) : (
                            !isClosed && (<div className="flex gap-3"><Button variant="ghost" onClick={() => setIsEditingLinked(true)} className={btnSmGreen}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteLinked} >Delete</Button><Button variant="secondary" size="sm" onClick={handleUnlinkLinked} >Unlink</Button></div>)
                          )
                        )}
                      </div>

                      {type === "transaction" && <CarouselNav />}

                      {(() => {
                        const item = type === "receipt" ? expense : currentLinkedExpense;
                        const form = type === "receipt" ? rootForm : linkedForm;
                        const setForm = type === "receipt" ? setRootForm : setLinkedForm;
                        const editing = type === "receipt" ? isEditingRoot : isEditingLinked;
                        const isLinked = type === "receipt" ? confirmedTransactions.length > 0 : (currentLinkedExpense !== null && tx !== null);
                        if (!item) return <div className="py-12 text-zinc-500 text-center">No Expense Linked</div>;

                        return (
                          <div className="space-y-4 flex-1">
                            <div><label className={labelCls}>Amount</label>{editing ? <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /> : <p className="text-xl font-semibold">{formatMoney(item.amount)}</p>}</div>
                            <div><label className={labelCls}>Vendor</label>{editing ? <Input type="text" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} /> : <p className="text-zinc-300">{item.vendor || "Unknown"}</p>}</div>
                            <div><label className={labelCls}>Description</label>{editing ? <Input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /> : <p className="text-zinc-300">{item.description}</p>}</div>
                            <div className="flex gap-6">
                              <div><label className={labelCls}>Date</label><p className="text-zinc-300">{new Date(item.timestamp).toLocaleDateString()}</p></div>
                              <div><label className={labelCls}>Tender</label>{editing ? <Input type="text" value={form.tender} onChange={e => setForm({ ...form, tender: e.target.value })} /> : <p className="text-zinc-300 uppercase">{item.tender}</p>}</div>
                            </div>
                            {item.chartAccount && <div><label className={labelCls}>Category</label><p className="text-zinc-300 text-sm">{item.chartAccount.code} — {item.chartAccount.name}</p></div>}
                            <div><label className={labelCls}>Notes</label>{editing ? <textarea className={inputCls} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /> : <p className="text-zinc-300 whitespace-pre-wrap">{item.notes || <span className="text-zinc-600 italic">No notes</span>}</p>}</div>
                            
                            <div className="pt-2 flex flex-col gap-2">
                              <Button variant="ghost" onClick={() => setShowReceiptModal(true)} className="w-full px-4 py-2 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center gap-2 text-sm">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                View Receipt Image
                              </Button>
                              {!editing && item.tender !== "cash" && !isLinked && (
                                <Button variant="ghost" size="sm"  onClick={handleMarkCash} >Mark as Cash Expense (No Tx Needed)</Button>
                              )}
                              {!editing && item.tender === "cash" && (
                                <Button variant="ghost" onClick={() => type === "receipt" ? setIsEditingRoot(true) : setIsEditingLinked(true)} className="text-xs text-zinc-500 hover:text-white transition">Change payment method</Button>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {type === "transaction" && !isClosed && (
                        <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-wrap gap-2">
                          <Button variant="secondary" size="sm" onClick={() => { setShowLinkPanel(p => !p); setSelectedLinkId(null); }}>Link Existing Expense</Button>
                          <Button variant="secondary" size="sm" onClick={() => { setShowCreateModal(true); setCreateForm({ timestamp: '', vendor: '', description: '', amount: '', tender: 'card' }); }}>Create New Expense</Button>
                        </div>
                      )}
                    </>
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
                          <div><span className="text-zinc-500">Amount:</span> <span className="font-bold">{formatMoney(e.amount)}</span></div>
                          <div><span className="text-zinc-500">Date:</span> {new Date(e.timestamp).toLocaleDateString()}</div>
                          <div className="col-span-2 truncate"><span className="text-zinc-500">Vendor:</span> {e.vendor}</div>
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
                          <div><span className="text-zinc-500">Amount:</span> <span className="font-bold">{formatMoney(t.amount)}</span></div>
                          <div><span className="text-zinc-500">Date:</span> {new Date(t.date).toLocaleDateString()}</div>
                          <div className="col-span-2 truncate"><span className="text-zinc-500">Desc:</span> {t.description}</div>
                        </div>
                        <Button variant="ghost" onClick={() => handleApproveSuggestedTx(t.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition text-sm font-bold shrink-0">Approve Match</Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LINK PICKER PANEL */}
              {showLinkPanel && (
                <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-6">
                  <h2 className="text-lg font-bold mb-4 border-b border-zinc-800 pb-2">Link Existing {type === "transaction" ? "Expense" : "Transaction"}</h2>
                  <div className="max-h-64 overflow-y-auto border border-zinc-800 rounded-md bg-zinc-900 mb-4">
                    {((type === "transaction" && unlinked.expenses.length === 0) || (type === "receipt" && unlinked.transactions.length === 0)) ? (
                      <div className="p-8 text-center text-zinc-500">No unlinked items available.</div>
                    ) : (
                      <ul className="divide-y divide-zinc-800">
                        {type === "transaction" && unlinked.expenses.map(e => (
                          <li key={e.id}><Button variant="ghost" onClick={() => setSelectedLinkId(e.id)} className={`w-full text-left p-4 hover:bg-zinc-800 transition ${selectedLinkId === e.id ? 'bg-zinc-800 border-l-2 border-blue-500' : ''}`}><div className="flex justify-between items-center"><span className="font-semibold">{formatMoney(e.amount)}</span><span className="text-xs text-zinc-400">{new Date(e.timestamp).toLocaleDateString()}</span></div><div className="text-sm text-zinc-300 truncate mt-1">{e.vendor} — {e.description}</div></Button></li>
                        ))}
                        {type === "receipt" && unlinked.transactions.map(t => (
                          <li key={t.id}><Button variant="ghost" onClick={() => setSelectedLinkId(t.id)} className={`w-full text-left p-4 hover:bg-zinc-800 transition ${selectedLinkId === t.id ? 'bg-zinc-800 border-l-2 border-blue-500' : ''}`}><div className="flex justify-between items-center"><span className="font-semibold">{formatMoney(t.amount)}</span><span className="text-xs text-zinc-400">{new Date(t.date).toLocaleDateString()}</span></div><div className="text-sm text-zinc-300 truncate mt-1">{t.description}</div></Button></li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {selectedLinkId !== null && (
                    <div className="flex justify-end gap-3"><Button variant="ghost" onClick={() => { setShowLinkPanel(false); setSelectedLinkId(null); }}>Cancel</Button><Button variant="info" onClick={handleLink}>Confirm Link</Button></div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* RECEIPT IMAGE MODAL */}
      {showReceiptModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
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
                  <div className="w-full flex flex-col items-center gap-8 py-4">
                    {receipts.map((receipt) => {
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
                          <p className="text-zinc-500 text-xs mt-2">{filename}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500 min-h-[50vh]">
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-lg">Create & Link {type === "transaction" ? "Expense" : "Transaction"}</h3>
              <Button variant="ghost" onClick={() => setShowCreateModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </Button>
            </div>
            <div className="p-5 space-y-4">
              {type === "transaction" ? (
                <>
                  <div><label className={labelCls}>Date</label><Input type="date" value={createForm.timestamp || ''} onChange={e => setCreateForm({ ...createForm, timestamp: e.target.value })} /></div>
                  <div><label className={labelCls}>Vendor</label><Input type="text" placeholder="e.g. Staples" value={createForm.vendor || ''} onChange={e => setCreateForm({ ...createForm, vendor: e.target.value })} /></div>
                  <div><label className={labelCls}>Description</label><Input type="text" value={createForm.description || ''} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} /></div>
                  <div><label className={labelCls}>Amount</label><Input type="number" step="0.01" value={createForm.amount || ''} onChange={e => setCreateForm({ ...createForm, amount: e.target.value })} /></div>
                  <div><label className={labelCls}>Tender</label>
                    <Select value={createForm.tender || 'card'} onChange={e => setCreateForm({ ...createForm, tender: e.target.value })}>
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="check">Check</option>
                      <option value="other">Other</option>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div><label className={labelCls}>Date</label><Input type="date" value={createForm.date || ''} onChange={e => setCreateForm({ ...createForm, date: e.target.value })} /></div>
                  <div><label className={labelCls}>Description</label><Input type="text" value={createForm.description || ''} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} /></div>
                  <div><label className={labelCls}>Amount</label><Input type="number" step="0.01" value={createForm.amount || ''} onChange={e => setCreateForm({ ...createForm, amount: e.target.value })} /></div>
                  <div><label className={labelCls}>Type</label>
                    <Select value={createForm.transactionType || 'DEBIT'} onChange={e => setCreateForm({ ...createForm, transactionType: e.target.value })}>
                      <option value="DEBIT">Debit</option>
                      <option value="DEP">Deposit</option>
                      <option value="PAYMENT">Payment</option>
                      <option value="OTHER">Other</option>
                    </Select>
                  </div>
                </>
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
    </>,
    document.body
  );
}
