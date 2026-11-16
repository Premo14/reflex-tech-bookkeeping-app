import React from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export interface SuggestedMatchItem {
  id: number | string;
  score?: number;
  reason?: string;
  eyebrow?: string;
  title: string;
  subtitle: string;
  amountLabel?: string;
  amountClassName?: string;
  actionLabel: string;
  onAction: () => void;
}

export interface SuggestedMatchesListProps {
  title: string;
  items: SuggestedMatchItem[];
  accent?: "blue" | "indigo";
  subtitleText?: string;
  showQuickApproveHint?: boolean;
  isActionLoading?: boolean;
  actionDisabled?: boolean;
  maxHeightClassName?: string;
  emptyState?: React.ReactNode;
}

function getScoreBadgeClass(score: number): string {
  if (score >= 85) {
    return "text-emerald-400 bg-emerald-500/10 border-emerald-500/25 glow-emerald";
  }
  if (score >= 60) {
    return "text-blue-400 bg-blue-500/10 border-blue-500/25 glow-blue";
  }
  if (score >= 30) {
    return "text-amber-400 bg-amber-500/10 border-amber-500/25 glow-amber";
  }
  return "text-zinc-300 bg-zinc-800 border-zinc-700";
}

/**
 * Shared ranked candidate-match list used across Invoice, Transaction, and Expense detail views.
 */
export function SuggestedMatchesList({
  title,
  items,
  accent = "blue",
  subtitleText,
  showQuickApproveHint = false,
  isActionLoading = false,
  actionDisabled = false,
  maxHeightClassName = "",
  emptyState = null,
}: SuggestedMatchesListProps) {
  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  const isIndigo = accent === "indigo";
  const dotClass = isIndigo ? "bg-purple-400" : "bg-blue-400";
  const cardBorderClass = isIndigo
    ? "border-purple-500/30 hover:border-purple-500/60"
    : "border-blue-500/30 hover:border-blue-500/60";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
          <span>
            {title} ({items.length})
          </span>
        </div>
        {showQuickApproveHint && (
          <span className="text-[11px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700">
            Press <kbd className="font-mono text-zinc-200 font-bold">A</kbd> to quick-approve highest match score
          </span>
        )}
      </div>

      {subtitleText && <p className="text-xs text-zinc-400">{subtitleText}</p>}

      <div className={`space-y-2 ${maxHeightClassName}`.trim()}>
        {items.map((item) => (
          <Card
            key={item.id}
            glowColor={isIndigo ? "purple" : "blue"}
            className={`p-3 bg-zinc-900/90 flex-col items-stretch rounded-xl border ${cardBorderClass}`}
          >
            <div className="flex justify-between items-start gap-2 w-full">
              <div className="min-w-0 flex-1">
                {(item.score !== undefined || item.reason) && (
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    {item.score !== undefined && (
                      <span
                        className={`text-[10px] font-bold font-mono tabular-nums border px-1.5 py-0.2 rounded ${getScoreBadgeClass(
                          item.score
                        )}`}
                      >
                        {item.score}% Match
                      </span>
                    )}
                    {item.reason && (
                      <span className="text-[10px] text-zinc-400 truncate">
                        {item.reason}
                      </span>
                    )}
                  </div>
                )}
                {item.eyebrow && (
                  <div className="font-mono text-xs text-indigo-400 font-bold">
                    {item.eyebrow}
                  </div>
                )}
                <div className="text-sm font-semibold text-white truncate">
                  {item.title}
                </div>
                <div className="text-[11px] text-zinc-400 truncate">
                  {item.subtitle}
                </div>
              </div>
              <div className="text-right shrink-0 flex flex-col items-end">
                {item.amountLabel && (
                  <div
                    className={`text-sm font-bold font-mono tabular-nums ${
                      item.amountClassName || "text-white"
                    }`}
                  >
                    {item.amountLabel}
                  </div>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  glow
                  isLoading={isActionLoading}
                  disabled={actionDisabled}
                  onClick={item.onAction}
                  className={`text-xs ${item.amountLabel ? "mt-1" : ""}`.trim()}
                >
                  {item.actionLabel}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
