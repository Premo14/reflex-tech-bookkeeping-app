import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import AppSettingsModal from "@/components/AppSettingsModal";
import SettingsModal from "@/components/SettingsModal";
import AccountManager from "@/components/AccountManager";
import BankRulesModal from "@/components/BankRulesModal";
import { ConfirmationProvider } from "@/components/ui/ConfirmDialog";
import type { BankRule, ChartAccount } from "@/types/models";
import * as api from "@/services/api";

vi.mock("@/services/api", () => ({
  updateSettings: vi.fn(),
  browseHostDirectories: vi.fn(),
  getSystemBackupDownloadUrl: vi.fn(() => "http://localhost/api/system/backup/export"),
  restoreSystemBackup: vi.fn(),
  getSettings: vi.fn(),
  getAuditLogs: vi.fn(),
  getClosePreflight: vi.fn(),
  createChartAccount: vi.fn(),
  updateChartAccount: vi.fn(),
  deleteChartAccount: vi.fn(),
  getBankRules: vi.fn(),
  getBankRuleSuggestions: vi.fn(),
  createBankRule: vi.fn(),
  updateBankRule: vi.fn(),
  deleteBankRule: vi.fn(),
  applyAllBankRules: vi.fn(),
  previewBankRule: vi.fn(),
  getChartAccounts: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const SAMPLE_ACCOUNTS: ChartAccount[] = [
  {
    id: 1,
    code: "1010",
    name: "Operating Checking",
    type: "ASSET",
    description: "Main operating account",
    active: true,
    isDefault: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    code: "1210",
    name: "Merchandise Inventory",
    type: "ASSET",
    description: "Goods for resale",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 3,
    code: "1020",
    name: "Sub Checking",
    type: "ASSET",
    parentId: 1,
    description: "",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 4,
    code: "1030",
    name: "Deep Cash Drawer",
    type: "ASSET",
    parentId: 3,
    description: "",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 5,
    code: "1040",
    name: "Fourth Level Account",
    type: "ASSET",
    parentId: 4,
    description: "",
    active: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 6,
    code: "5210",
    name: "Cloud Hosting",
    type: "EXPENSE",
    description: "AWS & infrastructure",
    scheduleCLine: "Line 18 - Office expense",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const SAMPLE_RULES: BankRule[] = [
  {
    id: 101,
    name: "AWS Hosting",
    priority: 1,
    matchLogic: "AND",
    conditions: JSON.stringify([{ field: "description", operator: "contains", value: "AWS" }]),
    categoryAccountId: 6,
    renamedVendor: "Amazon Web Services",
    autoConfirm: true,
    autoExclude: false,
    exclusionReason: "",
    notes: "Monthly cloud",
    active: true,
    applyCount: 12,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 102,
    name: "Personal Transfer",
    priority: 2,
    matchLogic: "OR",
    conditions: JSON.stringify([
      { field: "description", operator: "starts_with", value: "VENMO" },
      { field: "amount", operator: "greater_than", value: "100" },
    ]),
    categoryAccountId: undefined,
    renamedVendor: "",
    autoConfirm: false,
    autoExclude: true,
    exclusionReason: "PERSONAL",
    notes: "",
    active: false,
    applyCount: 3,
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
];

function wrapWithProviders(ui: React.ReactElement) {
  return render(<ConfirmationProvider>{ui}</ConfirmationProvider>);
}

async function selectCustomOption(combobox: HTMLElement, optionName: string | RegExp) {
  fireEvent.click(combobox);
  const listbox = await screen.findByRole("listbox");
  const option = within(listbox).getByRole("option", { name: optionName });
  fireEvent.click(option);
}

function makePreflight(
  overrides: Partial<import("@/types/models").ClosePreflight> = {}
): import("@/types/models").ClosePreflight {
  return {
    date: "2026-04-30",
    canClose: true,
    unlinkedTxCount: 0,
    unlinkedExpCount: 0,
    pendingCount: 0,
    unlinkedTxSamples: [],
    unlinkedExpSamples: [],
    earliestBlockerDate: "",
    excludedTxCount: 0,
    excludedExpCount: 0,
    excludedTxTotal: 0,
    excludedExpTotal: 0,
    uncategorizedTxCount: 0,
    uncategorizedExpCount: 0,
    ...overrides,
  };
}

describe("S20 Settings, Chart of Accounts & Bank Rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.updateSettings.mockResolvedValue(undefined);
    mockedApi.browseHostDirectories.mockResolvedValue({
      currentPath: "/Users/aj/Dropbox",
      parentPath: "/Users/aj",
      directories: ["Receipts", "Archive"],
    });
    mockedApi.restoreSystemBackup.mockResolvedValue({
      status: "success",
      message: "Restored",
      restored: { transactions: 42, expenses: 19 },
    });
    mockedApi.getSettings.mockResolvedValue({ BooksClosedDate: "2026-03-31" });
    mockedApi.getAuditLogs.mockResolvedValue([
      {
        id: 1,
        action: "LOCKED",
        previousDate: "",
        newDate: "2026-03-31",
        reason: "Quarter close",
        createdAt: "2026-04-01T12:00:00Z",
      },
      {
        id: 2,
        action: "UNLOCKED",
        previousDate: "2026-03-31",
        newDate: "",
        reason: "Adjustment",
        createdAt: "2026-04-02T12:00:00Z",
      },
      {
        id: 3,
        action: "ROLLED_BACK",
        previousDate: "2026-04-30",
        newDate: "2026-03-31",
        reason: "Reopen April",
        createdAt: "2026-05-01T12:00:00Z",
      },
      {
        id: 4,
        action: "NOTE",
        previousDate: "2026-03-31",
        newDate: "2026-03-31",
        reason: "Audit check",
        createdAt: "2026-05-02T12:00:00Z",
      },
    ]);
    mockedApi.getClosePreflight.mockResolvedValue(makePreflight());
    mockedApi.createChartAccount.mockResolvedValue(SAMPLE_ACCOUNTS[0]);
    mockedApi.updateChartAccount.mockResolvedValue(SAMPLE_ACCOUNTS[0]);
    mockedApi.deleteChartAccount.mockResolvedValue(undefined);
    mockedApi.getBankRules.mockResolvedValue(SAMPLE_RULES);
    mockedApi.getChartAccounts.mockResolvedValue(SAMPLE_ACCOUNTS);
    mockedApi.getBankRuleSuggestions.mockResolvedValue({
      suggestions: [
        {
          suggestedName: "Zoom Pro",
          payeeKeyword: "ZOOM",
          categoryAccountId: 6,
          categoryCode: "5210",
          categoryName: "Cloud Hosting",
          matchingTxCount: 4,
          sampleDescription: "ZOOM.US VIDEO CONF",
        },
      ],
    });
    mockedApi.createBankRule.mockResolvedValue({ rule: SAMPLE_RULES[0], appliedCount: 0 });
    mockedApi.updateBankRule.mockResolvedValue({ rule: SAMPLE_RULES[0], appliedCount: 0 });
    mockedApi.deleteBankRule.mockResolvedValue({ status: "success", message: "Deleted" });
    mockedApi.applyAllBankRules.mockResolvedValue({
      status: "success",
      appliedCount: 3,
      message: "Applied",
    });
    mockedApi.previewBankRule.mockResolvedValue({ matchCount: 5, sampleMatches: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("AppSettingsModal", () => {
    it("updates company profile, normalizes dropbox path, browses host dirs, and handles errors", async () => {
      const user = userEvent.setup();
      const refreshSettings = vi.fn();

      wrapWithProviders(
        <AppSettingsModal
          isOpen
          onClose={vi.fn()}
          settings={{
            DocumentDropboxPath: "./document-data",
            HostHomePath: "/Users/aj",
            CompanyName: "Reflex Tech",
          }}
          refreshSettings={refreshSettings}
        />
      );

      const companyInput = await screen.findByLabelText(/Company Profile & Legal Entity/i);
      await user.clear(companyInput);
      await user.type(companyInput, "   ");
      await user.click(screen.getByRole("button", { name: "Save Name" }));

      await waitFor(() => {
        expect(mockedApi.updateSettings).toHaveBeenCalledWith("CompanyName", "Unnamed Company");
      });
      expect(await screen.findByText("Company name saved!")).toBeInTheDocument();

      mockedApi.updateSettings.mockRejectedValueOnce(new Error("Company save denied"));
      await user.click(screen.getByRole("button", { name: "Save Name" }));
      expect(await screen.findByText("Company save denied")).toBeInTheDocument();

      // Test folder path normalization and validation
      const pathInput = screen.getByLabelText(/Host Path \/ Parent Directory/i);
      await user.clear(pathInput);
      await user.type(pathInput, "~/Documents/");
      expect(screen.getByText("/Users/aj/Documents/document-data")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Move Folder & Connect" }));
      await waitFor(() => {
        expect(mockedApi.updateSettings).toHaveBeenCalledWith(
          "DocumentDropboxPath",
          "~/Documents/"
        );
      });
      expect(await screen.findByRole("status")).toHaveTextContent(
        "/Users/aj/Documents/document-data"
      );

      // Failed move shows alert
      await user.clear(pathInput);
      await user.type(pathInput, "Users/aj/Custom");
      mockedApi.updateSettings.mockRejectedValueOnce(new Error("Permission error"));
      await user.click(screen.getByRole("button", { name: "Move Folder & Connect" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Permission error");

      // Empty path submit shows validation error
      await user.clear(pathInput);
      fireEvent.submit(pathInput.closest("form")!);
      expect(await screen.findByRole("alert")).toHaveTextContent("Folder path cannot be empty.");

      // Reset default
      await user.click(screen.getByRole("button", { name: /Reset to default/i }));
      expect(pathInput).toHaveValue("./document-data");

      // Open directory browser, test jump shortcuts, folder click, up, fallback & select
      await user.click(screen.getByRole("button", { name: /Browse\.\.\./i }));
      expect(await screen.findByText("Host Folder Browser")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Receipts/ })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Desktop" }));
      expect(mockedApi.browseHostDirectories).toHaveBeenCalledWith("/Users/aj/Desktop");

      await user.click(screen.getByRole("button", { name: "Documents" }));
      expect(mockedApi.browseHostDirectories).toHaveBeenCalledWith("/Users/aj/Documents");

      await user.click(screen.getByRole("button", { name: "Downloads" }));
      expect(mockedApi.browseHostDirectories).toHaveBeenCalledWith("/Users/aj/Downloads");

      await user.click(screen.getByRole("button", { name: "Home (~)" }));
      expect(mockedApi.browseHostDirectories).toHaveBeenCalledWith("/Users/aj");

      mockedApi.browseHostDirectories.mockRejectedValueOnce(new Error("Missing"));
      mockedApi.browseHostDirectories.mockResolvedValueOnce({
        currentPath: "/Users/aj",
        parentPath: "/Users",
        directories: ["Photos"],
      });
      await user.click(screen.getByRole("button", { name: /Receipts/ }));
      expect(await screen.findByRole("button", { name: /Photos/ })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /⬆ Up/i }));
      expect(mockedApi.browseHostDirectories).toHaveBeenCalledWith("/Users");

      await user.click(screen.getByRole("button", { name: "Select This Folder" }));
      expect(screen.queryByText("Host Folder Browser")).not.toBeInTheDocument();
    });

    it("supports backup download, confirmed/cancelled/failed JSON restore, and switches to Bank Rules tab", async () => {
      const user = userEvent.setup();
      const refreshSettings = vi.fn();

      wrapWithProviders(
        <AppSettingsModal
          isOpen
          onClose={vi.fn()}
          settings={{ DocumentDropboxPath: "./document-data", HostHomePath: "/Users/aj" }}
          refreshSettings={refreshSettings}
        />
      );

      expect(await screen.findByRole("link", { name: /Download Backup/i })).toHaveAttribute(
        "href",
        "http://localhost/api/system/backup/export"
      );

      const fileInput = screen.getByLabelText("Restore backup JSON file") as HTMLInputElement;
      const backupFile = new File(['{"version":1}'], "backup.json", { type: "application/json" });

      // Cancel confirmation
      fireEvent.change(fileInput, { target: { files: [backupFile] } });
      expect(await screen.findByRole("dialog", { name: "Restore System Backup" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(mockedApi.restoreSystemBackup).not.toHaveBeenCalled();

      // Confirm restore success
      fireEvent.change(fileInput, { target: { files: [backupFile] } });
      const restoreDialog = await screen.findByRole("dialog", { name: "Restore System Backup" });
      await user.click(within(restoreDialog).getByRole("button", { name: "Restore Backup" }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Backup restored successfully! (42 transactions, 19 expenses processed)"
      );
      expect(refreshSettings).toHaveBeenCalled();

      // Dismiss status banner
      await user.click(screen.getByRole("button", { name: "Dismiss restore status" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      // Confirm restore failure
      mockedApi.restoreSystemBackup.mockRejectedValueOnce(new Error("Corrupt JSON"));
      fireEvent.change(fileInput, { target: { files: [backupFile] } });
      const restoreFailDialog = await screen.findByRole("dialog", { name: "Restore System Backup" });
      await user.click(within(restoreFailDialog).getByRole("button", { name: "Restore Backup" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Restore failed: Corrupt JSON");

      // Switch to Bank Rules tab
      await user.click(screen.getByRole("tab", { name: /Bank Rules/i }));
      expect(await screen.findByText("Automated Bank Rules")).toBeInTheDocument();
    });
  });

  describe("SettingsModal (Accounting Period Management)", () => {
    it("displays lock banner, audit log, preflight blocked/uncategorized/ready workflows, and unlocks", async () => {
      const user = userEvent.setup();
      const refreshData = vi.fn();
      const onClose = vi.fn();
      const onViewItems = vi.fn();

      wrapWithProviders(
        <SettingsModal
          isOpen
          onClose={onClose}
          refreshData={refreshData}
          onViewItems={onViewItems}
        />
      );

      expect(await screen.findByText(/Books Locked through/i)).toBeInTheDocument();
      expect(screen.getByText("Quarter close")).toBeInTheDocument();
      expect(screen.getByText("Adjustment")).toBeInTheDocument();
      expect(screen.getByText("Reopen April")).toBeInTheDocument();
      expect(screen.getByText("Audit check")).toBeInTheDocument();

      // Preflight blocked -> shows View Unresolved Items button
      mockedApi.getClosePreflight.mockResolvedValueOnce(
        makePreflight({
          canClose: false,
          unlinkedTxCount: 2,
          unlinkedExpCount: 1,
          pendingCount: 3,
          uncategorizedTxCount: 1,
          uncategorizedExpCount: 1,
        })
      );

      const dateInput = screen.getByLabelText("New Closing Date");
      fireEvent.change(dateInput, { target: { value: "2026-04-30" } });

      expect(await screen.findByText("Action Required", {}, { timeout: 2000 })).toBeInTheDocument();
      expect(screen.getByText("2 unlinked transactions found.")).toBeInTheDocument();
      expect(screen.getByText("1 unlinked expenses found.")).toBeInTheDocument();
      expect(screen.getByText("3 items in review queue.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Date" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "View Unresolved Items" }));
      expect(onViewItems).toHaveBeenCalledWith("2026-04-30");
      expect(onClose).toHaveBeenCalled();

      // Preflight canClose with uncategorized items -> requires acknowledgement
      mockedApi.getClosePreflight.mockResolvedValueOnce(
        makePreflight({
          canClose: true,
          unlinkedTxCount: 0,
          unlinkedExpCount: 0,
          pendingCount: 0,
          uncategorizedTxCount: 2,
          uncategorizedExpCount: 1,
        })
      );

      await user.click(screen.getByRole("button", { name: /Quick Lock: End of Last Month/i }));
      const ackCheckbox = await screen.findByLabelText(
        /I acknowledge locking records with uncategorized suspense items/i,
        {},
        { timeout: 2000 }
      );
      expect(screen.getByRole("button", { name: "Save Date" })).toBeDisabled();
      await user.click(ackCheckbox);
      expect(screen.getByRole("button", { name: "Save Date" })).not.toBeDisabled();

      // Save fails first -> displays alert
      mockedApi.updateSettings.mockRejectedValueOnce(new Error("Locked period write rejected"));
      await user.click(screen.getByRole("button", { name: "Save Date" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Locked period write rejected");

      // Save succeeds
      mockedApi.updateSettings.mockResolvedValueOnce(undefined);
      await user.click(screen.getByRole("button", { name: "Save Date" }));
      await waitFor(() => {
        expect(mockedApi.updateSettings).toHaveBeenCalledWith(
          "BooksClosedDate",
          expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
        );
      });

      // Unlock All
      await user.click(screen.getByRole("button", { name: "Unlock All" }));
      await waitFor(() => {
        expect(mockedApi.updateSettings).toHaveBeenCalledWith("BooksClosedDate", "");
      });
    });

    it("shows open books banner when no closing date is configured", async () => {
      mockedApi.getSettings.mockResolvedValueOnce({});
      mockedApi.getAuditLogs.mockResolvedValueOnce([]);

      wrapWithProviders(
        <SettingsModal isOpen onClose={vi.fn()} refreshData={vi.fn()} />
      );

      expect(await screen.findByText("Books are completely OPEN")).toBeInTheDocument();
      expect(screen.getByText("No history available.")).toBeInTheDocument();
    });
  });

  describe("AccountManager", () => {
    it("filters accounts, validates creation, switches types/subclasses, and creates an account", async () => {
      const user = userEvent.setup();
      const refreshAccounts = vi.fn();

      wrapWithProviders(
        <AccountManager
          isOpen
          onClose={vi.fn()}
          accounts={SAMPLE_ACCOUNTS}
          refreshAccounts={refreshAccounts}
        />
      );

      // Search & clear
      const searchInput = screen.getByLabelText(/Search accounts by name or code/i);
      await user.type(searchInput, "Cloud");
      expect(screen.getByText("Cloud Hosting")).toBeInTheDocument();
      expect(screen.queryByText("Operating Checking")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Clear account search" }));
      expect(screen.getByText("Operating Checking")).toBeInTheDocument();

      // Open Create form
      await user.click(screen.getByRole("button", { name: "New Account" }));
      expect(screen.getByText("Create Account")).toBeInTheDocument();

      // Required error when name empty
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Code, Name, and Type are required.");

      // 4-digit suffix validation
      const nameInput = screen.getByLabelText("Account Name");
      const suffixInput = screen.getByLabelText("Account Code (4 Digits)");
      await user.type(nameInput, "New Asset");
      await user.clear(suffixInput);
      await user.type(suffixInput, "5");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/must be exactly 4 digits/i);

      // Switch Type -> ASSET, pick Inventory sub-class -> prefix 12, test duplicate code 1210
      await selectCustomOption(screen.getByLabelText("Type"), "ASSET");
      await selectCustomOption(screen.getByLabelText("Sub-Category"), /Inventory/i);
      fireEvent.change(suffixInput, { target: { value: "1210" } }); // 4-digit paste auto-strips prefix 12 -> 1210
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/code 1210 already exists/i);

      // Duplicate name check
      await user.clear(suffixInput);
      await user.type(suffixInput, "99");
      await user.clear(nameInput);
      await user.type(nameInput, "cloud hosting");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/already exists \(code 5210\)/i);

      // Valid create -> calls API (also test failure first then success)
      await user.clear(nameInput);
      await user.type(nameInput, "Warehouse Parts");
      await selectCustomOption(screen.getByLabelText(/IRS Schedule C Line/i), /Line 22 - Supplies/i);
      await user.type(screen.getByLabelText(/Description/i), "Parts room");

      mockedApi.createChartAccount.mockRejectedValueOnce(new Error("DB write error"));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("DB write error");

      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => {
        expect(mockedApi.createChartAccount).toHaveBeenCalledWith({
          code: "1299",
          name: "Warehouse Parts",
          type: "ASSET",
          parentId: undefined,
          description: "Parts room",
          scheduleCLine: "Line 22 - Supplies",
          active: true,
        });
      });
      expect(refreshAccounts).toHaveBeenCalled();
    });

    it("edits default & custom accounts, triggers soft hierarchy guardrails, toggles active, and deletes", async () => {
      const user = userEvent.setup();
      const refreshAccounts = vi.fn();

      wrapWithProviders(
        <AccountManager
          isOpen
          onClose={vi.fn()}
          accounts={SAMPLE_ACCOUNTS}
          refreshAccounts={refreshAccounts}
        />
      );

      // Edit default account 1010 -> select deep/mismatched parent 1030 -> triggers Soft Guardrails modal
      await user.click(screen.getByRole("button", { name: "Edit account 1010" }));
      expect(screen.getByText("Edit Default Account")).toBeInTheDocument();
      expect(screen.getByText("Locked on default accounts")).toBeInTheDocument();

      // Note: 1030 is a descendant of 1010 so let's instead edit 1210 (Inventory, no descendants) under 1030 (depth 2, Cash)
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Edit account 1210" }));
      expect(screen.getByText("Edit Custom Account")).toBeInTheDocument();

      await selectCustomOption(screen.getByLabelText(/Parent Account/i), /1030 — Deep Cash Drawer/i);
      // Cancel guardrail warning first
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("dialog", { name: "Unusual Account Hierarchy Detected" })).toBeInTheDocument();
      expect(screen.getByText(/Category Mismatch/i)).toBeInTheDocument();
      expect(screen.getByText(/Deep Hierarchy/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Change Parent" }));
      expect(mockedApi.updateChartAccount).not.toHaveBeenCalled();

      // Toggle Account is Active checkbox and proceed on warning
      const activeCheckbox = screen.getByRole("checkbox");
      await user.click(activeCheckbox);
      expect(activeCheckbox).toHaveAttribute("aria-checked", "false");

      await user.click(screen.getByRole("button", { name: "Save" }));
      await user.click(await screen.findByRole("button", { name: "Proceed Anyway" }));
      await waitFor(() => {
        expect(mockedApi.updateChartAccount).toHaveBeenCalledWith(
          2,
          expect.objectContaining({
            code: "1210",
            parentId: 4,
            active: false,
          })
        );
      });

      // Delete custom account: cancel -> fail -> succeed
      await user.click(screen.getByRole("button", { name: "Delete account 5210" }));
      expect(await screen.findByRole("dialog", { name: "Delete Account" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(mockedApi.deleteChartAccount).not.toHaveBeenCalled();

      mockedApi.deleteChartAccount.mockRejectedValueOnce(new Error("Account in use"));
      await user.click(screen.getByRole("button", { name: "Delete account 5210" }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Account in use");

      await user.click(screen.getByRole("button", { name: "Delete account 5210" }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));
      await waitFor(() => {
        expect(mockedApi.deleteChartAccount).toHaveBeenCalledWith(6);
      });
    });
  });

  describe("BankRulesModal & BankRulesTab", () => {
    it("renders rules & smart suggestions, toggles active, edits/deletes, and runs all rules", async () => {
      const user = userEvent.setup();
      const onRulesApplied = vi.fn();

      wrapWithProviders(
        <BankRulesModal
          isOpen
          onClose={vi.fn()}
          onRulesApplied={onRulesApplied}
        />
      );

      expect(await screen.findByText("AWS Hosting")).toBeInTheDocument();
      expect(screen.getByText("1 Active Rule")).toBeInTheDocument();
      expect(screen.getByText(/Smart Rule Suggestions \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText("Auto-Approve")).toBeInTheDocument();
      expect(screen.getByText("Auto-Exclude (PERSONAL)")).toBeInTheDocument();

      // Run All Rules
      await user.click(screen.getByRole("button", { name: "Run All Rules" }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Applied rules to 3 open transactions."
      );
      expect(onRulesApplied).toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Dismiss rule status" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      // Toggle rule active switch (success & failure)
      const toggleSwitch = screen.getByRole("switch", { name: "Pause rule AWS Hosting" });
      expect(toggleSwitch).toHaveAttribute("aria-checked", "true");
      await user.click(toggleSwitch);
      expect(mockedApi.updateBankRule).toHaveBeenCalledWith(101, { active: false });

      mockedApi.updateBankRule.mockRejectedValueOnce(new Error("Rule lock failed"));
      await user.click(screen.getByRole("switch", { name: "Activate rule AWS Hosting" }));
      expect(await screen.findByRole("dialog", { name: "Update Failed" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "OK" }));

      // Delete rule (fail + succeed)
      mockedApi.deleteBankRule.mockRejectedValueOnce(new Error("Delete blocked"));
      await user.click(screen.getByRole("button", { name: "Delete rule Personal Transfer" }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("dialog", { name: "Delete Failed" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "OK" }));

      await user.click(screen.getByRole("button", { name: "Delete rule Personal Transfer" }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));
      await waitFor(() => {
        expect(mockedApi.deleteBankRule).toHaveBeenCalledWith(102);
      });

      // Edit existing rule and update
      await user.click(screen.getByRole("button", { name: "Edit rule AWS Hosting" }));
      expect(screen.getByText("Edit Bank Rule")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Update Rule" }));
      await waitFor(() => {
        expect(mockedApi.updateBankRule).toHaveBeenCalledWith(
          101,
          expect.objectContaining({ name: "AWS Hosting", priority: 1 })
        );
      });
    });

    it("creates a rule via suggestion & manual validation, multi-conditions, live preview, and prefill", async () => {
      const user = userEvent.setup();

      const { rerender } = render(
        <ConfirmationProvider>
          <BankRulesModal isOpen onClose={vi.fn()} />
        </ConfirmationProvider>
      );

      // Adopt suggestion
      await user.click(await screen.findByRole("button", { name: "Create Rule" }));
      expect(screen.getByText("Create New Bank Rule")).toBeInTheDocument();
      expect(screen.getByLabelText(/Rule Name/i)).toHaveValue("Zoom Pro");

      // Test live preview debounce completes after 400ms
      await waitFor(
        () => {
          expect(mockedApi.previewBankRule).toHaveBeenCalledWith({
            matchLogic: "AND",
            conditions: [{ field: "description", operator: "contains", value: "ZOOM" }],
          });
        },
        { timeout: 1500 }
      );
      expect(await screen.findByText(/existing transactions in your ledger/i)).toBeInTheDocument();

      // Add a second condition, switch to amount field -> operator becomes equals_amount, then remove
      await user.click(screen.getByRole("button", { name: "+ Add Condition" }));
      await selectCustomOption(screen.getByLabelText("Condition 2 field"), "Amount ($)");
      expect(screen.getByLabelText("Condition 2 operator")).toHaveTextContent("equals exactly");
      await user.type(screen.getByLabelText("Condition 2 value"), "50");
      await user.click(screen.getByRole("button", { name: "Remove condition 2" }));
      expect(screen.queryByLabelText("Condition 2 value")).not.toBeInTheDocument();

      // Clear rule name -> required alert
      await user.clear(screen.getByLabelText(/Rule Name/i));
      await user.click(screen.getByRole("button", { name: "Create Rule" }));
      expect(await screen.findByRole("dialog", { name: "Rule Name Required" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "OK" }));

      // Back to list and start fresh to trigger Condition Required & Action Required
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "New Rule" }));
      await user.type(screen.getByLabelText(/Rule Name/i), "Test Rule");
      await user.click(screen.getByRole("button", { name: "Create Rule" }));
      expect(await screen.findByRole("dialog", { name: "Condition Required" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "OK" }));

      await user.type(screen.getByLabelText("Condition 1 value"), "TESTCO");
      await user.click(screen.getByRole("button", { name: "Create Rule" }));
      expect(await screen.findByRole("dialog", { name: "Action Required" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "OK" }));

      // Enable Auto-Exclude & pick reason + save failure + save success
      await user.click(screen.getByLabelText(/Auto-Exclude:/i));
      await selectCustomOption(screen.getByLabelText("Exclusion Reason:"), "Duplicate Item");
      await selectCustomOption(screen.getByLabelText("Condition Logic"), /OR/);

      mockedApi.createBankRule.mockRejectedValueOnce(new Error("Save rejected"));
      await user.click(screen.getByRole("button", { name: "Create Rule" }));
      expect(await screen.findByRole("dialog", { name: "Error Saving Rule" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "OK" }));

      await user.click(screen.getByRole("button", { name: "Create Rule" }));
      await waitFor(() => {
        expect(mockedApi.createBankRule).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Test Rule",
            matchLogic: "OR",
            autoExclude: true,
            exclusionReason: "DUPLICATE",
          })
        );
      });

      // Prefill via initialRuleData prop
      rerender(
        <ConfirmationProvider>
          <BankRulesModal
            isOpen
            onClose={vi.fn()}
            initialRuleData={{
              name: "Coffee Shop",
              descriptionKeyword: "STARBUCKS",
              categoryAccountId: 6,
            }}
          />
        </ConfirmationProvider>
      );
      expect(await screen.findByLabelText(/Rule Name/i)).toHaveValue("Coffee Shop");
      expect(screen.getByLabelText("Condition 1 value")).toHaveValue("STARBUCKS");
    });

    it("renders empty state when there are no rules", async () => {
      mockedApi.getBankRules.mockResolvedValueOnce([]);
      mockedApi.getBankRuleSuggestions.mockResolvedValueOnce({ suggestions: [] });

      wrapWithProviders(<BankRulesModal isOpen onClose={vi.fn()} />);
      expect(await screen.findByText("No Bank Rules Created Yet")).toBeInTheDocument();
      expect(screen.getByText("0 Active Rules")).toBeInTheDocument();
    });
  });
});
