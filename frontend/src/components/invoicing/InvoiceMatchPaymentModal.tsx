import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { Invoice, ScoredDepositCandidate } from "../../types/models";
import { formatDate } from "../../utils/dateUtils";
import { formatCurrency } from "../../utils/formatCurrency";

interface InvoiceMatchPaymentModalProps {
  invoice: Invoice | null;
  candidates: ScoredDepositCandidate[];
  isLoading: boolean;
  isMatching: boolean;
  onConfirmMatch: (bankTransactionId: number) => void;
  onPayCash: (invoice: Invoice) => void;
  onClose: () => void;
}

export function InvoiceMatchPaymentModal({
  invoice,
  candidates,
  isLoading,
  isMatching,
  onConfirmMatch,
  onPayCash,
  onClose,
}: InvoiceMatchPaymentModalProps) {
  if (!invoice) return null;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Match Deposit for Invoice ${invoice.invoiceNumber}`}
      maxWidth="lg"
    >
      <div className="space-y-4 text-sm">
        <div className="surface-glass border border-white/10 rounded-xl p-3 flex justify-between items-center">
          <div>
            <span className="text-xs text-zinc-400">Client:</span>
            <p className="font-bold text-white">{invoice.clientName}</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-zinc-400">Invoice Total:</span>
            <p className="font-bold font-mono tabular-nums text-amber-400 text-base">
              {formatCurrency(invoice.totalAmount)}
            </p>
          </div>
        </div>

        <p className="text-xs text-zinc-400">
          Select the incoming bank deposit that pays this invoice. Reflex will mark the invoice as PAID and automatically categorize the deposit to your revenue account.
        </p>

        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center text-zinc-400">
            <LoadingSpinner size="md" color="text-amber-500" className="mb-2" />
            <p className="text-xs">Finding matching bank deposits...</p>
          </div>
        ) : candidates.length === 0 ? (
          <div className="py-8 text-center text-zinc-400 bg-white/5 rounded-xl border border-white/5">
            <p className="font-medium text-xs">No matching bank deposits found.</p>
            <p className="text-[11px] text-zinc-400 mt-1">
              Once your client&apos;s payment clears in your bank statement, match it here.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
            {candidates.map((cand) => (
              <div
                key={cand.transaction.id}
                className="surface-glass p-3 border border-zinc-800 rounded-xl flex items-center justify-between gap-2 hover:border-emerald-500/50 touch-glow-emerald transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white text-xs truncate">
                      {cand.transaction.description}
                    </span>
                    <Badge variant="success" size="sm">
                      {cand.reason}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-zinc-400 block mt-0.5">
                    Date: {formatDate(cand.transaction.date)} •{" "}
                    {cand.transaction.chartAccount?.name || "Bank Account"}
                  </span>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono tabular-nums font-bold text-emerald-400 text-sm">
                    {formatCurrency(cand.transaction.amount, { signed: true })}
                  </span>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    glow
                    onClick={() => onConfirmMatch(cand.transaction.id)}
                    isLoading={isMatching}
                    className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs"
                  >
                    Match
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center gap-2 pt-2 border-t border-white/10">
          <Button
            type="button"
            variant="primary"
            size="sm"
            isLoading={isMatching}
            onClick={() => onPayCash(invoice)}
            className="touch-glow-emerald"
          >
            Or Mark Paid in Cash
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
