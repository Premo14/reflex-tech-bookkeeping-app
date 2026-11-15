import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import CreateExpenseForm, {
  type ManualExpenseFormState,
} from "@/components/CreateExpenseForm";
import CreateTransactionForm, {
  type ManualTransactionFormState,
} from "@/components/CreateTransactionForm";
import FileUploader from "@/components/FileUploader";
import UploadModal from "@/components/UploadModal";
import SplitExpenseModal from "@/components/SplitExpenseModal";
import ExcludeItemModal from "@/components/ExcludeItemModal";
import { ConfirmationProvider } from "@/components/ui/ConfirmDialog";
import * as api from "@/services/api";
import type { ChartAccount, Expense } from "@/types/models";

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    uploadFile: vi.fn(),
    splitExpense: vi.fn(),
    previewExclusion: vi.fn(),
    previewBulkExclusion: vi.fn(),
    excludeItem: vi.fn(),
    excludeItems: vi.fn(),
  };
});

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

const accounts: ChartAccount[] = [
  makeAccount({ id: 1, code: "1010", name: "Business Checking", type: "ASSET" }),
  makeAccount({ id: 2, code: "2100", name: "Business Visa", type: "LIABILITY" }),
  makeAccount({ id: 3, code: "4010", name: "Consulting Income", type: "REVENUE" }),
  makeAccount({ id: 4, code: "5010", name: "Office Supplies", type: "EXPENSE" }),
];

const sampleExpense: Expense = {
  id: 77,
  isManual: false,
  vendor: "Target",
  description: "Supplies & snacks",
  amount: 10.01,
  taxAmount: 0,
  currencyCode: "USD",
  tender: "CARD",
  chartAccountId: 4,
  timestamp: "2026-04-02T12:00:00Z",
  createdAt: "2026-04-02T12:00:00Z",
  updatedAt: "2026-04-02T12:00:00Z",
};

