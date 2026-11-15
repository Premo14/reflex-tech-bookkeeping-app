import { useState, useEffect, useRef, useCallback } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Badge, type BadgeVariant } from "./ui/Badge";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { useConfirm } from "./ui/confirmContext";
import DetailDrawer from "./DetailDrawer";
import { InvoiceEditorModal } from "./invoicing/InvoiceEditorModal";
import { InvoiceMatchPaymentModal } from "./invoicing/InvoiceMatchPaymentModal";
import { InvoicePrintModal } from "./invoicing/InvoicePrintModal";
import {
  getInvoices,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  matchInvoicePayment,
  markInvoicePaidCash,
  unmatchInvoicePayment,
  getInvoiceCandidates,
  getChartAccounts,
} from "../services/api";
import type {
  Invoice,
  InvoiceSummary,
  InvoiceLineItem,
  CreateInvoiceInput,
  ScoredDepositCandidate,
  ChartAccount,
} from "../types/models";
import { getGroupedAccounts } from "../utils/accountHierarchy";
import { calculateDueDateFromTerms, formatDate, toLocalISODate } from "../utils/dateUtils";
import { formatCurrency, fromCents, toCents } from "../utils/formatCurrency";

interface InvoicingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoicesUpdated?: () => void;
  /** When set, opens the invoice preview or editor for this invoice once loaded. */
  initialInvoiceId?: number;
  initialMode?: "inspect" | "edit" | "print";
  companyName?: string;
}

function getStatusBadgeProps(st: string): { variant: BadgeVariant; glow?: boolean; label: string } {
  switch (st) {
    case "PAID":
      return { variant: "success", glow: true, label: "PAID" };
    case "PARTIALLY_PAID":
      return { variant: "warning", label: "PARTIAL" };
    case "SENT":
      return { variant: "info", label: "SENT" };
    case "OVERDUE":
      return { variant: "danger", glow: true, label: "OVERDUE" };
    case "VOID":
      return { variant: "neutral", label: "VOID" };
    default:
      return { variant: "neutral", label: st };
  }
}

function getErrMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function InvoicingModal({
  isOpen,
  onClose,
  onInvoicesUpdated,
  initialInvoiceId,
  initialMode = "print",
  companyName = "Unnamed Company",
}: InvoicingModalProps) {
  const { confirm, alert } = useConfirm();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Editor State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("SENT");
  const [categoryAccountId, setCategoryAccountId] = useState<number | null>(null);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    { description: "", quantity: 1, unitPrice: 0, amount: 0 },
  ]);
  const [isSaving, setIsSaving] = useState(false);

  // Match Payment State
  const [matchingInvoice, setMatchingInvoice] = useState<Invoice | null>(null);
  const [candidates, setCandidates] = useState<ScoredDepositCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isMatching, setIsMatching] = useState(false);

  // Print Preview & Detail Drawer State
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [inspectingInvoiceId, setInspectingInvoiceId] = useState<number | null>(null);

  // Deep-link state: set whenever the modal opens with initialInvoiceId,
  // consumed by loadInvoices once the requested invoice has been fetched.
  const deepLinkPendingRef = useRef<{ id: number; mode: "inspect" | "edit" | "print" } | null>(null);

  const handleOpenEdit = useCallback((inv: Invoice) => {
    setEditingId(inv.id);
    setClientName(inv.clientName);
    setClientEmail(inv.clientEmail || "");
    setClientAddress(inv.clientAddress || "");
    setInvoiceNumber(inv.invoiceNumber);
    setIssueDate(inv.issueDate ? inv.issueDate.split("T")[0] : "");
    setDueDate(inv.dueDate ? inv.dueDate.split("T")[0] : "");
    setPaymentTerms(inv.paymentTerms || "Net 30");
    setNotes(inv.notes || "");
    setStatus(inv.status);
    setCategoryAccountId(inv.categoryAccountId || null);
    setTaxRate(inv.taxRate || 0);

    let items: InvoiceLineItem[] = [];
    try {
      if (inv.items) {
        const parsed = JSON.parse(inv.items);
        if (Array.isArray(parsed)) items = parsed;
      }
    } catch {
      items = [];
    }
    if (items.length === 0) {
      items = [{ description: "Services", quantity: 1, unitPrice: inv.totalAmount, amount: inv.totalAmount }];
    }
    setLineItems(items);
    setIsEditorOpen(true);
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const accs = await getChartAccounts("REVENUE");
      setAccounts(accs);
    } catch (err: unknown) {
      console.error("Failed to load revenue accounts:", err);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getInvoices({
        status: statusFilter,
        search: searchQuery,
      });
      setInvoices(res.invoices);
      setSummary(res.summary);
      if (deepLinkPendingRef.current != null) {
        const target = deepLinkPendingRef.current;
        const found = res.invoices.find((i) => i.id === target.id);
        deepLinkPendingRef.current = null;
        if (found) {
          if (target.mode === "edit") {
            handleOpenEdit(found);
          } else if (target.mode === "inspect") {
            setInspectingInvoiceId(found.id);
          } else {
            setPreviewInvoice(found);
          }
        }
      }
    } catch (err: unknown) {
      console.error("Failed to load invoices:", err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchQuery, handleOpenEdit]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (isOpen) {
        deepLinkPendingRef.current =
          initialInvoiceId != null
            ? { id: initialInvoiceId, mode: initialMode }
            : null;
        void loadInvoices();
        void loadAccounts();
      } else {
        deepLinkPendingRef.current = null;
        setInspectingInvoiceId(null);
        setIsEditorOpen(false);
        setMatchingInvoice(null);
        setPreviewInvoice(null);
      }
    });
    return () => {
      active = false;
    };
  }, [isOpen, initialInvoiceId, initialMode, loadInvoices, loadAccounts]);

  if (!isOpen) return null;

  const groupedRevenueAccounts = getGroupedAccounts(accounts, ["REVENUE"]);

  const handleOpenCreate = () => {
    setEditingId(null);
    setClientName("");
    setClientEmail("");
    setClientAddress("");
    setInvoiceNumber("");
    const today = toLocalISODate();
    const net30 = calculateDueDateFromTerms(today, "Net 30");
    setIssueDate(today);
    setDueDate(net30);
    setPaymentTerms("Net 30");
    setNotes("Thank you for your business!");
    setStatus("SENT");
    setCategoryAccountId(accounts[0]?.id || null);
    setTaxRate(0);
    setLineItems([
      { description: "Professional Services / Project Deliverables", quantity: 1, unitPrice: 500, amount: 500 },
    ]);
    setIsEditorOpen(true);
  };

  const handleLineItemChange = (idx: number, patch: Partial<InvoiceLineItem>) => {
    setLineItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, ...patch };
        if (patch.quantity !== undefined || patch.unitPrice !== undefined) {
          const lineCents = Math.round(updated.quantity * toCents(updated.unitPrice));
          updated.amount = fromCents(lineCents);
        }
        return updated;
      })
    );
  };

  const handleAddLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      { description: "", quantity: 1, unitPrice: 0, amount: 0 },
    ]);
  };

  const handleRemoveLineItem = (idx: number) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveInvoice = async () => {
    if (!clientName.trim()) {
      await alert({ title: "Validation Error", message: "Client name is required.", variant: "danger" });
      return;
    }
    if (lineItems.some((it) => !it.description.trim() || toCents(it.amount) <= 0)) {
      await alert({
        title: "Validation Error",
        message: "Please ensure all line items have descriptions and valid amounts.",
        variant: "danger",
      });
      return;
    }
    if (taxRate < 0 || taxRate > 100 || !Number.isFinite(taxRate)) {
      await alert({
        title: "Validation Error",
        message: "Tax rate must be between 0% and 100%.",
        variant: "danger",
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload: CreateInvoiceInput = {
        invoiceNumber: invoiceNumber.trim() || undefined,
        clientName: clientName.trim(),
        clientEmail: clientEmail.trim(),
        clientAddress: clientAddress.trim(),
        issueDate: issueDate || undefined,
        dueDate: dueDate || undefined,
        items: lineItems,
        taxRate: Number(taxRate) || 0,
        notes: notes.trim(),
        paymentTerms,
        status,
        categoryAccountId: categoryAccountId || undefined,
      };

      if (editingId) {
        await updateInvoice(editingId, payload);
      } else {
        await createInvoice(payload);
      }

      setIsEditorOpen(false);
      await loadInvoices();
      if (onInvoicesUpdated) onInvoicesUpdated();
    } catch (err: unknown) {
      console.error("Failed to save invoice:", err);
      await alert({
        title: "Error Saving Invoice",
        message: getErrMessage(err, "Failed to save invoice."),
        variant: "danger",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (inv: Invoice) => {
    const ok = await confirm({
      title: "Delete Invoice",
      message: `Are you sure you want to delete invoice ${inv.invoiceNumber} for ${inv.clientName}?`,
      confirmText: "Delete Invoice",
      variant: "danger",
    });
    if (!ok) return;

    try {
      await deleteInvoice(inv.id);
      await loadInvoices();
      if (onInvoicesUpdated) onInvoicesUpdated();
    } catch (err: unknown) {
      console.error("Failed to delete invoice:", err);
      await alert({
        title: "Error",
        message: getErrMessage(err, "Failed to delete invoice."),
        variant: "danger",
      });
    }
  };

  const handleOpenMatchPayment = async (inv: Invoice) => {
    setMatchingInvoice(inv);
    setIsLoadingCandidates(true);
    try {
      const res = await getInvoiceCandidates(inv.id);
      setCandidates(res.candidates);
    } catch (err: unknown) {
      console.error("Failed to load candidate deposits:", err);
    } finally {
      setIsLoadingCandidates(false);
    }
  };

  const handleConfirmMatchPayment = async (bankTransactionId: number) => {
    if (!matchingInvoice) return;
    setIsMatching(true);
    try {
      const res = await matchInvoicePayment(matchingInvoice.id, bankTransactionId);
      setMatchingInvoice(null);
      await loadInvoices();
      if (onInvoicesUpdated) onInvoicesUpdated();
      await alert({
        title: "Payment Matched!",
        message: res.message || "Invoice marked as paid and reconciled to bank deposit.",
        variant: "primary",
      });
    } catch (err: unknown) {
      console.error("Failed to match payment:", err);
      await alert({
        title: "Match Failed",
        message: getErrMessage(err, "Failed to link payment."),
        variant: "danger",
      });
    } finally {
      setIsMatching(false);
    }
  };

  const handlePayCash = async (inv: Invoice) => {
    const bal =
      inv.balanceDue !== undefined && inv.balanceDue > 0
        ? inv.balanceDue
        : inv.totalAmount;
    const ok = await confirm({
      title: "Mark Paid in Cash",
      message: `Record a cash payment of ${formatCurrency(bal)} for invoice ${inv.invoiceNumber} (${inv.clientName})? This posts directly to Cash on Hand (1030).`,
      confirmText: "Confirm Cash Payment",
    });
    if (!ok) return;

    setIsMatching(true);
    try {
      const res = await markInvoicePaidCash(inv.id);
      setMatchingInvoice(null);
      await loadInvoices();
      if (onInvoicesUpdated) onInvoicesUpdated();
      await alert({
        title: "Marked Paid in Cash",
        message: res.message || `Invoice ${inv.invoiceNumber} marked as PAID IN CASH.`,
        variant: "primary",
      });
    } catch (err: unknown) {
      console.error("Failed to mark invoice paid in cash:", err);
      await alert({
        title: "Cash Payment Failed",
        message: getErrMessage(err, "Failed to record cash payment."),
        variant: "danger",
      });
    } finally {
      setIsMatching(false);
    }
  };

  const handleUnmatch = async (inv: Invoice) => {
    const linked = inv.bankTransaction;
    const targetDesc = linked
      ? `"${linked.description}" (${formatCurrency(linked.amount)} on ${formatDate(linked.date)})`
      : "its linked payment record";
    const ok = await confirm({
      title: "Unlink Payment",
      message: `Unlink ${targetDesc} from invoice ${inv.invoiceNumber}? The invoice will return to SENT status.`,
      confirmText: "Unlink Payment",
      variant: "danger",
    });
    if (!ok) return;

    try {
      await unmatchInvoicePayment(inv.id);
      await loadInvoices();
      if (onInvoicesUpdated) onInvoicesUpdated();
    } catch (err: unknown) {
      console.error("Failed to unmatch payment:", err);
      await alert({
        title: "Error",
        message: getErrMessage(err, "Failed to unmatch payment."),
        variant: "danger",
      });
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Invoices & Client Receivables"
        maxWidth="4xl"
        suspended={Boolean(isEditorOpen || matchingInvoice || previewInvoice || inspectingInvoiceId !== null)}
      >
        <div className="space-y-6 text-sm">
          {/* TOP RECEIVABLES KPI CARDS */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="surface-glass border border-white/10 rounded-xl p-3.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Total Invoiced
                </span>
                <p className="text-base sm:text-xl font-black font-mono tabular-nums text-white mt-0.5 truncate">
                  {formatCurrency(summary.totalInvoiced)}
                </p>
                <span className="text-[10px] text-zinc-400 truncate block">{summary.invoiceCount} total invoices</span>
              </div>

              <div className="surface-glass bg-blue-500/10 border border-blue-500/30 rounded-xl p-3.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300">
                  Outstanding Unpaid
                </span>
                <p className="text-base sm:text-xl font-black font-mono tabular-nums text-blue-300 mt-0.5 truncate">
                  {formatCurrency(summary.totalUnpaid)}
                </p>
                <span className="text-[10px] text-blue-400/80 truncate block">Pending client payment</span>
              </div>

              <div className="surface-glass bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  Collected / Paid
                </span>
                <p className="text-base sm:text-xl font-black font-mono tabular-nums text-emerald-300 mt-0.5 truncate">
                  {formatCurrency(summary.totalPaid)}
                </p>
                <span className="text-[10px] text-emerald-400/80 truncate block">Reconciled in bank</span>
              </div>

              <div className="surface-glass bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-red-300">
                  Overdue
                </span>
                <p className="text-base sm:text-xl font-black font-mono tabular-nums text-red-300 mt-0.5 truncate">
                  {summary.overdueCount}
                </p>
                <span className="text-[10px] text-red-400/80 truncate block">Past due date</span>
              </div>
            </div>
          )}

          {/* ACTION BAR: FILTERS, SEARCH, NEW INVOICE */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1 border-t border-white/5">
            <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Invoice status filters">
              {[
                { id: "ALL", label: "All" },
                { id: "SENT", label: "Unpaid / Sent" },
                { id: "PAID", label: "Paid" },
                { id: "OVERDUE", label: "Overdue" },
                { id: "DRAFT", label: "Draft" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={statusFilter === f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                    statusFilter === f.id
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40 glow-amber"
                      : "bg-white/5 text-zinc-400 border-white/10 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <label htmlFor="invoice-search" className="sr-only">
                  Search client or invoice number
                </label>
                <input
                  id="invoice-search"
                  type="text"
                  placeholder="Search client or invoice #..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 pr-6 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 w-48 transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear invoice search"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1.5 top-1 text-zinc-500 hover:text-white text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              <Button
                type="button"
                variant="primary"
                glow
                onClick={handleOpenCreate}
                className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs"
              >
                + New Invoice
              </Button>
            </div>
          </div>

          {/* INVOICE LIST TABLE */}
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center text-zinc-400">
              <LoadingSpinner size="lg" color="text-amber-500" className="mb-2" />
              <p className="text-xs">Loading invoices...</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-white/10 rounded-xl bg-black/20">
              <p className="text-zinc-400 text-sm font-medium">No invoices found</p>
              <p className="text-zinc-400 text-xs mt-1">
                Create clean client invoices and match incoming bank deposits with 1 click.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={handleOpenCreate}
                className="mt-4 text-xs touch-glow-emerald"
              >
                Create First Invoice
              </Button>
            </div>
          ) : (
            <div className="surface-glass border border-white/10 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-black/50 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-white/10">
                    <tr>
                      <th className="py-3 px-3.5">Invoice #</th>
                      <th className="py-3 px-3.5">Client</th>
                      <th className="py-3 px-3.5">Issue / Due</th>
                      <th className="py-3 px-3.5 text-right">Amount</th>
                      <th className="py-3 px-3.5">Status</th>
                      <th className="py-3 px-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {invoices.map((inv) => {
                      const linkedTx = inv.bankTransaction;
                      const isCash = Boolean(
                        linkedTx &&
                          ((linkedTx.isManual && linkedTx.fitId?.startsWith("CASH-INV-")) ||
                            linkedTx.chartAccount?.code === "1030" ||
                            linkedTx.description?.startsWith("Cash Payment —"))
                      );
                      const badgeProps = getStatusBadgeProps(inv.status);
                      const balanceDueCents =
                        inv.balanceDue !== undefined
                          ? toCents(inv.balanceDue)
                          : Math.max(0, toCents(inv.totalAmount) - toCents(inv.amountPaid));

                      return (
                        <tr
                          key={inv.id}
                          onClick={() => setInspectingInvoiceId(inv.id)}
                          className="hover:bg-white/5 transition-colors cursor-pointer"
                          title="Click to inspect invoice details, payment link status, and attached receipts"
                        >
                          <td className="py-3 px-3.5 font-mono font-bold text-amber-400">
                            <div>{inv.invoiceNumber}</div>
                            <span className="text-[10px] font-sans font-normal text-indigo-400/80 block mt-0.5">
                              View details →
                            </span>
                          </td>
                          <td className="py-3 px-3.5">
                            <span className="font-semibold text-white block">{inv.clientName}</span>
                            {inv.clientEmail && (
                              <span className="text-[11px] text-zinc-400 block">{inv.clientEmail}</span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 text-zinc-400">
                            <span>{formatDate(inv.issueDate)}</span>
                            <span className="text-[10px] text-zinc-400 block">
                              Due: {formatDate(inv.dueDate)}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 font-mono tabular-nums font-bold text-right text-white">
                            <div>{formatCurrency(inv.totalAmount)}</div>
                            {inv.status === "PARTIALLY_PAID" && (
                              <div className="text-[10px] text-amber-400 font-normal">
                                Bal: {formatCurrency(fromCents(balanceDueCents))}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3.5">
                            <Badge variant={badgeProps.variant} glow={badgeProps.glow} size="sm">
                              {badgeProps.label}
                            </Badge>
                            {inv.status === "PAID" && linkedTx ? (
                              <span
                                className="text-[10px] text-emerald-400 block mt-1 truncate max-w-[190px]"
                                title={`${linkedTx.description} (${formatCurrency(linkedTx.amount)})`}
                              >
                                {isCash ? "✓ Cash Receipt" : `✓ ${linkedTx.description}`}
                              </span>
                            ) : inv.status === "PAID" && inv.paidDate ? (
                              <span className="text-[10px] text-emerald-400 block mt-0.5">
                                ✓ {formatDate(inv.paidDate)}
                              </span>
                            ) : inv.status === "PARTIALLY_PAID" && inv.amountPaid ? (
                              <span className="text-[10px] font-mono tabular-nums text-amber-400/80 block mt-0.5">
                                Paid: {formatCurrency(inv.amountPaid)}
                              </span>
                            ) : inv.status !== "VOID" ? (
                              <span className="text-[10px] text-zinc-400 block mt-0.5">
                                Unlinked
                              </span>
                            ) : null}
                          </td>
                          <td className="py-3 px-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {inv.status !== "PAID" && inv.status !== "VOID" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenMatchPayment(inv)}
                                    className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-bold cursor-pointer touch-glow-emerald transition-colors"
                                    title="Match an incoming bank deposit to mark this invoice as paid"
                                  >
                                    Match Deposit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handlePayCash(inv)}
                                    className="px-2 py-1 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 rounded text-[11px] font-bold cursor-pointer touch-glow-emerald transition-colors"
                                    title="Mark as Paid in Cash (Cash on Hand 1030)"
                                  >
                                    Pay Cash
                                  </button>
                                </>
                              )}

                              {(inv.status === "PAID" || linkedTx) && (
                                <button
                                  type="button"
                                  onClick={() => handleUnmatch(inv)}
                                  className="px-2 py-1 bg-white/5 hover:bg-red-500/15 text-zinc-300 hover:text-red-300 border border-white/10 hover:border-red-500/30 rounded text-[11px] cursor-pointer touch-glow-red transition-colors"
                                  title={
                                    linkedTx
                                      ? `Unlink "${linkedTx.description}" (${formatCurrency(linkedTx.amount)})`
                                      : "Unlink payment"
                                  }
                                >
                                  Unmatch
                                </button>
                              )}

                              <button
                                type="button"
                                aria-label={`Print invoice ${inv.invoiceNumber}`}
                                onClick={() => setPreviewInvoice(inv)}
                                className="px-2 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 rounded text-[11px] cursor-pointer transition-colors"
                                title="Print or view invoice"
                              >
                                Print
                              </button>

                              <button
                                type="button"
                                aria-label={`Edit invoice ${inv.invoiceNumber}`}
                                onClick={() => handleOpenEdit(inv)}
                                className="p-1 text-zinc-400 hover:text-white rounded touch-glow-emerald cursor-pointer transition-colors"
                                title="Edit"
                              >
                                ✎
                              </button>

                              <button
                                type="button"
                                aria-label={`Delete invoice ${inv.invoiceNumber}`}
                                onClick={() => handleDelete(inv)}
                                className="p-1 text-zinc-400 hover:text-red-400 rounded touch-glow-red cursor-pointer transition-colors"
                                title="Delete"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <InvoiceEditorModal
        isOpen={isEditorOpen}
        editingId={editingId}
        clientName={clientName}
        onChangeClientName={setClientName}
        clientEmail={clientEmail}
        onChangeClientEmail={setClientEmail}
        clientAddress={clientAddress}
        onChangeClientAddress={setClientAddress}
        invoiceNumber={invoiceNumber}
        onChangeInvoiceNumber={setInvoiceNumber}
        paymentTerms={paymentTerms}
        onChangePaymentTerms={setPaymentTerms}
        issueDate={issueDate}
        onChangeIssueDate={setIssueDate}
        dueDate={dueDate}
        onChangeDueDate={setDueDate}
        categoryAccountId={categoryAccountId}
        onChangeCategoryAccountId={setCategoryAccountId}
        groupedRevenueAccounts={groupedRevenueAccounts}
        status={status}
        onChangeStatus={setStatus}
        lineItems={lineItems}
        onLineItemChange={handleLineItemChange}
        onAddLineItem={handleAddLineItem}
        onRemoveLineItem={handleRemoveLineItem}
        notes={notes}
        onChangeNotes={setNotes}
        taxRate={taxRate}
        onChangeTaxRate={setTaxRate}
        isSaving={isSaving}
        onSave={handleSaveInvoice}
        onClose={() => setIsEditorOpen(false)}
      />

      <InvoiceMatchPaymentModal
        invoice={matchingInvoice}
        candidates={candidates}
        isLoading={isLoadingCandidates}
        isMatching={isMatching}
        onConfirmMatch={handleConfirmMatchPayment}
        onPayCash={handlePayCash}
        onClose={() => setMatchingInvoice(null)}
      />

      <InvoicePrintModal
        invoice={previewInvoice}
        companyName={companyName}
        onClose={() => setPreviewInvoice(null)}
      />

      <DetailDrawer
        type={inspectingInvoiceId ? "invoice" : null}
        id={inspectingInvoiceId}
        onClose={() => {
          setInspectingInvoiceId(null);
          void loadInvoices();
          if (onInvoicesUpdated) onInvoicesUpdated();
        }}
        onEditInvoice={(inv) => {
          setInspectingInvoiceId(null);
          handleOpenEdit(inv);
        }}
        onPrintInvoice={(inv) => {
          setInspectingInvoiceId(null);
          setPreviewInvoice(inv);
        }}
      />
    </>
  );
}
