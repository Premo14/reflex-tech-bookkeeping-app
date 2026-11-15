import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { MoneyInput } from "./ui/MoneyInput";
import type { ChartAccount, Expense } from "../types/models";
import { splitExpense, type SplitLineInput } from "../services/api";
import { getGroupedAccounts } from "../utils/accountHierarchy";
import { formatCurrency, fromCents, toCents } from "../utils/formatCurrency";
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

function buildInitialSplits(expense: Expense): SplitRowState[] {
  const totalCents = toCents(expense.amount);
  const halfCents = Math.round(totalCents / 2);
  const otherHalfCents = totalCents - halfCents;

  return [
    {
      id: "row_1",
      amount: fromCents(halfCents),
      chartAccountId: expense.chartAccountId || null,
      description: expense.description || "Business portion",
      isPersonal: false,
    },
    {
      id: "row_2",
      amount: fromCents(otherHalfCents),
      chartAccountId: null,
      description: "Personal items / Non-deductible",
      isPersonal: true,
    },
  ];
}

export default function SplitExpenseModal({
  isOpen,
  onClose,
  expense,
  accounts,
  onSplitSuccess,
}: SplitExpenseModalProps) {
  const { alert } = useConfirm();
  const baseId = useId();
  const nextRowSeqRef = useRef(3);
  const [splits, setSplits] = useState<SplitRowState[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !expense) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        setSplits(buildInitialSplits(expense));
      }
    });
    return () => {
      active = false;
    };
  }, [isOpen, expense]);

  if (!isOpen) return null;

  const groupedAccounts = getGroupedAccounts(accounts, ["EXPENSE"]);

  const totalAllocatedCents = splits.reduce(
    (acc, s) => acc + toCents(s.amount || 0),
    0
  );
  const originalTotalCents = toCents(expense.amount);
  const remainingCents = originalTotalCents - totalAllocatedCents;
  const totalAllocated = fromCents(totalAllocatedCents);
  const originalTotal = fromCents(originalTotalCents);
  const remaining = fromCents(remainingCents);
  const isBalanced = splits.length >= 2 && remainingCents === 0;

  const handleAddSplit = () => {
    const nextAmount = remainingCents > 0 ? remaining : 0;
    const rowId = `row_${nextRowSeqRef.current++}`;
    setSplits((prev) => [
      ...prev,
      {
        id: rowId,
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
    const otherCents = splits.reduce(
      (sum, s, i) => (i !== idx ? sum + toCents(s.amount || 0) : sum),
      0
    );
    const newCents = Math.max(0, originalTotalCents - otherCents);
    updateSplit(idx, { amount: fromCents(newCents) });
  };

  const handleSubmit = async () => {
    if (!isBalanced) {
      await alert({
        title: "Unbalanced Split",
        message: `Total allocated (${formatCurrency(totalAllocated)}) must equal the receipt total (${formatCurrency(originalTotal)}). Difference: ${formatCurrency(remaining)}`,
        variant: "danger",
      });
      return;
    }

    for (let i = 0; i < splits.length; i++) {
      if (toCents(splits[i].amount || 0) <= 0) {
        await alert({
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
        amount: fromCents(toCents(s.amount || 0)),
        chartAccountId: s.isPersonal ? null : s.chartAccountId,
        description: s.description.trim() || `${expense.vendor} purchase`,
        vendor: expense.vendor,
        isPersonal: s.isPersonal,
      }));

      await splitExpense(expense.id, payload);
      onSplitSuccess();
      onClose();
    } catch (err: unknown) {
      console.error("Failed to split expense:", err);
      await alert({
        title: "Error Splitting Receipt",
        message:
          err instanceof Error ? err.message : "Failed to split receipt.",
        variant: "danger",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

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
              <span className="text-base font-bold text-white">
                {expense.vendor || "Receipt Expense"}
              </span>
              <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
                #{expense.id}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Original Receipt Total:{" "}
              <span className="font-bold font-mono tabular-nums text-emerald-400">
                {formatCurrency(originalTotal)}
              </span>
            </p>
          </div>

          <div className="sm:text-right">
            <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold block mb-1">
              Allocation Status
            </span>
            {isBalanced ? (
              <Badge variant="success" glow>
                ✓ Balanced (100%)
              </Badge>
            ) : (
              <Badge variant="warning" glow className="font-mono tabular-nums">
                Remaining: {formatCurrency(remaining)}
              </Badge>
            )}
          </div>
        </div>

        <p className="text-xs text-zinc-400">
          Separate co-mingled personal expenses from legitimate business
          deductions, or divide a bulk purchase across multiple expense
          accounts. Each split retains access to the original receipt image.
        </p>

        {/* Split Lines Container */}
        <div className="space-y-3">
          {splits.map((s, idx) => {
            const amtId = `${baseId}-amt-${s.id}`;
            const catId = `${baseId}-cat-${s.id}`;
            const descId = `${baseId}-desc-${s.id}`;
            const chkId = `${baseId}-personal-${s.id}`;

            return (
              <div
                key={s.id}
                className={`p-3.5 rounded-xl border transition-colors ${
                  s.isPersonal
                    ? "bg-purple-950/20 border-purple-500/30 glow-border-purple"
                    : "bg-zinc-950/80 border-zinc-800 hover:border-white/15"
                }`}
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-white">
                      Line #{idx + 1}
                    </span>
                    {s.isPersonal && (
                      <Badge variant="purple" size="sm">
                        Personal / Non-Deductible
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAutoFillRemaining(idx)}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 px-2 py-0.5 rounded touch-glow-emerald transition-colors cursor-pointer"
                    >
                      Fill Remaining
                    </button>
                    {splits.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSplit(idx)}
                        className="text-xs text-rose-400 hover:text-rose-300 min-w-[28px] min-h-[28px] flex items-center justify-center rounded touch-glow-rose transition-colors cursor-pointer"
                        title="Remove split line"
                        aria-label={`Remove split line ${idx + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                  {/* Amount */}
                  <div className="sm:col-span-3">
                    <MoneyInput
                      id={amtId}
                      label="Amount ($)"
                      value={s.amount}
                      onChange={(val) =>
                        updateSplit(idx, { amount: fromCents(toCents(val || 0)) })
                      }
                    />
                  </div>

                  {/* Category */}
                  <div className="sm:col-span-4">
                    {s.isPersonal ? (
                      <div>
                        <span className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                          Category Account
                        </span>
                        <div className="min-h-[38px] flex items-center px-3 bg-zinc-900/60 border border-zinc-800/80 rounded-lg text-xs text-zinc-400 italic">
                          Excluded (Owner / Personal)
                        </div>
                      </div>
                    ) : (
                      <Select
                        id={catId}
                        label="Category Account"
                        searchable
                        value={s.chartAccountId ? String(s.chartAccountId) : ""}
                        onChange={(e) =>
                          updateSplit(idx, {
                            chartAccountId: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      >
                        <option value="">-- Uncategorized --</option>
                        {groupedAccounts.map((g) => (
                          <optgroup
                            key={g.subClassId}
                            label={`── ${g.label.toUpperCase()} ──`}
                          >
                            {g.options.map((opt) => (
                              <option
                                key={opt.account.id}
                                value={opt.account.id}
                              >
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
                    <Input
                      id={descId}
                      label="Description / Item Details"
                      value={s.description}
                      onChange={(e) =>
                        updateSplit(idx, { description: e.target.value })
                      }
                      placeholder="e.g. Printer ink, printer paper, etc."
                    />
                  </div>
                </div>

                {/* Personal Toggle */}
                <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={chkId}
                    checked={s.isPersonal}
                    onChange={(e) =>
                      updateSplit(idx, {
                        isPersonal: e.target.checked,
                        chartAccountId: e.target.checked
                          ? null
                          : s.chartAccountId,
                      })
                    }
                    className="rounded border-zinc-700 bg-zinc-900 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                  <label
                    htmlFor={chkId}
                    className="text-xs text-zinc-300 cursor-pointer select-none"
                  >
                    Mark as Personal Expense (co-mingled purchase — exclude
                    from Schedule C tax write-offs)
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Split Button */}
        <div className="flex flex-wrap justify-between items-center gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAddSplit}
          >
            + Add Another Split Line
          </Button>

          <div className="text-right text-xs">
            <span className="text-zinc-400">Total: </span>
            <span className="font-mono tabular-nums font-bold text-white mr-3">
              {formatCurrency(totalAllocated)}
            </span>
            <span className="text-zinc-400">Target: </span>
            <span className="font-mono tabular-nums font-bold text-white">
              {formatCurrency(originalTotal)}
            </span>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            glow
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={isSubmitting}
          >
            Apply Receipt Split
          </Button>
        </div>
      </div>
    </Modal>
  );
}
