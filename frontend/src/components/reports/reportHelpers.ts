import type {
  ARAgingReport,
  CashFlowReport,
  ProfitLossReport,
  ScheduleCReport,
  VendorSpendReport,
} from "../../types/models";
import { formatDateMMDDYYYY, toLocalISODate } from "../../utils/dateUtils";
import { formatFixedDollars } from "../../utils/formatCurrency";

export type ReportPreset = "this_month" | "last_month" | "ytd" | "full_year";

/** Computes YYYY-MM-DD bounds for quick date-range presets using local calendar dates. */
export function computePresetRange(preset: ReportPreset, now: Date = new Date()): { start: string; end: string } {
  if (preset === "this_month") {
    return {
      start: toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: toLocalISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  if (preset === "last_month") {
    return {
      start: toLocalISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  if (preset === "ytd") {
    return {
      start: toLocalISODate(new Date(now.getFullYear(), 0, 1)),
      end: toLocalISODate(now),
    };
  }
  return {
    start: toLocalISODate(new Date(now.getFullYear(), 0, 1)),
    end: toLocalISODate(new Date(now.getFullYear(), 11, 31)),
  };
}

/** Formats a YYYY-MM period key as a short readable month/year label (e.g., "Mar 2025"). */
export function formatMonthLabel(period: string): string {
  if (!period) return "";
  const parts = period.split("-");
  if (parts.length === 2) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    if (!Number.isNaN(year) && !Number.isNaN(month)) {
      const date = new Date(year, month, 1);
      return date.toLocaleString("en-US", { month: "short", year: "numeric" });
    }
  }
  return period;
}

/** Escapes CSV formula triggers (=, +, -, @, tab, CR) and quotes cell values safely. */
export function sanitizeCSV(val: string | number): string {
  let str = String(val ?? "");
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/** Downloads a 2D array of already-sanitized CSV rows as a UTF-8 BOM CSV file. */
export function downloadCSVFile(rows: string[][], filename: string): void {
  const csvContent = "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Exports the Profit & Loss statement to CSV. */
export function exportProfitLossCSV(report: ProfitLossReport): void {
  const rows: string[][] = [
    [sanitizeCSV("PROFIT & LOSS STATEMENT")],
    [sanitizeCSV(`Period: ${formatDateMMDDYYYY(report.startDate)} to ${formatDateMMDDYYYY(report.endDate)}`)],
    [sanitizeCSV(`Generated: ${new Date().toLocaleDateString()}`)],
    [],
    [sanitizeCSV("TYPE"), sanitizeCSV("ACCOUNT CODE"), sanitizeCSV("ACCOUNT NAME"), sanitizeCSV("AMOUNT")],
    [sanitizeCSV("REVENUE"), "", "", ""],
  ];

  report.revenue.forEach((r) => {
    rows.push([
      sanitizeCSV("Revenue"),
      sanitizeCSV(r.accountCode),
      sanitizeCSV(r.accountName),
      sanitizeCSV(formatFixedDollars(r.total)),
    ]);
  });
  rows.push([sanitizeCSV("Total Revenue"), "", "", sanitizeCSV(formatFixedDollars(report.totalRevenue))]);
  rows.push([]);

  rows.push([sanitizeCSV("OPERATING EXPENSES"), "", "", ""]);
  report.expenses.forEach((e) => {
    rows.push([
      sanitizeCSV("Expense"),
      sanitizeCSV(e.accountCode),
      sanitizeCSV(e.accountName),
      sanitizeCSV(formatFixedDollars(e.total)),
    ]);
  });
  rows.push([
    sanitizeCSV("Total Operating Expenses"),
    "",
    "",
    sanitizeCSV(formatFixedDollars(report.totalExpenses)),
  ]);
  rows.push([]);

  rows.push([sanitizeCSV("NET INCOME"), "", "", sanitizeCSV(formatFixedDollars(report.netIncome))]);
  if (report.netMarginPercent !== undefined) {
    rows.push([sanitizeCSV("Net Profit Margin"), "", "", sanitizeCSV(`${report.netMarginPercent.toFixed(1)}%`)]);
  }
  if (report.totalTax && report.totalTax > 0) {
    rows.push([sanitizeCSV("Sales Tax Paid (Receipts)"), "", "", sanitizeCSV(formatFixedDollars(report.totalTax))]);
  }

  downloadCSVFile(rows, `profit_loss_${report.startDate}_to_${report.endDate}.csv`);
}

/** Exports the Cash Flow statement to CSV. */
export function exportCashFlowCSV(report: CashFlowReport): void {
  const rows: string[][] = [
    [sanitizeCSV("CASH FLOW SUMMARY STATEMENT")],
    [sanitizeCSV(`Period: ${formatDateMMDDYYYY(report.startDate)} to ${formatDateMMDDYYYY(report.endDate)}`)],
    [sanitizeCSV(`Generated: ${new Date().toLocaleDateString()}`)],
    [],
    [sanitizeCSV("SUMMARY METRICS"), sanitizeCSV("AMOUNT")],
    [sanitizeCSV("Total Cash Inflow (Deposits)"), sanitizeCSV(formatFixedDollars(report.totalCashIn))],
    [sanitizeCSV("Total Cash Outflow (Disbursements)"), sanitizeCSV(formatFixedDollars(report.totalCashOut))],
    [sanitizeCSV("Net Cash Flow"), sanitizeCSV(formatFixedDollars(report.netCashFlow))],
    [sanitizeCSV("Savings / Cash Retention Rate"), sanitizeCSV(`${report.savingsRatePercent.toFixed(1)}%`)],
    [sanitizeCSV("Average Monthly Inflow"), sanitizeCSV(formatFixedDollars(report.avgMonthlyInflow))],
    [sanitizeCSV("Average Monthly Outflow"), sanitizeCSV(formatFixedDollars(report.avgMonthlyOutflow))],
    [],
    [
      sanitizeCSV("PERIOD (MONTH)"),
      sanitizeCSV("CASH INFLOW"),
      sanitizeCSV("CASH OUTFLOW"),
      sanitizeCSV("NET CASH FLOW"),
      sanitizeCSV("RUNNING POSITION"),
    ],
  ];

  report.periods.forEach((p) => {
    rows.push([
      sanitizeCSV(p.period),
      sanitizeCSV(formatFixedDollars(p.cashIn)),
      sanitizeCSV(formatFixedDollars(p.cashOut)),
      sanitizeCSV(formatFixedDollars(p.netCashFlow)),
      sanitizeCSV(formatFixedDollars(p.runningCashTotal)),
    ]);
  });

  downloadCSVFile(rows, `Cash_Flow_${report.startDate}_to_${report.endDate}.csv`);
}

/** Exports the Vendor Spend & 1099-NEC analytics report to CSV. */
export function exportVendorSpendCSV(report: VendorSpendReport): void {
  const rows: string[][] = [
    [sanitizeCSV("VENDOR SPEND & PAYEE ANALYTICS REPORT")],
    [sanitizeCSV(`Period: ${formatDateMMDDYYYY(report.startDate)} to ${formatDateMMDDYYYY(report.endDate)}`)],
    [sanitizeCSV(`Generated: ${new Date().toLocaleDateString()}`)],
    [],
    [sanitizeCSV("SUMMARY METRICS"), sanitizeCSV("VALUE")],
    [sanitizeCSV("Total Outflow Analyzed"), sanitizeCSV(formatFixedDollars(report.totalSpend))],
    [sanitizeCSV("Unique Payees / Vendors"), sanitizeCSV(report.totalVendors.toString())],
    [sanitizeCSV("Top 5 Payee Concentration"), sanitizeCSV(`${report.top5Percent.toFixed(1)}%`)],
    [sanitizeCSV("Contractors >= $600 (1099-NEC)"), sanitizeCSV((report.contractorsOver600 || 0).toString())],
    [sanitizeCSV("Total 1099-NEC Spend"), sanitizeCSV(formatFixedDollars(report.total1099Spend || 0))],
    [],
    [
      sanitizeCSV("RANK"),
      sanitizeCSV("VENDOR / PAYEE"),
      sanitizeCSV("TOTAL SPEND"),
      sanitizeCSV("% OF TOTAL"),
      sanitizeCSV("TRANSACTIONS"),
      sanitizeCSV("AVG TICKET"),
      sanitizeCSV("PRIMARY CATEGORY"),
      sanitizeCSV("1099-NEC REQUIRED"),
    ],
  ];

  report.vendors.forEach((v, idx) => {
    rows.push([
      sanitizeCSV((idx + 1).toString()),
      sanitizeCSV(v.vendorName),
      sanitizeCSV(formatFixedDollars(v.totalSpend)),
      sanitizeCSV(`${v.percentOfTotal.toFixed(1)}%`),
      sanitizeCSV(v.transactionCount.toString()),
      sanitizeCSV(formatFixedDollars(v.averageSpend)),
      sanitizeCSV(v.primaryCategoryName || "Uncategorized"),
      sanitizeCSV(v.requires1099 ? "YES (>= $600)" : "NO"),
    ]);
  });

  downloadCSVFile(rows, `Vendor_Spend_${report.startDate}_to_${report.endDate}.csv`);
}

/** Exports the Accounts Receivable Aging report to CSV. */
export function exportARAgingCSV(report: ARAgingReport): void {
  const rows: string[][] = [
    [sanitizeCSV("ACCOUNTS RECEIVABLE (A/R) AGING SUMMARY")],
    [sanitizeCSV(`As Of Date: ${formatDateMMDDYYYY(report.asOfDate)}`)],
    [sanitizeCSV(`Generated: ${new Date().toLocaleDateString()}`)],
    [],
    [sanitizeCSV("SUMMARY METRICS"), sanitizeCSV("VALUE")],
    [sanitizeCSV("Total Outstanding Receivables"), sanitizeCSV(formatFixedDollars(report.totalReceivables))],
    [sanitizeCSV("Current (Not Due Yet)"), sanitizeCSV(formatFixedDollars(report.totalCurrent))],
    [sanitizeCSV("Total Overdue"), sanitizeCSV(formatFixedDollars(report.totalOverdue))],
    [sanitizeCSV("Total Open Invoices"), sanitizeCSV(report.invoiceCount.toString())],
    [sanitizeCSV(`Days Sales Outstanding (DSO, ${report.salesDays}-day window)`), sanitizeCSV(report.dsoDays.toFixed(1))],
    [
      sanitizeCSV("Delinquency Rate (Overdue / Total Receivables)"),
      sanitizeCSV(`${report.delinquencyRate.toFixed(1)}%`),
    ],
    [
      sanitizeCSV(`Credit Sales (Trailing ${report.salesDays} Days, DSO Denominator)`),
      sanitizeCSV(formatFixedDollars(report.creditSales)),
    ],
    [],
    [sanitizeCSV("AGING BUCKETS SUMMARY"), sanitizeCSV("AMOUNT"), sanitizeCSV("INVOICES COUNT"), sanitizeCSV("% OF TOTAL")],
  ];

  report.buckets.forEach((b) => {
    const share = report.totalReceivables > 0 ? (b.totalAmount / report.totalReceivables) * 100 : 0;
    rows.push([
      sanitizeCSV(b.bucketName),
      sanitizeCSV(formatFixedDollars(b.totalAmount)),
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
    sanitizeCSV("STATUS"),
    sanitizeCSV("DAYS OVERDUE"),
    sanitizeCSV("AGING BUCKET"),
    sanitizeCSV("INVOICED (FACE)"),
    sanitizeCSV("PAID TO DATE"),
    sanitizeCSV("BALANCE DUE"),
  ]);

  const allInvoices = report.buckets.flatMap((b) =>
    (b.invoices || []).map((inv) => ({ ...inv, bucketName: b.bucketName }))
  );

  allInvoices.forEach((inv) => {
    rows.push([
      sanitizeCSV(inv.invoiceNumber),
      sanitizeCSV(inv.clientName),
      sanitizeCSV(formatDateMMDDYYYY(inv.issueDate)),
      sanitizeCSV(formatDateMMDDYYYY(inv.dueDate)),
      sanitizeCSV(inv.status),
      sanitizeCSV(inv.daysOverdue > 0 ? `${inv.daysOverdue} days` : "Current (0)"),
      sanitizeCSV(inv.bucketName),
      sanitizeCSV(formatFixedDollars(inv.totalAmount)),
      sanitizeCSV(formatFixedDollars(inv.amountPaid)),
      sanitizeCSV(formatFixedDollars(inv.balanceDue)),
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

  (report.clients || []).forEach((c) => {
    rows.push([
      sanitizeCSV(c.clientName),
      sanitizeCSV(formatFixedDollars(c.totalOutstanding)),
      sanitizeCSV(formatFixedDollars(c.currentAmount)),
      sanitizeCSV(formatFixedDollars(c.overdueAmount)),
      sanitizeCSV(c.invoiceCount.toString()),
    ]);
  });

  downloadCSVFile(rows, `AR_Aging_Report_${report.asOfDate}.csv`);
}

/** Exports the IRS Form 1040 Schedule C report to CSV. */
export function exportScheduleCCSV(report: ScheduleCReport): void {
  const rows: string[][] = [
    [sanitizeCSV("IRS FORM 1040 SCHEDULE C - PROFIT OR LOSS FROM BUSINESS")],
    [
      sanitizeCSV(
        `Tax Year: ${report.year} (${formatDateMMDDYYYY(report.startDate)} to ${formatDateMMDDYYYY(report.endDate)})`
      ),
    ],
    [sanitizeCSV(`Generated: ${new Date().toLocaleDateString()}`)],
    [],
    [sanitizeCSV("PART I: INCOME"), sanitizeCSV("LINE"), sanitizeCSV("AMOUNT")],
    [sanitizeCSV("Gross receipts or sales"), sanitizeCSV("Line 1"), sanitizeCSV(formatFixedDollars(report.grossReceipts))],
    [
      sanitizeCSV("Returns and allowances"),
      sanitizeCSV("Line 2"),
      sanitizeCSV(formatFixedDollars(report.returnsAndAllowances)),
    ],
    [sanitizeCSV("Net receipts"), sanitizeCSV("Line 3"), sanitizeCSV(formatFixedDollars(report.netReceipts))],
    [sanitizeCSV("Cost of goods sold"), sanitizeCSV("Line 4"), sanitizeCSV(formatFixedDollars(report.costOfGoodsSold))],
    [sanitizeCSV("Gross profit"), sanitizeCSV("Line 5"), sanitizeCSV(formatFixedDollars(report.grossProfit))],
    [sanitizeCSV("Other income"), sanitizeCSV("Line 6"), sanitizeCSV(formatFixedDollars(report.otherIncome))],
    [sanitizeCSV("Gross income"), sanitizeCSV("Line 7"), sanitizeCSV(formatFixedDollars(report.grossIncome))],
    [],
    [
      sanitizeCSV("PART II: EXPENSES"),
      sanitizeCSV("LINE"),
      sanitizeCSV("GROSS SPEND"),
      sanitizeCSV("DEDUCTIBLE %"),
      sanitizeCSV("ALLOWABLE DEDUCTION"),
    ],
  ];

  report.expenseLines.forEach((l) => {
    rows.push([
      sanitizeCSV(l.lineName),
      sanitizeCSV(l.lineNumber),
      sanitizeCSV(formatFixedDollars(l.grossAmount)),
      sanitizeCSV(`${l.deductiblePercent}%`),
      sanitizeCSV(formatFixedDollars(l.deductibleAmount)),
    ]);
  });

  rows.push([]);
  rows.push([
    sanitizeCSV("TOTAL EXPENSES"),
    sanitizeCSV("Line 28"),
    sanitizeCSV(formatFixedDollars(report.totalExpensesGross)),
    "",
    sanitizeCSV(formatFixedDollars(report.totalExpensesDeductible)),
  ]);
  rows.push([
    sanitizeCSV("Nondeductible Meals (50% IRS Cap)"),
    sanitizeCSV("Line 24b"),
    sanitizeCSV(formatFixedDollars(report.nondeductibleMeals)),
    "",
    "0.00",
  ]);
  rows.push([
    sanitizeCSV("NET PROFIT OR (LOSS)"),
    sanitizeCSV("Line 31"),
    "",
    "",
    sanitizeCSV(formatFixedDollars(report.netProfitOrLoss)),
  ]);

  downloadCSVFile(rows, `Schedule_C_${report.year}_Tax_Report.csv`);
}
