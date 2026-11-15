import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ReportsModal from "@/components/ReportsModal";
import type {
  ARAgingReport,
  CashFlowReport,
  ProfitLossReport,
  ScheduleCReport,
  TrialBalanceReport,
  VendorSpendReport,
} from "@/types/models";
import * as api from "@/services/api";

vi.mock("@/services/api", () => ({
  getProfitLoss: vi.fn(),
  getScheduleCReport: vi.fn(),
  getTaxPackDownloadUrl: vi.fn(({ year, startDate, endDate }: { year: number; startDate: string; endDate: string }) =>
    `/api/reports/tax-pack?year=${year}&start=${startDate}&end=${endDate}`
  ),
  getCashFlowReport: vi.fn(),
  getVendorSpendReport: vi.fn(),
  getARAgingReport: vi.fn(),
  getTrialBalance: vi.fn(),
  getTrialBalanceExportUrl: vi.fn(({ startDate, endDate }: { startDate: string; endDate: string }) =>
    `/api/reports/trial-balance/export?start=${startDate}&end=${endDate}`
  ),
}));

const mockedApi = vi.mocked(api);

const SAMPLE_PL: ProfitLossReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  revenue: [{ accountCode: "4010", accountName: "Consulting Revenue", total: 12000 }],
  totalRevenue: 12000,
  expenses: [{ accountCode: "5010", accountName: "Software", total: 2000 }],
  totalExpenses: 2000,
  netIncome: 10000,
  netMarginPercent: 83.3,
  totalTax: 0,
  uncategorizedTxCount: 0,
  uncategorizedExpCount: 0,
  excludedTxCount: 0,
  excludedTxTotal: 0,
  excludedExpCount: 0,
  excludedExpTotal: 0,
};

const SAMPLE_CASH_FLOW: CashFlowReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalCashIn: 12000,
  totalCashOut: 2000,
  netCashFlow: 10000,
  avgMonthlyInflow: 1000,
  avgMonthlyOutflow: 166.67,
  savingsRatePercent: 83.3,
  periods: [],
};

const SAMPLE_VENDOR_SPEND: VendorSpendReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalSpend: 2000,
  totalVendors: 1,
  top5Percent: 100,
  vendors: [],
};

const SAMPLE_AR_AGING: ARAgingReport = {
  asOfDate: "2025-06-15",
  totalReceivables: 4750,
  totalCurrent: 1250,
  totalOverdue: 3500,
  invoiceCount: 3,
  dsoDays: 68.4,
  delinquencyRate: 73.7,
  creditSales: 25000,
  salesDays: 90,
  buckets: [
    {
      bucketName: "Current (Not Due)",
      totalAmount: 1250,
      count: 1,
      invoices: [
        {
          id: 101,
          invoiceNumber: "INV-2025-01",
          clientName: "Zenith Studio",
          clientEmail: "ap@zenith.example",
          issueDate: "2025-06-01",
          dueDate: "2025-07-01",
          totalAmount: 1250,
          amountPaid: 0,
          balanceDue: 1250,
          daysOverdue: 0,
          status: "SENT",
        },
      ],
    },
    {
      bucketName: "1-30 Days Past Due",
      totalAmount: 1500,
      count: 1,
      invoices: [
        {
          id: 102,
          invoiceNumber: "INV-2025-02",
          clientName: "Apex Systems",
          clientEmail: "billing@apex.example",
          issueDate: "2025-04-25",
          dueDate: "2025-05-25",
          totalAmount: 2000,
          amountPaid: 500,
          balanceDue: 1500,
          daysOverdue: 21,
          status: "PARTIALLY_PAID",
        },
      ],
    },
    {
      bucketName: "31-60 Days Past Due",
      totalAmount: 2000,
      count: 1,
      invoices: [
        {
          id: 103,
          invoiceNumber: "INV-2025-03",
          clientName: "Northwind Co",
          clientEmail: "finance@northwind.example",
          issueDate: "2025-03-15",
          dueDate: "2025-04-15",
          totalAmount: 2000,
          amountPaid: 0,
          balanceDue: 2000,
          daysOverdue: 61,
          status: "OVERDUE",
        },
      ],
    },
    {
      bucketName: "61-90 Days Past Due",
      totalAmount: 0,
      count: 0,
      invoices: [],
    },
    {
      bucketName: "90+ Days Past Due",
      totalAmount: 0,
      count: 0,
      invoices: [],
    },
  ],
  clients: [
    {
      clientName: "Northwind Co",
      totalOutstanding: 2000,
      currentAmount: 0,
      overdueAmount: 2000,
      oldestDueDate: "2025-04-15",
      invoiceCount: 1,
    },
    {
      clientName: "Apex Systems",
      totalOutstanding: 1500,
      currentAmount: 0,
      overdueAmount: 1500,
      oldestDueDate: "2025-05-25",
      invoiceCount: 1,
    },
    {
      clientName: "Zenith Studio",
      totalOutstanding: 1250,
      currentAmount: 1250,
      overdueAmount: 0,
      oldestDueDate: "2025-07-01",
      invoiceCount: 1,
    },
  ],
};

