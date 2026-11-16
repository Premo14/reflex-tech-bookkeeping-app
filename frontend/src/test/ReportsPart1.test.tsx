import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ReportsModal from "@/components/ReportsModal";
import {
  exportARAgingCSV,
  exportCashFlowCSV,
  exportProfitLossCSV,
  exportScheduleCCSV,
  exportVendorSpendCSV,
  formatMonthLabel,
  sanitizeCSV,
} from "@/components/reports/reportHelpers";
import type {
  ARAgingReport,
  CashFlowReport,
  ProfitLossReport,
  ScheduleCReport,
  VendorSpendReport,
} from "@/types/models";
import * as api from "@/services/api";

vi.mock("@/services/api", () => ({
  getProfitLoss: vi.fn(),
  getScheduleCReport: vi.fn(),
  getTaxPackDownloadUrl: vi.fn(() => "/api/reports/tax-pack?year=2025"),
  getCashFlowReport: vi.fn(),
  getVendorSpendReport: vi.fn(),
  getARAgingReport: vi.fn(),
  getTrialBalance: vi.fn(),
  getTrialBalanceExportUrl: vi.fn(() => "/api/reports/trial-balance/export"),
}));

const mockedApi = vi.mocked(api);

const SAMPLE_PL: ProfitLossReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  revenue: [{ accountCode: "4010", accountName: "Consulting Revenue", total: 12500.5 }],
  totalRevenue: 12500.5,
  expenses: [{ accountCode: "5010", accountName: "Cloud Hosting", total: 2400.25 }],
  totalExpenses: 2400.25,
  netIncome: 10100.25,
  netMarginPercent: 80.8,
  totalTax: 185.5,
  uncategorizedTxCount: 2,
  uncategorizedExpCount: 1,
  excludedTxCount: 1,
  excludedTxTotal: 50,
  excludedExpCount: 1,
  excludedExpTotal: 25,
};

const SAMPLE_CASH_FLOW: CashFlowReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalCashIn: 15000,
  totalCashOut: 6000,
  netCashFlow: 9000,
  avgMonthlyInflow: 5000,
  avgMonthlyOutflow: 2000,
  savingsRatePercent: 60,
  periods: [
    {
      period: "2025-01",
      periodLabel: "Jan 2025",
      cashIn: 7000,
      cashOut: 2000,
      netCashFlow: 5000,
      runningCashTotal: 5000,
      inflowCount: 3,
      outflowCount: 4,
    },
    {
      period: "2025-02",
      periodLabel: "Feb 2025",
      cashIn: 1000,
      cashOut: 2500,
      netCashFlow: -1500,
      runningCashTotal: 3500,
      inflowCount: 1,
      outflowCount: 3,
    },
  ],
};

const SAMPLE_VENDOR_SPEND: VendorSpendReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalSpend: 5400,
  totalVendors: 4,
  top5Percent: 88.5,
  contractorsOver600: 1,
  total1099Spend: 1800,
  vendors: [
    {
      vendorName: "Acme Contractor",
      totalSpend: 1800,
      transactionCount: 3,
      averageSpend: 600,
      percentOfTotal: 33.3,
      primaryCategoryCode: "5100",
      primaryCategoryName: "Contractors",
      lastDate: "2025-03-01",
      requires1099: true,
    },
    {
      vendorName: "AWS",
      totalSpend: 1400,
      transactionCount: 2,
      averageSpend: 700,
      percentOfTotal: 25.9,
      primaryCategoryCode: "5010",
      primaryCategoryName: "Cloud",
      lastDate: "2025-03-02",
    },
    {
      vendorName: "Google Workspace",
      totalSpend: 1200,
      transactionCount: 12,
      averageSpend: 100,
      percentOfTotal: 22.2,
      primaryCategoryCode: "5010",
      primaryCategoryName: "Software",
      lastDate: "2025-03-03",
    },
    {
      vendorName: "=EVIL(\"Formula\")",
      totalSpend: 1000,
      transactionCount: 1,
      averageSpend: 1000,
      percentOfTotal: 18.5,
      primaryCategoryCode: "",
      primaryCategoryName: "",
      lastDate: "2025-03-04",
    },
  ],
};

const SAMPLE_AR_AGING: ARAgingReport = {
  asOfDate: "2025-03-15",
  totalReceivables: 2500,
  totalCurrent: 1500,
  totalOverdue: 1000,
  invoiceCount: 2,
  dsoDays: 32.5,
  delinquencyRate: 40,
  creditSales: 10000,
  salesDays: 90,
  clients: [
    {
      clientName: "Wayne Enterprises",
      totalOutstanding: 2500,
      currentAmount: 1500,
      overdueAmount: 1000,
      invoiceCount: 2,
      oldestDueDate: "2025-02-14",
    },
  ],
  buckets: [
    {
      bucketName: "Current",
      totalAmount: 1500,
      count: 1,
      invoices: [
        {
          id: 1,
          invoiceNumber: "INV-1001",
          clientName: "Wayne Enterprises",
          clientEmail: "ap@wayne.test",
          issueDate: "2025-03-01",
          dueDate: "2025-03-31",
          totalAmount: 1500,
          amountPaid: 0,
          balanceDue: 1500,
          daysOverdue: 0,
          status: "SENT",
        },
      ],
    },
    {
      bucketName: "1-30 Days Past Due",
      totalAmount: 1000,
      count: 1,
      invoices: [
        {
          id: 2,
          invoiceNumber: "INV-1000",
          clientName: "Wayne Enterprises",
          clientEmail: "ap@wayne.test",
          issueDate: "2025-01-15",
          dueDate: "2025-02-14",
          totalAmount: 1000,
          amountPaid: 0,
          balanceDue: 1000,
          daysOverdue: 29,
          status: "OVERDUE",
        },
      ],
    },
  ],
};

