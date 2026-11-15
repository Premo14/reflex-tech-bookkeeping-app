import { useState, useEffect, useCallback, useRef } from "react";
import {
  getProfitLoss,
  getScheduleCReport,
  getTaxPackDownloadUrl,
  getCashFlowReport,
  getVendorSpendReport,
  getARAgingReport,
  getTrialBalance,
  getTrialBalanceExportUrl,
} from "../services/api";
import type {
  ProfitLossReport,
  ScheduleCReport,
  CashFlowReport,
  VendorSpendReport,
  ARAgingReport,
  TrialBalanceReport,
} from "../types/models";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { toLocalISODate } from "../utils/dateUtils";
import {
  computePresetRange,
  exportARAgingCSV,
  exportCashFlowCSV,
  exportProfitLossCSV,
  exportScheduleCCSV,
  exportVendorSpendCSV,
  type ReportPreset,
} from "./reports/reportHelpers";
import { ProfitLossTab } from "./reports/ProfitLossTab";
import { CashFlowTab } from "./reports/CashFlowTab";
import { VendorSpendTab } from "./reports/VendorSpendTab";
import { ARAgingTab } from "./reports/ARAgingTab";
import { ScheduleCTab } from "./reports/ScheduleCTab";
import { TrialBalanceTab } from "./reports/TrialBalanceTab";

export type ReportTab = "pl" | "cash_flow" | "vendor_spend" | "ar_aging" | "schedule_c" | "trial_balance";

interface ReportsModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialStartDate?: string;
  initialEndDate?: string;
  onViewUncategorized?: () => void;
  onOpenInvoiceDetail?: (invoiceId: number) => void;
  initialTab?: ReportTab;
}

const PRESET_OPTIONS: { id: ReportPreset; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "ytd", label: "Year to Date (YTD)" },
  { id: "full_year", label: "Full Year" },
];

const TAX_YEAR_OPTIONS = [2027, 2026, 2025, 2024, 2023];

