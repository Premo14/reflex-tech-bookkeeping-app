import { useState, useEffect } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { useConfirm } from "./ui/ConfirmDialog";
import {
  getInvoices,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  matchInvoicePayment,
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

interface InvoicingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoicesUpdated?: () => void;
}

export default function InvoicingModal({
  isOpen,
  onClose,
  onInvoicesUpdated,
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

  // Print Preview State
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadInvoices();
      loadAccounts();
    }
  }, [isOpen, statusFilter, searchQuery]);

  const loadAccounts = async () => {
    try {
      const accs = await getChartAccounts("REVENUE");
      setAccounts(accs);
    } catch (err) {
      console.error("Failed to load revenue accounts:", err);
    }
  };

  const loadInvoices = async () => {
    setIsLoading(true);
    try {
      const res = await getInvoices({
        status: statusFilter,
        search: searchQuery,
      });
      setInvoices(res.invoices);
      setSummary(res.summary);
    } catch (err) {
      console.error("Failed to load invoices:", err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const groupedRevenueAccounts = getGroupedAccounts(accounts, ["REVENUE"]);

  const formatMoney = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const formatDate = (d: string) => {
    if (!d) return "";
    return d.split("T")[0];
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setClientName("");
    setClientEmail("");
    setClientAddress("");
    setInvoiceNumber("");
    const today = new Date().toISOString().split("T")[0];
    const net30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
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

  const handleOpenEdit = (inv: Invoice) => {
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
      if (inv.items) items = JSON.parse(inv.items);
    } catch (e) {
      items = [];
    }
    if (items.length === 0) {
      items = [{ description: "Services", quantity: 1, unitPrice: inv.totalAmount, amount: inv.totalAmount }];
    }
    setLineItems(items);
    setIsEditorOpen(true);
  };

  const handleLineItemChange = (idx: number, patch: Partial<InvoiceLineItem>) => {
    setLineItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, ...patch };
        if (patch.quantity !== undefined || patch.unitPrice !== undefined) {
          updated.amount = Math.round(updated.quantity * updated.unitPrice * 100) / 100;
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

  const subtotal = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const taxAmount = Math.round(subtotal * (taxRate / 100.0) * 100) / 100;
  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

  const handleSaveInvoice = async () => {
    if (!clientName.trim()) {
      alert({ title: "Validation Error", message: "Client name is required.", variant: "danger" });
      return;
    }
    if (lineItems.some((it) => !it.description.trim() || it.amount <= 0)) {
      alert({ title: "Validation Error", message: "Please ensure all line items have descriptions and valid amounts.", variant: "danger" });
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
    } catch (err: any) {
      console.error("Failed to save invoice:", err);
      alert({ title: "Error Saving Invoice", message: err.message || "Failed to save invoice.", variant: "danger" });
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
    } catch (err: any) {
      console.error("Failed to delete invoice:", err);
      alert({ title: "Error", message: "Failed to delete invoice.", variant: "danger" });
    }
  };

  const handleOpenMatchPayment = async (inv: Invoice) => {
    setMatchingInvoice(inv);
    setIsLoadingCandidates(true);
    try {
      const res = await getInvoiceCandidates(inv.id);
      setCandidates(res.candidates);
    } catch (err) {
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
      alert({
        title: "Payment Matched!",
        message: res.message || "Invoice marked as paid and reconciled to bank deposit.",
        variant: "primary",
      });
    } catch (err: any) {
      console.error("Failed to match payment:", err);
      alert({ title: "Match Failed", message: err.message || "Failed to link payment.", variant: "danger" });
    } finally {
      setIsMatching(false);
    }
  };

  const handleUnmatch = async (inv: Invoice) => {
    const ok = await confirm({
      title: "Unlink Payment",
      message: `Unlink bank payment from invoice ${inv.invoiceNumber}? Status will return to SENT.`,
      confirmText: "Unlink Payment",
    });
    if (!ok) return;

    try {
      await unmatchInvoicePayment(inv.id);
      await loadInvoices();
      if (onInvoicesUpdated) onInvoicesUpdated();
    } catch (err: any) {
      console.error("Failed to unmatch payment:", err);
      alert({ title: "Error", message: "Failed to unmatch payment.", variant: "danger" });
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "PAID":
        return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
      case "PARTIALLY_PAID":
        return "bg-amber-500/20 text-amber-300 border-amber-500/40";
      case "SENT":
        return "bg-blue-500/20 text-blue-300 border-blue-500/40";
      case "OVERDUE":
        return "bg-red-500/20 text-red-300 border-red-500/40 animate-pulse";
      case "VOID":
        return "bg-zinc-800 text-zinc-500 border-zinc-700";
      default:
        return "bg-zinc-700/50 text-zinc-300 border-zinc-600/50";
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Invoices & Client Receivables"
        maxWidth="4xl"
      >
        <div className="space-y-6 text-sm">
          {/* TOP RECEIVABLES KPI CARDS */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-black/30 border border-white/10 rounded-xl p-3.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Total Invoiced
                </span>
                <p className="text-base sm:text-xl font-black text-white mt-0.5 truncate">
                  {formatMoney(summary.totalInvoiced)}
                </p>
                <span className="text-[10px] text-zinc-500 truncate block">{summary.invoiceCount} total invoices</span>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300">
                  Outstanding Unpaid
                </span>
                <p className="text-base sm:text-xl font-black text-blue-300 mt-0.5 truncate">
                  {formatMoney(summary.totalUnpaid)}
                </p>
                <span className="text-[10px] text-blue-400/80 truncate block">Pending client payment</span>
              </div>

              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  Collected / Paid
                </span>
                <p className="text-base sm:text-xl font-black text-emerald-300 mt-0.5 truncate">
                  {formatMoney(summary.totalPaid)}
                </p>
                <span className="text-[10px] text-emerald-400/80 truncate block">Reconciled in bank</span>
              </div>

              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-red-300">
                  Overdue
                </span>
                <p className="text-base sm:text-xl font-black text-red-300 mt-0.5 truncate">
                  {summary.overdueCount}
                </p>
                <span className="text-[10px] text-red-400/80 truncate block">Past due date</span>
              </div>
            </div>
          )}

          {/* ACTION BAR: FILTERS, SEARCH, NEW INVOICE */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1 border-t border-white/5">
            <div className="flex items-center gap-1.5 flex-wrap">
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
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                    statusFilter === f.id
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : "bg-white/5 text-zinc-400 border-white/10 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search client or invoice #..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 w-48"
              />

              <Button
                variant="primary"
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
              <p className="text-zinc-500 text-xs mt-1">
                Create clean client invoices and match incoming bank deposits with 1 click.
              </p>
              <Button
                variant="secondary"
                onClick={handleOpenCreate}
                className="mt-4 text-xs"
              >
                Create First Invoice
              </Button>
            </div>
          ) : (
            <div className="border border-white/10 rounded-xl overflow-hidden bg-zinc-950/40">
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
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-3 px-3.5 font-mono font-bold text-amber-400">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-3 px-3.5">
                          <span className="font-semibold text-white block">{inv.clientName}</span>
                          {inv.clientEmail && (
                            <span className="text-[11px] text-zinc-500 block">{inv.clientEmail}</span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-zinc-400">
                          <span>{formatDate(inv.issueDate)}</span>
                          <span className="text-[10px] text-zinc-500 block">Due: {formatDate(inv.dueDate)}</span>
                        </td>
                        <td className="py-3 px-3.5 font-mono font-bold text-right text-white">
                          <div>{formatMoney(inv.totalAmount)}</div>
                          {inv.status === "PARTIALLY_PAID" && (
                            <div className="text-[10px] text-amber-400 font-normal">
                              Bal: {formatMoney(inv.balanceDue ?? (inv.totalAmount - (inv.amountPaid || 0)))}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusBadge(inv.status)}`}>
                            {inv.status === "PARTIALLY_PAID" ? "PARTIAL" : inv.status}
                          </span>
                          {inv.status === "PAID" && inv.paidDate && (
                            <span className="text-[10px] text-emerald-400 block mt-0.5">
                              ✓ {formatDate(inv.paidDate)}
                            </span>
                          )}
                          {inv.status === "PARTIALLY_PAID" && inv.amountPaid && (
                            <span className="text-[10px] text-amber-400/80 block mt-0.5">
                              Paid: {formatMoney(inv.amountPaid)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {inv.status !== "PAID" && inv.status !== "VOID" && (
                              <button
                                type="button"
                                onClick={() => handleOpenMatchPayment(inv)}
                                className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-bold cursor-pointer transition-colors"
                                title="Match an incoming bank deposit to mark this invoice as paid"
                              >
                                Match Deposit
                              </button>
                            )}

                            {inv.status === "PAID" && (
                              <button
                                type="button"
                                onClick={() => handleUnmatch(inv)}
                                className="px-2 py-1 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white border border-white/10 rounded text-[11px] cursor-pointer"
                                title="Unlink payment"
                              >
                                Unmatch
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setPreviewInvoice(inv)}
                              className="px-2 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 rounded text-[11px] cursor-pointer"
                              title="Print or view invoice"
                            >
                              Print
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenEdit(inv)}
                              className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                              title="Edit"
                            >
                              ✎
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDelete(inv)}
                              className="p-1 text-zinc-500 hover:text-red-400 cursor-pointer"
                              title="Delete"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* INVOICE EDITOR MODAL */}
      {isEditorOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsEditorOpen(false)}
          title={editingId ? "Edit Invoice" : "Create Client Invoice"}
          maxWidth="2xl"
        >
          <div className="space-y-4 text-sm">
            {/* Client Info Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  Client Name *
                </label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Acme Corporation"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  Client Email
                </label>
                <Input
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="e.g. billing@acme.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  Invoice Number
                </label>
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Auto (e.g. INV-2026-001)"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  Issue Date
                </label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  Due Date
                </label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  Revenue Category Account
                </label>
                <Select
                  value={categoryAccountId ? String(categoryAccountId) : ""}
                  onChange={(e) => setCategoryAccountId(e.target.value ? Number(e.target.value) : null)}
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
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  Status
                </label>
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="DRAFT">DRAFT</option>
                  <option value="SENT">SENT</option>
                  <option value="PAID">PAID</option>
                  <option value="VOID">VOID</option>
                </Select>
              </div>
            </div>

            {/* Line Items */}
            <div className="pt-2 border-t border-white/5 space-y-2">
              <label className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider block">
                Itemized Services / Products
              </label>

              {lineItems.map((item, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 sm:p-0 rounded-lg sm:rounded-none bg-white/[0.02] sm:bg-transparent border sm:border-0 border-white/5">
                  <div className="flex-1 min-w-0">
                    <Input
                      value={item.description}
                      onChange={(e) => handleLineItemChange(idx, { description: e.target.value })}
                      placeholder="Item description..."
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-20">
                      <Input
                        type="number"
                        step="any"
                        value={item.quantity}
                        onChange={(e) => handleLineItemChange(idx, { quantity: Number(e.target.value) })}
                        placeholder="Qty"
                      />
                    </div>
                    <div className="flex-1 sm:w-24">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => handleLineItemChange(idx, { unitPrice: Number(e.target.value) })}
                        placeholder="Price"
                      />
                    </div>
                    <div className="w-20 sm:w-24 font-mono font-bold text-right text-xs text-white px-2">
                      {formatMoney(item.amount)}
                    </div>
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLineItem(idx)}
                        className="text-red-400 hover:text-red-300 px-2 py-1 cursor-pointer text-sm"
                        title="Remove item"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="secondary"
                onClick={handleAddLineItem}
                className="text-xs mt-1"
              >
                + Add Line Item
              </Button>
            </div>

            {/* Totals & Notes */}
            <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row justify-between gap-4">
              <div className="flex-1">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  Notes & Payment Terms
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payment instructions, bank wire info, notes..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-amber-500 h-16 resize-none"
                />
              </div>

              <div className="w-full sm:w-60 bg-black/40 border border-white/5 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-zinc-400">
                  <span>Subtotal:</span>
                  <span className="font-mono text-white">{formatMoney(subtotal)}</span>
                </div>
                <div className="flex justify-between items-center text-zinc-400">
                  <span>Tax Rate (%):</span>
                  <input
                    type="number"
                    step="0.1"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                    className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-right text-xs text-white"
                  />
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Tax Amount:</span>
                  <span className="font-mono text-white">{formatMoney(taxAmount)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-white/10 font-bold text-sm text-white">
                  <span>Total Amount:</span>
                  <span className="text-amber-400 font-mono">{formatMoney(totalAmount)}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
              <Button variant="secondary" onClick={() => setIsEditorOpen(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveInvoice}
                isLoading={isSaving}
                className="bg-amber-500 hover:bg-amber-400 text-black font-bold"
              >
                {editingId ? "Update Invoice" : "Create Invoice"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MATCH PAYMENT MODAL */}
      {matchingInvoice && (
        <Modal
          isOpen={true}
          onClose={() => setMatchingInvoice(null)}
          title={`Match Deposit for Invoice ${matchingInvoice.invoiceNumber}`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-sm">
            <div className="bg-black/30 border border-white/10 rounded-xl p-3 flex justify-between items-center">
              <div>
                <span className="text-xs text-zinc-400">Client:</span>
                <p className="font-bold text-white">{matchingInvoice.clientName}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-zinc-400">Invoice Total:</span>
                <p className="font-bold text-amber-400 text-base">
                  {formatMoney(matchingInvoice.totalAmount)}
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-400">
              Select the incoming bank deposit that pays this invoice. Reflex will mark the invoice as PAID and automatically categorize the deposit to your revenue account.
            </p>

            {isLoadingCandidates ? (
              <div className="py-12 flex flex-col items-center justify-center text-zinc-400">
                <LoadingSpinner size="md" color="text-amber-500" className="mb-2" />
                <p className="text-xs">Finding matching bank deposits...</p>
              </div>
            ) : candidates.length === 0 ? (
              <div className="py-8 text-center text-zinc-400 bg-white/5 rounded-xl border border-white/5">
                <p className="font-medium text-xs">No matching bank deposits found.</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Once your client's payment clears in your bank statement, match it here.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {candidates.map((cand) => (
                  <div
                    key={cand.transaction.id}
                    className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between hover:border-emerald-500/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{cand.transaction.description}</span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-bold">
                          {cand.reason}
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-400 block mt-0.5">
                        Date: {formatDate(cand.transaction.date)} • {cand.transaction.chartAccount?.name || "Bank Account"}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-emerald-400 text-sm">
                        +{formatMoney(cand.transaction.amount)}
                      </span>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleConfirmMatchPayment(cand.transaction.id)}
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

            <div className="flex justify-end pt-2 border-t border-white/10">
              <Button variant="secondary" onClick={() => setMatchingInvoice(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* PRINTABLE INVOICE PREVIEW */}
      {previewInvoice && (
        <Modal
          isOpen={true}
          onClose={() => setPreviewInvoice(null)}
          title={`Invoice ${previewInvoice.invoiceNumber}`}
          maxWidth="2xl"
          headerClassName="print:hidden"
        >
          <div className="space-y-6 text-sm">
            <div className="flex justify-end gap-2 print:hidden pb-3 border-b border-white/10">
              <Button variant="secondary" onClick={() => window.print()}>
                Print / Save PDF
              </Button>
              <Button variant="secondary" onClick={() => setPreviewInvoice(null)}>
                Close
              </Button>
            </div>

            {/* INVOICE DOCUMENT */}
            <div className="bg-white text-black p-8 rounded-xl shadow-lg space-y-6 print:shadow-none print:p-0">
              <div className="flex justify-between items-start border-b border-zinc-200 pb-6">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-zinc-900">INVOICE</h1>
                  <span className="text-xs font-mono font-bold text-zinc-500 mt-1 block">
                    {previewInvoice.invoiceNumber}
                  </span>
                </div>

                <div className="text-right text-xs text-zinc-600">
                  <p className="font-bold text-zinc-900">Your Business / Freelancer Name</p>
                  <p>Reflex Bookkeeping Ledger</p>
                  <p className="mt-2 text-zinc-500">Status: <span className="font-bold uppercase text-zinc-900">{previewInvoice.status}</span></p>
                </div>
              </div>

              {/* Billed To & Dates */}
              <div className="grid grid-cols-2 gap-6 text-xs text-zinc-700">
                <div>
                  <span className="font-bold text-zinc-900 uppercase tracking-wider block mb-1">Billed To:</span>
                  <p className="text-sm font-bold text-zinc-900">{previewInvoice.clientName}</p>
                  {previewInvoice.clientEmail && <p>{previewInvoice.clientEmail}</p>}
                  {previewInvoice.clientAddress && <p className="whitespace-pre-line">{previewInvoice.clientAddress}</p>}
                </div>

                <div className="text-right space-y-1">
                  <div>
                    <span className="font-bold text-zinc-900">Issue Date: </span>
                    <span>{formatDate(previewInvoice.issueDate)}</span>
                  </div>
                  <div>
                    <span className="font-bold text-zinc-900">Due Date: </span>
                    <span>{formatDate(previewInvoice.dueDate)}</span>
                  </div>
                  <div>
                    <span className="font-bold text-zinc-900">Terms: </span>
                    <span>{previewInvoice.paymentTerms || "Net 30"}</span>
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
                    {(() => {
                      let items: InvoiceLineItem[] = [];
                      try {
                        if (previewInvoice.items) items = JSON.parse(previewInvoice.items);
                      } catch (e) {
                        items = [];
                      }
                      if (items.length === 0) {
                        items = [{ description: "Services rendered", quantity: 1, unitPrice: previewInvoice.totalAmount, amount: previewInvoice.totalAmount }];
                      }
                      return items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="py-2.5 px-3 font-medium text-zinc-900">{it.description}</td>
                          <td className="py-2.5 px-3 text-center text-zinc-600">{it.quantity}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-zinc-600">{formatMoney(it.unitPrice)}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-zinc-900">{formatMoney(it.amount)}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end text-xs">
                <div className="w-64 space-y-1.5 border-t border-zinc-200 pt-3">
                  <div className="flex justify-between text-zinc-600">
                    <span>Subtotal:</span>
                    <span className="font-mono">{formatMoney(previewInvoice.subtotal)}</span>
                  </div>
                  {previewInvoice.taxAmount > 0 && (
                    <div className="flex justify-between text-zinc-600">
                      <span>Tax ({previewInvoice.taxRate}%):</span>
                      <span className="font-mono">{formatMoney(previewInvoice.taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-zinc-900 font-bold text-base text-zinc-900">
                    <span>Total Due:</span>
                    <span className="font-mono">{formatMoney(previewInvoice.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {previewInvoice.notes && (
                <div className="pt-4 border-t border-zinc-200 text-xs text-zinc-600">
                  <span className="font-bold text-zinc-900 block mb-1">Notes:</span>
                  <p>{previewInvoice.notes}</p>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