describe("CreateExpenseForm", () => {
  it("updates fields cleanly including category, money inputs, and file attachment/removal", async () => {
    const user = userEvent.setup();
    const latest: { form: ManualExpenseFormState } = { form: { tender: "CARD" } };

    function Harness() {
      const [form, setForm] = useState<ManualExpenseFormState>({ tender: "CARD" });
      return (
        <CreateExpenseForm
          form={form}
          setForm={(next) => {
            latest.form = next;
            setForm(next);
          }}
          accounts={accounts}
        />
      );
    }

    render(<Harness />);

    const dateInput = screen.getByLabelText("Date");
    fireEvent.change(dateInput, { target: { value: "2026-04-10" } });
    expect(latest.form.timestamp).toBe("2026-04-10");

    await user.click(screen.getByLabelText("Tender"));
    await user.click(screen.getByRole("option", { name: "CASH" }));
    expect(latest.form.tender).toBe("CASH");

    const totalInput = screen.getByLabelText("Total");
    fireEvent.change(totalInput, { target: { value: "54.25" } });
    fireEvent.blur(totalInput);
    expect(latest.form.amount).toBe(54.25);

    const taxInput = screen.getByLabelText("Tax");
    fireEvent.change(taxInput, { target: { value: "4.25" } });
    fireEvent.blur(taxInput);
    expect(latest.form.taxAmount).toBe(4.25);

    await user.click(screen.getByLabelText("Currency"));
    await user.click(screen.getByRole("option", { name: "CAD" }));
    expect(latest.form.currencyCode).toBe("CAD");

    await user.type(screen.getByLabelText("Vendor"), "Staples");
    expect(latest.form.vendor).toBe("Staples");

    await user.type(screen.getByLabelText("Description"), "Copy paper");
    await user.click(screen.getByLabelText("Category (Optional)"));
    await user.click(screen.getByRole("option", { name: /Office Supplies/i }));
    expect(latest.form.chartAccountId).toBe(4);

    await user.type(screen.getByLabelText("Notes (Optional)"), "Q2 restock");

    const fileInput = screen.getByLabelText("Receipt Attachment (Optional)");
    const testFile = new File(["img"], "staples.png", { type: "image/png" });
    await user.upload(fileInput, testFile);
    expect(screen.getByText(/staples\.png attached/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(latest.form.receiptFile).toBeNull();
  });
});

describe("CreateTransactionForm", () => {
  it("coerces signs when toggling between outgoing DEBIT and incoming DEP types", async () => {
    const user = userEvent.setup();
    const latest: { form: ManualTransactionFormState } = {
      form: { transactionType: "DEBIT", amount: -45 },
    };

    function Harness() {
      const [form, setForm] = useState<ManualTransactionFormState>({
        transactionType: "DEBIT",
        amount: -45,
      });
      return (
        <CreateTransactionForm
          form={form}
          setForm={(next) => {
            latest.form = next;
            setForm(next);
          }}
          accounts={accounts}
          defaultBankAccountId={1}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByText(/Outgoing transaction/i)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Bank / Card Account (Required)"));
    await user.click(screen.getByRole("option", { name: /Business Visa/i }));
    expect(latest.form.chartAccountId).toBe(2);

    // Switch Type -> DEP flips amount positive & shows Incoming copy
    await user.click(screen.getByLabelText("Type"));
    await user.click(screen.getByRole("option", { name: "Deposit (money in)" }));
    expect(latest.form.transactionType).toBe("DEP");
    expect(latest.form.amount).toBe(45);
    expect(screen.getByText(/Incoming transaction/i)).toBeInTheDocument();

    // Editing negative value on DEP auto-coerces positive
    const amtInput = screen.getByLabelText("Amount");
    fireEvent.change(amtInput, { target: { value: "-88.50" } });
    expect(latest.form.amount).toBe(88.5);

    // Switch back to PAYMENT -> flips positive back to negative
    await user.click(screen.getByLabelText("Type"));
    await user.click(screen.getByRole("option", { name: "Payment (money out)" }));
    expect(latest.form.amount).toBe(-88.5);
    fireEvent.change(amtInput, { target: { value: "25.00" } });
    expect(latest.form.amount).toBe(-25);

    // Select Category & update Description & Notes
    await user.click(screen.getByLabelText("Category (Optional)"));
    await user.click(screen.getByRole("option", { name: /Office Supplies/i }));
    expect(latest.form.categoryAccountId).toBe(4);

    await user.type(screen.getByLabelText("Description"), "Client retainer");
    await user.type(screen.getByLabelText("Notes (Optional)"), "ACH settled");
    expect(latest.form.description).toBe("Client retainer");
    expect(latest.form.notes).toBe("ACH settled");

    // Date change
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-04-12" },
    });
    expect(latest.form.date).toBe("2026-04-12");
  });
});

describe("FileUploader & UploadModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads single and multiple dropped files inside UploadModal and reports errors cleanly", async () => {
    const onUploadSuccess = vi.fn();
    const onClose = vi.fn();
    vi.mocked(api.uploadFile).mockResolvedValue({ status: "ok" });

    const { rerender } = render(
      <ConfirmationProvider>
        <UploadModal isOpen={false} onClose={onClose} onUploadSuccess={onUploadSuccess} />
      </ConfirmationProvider>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <ConfirmationProvider>
        <UploadModal isOpen onClose={onClose} onUploadSuccess={onUploadSuccess} />
      </ConfirmationProvider>
    );

    const dropzone = screen.getByRole("button", { name: "Upload financial documents" });
    fireEvent.dragEnter(dropzone);
    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);

    const file1 = new File(["a"], "a.pdf", { type: "application/pdf" });
    const file2 = new File(["b"], "b.jpg", { type: "image/jpeg" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file1, file2] } });

    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(2));
    expect(onUploadSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    const alertDlg = await screen.findByRole("dialog", { name: "Upload Complete" });
    expect(
      within(alertDlg).getByText("2 files uploaded successfully! They are now being processed.")
    ).toBeInTheDocument();
  });

  it("uploads via file input and shows inline alert when upload fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadFile)
      .mockResolvedValueOnce({ status: "ok" })
      .mockRejectedValueOnce(new Error("Unsupported file signature"));

    render(
      <ConfirmationProvider>
        <FileUploader />
      </ConfirmationProvider>
    );

    const dropzone = screen.getByRole("button", { name: "Upload financial documents" });
    fireEvent.keyDown(dropzone, { key: "Enter" });
    fireEvent.keyDown(dropzone, { key: " " });

    const input = screen.getByLabelText("Select files to upload");
    await user.upload(input, new File(["ok"], "ok.ofx", { type: "text/plain" }));
    const okDlg = await screen.findByRole("dialog", { name: "Upload Complete" });
    await user.click(within(okDlg).getByRole("button", { name: "OK" }));

    await user.upload(input, new File(["bad"], "bad.pdf", { type: "application/pdf" }));
    const err = await screen.findByRole("alert");
    expect(err).toHaveTextContent("Unsupported file signature");
  });
});

