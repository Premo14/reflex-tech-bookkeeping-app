import { useEffect } from "react";
import type { Receipt } from "../../types/models";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

export interface ReceiptCanvasPaneProps {
  isOpen: boolean;
  receipts: Receipt[];
  activeReceiptIdx: number;
  onChangeActiveReceiptIdx: (updater: number | ((prev: number) => number)) => void;
  zoom: number;
  onChangeZoom: (updater: number | ((prev: number) => number)) => void;
  rotation: number;
  onChangeRotation: (updater: number | ((prev: number) => number)) => void;
  isClosed: boolean;
  isSaving: boolean;
  onDeleteReceipt: (receiptId: number) => void;
  onClose: () => void;
}

/** Lightbox canvas for inspecting, zooming, rotating, navigating, and deleting attached physical receipts. */
export function ReceiptCanvasPane({
  isOpen,
  receipts,
  activeReceiptIdx,
  onChangeActiveReceiptIdx,
  zoom,
  onChangeZoom,
  rotation,
  onChangeRotation,
  isClosed,
  isSaving,
  onDeleteReceipt,
  onClose,
}: ReceiptCanvasPaneProps) {
  const totalReceipts = receipts.length;
  const safeIdx = totalReceipts > 0 ? Math.min(Math.max(activeReceiptIdx, 0), totalReceipts - 1) : 0;
  const receipt = totalReceipts > 0 ? receipts[safeIdx] : null;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag && ["INPUT", "TEXTAREA", "SELECT"].includes(targetTag)) return;

      if (totalReceipts > 1) {
        if (e.key === "ArrowLeft") {
          onChangeActiveReceiptIdx((prev) => Math.max(0, prev - 1));
          onChangeZoom(1);
          onChangeRotation(0);
          return;
        }
        if (e.key === "ArrowRight") {
          onChangeActiveReceiptIdx((prev) => Math.min(totalReceipts - 1, prev + 1));
          onChangeZoom(1);
          onChangeRotation(0);
          return;
        }
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        onChangeZoom((prev) => Math.min(3, prev + 0.25));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        onChangeZoom((prev) => Math.max(0.5, prev - 0.25));
      } else if (e.key === "0") {
        e.preventDefault();
        onChangeZoom(1);
        onChangeRotation(0);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        onChangeRotation((prev) => (prev + 90) % 360);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, totalReceipts, onChangeActiveReceiptIdx, onChangeZoom, onChangeRotation]);

  const navigateReceipt = (nextIndex: number) => {
    onChangeActiveReceiptIdx(nextIndex);
    onChangeZoom(1);
    onChangeRotation(0);
  };

  const resetTransform = () => {
    onChangeZoom(1);
    onChangeRotation(0);
  };

  const filename = receipt ? receipt.documentUri.split("/").pop() || receipt.documentUri : "";
  const fileUrl = receipt ? `/api/images/${filename}` : "";
  const isPdf = receipt ? receipt.fileExt.toLowerCase() === ".pdf" : false;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="4xl"
      title={
        <div className="flex items-center gap-2.5 flex-wrap">
          <span>Physical Receipt</span>
          {totalReceipts > 1 && (
            <Badge variant="info" className="font-mono tabular-nums">
              {safeIdx + 1} / {totalReceipts}
            </Badge>
          )}
        </div>
      }
      bodyClassName="bg-zinc-950/90 min-h-[50vh] p-4 sm:p-5"
    >
      {receipt ? (
        <div className="w-full flex flex-col items-center py-2 relative">
          {totalReceipts > 1 && (
            <div className="flex w-full justify-between px-2 sm:px-4 absolute top-1/2 -translate-y-1/2 z-10 pointer-events-none">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigateReceipt(Math.max(0, safeIdx - 1))}
                disabled={safeIdx === 0}
                aria-label="Previous receipt"
                className="pointer-events-auto p-0! w-10 h-10 rounded-full bg-black/70 text-white border border-white/15 hover:bg-black/90 touch-glow-emerald"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigateReceipt(Math.min(totalReceipts - 1, safeIdx + 1))}
                disabled={safeIdx === totalReceipts - 1}
                aria-label="Next receipt"
                className="pointer-events-auto p-0! w-10 h-10 rounded-full bg-black/70 text-white border border-white/15 hover:bg-black/90 touch-glow-emerald"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </Button>
            </div>
          )}

          {!isPdf && (
            <div className="flex items-center gap-1.5 mb-3 surface-glass glow-border-emerald px-3 py-1.5 rounded-xl shadow-lg">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChangeZoom((prev) => Math.max(0.5, prev - 0.25))}
                title="Zoom Out (−)"
                aria-label="Zoom Out"
                className="p-0! min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] touch-glow-emerald text-sm font-bold"
              >
                −
              </Button>
              <span className="text-xs font-mono tabular-nums text-zinc-200 w-12 text-center select-none font-semibold">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChangeZoom((prev) => Math.min(3, prev + 0.25))}
                title="Zoom In (+)"
                aria-label="Zoom In"
                className="p-0! min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] touch-glow-emerald text-sm font-bold"
              >
                +
              </Button>
              <div className="h-4 w-px bg-white/15 mx-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChangeRotation((prev) => (prev + 90) % 360)}
                title="Rotate 90° Clockwise (R)"
                aria-label="Rotate 90 degrees clockwise"
                className="p-0! min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] touch-glow-emerald text-base font-bold"
              >
                ↻
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetTransform}
                title="Reset Zoom & Rotation (0)"
                aria-label="Reset zoom and rotation"
                className="px-2.5 py-1 text-xs font-medium text-zinc-300 touch-glow-emerald"
              >
                Reset
              </Button>
            </div>
          )}

          {isPdf ? (
            <iframe
              src={fileUrl}
              className="w-full h-[70vh] rounded-lg bg-white border border-white/10"
              title={`Receipt ${receipt.id}`}
            />
          ) : (
            <div className="w-full max-h-[68vh] overflow-auto flex items-center justify-center p-2 rounded-lg bg-zinc-950/70 border border-white/10">
              <img
                src={fileUrl}
                alt={`Receipt ${receipt.id}`}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                  transition: "transform 0.15s ease-out",
                }}
                className="max-w-full max-h-[64vh] object-contain rounded select-none motion-reduce:transition-none"
              />
            </div>
          )}

          <p className="text-zinc-400 text-xs font-mono mt-3 mb-1 break-all text-center">{filename}</p>
          {totalReceipts > 1 && (
            <p className="text-zinc-400 text-xs font-semibold tabular-nums">
              Image {safeIdx + 1} of {totalReceipts}
            </p>
          )}
          {!isClosed && (
            <div className="mt-4">
              <Button
                variant="danger"
                size="sm"
                onClick={() => onDeleteReceipt(receipt.id)}
                disabled={isSaving}
                isLoading={isSaving}
                className="touch-glow-red"
              >
                {isSaving ? "Deleting..." : "Delete Receipt"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="h-full flex items-center justify-center text-zinc-400 min-h-[45vh] text-sm">
          <p>No physical receipt attached.</p>
        </div>
      )}
    </Modal>
  );
}
