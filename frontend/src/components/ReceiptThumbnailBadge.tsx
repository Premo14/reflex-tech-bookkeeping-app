import React, { useEffect, useId, useRef, useState } from "react";
import ReactDOM from "react-dom";
import type { Receipt } from "../types/models";

interface ReceiptThumbnailBadgeProps {
  receipts?: Receipt[];
  onOpenReceipt?: (e: React.MouseEvent) => void;
}

export default function ReceiptThumbnailBadge({
  receipts,
  onOpenReceipt,
}: ReceiptThumbnailBadgeProps) {
  const badgeRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasLightboxOpenRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const lightboxTitleId = useId();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  }>({
    top: 0,
    left: 0,
    placement: "top",
  });

  // Built-in full-resolution lightbox state
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // Manage focus into the lightbox when opened and restore to trigger on close
  useEffect(() => {
    if (isLightboxOpen) {
      wasLightboxOpenRef.current = true;
      closeButtonRef.current?.focus();
    } else if (wasLightboxOpenRef.current) {
      wasLightboxOpenRef.current = false;
      badgeRef.current?.focus();
    }
  }, [isLightboxOpen]);

  useEffect(() => {
    if (!isPreviewOpen || isLightboxOpen) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsPreviewOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [isPreviewOpen, isLightboxOpen]);

  useEffect(() => {
    if (!isLightboxOpen || !receipts || receipts.length === 0) return;
    const activeReceipt = receipts[activeIdx] || receipts[0];
    const isPdf = (activeReceipt?.fileExt || "").toLowerCase() === ".pdf";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsLightboxOpen(false);
      } else if (!isPdf && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        setZoom((z) => Math.min(3, z + 0.25));
      } else if (!isPdf && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(0.5, z - 0.25));
      } else if (!isPdf && e.key === "0") {
        e.preventDefault();
        setZoom(1);
        setRotation(0);
      } else if (!isPdf && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        setRotation((r) => (r + 90) % 360);
      } else if (e.key === "ArrowLeft" && receipts.length > 1) {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        setZoom(1);
        setRotation(0);
      } else if (e.key === "ArrowRight" && receipts.length > 1) {
        e.preventDefault();
        setActiveIdx((i) => Math.min(receipts.length - 1, i + 1));
        setZoom(1);
        setRotation(0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLightboxOpen, activeIdx, receipts]);

  if (!receipts || receipts.length === 0) return null;

  const currentReceipt = receipts[activeIdx] || receipts[0];
  const filename = currentReceipt.documentUri.split("/").pop() || "receipt";
  const isPdf = (currentReceipt.fileExt || "").toLowerCase() === ".pdf";
  const fileUrl = `/api/images/${filename}`;

  const previewFilename = receipts[0].documentUri.split("/").pop() || "receipt";
  const previewIsPdf = (receipts[0].fileExt || "").toLowerCase() === ".pdf";
  const previewUrl = `/api/images/${previewFilename}`;

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const computePosition = () => {
    const el = badgeRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const popoverWidth = 224;
    const popoverHeight = 250;
    const gap = 6;

    const placeBelow = rect.top < popoverHeight + 16;
    const placement: "top" | "bottom" = placeBelow ? "bottom" : "top";
    const top = placeBelow ? rect.bottom + gap : rect.top - gap;
    const maxLeft = Math.max(8, window.innerWidth - popoverWidth - 8);
    const left = Math.min(maxLeft, Math.max(8, rect.left));
    setCoords({ top, left, placement });
  };

  const openPreview = () => {
    clearCloseTimer();
    computePosition();
    setIsPreviewOpen(true);
  };

  const scheduleClosePreview = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setIsPreviewOpen(false);
    }, 150);
  };

  const handleOpenLightbox = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearCloseTimer();
    setIsPreviewOpen(false);
    if (onOpenReceipt) {
      onOpenReceipt(e);
      return;
    }
    setActiveIdx(0);
    setZoom(1);
    setRotation(0);
    setIsLightboxOpen(true);
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={openPreview}
      onMouseLeave={scheduleClosePreview}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={badgeRef}
        type="button"
        onClick={(e) => {
          if (
            typeof window !== "undefined" &&
            window.matchMedia &&
            window.matchMedia("(hover: none)").matches
          ) {
            e.stopPropagation();
            if (!isPreviewOpen) {
              openPreview();
            } else {
              handleOpenLightbox(e);
            }
            return;
          }
          handleOpenLightbox(e);
        }}
        className="flex items-center gap-1 min-h-[24px] text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25 cursor-pointer hover:bg-emerald-500/20 hover:border-emerald-500/45 touch-glow-emerald motion-safe:active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
        aria-label={
          receipts.length > 1
            ? `View ${receipts.length} receipts`
            : "View physical receipt"
        }
        aria-expanded={isPreviewOpen || isLightboxOpen}
      >
        <svg
          aria-hidden="true"
          className="w-3 h-3 text-emerald-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
          />
        </svg>
        <span>
          {receipts.length > 1 ? `${receipts.length} Receipts` : "Receipt"}
        </span>
      </button>

      {/* Portal-rendered hover preview (opens from trigger corner & avoids overflow clipping) */}
      {isPreviewOpen &&
        typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <div
            onMouseEnter={openPreview}
            onMouseLeave={scheduleClosePreview}
            onClick={handleOpenLightbox}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform:
                coords.placement === "top"
                  ? "translateY(-100%)"
                  : "translateY(0)",
              transformOrigin:
                coords.placement === "top" ? "bottom left" : "top left",
            }}
            className="z-[90] w-56 max-w-[calc(100vw-16px)] p-2.5 surface-glass border border-zinc-700/80 rounded-xl shadow-2xl flex flex-col cursor-pointer pointer-events-auto hover:border-emerald-500/50 glow-border-emerald transition-colors"
          >
            <div className="w-full flex items-center justify-between pb-1.5 mb-1.5 border-b border-zinc-800 text-[10px] text-zinc-400">
              <span className="font-semibold text-zinc-200 truncate max-w-[140px]">
                {previewFilename}
              </span>
              <div className="flex items-center gap-1.5">
                {receipts.length > 1 && (
                  <span className="text-emerald-400 font-mono tabular-nums text-[9px]">
                    1/{receipts.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsPreviewOpen(false);
                  }}
                  className="sm:hidden min-w-[24px] min-h-[24px] flex items-center justify-center text-zinc-400 hover:text-white px-1 font-bold rounded touch-glow-emerald"
                  aria-label="Close preview"
                >
                  ✕
                </button>
              </div>
            </div>

            {previewIsPdf ? (
              <div className="w-full h-36 flex flex-col items-center justify-center bg-zinc-800/80 rounded-lg border border-zinc-700/60 p-3 text-center">
                <svg
                  aria-hidden="true"
                  className="w-10 h-10 text-red-400 mb-1.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <span className="text-[11px] text-zinc-200 font-medium">
                  PDF Document
                </span>
                <span className="text-[9px] text-zinc-400 mt-0.5">
                  Click to open in viewer
                </span>
              </div>
            ) : (
              <div className="w-full h-44 relative overflow-hidden rounded-lg bg-black/60 border border-zinc-800 flex items-center justify-center">
                <img
                  src={previewUrl}
                  alt={previewFilename}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            )}

            <div className="mt-2 flex items-center justify-between text-[10px] text-emerald-400 font-medium">
              <span>Click to view full {previewIsPdf ? "PDF" : "image"}</span>
              {receipts.length > 1 && (
                <span className="text-zinc-400 font-mono tabular-nums">
                  +{receipts.length - 1} more
                </span>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Built-in Full-Resolution Lightbox Modal */}
      {isLightboxOpen &&
        typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={lightboxTitleId}
            className="fixed inset-0 z-[115] flex items-center justify-center bg-black/85 p-3 sm:p-6 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsLightboxOpen(false);
            }}
          >
            <div
              className="surface-glass glow-border-emerald border border-zinc-700 rounded-2xl max-w-4xl w-full flex flex-col max-h-[92vh] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-zinc-800 flex justify-between items-center gap-3 bg-zinc-950/60">
                <div className="min-w-0">
                  <h3
                    id={lightboxTitleId}
                    className="font-bold text-sm text-white truncate"
                  >
                    Physical Receipt — {filename}
                  </h3>
                  {receipts.length > 1 && (
                    <p className="text-[11px] text-zinc-400 font-mono tabular-nums">
                      Attachment {activeIdx + 1} of {receipts.length}
                    </p>
                  )}
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => setIsLightboxOpen(false)}
                  className="text-zinc-400 hover:text-white p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg hover:bg-white/10 touch-glow-emerald cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                  aria-label="Close receipt viewer"
                >
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              <div className="p-4 flex-1 overflow-auto bg-[#050505] flex flex-col items-center justify-center min-h-[55vh] relative">
                {receipts.length > 1 && (
                  <div className="flex w-full justify-between px-2 sm:px-4 absolute top-1/2 -translate-y-1/2 z-10 pointer-events-none">
                    <button
                      type="button"
                      disabled={activeIdx === 0}
                      onClick={() => {
                        setActiveIdx((i) => Math.max(0, i - 1));
                        setZoom(1);
                        setRotation(0);
                      }}
                      className="pointer-events-auto bg-black/70 text-white rounded-full p-2 min-w-[36px] min-h-[36px] flex items-center justify-center hover:bg-black disabled:opacity-30 cursor-pointer border border-white/10 touch-glow-emerald focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                      aria-label="Previous attachment"
                    >
                      <svg
                        aria-hidden="true"
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      disabled={activeIdx === receipts.length - 1}
                      onClick={() => {
                        setActiveIdx((i) =>
                          Math.min(receipts.length - 1, i + 1)
                        );
                        setZoom(1);
                        setRotation(0);
                      }}
                      className="pointer-events-auto bg-black/70 text-white rounded-full p-2 min-w-[36px] min-h-[36px] flex items-center justify-center hover:bg-black disabled:opacity-30 cursor-pointer border border-white/10 touch-glow-emerald focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                      aria-label="Next attachment"
                    >
                      <svg
                        aria-hidden="true"
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </button>
                  </div>
                )}

                {!isPdf && (
                  <div className="flex items-center gap-1.5 mb-3 bg-zinc-900/95 px-3 py-1 rounded-xl border border-white/10 shadow-lg">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                      className="text-zinc-300 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold hover:bg-white/10 touch-glow-emerald cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                      aria-label="Zoom Out"
                    >
                      −
                    </button>
                    <span className="text-xs font-mono tabular-nums text-zinc-300 w-12 text-center select-none font-semibold">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                      className="text-zinc-300 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold hover:bg-white/10 touch-glow-emerald cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                      aria-label="Zoom In"
                    >
                      +
                    </button>
                    <div className="h-4 w-px bg-white/20 mx-1" />
                    <button
                      type="button"
                      onClick={() => setRotation((r) => (r + 90) % 360)}
                      className="text-zinc-300 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg text-base font-bold hover:bg-white/10 touch-glow-emerald cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                      aria-label="Rotate 90 degrees clockwise"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setZoom(1);
                        setRotation(0);
                      }}
                      className="text-zinc-400 hover:text-white px-2.5 py-1 min-h-[28px] rounded-lg text-xs font-medium hover:bg-white/10 touch-glow-emerald ml-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                    >
                      Reset
                    </button>
                  </div>
                )}

                {isPdf ? (
                  <iframe
                    src={fileUrl}
                    className="w-full h-[75vh] rounded-md bg-white border border-zinc-700"
                    title={`Receipt ${currentReceipt.id}`}
                  />
                ) : (
                  <div className="w-full max-h-[75vh] overflow-auto flex items-center justify-center p-2 rounded-md bg-zinc-950/60 border border-zinc-800">
                    <img
                      src={fileUrl}
                      alt={`Receipt ${currentReceipt.id}`}
                      style={{
                        transform: `scale(${zoom}) rotate(${rotation}deg)`,
                        transformOrigin: "center center",
                        transition: "transform 0.15s ease-out",
                      }}
                      className="max-w-full max-h-[70vh] object-contain rounded select-none motion-reduce:transition-none"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
