import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import TransactionList from "@/components/TransactionList";
import ReceiptList from "@/components/ReceiptList";
import InvoiceList from "@/components/InvoiceList";
import ReceiptThumbnailBadge from "@/components/ReceiptThumbnailBadge";
import { SuggestedMatchesList } from "@/components/SuggestedMatchesList";
import { AllocationStatusBadge } from "@/components/AllocationStatusBadge";
import {
  matchesAmountQuery,
  matchesLedgerFilter,
  normalizeAllocationStatus,
} from "@/utils/ledgerStatus";
import type {
  BankTransaction,
  ChartAccount,
  Expense,
  Invoice,
  Receipt,
} from "@/types/models";

const makeAccount = (overrides: Partial<ChartAccount> = {}): ChartAccount => ({
  id: 1,
  code: "1010",
  name: "Operating Checking",
  type: "ASSET",
  description: "",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeReceipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  id: 1,
  documentUri: "/uploads/receipt.jpg",
  fileExt: ".jpg",
  createdAt: "2026-04-01T00:00:00Z",
  ...overrides,
});

const makeTx = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  id: 1,
  isManual: false,
  fitId: "fit-1",
  date: "2026-04-01T12:00:00Z",
  description: "Transaction",
  transactionType: "DEBIT",
  amount: -10,
  reviewStatus: "",
  ...overrides,
});

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 1,
  isManual: false,
  vendor: "Vendor",
  description: "",
  amount: 10,
  taxAmount: 0,
  currencyCode: "USD",
  tender: "CARD",
  timestamp: "2026-04-01T12:00:00Z",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
  ...overrides,
});

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 1,
  invoiceNumber: "INV-1",
  clientName: "Client",
  clientEmail: "",
  clientAddress: "",
  issueDate: "2026-04-01",
  dueDate: "2026-04-30",
  items: "[]",
  subtotal: 100,
  taxRate: 0,
  taxAmount: 0,
  totalAmount: 100,
  notes: "",
  paymentTerms: "",
  status: "DRAFT",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
  ...overrides,
});

const baseChartAccount = makeAccount({ ofxAccountId: "99887766" });
const expenseAccount = makeAccount({
  id: 50,
  code: "5010",
  name: "Office Supplies",
  type: "EXPENSE",
});

describe("AllocationStatusBadge & helpers", () => {
  it("normalizes legacy and canonical statuses and matches filters & exact cents", () => {
    expect(normalizeAllocationStatus("LINKED")).toBe("BALANCED");
    expect(normalizeAllocationStatus("PARTIALLY_ALLOCATED")).toBe("PARTIAL");
    expect(normalizeAllocationStatus("PARTIAL")).toBe("PARTIAL");
    expect(normalizeAllocationStatus(undefined, undefined, true)).toBe("BALANCED");
    expect(normalizeAllocationStatus(undefined, undefined, false)).toBe("UNLINKED");

    expect(matchesLedgerFilter("ALL", "UNLINKED")).toBe(true);
    expect(matchesLedgerFilter("NEEDS_ATTENTION", "BALANCED")).toBe(false);
    expect(matchesLedgerFilter("NEEDS_ATTENTION", "UNLINKED", "WARNINGS_IGNORED")).toBe(false);
    expect(matchesLedgerFilter("NEEDS_ATTENTION", "UNLINKED")).toBe(true);
    expect(matchesLedgerFilter("BALANCED", "BALANCED")).toBe(true);
    expect(matchesLedgerFilter("PARTIAL", "PARTIAL")).toBe(true);
    expect(matchesLedgerFilter("PARTIALLY_ALLOCATED", "PARTIAL")).toBe(true);
    expect(matchesLedgerFilter("OVER_ALLOCATED", "OVER_ALLOCATED")).toBe(true);
    expect(matchesLedgerFilter("UNLINKED", "UNLINKED")).toBe(true);

    expect(matchesAmountQuery(-42.5, "$42.50")).toBe(true);
    expect(matchesAmountQuery(42.5, "42.5")).toBe(true);
    expect(matchesAmountQuery(42.5, "99.00")).toBe(false);
  });

  it("renders all status variants cleanly", () => {
    const { rerender } = render(
      <AllocationStatusBadge status="UNLINKED" hasSuggestions reviewStatus="WARNINGS_IGNORED" />
    );
    expect(screen.getByText("WARNINGS SILENCED")).toBeInTheDocument();

    rerender(<AllocationStatusBadge status="UNLINKED" hasSuggestions />);
    expect(screen.getByText("MATCH READY")).toBeInTheDocument();

    rerender(<AllocationStatusBadge status="PARTIAL" />);
    expect(screen.getByText("UNDER-ALLOCATED")).toBeInTheDocument();

    rerender(<AllocationStatusBadge status="OVER_ALLOCATED" />);
    expect(screen.getByText("OVER-ALLOCATED")).toBeInTheDocument();

    rerender(<AllocationStatusBadge status="BALANCED" />);
    expect(screen.getByText("BALANCED")).toBeInTheDocument();

    rerender(<AllocationStatusBadge status="UNLINKED" />);
    expect(screen.getByText("UNLINKED")).toBeInTheDocument();
  });
});

