import { useState, useEffect } from "react";
import { getProfitLoss } from "../services/api";
import type { ProfitLossReport } from "../types/models";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { toLocalISODate } from "../utils/dateUtils";

interface ReportsModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialStartDate?: string;
  initialEndDate?: string;
}

export default function ReportsModal({ isOpen = true, onClose, initialStartDate, initialEndDate }: ReportsModalProps) {
  const [startDate, setStartDate] = useState(initialStartDate || "");
  const [endDate, setEndDate] = useState(initialEndDate || "");
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activePreset, setActivePreset] = useState<string>(initialStartDate || initialEndDate ? "custom" : "this_month");

  useEffect(() => {
    if (isOpen) {
      if (initialStartDate || initialEndDate) {
        const start = initialStartDate || "1900-01-01";
        const end = initialEndDate || toLocalISODate(new Date());
        setStartDate(start);
        setEndDate(end);
        setActivePreset("custom");
        loadReport(start, end);
      } else {
        applyPreset("this_month");
      }
    }
  }, [isOpen, initialStartDate, initialEndDate]);

  const loadReport = async (start: string, end: string) => {
    setIsLoading(true);
    try {
      const data = await getProfitLoss(start, end);
      setReport(data);
    } catch (err) {
      console.error("Failed to load P&L report:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const applyPreset = (preset: "this_month" | "last_month" | "ytd" | "full_year") => {
    setActivePreset(preset);
    const now = new Date();
    let start = "";
    let end = "";

    if (preset === "this_month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      start = toLocalISODate(firstDay);
      end = toLocalISODate(lastDay);
    } else if (preset === "last_month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      start = toLocalISODate(firstDay);
      end = toLocalISODate(lastDay);
    } else if (preset === "ytd") {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      start = toLocalISODate(firstDay);
      end = toLocalISODate(now);
    } else if (preset === "full_year") {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      const lastDay = new Date(now.getFullYear(), 11, 31);
      start = toLocalISODate(firstDay);
      end = toLocalISODate(lastDay);
    }

    setStartDate(start);
    setEndDate(end);
    loadReport(start, end);
  };

  const handleApplyFilters = () => {
    setActivePreset("custom");
    loadReport(startDate, endDate);
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => setReport(null), 300);
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  };

  const formatReportDate = (d: string) => {
    if (!d) return "";
    const parts = d.split("T")[0].split("-");
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${month}/${day}/${year}`;
    }
    return d;
  };

  const sanitizeCSV = (val: string | number) => {
    let str = String(val ?? "");
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const exportCSV = () => {
    if (!report) return;

    const rows: string[][] = [
      [sanitizeCSV("PROFIT & LOSS STATEMENT")],
      [sanitizeCSV(`Period: ${formatReportDate(report.startDate)} to ${formatReportDate(report.endDate)}`)],
      [sanitizeCSV("Generated: " + new Date().toLocaleDateString())],
      [],
      [sanitizeCSV("TYPE"), sanitizeCSV("ACCOUNT CODE"), sanitizeCSV("ACCOUNT NAME"), sanitizeCSV("AMOUNT")],
    ];

    rows.push([sanitizeCSV("REVENUE"), "", "", ""]);
    report.revenue.forEach(r => {
      rows.push([
        sanitizeCSV("Revenue"),
        sanitizeCSV(r.accountCode),
        sanitizeCSV(r.accountName),
        sanitizeCSV(r.total.toFixed(2)),
      ]);
    });
    rows.push([sanitizeCSV("Total Revenue"), "", "", sanitizeCSV(report.totalRevenue.toFixed(2))]);
    rows.push([]);

    rows.push([sanitizeCSV("OPERATING EXPENSES"), "", "", ""]);
    report.expenses.forEach(e => {
      rows.push([
        sanitizeCSV("Expense"),
        sanitizeCSV(e.accountCode),
        sanitizeCSV(e.accountName),
        sanitizeCSV(e.total.toFixed(2)),
      ]);
    });
    rows.push([sanitizeCSV("Total Operating Expenses"), "", "", sanitizeCSV(report.totalExpenses.toFixed(2))]);
    rows.push([]);

    rows.push([sanitizeCSV("NET INCOME"), "", "", sanitizeCSV(report.netIncome.toFixed(2))]);
    if (report.totalTax && report.totalTax > 0) {
      rows.push([sanitizeCSV("Sales Tax Paid (Receipts)"), "", "", sanitizeCSV(report.totalTax.toFixed(2))]);
    }

    const csvContent = "\uFEFF" + rows.map(r => r.join(",")).join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `profit_loss_${report.startDate}_to_${report.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const titleContent = (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-emerald-900/30 text-emerald-400 rounded-xl flex items-center justify-center">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-white">Profit & Loss Statement</span>
          {isLoading && (
            <LoadingSpinner size="sm" color="text-emerald-400" />
          )}
        </div>
        <p className="text-xs text-zinc-400">Single-entry operating revenue, business expenses & net margin</p>
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={titleContent} maxWidth="4xl" headerClassName="print:hidden">
      <div className="flex flex-col gap-6">
        {/* PRESET CHIPS & FILTERS (Hidden during print) */}
        <div className="flex flex-col gap-3 bg-black/20 p-4 rounded-xl border border-white/5 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mr-1">Quick Presets:</span>
            {[
              { id: "this_month", label: "This Month" },
              { id: "last_month", label: "Last Month" },
              { id: "ytd", label: "Year to Date (YTD)" },
              { id: "full_year", label: "Full Year" },
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id as any)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors border ${
                  activePreset === p.id
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-white/5 text-zinc-400 border-white/10 hover:text-white hover:bg-white/10"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-4 items-end pt-2 border-t border-white/5">
            <div className="flex-1 min-w-[150px]">
              <Input
                id="pl-start-date"
                type="date"
                label="Start Date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  setActivePreset("custom");
                }}
              />
            </div>
            <div className="flex-1 min-w-[150px]">
              <Input
                id="pl-end-date"
                type="date"
                label="End Date"
                value={endDate}
                onChange={e => {
                  setEndDate(e.target.value);
                  setActivePreset("custom");
                }}
              />
            </div>
            <Button variant="secondary" onClick={handleApplyFilters} isLoading={isLoading}>
              Update Report
            </Button>
            {report && (
              <div className="flex gap-2 shrink-0">
                <Button variant="secondary" onClick={exportCSV} title="Export to CSV Spreadsheet">
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export CSV
                </Button>
                <Button variant="secondary" onClick={handlePrint} title="Print or Save as PDF">
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print / PDF
                </Button>
              </div>
            )}
          </div>
        </div>

        {!report && isLoading ? (
          <div className="py-16 flex items-center justify-center text-zinc-400 flex-col">
            <LoadingSpinner size="lg" color="text-emerald-500" className="mb-3" />
            <p className="text-sm">Generating Profit & Loss statement...</p>
          </div>
        ) : !report ? (
          <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
            <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>Select dates and generate to view P&L</p>
          </div>
        ) : (
          <div className={`max-w-3xl mx-auto w-full space-y-8 bg-black/40 border border-white/5 p-8 rounded-xl shadow-inner backdrop-blur-sm print:bg-white print:text-black print:border-none print:shadow-none print:p-0 transition-opacity duration-200 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="text-center border-b border-white/10 print:border-black/20 pb-6">
              <h3 className="text-2xl font-bold uppercase tracking-wider text-white print:text-black">Profit and Loss Statement</h3>
              <p className="text-zinc-400 print:text-zinc-600 mt-2 font-medium">
                {formatReportDate(report.startDate)} – {formatReportDate(report.endDate)}
              </p>
            </div>

            {/* REVENUE */}
            <div>
              <h4 className="text-sm font-bold text-zinc-400 print:text-zinc-700 uppercase tracking-wider mb-3">Revenue</h4>
              <div className="space-y-1">
                {report.revenue.map(line => (
                  <div key={line.accountCode} className="flex justify-between py-2 border-b border-white/5 print:border-zinc-200">
                    <span className="text-zinc-300 print:text-zinc-800">
                      {line.accountName} <span className="text-zinc-400 print:text-zinc-500 text-xs ml-2">{line.accountCode}</span>
                    </span>
                    <span className="font-medium print:text-black">{formatMoney(line.total)}</span>
                  </div>
                ))}
                {report.revenue.length === 0 && <div className="text-sm text-zinc-400 py-2 italic">No revenue recorded</div>}
              </div>
              <div className="flex justify-between py-3 mt-2 border-t border-white/10 print:border-black/30">
                <span className="font-bold print:text-black">Total Revenue</span>
                <span className="font-bold text-emerald-400 print:text-emerald-700">{formatMoney(report.totalRevenue)}</span>
              </div>
            </div>

            {/* EXPENSES */}
            <div>
              <h4 className="text-sm font-bold text-zinc-400 print:text-zinc-700 uppercase tracking-wider mb-3">Operating Expenses</h4>
              <div className="space-y-1">
                {report.expenses.map(line => (
                  <div key={line.accountCode} className="flex justify-between py-2 border-b border-white/5 print:border-zinc-200">
                    <span className="text-zinc-300 print:text-zinc-800">
                      {line.accountName} <span className="text-zinc-400 print:text-zinc-500 text-xs ml-2">{line.accountCode}</span>
                    </span>
                    <span className="font-medium print:text-black">{formatMoney(line.total)}</span>
                  </div>
                ))}
                {report.expenses.length === 0 && <div className="text-sm text-zinc-400 py-2 italic">No expenses recorded</div>}
              </div>
              <div className="flex justify-between py-3 mt-2 border-t border-white/10 print:border-black/30">
                <span className="font-bold print:text-black">Total Operating Expenses</span>
                <span className="font-bold text-red-400 print:text-red-700">{formatMoney(report.totalExpenses)}</span>
              </div>
            </div>

            {/* NET INCOME */}
            <div className="pt-6 border-t-4 border-white/10 print:border-black">
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold uppercase tracking-wider print:text-black">Net Income</span>
                <span className={`text-2xl font-black ${report.netIncome >= 0 ? "text-emerald-400 print:text-emerald-700" : "text-red-400 print:text-red-700"}`}>
                  {formatMoney(report.netIncome)}
                </span>
              </div>
            </div>

            {/* SALES TAX PAID FOOTNOTE */}
            {Boolean(report.totalTax && report.totalTax > 0) && (
              <div className="pt-3 border-t border-white/5 print:border-zinc-200 flex justify-between items-center text-xs text-zinc-400 print:text-zinc-600">
                <span>Cumulative Sales Tax Paid (Extracted from Receipts):</span>
                <span className="font-semibold text-zinc-200 print:text-black">{formatMoney(report.totalTax!)}</span>
              </div>
            )}

            {/* SUSPENSE / UNCATEGORIZED CLARIFICATION */}
            {(report.uncategorizedExpCount > 0 || report.uncategorizedTxCount > 0) && (
              <div className="mt-8 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:border-amber-400 print:bg-amber-50">
                <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 print:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h5 className="text-sm font-bold text-amber-500 print:text-amber-800">Uncategorized Items in Suspense</h5>
                  <p className="text-sm text-amber-200/80 print:text-amber-900 mt-1">
                    There are {report.uncategorizedTxCount} transactions and {report.uncategorizedExpCount} expenses without an assigned category in this period. 
                    These are currently included under Suspense (Accounts 9998 / 9999) in the calculation above. Please categorize them in the Ledger for clean tax reporting.
                  </p>
                </div>
              </div>
            )}

            {/* EXCLUDED ITEMS FOOTNOTE */}
            {(report.excludedExpCount > 0 || report.excludedTxCount > 0) && (
              <div className="mt-4 bg-zinc-500/10 border border-zinc-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:border-zinc-300 print:bg-zinc-50">
                <svg className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5 print:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h5 className="text-sm font-bold text-zinc-400 print:text-zinc-800">Excluded Items Footnote</h5>
                  <p className="text-sm text-zinc-400 print:text-zinc-700 mt-1">
                    This period contains intentionally excluded items (duplicates or personal expenses) omitted from the operating calculations above:
                  </p>
                  <ul className="text-sm text-zinc-400 print:text-zinc-700 mt-1 list-disc list-inside">
                    {report.excludedTxCount > 0 && (
                      <li>{report.excludedTxCount} Excluded Transactions ({formatMoney(report.excludedTxTotal)})</li>
                    )}
                    {report.excludedExpCount > 0 && (
                      <li>{report.excludedExpCount} Excluded Expenses ({formatMoney(report.excludedExpTotal)})</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
