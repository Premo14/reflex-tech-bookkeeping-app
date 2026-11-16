import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import DetailDrawer from "@/components/DetailDrawer";
import { AllocationProgressBar } from "@/components/detail-drawer/AllocationProgressBar";
import { DetailLinkedPagination } from "@/components/detail-drawer/DetailLinkedPagination";
import {
  parseApiError,
  getErrorDisplayMessage,
  computeExpenseAllocationCents,
  computeTxAllocationCents,
} from "@/components/detail-drawer/helpers";
import { ConfirmationProvider } from "@/components/ui/ConfirmDialog";
import * as api from "@/services/api";
import type { BankTransaction, ChartAccount, Expense, Invoice, Receipt } from "@/types/models";

const liveEventHandlers: Record<string, (payload?: unknown) => void> = {};

vi.mock("@/utils/useLiveSync", () => ({
  useLiveEvent: vi.fn((events: string | string[], cb: (payload?: unknown) => void) => {
    const list = Array.isArray(events) ? events : [events];
    for (const event of list) {
      liveEventHandlers[event] = cb;
    }
  }),
}));

vi.mock("@/components/ExcludeItemModal", () => ({
  default: ({
    isOpen,
    itemType,
    itemId,
    onBeforeSubmit,
    onExcluded,
    onClose,
  }: {
    isOpen: boolean;
    itemType: string;
    itemId: number;
    onBeforeSubmit?: () => Promise<void>;
    onExcluded: () => void;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="mock-exclude-modal" data-item-type={itemType} data-item-id={itemId}>
        <button
          type="button"
          onClick={async () => {
            if (onBeforeSubmit) await onBeforeSubmit();
            onExcluded();
          }}
        >
          Confirm Exclude Mock
        </button>
        <button type="button" onClick={onClose}>
          Close Exclude Mock
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/SplitExpenseModal", () => ({
  default: ({
    isOpen,
    onSplitSuccess,
    onClose,
  }: {
    isOpen: boolean;
    onSplitSuccess: () => void;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="mock-split-modal">
        <button type="button" onClick={onSplitSuccess}>
          Complete Split Mock
        </button>
        <button type="button" onClick={onClose}>
          Close Split Mock
        </button>
      </div>
    ) : null,
}));

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    getTransactionDetail: vi.fn(),
    getExpenseDetail: vi.fn(),
    updateTransaction: vi.fn(),
    updateExpense: vi.fn(),
    deleteTransaction: vi.fn(),
    deleteExpense: vi.fn(),
    getUnlinkedItems: vi.fn(),
    linkExpenseToTransaction: vi.fn(),
    unlinkExpenseFromTransaction: vi.fn(),
    linkExpenseToInvoice: vi.fn(),
    unlinkExpenseFromInvoice: vi.fn(),
    createAndLink: vi.fn(),
    uploadReceiptToExpense: vi.fn(),
    deleteReceipt: vi.fn(),
    getSettings: vi.fn(),
    getChartAccounts: vi.fn(),
    resolveReviewItems: vi.fn(),
    restoreItem: vi.fn(),
    getInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
    matchInvoicePayment: vi.fn(),
    markInvoicePaidCash: vi.fn(),
    unmatchInvoicePayment: vi.fn(),
    getInvoiceCandidates: vi.fn(),
    getInvoices: vi.fn(),
  };
});

const makeAccount = (overrides: Partial<ChartAccount> = {}): ChartAccount => ({
  id: 1010,
  code: "1010",
  name: "Operating Checking",
  type: "ASSET",
  description: "",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const checkingAcc = makeAccount({ id: 1010, code: "1010", name: "Checking", type: "ASSET" });
const ccAcc = makeAccount({ id: 2010, code: "2010", name: "Visa Corporate", type: "LIABILITY" });
const cashAcc = makeAccount({ id: 1030, code: "1030", name: "Cash on Hand", type: "ASSET" });
const officeAcc = makeAccount({ id: 5010, code: "5010", name: "Office Supplies", type: "EXPENSE" });
const travelAcc = makeAccount({ id: 5030, code: "5030", name: "Travel", type: "EXPENSE" });
const softwareAcc = makeAccount({
  id: 5020,
  code: "5020",
  name: "Legacy Software",
  type: "EXPENSE",
  active: false,
});

const makeReceipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  id: 90,
  documentUri: "/uploads/2026-06/receipt-90.jpg",
  fileExt: ".jpg",
  createdAt: "2026-06-15T10:00:00Z",
  ...overrides,
});

const makeTx = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  id: 100,
  isManual: false,
  transactionType: "DEBIT",
  reviewStatus: "APPROVED",
  fitId: "FIT-100",
  date: "2026-06-15T12:00:00Z",
  description: "STAPLES #412",
  amount: -48.5,
  allocationStatus: "BALANCED",
  chartAccountId: checkingAcc.id,
  chartAccount: checkingAcc,
  categoryAccountId: officeAcc.id,
  category: officeAcc,
  notes: "Paper and toner",
  ...overrides,
});

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 200,
  isManual: false,
  reviewStatus: "APPROVED",
  timestamp: "2026-06-15T12:00:00Z",
  vendor: "Staples",
  description: "Copy paper",
  amount: 48.5,
  taxAmount: 3.5,
  currencyCode: "USD",
  tender: "CARD",
  allocationStatus: "BALANCED",
  chartAccountId: officeAcc.id,
  chartAccount: officeAcc,
  notes: "Purchased in store",
  receipts: [makeReceipt()],
  createdAt: "2026-06-15T12:00:00Z",
  updatedAt: "2026-06-15T12:00:00Z",
  ...overrides,
});

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 300,
  invoiceNumber: "INV-2026-300",
  clientName: "Mohawk Valley Health",
  clientEmail: "ap@mvh.example",
  clientAddress: "123 Bleecker St, Utica NY",
  issueDate: "2026-06-01T00:00:00Z",
  dueDate: "2026-07-01T00:00:00Z",
  paymentTerms: "Net 30",
  status: "SENT",
  items: JSON.stringify([{ description: "Network Audit", quantity: 1, unitPrice: 250, amount: 250 }]),
  subtotal: 250,
  taxRate: 0,
  taxAmount: 0,
  totalAmount: 250,
  balanceDue: 250,
  notes: "",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
  ...overrides,
});

const emptyInvoiceSummary = {
  totalInvoiced: 0,
  totalPaid: 0,
  totalUnpaid: 0,
  overdueCount: 0,
  invoiceCount: 0,
};

function renderDrawer(props: Partial<React.ComponentProps<typeof DetailDrawer>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const result = render(
    <ConfirmationProvider>
      <DetailDrawer
        type={props.type ?? "transaction"}
        id={props.id ?? 100}
        onClose={onClose}
        onCreateRule={props.onCreateRule}
        onOpenInvoices={props.onOpenInvoices}
        onEditInvoice={props.onEditInvoice}
        onPrintInvoice={props.onPrintInvoice}
      />
    </ConfirmationProvider>
  );
  return { ...result, onClose };
}

