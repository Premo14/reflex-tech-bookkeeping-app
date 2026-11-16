import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import type { InvoiceLineItem } from "../../types/models";
import type { SubClassGroup } from "../../utils/accountHierarchy";
import { calculateDueDateFromTerms } from "../../utils/dateUtils";
import { formatCents, formatCurrency, toCents } from "../../utils/formatCurrency";

interface InvoiceEditorModalProps {
  isOpen: boolean;
  editingId: number | null;
  clientName: string;
  onChangeClientName: (value: string) => void;
  clientEmail: string;
  onChangeClientEmail: (value: string) => void;
  clientAddress: string;
  onChangeClientAddress: (value: string) => void;
  invoiceNumber: string;
  onChangeInvoiceNumber: (value: string) => void;
  paymentTerms: string;
  onChangePaymentTerms: (value: string) => void;
  issueDate: string;
  onChangeIssueDate: (value: string) => void;
  dueDate: string;
  onChangeDueDate: (value: string) => void;
  categoryAccountId: number | null;
  onChangeCategoryAccountId: (id: number | null) => void;
  groupedRevenueAccounts: SubClassGroup[];
  status: string;
  onChangeStatus: (value: string) => void;
  lineItems: InvoiceLineItem[];
  onLineItemChange: (idx: number, patch: Partial<InvoiceLineItem>) => void;
  onAddLineItem: () => void;
  onRemoveLineItem: (idx: number) => void;
  notes: string;
  onChangeNotes: (value: string) => void;
  taxRate: number;
  onChangeTaxRate: (value: number) => void;
  isSaving: boolean;
  onSave: () => void;
  onClose: () => void;
}