describe("TransactionList", () => {
  const sampleTransactions: BankTransaction[] = [
    makeTx({
      id: 1,
      isManual: true,
      fitId: "MANUAL-101",
      date: "2026-04-01T12:00:00Z",
      description: "ACH WITHDRAWAL STAPLES #1234",
      transactionType: "DEBIT",
      amount: -48.5,
      allocationStatus: "UNLINKED",
      hasSuggestions: true,
      notes: "Printer toner",
      chartAccount: baseChartAccount,
      category: expenseAccount,
    }),
    makeTx({
      id: 2,
      fitId: "fit-2",
      date: "2026-04-02T12:00:00Z",
      description: "Client Stripe Payout",
      transactionType: "CREDIT",
      amount: 1200,
      allocationStatus: "BALANCED",
      chartAccount: { ...baseChartAccount, active: false, name: "Legacy Checking" },
      expenses: [
        makeExpense({
          id: 10,
          vendor: "A",
          amount: 600,
          receipts: [makeReceipt({ id: 90, documentUri: "/uploads/doc1.jpg", fileExt: ".jpg" })],
        }),
        makeExpense({
          id: 11,
          vendor: "B",
          amount: 600,
        }),
      ],
    }),
    makeTx({
      id: 3,
      fitId: "fit-3",
      date: "2026-04-03T12:00:00Z",
      description: "Amazon Web Services",
      amount: -95.25,
      allocationStatus: "OVER_ALLOCATED",
      category: { ...expenseAccount, active: false, name: "Archived Cloud" },
    }),
    makeTx({
      id: 4,
      fitId: "fit-4",
      date: "2026-04-04T12:00:00Z",
      description: "Local Coffee Shop",
      amount: -8.75,
      allocationStatus: "PARTIAL",
    }),
    makeTx({
      id: 5,
      fitId: "fit-5",
      date: "2026-04-05T12:00:00Z",
      description: "Bank Fee Reversal",
      amount: -15,
      allocationStatus: "UNLINKED",
      reviewStatus: "WARNINGS_IGNORED",
    }),
    makeTx({
      id: 6,
      fitId: "fit-6",
      date: "2026-04-06T12:00:00Z",
      description: "Zeta Software Deposit",
      transactionType: "CREDIT",
      amount: 500,
      allocationStatus: "BALANCED",
    }),
  ];

  it("sorts problem priority first, renders badges/accounts/splits, and handles selection", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <TransactionList
        transactions={sampleTransactions}
        filter="ALL"
        searchQuery=""
        sortField="date"
        sortOrder="desc"
        onSelect={onSelect}
      />
    );

    expect(screen.getByText("MATCH READY")).toBeInTheDocument();
    expect(screen.getByText("OVER-ALLOCATED")).toBeInTheDocument();
    expect(screen.getByText("UNDER-ALLOCATED")).toBeInTheDocument();
    expect(screen.getAllByText("BALANCED")).toHaveLength(2);
    expect(screen.getByText("WARNINGS SILENCED")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Split (2 items)")).toBeInTheDocument();
    expect(screen.getAllByText("No Bank Account")).toHaveLength(4);
    expect(screen.getAllByText("Archived")).toHaveLength(2);
    expect(screen.getByText("-$48.50")).toBeInTheDocument();
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();

    await user.click(screen.getByText("Amazon Web Services"));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("supports search across notes/fitId/amount, status filters, sorting modes, and empty state", () => {
    const { rerender } = render(
      <TransactionList
        transactions={sampleTransactions}
        filter="ALL"
        searchQuery="Printer toner"
        sortField="amount"
        sortOrder="asc"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("ACH WITHDRAWAL STAPLES #1234")).toBeInTheDocument();
    expect(screen.queryByText("Amazon Web Services")).not.toBeInTheDocument();

    rerender(
      <TransactionList
        transactions={sampleTransactions}
        filter="ALL"
        searchQuery="$95.25"
        sortField="description"
        sortOrder="asc"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("Amazon Web Services")).toBeInTheDocument();

    for (const sortField of ["amount", "description", "type", "date"]) {
      rerender(
        <TransactionList
          transactions={sampleTransactions}
          filter="ALL"
          searchQuery=""
          sortField={sortField}
          sortOrder="asc"
          onSelect={vi.fn()}
        />
      );
      expect(screen.getByText("Amazon Web Services")).toBeInTheDocument();
    }

    rerender(
      <TransactionList
        transactions={sampleTransactions}
        filter="NEEDS_ATTENTION"
        searchQuery="does-not-exist"
        sortField="date"
        sortOrder="asc"
        onSelect={vi.fn()}
      />
    );
    expect(
      screen.getByText("No transactions found matching this criteria.")
    ).toBeInTheDocument();
  });
});

describe("ReceiptList", () => {
  const sampleExpenses: Expense[] = [
    makeExpense({
      id: 11,
      vendor: "Home Depot",
      description: "Drywall & paint",
      amount: 142.3,
      taxAmount: 11.38,
      tender: "CARD",
      timestamp: "2026-04-02T10:00:00Z",
      isManual: true,
      notes: "Office remodel",
      allocationStatus: "BALANCED",
      chartAccount: { ...expenseAccount, active: false },
      bankTransactions: [
        makeTx({
          id: 99,
          fitId: "fit-99",
          date: "2026-04-02T10:00:00Z",
          description: "HOME DEPOT STORE #41",
          amount: -142.3,
        }),
      ],
      receipts: [makeReceipt({ id: 501, documentUri: "/uploads/hd-receipt.png", fileExt: ".png" })],
    }),
    makeExpense({
      id: 12,
      vendor: "Local Cafe",
      amount: 12.0,
      tender: "CASH",
      timestamp: "2026-04-03T10:00:00Z",
    }),
    makeExpense({
      id: 13,
      vendor: "Staples",
      amount: 48.5,
      tender: "CARD",
      timestamp: "2026-04-04T10:00:00Z",
      allocationStatus: "UNLINKED",
      hasSuggestions: true,
    }),
  ];

  it("renders tax, archived/uncategorized badges, linked bank tx, and cash default balanced", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ReceiptList
        expenses={sampleExpenses}
        filter="ALL"
        searchQuery=""
        sortField="date"
        sortOrder="desc"
        onSelect={onSelect}
      />
    );

    expect(screen.getByText("$142.30")).toBeInTheDocument();
    expect(screen.getByText("$11.38")).toBeInTheDocument();
    expect(screen.getByText(/Linked to: HOME DEPOT STORE #41/)).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getAllByText("Uncategorized")).toHaveLength(2);
    expect(screen.getByText("MATCH READY")).toBeInTheDocument();
    expect(screen.getAllByText("No Receipt")).toHaveLength(2);

    await user.click(screen.getByText("Home Depot"));
    expect(onSelect).toHaveBeenCalledWith(11);
  });

  it("filters, searches notes/amount, sorts across fields, and renders empty state", () => {
    const { rerender } = render(
      <ReceiptList
        expenses={sampleExpenses}
        filter="ALL"
        searchQuery="Office remodel"
        sortField="amount"
        sortOrder="asc"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("Home Depot")).toBeInTheDocument();
    expect(screen.queryByText("Local Cafe")).not.toBeInTheDocument();

    rerender(
      <ReceiptList
        expenses={sampleExpenses}
        filter="BALANCED"
        searchQuery=""
        sortField="vendor"
        sortOrder="asc"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("Local Cafe")).toBeInTheDocument();

    rerender(
      <ReceiptList
        expenses={sampleExpenses}
        filter="UNLINKED"
        searchQuery="$48.50"
        sortField="tender"
        sortOrder="asc"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("Staples")).toBeInTheDocument();

    rerender(
      <ReceiptList
        expenses={[]}
        filter="ALL"
        searchQuery=""
        sortField="date"
        sortOrder="desc"
        onSelect={vi.fn()}
      />
    );
    expect(
      screen.getByText("No expenses found matching this criteria.")
    ).toBeInTheDocument();
  });
});

describe("InvoiceList", () => {
  const sampleInvoices: Invoice[] = [
    makeInvoice({
      id: 1,
      invoiceNumber: "INV-2026-001",
      clientName: "Acme Corp",
      clientEmail: "ap@acme.test",
      issueDate: "2026-03-01",
      dueDate: "2026-03-31",
      paymentTerms: "NET_30",
      status: "PAID",
      subtotal: 1500,
      totalAmount: 1500,
      amountPaid: 1500,
      balanceDue: 0,
      bankTransactionId: 44,
    }),
    makeInvoice({
      id: 2,
      invoiceNumber: "INV-2026-002",
      clientName: "Beta LLC",
      issueDate: "2026-03-10",
      dueDate: "2026-03-20",
      paymentTerms: "DUE_ON_RECEIPT",
      status: "OVERDUE",
      subtotal: 500,
      totalAmount: 500,
      amountPaid: 100,
      balanceDue: 400,
    }),
    makeInvoice({
      id: 3,
      invoiceNumber: "INV-2026-003",
      clientName: "Gamma Inc",
      issueDate: "2026-04-01",
      dueDate: "2026-04-15",
      status: "PARTIALLY_PAID",
      subtotal: 800,
      totalAmount: 800,
      amountPaid: 300,
      balanceDue: 500,
    }),
    makeInvoice({
      id: 4,
      invoiceNumber: "INV-2026-004",
      clientName: "Delta Co",
      issueDate: "2026-04-05",
      dueDate: "2026-05-05",
      status: "SENT",
      subtotal: 250,
      totalAmount: 250,
      amountPaid: 0,
      balanceDue: 250,
    }),
    makeInvoice({
      id: 5,
      invoiceNumber: "",
      clientName: "Draft Client",
      issueDate: "2026-04-06",
      dueDate: "2026-05-06",
      status: "DRAFT",
      subtotal: 100,
      totalAmount: 100,
      amountPaid: 0,
      balanceDue: 100,
    }),
  ];

  it("renders invoice badges, deposit link, balance due, search/sort, and triggers create/select", async () => {
    const onSelect = vi.fn();
    const onOpenCreate = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <InvoiceList
        invoices={sampleInvoices}
        filter="ALL"
        searchQuery=""
        sortField="amount"
        sortOrder="desc"
        onSelect={onSelect}
        onOpenCreate={onOpenCreate}
      />
    );

    expect(screen.getByText("INV-2026-001")).toBeInTheDocument();
    expect(screen.getByText("INV-5")).toBeInTheDocument();
    expect(screen.getByText("Linked to Deposit")).toBeInTheDocument();
    expect(screen.getByText("Paid in Full")).toBeInTheDocument();
    expect(screen.getByText("Due: $400.00")).toBeInTheDocument();
    expect(screen.getByText("OVERDUE")).toBeInTheDocument();
    expect(screen.getByText("PARTIALLY_PAID")).toBeInTheDocument();
    expect(screen.getByText("SENT")).toBeInTheDocument();
    expect(screen.getByText("DRAFT")).toBeInTheDocument();

    await user.click(screen.getByText("Acme Corp"));
    expect(onSelect).toHaveBeenCalledWith(1);

    for (const sortField of ["client", "date"]) {
      rerender(
        <InvoiceList
          invoices={sampleInvoices}
          filter="ALL"
          searchQuery=""
          sortField={sortField}
          sortOrder="asc"
          onSelect={onSelect}
          onOpenCreate={onOpenCreate}
        />
      );
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    }

    rerender(
      <InvoiceList
        invoices={sampleInvoices}
        filter="OVERDUE"
        searchQuery="$500.00"
        sortField="client"
        sortOrder="asc"
        onSelect={onSelect}
        onOpenCreate={onOpenCreate}
      />
    );
    expect(screen.getByText("Beta LLC")).toBeInTheDocument();
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();

    rerender(
      <InvoiceList
        invoices={sampleInvoices}
        filter="ALL"
        searchQuery="missing-client"
        sortField="date"
        sortOrder="asc"
        onSelect={onSelect}
        onOpenCreate={onOpenCreate}
      />
    );
    expect(screen.getByText("No client invoices found.")).toBeInTheDocument();
    expect(
      screen.getByText("Try adjusting your search or status filter.")
    ).toBeInTheDocument();

    rerender(
      <InvoiceList
        invoices={[]}
        filter="ALL"
        searchQuery=""
        sortField="date"
        sortOrder="asc"
        onSelect={onSelect}
        onOpenCreate={onOpenCreate}
      />
    );
    await user.click(screen.getByRole("button", { name: /Create New Invoice/i }));
    expect(onOpenCreate).toHaveBeenCalledTimes(1);
  });
});

