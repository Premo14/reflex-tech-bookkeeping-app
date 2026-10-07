// React imported implicitly in Vite

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center space-x-2 mt-4 py-2">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-3 py-1 rounded bg-zinc-800 text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-700 transition text-sm"
      >
        Prev
      </button>
      <span className="text-zinc-400 text-sm">
        Page {currentPage} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="px-3 py-1 rounded bg-zinc-800 text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-700 transition text-sm"
      >
        Next
      </button>
    </div>
  );
}
