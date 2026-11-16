import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ReviewModal from "@/components/ReviewModal";
import {
  computeDaysRemaining,
  computeTargetReopenDate,
  getBannerConfig,
  getErrorMessage,
  isItemDateClosed,
  resolveAllocationIssue,
  upsertReviewRow,
  type ReviewRow,
} from "@/components/review/reviewHelpers";
import type { BankTransaction, ChartAccount, Expense, Invoice } from "@/types/models";
import * as api from "@/services/api";

const liveListeners: Array<{ events: string[]; cb: () => void }> = [];

vi.mock("@/utils/useLiveSync", () => ({
  useLiveEvent: (events: string[], cb: () => void) => {
    liveListeners.push({ events, cb });
  },
}));

vi.mock("@/services/api", () => ({
  getReviewQueue: vi.fn(),
  getReviewQueueCounts: vi.fn(),
  resolveReviewItems: vi.fn(),
  restoreItems: vi.fn(),
  getFlaggedItems: vi.fn(),
  deleteItemsBulk: vi.fn(),
  restoreDeletedItems: vi.fn(),
  moveDeletedToExcluded: vi.fn(),
  deleteItemsPermanent: vi.fn(),
  getChartAccounts: vi.fn(),
  batchCategorizeItems: vi.fn(),
}));

