import type { Invoice } from "../types/models";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { formatDate } from "../utils/dateUtils";

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
      const numQuery = parseFloat(q.replace(/^\$/, ""));
      const matchesAmount =
        !isNaN(numQuery) && Math.abs((inv.totalAmount || 0) - numQuery) < 0.001;
      const formattedAmt = (inv.totalAmount || 0).toFixed(2);

      const matchesText =
        (inv.invoiceNumber || "").toLowerCase().includes(q) ||
        (inv.clientName || "").toLowerCase().includes(q) ||
        (inv.clientEmail || "").toLowerCase().includes(q) ||
        (inv.notes || "").toLowerCase().includes(q) ||
        (inv.totalAmount || 0).toString().includes(q) ||
        formattedAmt.includes(q) ||
        matchesAmount;

      if (!matchesText) return false;
    }

    return true;
  });

  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
    let cmp: number;
    if (sortField === "amount") {
      cmp = (a.totalAmount || 0) - (b.totalAmount || 0);
    } else if (sortField === "vendor" || sortField === "client") {
      cmp = (a.clientName || "").localeCompare(b.clientName || "");
    } else {
      const dateA = new Date(a.issueDate || a.createdAt).getTime();
      const dateB = new Date(b.issueDate || b.createdAt).getTime();
      cmp = dateA - dateB;
    }
    return sortOrder === "asc" ? cmp : -cmp;
  });

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

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
          className="w-10 h-10 text-zinc-600 mx-auto mb-3"
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
        <p className="text-zinc-600 text-xs mt-1">
          {searchQuery
            ? "Try adjusting your search or status filter."
            : "Create your first professional invoice to bill clients."}
        </p>
        {onOpenCreate && (
          <button
            type="button"
            onClick={onOpenCreate}
            className="mt-4 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
          >
            <span>+</span> Create New Invoice
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {sortedInvoices.map((inv) => {
        const isPaid = inv.status === "PAID";
        const hasDepositLink = !!inv.bankTransactionId;

        return (
          <Card
            key={inv.id}
            onClick={() => onSelect(inv.id)}
            className="p-3.5 hover:border-emerald-500/40 transition-all cursor-pointer group bg-zinc-900/60 border-white/5 relative overflow-hidden"
          >
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs font-bold text-zinc-300 group-hover:text-emerald-400 transition-colors">
                    {inv.invoiceNumber || `INV-${inv.id}`}
                  </span>
                  <Badge variant={getStatusBadgeVariant(inv.status)} size="sm">
                    {inv.status}
                  </Badge>
                  {hasDepositLink && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium">
                      <svg
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

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-zinc-400">
                  <span>Issued: {formatDate(inv.issueDate)}</span>
                  <span>•</span>
                  <span>Due: {formatDate(inv.dueDate)}</span>
                  {inv.paymentTerms && (
                    <>
                      <span>•</span>
                      <span className="text-zinc-500">{inv.paymentTerms}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-white tracking-tight">
                  {formatMoney(inv.totalAmount || 0)}
                </div>
                {inv.balanceDue !== undefined && inv.balanceDue > 0 && !isPaid && (
                  <div className="text-[11px] text-amber-400 font-medium mt-0.5">
                    Due: {formatMoney(inv.balanceDue)}
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