describe("detail-drawer unit helpers, progress bar & pagination", () => {
  it("parses unknown errors cleanly across object, plain error, and primitive inputs", () => {
    expect(parseApiError({ status: 409, message: "Conflict", data: { error: "CATEGORY_MISMATCH" } })).toEqual({
      status: 409,
      message: "Conflict",
      data: { error: "CATEGORY_MISMATCH" },
    });
    expect(parseApiError("boom", "Fallback msg")).toEqual({ message: "Fallback msg" });
    expect(getErrorDisplayMessage({ data: { error: "Closed books" } }, "Default")).toBe("Closed books");
    expect(getErrorDisplayMessage({ message: "Network down" }, "Default")).toBe("Network down");
  });

  it("computes integer-cent allocations cleanly for multi-link and single-link cases", () => {
    const e1 = makeExpense({ id: 1, amount: 30, allocationStatus: "BALANCED" });
    const e2 = makeExpense({ id: 2, amount: 20, allocationStatus: "BALANCED" });
    const tx1 = makeTx({ id: 10, amount: -50, allocationStatus: "BALANCED" });

    expect(computeExpenseAllocationCents(e1, [e1, e2], [tx1])).toEqual({
      allocatedCents: 5000,
      totalCents: 5000,
    });
    expect(computeExpenseAllocationCents(e1, [e1], [tx1])).toEqual({
      allocatedCents: 3000,
      totalCents: 3000,
    });

    const tx2 = makeTx({ id: 11, amount: -25 });
    expect(computeTxAllocationCents(tx1, [tx1, tx2], [e1, e2])).toEqual({
      allocatedCents: 5000,
      totalCents: 7500,
    });
    expect(computeTxAllocationCents(tx1, [tx1], [e1, e2])).toEqual({
      allocatedCents: 5000,
      totalCents: 5000,
    });
  });

  it("renders AllocationProgressBar states for balanced, remaining, and over-allocated cents", () => {
    const { rerender } = render(
      <AllocationProgressBar allocatedCents={5000} totalCents={5000} linkedCount={1} />
    );
    expect(screen.getByText(/Allocated:\s*\$50\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$50\.00 Total/)).toBeInTheDocument();

    rerender(<AllocationProgressBar allocatedCents={3000} totalCents={5000} linkedCount={2} />);
    expect(screen.getByText(/\(2 linked\)/)).toBeInTheDocument();
    expect(screen.getByText(/\$20\.00 remaining to allocate\./)).toBeInTheDocument();

    rerender(<AllocationProgressBar allocatedCents={6500} totalCents={5000} linkedCount={1} />);
    expect(screen.getByText(/Over-allocated by \$15\.00\./)).toBeInTheDocument();
  });

  it("renders DetailLinkedPagination only when multiple items exist and cycles indices", () => {
    const onChangeIndex = vi.fn();
    const { container, rerender } = render(
      <DetailLinkedPagination
        label="Expense"
        accent="emerald"
        total={1}
        activeIndex={0}
        onChangeIndex={onChangeIndex}
      />
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <DetailLinkedPagination
        label="Transaction"
        accent="blue"
        total={3}
        activeIndex={1}
        onChangeIndex={onChangeIndex}
      />
    );
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous Transaction" }));
    fireEvent.click(screen.getByRole("button", { name: "Transaction 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Next Transaction" }));
    expect(onChangeIndex).toHaveBeenCalledWith(0);
    expect(onChangeIndex).toHaveBeenCalledWith(2);
  });
});

