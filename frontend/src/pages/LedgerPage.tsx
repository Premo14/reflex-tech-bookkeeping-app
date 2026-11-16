import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChartAccounts,
  getSettings,
  getReviewQueueCounts,
  type ReviewStatusType,
} from "../services/api";
import type { ChartAccount } from "../types/models";

import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import LedgerGrid from "../components/LedgerGrid";
import ReviewModal from "../components/ReviewModal";
import AppSettingsModal from "../components/AppSettingsModal";
import InvoicingModal from "../components/InvoicingModal";
import { useLiveEvent } from "../utils/useLiveSync";
import { addDaysToISODate } from "../utils/dateUtils";
import { useNavigationStack } from "../context/navigationStackContext";

export default function LedgerPage() {
  const nav = useNavigationStack();
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAccountsLoading, setIsAccountsLoading] = useState(true);
  const [isQueueLoading, setIsQueueLoading] = useState(true);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewStatusType, setReviewStatusType] = useState<ReviewStatusType>("PENDING");
  const [appSettingsModalOpen, setAppSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"storage" | "rules">("storage");
  const [invoicingModalOpen, setInvoicingModalOpen] = useState(false);
  const [arDeepLinkInvoiceId, setArDeepLinkInvoiceId] = useState<number | null>(null);
  const [arDeepLinkMode, setArDeepLinkMode] = useState<"inspect" | "edit" | "print">("print");
  const [initialRuleData, setInitialRuleData] = useState<{
    name?: string;
    descriptionKeyword?: string;
    categoryAccountId?: number | null;
  } | null>(null);

  const handleOpenRules = (data?: {
    name?: string;
    descriptionKeyword?: string;
    categoryAccountId?: number | null;
  }) => {
    setInitialRuleData(data || null);
    setSettingsTab("rules");
    setAppSettingsModalOpen(true);
    setIsSidebarOpen(false);
  };

  const [pendingCount, setPendingCount] = useState(0);
  const [excludedCount, setExcludedCount] = useState(0);
  const [warningsIgnoredCount, setWarningsIgnoredCount] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  const [viewUnlinkedTrigger, setViewUnlinkedTrigger] = useState(0);
  const [viewUncategorizedTrigger, setViewUncategorizedTrigger] = useState(0);
  const hasInitializedOpenBooksRef = useRef(false);
  const prevClosedDateRef = useRef<string>("");

  const handleViewItems = (date: string) => {
    setStartDate("");
    setEndDate(date);
    setViewUnlinkedTrigger((prev) => prev + 1);
  };

  const handleViewUncategorized = () => {
    setViewUncategorizedTrigger((prev) => prev + 1);
  };

  const fetchQueueCounts = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsQueueLoading(true);
    try {
      const counts = await getReviewQueueCounts();
      setPendingCount(counts.pending);
      setExcludedCount(counts.excluded);
      setWarningsIgnoredCount(counts.warningsIgnored);
      setDeletedCount(counts.deleted);
    } catch (err) {
      console.error("Failed to load queue counts:", err);
    } finally {
      setIsQueueLoading(false);
    }
  }, []);

  const fetchAccounts = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsAccountsLoading(true);
    try {
      const data = await getChartAccounts();
      setAccounts(data || []);
    } catch (err) {
      console.error("Failed to load accounts:", err);
    } finally {
      setIsAccountsLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsSettingsLoading(true);
    try {
      const data = await getSettings();
      setSettings(data || {});
      const closedDate = data?.["BooksClosedDate"] || "";
      const prevClosedDate = prevClosedDateRef.current;
      prevClosedDateRef.current = closedDate;

      if (!hasInitializedOpenBooksRef.current && closedDate) {
        hasInitializedOpenBooksRef.current = true;
        setStartDate(addDaysToISODate(closedDate, 1));
        setEndDate("");
      } else if (prevClosedDate !== closedDate) {
        if (closedDate) {
          hasInitializedOpenBooksRef.current = true;
          setStartDate(addDaysToISODate(closedDate, 1));
          setEndDate("");
        } else {
          hasInitializedOpenBooksRef.current = false;
          setStartDate("");
          setEndDate("");
        }
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setIsSettingsLoading(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    await Promise.all([fetchAccounts(true), fetchSettings(true), fetchQueueCounts(true)]);
  }, [fetchAccounts, fetchSettings, fetchQueueCounts]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      void fetchAccounts(false);
      void fetchSettings(false);
      void fetchQueueCounts(false);
    });
    return () => {
      active = false;
    };
  }, [fetchAccounts, fetchSettings, fetchQueueCounts]);

  // Live real-time updates from background tasks
  useLiveEvent(["QUEUE_UPDATED", "RECONCILIATION_UPDATED"], () => {
    void fetchQueueCounts(false);
  });

  useLiveEvent(["ACCOUNTS_UPDATED", "TRANSACTIONS_UPDATED", "RULES_UPDATED"], () => {
    void fetchAccounts(false);
    void fetchQueueCounts(false);
  });

  useLiveEvent("SETTINGS_UPDATED", () => {
    void fetchSettings(false);
  });

  return (
    <div className="flex h-screen bg-[#050505] font-sans text-zinc-100 selection:bg-zinc-700 overflow-hidden relative">
      <Sidebar
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        pendingCount={pendingCount}
        excludedCount={excludedCount}
        warningsIgnoredCount={warningsIgnoredCount}
        deletedCount={deletedCount}
        booksClosedDate={settings["BooksClosedDate"] || ""}
        onOpenReview={(type) => {
          setReviewStatusType(type);
          setReviewModalOpen(true);
          setIsSidebarOpen(false);
          nav.push("review", { statusType: type });
        }}
        onOpenSettings={() => {
          setSettingsTab("storage");
          setAppSettingsModalOpen(true);
          setIsSidebarOpen(false);
          nav.push("settings", { tab: "storage" });
        }}
        isQueueLoading={isQueueLoading}
        isSettingsLoading={isSettingsLoading}
        companyName={settings["CompanyName"] || "Unnamed Company"}
      />

      <main className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 bg-[#050505]">
        <Header
          setIsSidebarOpen={setIsSidebarOpen}
          accounts={accounts}
          activeAccountId={activeAccountId}
          setActiveAccountId={setActiveAccountId}
          refreshData={fetchData}
          settings={settings}
          onViewItems={handleViewItems}
          onViewUncategorized={handleViewUncategorized}
          onOpenInvoices={() => {
            setArDeepLinkInvoiceId(null);
            setArDeepLinkMode("inspect");
            setInvoicingModalOpen(true);
            nav.push("invoicing");
          }}
          isAccountsLoading={isAccountsLoading}
          startDate={startDate}
          endDate={endDate}
          onOpenInvoiceDetail={(id) => {
            setArDeepLinkInvoiceId(id);
            setArDeepLinkMode("inspect");
            setInvoicingModalOpen(true);
            nav.push("invoicing", { invoiceId: id, mode: "inspect" });
          }}
        />
        <LedgerGrid
          startDate={startDate}
          endDate={endDate}
          accounts={accounts}
          activeAccountId={activeAccountId}
          viewUnlinkedTrigger={viewUnlinkedTrigger}
          viewUncategorizedTrigger={viewUncategorizedTrigger}
          onItemsChanged={fetchData}
          onCreateRule={(data) => {
            handleOpenRules(data);
            nav.push("settings", { tab: "rules", ruleData: data });
          }}
          onOpenInvoices={() => {
            setArDeepLinkInvoiceId(null);
            setArDeepLinkMode("inspect");
            setInvoicingModalOpen(true);
            nav.push("invoicing");
          }}
          onEditInvoice={(inv) => {
            setArDeepLinkInvoiceId(inv.id);
            setArDeepLinkMode("edit");
            setInvoicingModalOpen(true);
            nav.push("invoicing", { invoiceId: inv.id, mode: "edit" });
          }}
          onPrintInvoice={(inv) => {
            setArDeepLinkInvoiceId(inv.id);
            setArDeepLinkMode("print");
            setInvoicingModalOpen(true);
            nav.push("invoicing", { invoiceId: inv.id, mode: "print" });
          }}
        />
      </main>
      <ReviewModal
        isOpen={reviewModalOpen || nav.isOpen("review")}
        suspended={nav.isSuspended("review")}
        onClose={() => {
          setReviewModalOpen(false);
          if (nav.isOpen("review")) nav.pop();
        }}
        statusType={nav.getParams<{ statusType: ReviewStatusType }>("review")?.statusType || reviewStatusType}
        refreshData={fetchData}
      />
      <AppSettingsModal
        isOpen={appSettingsModalOpen || nav.isOpen("settings")}
        suspended={nav.isSuspended("settings")}
        onClose={() => {
          setAppSettingsModalOpen(false);
          setInitialRuleData(null);
          if (nav.isOpen("settings")) nav.pop();
        }}
        settings={settings}
        refreshSettings={fetchData}
        initialTab={nav.getParams<{ tab: "storage" | "rules" }>("settings")?.tab || settingsTab}
        initialRuleData={nav.getParams<{ ruleData: { name?: string; descriptionKeyword?: string; categoryAccountId?: number | null } | null }>("settings")?.ruleData ?? initialRuleData}
        onRulesApplied={fetchData}
      />
      <InvoicingModal
        isOpen={invoicingModalOpen || nav.isOpen("invoicing")}
        suspended={nav.isSuspended("invoicing")}
        onClose={() => {
          setInvoicingModalOpen(false);
          setArDeepLinkInvoiceId(null);
          if (nav.isOpen("invoicing")) nav.pop();
        }}
        initialInvoiceId={nav.getParams<{ invoiceId?: number }>("invoicing")?.invoiceId ?? arDeepLinkInvoiceId ?? undefined}
        initialMode={nav.getParams<{ mode?: "inspect" | "edit" | "print" }>("invoicing")?.mode ?? arDeepLinkMode}
        companyName={settings["CompanyName"] || "Unnamed Company"}
        onInvoicesUpdated={fetchData}
      />
    </div>
  );
}
