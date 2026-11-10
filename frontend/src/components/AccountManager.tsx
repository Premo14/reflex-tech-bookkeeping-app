import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import type { ChartAccount, CreateChartAccountInput, UpdateChartAccountInput } from "../types/models";
import { createChartAccount, updateChartAccount, deleteChartAccount } from "../services/api";
import { useConfirm } from "./ui/ConfirmDialog";

export type { SubClassDef } from "../utils/accountHierarchy";
export { ACCOUNT_SUBCLASSES, getSubClassForAccount, getAccountDepth } from "../utils/accountHierarchy";
import type { SubClassDef } from "../utils/accountHierarchy";
import { ACCOUNT_SUBCLASSES, getSubClassForAccount, getAccountDepth } from "../utils/accountHierarchy";


export function getDescendantIds(rootId: number, allAccounts: ChartAccount[]): Set<number> {
  const descendants = new Set<number>();
  function recurse(parentId: number) {
    for (const a of allAccounts) {
      if (a.parentId === parentId && !descendants.has(a.id)) {
        descendants.add(a.id);
        recurse(a.id);
      }
    }
  }
  recurse(rootId);
  return descendants;
}

export function getNextAvailableCodeInRange(min: number, max: number, existingAccounts: ChartAccount[]): string {
  const existingCodes = new Set(existingAccounts.map(a => parseInt(a.code, 10)).filter(n => !isNaN(n)));
  for (let candidate = min; candidate <= max; candidate += 10) {
    if (!existingCodes.has(candidate)) {
      return String(candidate);
    }
  }
  for (let candidate = min; candidate <= max; candidate++) {
    if (!existingCodes.has(candidate)) {
      return String(candidate);
    }
  }
  return String(min);
}

interface AccountManagerProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: ChartAccount[];
  refreshAccounts: () => void;
}

export const SCHEDULE_C_OPTIONS = [
  { value: "", label: "-- None / Not Applicable --" },
  { value: "Line 1 - Gross receipts or sales", label: "Line 1 - Gross receipts or sales (Revenue)" },
  { value: "Line 2 - Returns and allowances", label: "Line 2 - Returns & allowances" },
  { value: "Line 4 - Cost of goods sold", label: "Line 4 - Cost of goods sold (COGS)" },
  { value: "Line 6 - Other income", label: "Line 6 - Other income (Interest, refunds)" },
  { value: "Line 8 - Advertising", label: "Line 8 - Advertising & marketing" },
  { value: "Line 9 - Car and truck expenses", label: "Line 9 - Car and truck expenses" },
  { value: "Line 10 - Commissions and fees", label: "Line 10 - Commissions and fees" },
  { value: "Line 11 - Contract labor", label: "Line 11 - Contract labor (1099)" },
  { value: "Line 12 - Depletion", label: "Line 12 - Depletion" },
  { value: "Line 13 - Depreciation", label: "Line 13 - Depreciation & Sec 179" },
  { value: "Line 14 - Employee benefit programs", label: "Line 14 - Employee benefits" },
  { value: "Line 15 - Insurance (other than health)", label: "Line 15 - Insurance (liability, business)" },
  { value: "Line 16a - Mortgage interest", label: "Line 16a - Mortgage interest" },
  { value: "Line 16b - Other interest", label: "Line 16b - Other interest (loans, credit card interest)" },
  { value: "Line 17 - Legal and professional services", label: "Line 17 - Legal and professional services" },
  { value: "Line 18 - Office expense", label: "Line 18 - Office expense & supplies" },
  { value: "Line 19 - Pension and profit-sharing", label: "Line 19 - Pension and profit-sharing" },
  { value: "Line 20a - Rent (vehicles, machinery)", label: "Line 20a - Rent (vehicles, machinery, equipment)" },
  { value: "Line 20b - Rent or lease (other business property)", label: "Line 20b - Rent/lease (office, property)" },
  { value: "Line 21 - Repairs and maintenance", label: "Line 21 - Repairs and maintenance" },
  { value: "Line 22 - Supplies", label: "Line 22 - Supplies & materials" },
  { value: "Line 23 - Taxes and licenses", label: "Line 23 - Taxes and licenses" },
  { value: "Line 24a - Travel", label: "Line 24a - Travel & lodging" },
  { value: "Line 24b - Deductible meals (50%)", label: "Line 24b - Deductible meals (50% IRS limit)" },
  { value: "Line 25 - Utilities", label: "Line 25 - Utilities (electric, internet, phone)" },
  { value: "Line 26 - Wages", label: "Line 26 - Wages & salaries" },
  { value: "Line 27a - Other expenses", label: "Line 27a - Other expenses (Software, bank fees, misc)" },
];

