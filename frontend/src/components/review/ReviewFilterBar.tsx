import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { getGroupedAccounts } from "../../utils/accountHierarchy";
import type { ChartAccount } from "../../types/models";
import type { ReviewStatusType } from "../../services/api";

interface ReviewFilterBarProps {
  activeTab: ReviewStatusType;
  search: string;
  onSearchChange: (val: string) => void;
  isFiltersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  onResetFilters: () => void;
  typeFilter: string;
  onTypeFilterChange: (val: string) => void;
  issueFilter: string;
  onIssueFilterChange: (val: string) => void;
  accountFilter: string;
  onAccountFilterChange: (val: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (val: string) => void;
  sortBy: string;
  onSortByChange: (val: string) => void;
  accounts: ChartAccount[];
}

export function ReviewFilterBar({
  activeTab,
  search,
  onSearchChange,
  isFiltersOpen,
  onToggleFilters,
  activeFilterCount,
  onResetFilters,
  typeFilter,
  onTypeFilterChange,
  issueFilter,
  onIssueFilterChange,
  accountFilter,
  onAccountFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  sortBy,
  onSortByChange,
  accounts,
}: ReviewFilterBarProps) {
  const isPending = activeTab === "PENDING";
  const isIgnored = activeTab === "IGNORED";
  const isWarningsIgnored = activeTab === "WARNINGS_IGNORED";
  const isDeleted = activeTab === "DELETED";

  return (
    <div className="shrink-0 mb-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Input
            type="text"
            aria-label="Search review items"
            placeholder="Search description, vendor, reason, amount…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            }
          />
        </div>
        <Button
          variant={isFiltersOpen || activeFilterCount > 0 ? "secondary" : "ghost"}
          size="sm"
          aria-expanded={isFiltersOpen}
          onClick={onToggleFilters}
          className="flex items-center gap-1.5 whitespace-nowrap h-[38px] px-3 font-semibold text-xs border border-white/10 touch-glow-emerald"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          <span>Sort &amp; Filter</span>
          {activeFilterCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
              {activeFilterCount}
            </span>
          )}
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${isFiltersOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </Button>
      </div>

      {isFiltersOpen && (
        <div className="p-3 surface-glass border border-white/10 rounded-xl space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-white/5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Filters &amp; Sorting
            </span>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={onResetFilters}
                className="text-[11px] text-zinc-400 hover:text-emerald-400 transition-colors font-medium cursor-pointer"
              >
                Reset to default
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            <Select
              label="Item Type"
              value={typeFilter}
              onChange={(e) => onTypeFilterChange(e.target.value)}
              className="py-1.5! text-xs!"
            >
              <option value="ALL">All items</option>
              <option value="transaction">Bank transactions</option>
              <option value="expense">Expenses</option>
              <option value="invoice">Invoices</option>
            </Select>
            <Select
              label="Issue / Status"
              value={issueFilter}
              onChange={(e) => onIssueFilterChange(e.target.value)}
              className="py-1.5! text-xs!"
            >
              <option value="ALL">{isIgnored ? "All reasons / states" : "All issues"}</option>
              {isPending && <option value="CLOSED_PERIOD">Closed Period</option>}
              {isPending && <option value="UNLINKED">Unlinked</option>}
              {isPending && <option value="UNDER_ALLOCATED">Under-Allocated</option>}
              {isPending && <option value="OVER_ALLOCATED">Over-Allocated</option>}
              {isPending && <option value="OVERDUE">Overdue Invoices</option>}
              {isPending && <option value="UNPAID">Unpaid / Sent Invoices</option>}
              {isIgnored && (
                <>
                  <optgroup label="Filter by Reason">
                    <option value="DUPLICATE">Duplicate entry</option>
                    <option value="PERSONAL">Personal expense</option>
                    <option value="CLOSED_PERIOD">Declined during review</option>
                    <option value="OTHER">Other</option>
                  </optgroup>
                  <optgroup label="Filter by Accounting Period">
                    <option value="LOCKED">Locked period</option>
                    <option value="OPEN">Open period</option>
                  </optgroup>
                </>
              )}
              {isWarningsIgnored && (
                <>
                  <option value="UNLINKED">Unlinked</option>
                  <option value="UNDER_ALLOCATED">Under-Allocated</option>
                  <option value="OVER_ALLOCATED">Over-Allocated</option>
                  <option value="CLOSED_PERIOD">Closed Period</option>
                </>
              )}
              {isDeleted && <option value="DELETED">Deleted Items</option>}
            </Select>
            <Select
              label="Bank Account"
              value={accountFilter}
              onChange={(e) => onAccountFilterChange(e.target.value)}
              className="py-1.5! text-xs!"
            >
              <option value="ALL">All accounts</option>
              {getGroupedAccounts(accounts, ["ASSET", "LIABILITY"]).map((g) => (
                <optgroup key={g.subClassId} label={g.label}>
                  {g.options.map((opt) => (
                    <option key={opt.account.id} value={opt.account.id}>
                      {opt.displayName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <Select
              label="Category"
              value={categoryFilter}
              onChange={(e) => onCategoryFilterChange(e.target.value)}
              className="py-1.5! text-xs!"
            >
              <option value="ALL">All categories</option>
              <option value="UNCATEGORIZED">Uncategorized</option>
              {getGroupedAccounts(accounts, ["EXPENSE", "REVENUE", "EQUITY", "ASSET", "LIABILITY"]).map((g) => (
                <optgroup key={g.subClassId} label={g.label}>
                  {g.options.map((opt) => (
                    <option key={opt.account.id} value={opt.account.id}>
                      {opt.displayName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <Select
              label="Sort By"
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value)}
              className="py-1.5! text-xs!"
            >
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="amount_desc">Amount: high to low</option>
              <option value="amount_asc">Amount: low to high</option>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
