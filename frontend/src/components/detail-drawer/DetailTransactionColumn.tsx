import React from "react";
import type { BankTransaction, ChartAccount, Expense } from "../../types/models";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { MoneyInput } from "../ui/MoneyInput";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { getGroupedAccounts } from "../../utils/accountHierarchy";
import { formatDate } from "../../utils/dateUtils";
import { formatCurrency } from "../../utils/formatCurrency";
import { normalizeAllocationStatus } from "../../utils/ledgerStatus";
import { extractCleanVendor } from "../../utils/vendorUtils";
import { AllocationProgressBar } from "./AllocationProgressBar";
import { DetailLinkedPagination } from "./DetailLinkedPagination";
import { computeTxAllocationCents } from "./helpers";
import type { ActionTarget, AllowConfirmState, CreateFormState, TxEditFormState } from "./types";

export interface DetailTransactionColumnProps {
  type: "transaction" | "receipt";
  activeTx: BankTransaction | null;
  activeExpense: Expense | null;
  transactionsList: BankTransaction[];
  expensesList: Expense[];
  activeTxIdx: number;
  activeExpenseIdx: number;
  onSelectTxIdx: (idx: number) => void;
  onSelectActiveExpenseIdx: (idx: number) => void;
  accounts: ChartAccount[];
  isClosed: boolean;
  itemAwaitingReview: boolean;
  isDateInClosedPeriod: boolean;
  isEditingTx: boolean;
  txForm: Partial<TxEditFormState>;
  onChangeTxForm: React.Dispatch<React.SetStateAction<Partial<TxEditFormState>>>;
  onStartEditTx: () => void;
  onCancelEditTx: () => void;
  onSaveTx: () => void;
  onDeleteTx: () => void;
  onRestoreTxWarnings: (txId: number) => void;
  showSplitCategories: boolean;
  onToggleSplitCategories: () => void;
  onCreateRule?: (data: { name: string; descriptionKeyword: string; categoryAccountId?: number | null }) => void;
  showLinkPanel: boolean;
  onToggleTxLinkPanel: () => void;
  canAddMoreTransactions: boolean;
  onOpenCreateTxModal: (prefill: CreateFormState) => void;
  linkPickerNode: React.ReactNode;
  onAllowTxClosed: (target: AllowConfirmState) => void;
  onCardAction: (action: "EXCLUDE" | "IGNORE", targetType: ActionTarget["type"], targetId: number) => void;
}

const labelCls = "block text-[11px] font-medium text-zinc-400 mb-0.5 uppercase tracking-wider";
const textareaCls =
  "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors";

