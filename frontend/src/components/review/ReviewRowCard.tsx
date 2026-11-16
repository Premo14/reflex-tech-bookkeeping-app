import { Badge } from "../ui/Badge";
import { EXCLUSION_REASON_LABELS } from "../../utils/ledgerStatus";
import { formatDate } from "../../utils/dateUtils";
import { formatCurrency } from "../../utils/formatCurrency";
import type { ReviewStatusType } from "../../services/api";
import type { ReviewRow } from "./reviewHelpers";

interface ReviewRowCardProps {
  row: ReviewRow;
  activeTab: ReviewStatusType;
  isSelected: boolean;
  onToggleSelect: (key: string) => void;
  onOpenDrawer: (row: ReviewRow) => void;
}

export function ReviewRowCard({
  row,
  activeTab,
  isSelected,
  onToggleSelect,
  onOpenDrawer,
}: ReviewRowCardProps) {
  const isIgnored = activeTab === "IGNORED";
  const isDeleted = activeTab === "DELETED";
  const isCredit = row.type === "invoice" ? true : (row.type === "transaction" ? row.amount >= 0 : false);
  const formattedAbs = formatCurrency(Math.abs(row.amount));

  return (
    <div
      className={`group flex items-center gap-2.5 p-2.5 rounded-xl border transition-all duration-150 touch-glow-emerald ${
        isSelected
          ? "bg-emerald-500/5 border-emerald-500/35 glow-border-emerald"
          : "surface-glass border-white/5 hover:border-white/15 hover:bg-white/[0.04]"
      }`}
    >
      <input
        type="checkbox"
        aria-label={`Select ${row.title}`}
        checked={isSelected}
        onChange={() => onToggleSelect(row.key)}
        className="w-3.5 h-3.5 shrink-0 rounded border-zinc-700 bg-zinc-900 accent-emerald-500 cursor-pointer"
      />
      <button
        type="button"
        onClick={() => onOpenDrawer(row)}
        className="flex-1 min-w-0 flex items-center justify-between gap-2.5 text-left cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span
              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                row.type === "transaction"
                  ? "bg-blue-500/10 text-blue-400"
                  : row.type === "invoice"
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-emerald-500/10 text-emerald-400"
              }`}
            >
              {row.type === "transaction" ? "Transaction" : row.type === "invoice" ? "Invoice" : "Expense"}
            </span>
            {isDeleted && <Badge variant="danger" size="sm" glow>DELETED</Badge>}
            {isDeleted && (
              <Badge variant="warning" size="sm">
                {row.daysRemaining !== undefined ? `${row.daysRemaining}d left` : "30d left"}
              </Badge>
            )}
            {row.issues.includes("CLOSED_PERIOD") && (
              <Badge variant="warning" size="sm" glow>CLOSED PERIOD</Badge>
            )}
            {row.issues.includes("OVERDUE") && (
              <Badge variant="danger" size="sm" glow>OVERDUE</Badge>
            )}
            {row.issues.includes("UNPAID") && (
              <Badge variant="warning" size="sm">UNPAID</Badge>
            )}
            {row.issues.includes("UNLINKED") && <Badge variant="neutral" size="sm">UNLINKED</Badge>}
            {row.issues.includes("UNDER_ALLOCATED") && (
              <Badge variant="warning" size="sm">UNDER-ALLOCATED</Badge>
            )}
            {row.issues.includes("OVER_ALLOCATED") && (
              <Badge variant="danger" size="sm" glow>OVER-ALLOCATED</Badge>
            )}
            {row.issues.includes("WARNINGS_IGNORED") && (
              <Badge variant="info" size="sm">WARNINGS SILENCED</Badge>
            )}
            {row.hasSuggestions && <Badge variant="cyan" size="sm" glow>SUGGESTED LINK</Badge>}
            {isIgnored && row.isLocked && <Badge variant="warning" size="sm">LOCKED PERIOD</Badge>}
            {isIgnored && (
              <Badge variant="purple" size="sm" glow>
                {row.reason ? EXCLUSION_REASON_LABELS[row.reason] || row.reason : "EXCLUDED"}
              </Badge>
            )}
          </div>

          <p className="font-semibold text-white truncate text-xs leading-snug">{row.title}</p>

          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-zinc-400">
            <span>
              {formatDate(row.date)} · {row.subtitle}
            </span>
            {isDeleted && row.deletedAt && <span>· Deleted {formatDate(row.deletedAt)}</span>}
            {row.bankAccount && row.bankAccount.id > 0 && (
              <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono border border-white/5 inline-flex items-center">
                {row.bankAccount.code} {row.bankAccount.name}
                {!row.bankAccount.active && (
                  <span className="text-red-400 ml-1 font-sans font-semibold">(Archived)</span>
                )}
              </span>
            )}
            {row.categoryAccount && row.categoryAccount.id > 0 ? (
              <span className="text-[10px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded font-medium border border-emerald-500/20 inline-flex items-center">
                {row.categoryAccount.code} {row.categoryAccount.name}
                {!row.categoryAccount.active && (
                  <span className="text-red-400 ml-1 font-sans font-semibold">(Archived)</span>
                )}
              </span>
            ) : (
              <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded font-medium border border-amber-500/20 inline-flex items-center">
                Uncategorized
              </span>
            )}
          </div>
          {isIgnored && row.note && (
            <p className="text-[11px] text-zinc-400 mt-0.5 italic truncate">“{row.note}”</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
          <p className={`font-bold font-mono tabular-nums text-xs ${isCredit ? "text-emerald-400" : "text-white"}`}>
            {isCredit ? `+${formattedAbs}` : `-${formattedAbs}`}
          </p>
          <span className="text-[10px] text-zinc-400 group-hover:text-emerald-400 font-semibold uppercase tracking-wider transition-colors">
            View Details →
          </span>
        </div>
      </button>
    </div>
  );
}
