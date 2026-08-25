import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getTransactionDetail, getExpenseDetail,
  updateTransaction, updateExpense,
  deleteTransaction, deleteExpense,
  markExpenseAsCash, getUnlinkedItems,
  linkExpenseToTransaction, unlinkExpenseFromTransaction,
  createExpense, createTransaction,
  getAccountingPeriods,
} from "../services/api";
import type { BankTransaction, Expense } from "../types/models";

export default function DetailsView() {
  const { type, id } = useParams<{ type: string, id: string }>();
  const navigate = useNavigate();

  // The "root" item — the one we navigated to directly. Fixed in its column.
  const [tx, setTx] = useState<BankTransaction | null>(null);
  const [expense, setExpense] = useState<Expense | null>(null);

  // Linked items displayed in the carousel column
  const [confirmedExpenses, setConfirmedExpenses] = useState<Expense[]>([]);
  const [suggestedExpenses, setSuggestedExpenses] = useState<Expense[]>([]);
  const [confirmedTransactions, setConfirmedTransactions] = useState<BankTransaction[]>([]);
  const [suggestedTransactions, setSuggestedTransactions] = useState<BankTransaction[]>([]);

  // Carousel state — which linked item is currently shown
  const [activeLinkedIdx, setActiveLinkedIdx] = useState(0);

  // Edit state for the root item
  const [isEditingRoot, setIsEditingRoot] = useState(false);
  const [rootForm, setRootForm] = useState<any>({});

  // Edit state for the carousel item (scoped to what's in view)
  const [isEditingLinked, setIsEditingLinked] = useState(false);
  const [linkedForm, setLinkedForm] = useState<any>({});

  // For the link picker panel
  const [unlinked, setUnlinked] = useState<{ transactions: BankTransaction[], expenses: Expense[] }>({ transactions: [], expenses: [] });
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
  const [showLinkPanel, setShowLinkPanel] = useState(false);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);

  // Receipt viewer modal
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isClosed, setIsClosed] = useState(false);

  // ─── Computed ────────────────────────────────────────────────────────────────

  // The item currently shown in the carousel
  const currentLinkedExpense = type === "transaction" && confirmedExpenses.length > 0
    ? confirmedExpenses[activeLinkedIdx] : null;
  const currentLinkedTx = type === "receipt" && confirmedTransactions.length > 0
    ? confirmedTransactions[activeLinkedIdx] : null;

  const totalLinked = type === "transaction" ? confirmedExpenses.length : confirmedTransactions.length;

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  // Constraint check: expense with >1 receipts can only link to 1 transaction
  const expenseReceiptCount = expense?.receipts?.length ?? 0;
  const canAddMoreTransactions = !(expenseReceiptCount > 1 && confirmedTransactions.length >= 1);

  // ─── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id || !type) return;
    loadData();
  }, [id, type]);

  // When carousel index changes, reset linked edit state and refresh the linked form
  useEffect(() => {
    setIsEditingLinked(false);
    if (type === "transaction" && confirmedExpenses[activeLinkedIdx]) {
      const e = confirmedExpenses[activeLinkedIdx];
      setLinkedForm({ vendor: e.vendor, description: e.description, amount: e.amount, tender: e.tender });
    } else if (type === "receipt" && confirmedTransactions[activeLinkedIdx]) {
      const t = confirmedTransactions[activeLinkedIdx];
      setLinkedForm({ description: t.description, amount: t.amount });
    }
  }, [activeLinkedIdx, confirmedExpenses, confirmedTransactions]);

  const loadData = async () => {
    setIsLoading(true);
    setActiveLinkedIdx(0);
    setIsEditingRoot(false);
    setIsEditingLinked(false);
    setShowLinkPanel(false);

    try {
      if (type === "transaction") {
        const data = await getTransactionDetail(Number(id));
        setTx(data.transaction);
        setRootForm({ description: data.transaction.description, amount: data.transaction.amount });
        setConfirmedExpenses(data.confirmedExpenses);
        setSuggestedExpenses(data.suggestedExpenses);
        if (data.confirmedExpenses.length > 0) {
          const e = data.confirmedExpenses[0];
          setLinkedForm({ vendor: e.vendor, description: e.description, amount: e.amount, tender: e.tender });
        }
      } else if (type === "receipt") {
        const data = await getExpenseDetail(Number(id));
        setExpense(data.expense);
        setRootForm({ vendor: data.expense.vendor, description: data.expense.description, amount: data.expense.amount, tender: data.expense.tender });
        setConfirmedTransactions(data.confirmedTransactions);
        setSuggestedTransactions(data.suggestedTransactions);
        if (data.confirmedTransactions.length > 0) {
          const t = data.confirmedTransactions[0];
          setLinkedForm({ description: t.description, amount: t.amount });
        }
      }
      const unlinkedData = await getUnlinkedItems();
      setUnlinked(unlinkedData);

      const periods = await getAccountingPeriods();
      let targetDate: Date | null = null;
      if (type === "transaction") {
        const txData = await getTransactionDetail(Number(id));
        targetDate = new Date(txData.transaction.date);
      } else if (type === "receipt") {
        const exData = await getExpenseDetail(Number(id));
        targetDate = new Date(exData.expense.timestamp);
      }
      if (targetDate) {
        const y = targetDate.getFullYear();
        const m = targetDate.getMonth() + 1;
        const period = periods.find(p => p.year === y && p.month === m);
        if (period && period.status === "CLOSED") {
          setIsClosed(true);
        } else {
          setIsClosed(false);
        }
      }

    } catch (err) {
      console.error(err);
      alert("Failed to load details");
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleSaveRoot = async () => {
    try {
      if (type === "transaction" && tx) {
        await updateTransaction(tx.id, { description: rootForm.description, amount: Number(rootForm.amount) });
      } else if (type === "receipt" && expense) {
        await updateExpense(expense.id, { vendor: rootForm.vendor, description: rootForm.description, amount: Number(rootForm.amount), tender: rootForm.tender });
      }
      setIsEditingRoot(false);
      loadData();
    } catch { alert("Failed to save"); }
  };

  const handleSaveLinked = async () => {
    try {
      if (type === "transaction" && currentLinkedExpense) {
        await updateExpense(currentLinkedExpense.id, { vendor: linkedForm.vendor, description: linkedForm.description, amount: Number(linkedForm.amount), tender: linkedForm.tender });
      } else if (type === "receipt" && currentLinkedTx) {
        await updateTransaction(currentLinkedTx.id, { description: linkedForm.description, amount: Number(linkedForm.amount) });
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
      navigate(-1);
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
      if (type === "transaction" && tx && currentLinkedExpense) {
        await unlinkExpenseFromTransaction(currentLinkedExpense.id, tx.id);
      } else if (type === "receipt" && expense && currentLinkedTx) {
        await unlinkExpenseFromTransaction(expense.id, currentLinkedTx.id);
      }
      setActiveLinkedIdx(Math.max(0, activeLinkedIdx - 1));
      loadData();
    } catch { alert("Failed to unlink"); }
  };

  const handleLink = async () => {
    if (selectedLinkId === null) return;
    try {
      if (type === "transaction" && tx) {
        await linkExpenseToTransaction(selectedLinkId, tx.id);
      } else if (expense) {
        await linkExpenseToTransaction(expense.id, selectedLinkId);
      }
      setSelectedLinkId(null);
      setShowLinkPanel(false);
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to link");
    }
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
        const payload: any = {
          ...createForm,
          amount: Number(createForm.amount),
        };
        if (createForm.timestamp) {
          payload.timestamp = new Date(createForm.timestamp).toISOString();
        }
        const newExp = await createExpense(payload);
        await linkExpenseToTransaction(newExp.id, tx.id);
      } else if (type === "receipt" && expense) {
        if (!canAddMoreTransactions) {
          alert("This expense has multiple receipt files and is already linked to a transaction.");
          return;
        }
        const payload: any = {
          ...createForm,
          amount: Number(createForm.amount),
        };
        if (createForm.date) {
          payload.date = new Date(createForm.date).toISOString();
        }
        const newTx = await createTransaction(payload);
        await linkExpenseToTransaction(expense.id, newTx.id);
      }
      setShowCreateModal(false);
      setCreateForm({});
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to create and link");
    } finally {
      setIsSaving(false);
    }
  };

  const goToPrev = () => setActiveLinkedIdx(prev => Math.max(0, prev - 1));
  const goToNext = () => setActiveLinkedIdx(prev => Math.min(totalLinked - 1, prev + 1));

  // ─── Shared style tokens ─────────────────────────────────────────────────────
  const inputCls = "w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-white";
  const labelCls = "block text-xs font-medium text-zinc-500 mb-1";
  const btnSmRed = "text-xs text-red-400 hover:text-red-300 transition";
  const btnSmGray = "text-xs text-zinc-400 hover:text-zinc-200 transition";
  const btnSmBlue = "text-xs text-blue-400 hover:text-blue-300 transition";
  const btnSmGreen = "text-xs text-emerald-400 hover:text-emerald-300 transition";

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-900 text-white">Loading…</div>;
  }

  // ─── Carousel nav pills ──────────────────────────────────────────────────────
  const CarouselNav = () => totalLinked > 1 ? (
    <div className="flex items-center justify-center gap-2 mb-4 py-2">
      <button onClick={goToPrev} disabled={activeLinkedIdx === 0}
        className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition">
        ‹
      </button>
      <span className="text-xs text-zinc-500 font-medium px-1">{activeLinkedIdx + 1} / {totalLinked}</span>
      {Array.from({ length: totalLinked }).map((_, i) => (
        <button key={i} onClick={() => { setActiveLinkedIdx(i); setIsEditingLinked(false); }}
          className={`w-2 h-2 rounded-full transition ${i === activeLinkedIdx ? 'bg-white' : 'bg-zinc-600 hover:bg-zinc-400'}`} />
      ))}
      <button onClick={goToNext} disabled={activeLinkedIdx === totalLinked - 1}
        className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition">
        ›
      </button>
    </div>
  ) : null;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100 py-8 px-4 relative">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* HEADER — back button only, delete moved to each section */}
        <div className="flex items-center">
          <button onClick={() => navigate(-1)} className="text-zinc-400 hover:text-white flex items-center gap-2 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            Back
          </button>
        </div>

        {/* TWO-COLUMN LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── LEFT COLUMN: Bank Transaction ────────────────────────────────── */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col">

            {/* Column header */}
            <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
                <h2 className="text-xl font-bold">Bank Transaction</h2>
                {type === "receipt" && totalLinked > 1 && (
                  <span className="text-xs text-zinc-500 ml-1">{activeLinkedIdx + 1} of {totalLinked}</span>
                )}
              </div>

              {/* Actions — root (when type=transaction) or carousel item (when type=receipt) */}
              {type === "transaction" && tx && (
                isEditingRoot ? (
                  <div className="flex gap-3">
                    <button onClick={() => setIsEditingRoot(false)} className={btnSmGray}>Cancel</button>
                    <button onClick={handleSaveRoot} className={`${btnSmGreen} font-bold`}>Save</button>
                  </div>
                ) : (
                  !isClosed && (<div className="flex gap-3"><button onClick={() => setIsEditingRoot(true)} className={btnSmBlue}>Edit Details</button><button onClick={handleDeleteRoot} className={btnSmRed}>Delete</button></div>)
                )
              )}
              {type === "receipt" && currentLinkedTx && (
                isEditingLinked ? (
                  <div className="flex gap-3">
                    <button onClick={() => setIsEditingLinked(false)} className={btnSmGray}>Cancel</button>
                    <button onClick={handleSaveLinked} className={`${btnSmGreen} font-bold`}>Save</button>
                  </div>
                ) : (
                  !isClosed && (<div className="flex gap-3"><button onClick={() => setIsEditingLinked(true)} className={btnSmBlue}>Edit Details</button><button onClick={handleDeleteLinked} className={btnSmRed}>Delete</button><button onClick={handleUnlinkLinked} className={btnSmGray}>Unlink</button></div>)
                )
              )}
            </div>

            {/* Carousel nav (only for type=receipt) */}
            {type === "receipt" && <CarouselNav />}

            {/* Content */}
            {(() => {
              const item = type === "transaction" ? tx : currentLinkedTx;
              const form = type === "transaction" ? rootForm : linkedForm;
              const setForm = type === "transaction" ? setRootForm : setLinkedForm;
              const editing = type === "transaction" ? isEditingRoot : isEditingLinked;

              if (!item) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-500 text-center">
                    <svg className="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    <p>No Bank Transaction Linked</p>
                  </div>
                );
              }

              return (
                <div className="space-y-4 flex-1">
                  <div>
                    <label className={labelCls}>Amount</label>
                    {editing ? (
                      <input type="number" step="0.01" className={inputCls} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
                    ) : (
                      <p className="text-xl font-semibold">{formatMoney(item.amount)}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    {editing ? (
                      <input type="text" className={inputCls} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                    ) : (
                      <p className="text-zinc-300">{item.description}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Date</label>
                    <p className="text-zinc-300">{new Date(item.date).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <label className={labelCls}>Type</label>
                    <p className="text-zinc-300">{item.transactionType}</p>
                  </div>
                </div>
              );
            })()}

            {/* Add-another-link controls (only shown when viewing a receipt) */}
            {type === "receipt" && !isClosed && (
              <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-wrap gap-2">
                <button
                  onClick={() => { setShowLinkPanel(p => !p); setSelectedLinkId(null); }}
                  className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                  Link Existing Transaction
                </button>
                {canAddMoreTransactions ? (
                  <button
                    onClick={() => { setShowCreateModal(true); setCreateForm({ date: '', description: '', amount: '', transactionType: 'DEBIT', year: 0, month: 0 }); }}
                    className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    Create New Transaction
                  </button>
                ) : (
                  <span className="text-xs text-zinc-600 px-3 py-1.5" title="This expense has multiple receipt files — it can only link to one transaction">
                    Create New Transaction (disabled — multiple receipts)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN: Expense / Receipt ─────────────────────────────── */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col">

            <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <h2 className="text-xl font-bold">Expense Details</h2>
                {type === "transaction" && totalLinked > 1 && (
                  <span className="text-xs text-zinc-500 ml-1">{activeLinkedIdx + 1} of {totalLinked}</span>
                )}
              </div>

              {type === "receipt" && expense && (
                isEditingRoot ? (
                  <div className="flex gap-3">
                    <button onClick={() => setIsEditingRoot(false)} className={btnSmGray}>Cancel</button>
                    <button onClick={handleSaveRoot} className={`${btnSmGreen} font-bold`}>Save</button>
                  </div>
                ) : (
                  !isClosed && (<div className="flex gap-3"><button onClick={() => setIsEditingRoot(true)} className={btnSmGreen}>Edit Details</button><button onClick={handleDeleteRoot} className={btnSmRed}>Delete</button></div>)
                )
              )}
              {type === "transaction" && currentLinkedExpense && (
                isEditingLinked ? (
                  <div className="flex gap-3">
                    <button onClick={() => setIsEditingLinked(false)} className={btnSmGray}>Cancel</button>
                    <button onClick={handleSaveLinked} className={`${btnSmGreen} font-bold`}>Save</button>
                  </div>
                ) : (
                  !isClosed && (<div className="flex gap-3"><button onClick={() => setIsEditingLinked(true)} className={btnSmGreen}>Edit Details</button><button onClick={handleDeleteLinked} className={btnSmRed}>Delete</button><button onClick={handleUnlinkLinked} className={btnSmGray}>Unlink</button></div>)
                )
              )}
            </div>

            {/* Carousel nav (only for type=transaction) */}
            {type === "transaction" && <CarouselNav />}

            {/* Content */}
            {(() => {
              const item = type === "receipt" ? expense : currentLinkedExpense;
              const form = type === "receipt" ? rootForm : linkedForm;
              const setForm = type === "receipt" ? setRootForm : setLinkedForm;
              const editing = type === "receipt" ? isEditingRoot : isEditingLinked;
              const isLinked = type === "receipt" ? confirmedTransactions.length > 0 : (currentLinkedExpense !== null && tx !== null);

              if (!item) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-500 text-center">
                    <svg className="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    <p>No Expense Linked</p>
                  </div>
                );
              }

              return (
                <div className="space-y-4 flex-1">
                  <div>
                    <label className={labelCls}>Amount</label>
                    {editing ? (
                      <input type="number" step="0.01" className={inputCls} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
                    ) : (
                      <p className="text-xl font-semibold">{formatMoney(item.amount)}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Vendor</label>
                    {editing ? (
                      <input type="text" className={inputCls} value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} />
                    ) : (
                      <p className="text-zinc-300">{item.vendor || "Unknown"}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    {editing ? (
                      <input type="text" className={inputCls} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                    ) : (
                      <p className="text-zinc-300">{item.description}</p>
                    )}
                  </div>
                  <div className="flex gap-6">
                    <div>
                      <label className={labelCls}>Date</label>
                      <p className="text-zinc-300">{new Date(item.timestamp).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <label className={labelCls}>Tender</label>
                      {editing ? (
                        <input type="text" className={inputCls} value={form.tender} onChange={e => setForm({ ...form, tender: e.target.value })} />
                      ) : (
                        <p className="text-zinc-300 uppercase">{item.tender}</p>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col gap-2">
                    <button onClick={() => setShowReceiptModal(true)} className="w-full px-4 py-2 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center gap-2 text-sm">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                      View Receipt Image
                    </button>
                    {item.tender !== "cash" && !isLinked && (
                      <button onClick={handleMarkCash} className="text-xs text-zinc-500 hover:text-white transition">
                        Mark as Cash Expense (No Tx Needed)
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Add-another-link controls (only shown when viewing a transaction) */}
            {type === "transaction" && !isClosed && (
              <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-wrap gap-2">
                <button
                  onClick={() => { setShowLinkPanel(p => !p); setSelectedLinkId(null); }}
                  className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                  Link Existing Expense
                </button>
                <button
                  onClick={() => { setShowCreateModal(true); setCreateForm({ timestamp: '', vendor: '', description: '', amount: '', tender: 'card', year: 0, month: 0 }); }}
                  className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  Create New Expense
                </button>
              </div>
            )}
          </div>
        </div>

        {/* SUGGESTED MATCHES */}
        {type === "transaction" && suggestedExpenses.length > 0 && (
          <div className="border border-blue-900/50 bg-blue-900/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
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
                  <button onClick={() => handleApproveSuggestedExpense(e.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition text-sm font-bold shrink-0">
                    Approve Match
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {type === "receipt" && suggestedTransactions.length > 0 && (
          <div className="border border-blue-900/50 bg-blue-900/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
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
                  <button onClick={() => handleApproveSuggestedTx(t.id)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition text-sm font-bold shrink-0">
                    Approve Match
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LINK PICKER PANEL */}
        {showLinkPanel && (
          <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-6">
            <h2 className="text-lg font-bold mb-4 border-b border-zinc-800 pb-2">
              Link Existing {type === "transaction" ? "Expense" : "Transaction"}
            </h2>
            <div className="max-h-64 overflow-y-auto border border-zinc-800 rounded-md bg-zinc-900 mb-4">
              {((type === "transaction" && unlinked.expenses.length === 0) || (type === "receipt" && unlinked.transactions.length === 0)) ? (
                <div className="p-8 text-center text-zinc-500">No unlinked items available.</div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {type === "transaction" && unlinked.expenses.map(e => (
                    <li key={e.id}>
                      <button onClick={() => setSelectedLinkId(e.id)}
                        className={`w-full text-left p-4 hover:bg-zinc-800 transition ${selectedLinkId === e.id ? 'bg-zinc-800 border-l-2 border-blue-500' : ''}`}>
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">{formatMoney(e.amount)}</span>
                          <span className="text-xs text-zinc-400">{new Date(e.timestamp).toLocaleDateString()}</span>
                        </div>
                        <div className="text-sm text-zinc-300 truncate mt-1">{e.vendor} — {e.description}</div>
                      </button>
                    </li>
                  ))}
                  {type === "receipt" && unlinked.transactions.map(t => (
                    <li key={t.id}>
                      <button onClick={() => setSelectedLinkId(t.id)}
                        className={`w-full text-left p-4 hover:bg-zinc-800 transition ${selectedLinkId === t.id ? 'bg-zinc-800 border-l-2 border-blue-500' : ''}`}>
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">{formatMoney(t.amount)}</span>
                          <span className="text-xs text-zinc-400">{new Date(t.date).toLocaleDateString()}</span>
                        </div>
                        <div className="text-sm text-zinc-300 truncate mt-1">{t.description}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {selectedLinkId !== null && (
              <div className="flex justify-end gap-3">
                <button onClick={() => { setShowLinkPanel(false); setSelectedLinkId(null); }} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition">Cancel</button>
                <button onClick={handleLink} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-bold transition">Confirm Link</button>
              </div>
            )}
          </div>
        )}

      </div>

      {/* RECEIPT IMAGE MODAL */}
      {showReceiptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-4xl w-full flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-zinc-700 flex justify-between items-center">
              <h3 className="font-bold text-lg">Physical Receipt</h3>
              <button onClick={() => setShowReceiptModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto flex items-center justify-center bg-zinc-950 min-h-75">
              {(() => {
                const receipts = (type === "receipt" ? expense : currentLinkedExpense)?.receipts;
                return receipts && receipts.length > 0 ? (
                  <div className="text-center space-y-4">
                    <p className="text-zinc-500 italic">File: {receipts[0].documentUri.split('/').pop()}</p>
                    <p className="text-xs text-zinc-600">In production, this would display the PDF/Image natively.</p>
                  </div>
                ) : (
                  <p className="text-zinc-500">No physical receipt attached.</p>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* CREATE & LINK MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-lg">Create & Link {type === "transaction" ? "Expense" : "Transaction"}</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              {type === "transaction" ? (
                // Creating an expense to link to this transaction
                <>
                  <div>
                    <label className={labelCls}>Date</label>
                    <input type="date" className={inputCls} value={createForm.timestamp || ''} onChange={e => setCreateForm({ ...createForm, timestamp: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Vendor</label>
                    <input type="text" className={inputCls} placeholder="e.g. Staples" value={createForm.vendor || ''} onChange={e => setCreateForm({ ...createForm, vendor: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <input type="text" className={inputCls} value={createForm.description || ''} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Amount</label>
                    <input type="number" step="0.01" className={inputCls} value={createForm.amount || ''} onChange={e => setCreateForm({ ...createForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Tender</label>
                    <select className={inputCls} value={createForm.tender || 'card'} onChange={e => setCreateForm({ ...createForm, tender: e.target.value })}>
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="check">Check</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </>
              ) : (
                // Creating a transaction to link to this expense
                <>
                  <div>
                    <label className={labelCls}>Date</label>
                    <input type="date" className={inputCls} value={createForm.date || ''} onChange={e => setCreateForm({ ...createForm, date: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <input type="text" className={inputCls} value={createForm.description || ''} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Amount</label>
                    <input type="number" step="0.01" className={inputCls} value={createForm.amount || ''} onChange={e => setCreateForm({ ...createForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Type</label>
                    <select className={inputCls} value={createForm.transactionType || 'DEBIT'} onChange={e => setCreateForm({ ...createForm, transactionType: e.target.value })}>
                      <option value="DEBIT">Debit</option>
                      <option value="DEP">Deposit</option>
                      <option value="PAYMENT">Payment</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="p-5 border-t border-zinc-800 flex gap-3 justify-end">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition">Cancel</button>
              <button onClick={handleCreate} disabled={isSaving} className="px-5 py-2 bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {isSaving ? 'Saving…' : `Create & Link`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