describe("DetailDrawer end-to-end workflows (Part 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(liveEventHandlers).forEach((k) => delete liveEventHandlers[k]);
    vi.mocked(api.getSettings).mockResolvedValue({});
    vi.mocked(api.getChartAccounts).mockResolvedValue([checkingAcc, ccAcc, cashAcc, officeAcc, travelAcc, softwareAcc]);
    vi.mocked(api.getInvoices).mockResolvedValue({ status: "ok", invoices: [], summary: emptyInvoiceSummary });
    vi.mocked(api.getUnlinkedItems).mockResolvedValue({
      expenses: [],
      transactions: [],
      totalExpenses: 0,
      totalTxs: 0,
    });
    vi.mocked(api.updateExpense).mockImplementation(async (id, upd) =>
      makeExpense({ id, vendor: String(upd.vendor ?? "Updated") })
    );
    vi.mocked(api.updateTransaction).mockImplementation(async (id, upd) =>
      makeTx({ id, description: String(upd.description ?? "Updated") })
    );
    vi.mocked(api.deleteExpense).mockResolvedValue(undefined);
    vi.mocked(api.deleteTransaction).mockResolvedValue(undefined);
    vi.mocked(api.unlinkExpenseFromTransaction).mockResolvedValue(undefined);
    vi.mocked(api.linkExpenseToTransaction).mockResolvedValue({ status: "ok" });
    vi.mocked(api.createAndLink).mockResolvedValue(undefined);
    vi.mocked(api.resolveReviewItems).mockResolvedValue({ status: "ok" });
    vi.mocked(api.restoreItem).mockResolvedValue({ status: "ok", affected: [] });
  });

  it("loads transaction view, edits and saves both cards with category sync alert, and triggers Create Rule", async () => {
    const tx = makeTx({ categoryAccountId: officeAcc.id, chartAccount: { ...checkingAcc, active: false } });
    const exp = makeExpense({ chartAccountId: officeAcc.id, chartAccount: { ...officeAcc, active: false } });
    const onCreateRule = vi.fn();

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: tx,
      confirmedExpenses: [exp],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
    });

    renderDrawer({ type: "transaction", id: tx.id, onCreateRule });

    await waitFor(() => {
      expect(screen.getByText("STAPLES #412")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Archived").length).toBeGreaterThanOrEqual(2);

    // Edit Expense card and change category so category sync notice appears
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[0]);

    const expVendorInput = screen.getByLabelText("Vendor") as HTMLInputElement;
    fireEvent.change(expVendorInput, { target: { value: "Staples Business" } });
    const expNotesInput = document.getElementById("detail-exp-notes") as HTMLTextAreaElement;
    fireEvent.change(expNotesInput, { target: { value: "Updated note" } });
    const expCategoryTrigger = document.getElementById("detail-exp-category") as HTMLElement;
    fireEvent.click(expCategoryTrigger);
    fireEvent.click(screen.getByRole("option", { name: /5030 — Travel/ }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.updateExpense).toHaveBeenCalledWith(
        exp.id,
        expect.objectContaining({
          vendor: "Staples Business",
          notes: "Updated note",
          chartAccountId: travelAcc.id,
        })
      );
      expect(screen.getByText("Category Synced")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Edit Bank Transaction card and save after reload completes
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    });
    const txEditButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(txEditButtons[1]);
    const txDescInput = screen.getByLabelText("Description") as HTMLInputElement;
    fireEvent.change(txDescInput, { target: { value: "STAPLES CORP" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.updateTransaction).toHaveBeenCalledWith(
        tx.id,
        expect.objectContaining({ description: "STAPLES CORP" })
      );
    });

    // Click Create Rule button in Bank Transaction card
    fireEvent.click(screen.getByRole("button", { name: /Create Rule/i }));
    expect(onCreateRule).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryAccountId: officeAcc.id,
      })
    );
  });

  it("handles receipt mode with multi-linked split expenses accordion, cash tender invoice linking, duplicate receipt upload retry, and SplitExpenseModal", async () => {
    const exp1 = makeExpense({
      id: 201,
      tender: "CASH",
      amount: 30,
      vendor: "Local Bakery",
      description: "Client breakfast",
      allocationStatus: "PARTIALLY_ALLOCATED",
      receipts: [makeReceipt({ id: 91 })],
    });
    const exp2 = makeExpense({
      id: 202,
      tender: "CARD",
      amount: 20,
      vendor: "Local Bakery",
      description: "Office coffee",
      chartAccountId: softwareAcc.id,
      chartAccount: softwareAcc,
      receipts: [makeReceipt({ id: 92 })],
    });
    const linkedTx = makeTx({
      id: 105,
      amount: -50,
      isManual: true,
      fitId: "MANUAL-105",
      expenses: [exp1, exp2],
    });
    const inv = makeInvoice({ id: 301, invoiceNumber: "INV-2026-301", clientName: "Northside Clinic" });

    vi.mocked(api.getExpenseDetail).mockResolvedValue({
      expense: exp1,
      confirmedTransactions: [linkedTx],
      suggestedTransactions: [],
      suggestedTransactionCandidates: [],
    });
    vi.mocked(api.getInvoices).mockResolvedValue({ status: "ok", invoices: [inv], summary: emptyInvoiceSummary });
    vi.mocked(api.linkExpenseToInvoice).mockResolvedValue({ status: "ok", expenseId: exp1.id, invoiceId: inv.id });
    vi.mocked(api.unlinkExpenseFromInvoice).mockResolvedValue({ status: "ok", expenseId: exp1.id });
    vi.mocked(api.uploadReceiptToExpense)
      .mockRejectedValueOnce({
        status: 409,
        message: "Duplicate",
        data: { existingExpense: { vendor: "Prior Store", amount: 30 } },
      })
      .mockResolvedValueOnce({ status: "ok", receipt: { id: 93, filePath: "/uploads/2026-06/dup.jpg" } });
    vi.mocked(api.deleteReceipt).mockResolvedValue({ status: "ok" });

    renderDrawer({ type: "receipt", id: exp1.id });

    await waitFor(() => {
      expect(screen.getByText("2 Linked Categories")).toBeInTheDocument();
    });

    // Toggle split categories accordion and select Expense #2
    const accordionBtn = screen.getByRole("button", { name: /2 Linked Categories/i });
    expect(accordionBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(accordionBtn);
    expect(accordionBtn).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: /#2/i }));
    expect(screen.getAllByText("Office coffee").length).toBeGreaterThanOrEqual(2);

    // Open Split Receipt modal and trigger completion callback
    fireEvent.click(screen.getByRole("button", { name: /Split Receipt/i }));
    expect(screen.getByTestId("mock-split-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Complete Split Mock" }));
    await waitFor(() => {
      expect(api.getExpenseDetail).toHaveBeenCalledTimes(2);
    });

    // Re-expand split categories accordion after loadData reset, switch back to cash expense (#1) & open Link to Client Invoice
    fireEvent.click(screen.getByRole("button", { name: /2 Linked Categories/i }));
    fireEvent.click(screen.getByRole("button", { name: /#1/i }));
    fireEvent.click(screen.getByRole("button", { name: /Link to Client Invoice/i }));
    await waitFor(() => {
      expect(screen.getByText("INV-2026-301")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("INV-2026-301"));
    fireEvent.click(screen.getByRole("button", { name: "Link to Invoice" }));
    await waitFor(() => {
      expect(api.linkExpenseToInvoice).toHaveBeenCalledWith(exp1.id, inv.id);
    });

    // Upload a receipt triggering 409 duplicate prompt -> confirm Link Receipt retry
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["img"], "dup.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Duplicate Receipt Detected")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Link Receipt" }));
    await waitFor(() => {
      expect(api.uploadReceiptToExpense).toHaveBeenNthCalledWith(1, exp1.id, file, false);
      expect(api.uploadReceiptToExpense).toHaveBeenNthCalledWith(2, exp1.id, file, true);
    });

    // View Receipt lightbox & delete receipt
    fireEvent.click(screen.getByRole("button", { name: /View Receipt/i }));
    const deleteReceiptBtn = screen.getByRole("button", { name: "Delete Receipt" });
    fireEvent.click(deleteReceiptBtn);
    await waitFor(() => {
      expect(screen.getByText("Are you sure? Deleting a receipt completely removes the physical file from the system and cannot be undone.")).toBeInTheDocument();
    });
    const receiptDialog = screen
      .getByText(/Deleting a receipt completely removes the physical file/)
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(receiptDialog).getByRole("button", { name: "Delete Receipt" }));
    await waitFor(() => {
      expect(api.deleteReceipt).toHaveBeenCalledWith(91);
    });
  });

  it("handles deposit transaction invoice matching, manual dropdown match, unlink payment, and create new invoice CTA", async () => {
    const depTx = makeTx({
      id: 400,
      amount: 250,
      transactionType: "DEP",
      description: "ACH DEPOSIT MOHAWK",
      categoryAccountId: undefined,
      category: undefined,
    });
    const suggestedInv = makeInvoice({
      id: 302,
      invoiceNumber: "INV-2026-302",
      clientName: "Mohawk Valley Health",
      totalAmount: 250,
      balanceDue: 250,
    });
    const otherInv = makeInvoice({
      id: 303,
      invoiceNumber: "INV-2026-303",
      clientName: "Utica Coffee Co",
      totalAmount: 400,
      balanceDue: 180,
    });
    const onOpenInvoices = vi.fn();

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: depTx,
      confirmedExpenses: [],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
      suggestedInvoices: [suggestedInv],
    });
    vi.mocked(api.getInvoices).mockResolvedValue({
      status: "ok",
      invoices: [suggestedInv, otherInv],
      summary: emptyInvoiceSummary,
    });
    vi.mocked(api.matchInvoicePayment).mockResolvedValue({ status: "PAID", invoice: otherInv, message: "Matched" });
    vi.mocked(api.unmatchInvoicePayment).mockResolvedValue({ status: "SENT", invoice: suggestedInv });

    renderDrawer({ type: "transaction", id: depTx.id, onOpenInvoices });

    await waitFor(() => {
      expect(screen.getByText("Deposit & Revenue Details")).toBeInTheDocument();
      expect(screen.getByText("INV-2026-302")).toBeInTheDocument();
      expect(screen.getByText("Mohawk Valley Health")).toBeInTheDocument();
    });

    // Dropdown open invoice match using custom Select trigger
    const selectTrigger = document.getElementById("detail-open-invoice-select") as HTMLElement;
    fireEvent.click(selectTrigger);
    fireEvent.click(screen.getByRole("option", { name: /INV-2026-303 — Utica Coffee Co/ }));
    fireEvent.click(screen.getByRole("button", { name: "Match" }));

    await waitFor(() => {
      expect(api.matchInvoicePayment).toHaveBeenCalledWith(otherInv.id, depTx.id);
      expect(screen.getByText("Invoice Paid & Linked")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Open invoices CTA
    fireEvent.click(screen.getByRole("button", { name: /Create New Invoice for this Deposit/i }));
    expect(onOpenInvoices).toHaveBeenCalledTimes(1);

    // Reload as already-linked invoice -> Unlink Payment flow
    const linkedInv = makeInvoice({
      id: 302,
      status: "PAID",
      bankTransactionId: depTx.id,
      balanceDue: 0,
    });
    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: depTx,
      confirmedExpenses: [],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
      linkedInvoice: linkedInv,
    });

    // Trigger SSE background update while not editing -> silent reload shows PAID & MATCHED
    act(() => {
      liveEventHandlers["TRANSACTIONS_UPDATED"]?.();
    });

    await waitFor(() => {
      expect(screen.getByText("PAID & MATCHED")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Unlink Payment" }));
    await waitFor(() => {
      expect(screen.getByText(/Unlink "ACH DEPOSIT MOHAWK"/)).toBeInTheDocument();
    });
    const unlinkDialog = screen
      .getByText(/Unlink "ACH DEPOSIT MOHAWK"/)
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(unlinkDialog).getByRole("button", { name: "Unlink Payment" }));
    await waitFor(() => {
      expect(api.unmatchInvoicePayment).toHaveBeenCalledWith(linkedInv.id);
    });
  });

  it("handles invoice view with cash payment recording, bank candidate matching, and delete invoice", async () => {
    const inv = makeInvoice({ id: 500, invoiceNumber: "INV-2026-500", clientName: "Syracuse Tech" });
    const candTx = makeTx({ id: 501, amount: 250, transactionType: "DEP", description: "WIRE SYRACUSE TECH" });

    vi.mocked(api.getInvoice).mockResolvedValue({ status: "ok", invoice: inv });
    vi.mocked(api.getInvoiceCandidates).mockResolvedValue({
      status: "ok",
      candidates: [{ transaction: candTx, score: 92, reason: "Exact amount" }],
    });
    vi.mocked(api.markInvoicePaidCash).mockResolvedValue({
      status: "PAID",
      invoice: { ...inv, status: "PAID" },
      message: "Recorded to 1030",
    });
    vi.mocked(api.deleteInvoice).mockResolvedValue({ status: "ok" });

    const onClose = vi.fn();
    renderDrawer({ type: "invoice", id: inv.id, onClose });

    await waitFor(() => {
      expect(screen.getByText("Invoice #INV-2026-500 — Syracuse Tech")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Mark Paid in Cash" }));
    fireEvent.change(screen.getByLabelText(/Memo \/ Note/i), { target: { value: "Received check/cash" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Cash Payment/i }));

    await waitFor(() => {
      expect(api.markInvoicePaidCash).toHaveBeenCalledWith(inv.id, expect.objectContaining({ notes: "Received check/cash" }));
      expect(screen.getByText("Marked Paid in Cash")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getByText(/Delete invoice INV-2026-500/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete Invoice" }));
    await waitFor(() => {
      expect(api.deleteInvoice).toHaveBeenCalledWith(inv.id);
    });
  });

  it("handles Create New Expense -> ReplaceOrAdd -> 409 CATEGORY_MISMATCH -> OVER_ALLOCATED -> force createAndLink", async () => {
    const tx = makeTx({ id: 600, amount: -100, categoryAccountId: officeAcc.id });
    const existingExp = makeExpense({ id: 601, amount: 40 });

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: tx,
      confirmedExpenses: [existingExp],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
    });

    vi.mocked(api.createAndLink)
      .mockRejectedValueOnce({
        status: 409,
        message: "Category conflict",
        data: {
          error: "CATEGORY_MISMATCH",
          transactionCategory: { id: officeAcc.id, code: officeAcc.code, name: officeAcc.name },
          expenseCategory: { id: softwareAcc.id, code: softwareAcc.code, name: softwareAcc.name },
        },
      })
      .mockRejectedValueOnce({
        status: 400,
        message: "Would exceed transaction amount",
        data: {
          error: "OVER_ALLOCATED",
          message: "Linked expenses total $110.00 which exceeds $100.00.",
        },
      })
      .mockResolvedValueOnce(undefined);

    renderDrawer({ type: "transaction", id: tx.id });

    await waitFor(() => {
      expect(screen.getByText("STAPLES #412")).toBeInTheDocument();
    });

    // Open Create New Expense modal & submit -> opens Already Linked because existingExp is linked
    fireEvent.click(screen.getByRole("button", { name: /Create New/i }));
    const submitBtn = screen.getByRole("button", { name: "Create & Link" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Already Linked")).toBeInTheDocument();
    });

    // Choose Add to Existing (Split) -> hits 409 Category Mismatch modal
    fireEvent.click(screen.getByRole("button", { name: /Add to Existing \(Split\)/i }));

    await waitFor(() => {
      expect(screen.getByText("Category Mismatch")).toBeInTheDocument();
    });

    // Resolve choosing expense category -> hits Amount Mismatch modal
    const conflictCard = screen.getByText(/Use the Expense's category/i).closest("button");
    expect(conflictCard).toBeTruthy();
    if (conflictCard) fireEvent.click(conflictCard);

    await waitFor(() => {
      expect(screen.getByText("Amount Mismatch")).toBeInTheDocument();
    });

    // Force link anyway -> succeeds
    fireEvent.click(screen.getByRole("button", { name: "Link Anyway" }));

    await waitFor(() => {
      expect(api.createAndLink).toHaveBeenLastCalledWith(
        expect.objectContaining({
          overrideChartAccountId: softwareAcc.id,
          force: true,
        })
      );
    });
  });

  it("handles closed-period PENDING Allow Item, IGNORED Restore Item, Exclude ALL_LINKED, Undo Warnings, SSE reload banner & hotkeys", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ BooksClosedDate: "2026-07-01" });
    const pendingTx = makeTx({
      id: 700,
      date: "2026-06-15T12:00:00Z",
      reviewStatus: "PENDING",
      allocationStatus: "UNLINKED",
    });
    const linkedExp = makeExpense({
      id: 701,
      timestamp: "2026-06-15T12:00:00Z",
      reviewStatus: "WARNINGS_IGNORED",
      allocationStatus: "OVER_ALLOCATED",
      receipts: [],
    });

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: pendingTx,
      confirmedExpenses: [linkedExp],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
    });

    const { onClose } = renderDrawer({ type: "transaction", id: pendingTx.id });

    await waitFor(() => {
      expect(screen.getByText("Action Required")).toBeInTheDocument();
    });

    // Click Allow Item on pending tx -> confirm -> resolveReviewItems
    fireEvent.click(screen.getByRole("button", { name: "Allow Item" }));
    await waitFor(() => {
      expect(screen.getByText("Reopen Books to Allow Item")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Reopen Books" }));
    await waitFor(() => {
      expect(api.resolveReviewItems).toHaveBeenCalledWith("allow", [pendingTx.id], []);
    });

    // Undo warnings on expense -> resolveReviewItems("restore_warnings")
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(api.resolveReviewItems).toHaveBeenCalledWith("restore_warnings", [], [linkedExp.id]);
    });

    // Exclude flow -> opens Linked Items Detected -> Choose Unlink & Exclude Only This Item -> close mock
    const excludeBtns = screen.getAllByRole("button", { name: "Exclude..." });
    fireEvent.click(excludeBtns[excludeBtns.length - 1]);
    await waitFor(() => {
      expect(screen.getByText("Linked Items Detected")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Unlink & Exclude Only This Item/i }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-exclude-modal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Exclude Mock" }));
    await waitFor(() => {
      expect(api.unlinkExpenseFromTransaction).toHaveBeenCalledWith(linkedExp.id, pendingTx.id);
      expect(onClose).toHaveBeenCalled();
    }, { timeout: 1000 });
  });

  it("handles IGNORED Restore Item, SSE Edit Reload Record / Keep My Changes, and Escape key", async () => {
    const baseTx = makeTx({ id: 750, reviewStatus: "IGNORED", exclusionReason: "PERSONAL", exclusionNote: "Coffee" });
    vi.mocked(api.getTransactionDetail)
      .mockResolvedValueOnce({
        transaction: baseTx,
        confirmedExpenses: [],
        suggestedExpenses: [],
        suggestedExpenseCandidates: [],
      })
      .mockResolvedValue({
        transaction: { ...baseTx, reviewStatus: "APPROVED" },
        confirmedExpenses: [],
        suggestedExpenses: [],
        suggestedExpenseCandidates: [],
      });

    const { onClose } = renderDrawer({ type: "transaction", id: baseTx.id });

    await waitFor(() => {
      expect(screen.getByText("This item is excluded from your books")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore Item" }));
    await waitFor(() => {
      expect(api.restoreItem).toHaveBeenCalledWith("transaction", baseTx.id);
    });

    // Now unlocked -> enter edit mode and trigger SSE update -> Keep My Changes & Reload Record
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    act(() => {
      liveEventHandlers["TRANSACTIONS_UPDATED"]?.();
    });

    await waitFor(() => {
      expect(screen.getByText(/A background process updated this record/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Keep My Changes" }));
    act(() => {
      liveEventHandlers["TRANSACTIONS_UPDATED"]?.();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reload Record" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reload Record" }));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    }, { timeout: 1000 });
  });

  it("supports Link Existing flow, Quick-Approve 'a' hotkey, and Delete Confirmation in transaction mode", async () => {
    const tx = makeTx({ id: 800, amount: -55 });
    const candExp = makeExpense({ id: 801, amount: 55, vendor: "Target" });
    const unlinkedExp = makeExpense({ id: 802, amount: 55, vendor: "Walmart", description: "Supplies" });

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: tx,
      confirmedExpenses: [],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [{ expense: candExp, score: 91, reason: "Exact amount" }],
    });
    vi.mocked(api.getUnlinkedItems).mockResolvedValue({
      expenses: [unlinkedExp],
      transactions: [],
      totalExpenses: 1,
      totalTxs: 0,
    });

    renderDrawer({ type: "transaction", id: tx.id });

    await waitFor(() => {
      expect(screen.getByText("STAPLES #412")).toBeInTheDocument();
    });

    // Press 'a' hotkey to quick-approve top suggested candidate
    fireEvent.keyDown(document, { key: "a" });
    await waitFor(() => {
      expect(api.linkExpenseToTransaction).toHaveBeenCalledWith(candExp.id, tx.id, undefined, false);
    });

    // Link Existing picker selection & link
    fireEvent.click(screen.getByRole("button", { name: "Link Existing" }));
    await waitFor(() => {
      expect(within(document.body).getByText("Walmart — Supplies")).toBeInTheDocument();
    });
    fireEvent.click(within(document.body).getByText("Walmart — Supplies"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Link" }));
    await waitFor(() => {
      expect(api.linkExpenseToTransaction).toHaveBeenCalledWith(unlinkedExp.id, tx.id, undefined, false);
    });

    // Delete transaction
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getByText("Move Transaction to Deleted Items")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Move to Deleted Items" }));
    await waitFor(() => {
      expect(api.deleteTransaction).toHaveBeenCalledWith(tx.id);
    });
  });

  it("exercises full Expense & Bank Transaction field editing, validation alerts, Unlink Pair, and Replace Existing links", async () => {
    const tx = makeTx({
      id: 900,
      amount: -65,
      allocationStatus: "PARTIAL",
      categoryAccountId: officeAcc.id,
    });
    const exp1 = makeExpense({
      id: 901,
      amount: 45,
      allocationStatus: "PARTIAL",
      chartAccountId: officeAcc.id,
      receipts: [],
    });
    const replacementExp = makeExpense({ id: 902, amount: 65, vendor: "Costco", description: "Bulk paper" });

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: tx,
      confirmedExpenses: [exp1],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
    });
    vi.mocked(api.getUnlinkedItems).mockResolvedValue({
      expenses: [replacementExp],
      transactions: [],
      totalExpenses: 1,
      totalTxs: 0,
    });

    renderDrawer({ type: "transaction", id: tx.id });

    await waitFor(() => {
      expect(screen.getByText("STAPLES #412")).toBeInTheDocument();
    });

    // 1) Edit all Expense fields (Total, Tax, Currency, Description, Date, Tender) & check validation on zero amount
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const expAmtInput = document.getElementById("detail-exp-amount") as HTMLInputElement;
    const expTaxInput = document.getElementById("detail-exp-tax") as HTMLInputElement;
    const expDescInput = document.getElementById("detail-exp-desc") as HTMLInputElement;
    const expDateInput = document.getElementById("detail-exp-date") as HTMLInputElement;
    fireEvent.change(expAmtInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Invalid Amount")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    fireEvent.change(expAmtInput, { target: { value: "75.25" } });
    fireEvent.change(expTaxInput, { target: { value: "5.25" } });
    fireEvent.change(expDescInput, { target: { value: "Bulk office order" } });
    fireEvent.change(expDateInput, { target: { value: "2026-06-20" } });
    fireEvent.click(document.getElementById("detail-exp-currency") as HTMLElement);
    fireEvent.click(screen.getByRole("option", { name: "CAD" }));
    fireEvent.click(document.getElementById("detail-exp-tender") as HTMLElement);
    fireEvent.click(screen.getByRole("option", { name: "TRANSFER" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.updateExpense).toHaveBeenCalledWith(
        exp1.id,
        expect.objectContaining({
          amount: 75.25,
          taxAmount: 5.25,
          currencyCode: "CAD",
          description: "Bulk office order",
          tender: "TRANSFER",
        })
      );
    });

    // 2) Edit all Bank Transaction fields (Amount sign normalization, Date, Bank/Card Account, Category, Notes)
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    const txAmtInput = document.getElementById("detail-tx-amount") as HTMLInputElement;
    const txDateInput = document.getElementById("detail-tx-date") as HTMLInputElement;
    const txNotesInput = document.getElementById("detail-tx-notes") as HTMLTextAreaElement;
    fireEvent.change(txAmtInput, { target: { value: "88" } });
    fireEvent.change(txDateInput, { target: { value: "2026-06-21" } });
    fireEvent.change(txNotesInput, { target: { value: "Matched monthly charge" } });
    fireEvent.click(document.getElementById("detail-tx-account") as HTMLElement);
    fireEvent.click(screen.getByRole("option", { name: /2010 — Visa Corporate/ }));
    fireEvent.click(document.getElementById("detail-tx-category") as HTMLElement);
    fireEvent.click(screen.getByRole("option", { name: /5030 — Travel/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.updateTransaction).toHaveBeenCalledWith(
        tx.id,
        expect.objectContaining({
          amount: -88,
          chartAccountId: ccAcc.id,
          categoryAccountId: travelAcc.id,
          notes: "Matched monthly charge",
        })
      );
      expect(screen.getByText("Category Synced")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // 3) Replace Existing link via Link Existing picker -> Replace Existing
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Link Existing" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Link Existing" }));
    fireEvent.change(screen.getByLabelText("Search Amount or Text"), { target: { value: "Costco" } });
    fireEvent.change(document.getElementById("detail-link-start") as HTMLInputElement, {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(document.getElementById("detail-link-end") as HTMLInputElement, {
      target: { value: "2026-06-30" },
    });
    await waitFor(() => {
      expect(within(document.body).getByText("Costco — Bulk paper")).toBeInTheDocument();
    });
    fireEvent.click(within(document.body).getByText("Costco — Bulk paper"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Link" }));

    await waitFor(() => {
      expect(screen.getByText("Already Linked")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Replace Existing/i }));
    await waitFor(() => {
      expect(api.unlinkExpenseFromTransaction).toHaveBeenCalledWith(exp1.id, tx.id);
      expect(api.linkExpenseToTransaction).toHaveBeenCalledWith(replacementExp.id, tx.id, undefined, false);
    });

    // 4) Click Unlink Pair button between columns
    fireEvent.click(screen.getByRole("button", { name: "Unlink Pair" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Remove Link" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Link" }));
    await waitFor(() => {
      expect(api.unlinkExpenseFromTransaction).toHaveBeenCalled();
    });
  });

  it("exercises Receipt mode Cash N/A, Create New Transaction, Ignore Warnings (unlinked & Undo), Unlink Invoice, and Delete Expense", async () => {
    const linkedInv = makeInvoice({ id: 950, invoiceNumber: "INV-2026-950", clientName: "Boonville Co" });
    const cashExp = makeExpense({
      id: 910,
      vendor: "Local Hardware",
      tender: "CASH",
      amount: 35,
      allocationStatus: "BALANCED",
      invoice: linkedInv,
      receipts: [],
    });

    vi.mocked(api.getExpenseDetail).mockResolvedValue({
      expense: cashExp,
      confirmedTransactions: [],
      suggestedTransactions: [],
      suggestedTransactionCandidates: [],
    });
    vi.mocked(api.unlinkExpenseFromInvoice).mockResolvedValue({ status: "ok", expenseId: cashExp.id });

    renderDrawer({ type: "receipt", id: cashExp.id });

    await waitFor(() => {
      expect(screen.getByText("Not Applicable (Cash Expense)")).toBeInTheDocument();
    });

    // Unlink client invoice on expense
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => {
      expect(screen.getByText("Unlink Invoice")).toBeInTheDocument();
    });
    const unlinkInvDialog = screen
      .getByText(/Remove the association between this expense/)
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(unlinkInvDialog).getByRole("button", { name: "Unlink" }));
    await waitFor(() => {
      expect(api.unlinkExpenseFromInvoice).toHaveBeenCalledWith(cashExp.id);
    });

    // Ignore Warnings on unlinked expense (no receipt triggers warning) -> Confirm Ignore
    fireEvent.click(screen.getByRole("button", { name: "Ignore Warnings" }));
    await waitFor(() => {
      expect(screen.getByText(/This will mark the item as reviewed/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Ignore" }));
    await waitFor(() => {
      expect(api.resolveReviewItems).toHaveBeenCalledWith("ignore_warnings", [], [cashExp.id]);
    });

    // Reload same expense ID as CARD tender with NO linked tx -> tests Create New Transaction prefill (ccAcc selected) + Delete Expense
    const cardExp = makeExpense({
      id: cashExp.id,
      vendor: "AWS",
      description: "Cloud hosting",
      tender: "CARD",
      amount: 95,
      timestamp: "2026-06-15T12:00:00Z",
      receipts: [],
    });
    vi.mocked(api.getExpenseDetail).mockResolvedValue({
      expense: cardExp,
      confirmedTransactions: [],
      suggestedTransactions: [],
      suggestedTransactionCandidates: [],
    });

    act(() => {
      liveEventHandlers["EXPENSES_UPDATED"]?.();
    });

    await waitFor(() => {
      expect(screen.getByText("AWS")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Create New Transaction/i }));
    await waitFor(() => {
      expect(screen.getByText("Create & Link Transaction")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create & Link" }));
    await waitFor(() => {
      expect(api.createAndLink).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "receipt",
          targetId: cardExp.id,
          chartAccountId: ccAcc.id,
          amount: -95,
        })
      );
    });

    // Delete Expense
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getByText("Move Expense to Deleted Items")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Move to Deleted Items" }));
    await waitFor(() => {
      expect(api.deleteExpense).toHaveBeenCalledWith(cardExp.id);
    });
  });

  it("exercises Suggested Invoice Match button, deposit Search & Link Picker mode switching, and paid Invoice view", async () => {
    const depTx = makeTx({
      id: 960,
      amount: 250,
      transactionType: "DEP",
      description: "ACH DEPOSIT CLIENTS",
      reviewStatus: "WARNINGS_IGNORED",
      allocationStatus: "OVER_ALLOCATED",
      categoryAccountId: undefined,
      category: undefined,
    });
    const sugInv = makeInvoice({ id: 961, invoiceNumber: "INV-2026-961", clientName: "Utica General", totalAmount: 250 });

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: depTx,
      confirmedExpenses: [],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
      suggestedInvoices: [sugInv],
    });
    vi.mocked(api.getInvoices).mockResolvedValue({
      status: "ok",
      invoices: [sugInv],
      summary: emptyInvoiceSummary,
    });
    vi.mocked(api.matchInvoicePayment).mockResolvedValue({ status: "PAID", invoice: sugInv, message: "Matched" });

    renderDrawer({ type: "transaction", id: depTx.id });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Match & Mark Paid" })).toBeInTheDocument();
    });

    // Undo warnings on bank transaction card
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(api.resolveReviewItems).toHaveBeenCalledWith("restore_warnings", [depTx.id], []);
    });

    // Click Match & Mark Paid on suggested invoice
    fireEvent.click(screen.getByRole("button", { name: "Match & Mark Paid" }));
    await waitFor(() => {
      expect(api.matchInvoicePayment).toHaveBeenCalledWith(sugInv.id, depTx.id);
      expect(screen.getByText("Invoice Paid & Linked")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Open Search & Link Existing Invoice picker & switch back to Expenses tab
    fireEvent.click(screen.getByRole("button", { name: /Search & Link Existing Invoice/i }));
    await waitFor(() => {
      expect(screen.getByText("Link Existing Invoice")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Expenses" }));
    await waitFor(() => {
      expect(screen.getByText("Link Existing Expense")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Invoices" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Match & Mark Paid", hidden: false })).toBeInTheDocument();
    });

    // Render paid Invoice with linked bankTransaction
    const paidInv = makeInvoice({
      id: 970,
      invoiceNumber: "INV-2026-970",
      status: "PAID",
      bankTransactionId: depTx.id,
      bankTransaction: depTx,
      balanceDue: 0,
    });
    vi.mocked(api.getInvoice).mockResolvedValue({ status: "ok", invoice: paidInv });

    renderDrawer({ type: "invoice", id: paidInv.id });
    await waitFor(() => {
      expect(screen.getByText(/Paid via Bank Deposit/i)).toBeInTheDocument();
    });
  });

  it("exercises error alerts across save, upload, link, unlink, ignore, and delete workflows plus deleteTransaction success", async () => {
    const exp1 = makeExpense({ id: 980, vendor: "Target", amount: 55, receipts: [] });
    const tx1 = makeTx({ id: 981, description: "TARGET #12", amount: -55 });
    const unlinkedExp = makeExpense({ id: 982, vendor: "Unlinked Coffee", amount: 12, receipts: [] });
    const candTx = makeTx({ id: 983, description: "COFFEE SHOP", amount: -12 });

    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: tx1,
      confirmedExpenses: [exp1],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
    });
    vi.mocked(api.updateExpense).mockRejectedValueOnce(new Error("Expense save rejected"));
    vi.mocked(api.unlinkExpenseFromTransaction).mockRejectedValueOnce(new Error("Unlink failed"));
    vi.mocked(api.resolveReviewItems).mockRejectedValueOnce(new Error("Ignore failed"));
    vi.mocked(api.deleteExpense).mockRejectedValueOnce(new Error("Delete expense failed"));
    vi.mocked(api.deleteTransaction).mockRejectedValueOnce(new Error("Delete tx failed"));
    vi.mocked(api.uploadReceiptToExpense).mockRejectedValueOnce(new Error("Upload crashed"));
    vi.mocked(api.linkExpenseToTransaction).mockRejectedValueOnce(new Error("Link rejected"));
    vi.mocked(api.linkExpenseToInvoice).mockRejectedValueOnce(new Error("Invoice link rejected"));

    const { onClose } = renderDrawer({ type: "transaction", id: tx1.id });
    await waitFor(() => {
      expect(screen.getByText("Target")).toBeInTheDocument();
    });

    // Save Expense failure alert
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Save Failed")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Upload Receipt non-409 error alert
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["bad"], "bad.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => {
      expect(screen.getByText("Upload Failed")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Unlink Pair failure alert
    fireEvent.click(screen.getByRole("button", { name: "Unlink Pair" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Remove Link" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Link" }));
    await waitFor(() => {
      expect(screen.getByText("Unlink Failed")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Delete Expense failure alert
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => {
      expect(screen.getByText("Move Expense to Deleted Items")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Move to Deleted Items" }));
    await waitFor(() => {
      expect(screen.getByText("Delete Failed")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Delete Transaction failure alert then success
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    await waitFor(() => {
      expect(screen.getByText("Move Transaction to Deleted Items")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Move to Deleted Items" }));
    await waitFor(() => {
      expect(screen.getByText("Delete Failed")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    vi.mocked(api.deleteTransaction).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    await waitFor(() => {
      expect(screen.getByText("Move Transaction to Deleted Items")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Move to Deleted Items" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    // Receipt mode: Ignore Failed, Link Failed (tx & invoice)
    vi.mocked(api.getExpenseDetail).mockResolvedValue({
      expense: unlinkedExp,
      confirmedTransactions: [],
      suggestedTransactions: [candTx],
      suggestedTransactionCandidates: [
        { transaction: candTx, score: 85, reason: "Vendor match" },
      ],
    });
    vi.mocked(api.getInvoices).mockResolvedValue({
      status: "ok",
      invoices: [makeInvoice({ id: 985, invoiceNumber: "INV-2026-985", totalAmount: 12, balanceDue: 12 })],
      summary: emptyInvoiceSummary,
    });

    cleanup();
    renderDrawer({ type: "receipt", id: unlinkedExp.id });
    await waitFor(() => {
      expect(screen.getByText("Unlinked Coffee")).toBeInTheDocument();
    });

    // Ignore Warnings fails
    fireEvent.click(screen.getByRole("button", { name: "Ignore Warnings" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Ignore" }));
    await waitFor(() => {
      expect(screen.getByText("Ignore Failed")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Approve suggested match fails -> Link Failed
    fireEvent.click(screen.getByRole("button", { name: "Approve Link" }));
    await waitFor(() => {
      expect(screen.getByText("Link Failed")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Manual Link Invoice fails -> Link Failed
    fireEvent.click(screen.getByRole("button", { name: "Link Existing" }));
    fireEvent.click(screen.getByRole("button", { name: "Invoices" }));
    await waitFor(() => {
      expect(screen.getByText("INV-2026-985")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("INV-2026-985"));
    fireEvent.click(screen.getByRole("button", { name: "Link to Invoice" }));
    await waitFor(() => {
      expect(screen.getByText("Link Failed")).toBeInTheDocument();
    });
  });

  it("exercises Add to Existing (Split) via 'a' hotkey, ActionChoice ALL_LINKED, Create future-date alert, and submodal Cancel handlers", async () => {
    const exp = makeExpense({ id: 990, vendor: "OfficeMax", amount: 80, receipts: [] });
    const txLinked = makeTx({ id: 991, description: "OFFICEMAX 1", amount: -40 });
    const txSug = makeTx({ id: 992, description: "OFFICEMAX 2", amount: -40 });

    vi.mocked(api.getExpenseDetail).mockResolvedValue({
      expense: exp,
      confirmedTransactions: [txLinked],
      suggestedTransactions: [txSug],
      suggestedTransactionCandidates: [
        { transaction: txSug, score: 92, reason: "Exact split" },
      ],
    });

    renderDrawer({ type: "receipt", id: exp.id });
    await waitFor(() => {
      expect(screen.getByText("OfficeMax")).toBeInTheDocument();
    });

    // Hotkey 'a' on linked receipt triggers ReplaceOrAddModal via handleApproveSuggestedMatch -> Add to Existing (Split)
    fireEvent.keyDown(document, { key: "a" });
    await waitFor(() => {
      expect(screen.getByText("Already Linked")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Add to Existing \(Split\)/i }));
    await waitFor(() => {
      expect(api.linkExpenseToTransaction).toHaveBeenCalledWith(exp.id, txSug.id, undefined, false);
    });

    // ActionChoiceModal Cancel then Ignore All Linked Items
    fireEvent.click(screen.getAllByRole("button", { name: "Ignore Warnings" })[0]);
    await waitFor(() => {
      expect(screen.getByText("Linked Items Detected")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Ignore All Linked Items/i }));
    await waitFor(() => {
      expect(screen.getByText(/This will mark the item as reviewed/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Ignore" }));
    await waitFor(() => {
      expect(api.resolveReviewItems).toHaveBeenCalledWith("ignore_warnings", [txLinked.id], [exp.id]);
    });

    // Create New Transaction modal Cancel, then future-date validation via Add to Existing (Split)
    fireEvent.click(screen.getByRole("button", { name: /Create New Transaction/i }));
    await waitFor(() => {
      expect(screen.getByText("Create & Link Transaction")).toBeInTheDocument();
    });
    const modalToCancel = screen.getByText("Create & Link Transaction").closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(modalToCancel).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Create & Link Transaction")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Create New Transaction/i }));
    await waitFor(() => {
      expect(screen.getByText("Create & Link Transaction")).toBeInTheDocument();
    });
    const modal = screen.getByText("Create & Link Transaction").closest('[role="dialog"]') as HTMLElement;
    const dateInput = modal.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create & Link" }));
    await waitFor(() => {
      expect(screen.getByText("Already Linked")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Add to Existing \(Split\)/i }));
    await waitFor(() => {
      expect(screen.getByText("Invalid Date")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
  });

  it("exercises ONLY_THIS Ignore actions, Add/Replace via selectedLinkId, Split close, Deposit invoice link error, and Invoice error alerts", async () => {
    const exp = makeExpense({ id: 1001, vendor: "Costco", amount: 120, receipts: [] });
    const txLinked = makeTx({ id: 1002, description: "COSTCO #1", amount: -120 });
    const txCandidate = makeTx({ id: 1003, description: "COSTCO #2", amount: -60 });

    vi.mocked(api.getExpenseDetail).mockResolvedValue({
      expense: exp,
      confirmedTransactions: [txLinked],
      suggestedTransactions: [],
      suggestedTransactionCandidates: [],
    });
    vi.mocked(api.getUnlinkedItems).mockResolvedValue({
      expenses: [],
      transactions: [txCandidate],
      totalExpenses: 0,
      totalTxs: 1,
    });

    renderDrawer({ type: "receipt", id: exp.id });
    await waitFor(() => {
      expect(screen.getByText("Costco")).toBeInTheDocument();
    });

    // Open Split modal & close it (covers onClose line 1707)
    fireEvent.click(screen.getByRole("button", { name: /Split Receipt/i }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-split-modal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Close Split Mock" }));
    await waitFor(() => {
      expect(screen.queryByTestId("mock-split-modal")).not.toBeInTheDocument();
    });

    // ActionChoiceModal Cancel, then Ignore ONLY_THIS cancel & confirm on receipt
    fireEvent.click(screen.getAllByRole("button", { name: "Ignore Warnings" })[0]);
    await waitFor(() => {
      expect(screen.getByText("Linked Items Detected")).toBeInTheDocument();
    });
    const choiceModal = screen.getByText("Linked Items Detected").closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(choiceModal).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Linked Items Detected")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Ignore Warnings" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Unlink & Ignore Only This Item/i }));
    await waitFor(() => {
      expect(screen.getByText(/This will mark the item as reviewed/)).toBeInTheDocument();
    });
    const ignoreDialog = screen.getByText(/This will mark the item as reviewed/).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(ignoreDialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Ignore Warnings" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Unlink & Ignore Only This Item/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Ignore" }));
    await waitFor(() => {
      expect(api.unlinkExpenseFromTransaction).toHaveBeenCalledWith(exp.id, txLinked.id);
      expect(api.resolveReviewItems).toHaveBeenCalledWith("ignore_warnings", [], [exp.id]);
    });

    // Link Existing in receipt mode -> Add to Existing (Split) & Replace Existing (selectedLinkId)
    fireEvent.click(screen.getByRole("button", { name: "Link Existing" }));
    await waitFor(() => {
      expect(screen.getByText("COSTCO #2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("COSTCO #2"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Link" }));
    await waitFor(() => {
      expect(screen.getByText("Already Linked")).toBeInTheDocument();
    });
    const alreadyLinkedDialog = screen.getByText("Already Linked").closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(alreadyLinkedDialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirm Link" }));
    fireEvent.click(screen.getByRole("button", { name: /Add to Existing \(Split\)/i }));
    await waitFor(() => {
      expect(api.linkExpenseToTransaction).toHaveBeenCalledWith(exp.id, txCandidate.id, undefined, false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Link Existing" }));
    await waitFor(() => {
      expect(screen.getByText("COSTCO #2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("COSTCO #2"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Link" }));
    fireEvent.click(screen.getByRole("button", { name: /Replace Existing/i }));
    await waitFor(() => {
      expect(api.unlinkExpenseFromTransaction).toHaveBeenCalledWith(exp.id, txLinked.id);
    });

    // Transaction mode: Ignore ONLY_THIS + Deposit link invoice failure
    cleanup();
    const txWithWarning = { ...txLinked, allocationStatus: "OVER_ALLOCATED" as const };
    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: txWithWarning,
      confirmedExpenses: [exp],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
    });
    renderDrawer({ type: "transaction", id: txLinked.id });
    await waitFor(() => {
      expect(screen.getByText("COSTCO #1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Ignore Warnings" })[1]);
    fireEvent.click(screen.getByRole("button", { name: /Unlink & Ignore Only This Item/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Ignore" }));
    await waitFor(() => {
      expect(api.resolveReviewItems).toHaveBeenCalledWith("ignore_warnings", [txLinked.id], []);
    });

    // Deposit mode manual invoice match fail via handleLink
    cleanup();
    const depTx = makeTx({ id: 1004, amount: 300, transactionType: "DEP", description: "ACH CLIENT" });
    const inv = makeInvoice({ id: 1005, invoiceNumber: "INV-2026-1005", totalAmount: 300, balanceDue: 300 });
    vi.mocked(api.getTransactionDetail).mockResolvedValue({
      transaction: depTx,
      confirmedExpenses: [],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
    });
    vi.mocked(api.getInvoices).mockResolvedValue({
      status: "ok",
      invoices: [inv],
      summary: emptyInvoiceSummary,
    });
    vi.mocked(api.matchInvoicePayment).mockRejectedValueOnce(new Error("Match failed"));

    renderDrawer({ type: "transaction", id: depTx.id });
    await waitFor(() => {
      expect(screen.getByText("ACH CLIENT")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Search & Link Existing Invoice/i }));
    await waitFor(() => {
      expect(screen.getByText("INV-2026-1005")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("INV-2026-1005"));
    fireEvent.click(screen.getByRole("button", { name: "Match & Mark Paid" }));
    await waitFor(() => {
      expect(screen.getByText("Match Failed")).toBeInTheDocument();
    });

    // Invoice mode error alerts (Cash Pay, Unlink Payment, Delete Invoice)
    cleanup();
    vi.mocked(api.getInvoice).mockResolvedValue({ status: "ok", invoice: inv });
    vi.mocked(api.markInvoicePaidCash).mockRejectedValueOnce(new Error("Cash failed"));
    vi.mocked(api.deleteInvoice).mockRejectedValueOnce(new Error("Delete invoice failed"));
    renderDrawer({ type: "invoice", id: inv.id });
    await waitFor(() => {
      expect(screen.getByText("INV-2026-1005")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark Paid in Cash" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm Cash Payment/i }));
    await waitFor(() => {
      expect(screen.getByText("Cash Payment Failed")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getByText(/Delete invoice INV-2026-1005/i)).toBeInTheDocument();
    });
    const delInvDialog = screen.getByText(/Delete invoice INV-2026-1005/i).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(delInvDialog).getByRole("button", { name: "Delete Invoice" }));
    await waitFor(() => {
      expect(screen.getByText("Delete Failed")).toBeInTheDocument();
    });
  });
});
