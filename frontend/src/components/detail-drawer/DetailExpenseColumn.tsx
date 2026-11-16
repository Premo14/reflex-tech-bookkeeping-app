import React from "react";
import type { BankTransaction, ChartAccount, Expense, Invoice } from "../../types/models";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { MoneyInput } from "../ui/MoneyInput";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { SuggestedMatchesList } from "../SuggestedMatchesList";
import { getGroupedAccounts } from "../../utils/accountHierarchy";
import { formatDate } from "../../utils/dateUtils";
import { formatCurrency } from "../../utils/formatCurrency";
import { normalizeAllocationStatus } from "../../utils/ledgerStatus";
import { extractCleanVendor } from "../../utils/vendorUtils";
import { AllocationProgressBar } from "./AllocationProgressBar";
import { DetailLinkedPagination } from "./DetailLinkedPagination";
import { CURRENCIES, TENDERS, computeExpenseAllocationCents } from "./helpers";
import type { ActionTarget, AllowConfirmState, CreateFormState, ExpenseEditFormState } from "./types";

export interface DetailExpenseColumnProps {
  type: "transaction" | "receipt";
  isDeposit: boolean;
  tx: BankTransaction | null;
  activeTx: BankTransaction | null;
  activeExpense: Expense | null;
  expensesList: Expense[];
  transactionsList: BankTransaction[];
  activeExpenseIdx: number;
  onSelectExpenseIdx: (idx: number) => void;
  accounts: ChartAccount[];
  linkedInvoice: Invoice | null;
  suggestedInvoices: Invoice[];
  allOpenInvoices: Invoice[];
  selectedInvoiceToMatch: number | null;
  onChangeSelectedInvoiceToMatch: (id: number | null) => void;
  isMatchingInvoice: boolean;
  isLinkingInvoice: boolean;
  onMatchInvoicePayment: (invId: number, txId: number) => void;
  onUnmatchInvoicePayment: (invId: number, linkedTx?: BankTransaction | null, invNumber?: string) => void;
  onUnlinkExpenseInvoice: (expId: number, invNumber?: string) => void;
  onOpenInvoices?: () => void;
  showLinkPanel: boolean;
  onToggleDepositLinkPanel: () => void;
  onToggleExpenseLinkPanel: () => void;
  linkPickerNode: React.ReactNode;
  isClosed: boolean;
  itemAwaitingReview: boolean;
  isDateInClosedPeriod: boolean;
  isEditingExpense: boolean;
  expenseForm: Partial<ExpenseEditFormState>;
  onChangeExpenseForm: React.Dispatch<React.SetStateAction<Partial<ExpenseEditFormState>>>;
  onStartEditExpense: () => void;
  onCancelEditExpense: () => void;
  onSaveExpense: () => void;
  onDeleteExpense: () => void;
  onOpenSplitModal: () => void;
  onRestoreExpenseWarnings: (expenseId: number) => void;
  onOpenReceiptModal: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onUploadReceipt: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenCreateExpenseModal: (prefill: CreateFormState) => void;
  onAllowExpenseClosed: (target: AllowConfirmState) => void;
  onCardAction: (action: "EXCLUDE" | "IGNORE", targetType: ActionTarget["type"], targetId: number) => void;
}

const labelCls = "block text-[11px] font-medium text-zinc-400 mb-0.5 uppercase tracking-wider";
const textareaCls =
  "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors";

