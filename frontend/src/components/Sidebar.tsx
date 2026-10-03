import { useState } from "react";

interface SidebarProps {
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
}

export default function Sidebar({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  isSidebarOpen,
  setIsSidebarOpen,
}: SidebarProps) {
  const [activeFilter, setActiveFilter] = useState("ALL_TIME");
  const [showCustom, setShowCustom] = useState(false);

  const setFilter = (filter: string) => {
    setActiveFilter(filter);
    const now = new Date();
    setShowCustom(false);

    if (filter === "ALL_TIME") {
      setStartDate("");
      setEndDate("");
    } else if (filter === "THIS_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    } else if (filter === "LAST_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    } else if (filter === "THIS_YEAR") {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    } else if (filter === "CUSTOM") {
      setShowCustom(true);
      // don't change dates, let custom inputs handle it
    }
  };

  const NavItem = ({ label, filterId }: { label: string; filterId: string }) => {
    const isActive = activeFilter === filterId;
    return (
      <button
        onClick={() => {
          setFilter(filterId);
          if (filterId !== "CUSTOM") setIsSidebarOpen(false);
        }}
        className={`w-full flex items-center justify-between text-left py-2.5 px-4 rounded-xl transition-all duration-200 ${
          isActive ? 'bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20 shadow-sm' : 'text-zinc-400 font-medium hover:text-white hover:bg-white/5 border border-transparent'
        }`}
      >
        <span className="text-sm truncate">{label}</span>
        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
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
          <div className="px-8 mb-3">
            <h2 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Date Filters</h2>
          </div>
          
          <div className="px-4 space-y-1">
            <NavItem label="All Time" filterId="ALL_TIME" />
            <NavItem label="This Month" filterId="THIS_MONTH" />
            <NavItem label="Last Month" filterId="LAST_MONTH" />
            <NavItem label="This Year" filterId="THIS_YEAR" />
            <NavItem label="Custom Range" filterId="CUSTOM" />
          </div>

          {showCustom && (
            <div className="mx-4 mt-4 p-4 bg-[#121212] border border-white/5 rounded-xl shadow-inner">
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Start Date</label>
                  <input
                    type="date"
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 transition-colors"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">End Date</label>
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
      </aside>
    </>
  );
}
