import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SuggestedMatchesList } from "@/components/SuggestedMatchesList";
import DetailDrawer from "@/components/DetailDrawer";
import { ConfirmationProvider } from "@/components/ui/ConfirmDialog";
import * as api from "@/services/api";
import type { BankTransaction, Expense } from "@/types/models";

vi.mock("@/utils/useLiveSync", () => ({
  useLiveEvent: vi.fn(),
}));

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    getChartAccounts: vi.fn(),
    getSettings: vi.fn(),
    getTransactionDetail: vi.fn(),
    getExpenseDetail: vi.fn(),
    linkExpenseToTransaction: vi.fn(),
  };
});

describe("SuggestedMatchesList", () => {
  it("renders a ranked list with counts, scores, reasons, and triggers item action", () => {
    const onApproveFirst = vi.fn();
    const onApproveSecond = vi.fn();

    render(
      <SuggestedMatchesList
        title="Suggested Expense Matches"
        showQuickApproveHint
        items={[
          {
            id: 1,
            score: 95,
            reason: "Exact amount match, Vendor match, Same day",
            title: "Staples",
            subtitle: "Oct 15, 2026 • Office Supplies",
            amountLabel: "$48.50",
            actionLabel: "Approve Link",
            onAction: onApproveFirst,
          },
          {
            id: 2,
            score: 60,
            reason: "Within $1.50, 2 days apart",
            title: "OfficeMax",
            subtitle: "Oct 17, 2026 • Uncategorized",
            amountLabel: "$50.00",
            actionLabel: "Approve Link",
            onAction: onApproveSecond,
          },
        ]}
      />
    );

    expect(screen.getByText("Suggested Expense Matches (2)")).toBeInTheDocument();
    expect(screen.getByText("95% Match")).toBeInTheDocument();
    expect(screen.getByText("60% Match")).toBeInTheDocument();
    expect(screen.getByText("Exact amount match, Vendor match, Same day")).toBeInTheDocument();
    expect(screen.getByText("Within $1.50, 2 days apart")).toBeInTheDocument();
    expect(screen.getByText(/quick-approve/i)).toBeInTheDocument();

    const approveButtons = screen.getAllByRole("button", { name: "Approve Link" });
    expect(approveButtons).toHaveLength(2);
    fireEvent.click(approveButtons[1]);
    expect(onApproveSecond).toHaveBeenCalledTimes(1);
    expect(onApproveFirst).not.toHaveBeenCalled();
  });

  it("renders emptyState when items array is empty", () => {
    render(
      <SuggestedMatchesList
        title="Suggested Bank Deposit Matches"
        items={[]}
        emptyState={<div>No candidate bank deposits found</div>}
      />
    );
    expect(screen.getByText("No candidate bank deposits found")).toBeInTheDocument();
  });
});

