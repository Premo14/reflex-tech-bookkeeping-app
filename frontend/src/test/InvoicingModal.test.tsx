import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import InvoicingModal from "@/components/InvoicingModal";
import { ConfirmationProvider } from "@/components/ui/ConfirmDialog";
import type {
  BankTransaction,
  ChartAccount,
  Invoice,
  InvoiceSummary,
  ScoredDepositCandidate,
} from "@/types/models";
import * as api from "@/services/api";

vi.mock("@/services/api", () => ({
  getInvoices: vi.fn(),
  createInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  matchInvoicePayment: vi.fn(),
  markInvoicePaidCash: vi.fn(),
  unmatchInvoicePayment: vi.fn(),
  getInvoiceCandidates: vi.fn(),
  getChartAccounts: vi.fn(),
}));

vi.mock("@/components/DetailDrawer", () => ({
  default: ({
    type,
    id,
    onClose,
    onEditInvoice,
    onPrintInvoice,
  }: {
    type: string | null;
    id: number | null;
    onClose: () => void;
    onEditInvoice?: (inv: Invoice) => void;
    onPrintInvoice?: (inv: Invoice) => void;
  }) =>
    type && id != null ? (
      <div data-testid="mock-detail-drawer">
        <span>Drawer {type}:{id}</span>
        <button type="button" onClick={onClose}>
          Close Drawer
        </button>
        <button
          type="button"
          onClick={() => onEditInvoice?.(SAMPLE_INVOICES[0])}
        >
          Drawer Edit
        </button>
        <button
          type="button"
          onClick={() => onPrintInvoice?.(SAMPLE_INVOICES[1])}
        >
          Drawer Print
        </button>
      </div>
    ) : null,
}));

const mockedApi = vi.mocked(api);

