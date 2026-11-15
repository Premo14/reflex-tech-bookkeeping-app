import type { Invoice } from "../types/models";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { formatDate, formatPaymentTerms } from "../utils/dateUtils";
import { formatCurrency, toCents } from "../utils/formatCurrency";
import { matchesAmountQuery } from "../utils/ledgerStatus";

interface InvoiceListProps {
  invoices: Invoice[];
  filter: string;
  searchQuery: string;
  sortField: string;
  sortOrder: "asc" | "desc";
  onSelect: (id: number) => void;
  onOpenCreate?: () => void;
}

export default function InvoiceList({
  invoices,
  filter,
  searchQuery,
  sortField,
  sortOrder,
  onSelect,
  onOpenCreate,
}: InvoiceListProps) {
  const filteredInvoices = invoices.filter((inv) => {
    if (filter !== "ALL" && inv.status !== filter) {
      return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const matchesText =
        (inv.invoiceNumber || "").toLowerCase().includes(q) ||
        (inv.clientName || "").toLowerCase().includes(q) ||
        (inv.clientEmail || "").toLowerCase().includes(q) ||
        (inv.notes || "").toLowerCase().includes(q);

      if (!matchesText && !matchesAmountQuery(inv.totalAmount || 0, q)) {
        return false;
      }
    }

    return true;
  });

  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
    let cmp: number;
    if (sortField === "amount") {
      cmp = toCents(a.totalAmount || 0) - toCents(b.totalAmount || 0);
    } else if (sortField === "vendor" || sortField === "client") {
      cmp = (a.clientName || "").localeCompare(b.clientName || "");
    } else {
      const dateA = new Date(a.issueDate || a.createdAt).getTime() || 0;
      const dateB = new Date(b.issueDate || b.createdAt).getTime() || 0;
      cmp = dateA - dateB;
    }
    return sortOrder === "asc" ? cmp : -cmp;
  });

  const getStatusBadgeVariant = (
    status: string
  ): "success" | "warning" | "danger" | "info" | "neutral" => {
    switch (status) {
      case "PAID":
        return "success";
      case "OVERDUE":
        return "danger";
      case "PARTIALLY_PAID":
        return "warning";
      case "SENT":
        return "info";
      default:
        return "neutral";
    }
  };

  if (sortedInvoices.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
        <svg
          aria-hidden="true"
          className="w-10 h-10 text-zinc-500 mx-auto mb-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-zinc-400 text-sm font-medium">No client invoices found.</p>
        <p className="text-zinc-500 text-xs mt-1">
          {searchQuery
            ? "Try adjusting your search or status filter."
            : "Create your first professional invoice to bill clients."}
        </p>
        {onOpenCreate && (
          <Button
            variant="primary"
            size="sm"
            glow
            onClick={onOpenCreate}
            className="mt-4"
          >
            <span>+</span> Create New Invoice
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {sortedInvoices.map((inv, index) => {
        const isPaid = inv.status === "PAID";
        const hasDepositLink = !!inv.bankTransactionId;

        return (
          <Card
            key={inv.id}
            onClick={() => onSelect(inv.id)}
            glowColor="emerald"
            className="p-3.5 animate-card-cascade motion-reduce:animate-none hover:border-emerald-500/40 group bg-zinc-900/60 border-white/5 relative overflow-hidden"
            style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
          >
            <div className="flex justify-between items-start gap-3 w-full">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs font-bold text-zinc-300 group-hover:text-emerald-400 transition-colors">
                    {inv.invoiceNumber || `INV-${inv.id}`}
                  </span>
                  <Badge
                    variant={getStatusBadgeVariant(inv.status)}
                    size="sm"
                    glow={inv.status === "OVERDUE"}
                  >
                    {inv.status}
                  </Badge>
                  {hasDepositLink && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium">
                      <svg
                        aria-hidden="true"
                        className="w-3 h-3 text-emerald-400 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      Linked to Deposit
                    </span>
                  )}
                </div>

                <h3 className="text-sm font-semibold text-white truncate group-hover:text-white transition-colors">
                  {inv.clientName}
                </h3>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-zinc-400">
                  <span>Issued: {formatDate(inv.issueDate)}</span>
                  <span>•</span>
                  <span>Due: {formatDate(inv.dueDate)}</span>
                  {inv.paymentTerms && (
                    <>
                      <span>•</span>
                      <span
                        className="text-zinc-400 font-medium cursor-help underline decoration-dotted decoration-zinc-600 hover:text-zinc-200 transition-colors"
                        title={`Payment terms: ${inv.paymentTerms} (${formatPaymentTerms(inv.paymentTerms)})`}
                        data-tooltip={`Payment terms: ${inv.paymentTerms} (${formatPaymentTerms(inv.paymentTerms)})`}
                      >
                        {formatPaymentTerms(inv.paymentTerms)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="text-sm font-bold font-mono tabular-nums text-white tracking-tight">
                  {formatCurrency(inv.totalAmount || 0)}
                </div>
                {inv.balanceDue !== undefined && inv.balanceDue > 0 && !isPaid && (
                  <div className="text-[11px] text-amber-400 font-medium font-mono tabular-nums mt-0.5">
                    Due: {formatCurrency(inv.balanceDue)}
                  </div>
                )}
                {isPaid && (
                  <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                    Paid in Full
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
