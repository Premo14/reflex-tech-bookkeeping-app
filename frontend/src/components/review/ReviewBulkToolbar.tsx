import React from "react";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { getGroupedAccounts } from "../../utils/accountHierarchy";
import type { ChartAccount } from "../../types/models";
import type { ReviewStatusType } from "../../services/api";
import { PAGE_SIZE, type ReviewRow } from "./reviewHelpers";

interface ReviewBulkToolbarProps {
  activeTab: ReviewStatusType;
  selectAllRef: React.RefObject<HTMLInputElement | null>;
  allPageSelected: boolean;
  onToggleAllPage: () => void;
  paginatedCount: number;
  visibleRows: ReviewRow[];
  selectedRows: ReviewRow[];
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  accounts: ChartAccount[];
  bulkCategory: string;
  onBulkCategoryChange: (val: string) => void;
  isBulkCategorizing: boolean;
  onBulkCategorize: () => void;
  isResolving: boolean;
  canMassAllow: boolean;
  canIgnoreWarnings: boolean;
  canSendToQueue: boolean;
  canDirectRestore: boolean;
  onShowDeleteConfirm: () => void;
  onShowExcludeModal: () => void;
  onShowAllowConfirm: () => void;
  onShowPermanentDeleteConfirm: () => void;
  onShowMoveToExcludedModal: () => void;
  onIgnoreWarnings: () => void;
  onSendToQueue: () => void;
  onRestoreIgnored: () => void;
  onRestoreWarnings: () => void;
  onRestoreDeleted: () => void;
  onOpenSingleDrawer: () => void;
}

