import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/Button";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import type { ChartAccount } from "../types/models";
import UploadModal from "./UploadModal";
import AccountManager from "./AccountManager";
import SettingsModal from "./SettingsModal";
import ReportsModal from "./ReportsModal";

interface HeaderProps {
  setIsSidebarOpen: (isOpen: boolean) => void;
  accounts: ChartAccount[];
  activeAccountId: number | null;
  setActiveAccountId: (id: number | null) => void;
  refreshData: () => void;
  settings: Record<string, string>;
  onViewItems?: (date: string) => void;
  isAccountsLoading?: boolean;
  startDate?: string;
  endDate?: string;
}

export default function Header({
  setIsSidebarOpen,
  accounts,
  activeAccountId,
  setActiveAccountId,
  refreshData,
  settings,
  onViewItems,
  isAccountsLoading = false,
  startDate,
  endDate
}: HeaderProps) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAccountManager, setShowAccountManager] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showReportsModal, setShowReportsModal] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedAccount = activeAccountId ? accounts.find(a => a.id === activeAccountId) : null;
  const parentAccount = selectedAccount?.parentId ? accounts.find(p => p.id === selectedAccount.parentId) : null;
  const childCountForSelected = selectedAccount ? accounts.filter(a => a.parentId === selectedAccount.id).length : 0;
  const selectedText = selectedAccount 
    ? ((parentAccount ? `↳ ${selectedAccount.code} — ${selectedAccount.name}` : `${selectedAccount.code} — ${selectedAccount.name}`) + (!selectedAccount.active ? " (Archived)" : ""))
    : "All Accounts (Global View)";

  // Group accounts by type for the dropdown
  const groupedAccounts = accounts.reduce((acc, account) => {
    if (!acc[account.type]) acc[account.type] = [];
    acc[account.type].push(account);
    return acc;
  }, {} as Record<string, ChartAccount[]>);

  const accountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

  // Build tree list for an account type
  const buildHierarchyList = (typeAccounts: ChartAccount[]) => {
    if (accountSearch.trim()) {
      const q = accountSearch.toLowerCase();
      return typeAccounts
        .filter(a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
        .map(a => ({ account: a, depth: 0, childCount: 0 }));
    }

    const list: { account: ChartAccount; depth: number; childCount: number }[] = [];
    const topLevel = typeAccounts.filter(a => !a.parentId).sort((a, b) => a.code.localeCompare(b.code));

    const addAccountAndChildren = (parent: ChartAccount, depth: number) => {
      const directChildren = typeAccounts.filter(a => a.parentId === parent.id).sort((a, b) => a.code.localeCompare(b.code));
      list.push({ account: parent, depth, childCount: directChildren.length });
      for (const child of directChildren) {
        addAccountAndChildren(child, depth + 1);
      }
    };

    topLevel.forEach(a => addAccountAndChildren(a, 0));

    // Catch any accounts whose parentId is not in typeAccounts (orphans)
    const addedIds = new Set(list.map(i => i.account.id));
    typeAccounts.filter(a => !addedIds.has(a.id)).sort((a, b) => a.code.localeCompare(b.code)).forEach(a => {
      list.push({ account: a, depth: 1, childCount: 0 });
    });

    return list;
  };

  // Show tax season warning if it's past January and previous year isn't locked
  const currentYear = new Date().getFullYear();
  const booksClosedDateStr = settings["BooksClosedDate"];
  const isTaxWarning = (() => {
    // If settings haven't loaded yet, do not flash warning
    if (!settings || Object.keys(settings).length === 0) return false;

    const now = new Date();
    // Only show warning starting in Feb
    if (now.getMonth() < 1) return false; 
    
    if (!booksClosedDateStr) return true;
    
    const closedDate = new Date(booksClosedDateStr);
    const lastYearEnd = new Date(currentYear - 1, 11, 31);
    
    return closedDate < lastYearEnd;
  })();

  return (
    <>
      {isTaxWarning && (
        <div className="bg-gradient-to-r from-amber-500/20 to-amber-600/10 border-b border-amber-500/20 px-6 py-3 flex items-center justify-between text-sm text-amber-200 shrink-0 shadow-inner">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            <p><strong>Reminder:</strong> You haven't locked your books for {currentYear - 1}. We recommend setting a Closing Date to prevent accidental changes to your past records.</p>
          </div>
          <Button variant="warning" size="sm" onClick={() => setShowSettingsModal(true)}>
            Lock Books
          </Button>
        </div>
      )}
      <header className="p-6 md:p-8 pb-4 border-b border-white/5 flex flex-wrap md:items-end justify-between gap-6 shrink-0 bg-[#0a0a0a]">
        <div className="flex flex-col gap-4">
          {/* Mobile Top Bar (Hamburger Menu) */}
          <div className="flex items-center md:hidden">
            <Button variant="ghost"
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-2 mr-3 text-zinc-400 hover:text-white focus:bg-zinc-800 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </Button>
            <h1 className="text-xl font-bold text-white tracking-tight">Ledger</h1>
          </div>

          <div>
            <p className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-widest">Chart of Accounts</p>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
              <div className="relative flex-1 sm:flex-initial min-w-0" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className={`bg-[#121212] border ${isDropdownOpen ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-white/10 hover:border-white/20'} text-white rounded-xl px-4 py-2.5 font-bold transition-all shadow-sm flex items-center justify-between w-full sm:w-auto sm:min-w-[260px] whitespace-nowrap`}
                >
                  <span className="whitespace-nowrap flex items-center gap-2">
                    {isAccountsLoading && (
                      <LoadingSpinner size="xs" color="text-emerald-400" />
                    )}
                    <span className="whitespace-nowrap">{selectedText}</span>
                    {childCountForSelected > 0 && (
                      <span className="text-[10px] text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded font-normal shrink-0">
                        +{childCountForSelected} sub
                      </span>
                    )}
                  </span>
                  <svg className={`w-4 h-4 text-zinc-400 shrink-0 ml-3 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </button>

                {isDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 min-w-full w-max max-w-[calc(100vw-32px)] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-50 py-1.5 animate-in fade-in zoom-in-95 duration-200 overflow-hidden backdrop-blur-xl bg-zinc-900/95 max-h-[420px] overflow-y-auto custom-scrollbar flex flex-col">
                    {/* Quick Search */}
                    <div className="p-2 border-b border-white/5 bg-zinc-900/95 sticky top-0 z-10 shrink-0">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Filter accounts..."
                          value={accountSearch}
                          onChange={(e) => setAccountSearch(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
                          autoFocus
                        />
                        <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {accountSearch && (
                          <button
                            type="button"
                            onClick={() => setAccountSearch("")}
                            className="text-zinc-500 hover:text-white absolute right-2.5 top-1.5 text-xs p-0.5"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {isAccountsLoading && accounts.length === 0 ? (
                      <div className="py-8 flex flex-col items-center justify-center space-y-2 text-zinc-400">
                        <LoadingSpinner size="sm" color="text-emerald-500" />
                        <span className="text-xs">Loading accounts…</span>
                      </div>
                    ) : (
                      <>
                        {!accountSearch && (
                          <button
                            onClick={() => { setActiveAccountId(null); setIsDropdownOpen(false); setAccountSearch(""); }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors shrink-0 ${activeAccountId === null ? 'bg-emerald-500/10 text-emerald-400 font-bold' : 'text-zinc-300 hover:bg-white/5'}`}
                          >
                            All Accounts (Global View)
                          </button>
                        )}
                    
                    {accountTypes.map(type => {
                      const hierarchy = buildHierarchyList(groupedAccounts[type] || []);
                      if (hierarchy.length === 0) return null;

                      return (
                        <div key={type}>
                          <div className="px-4 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-2 flex items-center justify-between">
                            <span>{type}</span>
                            <span className="text-[10px] text-zinc-400 font-normal">{hierarchy.length}</span>
                          </div>
                          {hierarchy.map(({ account: acc, depth, childCount }) => (
                            <button
                              key={acc.id}
                              onClick={() => { setActiveAccountId(acc.id); setIsDropdownOpen(false); setAccountSearch(""); }}
                              className={`w-full text-left py-2 text-sm transition-colors ${activeAccountId === acc.id ? 'bg-emerald-500/10 text-emerald-400 font-bold' : 'text-zinc-300 hover:bg-white/5 hover:text-white'} whitespace-nowrap flex items-center gap-2`}
                              style={{ paddingLeft: `${16 + depth * 14}px`, paddingRight: '16px' }}
                            >
                              {depth > 0 && <span className="text-zinc-400 select-none text-xs shrink-0">↳</span>}
                              <span className={`text-xs font-mono shrink-0 ${activeAccountId === acc.id ? 'text-emerald-500/70' : depth > 0 ? 'text-zinc-400' : 'text-zinc-400'}`}>
                                 {acc.code}
                              </span>
                              <span className="whitespace-nowrap pr-2">{acc.name}</span>
                              {childCount > 0 && depth === 0 && (
                                <span className="text-[10px] text-zinc-400 bg-white/5 border border-white/5 px-1.5 py-0.2 rounded ml-1 shrink-0 font-normal">
                                  {childCount} sub
                                </span>
                              )}
                              {!acc.active && (
                                <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.2 rounded uppercase font-semibold ml-auto shrink-0">
                                  Inactive
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                      </>
                    )}
                  </div>
                )}
              </div>

              <Button variant="secondary" onClick={() => setShowAccountManager(true)} title="Manage Chart of Accounts" className="shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                Manage
              </Button>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="secondary" onClick={() => setShowReportsModal(true)} title="View Reports" className="!px-3 lg:!px-4">
            <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
            <span className="hidden lg:inline">Reports</span>
          </Button>
          <Button variant="secondary" onClick={() => setShowSettingsModal(true)} title="Lock Books" className="!px-3 lg:!px-4">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            <span className="hidden lg:inline">Lock Books</span>
          </Button>
          <Button variant="info"
            onClick={() => setShowUploadModal(true)}
            title="Upload Files"
            className="flex items-center justify-center gap-2 whitespace-nowrap bg-blue-600 hover:bg-blue-500 hover:-translate-y-0.5 text-white lg:!px-6 !px-3 py-2.5 rounded-xl text-sm font-bold transition-all shadow-[0_0_20px_rgba(37,99,235,0.2)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            <span className="hidden lg:inline">Upload Files</span>
          </Button>
        </div>
      </header>

      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadSuccess={refreshData}
      />

      <AccountManager
        isOpen={showAccountManager}
        onClose={() => setShowAccountManager(false)}
        accounts={accounts}
        refreshAccounts={refreshData}
      />

      <SettingsModal 
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        refreshData={refreshData}
        onViewItems={onViewItems}
      />

      {showReportsModal && (
        <ReportsModal 
          onClose={() => setShowReportsModal(false)}
          initialStartDate={startDate}
          initialEndDate={endDate}
        />
      )}
    </>
  );
}
