import type { BankTransaction, Invoice, InvoiceLineItem, ScoredDepositCandidate } from "../../types/models";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Tooltip } from "../ui/Tooltip";
import { SuggestedMatchesList } from "../SuggestedMatchesList";
import { formatDate, formatPaymentTerms } from "../../utils/dateUtils";
import { formatCurrency, formatCents, toCents } from "../../utils/formatCurrency";
import type { AllowConfirmState } from "./types";

export interface DetailInvoiceViewProps {
  invoice: Invoice;
  invoiceCandidates: ScoredDepositCandidate[];
  isMatchingInvoice: boolean;
  isLinkingInvoice: boolean;
  showCashPayPanel: boolean;
  onToggleCashPayPanel: () => void;
  cashPayDate: string;
  onCashPayDateChange: (value: string) => void;
  cashPayNotes: string;
  onCashPayNotesChange: (value: string) => void;
  isRecordingCashPay: boolean;
  onMarkPaidCash: (invoiceId: number) => void;
  onMatchPayment: (invoiceId: number, transactionId: number) => void;
  onUnmatchPayment: (invoiceId: number, linkedTx?: BankTransaction | null, invoiceNumber?: string) => void;
  onUnlinkExpense: (expenseId: number, invoiceNumber?: string) => void;
  onDeleteInvoice: (invoice: Invoice) => void;
  onEditInvoice?: (invoice: Invoice) => void;
  onPrintInvoice?: (invoice: Invoice) => void;
  isClosed?: boolean;
  itemAwaitingReview?: boolean;
  isDateInClosedPeriod?: boolean;
  onRestoreInvoiceWarnings?: (invoiceId: number) => void;
  onAllowInvoiceClosed?: (target: AllowConfirmState) => void;
  onCardAction?: (action: "EXCLUDE" | "IGNORE", targetType: "invoice", targetId: number) => void;
}

function parseInvoiceItems(rawItems: Invoice["items"]): InvoiceLineItem[] {
  try {
    if (typeof rawItems === "string") {
      const parsed: unknown = JSON.parse(rawItems);
      return Array.isArray(parsed) ? (parsed as InvoiceLineItem[]) : [];
    }
    if (Array.isArray(rawItems)) {
      return rawItems;
    }
  } catch {
    return [];
  }
  return [];
}

function getInvoiceStatusVariant(status: string): "success" | "danger" | "info" | "neutral" {
  switch (status) {
    case "PAID":
      return "success";
    case "OVERDUE":
      return "danger";
    case "SENT":
      return "info";
    default:
      return "neutral";
  }
}