/** Right column of DetailDrawer: Bank Transaction details, split category navigator, linking & allocation meter. */
export function DetailTransactionColumn({
  type,
  activeTx,
  activeExpense,
  transactionsList,
  expensesList,
  activeTxIdx,
  activeExpenseIdx,
  onSelectTxIdx,
  onSelectActiveExpenseIdx,
  accounts,
  isClosed,
  itemAwaitingReview,
  isDateInClosedPeriod,
  isEditingTx,
  txForm,
  onChangeTxForm,
  onStartEditTx,
  onCancelEditTx,
  onSaveTx,
  onDeleteTx,
  onRestoreTxWarnings,
  showSplitCategories,
  onToggleSplitCategories,
  onCreateRule,
  showLinkPanel,
  onToggleTxLinkPanel,
  canAddMoreTransactions,
  onOpenCreateTxModal,
  linkPickerNode,
  onAllowTxClosed,
  onCardAction,
}: DetailTransactionColumnProps) {
  const isCashExpense = activeExpense?.tender?.toLowerCase() === "cash";

  const renderTxBody = () => {
    if (!activeTx) {
      if (type === "receipt" && isCashExpense) {
        return <div className="py-6 text-zinc-400 text-center text-sm">Not Applicable (Cash Expense)</div>;
      }
      return <div className="py-6 text-zinc-400 text-center text-sm">No Bank Transaction Linked</div>;
    }

    const t = activeTx;
    const warnings: string[] = [];
    const tStatus = normalizeAllocationStatus(t.allocationStatus || t.linkStatus || t.reconciliationStatus);
    if (t.reviewStatus === "PENDING" && isDateInClosedPeriod) {
      warnings.push("This item is pending review for a closed period.");
    }
    if (t.amount < 0) {
      if (tStatus === "UNLINKED") warnings.push("This transaction is unlinked.");
      if (tStatus === "PARTIAL") warnings.push("This transaction is under-allocated.");
    }
    if (tStatus === "OVER_ALLOCATED") warnings.push("This transaction is over-allocated.");

    return (
      <div className="space-y-4 flex-1">
        {t.reviewStatus === "WARNINGS_IGNORED" ? (
          <div className="mb-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 p-3 rounded-xl text-sm flex items-center justify-between italic">
            <span>Warnings have been ignored for this item.</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRestoreTxWarnings(t.id)}
              className="text-blue-200 hover:text-white px-3 py-1 h-auto text-xs not-italic bg-blue-500/20 hover:bg-blue-500/40 rounded touch-glow-blue"
            >
              Undo
            </Button>
          </div>
        ) : (
          warnings.length > 0 &&
          !isEditingTx && (
            <div className="mb-2 bg-orange-500/10 border border-orange-500/20 text-orange-400 p-3 rounded-xl text-sm">
              <ul className="list-disc pl-4 space-y-1">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )
        )}

        <div>
          <label htmlFor="detail-tx-amount" className={labelCls}>
            Amount
          </label>
          {isEditingTx ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <MoneyInput
                  id="detail-tx-amount"
                  allowNegative
                  value={txForm.amount ?? 0}
                  onChange={(val) => {
                    let amt = val;
                    const isOutgoing = t.transactionType === "DEBIT" || t.transactionType === "PAYMENT";
                    if (isOutgoing && amt > 0) amt = -amt;
                    else if (!isOutgoing && amt < 0) amt = Math.abs(amt);
                    onChangeTxForm({ ...txForm, amount: amt });
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <p className="text-lg font-bold font-mono tabular-nums text-white">{formatCurrency(t.amount)}</p>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="detail-tx-desc" className={labelCls}>
              Description
            </label>
            {onCreateRule && !isEditingTx && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const clean = extractCleanVendor(t.description);
                  onCreateRule({
                    name: clean || t.description,
                    descriptionKeyword: clean || t.description,
                    categoryAccountId: t.categoryAccountId || null,
                  });
                }}
                className="text-[11px]! py-0.5! px-2! text-indigo-400 hover:text-indigo-300 font-medium touch-glow-indigo"
                title="Create an automated rule for this merchant"
              >
                ⚡ Create Rule
              </Button>
            )}
          </div>
          {isEditingTx ? (
            <Input
              id="detail-tx-desc"
              type="text"
              value={txForm.description ?? ""}
              onChange={(e) => onChangeTxForm({ ...txForm, description: e.target.value })}
            />
          ) : (
            <p className="text-zinc-300">{t.description}</p>
          )}
        </div>

        <div className="flex gap-6">
          <div>
            <label htmlFor="detail-tx-date" className={labelCls}>
              Date
            </label>
            {isEditingTx ? (
              <Input
                id="detail-tx-date"
                type="date"
                value={txForm.date ?? ""}
                onChange={(e) => onChangeTxForm({ ...txForm, date: e.target.value })}
              />
            ) : (
              <p className="text-zinc-300">{formatDate(t.date)}</p>
            )}
          </div>
          <div className="flex-1">
            <span className={labelCls}>Type</span>
            <p className="text-zinc-300 uppercase mt-2">{t.transactionType}</p>
          </div>
        </div>

        <div>
          <label htmlFor="detail-tx-account" className={labelCls}>
            Bank / Card Account
          </label>
          {isEditingTx ? (
            <Select
              id="detail-tx-account"
              searchable
              value={txForm.chartAccountId || ""}
              onChange={(e) => onChangeTxForm({ ...txForm, chartAccountId: e.target.value })}
            >
              <option value="">Select bank or card account...</option>
              {getGroupedAccounts(accounts, ["ASSET", "LIABILITY"], { currentSelectedId: txForm.chartAccountId }).map(
                (g) => (
                  <optgroup key={g.subClassId} label={g.label}>
                    {g.options.map((opt) => (
                      <option key={opt.account.id} value={opt.account.id}>
                        {opt.displayName}
                      </option>
                    ))}
                  </optgroup>
                )
              )}
            </Select>
          ) : t.chartAccount && t.chartAccount.id > 0 ? (
            <p className="text-zinc-300 text-sm flex items-center gap-2 flex-wrap">
              <span>
                {t.chartAccount.code} — {t.chartAccount.name}
              </span>
              {!t.chartAccount.active && (
                <Tooltip content="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                  <span>
                    <Badge variant="danger">Archived</Badge>
                  </span>
                </Tooltip>
              )}
            </p>
          ) : (
            <p className="text-red-400 italic text-sm">No Bank Account</p>
          )}
        </div>

        <div>
          <label htmlFor="detail-tx-category" className={labelCls}>
            Category
          </label>
          {expensesList.length > 1 ? (
            <div className="rounded-xl border border-purple-500/30 glow-border-purple bg-purple-500/10 overflow-hidden text-xs mt-1 shadow-sm">
              <button
                type="button"
                aria-expanded={showSplitCategories}
                onClick={onToggleSplitCategories}
                className="w-full flex items-center justify-between p-2.5 hover:bg-purple-500/15 transition-colors text-purple-300 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="purple">Split</Badge>
                  <span className="font-medium text-white">{expensesList.length} Linked Categories</span>
                </div>
                <svg
                  className={`w-4 h-4 text-purple-400 transition-transform duration-200 ${
                    showSplitCategories ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showSplitCategories && (
                <div className="border-t border-purple-500/20 divide-y divide-purple-500/15 bg-zinc-950/60">
                  {expensesList.map((exp, idx) => (
                    <button
                      type="button"
                      key={exp.id}
                      onClick={() => onSelectActiveExpenseIdx(idx)}
                      className={`w-full p-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60 ${
                        activeExpenseIdx === idx
                          ? "bg-purple-500/20 text-white"
                          : "hover:bg-purple-500/10 text-zinc-300"
                      }`}
                      title={`Click to view Expense #${idx + 1} (${formatCurrency(exp.amount)}) in left panel`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                            activeExpenseIdx === idx
                              ? "bg-purple-400 text-zinc-950 font-bold"
                              : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          }`}
                        >
                          #{idx + 1}
                        </span>
                        <div className="min-w-0">
                          {exp.chartAccount ? (
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="font-mono text-purple-300 text-xs font-semibold">
                                {exp.chartAccount.code}
                              </span>
                              <span className="text-zinc-200 text-xs truncate">{exp.chartAccount.name}</span>
                              {!exp.chartAccount.active && <Badge variant="danger">Archived</Badge>}
                            </div>
                          ) : (
                            <span className="text-zinc-400 italic text-xs">Uncategorized</span>
                          )}
                          {exp.description && (
                            <span className="text-[11px] text-zinc-400 truncate block">{exp.description}</span>
                          )}
                        </div>
                      </div>
                      <span className="font-semibold text-white text-xs shrink-0 font-mono tabular-nums">
                        {formatCurrency(exp.amount)}
                      </span>
                    </button>
                  ))}
                  <div className="p-2 text-[10px] text-zinc-400 bg-zinc-900/40 text-center italic">
                    Click a category row to view its receipt details on the left.
                  </div>
                </div>
              )}
            </div>
          ) : isEditingTx ? (
            <Select
              id="detail-tx-category"
              searchable
              value={txForm.categoryAccountId || ""}
              onChange={(e) => onChangeTxForm({ ...txForm, categoryAccountId: e.target.value })}
            >
              <option value="">None</option>
              {getGroupedAccounts(
                accounts,
                t.transactionType === "DEP"
                  ? ["REVENUE", "EQUITY", "ASSET", "LIABILITY"]
                  : ["EXPENSE", "EQUITY", "ASSET", "LIABILITY", "REVENUE"],
                { currentSelectedId: txForm.categoryAccountId }
              ).map((g) => (
                <optgroup key={g.subClassId} label={g.label}>
                  {g.options.map((opt) => (
                    <option key={opt.account.id} value={opt.account.id}>
                      {opt.displayName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          ) : t.category && t.category.id > 0 ? (
            <p className="text-zinc-300 text-sm flex items-center gap-2 flex-wrap">
              <span>
                {t.category.code} — {t.category.name}
              </span>
              {!t.category.active && (
                <Tooltip content="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                  <span>
                    <Badge variant="danger">Archived</Badge>
                  </span>
                </Tooltip>
              )}
            </p>
          ) : (
            <p className="text-zinc-400 italic text-sm">Uncategorized</p>
          )}
        </div>

        <div>
          <label htmlFor="detail-tx-notes" className={labelCls}>
            Notes
          </label>
          {isEditingTx ? (
            <textarea
              id="detail-tx-notes"
              className={textareaCls}
              rows={3}
              value={txForm.notes ?? ""}
              onChange={(e) => onChangeTxForm({ ...txForm, notes: e.target.value })}
            />
          ) : (
            <p className="text-zinc-300 whitespace-pre-wrap">
              {t.notes || <span className="text-zinc-400 italic">No notes</span>}
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderAllocationFooter = () => {
    if (!activeTx) return null;
    const hasLinks = expensesList.length > 0 || Boolean(activeTx.expenses && activeTx.expenses.length > 0);
    if (!hasLinks) return null;

    const { allocatedCents, totalCents } = computeTxAllocationCents(
      activeTx,
      transactionsList,
      expensesList
    );
    return (
      <AllocationProgressBar
        allocatedCents={allocatedCents}
        totalCents={totalCents}
        linkedCount={transactionsList.length}
      />
    );
  };

  const renderTxFooterActions = () => {
    const t = activeTx;
    if (!t || t.reviewStatus === "IGNORED") return null;
    if (isClosed && !itemAwaitingReview) return null;

    const isPendingClosed = t.reviewStatus === "PENDING" && isDateInClosedPeriod;
    const warnings: string[] = [];
    const tStatus = normalizeAllocationStatus(t.allocationStatus || t.linkStatus || t.reconciliationStatus);
    if (t.amount < 0) {
      if (tStatus === "UNLINKED") warnings.push("Unlinked");
      if (tStatus === "PARTIAL") warnings.push("Under-Allocated");
    }
    if (tStatus === "OVER_ALLOCATED") warnings.push("Over");

    return (
      <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-3 justify-end items-center">
        {isPendingClosed ? (
          <Button
            variant="primary"
            className="text-xs touch-glow-emerald"
            onClick={() => onAllowTxClosed({ type: "transaction", id: t.id, date: t.date })}
          >
            Allow Item
          </Button>
        ) : (
          t.reviewStatus !== "WARNINGS_IGNORED" &&
          (warnings.length > 0 ? (
            <Button
              variant="ghost"
              className="text-xs text-orange-400 hover:bg-orange-500/10 touch-glow-amber"
              onClick={() => onCardAction("IGNORE", "transaction", t.id)}
            >
              Ignore Warnings
            </Button>
          ) : (
            <Tooltip content="There are no issues with this item">
              <span className="inline-block cursor-not-allowed">
                <Button variant="ghost" disabled className="text-xs text-zinc-400 pointer-events-none">
                  Ignore Warnings
                </Button>
              </span>
            </Tooltip>
          ))
        )}
        <Button
          variant="ghost"
          className="text-xs text-red-400 hover:bg-red-500/10 touch-glow-red"
          onClick={() => onCardAction("EXCLUDE", "transaction", t.id)}
        >
          Exclude...
        </Button>
      </div>
    );
  };

  const isManualTx = activeTx ? activeTx.isManual || Boolean(activeTx.fitId?.startsWith("MANUAL-")) : false;

  return (
    <div
      className={`surface-glass rounded-xl p-4 sm:p-5 shadow-lg flex flex-col relative z-10 transition-colors duration-200 ${
        isEditingTx ? "glow-border-blue ring-1 ring-blue-500/20" : "border border-white/5"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 border-b border-zinc-800 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
            />
          </svg>
          <h2 className="text-base font-bold text-white">Bank Transaction</h2>
          {activeTx && <Badge variant={isManualTx ? "warning" : "info"}>{isManualTx ? "Manual" : "Bank Import"}</Badge>}
          {transactionsList.length > 1 && (
            <span className="text-xs text-zinc-400 ml-1 whitespace-nowrap">({transactionsList.length} linked)</span>
          )}
        </div>
        {activeTx &&
          (isEditingTx ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={onCancelEditTx}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={onSaveTx} className="touch-glow-blue">
                Save
              </Button>
            </div>
          ) : !isClosed ? (
            <div className="flex flex-wrap gap-1.5">
              <Button variant="ghost" size="sm" onClick={onStartEditTx} className="text-blue-400 touch-glow-blue">
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={onDeleteTx} className="touch-glow-red">
                Delete
              </Button>
            </div>
          ) : null)}
      </div>

      <DetailLinkedPagination
        label="Transaction"
        accent="blue"
        total={transactionsList.length}
        activeIndex={activeTxIdx}
        onChangeIndex={onSelectTxIdx}
      />

      {renderTxBody()}

      {type === "receipt" && !isClosed && (
        <>
          <div className={`mt-4 pt-3 border-t border-zinc-800 grid gap-2 ${!isCashExpense ? "grid-cols-2" : "grid-cols-1"}`}>
            <Button
              variant={showLinkPanel ? "info" : "secondary"}
              size="sm"
              onClick={onToggleTxLinkPanel}
              className="w-full text-xs font-semibold px-2 py-1.5 justify-center touch-glow-blue"
              title={showLinkPanel ? "Close Link Picker" : "Link Existing Transaction or Invoice"}
            >
              <span className="truncate">
                {showLinkPanel ? "Close Picker" : isCashExpense ? "Link to Client Invoice" : "Link Existing"}
              </span>
            </Button>
            {!isCashExpense && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const remainingAmt = activeExpense
                    ? Math.max(
                        0,
                        activeExpense.amount - transactionsList.reduce((s, ct) => s + Math.abs(ct.amount), 0)
                      )
                    : 0;

                  const cc =
                    activeExpense?.tender?.toLowerCase() === "card"
                      ? accounts.find((a) => a.type === "LIABILITY" && a.code.startsWith("20") && a.active)?.id
                      : undefined;
                  const cashAcc =
                    activeExpense?.tender?.toLowerCase() === "cash"
                      ? accounts.find((a) => a.code === "1030" && a.active)?.id
                      : undefined;
                  const checking = accounts.find((a) => a.code === "1010" && a.active)?.id;
                  const fallbackBank = accounts.find(
                    (a) => (a.type === "ASSET" || a.type === "LIABILITY") && a.active
                  )?.id;
                  const defaultBankId =
                    cc ??
                    (activeExpense?.tender?.toLowerCase() === "cash" ? cashAcc : checking ?? fallbackBank);

                  onOpenCreateTxModal({
                    date: activeExpense?.timestamp ? activeExpense.timestamp.split("T")[0] : "",
                    description: activeExpense?.vendor
                      ? `${activeExpense.vendor}${activeExpense.description ? ` - ${activeExpense.description}` : ""}`
                      : activeExpense?.description || "",
                    amount: remainingAmt > 0 ? remainingAmt : activeExpense?.amount,
                    transactionType: "DEBIT",
                    chartAccountId: defaultBankId,
                    categoryAccountId: activeExpense?.chartAccountId,
                  });
                }}
                className="w-full text-xs font-semibold px-2 py-1.5 justify-center touch-glow-blue"
                disabled={!canAddMoreTransactions}
                title="Create New Transaction"
              >
                <span className="truncate">
                  Create New <span className="hidden xl:inline">Transaction</span>
                </span>
              </Button>
            )}
          </div>
          {linkPickerNode}
        </>
      )}

      {renderAllocationFooter()}
      {renderTxFooterActions()}
    </div>
  );
}
