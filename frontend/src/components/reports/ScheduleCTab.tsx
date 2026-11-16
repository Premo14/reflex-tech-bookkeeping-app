import { useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { ScheduleCReport } from "../../types/models";
import { formatCents, formatCurrency, fromCents, toCents } from "../../utils/formatCurrency";

interface ScheduleCTabProps {
  report: ScheduleCReport | null;
  isLoading: boolean;
  taxYear: number;
  taxYearOptions: number[];
  onTaxYearChange: (year: number) => void;
  expandedLines: Record<string, boolean>;
  onToggleLineExpand: (key: string) => void;
  onDownloadTaxPack: () => void;
  onExportCSV: (report: ScheduleCReport) => void;
  onPrint: () => void;
  onViewUncategorized?: () => void;
  onClose: () => void;
}

export function ScheduleCTab({
  report,
  isLoading,
  taxYear,
  taxYearOptions,
  onTaxYearChange,
  expandedLines,
  onToggleLineExpand,
  onDownloadTaxPack,
  onExportCSV,
  onPrint,
  onViewUncategorized,
  onClose,
}: ScheduleCTabProps) {
  const [businessMiles, setBusinessMiles] = useState<number>(0);
  const [selectedMileageRateYear, setSelectedMileageRateYear] = useState<number>(taxYear);
  const [homeOfficeSqFt, setHomeOfficeSqFt] = useState<number>(0);

  const mileageRateCents = selectedMileageRateYear === 2024 ? 67 : 70;
  const calculatedMileageCents = Math.round(businessMiles * mileageRateCents);
  const line9Expense = (report?.expenseLines ?? []).find((l) => l.lineNumber.toLowerCase().includes("line 9"));
  const actualVehicleCents = toCents(line9Expense ? line9Expense.deductibleAmount : 0);
  const mileageAdvantageCents = calculatedMileageCents - actualVehicleCents;

  const homeOfficeCents = Math.round(Math.min(300, Math.max(0, homeOfficeSqFt)) * 500);
  const totalPotentialCents = (mileageAdvantageCents > 0 ? mileageAdvantageCents : 0) + homeOfficeCents;
  const estimatedTaxSavingsCents = Math.round(totalPotentialCents * 0.303);

  return (
    <div className="space-y-4">
      <div className="bg-amber-500/10 border border-amber-500/20 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
        <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <div>
          <h4 className="text-xs font-bold text-amber-400 flex items-center gap-2 uppercase tracking-wider">
            Form 1040 Schedule C — Profit or Loss From Business
          </h4>
          <p className="text-xs text-amber-200/80 mt-1 leading-relaxed">
            Tax year {taxYear} (<span className="font-mono tabular-nums">01/01/{taxYear} – 12/31/{taxYear}</span>) • Single-entry ledger mapped directly to IRS Form 1040 Schedule C lines, 50% meals deductibility limits, and 1040-ES quarterly tax projections.
          </p>
        </div>
      </div>

      <div className="relative z-30 flex flex-wrap items-end justify-between gap-3 surface-glass p-3 sm:p-3.5 rounded-xl border border-white/5 print:hidden">
        <Select
          id="schedule-c-tax-year"
          name="taxYear"
          label="Tax Year:"
          autoWidth
          value={taxYear}
          onChange={(e) => onTaxYearChange(Number(e.target.value))}
          className="text-xs font-bold font-mono tabular-nums"
        >
          {taxYearOptions.map((y) => (
            <option key={y} value={y}>
              {y} (01/01/{y} – 12/31/{y})
            </option>
          ))}
        </Select>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            variant="primary"
            size="sm"
            glow
            onClick={onDownloadTaxPack}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold"
            title="Download bundled ZIP of Schedule C CSV, Transaction Register, and Categorized Receipts"
          >
            <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            1-Click CPA Tax Pack (.zip)
          </Button>

          {report && (
            <>
              <Button variant="secondary" size="sm" onClick={() => onExportCSV(report)} title="Export Schedule C CSV">
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export CSV
              </Button>
              <Button variant="secondary" size="sm" onClick={onPrint} title="Print or Save as PDF">
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print / PDF
              </Button>
            </>
          )}
        </div>
      </div>

      {isLoading && !report ? (
        <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
          <LoadingSpinner size="lg" color="text-amber-500" className="mb-3" />
          <p className="text-sm">Compiling IRS Form 1040 Schedule C...</p>
        </div>
      ) : report ? (
        <div
          className={`relative z-10 space-y-4 transition-opacity duration-200 ${
            isLoading ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Gross Income (Line 7)
              </span>
              <p className="text-xl sm:text-2xl font-black text-emerald-400 mt-1 font-mono tabular-nums">
                {formatCurrency(report.grossIncome)}
              </p>
              <span className="text-[10px] text-zinc-400">Gross receipts &amp; revenues</span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Total Expenses (Line 28)
              </span>
              <p className="text-xl sm:text-2xl font-black text-red-400 mt-1 font-mono tabular-nums">
                {formatCurrency(report.totalExpensesDeductible)}
              </p>
              <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                Gross: {formatCurrency(report.totalExpensesGross)}
              </span>
            </div>

            <div className="surface-glass border border-white/10 rounded-xl p-3 sm:p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Net Profit / Loss (Line 31)
              </span>
              <p
                className={`text-xl sm:text-2xl font-black mt-1 font-mono tabular-nums ${
                  report.netProfitOrLoss >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {formatCurrency(report.netProfitOrLoss)}
              </p>
              <span className="text-[10px] text-zinc-400">Taxable business income</span>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 sm:p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  Meals 50% IRS Limit
                </span>
                <Badge variant="warning" size="sm" glow>
                  Line 24b
                </Badge>
              </div>
              <p className="text-xl sm:text-2xl font-black text-amber-300 mt-1 font-mono tabular-nums">
                {formatCurrency(report.nondeductibleMeals)}
              </p>
              <span className="text-[10px] text-amber-400/80">
                Non-deductible 50% meal cap applied
              </span>
            </div>
          </div>

          {(report.uncategorizedExpenseAmount > 0 || report.uncategorizedIncomeAmount > 0) && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md">
              <svg
                className="w-5 h-5 text-amber-400 shrink-0 mt-0.5"
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
              <div className="flex-1">
                <h5 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  Uncategorized Items in Suspense
                </h5>
                <p className="text-xs text-amber-200/80 mt-1">
                  There are {(report.uncategorizedTxCount || 0) + (report.uncategorizedExpCount || 0)} transactions (
                  {report.uncategorizedExpenseAmount > 0 && report.uncategorizedIncomeAmount > 0 ? (
                    <span className="font-mono tabular-nums">
                      {formatCurrency(report.uncategorizedExpenseAmount)} expenses,{" "}
                      {formatCurrency(report.uncategorizedIncomeAmount)} income
                    </span>
                  ) : (
                    <span className="font-mono tabular-nums">
                      {formatCurrency(report.uncategorizedExpenseAmount || report.uncategorizedIncomeAmount)}
                    </span>
                  )}
                  ) awaiting categorization. For accurate tax reporting, categorize these before filing your Schedule C.
                </p>
                {onViewUncategorized && (
                  <Button
                    variant="secondary"
                    size="sm"
                    glow
                    onClick={() => {
                      onViewUncategorized();
                      onClose();
                    }}
                    className="mt-2 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-amber-500/40"
                  >
                    Resolve Uncategorized in Ledger →
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="surface-glass border border-white/5 rounded-xl p-4 sm:p-5 space-y-4">
            <div>
              <div className="border-b border-white/10 pb-2 mb-3 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Part I: Income
                </h4>
                <span className="text-xs font-mono text-zinc-400">IRS Form 1040 Line 1–7</span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-300">
                    <span className="font-mono text-amber-400 font-bold mr-2">Line 1</span> Gross receipts or sales
                  </span>
                  <span className="font-semibold font-mono tabular-nums text-white">
                    {formatCurrency(report.grossReceipts)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-300">
                    <span className="font-mono text-amber-400 font-bold mr-2">Line 2</span> Returns and allowances
                  </span>
                  <span className="font-semibold font-mono tabular-nums text-zinc-400">
                    ({formatCurrency(report.returnsAndAllowances)})
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-300">
                    <span className="font-mono text-amber-400 font-bold mr-2">Line 3</span> Net receipts (Line 1 minus Line 2)
                  </span>
                  <span className="font-semibold font-mono tabular-nums text-white">
                    {formatCurrency(report.netReceipts)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-300">
                    <span className="font-mono text-amber-400 font-bold mr-2">Line 4</span> Cost of goods sold (COGS)
                  </span>
                  <span className="font-semibold font-mono tabular-nums text-zinc-400">
                    ({formatCurrency(report.costOfGoodsSold)})
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-300">
                    <span className="font-mono text-amber-400 font-bold mr-2">Line 5</span> Gross profit (Line 3 minus Line 4)
                  </span>
                  <span className="font-semibold font-mono tabular-nums text-white">
                    {formatCurrency(report.grossProfit)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-300">
                    <span className="font-mono text-amber-400 font-bold mr-2">Line 6</span> Other income (interest, refunds)
                    {report.uncategorizedIncomeAmount > 0 && (
                      <span className="text-[10px] text-amber-400/80 ml-1.5 font-mono tabular-nums">
                        (includes {formatCurrency(report.uncategorizedIncomeAmount)} Suspense 9998)
                      </span>
                    )}
                  </span>
                  <span className="font-semibold font-mono tabular-nums text-white">
                    {formatCurrency(report.otherIncome)}
                  </span>
                </div>
                <div className="flex justify-between py-2 pt-3 border-t border-white/10 font-bold text-sm">
                  <span className="text-emerald-400">
                    <span className="font-mono mr-2">Line 7</span> Gross Income
                  </span>
                  <span className="text-emerald-400 font-mono tabular-nums">
                    {formatCurrency(report.grossIncome)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="border-b border-white/10 pb-2 mb-3 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Part II: Expenses (Deductible Business Write-Offs)
                </h4>
                <span className="text-xs font-mono text-zinc-400">IRS Form 1040 Line 8–27a</span>
              </div>

              <div className="space-y-2">
                {(report.expenseLines ?? []).map((line) => {
                  const lineKey = `${line.lineNumber}-${line.lineName}`;
                  const isExpanded = Boolean(expandedLines[lineKey] || expandedLines[line.lineNumber]);
                  return (
                    <div
                      key={lineKey}
                      className="border border-white/5 rounded-lg bg-zinc-950/40 overflow-hidden"
                    >
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => onToggleLineExpand(lineKey)}
                        className="w-full text-left flex items-center justify-between p-2.5 hover:bg-white/5 transition-colors cursor-pointer select-none touch-glow-amber"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-amber-400 text-xs w-16 shrink-0">
                            {line.lineNumber}
                          </span>{" "}
                          <span className="text-xs font-semibold text-zinc-200">
                            {line.lineName}
                          </span>{" "}
                          {line.deductiblePercent < 100 && (
                            <Badge variant="warning" size="sm">
                              {line.deductiblePercent}% Deductible
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-4 text-xs shrink-0">
                          <div className="text-right font-mono tabular-nums">
                            <span className="font-bold text-white">
                              {formatCurrency(line.deductibleAmount)}
                            </span>
                            {line.deductiblePercent < 100 && (
                              <span className="block text-[10px] text-zinc-400">
                                Gross: {formatCurrency(line.grossAmount)}
                              </span>
                            )}
                          </div>
                          <span className="text-zinc-400 text-xs" aria-hidden="true">
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="bg-black/30 px-4 py-2 border-t border-white/5 space-y-1">
                          {line.accounts.map((acc) => (
                            <div
                              key={acc.accountId || acc.accountCode}
                              className="flex justify-between text-xs py-1 text-zinc-400"
                            >
                              <span className="font-mono">
                                {acc.accountCode} — {acc.accountName}
                              </span>
                              <span className="font-mono tabular-nums text-zinc-300">
                                {formatCurrency(acc.total)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-3 border-t border-white/10 flex justify-between items-center text-sm font-bold">
                <span className="text-zinc-200">
                  <span className="font-mono text-amber-400 mr-2">Line 28</span> Total Allowable Deductions
                </span>
                <span className="text-red-400 font-mono tabular-nums">
                  {formatCurrency(report.totalExpensesDeductible)}
                </span>
              </div>
            </div>

            <div className="pt-4 border-t-2 border-white/10 flex justify-between items-center">
              <div>
                <span className="text-lg font-bold uppercase tracking-wider text-white">
                  Line 31 — Net Profit or (Loss)
                </span>
                <p className="text-xs text-zinc-400">
                  Gross income (Line 7) minus Total expenses (Line 28)
                </p>
              </div>
              <span
                className={`text-2xl font-black font-mono tabular-nums ${
                  report.netProfitOrLoss >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {formatCurrency(report.netProfitOrLoss)}
              </span>
            </div>

            <div className="pt-6 border-t-2 border-white/10 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-wider text-amber-400">
                    IRS Form 1040-ES Quarterly Estimated Taxes &amp; Schedule SE
                  </h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Projected tax liabilities based on {report.year} Schedule C net income of{" "}
                    <span className="font-mono tabular-nums">{formatCurrency(report.netProfitOrLoss)}</span>
                  </p>
                </div>
                <Badge variant="warning" className="font-mono">
                  15.3% SE Tax + 15% Estimated Federal
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                    Schedule SE Tax (15.3%)
                  </span>
                  <span className="text-lg font-bold font-mono tabular-nums text-white">
                    {formatCurrency(report.selfEmploymentTax || 0)}
                  </span>
                  <span className="text-[10px] text-zinc-400 block mt-1">Social Security &amp; Medicare</span>
                </div>

                <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                    50% SE Deduction
                  </span>
                  <span className="text-lg font-bold font-mono tabular-nums text-emerald-400">
                    {formatCurrency(report.deductibleSelfEmploymentTax || 0)}
                  </span>
                  <span className="text-[10px] text-zinc-400 block mt-1">Reduces AGI on 1040</span>
                </div>

                <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                    Total Annual Estimated Tax
                  </span>
                  <span className="text-lg font-bold font-mono tabular-nums text-white">
                    {formatCurrency(report.totalEstimatedTax || 0)}
                  </span>
                  <span className="text-[10px] text-zinc-400 block mt-1">SE + Est Federal Income</span>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block mb-1">
                    Estimated Quarterly Voucher
                  </span>
                  <span className="text-lg font-bold font-mono tabular-nums text-amber-300">
                    {formatCurrency(report.estimatedQuarterlyTax || 0)}
                  </span>
                  <span className="text-[10px] text-amber-400/70 block mt-1">Due per IRS quarter</span>
                </div>
              </div>

              {report.quarterlyDeadlines && report.quarterlyDeadlines.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
                  {report.quarterlyDeadlines.map((dl) => (
                    <div
                      key={dl.quarter}
                      className={`p-2.5 rounded-lg border text-xs flex justify-between items-center ${
                        dl.isPast
                          ? "bg-zinc-950/40 border-white/5 text-zinc-400"
                          : "bg-zinc-900 border-amber-500/20 text-zinc-200"
                      }`}
                    >
                      <div>
                        <span className="font-bold text-amber-400 font-mono mr-1.5">{dl.quarter}</span>
                        <span className="text-[11px] text-zinc-400">{dl.dueDate}</span>
                      </div>
                      <span className="font-mono tabular-nums font-bold">
                        {formatCurrency(dl.amountDue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-6 border-t-2 border-white/10 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                    Solopreneur Tax Deduction Optimizers
                  </h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Interactive calculators for vehicle business mileage and home office deductions.
                  </p>
                </div>
                <Badge variant="success" glow className="font-mono">
                  Maximize Write-Offs
                </Badge>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                        IRC § 162 Business Mileage
                      </span>
                      <Badge variant="info" size="sm" className="font-mono tabular-nums">
                        {formatCurrency(fromCents(mileageRateCents))} / mile ({selectedMileageRateYear})
                      </Badge>
                    </div>

                    <div className="relative z-20 grid grid-cols-2 gap-2">
                      <Input
                        id="schedule-c-miles"
                        label="Annual Business Miles"
                        type="number"
                        min="0"
                        step="50"
                        placeholder="e.g. 5000"
                        value={businessMiles || ""}
                        onChange={(e) => setBusinessMiles(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="text-xs font-mono tabular-nums"
                      />
                      <Select
                        id="schedule-c-mileage-year"
                        label="Tax Rate Year"
                        value={selectedMileageRateYear}
                        onChange={(e) => setSelectedMileageRateYear(Number(e.target.value))}
                        className="text-xs font-mono tabular-nums"
                      >
                        <option value={2026}>2026 ($0.70/mi)</option>
                        <option value={2025}>2025 ($0.70/mi)</option>
                        <option value={2024}>2024 ($0.67/mi)</option>
                      </Select>
                    </div>

                    <div className="bg-zinc-950/60 border border-white/5 rounded-lg p-3 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Standard Mileage Deduction:</span>
                        <span className="font-mono tabular-nums font-bold text-white">
                          {formatCents(calculatedMileageCents)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Actual Vehicle Costs (Line 9):</span>
                        <span className="font-mono tabular-nums text-zinc-300">
                          {formatCents(actualVehicleCents)}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-white/10 pt-1.5">
                        <span className="font-semibold text-zinc-300">Mileage vs Actual Advantage:</span>
                        <span
                          className={`font-mono tabular-nums font-bold ${
                            mileageAdvantageCents >= 0 ? "text-emerald-400" : "text-amber-400"
                          }`}
                        >
                          {mileageAdvantageCents >= 0
                            ? `${formatCents(mileageAdvantageCents, { signed: true })} (Mileage better)`
                            : `${formatCents(mileageAdvantageCents)} (Actual better)`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                        IRC § 280A Simplified Home Office
                      </span>
                      <Badge variant="warning" size="sm" className="font-mono tabular-nums">
                        $5.00 / sq ft (Max 300 sq ft)
                      </Badge>
                    </div>

                    <Input
                      id="schedule-c-home-sqft"
                      label="Dedicated Office Area (Square Feet, Max 300)"
                      type="number"
                      min="0"
                      max="300"
                      step="10"
                      placeholder="e.g. 200"
                      value={homeOfficeSqFt || ""}
                      onChange={(e) => setHomeOfficeSqFt(Math.min(300, Math.max(0, parseFloat(e.target.value) || 0)))}
                      className="text-xs font-mono tabular-nums"
                    />

                    <div className="bg-zinc-950/60 border border-white/5 rounded-lg p-3 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Calculated Line 30 Deduction:</span>
                        <span className="font-mono tabular-nums font-bold text-emerald-400">
                          {formatCents(homeOfficeCents)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">IRS Safe Harbor Cap:</span>
                        <span className="font-mono tabular-nums text-zinc-400">$1,500.00 / year</span>
                      </div>
                      <p className="text-[10px] text-zinc-400 pt-1 border-t border-white/10 leading-relaxed">
                        No receipts or utility apportionment required. Requires exclusive regular business use of the room.
                      </p>
                    </div>
                  </div>
                </div>

                {totalPotentialCents > 0 && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider font-mono tabular-nums">
                        Potential Additional Tax Write-Offs: {formatCents(totalPotentialCents)}
                      </span>
                      <p className="text-xs text-emerald-400/80 mt-0.5">
                        Reduces both Self-Employment Tax (15.3%) and Federal Income Tax (~15% effective bracket).
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] uppercase font-bold text-zinc-400 block">
                        Estimated Cash Saved
                      </span>
                      <span className="text-lg font-black text-emerald-400 font-mono tabular-nums">
                        ~{formatCents(estimatedTaxSavingsCents)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
