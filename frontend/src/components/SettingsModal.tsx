import { useState, useEffect, useRef, useCallback } from "react";
import { getSettings, updateSettings, getAuditLogs, getClosePreflight } from "../services/api";
import type { PeriodAuditLog, ClosePreflight } from "../types/models";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { formatDate, toLocalISODate } from "../utils/dateUtils";

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
  const [ackUncategorized, setAckUncategorized] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const loadData = useCallback(async () => {
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
    } catch (err: unknown) {
      console.error("Failed to load settings:", err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setAckUncategorized(false);
      void loadData();
    });
    return () => {
      active = false;
    };
  }, [isOpen, loadData]);

  useEffect(() => {
    let active = true;
    if (!booksClosedDate) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setAckUncategorized(false);
        setPreflight(null);
      });
      return () => {
        active = false;
      };
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      if (!active) return;
      setAckUncategorized(false);
      setIsLoadingPreflight(true);
      try {
        const data = await getClosePreflight(booksClosedDate);
        if (active) setPreflight(data);
      } catch (err: unknown) {
        console.error("Failed to fetch preflight:", err);
      } finally {
        if (active) setIsLoadingPreflight(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(debounceRef.current ?? undefined);
    };
  }, [booksClosedDate]);

  const handleSave = async (forceDate?: string) => {
    const dateToSave = forceDate !== undefined ? forceDate : booksClosedDate;
    setIsSaving(true);
    setError("");
    try {
      await updateSettings("BooksClosedDate", dateToSave);
      refreshData();
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickClose = () => {
    const now = new Date();
    // End of last month
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const dateStr = toLocalISODate(endOfLastMonth);
    setBooksClosedDate(dateStr);
  };

  const hasUncategorized = !!preflight && (preflight.uncategorizedTxCount > 0 || preflight.uncategorizedExpCount > 0);
  const canSave = (!preflight || preflight.canClose || booksClosedDate === "") && (!hasUncategorized || ackUncategorized);

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
      <div className="space-y-4 text-xs">
        
        {/* STATUS BANNER */}
        <div className={`p-3.5 rounded-xl flex items-center gap-3.5 ${currentClosedDate ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${currentClosedDate ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
            {currentClosedDate ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
            )}
          </div>
          <div>
            <h3 className={`text-xs font-bold ${currentClosedDate ? 'text-emerald-400' : 'text-amber-400'}`}>
              {currentClosedDate ? `Books Locked through ${formatDate(currentClosedDate)}` : "Books are completely OPEN"}
            </h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {currentClosedDate 
                ? "Transactions on or before this date cannot be modified, preventing accidental changes to past financial records."
                : "No historical records are protected. It is highly recommended to lock past periods."}
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs font-medium">
            {error}
          </div>
        )}

        {/* CONTROLS */}
        <div className="surface-glass border border-white/10 p-4 rounded-xl">
          <h3 className="text-xs font-bold text-white mb-2">Change Closing Date</h3>
          <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed">
            <strong className="text-amber-400/90">Strict Closing Rule:</strong> You cannot lock books for a period that contains unresolved items. All expenses and transactions on or before your chosen date must be explicitly linked and balanced, or moved to the &ldquo;Ignored Items&rdquo; queue.
          </p>
          
          <div className="flex flex-col sm:flex-row items-end gap-2.5">
            <div className="flex-1 w-full">
              <Input
                id="settings-closing-date"
                type="date"
                label="New Closing Date"
                value={booksClosedDate}
                onChange={e => setBooksClosedDate(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <Button variant="primary" size="sm" glow onClick={() => handleSave()} disabled={!canSave} isLoading={isSaving} className="flex-1 sm:flex-none">
                Save Date
              </Button>
              {booksClosedDate && (
                <Button variant="danger" size="sm" onClick={() => handleSave("")} isLoading={isSaving} className="flex-1 sm:flex-none touch-glow-red" title="Clear date to completely unlock books">
                  Unlock All
                </Button>
              )}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/5">
            <Button variant="secondary" size="sm" onClick={handleQuickClose} isLoading={isSaving} className="w-full justify-center text-xs touch-glow-emerald">
              Quick Lock: End of Last Month
            </Button>
          </div>

          {/* PREFLIGHT CHECKLIST */}
          {preflight && booksClosedDate && (
            <div className={`mt-4 p-3.5 rounded-xl border ${preflight.canClose ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <h4 className={`text-xs font-bold mb-2 flex items-center gap-1.5 ${preflight.canClose ? 'text-emerald-400' : 'text-red-400'}`}>
                {isLoadingPreflight ? (
                  <LoadingSpinner size="xs" />
                ) : preflight.canClose ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                )}
                {preflight.canClose ? "Ready to Lock" : "Action Required"}
              </h4>
              <ul className="text-xs space-y-1.5 text-zinc-300">
                {preflight.unlinkedTxCount > 0 && (
                  <li className="flex items-start gap-1.5">
                    <span className="text-red-400 mt-0.5">•</span>
                    <span>{preflight.unlinkedTxCount} unlinked transactions found.</span>
                  </li>
                )}
                {preflight.unlinkedExpCount > 0 && (
                  <li className="flex items-start gap-1.5">
                    <span className="text-red-400 mt-0.5">•</span>
                    <span>{preflight.unlinkedExpCount} unlinked expenses found.</span>
                  </li>
                )}
                {preflight.pendingCount > 0 && (
                  <li className="flex items-start gap-1.5">
                    <span className="text-red-400 mt-0.5">•</span>
                    <span>{preflight.pendingCount} items in review queue.</span>
                  </li>
                )}
                {(preflight.uncategorizedTxCount > 0 || preflight.uncategorizedExpCount > 0) && (
                  <li className="flex flex-col gap-1.5 pt-1 border-t border-amber-500/20 text-amber-300">
                    <div className="flex items-start gap-1.5">
                      <span className="mt-0.5">⚠️</span>
                      <span>
                        {preflight.uncategorizedTxCount > 0 && `${preflight.uncategorizedTxCount} transaction(s)`}
                        {preflight.uncategorizedTxCount > 0 && preflight.uncategorizedExpCount > 0 && " and "}
                        {preflight.uncategorizedExpCount > 0 && `${preflight.uncategorizedExpCount} expense(s)`}
                        {" without an assigned category will be locked."}
                      </span>
                    </div>
                    {preflight.canClose && (
                      <label className="flex items-center gap-2 cursor-pointer mt-0.5 bg-amber-500/10 border border-amber-500/30 p-2 rounded-lg select-none text-[11px] text-amber-200 hover:bg-amber-500/20 transition-colors">
                        <input
                          type="checkbox"
                          checked={ackUncategorized}
                          onChange={e => setAckUncategorized(e.target.checked)}
                          className="rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-amber-500/20 h-3.5 w-3.5"
                        />
                        <span>I acknowledge locking records with uncategorized suspense items.</span>
                      </label>
                    )}
                  </li>
                )}
                {preflight.canClose && (
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-400 mt-0.5">•</span>
                    <span>All items on or before {formatDate(booksClosedDate)} are resolved.</span>
                  </li>
                )}
              </ul>
              {!preflight.canClose && (
                <div className="mt-3 flex gap-2">
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
          <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 pl-1">Audit History</h3>
          <div className="bg-zinc-900/50 border border-white/10 rounded-xl overflow-hidden max-h-40 overflow-y-auto overflow-x-auto">
            {auditLogs.length === 0 ? (
              <div className="p-3 text-center text-xs text-zinc-500">No history available.</div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111] sticky top-0 border-b border-white/5">
                  <tr className="text-[10px] text-zinc-400 uppercase font-semibold">
                    <th className="py-2 px-3 font-medium">Date/Time</th>
                    <th className="py-2 px-3 font-medium">Action</th>
                    <th className="py-2 px-3 font-medium">Changes</th>
                    <th className="py-2 px-3 font-medium hidden sm:table-cell">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-3 text-zinc-300 whitespace-nowrap text-[11px]">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className={`py-2 px-3 font-semibold ${getActionColor(log.action)}`}>{log.action}</td>
                      <td className="py-2 px-3 text-zinc-400">
                        {log.previousDate || "OPEN"} <span className="text-zinc-400 mx-1">→</span> {log.newDate || "OPEN"}
                      </td>
                      <td className="py-2 px-3 text-zinc-500 hidden sm:table-cell text-[11px]">{log.reason}</td>
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
