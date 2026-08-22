import { useState } from "react";
import type { AccountingPeriod } from "../types/models";
import { Link } from "react-router-dom";

interface SidebarProps {
  periods: AccountingPeriod[];
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
}

// sidebar navigation, groups periods by year
export default function Sidebar({ periods, isSidebarOpen, setIsSidebarOpen }: SidebarProps) {
  // group by year for the tree view
  // e.g. { 2026: [8, 7] }
  const periodsByYear: Record<number, AccountingPeriod[]> = {};
  
  periods.forEach(p => {
    if (!periodsByYear[p.year]) {
      periodsByYear[p.year] = [];
    }
    periodsByYear[p.year].push(p);
  });

  // sort years desc
  const years = Object.keys(periodsByYear).map(Number).sort((a, b) => b - a);

  // track open year dropdowns
  const [openYears, setOpenYears] = useState<Record<number, boolean>>({
    [years[0]]: true 
  });

  const toggleYear = (year: number) => {
    setOpenYears(prev => ({
      ...prev,
      [year]: !prev[year]
    }));
  };

  // convert month num to name
  const getMonthName = (monthNumber: number) => {
    const date = new Date();
    date.setMonth(monthNumber - 1);
    return date.toLocaleString('default', { month: 'long' });
  };

  return (
    <>
      {/* MOBILE OVERLAY: Dims the background when the sidebar is open on small screens */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight text-white">Ledger</h1>
          {/* Mobile Close Button */}
          <button 
            className="md:hidden text-zinc-400 hover:text-white transition-colors"
            onClick={() => setIsSidebarOpen(false)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Past Months</h2>
          
          {years.length === 0 && (
            <p className="text-sm text-zinc-500 italic">No periods found.</p>
          )}

          {years.map(year => (
            <div key={year} className="mb-2">
              <button 
                onClick={() => toggleYear(year)}
                className="w-full flex justify-between items-center text-left font-medium text-zinc-400 hover:text-white py-2 transition-colors"
              >
                <span>{year}</span>
                <svg className={`w-3 h-3 transition-transform duration-200 ${openYears[year] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
              </button>
              
              {openYears[year] && (
                <ul className="ml-4 mt-2 space-y-2 border-l-2 border-zinc-800 pl-4">
                  {/* Sort months descending so August is above July */}
                  {periodsByYear[year].sort((a, b) => b.month - a.month).map(period => (
                    <li key={period.id} className="flex items-center justify-between">
                        <Link 
                            to={`/ledger/${year}/${period.month}`}
                            className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
                        >
                            {getMonthName(period.month)}
                        </Link>
                      {/* Colored pill for the status */}
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase border ${
                        period.status === "CLOSED"
                          ? "bg-zinc-800/50 text-zinc-500 border-zinc-800"
                          : period.status === "OPEN"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20" // e.g. "REVIEW"
                      }`}>
                        {period.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}