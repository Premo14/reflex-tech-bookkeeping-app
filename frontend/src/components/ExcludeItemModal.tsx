import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { excludeItem, previewExclusion } from "../services/api";
import type { ExcludePreview, ExclusionReason } from "../types/models";

interface ExcludeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemType: "transaction" | "expense";
  itemId: number;
  /** Called after the item (and its link group) was successfully excluded. */
  onExcluded: () => void;
}

export const EXCLUSION_REASON_LABELS: Record<string, string> = {
  DUPLICATE: "Duplicate entry",
  PERSONAL: "Personal / non-business",
  ERROR: "Bank or data error",
  OTHER: "Other",
  CLOSED_PERIOD: "Declined in closed-period review",
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export default function ExcludeItemModal({ isOpen, onClose, itemType, itemId, onExcluded }: ExcludeItemModalProps) {
  const [preview, setPreview] = useState<ExcludePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reason, setReason] = useState<ExclusionReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setPreview(null);
    setReason("");
    setNote("");
    setError("");
    setIsLoading(true);
    previewExclusion(itemType, itemId)
      .then(setPreview)
      .catch((err) => setError(err.message || "Failed to load preview"))
      .finally(() => setIsLoading(false));
  }, [isOpen, itemType, itemId]);

  const others = (preview?.items || []).filter((i) => !(i.type === itemType && i.id === itemId));
  const noteRequired = reason === "OTHER";
  const canSubmit = !!preview && !preview.blocked && !!reason && (!noteRequired || note.trim() !== "");

  const handleSubmit = async () => {
    if (!reason) return;
    setIsSaving(true);
    setError("");
    try {
      await excludeItem(itemType, itemId, reason, note);
      onExcluded();
    } catch (err: any) {
      setError(err.message || "Failed to exclude item");
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
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={handleSubmit} disabled={!canSubmit} isLoading={isSaving}>
            Exclude {others.length > 0 ? `${others.length + 1} Items` : "Item"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-200/90 leading-relaxed">
          <p className="font-bold text-amber-400 mb-1">This is rarely the right move.</p>
          Excluding removes the item from reports and totals, and it will no longer be matched or suggested.
          Use it only for duplicates, personal spending, or bank/data errors. Nothing is deleted: the exclusion is
          recorded in the audit history and can be restored later (while the period is open).
        </div>

        {isLoading && <div className="text-center text-zinc-400 py-6">Checking linked items…</div>}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm font-medium">{error}</div>
        )}

        {preview?.blocked && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl text-sm">
            <p className="font-bold text-red-400 mb-1">Can't exclude right now</p>
            {preview.blockedReason}
          </div>
        )}

        {preview && others.length > 0 && (
          <div>
            <p className="text-sm text-zinc-300 mb-2">
              This item is linked, so these linked items will <strong className="text-white">also be excluded</strong> (linked items are always handled together):
            </p>
            <div className="bg-black/30 border border-white/5 rounded-xl divide-y divide-white/5">
              {others.map((i) => (
                <div key={`${i.type}-${i.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="text-white truncate">{i.label}</p>
                    <p className="text-xs text-zinc-400">
                      {i.type === "transaction" ? "Bank transaction" : "Expense"} · {new Date(i.date).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-bold text-zinc-200 shrink-0">{formatMoney(Math.abs(i.amount))}</span>
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
            <option value="DUPLICATE">{EXCLUSION_REASON_LABELS.DUPLICATE}</option>
            <option value="PERSONAL">{EXCLUSION_REASON_LABELS.PERSONAL}</option>
            <option value="ERROR">{EXCLUSION_REASON_LABELS.ERROR}</option>
            <option value="OTHER">{EXCLUSION_REASON_LABELS.OTHER}</option>
          </Select>

          <div>
            <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
              Note {noteRequired ? "(required)" : "(optional)"}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Add context for your records or your accountant…"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
