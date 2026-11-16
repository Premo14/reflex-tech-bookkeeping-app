import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ReceiptCanvasPane } from "@/components/detail-drawer/ReceiptCanvasPane";
import { DetailInvoiceView } from "@/components/detail-drawer/DetailInvoiceView";
import { DetailLinkPicker } from "@/components/detail-drawer/DetailLinkPicker";
import { DetailSubModals } from "@/components/detail-drawer/DetailSubModals";
import type { CreateFormState } from "@/components/detail-drawer/types";
import type {
  BankTransaction,
  ChartAccount,
  Expense,
  Invoice,
  Receipt,
  ScoredDepositCandidate,
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
  id: 10,
  documentUri: "/uploads/2026-06/receipt-10.jpg",
  fileExt: ".jpg",
  createdAt: "2026-06-15T10:00:00Z",
  ...overrides,
});

const makeTx = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  id: 20,
  isManual: false,
  transactionType: "CREDIT",
  reviewStatus: "APPROVED",
  fitId: "FIT-20",
  date: "2026-06-15T00:00:00Z",
  description: "STRIPE TRANSFER",
  amount: 250,
  allocationStatus: "UNLINKED",
  chartAccountId: 1,
  chartAccount: makeAccount(),
  ...overrides,
});

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 30,
  isManual: false,
  timestamp: "2026-06-15T00:00:00Z",
  vendor: "Home Depot",
  description: "Lumber & screws",
  amount: 125.5,
  taxAmount: 8.5,
  currencyCode: "USD",
  tender: "CARD",
  allocationStatus: "UNLINKED",
  chartAccountId: 2,
  chartAccount: makeAccount({ id: 2, code: "5100", name: "Materials", type: "EXPENSE" }),
  createdAt: "2026-06-15T00:00:00Z",
  updatedAt: "2026-06-15T00:00:00Z",
  ...overrides,
});

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 40,
  invoiceNumber: "INV-2026-040",
  clientName: "Acme Corp",
  clientEmail: "billing@acme.test",
  clientAddress: "123 Bleecker St\nUtica, NY",
  issueDate: "2026-06-01T00:00:00Z",
  dueDate: "2026-07-01T00:00:00Z",
  paymentTerms: "Net 30",
  status: "SENT",
  items: JSON.stringify([
    { description: "Consulting Hours", quantity: 2, unitPrice: 125, amount: 250 },
    { description: "Cable Run", quantity: 3, unitPrice: 10 },
  ]),
  subtotal: 280,
  taxRate: 8,
  taxAmount: 22.4,
  totalAmount: 302.4,
  balanceDue: 150,
  notes: "Thank you for your business",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
  ...overrides,
});

