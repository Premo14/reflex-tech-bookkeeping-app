import { Badge, type BadgeVariant } from "../ui/Badge";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { TrialBalanceReport } from "../../types/models";
import { formatCents, formatCurrency } from "../../utils/formatCurrency";

interface TrialBalanceTabProps {
  report: TrialBalanceReport | null;
  isLoading: boolean;
  typeFilter: string;
  onTypeFilterChange: (type: string) => void;
  onExportCSV: () => void;
}

const ACCOUNT_TYPES = ["ALL", "ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

const ACCOUNT_TYPE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  ASSET: "success",
  EXPENSE: "warning",
  REVENUE: "cyan",
  EQUITY: "purple",
  LIABILITY: "danger",
};

export function TrialBalanceTab({
  report,
  isLoading,
  typeFilter,
  onTypeFilterChange,
  onExportCSV,
}: TrialBalanceTabProps) {
  const filteredAccounts = report
    ? report.accounts.filter((acc) => typeFilter === "ALL" || acc.accountType.toUpperCase() === typeFilter)
    : [];

  return (
    <div className="space-y-4">
      <div className="bg-blue-500/10 border border-blue-500/20 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
        <svg className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
        </svg>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h5 className="text-xs font-bold uppercase tracking-wider text-blue-400">
              GAAP Trial Balance &amp; Double-Entry Ledger Verification
            </h5>
            <Badge variant="info" size="sm" glow className="font-mono">
              CPA-Ready
            </Badge>
          </div>
          <p className="text-xs text-blue-200/80 leading-relaxed">
            Under formal double-entry bookkeeping, every monetary inflow or outflow is balanced across two accounts:
            the asset/source account (Bank, Card, Cash) and the offsetting nominal or real account (Expense, Revenue, Equipment, or Owner&apos;s Equity).
            When total debits equal total credits (<span className="font-mono font-semibold text-blue-300">Δ = $0.00</span>), your general ledger is mathematically verified and ready for tax filing, external audit, or seamless export.
          </p>
        </div>
      </div>

      {isLoading && !report ? (
        <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
          <LoadingSpinner size="lg" color="text-blue-500" className="mb-3" />
          <p className="text-sm">Calculating double-entry trial balance...</p>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <div
            className={`p-3 sm:p-3.5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
              report.isBalanced
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-rose-500/10 border-rose-500/30 text-rose-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold shrink-0 ${
                  report.isBalanced ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                }`}
              >
                {report.isBalanced ? "✓" : "⚠"}
              </div>
              <div>
                <h4 className="text-xs font-bold tracking-tight uppercase">
                  {report.isBalanced
                    ? "General Ledger is Mechanically Balanced"
                    : "General Ledger Out of Balance Warning"}
                </h4>
                <p className="text-xs opacity-80 mt-0.5">
                  {report.isBalanced
                    ? `Total Debits match Total Credits exactly across ${report.accounts.length} active ledger accounts.`
                    : `Total debits and credits do not match. Variance: ${formatCents(report.varianceCents)}.`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-md bg-black/40 border border-white/10">
                Variance:{" "}
                <span className={report.isBalanced ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                  {formatCents(report.varianceCents)}
                </span>
              </span>
              <Button variant="secondary" size="sm" onClick={onExportCSV} className="text-xs">
                Export CSV
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                Total Debits (Dr)
              </span>
              <span className="text-lg font-bold font-mono tabular-nums text-white">
                {formatCurrency(report.totalDebit)}
              </span>
              <span className="text-[10px] text-zinc-400 block mt-0.5">Left-hand entries</span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                Total Credits (Cr)
              </span>
              <span className="text-lg font-bold font-mono tabular-nums text-white">
                {formatCurrency(report.totalCredit)}
              </span>
              <span className="text-[10px] text-zinc-400 block mt-0.5">Right-hand entries</span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                Net Ledger Variance
              </span>
              <span
                className={`text-lg font-bold font-mono tabular-nums ${
                  report.isBalanced ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCents(report.varianceCents)}
              </span>
              <span className="text-[10px] text-zinc-400 block mt-0.5">
                {report.isBalanced ? "Zero variance (balanced)" : "Needs reconciliation"}
              </span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                Active Accounts
              </span>
              <span className="text-lg font-bold font-mono tabular-nums text-blue-400">
                {report.accounts.length}
              </span>
              <span className="text-[10px] text-zinc-400 block mt-0.5">Chart of Accounts</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mr-1.5">
              Filter Account Type:
            </span>
            {ACCOUNT_TYPES.map((type) => {
              const count =
                type === "ALL"
                  ? report.accounts.length
                  : report.accounts.filter((a) => a.accountType.toUpperCase() === type).length;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={typeFilter === type}
                  onClick={() => onTypeFilterChange(type)}
                  className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 border touch-glow-blue ${
                    typeFilter === type
                      ? "bg-blue-500/20 text-blue-300 border-blue-500/40 font-semibold glow-blue"
                      : "bg-white/5 text-zinc-400 border-white/10 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {type}{" "}
                  <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 bg-black/40 rounded-full text-zinc-300">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="surface-glass border border-white/10 rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-zinc-950/95 backdrop-blur-md text-zinc-400 border-b border-white/10 text-[10px] font-bold uppercase tracking-wider z-10">
                  <tr>
                    <th className="py-2 px-3 sm:px-3.5">Code</th>
                    <th className="py-2 px-3 sm:px-3.5">Account Name</th>
                    <th className="py-2 px-3 sm:px-3.5">Type</th>
                    <th className="py-2 px-3 sm:px-3.5">Normal Balance</th>
                    <th className="py-2 px-3 sm:px-3.5 text-right">Debit ($)</th>
                    <th className="py-2 px-3 sm:px-3.5 text-right">Credit ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {filteredAccounts.map((acc) => {
                    const isDebitNormal = acc.accountType === "ASSET" || acc.accountType === "EXPENSE";
                    const badgeVariant = ACCOUNT_TYPE_BADGE_VARIANT[acc.accountType] ?? "neutral";
                    return (
                      <tr key={acc.accountId || acc.accountCode} className="hover:bg-white/5 transition-colors">
                        <td className="py-1.5 px-3 sm:px-3.5 font-bold text-zinc-300">{acc.accountCode}</td>
                        <td className="py-1.5 px-3 sm:px-3.5 font-sans text-zinc-200 font-medium">
                          {acc.accountName}
                        </td>
                        <td className="py-1.5 px-3 sm:px-3.5 font-sans">
                          <Badge variant={badgeVariant} size="sm">
                            {acc.accountType}
                          </Badge>
                        </td>
                        <td className="py-1.5 px-3 sm:px-3.5 font-sans text-[11px] text-zinc-400">
                          {isDebitNormal ? (
                            <span className="text-emerald-400/80">Debit (Dr)</span>
                          ) : (
                            <span className="text-cyan-400/80">Credit (Cr)</span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 sm:px-3.5 text-right tabular-nums text-zinc-100">
                          {acc.netDebit > 0 ? (
                            <span className="font-semibold text-white">{formatCurrency(acc.netDebit)}</span>
                          ) : (
                            <span className="text-zinc-400">-</span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 sm:px-3.5 text-right tabular-nums text-zinc-100">
                          {acc.netCredit > 0 ? (
                            <span className="font-semibold text-white">{formatCurrency(acc.netCredit)}</span>
                          ) : (
                            <span className="text-zinc-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredAccounts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-zinc-400 font-sans text-xs">
                        No ledger activity found for account type &quot;{typeFilter}&quot;.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="sticky bottom-0 bg-zinc-950 border-t-2 border-white/20 font-mono font-bold text-xs z-10">
                  <tr>
                    <td colSpan={4} className="py-2 px-3 sm:px-3.5 font-sans uppercase tracking-wider text-zinc-300 text-[11px]">
                      Totals (All Accounts)
                    </td>
                    <td className="py-2 px-3 sm:px-3.5 text-right tabular-nums text-white">
                      {formatCurrency(report.totalDebit)}
                    </td>
                    <td className="py-2 px-3 sm:px-3.5 text-right tabular-nums text-white">
                      {formatCurrency(report.totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
          <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
          <p>Select date range and click Update Report to generate Trial Balance.</p>
        </div>
      )}
    </div>
  );
}