export function InvoiceEditorModal({
  isOpen,
  editingId,
  clientName,
  onChangeClientName,
  clientEmail,
  onChangeClientEmail,
  clientAddress,
  onChangeClientAddress,
  invoiceNumber,
  onChangeInvoiceNumber,
  paymentTerms,
  onChangePaymentTerms,
  issueDate,
  onChangeIssueDate,
  dueDate,
  onChangeDueDate,
  categoryAccountId,
  onChangeCategoryAccountId,
  groupedRevenueAccounts,
  status,
  onChangeStatus,
  lineItems,
  onLineItemChange,
  onAddLineItem,
  onRemoveLineItem,
  notes,
  onChangeNotes,
  taxRate,
  onChangeTaxRate,
  isSaving,
  onSave,
  onClose,
}: InvoiceEditorModalProps) {
  const subtotalCents = lineItems.reduce((sum, item) => sum + toCents(item.amount), 0);
  const effectiveTaxRate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  const taxAmountCents = Math.round((subtotalCents * effectiveTaxRate) / 100);
  const totalCents = subtotalCents + taxAmountCents;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingId ? "Edit Invoice" : "Create Client Invoice"}
      maxWidth="2xl"
    >
      <div className="space-y-4 text-sm">
        {/* Client Info Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="inv-client-name" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Client Name *
            </label>
            <Input
              id="inv-client-name"
              value={clientName}
              onChange={(e) => onChangeClientName(e.target.value)}
              placeholder="e.g. Acme Corporation"
            />
          </div>

          <div>
            <label htmlFor="inv-client-email" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Client Email
            </label>
            <Input
              id="inv-client-email"
              value={clientEmail}
              onChange={(e) => onChangeClientEmail(e.target.value)}
              placeholder="e.g. billing@acme.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="inv-client-address" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
            Client Billing Address
          </label>
          <Input
            id="inv-client-address"
            value={clientAddress}
            onChange={(e) => onChangeClientAddress(e.target.value)}
            placeholder="Street address, City, State, ZIP"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label htmlFor="inv-number" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Invoice Number
            </label>
            <Input
              id="inv-number"
              value={invoiceNumber}
              onChange={(e) => onChangeInvoiceNumber(e.target.value)}
              placeholder="Auto (e.g. INV-2026-001)"
            />
          </div>

          <div>
            <label htmlFor="inv-payment-terms" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Payment Deadline
            </label>
            <Select
              id="inv-payment-terms"
              value={paymentTerms}
              onChange={(e) => {
                const terms = e.target.value;
                onChangePaymentTerms(terms);
                if (issueDate) {
                  const computedDue = calculateDueDateFromTerms(issueDate, terms);
                  if (computedDue) onChangeDueDate(computedDue);
                }
              }}
              className="w-full text-xs"
            >
              <option value="Net 30">Due in 30 days (Standard / Net 30)</option>
              <option value="Due Upon Receipt">Due immediately (Upon receipt)</option>
              <option value="Net 15">Due in 15 days (Net 15)</option>
              <option value="Net 60">Due in 60 days (Net 60)</option>
              <option value="Net 90">Due in 90 days (Net 90)</option>
            </Select>
            <p className="text-[10px] text-zinc-400 mt-1">
              Automatically calculates due date from issue date.
            </p>
          </div>

          <div>
            <label htmlFor="inv-issue-date" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Issue Date
            </label>
            <Input
              id="inv-issue-date"
              type="date"
              value={issueDate}
              onChange={(e) => {
                const newIssue = e.target.value;
                onChangeIssueDate(newIssue);
                if (newIssue) {
                  const computedDue = calculateDueDateFromTerms(newIssue, paymentTerms);
                  if (computedDue) onChangeDueDate(computedDue);
                }
              }}
            />
          </div>

          <div>
            <label htmlFor="inv-due-date" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Due Date
            </label>
            <Input
              id="inv-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => onChangeDueDate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="inv-revenue-account" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Revenue Category Account
            </label>
            <Select
              id="inv-revenue-account"
              value={categoryAccountId ? String(categoryAccountId) : ""}
              onChange={(e) => onChangeCategoryAccountId(e.target.value ? Number(e.target.value) : null)}
            >
              {groupedRevenueAccounts.map((g) => (
                <optgroup key={g.subClassId} label={`── ${g.label.toUpperCase()} ──`}>
                  {g.options.map((opt) => (
                    <option key={opt.account.id} value={opt.account.id}>
                      {opt.displayName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="inv-status" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Status
            </label>
            <Select id="inv-status" value={status} onChange={(e) => onChangeStatus(e.target.value)}>
              <option value="DRAFT">DRAFT</option>
              <option value="SENT">SENT</option>
              <option value="PAID">PAID</option>
              <option value="VOID">VOID</option>
            </Select>
          </div>
        </div>

        {/* Line Items */}
        <div className="pt-2 border-t border-white/5 space-y-2">
          <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider block">
            Itemized Services / Products
          </span>

          {lineItems.map((item, idx) => (
            <div
              key={idx}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 sm:p-0 rounded-lg sm:rounded-none bg-white/[0.02] sm:bg-transparent border sm:border-0 border-white/5"
            >
              <div className="flex-1 min-w-0">
                <Input
                  aria-label={`Line item ${idx + 1} description`}
                  value={item.description}
                  onChange={(e) => onLineItemChange(idx, { description: e.target.value })}
                  placeholder="Item description..."
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="w-20">
                  <Input
                    aria-label={`Line item ${idx + 1} quantity`}
                    type="number"
                    step="any"
                    min="0"
                    value={item.quantity}
                    onChange={(e) => onLineItemChange(idx, { quantity: Number(e.target.value) })}
                    placeholder="Qty"
                  />
                </div>
                <div className="flex-1 sm:w-24">
                  <Input
                    aria-label={`Line item ${idx + 1} unit price`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.unitPrice}
                    onChange={(e) => onLineItemChange(idx, { unitPrice: Number(e.target.value) })}
                    placeholder="Price"
                  />
                </div>
                <div className="w-24 font-mono tabular-nums font-bold text-right text-xs text-white px-2">
                  {formatCurrency(item.amount)}
                </div>
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove line item ${idx + 1}`}
                    onClick={() => onRemoveLineItem(idx)}
                    className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg touch-glow-red cursor-pointer transition-colors"
                    title="Remove item"
                  >
                    <svg
                      aria-hidden="true"
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.75}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAddLineItem}
            className="text-xs mt-1 touch-glow-emerald"
          >
            + Add Line Item
          </Button>
        </div>

        {/* Totals & Notes */}
        <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex-1">
            <label htmlFor="inv-notes" className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
              Notes & Payment Terms
            </label>
            <textarea
              id="inv-notes"
              value={notes}
              onChange={(e) => onChangeNotes(e.target.value)}
              placeholder="Payment instructions, bank wire info, notes..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-amber-500 h-16 resize-none"
            />
          </div>

          <div className="surface-glass w-full sm:w-64 border border-white/10 rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-zinc-400">
              <span>Subtotal:</span>
              <span className="font-mono tabular-nums text-white">{formatCents(subtotalCents)}</span>
            </div>
            <div className="flex justify-between items-center text-zinc-400">
              <label htmlFor="inv-tax-rate">Tax Rate (%):</label>
              <input
                id="inv-tax-rate"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={taxRate}
                onChange={(e) => onChangeTaxRate(Number(e.target.value))}
                className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-right font-mono tabular-nums text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Tax Amount:</span>
              <span className="font-mono tabular-nums text-white">{formatCents(taxAmountCents)}</span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-white/10 font-bold text-sm text-white">
              <span>Total Amount:</span>
              <span className="text-amber-400 font-mono tabular-nums">{formatCents(totalCents)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            glow
            onClick={onSave}
            isLoading={isSaving}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold"
          >
            {editingId ? "Update Invoice" : "Create Invoice"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