describe("ReceiptCanvasPane", () => {
  it("renders empty placeholder when no receipts are attached", () => {
    const onClose = vi.fn();
    render(
      <ReceiptCanvasPane
        isOpen={true}
        receipts={[]}
        activeReceiptIdx={0}
        onChangeActiveReceiptIdx={vi.fn()}
        zoom={1}
        onChangeZoom={vi.fn()}
        rotation={0}
        onChangeRotation={vi.fn()}
        isClosed={false}
        isSaving={false}
        onDeleteReceipt={vi.fn()}
        onClose={onClose}
      />
    );

    expect(screen.getByText("Physical Receipt")).toBeInTheDocument();
    expect(screen.getByText("No physical receipt attached.")).toBeInTheDocument();
  });

  it("handles image zoom, rotation, multi-receipt navigation, keyboard shortcuts, and deletion", async () => {
    const user = userEvent.setup();
    const onDeleteReceipt = vi.fn();
    const onClose = vi.fn();

    function ControlledCanvas() {
      const [idx, setIdx] = useState(0);
      const [zoom, setZoom] = useState(1);
      const [rotation, setRotation] = useState(0);
      return (
        <div>
          <input aria-label="External input" />
          <ReceiptCanvasPane
            isOpen={true}
            receipts={[
              makeReceipt({ id: 1, documentUri: "/files/page-1.jpg", fileExt: ".jpg" }),
              makeReceipt({ id: 2, documentUri: "/files/page-2.pdf", fileExt: ".pdf" }),
            ]}
            activeReceiptIdx={idx}
            onChangeActiveReceiptIdx={setIdx}
            zoom={zoom}
            onChangeZoom={setZoom}
            rotation={rotation}
            onChangeRotation={setRotation}
            isClosed={false}
            isSaving={false}
            onDeleteReceipt={onDeleteReceipt}
            onClose={onClose}
          />
        </div>
      );
    }

    render(<ControlledCanvas />);

    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByAltText("Receipt 1")).toHaveAttribute("src", "/api/images/page-1.jpg");

    await user.click(screen.getByRole("button", { name: "Zoom In" }));
    expect(screen.getByText("125%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zoom Out" }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rotate 90 degrees clockwise" }));
    expect(screen.getByAltText("Receipt 1")).toHaveStyle({ transform: "scale(1) rotate(90deg)" });

    // Keyboard shortcuts when image is active
    fireEvent.keyDown(document, { key: "+" });
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "-" });
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "r" });
    expect(screen.getByAltText("Receipt 1")).toHaveStyle({ transform: "scale(1) rotate(180deg)" });
    fireEvent.keyDown(document, { key: "0" });
    expect(screen.getByAltText("Receipt 1")).toHaveStyle({ transform: "scale(1) rotate(0deg)" });

    // Ignore hotkeys while input is focused
    const input = screen.getByLabelText("External input");
    input.focus();
    fireEvent.keyDown(input, { key: "+" });
    expect(screen.getByText("100%")).toBeInTheDocument();

    // Navigate to PDF receipt via button and back with ArrowLeft
    await user.click(screen.getByRole("button", { name: "Next receipt" }));
    expect(screen.getByText("Image 2 of 2")).toBeInTheDocument();
    expect(screen.getByTitle("Receipt 2")).toHaveAttribute("src", "/api/images/page-2.pdf");
    expect(screen.queryByRole("button", { name: "Zoom In" })).not.toBeInTheDocument();

    // Keyboard navigation between receipts
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText("Image 1 of 2")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("Image 2 of 2")).toBeInTheDocument();

    // Go back with Previous button and test Reset + Delete
    await user.click(screen.getByRole("button", { name: "Previous receipt" }));
    await user.click(screen.getByRole("button", { name: "Zoom In" }));
    await user.click(screen.getByRole("button", { name: "Reset zoom and rotation" }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Receipt" }));
    expect(onDeleteReceipt).toHaveBeenCalledWith(1);
  });

  it("hides delete action in closed period and displays saving label when deleting", () => {
    const { rerender } = render(
      <ReceiptCanvasPane
        isOpen={true}
        receipts={[makeReceipt({ id: 9 })]}
        activeReceiptIdx={5}
        onChangeActiveReceiptIdx={vi.fn()}
        zoom={1}
        onChangeZoom={vi.fn()}
        rotation={0}
        onChangeRotation={vi.fn()}
        isClosed={true}
        isSaving={false}
        onDeleteReceipt={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /Delete/i })).not.toBeInTheDocument();

    rerender(
      <ReceiptCanvasPane
        isOpen={true}
        receipts={[makeReceipt({ id: 9 })]}
        activeReceiptIdx={0}
        onChangeActiveReceiptIdx={vi.fn()}
        zoom={1}
        onChangeZoom={vi.fn()}
        rotation={0}
        onChangeRotation={vi.fn()}
        isClosed={false}
        isSaving={true}
        onDeleteReceipt={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Deleting.../i })).toBeDisabled();
  });
});