const SAMPLE_SCHEDULE_C: ScheduleCReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  year: 2025,
  grossReceipts: 95000,
  returnsAndAllowances: 1500,
  netReceipts: 93500,
  costOfGoodsSold: 3500,
  grossProfit: 90000,
  otherIncome: 250,
  grossIncome: 90250,
  incomeLines: [],
  expenseLines: [
    {
      lineNumber: "Line 9",
      lineName: "Car and truck expenses",
      grossAmount: 1800,
      deductiblePercent: 100,
      deductibleAmount: 1800,
      accounts: [{ accountId: 51, accountCode: "5050", accountName: "Vehicle Fuel", total: 1800 }],
    },
    {
      lineNumber: "Line 24b",
      lineName: "Deductible meals",
      grossAmount: 600,
      deductiblePercent: 50,
      deductibleAmount: 300,
      accounts: [{ accountId: 52, accountCode: "5060", accountName: "Client Meals", total: 600 }],
    },
  ],
  totalExpensesGross: 2400,
  totalExpensesDeductible: 2100,
  nondeductibleMeals: 300,
  netProfitOrLoss: 88150,
  uncategorizedExpenseAmount: 420,
  uncategorizedIncomeAmount: 0,
  uncategorizedTxCount: 3,
  uncategorizedExpCount: 0,
  selfEmploymentTax: 12456.03,
  deductibleSelfEmploymentTax: 6228.02,
  estimatedIncomeTax: 12288.3,
  totalEstimatedTax: 24744.33,
  estimatedQuarterlyTax: 6186.08,
  quarterlyDeadlines: [
    { quarter: "Q1", period: "Jan 1 - Mar 31", dueDate: "Apr 15, 2025", amountDue: 6186.08, isPast: true },
    { quarter: "Q2", period: "Apr 1 - May 31", dueDate: "Jun 16, 2025", amountDue: 6186.08, isPast: false },
  ],
};

const SAMPLE_TRIAL_BALANCE: TrialBalanceReport = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  accounts: [
    {
      accountId: 1,
      accountCode: "1010",
      accountName: "Operating Checking",
      accountType: "ASSET",
      grossDebit: 12000,
      grossCredit: 2000,
      netDebit: 10000,
      netCredit: 0,
    },
    {
      accountId: 2,
      accountCode: "3000",
      accountName: "Owner Capital",
      accountType: "EQUITY",
      grossDebit: 0,
      grossCredit: 0,
      netDebit: 0,
      netCredit: 0,
    },
    {
      accountId: 3,
      accountCode: "4010",
      accountName: "Consulting Revenue",
      accountType: "REVENUE",
      grossDebit: 0,
      grossCredit: 12000,
      netDebit: 0,
      netCredit: 12000,
    },
    {
      accountId: 4,
      accountCode: "5010",
      accountName: "Software Hosting",
      accountType: "EXPENSE",
      grossDebit: 2000,
      grossCredit: 0,
      netDebit: 2000,
      netCredit: 0,
    },
  ],
  totalDebit: 12000,
  totalCredit: 12000,
  isBalanced: true,
  varianceCents: 0,
};