const SAMPLE_SCHEDULE_C: ScheduleCReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  year: 2025,
  grossReceipts: 50000,
  returnsAndAllowances: 500,
  netReceipts: 49500,
  costOfGoodsSold: 2000,
  grossProfit: 47500,
  otherIncome: 0,
  grossIncome: 47500,
  incomeLines: [],
  expenseLines: [
    {
      lineNumber: "Line 18",
      lineName: "Office expense",
      grossAmount: 1200,
      deductibleAmount: 1200,
      deductiblePercent: 100,
      accounts: [{ accountId: 52, accountCode: "5200", accountName: "Office Supplies", total: 1200 }],
    },
  ],
  totalExpensesGross: 1200,
  totalExpensesDeductible: 1200,
  nondeductibleMeals: 300,
  netProfitOrLoss: 46300,
  uncategorizedExpenseAmount: 0,
  uncategorizedIncomeAmount: 0,
  uncategorizedTxCount: 0,
  uncategorizedExpCount: 0,
};

describe("reportHelpers", () => {
  it("neutralizes CSV formula prefixes, quotes safely, and formats months", () => {
    expect(sanitizeCSV("=SUM(A1)")).toBe("\"'=SUM(A1)\"");
    expect(sanitizeCSV("+1+1")).toBe("\"'+1+1\"");
    expect(sanitizeCSV("-100")).toBe("\"'-100\"");
    expect(sanitizeCSV("@cmd")).toBe("\"'@cmd\"");
    expect(sanitizeCSV("A \"quoted\" cell")).toBe("\"A \"\"quoted\"\" cell\"");

    expect(formatMonthLabel("2025-03")).toBe("Mar 2025");
    expect(formatMonthLabel("invalid")).toBe("invalid");
    expect(formatMonthLabel("")).toBe("");
  });

  it("exports P&L, Cash Flow, Vendor Spend, A/R Aging, and Schedule C CSVs with BOM and sanitized cells", async () => {
    const blobs: Blob[] = [];
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return "blob:test-csv";
    });
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      exportProfitLossCSV(SAMPLE_PL);
      exportCashFlowCSV(SAMPLE_CASH_FLOW);
      exportVendorSpendCSV(SAMPLE_VENDOR_SPEND);
      exportARAgingCSV(SAMPLE_AR_AGING);
      exportScheduleCCSV(SAMPLE_SCHEDULE_C);

      expect(blobs).toHaveLength(5);
      expect(clickSpy).toHaveBeenCalledTimes(5);

      const plCsv = await blobs[0].text();
      expect(plCsv).toContain("PROFIT & LOSS STATEMENT");
      expect(plCsv).toContain("\"12500.50\"");

      const vendorCsv = await blobs[2].text();
      expect(vendorCsv).toContain("\"'=EVIL(\"\"Formula\"\")\"");
      expect(vendorCsv).toContain("YES (>= $600)");

      const arCsv = await blobs[3].text();
      expect(arCsv).toContain("INV-1001");
      expect(arCsv).toContain("\"1500.00\"");

      const schedCsv = await blobs[4].text();
      expect(schedCsv).toContain("Line 31");
      expect(schedCsv).toContain("\"46300.00\"");
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});

