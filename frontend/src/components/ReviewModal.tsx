import { useState, useEffect, useMemo } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Badge } from "./ui/Badge";
import { getReviewQueue, resolveReviewItems, restoreItem, getFlaggedItems } from "../services/api";
import { EXCLUSION_REASON_LABELS } from "./ExcludeItemModal";
import DetailDrawer from "./DetailDrawer";
import type { BankTransaction, Expense } from "../types/models";

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  statusType: 'PENDING' | 'IGNORED';
  refreshData: () => void;
}

type IssueType = "CLOSED_PERIOD" | "UNLINKED" | "PARTIAL_LINK" | "OVER_ALLOCATED" | "IGNORED";

type Row = {
  key: string;
  type: "transaction" | "expense";
  id: number;
  title: string;
  subtitle: string;
  date: string;
  amount: number;
  reason: string;
  note: string;
  issue: IssueType;
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export default function ReviewModal({ isOpen, onClose, statusType, refreshData }: ReviewModalProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [issueFilter, setIssueFilter] = useState("ALL");
  const [errors, setErrors] = useState<string[]>([]);
  const [info, setInfo] = useState("");
  const [drawerConfig, setDrawerConfig] = useState<{ type: "transaction" | "expense" | null; id: number | null }>({ type: null, id: null });

  const isPending = statusType === 'PENDING';

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSortBy("date_desc");
      setTypeFilter("ALL");
      setIssueFilter("ALL");
      setErrors([]);
      setInfo("");
      setSelected(new Set());
      loadData();
    }
  }, [isOpen, statusType]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await getReviewQueue(statusType);
      const allRows: Row[] = [];
      const seenIds = new Set<string>();

      // Helper to add row
      const addRow = (type: "transaction"|"expense", id: number, title: string, subtitle: string, date: string, amount: number, reason: string, note: string, issue: IssueType) => {
        const key = `${type}-${id}`;
        if (seenIds.has(key)) return;
        seenIds.add(key);
        allRows.push({ key, type, id, title, subtitle, date, amount, reason, note, issue });
      };

      // Add PENDING / IGNORED items
      (data.transactions || []).forEach((t: BankTransaction) => {
        addRow("transaction", t.id, t.description, t.transactionType, t.date, t.amount, t.exclusionReason || "", t.exclusionNote || "", isPending ? "CLOSED_PERIOD" : "IGNORED");
      });
      (data.expenses || []).forEach((e: Expense) => {
        addRow("expense", e.id, `${e.vendor}${e.description ? " – " + e.description : ""}`, e.tender, e.timestamp, e.amount, e.exclusionReason || "", e.exclusionNote || "", isPending ? "CLOSED_PERIOD" : "IGNORED");
      });

      // If PENDING (Action Required), also fetch flagged items
      if (isPending) {
        const flagged = await getFlaggedItems().catch(() => ({ transactions: [], expenses: [] }));
        
        (flagged.transactions || []).forEach((t: BankTransaction) => {
          let issue: IssueType = "UNLINKED";
          if (t.reconciliationStatus === "PARTIALLY_MATCHED") issue = "PARTIAL_LINK";
          if (t.reconciliationStatus === "OVER_ALLOCATED") issue = "OVER_ALLOCATED";
          addRow("transaction", t.id, t.description, t.transactionType, t.date, t.amount, t.exclusionReason || "", t.exclusionNote || "", issue);
        });
        (flagged.expenses || []).forEach((e: Expense) => {
          let issue: IssueType = "UNLINKED";
          if (e.reconciliationStatus === "PARTIALLY_MATCHED") issue = "PARTIAL_LINK";
          if (e.reconciliationStatus === "OVER_ALLOCATED") issue = "OVER_ALLOCATED";
          addRow("expense", e.id, `${e.vendor}${e.description ? " – " + e.description : ""}`, e.tender, e.timestamp, e.amount, e.exclusionReason || "", e.exclusionNote || "", issue);
        });
      }

      setRows(allRows);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (typeFilter !== "ALL" && r.type !== typeFilter) return false;
      if (issueFilter !== "ALL" && r.issue !== issueFilter) return false;
      if (!q) return true;
      const haystack = [r.title, r.subtitle, r.note, EXCLUSION_REASON_LABELS[r.reason] || r.reason, String(Math.abs(r.amount))]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "date_asc": return new Date(a.date).getTime() - new Date(b.date).getTime();
        case "amount_desc": return Math.abs(b.amount) - Math.abs(a.amount);
        case "amount_asc": return Math.abs(a.amount) - Math.abs(b.amount);
        default: return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
    });
    return sorted;
  }, [rows, search, sortBy, typeFilter, issueFilter]);

  const toggle = (key: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.key));
  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) visibleRows.forEach((r) => next.delete(r.key));
    else visibleRows.forEach((r) => next.add(r.key));
    setSelected(next);
  };

  const selectedRows = rows.filter((r) => selected.has(r.key));
  
  // Can only mass-allow if all selected items are CLOSED_PERIOD.
  // We cannot 'allow' an unlinked item - it must be resolved via linking.
  const canMassAllow = isPending && selectedRows.length > 0 && selectedRows.every(r => r.issue === 'CLOSED_PERIOD');

  const afterAction = async () => {
    refreshData();
    await loadData();
    setSelected(new Set());
  };

  const handleResolve = async (action: 'allow' | 'ignore' | 'pending') => {
    if (selectedRows.length === 0) return;
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      await resolveReviewItems(
        action,
        selectedRows.filter((r) => r.type === "transaction").map((r) => r.id),
        selectedRows.filter((r) => r.type === "expense").map((r) => r.id)
      );
      if (action === "allow") setInfo("Items allowed. The books were reopened back to the oldest allowed item's date if needed.");
      await afterAction();
    } catch (err: any) {
      setErrors([err.message || "Action failed"]);
    } finally {
      setIsResolving(false);
    }
  };

  const handleRestore = async () => {
    if (selectedRows.length === 0) return;
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    const done = new Set<string>();
    const errs: string[] = [];
    let restoredCount = 0;
    for (const r of selectedRows) {
      if (done.has(r.key)) continue;
      try {
        const res = await restoreItem(r.type, r.id);
        (res.affected || []).forEach((a: any) => done.add(`${a.type}-${a.id}`));
        restoredCount += (res.affected || []).length;
      } catch (err: any) {
        errs.push(`${r.title}: ${err.message || "failed"}`);
      }
    }
    setErrors(errs);
    if (restoredCount > 0) setInfo(`Restored ${restoredCount} item(s) to the books (linked items are restored together).`);
    await afterAction();
    setIsResolving(false);
  };

  const totalSelected = selectedRows.length;

  return (
    <>
      <Modal
        isOpen={isOpen && !drawerConfig.type}
        onClose={onClose}
        title={isPending ? "Action Required" : "Excluded Items"}
        maxWidth="4xl"
      >
        <div className="flex flex-col h-[70vh]">
          {isPending ? (
            <div className="p-4 mb-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-sm leading-relaxed">
              <strong>Action Required:</strong> These items are blocking you from closing your books. They may have been imported inside a closed period, lack matching links, or have allocation mismatches. Open them to resolve via the Detail Drawer, or select and exclude them.
            </div>
          ) : (
            <div className="p-4 mb-4 bg-white/[0.03] border border-white/10 text-zinc-300 rounded-xl text-sm leading-relaxed">
              Excluded items are kept for your records but are left out of reports, totals and matching. <strong>Restore</strong> puts
              them (and anything linked to them) back in your books. Items in a locked period can't be restored until the books are
              unlocked; you can send those to the Review Queue instead.
            </div>
          )}

          {/* TOOLBAR */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex-1 min-w-[200px]">
              <Input
                type="text"
                placeholder="Search description, vendor, reason, amount…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
              />
            </div>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="py-1.5! text-xs!">
              <option value="ALL">All items</option>
              <option value="transaction">Bank transactions</option>
              <option value="expense">Expenses</option>
            </Select>
            <Select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)} className="py-1.5! text-xs!">
              <option value="ALL">All issues</option>
              {isPending && <option value="CLOSED_PERIOD">Closed Period</option>}
              {!isPending && <option value="IGNORED">Ignored</option>}
              {isPending && <option value="UNLINKED">Unlinked</option>}
              {isPending && <option value="PARTIAL_LINK">Partial Link</option>}
              {isPending && <option value="OVER_ALLOCATED">Over-Allocated</option>}
            </Select>
            <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="py-1.5! text-xs!">
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="amount_desc">Amount: high to low</option>
              <option value="amount_asc">Amount: low to high</option>
            </Select>
          </div>

          <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                disabled={visibleRows.length === 0}
                className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 accent-emerald-500 cursor-pointer"
              />
              {visibleRows.length} shown of {rows.length} · {totalSelected} selected
            </label>
            <div className="flex gap-2 items-center">
              {isPending ? (
                <>
                  <Button variant="danger" size="sm" disabled={totalSelected === 0} onClick={() => handleResolve('ignore')} isLoading={isResolving}>Exclude Selected</Button>
                  <Button 
                    variant="primary" 
                    size="sm" 
                    disabled={totalSelected === 0 || !canMassAllow} 
                    onClick={() => handleResolve('allow')} 
                    isLoading={isResolving}
                    title={(!canMassAllow && totalSelected > 0) ? "You can only mass-allow closed period items. Unlinked/partial items must be resolved individually." : ""}
                  >
                    Allow Selected
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="sm" disabled={totalSelected === 0} onClick={() => handleResolve('pending')} isLoading={isResolving} title="Move back to the Review Queue (for items in a locked period)">Send to Review Queue</Button>
                  <Button variant="primary" size="sm" disabled={totalSelected === 0} onClick={handleRestore} isLoading={isResolving}>Restore Selected</Button>
                </>
              )}
            </div>
          </div>

          {errors.length > 0 && (
            <div className="p-3 mb-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-sm space-y-1">
              {errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
          {info && (
            <div className="p-3 mb-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-lg text-sm">{info}</div>
          )}

          {/* LIST */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              <div className="text-center text-zinc-400 py-12">Loading…</div>
            ) : visibleRows.length === 0 ? (
              <div className="text-center text-zinc-400 py-12">
                {rows.length === 0 ? (isPending ? "Nothing is waiting for review." : "No excluded items.") : "No items match your search or filters."}
              </div>
            ) : (
              visibleRows.map((r) => (
                <div
                  key={r.key}
                  onClick={() => setDrawerConfig({ type: r.type, id: r.id })}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    selected.has(r.key) ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.key)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => toggle(r.key, e as any)}
                    className="w-4 h-4 shrink-0 rounded border-zinc-700 bg-zinc-900 accent-emerald-500 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        r.type === "transaction" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"
                      }`}>
                        {r.type === "transaction" ? "Transaction" : "Expense"}
                      </span>
                      {r.issue === "CLOSED_PERIOD" && <Badge variant="warning" size="sm">CLOSED PERIOD</Badge>}
                      {r.issue === "UNLINKED" && <Badge variant="neutral" size="sm">UNLINKED</Badge>}
                      {r.issue === "PARTIAL_LINK" && <Badge variant="warning" size="sm">PARTIAL</Badge>}
                      {r.issue === "OVER_ALLOCATED" && <Badge variant="danger" size="sm">OVER-ALLOCATED</Badge>}
                      <p className="font-semibold text-white truncate ml-1">{r.title}</p>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      {new Date(r.date).toLocaleDateString()} · {r.subtitle}
                      {!isPending && r.reason && (
                        <> · <span className="text-amber-400">{EXCLUSION_REASON_LABELS[r.reason] || r.reason}</span></>
                      )}
                    </p>
                    {!isPending && r.note && <p className="text-xs text-zinc-400 mt-0.5 italic truncate">“{r.note}”</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="font-bold text-white">{formatMoney(Math.abs(r.amount))}</p>
                    <button 
                      className="text-[10px] text-zinc-400 hover:text-emerald-400 font-semibold uppercase tracking-wider transition-colors"
                      onClick={(e) => { e.stopPropagation(); setDrawerConfig({ type: r.type, id: r.id }); }}
                    >
                      View Details →
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* DETAIL DRAWER RENDERED OVER THE MODAL */}
      {drawerConfig.type && drawerConfig.id && (
        <DetailDrawer
          type={drawerConfig.type === 'expense' ? 'receipt' : drawerConfig.type}
          id={drawerConfig.id}
          onClose={() => {
            setDrawerConfig({ type: null, id: null });
            afterAction(); // Reload data when returning from the drawer
          }}
        />
      )}
    </>
  );
}