/** Two-column Invoice overview, line items summary, linked expenses, cash settlement, and bank deposit reconciliation. */
export function DetailInvoiceView({
  invoice,
  invoiceCandidates,
  isMatchingInvoice,
  isLinkingInvoice,
  showCashPayPanel,
  onToggleCashPayPanel,
  cashPayDate,
  onCashPayDateChange,
  cashPayNotes,
  onCashPayNotesChange,
  isRecordingCashPay,
  onMarkPaidCash,
  onMatchPayment,
  onUnmatchPayment,
  onUnlinkExpense,
  onDeleteInvoice,
  onEditInvoice,
  onPrintInvoice,
  isClosed = false,
  itemAwaitingReview = false,
  isDateInClosedPeriod = false,
  onRestoreInvoiceWarnings,
  onAllowInvoiceClosed,
  onCardAction,
}: DetailInvoiceViewProps) {
  const items = parseInvoiceItems(invoice.items);
  const isPaid = invoice.status === "PAID";
  const hasTx = Boolean(invoice.bankTransactionId || invoice.bankTransaction);
  const linkedTx = invoice.bankTransaction;
  const isCashPayment = Boolean(
    linkedTx &&
      ((linkedTx.isManual && linkedTx.fitId?.startsWith("CASH-INV-")) ||
        linkedTx.chartAccount?.code === "1030" ||
        linkedTx.description?.startsWith("Cash Payment —"))
  );

  const paymentTermsLabel = invoice.paymentTerms || "Net 30";
  const formattedTerms = formatPaymentTerms(paymentTermsLabel);

  const isPendingClosed =
    (invoice.reviewStatus === "PENDING" && isDateInClosedPeriod) || itemAwaitingReview;
  const warnings: string[] = [];
  if (isPendingClosed) {
    warnings.push("This invoice is pending review for a closed period.");
  }
  if (invoice.status === "OVERDUE") {
    warnings.push("This invoice is past due date.");
  }
  if (!hasTx && !isPaid) {
    warnings.push("This invoice is unpaid and unlinked to a customer deposit.");
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch relative">
      {/* LEFT COLUMN: INVOICE DETAILS */}
      <div className="surface-glass glow-border-indigo rounded-xl p-4 sm:p-5 shadow-lg flex flex-col space-y-4">
        {invoice.reviewStatus === "WARNINGS_IGNORED" ? (
          <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 p-2.5 rounded-xl text-xs flex items-center justify-between italic">
            <span>Warnings have been ignored for this invoice.</span>
            {onRestoreInvoiceWarnings && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRestoreInvoiceWarnings(invoice.id)}
                className="text-blue-200 hover:text-white px-2.5 py-0.5 h-auto text-xs not-italic bg-blue-500/20 hover:bg-blue-500/40 rounded touch-glow-blue"
              >
                Undo
              </Button>
            )}
          </div>
        ) : (
          warnings.length > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/20 text-orange-400 p-2.5 rounded-xl text-xs">
              <ul className="list-disc pl-4 space-y-1">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )
        )}

        <div className="flex justify-between items-start border-b border-zinc-800 pb-3 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-xs font-bold text-indigo-400">
                {invoice.invoiceNumber || `INV-${invoice.id}`}
              </span>
              <Badge variant={getInvoiceStatusVariant(invoice.status)} glow={isPaid}>
                {invoice.status}
              </Badge>
            </div>
            <h2 className="text-base font-bold text-white">{invoice.clientName}</h2>
            {invoice.clientEmail && <p className="text-xs text-zinc-400 mt-0.5">{invoice.clientEmail}</p>}
            {invoice.clientAddress && (
              <p className="text-xs text-zinc-400 mt-0.5 whitespace-pre-line">{invoice.clientAddress}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 block">Total Due</span>
            <span className="text-xl font-black text-white font-mono tabular-nums">
              {formatCurrency(invoice.totalAmount)}
            </span>
            {invoice.balanceDue !== undefined && invoice.balanceDue > 0 && !isPaid && (
              <span className="text-xs text-amber-400 font-semibold block mt-0.5 font-mono tabular-nums">
                Remaining: {formatCurrency(invoice.balanceDue)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pb-1">
          {onEditInvoice && !isClosed && (
            <Button variant="secondary" size="sm" onClick={() => onEditInvoice(invoice)} className="text-xs">
              Edit Invoice
            </Button>
          )}
          {onPrintInvoice && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPrintInvoice(invoice)}
              className="text-xs bg-white/5 hover:bg-white/10 text-zinc-200 touch-glow-indigo"
            >
              Print / PDF
            </Button>
          )}
          {isPendingClosed && onAllowInvoiceClosed && (
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                onAllowInvoiceClosed({
                  type: "invoice",
                  id: invoice.id,
                  date: invoice.issueDate || invoice.createdAt || "",
                })
              }
              className="text-xs touch-glow-emerald"
            >
              Allow Item
            </Button>
          )}
          {onCardAction && !isClosed && invoice.reviewStatus !== "IGNORED" && (
            <>
              {invoice.reviewStatus !== "WARNINGS_IGNORED" &&
                (warnings.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-orange-400 hover:bg-orange-500/10 touch-glow-amber"
                    onClick={() => onCardAction("IGNORE", "invoice", invoice.id)}
                  >
                    Ignore Warnings
                  </Button>
                ) : (
                  <Tooltip content="There are no issues with this item">
                    <span className="inline-block cursor-not-allowed">
                      <Button variant="ghost" size="sm" disabled className="text-xs text-zinc-400 pointer-events-none">
                        Ignore Warnings
                      </Button>
                    </span>
                  </Tooltip>
                ))}
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-red-400 hover:bg-red-500/10 touch-glow-red"
                onClick={() => onCardAction("EXCLUDE", "invoice", invoice.id)}
              >
                Exclude...
              </Button>
            </>
          )}
          {!isClosed && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => onDeleteInvoice(invoice)}
              className="text-xs ml-auto touch-glow-red"
              title="Move to Deleted Items (30-day retention)"
            >
              Delete
            </Button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs p-3 bg-zinc-900/60 rounded-xl border border-white/5">
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase font-bold">Issue Date</span>
            <span className="text-zinc-300 font-medium">{formatDate(invoice.issueDate)}</span>
          </div>
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase font-bold">Due Date</span>
            <span className="text-zinc-300 font-medium">{formatDate(invoice.dueDate)}</span>
          </div>
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase font-bold">Payment Window</span>
            <Tooltip content={`Payment terms: ${paymentTermsLabel} (${formattedTerms})`}>
              <span className="text-zinc-200 font-medium cursor-help underline decoration-dotted decoration-zinc-600 hover:text-white transition-colors">
                {formattedTerms}
              </span>
            </Tooltip>
            <span className="text-[10px] text-zinc-400 block font-normal mt-0.5">
              ({paymentTermsLabel})
            </span>
          </div>
        </div>

        {/* LINE ITEMS TABLE */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">Line Items</h4>
          <div className="border border-white/5 rounded-xl overflow-hidden bg-zinc-900/40">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02] text-zinc-400 text-[10px] uppercase tracking-wider font-semibold">
                  <th className="py-2 px-3">Description</th>
                  <th className="py-2 px-2 text-right">Qty</th>
                  <th className="py-2 px-2 text-right">Rate</th>
                  <th className="py-2 px-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 px-3 text-zinc-400 italic text-center">
                      No line items specified
                    </td>
                  </tr>
                ) : (
                  items.map((it, i) => {
                    const lineAmountLabel =
                      it.amount !== undefined
                        ? formatCurrency(it.amount)
                        : formatCents(Math.round((it.quantity || 0) * toCents(it.unitPrice || 0)));

                    return (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        <td className="py-2 px-3 font-medium text-white">{it.description || "Item"}</td>
                        <td className="py-2 px-2 text-right text-zinc-400 font-mono tabular-nums">{it.quantity}</td>
                        <td className="py-2 px-2 text-right text-zinc-400 font-mono tabular-nums">
                          {formatCurrency(it.unitPrice)}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-white font-mono tabular-nums">
                          {lineAmountLabel}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* FINANCIAL SUMMARY TOTALS */}
        <div className="pt-2 border-t border-white/5 space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-400">
            <span>Subtotal:</span>
            <span className="font-mono tabular-nums text-zinc-200">
              {formatCurrency(invoice.subtotal || invoice.totalAmount)}
            </span>
          </div>
          {invoice.taxAmount !== undefined && invoice.taxAmount > 0 && (
            <div className="flex justify-between text-zinc-400">
              <span>Tax ({(invoice.taxRate || 0).toFixed(1)}%):</span>
              <span className="font-mono tabular-nums text-zinc-200">{formatCurrency(invoice.taxAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-white pt-1 border-t border-white/5">
            <span>Total Invoice Amount:</span>
            <span className="font-mono tabular-nums text-emerald-400">{formatCurrency(invoice.totalAmount)}</span>
          </div>
        </div>

        {invoice.notes && (
          <div className="p-3 bg-zinc-900/40 border border-white/5 rounded-xl text-xs">
            <span className="text-zinc-400 font-bold block mb-0.5">Notes:</span>
            <p className="text-zinc-300 italic">{invoice.notes}</p>
          </div>
        )}

        {invoice.linkedExpenses && invoice.linkedExpenses.length > 0 && (
          <div className="pt-2 border-t border-white/5 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Linked Receipts / Expenses ({invoice.linkedExpenses.length})
            </h4>
            <div className="space-y-1.5">
              {invoice.linkedExpenses.map((le) => (
                <div
                  key={le.id}
                  className="p-2.5 bg-zinc-900/60 border border-white/10 rounded-lg flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-white truncate">{le.vendor || le.description}</div>
                    <div className="text-[11px] text-zinc-400 font-mono tabular-nums">
                      {formatDate(le.timestamp)} • {formatCurrency(le.amount)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={isLinkingInvoice}
                    onClick={() => onUnlinkExpense(le.id, invoice.invoiceNumber)}
                    className="text-[11px] text-zinc-400 hover:text-red-400 shrink-0 touch-glow-red"
                  >
                    Unlink
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: BANK & CASH DEPOSIT MATCHING */}
      <div className="surface-glass glow-border-blue rounded-xl p-4 sm:p-5 shadow-lg flex flex-col space-y-4">
        <div className="flex justify-between items-center border-b border-zinc-800 pb-2.5">
          <h3 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5 uppercase">
            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            <span>Payment & Deposit Reconciliation</span>
          </h3>
          {hasTx && (
            <Badge variant="success" glow>
              BALANCED
            </Badge>
          )}
        </div>

        {hasTx && linkedTx ? (
          <div className="p-4 bg-zinc-900/80 border border-emerald-500/30 glow-border-emerald rounded-xl space-y-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 block mb-1">
                  {isCashPayment ? "✓ Paid in Cash (Cash on Hand)" : "✓ Paid via Bank Deposit"}
                </span>
                <div className="text-base font-bold text-white break-words">{linkedTx.description}</div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {isCashPayment ? "Cash Received" : "Deposited"}: {formatDate(linkedTx.date)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-zinc-400">Payment Amount</div>
                <div className="text-base font-bold text-emerald-400 font-mono tabular-nums">
                  {formatCurrency(linkedTx.amount)}
                </div>
              </div>
            </div>

            {linkedTx.chartAccount && (
              <div className="text-xs pt-2 border-t border-white/5 flex items-center gap-2 text-zinc-400">
                <span>{isCashPayment ? "Cash Account:" : "Bank Account:"}</span>
                <span className="text-zinc-200 font-medium">
                  {linkedTx.chartAccount.name} ({linkedTx.chartAccount.code})
                </span>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <Button
                variant="danger"
                size="sm"
                isLoading={isMatchingInvoice}
                onClick={() => onUnmatchPayment(invoice.id, linkedTx, invoice.invoiceNumber)}
                className="text-xs touch-glow-red"
              >
                Unlink Payment
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 flex-1 flex flex-col">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Match an incoming bank deposit below or mark this invoice as paid in cash to post directly to Cash on Hand (1030).
            </p>

            {!isPaid && invoice.status !== "VOID" && (
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-emerald-300">Paid in Physical Cash?</div>
                    <div className="text-[11px] text-zinc-400">
                      Records a balanced deposit on Cash on Hand without waiting for bank feed sync.
                    </div>
                  </div>
                  <Button
                    variant={showCashPayPanel ? "ghost" : "primary"}
                    size="sm"
                    onClick={onToggleCashPayPanel}
                    className="text-xs shrink-0 touch-glow-emerald"
                  >
                    {showCashPayPanel ? "Cancel" : "Mark Paid in Cash"}
                  </Button>
                </div>

                {showCashPayPanel && (
                  <div className="pt-2.5 border-t border-emerald-500/20 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label
                          htmlFor={`cash-pay-date-${invoice.id}`}
                          className="text-[10px] font-bold uppercase text-zinc-400 block mb-1"
                        >
                          Cash Payment Date
                        </label>
                        <Input
                          id={`cash-pay-date-${invoice.id}`}
                          type="date"
                          value={cashPayDate}
                          onChange={(e) => onCashPayDateChange(e.target.value)}
                          className="text-xs py-1"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`cash-pay-notes-${invoice.id}`}
                          className="text-[10px] font-bold uppercase text-zinc-400 block mb-1"
                        >
                          Memo / Note (Optional)
                        </label>
                        <Input
                          id={`cash-pay-notes-${invoice.id}`}
                          type="text"
                          placeholder="e.g. Received cash at job site"
                          value={cashPayNotes}
                          onChange={(e) => onCashPayNotesChange(e.target.value)}
                          className="text-xs py-1"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="primary"
                        size="sm"
                        isLoading={isRecordingCashPay}
                        onClick={() => onMarkPaidCash(invoice.id)}
                        className="text-xs font-bold touch-glow-emerald"
                      >
                        Confirm Cash Payment ({formatCurrency(invoice.balanceDue ?? invoice.totalAmount)})
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <SuggestedMatchesList
              title="Suggested Bank Deposit Matches"
              isActionLoading={isMatchingInvoice}
              items={invoiceCandidates.map((cand) => ({
                id: cand.transaction.id,
                score: cand.score,
                reason: cand.reason,
                title: cand.transaction.description,
                subtitle: `${formatDate(cand.transaction.date)} • ${cand.transaction.chartAccount?.name || "Checking"}`,
                amountLabel: formatCurrency(cand.transaction.amount),
                amountClassName: "text-emerald-400",
                actionLabel: "Match & Pay",
                onAction: () => onMatchPayment(invoice.id, cand.transaction.id),
              }))}
              emptyState={
                <div className="p-6 border border-dashed border-white/10 rounded-xl text-center text-zinc-400 text-xs">
                  <svg className="w-8 h-8 text-zinc-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-medium text-zinc-300">No candidate bank deposits found</p>
                  <p className="text-zinc-400 mt-1">
                    When a matching customer deposit arrives on your bank statement, it will appear here for 1-click matching.
                  </p>
                </div>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
