import { Badge } from "../ui/Badge";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { CashFlowReport } from "../../types/models";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatMonthLabel } from "./reportHelpers";

interface CashFlowTabProps {
  report: CashFlowReport | null;
  isLoading: boolean;
}

export function CashFlowTab({ report, isLoading }: CashFlowTabProps) {
  return (
    <div className="space-y-4">
      <div className="bg-cyan-500/10 border border-cyan-500/20 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
        <svg className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <h5 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
            What is a Cash Flow Summary?
          </h5>
          <p className="text-xs text-cyan-200/80 mt-1 leading-relaxed">
            Profit is an accounting construct, but <strong className="text-cyan-200 font-semibold">cash is liquid reality</strong>.
            While your P&amp;L measures taxable performance, the Cash Flow Summary tracks the physical movement of money into and out of your bank accounts month by month.
            It reveals your net liquidity trajectory, your savings rate, and whether you are adding to or burning your cash reserves.
          </p>
        </div>
      </div>

      {isLoading && !report ? (
        <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
          <LoadingSpinner size="lg" color="text-cyan-400" className="mb-3" />
          <p className="text-sm">Calculating liquid cash flow trajectory...</p>
        </div>
      ) : report ? (
        <div
          className={`space-y-4 transition-opacity duration-200 ${
            isLoading ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Total Cash In (Deposits)
              </span>
              <p className="text-xl sm:text-2xl font-black text-emerald-400 mt-1 font-mono tabular-nums">
                {formatCurrency(report.totalCashIn)}
              </p>
              <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                Avg: {formatCurrency(report.avgMonthlyInflow)} / mo
              </span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Total Cash Out (Disbursements)
              </span>
              <p className="text-xl sm:text-2xl font-black text-red-400 mt-1 font-mono tabular-nums">
                {formatCurrency(report.totalCashOut)}
              </p>
              <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                Avg: {formatCurrency(report.avgMonthlyOutflow)} / mo
              </span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Net Cash Flow
              </span>
              <p
                className={`text-xl sm:text-2xl font-black mt-1 font-mono tabular-nums ${
                  report.netCashFlow >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {report.netCashFlow >= 0 ? "+" : ""}
                {formatCurrency(report.netCashFlow)}
              </p>
              <span className="text-[10px] text-zinc-400">
                {report.netCashFlow >= 0 ? "Cash surplus accrued" : "Net cash burn rate"}
              </span>
            </div>

            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 sm:p-3.5 glow-cyan">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                  Cash Savings Rate
                </span>
                <Badge variant="cyan" size="sm">Retention</Badge>
              </div>
              <p className="text-xl sm:text-2xl font-black text-cyan-300 mt-1 font-mono tabular-nums">
                {report.savingsRatePercent.toFixed(1)}%
              </p>
              <span className="text-[10px] text-cyan-400/80">
                Retained of gross cash inflow
              </span>
            </div>
          </div>

          <div className="surface-glass border border-white/5 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Monthly Cash Flow Trajectory</h4>
                <p className="text-[11px] text-zinc-400">
                  Month-by-month inflow vs outflow with cumulative position
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                {(report.periods ?? []).length} months tracked
              </span>
            </div>

            {(report.periods ?? []).length === 0 ? (
              <div className="py-6 text-center text-zinc-400 text-xs">
                No cash transactions recorded within this date range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400 uppercase tracking-wider text-[10px]">
                      <th className="py-2 px-2.5 font-bold">Month</th>
                      <th className="py-2 px-2.5 font-bold text-right">Cash In (+)</th>
                      <th className="py-2 px-2.5 font-bold text-right">Cash Out (-)</th>
                      <th className="py-2 px-2.5 font-bold text-right">Net Flow</th>
                      <th className="py-2 px-2.5 font-bold text-center">Direction</th>
                      <th className="py-2 px-2.5 font-bold text-right">Running Position</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(report.periods ?? []).map((p) => {
                      const isPositive = p.netCashFlow >= 0;
                      return (
                        <tr key={p.period} className="hover:bg-white/5 transition-colors">
                          <td className="py-1.5 px-2.5 font-medium text-white">
                            {formatMonthLabel(p.period)}
                            <span className="text-zinc-400 text-[10px] ml-1.5 font-mono">({p.period})</span>
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-emerald-400">
                            {formatCurrency(p.cashIn)}
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-red-400">
                            {formatCurrency(p.cashOut)}
                          </td>
                          <td
                            className={`py-1.5 px-2.5 text-right font-mono tabular-nums font-bold ${
                              isPositive ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {isPositive ? "+" : ""}
                            {formatCurrency(p.netCashFlow)}
                          </td>
                          <td className="py-1.5 px-2.5 text-center">
                            <Badge variant={isPositive ? "success" : "danger"} size="sm" glow={isPositive}>
                              {isPositive ? "▲ Surplus" : "▼ Burn"}
                            </Badge>
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums font-bold text-zinc-200">
                            {p.runningCashTotal >= 0 ? "+" : ""}
                            {formatCurrency(p.runningCashTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-white/20 font-bold text-zinc-100">
                      <td className="py-2 px-2.5 uppercase tracking-wider text-[11px]">Total Period</td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-emerald-400">
                        {formatCurrency(report.totalCashIn)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-red-400">
                        {formatCurrency(report.totalCashOut)}
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-mono tabular-nums ${
                          report.netCashFlow >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {report.netCashFlow >= 0 ? "+" : ""}
                        {formatCurrency(report.netCashFlow)}
                      </td>
                      <td className="py-2 px-2.5 text-center">
                        <span className="text-[10px] text-zinc-400 uppercase font-mono">
                          Net Position
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-white">
                        {formatCurrency(report.netCashFlow)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