describe("ReceiptThumbnailBadge", () => {
  const twoReceipts: Receipt[] = [
    makeReceipt({ id: 1, documentUri: "/uploads/receipt-photo.jpg", fileExt: ".jpg" }),
    makeReceipt({ id: 2, documentUri: "/uploads/invoice.pdf", fileExt: ".pdf" }),
  ];

  const origMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = origMatchMedia;
    vi.useRealTimers();
  });

  it("returns null when receipts are missing", () => {
    const { container } = render(<ReceiptThumbnailBadge receipts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("opens preview on hover, supports mobile first-tap preview, and custom onOpenReceipt callback", () => {
    vi.useFakeTimers();
    const onOpenReceipt = vi.fn();
    render(
      <ReceiptThumbnailBadge receipts={twoReceipts} onOpenReceipt={onOpenReceipt} />
    );

    const btn = screen.getByRole("button", { name: "View 2 receipts" });
    fireEvent.mouseEnter(btn.parentElement!);
    expect(screen.getByText("receipt-photo.jpg")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();

    fireEvent.mouseLeave(btn.parentElement!);
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(screen.queryByText("receipt-photo.jpg")).not.toBeInTheDocument();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(hover: none)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    fireEvent.click(btn);
    expect(screen.getByText("receipt-photo.jpg")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("receipt-photo.jpg")).not.toBeInTheDocument();

    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByText("receipt-photo.jpg")).not.toBeInTheDocument();

    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onOpenReceipt).toHaveBeenCalledTimes(1);
  });

  it("opens full lightbox dialog with focus restoration, zoom/rotate controls, arrow paging, PDF iframe & Escape", async () => {
    const user = userEvent.setup();
    render(<ReceiptThumbnailBadge receipts={twoReceipts} />);

    const trigger = screen.getByRole("button", { name: "View 2 receipts" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const closeBtn = screen.getByRole("button", { name: "Close receipt viewer" });
    await waitFor(() => expect(document.activeElement).toBe(closeBtn));

    expect(screen.getByText("100%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zoom In" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zoom Out" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rotate 90 degrees clockwise" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));

    fireEvent.keyDown(window, { key: "+" });
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "-" });
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "0" });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Attachment 2 of 2")).toBeInTheDocument();
    expect(screen.getByTitle("Receipt 2")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("Attachment 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next attachment" }));
    expect(screen.getByText("Attachment 2 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous attachment" }));
    expect(screen.getByText("Attachment 1 of 2")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("SuggestedMatchesList extra variants", () => {
  it("renders indigo accent, eyebrow, subtitleText, low-score tiers, and disabled state", () => {
    render(
      <SuggestedMatchesList
        title="Suggested Invoices"
        accent="indigo"
        subtitleText="Review candidate client invoices."
        actionDisabled
        items={[
          {
            id: 1,
            score: 35,
            eyebrow: "INV-100",
            title: "Acme",
            subtitle: "2026-04-01",
            amountLabel: "$120.00",
            actionLabel: "Link",
            onAction: vi.fn(),
          },
          {
            id: 2,
            score: 15,
            title: "Beta",
            subtitle: "2026-04-02",
            actionLabel: "Link",
            onAction: vi.fn(),
          },
        ]}
      />
    );

    expect(screen.getByText("Review candidate client invoices.")).toBeInTheDocument();
    expect(screen.getByText("INV-100")).toBeInTheDocument();
    expect(screen.getByText("35% Match")).toBeInTheDocument();
    expect(screen.getByText("15% Match")).toBeInTheDocument();
    expect(screen.getByText("$120.00")).toBeInTheDocument();
    for (const btn of screen.getAllByRole("button", { name: "Link" })) {
      expect(btn).toBeDisabled();
    }
  });
});
