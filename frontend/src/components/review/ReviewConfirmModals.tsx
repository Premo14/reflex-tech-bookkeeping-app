import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { EXCLUSION_REASON_LABELS } from "../../utils/ledgerStatus";
import type { ExclusionReason } from "../../types/models";

interface ReviewConfirmModalsProps {
  totalSelected: number;
  isResolving: boolean;
  showAllowConfirm: boolean;
  targetOpenDateStr: string | null;
  onCloseAllow: () => void;
  onConfirmAllow: () => void;
  showDeleteConfirm: boolean;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  showPermanentDeleteConfirm: boolean;
  onClosePermanentDelete: () => void;
  onConfirmPermanentDelete: () => void;
  showMoveToExcludedModal: boolean;
  moveToExcludedReason: ExclusionReason | "";
  moveToExcludedNote: string;
  onMoveToExcludedReasonChange: (reason: ExclusionReason | "") => void;
  onMoveToExcludedNoteChange: (note: string) => void;
  onCloseMoveToExcluded: () => void;
  onConfirmMoveToExcluded: () => void;
}

export function ReviewConfirmModals({
  totalSelected,
  isResolving,
  showAllowConfirm,
  targetOpenDateStr,
  onCloseAllow,
  onConfirmAllow,
  showDeleteConfirm,
  onCloseDelete,
  onConfirmDelete,
  showPermanentDeleteConfirm,
  onClosePermanentDelete,
  onConfirmPermanentDelete,
  showMoveToExcludedModal,
  moveToExcludedReason,
  moveToExcludedNote,
  onMoveToExcludedReasonChange,
  onMoveToExcludedNoteChange,
  onCloseMoveToExcluded,
  onConfirmMoveToExcluded,
}: ReviewConfirmModalsProps) {
  return (
    <>
      <Modal
        isOpen={showAllowConfirm}
        onClose={onCloseAllow}
        title="Reopen Books to Allow Items"
        maxWidth="md"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={onCloseAllow}>
              Cancel
            </Button>
            <Button variant="primary" glow onClick={onConfirmAllow} isLoading={isResolving}>
              Confirm &amp; Reopen Books
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p>
            Allowing {totalSelected} item(s) will reopen your books back to{" "}
            <strong className="text-white font-mono tabular-nums">{targetOpenDateStr}</strong> (the day before the oldest allowed item).
          </p>
          <p className="text-xs text-zinc-400">
            Any subsequent items dated after this reopened date will automatically become open. Linked transactions and expenses move together.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={onCloseDelete}
        title="Move Items to Deleted Items"
        maxWidth="md"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={onCloseDelete}>
              Cancel
            </Button>
            <Button variant="danger" glow onClick={onConfirmDelete} isLoading={isResolving}>
              Delete Selected ({totalSelected})
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p>
            Are you sure you want to delete <strong className="text-white">{totalSelected} item(s)</strong>?
          </p>
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-xs leading-relaxed">
            Items will be removed from your books and active reports immediately. They will be kept in{" "}
            <strong>Deleted Items</strong> for 30 days before being permanently purged. You can restore them anytime from the sidebar.
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showPermanentDeleteConfirm}
        onClose={onClosePermanentDelete}
        title="Permanently Delete Items"
        maxWidth="md"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={onClosePermanentDelete}>
              Cancel
            </Button>
            <Button variant="danger" glow onClick={onConfirmPermanentDelete} isLoading={isResolving}>
              Permanently Delete ({totalSelected})
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p className="font-semibold text-red-400">Warning: This action cannot be undone.</p>
          <p>
            Are you sure you want to permanently erase <strong className="text-white">{totalSelected} item(s)</strong>?
            All records, receipt attachments, and associations will be completely removed from the database immediately without waiting for the 30-day retention period.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={showMoveToExcludedModal}
        onClose={onCloseMoveToExcluded}
        title="Move to Excluded Items"
        maxWidth="md"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={onCloseMoveToExcluded}>
              Cancel
            </Button>
            <Button
              variant="primary"
              glow={Boolean(moveToExcludedReason)}
              disabled={!moveToExcludedReason || (moveToExcludedReason === "OTHER" && !moveToExcludedNote.trim())}
              onClick={onConfirmMoveToExcluded}
              isLoading={isResolving}
            >
              Move to Excluded ({totalSelected})
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            Moving {totalSelected} item(s) from Deleted Items to Excluded Items will permanently keep them for your records (out of active books) without being purged after 30 days.
          </p>
          <Select
            label="Reason (required)"
            value={moveToExcludedReason}
            onChange={(e) => onMoveToExcludedReasonChange(e.target.value as ExclusionReason | "")}
          >
            <option value="">Select a reason…</option>
            <option value="DUPLICATE">{EXCLUSION_REASON_LABELS.DUPLICATE}</option>
            <option value="PERSONAL">{EXCLUSION_REASON_LABELS.PERSONAL}</option>
            <option value="CLOSED_PERIOD">{EXCLUSION_REASON_LABELS.CLOSED_PERIOD}</option>
            <option value="OTHER">{EXCLUSION_REASON_LABELS.OTHER}</option>
          </Select>

          <div>
            <label
              htmlFor="move-to-excluded-note"
              className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5 cursor-pointer"
            >
              Note {moveToExcludedReason === "OTHER" ? "(required)" : "(optional)"}
            </label>
            <textarea
              id="move-to-excluded-note"
              value={moveToExcludedNote}
              onChange={(e) => onMoveToExcludedNoteChange(e.target.value)}
              rows={3}
              placeholder="Add context for your records…"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
