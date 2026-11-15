import { formatCents } from "../../utils/formatCurrency";

export interface AllocationProgressBarProps {
  allocatedCents: number;
  totalCents: number;
  linkedCount?: number;
}

/** Exact integer-cent allocation meter shown at the footer of linked Expense and Transaction columns. */
export function AllocationProgressBar({
  allocatedCents,
  totalCents,
  linkedCount = 1,
}: AllocationProgressBarProps) {
  const remainingCents = totalCents - allocatedCents;
  const pct = totalCents > 0 ? Math.min(100, Math.max(0, (allocatedCents / totalCents) * 100)) : 0;

  const barColorClass =
    remainingCents < 0 ? "bg-red-500" : remainingCents > 0 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="mt-5 pt-4 border-t border-zinc-800">
      <div className="space-y-2">
        <div className="flex justify-between text-xs font-semibold">
          <span className="text-zinc-400 font-mono tabular-nums">
            Allocated: {formatCents(allocatedCents)}
          </span>
          <span className="text-white font-mono tabular-nums">
            {formatCents(totalCents)} Total{linkedCount > 1 ? ` (${linkedCount} linked)` : ""}
          </span>
        </div>
        <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all motion-reduce:transition-none ${barColorClass}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {remainingCents > 0 && (
          <p className="text-amber-400 text-xs font-medium font-mono tabular-nums">
            ⚠️ {formatCents(remainingCents)} remaining to allocate.
          </p>
        )}
        {remainingCents < 0 && (
          <p className="text-red-400 text-xs font-medium font-mono tabular-nums">
            🚨 Over-allocated by {formatCents(Math.abs(remainingCents))}.
          </p>
        )}
      </div>
    </div>
  );
}
