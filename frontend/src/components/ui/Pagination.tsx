import { Button } from './Button';

export interface PaginationProps {
  // Standard variant props
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;

  // Variant selector
  variant?: 'standard' | 'load-more';

  // Load-more variant props
  hasMore?: boolean;
  onLoadMore?: () => void;
  loading?: boolean;
  loadedCount?: number;
  totalItems?: number;
  label?: string;
  className?: string;
}

export default function Pagination({
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  variant = 'standard',
  hasMore = false,
  onLoadMore,
  loading = false,
  loadedCount,
  totalItems,
  label = 'Load More',
  className = '',
}: PaginationProps) {
  if (variant === 'load-more') {
    if (!hasMore && (totalItems === undefined || loadedCount === undefined || loadedCount === 0)) {
      return null;
    }

    return (
      <div className={`flex flex-col items-center justify-center gap-1.5 mt-3 py-1 ${className}`}>
        {hasMore && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onLoadMore}
            disabled={loading}
            className="text-xs px-4 py-1.5 h-auto font-medium text-zinc-300 hover:text-white"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin -ml-0.5 h-3.5 w-3.5 text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                Loading...
              </span>
            ) : (
              label
            )}
          </Button>
        )}
        {totalItems !== undefined && loadedCount !== undefined && totalItems > 0 && (
          <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
            Showing {loadedCount} of {totalItems}
          </span>
        )}
      </div>
    );
  }

  // Standard pagination variant
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Pagination" className={`flex items-center justify-center gap-2 mt-4 py-2 ${className}`}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onPageChange?.(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        Prev
      </Button>
      <span className="text-zinc-400 text-xs font-mono tabular-nums px-2">
        Page {currentPage} of {totalPages}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onPageChange?.(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        Next
      </Button>
    </nav>
  );
}