export function ReviewBulkToolbar({
  activeTab,
  selectAllRef,
  allPageSelected,
  onToggleAllPage,
  paginatedCount,
  visibleRows,
  selectedRows,
  onSelectAllVisible,
  onClearSelection,
  accounts,
  bulkCategory,
  onBulkCategoryChange,
  isBulkCategorizing,
  onBulkCategorize,
  isResolving,
  canMassAllow,
  canIgnoreWarnings,
  canSendToQueue,
  canDirectRestore,
  onShowDeleteConfirm,
  onShowExcludeModal,
  onShowAllowConfirm,
  onShowPermanentDeleteConfirm,
  onShowMoveToExcludedModal,
  onIgnoreWarnings,
  onSendToQueue,
  onRestoreIgnored,
  onRestoreWarnings,
  onRestoreDeleted,
  onOpenSingleDrawer,
}: ReviewBulkToolbarProps) {
  const isPending = activeTab === "PENDING";
  const isIgnored = activeTab === "IGNORED";
  const isWarningsIgnored = activeTab === "WARNINGS_IGNORED";
  const isDeleted = activeTab === "DELETED";
  const totalSelected = selectedRows.length;

  return (
    <>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-2">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allPageSelected}
              onChange={onToggleAllPage}
              disabled={paginatedCount === 0}
              className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 accent-emerald-500 cursor-pointer"
            />
            <span>
              {visibleRows.length > PAGE_SIZE
                ? `${paginatedCount} on page (${visibleRows.length} total)`
                : `${visibleRows.length} shown`}
              {" · "}
              <strong className={totalSelected > 0 ? "text-white font-mono tabular-nums" : "text-zinc-400 font-mono tabular-nums"}>
                {totalSelected} selected
              </strong>
            </span>
          </label>
          {visibleRows.length > paginatedCount && totalSelected < visibleRows.length && (
            <button
              type="button"
              onClick={onSelectAllVisible}
              className="text-xs text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
            >
              Select all {visibleRows.length}
            </button>
          )}
          {totalSelected > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs text-zinc-400 hover:text-white hover:underline cursor-pointer"
            >
              Clear selection
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {!isDeleted && totalSelected > 0 && (
            <div className="flex items-center gap-1.5 bg-zinc-800/90 py-1 px-2 rounded-lg border border-zinc-700/80">
              <label
                htmlFor="review-bulk-category"
                className="text-xs text-zinc-400 font-medium whitespace-nowrap cursor-pointer"
              >
                Category:
              </label>
              <Select
                id="review-bulk-category"
                aria-label="Bulk category"
                autoWidth
                searchable
                dropdownAlign="right"
                dropdownWidth="w-72"
                value={bulkCategory}
                onChange={(e) => onBulkCategoryChange(e.target.value)}
                disabled={isBulkCategorizing}
                className="py-1! min-h-[30px]! text-xs! max-w-[220px]"
              >
                <option value="">
                  Assign to {totalSelected} item{totalSelected > 1 ? "s" : ""}...
                </option>
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
              <Button
                variant="primary"
                size="sm"
                glow={Boolean(bulkCategory)}
                disabled={!bulkCategory || isBulkCategorizing}
                isLoading={isBulkCategorizing}
                onClick={onBulkCategorize}
              >
                Apply
              </Button>
            </div>
          )}

          {isPending && (
            <>
              <Button variant="danger" size="sm" disabled={totalSelected === 0} onClick={onShowDeleteConfirm}>
                Delete Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
              <Button variant="danger" size="sm" disabled={totalSelected === 0} onClick={onShowExcludeModal}>
                Exclude Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canIgnoreWarnings}
                onClick={onIgnoreWarnings}
                isLoading={isResolving}
              >
                Ignore Warnings
              </Button>
              {totalSelected === 1 && (
                <Button variant="primary" size="sm" glow onClick={onOpenSingleDrawer}>
                  Open in Drawer
                </Button>
              )}
              {canMassAllow && (
                <Button
                  variant="primary"
                  size="sm"
                  glow
                  disabled={!canMassAllow}
                  onClick={onShowAllowConfirm}
                  isLoading={isResolving}
                >
                  Allow Selected ({totalSelected})
                </Button>
              )}
            </>
          )}

          {isIgnored && (
            <>
              <Button variant="danger" size="sm" disabled={totalSelected === 0} onClick={onShowDeleteConfirm}>
                Delete Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canSendToQueue}
                onClick={onSendToQueue}
                isLoading={isResolving}
              >
                Send to Review Queue
              </Button>
              <Button
                variant="primary"
                size="sm"
                glow={canDirectRestore}
                disabled={!canDirectRestore}
                onClick={onRestoreIgnored}
                isLoading={isResolving}
              >
                Restore Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
            </>
          )}

          {isWarningsIgnored && (
            <>
              <Button variant="danger" size="sm" disabled={totalSelected === 0} onClick={onShowDeleteConfirm}>
                Delete Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
              <Button variant="danger" size="sm" disabled={totalSelected === 0} onClick={onShowExcludeModal}>
                Exclude Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
              <Button
                variant="primary"
                size="sm"
                glow={totalSelected > 0}
                disabled={totalSelected === 0}
                onClick={onRestoreWarnings}
                isLoading={isResolving}
              >
                Restore Warnings
              </Button>
            </>
          )}

          {isDeleted && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={totalSelected === 0}
                onClick={onShowMoveToExcludedModal}
                isLoading={isResolving}
              >
                Move to Excluded {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={totalSelected === 0}
                onClick={onShowPermanentDeleteConfirm}
                isLoading={isResolving}
              >
                Delete Permanently {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
              <Button
                variant="primary"
                size="sm"
                glow={totalSelected > 0}
                disabled={totalSelected === 0}
                onClick={onRestoreDeleted}
                isLoading={isResolving}
              >
                Restore Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
              </Button>
            </>
          )}
        </div>
      </div>

      {totalSelected > 0 && isPending && !canMassAllow && !canIgnoreWarnings && (
        <p className="text-xs text-zinc-400 mb-2">
          Selection contains both closed-period items and unlinked/open items. Handle closed-period items separately (Allow or Exclude).
        </p>
      )}
      {totalSelected > 0 && isPending && !canMassAllow && canIgnoreWarnings && (
        <p className="text-xs text-zinc-400 mb-2">
          Allow is only for closed-period items. For unlinked items, link them or ignore their warnings.
        </p>
      )}
      {totalSelected > 0 && isPending && canMassAllow && !canIgnoreWarnings && (
        <p className="text-xs text-zinc-400 mb-2">
          Warnings cannot be silenced on closed-period items. Allow or Exclude them instead.
        </p>
      )}
      {totalSelected > 0 && isIgnored && !canSendToQueue && !canDirectRestore && (
        <p className="text-xs text-zinc-400 mb-2">
          Selection contains both locked-period and open-period items. Items in a locked period cannot be restored directly; handle them separately.
        </p>
      )}
      {totalSelected > 0 && isIgnored && canSendToQueue && (
        <p className="text-xs text-zinc-400 mb-2">
          Selected item(s) fall in a locked accounting period. They cannot be restored directly; click &quot;Send to Review Queue&quot; to review reopening the books.
        </p>
      )}
      {totalSelected > 0 && isIgnored && canDirectRestore && (
        <p className="text-xs text-zinc-400 mb-2">
          Restore Selected will return these item(s) to your books.
        </p>
      )}
      {totalSelected > 0 && isWarningsIgnored && (
        <p className="text-xs text-zinc-400 mb-2">
          Restore Warnings will turn reconciliation warnings back on for the selected item(s).
        </p>
      )}
      {totalSelected > 0 && isDeleted && (
        <p className="text-xs text-zinc-400 mb-2">
          Restore Selected returns items to active books. Move to Excluded keeps them permanently out of your books. Delete Permanently erases them immediately.
        </p>
      )}
    </>
  );
}
