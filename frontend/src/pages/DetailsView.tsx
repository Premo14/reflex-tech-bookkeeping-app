import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { 
  getTransaction, getExpense, updateTransaction, updateExpense, 
  deleteTransaction, deleteExpense, markExpenseAsCash, getUnlinkedItems,
  linkExpenseToTransaction, unlinkExpenseFromTransaction
} from "../services/api";
import type { BankTransaction, Expense } from "../types/models";

export default function DetailsView() {
  const { type, id } = useParams<{ type: string, id: string }>();
  const navigate = useNavigate();

  const [tx, setTx] = useState<BankTransaction | null>(null);
  const [expense, setExpense] = useState<Expense | null>(null);
  
  const [unlinked, setUnlinked] = useState<{ transactions: BankTransaction[], expenses: Expense[] }>({ transactions: [], expenses: [] });
  
  const [isEditingTx, setIsEditingTx] = useState(false);
  const [txForm, setTxForm] = useState<any>({});
  
  const [isEditingExp, setIsEditingExp] = useState(false);
  const [expForm, setExpForm] = useState<any>({});
  
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // modal
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!id || !type) return;
    loadData();
  }, [id, type]);

  const loadData = async () => {
    setIsLoading(true);
    setTx(null);
    setExpense(null);
    
    try {
      if (type === "transaction") {
        const data = await getTransaction(Number(id));
        setTx(data);
        setTxForm({ description: data.description, amount: data.amount });
        if (data.expenses && data.expenses.length > 0) {
          setExpense(data.expenses[0]);
          setExpForm({ vendor: data.expenses[0].vendor, description: data.expenses[0].description, amount: data.expenses[0].amount, tender: data.expenses[0].tender });
        }
      } else if (type === "receipt") {
        const data = await getExpense(Number(id));
        setExpense(data);
        setExpForm({ vendor: data.vendor, description: data.description, amount: data.amount, tender: data.tender });
        
        if (data.bankTransactionId) {
          const txData = await getTransaction(data.bankTransactionId);
          setTx(txData);
          setTxForm({ description: txData.description, amount: txData.amount });
        }
      }
      
      const unlinkedData = await getUnlinkedItems();
      setUnlinked(unlinkedData);
    } catch (err) {
      console.error(err);
      alert("Failed to load details");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTx = async () => {
    if (!tx) return;
    try {
      await updateTransaction(tx.id, { description: txForm.description, amount: Number(txForm.amount) });
      setIsEditingTx(false);
      loadData();
    } catch (err) { alert("Failed to save tx updates"); }
  };
  
  const handleSaveExp = async () => {
    if (!expense) return;
    try {
      await updateExpense(expense.id, { vendor: expForm.vendor, description: expForm.description, amount: Number(expForm.amount), tender: expForm.tender });
      setIsEditingExp(false);
      loadData();
    } catch (err) { alert("Failed to save expense updates"); }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this entirely?")) return;
    try {
      if (type === "transaction" && tx) await deleteTransaction(tx.id);
      else if (expense) await deleteExpense(expense.id);
      navigate(-1);
    } catch (err) {
      alert("Failed to delete");
    }
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
      loadData();
    } catch (err) {
      alert("Failed to link");
    }
  };
  
  const handleUnlink = async () => {
    if (!expense || !tx) return;
    try {
      await unlinkExpenseFromTransaction(expense.id);
      loadData();
    } catch (err) {
      alert("Failed to unlink");
    }
  };

  const handleMarkCash = async () => {
    if (!expense) return;
    try {
      await markExpenseAsCash(expense.id);
      loadData();
    } catch (err) {
      alert("Failed to mark as cash");
    }
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-900 text-white">Loading...</div>;
  }

  const isMatched = tx !== null && expense !== null;

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100 py-8 px-4 relative">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="text-zinc-400 hover:text-white flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            Back
          </button>
          <div>
            <button onClick={handleDelete} className="px-4 py-2 bg-red-900/50 text-red-400 rounded-md hover:bg-red-900 transition font-medium">Delete Root Item</button>
          </div>
        </div>

        {/* TWO-COLUMN LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* LEFT COLUMN: BANK TRANSACTION */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col">
            <div className="flex items-center justify-between mb-6 border-b border-zinc-800 pb-2">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
                Bank Transaction
              </h2>
              {tx && (
                !isEditingTx ? (
                  <button onClick={() => setIsEditingTx(true)} className="text-xs text-blue-400 hover:text-blue-300">Edit Details</button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setIsEditingTx(false)} className="text-xs text-zinc-400 hover:text-zinc-300">Cancel</button>
                    <button onClick={handleSaveTx} className="text-xs text-emerald-400 hover:text-emerald-300 font-bold">Save</button>
                  </div>
                )
              )}
            </div>
            
            {tx ? (
              <div className="space-y-4 flex-1">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Amount</label>
                  {isEditingTx ? (
                    <input type="number" step="0.01" className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white" value={txForm.amount} onChange={(e) => setTxForm({...txForm, amount: e.target.value})} />
                  ) : (
                    <p className="text-xl font-semibold">${Math.abs(tx.amount).toFixed(2)}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Description</label>
                  {isEditingTx ? (
                    <input type="text" className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white" value={txForm.description} onChange={(e) => setTxForm({...txForm, description: e.target.value})} />
                  ) : (
                    <p className="text-zinc-300">{tx.description}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Date</label>
                  <p className="text-zinc-300">{new Date(tx.date).toLocaleDateString()}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Type</label>
                  <p className="text-zinc-300">{tx.transactionType}</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-500 text-center">
                <svg className="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                <p>No Bank Transaction Linked</p>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: EXPENSE/RECEIPT */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col">
            <div className="flex items-center justify-between mb-6 border-b border-zinc-800 pb-2">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                Expense Details
              </h2>
              {expense && (
                !isEditingExp ? (
                  <button onClick={() => setIsEditingExp(true)} className="text-xs text-emerald-400 hover:text-emerald-300">Edit Details</button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setIsEditingExp(false)} className="text-xs text-zinc-400 hover:text-zinc-300">Cancel</button>
                    <button onClick={handleSaveExp} className="text-xs text-emerald-400 hover:text-emerald-300 font-bold">Save</button>
                  </div>
                )
              )}
            </div>
            
            {expense ? (
              <div className="space-y-4 flex-1">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Amount</label>
                  {isEditingExp ? (
                    <input type="number" step="0.01" className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white" value={expForm.amount} onChange={(e) => setExpForm({...expForm, amount: e.target.value})} />
                  ) : (
                    <p className="text-xl font-semibold">${Math.abs(expense.amount).toFixed(2)}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Vendor</label>
                  {isEditingExp ? (
                    <input type="text" className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white" value={expForm.vendor} onChange={(e) => setExpForm({...expForm, vendor: e.target.value})} />
                  ) : (
                    <p className="text-zinc-300">{expense.vendor || "Unknown"}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Description</label>
                  {isEditingExp ? (
                    <input type="text" className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white" value={expForm.description} onChange={(e) => setExpForm({...expForm, description: e.target.value})} />
                  ) : (
                    <p className="text-zinc-300">{expense.description}</p>
                  )}
                </div>
                <div className="flex gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Date</label>
                    <p className="text-zinc-300">{new Date(expense.timestamp).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Tender</label>
                    {isEditingExp ? (
                      <input type="text" className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white" value={expForm.tender} onChange={(e) => setExpForm({...expForm, tender: e.target.value})} />
                    ) : (
                      <p className="text-zinc-300 uppercase">{expense.tender}</p>
                    )}
                  </div>
                </div>

                <div className="pt-4 flex flex-col gap-2">
                  <button onClick={() => setShowModal(true)} className="w-full px-4 py-2 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                    View Receipt Image
                  </button>
                  {expense.tender !== 'cash' && !isMatched && (
                    <button onClick={handleMarkCash} className="text-xs text-zinc-500 hover:text-white transition">Mark as Cash Expense (No Tx Needed)</button>
                  )}
                </div>

              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-500 text-center">
                <svg className="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <p>No Expense Linked</p>
                {/* For unmatched transactions, they can upload one theoretically, or link it below */}
              </div>
            )}
          </div>
        </div>

        {/* SUGGESTED MATCH */}
        {!isMatched && (
          (type === 'transaction' && tx?.suggestedExpense) || (type === 'receipt' && expense?.suggestedTransaction)
        ) && (
          <div className="border border-blue-900/50 bg-blue-900/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              <h3 className="text-lg font-bold text-blue-400">Suggested Match Found</h3>
            </div>
            <p className="text-zinc-300 text-sm mb-4">We found a likely match for this record. Would you like to approve it?</p>
            
            <div className="border border-blue-900/30 bg-black rounded-lg p-5 flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between mb-4">
              <div className="flex-1 min-w-0">
                {type === 'transaction' && tx?.suggestedExpense && (
                  <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-2">
                    <div><span className="text-zinc-500">Amount:</span> <span className="font-bold">${Math.abs(tx.suggestedExpense.amount).toFixed(2)}</span></div>
                    <div><span className="text-zinc-500">Date:</span> {new Date(tx.suggestedExpense.timestamp).toLocaleDateString()}</div>
                    <div className="col-span-2 truncate"><span className="text-zinc-500">Vendor:</span> {tx.suggestedExpense.vendor}</div>
                    <div className="col-span-2 truncate text-zinc-400">{tx.suggestedExpense.description}</div>
                  </div>
                )}
                {type === 'receipt' && expense?.suggestedTransaction && (
                  <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-2">
                    <div><span className="text-zinc-500">Amount:</span> <span className="font-bold">${Math.abs(expense.suggestedTransaction.amount).toFixed(2)}</span></div>
                    <div><span className="text-zinc-500">Date:</span> {new Date(expense.suggestedTransaction.date).toLocaleDateString()}</div>
                    <div className="col-span-2 truncate"><span className="text-zinc-500">Desc:</span> {expense.suggestedTransaction.description}</div>
                  </div>
                )}
              </div>
            </div>

            <button 
              onClick={async () => {
                try {
                  if (type === 'transaction') {
                    await linkExpenseToTransaction(tx!.suggestedExpenseId!, tx!.id);
                  } else {
                    await linkExpenseToTransaction(expense!.id, expense!.suggestedTransactionId!);
                  }
                  loadData();
                } catch (err) {
                  alert("Failed to link suggestion");
                }
              }}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition text-sm font-bold w-full sm:w-auto"
            >
              Approve Match
            </button>
          </div>
        )}

        {/* BOTTOM AREA: MANUAL LINKING */}
        <div id="manual-link-section" className={`border rounded-xl p-6 ${isMatched ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-zinc-950 border-zinc-800'}`}>
          <h2 className="text-xl font-bold mb-4 border-b border-zinc-800 pb-2">Manual Link</h2>
          
          {isMatched ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="text-emerald-400 font-medium">This transaction and expense are fully matched!</p>
                <p className="text-zinc-500 text-sm mt-1">They are reconciled in the database.</p>
              </div>
              <button onClick={handleUnlink} className="px-4 py-2 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition w-full sm:w-auto">Unlink</button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Select an unlinked {type === 'transaction' ? 'expense/receipt' : 'transaction'} from the list to preview and link it:
              </p>
              
              <div className="flex flex-col gap-6">
                
                {/* Scrollable list */}
                <div className="max-h-64 overflow-y-auto border border-zinc-800 rounded-md bg-zinc-900">
                  {((type === 'transaction' && unlinked.expenses.length === 0) || (type === 'receipt' && unlinked.transactions.length === 0)) ? (
                    <div className="p-8 text-center text-zinc-500">No unlinked items available.</div>
                  ) : (
                    <ul className="divide-y divide-zinc-800">
                      {type === 'transaction' && unlinked.expenses.map(e => (
                        <li key={e.id}>
                          <button 
                            onClick={() => setSelectedLinkId(e.id)}
                            className={`w-full text-left p-4 hover:bg-zinc-800 transition ${selectedLinkId === e.id ? 'bg-zinc-800 border-l-2 border-blue-500' : ''}`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-semibold">${Math.abs(e.amount).toFixed(2)}</span>
                              <span className="text-xs text-zinc-400">{new Date(e.timestamp).toLocaleDateString()}</span>
                            </div>
                            <div className="text-sm text-zinc-300 truncate mt-1">{e.vendor} — {e.description}</div>
                          </button>
                        </li>
                      ))}
                      {type === 'receipt' && unlinked.transactions.map(t => (
                        <li key={t.id}>
                          <button 
                            onClick={() => setSelectedLinkId(t.id)}
                            className={`w-full text-left p-4 hover:bg-zinc-800 transition ${selectedLinkId === t.id ? 'bg-zinc-800 border-l-2 border-blue-500' : ''}`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-semibold">${Math.abs(t.amount).toFixed(2)}</span>
                              <span className="text-xs text-zinc-400">{new Date(t.date).toLocaleDateString()}</span>
                            </div>
                            <div className="text-sm text-zinc-300 truncate mt-1">{t.description}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Preview Card */}
                {selectedLinkId !== null && (
                  <div className="border border-zinc-700 bg-black rounded-lg p-5 flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Preview Selection</p>
                      {type === 'transaction' && (
                        <div className="text-sm">
                          {unlinked.expenses.filter(e => e.id === selectedLinkId).map(e => (
                            <div key={e.id} className="grid grid-cols-2 gap-x-4 gap-y-2">
                              <div><span className="text-zinc-500">Amount:</span> <span className="font-bold">${Math.abs(e.amount).toFixed(2)}</span></div>
                              <div><span className="text-zinc-500">Date:</span> {new Date(e.timestamp).toLocaleDateString()}</div>
                              <div className="col-span-2 truncate"><span className="text-zinc-500">Vendor:</span> {e.vendor}</div>
                              <div className="col-span-2 truncate text-zinc-400">{e.description}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {type === 'receipt' && (
                        <div className="text-sm">
                          {unlinked.transactions.filter(t => t.id === selectedLinkId).map(t => (
                            <div key={t.id} className="grid grid-cols-2 gap-x-4 gap-y-2">
                              <div><span className="text-zinc-500">Amount:</span> <span className="font-bold">${Math.abs(t.amount).toFixed(2)}</span></div>
                              <div><span className="text-zinc-500">Date:</span> {new Date(t.date).toLocaleDateString()}</div>
                              <div className="col-span-2 truncate"><span className="text-zinc-500">Desc:</span> {t.description}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <button 
                      onClick={handleLink}
                      className="px-6 py-3 rounded-md font-bold bg-blue-600 hover:bg-blue-500 text-white w-full lg:w-auto shrink-0 transition"
                    >
                      Confirm Link
                    </button>
                  </div>
                )}
                
              </div>
            </div>
          )}
        </div>

      </div>

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-4xl w-full flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-zinc-700 flex justify-between items-center">
              <h3 className="font-bold text-lg">Physical Receipt</h3>
              <button onClick={() => setShowModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto flex items-center justify-center bg-zinc-950 min-h-75">
              {expense?.receipts && expense.receipts.length > 0 ? (
                <div className="text-center space-y-4">
                  <p className="text-zinc-500 italic">File: {expense.receipts[0].documentUri.split('/').pop()}</p>
                  <p className="text-xs text-zinc-600">In a production environment, this would display the PDF/Image natively using an img tag or pdf viewer.</p>
                </div>
              ) : (
                <p className="text-zinc-500">No physical receipt attached.</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
