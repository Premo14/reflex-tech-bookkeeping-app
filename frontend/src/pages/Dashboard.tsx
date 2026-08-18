import { useEffect, useState } from "react";
import { getAccountingPeriods } from "../services/api";
import type { AccountingPeriod } from "../types/models";

import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import FileUploader from "../components/FileUploader";

export default function Dashboard() {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // extracted so we can call it on load and after uploads
  const fetchPeriods = () => {
    getAccountingPeriods()
      .then(data => {
        setPeriods(data || []);
      })
      .catch(err => {
        console.error("Failed to load accounting periods:", err);
      });
  };

  // fetch periods on mount
  useEffect(() => {
    fetchPeriods();
  }, []);

  return (
    <div className="flex h-screen bg-zinc-900 font-sans text-zinc-100 selection:bg-zinc-700 overflow-hidden relative">
      
      {/* The Sidebar gets the periods data and controls its own mobile state */}
      <Sidebar 
        periods={periods} 
        isSidebarOpen={isSidebarOpen} 
        setIsSidebarOpen={setIsSidebarOpen} 
      />

      <main className="flex-1 flex flex-col overflow-y-auto w-full">
        <Header setIsSidebarOpen={setIsSidebarOpen} />

        {/* The Dashboard Content (Dropzone) */}
        <div className="p-6 md:p-8 pt-4 md:pt-8 max-w-5xl space-y-6 md:space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Pass the fetch function down so the Uploader can trigger a refresh */}
            <FileUploader onUploadSuccess={fetchPeriods} />
          </div>
        </div>
      </main>

    </div>
  );
}
