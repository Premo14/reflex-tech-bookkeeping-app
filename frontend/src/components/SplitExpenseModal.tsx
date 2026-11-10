import { useState, useEffect } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { MoneyInput } from "./ui/MoneyInput";
import type { Expense, ChartAccount } from "../types/models";
import { splitExpense, type SplitLineInput } from "../services/api";
import { getGroupedAccounts } from "../utils/accountHierarchy";
import { useConfirm } from "./ui/ConfirmDialog";

interface SplitExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense;
  accounts: ChartAccount[];
  onSplitSuccess: () => void;
}

interface SplitRowState {
  id: string;
  amount: number;
  chartAccountId: number | null;
  description: string;
  isPersonal: boolean;
}

export default function SplitExpenseModal({
  isOpen,
  onClose,
  expense,
  accounts,
  onSplitSuccess,
}: SplitExpenseModalProps) {
  const { alert } = useConfirm();
  const [splits, setSplits] = useState<SplitRowState[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && expense) {
      // Initialize with 2 split lines
      const half = Math.round((expense.amount / 2) * 100) / 100;
      const otherHalf = Math.round((expense.amount - half) * 100) / 100;

      setSplits([
        {
          id: "row_1",
          amount: half,
          chartAccountId: expense.chartAccountId || null,
          description: expense.description || "Business portion",
          isPersonal: false,
        },
        {
          id: "row_2",
          amount: otherHalf,
          chartAccountId: null,
          description: "Personal items / Non-deductible",
          isPersonal: true,
        },
      ]);
    }
  }, [isOpen, expense]);

  if (!isOpen) return null;

  const groupedAccounts = getGroupedAccounts(accounts, ["EXPENSE"]);

  const totalAllocated = Math.round(splits.reduce((acc, s) => acc + (s.amount || 0), 0) * 100) / 100;
  const originalTotal = Math.round(expense.amount * 100) / 100;
  const remaining = Math.round((originalTotal - totalAllocated) * 100) / 100;
  const isBalanced = Math.abs(remaining) < 0.009;

  const handleAddSplit = () => {
    const nextAmount = remaining > 0 ? remaining : 0;
    setSplits((prev) => [
      ...prev,
      {
        id: `row_${Date.now()}`,
        amount: nextAmount,
        chartAccountId: null,
        description: "",
        isPersonal: false,
      },
    ]);
  };

  const handleRemoveSplit = (idx: number) => {
    if (splits.length <= 2) return;
    setSplits((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSplit = (idx: number, patch: Partial<SplitRowState>) => {
    setSplits((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const handleAutoFillRemaining = (idx: number) => {
    const otherSum = splits.reduce((sum, s, i) => (i !== idx ? sum + (s.amount || 0) : sum), 0);
    const newAmt = Math.max(0, Math.round((originalTotal - otherSum) * 100) / 100);
    updateSplit(idx, { amount: newAmt });
  };

  const handleSubmit = async () => {
    if (!isBalanced) {
      alert({
        title: "Unbalanced Split",
        message: `Total allocated ($${totalAllocated.toFixed(2)}) must equal the receipt total ($${originalTotal.toFixed(2)}). Difference: $${remaining.toFixed(2)}`,
        variant: "danger",
      });
      return;
    }

    for (let i = 0; i < splits.length; i++) {
      if (!splits[i].amount || splits[i].amount <= 0) {
        alert({
          title: "Invalid Amount",
          message: `Split line #${i + 1} must have an amount greater than $0.00.`,
          variant: "danger",
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload: SplitLineInput[] = splits.map((s) => ({
        amount: Math.round((s.amount || 0) * 100) / 100,
        chartAccountId: s.isPersonal ? null : s.chartAccountId,
        description: s.description.trim() || `${expense.vendor} purchase`,
        vendor: expense.vendor,
        isPersonal: s.isPersonal,
      }));

      await splitExpense(expense.id, payload);
      onSplitSuccess();
      onClose();
    } catch (err: any) {
      console.error("Failed to split expense:", err);
      alert({
        title: "Error Splitting Receipt",
        message: err.message || "Failed to split receipt.",
        variant: "danger",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatMoney = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Split Receipt / Co-Mingled Purchase"
      maxWidth="2xl"
    >
      <div className="space-y-5 text-sm">
        {/* Receipt Header Banner */}
        <div className="bg-black/30 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-white">{expense.vendor || "Receipt Expense"}</span>
              <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
                #{expense.id}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Original Receipt Total: <span className="font-bold text-emerald-400">{formatMoney(originalTotal)}</span>
            </p>
          </div>

          <div className="text-right">
            <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold block">
              Allocation Status
            </span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block mt-0.5 ${
                isBalanced
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse"
              }`}
            >
              {isBalanced
                ? "✓ Balanced (100%)"
                : `Remaining: ${formatMoney(remaining)}`}
            </span>
          </div>
        </div>

        <p className="text-xs text-zinc-400">
          Separate co-mingled personal expenses from legitimate business deductions, or divide a bulk purchase across multiple expense accounts. Each split retains access to the original receipt image.
        </p>

        {/* Split Lines Container */}
        <div className="space-y-3">
          {splits.map((s, idx) => (
            <div
              key={s.id}
              className={`p-3.5 rounded-xl border transition-colors ${
                s.isPersonal
                  ? "bg-purple-950/20 border-purple-500/30"
                  : "bg-zinc-950 border-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-white">Line #{idx + 1}</span>
                  {s.isPersonal && (
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.2 rounded font-bold uppercase">
                      Personal / Non-Deductible
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleAutoFillRemaining(idx)}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                  >
                    Fill Remaining
                  </button>
                  {splits.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSplit(idx)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                      title="Remove split line"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                {/* Amount */}
                <div className="sm:col-span-3">
                  <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                    Amount ($)
                  </label>
                  <MoneyInput
                    value={s.amount}
                    onChange={(val) => updateSplit(idx, { amount: Math.round((val || 0) * 100) / 100 })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                {/* Category */}
                <div className="sm:col-span-4">
                  <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                    Category Account
                  </label>
                  {s.isPersonal ? (
                    <div className="h-8 flex items-center px-2.5 bg-zinc-900/60 border border-zinc-800/80 rounded-lg text-xs text-zinc-500 italic">
                      Excluded (Owner / Personal)
                    </div>
                  ) : (
                    <Select
                      value={s.chartAccountId ? String(s.chartAccountId) : ""}
                      onChange={(e) =>
                        updateSplit(idx, {
                          chartAccountId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">-- Uncategorized --</option>
                      {groupedAccounts.map((g) => (
                        <optgroup key={g.subClassId} label={`── ${g.label.toUpperCase()} ──`}>
                          {g.options.map((opt) => (
                            <option key={opt.account.id} value={opt.account.id}>
                              {opt.displayName}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  )}
                </div>

                {/* Description */}
                <div className="sm:col-span-5">
                  <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                    Description / Item Details
                  </label>
                  <Input
                    value={s.description}
                    onChange={(e) => updateSplit(idx, { description: e.target.value })}
                    placeholder="e.g. Printer ink, printer paper, etc."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Personal Toggle */}
              <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`personal_chk_${idx}`}
                  checked={s.isPersonal}
                  onChange={(e) =>
                    updateSplit(idx, {
                      isPersonal: e.target.checked,
                      chartAccountId: e.target.checked ? null : s.chartAccountId,
                    })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 text-purple-600 focus:ring-0 cursor-pointer"
                />
                <label
                  htmlFor={`personal_chk_${idx}`}
                  className="text-xs text-zinc-300 cursor-pointer select-none"
                >
                  Mark as Personal Expense (co-mingled purchase — exclude from Schedule C tax write-offs)
                </label>
              </div>
            </div>
          ))}
        </div>

        {/* Add Split Button */}
        <div className="flex justify-between items-center pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleAddSplit}
            className="text-xs"
          >
            + Add Another Split Line
          </Button>

          <div className="text-right text-xs">
            <span className="text-zinc-400">Total: </span>
            <span className="font-mono font-bold text-white mr-3">{formatMoney(totalAllocated)}</span>
            <span className="text-zinc-400">Target: </span>
            <span className="font-mono font-bold text-white">{formatMoney(originalTotal)}</span>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={!isBalanced || isSubmitting}
            className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold"
          >
            Apply Receipt Split
          </Button>
        </div>
      </div>
    </Modal>
  );
}
