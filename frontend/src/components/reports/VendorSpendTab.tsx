import { Badge } from "../ui/Badge";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { VendorSpendReport } from "../../types/models";
import { formatCurrency } from "../../utils/formatCurrency";

interface VendorSpendTabProps {
  report: VendorSpendReport | null;
  isLoading: boolean;
}

export function VendorSpendTab({ report, isLoading }: VendorSpendTabProps) {
  return (
    <div className="space-y-4">
      <div className="bg-purple-500/10 border border-purple-500/20 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
        <svg className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <h5 className="text-xs font-bold uppercase tracking-wider text-purple-400">
            What is Vendor Spend Analytics?
          </h5>
          <p className="text-xs text-purple-200/80 mt-1 leading-relaxed">
            Messy bank statements often scatter expenses under cryptic names (e.g., store numbers, POS prefixes).
            This report normalizes payees into clean vendor entities, ranks your highest outflows, and calculates{" "}
            <strong className="text-purple-200 font-semibold">supplier concentration risk</strong> &amp; IRS 1099-NEC thresholds.
          </p>
        </div>
      </div>

      {isLoading && !report ? (
        <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
          <LoadingSpinner size="lg" color="text-purple-400" className="mb-3" />
          <p className="text-sm">Aggregating vendor spend and payee concentration...</p>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Total Outflow Analyzed
              </span>
              <p className="text-xl sm:text-2xl font-black text-purple-400 mt-1 font-mono tabular-nums">
                {formatCurrency(report.totalSpend)}
              </p>
              <span className="text-[10px] text-zinc-400">Across all business expenses</span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Unique Payees / Vendors
              </span>
              <p className="text-xl sm:text-2xl font-black text-white mt-1 font-mono tabular-nums">
                {report.totalVendors}
              </p>
              <span className="text-[10px] text-zinc-400">
                {(report.contractorsOver600 || 0) > 0
                  ? `${report.contractorsOver600} at 1099-NEC threshold (${formatCurrency(report.total1099Spend || 0)})`
                  : "Distinct suppliers identified"}
              </span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Top 5 Concentration
                </span>
                <Badge variant={report.top5Percent > 75 ? "warning" : "success"} size="sm" glow>
                  {report.top5Percent > 75 ? "High Risk" : "Balanced"}
                </Badge>
              </div>
              <p className="text-xl sm:text-2xl font-black text-amber-300 mt-1 font-mono tabular-nums">
                {report.top5Percent.toFixed(1)}%
              </p>
              <span className="text-[10px] text-zinc-400">Of spend captured by top 5 payees</span>
            </div>

            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 sm:p-3.5 glow-purple">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
                #1 Top Payee
              </span>
              <p
                className="text-sm font-black text-white break-words line-clamp-1 leading-tight mt-1"
                title={report.vendors[0]?.vendorName}
              >
                {report.vendors[0]?.vendorName || "None"}
              </p>
              <span className="text-[10px] text-purple-300/80 font-mono tabular-nums">
                {report.vendors[0]
                  ? `${formatCurrency(report.vendors[0].totalSpend)} (${report.vendors[0].percentOfTotal.toFixed(1)}%)`
                  : "No spend recorded"}
              </span>
            </div>
          </div>

          <div className="surface-glass border border-white/5 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Vendor Ranking &amp; Spend Distribution</h4>
                <p className="text-[11px] text-zinc-400">
                  Sorted by highest total cash outflow with category allocation
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                {report.vendors.length} payees
              </span>
            </div>

            {report.vendors.length === 0 ? (
              <div className="py-6 text-center text-zinc-400 text-xs">
                No vendor expenses found in this date range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400 uppercase tracking-wider text-[10px] whitespace-nowrap">
                      <th className="py-2 px-2.5 font-bold w-12 text-center">Rank</th>
                      <th className="py-2 px-2.5 font-bold min-w-[170px]">Payee / Vendor</th>
                      <th className="py-2 px-2.5 font-bold min-w-[150px]">Spend Share</th>
                      <th className="py-2 px-2.5 font-bold text-right min-w-[100px]">Total Spent</th>
                      <th className="py-2 px-2.5 font-bold text-center min-w-[60px]">Txns</th>
                      <th className="py-2 px-2.5 font-bold text-right min-w-[100px]">Avg Ticket</th>
                      <th className="py-2 px-2.5 font-bold min-w-[150px]">Primary Category</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 whitespace-nowrap">
                    {report.vendors.map((v, idx) => (
                      <tr key={v.vendorName} className="hover:bg-white/5 transition-colors">
                        <td className="py-1.5 px-2.5 text-center font-mono tabular-nums">
                          {idx === 0 && (
                            <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-300 font-bold inline-flex items-center justify-center text-[10px]">
                              1
                            </span>
                          )}
                          {idx === 1 && (
                            <span className="w-4 h-4 rounded-full bg-zinc-400/20 text-zinc-300 font-bold inline-flex items-center justify-center text-[10px]">
                              2
                            </span>
                          )}
                          {idx === 2 && (
                            <span className="w-4 h-4 rounded-full bg-amber-700/20 text-amber-600 font-bold inline-flex items-center justify-center text-[10px]">
                              3
                            </span>
                          )}
                          {idx > 2 && <span className="text-zinc-400 text-[10px]">#{idx + 1}</span>}
                        </td>
                        <td className="py-1.5 px-2.5 font-semibold text-white">
                          <span className="inline-flex items-center gap-1.5">
                            <span>{v.vendorName}</span>
                            {v.requires1099 && (
                              <Badge variant="warning" size="sm" glow>1099-NEC</Badge>
                            )}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-white/10 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-purple-500 h-1.5 rounded-full"
                                style={{ width: `${Math.min(v.percentOfTotal, 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-mono tabular-nums text-zinc-400 w-9 text-right">
                              {v.percentOfTotal.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums font-bold text-white">
                          {formatCurrency(v.totalSpend)}
                        </td>
                        <td className="py-1.5 px-2.5 text-center font-mono tabular-nums text-zinc-400">
                          {v.transactionCount}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-zinc-300">
                          {formatCurrency(v.averageSpend)}
                        </td>
                        <td className="py-1.5 px-2.5">
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-medium border border-white/5">
                            {v.primaryCategoryName || "Uncategorized"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