describe("ReportsModal Part 2 (A/R Aging, Schedule C, Trial Balance)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getProfitLoss.mockResolvedValue(SAMPLE_PL);
    mockedApi.getCashFlowReport.mockResolvedValue(SAMPLE_CASH_FLOW);
    mockedApi.getVendorSpendReport.mockResolvedValue(SAMPLE_VENDOR_SPEND);
    mockedApi.getARAgingReport.mockResolvedValue(SAMPLE_AR_AGING);
    mockedApi.getScheduleCReport.mockResolvedValue(SAMPLE_SCHEDULE_C);
    mockedApi.getTrialBalance.mockResolvedValue(SAMPLE_TRIAL_BALANCE);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders A/R Aging metrics, buckets, invoice drilldown, recalculation, and empty invoice state", async () => {
    const user = userEvent.setup();
    const onOpenInvoiceDetail = vi.fn();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-ar");
    const revokeUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    let resolveAR: (val: ARAgingReport) => void = () => {};
    mockedApi.getARAgingReport.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveAR = res;
        })
    );

    render(<ReportsModal onClose={vi.fn()} initialTab="ar_aging" onOpenInvoiceDetail={onOpenInvoiceDetail} />);

    expect(await screen.findByText("Calculating A/R aging buckets and invoice statuses...")).toBeInTheDocument();
    resolveAR(SAMPLE_AR_AGING);

    expect(await screen.findByText("Outstanding Invoices Ledger")).toBeInTheDocument();
    expect(screen.getAllByText("$4,750.00")).toHaveLength(2);
    expect(screen.getByText("Action Needed")).toBeInTheDocument();
    expect(screen.getByText("68.4 days")).toBeInTheDocument();
    expect(screen.getByText("73.7%")).toBeInTheDocument();
    expect(screen.getByText("PARTIAL")).toBeInTheDocument();
    expect(screen.getByText("61d overdue")).toBeInTheDocument();
    expect(screen.getByText("Client Receivables Concentration")).toBeInTheDocument();

    // Open invoice detail callback from View button
    const viewButtons = screen.getAllByRole("button", { name: "View" });
    await user.click(viewButtons[0]);
    expect(onOpenInvoiceDetail).toHaveBeenCalledWith(101);

    // Export CSV & Print
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(printSpy).toHaveBeenCalledTimes(1);

    // Change As-Of Date & DSO window then Recalculate
    const asOfInput = screen.getByLabelText("Aging As Of Date");
    fireEvent.change(asOfInput, { target: { value: "2025-07-15" } });
    await user.selectOptions(screen.getByLabelText("DSO Window (Days)"), "365");

    mockedApi.getARAgingReport.mockResolvedValueOnce({
      ...SAMPLE_AR_AGING,
      asOfDate: "2025-07-15",
      totalReceivables: 0,
      totalOverdue: 0,
      dsoDays: 12.5,
      delinquencyRate: 0,
      buckets: [{ bucketName: "Current (Not Due)", totalAmount: 0, count: 0, invoices: [] }],
      clients: [],
    });

    await user.click(screen.getByRole("button", { name: "Recalculate Aging" }));
    expect(mockedApi.getARAgingReport).toHaveBeenLastCalledWith({
      asOfDate: "2025-07-15",
      salesDays: 365,
    });

    expect(
      await screen.findByText("No unpaid invoices found! All invoices are fully collected.")
    ).toBeInTheDocument();

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
  });

  it("renders Schedule C lines, accordion drilldown, suspense action, Tax Pack year sync, and tax deduction calculators", async () => {
    const user = userEvent.setup();
    const onViewUncategorized = vi.fn();
    const onClose = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-sc");
    const revokeUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    let resolveTax: (val: ScheduleCReport) => void = () => {};
    mockedApi.getScheduleCReport.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveTax = res;
        })
    );

    render(
      <ReportsModal
        onClose={onClose}
        initialStartDate="2026-01-01"
        initialEndDate="2026-12-31"
        initialTab="schedule_c"
        onViewUncategorized={onViewUncategorized}
      />
    );

    expect(await screen.findByText("Compiling IRS Form 1040 Schedule C...")).toBeInTheDocument();
    resolveTax(SAMPLE_SCHEDULE_C);

    expect(await screen.findByText("Line 31 — Net Profit or (Loss)")).toBeInTheDocument();
    expect(screen.getAllByText("$90,250.00")).toHaveLength(2);
    expect(screen.getByText("50% Deductible")).toBeInTheDocument();
    expect(screen.getByText("Uncategorized Items in Suspense")).toBeInTheDocument();
    expect(screen.getByText("IRS Form 1040-ES Quarterly Estimated Taxes & Schedule SE")).toBeInTheDocument();

    // Expand Line 9 & Line 24b accordions
    const line9Btn = screen.getByRole("button", { name: /Line 9.*Car and truck expenses/i });
    expect(line9Btn).toHaveAttribute("aria-expanded", "false");
    await user.click(line9Btn);
    expect(line9Btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("5050 — Vehicle Fuel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Line 24b.*Deductible meals/i }));
    expect(screen.getByText("5060 — Client Meals")).toBeInTheDocument();

    // Solopreneur Mileage Calculator: 1000 miles at 2024 rate ($0.67 = $670 vs actual $1800 -> Actual better)
    const milesInput = screen.getByLabelText("Annual Business Miles");
    await user.type(milesInput, "1000");
    await user.selectOptions(screen.getByLabelText("Tax Rate Year"), "2024");
    expect(screen.getByText("$0.67 / mile (2024)")).toBeInTheDocument();
    expect(screen.getByText("-$1,130.00 (Actual better)")).toBeInTheDocument();

    // Increase to 5000 miles at 2026 rate ($0.70 = $3500 vs actual $1800 -> +$1,700.00 Mileage better)
    await user.selectOptions(screen.getByLabelText("Tax Rate Year"), "2026");
    await user.clear(milesInput);
    await user.type(milesInput, "5000");
    expect(screen.getByText("+$1,700.00 (Mileage better)")).toBeInTheDocument();

    // Home office simplified deduction (clamped at 300 sq ft max = $1,500.00)
    const sqFtInput = screen.getByLabelText(/Dedicated Office Area/i);
    await user.type(sqFtInput, "450");
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
    expect(screen.getByText(/Potential Additional Tax Write-Offs: \$3,200\.00/i)).toBeInTheDocument();

    // Change header Tax Year to 2024 -> Tax Pack uses 2024-01-01..2024-12-31, NOT 2026-01-01
    await user.selectOptions(screen.getByLabelText("Tax Year:"), "2024");
    await waitFor(() => {
      expect(mockedApi.getScheduleCReport).toHaveBeenLastCalledWith({
        year: 2024,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      });
    });

    await user.click(screen.getByRole("button", { name: /1-Click CPA Tax Pack/i }));
    expect(mockedApi.getTaxPackDownloadUrl).toHaveBeenCalledWith({
      year: 2024,
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });
    expect(openSpy).toHaveBeenCalledWith("/api/reports/tax-pack?year=2024&start=2024-01-01&end=2024-12-31", "_blank");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);

    // Resolve uncategorized action
    await user.click(screen.getByRole("button", { name: /Resolve Uncategorized in Ledger/i }));
    expect(onViewUncategorized).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
  });

  it("renders Trial Balance balanced/out-of-balance states, account filters, CSV export, and Update Report across tabs", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    let resolveTB: (val: TrialBalanceReport) => void = () => {};
    mockedApi.getTrialBalance.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveTB = res;
        })
    );

    render(<ReportsModal onClose={vi.fn()} initialTab="trial_balance" />);

    expect(await screen.findByText("Calculating double-entry trial balance...")).toBeInTheDocument();
    resolveTB(SAMPLE_TRIAL_BALANCE);

    expect(await screen.findByText("General Ledger is Mechanically Balanced")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Operating Checking")).toBeInTheDocument();

    // Filter pills
    await user.click(screen.getByRole("button", { name: /^EXPENSE\b/i }));
    expect(within(dialog).getByText("Software Hosting")).toBeInTheDocument();
    expect(within(dialog).queryByText("Operating Checking")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^LIABILITY\b/i }));
    expect(
      screen.getByText('No ledger activity found for account type "LIABILITY".')
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^ALL\b/i }));

    // Export Trial Balance CSV via both top toolbar and banner button
    const csvButtons = screen.getAllByRole("button", { name: "Export CSV" });
    await user.click(csvButtons[0]);
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("/api/reports/trial-balance/export"), "_blank");

    // Out-of-balance state via Update Report
    mockedApi.getTrialBalance.mockResolvedValueOnce({
      ...SAMPLE_TRIAL_BALANCE,
      totalCredit: 11987.5,
      isBalanced: false,
      varianceCents: 1250,
    });
    await user.click(screen.getByRole("button", { name: "Update Report" }));
    expect(await screen.findByText("General Ledger Out of Balance Warning")).toBeInTheDocument();
    expect(screen.getAllByText("$12.50").length).toBeGreaterThanOrEqual(2);

    // Switch through remaining tabs and test Update Report + tab switching
    await user.click(screen.getByRole("tab", { name: /Profit & Loss/i }));
    expect(await screen.findByText("Consulting Revenue")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update Report" }));

    await user.click(screen.getByRole("tab", { name: /Cash Flow/i }));
    await user.click(screen.getByRole("button", { name: "Update Report" }));

    await user.click(screen.getByRole("tab", { name: /Vendor Spend/i }));
    await user.click(screen.getByRole("button", { name: "Update Report" }));

    await user.click(screen.getByRole("tab", { name: /A\/R Aging/i }));
    await user.click(screen.getByRole("tab", { name: /Schedule C/i }));
    await user.click(screen.getByRole("tab", { name: /Trial Balance/i }));
  });

  it("handles API errors gracefully and cancels/clears reset timers on close and reopen", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    mockedApi.getProfitLoss.mockRejectedValueOnce(new Error("PL boom"));
    mockedApi.getCashFlowReport.mockRejectedValueOnce(new Error("CF boom"));
    mockedApi.getVendorSpendReport.mockRejectedValueOnce(new Error("Vendor boom"));
    mockedApi.getARAgingReport.mockRejectedValueOnce(new Error("AR boom"));
    mockedApi.getScheduleCReport.mockRejectedValueOnce(new Error("Tax boom"));
    mockedApi.getTrialBalance.mockRejectedValueOnce(new Error("TB boom"));

    const user = userEvent.setup();
    const { rerender } = render(<ReportsModal isOpen={true} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText("Select dates and generate to view P&L")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: /Cash Flow/i }));
    await user.click(screen.getByRole("tab", { name: /Vendor Spend/i }));
    await user.click(screen.getByRole("tab", { name: /A\/R Aging/i }));
    await user.click(screen.getByRole("tab", { name: /Schedule C/i }));
    await user.click(screen.getByRole("tab", { name: /Trial Balance/i }));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledTimes(6);
    });
    expect(screen.getByText("Select date range and click Update Report to generate Trial Balance.")).toBeInTheDocument();

    // Test close timer cancellation on immediate reopen & completion when staying closed
    vi.useFakeTimers();
    fireEvent.click(screen.getByLabelText("Close modal"));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<ReportsModal isOpen={false} onClose={onClose} />);
    rerender(<ReportsModal isOpen={true} onClose={onClose} initialStartDate="2025-01-01" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mockedApi.getProfitLoss).toHaveBeenLastCalledWith("2025-01-01", expect.any(String));

    fireEvent.click(screen.getByLabelText("Close modal"));
    rerender(<ReportsModal isOpen={false} onClose={onClose} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    errorSpy.mockRestore();
  });
});
