import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { ProfitLossReport } from "../../types/models";
import { formatDateMMDDYYYY } from "../../utils/dateUtils";
import { formatCurrency } from "../../utils/formatCurrency";

interface ProfitLossTabProps {
  report: ProfitLossReport | null;
  isLoading: boolean;
  onViewUncategorized?: () => void;
  onClose: () => void;
}

export function ProfitLossTab({
  report,
  isLoading,
  onViewUncategorized,
  onClose,
}: ProfitLossTabProps) {
  return (
    <>
      <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
        <svg className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <h5 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            What is a Profit &amp; Loss (P&amp;L) Statement?
          </h5>
          <p className="text-xs text-emerald-200/80 mt-1 leading-relaxed">
            The P&amp;L (also known as an Income Statement) summarizes the revenues, costs, and operating expenses incurred during a specific time window.
            It shows your net profitability—whether your core business model generates more operating income than it spends to stay open.
          </p>
        </div>
      </div>

      {!report && isLoading ? (
        <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
          <LoadingSpinner size="lg" color="text-emerald-500" className="mb-3" />
          <p className="text-sm">Generating Profit &amp; Loss statement...</p>
        </div>
      ) : !report ? (
        <div className="py-10 flex items-center justify-center text-zinc-400 flex-col">
          <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p>Select dates and generate to view P&amp;L</p>
        </div>
      ) : (
        <div
          className={`max-w-3xl mx-auto w-full space-y-5 surface-glass border border-white/5 p-4 sm:p-6 rounded-xl shadow-inner print:bg-white print:text-black print:border-none print:shadow-none print:p-0 transition-opacity duration-200 ${
            isLoading ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <div className="text-center border-b border-white/10 print:border-black/20 pb-4">
            <h3 className="text-xl font-bold uppercase tracking-wider text-white print:text-black">
              Profit and Loss Statement
            </h3>
            <p className="text-xs text-zinc-400 print:text-zinc-600 mt-1.5 font-medium font-mono tabular-nums">
              {formatDateMMDDYYYY(report.startDate)} – {formatDateMMDDYYYY(report.endDate)}
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold text-zinc-400 print:text-zinc-700 uppercase tracking-wider mb-2">
              Revenue
            </h4>
            <div className="space-y-0.5">
              {report.revenue.map((line) => (
                <div
                  key={line.accountCode}
                  className="flex justify-between items-center gap-3 py-1.5 border-b border-white/5 print:border-zinc-200 min-w-0 text-xs"
                >
                  <span className="text-zinc-300 print:text-zinc-800 truncate min-w-0 flex-1">
                    {line.accountName}{" "}
                    <span className="text-zinc-400 print:text-zinc-500 text-[11px] ml-2 font-mono">
                      {line.accountCode}
                    </span>
                  </span>
                  <span className="font-medium font-mono tabular-nums text-right shrink-0 print:text-black ml-2">
                    {formatCurrency(line.total)}
                  </span>
                </div>
              ))}
              {report.revenue.length === 0 && (
                <div className="text-xs text-zinc-400 py-2 italic">No revenue recorded</div>
              )}
            </div>
            <div className="flex justify-between items-center gap-3 py-2 mt-1 border-t border-white/10 print:border-black/30 min-w-0 text-xs">
              <span className="font-bold print:text-black truncate">Total Revenue</span>
              <span className="font-bold font-mono tabular-nums text-right shrink-0 text-emerald-400 print:text-emerald-700">
                {formatCurrency(report.totalRevenue)}
              </span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-zinc-400 print:text-zinc-700 uppercase tracking-wider mb-2">
              Operating Expenses
            </h4>
            <div className="space-y-0.5">
              {report.expenses.map((line) => (
                <div
                  key={line.accountCode}
                  className="flex justify-between items-center gap-3 py-1.5 border-b border-white/5 print:border-zinc-200 min-w-0 text-xs"
                >
                  <span className="text-zinc-300 print:text-zinc-800 truncate min-w-0 flex-1">
                    {line.accountName}{" "}
                    <span className="text-zinc-400 print:text-zinc-500 text-[11px] ml-2 font-mono">
                      {line.accountCode}
                    </span>
                  </span>
                  <span className="font-medium font-mono tabular-nums text-right shrink-0 print:text-black ml-2">
                    {formatCurrency(line.total)}
                  </span>
                </div>
              ))}
              {report.expenses.length === 0 && (
                <div className="text-xs text-zinc-400 py-2 italic">No expenses recorded</div>
              )}
            </div>
            <div className="flex justify-between items-center gap-3 py-2 mt-1 border-t border-white/10 print:border-black/30 min-w-0 text-xs">
              <span className="font-bold print:text-black truncate">Total Operating Expenses</span>
              <span className="font-bold font-mono tabular-nums text-right shrink-0 text-red-400 print:text-red-700">
                {formatCurrency(report.totalExpenses)}
              </span>
            </div>
          </div>

          <div className="pt-4 border-t-2 border-white/10 print:border-black">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-base font-bold uppercase tracking-wider print:text-black">Net Income</span>
                {report.netMarginPercent !== undefined && (
                  <span className="block text-[11px] text-zinc-400 print:text-zinc-600 mt-0.5">
                    Net Profit Margin:{" "}
                    <strong
                      className={`font-mono tabular-nums font-bold ${
                        report.netIncome >= 0
                          ? "text-emerald-400 print:text-emerald-700"
                          : "text-rose-400 print:text-rose-700"
                      }`}
                    >
                      {report.netMarginPercent.toFixed(1)}%
                    </strong>
                  </span>
                )}
              </div>
              <span
                className={`text-xl font-black font-mono tabular-nums ${
                  report.netIncome >= 0
                    ? "text-emerald-400 print:text-emerald-700"
                    : "text-red-400 print:text-red-700"
                }`}
              >
                {formatCurrency(report.netIncome)}
              </span>
            </div>
          </div>

          {Boolean(report.totalTax && report.totalTax > 0) && (
            <div className="pt-3 border-t border-white/5 print:border-zinc-200 flex justify-between items-center text-xs text-zinc-400 print:text-zinc-600">
              <span>Cumulative Sales Tax Paid (Extracted from Receipts):</span>
              <span className="font-semibold font-mono tabular-nums text-zinc-200 print:text-black">
                {formatCurrency(report.totalTax ?? 0)}
              </span>
            </div>
          )}

          {(report.uncategorizedExpCount > 0 || report.uncategorizedTxCount > 0) && (
            <div className="mt-8 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:border-amber-400 print:bg-amber-50">
              <svg
                className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 print:hidden"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <h5 className="text-sm font-bold text-amber-500 print:text-amber-800">
                  Uncategorized Items in Suspense
                </h5>
                <p className="text-sm text-amber-200/80 print:text-amber-900 mt-1">
                  There are {report.uncategorizedTxCount} transactions and {report.uncategorizedExpCount} expenses
                  without an assigned category in this period. These are currently included under Suspense (Accounts
                  9998 / 9999).
                </p>
                {onViewUncategorized && (
                  <Button
                    variant="warning"
                    size="sm"
                    glow
                    onClick={() => {
                      onViewUncategorized();
                      onClose();
                    }}
                    className="mt-2.5 print:hidden"
                  >
                    Filter Uncategorized in Ledger →
                  </Button>
                )}
              </div>
            </div>
          )}

          {(report.excludedExpCount > 0 || report.excludedTxCount > 0) && (
            <div className="mt-4 bg-zinc-500/10 border border-zinc-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:border-zinc-300 print:bg-zinc-50">
              <svg
                className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5 print:hidden"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h5 className="text-sm font-bold text-zinc-400 print:text-zinc-800">Excluded Items Footnote</h5>
                <p className="text-sm text-zinc-400 print:text-zinc-700 mt-1">
                  This period contains intentionally excluded items (duplicates or personal expenses) omitted from the
                  operating calculations above:
                </p>
                <ul className="text-sm text-zinc-400 print:text-zinc-700 mt-1 list-disc list-inside">
                  {report.excludedTxCount > 0 && (
                    <li>
                      {report.excludedTxCount} Excluded Transactions ({formatCurrency(report.excludedTxTotal)})
                    </li>
                  )}
                  {report.excludedExpCount > 0 && (
                    <li>
                      {report.excludedExpCount} Excluded Expenses ({formatCurrency(report.excludedExpTotal)})
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
