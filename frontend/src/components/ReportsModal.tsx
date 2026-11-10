import { useState, useEffect } from "react";
import {
  getProfitLoss,
  getScheduleCReport,
  getTaxPackDownloadUrl,
  getCashFlowReport,
  getVendorSpendReport,
  getARAgingReport,
} from "../services/api";
import type {
  ProfitLossReport,
  ScheduleCReport,
  CashFlowReport,
  VendorSpendReport,
  ARAgingReport,
} from "../types/models";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { toLocalISODate } from "../utils/dateUtils";

export type ReportTab = "pl" | "cash_flow" | "vendor_spend" | "ar_aging" | "schedule_c";

interface ReportsModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialStartDate?: string;
  initialEndDate?: string;
  onViewUncategorized?: () => void;
  initialTab?: ReportTab;
}

export default function ReportsModal({
  isOpen = true,
  onClose,
  initialStartDate,
  initialEndDate,
  onViewUncategorized,
  initialTab = "pl",
}: ReportsModalProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const [startDate, setStartDate] = useState(initialStartDate || "");
  const [endDate, setEndDate] = useState(initialEndDate || "");
  const [asOfDate, setAsOfDate] = useState<string>(toLocalISODate(new Date()));
  const [taxYear, setTaxYear] = useState<number>(new Date().getFullYear());
  const [activePreset, setActivePreset] = useState<string>(
    initialStartDate || initialEndDate ? "custom" : "full_year"
  );
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});

  // Report states
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [cashFlowReport, setCashFlowReport] = useState<CashFlowReport | null>(null);
  const [vendorSpendReport, setVendorSpendReport] = useState<VendorSpendReport | null>(null);
  const [arAgingReport, setARAgingReport] = useState<ARAgingReport | null>(null);
  const [scheduleCReport, setScheduleCReport] = useState<ScheduleCReport | null>(null);

  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [isCashFlowLoading, setIsCashFlowLoading] = useState(false);
  const [isVendorLoading, setIsVendorLoading] = useState(false);
  const [isARLoading, setIsARLoading] = useState(false);
  const [isTaxLoading, setIsTaxLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialStartDate || initialEndDate) {
        const start = initialStartDate || "1900-01-01";
        const end = initialEndDate || toLocalISODate(new Date());
        setStartDate(start);
        setEndDate(end);
        setActivePreset("custom");
        loadActiveTabData(activeTab, start, end);
      } else {
        applyPreset("full_year");
      }
    }
  }, [isOpen, initialStartDate, initialEndDate]);

  const loadActiveTabData = (
    tab: ReportTab,
    start: string = startDate,
    end: string = endDate,
    targetAsOf: string = asOfDate
  ) => {
    switch (tab) {
      case "pl":
        loadReport(start, end);
        break;
      case "cash_flow":
        loadCashFlow(start, end);
        break;
      case "vendor_spend":
        loadVendorSpend(start, end);
        break;
      case "ar_aging":
        loadARAging(targetAsOf);
        break;
      case "schedule_c":
        loadScheduleC(taxYear, start, end);
        break;
    }
  };

  const handleTabChange = (tab: ReportTab) => {
    setActiveTab(tab);
    switch (tab) {
      case "pl":
        if (!report || report.startDate !== startDate || report.endDate !== endDate) {
          loadReport(startDate, endDate);
        }
        break;
      case "cash_flow":
        if (!cashFlowReport || cashFlowReport.startDate !== startDate || cashFlowReport.endDate !== endDate) {
          loadCashFlow(startDate, endDate);
        }
        break;
      case "vendor_spend":
        if (!vendorSpendReport || vendorSpendReport.startDate !== startDate || vendorSpendReport.endDate !== endDate) {
          loadVendorSpend(startDate, endDate);
        }
        break;
      case "ar_aging":
        if (!arAgingReport || arAgingReport.asOfDate !== asOfDate) {
          loadARAging(asOfDate);
        }
        break;
      case "schedule_c":
        if (!scheduleCReport || scheduleCReport.year !== taxYear) {
          loadScheduleC(taxYear);
        }
        break;
    }
  };

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

  const loadCashFlow = async (start: string, end: string) => {
    setIsCashFlowLoading(true);
    try {
      const data = await getCashFlowReport({ startDate: start, endDate: end });
      setCashFlowReport(data);
    } catch (err) {
      console.error("Failed to load Cash Flow report:", err);
    } finally {
      setIsCashFlowLoading(false);
    }
  };

  const loadVendorSpend = async (start: string, end: string) => {
    setIsVendorLoading(true);
    try {
      const data = await getVendorSpendReport({ startDate: start, endDate: end });
      setVendorSpendReport(data);
    } catch (err) {
      console.error("Failed to load Vendor Spend report:", err);
    } finally {
      setIsVendorLoading(false);
    }
  };

  const loadARAging = async (targetDate: string = asOfDate) => {
    setIsARLoading(true);
    try {
      const data = await getARAgingReport({ asOfDate: targetDate });
      setARAgingReport(data);
    } catch (err) {
      console.error("Failed to load A/R Aging report:", err);
    } finally {
      setIsARLoading(false);
    }
  };

  const loadScheduleC = async (year: number, start?: string, end?: string) => {
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

    // Invalidate other reports so switching tabs refetches for the updated date range
    if (activeTab !== "pl") setReport(null);
    if (activeTab !== "cash_flow") setCashFlowReport(null);
    if (activeTab !== "vendor_spend") setVendorSpendReport(null);

    // Refresh current active tab
    if (activeTab === "pl") {
      loadReport(start, end);
    } else if (activeTab === "cash_flow") {
      loadCashFlow(start, end);
    } else if (activeTab === "vendor_spend") {
      loadVendorSpend(start, end);
    } else if (activeTab === "schedule_c") {
      loadScheduleC(taxYear, start, end);
    }
  };

  const handleApplyFilters = () => {
    setActivePreset("custom");

    // Invalidate other reports so switching tabs refetches for the updated date range
    if (activeTab !== "pl") setReport(null);
    if (activeTab !== "cash_flow") setCashFlowReport(null);
    if (activeTab !== "vendor_spend") setVendorSpendReport(null);

    if (activeTab === "pl") {
      loadReport(startDate, endDate);
    } else if (activeTab === "cash_flow") {
      loadCashFlow(startDate, endDate);
    } else if (activeTab === "vendor_spend") {
      loadVendorSpend(startDate, endDate);
    } else if (activeTab === "schedule_c") {
      loadScheduleC(taxYear, startDate, endDate);
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
    }, 300);
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

  const formatMonthLabel = (period: string) => {
    if (!period) return "";
    const parts = period.split("-");
    if (parts.length === 2) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const date = new Date(year, month, 1);
      return date.toLocaleString("en-US", { month: "short", year: "numeric" });
    }
    return period;
  };

  const sanitizeCSV = (val: string | number) => {
    let str = String(val ?? "");
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  // CSV EXPORTS
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
    report.revenue.forEach((r) => {
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
    report.expenses.forEach((e) => {
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

    const csvContent = "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n");
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

  const exportCashFlowCSV = () => {
    if (!cashFlowReport) return;
    const rows: string[][] = [
      [sanitizeCSV("CASH FLOW SUMMARY STATEMENT")],
      [sanitizeCSV(`Period: ${formatReportDate(cashFlowReport.startDate)} to ${formatReportDate(cashFlowReport.endDate)}`)],
      [sanitizeCSV("Generated: " + new Date().toLocaleDateString())],
      [],
      [sanitizeCSV("SUMMARY METRICS"), sanitizeCSV("AMOUNT")],
      [sanitizeCSV("Total Cash Inflow (Deposits)"), sanitizeCSV(cashFlowReport.totalCashIn.toFixed(2))],
      [sanitizeCSV("Total Cash Outflow (Disbursements)"), sanitizeCSV(cashFlowReport.totalCashOut.toFixed(2))],
      [sanitizeCSV("Net Cash Flow"), sanitizeCSV(cashFlowReport.netCashFlow.toFixed(2))],
      [sanitizeCSV("Savings / Cash Retention Rate"), sanitizeCSV(`${cashFlowReport.savingsRatePercent.toFixed(1)}%`)],
      [sanitizeCSV("Average Monthly Inflow"), sanitizeCSV(cashFlowReport.avgMonthlyInflow.toFixed(2))],
      [sanitizeCSV("Average Monthly Outflow"), sanitizeCSV(cashFlowReport.avgMonthlyOutflow.toFixed(2))],
      [],
      [
        sanitizeCSV("PERIOD (MONTH)"),
        sanitizeCSV("CASH INFLOW"),
        sanitizeCSV("CASH OUTFLOW"),
        sanitizeCSV("NET CASH FLOW"),
        sanitizeCSV("RUNNING POSITION"),
      ],
    ];

    cashFlowReport.periods.forEach((p) => {
      rows.push([
        sanitizeCSV(p.period),
        sanitizeCSV(p.cashIn.toFixed(2)),
        sanitizeCSV(p.cashOut.toFixed(2)),
        sanitizeCSV(p.netCashFlow.toFixed(2)),
        sanitizeCSV(p.runningCashTotal.toFixed(2)),
      ]);
    });

    const csvContent = "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Cash_Flow_${cashFlowReport.startDate}_to_${cashFlowReport.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportVendorSpendCSV = () => {
    if (!vendorSpendReport) return;
    const rows: string[][] = [
      [sanitizeCSV("VENDOR SPEND & PAYEE ANALYTICS REPORT")],
      [sanitizeCSV(`Period: ${formatReportDate(vendorSpendReport.startDate)} to ${formatReportDate(vendorSpendReport.endDate)}`)],
      [sanitizeCSV("Generated: " + new Date().toLocaleDateString())],
      [],
      [sanitizeCSV("SUMMARY METRICS"), sanitizeCSV("VALUE")],
      [sanitizeCSV("Total Outflow Analyzed"), sanitizeCSV(vendorSpendReport.totalSpend.toFixed(2))],
      [sanitizeCSV("Unique Payees / Vendors"), sanitizeCSV(vendorSpendReport.totalVendors.toString())],
      [sanitizeCSV("Top 5 Payee Concentration"), sanitizeCSV(`${vendorSpendReport.top5Percent.toFixed(1)}%`)],
      [],
      [
        sanitizeCSV("RANK"),
        sanitizeCSV("VENDOR / PAYEE"),
        sanitizeCSV("TOTAL SPEND"),
        sanitizeCSV("% OF TOTAL"),
        sanitizeCSV("TRANSACTIONS"),
        sanitizeCSV("AVG TICKET"),
        sanitizeCSV("PRIMARY CATEGORY"),
      ],
    ];

    vendorSpendReport.vendors.forEach((v, idx) => {
      rows.push([
        sanitizeCSV((idx + 1).toString()),
        sanitizeCSV(v.vendorName),
        sanitizeCSV(v.totalSpend.toFixed(2)),
        sanitizeCSV(`${v.percentOfTotal.toFixed(1)}%`),
        sanitizeCSV(v.transactionCount.toString()),
        sanitizeCSV(v.averageSpend.toFixed(2)),
        sanitizeCSV(v.primaryCategoryName || "Uncategorized"),
      ]);
    });

    const csvContent = "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Vendor_Spend_${vendorSpendReport.startDate}_to_${vendorSpendReport.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportARAgingCSV = () => {
    if (!arAgingReport) return;
    const rows: string[][] = [
      [sanitizeCSV("ACCOUNTS RECEIVABLE (A/R) AGING SUMMARY")],
      [sanitizeCSV(`As Of Date: ${formatReportDate(arAgingReport.asOfDate)}`)],
      [sanitizeCSV("Generated: " + new Date().toLocaleDateString())],
      [],
      [sanitizeCSV("SUMMARY METRICS"), sanitizeCSV("VALUE")],
      [sanitizeCSV("Total Outstanding Receivables"), sanitizeCSV(arAgingReport.totalReceivables.toFixed(2))],
      [sanitizeCSV("Current (Not Due Yet)"), sanitizeCSV(arAgingReport.totalCurrent.toFixed(2))],
      [sanitizeCSV("Total Overdue"), sanitizeCSV(arAgingReport.totalOverdue.toFixed(2))],
      [sanitizeCSV("Total Open Invoices"), sanitizeCSV(arAgingReport.invoiceCount.toString())],
      [],
      [sanitizeCSV("AGING BUCKETS SUMMARY"), sanitizeCSV("AMOUNT"), sanitizeCSV("INVOICES COUNT"), sanitizeCSV("% OF TOTAL")],
    ];

    arAgingReport.buckets.forEach((b) => {
      const share =
        arAgingReport.totalReceivables > 0 ? (b.totalAmount / arAgingReport.totalReceivables) * 100 : 0;
      rows.push([
        sanitizeCSV(b.bucketName),
        sanitizeCSV(b.totalAmount.toFixed(2)),
        sanitizeCSV(b.count.toString()),
        sanitizeCSV(`${share.toFixed(1)}%`),
      ]);
    });

    rows.push([]);
    rows.push([
      sanitizeCSV("INVOICE #"),
      sanitizeCSV("CUSTOMER / CLIENT"),
      sanitizeCSV("ISSUE DATE"),
      sanitizeCSV("DUE DATE"),
      sanitizeCSV("DAYS OVERDUE"),
      sanitizeCSV("AGING BUCKET"),
      sanitizeCSV("AMOUNT OUTSTANDING"),
    ]);

    const allInvoices = arAgingReport.buckets.flatMap((b) =>
      (b.invoices || []).map((inv) => ({ ...inv, bucketName: b.bucketName }))
    );

    allInvoices.forEach((inv) => {
      rows.push([
        sanitizeCSV(inv.invoiceNumber),
        sanitizeCSV(inv.clientName),
        sanitizeCSV(formatReportDate(inv.issueDate)),
        sanitizeCSV(formatReportDate(inv.dueDate)),
        sanitizeCSV(inv.daysOverdue > 0 ? `${inv.daysOverdue} days` : "Current (0)"),
        sanitizeCSV(inv.bucketName),
        sanitizeCSV(inv.totalAmount.toFixed(2)),
      ]);
    });

    rows.push([]);
    rows.push([
      sanitizeCSV("CLIENT CONCENTRATION SUMMARY"),
      sanitizeCSV("TOTAL OUTSTANDING"),
      sanitizeCSV("CURRENT"),
      sanitizeCSV("OVERDUE"),
      sanitizeCSV("OPEN INVOICES"),
    ]);

    (arAgingReport.clients || []).forEach((c) => {
      rows.push([
        sanitizeCSV(c.clientName),
        sanitizeCSV(c.totalOutstanding.toFixed(2)),
        sanitizeCSV(c.currentAmount.toFixed(2)),
        sanitizeCSV(c.overdueAmount.toFixed(2)),
        sanitizeCSV(c.invoiceCount.toString()),
      ]);
    });

    const csvContent = "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `AR_Aging_Report_${arAgingReport.asOfDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportScheduleCCSV = () => {
    if (!scheduleCReport) return;
    const rows: string[][] = [
      [sanitizeCSV("IRS FORM 1040 SCHEDULE C - PROFIT OR LOSS FROM BUSINESS")],
      [
        sanitizeCSV(
          `Tax Year: ${scheduleCReport.year} (${formatReportDate(
            scheduleCReport.startDate
          )} to ${formatReportDate(scheduleCReport.endDate)})`
        ),
      ],
      [sanitizeCSV(`Generated: ${new Date().toLocaleDateString()}`)],
      [],
      [sanitizeCSV("PART I: INCOME"), sanitizeCSV("LINE"), sanitizeCSV("AMOUNT")],
      [
        sanitizeCSV("Gross receipts or sales"),
        sanitizeCSV("Line 1"),
        sanitizeCSV(scheduleCReport.grossReceipts.toFixed(2)),
      ],
      [
        sanitizeCSV("Returns and allowances"),
        sanitizeCSV("Line 2"),
        sanitizeCSV(scheduleCReport.returnsAndAllowances.toFixed(2)),
      ],
      [sanitizeCSV("Net receipts"), sanitizeCSV("Line 3"), sanitizeCSV(scheduleCReport.netReceipts.toFixed(2))],
      [
        sanitizeCSV("Cost of goods sold"),
        sanitizeCSV("Line 4"),
        sanitizeCSV(scheduleCReport.costOfGoodsSold.toFixed(2)),
      ],
      [sanitizeCSV("Gross profit"), sanitizeCSV("Line 5"), sanitizeCSV(scheduleCReport.grossProfit.toFixed(2))],
      [sanitizeCSV("Other income"), sanitizeCSV("Line 6"), sanitizeCSV(scheduleCReport.otherIncome.toFixed(2))],
      [sanitizeCSV("Gross income"), sanitizeCSV("Line 7"), sanitizeCSV(scheduleCReport.grossIncome.toFixed(2))],
      [],
      [
        sanitizeCSV("PART II: EXPENSES"),
        sanitizeCSV("LINE"),
        sanitizeCSV("GROSS SPEND"),
        sanitizeCSV("DEDUCTIBLE %"),
        sanitizeCSV("ALLOWABLE DEDUCTION"),
      ],
    ];
    scheduleCReport.expenseLines.forEach((l) => {
      rows.push([
        sanitizeCSV(l.lineName),
        sanitizeCSV(l.lineNumber),
        sanitizeCSV(l.grossAmount.toFixed(2)),
        sanitizeCSV(`${l.deductiblePercent}%`),
        sanitizeCSV(l.deductibleAmount.toFixed(2)),
      ]);
    });
    rows.push([]);
    rows.push([
      sanitizeCSV("TOTAL EXPENSES"),
      sanitizeCSV("Line 28"),
      sanitizeCSV(scheduleCReport.totalExpensesGross.toFixed(2)),
      "",
      sanitizeCSV(scheduleCReport.totalExpensesDeductible.toFixed(2)),
    ]);
    rows.push([
      sanitizeCSV("Nondeductible Meals (50% IRS Cap)"),
      sanitizeCSV("Line 24b"),
      sanitizeCSV(scheduleCReport.nondeductibleMeals.toFixed(2)),
      "",
      "0.00",
    ]);
    rows.push([
      sanitizeCSV("NET PROFIT OR (LOSS)"),
      sanitizeCSV("Line 31"),
      "",
      "",
      sanitizeCSV(scheduleCReport.netProfitOrLoss.toFixed(2)),
    ]);

    const csvContent = "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Schedule_C_${scheduleCReport.year}_Tax_Report.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
    <Modal isOpen={isOpen} onClose={handleClose} title={titleContent} maxWidth="4xl" headerClassName="print:hidden">
      <div className="flex flex-col gap-6">
        {/* REPORT TAB SELECTOR (5 TABS) - STICKY */}
        <div className="sticky -top-6 -mt-6 -mx-6 px-4 sm:px-6 py-2.5 sm:py-3.5 bg-zinc-900/95 backdrop-blur-md z-30 border-b border-white/10 flex items-center justify-between gap-2 shadow-md overflow-x-auto no-scrollbar print:static print:bg-transparent print:p-0 print:border-none print:m-0">
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleTabChange("pl")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "pl"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Profit & Loss
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("cash_flow")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "cash_flow"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Cash Flow
              <span className="bg-cyan-500/30 text-cyan-200 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                Runway
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("vendor_spend")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "vendor_spend"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Vendor Spend
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("ar_aging")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "ar_aging"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              A/R Aging
              <span className="bg-rose-500/30 text-rose-200 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                Invoices
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("schedule_c")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "schedule_c"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Schedule C
              <span className="bg-amber-500/30 text-amber-200 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                Tax Pack
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
                  loadScheduleC(y);
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

        {/* DATE RANGE FILTER TOOLBAR FOR DATE-BOUND REPORTS (P&L, Cash Flow, Vendor Spend) */}
        {(activeTab === "pl" || activeTab === "cash_flow" || activeTab === "vendor_spend") && (
          <div className="flex flex-col gap-3 bg-black/20 p-4 rounded-xl border border-white/5 print:hidden">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mr-1">
                Quick Presets:
              </span>
              {[
                { id: "this_month", label: "This Month" },
                { id: "last_month", label: "Last Month" },
                { id: "ytd", label: "Year to Date (YTD)" },
                { id: "full_year", label: "Full Year" },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id as any)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors border cursor-pointer ${
                    activePreset === p.id
                      ? "bg-white/20 text-white border-white/30 font-semibold"
                      : "bg-white/5 text-zinc-400 border-white/10 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-end pt-2 border-t border-white/5">
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
                onClick={handleApplyFilters}
                isLoading={isLoading || isCashFlowLoading || isVendorLoading}
                className="w-full sm:w-auto shrink-0"
              >
                Update Report
              </Button>

              <div className="flex gap-2 shrink-0">
                {activeTab === "pl" && report && (
                  <Button variant="secondary" onClick={exportCSV} title="Export to CSV Spreadsheet">
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export CSV
                  </Button>
                )}

                {activeTab === "cash_flow" && cashFlowReport && (
                  <Button variant="secondary" onClick={exportCashFlowCSV} title="Export Cash Flow to CSV">
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export CSV
                  </Button>
                )}

                {activeTab === "vendor_spend" && vendorSpendReport && (
                  <Button variant="secondary" onClick={exportVendorSpendCSV} title="Export Vendor Spend to CSV">
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export CSV
                  </Button>
                )}

                <Button variant="secondary" onClick={handlePrint} title="Print or Save as PDF">
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print / PDF
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: PROFIT & LOSS                                                      */}
        {/* ========================================================================= */}
        {activeTab === "pl" && (
          <>
            {/* EDUCATIONAL BANNER */}
            <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
              <svg className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h5 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  What is a Profit & Loss (P&L) Statement?
                </h5>
                <p className="text-xs text-emerald-200/80 mt-1 leading-relaxed">
                  The P&L (also known as an Income Statement) summarizes the revenues, costs, and operating expenses incurred during a specific time window. 
                  It shows your net profitability—whether your core business model generates more operating income than it spends to stay open.
                </p>
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
              <div
                className={`max-w-3xl mx-auto w-full space-y-8 bg-black/40 border border-white/5 p-8 rounded-xl shadow-inner backdrop-blur-sm print:bg-white print:text-black print:border-none print:shadow-none print:p-0 transition-opacity duration-200 ${
                  isLoading ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <div className="text-center border-b border-white/10 print:border-black/20 pb-6">
                  <h3 className="text-2xl font-bold uppercase tracking-wider text-white print:text-black">
                    Profit and Loss Statement
                  </h3>
                  <p className="text-zinc-400 print:text-zinc-600 mt-2 font-medium">
                    {formatReportDate(report.startDate)} – {formatReportDate(report.endDate)}
                  </p>
                </div>

                {/* REVENUE */}
                <div>
                  <h4 className="text-sm font-bold text-zinc-400 print:text-zinc-700 uppercase tracking-wider mb-3">
                    Revenue
                  </h4>
                  <div className="space-y-1">
                    {report.revenue.map((line) => (
                      <div
                        key={line.accountCode}
                        className="flex justify-between items-center gap-3 py-2 border-b border-white/5 print:border-zinc-200 min-w-0"
                      >
                        <span className="text-zinc-300 print:text-zinc-800 truncate min-w-0 flex-1">
                          {line.accountName}{" "}
                          <span className="text-zinc-400 print:text-zinc-500 text-xs ml-2">
                            {line.accountCode}
                          </span>
                        </span>
                        <span className="font-medium font-mono text-right shrink-0 print:text-black ml-2">{formatMoney(line.total)}</span>
                      </div>
                    ))}
                    {report.revenue.length === 0 && (
                      <div className="text-sm text-zinc-400 py-2 italic">No revenue recorded</div>
                    )}
                  </div>
                  <div className="flex justify-between items-center gap-3 py-3 mt-2 border-t border-white/10 print:border-black/30 min-w-0">
                    <span className="font-bold print:text-black truncate">Total Revenue</span>
                    <span className="font-bold font-mono text-right shrink-0 text-emerald-400 print:text-emerald-700">
                      {formatMoney(report.totalRevenue)}
                    </span>
                  </div>
                </div>

                {/* EXPENSES */}
                <div>
                  <h4 className="text-sm font-bold text-zinc-400 print:text-zinc-700 uppercase tracking-wider mb-3">
                    Operating Expenses
                  </h4>
                  <div className="space-y-1">
                    {report.expenses.map((line) => (
                      <div
                        key={line.accountCode}
                        className="flex justify-between items-center gap-3 py-2 border-b border-white/5 print:border-zinc-200 min-w-0"
                      >
                        <span className="text-zinc-300 print:text-zinc-800 truncate min-w-0 flex-1">
                          {line.accountName}{" "}
                          <span className="text-zinc-400 print:text-zinc-500 text-xs ml-2">
                            {line.accountCode}
                          </span>
                        </span>
                        <span className="font-medium font-mono text-right shrink-0 print:text-black ml-2">{formatMoney(line.total)}</span>
                      </div>
                    ))}
                    {report.expenses.length === 0 && (
                      <div className="text-sm text-zinc-400 py-2 italic">No expenses recorded</div>
                    )}
                  </div>
                  <div className="flex justify-between items-center gap-3 py-3 mt-2 border-t border-white/10 print:border-black/30 min-w-0">
                    <span className="font-bold print:text-black truncate">Total Operating Expenses</span>
                    <span className="font-bold font-mono text-right shrink-0 text-red-400 print:text-red-700">
                      {formatMoney(report.totalExpenses)}
                    </span>
                  </div>
                </div>

                {/* NET INCOME */}
                <div className="pt-6 border-t-4 border-white/10 print:border-black">
                  <div className="flex justify-between items-center">
                    <span className="text-xl font-bold uppercase tracking-wider print:text-black">Net Income</span>
                    <span
                      className={`text-2xl font-black ${
                        report.netIncome >= 0
                          ? "text-emerald-400 print:text-emerald-700"
                          : "text-red-400 print:text-red-700"
                      }`}
                    >
                      {formatMoney(report.netIncome)}
                    </span>
                  </div>
                </div>

                {/* SALES TAX FOOTNOTE */}
                {Boolean(report.totalTax && report.totalTax > 0) && (
                  <div className="pt-3 border-t border-white/5 print:border-zinc-200 flex justify-between items-center text-xs text-zinc-400 print:text-zinc-600">
                    <span>Cumulative Sales Tax Paid (Extracted from Receipts):</span>
                    <span className="font-semibold text-zinc-200 print:text-black">{formatMoney(report.totalTax!)}</span>
                  </div>
                )}

                {/* SUSPENSE / UNCATEGORIZED CLARIFICATION */}
                {(report.uncategorizedExpCount > 0 || report.uncategorizedTxCount > 0) && (
                  <div className="mt-8 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:border-amber-400 print:bg-amber-50">
                    <svg
                      className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 print:hidden"
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
                        <button
                          type="button"
                          onClick={() => {
                            onViewUncategorized();
                            onClose();
                          }}
                          className="mt-2.5 text-xs font-semibold px-3 py-1 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg transition-colors cursor-pointer print:hidden flex items-center gap-1.5"
                        >
                          <span>Filter Uncategorized in Ledger</span>
                          <span>→</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* EXCLUDED ITEMS FOOTNOTE */}
                {(report.excludedExpCount > 0 || report.excludedTxCount > 0) && (
                  <div className="mt-4 bg-zinc-500/10 border border-zinc-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:border-zinc-300 print:bg-zinc-50">
                    <svg
                      className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5 print:hidden"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
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
                            {report.excludedTxCount} Excluded Transactions ({formatMoney(report.excludedTxTotal)})
                          </li>
                        )}
                        {report.excludedExpCount > 0 && (
                          <li>
                            {report.excludedExpCount} Excluded Expenses ({formatMoney(report.excludedExpTotal)})
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: CASH FLOW SUMMARY                                                  */}
        {/* ========================================================================= */}
        {activeTab === "cash_flow" && (
          <div className="space-y-6">
            {/* EDUCATIONAL BANNER */}
            <div className="bg-cyan-500/10 border border-cyan-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
              <svg className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h5 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                  What is a Cash Flow Summary?
                </h5>
                <p className="text-xs text-cyan-200/80 mt-1 leading-relaxed">
                  Profit is an accounting construct, but <strong className="text-cyan-200 font-semibold">cash is liquid reality</strong>. 
                  While your P&L measures taxable performance, the Cash Flow Summary tracks the physical movement of money into and out of your bank accounts month by month. 
                  It reveals your net liquidity trajectory, your savings rate, and whether you are adding to or burning your cash reserves.
                </p>
              </div>
            </div>

            {isCashFlowLoading && !cashFlowReport ? (
              <div className="py-16 flex items-center justify-center text-zinc-400 flex-col">
                <LoadingSpinner size="lg" color="text-cyan-400" className="mb-3" />
                <p className="text-sm">Calculating liquid cash flow trajectory...</p>
              </div>
            ) : cashFlowReport ? (
              <div className="space-y-6">
                {/* 4 SUMMARY METRIC CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Total Cash In (Deposits)
                    </span>
                    <p className="text-2xl font-black text-emerald-400 mt-1">
                      {formatMoney(cashFlowReport.totalCashIn)}
                    </p>
                    <span className="text-[10px] text-zinc-500">
                      Avg: {formatMoney(cashFlowReport.avgMonthlyInflow)} / mo
                    </span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Total Cash Out (Disbursements)
                    </span>
                    <p className="text-2xl font-black text-red-400 mt-1">
                      {formatMoney(cashFlowReport.totalCashOut)}
                    </p>
                    <span className="text-[10px] text-zinc-500">
                      Avg: {formatMoney(cashFlowReport.avgMonthlyOutflow)} / mo
                    </span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Net Cash Flow
                    </span>
                    <p
                      className={`text-2xl font-black mt-1 ${
                        cashFlowReport.netCashFlow >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {cashFlowReport.netCashFlow >= 0 ? "+" : ""}
                      {formatMoney(cashFlowReport.netCashFlow)}
                    </p>
                    <span className="text-[10px] text-zinc-500">
                      {cashFlowReport.netCashFlow >= 0 ? "Cash surplus accrued" : "Net cash burn rate"}
                    </span>
                  </div>

                  <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
                        Cash Savings Rate
                      </span>
                      <span className="text-[10px] bg-cyan-500/30 text-cyan-200 px-1.5 py-0.2 rounded font-bold">
                        Retention
                      </span>
                    </div>
                    <p className="text-2xl font-black text-cyan-300 mt-1">
                      {cashFlowReport.savingsRatePercent.toFixed(1)}%
                    </p>
                    <span className="text-[10px] text-cyan-400/80">
                      Retained of gross cash inflow
                    </span>
                  </div>
                </div>

                {/* MONTHLY CASH TRAJECTORY TABLE */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <div>
                      <h4 className="text-sm font-bold text-white">Monthly Cash Flow Trajectory</h4>
                      <p className="text-xs text-zinc-400">
                        Month-by-month inflow vs outflow with cumulative position
                      </p>
                    </div>
                    <span className="text-xs font-mono text-zinc-500">
                      {cashFlowReport.periods.length} months tracked
                    </span>
                  </div>

                  {cashFlowReport.periods.length === 0 ? (
                    <div className="py-8 text-center text-zinc-400 text-sm">
                      No cash transactions recorded within this date range.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-white/10 text-zinc-400 uppercase tracking-wider text-[11px]">
                            <th className="py-2.5 font-bold">Month</th>
                            <th className="py-2.5 font-bold text-right">Cash In (+)</th>
                            <th className="py-2.5 font-bold text-right">Cash Out (-)</th>
                            <th className="py-2.5 font-bold text-right">Net Flow</th>
                            <th className="py-2.5 font-bold text-center">Direction</th>
                            <th className="py-2.5 font-bold text-right">Running Position</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {cashFlowReport.periods.map((p) => {
                            const isPositive = p.netCashFlow >= 0;
                            return (
                              <tr key={p.period} className="hover:bg-white/5 transition-colors">
                                <td className="py-2.5 font-medium text-white">
                                  {formatMonthLabel(p.period)}
                                  <span className="text-zinc-500 text-[10px] ml-1.5 font-mono">({p.period})</span>
                                </td>
                                <td className="py-2.5 text-right font-mono text-emerald-400">
                                  {formatMoney(p.cashIn)}
                                </td>
                                <td className="py-2.5 text-right font-mono text-red-400">
                                  {formatMoney(p.cashOut)}
                                </td>
                                <td
                                  className={`py-2.5 text-right font-mono font-bold ${
                                    isPositive ? "text-emerald-400" : "text-red-400"
                                  }`}
                                >
                                  {isPositive ? "+" : ""}
                                  {formatMoney(p.netCashFlow)}
                                </td>
                                <td className="py-2.5 text-center">
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      isPositive
                                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                        : "bg-red-500/20 text-red-300 border border-red-500/30"
                                    }`}
                                  >
                                    {isPositive ? "▲ Surplus" : "▼ Burn"}
                                  </span>
                                </td>
                                <td className="py-2.5 text-right font-mono font-bold text-zinc-200">
                                  {p.runningCashTotal >= 0 ? "+" : ""}
                                  {formatMoney(p.runningCashTotal)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-white/20 font-bold text-zinc-100">
                            <td className="py-3 uppercase tracking-wider">Total Period</td>
                            <td className="py-3 text-right font-mono text-emerald-400">
                              {formatMoney(cashFlowReport.totalCashIn)}
                            </td>
                            <td className="py-3 text-right font-mono text-red-400">
                              {formatMoney(cashFlowReport.totalCashOut)}
                            </td>
                            <td
                              className={`py-3 text-right font-mono ${
                                cashFlowReport.netCashFlow >= 0 ? "text-emerald-400" : "text-red-400"
                              }`}
                            >
                              {cashFlowReport.netCashFlow >= 0 ? "+" : ""}
                              {formatMoney(cashFlowReport.netCashFlow)}
                            </td>
                            <td className="py-3 text-center">
                              <span className="text-[10px] text-zinc-400 uppercase font-mono">
                                Net Position
                              </span>
                            </td>
                            <td className="py-3 text-right font-mono text-white">
                              {formatMoney(cashFlowReport.netCashFlow)}
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
        )}

        {/* ========================================================================= */}
        {/* TAB 3: VENDOR SPEND ANALYTICS                                             */}
        {/* ========================================================================= */}
        {activeTab === "vendor_spend" && (
          <div className="space-y-6">
            {/* EDUCATIONAL BANNER */}
            <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
              <svg className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h5 className="text-xs font-bold uppercase tracking-wider text-purple-400">
                  What is Vendor Spend Analytics?
                </h5>
                <p className="text-xs text-purple-200/80 mt-1 leading-relaxed">
                  Messy bank statements often scatter expenses under cryptic names (e.g., store numbers, POS prefixes). 
                  This report normalizes payees into clean vendor entities, ranks your highest outflows, and calculates <strong className="text-purple-200 font-semibold">supplier concentration risk</strong>. 
                  It helps you negotiate vendor contracts, eliminate duplicate subscriptions, and see exactly who you pay the most.
                </p>
              </div>
            </div>

            {isVendorLoading && !vendorSpendReport ? (
              <div className="py-16 flex items-center justify-center text-zinc-400 flex-col">
                <LoadingSpinner size="lg" color="text-purple-400" className="mb-3" />
                <p className="text-sm">Aggregating vendor spend and payee concentration...</p>
              </div>
            ) : vendorSpendReport ? (
              <div className="space-y-6">
                {/* 4 SUMMARY METRIC CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Total Outflow Analyzed
                    </span>
                    <p className="text-2xl font-black text-purple-400 mt-1">
                      {formatMoney(vendorSpendReport.totalSpend)}
                    </p>
                    <span className="text-[10px] text-zinc-500">Across all business expenses</span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Unique Payees / Vendors
                    </span>
                    <p className="text-2xl font-black text-white mt-1">
                      {vendorSpendReport.totalVendors}
                    </p>
                    <span className="text-[10px] text-zinc-500">Distinct suppliers identified</span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                        Top 5 Concentration
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                          vendorSpendReport.top5Percent > 75
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {vendorSpendReport.top5Percent > 75 ? "High Risk" : "Balanced"}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-amber-300 mt-1">
                      {vendorSpendReport.top5Percent.toFixed(1)}%
                    </p>
                    <span className="text-[10px] text-zinc-500">Of spend captured by top 5 payees</span>
                  </div>

                  <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300">
                      #1 Top Payee
                    </span>
                    <p className="text-base font-black text-white break-words line-clamp-2 leading-tight mt-1" title={vendorSpendReport.vendors[0]?.vendorName}>
                      {vendorSpendReport.vendors[0]?.vendorName || "None"}
                    </p>
                    <span className="text-[10px] text-purple-300/80">
                      {vendorSpendReport.vendors[0]
                        ? `${formatMoney(vendorSpendReport.vendors[0].totalSpend)} (${vendorSpendReport.vendors[0].percentOfTotal.toFixed(1)}%)`
                        : "No spend recorded"}
                    </span>
                  </div>
                </div>

                {/* VENDORS TABLE */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <div>
                      <h4 className="text-sm font-bold text-white">Vendor Ranking & Spend Distribution</h4>
                      <p className="text-xs text-zinc-400">
                        Sorted by highest total cash outflow with category allocation
                      </p>
                    </div>
                    <span className="text-xs font-mono text-zinc-500">
                      {vendorSpendReport.vendors.length} payees
                    </span>
                  </div>

                  {vendorSpendReport.vendors.length === 0 ? (
                    <div className="py-8 text-center text-zinc-400 text-sm">
                      No vendor expenses found in this date range.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-white/10 text-zinc-400 uppercase tracking-wider text-[11px] whitespace-nowrap">
                            <th className="py-2.5 px-3 font-bold w-12 text-center">Rank</th>
                            <th className="py-2.5 px-3 font-bold min-w-[170px]">Payee / Vendor</th>
                            <th className="py-2.5 px-3 font-bold min-w-[150px]">Spend Share</th>
                            <th className="py-2.5 px-3 font-bold text-right min-w-[100px]">Total Spent</th>
                            <th className="py-2.5 px-3 font-bold text-center min-w-[60px]">Txns</th>
                            <th className="py-2.5 px-3 font-bold text-right min-w-[100px]">Avg Ticket</th>
                            <th className="py-2.5 px-3 font-bold min-w-[150px]">Primary Category</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 whitespace-nowrap">
                          {vendorSpendReport.vendors.map((v, idx) => (
                            <tr key={v.vendorName} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 px-3 text-center font-mono">
                                {idx === 0 && (
                                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold inline-flex items-center justify-center text-[10px]">
                                    1
                                  </span>
                                )}
                                {idx === 1 && (
                                  <span className="w-5 h-5 rounded-full bg-zinc-400/20 text-zinc-300 font-bold inline-flex items-center justify-center text-[10px]">
                                    2
                                  </span>
                                )}
                                {idx === 2 && (
                                  <span className="w-5 h-5 rounded-full bg-amber-700/20 text-amber-600 font-bold inline-flex items-center justify-center text-[10px]">
                                    3
                                  </span>
                                )}
                                {idx > 2 && <span className="text-zinc-500">#{idx + 1}</span>}
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-white">
                                {v.vendorName}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 bg-white/10 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className="bg-purple-500 h-1.5 rounded-full"
                                      style={{ width: `${Math.min(v.percentOfTotal, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-zinc-400 w-10 text-right">
                                    {v.percentOfTotal.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                                {formatMoney(v.totalSpend)}
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono text-zinc-400">
                                {v.transactionCount}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-zinc-300">
                                {formatMoney(v.averageSpend)}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-medium border border-white/5">
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
        )}

        {/* ========================================================================= */}
        {/* TAB 4: ACCOUNTS RECEIVABLE (A/R) AGING                                     */}
        {/* ========================================================================= */}
        {activeTab === "ar_aging" && (
          <div className="space-y-6">
            {/* EDUCATIONAL BANNER */}
            <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md print:hidden">
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
            <div className="flex flex-wrap items-end justify-between gap-4 bg-black/20 p-4 rounded-xl border border-white/5 print:hidden">
              <div className="flex items-end gap-3 flex-1 min-w-[220px]">
                <div className="w-48">
                  <Input
                    id="ar-as-of-date"
                    name="asOfDate"
                    type="date"
                    label="Aging As Of Date"
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                  />
                </div>
                <Button variant="secondary" onClick={() => loadARAging(asOfDate)} isLoading={isARLoading}>
                  Recalculate Aging
                </Button>
              </div>

              {arAgingReport && (
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={exportARAgingCSV} title="Export A/R Aging to CSV">
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export CSV
                  </Button>
                  <Button variant="secondary" onClick={handlePrint} title="Print or Save PDF">
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print
                  </Button>
                </div>
              )}
            </div>

            {isARLoading && !arAgingReport ? (
              <div className="py-16 flex items-center justify-center text-zinc-400 flex-col">
                <LoadingSpinner size="lg" color="text-rose-400" className="mb-3" />
                <p className="text-sm">Calculating A/R aging buckets and invoice statuses...</p>
              </div>
            ) : arAgingReport ? (
              <div className="space-y-6">
                {/* 4 SUMMARY METRIC CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Total Receivables
                    </span>
                    <p className="text-2xl font-black text-white mt-1">
                      {formatMoney(arAgingReport.totalReceivables)}
                    </p>
                    <span className="text-[10px] text-zinc-500">Uncollected invoice balance</span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Current (Not Due Yet)
                    </span>
                    <p className="text-2xl font-black text-emerald-400 mt-1">
                      {formatMoney(arAgingReport.totalCurrent)}
                    </p>
                    <span className="text-[10px] text-zinc-500">Within payment terms</span>
                  </div>

                  <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-rose-300">
                        Total Overdue
                      </span>
                      {arAgingReport.totalOverdue > 0 && (
                        <span className="text-[10px] bg-rose-500/30 text-rose-200 px-1.5 py-0.2 rounded font-bold">
                          Action Needed
                        </span>
                      )}
                    </div>
                    <p className="text-2xl font-black text-rose-300 mt-1">
                      {formatMoney(arAgingReport.totalOverdue)}
                    </p>
                    <span className="text-[10px] text-rose-400/80">Past contractual due date</span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Open Invoices
                    </span>
                    <p className="text-2xl font-black text-zinc-200 mt-1">
                      {arAgingReport.invoiceCount}
                    </p>
                    <span className="text-[10px] text-zinc-500">
                      Across {(arAgingReport.clients || []).length} clients
                    </span>
                  </div>
                </div>

                {/* 5 AGING BUCKETS GRID */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                    Aging Distribution Buckets (As of {formatReportDate(arAgingReport.asOfDate)})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
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
                          className={`p-3 rounded-xl border transition-all ${
                            hasBalance && isPastDue
                              ? "bg-rose-950/20 border-rose-500/30 text-rose-200"
                              : hasBalance
                              ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-200"
                              : "bg-black/30 border-white/5 text-zinc-400"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5 min-h-[2rem]">
                            <span className="text-[10px] font-bold uppercase tracking-wider leading-tight text-white/90" title={b.bucketName}>
                              {b.bucketName}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/10 shrink-0">
                              {b.count}
                            </span>
                          </div>
                          <p
                            className={`text-lg font-black mt-1 font-mono ${
                              hasBalance && isPastDue
                                ? "text-rose-400"
                                : hasBalance
                                ? "text-emerald-400"
                                : "text-zinc-500"
                            }`}
                          >
                            {formatMoney(b.totalAmount)}
                          </p>
                          <div className="flex items-center justify-between text-[10px] mt-1 text-zinc-400">
                            <span>Share</span>
                            <span className="font-mono font-semibold">{share.toFixed(1)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* INVOICES DETAIL TABLE */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <div>
                      <h4 className="text-sm font-bold text-white">Outstanding Invoices Ledger</h4>
                      <p className="text-xs text-zinc-400">
                        Detailed invoice status, due dates, and days overdue
                      </p>
                    </div>
                    <span className="text-xs font-mono text-zinc-500">
                      {allARInvoices.length} open invoices
                    </span>
                  </div>

                  {allARInvoices.length === 0 ? (
                    <div className="py-8 text-center text-zinc-400 text-sm">
                      No unpaid invoices found! All invoices are fully collected.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-white/10 text-zinc-400 uppercase tracking-wider text-[11px]">
                            <th className="py-2.5 font-bold">Invoice #</th>
                            <th className="py-2.5 font-bold">Customer / Client</th>
                            <th className="py-2.5 font-bold">Issue Date</th>
                            <th className="py-2.5 font-bold">Due Date</th>
                            <th className="py-2.5 font-bold text-center">Overdue Status</th>
                            <th className="py-2.5 font-bold">Aging Bucket</th>
                            <th className="py-2.5 font-bold text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {allARInvoices.map((inv) => {
                            const isOverdue = inv.daysOverdue > 0;
                            return (
                              <tr key={inv.id} className="hover:bg-white/5 transition-colors">
                                <td className="py-2.5 font-mono font-bold text-white">
                                  {inv.invoiceNumber}
                                </td>
                                <td className="py-2.5 font-semibold text-zinc-200">
                                  {inv.clientName}
                                </td>
                                <td className="py-2.5 text-zinc-400">
                                  {formatReportDate(inv.issueDate)}
                                </td>
                                <td className="py-2.5 text-zinc-400">
                                  {formatReportDate(inv.dueDate)}
                                </td>
                                <td className="py-2.5 text-center">
                                  {isOverdue ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                      ⚠️ {inv.daysOverdue}d overdue
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      ✓ Current
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5">
                                  <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-medium border border-white/5">
                                    {inv.bucketName}
                                  </span>
                                </td>
                                <td className="py-2.5 text-right font-mono font-bold text-white">
                                  {formatMoney(inv.totalAmount)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-white/20 font-bold text-zinc-100">
                            <td colSpan={6} className="py-3 uppercase tracking-wider text-right pr-4">
                              Total Outstanding:
                            </td>
                            <td className="py-3 text-right font-mono text-white text-sm">
                              {formatMoney(arAgingReport.totalReceivables)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {/* CLIENT CONCENTRATION BREAKDOWN */}
                {(arAgingReport.clients || []).length > 0 && (
                  <div className="bg-black/40 border border-white/5 rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <div>
                        <h4 className="text-sm font-bold text-white">Client Receivables Concentration</h4>
                        <p className="text-xs text-zinc-400">
                          Summary of outstanding and overdue balances grouped by client
                        </p>
                      </div>
                      <span className="text-xs font-mono text-zinc-500">
                        {(arAgingReport.clients || []).length} clients
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-white/10 text-zinc-400 uppercase tracking-wider text-[11px]">
                            <th className="py-2.5 font-bold">Client Name</th>
                            <th className="py-2.5 font-bold text-center">Open Invoices</th>
                            <th className="py-2.5 font-bold text-right">Current</th>
                            <th className="py-2.5 font-bold text-right">Overdue</th>
                            <th className="py-2.5 font-bold text-right">Total Outstanding</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {(arAgingReport.clients || []).map((c) => (
                            <tr key={c.clientName} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 font-semibold text-white">{c.clientName}</td>
                              <td className="py-2.5 text-center font-mono text-zinc-300">
                                {c.invoiceCount}
                              </td>
                              <td className="py-2.5 text-right font-mono text-emerald-400">
                                {formatMoney(c.currentAmount)}
                              </td>
                              <td
                                className={`py-2.5 text-right font-mono font-bold ${
                                  c.overdueAmount > 0 ? "text-rose-400" : "text-zinc-500"
                                }`}
                              >
                                {formatMoney(c.overdueAmount)}
                              </td>
                              <td className="py-2.5 text-right font-mono font-bold text-white">
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
          <div className="space-y-6">
            {/* ACTION TOOLBAR & EXPORTS */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-black/20 p-4 rounded-xl border border-white/5 print:hidden">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  Form 1040 Schedule C — Profit or Loss From Business
                </h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Tax year {taxYear} • Single-entry ledger mapped directly to IRS tax schedule lines.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="primary"
                  onClick={handleDownloadTaxPack}
                  className="bg-amber-500 hover:bg-amber-400 text-black font-bold shadow-lg shadow-amber-500/20"
                  title="Download bundled ZIP of Schedule C CSV, Transaction Register, and Categorized Receipts"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  1-Click CPA Tax Pack (.zip)
                </Button>

                {scheduleCReport && (
                  <>
                    <Button variant="secondary" onClick={exportScheduleCCSV} title="Export Schedule C CSV">
                      <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export CSV
                    </Button>
                    <Button variant="secondary" onClick={handlePrint} title="Print or Save PDF">
                      <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      Print
                    </Button>
                  </>
                )}
              </div>
            </div>

            {isTaxLoading && !scheduleCReport ? (
              <div className="py-16 flex items-center justify-center text-zinc-400 flex-col">
                <LoadingSpinner size="lg" color="text-amber-500" className="mb-3" />
                <p className="text-sm">Compiling IRS Form 1040 Schedule C...</p>
              </div>
            ) : scheduleCReport ? (
              <div className="space-y-6">
                {/* 4 SUMMARY METRIC CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Gross Income (Line 7)
                    </span>
                    <p className="text-2xl font-black text-emerald-400 mt-1">
                      {formatMoney(scheduleCReport.grossIncome)}
                    </p>
                    <span className="text-[10px] text-zinc-500">Gross receipts & revenues</span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Total Expenses (Line 28)
                    </span>
                    <p className="text-2xl font-black text-red-400 mt-1">
                      {formatMoney(scheduleCReport.totalExpensesDeductible)}
                    </p>
                    <span className="text-[10px] text-zinc-500">
                      Gross: {formatMoney(scheduleCReport.totalExpensesGross)}
                    </span>
                  </div>

                  <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Net Profit / Loss (Line 31)
                    </span>
                    <p
                      className={`text-2xl font-black mt-1 ${
                        scheduleCReport.netProfitOrLoss >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {formatMoney(scheduleCReport.netProfitOrLoss)}
                    </p>
                    <span className="text-[10px] text-zinc-500">Taxable business income</span>
                  </div>

                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                        Meals 50% IRS Limit
                      </span>
                      <span className="text-[10px] bg-amber-500/30 text-amber-200 px-1.5 py-0.2 rounded font-bold">
                        Line 24b
                      </span>
                    </div>
                    <p className="text-2xl font-black text-amber-300 mt-1">
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
                  <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex items-start gap-3 backdrop-blur-md">
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
                      <h5 className="text-sm font-bold text-amber-300">Uncategorized Items in Suspense</h5>
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
                          className="mt-2 text-xs font-semibold px-3 py-1 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          Resolve Uncategorized in Ledger →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* SCHEDULE C DETAILED BREAKDOWN */}
                <div className="bg-black/40 border border-white/5 rounded-xl p-6 space-y-6">
                  {/* PART I: INCOME */}
                  <div>
                    <div className="border-b border-white/10 pb-2 mb-3 flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Part I: Income
                      </h4>
                      <span className="text-xs font-mono text-zinc-500">IRS Form 1040 Line 1–7</span>
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
                      <span className="text-xs font-mono text-zinc-500">IRS Form 1040 Line 8–27a</span>
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
                                    <span className="block text-[10px] text-zinc-500">
                                      Gross: {formatMoney(l.grossAmount)}
                                    </span>
                                  )}
                                </div>
                                <span className="text-zinc-500 text-xs">
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
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}
