import { useEffect, useId, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import {
  excludeItem,
  excludeItems,
  previewBulkExclusion,
  previewExclusion,
} from "../services/api";
import type { ExcludePreview, ExclusionReason } from "../types/models";
import { formatDate } from "../utils/dateUtils";
import { formatCurrency } from "../utils/formatCurrency";
import { EXCLUSION_REASON_LABELS } from "../utils/ledgerStatus";

interface ExcludeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemType?: "transaction" | "expense" | "invoice";
  itemId?: number;
  targets?: Array<{ type: "transaction" | "expense" | "invoice"; id: number }>;
  /** Called after the item (and its link group) was successfully excluded. */
  onExcluded: () => void;
  linkedChoice?: "ONLY_THIS" | "ALL_LINKED";
  onBeforeSubmit?: () => Promise<void>;
}

export default function ExcludeItemModal({
  isOpen,
  onClose,
  itemType,
  itemId,
  targets,
  onExcluded,
  linkedChoice,
  onBeforeSubmit,
}: ExcludeItemModalProps) {
  const noteId = useId();
  const [preview, setPreview] = useState<ExcludePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reason, setReason] = useState<ExclusionReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [scopeChoice, setScopeChoice] = useState<
    "ONLY_SELECTED" | "ALL_LINKED"
  >("ONLY_SELECTED");

  const isBulk = Boolean(targets && targets.length > 0);
  const targetCount = isBulk ? targets!.length : 1;
  const targetsKey = JSON.stringify(targets || []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    const currentTargets: Array<{
      type: "transaction" | "expense";
      id: number;
    }> = JSON.parse(targetsKey);

    void Promise.resolve().then(() => {
      if (!active) return;
      setPreview(null);
      setReason("");
      setNote("");
      setError("");
      setScopeChoice(
        linkedChoice === "ALL_LINKED" ? "ALL_LINKED" : "ONLY_SELECTED"
      );
      setIsLoading(true);

      const promise = isBulk
        ? previewBulkExclusion(currentTargets)
        : itemType && itemId
          ? previewExclusion(itemType, itemId)
          : Promise.resolve(null);

      promise
        .then((res) => {
          if (active) setPreview(res);
        })
        .catch((err: unknown) => {
          if (active) {
            setError(
              err instanceof Error ? err.message : "Failed to load preview"
            );
          }
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
    });

    return () => {
      active = false;
    };
  }, [isOpen, itemType, itemId, isBulk, linkedChoice, targetsKey]);

  const targetSet = isBulk
    ? new Set((targets || []).map((t) => `${t.type}-${t.id}`))
    : new Set(itemType && itemId ? [`${itemType}-${itemId}`] : []);

  const others = (preview?.items || []).filter(
    (i) => !targetSet.has(`${i.type}-${i.id}`)
  );
  const noteRequired = reason === "OTHER";
  const isOnlyThis =
    linkedChoice === "ONLY_THIS" ||
    (!linkedChoice && scopeChoice === "ONLY_SELECTED");
  const canSubmit =
    (isOnlyThis ? true : Boolean(preview && !preview.blocked)) &&
    Boolean(reason) &&
    (!noteRequired || note.trim() !== "");

  const totalCount = preview?.items?.length || targetCount;

  const handleSubmit = async () => {
    if (!reason) return;
    setIsSaving(true);
    setError("");
    const unlinkOnly = isOnlyThis;
    try {
      if (onBeforeSubmit) {
        await onBeforeSubmit();
      }
      if (isBulk && targets) {
        await excludeItems(
          targets,
          reason as ExclusionReason,
          note,
          unlinkOnly
        );
      } else if (itemType && itemId) {
        await excludeItem(
          itemType,
          itemId,
          reason as ExclusionReason,
          note,
          unlinkOnly
        );
      }
      onExcluded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to exclude item");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Exclude from Books"
      maxWidth="lg"
      footer={
        <div className="flex gap-3 justify-end w-full">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            glow
            onClick={handleSubmit}
            disabled={!canSubmit}
            isLoading={isSaving}
          >
            {isOnlyThis
              ? `Exclude ${targetCount === 1 ? "Selected Item" : `${targetCount} Selected Items`}`
              : `Exclude All Linked (${totalCount} Items)`}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-200/90 leading-relaxed">
          <p className="font-bold text-amber-400 mb-1">
            This is rarely the right move.
          </p>
          Excluding removes the item from reports and totals, and it will no
          longer be linked or suggested. Use it only for duplicates, personal
          spending, or items declined during review. Nothing is permanently
          deleted: the exclusion is recorded in the audit history and can be
          restored later (while the period is open).
        </div>

        {linkedChoice && (
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-xl text-sm font-medium">
            {linkedChoice === "ONLY_THIS"
              ? "You chose to sever the link(s) and only exclude this specific item."
              : "You chose to keep the link(s) intact and exclude all linked items."}
          </div>
        )}

        {isLoading && (
          <div className="text-center text-zinc-400 py-6">
            Checking linked items…
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-3 bg-rose-500/10 border border-rose-500/25 text-rose-400 rounded-lg text-sm font-medium"
          >
            {error}
          </div>
        )}

        {preview?.blocked && !isOnlyThis && (
          <div
            role="alert"
            className="p-4 bg-rose-500/10 border border-rose-500/25 text-rose-300 rounded-xl text-sm"
          >
            <p className="font-bold text-rose-400 mb-1">
              Can't exclude right now
            </p>
            {preview.blockedReason}
          </div>
        )}

        {/* Choice between excluding only selected items vs all linked items */}
        {preview && others.length > 0 && !linkedChoice && (
          <div className="p-4 bg-zinc-900/70 border border-zinc-700/80 rounded-xl space-y-3">
            <div className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
              Linked items detected
            </div>
            <p className="text-xs text-zinc-400">
              The item(s) you selected are currently linked to {others.length}{" "}
              other item(s). How would you like to handle this exclusion?
            </p>
            <div className="space-y-2">
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors touch-glow-emerald ${
                  scopeChoice === "ONLY_SELECTED"
                    ? "bg-emerald-500/10 border-emerald-500/35 text-white glow-border-emerald"
                    : "bg-black/20 border-white/5 text-zinc-300 hover:bg-white/5"
                }`}
              >
                <input
                  type="radio"
                  name="scopeChoice"
                  value="ONLY_SELECTED"
                  checked={scopeChoice === "ONLY_SELECTED"}
                  onChange={() => setScopeChoice("ONLY_SELECTED")}
                  className="mt-0.5 text-emerald-500 focus:ring-emerald-500"
                />
                <div>
                  <div className="font-semibold text-sm">
                    Unlink &amp; exclude only selected ({targetCount}{" "}
                    {targetCount === 1 ? "item" : "items"})
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Severs the link(s). Only the{" "}
                    {targetCount === 1 ? "item" : `${targetCount} items`} you
                    checked will be excluded. The other {others.length} linked
                    item(s) remain in your books.
                  </div>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors touch-glow-amber ${
                  scopeChoice === "ALL_LINKED"
                    ? "bg-amber-500/10 border-amber-500/35 text-white glow-border-amber"
                    : "bg-black/20 border-white/5 text-zinc-300 hover:bg-white/5"
                }`}
              >
                <input
                  type="radio"
                  name="scopeChoice"
                  value="ALL_LINKED"
                  checked={scopeChoice === "ALL_LINKED"}
                  onChange={() => setScopeChoice("ALL_LINKED")}
                  className="mt-0.5 text-amber-500 focus:ring-amber-500"
                />
                <div>
                  <div className="font-semibold text-sm">
                    Exclude all linked items together ({totalCount} items)
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Keeps the relationship intact and excludes the selected
                    item(s) PLUS the {others.length} other linked item(s) from
                    your books.
                  </div>
                </div>
              </label>
            </div>
          </div>
        )}

        {preview &&
          others.length > 0 &&
          (scopeChoice === "ALL_LINKED" || linkedChoice === "ALL_LINKED") && (
            <div>
              <div className="text-xs font-semibold text-zinc-400 mb-1.5">
                Additional linked items that will also be excluded (
                {others.length}):
              </div>
              <div className="bg-black/30 border border-white/5 rounded-xl divide-y divide-white/5 max-h-48 overflow-y-auto">
                {others.map((i) => (
                  <div
                    key={`${i.type}-${i.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-white truncate">{i.label}</p>
                      <p className="text-xs text-zinc-400">
                        {i.type === "transaction"
                          ? "Bank transaction"
                          : i.type === "invoice"
                          ? "Invoice"
                          : "Expense"}{" "}
                        · {formatDate(i.date)}
                      </p>
                    </div>
                    <span className="font-bold font-mono tabular-nums text-zinc-200 shrink-0">
                      {formatCurrency(Math.abs(i.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        <div className="space-y-4">
          <Select
            label="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value as ExclusionReason)}
          >
            <option value="">Select a reason…</option>
            <option value="DUPLICATE">
              {EXCLUSION_REASON_LABELS.DUPLICATE}
            </option>
            <option value="PERSONAL">{EXCLUSION_REASON_LABELS.PERSONAL}</option>
            <option value="CLOSED_PERIOD">
              {EXCLUSION_REASON_LABELS.CLOSED_PERIOD}
            </option>
            <option value="OTHER">{EXCLUSION_REASON_LABELS.OTHER}</option>
          </Select>

          <div>
            <label
              htmlFor={noteId}
              className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5"
            >
              Note {noteRequired ? "(required)" : "(optional)"}
            </label>
            <textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Add context for your records or your accountant…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
