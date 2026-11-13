import { useState, useEffect, useMemo } from "react";
import { LoadingSpinner } from "./ui/LoadingSpinner";

interface SidebarProps {
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  pendingCount?: number;
  excludedCount?: number;
  warningsIgnoredCount?: number;
  deletedCount?: number;
  booksClosedDate?: string;
  onOpenReview?: (type: 'PENDING' | 'IGNORED' | 'WARNINGS_IGNORED' | 'DELETED') => void;
  onOpenSettings?: () => void;
  isQueueLoading?: boolean;
  isSettingsLoading?: boolean;
  companyName?: string;
}

function formatDateMMDDYYYY(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y}`;
  }
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return "";
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${m}/${d}/${dt.getFullYear()}`;
}

function addDays(dateStr: string, days: number): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("T")[0].split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, "0");
  const nd = String(dt.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

function getMonthRange(year: number, monthIndex: number) {
  const dt = new Date(year, monthIndex, 1);
  const y = dt.getFullYear();
  const m = dt.getMonth();
  const mm = String(m + 1).padStart(2, "0");
  const lastDay = new Date(y, m + 1, 0).getDate();
  const dd = String(lastDay).padStart(2, "0");
  const startIso = `${y}-${mm}-01`;
  const endIso = `${y}-${mm}-${dd}`;
  const label = `${mm}/01/${y} - ${mm}/${dd}/${y}`;
  return { startIso, endIso, label };
}

export default function Sidebar({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  isSidebarOpen,
  setIsSidebarOpen,
  pendingCount = 0,
  excludedCount = 0,
  warningsIgnoredCount = 0,
  deletedCount = 0,
  booksClosedDate = "",
  onOpenReview,
  onOpenSettings,
  isQueueLoading = false,
  isSettingsLoading = false,
  companyName = "Reflex Technologies LLC",
}: SidebarProps) {
  const [activeFilter, setActiveFilter] = useState("OPEN_BOOKS");
  const [showCustom, setShowCustom] = useState(false);

  const now = useMemo(() => new Date(), []);

  const thisMonthRange = useMemo(() => getMonthRange(now.getFullYear(), now.getMonth()), [now]);
  const lastMonthRange = useMemo(() => {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return getMonthRange(lm.getFullYear(), lm.getMonth());
  }, [now]);
  const thisYearRange = useMemo(() => {
    const y = now.getFullYear();
    return {
      startIso: `${y}-01-01`,
      endIso: `${y}-12-31`,
      label: `01/01/${y} - 12/31/${y}`,
    };
  }, [now]);

  const openStartDate = useMemo(() => (booksClosedDate ? addDays(booksClosedDate, 1) : ""), [booksClosedDate]);
  const openSubtitle = useMemo(() => {
    if (isSettingsLoading) return "loading...";
    if (booksClosedDate && openStartDate) return `${formatDateMMDDYYYY(openStartDate)} - present`;
    return "past - present";
  }, [openStartDate, booksClosedDate, isSettingsLoading]);

  const closedSubtitle = useMemo(() => {
    if (isSettingsLoading) return "loading...";
    if (booksClosedDate) {
      return `past - ${formatDateMMDDYYYY(booksClosedDate)}`;
    }
    return "None (Books Open)";
  }, [booksClosedDate, isSettingsLoading]);

  useEffect(() => {
    if (booksClosedDate) {
      const openStart = addDays(booksClosedDate, 1);
      if (startDate === openStart && endDate === "") {
        setActiveFilter("OPEN_BOOKS");
        setShowCustom(false);
      } else if (startDate === "" && endDate === booksClosedDate) {
        setActiveFilter("CLOSED_BOOKS");
        setShowCustom(false);
      } else if (startDate === thisMonthRange.startIso && endDate === thisMonthRange.endIso) {
        setActiveFilter("THIS_MONTH");
        setShowCustom(false);
      } else if (startDate === lastMonthRange.startIso && endDate === lastMonthRange.endIso) {
        setActiveFilter("LAST_MONTH");
        setShowCustom(false);
      } else if (startDate === thisYearRange.startIso && endDate === thisYearRange.endIso) {
        setActiveFilter("THIS_YEAR");
        setShowCustom(false);
      } else if (startDate !== "" || endDate !== "") {
        setActiveFilter("CUSTOM");
        setShowCustom(true);
      }
    } else {
      if (startDate === "" && endDate === "") {
        setActiveFilter("OPEN_BOOKS");
        setShowCustom(false);
      } else if (startDate === thisMonthRange.startIso && endDate === thisMonthRange.endIso) {
        setActiveFilter("THIS_MONTH");
        setShowCustom(false);
      } else if (startDate === lastMonthRange.startIso && endDate === lastMonthRange.endIso) {
        setActiveFilter("LAST_MONTH");
        setShowCustom(false);
      } else if (startDate === thisYearRange.startIso && endDate === thisYearRange.endIso) {
        setActiveFilter("THIS_YEAR");
        setShowCustom(false);
      } else if (startDate !== "" || endDate !== "") {
        setActiveFilter("CUSTOM");
        setShowCustom(true);
      }
    }
  }, [startDate, endDate, booksClosedDate, thisMonthRange, lastMonthRange, thisYearRange]);

  const setFilter = (filter: string) => {
    setActiveFilter(filter);
    setShowCustom(false);

    if (filter === "OPEN_BOOKS") {
      setStartDate(booksClosedDate ? addDays(booksClosedDate, 1) : "");
      setEndDate("");
    } else if (filter === "CLOSED_BOOKS") {
      setStartDate("");
      setEndDate(booksClosedDate || "1970-01-01");
    } else if (filter === "THIS_MONTH") {
      setStartDate(thisMonthRange.startIso);
      setEndDate(thisMonthRange.endIso);
    } else if (filter === "LAST_MONTH") {
      setStartDate(lastMonthRange.startIso);
      setEndDate(lastMonthRange.endIso);
    } else if (filter === "THIS_YEAR") {
      setStartDate(thisYearRange.startIso);
      setEndDate(thisYearRange.endIso);
    } else if (filter === "CUSTOM") {
      setShowCustom(true);
    }
  };

  const NavItem = ({ label, filterId, subtitle }: { label: string; filterId: string; subtitle?: string }) => {
    const isActive = activeFilter === filterId;
    return (
      <button
        onClick={() => {
          setFilter(filterId);
          if (filterId !== "CUSTOM") setIsSidebarOpen(false);
        }}
        className={`w-full flex items-center justify-between text-left py-1.5 px-3 rounded-lg transition-all duration-150 cursor-pointer ${
          isActive 
            ? 'bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20 shadow-sm' 
            : 'text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent'
        }`}
      >
        <div className="min-w-0 flex-1">
          <span className="text-xs block truncate">{label}</span>
          {subtitle && (
            <span className={`text-[10px] block truncate transition-colors ${isActive ? 'text-emerald-400/80 font-normal' : 'text-zinc-500 font-normal'}`}>
              {subtitle}
            </span>
          )}
        </div>
        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 ml-1.5" />}
      </button>
    );
  };

  return (
    <>
      {/* MOBILE OVERLAY */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#050505] border-r border-white/10 flex flex-col shadow-2xl transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        
        {/* HEADER */}
        <div className="p-3.5 border-b border-white/10 flex justify-between items-center bg-[#0a0a0a]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center font-black text-emerald-400 text-xs shadow-sm">
              R
            </div>
            <div>
              <span className="text-xs font-bold tracking-tight text-white block">Reflex Bookkeeping</span>
              <span className="text-[10px] text-zinc-400 block -mt-0.5 truncate max-w-[140px]">{companyName}</span>
            </div>
          </div>
          <button
            className="lg:hidden text-zinc-400 hover:text-white transition-colors p-1 cursor-pointer"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        {/* SCROLLABLE BODY */}
        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          
          {/* REVIEW QUEUE SECTION */}
          <div className="px-5 mb-2 flex items-center justify-between">
            <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Review Queue</h2>
            {isQueueLoading && (
              <LoadingSpinner size="xs" color="text-zinc-500" />
            )}
          </div>
          <div className="px-3 space-y-0.5 mb-5">
            <button
              onClick={() => onOpenReview && onOpenReview('PENDING')}
              className="w-full flex items-center justify-between text-left py-1.5 px-3 rounded-lg transition-all duration-150 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent cursor-pointer"
            >
              <span className="text-xs">Action Required</span>
              {isQueueLoading ? (
                <span className="px-1.5 py-0.5"><LoadingSpinner size="xs" color="text-amber-500" /></span>
              ) : pendingCount > 0 ? (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-bold border border-amber-500/20">{pendingCount}</span>
              ) : null}
            </button>
            <button
              onClick={() => onOpenReview && onOpenReview('IGNORED')}
              className="w-full flex items-center justify-between text-left py-1.5 px-3 rounded-lg transition-all duration-150 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent cursor-pointer"
            >
              <span className="text-xs">Excluded Items</span>
              {isQueueLoading ? (
                <span className="px-1.5 py-0.5"><LoadingSpinner size="xs" color="text-purple-400" /></span>
              ) : excludedCount > 0 ? (
                <span className="px-1.5 py-0.2 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-bold border border-purple-500/20">{excludedCount}</span>
              ) : null}
            </button>
            <button
              onClick={() => onOpenReview && onOpenReview('WARNINGS_IGNORED')}
              className="w-full flex items-center justify-between text-left py-1.5 px-3 rounded-lg transition-all duration-150 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent cursor-pointer"
            >
              <span className="text-xs">Warnings Ignored</span>
              {isQueueLoading ? (
                <span className="px-1.5 py-0.5"><LoadingSpinner size="xs" color="text-blue-400" /></span>
              ) : warningsIgnoredCount > 0 ? (
                <span className="px-1.5 py-0.2 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">{warningsIgnoredCount}</span>
              ) : null}
            </button>
            <button
              onClick={() => onOpenReview && onOpenReview('DELETED')}
              className="w-full flex items-center justify-between text-left py-1.5 px-3 rounded-lg transition-all duration-150 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent cursor-pointer"
            >
              <span className="text-xs">Deleted Items</span>
              {isQueueLoading ? (
                <span className="px-1.5 py-0.5"><LoadingSpinner size="xs" color="text-red-400" /></span>
              ) : deletedCount > 0 ? (
                <span className="px-1.5 py-0.2 rounded-full bg-red-500/10 text-red-400 text-[10px] font-bold border border-red-500/20">{deletedCount}</span>
              ) : null}
            </button>
          </div>

          {/* FILTERS SECTION */}
          <div className="px-5 mb-2">
            <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Date Filters</h2>
          </div>
          
          <div className="px-3 space-y-0.5">
            <NavItem label="Open Books" filterId="OPEN_BOOKS" subtitle={openSubtitle} />
            <NavItem label="Closed Books" filterId="CLOSED_BOOKS" subtitle={closedSubtitle} />
            <NavItem label="This Month" filterId="THIS_MONTH" subtitle={thisMonthRange.label} />
            <NavItem label="Last Month" filterId="LAST_MONTH" subtitle={lastMonthRange.label} />
            <NavItem label="This Year" filterId="THIS_YEAR" subtitle={thisYearRange.label} />
            <NavItem label="Custom Range" filterId="CUSTOM" />
          </div>

          {showCustom && (
            <div className="mx-3 mt-3 p-3 bg-zinc-950 border border-white/10 rounded-lg shadow-inner">
              <div className="space-y-3">
                <div>
                  <label htmlFor="sidebar-start-date" className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 cursor-pointer">Start Date</label>
                  <input
                    id="sidebar-start-date"
                    name="sidebarStartDate"
                    type="date"
                    className="w-full bg-black border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500 transition-colors"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="sidebar-end-date" className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 cursor-pointer">End Date</label>
                  <input
                    id="sidebar-end-date"
                    name="sidebarEndDate"
                    type="date"
                    className="w-full bg-black border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500 transition-colors"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SETTINGS FOOTER: COMPANY NAME & SETTINGS ICON INLINE */}
        <div className="p-3 border-t border-white/10 bg-zinc-950/60 shrink-0 flex items-center justify-between text-xs">
          <div className="min-w-0 pr-2">
            <div className="font-semibold text-zinc-200 truncate text-xs">{companyName}</div>
            <div className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>{booksClosedDate ? `Closed thru ${formatDateMMDDYYYY(booksClosedDate)}` : "Books Open (2026)"}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition shrink-0 cursor-pointer border border-transparent hover:border-white/10"
            title="Settings, Storage & Company Profile"
          >
            <svg
              className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </aside>
    </>
  );
}
