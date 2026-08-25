import { useState } from "react";
import type { AccountingPeriod } from "../types/models";
import { Link } from "react-router-dom";
import { createAccountingPeriod } from "../services/api";

interface SidebarProps {
  periods: AccountingPeriod[];
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  refreshPeriods?: () => void;
}

// sidebar navigation, groups periods by year
export default function Sidebar({ periods, isSidebarOpen, setIsSidebarOpen, refreshPeriods }: SidebarProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createYear, setCreateYear] = useState(new Date().getFullYear());
  const [createMonth, setCreateMonth] = useState(new Date().getMonth() + 1);
  const [createError, setCreateError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // group by year for the tree view
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
    [years[0] || new Date().getFullYear()]: true 
  });

  const toggleYear = (year: number) => {
    setOpenYears(prev => ({
      ...prev,
      [year]: !prev[year]
    }));
  };

  const getMonthName = (monthNumber: number) => {
    const date = new Date();
    date.setMonth(monthNumber - 1);
    return date.toLocaleString('default', { month: 'long' });
  };

  const handleCreatePeriod = async () => {
    setCreateError("");
    setIsSaving(true);
    try {
      await createAccountingPeriod(createYear, createMonth);
      setShowCreateModal(false);
      if (refreshPeriods) refreshPeriods();
      // Ensure the year we just created is open in the tree view
      setOpenYears(prev => ({ ...prev, [createYear]: true }));
    } catch (err: any) {
      setCreateError(err.message || "Failed to create accounting period");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* MOBILE OVERLAY */}
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
          <button 
            className="md:hidden text-zinc-400 hover:text-white transition-colors"
            onClick={() => setIsSidebarOpen(false)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Past Months</h2>
            <button 
              onClick={() => setShowCreateModal(true)}
              className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-md transition"
              title="Create Month"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            </button>
          </div>
          
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
                  {periodsByYear[year].sort((a, b) => b.month - a.month).map(period => (
                    <li key={period.id} className="flex items-center justify-between">
                        <Link 
                            to={`/ledger/${year}/${period.month}`}
                            className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
                        >
                            {getMonthName(period.month)}
                        </Link>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase border ${
                        period.status === "CLOSED"
                          ? "bg-zinc-800/50 text-zinc-500 border-zinc-800"
                          : period.status === "OPEN"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
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

      {/* CREATE MONTH MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 z-100 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-white">Create Month</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              {createError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">
                  {createError}
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Year</label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" 
                    value={createYear} 
                    onChange={e => setCreateYear(Number(e.target.value))} 
                    min={new Date().getFullYear() - 10}
                    max={new Date().getFullYear()}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Month</label>
                  <select 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" 
                    value={createMonth} 
                    onChange={e => setCreateMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{getMonthName(m)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            
            <div className="p-5 border-t border-zinc-800 flex gap-3 justify-end">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition">Cancel</button>
              <button 
                onClick={handleCreatePeriod} 
                disabled={isSaving} 
                className="px-5 py-2 bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
              >
                {isSaving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
