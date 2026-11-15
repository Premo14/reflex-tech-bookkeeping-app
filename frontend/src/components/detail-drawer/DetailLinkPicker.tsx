import type { BankTransaction, Expense, Invoice } from "../../types/models";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import Pagination from "../ui/Pagination";
import { formatDate } from "../../utils/dateUtils";
import { formatCurrency } from "../../utils/formatCurrency";
import { normalizeAllocationStatus } from "../../utils/ledgerStatus";
import type { LinkTargetMode } from "./types";

export interface DetailLinkPickerProps {
  type: "transaction" | "receipt";
  tx: BankTransaction | null;
  activeExpense: Expense | null;
  linkTargetMode: LinkTargetMode;
  onSelectMode: (mode: LinkTargetMode) => void;
  linkStartDate: string;
  onLinkStartDateChange: (value: string) => void;
  linkEndDate: string;
  onLinkEndDateChange: (value: string) => void;
  linkSearch: string;
  onLinkSearchChange: (value: string) => void;
  linkInvoices: Invoice[];
  unlinkedExpenses: Expense[];
  unlinkedTransactions: BankTransaction[];
  selectedLinkId: number | null;
  onSelectLinkId: (id: number | null) => void;
  linkPage: number;
  unlinkedTotalPages: number;
  onLinkPageChange: (page: number) => void;
  isLinkingInvoice: boolean;
  isMatchingInvoice: boolean;
  onCancel: () => void;
  onConfirmLink: () => void;
}

