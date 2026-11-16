import { Button } from "../ui/Button";

export interface DetailLinkedPaginationProps {
  label: "Transaction" | "Expense";
  accent: "blue" | "emerald";
  total: number;
  activeIndex: number;
  onChangeIndex: (index: number) => void;
}

/** Compact carousel pager for stepping through multiple linked transactions or expenses. */
export function DetailLinkedPagination({
  label,
  accent,
  total,
  activeIndex,
  onChangeIndex,
}: DetailLinkedPaginationProps) {
  if (total <= 1) return null;

  const activeDotClass =
    accent === "blue" ? "bg-blue-400 scale-125" : "bg-emerald-400 scale-125";
  const touchGlowClass = accent === "blue" ? "touch-glow-blue" : "touch-glow-emerald";

  return (
    <div className="flex items-center justify-center gap-2 mb-4 py-1.5">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => onChangeIndex(Math.max(0, activeIndex - 1))}
        disabled={activeIndex === 0}
        className={`p-0! w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:text-white text-base shrink-0 ${touchGlowClass}`}
        title={`Previous ${label}`}
        aria-label={`Previous ${label}`}
      >
        ‹
      </Button>
      <span className="text-xs text-zinc-400 font-medium font-mono tabular-nums px-1">
        {activeIndex + 1} / {total}
      </span>
      <div className="flex items-center gap-1.5 px-1">
        {Array.from({ length: total }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChangeIndex(i)}
            className="p-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-full"
            title={`${label} ${i + 1}`}
            aria-label={`${label} ${i + 1}`}
          >
            <span
              className={`block w-2.5 h-2.5 rounded-full transition-all motion-reduce:transition-none ${
                i === activeIndex ? activeDotClass : "bg-zinc-600 hover:bg-zinc-400"
              }`}
            />
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => onChangeIndex(Math.min(total - 1, activeIndex + 1))}
        disabled={activeIndex === total - 1}
        className={`p-0! w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:text-white text-base shrink-0 ${touchGlowClass}`}
        title={`Next ${label}`}
        aria-label={`Next ${label}`}
      >
        ›
      </Button>
    </div>
  );
}
