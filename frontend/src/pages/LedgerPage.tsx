import { useEffect, useState } from "react";
import { getChartAccounts, getSettings, getReviewQueueCounts, type ReviewStatusType } from "../services/api";
import type { ChartAccount } from "../types/models";

import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import LedgerGrid from "../components/LedgerGrid";
import ReviewModal from "../components/ReviewModal";
import AppSettingsModal from "../components/AppSettingsModal";
import InvoicingModal from "../components/InvoicingModal";
import { useLiveEvent } from "../utils/useLiveSync";

export default function LedgerPage() {
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
  const [reviewStatusType, setReviewStatusType] = useState<ReviewStatusType>('PENDING');
  const [appSettingsModalOpen, setAppSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'storage' | 'rules'>('storage');
  const [invoicingModalOpen, setInvoicingModalOpen] = useState(false);
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
    setSettingsTab('rules');
    setAppSettingsModalOpen(true);
    setIsSidebarOpen(false);
  };
  const [pendingCount, setPendingCount] = useState(0);
  const [excludedCount, setExcludedCount] = useState(0);
  const [warningsIgnoredCount, setWarningsIgnoredCount] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  const [viewUnlinkedTrigger, setViewUnlinkedTrigger] = useState(0);
  const [viewUncategorizedTrigger, setViewUncategorizedTrigger] = useState(0);
  const [hasInitializedOpenBooks, setHasInitializedOpenBooks] = useState(false);

  function addDays(dateStr: string, days: number): string {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("T")[0].split("-").map(Number);
    const dt = new Date(y, m - 1, d + days);
    const ny = dt.getFullYear();
    const nm = String(dt.getMonth() + 1).padStart(2, "0");
    const nd = String(dt.getDate()).padStart(2, "0");
    return `${ny}-${nm}-${nd}`;
  }

  const handleViewItems = (date: string) => {
    setStartDate("");
    setEndDate(date);
    setViewUnlinkedTrigger(prev => prev + 1);
  };

  const handleViewUncategorized = () => {
    setViewUncategorizedTrigger(prev => prev + 1);
  };

  const fetchQueueCounts = async () => {
    setIsQueueLoading(true);
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
  };

  const fetchAccounts = async () => {
    setIsAccountsLoading(true);
    try {
      const data = await getChartAccounts();
      setAccounts(data || []);
    } catch (err) {
      console.error("Failed to load accounts:", err);
    } finally {
      setIsAccountsLoading(false);
    }
  };

  const fetchSettings = async () => {
    setIsSettingsLoading(true);
    try {
      const data = await getSettings();
      setSettings(data || {});
      if (!hasInitializedOpenBooks && data?.["BooksClosedDate"]) {
        setHasInitializedOpenBooks(true);
        const nextDay = addDays(data["BooksClosedDate"], 1);
        setStartDate(nextDay);
        setEndDate("");
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setIsSettingsLoading(false);
    }
  };

  const fetchData = async () => {
    await Promise.all([fetchAccounts(), fetchSettings(), fetchQueueCounts()]);
  };

  useEffect(() => {
    fetchAccounts();
    fetchSettings();
    fetchQueueCounts();
  }, []);

  // Live real-time updates from background tasks
  useLiveEvent(["QUEUE_UPDATED", "RECONCILIATION_UPDATED"], () => {
    fetchQueueCounts();
  });

  useLiveEvent(["ACCOUNTS_UPDATED", "TRANSACTIONS_UPDATED", "RULES_UPDATED"], () => {
    fetchAccounts();
    fetchQueueCounts();
  });

  useLiveEvent("SETTINGS_UPDATED", () => {
    fetchSettings();
  });

  return (
    <div className="flex h-screen bg-zinc-900 font-sans text-zinc-100 selection:bg-zinc-700 overflow-hidden relative">
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
        onOpenReview={(type) => { setReviewStatusType(type); setReviewModalOpen(true); setIsSidebarOpen(false); }}
        onOpenSettings={() => { setSettingsTab('storage'); setAppSettingsModalOpen(true); setIsSidebarOpen(false); }}
        isQueueLoading={isQueueLoading}
        isSettingsLoading={isSettingsLoading}
      />
      
      <main className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 bg-[#0a0a0a]">
        <Header 
          setIsSidebarOpen={setIsSidebarOpen}
          accounts={accounts}
          activeAccountId={activeAccountId}
          setActiveAccountId={setActiveAccountId}
          refreshData={fetchData}
          settings={settings}
          onViewItems={handleViewItems}
          onViewUncategorized={handleViewUncategorized}
          onOpenInvoices={() => setInvoicingModalOpen(true)}
          isAccountsLoading={isAccountsLoading}
          startDate={startDate}
          endDate={endDate}
        />
        <LedgerGrid 
          startDate={startDate}
          endDate={endDate}
          accounts={accounts}
          activeAccountId={activeAccountId}
          viewUnlinkedTrigger={viewUnlinkedTrigger}
          viewUncategorizedTrigger={viewUncategorizedTrigger}
          onItemsChanged={fetchData}
          onCreateRule={(data) => handleOpenRules(data)}
        />
      </main>
      <ReviewModal 
        isOpen={reviewModalOpen} 
        onClose={() => setReviewModalOpen(false)} 
        statusType={reviewStatusType} 
        refreshData={fetchData} 
      />
      <AppSettingsModal
        isOpen={appSettingsModalOpen}
        onClose={() => { setAppSettingsModalOpen(false); setInitialRuleData(null); }}
        settings={settings}
        refreshSettings={fetchData}
        initialTab={settingsTab}
        initialRuleData={initialRuleData}
        onRulesApplied={fetchData}
      />
      <InvoicingModal
        isOpen={invoicingModalOpen}
        onClose={() => setInvoicingModalOpen(false)}
        onInvoicesUpdated={fetchData}
      />
    </div>
  );
}