describe("ReportsModal - S23A (P&L, Cash Flow, Vendor Spend)", () => {
  const onClose = vi.fn();
  const onViewUncategorized = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getProfitLoss.mockResolvedValue(SAMPLE_PL);
    mockedApi.getCashFlowReport.mockResolvedValue(SAMPLE_CASH_FLOW);
    mockedApi.getVendorSpendReport.mockResolvedValue(SAMPLE_VENDOR_SPEND);
  });

  it("renders Profit & Loss statement, handles presets, custom dates, print, CSV export, and uncategorized CTA", async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pl");
    const revokeUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <StrictMode>
        <ReportsModal
          isOpen
          onClose={onClose}
          onViewUncategorized={onViewUncategorized}
        />
      </StrictMode>
    );

    expect(await screen.findByText("Consulting Revenue")).toBeInTheDocument();
    expect(screen.getAllByText("$12,500.50")).toHaveLength(2);
    expect(screen.getByText("$10,100.25")).toBeInTheDocument();
    expect(screen.getByText("80.8%")).toBeInTheDocument();
    expect(screen.getByText("$185.50")).toBeInTheDocument();
    expect(screen.getByText(/1 Excluded Expenses \(\$25\.00\)/i)).toBeInTheDocument();

    // Quick Presets (including All Time, Open Books, Closed Books, and date range labels)
    await user.click(screen.getByRole("button", { name: "All Time" }));
    await user.click(screen.getByRole("button", { name: "Open Books" }));
    await user.click(screen.getByRole("button", { name: "Closed Books" }));
    await user.click(screen.getByRole("button", { name: "This Month" }));
    await user.click(screen.getByRole("button", { name: "Last Month" }));
    await user.click(screen.getByRole("button", { name: "Year to Date (YTD)" }));
    expect(mockedApi.getProfitLoss).toHaveBeenCalledTimes(7);

    // Custom dates + Update Report
    await user.clear(screen.getByLabelText("Start Date"));
    await user.type(screen.getByLabelText("Start Date"), "2025-02-01");
    await user.clear(screen.getByLabelText("End Date"));
    await user.type(screen.getByLabelText("End Date"), "2025-03-01");
    await user.click(screen.getByRole("button", { name: "Update Report" }));
    await waitFor(() => {
      expect(mockedApi.getProfitLoss).toHaveBeenLastCalledWith("2025-02-01", "2025-03-01");
    });

    // Export CSV & Print
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Print / PDF" }));
    expect(printSpy).toHaveBeenCalledTimes(1);

    // Filter Uncategorized CTA calls callback & closes
    await user.click(screen.getByRole("button", { name: /Filter Uncategorized in Ledger/i }));
    expect(onViewUncategorized).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    printSpy.mockRestore();
    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
    anchorClickSpy.mockRestore();
  });

  it("renders initial custom range empty P&L state when no revenue/expenses exist or fetch errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.getProfitLoss
      .mockRejectedValueOnce(new Error("DB error"))
      .mockResolvedValueOnce({
        startDate: "2025-01-01",
        endDate: "2025-01-31",
        revenue: [],
        totalRevenue: 0,
        expenses: [],
        totalExpenses: 0,
        netIncome: -100,
        netMarginPercent: -10,
        uncategorizedTxCount: 0,
        uncategorizedExpCount: 0,
        excludedTxCount: 0,
        excludedTxTotal: 0,
        excludedExpCount: 0,
        excludedExpTotal: 0,
      });

    const user = userEvent.setup();
    render(
      <ReportsModal
        isOpen
        onClose={onClose}
        initialStartDate="2025-01-01"
        initialEndDate="2025-01-31"
      />
    );

    expect(await screen.findByText(/Select dates and generate to view P&L/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update Report" }));
    expect(await screen.findByText("No revenue recorded")).toBeInTheDocument();
    expect(screen.getByText("No expenses recorded")).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("switches to Cash Flow and Vendor Spend tabs, renders analytics & 1099-NEC indicators, and handles empty states", async () => {
    const user = userEvent.setup();
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cf");
    const revokeUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ReportsModal isOpen onClose={onClose} />);
    await screen.findByText("Consulting Revenue");

    // Tab 2: Cash Flow
    await user.click(screen.getByRole("tab", { name: /Cash Flow/i }));
    expect(await screen.findByText("Monthly Cash Flow Trajectory")).toBeInTheDocument();
    expect(screen.getAllByText("$15,000.00")).toHaveLength(2);
    expect(screen.getAllByText("+$9,000.00")).toHaveLength(2);
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText(/Surplus/)).toBeInTheDocument();
    expect(screen.getByText(/Burn/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);

    // Presets work on Cash Flow tab too
    mockedApi.getCashFlowReport.mockResolvedValueOnce({
      ...SAMPLE_CASH_FLOW,
      netCashFlow: -500,
      periods: [],
    });
    await user.click(screen.getByRole("button", { name: "This Month" }));
    expect(await screen.findByText("No cash transactions recorded within this date range.")).toBeInTheDocument();

    // Tab 3: Vendor Spend
    await user.click(screen.getByRole("tab", { name: /Vendor Spend/i }));
    expect(await screen.findByText("Vendor Ranking & Spend Distribution")).toBeInTheDocument();
    const vendorDialog = screen.getByRole("dialog");
    expect(within(vendorDialog).getAllByText("Acme Contractor").length).toBeGreaterThanOrEqual(2);
    expect(within(vendorDialog).getByText("1099-NEC")).toBeInTheDocument();
    expect(within(vendorDialog).getByText("High Risk")).toBeInTheDocument();
    expect(within(vendorDialog).getByText(/1 at 1099-NEC threshold \(\$1,800\.00\)/i)).toBeInTheDocument();
    expect(within(vendorDialog).getByText("#4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(anchorClickSpy).toHaveBeenCalledTimes(2);

    mockedApi.getVendorSpendReport.mockResolvedValueOnce({
      ...SAMPLE_VENDOR_SPEND,
      totalVendors: 0,
      top5Percent: 20,
      contractorsOver600: 0,
      vendors: [],
    });
    await user.click(screen.getByRole("button", { name: "Update Report" }));
    expect(await screen.findByText("No vendor expenses found in this date range.")).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
    anchorClickSpy.mockRestore();
  });
});