/** Searchable, date-filtered picker for linking an existing expense, transaction, or invoice. */
export function DetailLinkPicker({
  type,
  tx,
  activeExpense,
  linkTargetMode,
  onSelectMode,
  linkStartDate,
  onLinkStartDateChange,
  linkEndDate,
  onLinkEndDateChange,
  linkSearch,
  onLinkSearchChange,
  linkInvoices,
  unlinkedExpenses,
  unlinkedTransactions,
  selectedLinkId,
  onSelectLinkId,
  linkPage,
  unlinkedTotalPages,
  onLinkPageChange,
  isLinkingInvoice,
  isMatchingInvoice,
  onCancel,
  onConfirmLink,
}: DetailLinkPickerProps) {
  const isInvoiceMode = linkTargetMode === "invoice";
  const isNonDepositTxInvoice = isInvoiceMode && type === "transaction" && (!tx || tx.amount <= 0);
  const isCashReceiptBlocked =
    type === "receipt" && !isInvoiceMode && activeExpense?.tender?.toLowerCase() === "cash";

  const hasEmptyList = isInvoiceMode
    ? linkInvoices.length === 0
    : type === "transaction"
    ? unlinkedExpenses.length === 0
    : unlinkedTransactions.length === 0;

  return (
    <div className="surface-glass glow-border-blue rounded-xl p-3.5 sm:p-4 mt-4 shadow-xl">
      <div className="flex flex-col gap-3 mb-4 border-b border-zinc-800 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>
                Link Existing{" "}
                {isInvoiceMode ? "Invoice" : type === "transaction" ? "Expense" : "Transaction"}
              </span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {isInvoiceMode
                ? type === "transaction"
                  ? "Match this bank deposit to an open client invoice."
                  : "Associate this receipt/expense with a client invoice."
                : "Select a matching record to link."}
            </p>
          </div>
          <div className="inline-flex bg-zinc-950 p-0.5 rounded-lg border border-white/10">
            {type === "transaction" ? (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={!isInvoiceMode}
                onClick={() => onSelectMode("expense")}
                className={`px-2.5! py-1! rounded-md text-xs font-semibold ${
                  !isInvoiceMode
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 touch-glow-emerald"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Expenses
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={!isInvoiceMode}
                onClick={() => onSelectMode("tx")}
                className={`px-2.5! py-1! rounded-md text-xs font-semibold ${
                  !isInvoiceMode
                    ? "bg-blue-500/20 text-blue-300 border border-blue-500/30 touch-glow-blue"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Bank Transactions
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={isInvoiceMode}
              onClick={() => onSelectMode("invoice")}
              className={`px-2.5! py-1! rounded-md text-xs font-semibold ${
                isInvoiceMode
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 touch-glow-indigo"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Invoices
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full">
          <div className="flex items-center gap-1.5">
            <label htmlFor="detail-link-start" className="text-xs text-zinc-400 font-medium">
              From
            </label>
            <Input
              id="detail-link-start"
              type="date"
              value={linkStartDate}
              onChange={(e) => onLinkStartDateChange(e.target.value)}
              className="text-xs py-1 w-32"
              title="Start Date"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="detail-link-end" className="text-xs text-zinc-400 font-medium">
              To
            </label>
            <Input
              id="detail-link-end"
              type="date"
              value={linkEndDate}
              onChange={(e) => onLinkEndDateChange(e.target.value)}
              className="text-xs py-1 w-32"
              title="End Date"
            />
          </div>
          <Input
            type="text"
            aria-label={isInvoiceMode ? "Search Client or Invoice Number" : "Search Amount or Text"}
            placeholder={isInvoiceMode ? "Search Client / Invoice #..." : "Search Amount / Text..."}
            value={linkSearch}
            onChange={(e) => onLinkSearchChange(e.target.value)}
            className="w-full sm:w-44 text-xs py-1 flex-1"
          />
        </div>
      </div>

      {isNonDepositTxInvoice && (
        <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          Only incoming deposits (+ positive amount) can settle a client invoice payment. Select the{" "}
          <strong>Expenses</strong> tab to link debit purchases.
        </div>
      )}

      {isCashReceiptBlocked && (
        <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          Cash expenses are auto-balanced without bank statement matching. Switch to the{" "}
          <strong>Invoices</strong> tab to attach this cash slip to a client invoice.
        </div>
      )}

      <div className="max-h-80 overflow-y-auto border border-zinc-800 rounded-md bg-zinc-950 mb-3">
        {hasEmptyList ? (
          <div className="p-6 text-center text-zinc-400 text-sm">
            {isInvoiceMode ? "No matching invoices found." : "No unlinked items available."}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {isInvoiceMode &&
              linkInvoices.map((inv) => {
                const bal = inv.balanceDue ?? inv.totalAmount;
                const badgeVariant =
                  inv.status === "PAID" ? "success" : inv.status === "OVERDUE" ? "danger" : "info";
                return (
                  <li key={inv.id}>
                    <Card
                      active={selectedLinkId === inv.id}
                      glowColor={selectedLinkId === inv.id ? "purple" : "none"}
                      onClick={() => onSelectLinkId(inv.id)}
                      className="flex-col! items-start! gap-1 rounded-none! border-0!"
                    >
                      <div className="w-full flex justify-between items-center gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="font-mono text-xs font-bold text-indigo-400">
                            {inv.invoiceNumber || `INV-${inv.id}`}
                          </span>
                          <span className="font-semibold text-white font-mono tabular-nums">
                            {formatCurrency(inv.totalAmount)}
                          </span>
                          {bal > 0 && bal < inv.totalAmount && (
                            <Badge variant="warning" className="font-mono tabular-nums">
                              Bal {formatCurrency(bal)}
                            </Badge>
                          )}
                          <Badge variant={badgeVariant}>{inv.status}</Badge>
                        </div>
                        <span className="text-xs text-zinc-400 shrink-0">{formatDate(inv.issueDate)}</span>
                      </div>
                      <div className="text-sm text-zinc-300 truncate w-full">
                        {inv.clientName}
                        {inv.clientEmail ? ` — ${inv.clientEmail}` : ""}
                      </div>
                    </Card>
                  </li>
                );
              })}

            {!isInvoiceMode &&
              type === "transaction" &&
              unlinkedExpenses.map((e) => (
                <li key={e.id}>
                  <Card
                    active={selectedLinkId === e.id}
                    glowColor={selectedLinkId === e.id ? "emerald" : "none"}
                    onClick={() => onSelectLinkId(e.id)}
                    className="flex-col! items-start! gap-1 rounded-none! border-0!"
                  >
                    <div className="w-full flex justify-between items-center gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white font-mono tabular-nums">
                          {formatCurrency(e.amount)}
                        </span>
                        {normalizeAllocationStatus(e.allocationStatus) === "PARTIAL" && (
                          <Badge variant="warning">Under-Allocated</Badge>
                        )}
                        {e.chartAccount && (
                          <Badge variant="purple" className="font-mono">
                            {e.chartAccount.code} {e.chartAccount.name}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-zinc-400">{formatDate(e.timestamp)}</span>
                    </div>
                    <div className="text-sm text-zinc-400 truncate w-full">
                      {e.vendor} — {e.description}
                    </div>
                  </Card>
                </li>
              ))}

            {!isInvoiceMode &&
              type === "receipt" &&
              unlinkedTransactions.map((t) => (
                <li key={t.id}>
                  <Card
                    active={selectedLinkId === t.id}
                    glowColor={selectedLinkId === t.id ? "blue" : "none"}
                    onClick={() => onSelectLinkId(t.id)}
                    className="flex-col! items-start! gap-1 rounded-none! border-0!"
                  >
                    <div className="w-full flex justify-between items-center gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white font-mono tabular-nums">
                          {formatCurrency(t.amount)}
                        </span>
                        {normalizeAllocationStatus(t.allocationStatus) === "PARTIAL" && (
                          <Badge variant="warning">Under-Allocated</Badge>
                        )}
                        {t.chartAccount && (
                          <Badge variant="info" className="font-mono">
                            {t.chartAccount.code} {t.chartAccount.name}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-zinc-400">{formatDate(t.date)}</span>
                    </div>
                    <div className="text-sm text-zinc-400 truncate w-full">{t.description}</div>
                  </Card>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        {!isInvoiceMode ? (
          <Pagination currentPage={linkPage} totalPages={unlinkedTotalPages} onPageChange={onLinkPageChange} />
        ) : (
          <span className="text-[11px] text-zinc-400">
            {linkInvoices.length} invoice{linkInvoices.length === 1 ? "" : "s"} shown
          </span>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {selectedLinkId !== null && (
            <Button
              variant="info"
              size="sm"
              disabled={isNonDepositTxInvoice || isCashReceiptBlocked}
              isLoading={isLinkingInvoice || isMatchingInvoice}
              onClick={onConfirmLink}
              className="touch-glow-blue"
            >
              {isInvoiceMode ? (type === "transaction" ? "Match & Mark Paid" : "Link to Invoice") : "Confirm Link"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
