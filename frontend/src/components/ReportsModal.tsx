import { useState, useEffect } from "react";
import { getProfitLoss } from "../services/api";
import type { ProfitLossReport } from "../types/models";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

interface ReportsModalProps {
  isOpen?: boolean;
  onClose: () => void;
}

export default function ReportsModal({ isOpen = true, onClose }: ReportsModalProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(lastDay.toISOString().split('T')[0]);
      setReport(null);
    }
  }, [isOpen]);

  const handleApplyFilters = async () => {
    setIsLoading(true);
    try {
      const data = await getProfitLoss(startDate, endDate);
      setReport(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => setReport(null), 300);
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const titleContent = (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-emerald-900/30 text-emerald-400 rounded-xl flex items-center justify-center">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
      </div>
      <span className="text-xl font-bold text-white">Profit & Loss Report</span>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={titleContent} maxWidth="4xl">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-4 items-end bg-black/20 p-4 rounded-xl border border-white/5">
          <div className="flex-1 min-w-[150px]">
            <Input type="date" label="Start Date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Input type="date" label="End Date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={handleApplyFilters} isLoading={isLoading}>
            Generate Report
          </Button>
        </div>

        {!report ? (
          <div className="py-12 flex items-center justify-center text-zinc-500 flex-col">
            <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <p>Select dates and generate to view P&L</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto w-full space-y-8 bg-black/40 border border-white/5 p-8 rounded-xl shadow-inner backdrop-blur-sm">
            <div className="text-center border-b border-white/10 pb-6">
              <h3 className="text-2xl font-bold uppercase tracking-wider text-white">Profit and Loss</h3>
              <p className="text-zinc-400 mt-2">{new Date(report.startDate).toLocaleDateString()} – {new Date(report.endDate).toLocaleDateString()}</p>
            </div>

            {/* REVENUE */}
            <div>
              <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">Revenue</h4>
              <div className="space-y-1">
                {report.revenue.map(line => (
                  <div key={line.accountCode} className="flex justify-between py-2 border-b border-white/5">
                    <span className="text-zinc-300">{line.accountName} <span className="text-zinc-600 text-xs ml-2">{line.accountCode}</span></span>
                    <span className="font-medium">{formatMoney(line.total)}</span>
                  </div>
                ))}
                {report.revenue.length === 0 && <div className="text-sm text-zinc-500 py-2 italic">No revenue recorded</div>}
              </div>
              <div className="flex justify-between py-3 mt-2 border-t border-white/10">
                <span className="font-bold">Total Revenue</span>
                <span className="font-bold text-emerald-400">{formatMoney(report.totalRevenue)}</span>
              </div>
            </div>

            {/* EXPENSES */}
            <div>
              <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">Operating Expenses</h4>
              <div className="space-y-1">
                {report.expenses.map(line => (
                  <div key={line.accountCode} className="flex justify-between py-2 border-b border-white/5">
                    <span className="text-zinc-300">{line.accountName} <span className="text-zinc-600 text-xs ml-2">{line.accountCode}</span></span>
                    <span className="font-medium">{formatMoney(line.total)}</span>
                  </div>
                ))}
                {report.expenses.length === 0 && <div className="text-sm text-zinc-500 py-2 italic">No expenses recorded</div>}
              </div>
              <div className="flex justify-between py-3 mt-2 border-t border-white/10">
                <span className="font-bold">Total Expenses</span>
                <span className="font-bold text-red-400">{formatMoney(report.totalExpenses)}</span>
              </div>
            </div>

            {/* NET INCOME */}
            <div className="pt-6 border-t-4 border-white/10">
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold uppercase tracking-wider">Net Income</span>
                <span className={`text-2xl font-black ${report.netIncome >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatMoney(report.netIncome)}
                </span>
              </div>
            </div>

            {/* WARNINGS */}
            {(report.uncategorizedExpCount > 0 || report.uncategorizedTxCount > 0) && (
              <div className="mt-8 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md">
                <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div>
                  <h5 className="text-sm font-bold text-amber-500">Uncategorized Items</h5>
                  <p className="text-sm text-amber-200/70 mt-1">
                    There are {report.uncategorizedTxCount} transactions and {report.uncategorizedExpCount} expenses without a category in this period. 
                    These are excluded from the report above. Please categorize them in the Ledger.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