describe("DetailDrawer suggested match lists", () => {
  const baseAccount = {
    id: 5010,
    code: "5010",
    name: "Office Supplies",
    type: "EXPENSE",
  };

  const makeTx = (overrides: Partial<BankTransaction>): BankTransaction => ({
    id: 1,
    isManual: false,
    fitId: "fit-1",
    date: "2026-10-15T12:00:00Z",
    description: "TX",
    amount: -10,
    transactionType: "DEBIT",
    allocationStatus: "UNLINKED",
    reviewStatus: "APPROVED",
    hasSuggestions: false,
    ...overrides,
  });

  const makeExpense = (overrides: Partial<Expense>): Expense => ({
    id: 1,
    isManual: false,
    vendor: "Vendor",
    description: "Item",
    amount: 10,
    taxAmount: 0,
    currencyCode: "USD",
    tender: "card",
    timestamp: "2026-10-15T12:00:00Z",
    allocationStatus: "UNLINKED",
    reviewStatus: "APPROVED",
    hasSuggestions: false,
    createdAt: "2026-10-15T12:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getChartAccounts).mockResolvedValue([baseAccount as never]);
    vi.mocked(api.getSettings).mockResolvedValue({});
    vi.mocked(api.linkExpenseToTransaction).mockResolvedValue({ status: "success" });
  });

  it("displays a ranked list of suggested expense matches in Transaction details and links on click", async () => {
    const tx = makeTx({
      id: 101,
      fitId: "fit-101",
      description: "STAPLES #0421",
      amount: -48.5,
      hasSuggestions: true,
    });

    const exp1 = makeExpense({
      id: 201,
      vendor: "Staples",
      description: "Printer Paper",
      amount: 48.5,
      chartAccountId: 5010,
      chartAccount: baseAccount as never,
      hasSuggestions: true,
    });

    const exp2 = makeExpense({
      id: 202,
      vendor: "Staples Online",
      description: "Ink",
      amount: 50.0,
      timestamp: "2026-10-16T12:00:00Z",
    });

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: tx,
      confirmedExpenses: [],
      suggestedExpenses: [exp1, exp2],
      suggestedExpenseCandidates: [
        { expense: exp1, score: 95, reason: "Exact amount match, Vendor match, Same day" },
        { expense: exp2, score: 75, reason: "Within $1.50, Vendor match, Within 1 day" },
      ],
      linkedInvoice: null,
      suggestedInvoices: [],
    });

    render(
      <ConfirmationProvider>
        <DetailDrawer type="transaction" id={101} onClose={vi.fn()} />
      </ConfirmationProvider>
    );

    expect(await screen.findByText("Suggested Expense Matches (2)")).toBeInTheDocument();
    expect(screen.getByText("95% Match")).toBeInTheDocument();
    expect(screen.getByText("75% Match")).toBeInTheDocument();
    expect(screen.getByText("Staples Online")).toBeInTheDocument();

    const approveButtons = screen.getAllByRole("button", { name: "Approve Link" });
    fireEvent.click(approveButtons[1]);

    await waitFor(() => {
      expect(api.linkExpenseToTransaction).toHaveBeenCalledWith(202, 101, undefined, false);
    });
  });

  it("displays a ranked list of suggested transaction matches in Expense details and links on click", async () => {
    const exp = makeExpense({
      id: 301,
      vendor: "Home Depot",
      description: "Tools",
      amount: 125.0,
      chartAccountId: 5010,
      chartAccount: baseAccount as never,
      hasSuggestions: true,
    });

    const tx1 = makeTx({
      id: 401,
      fitId: "fit-401",
      description: "THE HOME DEPOT #3310",
      amount: -125.0,
      hasSuggestions: true,
    });

    const tx2 = makeTx({
      id: 402,
      fitId: "fit-402",
      date: "2026-10-17T12:00:00Z",
      description: "HOME DEPOT ONLINE",
      amount: -124.0,
    });

    vi.mocked(api.getExpenseDetail).mockResolvedValue({
      expense: exp,
      confirmedTransactions: [],
      suggestedTransactions: [tx1, tx2],
      suggestedTransactionCandidates: [
        { transaction: tx1, score: 100, reason: "Exact amount match, Vendor match, Same day" },
        { transaction: tx2, score: 85, reason: "Within $1.00, Vendor match, 2 days apart" },
      ],
    });

    render(
      <ConfirmationProvider>
        <DetailDrawer type="receipt" id={301} onClose={vi.fn()} />
      </ConfirmationProvider>
    );

    expect(await screen.findByText("Suggested Transaction Matches (2)")).toBeInTheDocument();
    expect(screen.getByText("100% Match")).toBeInTheDocument();
    expect(screen.getByText("85% Match")).toBeInTheDocument();
    expect(screen.getByText("THE HOME DEPOT #3310")).toBeInTheDocument();
    expect(screen.getByText("HOME DEPOT ONLINE")).toBeInTheDocument();

    const approveButtons = screen.getAllByRole("button", { name: "Approve Link" });
    fireEvent.click(approveButtons[0]);

    await waitFor(() => {
      expect(api.linkExpenseToTransaction).toHaveBeenCalledWith(301, 401, undefined, false);
    });
  });
});
