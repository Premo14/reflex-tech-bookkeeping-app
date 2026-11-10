import React from "react";
import type { Receipt } from "../types/models";

interface ReceiptThumbnailBadgeProps {
  receipts?: Receipt[];
  onOpenReceipt?: (e: React.MouseEvent) => void;
}

export default function ReceiptThumbnailBadge({ receipts, onOpenReceipt }: ReceiptThumbnailBadgeProps) {
  const [isOpenMobile, setIsOpenMobile] = React.useState(false);

  if (!receipts || receipts.length === 0) return null;

  const activeIdx = 0;
  const currentReceipt = receipts[activeIdx] || receipts[0];
  const filename = currentReceipt.documentUri.split("/").pop() || "receipt";
  const isPdf = (currentReceipt.fileExt || "").toLowerCase() === ".pdf";
  const fileUrl = `/api/images/${filename}`;

  return (
    <div 
      className="relative group/receipt inline-block" 
      onClick={(e) => {
        if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: none)").matches) {
          e.stopPropagation();
          setIsOpenMobile((prev) => !prev);
          return;
        }
        e.stopPropagation();
        if (onOpenReceipt) onOpenReceipt(e);
      }}
    >
      <span 
        className="flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-colors"
        title="Preview physical receipt"
      >
        <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
        <span>{receipts.length > 1 ? `${receipts.length} Receipts` : "Receipt"}</span>
      </span>

      {/* Floating Instant Hover Thumbnail Popover */}
      <div className={`${isOpenMobile ? 'flex' : 'hidden'} group-hover/receipt:flex flex-col absolute bottom-full left-0 mb-2 z-50 p-2.5 bg-zinc-900/95 border border-zinc-700/80 rounded-xl shadow-2xl backdrop-blur-md w-56 max-w-[calc(100vw-32px)] pointer-events-auto sm:pointer-events-none animate-in fade-in zoom-in-95 duration-150`}>
        <div className="w-full flex items-center justify-between pb-1.5 mb-1.5 border-b border-zinc-800 text-[10px] text-zinc-400">
          <span className="font-semibold text-zinc-200 truncate max-w-[130px]">{filename}</span>
          <div className="flex items-center gap-2">
            {receipts.length > 1 && (
              <span className="text-emerald-400 font-mono text-[9px]">{activeIdx + 1}/{receipts.length}</span>
            )}
            {isOpenMobile && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpenMobile(false);
                }}
                className="sm:hidden text-zinc-400 hover:text-white px-1 font-bold"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {isPdf ? (
          <div className="w-full h-36 flex flex-col items-center justify-center bg-zinc-800/80 rounded-lg border border-zinc-700/60 p-3 text-center">
            <svg className="w-10 h-10 text-red-400 mb-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="text-[11px] text-zinc-200 font-medium">PDF Statement / Invoice</span>
            <span className="text-[9px] text-zinc-400 mt-0.5">Click card to open in viewer</span>
          </div>
        ) : (
          <div className="w-full h-44 relative overflow-hidden rounded-lg bg-black/60 border border-zinc-800 flex items-center justify-center">
            <img 
              src={fileUrl} 
              alt={filename} 
              className="max-w-full max-h-full object-contain"
              loading="lazy"
            />
          </div>
        )}

        <div className="mt-2 flex items-center justify-between text-[9px] text-zinc-500">
          <span>Click to view full image</span>
          {receipts.length > 1 && <span>+{receipts.length - 1} attached</span>}
        </div>
      </div>
    </div>
  );
}