const REVENUE_ACCOUNTS: ChartAccount[] = [
  {
    id: 40,
    code: "4010",
    name: "Consulting Revenue",
    type: "REVENUE",
    description: "Advisory & engineering",
    active: true,
    isDefault: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const SAMPLE_SUMMARY: InvoiceSummary = {
  totalInvoiced: 4550,
  totalPaid: 1500,
  totalUnpaid: 3050,
  overdueCount: 1,
  invoiceCount: 4,
};

const BANK_DEPOSIT: BankTransaction = {
  id: 900,
  isManual: false,
  transactionType: "CREDIT",
  reviewStatus: "APPROVED",
  fitId: "DEP-900",
  date: "2026-06-15T00:00:00Z",
  description: "ACH NORTHSTAR LABS",
  amount: 1350,
  allocationStatus: "BALANCED",
  chartAccountId: 1,
  chartAccount: {
    id: 1,
    code: "1010",
    name: "Operating Checking",
    type: "ASSET",
    description: "",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
};

const CASH_DEPOSIT: BankTransaction = {
  id: 901,
  isManual: true,
  transactionType: "CREDIT",
  reviewStatus: "APPROVED",
  fitId: "CASH-INV-202",
  date: "2026-06-10T00:00:00Z",
  description: "Cash Payment — INV-2026-002",
  amount: 500,
  allocationStatus: "BALANCED",
  chartAccountId: 2,
};

const SAMPLE_INVOICES: Invoice[] = [
  {
    id: 201,
    invoiceNumber: "INV-2026-001",
    clientName: "Northstar Labs",
    clientEmail: "ap@northstar.test",
    clientAddress: "100 Main St\nUtica, NY",
    issueDate: "2026-06-01T00:00:00Z",
    dueDate: "2026-07-01T00:00:00Z",
    paymentTerms: "Net 30",
    status: "SENT",
    items: JSON.stringify([
      { description: "Consulting", quantity: 2, unitPrice: 625, amount: 1250 },
    ]),
    subtotal: 1250,
    taxRate: 8,
    taxAmount: 100,
    totalAmount: 1350,
    amountPaid: 0,
    balanceDue: 1350,
    notes: "ACH preferred",
    categoryAccountId: 40,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  },
  {
    id: 202,
    invoiceNumber: "INV-2026-002",
    clientName: "Cash Client LLC",
    clientEmail: "",
    clientAddress: "",
    issueDate: "2026-06-05T00:00:00Z",
    dueDate: "2026-06-05T00:00:00Z",
    paymentTerms: "Due Upon Receipt",
    status: "PAID",
    items: "{bad-json",
    subtotal: 500,
    taxRate: 0,
    taxAmount: 0,
    totalAmount: 500,
    amountPaid: 500,
    balanceDue: 0,
    paidDate: "2026-06-10T00:00:00Z",
    notes: "",
    bankTransaction: CASH_DEPOSIT,
    createdAt: "2026-06-05T00:00:00Z",
    updatedAt: "2026-06-10T00:00:00Z",
  },
  {
    id: 203,
    invoiceNumber: "INV-2026-003",
    clientName: "Partial Co",
    clientEmail: "",
    clientAddress: "",
    issueDate: "2026-05-01T00:00:00Z",
    dueDate: "2026-05-31T00:00:00Z",
    paymentTerms: "Net 30",
    status: "PARTIALLY_PAID",
    items: JSON.stringify([
      { description: "Phase 1", quantity: 1, unitPrice: 1200, amount: 1200 },
    ]),
    subtotal: 1200,
    taxRate: 0,
    taxAmount: 0,
    totalAmount: 1200,
    amountPaid: 400,
    balanceDue: 800,
    notes: "",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-15T00:00:00Z",
  },
  {
    id: 204,
    invoiceNumber: "INV-2026-004",
    clientName: "Late Payer Inc",
    clientEmail: "",
    clientAddress: "",
    issueDate: "2026-04-01T00:00:00Z",
    dueDate: "2026-04-15T00:00:00Z",
    paymentTerms: "Net 15",
    status: "OVERDUE",
    items: "[]",
    subtotal: 1500,
    taxRate: 0,
    taxAmount: 0,
    totalAmount: 1500,
    notes: "",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  },
];

const CANDIDATES: ScoredDepositCandidate[] = [
  {
    score: 98,
    reason: "Exact Amount & Client Match",
    transaction: BANK_DEPOSIT,
  },
];

function wrapModal(ui: React.ReactElement) {
  return render(<ConfirmationProvider>{ui}</ConfirmationProvider>);
}

async function selectCustomOption(combobox: HTMLElement, optionName: string | RegExp) {
  await userEvent.click(combobox);
  const listbox = await screen.findByRole("listbox");
  await userEvent.click(within(listbox).getByRole("option", { name: optionName }));
}

describe("S21 InvoicingModal & Extracted Subcomponents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getChartAccounts.mockResolvedValue(REVENUE_ACCOUNTS);
    mockedApi.getInvoices.mockResolvedValue({
      status: "ok",
      invoices: SAMPLE_INVOICES,
      summary: SAMPLE_SUMMARY,
    });
    mockedApi.createInvoice.mockResolvedValue({ status: "created", invoice: SAMPLE_INVOICES[0] });
    mockedApi.updateInvoice.mockResolvedValue({ status: "updated", invoice: SAMPLE_INVOICES[0] });
    mockedApi.deleteInvoice.mockResolvedValue({ status: "deleted" });
    mockedApi.getInvoiceCandidates.mockResolvedValue({ status: "ok", candidates: CANDIDATES });
    mockedApi.matchInvoicePayment.mockResolvedValue({
      status: "matched",
      invoice: SAMPLE_INVOICES[0],
      message: "Matched ACH NORTHSTAR LABS to INV-2026-001",
    });
    mockedApi.markInvoicePaidCash.mockResolvedValue({
      status: "paid",
      invoice: SAMPLE_INVOICES[1],
      message: "Paid in cash via 1030",
    });
    mockedApi.unmatchInvoicePayment.mockResolvedValue({ status: "unmatched", invoice: SAMPLE_INVOICES[0] });
  });

  it("renders KPI summary cards, filters by status and search, and shows empty state", async () => {
    const user = userEvent.setup();
    wrapModal(<InvoicingModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByText("INV-2026-001")).toBeInTheDocument();
    expect(screen.getByText("$4,550.00")).toBeInTheDocument();
    expect(screen.getByText("$3,050.00")).toBeInTheDocument();
    expect(screen.getAllByText("$1,500.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("✓ Cash Receipt")).toBeInTheDocument();
    expect(screen.getByText("PARTIAL")).toBeInTheDocument();
    expect(screen.getByText("Bal: $800.00")).toBeInTheDocument();
    expect(screen.getByText("OVERDUE")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Overdue" }));
    await waitFor(() => {
      expect(mockedApi.getInvoices).toHaveBeenCalledWith({ status: "OVERDUE", search: "" });
    });

    const searchInput = screen.getByLabelText("Search client or invoice number");
    await user.type(searchInput, "Northstar");
    await waitFor(() => {
      expect(mockedApi.getInvoices).toHaveBeenLastCalledWith({
        status: "OVERDUE",
        search: "Northstar",
      });
    });

    mockedApi.getInvoices.mockResolvedValueOnce({
      status: "ok",
      invoices: [],
      summary: { totalInvoiced: 0, totalPaid: 0, totalUnpaid: 0, overdueCount: 0, invoiceCount: 0 },
    });
    await user.click(screen.getByRole("button", { name: "Clear invoice search" }));
    expect(await screen.findByText("No invoices found")).toBeInTheDocument();
  });

  it("validates, adds/removes line items, computes exact cents, and creates an invoice", async () => {
    const user = userEvent.setup();
    const onInvoicesUpdated = vi.fn();

    wrapModal(<InvoicingModal isOpen onClose={vi.fn()} onInvoicesUpdated={onInvoicesUpdated} />);

    await screen.findByText("INV-2026-001");
    await user.click(screen.getByRole("button", { name: "+ New Invoice" }));
    expect(await screen.findByText("Create Client Invoice")).toBeInTheDocument();

    // Missing client name validation
    await user.click(screen.getByRole("button", { name: "Create Invoice" }));
    expect(await screen.findByRole("dialog", { name: "Validation Error" })).toHaveTextContent(
      "Client name is required."
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    // Fill client info + test due date term recalculation
    await user.type(screen.getByLabelText(/Client Name/i), "Utica Manufacturing");
    await user.type(screen.getByLabelText(/Client Email/i), "ap@utica.test");
    await user.type(screen.getByLabelText(/Client Billing Address/i), "200 Genesee St");
    await user.clear(screen.getByLabelText("Issue Date"));
    await user.type(screen.getByLabelText("Issue Date"), "2026-06-01");
    await selectCustomOption(screen.getByLabelText("Payment Deadline"), /Net 15/i);
    expect(screen.getByLabelText("Due Date")).toHaveValue("2026-06-16");

    // Add second blank line -> triggers line item validation, then fill, then remove
    await user.click(screen.getByRole("button", { name: "+ Add Line Item" }));
    await user.click(screen.getByRole("button", { name: "Create Invoice" }));
    expect(await screen.findByRole("dialog", { name: "Validation Error" })).toHaveTextContent(
      /all line items have descriptions and valid amounts/i
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.type(screen.getByLabelText("Line item 2 description"), "Cabling");
    await user.clear(screen.getByLabelText("Line item 2 quantity"));
    await user.type(screen.getByLabelText("Line item 2 quantity"), "2");
    await user.clear(screen.getByLabelText("Line item 2 unit price"));
    await user.type(screen.getByLabelText("Line item 2 unit price"), "10.05");
    expect(screen.getAllByText("$520.10").length).toBeGreaterThanOrEqual(2);

    // Tax rate out of range validation (> 100)
    const taxInput = screen.getByLabelText("Tax Rate (%):");
    await user.clear(taxInput);
    await user.type(taxInput, "120");
    await user.click(screen.getByRole("button", { name: "Create Invoice" }));
    expect(await screen.findByRole("dialog", { name: "Validation Error" })).toHaveTextContent(
      "Tax rate must be between 0% and 100%."
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.clear(taxInput);
    await user.type(taxInput, "8");
    await user.click(screen.getByRole("button", { name: "Remove line item 2" }));
    expect(screen.getByText("$540.00")).toBeInTheDocument(); // 500 + 8% = 540

    // Save fails first, then succeeds
    mockedApi.createInvoice.mockRejectedValueOnce(new Error("Closed period lock"));
    await user.click(screen.getByRole("button", { name: "Create Invoice" }));
    expect(await screen.findByRole("dialog", { name: "Error Saving Invoice" })).toHaveTextContent(
      "Closed period lock"
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.click(screen.getByRole("button", { name: "Create Invoice" }));
    await waitFor(() => {
      expect(mockedApi.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          clientName: "Utica Manufacturing",
          clientEmail: "ap@utica.test",
          clientAddress: "200 Genesee St",
          paymentTerms: "Net 15",
          taxRate: 8,
        })
      );
    });
    expect(onInvoicesUpdated).toHaveBeenCalled();
  });

  it("edits an invoice (handling invalid JSON items), deletes an invoice, and handles errors", async () => {
    const user = userEvent.setup();
    const onInvoicesUpdated = vi.fn();

    wrapModal(<InvoicingModal isOpen onClose={vi.fn()} onInvoicesUpdated={onInvoicesUpdated} />);

    // Edit INV-2026-002 (has "{bad-json" items -> falls back to Services single item)
    await screen.findByText("INV-2026-002");
    await user.click(screen.getByRole("button", { name: "Edit invoice INV-2026-002" }));
    expect(await screen.findByText("Edit Invoice")).toBeInTheDocument();
    expect(screen.getByLabelText("Line item 1 description")).toHaveValue("Services");

    await selectCustomOption(screen.getByLabelText("Status"), "VOID");
    await user.click(screen.getByRole("button", { name: "Update Invoice" }));
    await waitFor(() => {
      expect(mockedApi.updateInvoice).toHaveBeenCalledWith(
        202,
        expect.objectContaining({ status: "VOID", clientName: "Cash Client LLC" })
      );
    });

    // Delete invoice: cancel -> fail -> succeed
    await user.click(screen.getByRole("button", { name: "Delete invoice INV-2026-001" }));
    expect(await screen.findByRole("dialog", { name: "Delete Invoice" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockedApi.deleteInvoice).not.toHaveBeenCalled();

    mockedApi.deleteInvoice.mockRejectedValueOnce(new Error("Protected linked invoice"));
    await user.click(screen.getByRole("button", { name: "Delete invoice INV-2026-001" }));
    await user.click(await screen.findByRole("button", { name: "Delete Invoice" }));
    expect(await screen.findByRole("dialog", { name: "Error" })).toHaveTextContent(
      "Protected linked invoice"
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.click(screen.getByRole("button", { name: "Delete invoice INV-2026-001" }));
    await user.click(await screen.findByRole("button", { name: "Delete Invoice" }));
    await waitFor(() => {
      expect(mockedApi.deleteInvoice).toHaveBeenCalledWith(201);
    });
  });

  it("matches deposit candidates, settles cash payments, and unmatches payments", async () => {
    const user = userEvent.setup();
    const onInvoicesUpdated = vi.fn();

    wrapModal(<InvoicingModal isOpen onClose={vi.fn()} onInvoicesUpdated={onInvoicesUpdated} />);
    await screen.findByText("INV-2026-001");

    // Empty candidates branch
    mockedApi.getInvoiceCandidates.mockResolvedValueOnce({ status: "ok", candidates: [] });
    await user.click(screen.getAllByRole("button", { name: "Match Deposit" })[0]);
    expect(await screen.findByText("No matching bank deposits found.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    // With candidate match -> failure + success
    await user.click(screen.getAllByRole("button", { name: "Match Deposit" })[0]);
    expect(await screen.findByText("ACH NORTHSTAR LABS")).toBeInTheDocument();
    expect(screen.getByText("Exact Amount & Client Match")).toBeInTheDocument();

    mockedApi.matchInvoicePayment.mockRejectedValueOnce(new Error("Amount mismatch"));
    await user.click(screen.getByRole("button", { name: "Match" }));
    expect(await screen.findByRole("dialog", { name: "Match Failed" })).toHaveTextContent(
      "Amount mismatch"
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.click(screen.getByRole("button", { name: "Match" }));
    expect(await screen.findByRole("dialog", { name: "Payment Matched!" })).toHaveTextContent(
      "Matched ACH NORTHSTAR LABS to INV-2026-001"
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    // Pay Cash from inside Match Deposit modal ("Or Mark Paid in Cash") -> cancel first, then confirm
    await user.click(screen.getAllByRole("button", { name: "Match Deposit" })[0]);
    await user.click(await screen.findByRole("button", { name: "Or Mark Paid in Cash" }));
    expect(await screen.findByRole("dialog", { name: "Mark Paid in Cash" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    // Pay Cash -> fail + succeed
    await user.click(screen.getAllByRole("button", { name: "Pay Cash" })[0]);
    expect(await screen.findByRole("dialog", { name: "Mark Paid in Cash" })).toBeInTheDocument();
    mockedApi.markInvoicePaidCash.mockRejectedValueOnce(new Error("Cash ledger locked"));
    await user.click(screen.getByRole("button", { name: "Confirm Cash Payment" }));
    expect(await screen.findByRole("dialog", { name: "Cash Payment Failed" })).toHaveTextContent(
      "Cash ledger locked"
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.click(screen.getAllByRole("button", { name: "Pay Cash" })[0]);
    await user.click(await screen.findByRole("button", { name: "Confirm Cash Payment" }));
    expect(await screen.findByRole("dialog", { name: "Marked Paid in Cash" })).toHaveTextContent(
      "Paid in cash via 1030"
    );
    await user.click(screen.getByRole("button", { name: "OK" }));

    // Unmatch payment -> fail + succeed
    await user.click(screen.getByRole("button", { name: "Unmatch" }));
    mockedApi.unmatchInvoicePayment.mockRejectedValueOnce(new Error("Closed period"));
    await user.click(await screen.findByRole("button", { name: "Unlink Payment" }));
    expect(await screen.findByRole("dialog", { name: "Error" })).toHaveTextContent("Closed period");
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.click(screen.getByRole("button", { name: "Unmatch" }));
    await user.click(await screen.findByRole("button", { name: "Unlink Payment" }));
    await waitFor(() => {
      expect(mockedApi.unmatchInvoicePayment).toHaveBeenCalledWith(202);
    });
  });

  it("opens print preview with company fallback, partial payments, and triggers window.print", async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    wrapModal(<InvoicingModal isOpen onClose={vi.fn()} companyName="   " />);

    await screen.findByText("INV-2026-003");
    await user.click(screen.getByRole("button", { name: "Print invoice INV-2026-003" }));

    const dialog = await screen.findByRole("dialog", { name: "Invoice INV-2026-003" });
    expect(within(dialog).getByText("Unnamed Company")).toBeInTheDocument();
    expect(within(dialog).getByText("Phase 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Amount Paid:")).toBeInTheDocument();
    expect(within(dialog).getByText("-$400.00")).toBeInTheDocument();
    expect(within(dialog).getByText("Balance Due:")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Print / Save PDF" }));
    expect(printSpy).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Invoice INV-2026-003" })).not.toBeInTheDocument();
    printSpy.mockRestore();
  });

  it("handles deep-linking modes (edit, print, inspect) and DetailDrawer callbacks", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <ConfirmationProvider>
        <InvoicingModal isOpen onClose={vi.fn()} initialInvoiceId={201} initialMode="edit" companyName="Reflex Co" />
      </ConfirmationProvider>
    );
    expect(await screen.findByText("Edit Invoice")).toBeInTheDocument();

    rerender(
      <ConfirmationProvider>
        <InvoicingModal isOpen onClose={vi.fn()} initialInvoiceId={201} initialMode="print" companyName="Reflex Co" />
      </ConfirmationProvider>
    );
    const printModal = await screen.findByRole("dialog", { name: "Invoice INV-2026-001" });
    expect(within(printModal).getByText("Reflex Co")).toBeInTheDocument();
    expect(within(printModal).getByText("Tax (8%):")).toBeInTheDocument();
    await user.click(within(printModal).getByRole("button", { name: "Close" }));

    // Row click opens DetailDrawer; test its edit/print/close callbacks
    await user.click(screen.getByText("INV-2026-001"));
    expect(await screen.findByTestId("mock-detail-drawer")).toHaveTextContent("Drawer invoice:201");

    await user.click(screen.getByRole("button", { name: "Drawer Print" }));
    expect(await screen.findByRole("dialog", { name: "Invoice INV-2026-002" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "Invoice INV-2026-002" })).getByRole("button", { name: "Close" }));

    await user.click(screen.getByText("INV-2026-001"));
    await user.click(await screen.findByRole("button", { name: "Drawer Edit" }));
    expect(await screen.findByText("Edit Invoice")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByText("INV-2026-001"));
    await user.click(await screen.findByRole("button", { name: "Close Drawer" }));
    expect(screen.queryByTestId("mock-detail-drawer")).not.toBeInTheDocument();

    // Closed modal returns null
    rerender(
      <ConfirmationProvider>
        <InvoicingModal isOpen={false} onClose={vi.fn()} />
      </ConfirmationProvider>
    );
    await waitFor(() => {
      expect(screen.queryByText("Invoices & Client Receivables")).not.toBeInTheDocument();
    });
  });
});