export default function ReportsModal({
  isOpen = true,
  onClose,
  initialStartDate,
  initialEndDate,
  onViewUncategorized,
  onOpenInvoiceDetail,
  initialTab = "pl",
}: ReportsModalProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const [startDate, setStartDate] = useState(initialStartDate || "");
  const [endDate, setEndDate] = useState(initialEndDate || "");
  const [asOfDate, setAsOfDate] = useState<string>(toLocalISODate(new Date()));
  const [dsoWindow, setDsoWindow] = useState<number>(90);
  const [taxYear, setTaxYear] = useState<number>(new Date().getFullYear());
  const [activePreset, setActivePreset] = useState<string>(
    initialStartDate || initialEndDate ? "custom" : "full_year"
  );
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});

  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [cashFlowReport, setCashFlowReport] = useState<CashFlowReport | null>(null);
  const [vendorSpendReport, setVendorSpendReport] = useState<VendorSpendReport | null>(null);
  const [arAgingReport, setARAgingReport] = useState<ARAgingReport | null>(null);
  const [scheduleCReport, setScheduleCReport] = useState<ScheduleCReport | null>(null);
  const [trialBalanceReport, setTrialBalanceReport] = useState<TrialBalanceReport | null>(null);
  const [tbTypeFilter, setTbTypeFilter] = useState<string>("ALL");

  const [isLoading, setIsLoading] = useState(false);
  const [isCashFlowLoading, setIsCashFlowLoading] = useState(false);
  const [isVendorLoading, setIsVendorLoading] = useState(false);
  const [isARLoading, setIsARLoading] = useState(false);
  const [isTaxLoading, setIsTaxLoading] = useState(false);
  const [isTrialBalanceLoading, setIsTrialBalanceLoading] = useState(false);

  const loadReport = useCallback(async (start: string, end: string) => {
    setIsLoading(true);
    try {
      const data = await getProfitLoss(start, end);
      setReport(data);
    } catch (err) {
      console.error("Failed to load P&L report:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadCashFlow = useCallback(async (start: string, end: string) => {
    setIsCashFlowLoading(true);
    try {
      const data = await getCashFlowReport({ startDate: start, endDate: end });
      setCashFlowReport(data);
    } catch (err) {
      console.error("Failed to load Cash Flow report:", err);
    } finally {
      setIsCashFlowLoading(false);
    }
  }, []);

  const loadVendorSpend = useCallback(async (start: string, end: string) => {
    setIsVendorLoading(true);
    try {
      const data = await getVendorSpendReport({ startDate: start, endDate: end });
      setVendorSpendReport(data);
    } catch (err) {
      console.error("Failed to load Vendor Spend report:", err);
    } finally {
      setIsVendorLoading(false);
    }
  }, []);

  const loadARAging = useCallback(async (targetDate: string, targetWindow: number) => {
    setIsARLoading(true);
    try {
      const data = await getARAgingReport({ asOfDate: targetDate, salesDays: targetWindow });
      setARAgingReport(data);
    } catch (err) {
      console.error("Failed to load A/R Aging report:", err);
    } finally {
      setIsARLoading(false);
    }
  }, []);

  const loadScheduleC = useCallback(async (year: number, start?: string, end?: string) => {
    setIsTaxLoading(true);
    try {
      const data = await getScheduleCReport({
        year,
        startDate: start || `${year}-01-01`,
        endDate: end || `${year}-12-31`,
      });
      setScheduleCReport(data);
    } catch (err) {
      console.error("Failed to load Schedule C report:", err);
    } finally {
      setIsTaxLoading(false);
    }
  }, []);

  const loadTrialBalance = useCallback(async (start: string, end: string) => {
    setIsTrialBalanceLoading(true);
    try {
      const data = await getTrialBalance({ startDate: start, endDate: end });
      setTrialBalanceReport(data);
    } catch (err) {
      console.error("Failed to load Trial Balance report:", err);
    } finally {
      setIsTrialBalanceLoading(false);
    }
  }, []);

  const initializedOpenRef = useRef(false);
  const initialAsOfRef = useRef(asOfDate);
  const initialDsoRef = useRef(dsoWindow);
  const initialTaxYearRef = useRef(taxYear);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const loadTabForParams = useCallback(
    (
      tab: ReportTab,
      start: string,
      end: string,
      targetAsOf: string,
      targetWindow: number,
      targetYear: number
    ) => {
      switch (tab) {
        case "pl":
          void loadReport(start, end);
          break;
        case "cash_flow":
          void loadCashFlow(start, end);
          break;
        case "vendor_spend":
          void loadVendorSpend(start, end);
          break;
        case "ar_aging":
          void loadARAging(targetAsOf, targetWindow);
          break;
        case "schedule_c":
          void loadScheduleC(targetYear, `${targetYear}-01-01`, `${targetYear}-12-31`);
          break;
        case "trial_balance":
          void loadTrialBalance(start, end);
          break;
      }
    },
    [loadARAging, loadCashFlow, loadReport, loadScheduleC, loadTrialBalance, loadVendorSpend]
  );

  const applyPreset = useCallback(
    (preset: ReportPreset) => {
      setActivePreset(preset);
      const { start, end } = computePresetRange(preset);
      setStartDate(start);
      setEndDate(end);

      if (activeTab !== "pl") setReport(null);
      if (activeTab !== "cash_flow") setCashFlowReport(null);
      if (activeTab !== "vendor_spend") setVendorSpendReport(null);
      if (activeTab !== "trial_balance") setTrialBalanceReport(null);

      loadTabForParams(activeTab, start, end, asOfDate, dsoWindow, taxYear);
    },
    [activeTab, asOfDate, dsoWindow, loadTabForParams, taxYear]
  );

  useEffect(() => {
    if (!isOpen) {
      initializedOpenRef.current = false;
      return;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const start = initialStartDate || (initialEndDate ? "1900-01-01" : computePresetRange("full_year").start);
      const end = initialEndDate || (initialStartDate ? toLocalISODate(new Date()) : computePresetRange("full_year").end);
      setActiveTab(initialTab);
      setStartDate(start);
      setEndDate(end);
      setActivePreset(initialStartDate || initialEndDate ? "custom" : "full_year");
      loadTabForParams(
        initialTab,
        start,
        end,
        initialAsOfRef.current,
        initialDsoRef.current,
        initialTaxYearRef.current
      );
    });
    return () => {
      active = false;
    };
  }, [isOpen, initialStartDate, initialEndDate, initialTab, loadTabForParams]);

  const handleTabChange = (tab: ReportTab) => {
    setActiveTab(tab);
    switch (tab) {
      case "pl":
        if (!report || report.startDate !== startDate || report.endDate !== endDate) {
          void loadReport(startDate, endDate);
        }
        break;
      case "cash_flow":
        if (!cashFlowReport || cashFlowReport.startDate !== startDate || cashFlowReport.endDate !== endDate) {
          void loadCashFlow(startDate, endDate);
        }
        break;
      case "vendor_spend":
        if (!vendorSpendReport || vendorSpendReport.startDate !== startDate || vendorSpendReport.endDate !== endDate) {
          void loadVendorSpend(startDate, endDate);
        }
        break;
      case "ar_aging":
        if (!arAgingReport || arAgingReport.asOfDate !== asOfDate || arAgingReport.salesDays !== dsoWindow) {
          void loadARAging(asOfDate, dsoWindow);
        }
        break;
      case "schedule_c":
        if (!scheduleCReport || scheduleCReport.year !== taxYear) {
          void loadScheduleC(taxYear);
        }
        break;
      case "trial_balance":
        if (!trialBalanceReport || trialBalanceReport.startDate !== startDate || trialBalanceReport.endDate !== endDate) {
          void loadTrialBalance(startDate, endDate);
        }
        break;
    }
  };

  const exportTrialBalanceCSV = () => {
    const url = getTrialBalanceExportUrl({ startDate, endDate });
    window.open(url, "_blank");
  };

  const handleApplyFilters = () => {
    setActivePreset("custom");

    if (activeTab !== "pl") setReport(null);
    if (activeTab !== "cash_flow") setCashFlowReport(null);
    if (activeTab !== "vendor_spend") setVendorSpendReport(null);
    if (activeTab !== "trial_balance") setTrialBalanceReport(null);

    if (activeTab === "pl") {
      void loadReport(startDate, endDate);
    } else if (activeTab === "cash_flow") {
      void loadCashFlow(startDate, endDate);
    } else if (activeTab === "vendor_spend") {
      void loadVendorSpend(startDate, endDate);
    } else if (activeTab === "schedule_c") {
      void loadScheduleC(taxYear, startDate, endDate);
    } else if (activeTab === "trial_balance") {
      void loadTrialBalance(startDate, endDate);
    }
  };

  const handleClose = () => {
    onClose();
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setReport(null);
      setCashFlowReport(null);
      setVendorSpendReport(null);
      setARAgingReport(null);
      setScheduleCReport(null);
      setTrialBalanceReport(null);
    }, 300);
  };

  const handleDownloadTaxPack = () => {
    const url = getTaxPackDownloadUrl({
      year: taxYear,
      startDate: `${taxYear}-01-01`,
      endDate: `${taxYear}-12-31`,
    });
    window.open(url, "_blank");
  };

  const handlePrint = () => {
    window.print();
  };

  const toggleLineExpand = (key: string) => {
    setExpandedLines((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getHeaderDetails = () => {
    switch (activeTab) {
      case "pl":
        return {
          title: "Profit & Loss Statement",
          subtitle: "Single-entry operating revenue, business expenses & net margin",
          iconBg: "bg-emerald-900/30 text-emerald-400",
          spinnerColor: "text-emerald-400",
          isLoading: isLoading,
        };
      case "cash_flow":
        return {
          title: "Cash Flow Summary",
          subtitle: "Real cash in vs out trajectory, monthly net liquidity & savings rate",
          iconBg: "bg-cyan-900/30 text-cyan-400",
          spinnerColor: "text-cyan-400",
          isLoading: isCashFlowLoading,
        };
      case "vendor_spend":
        return {
          title: "Vendor Spend Analytics",
          subtitle: "Payee ranking, supplier concentration risk & recurring outflow breakdown",
          iconBg: "bg-purple-900/30 text-purple-400",
          spinnerColor: "text-purple-400",
          isLoading: isVendorLoading,
        };
      case "ar_aging":
        return {
          title: "Accounts Receivable (A/R) Aging",
          subtitle: "Aging analysis of unpaid client invoices across 30/60/90+ day overdue buckets",
          iconBg: "bg-rose-900/30 text-rose-400",
          spinnerColor: "text-rose-400",
          isLoading: isARLoading,
        };
      case "schedule_c":
        return {
          title: "IRS Schedule C Tax Report",
          subtitle: "Form 1040 Schedule C solopreneur tax engine with 1-click CPA Tax Pack",
          iconBg: "bg-amber-900/30 text-amber-400",
          spinnerColor: "text-amber-400",
          isLoading: isTaxLoading,
        };
      case "trial_balance":
        return {
          title: "Trial Balance & Double-Entry Ledger",
          subtitle: "GAAP verified general ledger balance: Total Debits = Total Credits verification",
          iconBg: "bg-blue-900/30 text-blue-400",
          spinnerColor: "text-blue-400",
          isLoading: isTrialBalanceLoading,
        };
    }
  };

  const header = getHeaderDetails();

  const titleContent = (
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${header.iconBg}`}>
        {activeTab === "pl" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        )}
        {activeTab === "cash_flow" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {activeTab === "vendor_spend" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        )}
        {activeTab === "ar_aging" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {activeTab === "schedule_c" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )}
        {activeTab === "trial_balance" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
        )}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-white">{header.title}</span>
          {header.isLoading && <LoadingSpinner size="sm" color={header.spinnerColor} />}
        </div>
        <p className="text-xs text-zinc-400">{header.subtitle}</p>
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={titleContent} maxWidth="5xl" headerClassName="print:hidden">
      <div className="flex flex-col gap-4 sm:gap-5 min-w-0">
        <div className="sticky -top-5 sm:-top-6 -mt-5 sm:-mt-6 -mx-5 sm:-mx-6 px-3 sm:px-6 py-2 sm:py-2.5 bg-zinc-900/95 backdrop-blur-md z-30 border-b border-white/10 flex items-center justify-between gap-2 shadow-md overflow-x-auto no-scrollbar scroll-smooth print:static print:bg-transparent print:p-0 print:border-none print:m-0 min-w-0">
          <div role="tablist" aria-label="Financial reports" className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "pl"}
              onClick={() => handleTabChange("pl")}
              className={`flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 touch-glow-emerald ${
                activeTab === "pl"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm glow-emerald"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Profit &amp; Loss
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "cash_flow"}
              onClick={() => handleTabChange("cash_flow")}
              className={`flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 touch-glow-cyan ${
                activeTab === "cash_flow"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm glow-cyan"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Cash Flow
              <span className="hidden md:inline-block bg-cyan-500/30 text-cyan-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                Runway
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "vendor_spend"}
              onClick={() => handleTabChange("vendor_spend")}
              className={`flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 touch-glow-purple ${
                activeTab === "vendor_spend"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm glow-purple"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Vendor Spend
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "ar_aging"}
              onClick={() => handleTabChange("ar_aging")}
              className={`flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 touch-glow-rose ${
                activeTab === "ar_aging"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm glow-rose"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              A/R Aging
              <span className="hidden md:inline-block bg-rose-500/30 text-rose-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                Invoices
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "schedule_c"}
              onClick={() => handleTabChange("schedule_c")}
              className={`flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 touch-glow-amber ${
                activeTab === "schedule_c"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm glow-amber"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Schedule C
              <span className="hidden md:inline-block bg-amber-500/30 text-amber-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                Tax Pack
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "trial_balance"}
              onClick={() => handleTabChange("trial_balance")}
              className={`flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 touch-glow-blue ${
                activeTab === "trial_balance"
                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm glow-blue"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
              </svg>
              Trial Balance
              <span className="hidden md:inline-block bg-blue-500/30 text-blue-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                Double-Entry
              </span>
            </button>
          </div>

          {activeTab === "schedule_c" && (
            <div className="flex items-center gap-2 shrink-0">
              <label htmlFor="schedule-c-tax-year" className="text-xs text-zinc-400 font-medium">
                Tax Year:
              </label>
              <select
                id="schedule-c-tax-year"
                name="taxYear"
                value={taxYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setTaxYear(y);
                  void loadScheduleC(y);
                }}
                className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1 text-xs font-bold text-white focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                {TAX_YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {(activeTab === "pl" || activeTab === "cash_flow" || activeTab === "vendor_spend" || activeTab === "trial_balance") && (
          <div className="flex flex-col gap-2.5 surface-glass p-3 sm:p-3.5 rounded-xl border border-white/5 print:hidden">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mr-1">
                Quick Presets:
              </span>
              {PRESET_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`px-2.5 py-0.5 rounded-lg text-xs font-medium transition-colors border cursor-pointer touch-glow-emerald ${
                    activePreset === p.id
                      ? "bg-white/20 text-white border-white/30 font-semibold"
                      : "bg-white/5 text-zinc-400 border-white/10 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-2.5 items-end pt-2 border-t border-white/5">
              <div className="w-full sm:w-auto flex-1 min-w-0">
                <Input
                  id="report-start-date"
                  name="startDate"
                  type="date"
                  label="Start Date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setActivePreset("custom");
                  }}
                />
              </div>
              <div className="w-full sm:w-auto flex-1 min-w-0">
                <Input
                  id="report-end-date"
                  name="endDate"
                  type="date"
                  label="End Date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setActivePreset("custom");
                  }}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleApplyFilters}
                isLoading={isLoading || isCashFlowLoading || isVendorLoading || isTrialBalanceLoading}
                className="w-full sm:w-auto shrink-0"
              >
                Update Report
              </Button>

              <div className="flex gap-1.5 shrink-0 flex-wrap">
                {activeTab === "pl" && report && (
                  <Button variant="secondary" size="sm" onClick={() => exportProfitLossCSV(report)} title="Export to CSV Spreadsheet">
                    Export CSV
                  </Button>
                )}

                {activeTab === "cash_flow" && cashFlowReport && (
                  <Button variant="secondary" size="sm" onClick={() => exportCashFlowCSV(cashFlowReport)} title="Export Cash Flow to CSV">
                    Export CSV
                  </Button>
                )}

                {activeTab === "vendor_spend" && vendorSpendReport && (
                  <Button variant="secondary" size="sm" onClick={() => exportVendorSpendCSV(vendorSpendReport)} title="Export Vendor Spend to CSV">
                    Export CSV
                  </Button>
                )}

                {activeTab === "trial_balance" && trialBalanceReport && (
                  <Button variant="secondary" size="sm" onClick={exportTrialBalanceCSV} title="Export Trial Balance to CSV">
                    Export CSV
                  </Button>
                )}

                <Button variant="secondary" size="sm" onClick={handlePrint} title="Print or Save as PDF">
                  Print / PDF
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "pl" && (
          <ProfitLossTab
            report={report}
            isLoading={isLoading}
            onViewUncategorized={onViewUncategorized}
            onClose={onClose}
          />
        )}

        {activeTab === "cash_flow" && (
          <CashFlowTab report={cashFlowReport} isLoading={isCashFlowLoading} />
        )}

        {activeTab === "vendor_spend" && (
          <VendorSpendTab report={vendorSpendReport} isLoading={isVendorLoading} />
        )}

        {activeTab === "ar_aging" && (
          <ARAgingTab
            report={arAgingReport}
            isLoading={isARLoading}
            asOfDate={asOfDate}
            dsoWindow={dsoWindow}
            onAsOfDateChange={setAsOfDate}
            onDsoWindowChange={setDsoWindow}
            onRecalculate={() => void loadARAging(asOfDate, dsoWindow)}
            onExportCSV={exportARAgingCSV}
            onPrint={handlePrint}
            onOpenInvoiceDetail={onOpenInvoiceDetail}
          />
        )}

        {activeTab === "schedule_c" && (
          <ScheduleCTab
            report={scheduleCReport}
            isLoading={isTaxLoading}
            taxYear={taxYear}
            expandedLines={expandedLines}
            onToggleLineExpand={toggleLineExpand}
            onDownloadTaxPack={handleDownloadTaxPack}
            onExportCSV={exportScheduleCCSV}
            onPrint={handlePrint}
            onViewUncategorized={onViewUncategorized}
            onClose={onClose}
          />
        )}

        {activeTab === "trial_balance" && (
          <TrialBalanceTab
            report={trialBalanceReport}
            isLoading={isTrialBalanceLoading}
            typeFilter={tbTypeFilter}
            onTypeFilterChange={setTbTypeFilter}
            onExportCSV={exportTrialBalanceCSV}
          />
        )}
      </div>
    </Modal>
  );
}
