import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { ARAgingReport } from "../../types/models";
import { formatDateMMDDYYYY } from "../../utils/dateUtils";
import { formatCents, formatCurrency, toCents } from "../../utils/formatCurrency";

interface ARAgingTabProps {
  report: ARAgingReport | null;
  isLoading: boolean;
  asOfDate: string;
  dsoWindow: number;
  onAsOfDateChange: (val: string) => void;
  onDsoWindowChange: (val: number) => void;
  onRecalculate: () => void;
  onExportCSV: (report: ARAgingReport) => void;
  onPrint: () => void;
  onOpenInvoiceDetail?: (invoiceId: number) => void;
}

const DSO_WINDOW_OPTIONS = [30, 90, 180, 365];

export function ARAgingTab({
  report,
  isLoading,
  asOfDate,
  dsoWindow,
  onAsOfDateChange,
  onDsoWindowChange,
  onRecalculate,
  onExportCSV,
  onPrint,
  onOpenInvoiceDetail,
}: ARAgingTabProps) {
  const allInvoices = report
    ? report.buckets.flatMap((b) =>
        (b.invoices || []).map((inv) => ({ ...inv, bucketName: b.bucketName }))
      )
    : [];

  const totalInvoicedCents = allInvoices.reduce((sum, inv) => sum + toCents(inv.totalAmount), 0);
  const totalPaidCents = allInvoices.reduce((sum, inv) => sum + toCents(inv.amountPaid), 0);

  return (
    <div className="space-y-4">
      <div className="bg-rose-500/10 border border-rose-500/20 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
        <svg className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <h5 className="text-xs font-bold uppercase tracking-wider text-rose-400">
            What is an Accounts Receivable (A/R) Aging Report?
          </h5>
          <p className="text-xs text-rose-200/80 mt-1 leading-relaxed">
            Invoiced revenue is only theoretical until the customer pays.
            The A/R Aging report categorizes unpaid customer invoices into 30-day brackets (Current, 1–30, 31–60, 61–90, 90+ days overdue).
            It helps you prioritize collection follow-ups, safeguard your operating cash, and identify delinquent clients before bad debt accumulates.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 surface-glass p-3 sm:p-3.5 rounded-xl border border-white/5 print:hidden">
        <div className="flex flex-wrap items-end gap-2.5 flex-1 min-w-[220px]">
          <div className="w-44">
            <Input
              id="ar-as-of-date"
              name="asOfDate"
              type="date"
              label="Aging As Of Date"
              value={asOfDate}
              onChange={(e) => onAsOfDateChange(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="ar-dso-window" className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
              DSO Window (Days)
            </label>
            <select
              id="ar-dso-window"
              value={dsoWindow}
              onChange={(e) => onDsoWindowChange(Number(e.target.value))}
              className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-rose-500 cursor-pointer touch-glow-rose"
              title="Trailing credit-sales window used as the DSO denominator"
            >
              {DSO_WINDOW_OPTIONS.map((win) => (
                <option key={win} value={win}>
                  {win}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" size="sm" glow onClick={onRecalculate} isLoading={isLoading}>
            Recalculate Aging
          </Button>
        </div>

        {report && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => onExportCSV(report)} title="Export A/R Aging to CSV">
              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={onPrint} title="Print or Save PDF">
              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </Button>
          </div>
        )}
      </div>

      {isLoading && !report ? (
        <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
          <LoadingSpinner size="lg" color="text-rose-400" className="mb-3" />
          <p className="text-sm">Calculating A/R aging buckets and invoice statuses...</p>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Total Receivables
              </span>
              <p className="text-xl sm:text-2xl font-black text-white mt-1 font-mono tabular-nums">
                {formatCurrency(report.totalReceivables)}
              </p>
              <span className="text-[10px] text-zinc-400">Uncollected invoice balance</span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Current (Not Due Yet)
              </span>
              <p className="text-xl sm:text-2xl font-black text-emerald-400 mt-1 font-mono tabular-nums">
                {formatCurrency(report.totalCurrent)}
              </p>
              <span className="text-[10px] text-zinc-400">Within payment terms</span>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 sm:p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300">
                  Total Overdue
                </span>
                {report.totalOverdue > 0 && (
                  <Badge variant="danger" size="sm" glow>
                    Action Needed
                  </Badge>
                )}
              </div>
              <p className="text-xl sm:text-2xl font-black text-rose-300 mt-1 font-mono tabular-nums">
                {formatCurrency(report.totalOverdue)}
              </p>
              <span className="text-[10px] text-rose-400/80">Past contractual due date</span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Open Invoices
              </span>
              <p className="text-xl sm:text-2xl font-black text-zinc-200 mt-1 font-mono tabular-nums">
                {report.invoiceCount}
              </p>
              <span className="text-[10px] text-zinc-400">
                Across {(report.clients || []).length} clients
              </span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  DSO (Days Sales Outstanding)
                </span>
                <Badge variant="neutral" size="sm" className="font-mono">
                  {report.salesDays}d window
                </Badge>
              </div>
              <p
                className={`text-xl sm:text-2xl font-black mt-1 font-mono tabular-nums ${
                  report.dsoDays > 60 ? "text-rose-300" : "text-cyan-300"
                }`}
              >
                {report.dsoDays.toFixed(1)} days
              </p>
              <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                vs {formatCurrency(report.creditSales)} credit sales
              </span>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300">
                Delinquency Rate
              </span>
              <p
                className={`text-xl sm:text-2xl font-black mt-1 font-mono tabular-nums ${
                  report.delinquencyRate > 20 ? "text-rose-300" : "text-emerald-400"
                }`}
              >
                {report.delinquencyRate.toFixed(1)}%
              </p>
              <span className="text-[10px] text-rose-400/80">Share of receivables past due</span>
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Aging Distribution Buckets (As of {formatDateMMDDYYYY(report.asOfDate)})
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {report.buckets.map((b) => {
                const isPastDue = b.bucketName !== "Current (Not Due)";
                const hasBalance = b.totalAmount > 0;
                const share =
                  report.totalReceivables > 0
                    ? (b.totalAmount / report.totalReceivables) * 100
                    : 0;
                return (
                  <div
                    key={b.bucketName}
                    className={`p-2.5 rounded-lg border transition-all ${
                      hasBalance && isPastDue
                        ? "bg-rose-950/20 border-rose-500/30 text-rose-200"
                        : hasBalance
                        ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-200"
                        : "bg-black/30 border-white/5 text-zinc-400"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5 min-h-[1.75rem]">
                      <span className="text-[10px] font-bold uppercase tracking-wider leading-tight text-white/90" title={b.bucketName}>
                        {b.bucketName}
                      </span>
                      <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-white/10 shrink-0">
                        {b.count}
                      </span>
                    </div>
                    <p
                      className={`text-base font-black mt-1 font-mono tabular-nums ${
                        hasBalance && isPastDue
                          ? "text-rose-400"
                          : hasBalance
                          ? "text-emerald-400"
                          : "text-zinc-400"
                      }`}
                    >
                      {formatCurrency(b.totalAmount)}
                    </p>
                    <div className="flex items-center justify-between text-[10px] mt-0.5 text-zinc-400">
                      <span>Share</span>
                      <span className="font-mono tabular-nums font-semibold">{share.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="surface-glass border border-white/5 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Outstanding Invoices Ledger</h4>
                <p className="text-[11px] text-zinc-400">
                  Detailed invoice status, due dates, and days overdue
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                {allInvoices.length} open invoices
              </span>
            </div>

            {allInvoices.length === 0 ? (
              <div className="py-6 text-center text-zinc-400 text-xs">
                No unpaid invoices found! All invoices are fully collected.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400 uppercase tracking-wider text-[10px] whitespace-nowrap">
                      <th className="py-2 px-2.5 font-bold">Invoice #</th>
                      <th className="py-2 px-2.5 font-bold">Customer / Client</th>
                      <th className="py-2 px-2.5 font-bold">Issue / Due</th>
                      <th className="py-2 px-2.5 font-bold">Status</th>
                      <th className="py-2 px-2.5 font-bold text-center">Overdue</th>
                      <th className="py-2 px-2.5 font-bold">Aging Bucket</th>
                      <th className="py-2 px-2.5 font-bold text-right">Invoiced</th>
                      <th className="py-2 px-2.5 font-bold text-right">Paid</th>
                      <th className="py-2 px-2.5 font-bold text-right">Balance Due</th>
                      <th className="py-2 px-2.5 font-bold text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 whitespace-nowrap">
                    {allInvoices.map((inv) => {
                      const isOverdue = inv.daysOverdue > 0;
                      const badgeVariant =
                        inv.status === "OVERDUE"
                          ? "danger"
                          : inv.status === "PARTIALLY_PAID"
                          ? "warning"
                          : "info";
                      return (
                        <tr key={inv.id} className="hover:bg-white/5 transition-colors">
                          <td className="py-1.5 px-2.5 font-mono font-bold text-white">
                            {inv.invoiceNumber}
                          </td>
                          <td className="py-1.5 px-2.5 font-semibold text-zinc-200">
                            {inv.clientName}
                          </td>
                          <td className="py-1.5 px-2.5 text-zinc-400 font-mono tabular-nums">
                            <span>{formatDateMMDDYYYY(inv.issueDate)}</span>
                            <span className="text-[10px] text-zinc-400 block">
                              Due: {formatDateMMDDYYYY(inv.dueDate)}
                            </span>
                          </td>
                          <td className="py-1.5 px-2.5">
                            <Badge variant={badgeVariant} size="sm" glow={inv.status === "OVERDUE"}>
                              {inv.status === "PARTIALLY_PAID" ? "PARTIAL" : inv.status}
                            </Badge>
                          </td>
                          <td className="py-1.5 px-2.5 text-center">
                            {isOverdue ? (
                              <Badge variant="danger" size="sm" className="font-mono">
                                {inv.daysOverdue}d overdue
                              </Badge>
                            ) : (
                              <Badge variant="success" size="sm">
                                Current
                              </Badge>
                            )}
                          </td>
                          <td className="py-1.5 px-2.5">
                            <Badge variant="neutral" size="sm">
                              {inv.bucketName}
                            </Badge>
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-zinc-300">
                            {formatCurrency(inv.totalAmount)}
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-zinc-400">
                            {inv.amountPaid > 0 ? formatCurrency(inv.amountPaid) : "—"}
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums font-bold text-white">
                            {formatCurrency(inv.balanceDue)}
                          </td>
                          <td className="py-1.5 px-2.5 text-right">
                            {onOpenInvoiceDetail && (
                              <Button
                                variant="secondary"
                                size="sm"
                                glow
                                onClick={() => onOpenInvoiceDetail(inv.id)}
                                title="Open invoice in the Invoices panel"
                              >
                                View
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-white/20 font-bold text-zinc-100">
                      <td colSpan={6} className="py-2 px-2.5 uppercase tracking-wider text-right pr-4 text-[11px]">
                        Total Balance Due:
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-zinc-300">
                        {formatCents(totalInvoicedCents)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-zinc-300">
                        {formatCents(totalPaidCents)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-white text-xs font-bold">
                        {formatCurrency(report.totalReceivables)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {(report.clients || []).length > 0 && (
            <div className="surface-glass border border-white/5 rounded-xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Client Receivables Concentration</h4>
                  <p className="text-[11px] text-zinc-400">
                    Summary of outstanding and overdue balances grouped by client
                  </p>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                  {(report.clients || []).length} clients
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400 uppercase tracking-wider text-[10px]">
                      <th className="py-2 px-2.5 font-bold">Client Name</th>
                      <th className="py-2 px-2.5 font-bold text-center">Open Invoices</th>
                      <th className="py-2 px-2.5 font-bold text-right">Current</th>
                      <th className="py-2 px-2.5 font-bold text-right">Overdue</th>
                      <th className="py-2 px-2.5 font-bold text-right">Total Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(report.clients || []).map((c) => (
                      <tr key={c.clientName} className="hover:bg-white/5 transition-colors">
                        <td className="py-1.5 px-2.5 font-semibold text-white">{c.clientName}</td>
                        <td className="py-1.5 px-2.5 text-center font-mono tabular-nums text-zinc-300">
                          {c.invoiceCount}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-emerald-400">
                          {formatCurrency(c.currentAmount)}
                        </td>
                        <td
                          className={`py-1.5 px-2.5 text-right font-mono tabular-nums font-bold ${
                            c.overdueAmount > 0 ? "text-rose-400" : "text-zinc-400"
                          }`}
                        >
                          {formatCurrency(c.overdueAmount)}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums font-bold text-white">
                          {formatCurrency(c.totalOutstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
