import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { Button } from "./Button";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "danger" | "secondary";
}

export interface AlertOptions {
  title?: string;
  message: string;
  okText?: string;
  variant?: "primary" | "danger" | "secondary";
}

interface ConfirmationContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alert: (options: AlertOptions | string, title?: string) => Promise<void>;
}

const ConfirmationContext = createContext<ConfirmationContextType | null>(null);

export function useConfirm() {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmationProvider");
  }
  return context;
}

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "danger" | "secondary";
  showCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "primary",
  showCancel = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div 
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-zinc-800">
          <h3 className="font-bold text-lg text-white">{title}</h3>
          <div className="text-sm text-zinc-400 mt-2 leading-relaxed whitespace-pre-line">
            {message}
          </div>
        </div>
        <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-800/50">
          {showCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {cancelText}
            </Button>
          )}
          <Button variant={variant} onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmationProvider({ children }: { children: React.ReactNode }) {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    variant: "primary" | "danger" | "secondary";
    showCancel: boolean;
  }>({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    variant: "primary",
    showCancel: true,
  });

  const resolverRef = useRef<((val: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (resolverRef.current) {
        resolverRef.current(false);
      }
      resolverRef.current = resolve;
      if (typeof options === "string") {
        setDialogState({
          isOpen: true,
          title: "Confirmation",
          message: options,
          confirmText: "Confirm",
          cancelText: "Cancel",
          variant: "primary",
          showCancel: true,
        });
      } else {
        setDialogState({
          isOpen: true,
          title: options.title || "Confirmation",
          message: options.message,
          confirmText: options.confirmText || "Confirm",
          cancelText: options.cancelText || "Cancel",
          variant: options.variant || "primary",
          showCancel: true,
        });
      }
    });
  }, []);

  const alert = useCallback((options: AlertOptions | string, titleOverride?: string): Promise<void> => {
    return new Promise((resolve) => {
      if (resolverRef.current) {
        resolverRef.current(false);
      }
      resolverRef.current = () => resolve();
      if (typeof options === "string") {
        setDialogState({
          isOpen: true,
          title: titleOverride || "Notice",
          message: options,
          confirmText: "OK",
          cancelText: "Cancel",
          variant: "primary",
          showCancel: false,
        });
      } else {
        setDialogState({
          isOpen: true,
          title: options.title || titleOverride || "Notice",
          message: options.message,
          confirmText: options.okText || "OK",
          cancelText: "Cancel",
          variant: options.variant || "primary",
          showCancel: false,
        });
      }
    });
  }, []);

  const handleConfirm = () => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
  };

  const handleCancel = () => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
  };

  return (
    <ConfirmationContext.Provider value={{ confirm, alert }}>
      {children}
      <ConfirmModal
        isOpen={dialogState.isOpen}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        variant={dialogState.variant}
        showCancel={dialogState.showCancel}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmationContext.Provider>
  );
}
