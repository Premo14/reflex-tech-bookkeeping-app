import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import type { ChartAccount, CreateChartAccountInput, UpdateChartAccountInput } from "../types/models";
import { createChartAccount, updateChartAccount, deleteChartAccount } from "../services/api";

interface AccountManagerProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: ChartAccount[];
  refreshAccounts: () => void;
}

export default function AccountManager({ isOpen, onClose, accounts, refreshAccounts }: AccountManagerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

  const handleCreateNew = () => {
    setIsCreating(true);
    setEditingId(null);
    setFormData({ code: "", name: "", type: "EXPENSE", description: "", active: true });
    setError("");
  };

  const handleEdit = (acc: ChartAccount) => {
    setIsCreating(false);
    setEditingId(acc.id);
    setFormData({ code: acc.code, name: acc.name, type: acc.type, description: acc.description, active: acc.active });
    setError("");
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setError("");
  };

  const handleSave = async () => {
    setError("");
    if (!formData.code || !formData.name || !formData.type) {
      setError("Code, Name, and Type are required.");
      return;
    }

    setIsSaving(true);
    try {
      if (isCreating) {
        await createChartAccount(formData as CreateChartAccountInput);
      } else if (editingId) {
        await updateChartAccount(editingId, formData as UpdateChartAccountInput);
      }
      refreshAccounts();
      handleCancel();
    } catch (err: any) {
      setError(err.message || "Failed to save account");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number, code: string) => {
    if (!confirm(`Are you sure you want to delete account ${code}? This cannot be undone.`)) return;
    try {
      await deleteChartAccount(id);
      refreshAccounts();
    } catch (err: any) {
      setError(err.message || "Failed to delete account (it may have associated transactions).");
    }
  };

  const inputCls = "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors";
  const labelCls = "block text-xs font-medium text-zinc-400 mb-1 uppercase tracking-wider";

  // Group accounts for display
  const groupedAccounts = accounts.reduce((acc, account) => {
    if (!acc[account.type]) acc[account.type] = [];
    acc[account.type].push(account);
    return acc;
  }, {} as Record<string, ChartAccount[]>);

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={<div className="flex items-center gap-2"><svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>Chart of Accounts</div>}
      maxWidth="4xl"
    >

        <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-8">
          
          {/* LEFT: List of Accounts */}
          <div className="flex-1 space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Existing Accounts</h3>
              <button 
                onClick={handleCreateNew}
                className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded-md transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                New Account
              </button>
            </div>

            {error && !isCreating && !editingId && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">
                {error}
              </div>
            )}

            {accountTypes.map(type => {
              const typeAccounts = groupedAccounts[type] || [];
              if (typeAccounts.length === 0) return null;
              
              return (
                <div key={type} className="space-y-2">
                  <h4 className="text-xs font-medium text-zinc-400 border-b border-zinc-800 pb-1">{type}</h4>
                  <div className="space-y-1.5">
                    {typeAccounts.sort((a,b) => a.code.localeCompare(b.code)).map(acc => (
                      <div key={acc.id} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${editingId === acc.id ? 'bg-zinc-800 border-emerald-500/50' : 'bg-zinc-950 border-zinc-800/50 hover:border-zinc-700'}`}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono text-emerald-400">{acc.code}</span>
                            <span className="text-sm font-semibold text-zinc-200 truncate">{acc.name}</span>
                            {!acc.active && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 rounded uppercase tracking-wider font-semibold">Inactive</span>}
                          </div>
                          <p className="text-xs text-zinc-400 truncate mt-0.5">{acc.description || "No description"}</p>
                        </div>
                        <div className="flex items-center gap-2 ml-4 shrink-0">
                          <button onClick={() => handleEdit(acc)} className="text-zinc-400 hover:text-white p-1" title="Edit">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                          </button>
                          <button onClick={() => handleDelete(acc.id, acc.code)} className="text-zinc-400 hover:text-red-400 p-1" title="Delete">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT: Edit/Create Form */}
          <div className="md:w-80 shrink-0">
            {(isCreating || editingId) ? (
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 sticky top-0">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                  {isCreating ? "Create Account" : "Edit Account"}
                </h3>

                {(error && (isCreating || editingId)) && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Account Code</label>
                    <Input label="Account Code" type="text" className="font-mono" placeholder="e.g. 1010" value={formData.code || ""} onChange={e => setFormData({ ...formData, code: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Name</label>
                    <Input label="Account Name" type="text" placeholder="e.g. Checking Account" value={formData.name || ""} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Type</label>
                    <Select 
                      className={inputCls} 
                      value={formData.type || "EXPENSE"} 
                      onChange={e => setFormData({ ...formData, type: e.target.value })}
                    >
                      {accountTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className={labelCls}>Description (Optional)</label>
                    <textarea 
                      className={`${inputCls} resize-none h-20`} 
                      value={formData.description || ""} 
                      onChange={e => setFormData({ ...formData, description: e.target.value })} 
                    />
                  </div>
                  {!isCreating && (
                    <div 
                      className="flex items-center gap-3 pt-2 cursor-pointer group w-fit"
                      onClick={() => setFormData({ ...formData, active: !formData.active })}
                    >
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all duration-200 ${formData.active ? 'bg-emerald-500 border-emerald-500 text-black shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border-white/10 text-transparent group-hover:border-white/20'}`}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                      </div>
                      <span className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors select-none">Account is Active</span>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex gap-3 pt-4 border-t border-zinc-800">
                  <Button variant="secondary" onClick={handleCancel} className="flex-1">Cancel</Button>
                  <button 
                    onClick={handleSave} 
                    disabled={isSaving} 
                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
                  >
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center text-center px-6 border-2 border-dashed border-zinc-800/50 rounded-xl bg-white/[0.02]">
                <svg className="w-10 h-10 text-zinc-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"></path></svg>
                <p className="text-zinc-400 text-sm">Select an account to edit, or create a new one.</p>
              </div>
            )}
          </div>
        </div>
    </Modal>
  );
}
