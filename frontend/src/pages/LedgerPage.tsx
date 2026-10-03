import { useEffect, useState } from "react";
import { getChartAccounts, getSettings } from "../services/api";
import type { ChartAccount } from "../types/models";

import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import LedgerGrid from "../components/LedgerGrid";

export default function LedgerPage() {
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [accountsData, settingsData] = await Promise.all([
        getChartAccounts(),
        getSettings()
      ]);
      setAccounts(accountsData || []);
      setSettings(settingsData || {});
    } catch (err) {
      console.error("Failed to load global data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="flex h-screen bg-zinc-900 font-sans text-zinc-100 selection:bg-zinc-700 overflow-hidden relative">
      <Sidebar 
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
      />
      
      <main className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 bg-[#0a0a0a]">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : (
          <>
            <Header 
              setIsSidebarOpen={setIsSidebarOpen}
              accounts={accounts}
              activeAccountId={activeAccountId}
              setActiveAccountId={setActiveAccountId}
              refreshData={fetchData}
              settings={settings}
            />
            <LedgerGrid 
              startDate={startDate}
              endDate={endDate}
              accounts={accounts}
              activeAccountId={activeAccountId}
            />
          </>
        )}
      </main>
    </div>
  );
}
