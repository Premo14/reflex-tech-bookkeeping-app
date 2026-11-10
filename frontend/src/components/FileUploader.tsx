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

  // triggered when file is selected
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processUpload(Array.from(e.target.files));
    }
  };

  // --- Drag and Drop Handlers ---
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

  // handle the api upload
  const processUpload = async (files: File[]) => {
    setIsUploading(true);
    setError(null);
    let successCount = 0;
    try {
      for (const file of files) {
        await uploadFile(file);
        successCount++;
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      // tell dashboard to refresh the sidebar
      if (onUploadSuccess) {
        onUploadSuccess();
      }
      await alert({
        title: "Upload Complete",
        message: files.length > 1
          ? `${files.length} files uploaded successfully! They are now being processed.`
          : "File uploaded successfully! It is now being processed.",
      });
    } catch (err: any) {
      setError(err.message || "Failed to upload file");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div 
      className={`border-2 border-dashed rounded-xl p-6 md:p-8 text-center transition-all cursor-pointer group relative ${
        isDragging 
          ? "border-zinc-400 bg-zinc-800" 
          : "border-zinc-700 bg-zinc-800/30 hover:bg-zinc-800 hover:border-zinc-500"
      }`}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        multiple
        className="hidden" 
        onChange={handleFileChange}
        accept=".png,.jpg,.jpeg,.heic,.pdf,.ofx,.qfx,.qbo,.csv"
      />

      <div className="mx-auto w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center mb-4 group-hover:bg-zinc-700 border border-transparent group-hover:border-zinc-600 transition-all">
        {isUploading ? (
          <LoadingSpinner size="lg" color="text-zinc-400" />
        ) : (
          <svg className="w-6 h-6 text-zinc-400 group-hover:text-zinc-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
        )}
      </div>
      
      <h3 className="text-lg font-semibold text-white mb-1">Upload Files</h3>
      <p className="text-sm text-zinc-400">Drag & drop or click to browse</p>
      <p className="text-xs text-zinc-400 mt-4 font-mono">Accepts: .png, .jpg, .heic, .pdf, .ofx, .qfx, .csv</p>

      {error && (
        <p className="text-red-400 text-sm mt-4">{error}</p>
      )}
    </div>
  );
}