describe("SplitExpenseModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes exact cent split ($5.01 / $5.00), validates balance & zero rows, and submits", async () => {
    const user = userEvent.setup();
    const onSplitSuccess = vi.fn();
    const onClose = vi.fn();
    vi.mocked(api.splitExpense).mockResolvedValue({
      originalExpense: sampleExpense,
      createdExpenses: [],
      message: "ok",
    });

    render(
      <ConfirmationProvider>
        <SplitExpenseModal
          isOpen
          onClose={onClose}
          expense={sampleExpense}
          accounts={accounts}
          onSplitSuccess={onSplitSuccess}
        />
      </ConfirmationProvider>
    );

    await waitFor(() =>
      expect(screen.getByText("✓ Balanced (100%)")).toBeInTheDocument()
    );
    expect(screen.getByText("Personal / Non-Deductible")).toBeInTheDocument();

    // Modify row 1 to create $1.00 shortfall -> triggers Unbalanced Split alert
    const amountInputs = screen.getAllByLabelText("Amount ($)");
    fireEvent.change(amountInputs[0], { target: { value: "4.01" } });
    fireEvent.blur(amountInputs[0]);

    await waitFor(() =>
      expect(screen.getByText("Remaining: $1.00")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "Apply Receipt Split" }));
    const unbalancedDlg = await screen.findByRole("dialog", {
      name: "Unbalanced Split",
    });
    expect(within(unbalancedDlg).getByText(/Difference: \$1\.00/)).toBeInTheDocument();
    await user.click(within(unbalancedDlg).getByRole("button", { name: "OK" }));

    // Fill Remaining restores balance cleanly
    const fillBtns = screen.getAllByRole("button", { name: "Fill Remaining" });
    await user.click(fillBtns[0]);
    await waitFor(() =>
      expect(screen.getByText("✓ Balanced (100%)")).toBeInTheDocument()
    );

    // Add 3rd line ($0 while already balanced), submit -> Invalid Amount
    await user.click(screen.getByRole("button", { name: "+ Add Another Split Line" }));
    await user.click(screen.getByRole("button", { name: "Apply Receipt Split" }));
    const invalidDlg = await screen.findByRole("dialog", {
      name: "Invalid Amount",
    });
    await user.click(within(invalidDlg).getByRole("button", { name: "OK" }));

    // Remove 3rd line, toggle Personal checkbox off on row 2? Keep row 2 personal & submit
    await user.click(screen.getByRole("button", { name: "Remove split line 3" }));
    await user.click(screen.getByRole("button", { name: "Apply Receipt Split" }));

    await waitFor(() =>
      expect(api.splitExpense).toHaveBeenCalledWith(77, [
        {
          amount: 5.01,
          chartAccountId: 4,
          description: "Supplies & snacks",
          vendor: "Target",
          isPersonal: false,
        },
        {
          amount: 5,
          chartAccountId: null,
          description: "Personal items / Non-deductible",
          vendor: "Target",
          isPersonal: true,
        },
      ])
    );
    expect(onSplitSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("displays Alert dialog when splitExpense API fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.splitExpense).mockRejectedValueOnce(new Error("Closed period"));

    render(
      <ConfirmationProvider>
        <SplitExpenseModal
          isOpen
          onClose={vi.fn()}
          expense={sampleExpense}
          accounts={accounts}
          onSplitSuccess={vi.fn()}
        />
      </ConfirmationProvider>
    );

    await waitFor(() =>
      expect(screen.getByText("✓ Balanced (100%)")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "Apply Receipt Split" }));

    const errDlg = await screen.findByRole("dialog", {
      name: "Error Splitting Receipt",
    });
    expect(within(errDlg).getByText("Closed period")).toBeInTheDocument();
  });
});