vi.mock("@/components/DetailDrawer", () => ({
  default: ({
    type,
    id,
    onClose,
  }: {
    type: string | null;
    id: number | null;
    onClose: () => void;
  }) =>
    type && id != null ? (
      <div data-testid="mock-detail-drawer">
        <span>Drawer {type}:{id}</span>
        <button type="button" onClick={onClose}>
          Close Drawer
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ExcludeItemModal", () => ({
  default: ({
    isOpen,
    onClose,
    targets,
    onExcluded,
  }: {
    isOpen: boolean;
    onClose: () => void;
    targets?: Array<{ type: string; id: number }>;
    onExcluded: () => void;
  }) =>
    isOpen ? (
      <div data-testid="mock-exclude-modal">
        <span>Excluding {targets?.length ?? 0} targets</span>
        <button type="button" onClick={onExcluded}>
          Confirm Mock Exclude
        </button>
        <button type="button" onClick={onClose}>
          Cancel Mock Exclude
        </button>
      </div>
    ) : null,
}));

const mockedApi = vi.mocked(api);

const BANK_ACC: ChartAccount = {
  id: 10,
  code: "1010",
  name: "Business Checking",
  type: "ASSET",
  description: "",
  active: true,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

const ARCHIVED_BANK_ACC: ChartAccount = {
  id: 11,
  code: "1020",
  name: "Old Savings",
  type: "ASSET",
  description: "",
  active: false,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

const EXPENSE_CAT: ChartAccount = {
  id: 50,
  code: "5010",
  name: "Software & SaaS",
  type: "EXPENSE",
  description: "",
  active: true,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

const ARCHIVED_CAT: ChartAccount = {
  id: 51,
  code: "5099",
  name: "Legacy Fees",
  type: "EXPENSE",
  description: "",
  active: false,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

function makeTx(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: 1,
    isManual: false,
    chartAccountId: 10,
    chartAccount: BANK_ACC,
    categoryAccountId: 50,
    category: EXPENSE_CAT,
    date: "2025-03-10",
    description: "AWS Cloud Hosting",
    amount: -125.5,
    transactionType: "DEBIT",
    fitId: "fit-1",
    allocationStatus: "UNLINKED",
    reviewStatus: "PENDING",
    ...overrides,
  };
}

function makeExp(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 101,
    isManual: true,
    timestamp: "2025-03-12",
    vendor: "Staples",
    description: "Printer paper",
    amount: 42.25,
    taxAmount: 0,
    currencyCode: "USD",
    tender: "Card",
    chartAccountId: 50,
    chartAccount: EXPENSE_CAT,
    allocationStatus: "PARTIAL",
    reviewStatus: "PENDING",
    createdAt: "2025-03-12T00:00:00Z",
    updatedAt: "2025-03-12T00:00:00Z",
    ...overrides,
  };
}

describe("reviewHelpers", () => {
  it("extracts readable error messages and normalizes allocation issues", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom");
    expect(getErrorMessage({ message: "api problem" }, "fallback")).toBe("api problem");
    expect(getErrorMessage({ message: "   " }, "fallback")).toBe("fallback");
    expect(getErrorMessage("raw string", "fallback")).toBe("fallback");

    expect(resolveAllocationIssue("PARTIAL")).toBe("UNDER_ALLOCATED");
    expect(resolveAllocationIssue(undefined, "PARTIALLY_ALLOCATED")).toBe("UNDER_ALLOCATED");
    expect(resolveAllocationIssue("OVER_ALLOCATED")).toBe("OVER_ALLOCATED");
    expect(resolveAllocationIssue("UNLINKED")).toBe("UNLINKED");
  });

  it("computes deleted retention days, banner copy, target reopen date, and row deduplication", () => {
    const now = new Date("2025-04-15T12:00:00Z").getTime();
    expect(computeDaysRemaining(undefined, now)).toBe(30);
    expect(computeDaysRemaining("not-a-date", now)).toBe(30);
    expect(computeDaysRemaining("2025-04-05T12:00:00Z", now)).toBe(20);
    expect(computeDaysRemaining("2025-01-01T12:00:00Z", now)).toBe(0);

    expect(getBannerConfig("PENDING").title).toMatch(/Action Required/i);
    expect(getBannerConfig("IGNORED").title).toMatch(/Excluded/i);
    expect(getBannerConfig("WARNINGS_IGNORED").title).toMatch(/Warnings Ignored/i);
    expect(getBannerConfig("DELETED").title).toMatch(/Deleted Retention/i);

    const closedOld: ReviewRow = {
      key: "transaction-1",
      type: "transaction",
      id: 1,
      title: "Old",
      subtitle: "DEBIT",
      date: "2025-03-01T12:00:00Z",
      amount: -10,
      reason: "",
      note: "",
      issues: ["CLOSED_PERIOD"],
      hasSuggestions: false,
      isLocked: true,
    };
    const closedNew: ReviewRow = { ...closedOld, id: 2, key: "transaction-2", date: "2025-03-10" };
    const openOlder: ReviewRow = {
      ...closedOld,
      id: 3,
      key: "transaction-3",
      date: "2025-02-15",
      issues: ["UNLINKED"],
    };
    expect(computeTargetReopenDate([openOlder])).toBeNull();
    expect(computeTargetReopenDate([closedNew, closedOld, openOlder])).toBe("2025-02-28");

    const map = new Map<string, ReviewRow>();
    upsertReviewRow(map, "2025-03-05", {
      type: "transaction",
      id: 10,
      title: "Item",
      subtitle: "DEBIT",
      date: "2025-03-04",
      amount: -50,
      reason: "",
      note: "",
      issue: "CLOSED_PERIOD",
      hasSuggestions: false,
    });
    upsertReviewRow(map, "2025-03-05", {
      type: "transaction",
      id: 10,
      title: "Item",
      subtitle: "DEBIT",
      date: "2025-03-04",
      amount: -50,
      reason: "",
      note: "",
      issue: "UNLINKED",
      hasSuggestions: true,
      extra: {
        bankAccount: BANK_ACC,
        categoryAccount: EXPENSE_CAT,
        deletedAt: "2025-04-01",
        daysRemaining: 16,
      },
    });
    const merged = map.get("transaction-10")!;
    expect(merged.issues).toEqual(["CLOSED_PERIOD", "UNLINKED"]);
    expect(merged.hasSuggestions).toBe(true);
    expect(merged.bankAccountId).toBe(10);
    expect(merged.categoryAccountId).toBe(50);
    expect(merged.daysRemaining).toBe(16);
  });
});

describe("ReviewModal", () => {
  const refreshData = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    liveListeners.length = 0;

    mockedApi.getChartAccounts.mockResolvedValue([BANK_ACC, ARCHIVED_BANK_ACC, EXPENSE_CAT, ARCHIVED_CAT]);
    mockedApi.getReviewQueueCounts.mockResolvedValue({
      pending: 3,
      excluded: 2,
      warningsIgnored: 1,
      deleted: 1,
    });
    mockedApi.getReviewQueue.mockResolvedValue({
      status: "ok",
      booksClosedDate: "2025-03-05",
      transactions: [
        makeTx({ id: 1, date: "2025-03-01", description: "February Closed Tx", amount: -88, suggestedExpenseId: 9 }),
      ],
      expenses: [
        makeExp({ id: 101, timestamp: "2025-03-04", vendor: "Closed Vendor", amount: 55 }),
      ],
    });
    mockedApi.getFlaggedItems.mockResolvedValue({
      transactions: [
        makeTx({
          id: 2,
          date: "2025-03-14",
          description: "Stripe Payout",
          transactionType: "CREDIT",
          amount: 450,
          allocationStatus: "UNLINKED",
          categoryAccountId: undefined,
          category: undefined,
        }),
      ],
      expenses: [
        makeExp({
          id: 102,
          timestamp: "2025-03-15",
          vendor: "Delta Air",
          description: "Flight",
          amount: 310.25,
          allocationStatus: "OVER_ALLOCATED",
          bankTransactions: [makeTx({ id: 99, chartAccountId: 11, chartAccount: ARCHIVED_BANK_ACC })],
        }),
      ],
    });
  });

  async function renderOpenModal(statusType: api.ReviewStatusType = "PENDING") {
    render(
      <ReviewModal isOpen onClose={onClose} statusType={statusType} refreshData={refreshData} />
    );
    await waitFor(() => {
      expect(screen.queryByText(/Loading review items/i)).not.toBeInTheDocument();
    });
  }

  it("loads pending closed-period & flagged items, normalizes status badges, and toggles banner details", async () => {
    const user = userEvent.setup();
    await renderOpenModal("PENDING");

    expect(screen.getByText("February Closed Tx")).toBeInTheDocument();
    expect(screen.getByText(/Closed Vendor – Printer paper/)).toBeInTheDocument();
    expect(screen.getByText("Stripe Payout")).toBeInTheDocument();
    expect(screen.getByText("+$450.00")).toBeInTheDocument();
    expect(screen.getByText("SUGGESTED LINK")).toBeInTheDocument();
    expect(screen.getByText("OVER-ALLOCATED")).toBeInTheDocument();
    expect(screen.getByText(/\(Archived\)/)).toBeInTheDocument();
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();

    const bannerBtn = screen.getByRole("button", { name: /About Action Required Items/i });
    expect(bannerBtn).toHaveAttribute("aria-expanded", "false");
    await user.click(bannerBtn);
    expect(bannerBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/These items have not yet been approved/i)).toBeInTheDocument();

    // Live SSE event reloads tab counts when open
    expect(liveListeners.length).toBeGreaterThan(0);
    liveListeners[0].cb();
    expect(mockedApi.getReviewQueueCounts).toHaveBeenCalledTimes(2);
  });

  it("filters by search/amount, item type, issue, bank account, category, sort, and resets filters", async () => {
    const user = userEvent.setup();
    await renderOpenModal("PENDING");

    // Search exact amount matches Stripe Payout ($450.00)
    const searchInput = screen.getByPlaceholderText(/Search description, vendor/i);
    await user.type(searchInput, "$450.00");
    expect(screen.getByText("Stripe Payout")).toBeInTheDocument();
    expect(screen.queryByText("February Closed Tx")).not.toBeInTheDocument();
    await user.clear(searchInput);

    await user.click(screen.getByRole("button", { name: /Sort & Filter/i }));
    await user.click(screen.getByRole("button", { name: "Item Type" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Expenses" }));
    expect(screen.queryByText("February Closed Tx")).not.toBeInTheDocument();
    expect(screen.getByText(/Delta Air/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Issue / Status" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Over-Allocated" }));
    expect(screen.getByText(/Delta Air/)).toBeInTheDocument();
    expect(screen.queryByText(/Closed Vendor/)).not.toBeInTheDocument();

    // Reset to default
    await user.click(screen.getByRole("button", { name: /Reset to default/i }));
    expect(screen.getByText("February Closed Tx")).toBeInTheDocument();

    // Sort amount_desc
    await user.click(screen.getByRole("button", { name: "Sort By" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Amount: high to low" }));
    const rowTitles = screen.getAllByText(/Stripe Payout|Delta Air|February Closed Tx|Closed Vendor/).map((n) => n.textContent);
    expect(rowTitles[0]).toBe("Stripe Payout");

    // Sort date_asc & amount_asc & bank account filter
    await user.click(screen.getByRole("button", { name: "Sort By" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Oldest first" }));
    await user.click(screen.getByRole("button", { name: "Sort By" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Amount: low to high" }));
    await user.click(screen.getByRole("button", { name: "Bank Account" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: /1010/ }));

    // Category filter: Uncategorized
    await user.click(screen.getByRole("button", { name: "Category" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Uncategorized" }));
    expect(screen.getByText("Stripe Payout")).toBeInTheDocument();
    expect(screen.queryByText(/Delta Air/)).not.toBeInTheDocument();
  });

  it("supports batch categorization, detail drawer navigation, allow reopen modal, ignore warnings, exclude modal, and soft delete", async () => {
    const user = userEvent.setup();
    mockedApi.batchCategorizeItems.mockResolvedValue({ status: "ok", count: 1, message: "Categorized 1 item" });
    mockedApi.resolveReviewItems.mockResolvedValue({
      status: "ok",
      rolledBack: true,
      booksClosedDate: "2025-02-28",
      autoApproved: 2,
    });
    mockedApi.deleteItemsBulk.mockResolvedValue({ status: "ok", deletedCount: 1, affected: [] });

    await renderOpenModal("PENDING");

    // Select Stripe Payout (unlinked) + February Closed Tx (closed) -> shows mixed warning message
    await user.click(screen.getByLabelText("Select February Closed Tx"));
    await user.click(screen.getByLabelText("Select Stripe Payout"));
    expect(screen.getByText(/Selection contains both closed-period items and unlinked\/open items/i)).toBeInTheDocument();

    // Keyboard 'c' clears selection
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByText(/0 selected/i)).toBeInTheDocument();

    // Re-select single closed-period item -> Allow Selected shows reopen date 2025-02-28
    await user.click(screen.getByLabelText("Select February Closed Tx"));
    expect(screen.getByText(/Warnings cannot be silenced on closed-period items/i)).toBeInTheDocument();

    // Open in Drawer
    await user.click(screen.getByRole("button", { name: "Open in Drawer" }));
    expect(screen.getByTestId("mock-detail-drawer")).toHaveTextContent("Drawer transaction:1");
    await user.click(screen.getByRole("button", { name: "Close Drawer" }));

    // Batch categorize via searchable Select
    await user.click(screen.getByRole("button", { name: /Bulk category/i }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: /5010.*Software/ }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(mockedApi.batchCategorizeItems).toHaveBeenCalledWith([1], [], 50, []);
    expect(await screen.findByRole("status")).toHaveTextContent("Categorized 1 item");

    // Allow Selected -> modal confirmation
    await user.click(screen.getByRole("button", { name: /Allow Selected \(1\)/i }));
    expect(screen.getByText("2025-02-28")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Confirm & Reopen Books/i }));
    expect(mockedApi.resolveReviewItems).toHaveBeenCalledWith("allow", [1], [], []);
    expect(await screen.findByRole("status")).toHaveTextContent(
      /reopened back to 2025-02-28.*2 subsequent pending item\(s\)/i
    );

    // Keyboard 'w' triggers ignore warnings when non-closed item selected
    fireEvent.keyDown(window, { key: "c" });
    await user.click(screen.getByLabelText("Select Stripe Payout"));
    fireEvent.keyDown(window, { key: "w" });
    await waitFor(() => {
      expect(mockedApi.resolveReviewItems).toHaveBeenCalledWith("ignore_warnings", [2], [], []);
    });

    // Keyboard 'x' opens Exclude modal
    fireEvent.keyDown(window, { key: "x" });
    expect(screen.getByTestId("mock-exclude-modal")).toHaveTextContent("Excluding 1 targets");
    await user.click(screen.getByRole("button", { name: "Confirm Mock Exclude" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Excluded 1 item(s) from the books.");

    // Delete Selected -> confirmation modal -> soft delete
    await user.click(screen.getByRole("button", { name: /Delete Selected/i }));
    const deleteDialog = screen.getByRole("dialog", { name: /Move Items to Deleted Items/i });
    await user.click(within(deleteDialog).getByRole("button", { name: /Delete Selected/i }));
    expect(mockedApi.deleteItemsBulk).toHaveBeenCalledWith([{ type: "transaction", id: 2 }]);
    expect(await screen.findByRole("status")).toHaveTextContent(/Deleted Items \(kept for 30 days\)/i);

    // Escape closes main ReviewModal when no nested modal/drawer is open
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("handles IGNORED, WARNINGS_IGNORED, and DELETED tab flows cleanly", async () => {
    const user = userEvent.setup();
    mockedApi.resolveReviewItems.mockResolvedValue({ status: "ok" });
    mockedApi.restoreItems.mockResolvedValue({
      status: "ok",
      affected: [{ type: "transaction", id: 12, label: "Open Excluded", date: "2025-03-20", amount: -125.5, reviewStatus: "ALLOWED" }],
    });
    mockedApi.restoreDeletedItems.mockResolvedValue({ status: "ok", restoredCount: 1, affected: [] });
    mockedApi.moveDeletedToExcluded.mockResolvedValue({ status: "ok", movedCount: 1, affected: [] });
    mockedApi.deleteItemsPermanent.mockResolvedValue({ status: "ok", deletedCount: 1 });

    mockedApi.getReviewQueue.mockImplementation(async (tab) => {
      if (tab === "IGNORED") {
        return {
          status: "ok",
          booksClosedDate: "2025-03-05",
          transactions: [
            makeTx({ id: 11, date: "2025-03-01", description: "Locked Excluded", exclusionReason: "DUPLICATE", exclusionNote: "Dup import" }),
            makeTx({ id: 12, date: "2025-03-20", description: "Open Excluded", exclusionReason: "PERSONAL" }),
          ],
          expenses: [],
        };
      }
      if (tab === "WARNINGS_IGNORED") {
        return {
          status: "ok",
          booksClosedDate: "2025-03-05",
          transactions: [makeTx({ id: 21, date: "2025-03-18", description: "Silenced Bank Tx", allocationStatus: "PARTIAL" })],
          expenses: [makeExp({ id: 201, timestamp: "2025-03-19", vendor: "Silenced Vendor", allocationStatus: "UNLINKED" })],
        };
      }
      if (tab === "DELETED") {
        return {
          status: "ok",
          booksClosedDate: "2025-03-05",
          transactions: [
            makeTx({ id: 31, date: "2025-03-22", description: "Soft Deleted Tx", deletedAt: "2025-04-01T00:00:00Z" }),
          ],
          expenses: [
            makeExp({ id: 301, vendor: "Soft Deleted Exp", deletedAt: "2025-04-05T00:00:00Z" }),
          ],
        };
      }
      return { status: "ok", transactions: [], expenses: [] };
    });
    mockedApi.getFlaggedItems.mockResolvedValue({ transactions: [], expenses: [] });

    await renderOpenModal("PENDING");
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();

    // IGNORED tab
    await user.click(screen.getByRole("tab", { name: /Excluded Items/i }));
    expect(await screen.findByText("Locked Excluded")).toBeInTheDocument();
    expect(screen.getByText(/Dup import/)).toBeInTheDocument();
    expect(screen.getByText("LOCKED PERIOD")).toBeInTheDocument();

    // Direct click on row card opens DetailDrawer
    await user.click(screen.getByRole("button", { name: /Locked Excluded/i }));
    expect(screen.getByTestId("mock-detail-drawer")).toHaveTextContent("Drawer transaction:11");
    await user.click(screen.getByRole("button", { name: "Close Drawer" }));

    // Filter by LOCKED / DUPLICATE / OPEN on IGNORED tab
    await user.click(screen.getByRole("button", { name: /Sort & Filter/i }));
    await user.click(screen.getByRole("button", { name: "Issue / Status" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Locked period" }));
    expect(screen.queryByText("Open Excluded")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Issue / Status" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Open period" }));
    expect(screen.getByText("Open Excluded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Issue / Status" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Duplicate entry" }));
    expect(screen.getByText("Locked Excluded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reset to default/i }));

    await user.click(screen.getByLabelText("Select Locked Excluded"));
    await user.click(screen.getByLabelText("Select Open Excluded"));
    expect(screen.getByText(/both locked-period and open-period items/i)).toBeInTheDocument();

    // Deselect Open -> Send locked item to Review Queue
    await user.click(screen.getByLabelText("Select Open Excluded"));
    await user.click(screen.getByRole("button", { name: "Send to Review Queue" }));
    expect(mockedApi.resolveReviewItems).toHaveBeenCalledWith("pending", [11], [], []);

    // Switch selection to Open Excluded -> Restore Selected
    await user.click(screen.getByLabelText("Select Locked Excluded"));
    await user.click(screen.getByLabelText("Select Open Excluded"));
    await user.click(screen.getByRole("button", { name: /Restore Selected/i }));
    expect(mockedApi.restoreItems).toHaveBeenCalledWith([{ type: "transaction", id: 12 }]);

    // WARNINGS_IGNORED tab
    await user.click(screen.getByRole("tab", { name: /Warnings Ignored/i }));
    expect(await screen.findByText("Silenced Bank Tx")).toBeInTheDocument();
    expect(screen.getByText("UNDER-ALLOCATED")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Select Silenced Bank Tx"));
    await user.click(screen.getByRole("button", { name: "Restore Warnings" }));
    expect(mockedApi.resolveReviewItems).toHaveBeenCalledWith("restore_warnings", [21], [], []);

    // DELETED tab
    await user.click(screen.getByRole("tab", { name: /Deleted Items/i }));
    expect(await screen.findByText("Soft Deleted Tx")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Select Soft Deleted Tx"));

    // Move to Excluded requires note for OTHER
    await user.click(screen.getByRole("button", { name: /Move to Excluded/i }));
    const moveDialog = screen.getByRole("dialog", { name: /Move to Excluded Items/i });
    await user.click(within(moveDialog).getByRole("button", { name: "Reason (required)" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Other" }));
    const submitMoveBtn = within(moveDialog).getByRole("button", { name: /Move to Excluded/i });
    expect(submitMoveBtn).toBeDisabled();
    await user.type(within(moveDialog).getByLabelText(/Note/i), "Personal card charge");
    await user.click(submitMoveBtn);
    expect(mockedApi.moveDeletedToExcluded).toHaveBeenCalledWith(
      [{ type: "transaction", id: 31 }],
      "OTHER",
      "Personal card charge"
    );

    // Permanent delete & restore deleted
    await user.click(screen.getByRole("button", { name: /Delete Permanently/i }));
    const permDialog = screen.getByRole("dialog", { name: /Permanently Delete Items/i });
    await user.click(within(permDialog).getByRole("button", { name: /Permanently Delete/i }));
    expect(mockedApi.deleteItemsPermanent).toHaveBeenCalledWith([{ type: "transaction", id: 31 }]);

    await user.click(screen.getByRole("button", { name: /Restore Selected/i }));
    expect(mockedApi.restoreDeletedItems).toHaveBeenCalledWith([{ type: "transaction", id: 31 }]);
  });

  it("handles pagination, select-all across pages, and API errors", async () => {
    const user = userEvent.setup();
    const manyTxs = Array.from({ length: 17 }, (_, i) =>
      makeTx({ id: i + 1, description: `Batch Item ${i + 1}`, date: `2025-03-${String(28 - i).padStart(2, "0")}` })
    );
    mockedApi.getReviewQueue.mockResolvedValue({
      status: "ok",
      booksClosedDate: "2025-03-31",
      transactions: manyTxs,
      expenses: [],
    });
    mockedApi.getFlaggedItems.mockRejectedValue(new Error("Flagged timeout"));
    mockedApi.resolveReviewItems.mockRejectedValue(new Error("Server rejected update"));

    await renderOpenModal("PENDING");

    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load flagged items: Flagged timeout");
    expect(screen.getByText(/15 on page \(17 total\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select all 17" }));
    expect(screen.getByText(/17 selected/i)).toBeInTheDocument();

    // Trigger page 2
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Batch Item 16")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Allow Selected \(17\)/i }));
    await user.click(screen.getByRole("button", { name: /Confirm & Reopen Books/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server rejected update");
    await user.click(within(screen.getByRole("dialog", { name: /Reopen Books to Allow Items/i })).getByRole("button", { name: "Cancel" }));

    // Page-level select-all toggle & Clear selection + action error paths
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText(/0 selected/i)).toBeInTheDocument();
    const pageSelectAll = screen.getByRole("checkbox", { name: /2 on page/i });
    await user.click(pageSelectAll);
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    mockedApi.batchCategorizeItems.mockRejectedValue(new Error("Bulk cat error"));
    await user.click(screen.getByRole("button", { name: /Bulk category/i }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: /5010/ }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bulk cat error");

    mockedApi.deleteItemsBulk.mockRejectedValue(new Error("Soft delete error"));
    await user.click(screen.getByRole("button", { name: /Delete Selected/i }));
    const deleteDialog = screen.getByRole("dialog", { name: /Move Items to Deleted Items/i });
    await user.click(within(deleteDialog).getByRole("button", { name: /Delete Selected/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Soft delete error");
  });

  it("renders and manages invoices across Review Queue tabs, handles badges, filtering, and bulk operations", async () => {
    const user = userEvent.setup();

    const sampleInvoices: Invoice[] = [
      {
        id: 101,
        invoiceNumber: "INV-2026-001",
        clientName: "Acme Corp",
        clientEmail: "acme@example.com",
        clientAddress: "123 Main St",
        issueDate: "2026-11-01T00:00:00Z",
        dueDate: "2026-11-15T00:00:00Z",
        items: "[]",
        subtotal: 1000,
        taxRate: 0,
        taxAmount: 0,
        totalAmount: 1000,
        balanceDue: 1000,
        notes: "Net 30 terms",
        paymentTerms: "Net 30",
        status: "OVERDUE",
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
        reviewStatus: "APPROVED",
      },
      {
        id: 102,
        invoiceNumber: "INV-2026-002",
        clientName: "Beta LLC",
        clientEmail: "beta@example.com",
        clientAddress: "456 Oak St",
        issueDate: "2026-11-10T00:00:00Z",
        dueDate: "2026-12-10T00:00:00Z",
        items: "[]",
        subtotal: 500,
        taxRate: 0,
        taxAmount: 0,
        totalAmount: 500,
        balanceDue: 500,
        notes: "Due in 30 days",
        paymentTerms: "Net 30",
        status: "SENT",
        createdAt: "2026-11-10T00:00:00Z",
        updatedAt: "2026-11-10T00:00:00Z",
        reviewStatus: "APPROVED",
      },
    ];

    mockedApi.getReviewQueue.mockResolvedValue({
      status: "success",
      transactions: [],
      expenses: [],
      invoices: sampleInvoices,
      booksClosedDate: "2025-01-01",
    });

    await renderOpenModal("PENDING");

    // Invoices should render with Invoice tag, title, and badges
    expect(await screen.findByText(/INV-2026-001 – Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText(/INV-2026-002 – Beta LLC/)).toBeInTheDocument();

    const invoiceTags = screen.getAllByText("Invoice");
    expect(invoiceTags.length).toBe(2);

    expect(screen.getByText("OVERDUE")).toBeInTheDocument();
    expect(screen.getByText("UNPAID")).toBeInTheDocument();

    // Verify positive receivable amount formatting
    expect(screen.getByText("+$1,000.00")).toBeInTheDocument();
    expect(screen.getByText("+$500.00")).toBeInTheDocument();

    // Filter by Item Type -> Invoices
    await user.click(screen.getByRole("button", { name: /Sort & Filter/i }));
    await user.click(screen.getByRole("button", { name: "Item Type" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Invoices" }));
    expect(screen.getByText(/INV-2026-001 – Acme Corp/)).toBeInTheDocument();

    // Filter by Issue -> Overdue Invoices
    await user.click(screen.getByRole("button", { name: "Issue / Status" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Overdue Invoices" }));
    expect(screen.getByText(/INV-2026-001 – Acme Corp/)).toBeInTheDocument();
    expect(screen.queryByText(/INV-2026-002 – Beta LLC/)).not.toBeInTheDocument();

    // Reset filters
    await user.click(screen.getByRole("button", { name: /Reset to default/i }));
    expect(screen.getByText(/INV-2026-002 – Beta LLC/)).toBeInTheDocument();

    // Select invoice and open drawer
    await user.click(screen.getByLabelText("Select INV-2026-001 – Acme Corp"));
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open in Drawer" }));
    expect(screen.getByTestId("mock-detail-drawer")).toHaveTextContent("Drawer invoice:101");
    await user.click(screen.getByRole("button", { name: "Close Drawer" }));

    // Bulk categorize invoice
    await user.click(screen.getByRole("button", { name: /Bulk category/i }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: /5010.*Software/ }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(mockedApi.batchCategorizeItems).toHaveBeenCalledWith([], [], 50, [101]);

    // Soft delete invoice
    await user.click(screen.getByRole("button", { name: /Delete Selected \(1\)/i }));
    const deleteDialog = screen.getByRole("dialog", { name: /Move Items to Deleted Items/i });
    await user.click(within(deleteDialog).getByRole("button", { name: /Delete Selected/i }));
    expect(mockedApi.deleteItemsBulk).toHaveBeenCalledWith([{ type: "invoice", id: 101 }]);
  });

  it("does not label open-period PENDING missing-data expenses as CLOSED PERIOD", async () => {
    expect(isItemDateClosed("2025-03-05", "2025-03-05T12:00:00Z")).toBe(true);
    expect(isItemDateClosed("2025-03-05", "2025-03-06T00:00:00Z")).toBe(false);
    expect(isItemDateClosed("", "2025-03-05")).toBe(false);

    mockedApi.getReviewQueue.mockResolvedValue({
      status: "success",
      booksClosedDate: "2025-03-05",
      transactions: [],
      expenses: [
        makeExp({
          id: 777,
          timestamp: "2025-03-15",
          vendor: "Receipt 777",
          description: "[MISSING AMOUNT - AI could not read receipt total]",
          amount: 0,
          reviewStatus: "PENDING",
          allocationStatus: "UNLINKED",
        }),
      ],
      invoices: [],
    });
    mockedApi.getFlaggedItems.mockResolvedValue({ transactions: [], expenses: [] });

    await renderOpenModal("PENDING");
    expect(screen.getByText(/Receipt 777/)).toBeInTheDocument();
    expect(screen.queryByText("CLOSED PERIOD")).not.toBeInTheDocument();
    expect(screen.getByText("UNLINKED")).toBeInTheDocument();
  });
});
