import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { Invoice, InvoiceLineItem } from "../../types/models";
import { formatDate, formatPaymentTerms } from "../../utils/dateUtils";
import { formatCents, formatCurrency, toCents } from "../../utils/formatCurrency";

interface InvoicePrintModalProps {
  invoice: Invoice | null;
  companyName: string;
  onClose: () => void;
}

export function InvoicePrintModal({
  invoice,
  companyName,
  onClose,
}: InvoicePrintModalProps) {
  if (!invoice) return null;

  let items: InvoiceLineItem[] = [];
  try {
    if (invoice.items) {
      const parsed = JSON.parse(invoice.items);
      if (Array.isArray(parsed)) items = parsed;
    }
  } catch {
    items = [];
  }
  if (items.length === 0) {
    items = [
      {
        description: "Services rendered",
        quantity: 1,
        unitPrice: invoice.totalAmount,
        amount: invoice.totalAmount,
      },
    ];
  }

  const paidCents = toCents(invoice.amountPaid);
  const balanceDueCents =
    invoice.balanceDue !== undefined
      ? toCents(invoice.balanceDue)
      : Math.max(0, toCents(invoice.totalAmount) - paidCents);
  const displayCompany = companyName.trim() || "Unnamed Company";

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Invoice ${invoice.invoiceNumber}`}
      maxWidth="2xl"
      headerClassName="print:hidden"
    >
      <div className="space-y-6 text-sm">
        <div className="flex justify-end gap-2 print:hidden pb-3 border-b border-white/10">
          <Button type="button" variant="secondary" glow onClick={() => window.print()}>
            Print / Save PDF
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* INVOICE DOCUMENT */}
        <div className="bg-white text-black p-8 rounded-xl shadow-lg space-y-6 print:shadow-none print:p-0">
          <div className="flex justify-between items-start border-b border-zinc-200 pb-6">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-zinc-900">INVOICE</h1>
              <span className="text-xs font-mono font-bold text-zinc-500 mt-1 block">
                {invoice.invoiceNumber}
              </span>
            </div>

            <div className="text-right text-xs text-zinc-600">
              <p className="font-bold text-zinc-900">{displayCompany}</p>
              <p>Reflex Bookkeeping Ledger</p>
              <p className="mt-2 text-zinc-500">
                Status: <span className="font-bold uppercase text-zinc-900">{invoice.status}</span>
              </p>
            </div>
          </div>

          {/* Billed To & Dates */}
          <div className="grid grid-cols-2 gap-6 text-xs text-zinc-700">
            <div>
              <span className="font-bold text-zinc-900 uppercase tracking-wider block mb-1">
                Billed To:
              </span>
              <p className="text-sm font-bold text-zinc-900">{invoice.clientName}</p>
              {invoice.clientEmail && <p>{invoice.clientEmail}</p>}
              {invoice.clientAddress && (
                <p className="whitespace-pre-line">{invoice.clientAddress}</p>
              )}
            </div>

            <div className="text-right space-y-1">
              <div>
                <span className="font-bold text-zinc-900">Issue Date: </span>
                <span>{formatDate(invoice.issueDate)}</span>
              </div>
              <div>
                <span className="font-bold text-zinc-900">Due Date: </span>
                <span>{formatDate(invoice.dueDate)}</span>
              </div>
              <div>
                <span className="font-bold text-zinc-900">Payment Window: </span>
                <span>
                  {formatPaymentTerms(invoice.paymentTerms || "Net 30")} (
                  {invoice.paymentTerms || "Net 30"})
                </span>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="border border-zinc-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[360px]">
              <thead className="bg-zinc-100 text-zinc-700 font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3 text-center">Qty</th>
                  <th className="py-2.5 px-3 text-right">Unit Price</th>
                  <th className="py-2.5 px-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="py-2.5 px-3 font-medium text-zinc-900">{it.description}</td>
                    <td className="py-2.5 px-3 text-center font-mono tabular-nums text-zinc-600">
                      {it.quantity}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-600">
                      {formatCurrency(it.unitPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-zinc-900">
                      {formatCurrency(it.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end text-xs">
            <div className="w-64 space-y-1.5 border-t border-zinc-200 pt-3">
              <div className="flex justify-between text-zinc-600">
                <span>Subtotal:</span>
                <span className="font-mono tabular-nums">{formatCurrency(invoice.subtotal)}</span>
              </div>
              {invoice.taxAmount > 0 && (
                <div className="flex justify-between text-zinc-600">
                  <span>Tax ({invoice.taxRate}%):</span>
                  <span className="font-mono tabular-nums">{formatCurrency(invoice.taxAmount)}</span>
                </div>
              )}
              {paidCents > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Amount Paid:</span>
                  <span className="font-mono tabular-nums">-{formatCents(paidCents)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-zinc-900 font-bold text-base text-zinc-900">
                <span>{paidCents > 0 ? "Balance Due:" : "Total Due:"}</span>
                <span className="font-mono tabular-nums">
                  {paidCents > 0 ? formatCents(balanceDueCents) : formatCurrency(invoice.totalAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="pt-4 border-t border-zinc-200 text-xs text-zinc-600">
              <span className="font-bold text-zinc-900 block mb-1">Notes:</span>
              <p>{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
