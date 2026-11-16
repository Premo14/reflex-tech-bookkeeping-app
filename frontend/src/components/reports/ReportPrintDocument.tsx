import type {
  ARAgingReport,
  CashFlowReport,
  ProfitLossReport,
  ScheduleCReport,
  TrialBalanceReport,
  VendorSpendReport,
} from "../../types/models";
import type { ReportTab } from "../ReportsModal";
import { formatDateMMDDYYYY } from "../../utils/dateUtils";
import { formatCents, formatCurrency, toCents } from "../../utils/formatCurrency";
import { formatMonthLabel } from "./reportHelpers";

interface ReportPrintDocumentProps {
  activeTab: ReportTab;
  companyName: string;
  startDate: string;
  endDate: string;
  asOfDate: string;
  dsoWindow: number;
  taxYear: number;
  tbTypeFilter: string;
  plReport: ProfitLossReport | null;
  cashFlowReport: CashFlowReport | null;
  vendorSpendReport: VendorSpendReport | null;
  arAgingReport: ARAgingReport | null;
  scheduleCReport: ScheduleCReport | null;
  trialBalanceReport: TrialBalanceReport | null;
}

export function ReportPrintDocument({
  activeTab,
  companyName,
  startDate,
  endDate,
  asOfDate,
  dsoWindow,
  taxYear,
  tbTypeFilter,
  plReport,
  cashFlowReport,
  vendorSpendReport,
  arAgingReport,
  scheduleCReport,
  trialBalanceReport,
}: ReportPrintDocumentProps) {
  const displayCompany = (companyName || "").trim() || "Unnamed Company";
  const periodLabel =
    startDate || endDate
      ? `${formatDateMMDDYYYY(startDate) || "Beginning"} – ${formatDateMMDDYYYY(endDate) || "Present"}`
      : "All Time (Open Books)";

  const getMeta = () => {
    switch (activeTab) {
      case "pl":
        return {
          title: "Profit & Loss Statement (Income Statement)",
          subtitle: "Operating revenue, deductible business expenses & net operating profit",
          period: `Reporting Period: ${
            plReport?.startDate || plReport?.endDate
              ? `${formatDateMMDDYYYY(plReport.startDate)} – ${formatDateMMDDYYYY(plReport.endDate)}`
              : periodLabel
          }`,
        };
      case "cash_flow":
        return {
          title: "Cash Flow Summary Report",
          subtitle: "Liquid cash inflows, disbursements, monthly trajectory & retention rate",
          period: `Reporting Period: ${
            cashFlowReport?.startDate || cashFlowReport?.endDate
              ? `${formatDateMMDDYYYY(cashFlowReport.startDate)} – ${formatDateMMDDYYYY(cashFlowReport.endDate)}`
              : periodLabel
          }`,
        };
      case "vendor_spend":
        return {
          title: "Vendor Spend & 1099-NEC Analytics Report",
          subtitle: "Normalized payee outflow ranking, supplier concentration & IRS 1099-NEC thresholds",
          period: `Reporting Period: ${
            vendorSpendReport?.startDate || vendorSpendReport?.endDate
              ? `${formatDateMMDDYYYY(vendorSpendReport.startDate)} – ${formatDateMMDDYYYY(vendorSpendReport.endDate)}`
              : periodLabel
          }`,
        };
      case "ar_aging":
        return {
          title: "Accounts Receivable (A/R) Aging Schedule",
          subtitle: "Unpaid client invoices categorized by 30/60/90+ day delinquency buckets",
          period: `As of Date: ${formatDateMMDDYYYY(arAgingReport?.asOfDate || asOfDate)} • DSO Window: ${
            arAgingReport?.salesDays || dsoWindow
          } Days`,
        };
      case "schedule_c":
        return {
          title: `IRS Form 1040 Schedule C — Tax Year ${scheduleCReport?.year || taxYear}`,
          subtitle: "Profit or Loss From Business (Sole Proprietorship / Single-Member LLC)",
          period: `Tax Period: 01/01/${scheduleCReport?.year || taxYear} – 12/31/${scheduleCReport?.year || taxYear}`,
        };
      case "trial_balance":
        return {
          title: "General Ledger Trial Balance",
          subtitle: "GAAP double-entry debit & credit mathematical verification schedule",
          period: `Reporting Period: ${
            trialBalanceReport?.startDate || trialBalanceReport?.endDate
              ? `${formatDateMMDDYYYY(trialBalanceReport.startDate)} – ${formatDateMMDDYYYY(trialBalanceReport.endDate)}`
              : periodLabel
          }`,
        };
    }
  };

  const meta = getMeta();

  return (
    <div
      data-testid="report-print-document"
      className="hidden print:block bg-white text-black font-sans text-xs leading-normal w-full"
    >
      {/* Formal Financial Statement Header */}
      <div className="border-b-2 border-zinc-900 pb-3 mb-4 flex justify-between items-end gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
            {displayCompany}
          </p>
          <h1 className="text-lg font-black uppercase tracking-tight text-zinc-950 mt-0.5">
            {meta.title}
          </h1>
          <p className="text-[11px] text-zinc-600">{meta.subtitle}</p>
        </div>
        <div className="text-right font-mono text-[11px] text-zinc-700 shrink-0">
          <p className="font-bold text-zinc-950">{meta.period}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Basis: Cash / Double-Entry Verified
          </p>
        </div>
      </div>

      {/* 1. PROFIT & LOSS PRINT VIEW */}
      {activeTab === "pl" && plReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 border border-zinc-300 bg-zinc-50 divide-x divide-zinc-300 text-xs break-inside-avoid">
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Total Revenue</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(plReport.totalRevenue)}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Operating Expenses</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(plReport.totalExpenses)}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Net Operating Income</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(plReport.netIncome)}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Net Profit Margin</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {(plReport.netMarginPercent ?? 0).toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="break-inside-avoid">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1.5">
              I. Operating Revenue
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-zinc-900 bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-800">
                  <th className="py-1.5 px-2 text-left w-24">Code</th>
                  <th className="py-1.5 px-2 text-left">Account Name</th>
                  <th className="py-1.5 px-2 text-right w-28">Share %</th>
                  <th className="py-1.5 px-2 text-right w-32">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {(plReport.revenue ?? []).map((line) => {
                  const pct =
                    plReport.totalRevenue > 0 ? (line.total / plReport.totalRevenue) * 100 : 0;
                  return (
                    <tr key={line.accountCode} className="break-inside-avoid">
                      <td className="py-1.5 px-2 font-mono font-bold text-zinc-700">{line.accountCode}</td>
                      <td className="py-1.5 px-2 text-zinc-900">{line.accountName}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-zinc-600">
                        {pct.toFixed(1)}%
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium text-zinc-950">
                        {formatCurrency(line.total)}
                      </td>
                    </tr>
                  );
                })}
                {(plReport.revenue ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 px-2 text-zinc-500 italic">
                      No operating revenue recorded in this period.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-b-2 border-zinc-900 bg-zinc-50 font-bold">
                  <td colSpan={3} className="py-1.5 px-2 uppercase text-[11px]">
                    Total Operating Revenue
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-zinc-950">
                    {formatCurrency(plReport.totalRevenue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1.5">
              II. Operating Expenses
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-zinc-900 bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-800">
                  <th className="py-1.5 px-2 text-left w-24">Code</th>
                  <th className="py-1.5 px-2 text-left">Account Name</th>
                  <th className="py-1.5 px-2 text-right w-28">% of Expense</th>
                  <th className="py-1.5 px-2 text-right w-32">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {(plReport.expenses ?? []).map((line) => {
                  const pct =
                    plReport.totalExpenses > 0 ? (line.total / plReport.totalExpenses) * 100 : 0;
                  return (
                    <tr key={line.accountCode} className="break-inside-avoid">
                      <td className="py-1.5 px-2 font-mono font-bold text-zinc-700">{line.accountCode}</td>
                      <td className="py-1.5 px-2 text-zinc-900">{line.accountName}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-zinc-600">
                        {pct.toFixed(1)}%
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium text-zinc-950">
                        {formatCurrency(line.total)}
                      </td>
                    </tr>
                  );
                })}
                {(plReport.expenses ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 px-2 text-zinc-500 italic">
                      No operating expenses recorded in this period.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-b-2 border-zinc-900 bg-zinc-50 font-bold">
                  <td colSpan={3} className="py-1.5 px-2 uppercase text-[11px]">
                    Total Operating Expenses
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-zinc-950">
                    {formatCurrency(plReport.totalExpenses)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="border-t-2 border-b-4 border-double border-zinc-900 py-2.5 px-2 bg-zinc-50 flex justify-between items-center break-inside-avoid">
            <div>
              <span className="text-sm font-black uppercase tracking-wider text-zinc-950">
                Net Operating Income (Profit / Loss)
              </span>
              <span className="block text-[10px] font-mono text-zinc-600">
                Net Margin: {(plReport.netMarginPercent ?? 0).toFixed(1)}%
                {Boolean(plReport.totalTax && plReport.totalTax > 0) &&
                  ` • Extracted Receipt Sales Tax: ${formatCurrency(plReport.totalTax ?? 0)}`}
              </span>
            </div>
            <span className="text-base font-black font-mono tabular-nums text-zinc-950">
              {formatCurrency(plReport.netIncome)}
            </span>
          </div>

          {((plReport.uncategorizedTxCount || 0) + (plReport.uncategorizedExpCount || 0) > 0 ||
            (plReport.excludedTxCount || 0) + (plReport.excludedExpCount || 0) > 0) && (
            <div className="border border-zinc-300 p-2.5 text-[10px] text-zinc-700 space-y-1 break-inside-avoid">
              <p className="font-bold uppercase text-zinc-900">Audit &amp; Reconciliation Notes:</p>
              {(plReport.uncategorizedTxCount || 0) + (plReport.uncategorizedExpCount || 0) > 0 && (
                <p>
                  • Suspense Items Included: {plReport.uncategorizedTxCount} bank transactions and{" "}
                  {plReport.uncategorizedExpCount} standalone expenses are currently assigned to Suspense (Accounts 9998 / 9999).
                </p>
              )}
              {(plReport.excludedTxCount || 0) + (plReport.excludedExpCount || 0) > 0 && (
                <p>
                  • Excluded Non-Operating Items Omitted:{" "}
                  {plReport.excludedTxCount > 0 &&
                    `${plReport.excludedTxCount} transactions (${formatCurrency(plReport.excludedTxTotal)})`}
                  {plReport.excludedTxCount > 0 && plReport.excludedExpCount > 0 && "; "}
                  {plReport.excludedExpCount > 0 &&
                    `${plReport.excludedExpCount} expenses (${formatCurrency(plReport.excludedExpTotal)})`}
                  .
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. CASH FLOW PRINT VIEW */}
      {activeTab === "cash_flow" && cashFlowReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 border border-zinc-300 bg-zinc-50 divide-x divide-zinc-300 text-xs break-inside-avoid">
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Total Cash In (+)</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(cashFlowReport.totalCashIn)}
              </span>
              <span className="text-[10px] font-mono text-zinc-500 block">
                Avg: {formatCurrency(cashFlowReport.avgMonthlyInflow)} / mo
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Total Cash Out (-)</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(cashFlowReport.totalCashOut)}
              </span>
              <span className="text-[10px] font-mono text-zinc-500 block">
                Avg: {formatCurrency(cashFlowReport.avgMonthlyOutflow)} / mo
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Net Cash Flow</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {cashFlowReport.netCashFlow >= 0 ? "+" : ""}
                {formatCurrency(cashFlowReport.netCashFlow)}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Cash Savings Rate</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {cashFlowReport.savingsRatePercent.toFixed(1)}%
              </span>
            </div>
          </div>

          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1.5">
              Monthly Cash Flow Schedule
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-zinc-900 bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-800">
                  <th className="py-1.5 px-2 text-left">Month / Period</th>
                  <th className="py-1.5 px-2 text-right">Cash In (+)</th>
                  <th className="py-1.5 px-2 text-right">Cash Out (-)</th>
                  <th className="py-1.5 px-2 text-right">Net Cash Flow</th>
                  <th className="py-1.5 px-2 text-center">Status</th>
                  <th className="py-1.5 px-2 text-right">Cumulative Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {(cashFlowReport.periods ?? []).map((p) => {
                  const isPos = p.netCashFlow >= 0;
                  return (
                    <tr key={p.period} className="break-inside-avoid">
                      <td className="py-1.5 px-2 font-medium text-zinc-900">
                        {formatMonthLabel(p.period)}{" "}
                        <span className="font-mono text-[10px] text-zinc-500">({p.period})</span>
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-zinc-900">
                        {formatCurrency(p.cashIn)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-zinc-900">
                        {formatCurrency(p.cashOut)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums font-bold text-zinc-950">
                        {isPos ? "+" : ""}
                        {formatCurrency(p.netCashFlow)}
                      </td>
                      <td className="py-1.5 px-2 text-center font-mono text-[10px] uppercase text-zinc-700">
                        {isPos ? "Surplus" : "Burn"}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold text-zinc-900">
                        {p.runningCashTotal >= 0 ? "+" : ""}
                        {formatCurrency(p.runningCashTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-b-2 border-zinc-900 bg-zinc-50 font-bold">
                  <td className="py-1.5 px-2 uppercase text-[11px]">Total Period</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(cashFlowReport.totalCashIn)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(cashFlowReport.totalCashOut)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {cashFlowReport.netCashFlow >= 0 ? "+" : ""}
                    {formatCurrency(cashFlowReport.netCashFlow)}
                  </td>
                  <td className="py-1.5 px-2 text-center text-[10px] uppercase font-mono">Net Position</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(cashFlowReport.netCashFlow)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 3. VENDOR SPEND PRINT VIEW */}
      {activeTab === "vendor_spend" && vendorSpendReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 border border-zinc-300 bg-zinc-50 divide-x divide-zinc-300 text-xs break-inside-avoid">
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Total Outflow Analyzed</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(vendorSpendReport.totalSpend)}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Unique Payees</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {vendorSpendReport.totalVendors}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">Top 5 Concentration</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {vendorSpendReport.top5Percent.toFixed(1)}%
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">1099-NEC Contractors</span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {vendorSpendReport.contractorsOver600 || 0} ({formatCurrency(vendorSpendReport.total1099Spend || 0)})
              </span>
            </div>
          </div>

          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1.5">
              Vendor Ranking &amp; Spend Schedule
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-zinc-900 bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-800">
                  <th className="py-1.5 px-2 text-center w-12">Rank</th>
                  <th className="py-1.5 px-2 text-left">Vendor / Payee</th>
                  <th className="py-1.5 px-2 text-center">1099-NEC</th>
                  <th className="py-1.5 px-2 text-left">Primary Category</th>
                  <th className="py-1.5 px-2 text-center">Txns</th>
                  <th className="py-1.5 px-2 text-right">Avg Ticket</th>
                  <th className="py-1.5 px-2 text-right">Share %</th>
                  <th className="py-1.5 px-2 text-right">Total Spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {(vendorSpendReport.vendors ?? []).map((v, idx) => (
                  <tr key={v.vendorName} className="break-inside-avoid">
                    <td className="py-1.5 px-2 text-center font-mono tabular-nums text-zinc-700">
                      #{idx + 1}
                    </td>
                    <td className="py-1.5 px-2 font-semibold text-zinc-950">{v.vendorName}</td>
                    <td className="py-1.5 px-2 text-center font-mono text-[10px]">
                      {v.requires1099 ? (
                        <span className="font-bold text-zinc-950">YES (&gt;=$600)</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-zinc-700">
                      {v.primaryCategoryCode
                        ? `${v.primaryCategoryCode} — ${v.primaryCategoryName}`
                        : v.primaryCategoryName || "Uncategorized"}
                    </td>
                    <td className="py-1.5 px-2 text-center font-mono tabular-nums text-zinc-700">
                      {v.transactionCount}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums text-zinc-700">
                      {formatCurrency(v.averageSpend)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums text-zinc-700">
                      {v.percentOfTotal.toFixed(1)}%
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums font-bold text-zinc-950">
                      {formatCurrency(v.totalSpend)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-b-2 border-zinc-900 bg-zinc-50 font-bold">
                  <td colSpan={6} className="py-1.5 px-2 uppercase text-[11px]">
                    Total Vendor Outflow ({vendorSpendReport.totalVendors} Payees)
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">100.0%</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(vendorSpendReport.totalSpend)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 4. A/R AGING PRINT VIEW */}
      {activeTab === "ar_aging" && arAgingReport && (() => {
        const allInvoices = (arAgingReport.buckets ?? []).flatMap((b) =>
          (b.invoices || []).map((inv) => ({ ...inv, bucketName: b.bucketName }))
        );
        const totalInvoicedCents = allInvoices.reduce((s, inv) => s + toCents(inv.totalAmount), 0);
        const totalPaidCents = allInvoices.reduce((s, inv) => s + toCents(inv.amountPaid), 0);

        return (
          <div className="space-y-4">
            {/* Compact 6-metric Executive Strip */}
            <div className="grid grid-cols-6 border border-zinc-300 bg-zinc-50 divide-x divide-zinc-300 text-xs break-inside-avoid">
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">Total Receivables</span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(arAgingReport.totalReceivables)}
                </span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">Current (Not Due)</span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(arAgingReport.totalCurrent)}
                </span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">Total Overdue</span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(arAgingReport.totalOverdue)}
                </span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">Open Invoices</span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {arAgingReport.invoiceCount} ({(arAgingReport.clients || []).length} clients)
                </span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">
                  DSO ({arAgingReport.salesDays}d)
                </span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {arAgingReport.dsoDays.toFixed(1)} days
                </span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">Delinquency Rate</span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {arAgingReport.delinquencyRate.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Compact Aging Distribution Table */}
            <div className="break-inside-avoid">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1">
                I. Aging Bucket Distribution (As of {formatDateMMDDYYYY(arAgingReport.asOfDate)})
              </h2>
              <div className="grid grid-cols-5 border border-zinc-300 divide-x divide-zinc-300 text-xs">
                {(arAgingReport.buckets ?? []).map((b) => {
                  const share =
                    arAgingReport.totalReceivables > 0
                      ? (b.totalAmount / arAgingReport.totalReceivables) * 100
                      : 0;
                  return (
                    <div key={b.bucketName} className="p-2">
                      <div className="flex justify-between items-center text-[10px] font-bold uppercase text-zinc-700">
                        <span>{b.bucketName}</span>
                        <span className="font-mono">({b.count})</span>
                      </div>
                      <p className="text-xs font-bold font-mono tabular-nums text-zinc-950 mt-0.5">
                        {formatCurrency(b.totalAmount)}
                      </p>
                      <p className="text-[10px] font-mono tabular-nums text-zinc-500">
                        Share: {share.toFixed(1)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Outstanding Invoices Schedule (No Action/View column!) */}
            <div className="break-inside-avoid">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1">
                II. Outstanding Invoices Ledger ({allInvoices.length} Open Invoices)
              </h2>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-y border-zinc-900 bg-zinc-100 text-[9px] font-bold uppercase tracking-wider text-zinc-800">
                    <th className="py-1.5 px-1.5 text-left">Invoice #</th>
                    <th className="py-1.5 px-1.5 text-left">Customer / Client</th>
                    <th className="py-1.5 px-1.5 text-left">Issue Date</th>
                    <th className="py-1.5 px-1.5 text-left">Due Date</th>
                    <th className="py-1.5 px-1.5 text-center">Status</th>
                    <th className="py-1.5 px-1.5 text-center">Overdue</th>
                    <th className="py-1.5 px-1.5 text-left">Aging Bucket</th>
                    <th className="py-1.5 px-1.5 text-right">Invoiced</th>
                    <th className="py-1.5 px-1.5 text-right">Paid</th>
                    <th className="py-1.5 px-1.5 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {allInvoices.map((inv) => (
                    <tr key={inv.id} className="break-inside-avoid">
                      <td className="py-1 px-1.5 font-mono font-bold text-zinc-950">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-1 px-1.5 font-medium text-zinc-900">{inv.clientName}</td>
                      <td className="py-1 px-1.5 font-mono tabular-nums text-zinc-700">
                        {formatDateMMDDYYYY(inv.issueDate)}
                      </td>
                      <td className="py-1 px-1.5 font-mono tabular-nums text-zinc-700">
                        {formatDateMMDDYYYY(inv.dueDate)}
                      </td>
                      <td className="py-1 px-1.5 text-center font-mono text-[10px] uppercase font-semibold text-zinc-800">
                        {inv.status === "PARTIALLY_PAID" ? "PARTIAL" : inv.status}
                      </td>
                      <td className="py-1 px-1.5 text-center font-mono tabular-nums text-[10px] text-zinc-800">
                        {inv.daysOverdue > 0 ? `${inv.daysOverdue}d` : "Current"}
                      </td>
                      <td className="py-1 px-1.5 text-[10px] text-zinc-700">{inv.bucketName}</td>
                      <td className="py-1 px-1.5 text-right font-mono tabular-nums text-zinc-800">
                        {formatCurrency(inv.totalAmount)}
                      </td>
                      <td className="py-1 px-1.5 text-right font-mono tabular-nums text-zinc-600">
                        {inv.amountPaid > 0 ? formatCurrency(inv.amountPaid) : "—"}
                      </td>
                      <td className="py-1 px-1.5 text-right font-mono tabular-nums font-bold text-zinc-950">
                        {formatCurrency(inv.balanceDue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-b-2 border-zinc-900 bg-zinc-50 font-bold">
                    <td colSpan={7} className="py-1.5 px-1.5 text-right uppercase text-[10px]">
                      Total Balance Due:
                    </td>
                    <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">
                      {formatCents(totalInvoicedCents)}
                    </td>
                    <td className="py-1.5 px-1.5 text-right font-mono tabular-nums">
                      {formatCents(totalPaidCents)}
                    </td>
                    <td className="py-1.5 px-1.5 text-right font-mono tabular-nums text-zinc-950">
                      {formatCurrency(arAgingReport.totalReceivables)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Client Receivables Concentration */}
            {(arAgingReport.clients || []).length > 0 && (
              <div className="break-inside-avoid">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1">
                  III. Client Receivables Concentration ({(arAgingReport.clients || []).length} Clients)
                </h2>
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-y border-zinc-900 bg-zinc-100 text-[9px] font-bold uppercase tracking-wider text-zinc-800">
                      <th className="py-1.5 px-2 text-left">Client Name</th>
                      <th className="py-1.5 px-2 text-center">Open Invoices</th>
                      <th className="py-1.5 px-2 text-right">Current (Not Due)</th>
                      <th className="py-1.5 px-2 text-right">Overdue Balance</th>
                      <th className="py-1.5 px-2 text-right">Total Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {(arAgingReport.clients || []).map((c) => (
                      <tr key={c.clientName} className="break-inside-avoid">
                        <td className="py-1 px-2 font-semibold text-zinc-950">{c.clientName}</td>
                        <td className="py-1 px-2 text-center font-mono tabular-nums text-zinc-700">
                          {c.invoiceCount}
                        </td>
                        <td className="py-1 px-2 text-right font-mono tabular-nums text-zinc-800">
                          {formatCurrency(c.currentAmount)}
                        </td>
                        <td className="py-1 px-2 text-right font-mono tabular-nums font-semibold text-zinc-900">
                          {formatCurrency(c.overdueAmount)}
                        </td>
                        <td className="py-1 px-2 text-right font-mono tabular-nums font-bold text-zinc-950">
                          {formatCurrency(c.totalOutstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-b-2 border-zinc-900 bg-zinc-50 font-bold">
                      <td className="py-1.5 px-2 uppercase text-[10px]">Total Client Receivables</td>
                      <td className="py-1.5 px-2 text-center font-mono tabular-nums">
                        {arAgingReport.invoiceCount}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                        {formatCurrency(arAgingReport.totalCurrent)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                        {formatCurrency(arAgingReport.totalOverdue)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                        {formatCurrency(arAgingReport.totalReceivables)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* 5. SCHEDULE C PRINT VIEW */}
      {activeTab === "schedule_c" && scheduleCReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 border border-zinc-300 bg-zinc-50 divide-x divide-zinc-300 text-xs break-inside-avoid">
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">
                Gross Income (Line 7)
              </span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(scheduleCReport.grossIncome)}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">
                Deductible Expenses (Line 28)
              </span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(scheduleCReport.totalExpensesDeductible)}
              </span>
              <span className="text-[10px] font-mono text-zinc-500 block">
                Gross: {formatCurrency(scheduleCReport.totalExpensesGross)}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">
                Net Profit / Loss (Line 31)
              </span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(scheduleCReport.netProfitOrLoss)}
              </span>
            </div>
            <div className="p-2.5">
              <span className="text-[10px] font-bold uppercase text-zinc-600 block">
                50% Meals Disallowed
              </span>
              <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                {formatCurrency(scheduleCReport.nondeductibleMeals)}
              </span>
            </div>
          </div>

          <div className="break-inside-avoid">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1">
              Part I: Income (IRS Form 1040 Schedule C, Lines 1–7)
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-zinc-900 bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-800">
                  <th className="py-1 px-2 text-left w-24">IRS Line</th>
                  <th className="py-1 px-2 text-left">Description</th>
                  <th className="py-1 px-2 text-right w-36">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                <tr>
                  <td className="py-1 px-2 font-mono font-bold">Line 1</td>
                  <td className="py-1 px-2">Gross receipts or sales</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(scheduleCReport.grossReceipts)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 px-2 font-mono font-bold">Line 2</td>
                  <td className="py-1 px-2">Returns and allowances</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                    ({formatCurrency(scheduleCReport.returnsAndAllowances)})
                  </td>
                </tr>
                <tr>
                  <td className="py-1 px-2 font-mono font-bold">Line 3</td>
                  <td className="py-1 px-2">Net receipts (Line 1 minus Line 2)</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(scheduleCReport.netReceipts)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 px-2 font-mono font-bold">Line 4</td>
                  <td className="py-1 px-2">Cost of goods sold (COGS)</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                    ({formatCurrency(scheduleCReport.costOfGoodsSold)})
                  </td>
                </tr>
                <tr>
                  <td className="py-1 px-2 font-mono font-bold">Line 5</td>
                  <td className="py-1 px-2">Gross profit (Line 3 minus Line 4)</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(scheduleCReport.grossProfit)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 px-2 font-mono font-bold">Line 6</td>
                  <td className="py-1 px-2">
                    Other income (interest, refunds)
                    {scheduleCReport.uncategorizedIncomeAmount > 0 &&
                      ` (includes ${formatCurrency(scheduleCReport.uncategorizedIncomeAmount)} Suspense 9998)`}
                  </td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(scheduleCReport.otherIncome)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t border-b-2 border-zinc-900 bg-zinc-50 font-bold">
                  <td className="py-1.5 px-2 font-mono">Line 7</td>
                  <td className="py-1.5 px-2 uppercase text-[11px]">Gross Income</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(scheduleCReport.grossIncome)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1">
              Part II: Expenses (IRS Form 1040 Schedule C, Lines 8–28)
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-zinc-900 bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-800">
                  <th className="py-1 px-2 text-left w-20">IRS Line</th>
                  <th className="py-1 px-2 text-left">Category &amp; Underlying Accounts</th>
                  <th className="py-1 px-2 text-right w-28">Gross Spend</th>
                  <th className="py-1 px-2 text-center w-16">Rate</th>
                  <th className="py-1 px-2 text-right w-32">Allowable Deduction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {(scheduleCReport.expenseLines ?? []).map((line) => (
                  <tr key={`${line.lineNumber}-${line.lineName}`} className="break-inside-avoid">
                    <td className="py-1.5 px-2 font-mono font-bold align-top">{line.lineNumber}</td>
                    <td className="py-1.5 px-2 align-top">
                      <div className="font-semibold text-zinc-950">{line.lineName}</div>
                      {(line.accounts ?? []).length > 0 && (
                        <div className="text-[10px] font-mono text-zinc-600 mt-0.5 space-x-2">
                          {line.accounts.map((acc) => (
                            <span key={acc.accountId || acc.accountCode} className="inline-block">
                              [{acc.accountCode} {acc.accountName}: {formatCurrency(acc.total)}]
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums align-top text-zinc-700">
                      {formatCurrency(line.grossAmount)}
                    </td>
                    <td className="py-1.5 px-2 text-center font-mono tabular-nums align-top text-zinc-700">
                      {line.deductiblePercent}%
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums font-bold align-top text-zinc-950">
                      {formatCurrency(line.deductibleAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-900 bg-zinc-50 font-bold">
                  <td className="py-1.5 px-2 font-mono">Line 28</td>
                  <td className="py-1.5 px-2 uppercase text-[11px]">Total Allowable Deductions</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(scheduleCReport.totalExpensesGross)}
                  </td>
                  <td />
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(scheduleCReport.totalExpensesDeductible)}
                  </td>
                </tr>
                <tr className="border-t-2 border-b-4 border-double border-zinc-900 bg-zinc-100 font-black text-sm">
                  <td className="py-2 px-2 font-mono">Line 31</td>
                  <td colSpan={3} className="py-2 px-2 uppercase">
                    Net Profit or (Loss) (Line 7 minus Line 28)
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatCurrency(scheduleCReport.netProfitOrLoss)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="break-inside-avoid">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 mb-1">
              Part III: IRS Form 1040-ES Quarterly Estimated Tax &amp; Schedule SE Projection
            </h2>
            <div className="grid grid-cols-4 border border-zinc-300 bg-zinc-50 divide-x divide-zinc-300 text-xs">
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">
                  Schedule SE Tax (15.3%)
                </span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(scheduleCReport.selfEmploymentTax || 0)}
                </span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">
                  50% SE Tax Deduction
                </span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(scheduleCReport.deductibleSelfEmploymentTax || 0)}
                </span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">
                  Total Annual Est. Tax
                </span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(scheduleCReport.totalEstimatedTax || 0)}
                </span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-bold uppercase text-zinc-600 block">
                  Quarterly 1040-ES Voucher
                </span>
                <span className="text-xs font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(scheduleCReport.estimatedQuarterlyTax || 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. TRIAL BALANCE PRINT VIEW */}
      {activeTab === "trial_balance" && trialBalanceReport && (() => {
        const accounts = trialBalanceReport.accounts ?? [];
        const filteredAccounts = accounts.filter(
          (acc) => tbTypeFilter === "ALL" || acc.accountType.toUpperCase() === tbTypeFilter
        );
        const filteredDebitSubtotal = filteredAccounts.reduce((s, a) => s + (a.netDebit || 0), 0);
        const filteredCreditSubtotal = filteredAccounts.reduce((s, a) => s + (a.netCredit || 0), 0);

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-4 border border-zinc-300 bg-zinc-50 divide-x divide-zinc-300 text-xs break-inside-avoid">
              <div className="p-2.5">
                <span className="text-[10px] font-bold uppercase text-zinc-600 block">Total Debits (Dr)</span>
                <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(trialBalanceReport.totalDebit)}
                </span>
              </div>
              <div className="p-2.5">
                <span className="text-[10px] font-bold uppercase text-zinc-600 block">Total Credits (Cr)</span>
                <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                  {formatCurrency(trialBalanceReport.totalCredit)}
                </span>
              </div>
              <div className="p-2.5">
                <span className="text-[10px] font-bold uppercase text-zinc-600 block">Ledger Variance</span>
                <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                  {formatCents(trialBalanceReport.varianceCents)} (
                  {trialBalanceReport.isBalanced ? "BALANCED" : "OUT OF BALANCE"})
                </span>
              </div>
              <div className="p-2.5">
                <span className="text-[10px] font-bold uppercase text-zinc-600 block">Active Accounts</span>
                <span className="text-sm font-bold font-mono tabular-nums text-zinc-950">
                  {accounts.length} {tbTypeFilter !== "ALL" ? `(Filtered: ${tbTypeFilter})` : ""}
                </span>
              </div>
            </div>

            <div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-y border-zinc-900 bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-800">
                    <th className="py-1.5 px-2 text-left w-16">Code</th>
                    <th className="py-1.5 px-2 text-left">Account Name</th>
                    <th className="py-1.5 px-2 text-left w-24">Type</th>
                    <th className="py-1.5 px-2 text-left w-24">Normal Bal</th>
                    <th className="py-1.5 px-2 text-right w-32">Debit ($)</th>
                    <th className="py-1.5 px-2 text-right w-32">Credit ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 font-mono">
                  {filteredAccounts.map((acc) => {
                    const isDebitNormal =
                      acc.accountType === "ASSET" || acc.accountType === "EXPENSE";
                    return (
                      <tr key={acc.accountId || acc.accountCode} className="break-inside-avoid">
                        <td className="py-1 px-2 font-bold text-zinc-800">{acc.accountCode}</td>
                        <td className="py-1 px-2 font-sans text-zinc-950 font-medium">
                          <span>{acc.accountName}</span>
                          {acc.grossDebit > 0 && acc.grossCredit > 0 && (
                            <span className="block text-[9px] font-mono text-zinc-500">
                              Gross Dr {formatCurrency(acc.grossDebit)} / Cr{" "}
                              {formatCurrency(acc.grossCredit)}
                            </span>
                          )}
                        </td>
                        <td className="py-1 px-2 font-sans text-[10px] uppercase font-semibold text-zinc-700">
                          {acc.accountType}
                        </td>
                        <td className="py-1 px-2 font-sans text-[10px] text-zinc-600">
                          {isDebitNormal ? "Debit (Dr)" : "Credit (Cr)"}
                        </td>
                        <td className="py-1 px-2 text-right tabular-nums text-zinc-950">
                          {acc.netDebit > 0 ? formatCurrency(acc.netDebit) : "—"}
                        </td>
                        <td className="py-1 px-2 text-right tabular-nums text-zinc-950">
                          {acc.netCredit > 0 ? formatCurrency(acc.netCredit) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="font-mono font-bold">
                  {tbTypeFilter !== "ALL" && filteredAccounts.length > 0 && (
                    <tr className="border-t border-zinc-400 bg-zinc-50">
                      <td colSpan={4} className="py-1 px-2 font-sans uppercase text-[10px]">
                        Filtered Subtotal ({tbTypeFilter})
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        {formatCurrency(filteredDebitSubtotal)}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        {formatCurrency(filteredCreditSubtotal)}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-b-4 border-double border-zinc-900 bg-zinc-100">
                    <td colSpan={4} className="py-1.5 px-2 font-sans uppercase text-[11px]">
                      Totals (All Accounts)
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {formatCurrency(trialBalanceReport.totalDebit)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {formatCurrency(trialBalanceReport.totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