/** Left column of DetailDrawer: Deposit-to-Invoice matching (for deposits) or Expense details, attachments & allocation. */
export function DetailExpenseColumn({
  type,
  isDeposit,
  tx,
  activeTx,
  activeExpense,
  expensesList,
  transactionsList,
  activeExpenseIdx,
  onSelectExpenseIdx,
  accounts,
  linkedInvoice,
  suggestedInvoices,
  allOpenInvoices,
  selectedInvoiceToMatch,
  onChangeSelectedInvoiceToMatch,
  isMatchingInvoice,
  isLinkingInvoice,
  onMatchInvoicePayment,
  onUnmatchInvoicePayment,
  onUnlinkExpenseInvoice,
  onOpenInvoices,
  showLinkPanel,
  onToggleDepositLinkPanel,
  onToggleExpenseLinkPanel,
  linkPickerNode,
  isClosed,
  itemAwaitingReview,
  isDateInClosedPeriod,
  isEditingExpense,
  expenseForm,
  onChangeExpenseForm,
  onStartEditExpense,
  onCancelEditExpense,
  onSaveExpense,
  onDeleteExpense,
  onOpenSplitModal,
  onRestoreExpenseWarnings,
  onOpenReceiptModal,
  fileInputRef,
  onUploadReceipt,
  onOpenCreateExpenseModal,
  onAllowExpenseClosed,
  onCardAction,
}: DetailExpenseColumnProps) {
  const renderExpenseBody = () => {
    if (!activeExpense) {
      return <div className="py-6 text-zinc-400 text-center text-xs">No Expense Linked</div>;
    }

    const e = activeExpense;
    const warnings: string[] = [];
    const eStatus = normalizeAllocationStatus(e.allocationStatus || e.linkStatus || e.reconciliationStatus);
    if (e.reviewStatus === "PENDING" && isDateInClosedPeriod) {
      warnings.push("This item is pending review for a closed period.");
    }
    if (e.tender?.toLowerCase() !== "cash") {
      if (eStatus === "UNLINKED") warnings.push("This expense is unlinked.");
      if (eStatus === "PARTIAL") warnings.push("This expense is under-allocated.");
    }
    if (eStatus === "OVER_ALLOCATED") warnings.push("This expense is over-allocated.");
    if (!isDeposit && (!e.receipts || e.receipts.length === 0)) {
      warnings.push("This expense does not have a physical receipt file attached to it.");
    }

    return (
      <div className="space-y-3.5 flex-1">
        {e.reviewStatus === "WARNINGS_IGNORED" ? (
          <div className="mb-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 p-2.5 rounded-xl text-xs flex items-center justify-between italic">
            <span>Warnings have been ignored for this item.</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRestoreExpenseWarnings(e.id)}
              className="text-blue-200 hover:text-white px-2.5 py-0.5 h-auto text-xs not-italic bg-blue-500/20 hover:bg-blue-500/40 rounded touch-glow-blue"
            >
              Undo
            </Button>
          </div>
        ) : (
          warnings.length > 0 &&
          !isEditingExpense && (
            <div className="mb-2 bg-orange-500/10 border border-orange-500/20 text-orange-400 p-2.5 rounded-xl text-xs">
              <ul className="list-disc pl-4 space-y-1">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )
        )}

        <div>
          <label htmlFor="detail-exp-amount" className={labelCls}>
            Amount
          </label>
          {isEditingExpense ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="detail-exp-amount" className="text-[11px] text-zinc-400 block mb-0.5">
                  Total
                </label>
                <MoneyInput
                  id="detail-exp-amount"
                  value={expenseForm.amount ?? 0}
                  onChange={(val) => onChangeExpenseForm({ ...expenseForm, amount: val })}
                />
              </div>
              <div className="w-24">
                <label htmlFor="detail-exp-tax" className="text-[11px] text-zinc-400 block mb-0.5">
                  Tax
                </label>
                <MoneyInput
                  id="detail-exp-tax"
                  value={expenseForm.taxAmount || 0}
                  onChange={(val) => onChangeExpenseForm({ ...expenseForm, taxAmount: val })}
                />
              </div>
              <div className="w-24">
                <label htmlFor="detail-exp-currency" className="text-[11px] text-zinc-400 block mb-0.5">
                  Currency
                </label>
                <Select
                  id="detail-exp-currency"
                  searchable
                  dropdownAlign="right"
                  value={expenseForm.currencyCode || "USD"}
                  onChange={(ev) => onChangeExpenseForm({ ...expenseForm, currencyCode: ev.target.value })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : (
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-lg font-bold font-mono tabular-nums text-white">{formatCurrency(e.amount)}</p>
              {(e.taxAmount > 0 || (e.currencyCode && e.currencyCode !== "USD")) && (
                <p className="text-xs text-zinc-400 font-mono tabular-nums">
                  {e.currencyCode && e.currencyCode !== "USD" ? e.currencyCode : ""}
                  {e.taxAmount > 0 ? ` (Includes ${formatCurrency(e.taxAmount)} tax)` : ""}
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="detail-exp-vendor" className={labelCls}>
            Vendor
          </label>
          {isEditingExpense ? (
            <Input
              id="detail-exp-vendor"
              type="text"
              value={expenseForm.vendor ?? ""}
              onChange={(ev) => onChangeExpenseForm({ ...expenseForm, vendor: ev.target.value })}
            />
          ) : (
            <p className="text-zinc-300">{e.vendor || "Unknown"}</p>
          )}
        </div>

        <div>
          <label htmlFor="detail-exp-desc" className={labelCls}>
            Description
          </label>
          {isEditingExpense ? (
            <Input
              id="detail-exp-desc"
              type="text"
              value={expenseForm.description ?? ""}
              onChange={(ev) => onChangeExpenseForm({ ...expenseForm, description: ev.target.value })}
            />
          ) : (
            <p className="text-zinc-300">{e.description}</p>
          )}
        </div>

        <div className="flex gap-6">
          <div>
            <label htmlFor="detail-exp-date" className={labelCls}>
              Date
            </label>
            {isEditingExpense ? (
              <Input
                id="detail-exp-date"
                type="date"
                value={expenseForm.timestamp ?? ""}
                onChange={(ev) => onChangeExpenseForm({ ...expenseForm, timestamp: ev.target.value })}
              />
            ) : (
              <p className="text-zinc-300">{formatDate(e.timestamp)}</p>
            )}
          </div>
          <div className="flex-1">
            <label htmlFor="detail-exp-tender" className={labelCls}>
              Tender
            </label>
            {isEditingExpense ? (
              <Select
                id="detail-exp-tender"
                searchable
                value={expenseForm.tender?.toUpperCase() || ""}
                onChange={(ev) => onChangeExpenseForm({ ...expenseForm, tender: ev.target.value })}
              >
                <option value="">Unknown</option>
                {TENDERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-zinc-300 uppercase">{e.tender || "Unknown"}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="detail-exp-category" className={labelCls}>
            Category
          </label>
          {isEditingExpense ? (
            <Select
              id="detail-exp-category"
              searchable
              value={expenseForm.chartAccountId || ""}
              onChange={(ev) => onChangeExpenseForm({ ...expenseForm, chartAccountId: ev.target.value })}
            >
              <option value="">None</option>
              {getGroupedAccounts(accounts, ["EXPENSE"], { currentSelectedId: expenseForm.chartAccountId }).map((g) => (
                <optgroup key={g.subClassId} label={g.label}>
                  {g.options.map((opt) => (
                    <option key={opt.account.id} value={opt.account.id}>
                      {opt.displayName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          ) : e.chartAccount && e.chartAccount.id > 0 ? (
            <p className="text-zinc-300 text-sm flex items-center gap-2 flex-wrap">
              <span>
                {e.chartAccount.code} — {e.chartAccount.name}
              </span>
              {!e.chartAccount.active && (
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
          <label htmlFor="detail-exp-notes" className={labelCls}>
            Notes
          </label>
          {isEditingExpense ? (
            <textarea
              id="detail-exp-notes"
              className={textareaCls}
              rows={3}
              value={expenseForm.notes ?? ""}
              onChange={(ev) => onChangeExpenseForm({ ...expenseForm, notes: ev.target.value })}
            />
          ) : (
            <p className="text-zinc-300 whitespace-pre-wrap">
              {e.notes || <span className="text-zinc-400 italic">No notes</span>}
            </p>
          )}
        </div>

        {e.invoice && (
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/25 glow-border-indigo rounded-xl flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-300 block">
                Linked Client Invoice
              </span>
              <div className="font-mono font-bold text-white truncate">
                {e.invoice.invoiceNumber || `INV-${e.invoice.id}`} — {e.invoice.clientName}
              </div>
              <div className="text-[11px] text-zinc-400 font-mono tabular-nums">
                {formatCurrency(e.invoice.totalAmount)} • {e.invoice.status}
              </div>
            </div>
            {!isClosed && (
              <Button
                variant="ghost"
                size="sm"
                isLoading={isLinkingInvoice}
                onClick={() => onUnlinkExpenseInvoice(e.id, e.invoice?.invoiceNumber)}
                className="text-xs text-zinc-300 hover:text-red-400 shrink-0 touch-glow-red"
              >
                Unlink
              </Button>
            )}
          </div>
        )}

        <div className="pt-2 flex flex-col gap-2">
          {e.receipts && e.receipts.length > 0 ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={onOpenReceiptModal}
                className="flex-1 justify-center text-sm touch-glow-emerald"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                View Receipt
              </Button>
              {!isClosed && (
                <Button
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload another receipt"
                  aria-label="Upload another receipt"
                  className="px-3 touch-glow-emerald"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                </Button>
              )}
            </div>
          ) : !isClosed ? (
            <div className="text-center mt-2">
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                className="w-full justify-center text-sm touch-glow-emerald"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Upload Receipt
              </Button>
            </div>
          ) : null}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".jpg,.jpeg,.png,.pdf,.heic"
            onChange={onUploadReceipt}
          />
        </div>
      </div>
    );
  };

  const renderAllocationFooter = () => {
    if (!activeExpense) return null;
    const hasLinks =
      transactionsList.length > 0 || Boolean(activeExpense.bankTransactions && activeExpense.bankTransactions.length > 0);
    if (!hasLinks) return null;

    const { allocatedCents, totalCents } = computeExpenseAllocationCents(
      activeExpense,
      expensesList,
      transactionsList
    );
    return (
      <AllocationProgressBar
        allocatedCents={allocatedCents}
        totalCents={totalCents}
        linkedCount={expensesList.length}
      />
    );
  };

  const renderExpenseFooterActions = () => {
    const e = activeExpense;
    if (!e || e.reviewStatus === "IGNORED") return null;
    if (isClosed && !itemAwaitingReview) return null;

    const isPendingClosed = e.reviewStatus === "PENDING" && isDateInClosedPeriod;
    const eStatus = normalizeAllocationStatus(e.allocationStatus || e.linkStatus || e.reconciliationStatus);
    const warnings: string[] = [];
    if (e.tender?.toLowerCase() !== "cash") {
      if (eStatus === "UNLINKED") warnings.push("Unlinked");
      if (eStatus === "PARTIAL") warnings.push("Under-Allocated");
    }
    if (eStatus === "OVER_ALLOCATED") warnings.push("Over");
    if (!isDeposit && (!e.receipts || e.receipts.length === 0)) warnings.push("No receipt");

    return (
      <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-3 justify-end items-center">
        {isPendingClosed ? (
          <Button
            variant="primary"
            className="text-xs touch-glow-emerald"
            onClick={() => onAllowExpenseClosed({ type: "expense", id: e.id, date: e.timestamp })}
          >
            Allow Item
          </Button>
        ) : (
          e.reviewStatus !== "WARNINGS_IGNORED" &&
          (warnings.length > 0 ? (
            <Button
              variant="ghost"
              className="text-xs text-orange-400 hover:bg-orange-500/10 touch-glow-amber"
              onClick={() => onCardAction("IGNORE", "expense", e.id)}
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
          onClick={() => onCardAction("EXCLUDE", "expense", e.id)}
        >
          Exclude...
        </Button>
      </div>
    );
  };

  return (
    <div
      className={`surface-glass rounded-xl p-4 sm:p-5 shadow-lg flex flex-col relative z-10 transition-colors duration-200 ${
        isEditingExpense ? "glow-border-emerald ring-1 ring-emerald-500/20" : "border border-white/5"
      }`}
    >
      {isDeposit ? (
        <div className="flex flex-col h-full space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h3 className="text-sm font-bold text-white tracking-tight">Client Invoice Relationship</h3>
            </div>
            {linkedInvoice && (
              <Badge variant="success" glow>
                PAID &amp; MATCHED
              </Badge>
            )}
          </div>

          {linkedInvoice ? (
            <div className="bg-zinc-900/80 border border-emerald-500/30 glow-border-emerald rounded-xl p-4 space-y-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="text-xs font-mono font-bold text-emerald-400">
                    {linkedInvoice.invoiceNumber || `INV-${linkedInvoice.id}`}
                  </div>
                  <div className="text-base font-bold text-white mt-0.5">{linkedInvoice.clientName}</div>
                  {linkedInvoice.clientEmail && (
                    <div className="text-xs text-zinc-400">{linkedInvoice.clientEmail}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-zinc-400">Total Billed</div>
                  <div className="text-base font-bold text-white font-mono tabular-nums">
                    {formatCurrency(linkedInvoice.totalAmount)}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">Paid in Full</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-white/5">
                <div>
                  <span className="text-zinc-400 block text-[11px]">Issue Date</span>
                  <span className="text-zinc-300 font-medium">{formatDate(linkedInvoice.issueDate)}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[11px]">Due Date</span>
                  <span className="text-zinc-300 font-medium">{formatDate(linkedInvoice.dueDate)}</span>
                </div>
              </div>

              {!isClosed && (
                <div className="pt-2 flex justify-end">
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={isMatchingInvoice}
                    onClick={() => onUnmatchInvoicePayment(linkedInvoice.id, tx, linkedInvoice.invoiceNumber)}
                    className="text-xs touch-glow-red"
                  >
                    Unlink Payment
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 flex-1 flex flex-col">
              <p className="text-xs text-zinc-400 leading-relaxed">
                This deposit can be matched to an outstanding client invoice, or categorized directly to a Revenue account
                in the right panel.
              </p>

              <SuggestedMatchesList
                title="Suggested Invoice Matches"
                accent="indigo"
                isActionLoading={isMatchingInvoice}
                items={suggestedInvoices.map((sug) => ({
                  id: sug.id,
                  eyebrow: sug.invoiceNumber || `INV-${sug.id}`,
                  title: sug.clientName,
                  subtitle: `Due: ${formatDate(sug.dueDate)} • ${
                    sug.balanceDue !== undefined && sug.balanceDue < sug.totalAmount
                      ? `Balance: ${formatCurrency(sug.balanceDue)} (Total ${formatCurrency(sug.totalAmount)})`
                      : formatCurrency(sug.totalAmount)
                  }`,
                  actionLabel: "Match & Mark Paid",
                  onAction: () => tx && onMatchInvoicePayment(sug.id, tx.id),
                }))}
              />

              {allOpenInvoices.length > 0 && (
                <div className="p-3.5 bg-zinc-900/40 border border-white/5 rounded-xl space-y-2 min-w-0">
                  <label htmlFor="detail-open-invoice-select" className="text-xs font-semibold text-zinc-300 block">
                    Select Open Invoice to Match:
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center min-w-0">
                    <div className="flex-1 min-w-0">
                      <Select
                        id="detail-open-invoice-select"
                        value={selectedInvoiceToMatch ? String(selectedInvoiceToMatch) : ""}
                        onChange={(e) => onChangeSelectedInvoiceToMatch(Number(e.target.value) || null)}
                        className="text-xs py-1.5! w-full truncate"
                      >
                        <option value="">Choose open invoice...</option>
                        {allOpenInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoiceNumber || `INV-${inv.id}`} — {inv.clientName} (
                            {inv.balanceDue !== undefined && inv.balanceDue < inv.totalAmount
                              ? `Bal ${formatCurrency(inv.balanceDue)} / Tot ${formatCurrency(inv.totalAmount)}`
                              : formatCurrency(inv.totalAmount)}
                            )
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      variant="info"
                      size="sm"
                      disabled={!selectedInvoiceToMatch}
                      isLoading={isMatchingInvoice}
                      onClick={() => {
                        if (selectedInvoiceToMatch && tx) {
                          onMatchInvoicePayment(selectedInvoiceToMatch, tx.id);
                        }
                      }}
                      className="text-xs shrink-0 justify-center touch-glow-blue"
                    >
                      Match
                    </Button>
                  </div>
                </div>
              )}

              {!isClosed && (
                <div className="pt-2 mt-auto space-y-2">
                  <Button
                    variant={showLinkPanel ? "info" : "secondary"}
                    size="sm"
                    onClick={onToggleDepositLinkPanel}
                    className="w-full text-xs font-semibold justify-center touch-glow-blue"
                  >
                    {showLinkPanel ? "Close Link Existing Picker" : "Search & Link Existing Invoice"}
                  </Button>
                  {linkPickerNode}
                  {onOpenInvoices && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onOpenInvoices}
                      className="w-full py-2 px-3 border border-dashed border-white/10 hover:border-indigo-500/40 hover:bg-indigo-500/5 text-zinc-400 hover:text-indigo-300 text-xs font-medium justify-center touch-glow-indigo"
                    >
                      <span>+</span> Create New Invoice for this Deposit
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 border-b border-zinc-800 pb-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h2 className="text-base font-bold text-white">Expense Details</h2>
              {activeExpense && (
                <Badge variant={activeExpense.isManual ? "warning" : "info"}>
                  {activeExpense.isManual ? "Manual" : "AI Extracted"}
                </Badge>
              )}
              {expensesList.length > 1 && (
                <span className="text-xs text-zinc-400 ml-1 whitespace-nowrap">
                  ({expensesList.length} linked)
                </span>
              )}
            </div>
            {activeExpense &&
              (isEditingExpense ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={onCancelEditExpense}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={onSaveExpense} className="touch-glow-emerald">
                    Save
                  </Button>
                </div>
              ) : !isClosed ? (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onOpenSplitModal}
                    className="text-amber-300 border-amber-500/30 hover:bg-amber-500/10 font-medium text-xs touch-glow-amber"
                    title="Split receipt into multiple items (e.g. personal vs business)"
                  >
                    ✂ Split Receipt
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onStartEditExpense} className="text-emerald-400 touch-glow-emerald">
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={onDeleteExpense} className="touch-glow-red">
                    Delete
                  </Button>
                </div>
              ) : null)}
          </div>

          <DetailLinkedPagination
            label="Expense"
            accent="emerald"
            total={expensesList.length}
            activeIndex={activeExpenseIdx}
            onChangeIndex={onSelectExpenseIdx}
          />

          {renderExpenseBody()}

          {type === "transaction" && !isClosed && (
            <>
              <div className="mt-4 pt-3 border-t border-zinc-800 grid grid-cols-2 gap-2">
                <Button
                  variant={showLinkPanel ? "info" : "secondary"}
                  size="sm"
                  onClick={onToggleExpenseLinkPanel}
                  className="w-full text-xs font-semibold px-2 py-1.5 justify-center touch-glow-blue"
                  title={showLinkPanel ? "Close Link Picker" : "Link Existing Expense or Invoice"}
                >
                  <span className="truncate">{showLinkPanel ? "Close Picker" : "Link Existing"}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const targetTx = activeTx || tx;
                    const txDateStr = targetTx?.date ? targetTx.date.split("T")[0] : "";
                    const linkedExpSum = expensesList.reduce((s, ce) => s + ce.amount, 0);
                    const remainingTxAmt = targetTx?.amount ? Math.max(0, Math.abs(targetTx.amount) - linkedExpSum) : 0;
                    const txAmt =
                      remainingTxAmt > 0
                        ? remainingTxAmt
                        : targetTx?.amount
                        ? Math.abs(targetTx.amount)
                        : undefined;
                    const txVendor = targetTx?.description || "";
                    const txCatId = targetTx?.categoryAccountId;
                    onOpenCreateExpenseModal({
                      timestamp: txDateStr,
                      vendor: extractCleanVendor(txVendor),
                      description: txVendor,
                      amount: txAmt,
                      tender: "card",
                      chartAccountId: txCatId ? Number(txCatId) : undefined,
                    });
                  }}
                  className="w-full text-xs font-semibold px-2 py-1.5 justify-center touch-glow-emerald"
                  title="Create New Expense"
                >
                  <span className="truncate">
                    Create New <span className="hidden xl:inline">Expense</span>
                  </span>
                </Button>
              </div>
              {linkPickerNode}
            </>
          )}

          {renderAllocationFooter()}
          {renderExpenseFooterActions()}
        </>
      )}
    </div>
  );
}
