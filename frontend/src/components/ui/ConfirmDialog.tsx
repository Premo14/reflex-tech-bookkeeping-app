import React, { useState, useCallback, useRef, useEffect, useId } from 'react';
import { Button } from './Button';
import {
  ConfirmationContext,
  type ConfirmOptions,
  type AlertOptions,
} from './confirmContext';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger' | 'secondary';
  showCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  showCancel = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const titleId = useId();
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`surface-glass rounded-2xl w-full max-w-[calc(100vw-1rem)] sm:max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150 ${
          variant === 'danger' ? 'border-red-500/25 glow-border-rose' : 'border-white/10'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-white/10">
          <h3 id={titleId} className="font-bold text-base text-white tracking-tight">
            {title}
          </h3>
          <div className="text-sm text-zinc-400 mt-2 leading-relaxed whitespace-pre-line">
            {message}
          </div>
        </div>
        <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2.5 bg-black/30">
          {showCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {cancelText}
            </Button>
          )}
          <Button type="button" variant={variant} glow={variant !== 'secondary'} onClick={onConfirm}>
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
    variant: 'primary' | 'danger' | 'secondary';
    showCancel: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'primary',
    showCancel: true,
  });

  const resolverRef = useRef<((val: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (resolverRef.current) {
        resolverRef.current(false);
      }
      resolverRef.current = resolve;
      if (typeof options === 'string') {
        setDialogState({
          isOpen: true,
          title: 'Confirmation',
          message: options,
          confirmText: 'Confirm',
          cancelText: 'Cancel',
          variant: 'primary',
          showCancel: true,
        });
      } else {
        setDialogState({
          isOpen: true,
          title: options.title || 'Confirmation',
          message: options.message,
          confirmText: options.confirmText || 'Confirm',
          cancelText: options.cancelText || 'Cancel',
          variant: options.variant || 'primary',
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
      if (typeof options === 'string') {
        setDialogState({
          isOpen: true,
          title: titleOverride || 'Notice',
          message: options,
          confirmText: 'OK',
          cancelText: 'Cancel',
          variant: 'primary',
          showCancel: false,
        });
      } else {
        setDialogState({
          isOpen: true,
          title: options.title || titleOverride || 'Notice',
          message: options.message,
          confirmText: options.okText || 'OK',
          cancelText: 'Cancel',
          variant: options.variant || 'primary',
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
