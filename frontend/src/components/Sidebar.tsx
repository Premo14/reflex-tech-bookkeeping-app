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
  // Day 0 of next month is the last day of this month (properly handles leap years for Feb)
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
}: SidebarProps) {
  const [activeFilter, setActiveFilter] = useState("OPEN_BOOKS");
  const [showCustom, setShowCustom] = useState(false);

  const now = useMemo(() => new Date(), []);

  // Compute month ranges (with leap-year handling)
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

  // Open Books range & subtitle
  const openStartDate = useMemo(() => (booksClosedDate ? addDays(booksClosedDate, 1) : ""), [booksClosedDate]);
  const openSubtitle = useMemo(() => {
    if (isSettingsLoading) return "loading...";
    if (booksClosedDate && openStartDate) return `${formatDateMMDDYYYY(openStartDate)} - present`;
    return "past - present";
  }, [openStartDate, booksClosedDate, isSettingsLoading]);

  // Closed Books range & subtitle
  const closedSubtitle = useMemo(() => {
    if (isSettingsLoading) return "loading...";
    if (booksClosedDate) {
      return `past - ${formatDateMMDDYYYY(booksClosedDate)}`;
    }
    return "None (Books Open)";
  }, [booksClosedDate, isSettingsLoading]);

  // Keep activeFilter in sync if dates change externally
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
        className={`w-full flex items-center justify-between text-left py-2 px-4 rounded-xl transition-all duration-200 ${
          isActive 
            ? 'bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20 shadow-sm' 
            : 'text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent'
        }`}
      >
        <div className="min-w-0 flex-1">
          <span className="text-sm block truncate">{label}</span>
          {subtitle && (
            <span className={`text-[11px] block truncate transition-colors mt-0.5 ${isActive ? 'text-emerald-400/80 font-normal' : 'text-zinc-400 font-normal'}`}>
              {subtitle}
            </span>
          )}
        </div>
        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 ml-2" />}
      </button>
    );
  };

  return (
    <>
      {/* MOBILE OVERLAY */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#050505] border-r border-white/5 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-[#0a0a0a]">
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            Bookkeeper
          </h1>
          <button
            className="md:hidden text-zinc-400 hover:text-white transition-colors"
            onClick={() => setIsSidebarOpen(false)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-6">
          <div className="px-8 mb-3 flex items-center justify-between">
            <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Review Queue</h2>
            {isQueueLoading && (
              <LoadingSpinner size="xs" color="text-zinc-500" />
            )}
          </div>
          <div className="px-4 space-y-1 mb-8">
            <button
              onClick={() => onOpenReview && onOpenReview('PENDING')}
              className="w-full flex items-center justify-between text-left py-2.5 px-4 rounded-xl transition-all duration-200 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent"
            >
              <span className="text-sm">Action Required</span>
              {isQueueLoading ? (
                <span className="px-2 py-0.5"><LoadingSpinner size="xs" color="text-amber-500" /></span>
              ) : pendingCount > 0 ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-bold border border-amber-500/20">{pendingCount}</span>
              ) : null}
            </button>
            <button
              onClick={() => onOpenReview && onOpenReview('IGNORED')}
              className="w-full flex items-center justify-between text-left py-2.5 px-4 rounded-xl transition-all duration-200 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent"
            >
              <span className="text-sm">Excluded Items</span>
              {isQueueLoading ? (
                <span className="px-2 py-0.5"><LoadingSpinner size="xs" color="text-purple-400" /></span>
              ) : excludedCount > 0 ? (
                <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-bold border border-purple-500/20">{excludedCount}</span>
              ) : null}
            </button>
            <button
              onClick={() => onOpenReview && onOpenReview('WARNINGS_IGNORED')}
              className="w-full flex items-center justify-between text-left py-2.5 px-4 rounded-xl transition-all duration-200 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent"
            >
              <span className="text-sm">Warnings Ignored</span>
              {isQueueLoading ? (
                <span className="px-2 py-0.5"><LoadingSpinner size="xs" color="text-blue-400" /></span>
              ) : warningsIgnoredCount > 0 ? (
                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">{warningsIgnoredCount}</span>
              ) : null}
            </button>
            <button
              onClick={() => onOpenReview && onOpenReview('DELETED')}
              className="w-full flex items-center justify-between text-left py-2.5 px-4 rounded-xl transition-all duration-200 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent"
            >
              <span className="text-sm">Deleted Items</span>
              {isQueueLoading ? (
                <span className="px-2 py-0.5"><LoadingSpinner size="xs" color="text-red-400" /></span>
              ) : deletedCount > 0 ? (
                <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-bold border border-red-500/20">{deletedCount}</span>
              ) : null}
            </button>
          </div>

          <div className="px-8 mb-3">
            <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Filters</h2>
          </div>
          
          <div className="px-4 space-y-1">
            <NavItem label="Open Books" filterId="OPEN_BOOKS" subtitle={openSubtitle} />
            <NavItem label="Closed Books" filterId="CLOSED_BOOKS" subtitle={closedSubtitle} />
            <NavItem label="This Month" filterId="THIS_MONTH" subtitle={thisMonthRange.label} />
            <NavItem label="Last Month" filterId="LAST_MONTH" subtitle={lastMonthRange.label} />
            <NavItem label="This Year" filterId="THIS_YEAR" subtitle={thisYearRange.label} />
            <NavItem label="Custom Range" filterId="CUSTOM" />
          </div>

          {showCustom && (
            <div className="mx-4 mt-4 p-4 bg-[#121212] border border-white/5 rounded-xl shadow-inner">
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">Start Date</label>
                  <input
                    type="date"
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 transition-colors"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">End Date</label>
                  <input
                    type="date"
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 transition-colors"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SETTINGS FOOTER */}
        <div className="p-4 border-t border-white/5 bg-[#0a0a0a] shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full flex items-center gap-3 py-2.5 px-4 rounded-xl text-zinc-400 font-medium hover:text-white hover:bg-white/5 transition-all duration-200 border border-transparent group cursor-pointer"
          >
            <svg
              className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors"
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
            <span className="text-sm font-medium">Settings</span>
          </button>
        </div>
      </aside>
    </>
  );
}