describe("ExcludeItemModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads preview with linked items, requires note for OTHER reason, and submits exclusion", async () => {
    const user = userEvent.setup();
    const onBeforeSubmit = vi.fn().mockResolvedValue(undefined);
    const onExcluded = vi.fn();

    vi.mocked(api.previewExclusion).mockResolvedValue({
      blocked: false,
      blockedReason: "",
      items: [
        {
          type: "transaction",
          id: 10,
          label: "Target Purchase",
          amount: -10.01,
          date: "2026-04-02T00:00:00Z",
          reviewStatus: "",
        },
        {
          type: "expense",
          id: 77,
          label: "Target Receipt",
          amount: 10.01,
          date: "2026-04-02T00:00:00Z",
          reviewStatus: "",
        },
      ],
    });
    vi.mocked(api.excludeItem).mockResolvedValue({ status: "ok", affected: [] });

    render(
      <ExcludeItemModal
        isOpen
        onClose={vi.fn()}
        itemType="transaction"
        itemId={10}
        onBeforeSubmit={onBeforeSubmit}
        onExcluded={onExcluded}
      />
    );

    expect(
      await screen.findByText(/Linked items detected/i)
    ).toBeInTheDocument();

    // Switch to ALL_LINKED -> displays linked receipt list
    await user.click(screen.getByLabelText(/Exclude all linked items together/i));
    expect(screen.getByText("Target Receipt")).toBeInTheDocument();
    expect(screen.getByText("$10.01")).toBeInTheDocument();

    // Select reason OTHER -> requires note before submit is enabled
    const submitBtn = screen.getByRole("button", {
      name: /Exclude All Linked \(2 Items\)/i,
    });
    expect(submitBtn).toBeDisabled();

    await user.click(screen.getByLabelText("Reason (required)"));
    await user.click(screen.getByRole("option", { name: "Other" }));
    expect(screen.getByLabelText("Note (required)")).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByLabelText("Note (required)"), "Reconciled manually");
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);
    await waitFor(() => expect(onBeforeSubmit).toHaveBeenCalledTimes(1));
    expect(api.excludeItem).toHaveBeenCalledWith(
      "transaction",
      10,
      "OTHER",
      "Reconciled manually",
      false
    );
    expect(onExcluded).toHaveBeenCalledTimes(1);
  });

  it("handles bulk exclusion targets, blocked preview state, and API errors", async () => {
    const user = userEvent.setup();
    vi.mocked(api.previewBulkExclusion).mockResolvedValue({
      blocked: true,
      blockedReason: "Includes closed period items",
      items: [],
    });

    const { rerender } = render(
      <ExcludeItemModal
        isOpen
        onClose={vi.fn()}
        targets={[
          { type: "transaction", id: 1 },
          { type: "transaction", id: 2 },
        ]}
        linkedChoice="ALL_LINKED"
        onExcluded={vi.fn()}
      />
    );

    expect(
      await screen.findByText("Includes closed period items")
    ).toBeInTheDocument();

    vi.mocked(api.previewBulkExclusion).mockRejectedValueOnce(
      new Error("Preview network error")
    );
    rerender(
      <ExcludeItemModal
        isOpen
        onClose={vi.fn()}
        targets={[{ type: "expense", id: 5 }]}
        linkedChoice="ONLY_THIS"
        onExcluded={vi.fn()}
      />
    );

    expect(
      await screen.findByText("Preview network error")
    ).toBeInTheDocument();

    // Select DUPLICATE & submit failing excludeItems call -> shows error alert
    vi.mocked(api.excludeItems).mockRejectedValueOnce(
      new Error("Server write rejected")
    );
    await user.click(screen.getByLabelText("Reason (required)"));
    await user.click(screen.getByRole("option", { name: "Duplicate entry" }));
    await user.click(
      screen.getByRole("button", { name: "Exclude Selected Item" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server write rejected"
    );
  });
});
