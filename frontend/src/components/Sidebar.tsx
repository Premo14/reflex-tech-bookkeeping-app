import { useState, useEffect, useMemo } from "react";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { getSystemHealth } from "../services/api";
import { addDaysToISODate, formatDateMMDDYYYY } from "../utils/dateUtils";

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

function getMonthRange(year: number, monthIndex: number) {
  const dt = new Date(year, monthIndex, 1);
  const y = dt.getFullYear();
  const m = dt.getMonth();
  const mm = String(m + 1).padStart(2, "0");
  const lastDay = new Date(y, m + 1, 0).getDate();
  const dd = String(lastDay).padStart(2, "0");
  return {
    startIso: `${y}-${mm}-01`,
    endIso: `${y}-${mm}-${dd}`,
    label: `${mm}/01/${y} - ${mm}/${dd}/${y}`,
  };
}

interface SidebarNavItemProps {
  label: string;
  subtitle?: string;
  isActive: boolean;
  onSelect: () => void;
}

function SidebarNavItem({ label, subtitle, isActive, onSelect }: SidebarNavItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center justify-between text-left py-2 px-3 rounded-lg transition-all duration-150 cursor-pointer touch-glow-emerald motion-safe:active:scale-[0.98] ${
        isActive
          ? "bg-emerald-500/10 text-emerald-300 font-semibold border border-emerald-500/30 glow-emerald"
          : "text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent"
      }`}
    >
      <div className="min-w-0 flex-1">
        <span className="text-xs block truncate">{label}</span>
        {subtitle && (
          <span
            className={`text-[10px] block truncate font-mono tabular-nums transition-colors ${
              isActive ? "text-emerald-400/80 font-normal" : "text-zinc-400 font-normal"
            }`}
          >
            {subtitle}
          </span>
        )}
      </div>
      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 ml-1.5" />}
    </button>
  );
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
  companyName = "Unnamed Company",
}: SidebarProps) {
  const [customExpanded, setCustomExpanded] = useState(false);
  const [isReviewQueueOpen, setIsReviewQueueOpen] = useState(true);
  const [isDateFiltersOpen, setIsDateFiltersOpen] = useState(true);
  const [aiReady, setAiReady] = useState<boolean | null>(null);

  const totalReviewQueueCount = pendingCount + excludedCount + warningsIgnoredCount + deletedCount;

  useEffect(() => {
    let active = true;
    getSystemHealth()
      .then((health) => {
        if (active) setAiReady(health.aiEngine?.ready ?? false);
      })
      .catch(() => {
        if (active) setAiReady(null);
      });
    return () => {
      active = false;
    };
  }, []);

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

  const openStartDate = useMemo(
    () => (booksClosedDate ? addDaysToISODate(booksClosedDate, 1) : ""),
    [booksClosedDate]
  );

  const activeFilter = useMemo(() => {
    if (booksClosedDate) {
      if (startDate === openStartDate && endDate === "") return "OPEN_BOOKS";
      if (startDate === "" && endDate === booksClosedDate) return "CLOSED_BOOKS";
    } else if (startDate === "" && endDate === "") {
      return "OPEN_BOOKS";
    }
    if (startDate === thisMonthRange.startIso && endDate === thisMonthRange.endIso) return "THIS_MONTH";
    if (startDate === lastMonthRange.startIso && endDate === lastMonthRange.endIso) return "LAST_MONTH";
    if (startDate === thisYearRange.startIso && endDate === thisYearRange.endIso) return "THIS_YEAR";
    if (startDate !== "" || endDate !== "") return "CUSTOM";
    return customExpanded ? "CUSTOM" : "OPEN_BOOKS";
  }, [
    booksClosedDate,
    openStartDate,
    startDate,
    endDate,
    thisMonthRange,
    lastMonthRange,
    thisYearRange,
    customExpanded,
  ]);

  const showCustom = customExpanded || activeFilter === "CUSTOM";

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

  const selectFilter = (filter: string) => {
    if (filter === "CUSTOM") {
      setCustomExpanded(true);
      return;
    }
    setCustomExpanded(false);
    setIsSidebarOpen(false);

    if (filter === "OPEN_BOOKS") {
      setStartDate(booksClosedDate ? addDaysToISODate(booksClosedDate, 1) : "");
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
    }
  };

  return (
    <>
      {/* MOBILE OVERLAY */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#050505] border-r border-white/10 flex flex-col shadow-2xl transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* HEADER */}
        <div className="p-3.5 border-b border-white/10 flex justify-between items-center bg-[#0a0a0a]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 glow-emerald flex items-center justify-center font-black text-emerald-400 text-xs shadow-sm">
              R
            </div>
            <div>
              <span className="text-xs font-bold tracking-tight text-white block">
                Reflex Bookkeeping
              </span>
              <button
                type="button"
                onClick={onOpenSettings}
                title="Click to edit company name in Settings"
                className="group flex items-center gap-1 text-[10px] text-zinc-400 hover:text-emerald-300 -mt-0.5 max-w-[155px] cursor-pointer transition-colors text-left"
              >
                <span className="truncate">{companyName || "Unnamed Company"}</span>
                <svg
                  className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
            </div>
          </div>
          <button
            type="button"
            className="lg:hidden text-zinc-400 hover:text-white transition-colors p-1.5 rounded-lg touch-glow-emerald cursor-pointer"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* SCROLLABLE BODY */}
        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          {/* REVIEW QUEUE SECTION */}
          <button
            type="button"
            onClick={() => setIsReviewQueueOpen((prev) => !prev)}
            className="w-full px-5 mb-2 flex items-center justify-between text-left group cursor-pointer"
            aria-expanded={isReviewQueueOpen}
          >
            <div className="flex items-center gap-1.5">
              <svg
                className={`w-3 h-3 text-zinc-500 group-hover:text-zinc-300 transition-transform duration-150 ${
                  isReviewQueueOpen ? "rotate-90" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <h2 className="text-[10px] font-bold text-zinc-400 group-hover:text-zinc-200 uppercase tracking-wider transition-colors">
                Review Queue
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              {isQueueLoading ? (
                <LoadingSpinner size="xs" color="text-zinc-500" />
              ) : totalReviewQueueCount > 0 ? (
                <span className="px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-200 text-[10px] font-bold font-mono tabular-nums border border-white/10">
                  {totalReviewQueueCount}
                </span>
              ) : null}
            </div>
          </button>
          {isReviewQueueOpen && (
            <div className="px-3 space-y-0.5 mb-5">
              <button
                type="button"
                onClick={() => onOpenReview?.("PENDING")}
                className="w-full flex items-center justify-between text-left py-2 px-3 rounded-lg transition-all duration-150 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent hover:border-amber-500/20 touch-glow-amber cursor-pointer motion-safe:active:scale-[0.98]"
              >
                <span className="text-xs">Action Required</span>
                {isQueueLoading ? (
                  <span className="px-1.5 py-0.5">
                    <LoadingSpinner size="xs" color="text-amber-500" />
                  </span>
                ) : pendingCount > 0 ? (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold font-mono tabular-nums border border-amber-500/25 glow-amber">
                    {pendingCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onOpenReview?.("IGNORED")}
                className="w-full flex items-center justify-between text-left py-2 px-3 rounded-lg transition-all duration-150 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent hover:border-purple-500/20 touch-glow-purple cursor-pointer motion-safe:active:scale-[0.98]"
              >
                <span className="text-xs">Excluded Items</span>
                {isQueueLoading ? (
                  <span className="px-1.5 py-0.5">
                    <LoadingSpinner size="xs" color="text-purple-400" />
                  </span>
                ) : excludedCount > 0 ? (
                  <span className="px-1.5 py-0.2 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-bold font-mono tabular-nums border border-purple-500/25">
                    {excludedCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onOpenReview?.("WARNINGS_IGNORED")}
                className="w-full flex items-center justify-between text-left py-2 px-3 rounded-lg transition-all duration-150 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent hover:border-blue-500/20 touch-glow-blue cursor-pointer motion-safe:active:scale-[0.98]"
              >
                <span className="text-xs">Warnings Ignored</span>
                {isQueueLoading ? (
                  <span className="px-1.5 py-0.5">
                    <LoadingSpinner size="xs" color="text-blue-400" />
                  </span>
                ) : warningsIgnoredCount > 0 ? (
                  <span className="px-1.5 py-0.2 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold font-mono tabular-nums border border-blue-500/25">
                    {warningsIgnoredCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onOpenReview?.("DELETED")}
                className="w-full flex items-center justify-between text-left py-2 px-3 rounded-lg transition-all duration-150 text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent hover:border-rose-500/20 touch-glow-rose cursor-pointer motion-safe:active:scale-[0.98]"
              >
                <span className="text-xs">Deleted Items</span>
                {isQueueLoading ? (
                  <span className="px-1.5 py-0.5">
                    <LoadingSpinner size="xs" color="text-red-400" />
                  </span>
                ) : deletedCount > 0 ? (
                  <span className="px-1.5 py-0.2 rounded-full bg-red-500/10 text-red-400 text-[10px] font-bold font-mono tabular-nums border border-red-500/25">
                    {deletedCount}
                  </span>
                ) : null}
              </button>
            </div>
          )}

          {/* FILTERS SECTION */}
          <button
            type="button"
            onClick={() => setIsDateFiltersOpen((prev) => !prev)}
            className={`w-full px-5 mb-2 flex items-center gap-1.5 text-left group cursor-pointer ${
              !isReviewQueueOpen ? "mt-2" : ""
            }`}
            aria-expanded={isDateFiltersOpen}
          >
            <svg
              className={`w-3 h-3 text-zinc-500 group-hover:text-zinc-300 transition-transform duration-150 ${
                isDateFiltersOpen ? "rotate-90" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M9 5l7 7-7 7"
              />
            </svg>
            <h2 className="text-[10px] font-bold text-zinc-400 group-hover:text-zinc-200 uppercase tracking-wider transition-colors">
              Date Filters
            </h2>
          </button>

          {isDateFiltersOpen && (
            <>
              <div className="px-3 space-y-0.5">
                <SidebarNavItem
                  label="Open Books"
                  subtitle={openSubtitle}
                  isActive={activeFilter === "OPEN_BOOKS"}
                  onSelect={() => selectFilter("OPEN_BOOKS")}
                />
                <SidebarNavItem
                  label="Closed Books"
                  subtitle={closedSubtitle}
                  isActive={activeFilter === "CLOSED_BOOKS"}
                  onSelect={() => selectFilter("CLOSED_BOOKS")}
                />
                <SidebarNavItem
                  label="This Month"
                  subtitle={thisMonthRange.label}
                  isActive={activeFilter === "THIS_MONTH"}
                  onSelect={() => selectFilter("THIS_MONTH")}
                />
                <SidebarNavItem
                  label="Last Month"
                  subtitle={lastMonthRange.label}
                  isActive={activeFilter === "LAST_MONTH"}
                  onSelect={() => selectFilter("LAST_MONTH")}
                />
                <SidebarNavItem
                  label="This Year"
                  subtitle={thisYearRange.label}
                  isActive={activeFilter === "THIS_YEAR"}
                  onSelect={() => selectFilter("THIS_YEAR")}
                />
                <SidebarNavItem
                  label="Custom Range"
                  isActive={activeFilter === "CUSTOM"}
                  onSelect={() => selectFilter("CUSTOM")}
                />
              </div>

              {showCustom && (
                <div className="mx-3 mt-3 p-3 bg-[#0a0a0a] border border-white/10 rounded-lg shadow-inner">
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="sidebar-start-date"
                        className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 cursor-pointer"
                      >
                        Start Date
                      </label>
                      <input
                        id="sidebar-start-date"
                        name="sidebarStartDate"
                        type="date"
                        className="w-full bg-black border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-emerald-500 focus:shadow-[0_0_12px_rgba(16,185,129,0.2)] transition-all"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="sidebar-end-date"
                        className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 cursor-pointer"
                      >
                        End Date
                      </label>
                      <input
                        id="sidebar-end-date"
                        name="sidebarEndDate"
                        type="date"
                        className="w-full bg-black border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-emerald-500 focus:shadow-[0_0_12px_rgba(16,185,129,0.2)] transition-all"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* SETTINGS FOOTER: COMPANY NAME & SETTINGS ICON INLINE */}
        <div className="p-3 border-t border-white/10 bg-[#08080a] shrink-0 flex items-center justify-between text-xs">
          <div className="min-w-0 pr-2">
            <button
              type="button"
              onClick={onOpenSettings}
              title="Click to edit company name in Settings"
              className="group flex items-center gap-1.5 font-semibold text-zinc-200 hover:text-emerald-300 text-xs max-w-[165px] cursor-pointer transition-colors text-left"
            >
              <span className="truncate">{companyName || "Unnamed Company"}</span>
              <svg
                className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </button>
            <div className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono tabular-nums">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>
                {booksClosedDate
                  ? `Books Closed thru ${formatDateMMDDYYYY(booksClosedDate)}`
                  : "Books Open (2026)"}
              </span>
            </div>
            {aiReady !== null && (
              <div className="text-[9px] text-zinc-400 flex items-center gap-1 font-mono mt-0.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    aiReady ? "bg-emerald-400" : "bg-amber-400 motion-safe:animate-pulse"
                  }`}
                />
                <span>{aiReady ? "Local AI: Ready" : "Private AI: Initializing..."}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-all shrink-0 cursor-pointer border border-transparent hover:border-emerald-500/30 touch-glow-emerald"
            title="Settings, Storage & Company Profile"
            aria-label="Open settings"
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
