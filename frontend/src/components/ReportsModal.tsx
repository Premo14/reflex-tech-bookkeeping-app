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
import { formatDateMMDDYYYY, toLocalISODate } from "../utils/dateUtils";
import { formatCurrency } from "../utils/formatCurrency";
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

  // Solopreneur Tax Deduction Calculators
  const [businessMiles, setBusinessMiles] = useState<number>(0);
  const [selectedMileageRateYear, setSelectedMileageRateYear] = useState<number>(taxYear);
  const [homeOfficeSqFt, setHomeOfficeSqFt] = useState<number>(0);

  // Report states
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [cashFlowReport, setCashFlowReport] = useState<CashFlowReport | null>(null);
  const [vendorSpendReport, setVendorSpendReport] = useState<VendorSpendReport | null>(null);
  const [arAgingReport, setARAgingReport] = useState<ARAgingReport | null>(null);
  const [scheduleCReport, setScheduleCReport] = useState<ScheduleCReport | null>(null);
  const [trialBalanceReport, setTrialBalanceReport] = useState<TrialBalanceReport | null>(null);
  const [tbTypeFilter, setTbTypeFilter] = useState<string>("ALL");

  // Loading states
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
          void loadScheduleC(targetYear, start, end);
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
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const start = initialStartDate || (initialEndDate ? "1900-01-01" : computePresetRange("full_year").start);
      const end = initialEndDate || (initialStartDate ? toLocalISODate(new Date()) : computePresetRange("full_year").end);
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
    setTimeout(() => {
      setReport(null);
      setCashFlowReport(null);
      setVendorSpendReport(null);
      setARAgingReport(null);
      setScheduleCReport(null);
      setTrialBalanceReport(null);
    }, 300);
  };

  const formatMoney = formatCurrency;
  const formatReportDate = formatDateMMDDYYYY;
  const handleDownloadTaxPack = () => {
    const url = getTaxPackDownloadUrl({
      year: taxYear,
      startDate: startDate || `${taxYear}-01-01`,
      endDate: endDate || `${taxYear}-12-31`,
    });
    window.open(url, "_blank");
  };

  const handlePrint = () => {
    window.print();
  };

  const toggleLineExpand = (key: string) => {
    setExpandedLines((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // HEADER CONFIG
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
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        )}
        {activeTab === "cash_flow" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {activeTab === "vendor_spend" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        )}
        {activeTab === "ar_aging" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {activeTab === "schedule_c" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )}
        {activeTab === "trial_balance" && (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

  // Collect all invoices flat for A/R table
  const allARInvoices = arAgingReport
    ? arAgingReport.buckets.flatMap((b) =>
        (b.invoices || []).map((inv) => ({ ...inv, bucketName: b.bucketName }))
      )
    : [];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={titleContent} maxWidth="5xl" headerClassName="print:hidden">
      <div className="flex flex-col gap-4 sm:gap-5 min-w-0">
        {/* REPORT TAB SELECTOR (6 TABS) - STICKY & FLUID HORIZONTAL SCROLL */}
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
            <div className="flex items-center gap-2">
              <label htmlFor="schedule-c-tax-year" className="text-xs text-zinc-400 font-medium">Tax Year:</label>
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
                {[2027, 2026, 2025, 2024, 2023].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* DATE RANGE FILTER TOOLBAR FOR DATE-BOUND REPORTS */}
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

        {/* ========================================================================= */}
        {/* TAB 4: ACCOUNTS RECEIVABLE (A/R) AGING                                     */}
        {/* ========================================================================= */}
        {activeTab === "ar_aging" && (
          <div className="space-y-4">
            {/* EDUCATIONAL BANNER */}
            <div className="bg-rose-500/10 border border-rose-500/20 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
              <svg className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

            {/* AS OF DATE FILTER TOOLBAR */}
            <div className="flex flex-wrap items-end justify-between gap-3 bg-black/20 p-3 sm:p-3.5 rounded-xl border border-white/5 print:hidden">
              <div className="flex flex-wrap items-end gap-2.5 flex-1 min-w-[220px]">
                <div className="w-44">
                  <Input
                    id="ar-as-of-date"
                    name="asOfDate"
                    type="date"
                    label="Aging As Of Date"
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="ar-dso-window" className="block text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-1">
                    DSO Window (Days)
                  </label>
                  <select
                    id="ar-dso-window"
                    value={dsoWindow}
                    onChange={(e) => setDsoWindow(Number(e.target.value))}
                    className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-rose-500 cursor-pointer"
                    title="Trailing credit-sales window used as the DSO denominator"
                  >
                    <option value={30}>30</option>
                    <option value={90}>90</option>
                    <option value={180}>180</option>
                    <option value={365}>365</option>
                  </select>
                </div>
                <Button variant="secondary" size="sm" onClick={() => loadARAging(asOfDate, dsoWindow)} isLoading={isARLoading}>
                  Recalculate Aging
                </Button>
              </div>

              {arAgingReport && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => exportARAgingCSV(arAgingReport)} title="Export A/R Aging to CSV">
                    <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export CSV
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handlePrint} title="Print or Save PDF">
                    <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print
                  </Button>
                </div>
              )}
            </div>

            {isARLoading && !arAgingReport ? (
              <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
                <LoadingSpinner size="lg" color="text-rose-400" className="mb-3" />
                <p className="text-sm">Calculating A/R aging buckets and invoice statuses...</p>
              </div>
            ) : arAgingReport ? (
              <div className="space-y-4">
                {/* 6 SUMMARY METRIC CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  <div className="bg-black/30 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Total Receivables
                    </span>
                    <p className="text-xl sm:text-2xl font-black text-white mt-1 font-mono">
                      {formatMoney(arAgingReport.totalReceivables)}
                    </p>
                    <span className="text-[10px] text-zinc-400">Uncollected invoice balance</span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Current (Not Due Yet)
                    </span>
                    <p className="text-xl sm:text-2xl font-black text-emerald-400 mt-1 font-mono">
                      {formatMoney(arAgingReport.totalCurrent)}
                    </p>
                    <span className="text-[10px] text-zinc-400">Within payment terms</span>
                  </div>

                  <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 sm:p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300">
                        Total Overdue
                      </span>
                      {arAgingReport.totalOverdue > 0 && (
                        <span className="text-[10px] bg-rose-500/30 text-rose-200 px-1.5 py-0.2 rounded font-bold">
                          Action Needed
                        </span>
                      )}
                    </div>
                    <p className="text-xl sm:text-2xl font-black text-rose-300 mt-1 font-mono">
                      {formatMoney(arAgingReport.totalOverdue)}
                    </p>
                    <span className="text-[10px] text-rose-400/80">Past contractual due date</span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Open Invoices
                    </span>
                    <p className="text-xl sm:text-2xl font-black text-zinc-200 mt-1 font-mono">
                      {arAgingReport.invoiceCount}
                    </p>
                    <span className="text-[10px] text-zinc-400">
                      Across {(arAgingReport.clients || []).length} clients
                    </span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        DSO (Days Sales Outstanding)
                      </span>
                      <span className="text-[10px] bg-white/10 text-zinc-300 px-1.5 py-0.2 rounded font-mono">
                        {arAgingReport.salesDays}d window
                      </span>
                    </div>
                    <p
                      className={`text-xl sm:text-2xl font-black mt-1 font-mono ${
                        arAgingReport.dsoDays > 60 ? "text-rose-300" : "text-cyan-300"
                      }`}
                    >
                      {arAgingReport.dsoDays.toFixed(1)} days
                    </p>
                    <span className="text-[10px] text-zinc-400">
                      vs {formatMoney(arAgingReport.creditSales)} credit sales
                    </span>
                  </div>

                  <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300">
                      Delinquency Rate
                    </span>
                    <p
                      className={`text-xl sm:text-2xl font-black mt-1 font-mono ${
                        arAgingReport.delinquencyRate > 20 ? "text-rose-300" : "text-emerald-400"
                      }`}
                    >
                      {arAgingReport.delinquencyRate.toFixed(1)}%
                    </p>
                    <span className="text-[10px] text-rose-400/80">Share of receivables past due</span>
                  </div>
                </div>

                {/* 5 AGING BUCKETS GRID */}
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    Aging Distribution Buckets (As of {formatReportDate(arAgingReport.asOfDate)})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
                    {arAgingReport.buckets.map((b) => {
                      const isPastDue = b.bucketName !== "Current (Not Due)";
                      const hasBalance = b.totalAmount > 0;
                      const share =
                        arAgingReport.totalReceivables > 0
                          ? (b.totalAmount / arAgingReport.totalReceivables) * 100
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
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/10 shrink-0">
                              {b.count}
                            </span>
                          </div>
                          <p
                            className={`text-base font-black mt-1 font-mono ${
                              hasBalance && isPastDue
                                ? "text-rose-400"
                                : hasBalance
                                ? "text-emerald-400"
                                : "text-zinc-400"
                            }`}
                          >
                            {formatMoney(b.totalAmount)}
                          </p>
                          <div className="flex items-center justify-between text-[10px] mt-0.5 text-zinc-400">
                            <span>Share</span>
                            <span className="font-mono font-semibold">{share.toFixed(1)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* INVOICES DETAIL TABLE */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Outstanding Invoices Ledger</h4>
                      <p className="text-[11px] text-zinc-400">
                        Detailed invoice status, due dates, and days overdue
                      </p>
                    </div>
                    <span className="text-[11px] font-mono text-zinc-400">
                      {allARInvoices.length} open invoices
                    </span>
                  </div>

                  {allARInvoices.length === 0 ? (
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
                          {allARInvoices.map((inv) => {
                            const isOverdue = inv.daysOverdue > 0;
                            const statusClasses =
                              inv.status === "OVERDUE"
                                ? "bg-red-500/20 text-red-300 border-red-500/40"
                                : inv.status === "PARTIALLY_PAID"
                                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                : "bg-blue-500/20 text-blue-300 border-blue-500/40";
                            return (
                              <tr key={inv.id} className="hover:bg-white/5 transition-colors">
                                <td className="py-1.5 px-2.5 font-mono font-bold text-white">
                                  {inv.invoiceNumber}
                                </td>
                                <td className="py-1.5 px-2.5 font-semibold text-zinc-200">
                                  {inv.clientName}
                                </td>
                                <td className="py-1.5 px-2.5 text-zinc-400">
                                  <span>{formatReportDate(inv.issueDate)}</span>
                                  <span className="text-[10px] text-zinc-400 block">
                                    Due: {formatReportDate(inv.dueDate)}
                                  </span>
                                </td>
                                <td className="py-1.5 px-2.5">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full border ${statusClasses}`}>
                                    {inv.status === "PARTIALLY_PAID" ? "PARTIAL" : inv.status}
                                  </span>
                                </td>
                                <td className="py-1.5 px-2.5 text-center">
                                  {isOverdue ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                      ⚠️ {inv.daysOverdue}d
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      ✓ Current
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 px-2.5">
                                  <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 text-[10px] font-medium border border-white/5">
                                    {inv.bucketName}
                                  </span>
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono text-zinc-300">
                                  {formatMoney(inv.totalAmount)}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono text-zinc-400">
                                  {inv.amountPaid > 0 ? formatMoney(inv.amountPaid) : "—"}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono font-bold text-white">
                                  {formatMoney(inv.balanceDue)}
                                </td>
                                <td className="py-1.5 px-2.5 text-right">
                                  {onOpenInvoiceDetail && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenInvoiceDetail(inv.id)}
                                      className="px-2 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/10 rounded text-[11px] cursor-pointer transition-colors"
                                      title="Open invoice in the Invoices panel"
                                    >
                                      View
                                    </button>
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
                            <td className="py-2 px-2.5 text-right font-mono text-zinc-300">
                              {formatMoney(allARInvoices.reduce((s, i) => s + i.totalAmount, 0))}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-zinc-300">
                              {formatMoney(allARInvoices.reduce((s, i) => s + i.amountPaid, 0))}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-white text-xs font-bold">
                              {formatMoney(arAgingReport.totalReceivables)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {/* CLIENT CONCENTRATION BREAKDOWN */}
                {(arAgingReport.clients || []).length > 0 && (
                  <div className="bg-black/40 border border-white/5 rounded-xl p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Client Receivables Concentration</h4>
                        <p className="text-[11px] text-zinc-400">
                          Summary of outstanding and overdue balances grouped by client
                        </p>
                      </div>
                      <span className="text-[11px] font-mono text-zinc-400">
                        {(arAgingReport.clients || []).length} clients
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
                          {(arAgingReport.clients || []).map((c) => (
                            <tr key={c.clientName} className="hover:bg-white/5 transition-colors">
                              <td className="py-1.5 px-2.5 font-semibold text-white">{c.clientName}</td>
                              <td className="py-1.5 px-2.5 text-center font-mono text-zinc-300">
                                {c.invoiceCount}
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-mono text-emerald-400">
                                {formatMoney(c.currentAmount)}
                              </td>
                              <td
                                className={`py-1.5 px-2.5 text-right font-mono font-bold ${
                                  c.overdueAmount > 0 ? "text-rose-400" : "text-zinc-400"
                                }`}
                              >
                                {formatMoney(c.overdueAmount)}
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-mono font-bold text-white">
                                {formatMoney(c.totalOutstanding)}
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
        )}

        {/* ========================================================================= */}
        {/* TAB 5: IRS SCHEDULE C (FORM 1040)                                         */}
        {/* ========================================================================= */}
        {activeTab === "schedule_c" && (
          <div className="space-y-4">
            {/* ACTION TOOLBAR & EXPORTS */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 bg-black/20 p-3 sm:p-3.5 rounded-xl border border-white/5 print:hidden">
              <div>
                <h4 className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                  Form 1040 Schedule C — Profit or Loss From Business
                </h4>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Tax year {taxYear} • Single-entry ledger mapped directly to IRS tax schedule lines.
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleDownloadTaxPack}
                  className="bg-amber-500 hover:bg-amber-400 text-black font-bold shadow-md shadow-amber-500/20"
                  title="Download bundled ZIP of Schedule C CSV, Transaction Register, and Categorized Receipts"
                >
                  <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  1-Click CPA Tax Pack (.zip)
                </Button>

                {scheduleCReport && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => exportScheduleCCSV(scheduleCReport)} title="Export Schedule C CSV">
                      <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export CSV
                    </Button>
                    <Button variant="secondary" size="sm" onClick={handlePrint} title="Print or Save PDF">
                      <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      Print
                    </Button>
                  </>
                )}
              </div>
            </div>

            {isTaxLoading && !scheduleCReport ? (
              <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
                <LoadingSpinner size="lg" color="text-amber-500" className="mb-3" />
                <p className="text-sm">Compiling IRS Form 1040 Schedule C...</p>
              </div>
            ) : scheduleCReport ? (
              <div className="space-y-4">
                {/* 4 SUMMARY METRIC CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <div className="bg-black/30 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Gross Income (Line 7)
                    </span>
                    <p className="text-xl sm:text-2xl font-black text-emerald-400 mt-1 font-mono">
                      {formatMoney(scheduleCReport.grossIncome)}
                    </p>
                    <span className="text-[10px] text-zinc-400">Gross receipts & revenues</span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Total Expenses (Line 28)
                    </span>
                    <p className="text-xl sm:text-2xl font-black text-red-400 mt-1 font-mono">
                      {formatMoney(scheduleCReport.totalExpensesDeductible)}
                    </p>
                    <span className="text-[10px] text-zinc-400 font-mono">
                      Gross: {formatMoney(scheduleCReport.totalExpensesGross)}
                    </span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Net Profit / Loss (Line 31)
                    </span>
                    <p
                      className={`text-xl sm:text-2xl font-black mt-1 font-mono ${
                        scheduleCReport.netProfitOrLoss >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {formatMoney(scheduleCReport.netProfitOrLoss)}
                    </p>
                    <span className="text-[10px] text-zinc-400">Taxable business income</span>
                  </div>

                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 sm:p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                        Meals 50% IRS Limit
                      </span>
                      <span className="text-[10px] bg-amber-500/30 text-amber-200 px-1.5 py-0.2 rounded font-bold">
                        Line 24b
                      </span>
                    </div>
                    <p className="text-xl sm:text-2xl font-black text-amber-300 mt-1 font-mono">
                      {formatMoney(scheduleCReport.nondeductibleMeals)}
                    </p>
                    <span className="text-[10px] text-amber-400/80">
                      Non-deductible 50% meal cap applied
                    </span>
                  </div>
                </div>

                {/* SUSPENSE WARNING */}
                {(scheduleCReport.uncategorizedExpenseAmount > 0 ||
                  scheduleCReport.uncategorizedIncomeAmount > 0) && (
                  <div className="bg-amber-500/10 border border-amber-500/30 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md">
                    <svg
                      className="w-5 h-5 text-amber-400 shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <div className="flex-1">
                      <h5 className="text-xs font-bold text-amber-300 uppercase tracking-wider">Uncategorized Items in Suspense</h5>
                      <p className="text-xs text-amber-200/80 mt-1">
                        There are {scheduleCReport.uncategorizedTxCount} transactions (
                        {formatMoney(scheduleCReport.uncategorizedExpenseAmount)}) awaiting categorization. For accurate
                        tax reporting, categorize these before filing your Schedule C.
                      </p>
                      {onViewUncategorized && (
                        <button
                          type="button"
                          onClick={() => {
                            onViewUncategorized();
                            onClose();
                          }}
                          className="mt-2 text-xs font-semibold px-2.5 py-1 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          Resolve Uncategorized in Ledger →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* SCHEDULE C DETAILED BREAKDOWN */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 sm:p-5 space-y-4">
                  {/* PART I: INCOME */}
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
                          <span className="font-mono text-amber-400 font-bold mr-2">Line 1</span> Gross receipts or
                          sales
                        </span>
                        <span className="font-semibold text-white">
                          {formatMoney(scheduleCReport.grossReceipts)}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-white/5">
                        <span className="text-zinc-300">
                          <span className="font-mono text-amber-400 font-bold mr-2">Line 2</span> Returns and
                          allowances
                        </span>
                        <span className="font-semibold text-zinc-400">
                          ({formatMoney(scheduleCReport.returnsAndAllowances)})
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-white/5">
                        <span className="text-zinc-300">
                          <span className="font-mono text-amber-400 font-bold mr-2">Line 3</span> Net receipts (Line 1
                          minus Line 2)
                        </span>
                        <span className="font-semibold text-white">
                          {formatMoney(scheduleCReport.netReceipts)}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-white/5">
                        <span className="text-zinc-300">
                          <span className="font-mono text-amber-400 font-bold mr-2">Line 4</span> Cost of goods sold
                          (COGS)
                        </span>
                        <span className="font-semibold text-zinc-400">
                          ({formatMoney(scheduleCReport.costOfGoodsSold)})
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-white/5">
                        <span className="text-zinc-300">
                          <span className="font-mono text-amber-400 font-bold mr-2">Line 5</span> Gross profit (Line 3
                          minus Line 4)
                        </span>
                        <span className="font-semibold text-white">
                          {formatMoney(scheduleCReport.grossProfit)}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-white/5">
                        <span className="text-zinc-300">
                          <span className="font-mono text-amber-400 font-bold mr-2">Line 6</span> Other income
                          (interest, refunds)
                        </span>
                        <span className="font-semibold text-white">
                          {formatMoney(scheduleCReport.otherIncome)}
                        </span>
                      </div>
                      <div className="flex justify-between py-2 pt-3 border-t border-white/10 font-bold text-sm">
                        <span className="text-emerald-400">
                          <span className="font-mono mr-2">Line 7</span> Gross Income
                        </span>
                        <span className="text-emerald-400">{formatMoney(scheduleCReport.grossIncome)}</span>
                      </div>
                    </div>
                  </div>

                  {/* PART II: EXPENSES */}
                  <div>
                    <div className="border-b border-white/10 pb-2 mb-3 flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Part II: Expenses (Deductible Business Write-Offs)
                      </h4>
                      <span className="text-xs font-mono text-zinc-400">IRS Form 1040 Line 8–27a</span>
                    </div>

                    <div className="space-y-2">
                      {scheduleCReport.expenseLines.map((l) => {
                        const isExpanded = Boolean(expandedLines[l.lineNumber]);
                        return (
                          <div
                            key={l.lineNumber}
                            className="border border-white/5 rounded-lg bg-zinc-950/40 overflow-hidden"
                          >
                            <div
                              onClick={() => toggleLineExpand(l.lineNumber)}
                              className="flex items-center justify-between p-2.5 hover:bg-white/5 transition-colors cursor-pointer select-none"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-amber-400 text-xs w-16 shrink-0">
                                  {l.lineNumber}
                                </span>
                                <span className="text-xs font-semibold text-zinc-200">
                                  {l.lineName}
                                </span>
                                {l.deductiblePercent < 100 && (
                                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 rounded font-bold">
                                    {l.deductiblePercent}% Deductible
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-4 text-xs">
                                <div className="text-right">
                                  <span className="font-bold text-white">
                                    {formatMoney(l.deductibleAmount)}
                                  </span>
                                  {l.deductiblePercent < 100 && (
                                    <span className="block text-[10px] text-zinc-400">
                                      Gross: {formatMoney(l.grossAmount)}
                                    </span>
                                  )}
                                </div>
                                <span className="text-zinc-400 text-xs">
                                  {isExpanded ? "▲" : "▼"}
                                </span>
                              </div>
                            </div>

                            {/* ACCOUNT DRILLDOWN */}
                            {isExpanded && (
                              <div className="bg-black/30 px-4 py-2 border-t border-white/5 space-y-1">
                                {l.accounts.map((acc) => (
                                  <div
                                    key={acc.accountId || acc.accountCode}
                                    className="flex justify-between text-xs py-1 text-zinc-400"
                                  >
                                    <span className="font-mono">
                                      {acc.accountCode} — {acc.accountName}
                                    </span>
                                    <span className="font-mono text-zinc-300">
                                      {formatMoney(acc.total)}
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
                      <span className="text-red-400">
                        {formatMoney(scheduleCReport.totalExpensesDeductible)}
                      </span>
                    </div>
                  </div>

                  {/* LINE 31: NET PROFIT OR (LOSS) */}
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
                      className={`text-2xl font-black ${
                        scheduleCReport.netProfitOrLoss >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {formatMoney(scheduleCReport.netProfitOrLoss)}
                    </span>
                  </div>

                  {/* PART III: FORM 1040-ES QUARTERLY ESTIMATED TAX & SCHEDULE SE */}
                  <div className="pt-6 border-t-2 border-white/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold uppercase tracking-wider text-amber-400">
                          IRS Form 1040-ES Quarterly Estimated Taxes & Schedule SE
                        </h4>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Projected tax liabilities based on {scheduleCReport.year} Schedule C net income of {formatMoney(scheduleCReport.netProfitOrLoss)}
                        </p>
                      </div>
                      <span className="text-[10px] font-mono bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30">
                        15.3% SE Tax + 15% Estimated Federal
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                          Schedule SE Tax (15.3%)
                        </span>
                        <span className="text-lg font-bold font-mono text-white">
                          {formatMoney(scheduleCReport.selfEmploymentTax || 0)}
                        </span>
                        <span className="text-[10px] text-zinc-400 block mt-1">Social Security & Medicare</span>
                      </div>

                      <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                          50% SE Deduction
                        </span>
                        <span className="text-lg font-bold font-mono text-emerald-400">
                          {formatMoney(scheduleCReport.deductibleSelfEmploymentTax || 0)}
                        </span>
                        <span className="text-[10px] text-zinc-400 block mt-1">Reduces AGI on 1040</span>
                      </div>

                      <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                          Total Annual Estimated Tax
                        </span>
                        <span className="text-lg font-bold font-mono text-white">
                          {formatMoney(scheduleCReport.totalEstimatedTax || 0)}
                        </span>
                        <span className="text-[10px] text-zinc-400 block mt-1">SE + Est Federal Income</span>
                      </div>

                      <div className="bg-zinc-950/60 border border-amber-500/30 rounded-xl p-3 bg-amber-500/5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block mb-1">
                          Estimated Quarterly Voucher
                        </span>
                        <span className="text-lg font-bold font-mono text-amber-300">
                          {formatMoney(scheduleCReport.estimatedQuarterlyTax || 0)}
                        </span>
                        <span className="text-[10px] text-amber-400/70 block mt-1">Due per IRS quarter</span>
                      </div>
                    </div>

                    {/* QUARTERLY DEADLINES */}
                    {scheduleCReport.quarterlyDeadlines && scheduleCReport.quarterlyDeadlines.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
                        {scheduleCReport.quarterlyDeadlines.map((dl) => (
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
                            <span className="font-mono font-bold">
                              {formatMoney(dl.amountDue)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* PART IV: SOLOPRENEUR TAX DEDUCTION OPTIMIZERS (MILEAGE & HOME OFFICE) */}
                  <div className="pt-6 border-t-2 border-white/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                          Solopreneur Tax Deduction Optimizers
                        </h4>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Interactive calculators for vehicle business mileage and home office deductions.
                        </p>
                      </div>
                      <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                        Maximize Write-Offs
                      </span>
                    </div>

                    {(() => {
                      const mileageRate = selectedMileageRateYear === 2024 ? 0.67 : 0.70;
                      const calculatedMileageDeduction = businessMiles * mileageRate;
                      const line9Expense = scheduleCReport.expenseLines.find((l) =>
                        l.lineNumber.toLowerCase().includes("line 9")
                      );
                      const actualVehicleExpenses = line9Expense ? line9Expense.deductibleAmount : 0;
                      const mileageAdvantage = calculatedMileageDeduction - actualVehicleExpenses;

                      const homeOfficeDeduction = Math.min(300, Math.max(0, homeOfficeSqFt)) * 5.0;
                      const totalPotentialDeduction =
                        (mileageAdvantage > 0 ? mileageAdvantage : 0) + homeOfficeDeduction;
                      const estimatedTaxSavings = totalPotentialDeduction * 0.303; // ~15.3% SE tax + ~15% income tax

                      return (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* IRC § 162 VEHICLE MILEAGE CALCULATOR */}
                            <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-4 space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                                  🚗 IRC § 162 Business Mileage
                                </span>
                                <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded font-mono">
                                  ${mileageRate.toFixed(2)} / mile ({selectedMileageRateYear})
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                                    Annual Business Miles
                                  </label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="50"
                                    placeholder="e.g. 5000"
                                    value={businessMiles || ""}
                                    onChange={(e) => setBusinessMiles(Math.max(0, parseFloat(e.target.value) || 0))}
                                    className="text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                                    Tax Rate Year
                                  </label>
                                  <select
                                    value={selectedMileageRateYear}
                                    onChange={(e) => setSelectedMileageRateYear(Number(e.target.value))}
                                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                                  >
                                    <option value={2026}>2026 ($0.70/mi)</option>
                                    <option value={2025}>2025 ($0.70/mi)</option>
                                    <option value={2024}>2024 ($0.67/mi)</option>
                                  </select>
                                </div>
                              </div>

                              <div className="bg-zinc-950/60 border border-white/5 rounded-lg p-3 space-y-2 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-zinc-400">Standard Mileage Deduction:</span>
                                  <span className="font-mono font-bold text-white">
                                    {formatMoney(calculatedMileageDeduction)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-zinc-400">Actual Vehicle Costs (Line 9):</span>
                                  <span className="font-mono text-zinc-300">
                                    {formatMoney(actualVehicleExpenses)}
                                  </span>
                                </div>
                                <div className="flex justify-between border-t border-white/10 pt-1.5">
                                  <span className="font-semibold text-zinc-300">Mileage vs Actual Advantage:</span>
                                  <span
                                    className={`font-mono font-bold ${
                                      mileageAdvantage >= 0 ? "text-emerald-400" : "text-amber-400"
                                    }`}
                                  >
                                    {mileageAdvantage >= 0
                                      ? `+${formatMoney(mileageAdvantage)} (Mileage better)`
                                      : `${formatMoney(mileageAdvantage)} (Actual better)`}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* IRC § 280A SIMPLIFIED HOME OFFICE CALCULATOR */}
                            <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-4 space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                                  🏠 IRC § 280A Simplified Home Office
                                </span>
                                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono">
                                  $5.00 / sq ft (Max 300 sq ft)
                                </span>
                              </div>

                              <div className="pt-1">
                                <label className="text-[11px] text-zinc-400 font-medium block mb-1">
                                  Dedicated Office Area (Square Feet, Max 300)
                                </label>
                                <Input
                                  type="number"
                                  min="0"
                                  max="300"
                                  step="10"
                                  placeholder="e.g. 200"
                                  value={homeOfficeSqFt || ""}
                                  onChange={(e) => setHomeOfficeSqFt(Math.min(300, Math.max(0, parseFloat(e.target.value) || 0)))}
                                  className="text-xs"
                                />
                              </div>

                              <div className="bg-zinc-950/60 border border-white/5 rounded-lg p-3 space-y-2 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-zinc-400">Calculated Line 30 Deduction:</span>
                                  <span className="font-mono font-bold text-emerald-400">
                                    {formatMoney(homeOfficeDeduction)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-zinc-400">IRS Safe Harbor Cap:</span>
                                  <span className="font-mono text-zinc-400">$1,500.00 / year</span>
                                </div>
                                <p className="text-[10px] text-zinc-400 pt-1 border-t border-white/10 leading-relaxed">
                                  No receipts or utility apportionment required. Requires exclusive regular business use of the room.
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* TOTAL TAX SAVINGS BANNER */}
                          {totalPotentialDeduction > 0 && (
                            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                              <div>
                                <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                                  Potential Additional Tax Write-Offs: {formatMoney(totalPotentialDeduction)}
                                </span>
                                <p className="text-xs text-emerald-400/80 mt-0.5">
                                  Reduces both Self-Employment Tax (15.3%) and Federal Income Tax (~15% effective bracket).
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-[10px] uppercase font-bold text-zinc-400 block">
                                  Estimated Cash Saved
                                </span>
                                <span className="text-lg font-black text-emerald-400">
                                  ~{formatMoney(estimatedTaxSavings)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: TRIAL BALANCE & DOUBLE-ENTRY LEDGER VERIFICATION                   */}
        {/* ========================================================================= */}
        {activeTab === "trial_balance" && (
          <div className="space-y-4">
            {/* EDUCATIONAL & GAAP BANNER */}
            <div className="bg-blue-500/10 border border-blue-500/20 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
              <svg className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
              </svg>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-blue-400">
                    GAAP Trial Balance & Double-Entry Ledger Verification
                  </h5>
                  <span className="bg-blue-500/20 text-blue-300 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border border-blue-500/30">
                    CPA-Ready
                  </span>
                </div>
                <p className="text-xs text-blue-200/80 leading-relaxed">
                  Under formal double-entry bookkeeping, every monetary inflow or outflow is balanced across two accounts: 
                  the asset/source account (Bank, Card, Cash) and the offsetting nominal or real account (Expense, Revenue, Equipment, or Owner's Equity). 
                  When total debits equal total credits (<span className="font-mono font-semibold text-blue-300">&Delta; = $0.00</span>), your general ledger is mathematically verified and ready for tax filing, external audit, or seamless export.
                </p>
              </div>
            </div>

            {isTrialBalanceLoading && !trialBalanceReport ? (
              <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
                <LoadingSpinner size="lg" color="text-blue-500" className="mb-3" />
                <p className="text-sm">Calculating double-entry trial balance...</p>
              </div>
            ) : trialBalanceReport ? (
              <div className="space-y-4">
                {/* BALANCE INTEGRITY BANNER */}
                <div
                  className={`p-3 sm:p-3.5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    trialBalanceReport.isBalanced
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                      : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold shrink-0 ${
                        trialBalanceReport.isBalanced ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                      }`}
                    >
                      {trialBalanceReport.isBalanced ? "✓" : "⚠"}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold tracking-tight uppercase">
                        {trialBalanceReport.isBalanced
                          ? "General Ledger is Mechanically Balanced"
                          : "General Ledger Out of Balance Warning"}
                      </h4>
                      <p className="text-xs opacity-80 mt-0.5">
                        {trialBalanceReport.isBalanced
                          ? `Total Debits match Total Credits exactly across ${trialBalanceReport.accounts.length} active ledger accounts.`
                          : `Total debits and credits do not match. Variance: ${formatMoney(trialBalanceReport.varianceCents / 100)}.`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-black/40 border border-white/10">
                      Variance:{" "}
                      <span className={trialBalanceReport.isBalanced ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                        {formatMoney(trialBalanceReport.varianceCents / 100)}
                      </span>
                    </span>
                    <Button variant="secondary" size="sm" onClick={exportTrialBalanceCSV} className="text-xs">
                      Export CSV
                    </Button>
                  </div>
                </div>

                {/* 4 SUMMARY METRIC CARDS */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                      Total Debits (Dr)
                    </span>
                    <span className="text-lg font-bold font-mono text-white">
                      {formatMoney(trialBalanceReport.totalDebit)}
                    </span>
                    <span className="text-[10px] text-zinc-400 block mt-0.5">Left-hand entries</span>
                  </div>

                  <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                      Total Credits (Cr)
                    </span>
                    <span className="text-lg font-bold font-mono text-white">
                      {formatMoney(trialBalanceReport.totalCredit)}
                    </span>
                    <span className="text-[10px] text-zinc-400 block mt-0.5">Right-hand entries</span>
                  </div>

                  <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                      Net Ledger Variance
                    </span>
                    <span
                      className={`text-lg font-bold font-mono ${
                        trialBalanceReport.isBalanced ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {formatMoney(trialBalanceReport.varianceCents / 100)}
                    </span>
                    <span className="text-[10px] text-zinc-400 block mt-0.5">
                      {trialBalanceReport.isBalanced ? "Zero variance (balanced)" : "Needs reconciliation"}
                    </span>
                  </div>

                  <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-3 sm:p-3.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                      Active Accounts
                    </span>
                    <span className="text-lg font-bold font-mono text-blue-400">
                      {trialBalanceReport.accounts.length}
                    </span>
                    <span className="text-[10px] text-zinc-400 block mt-0.5">Chart of Accounts</span>
                  </div>
                </div>

                {/* ACCOUNT TYPE FILTER PILLS */}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mr-1.5">
                    Filter Account Type:
                  </span>
                  {["ALL", "ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"].map((type) => {
                    const count =
                      type === "ALL"
                        ? trialBalanceReport.accounts.length
                        : trialBalanceReport.accounts.filter((a) => a.accountType.toUpperCase() === type).length;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setTbTypeFilter(type)}
                        className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 border ${
                          tbTypeFilter === type
                            ? "bg-blue-500/20 text-blue-300 border-blue-500/40 font-semibold"
                            : "bg-white/5 text-zinc-400 border-white/10 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        {type}
                        <span className="text-[10px] font-mono px-1.5 py-0.2 bg-black/40 rounded-full text-zinc-300">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* TRIAL BALANCE TABLE */}
                <div className="bg-zinc-900/80 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
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
                        {trialBalanceReport.accounts
                          .filter((acc) => tbTypeFilter === "ALL" || acc.accountType.toUpperCase() === tbTypeFilter)
                          .map((acc) => {
                            const isDebitNormal = acc.accountType === "ASSET" || acc.accountType === "EXPENSE";
                            return (
                              <tr key={acc.accountId || acc.accountCode} className="hover:bg-white/5 transition-colors">
                                <td className="py-1.5 px-3 sm:px-3.5 font-bold text-zinc-300">{acc.accountCode}</td>
                                <td className="py-1.5 px-3 sm:px-3.5 font-sans text-zinc-200 font-medium">
                                  {acc.accountName}
                                </td>
                                <td className="py-1.5 px-3 sm:px-3.5 font-sans">
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase tracking-wider border ${
                                      acc.accountType === "ASSET"
                                        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                                        : acc.accountType === "EXPENSE"
                                        ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                                        : acc.accountType === "REVENUE"
                                        ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                                        : acc.accountType === "EQUITY"
                                        ? "bg-purple-500/10 text-purple-300 border-purple-500/20"
                                        : "bg-rose-500/10 text-rose-300 border-rose-500/20"
                                    }`}
                                  >
                                    {acc.accountType}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 sm:px-3.5 font-sans text-[11px] text-zinc-400">
                                  {isDebitNormal ? (
                                    <span className="text-emerald-400/80">Debit (Dr)</span>
                                  ) : (
                                    <span className="text-cyan-400/80">Credit (Cr)</span>
                                  )}
                                </td>
                                <td className="py-1.5 px-3 sm:px-3.5 text-right text-zinc-100">
                                  {acc.netDebit > 0 ? (
                                    <span className="font-semibold text-white">{formatMoney(acc.netDebit)}</span>
                                  ) : (
                                    <span className="text-zinc-400">-</span>
                                  )}
                                </td>
                                <td className="py-1.5 px-3 sm:px-3.5 text-right text-zinc-100">
                                  {acc.netCredit > 0 ? (
                                    <span className="font-semibold text-white">{formatMoney(acc.netCredit)}</span>
                                  ) : (
                                    <span className="text-zinc-400">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}

                        {trialBalanceReport.accounts.filter(
                          (acc) => tbTypeFilter === "ALL" || acc.accountType.toUpperCase() === tbTypeFilter
                        ).length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-6 text-center text-zinc-400 font-sans text-xs">
                              No ledger activity found for account type "{tbTypeFilter}".
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-zinc-950 border-t-2 border-white/20 font-mono font-bold text-xs z-10">
                        <tr>
                          <td colSpan={4} className="py-2 px-3 sm:px-3.5 font-sans uppercase tracking-wider text-zinc-300 text-[11px]">
                            Totals (All Accounts)
                          </td>
                          <td className="py-2 px-3 sm:px-3.5 text-right text-white">
                            {formatMoney(trialBalanceReport.totalDebit)}
                          </td>
                          <td className="py-2 px-3 sm:px-3.5 text-right text-white">
                            {formatMoney(trialBalanceReport.totalCredit)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 flex items-center justify-center text-zinc-400 flex-col">
                <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
                <p>Select date range and click Update Report to generate Trial Balance.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
