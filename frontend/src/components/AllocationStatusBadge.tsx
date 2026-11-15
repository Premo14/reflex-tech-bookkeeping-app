import { Badge } from "./ui/Badge";
import type { NormalizedAllocationStatus } from "../utils/ledgerStatus";

interface AllocationStatusBadgeProps {
  status: NormalizedAllocationStatus;
  hasSuggestions?: boolean;
  reviewStatus?: string;
}

/**
 * Canonical allocation & match-readiness badge shared by ledger lists.
 */
export function AllocationStatusBadge({
  status,
  hasSuggestions = false,
  reviewStatus,
}: AllocationStatusBadgeProps) {
  if (reviewStatus === "WARNINGS_IGNORED" || reviewStatus === "IGNORED") {
    return (
      <Badge variant="neutral" size="sm">
        WARNINGS SILENCED
      </Badge>
    );
  }

  if (status === "UNLINKED" && hasSuggestions) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1 glow-blue motion-safe:animate-pulse">
        <svg
          aria-hidden="true"
          className="w-3 h-3 text-blue-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
            clipRule="evenodd"
          />
        </svg>
        MATCH READY
      </span>
    );
  }

  if (status === "BALANCED") {
    return <Badge variant="success">BALANCED</Badge>;
  }
  if (status === "PARTIAL") {
    return (
      <Badge variant="warning" glow>
        UNDER-ALLOCATED
      </Badge>
    );
  }
  if (status === "OVER_ALLOCATED") {
    return (
      <Badge variant="danger" glow>
        OVER-ALLOCATED
      </Badge>
    );
  }
  return <Badge variant="neutral">UNLINKED</Badge>;
}