export default function AccountManager({ isOpen, onClose, accounts, refreshAccounts }: AccountManagerProps) {
  const { confirm } = useConfirm();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

  const TYPE_METADATA: Record<string, { label: string; desc: string }> = {
    ASSET: { label: "Assets", desc: "Bank accounts, cash on hand, receivables, inventory" },
    LIABILITY: { label: "Liabilities", desc: "Credit cards, bank loans, payables" },
    EQUITY: { label: "Equity", desc: "Owner's capital, draws, retained earnings" },
    REVENUE: { label: "Revenue", desc: "Product sales, service fees, interest" },
    EXPENSE: { label: "Expenses", desc: "Operating expenses & business costs" },
  };

  const selectedAccount = accounts.find(a => a.id === editingId);
  const isEditingDefault = Boolean(selectedAccount?.isDefault);

  const currentSubClass = getSubClassForAccount(formData.type || "EXPENSE", formData.code || "", formData.subClassId)
    || (ACCOUNT_SUBCLASSES[formData.type || "EXPENSE"] || [])[0];
  const currentPrefix = currentSubClass?.prefix || "10";
  const rawCode = (formData.code || "").trim();
  const suffixCode = rawCode.startsWith(currentPrefix) 
    ? rawCode.slice(currentPrefix.length) 
    : (rawCode.length > 2 ? rawCode.slice(2) : rawCode);

  const handleCreateNew = () => {
    setIsCreating(true);
    setEditingId(null);
    const defaultSubClass = ACCOUNT_SUBCLASSES["EXPENSE"][0];
    const suggestedCode = getNextAvailableCodeInRange(defaultSubClass.min, defaultSubClass.max, accounts);
    setFormData({
      code: suggestedCode,
      subClassId: defaultSubClass.id,
      name: "",
      type: "EXPENSE",
      description: "",
      scheduleCLine: "",
      active: true,
      parentId: undefined,
    });
    setError("");
  };

  const handleEdit = (acc: ChartAccount) => {
    setIsCreating(false);
    setEditingId(acc.id);
    const sc = getSubClassForAccount(acc.type, acc.code);
    setFormData({
      code: acc.code,
      subClassId: sc?.id,
      name: acc.name,
      type: acc.type,
      parentId: acc.parentId,
      description: acc.description,
      scheduleCLine: acc.scheduleCLine || "",
      active: acc.active,
      isDefault: acc.isDefault,
    });
    setError("");
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setError("");
  };

  const handleTypeChange = (newType: string) => {
    const subClasses = ACCOUNT_SUBCLASSES[newType] || [];
    const defaultSubClass = subClasses[0];
    const suggestedCode = defaultSubClass
      ? getNextAvailableCodeInRange(defaultSubClass.min, defaultSubClass.max, accounts)
      : ((defaultSubClass as SubClassDef | undefined)?.prefix || "10") + "10";

    setFormData({
      ...formData,
      type: newType,
      subClassId: defaultSubClass?.id,
      code: suggestedCode,
      parentId: undefined, // reset parent when type changes
    });
  };

  const handleSubCategoryChange = (subClassId: string) => {
    const list = ACCOUNT_SUBCLASSES[formData.type || "EXPENSE"] || [];
    const chosen = list.find(sc => sc.id === subClassId);
    if (!chosen) return;
    const suggestedCode = getNextAvailableCodeInRange(chosen.min, chosen.max, accounts);
    setFormData({
      ...formData,
      subClassId: chosen.id,
      code: suggestedCode,
    });
  };

  const handleSuffixChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/\D/g, "");
    if (raw.length === 4 && raw.startsWith(currentPrefix)) {
      raw = raw.slice(2);
    }
    raw = raw.slice(0, 2);
    setFormData({
      ...formData,
      code: currentPrefix + raw,
    });
  };

  const handleSave = async () => {
    setError("");
    const cleanCode = (formData.code || "").trim();
    const cleanName = (formData.name || "").trim();

    if (!cleanCode || !cleanName || !formData.type) {
      setError("Code, Name, and Type are required.");
      return;
    }

    if (!/^\d+$/.test(cleanCode)) {
      setError("Account Code must contain numbers only.");
      return;
    }

    if (cleanCode.length !== 4) {
      setError(`Account code must be exactly 4 digits (prefix ${currentPrefix} + 2 digits, e.g. ${currentPrefix}10).`);
      return;
    }

    if (!cleanCode.startsWith(currentPrefix)) {
      setError(`Account code for ${currentSubClass.name} must start with ${currentPrefix} (${currentPrefix}00-${currentPrefix}99).`);
      return;
    }

    // Check duplicate code across existing accounts
    const duplicateCode = accounts.find(a => a.code === cleanCode && a.id !== editingId);
    if (duplicateCode) {
      setError(`An account with code ${cleanCode} already exists (${duplicateCode.name}).`);
      return;
    }

    // Check duplicate name across existing accounts (case-insensitive)
    const duplicateName = accounts.find(a => a.name.trim().toLowerCase() === cleanName.toLowerCase() && a.id !== editingId);
    if (duplicateName) {
      setError(`An account with name '${cleanName}' already exists (code ${duplicateName.code}).`);
      return;
    }

    // Smart Soft Guardrails: Hierarchy and Category validation
    if (formData.parentId) {
      const parentAcc = accounts.find(a => a.id === formData.parentId);
      if (parentAcc) {
        const childSubClass = getSubClassForAccount(formData.type, cleanCode);
        const parentSubClass = getSubClassForAccount(parentAcc.type, parentAcc.code);
        const warnings: string[] = [];

        // 1. Sub-Class / Category Mismatch Warning
        if (childSubClass && parentSubClass && childSubClass.id !== parentSubClass.id) {
          warnings.push(`• Category Mismatch: "${cleanName}" (${cleanCode}) belongs to ${childSubClass.name}, but parent "${parentAcc.name}" (${parentAcc.code}) is in ${parentSubClass.name}. In standard accounting, nesting liquid funds under physical inventory or equipment distorts Balance Sheet reporting.`);
        }

        // 2. Default Anchor Account Parenting Warning
        if (selectedAccount?.isDefault) {
          warnings.push(`• Default Anchor Account: "${cleanName}" (${cleanCode}) is a core system default account. Nesting default accounts under another account can alter standard financial rollups.`);
        }

        // 3. Depth Warning (> 2 parent depth means target depth >= 3)
        const parentDepth = getAccountDepth(parentAcc, accounts);
        if (parentDepth >= 2) {
          warnings.push(`• Deep Hierarchy (${parentDepth + 1} levels deep): Nesting under "${parentAcc.name}" will make this account ${parentDepth + 1} levels deep. Hierarchies deeper than 3 levels (Top → Sub → Sub-sub) can make dropdowns and financial reports hard to navigate.`);
        }

        if (warnings.length > 0) {
          const warningMessage = `The following hierarchy warnings were detected:\n\n${warnings.join("\n\n")}\n\nYou have full control over your Chart of Accounts. Would you like to proceed anyway or change the parent?`;

          const proceed = await confirm({
            title: "Unusual Account Hierarchy Detected",
            message: warningMessage,
            confirmText: "Proceed Anyway",
            cancelText: "Change Parent",
            variant: "secondary",
          });

          if (!proceed) {
            return;
          }
        }
      }
    }

    setIsSaving(true);
    try {
      const payload = {
        ...formData,
        code: cleanCode,
        name: cleanName,
        description: (formData.description || "").trim(),
        scheduleCLine: (formData.scheduleCLine || "").trim(),
      };
      if (isCreating) {
        await createChartAccount(payload as CreateChartAccountInput);
      } else if (editingId) {
        const updatePayload: UpdateChartAccountInput = {
          ...payload,
          parentId: formData.parentId ? Number(formData.parentId) : null,
        };
        await updateChartAccount(editingId, updatePayload);
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
    const ok = await confirm({
      title: "Delete Account",
      message: `Are you sure you want to delete account ${code}? This cannot be undone.`,
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteChartAccount(id);
      refreshAccounts();
    } catch (err: any) {
      setError(err.message || "Failed to delete account (it may have associated transactions).");
    }
  };

  const inputCls = "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors";
  const labelCls = "block text-[11px] font-medium text-zinc-400 mb-0.5 uppercase tracking-wider";

  // Group accounts for display
  const groupedAccounts = accounts.reduce((acc, account) => {
    if (!acc[account.type]) acc[account.type] = [];
    acc[account.type].push(account);
    return acc;
  }, {} as Record<string, ChartAccount[]>);

  const invalidParentIds = editingId ? getDescendantIds(editingId, accounts) : new Set<number>();
  if (editingId) invalidParentIds.add(editingId);

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={<div className="flex items-center gap-2"><svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>Chart of Accounts</div>}
      maxWidth="4xl"
      bodyClassName="p-4 md:p-6 overflow-y-auto md:overflow-hidden flex-1 min-h-0 flex flex-col"
    >

        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-8 overflow-hidden">
          
          {/* LEFT: List of Accounts */}
          <div className={`flex-1 overflow-y-auto pr-3 space-y-6 custom-scrollbar min-h-0 max-h-[calc(90vh-140px)] ${(isCreating || editingId) ? 'hidden md:block' : 'block'}`}>
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Existing Accounts</h3>
              <button 
                onClick={handleCreateNew}
                className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 px-2.5 py-1 rounded-md transition-colors border border-emerald-500/20"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                New Account
              </button>
            </div>

            {/* Quick Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search accounts by name or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-7 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-zinc-500 hover:text-white absolute right-2.5 top-2 text-xs p-0.5"
                >
                  ✕
                </button>
              )}
            </div>

            {error && !isCreating && !editingId && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">
                {error}
              </div>
            )}

            {accountTypes.map(type => {
              const typeAccounts = (groupedAccounts[type] || []).filter(acc => {
                if (!searchQuery.trim()) return true;
                const q = searchQuery.toLowerCase();
                return acc.code.toLowerCase().includes(q) || acc.name.toLowerCase().includes(q) || (acc.description || "").toLowerCase().includes(q);
              });
              if (typeAccounts.length === 0) return null;
              const meta = TYPE_METADATA[type] || { label: type, desc: "" };
              
              return (
                <div key={type} className="space-y-2">
                  <div className="border-b border-zinc-800 pb-1.5 flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">{meta.label}</h4>
                      <span className="text-[10px] text-zinc-400 bg-white/5 border border-white/5 px-1.5 py-0.2 rounded font-mono font-normal">
                        {typeAccounts.length}
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-400 font-normal truncate">{meta.desc}</span>
                  </div>
                  <div className="space-y-1.5">
                    {typeAccounts.sort((a,b) => a.code.localeCompare(b.code)).map(acc => {
                      const accSubClass = getSubClassForAccount(acc.type, acc.code);
                      return (
                        <div key={acc.id} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${editingId === acc.id ? 'bg-zinc-800 border-emerald-500/50' : 'bg-zinc-950 border-zinc-800/50 hover:border-zinc-700'}`}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-mono text-emerald-400 font-medium">{acc.code}</span>
                              <span className="text-sm font-semibold text-zinc-200 truncate">{acc.name}</span>
                              {accSubClass && (
                                <span className="text-[10px] bg-zinc-800/90 text-zinc-300 border border-zinc-700/60 px-1.5 py-0.2 rounded font-medium truncate max-w-35" title={accSubClass.description}>
                                  {accSubClass.name}
                                </span>
                              )}
                              {acc.parentId && (() => {
                                const parentAcc = accounts.find(p => p.id === acc.parentId);
                                return (
                                  <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700/60 px-1.5 py-0.2 rounded font-medium truncate max-w-37.5" title={`Sub-account of ${parentAcc?.code || ''} ${parentAcc?.name || ''}`}>
                                    ↳ {parentAcc?.code || 'Sub'}
                                  </span>
                                );
                              })()}
                              {acc.isDefault && (
                                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 rounded uppercase tracking-wider font-bold">
                                  Default
                                </span>
                              )}
                              {acc.scheduleCLine && (
                                <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 px-1.5 py-0.2 rounded font-medium truncate max-w-44" title={`IRS Schedule C: ${acc.scheduleCLine}`}>
                                  📋 {acc.scheduleCLine.split("-")[0].trim()}
                                </span>
                              )}
                              {!acc.active && (
                                <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 rounded uppercase tracking-wider font-semibold">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-400 truncate mt-0.5">
                              {acc.description ? (
                                <span>{acc.description}</span>
                              ) : (
                                <span className="text-zinc-500 italic text-[11px]">No description</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-4 shrink-0">
                            <button onClick={() => handleEdit(acc)} className="text-zinc-400 hover:text-white p-1 transition-colors" title="Edit">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                            </button>
                            {acc.isDefault ? (
                              <span className="text-zinc-600 p-1 cursor-not-allowed" title="Default accounts cannot be deleted (toggle Active to hide)">
                                <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                              </span>
                            ) : (
                              <button onClick={() => handleDelete(acc.id, acc.code)} className="text-zinc-400 hover:text-red-400 p-1 transition-colors" title="Delete">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT: Edit/Create Form */}
          <div className={`md:w-84 shrink-0 flex flex-col justify-center my-auto max-h-[calc(90vh-140px)] min-w-0 max-w-full ${(isCreating || editingId) ? 'block flex-1' : 'hidden md:flex'}`}>
            {(isCreating || editingId) ? (
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-xl flex flex-col max-h-full overflow-hidden min-w-0">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/80 shrink-0">
                  <div className="flex items-center gap-2">
                    <button 
                      type="button" 
                      onClick={handleCancel} 
                      className="md:hidden text-zinc-400 hover:text-white mr-1 text-xs px-1.5 py-0.5 rounded bg-zinc-800"
                    >
                      ← Back
                    </button>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                      {isCreating ? "Create Account" : isEditingDefault ? "Edit Default Account" : "Edit Custom Account"}
                    </h3>
                  </div>
                </div>

                {(error && (isCreating || editingId)) && (
                  <div className="mb-2 p-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs shrink-0">
                    {error}
                  </div>
                )}

                <div className="space-y-2.5 overflow-y-auto overflow-x-hidden pr-1.5 custom-scrollbar flex-1 min-h-0 min-w-0">
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <label className={labelCls}>Type</label>
                      {isEditingDefault && (
                        <span className="text-[10px] text-zinc-500">Locked on default accounts</span>
                      )}
                    </div>
                    <Select 
                      disabled={isEditingDefault}
                      className={`${inputCls} ${isEditingDefault ? 'opacity-60 cursor-not-allowed bg-zinc-900/80' : ''}`} 
                      value={formData.type || "EXPENSE"} 
                      onChange={e => handleTypeChange(e.target.value)}
                    >
                      {accountTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <label className={labelCls}>Sub-Category</label>
                      {currentSubClass && (
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {currentSubClass.min}–{currentSubClass.max}
                        </span>
                      )}
                    </div>
                    <Select
                      className={inputCls}
                      value={currentSubClass?.id || ""}
                      onChange={e => handleSubCategoryChange(e.target.value)}
                    >
                      {(ACCOUNT_SUBCLASSES[formData.type || "EXPENSE"] || []).map(sc => (
                        <option key={sc.id} value={sc.id}>
                          {sc.min}–{sc.max}: {sc.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <label className={labelCls}>
                        Account Code (4 Digits)
                      </label>
                      <span className="text-[10px] text-emerald-400/90 font-mono font-medium">
                        Prefix: {currentPrefix}
                      </span>
                    </div>
                    <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden focus-within:border-emerald-500 transition-colors">
                      <div className="bg-zinc-900 px-3 py-1.5 text-sm font-mono font-bold text-emerald-400 border-r border-zinc-800 select-none flex items-center gap-1 shrink-0" title={`Fixed 2-digit prefix for ${currentSubClass.name}`}>
                        <span>{currentPrefix}</span>
                      </div>
                      <input 
                        type="text" 
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        className="w-full bg-transparent px-3 py-1.5 text-sm font-mono text-white placeholder-zinc-600 focus:outline-none" 
                        placeholder="e.g. 10" 
                        value={suffixCode} 
                        onChange={handleSuffixChange} 
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Account Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Checking Account" 
                      value={formData.name || ""} 
                      onChange={e => setFormData({ ...formData, name: e.target.value })} 
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Parent Account (Optional)</label>
                    <Select 
                      className={inputCls}
                      value={formData.parentId ? String(formData.parentId) : ""} 
                      onChange={e => setFormData({ ...formData, parentId: e.target.value ? Number(e.target.value) : undefined })}
                    >
                      <option value="">None (Top-Level Account)</option>
                      {accounts
                        .filter(a => a.type === formData.type && !invalidParentIds.has(a.id) && a.active)
                        .map(a => {
                          const pSubClass = getSubClassForAccount(a.type, a.code);
                          const depth = getAccountDepth(a, accounts);
                          const prefixGlyph = depth > 0 ? "↳ ".repeat(depth) : "";
                          return (
                            <option key={a.id} value={a.id}>
                              {prefixGlyph}{a.code} — {a.name}{pSubClass ? ` (${pSubClass.name})` : ""}
                            </option>
                          );
                        })}
                    </Select>
                  </div>

                  <div>
                    <label className={labelCls}>IRS Schedule C Line (Tax Mapping)</label>
                    <Select
                      className={inputCls}
                      value={formData.scheduleCLine || ""}
                      onChange={e => setFormData({ ...formData, scheduleCLine: e.target.value })}
                    >
                      {SCHEDULE_C_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                    <p className="text-[10px] text-zinc-500 mt-1">
                      Links this account directly to Form 1040 Schedule C for 1-click tax prep & export.
                    </p>
                  </div>

                  <div>
                    <label className={labelCls}>Description (Optional)</label>
                    <textarea 
                      className={`${inputCls} resize-none h-14`} 
                      placeholder="e.g. Operating checking account or notes"
                      value={formData.description || ""} 
                      onChange={e => setFormData({ ...formData, description: e.target.value })} 
                    />
                  </div>

                  {!isCreating && (
                    <div 
                      className="flex items-center gap-2.5 pt-0.5 cursor-pointer group w-fit"
                      onClick={() => setFormData({ ...formData, active: !formData.active })}
                    >
                      <div className={`w-4 h-4 rounded-md flex items-center justify-center border transition-all duration-200 ${formData.active ? 'bg-emerald-500 border-emerald-500 text-black shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border-white/10 text-transparent group-hover:border-white/20'}`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                      </div>
                      <span className="text-xs font-medium text-zinc-300 group-hover:text-white transition-colors select-none">Account is Active</span>
                    </div>
                  )}
                </div>

                {/* Sticky Pinned Buttons */}
                <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-2.5 shrink-0 bg-zinc-950">
                  <Button variant="secondary" onClick={handleCancel} className="flex-1 py-1.5 text-xs">Cancel</Button>
                  <button 
                    onClick={handleSave} 
                    disabled={isSaving} 
                    className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                  >
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center text-center px-6 border-2 border-dashed border-zinc-800/50 rounded-xl bg-white/2">
                <svg className="w-10 h-10 text-zinc-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"></path></svg>
                <p className="text-zinc-400 text-sm">Select an account to edit, or create a new one.</p>
              </div>
            )}
          </div>
        </div>
    </Modal>
  );
}