describe("DetailInvoiceView", () => {
  const baseHandlers = () => ({
    onToggleCashPayPanel: vi.fn(),
    onCashPayDateChange: vi.fn(),
    onCashPayNotesChange: vi.fn(),
    onMarkPaidCash: vi.fn(),
    onMatchPayment: vi.fn(),
    onUnmatchPayment: vi.fn(),
    onUnlinkExpense: vi.fn(),
    onDeleteInvoice: vi.fn(),
    onEditInvoice: vi.fn(),
    onPrintInvoice: vi.fn(),
  });

  it("renders invoice metadata, line items, linked expenses, cash payment panel, and deposit matching", async () => {
    const user = userEvent.setup();
    const handlers = baseHandlers();
    const candidates: ScoredDepositCandidate[] = [
      {
        transaction: makeTx({ id: 201, description: "ACME WIRE", amount: 150 }),
        score: 92,
        reason: "Exact match to balance due",
      },
    ];
    const invoice = makeInvoice({
      status: "OVERDUE",
      linkedExpenses: [makeExpense({ id: 77, vendor: "SubcontractorCo", amount: 75 })],
    });

    render(
      <DetailInvoiceView
        invoice={invoice}
        invoiceCandidates={candidates}
        isMatchingInvoice={false}
        isLinkingInvoice={false}
        showCashPayPanel={true}
        cashPayDate="2026-06-20"
        cashPayNotes="Paid at job site"
        isRecordingCashPay={false}
        {...handlers}
      />
    );

    expect(screen.getByText("INV-2026-040")).toBeInTheDocument();
    expect(screen.getByText("OVERDUE")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getAllByText("$302.40")).toHaveLength(2);
    expect(screen.getByText("Remaining: $150.00")).toBeInTheDocument();
    expect(screen.getByText("Tax (8.0%):")).toBeInTheDocument();
    expect(screen.getByText("$22.40")).toBeInTheDocument();
    expect(screen.getByText("$30.00")).toBeInTheDocument(); // 3 * $10 computed via cents
    expect(screen.getByText("Thank you for your business")).toBeInTheDocument();
    expect(screen.getByText("SubcontractorCo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Invoice" }));
    expect(handlers.onEditInvoice).toHaveBeenCalledWith(invoice);

    await user.click(screen.getByRole("button", { name: "Print / PDF" }));
    expect(handlers.onPrintInvoice).toHaveBeenCalledWith(invoice);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(handlers.onDeleteInvoice).toHaveBeenCalledWith(invoice);

    await user.click(screen.getByRole("button", { name: "Unlink" }));
    expect(handlers.onUnlinkExpense).toHaveBeenCalledWith(77, "INV-2026-040");

    await user.type(screen.getByLabelText("Memo / Note (Optional)"), "!");
    expect(handlers.onCashPayNotesChange).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Cash Payment Date"), { target: { value: "2026-06-21" } });
    expect(handlers.onCashPayDateChange).toHaveBeenCalledWith("2026-06-21");

    await user.click(screen.getByRole("button", { name: /Confirm Cash Payment \(\$150.00\)/i }));
    expect(handlers.onMarkPaidCash).toHaveBeenCalledWith(40);

    await user.click(screen.getByRole("button", { name: "Match & Pay" }));
    expect(handlers.onMatchPayment).toHaveBeenCalledWith(40, 201);
  });

  it("renders paid-in-cash / paid-via-bank state and handles malformed items fallback", async () => {
    const user = userEvent.setup();
    const handlers = baseHandlers();
    const cashTx = makeTx({
      id: 99,
      fitId: "CASH-INV-40",
      isManual: true,
      description: "Cash Payment — INV-40",
      amount: 302.4,
      chartAccount: makeAccount({ code: "1030", name: "Cash on Hand" }),
    });
    const paidInvoice = makeInvoice({
      status: "PAID",
      items: "{bad json",
      bankTransactionId: 99,
      bankTransaction: cashTx,
      taxAmount: 0,
    });

    const { rerender } = render(
      <DetailInvoiceView
        invoice={paidInvoice}
        invoiceCandidates={[]}
        isMatchingInvoice={false}
        isLinkingInvoice={false}
        showCashPayPanel={false}
        cashPayDate="2026-06-20"
        cashPayNotes=""
        isRecordingCashPay={false}
        {...handlers}
      />
    );

    expect(screen.getByText("BALANCED")).toBeInTheDocument();
    expect(screen.getByText("✓ Paid in Cash (Cash on Hand)")).toBeInTheDocument();
    expect(screen.getByText("No line items specified")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Unlink Payment" }));
    expect(handlers.onUnmatchPayment).toHaveBeenCalledWith(40, cashTx, "INV-2026-040");

    rerender(
      <DetailInvoiceView
        invoice={makeInvoice({
          status: "DRAFT",
          items: JSON.stringify([{ description: "Setup", quantity: 1, unitPrice: 100, amount: 100 }]),
        })}
        invoiceCandidates={[]}
        isMatchingInvoice={false}
        isLinkingInvoice={false}
        showCashPayPanel={false}
        cashPayDate="2026-06-20"
        cashPayNotes=""
        isRecordingCashPay={false}
        {...handlers}
      />
    );
    expect(screen.getByText("No candidate bank deposits found")).toBeInTheDocument();
  });

  it("handles invoice warning alerts, Ignore Warnings, Undo restore warnings, Exclude, and closed-period Allow Item", async () => {
    const user = userEvent.setup();
    const handlers = {
      ...baseHandlers(),
      onRestoreInvoiceWarnings: vi.fn(),
      onAllowInvoiceClosed: vi.fn(),
      onCardAction: vi.fn(),
    };

    const overdueUnlinkedInv = makeInvoice({
      id: 42,
      invoiceNumber: "INV-2026-042",
      status: "OVERDUE",
    });

    const { rerender } = render(
      <DetailInvoiceView
        invoice={overdueUnlinkedInv}
        invoiceCandidates={[]}
        isMatchingInvoice={false}
        isLinkingInvoice={false}
        showCashPayPanel={false}
        cashPayDate="2026-06-20"
        cashPayNotes=""
        isRecordingCashPay={false}
        {...handlers}
      />
    );

    // Displays warnings
    expect(screen.getByText("This invoice is past due date.")).toBeInTheDocument();
    expect(screen.getByText("This invoice is unpaid and unlinked to a customer deposit.")).toBeInTheDocument();

    // Ignore Warnings button is enabled
    const ignoreBtn = screen.getByRole("button", { name: "Ignore Warnings" });
    await user.click(ignoreBtn);
    expect(handlers.onCardAction).toHaveBeenCalledWith("IGNORE", "invoice", 42);

    // Exclude button
    const excludeBtn = screen.getByRole("button", { name: "Exclude..." });
    await user.click(excludeBtn);
    expect(handlers.onCardAction).toHaveBeenCalledWith("EXCLUDE", "invoice", 42);

    // Rerender as WARNINGS_IGNORED
    const warningsIgnoredInv = makeInvoice({
      id: 42,
      invoiceNumber: "INV-2026-042",
      status: "OVERDUE",
      reviewStatus: "WARNINGS_IGNORED",
    });
    rerender(
      <DetailInvoiceView
        invoice={warningsIgnoredInv}
        invoiceCandidates={[]}
        isMatchingInvoice={false}
        isLinkingInvoice={false}
        showCashPayPanel={false}
        cashPayDate="2026-06-20"
        cashPayNotes=""
        isRecordingCashPay={false}
        {...handlers}
      />
    );
    expect(screen.getByText("Warnings have been ignored for this invoice.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(handlers.onRestoreInvoiceWarnings).toHaveBeenCalledWith(42);

    // Rerender as PENDING in closed period
    const closedPendingInv = makeInvoice({
      id: 43,
      invoiceNumber: "INV-2026-043",
      status: "SENT",
      reviewStatus: "PENDING",
      issueDate: "2025-12-15",
    });
    rerender(
      <DetailInvoiceView
        invoice={closedPendingInv}
        invoiceCandidates={[]}
        isMatchingInvoice={false}
        isLinkingInvoice={false}
        showCashPayPanel={false}
        cashPayDate="2026-06-20"
        cashPayNotes=""
        isRecordingCashPay={false}
        isClosed={true}
        itemAwaitingReview={true}
        isDateInClosedPeriod={true}
        {...handlers}
      />
    );
    expect(screen.getByText("This invoice is pending review for a closed period.")).toBeInTheDocument();
    const allowBtn = screen.getByRole("button", { name: "Allow Item" });
    await user.click(allowBtn);
    expect(handlers.onAllowInvoiceClosed).toHaveBeenCalledWith({
      type: "invoice",
      id: 43,
      date: "2025-12-15",
    });
  });
});

describe("DetailLinkPicker", () => {
  it("supports transaction mode tabs, date/search filters, unlinked expense selection, and deposit-only invoice warnings", async () => {
    const user = userEvent.setup();
    const onSelectMode = vi.fn();
    const onSelectLinkId = vi.fn();
    const onConfirmLink = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <DetailLinkPicker
        type="transaction"
        tx={makeTx({ amount: -45 })}
        activeExpense={null}
        linkTargetMode="expense"
        onSelectMode={onSelectMode}
        linkStartDate=""
        onLinkStartDateChange={vi.fn()}
        linkEndDate=""
        onLinkEndDateChange={vi.fn()}
        linkSearch=""
        onLinkSearchChange={vi.fn()}
        linkInvoices={[]}
        unlinkedExpenses={[
          makeExpense({ id: 51, amount: 45, allocationStatus: "PARTIALLY_ALLOCATED" }),
        ]}
        unlinkedTransactions={[]}
        selectedLinkId={51}
        onSelectLinkId={onSelectLinkId}
        linkPage={1}
        unlinkedTotalPages={2}
        onLinkPageChange={vi.fn()}
        isLinkingInvoice={false}
        isMatchingInvoice={false}
        onCancel={onCancel}
        onConfirmLink={onConfirmLink}
      />
    );

    expect(screen.getByText("Link Existing Expense")).toBeInTheDocument();
    expect(screen.getByText("Under-Allocated")).toBeInTheDocument();
    expect(screen.getByText("5100 Materials")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm Link" }));
    expect(onConfirmLink).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Invoices" }));
    expect(onSelectMode).toHaveBeenCalledWith("invoice");

    rerender(
      <DetailLinkPicker
        type="transaction"
        tx={makeTx({ amount: -45 })}
        activeExpense={null}
        linkTargetMode="invoice"
        onSelectMode={onSelectMode}
        linkStartDate=""
        onLinkStartDateChange={vi.fn()}
        linkEndDate=""
        onLinkEndDateChange={vi.fn()}
        linkSearch=""
        onLinkSearchChange={vi.fn()}
        linkInvoices={[makeInvoice({ id: 40 })]}
        unlinkedExpenses={[]}
        unlinkedTransactions={[]}
        selectedLinkId={40}
        onSelectLinkId={onSelectLinkId}
        linkPage={1}
        unlinkedTotalPages={1}
        onLinkPageChange={vi.fn()}
        isLinkingInvoice={false}
        isMatchingInvoice={false}
        onCancel={onCancel}
        onConfirmLink={onConfirmLink}
      />
    );

    expect(screen.getByText(/Only incoming deposits/)).toBeInTheDocument();
    expect(screen.getByText("1 invoice shown")).toBeInTheDocument();
    expect(screen.getByText("Bal $150.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match & Mark Paid" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("handles receipt mode with cash block notice, unlinked bank tx selection, date/search filters, invoice selection, and empty states", async () => {
    const user = userEvent.setup();
    const onSelectLinkId = vi.fn();
    const onSelectMode = vi.fn();
    const onLinkStartDateChange = vi.fn();
    const onLinkEndDateChange = vi.fn();
    const onLinkSearchChange = vi.fn();

    const { rerender } = render(
      <DetailLinkPicker
        type="receipt"
        tx={null}
        activeExpense={makeExpense({ tender: "CASH" })}
        linkTargetMode="tx"
        onSelectMode={onSelectMode}
        linkStartDate=""
        onLinkStartDateChange={onLinkStartDateChange}
        linkEndDate=""
        onLinkEndDateChange={onLinkEndDateChange}
        linkSearch=""
        onLinkSearchChange={onLinkSearchChange}
        linkInvoices={[]}
        unlinkedExpenses={[]}
        unlinkedTransactions={[
          makeTx({ id: 66, amount: -88.25, allocationStatus: "PARTIAL", description: "OFFICE DEPOT" }),
        ]}
        selectedLinkId={66}
        onSelectLinkId={onSelectLinkId}
        linkPage={1}
        unlinkedTotalPages={1}
        onLinkPageChange={vi.fn()}
        isLinkingInvoice={false}
        isMatchingInvoice={false}
        onCancel={vi.fn()}
        onConfirmLink={vi.fn()}
      />
    );

    expect(screen.getByText(/Cash expenses are auto-balanced/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Link" })).toBeDisabled();
    expect(screen.getByText("OFFICE DEPOT")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    fireEvent.change(screen.getByLabelText("Search Amount or Text"), { target: { value: "OFFICE" } });
    expect(onLinkStartDateChange).toHaveBeenCalledWith("2026-06-01");
    expect(onLinkEndDateChange).toHaveBeenCalledWith("2026-06-30");
    expect(onLinkSearchChange).toHaveBeenCalledWith("OFFICE");

    await user.click(screen.getByRole("button", { name: /OFFICE DEPOT/i }));
    expect(onSelectLinkId).toHaveBeenCalledWith(66);

    await user.click(screen.getByRole("button", { name: "Bank Transactions" }));
    expect(onSelectMode).toHaveBeenCalledWith("tx");

    // Invoice selection and empty invoice state
    rerender(
      <DetailLinkPicker
        type="receipt"
        tx={null}
        activeExpense={makeExpense({ tender: "CARD" })}
        linkTargetMode="invoice"
        onSelectMode={onSelectMode}
        linkStartDate=""
        onLinkStartDateChange={onLinkStartDateChange}
        linkEndDate=""
        onLinkEndDateChange={onLinkEndDateChange}
        linkSearch=""
        onLinkSearchChange={onLinkSearchChange}
        linkInvoices={[makeInvoice({ id: 44, invoiceNumber: "INV-044", clientName: "Widget LLC" })]}
        unlinkedExpenses={[]}
        unlinkedTransactions={[]}
        selectedLinkId={null}
        onSelectLinkId={onSelectLinkId}
        linkPage={1}
        unlinkedTotalPages={1}
        onLinkPageChange={vi.fn()}
        isLinkingInvoice={false}
        isMatchingInvoice={false}
        onCancel={vi.fn()}
        onConfirmLink={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /Widget LLC/i }));
    expect(onSelectLinkId).toHaveBeenCalledWith(44);

    // Transaction selecting expense Card and empty lists
    rerender(
      <DetailLinkPicker
        type="transaction"
        tx={makeTx({ amount: -45 })}
        activeExpense={null}
        linkTargetMode="expense"
        onSelectMode={onSelectMode}
        linkStartDate=""
        onLinkStartDateChange={onLinkStartDateChange}
        linkEndDate=""
        onLinkEndDateChange={onLinkEndDateChange}
        linkSearch=""
        onLinkSearchChange={onLinkSearchChange}
        linkInvoices={[]}
        unlinkedExpenses={[makeExpense({ id: 52, vendor: "Staples" })]}
        unlinkedTransactions={[]}
        selectedLinkId={null}
        onSelectLinkId={onSelectLinkId}
        linkPage={1}
        unlinkedTotalPages={1}
        onLinkPageChange={vi.fn()}
        isLinkingInvoice={false}
        isMatchingInvoice={false}
        onCancel={vi.fn()}
        onConfirmLink={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /Staples/i }));
    expect(onSelectLinkId).toHaveBeenCalledWith(52);

    rerender(
      <DetailLinkPicker
        type="transaction"
        tx={makeTx({ amount: -45 })}
        activeExpense={null}
        linkTargetMode="invoice"
        onSelectMode={onSelectMode}
        linkStartDate=""
        onLinkStartDateChange={onLinkStartDateChange}
        linkEndDate=""
        onLinkEndDateChange={onLinkEndDateChange}
        linkSearch=""
        onLinkSearchChange={onLinkSearchChange}
        linkInvoices={[]}
        unlinkedExpenses={[]}
        unlinkedTransactions={[]}
        selectedLinkId={null}
        onSelectLinkId={onSelectLinkId}
        linkPage={1}
        unlinkedTotalPages={1}
        onLinkPageChange={vi.fn()}
        isLinkingInvoice={false}
        isMatchingInvoice={false}
        onCancel={vi.fn()}
        onConfirmLink={vi.fn()}
      />
    );
    expect(screen.getByText("No matching invoices found.")).toBeInTheDocument();
  });
});

describe("DetailSubModals", () => {
  const accounts = [
    makeAccount({ id: 1, code: "1010", name: "Checking", type: "ASSET" }),
    makeAccount({ id: 2, code: "5100", name: "Supplies", type: "EXPENSE" }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Create & Link dialog for transaction and receipt modes and submits cleanly", async () => {
    const user = userEvent.setup();
    const onSubmitCreate = vi.fn();

    function ControlledCreateModal({ mode }: { mode: "transaction" | "receipt" }) {
      const [form, setForm] = useState<CreateFormState>({});
      return (
        <DetailSubModals
          type={mode}
          accounts={accounts}
          isSaving={false}
          isAllowing={false}
          showCreateModal={true}
          createForm={form}
          onChangeCreateForm={setForm}
          onCloseCreateModal={vi.fn()}
          onSubmitCreate={onSubmitCreate}
          ignoreTarget={null}
          onCloseIgnoreModal={vi.fn()}
          onConfirmIgnore={vi.fn()}
          actionChoiceModal={null}
          onCloseActionChoice={vi.fn()}
          onSelectActionChoice={vi.fn()}
          conflictModalData={null}
          onCloseConflictModal={vi.fn()}
          onResolveConflict={vi.fn()}
          replaceOrAddModalData={null}
          onCloseReplaceOrAddModal={vi.fn()}
          onAddSplitLink={vi.fn()}
          onReplaceLinks={vi.fn()}
          overAllocatedModalData={null}
          onCloseOverAllocatedModal={vi.fn()}
          onConfirmOverAllocated={vi.fn()}
          allowConfirmTarget={null}
          onCloseAllowConfirm={vi.fn()}
          onConfirmAllowClosed={vi.fn()}
        />
      );
    }

    const { rerender } = render(<ControlledCreateModal mode="transaction" />);
    expect(screen.getByText("Create & Link Expense")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create & Link" }));
    expect(onSubmitCreate).toHaveBeenCalledTimes(1);

    rerender(<ControlledCreateModal mode="receipt" />);
    expect(screen.getByText("Create & Link Transaction")).toBeInTheDocument();
  });

  it("renders and triggers callbacks across Ignore, ActionChoice, CategoryConflict, ReplaceOrAdd, OverAllocated, and AllowConfirm dialogs", async () => {
    const user = userEvent.setup();
    const onConfirmIgnore = vi.fn();
    const onSelectActionChoice = vi.fn();
    const onResolveConflict = vi.fn();
    const onAddSplitLink = vi.fn();
    const onReplaceLinks = vi.fn();
    const onConfirmOverAllocated = vi.fn();
    const onConfirmAllowClosed = vi.fn();

    const baseProps = {
      type: "transaction" as const,
      accounts,
      isSaving: false,
      isAllowing: false,
      showCreateModal: false,
      createForm: {},
      onChangeCreateForm: vi.fn(),
      onCloseCreateModal: vi.fn(),
      onSubmitCreate: vi.fn(),
      ignoreTarget: null,
      onCloseIgnoreModal: vi.fn(),
      onConfirmIgnore,
      actionChoiceModal: null,
      onCloseActionChoice: vi.fn(),
      onSelectActionChoice,
      conflictModalData: null,
      onCloseConflictModal: vi.fn(),
      onResolveConflict,
      replaceOrAddModalData: null,
      onCloseReplaceOrAddModal: vi.fn(),
      onAddSplitLink,
      onReplaceLinks,
      overAllocatedModalData: null,
      onCloseOverAllocatedModal: vi.fn(),
      onConfirmOverAllocated,
      allowConfirmTarget: null,
      onCloseAllowConfirm: vi.fn(),
      onConfirmAllowClosed,
    };

    const { rerender } = render(
      <DetailSubModals
        {...baseProps}
        ignoreTarget={{ type: "transaction", id: 20, linkedChoice: "ONLY_THIS" }}
      />
    );
    expect(screen.getByText(/sever the link\(s\)/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm Ignore" }));
    expect(onConfirmIgnore).toHaveBeenCalledWith({
      type: "transaction",
      id: 20,
      linkedChoice: "ONLY_THIS",
    });

    rerender(
      <DetailSubModals
        {...baseProps}
        actionChoiceModal={{ action: "EXCLUDE", targetType: "transaction", targetId: 20 }}
      />
    );
    await user.click(screen.getByRole("button", { name: /Unlink & Exclude Only This Item/i }));
    expect(onSelectActionChoice).toHaveBeenCalledWith("ONLY_THIS", {
      action: "EXCLUDE",
      targetType: "transaction",
      targetId: 20,
    });
    await user.click(screen.getByRole("button", { name: /Exclude All Linked Items/i }));
    expect(onSelectActionChoice).toHaveBeenCalledWith("ALL_LINKED", {
      action: "EXCLUDE",
      targetType: "transaction",
      targetId: 20,
    });

    const conflictData = {
      expenseId: 30,
      transactionId: 20,
      txCategory: { id: 101, code: "5100", name: "Supplies", active: false },
      expCategory: { id: 102, code: "5200", name: "Travel", active: true },
    };
    rerender(<DetailSubModals {...baseProps} conflictModalData={conflictData} />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /5200 — Travel/i }));
    expect(onResolveConflict).toHaveBeenCalledWith(102, conflictData);

    const replaceData = { selectedLinkId: 77 };
    rerender(<DetailSubModals {...baseProps} replaceOrAddModalData={replaceData} />);
    await user.click(screen.getByRole("button", { name: /Add to Existing \(Split\)/i }));
    expect(onAddSplitLink).toHaveBeenCalledWith(replaceData);
    await user.click(screen.getByRole("button", { name: /Replace Existing/i }));
    expect(onReplaceLinks).toHaveBeenCalledWith(replaceData);

    const overData = {
      expenseId: 30,
      transactionId: 20,
      message: "Linked amounts exceed bank transaction by $20.00.",
    };
    rerender(<DetailSubModals {...baseProps} overAllocatedModalData={overData} />);
    expect(screen.getByText(/exceed bank transaction/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Link Anyway" }));
    expect(onConfirmOverAllocated).toHaveBeenCalledWith(overData);

    const allowData = { type: "expense" as const, id: 30, date: "2026-06-15T00:00:00Z" };
    rerender(<DetailSubModals {...baseProps} allowConfirmTarget={allowData} />);
    expect(screen.getByText("2026-06-14")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm & Reopen Books" }));
    expect(onConfirmAllowClosed).toHaveBeenCalledWith(allowData);
  });
});
