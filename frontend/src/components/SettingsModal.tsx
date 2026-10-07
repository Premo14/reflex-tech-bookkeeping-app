import { useState, useEffect, useRef } from "react";
import { getSettings, updateSettings, getAuditLogs, getClosePreflight } from "../services/api";
import type { PeriodAuditLog, ClosePreflight } from "../types/models";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  refreshData: () => void;
  onViewItems?: (date: string) => void;
}

export default function SettingsModal({ isOpen, onClose, refreshData, onViewItems }: SettingsModalProps) {
  const [booksClosedDate, setBooksClosedDate] = useState("");
  const [currentClosedDate, setCurrentClosedDate] = useState("");
  const [auditLogs, setAuditLogs] = useState<PeriodAuditLog[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [preflight, setPreflight] = useState<ClosePreflight | null>(null);
  const [isLoadingPreflight, setIsLoadingPreflight] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!booksClosedDate) {
      setPreflight(null);
      return;
    }
    setIsLoadingPreflight(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const data = await getClosePreflight(booksClosedDate);
        setPreflight(data);
      } catch (err: any) {
        console.error("Failed to fetch preflight:", err);
      } finally {
        setIsLoadingPreflight(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current ?? undefined);
  }, [booksClosedDate]);

  const loadData = async () => {
    try {
      const [settings, logs] = await Promise.all([
        getSettings(),
        getAuditLogs()
      ]);
      if (settings["BooksClosedDate"]) {
        setBooksClosedDate(settings["BooksClosedDate"]);
        setCurrentClosedDate(settings["BooksClosedDate"]);
      } else {
        setBooksClosedDate("");
        setCurrentClosedDate("");
      }
      setAuditLogs(logs || []);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const handleSave = async (forceDate?: string) => {
    const dateToSave = forceDate !== undefined ? forceDate : booksClosedDate;
    setIsSaving(true);
    setError("");
    try {
      await updateSettings("BooksClosedDate", dateToSave);
      refreshData();
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to update settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickClose = () => {
    const now = new Date();
    // End of last month
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const dateStr = endOfLastMonth.toISOString().split("T")[0];
    setBooksClosedDate(dateStr);
    handleSave(dateStr);
  };

  const getActionColor = (action: string) => {
    if (action.includes("LOCKED")) return "text-emerald-400";
    if (action.includes("UNLOCKED")) return "text-amber-400";
    if (action.includes("ROLLED_BACK")) return "text-blue-400";
    return "text-zinc-400";
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Accounting Period Management" 
      maxWidth="xl"
    >
      <div className="space-y-6">
        
        {/* STATUS BANNER */}
        <div className={`p-4 rounded-xl flex items-center gap-4 ${currentClosedDate ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${currentClosedDate ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
            {currentClosedDate ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
            )}
          </div>
          <div>
            <h3 className={`font-bold ${currentClosedDate ? 'text-emerald-400' : 'text-amber-400'}`}>
              {currentClosedDate ? `Books Locked through ${new Date(currentClosedDate).toLocaleDateString()}` : "Books are completely OPEN"}
            </h3>
            <p className="text-sm text-zinc-400 mt-1">
              {currentClosedDate 
                ? "Transactions on or before this date cannot be modified, preventing accidental changes to past financial records."
                : "No historical records are protected. It is highly recommended to lock past periods."}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm font-medium">
            {error}
          </div>
        )}

        {/* CONTROLS */}
        <div className="bg-[#111] border border-white/5 p-5 rounded-2xl">
          <h3 className="text-sm font-bold text-white mb-4">Change Closing Date</h3>
          <p className="text-xs text-zinc-400 mb-4">
            <strong className="text-amber-500/80">Strict Closing Rule:</strong> You cannot lock books for a period that contains unresolved items. All expenses and transactions on or before your chosen date must be explicitly matched or moved to the "Ignored Items" queue.
          </p>
          
          <div className="flex flex-col sm:flex-row items-end gap-3">
            <div className="flex-1 w-full">
              <Input
                type="date"
                label="New Closing Date"
                value={booksClosedDate}
                onChange={e => setBooksClosedDate(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <Button variant="primary" onClick={() => handleSave()} disabled={!!preflight && !preflight.canClose && booksClosedDate !== ""} isLoading={isSaving} className="flex-1 sm:flex-none">
                Save Date
              </Button>
              {booksClosedDate && (
                <Button variant="danger" onClick={() => handleSave("")} isLoading={isSaving} className="flex-1 sm:flex-none" title="Clear date to completely unlock books">
                  Unlock All
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/5">
            <Button variant="secondary" size="sm" onClick={handleQuickClose} isLoading={isSaving} className="w-full justify-center">
              Quick Lock: End of Last Month
            </Button>
          </div>

          {/* PREFLIGHT CHECKLIST */}
          {preflight && booksClosedDate && (
            <div className={`mt-5 p-4 rounded-xl border ${preflight.canClose ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <h4 className={`text-sm font-bold mb-2 flex items-center gap-2 ${preflight.canClose ? 'text-emerald-400' : 'text-red-400'}`}>
                {isLoadingPreflight ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
                ) : preflight.canClose ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                )}
                {preflight.canClose ? "Ready to Lock" : "Action Required"}
              </h4>
              <ul className="text-sm space-y-2 text-zinc-300">
                {preflight.unlinkedTxCount > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-0.5">•</span>
                    <span>{preflight.unlinkedTxCount} unlinked transactions found.</span>
                  </li>
                )}
                {preflight.unlinkedExpCount > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-0.5">•</span>
                    <span>{preflight.unlinkedExpCount} unlinked expenses found.</span>
                  </li>
                )}
                {preflight.pendingCount > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-0.5">•</span>
                    <span>{preflight.pendingCount} items in review queue.</span>
                  </li>
                )}
                {preflight.canClose && (
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">•</span>
                    <span>All items on or before {new Date(booksClosedDate).toLocaleDateString()} are resolved.</span>
                  </li>
                )}
              </ul>
              {!preflight.canClose && (
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => {
                    if (onViewItems) {
                      onViewItems(booksClosedDate);
                      onClose();
                    }
                  }}>
                    View Unresolved Items
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* AUDIT LOG */}
        <div>
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3 pl-1">Audit History</h3>
          <div className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
            {auditLogs.length === 0 ? (
              <div className="p-4 text-center text-sm text-zinc-500">No history available.</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-[#111] sticky top-0">
                  <tr>
                    <th className="p-3 text-zinc-400 font-medium">Date/Time</th>
                    <th className="p-3 text-zinc-400 font-medium">Action</th>
                    <th className="p-3 text-zinc-400 font-medium">Changes</th>
                    <th className="p-3 text-zinc-400 font-medium hidden sm:table-cell">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-white/[0.02]">
                      <td className="p-3 text-zinc-300 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className={`p-3 font-semibold ${getActionColor(log.action)}`}>{log.action}</td>
                      <td className="p-3 text-zinc-400">
                        {log.previousDate || "OPEN"} <span className="text-zinc-600 mx-1">→</span> {log.newDate || "OPEN"}
                      </td>
                      <td className="p-3 text-zinc-500 hidden sm:table-cell">{log.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </Modal>
  );
}
