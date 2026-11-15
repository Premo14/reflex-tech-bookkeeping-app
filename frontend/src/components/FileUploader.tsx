import React, { useRef, useState } from "react";
import { uploadFile } from "../services/api";
import { useConfirm } from "./ui/ConfirmDialog";
import { LoadingSpinner } from "./ui/LoadingSpinner";

interface FileUploaderProps {
  onUploadSuccess?: () => void;
}

export default function FileUploader({ onUploadSuccess }: FileUploaderProps) {
  const { alert } = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processUpload(Array.from(e.target.files));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processUpload(Array.from(e.dataTransfer.files));
    }
  };

  const processUpload = async (files: File[]) => {
    setIsUploading(true);
    setError(null);
    let successCount = 0;
    try {
      for (const file of files) {
        await uploadFile(file);
        successCount++;
      }
      if (onUploadSuccess) {
        onUploadSuccess();
      }
      await alert({
        title: "Upload Complete",
        message:
          successCount > 1
            ? `${successCount} files uploaded successfully! They are now being processed.`
            : "File uploaded successfully! It is now being processed.",
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setIsUploading(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload financial documents"
      className={`border-2 border-dashed rounded-xl p-6 md:p-8 text-center transition-all cursor-pointer group relative touch-glow-emerald focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] ${
        isDragging
          ? "border-emerald-400/70 bg-emerald-500/10 glow-border-emerald"
          : "border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/80 hover:border-emerald-500/40"
      }`}
      onClick={() => fileInputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        multiple
        className="hidden"
        onChange={handleFileChange}
        accept=".png,.jpg,.jpeg,.heic,.pdf,.ofx,.qfx,.qbo"
        aria-label="Select files to upload"
      />

      <div className="mx-auto w-12 h-12 bg-zinc-800/90 rounded-full flex items-center justify-center mb-4 group-hover:bg-emerald-500/15 border border-white/10 group-hover:border-emerald-500/35 transition-all">
        {isUploading ? (
          <LoadingSpinner size="lg" color="text-emerald-400" />
        ) : (
          <svg
            aria-hidden="true"
            className="w-6 h-6 text-zinc-400 group-hover:text-emerald-400 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
        )}
      </div>

      <h3 className="text-lg font-semibold text-white mb-1">Upload Files</h3>
      <p className="text-sm text-zinc-400">Drag & drop or click to browse</p>
      <p className="text-xs text-zinc-400 mt-4 font-mono">
        Accepts: .png, .jpg, .heic, .pdf, .ofx, .qfx
      </p>

      {error && (
        <p role="alert" className="text-rose-400 text-sm mt-4 font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
