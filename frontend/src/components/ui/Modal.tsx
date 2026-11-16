import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '5xl' | '6xl';
  suspended?: boolean;
  bodyClassName?: string;
  headerClassName?: string;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'md',
  suspended = false,
  bodyClassName,
  headerClassName,
}: ModalProps) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || suspended) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleEsc);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, suspended]);

  // Trap focus inside active dialog and restore focus on close
  useEffect(() => {
    if (!isOpen || suspended) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const prevActive = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

    const focusable = getFocusable();
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      dialog.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const elements = getFocusable();
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = elements[0];
      const lastEl = elements[elements.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === firstEl || !dialog.contains(document.activeElement)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (document.activeElement === lastEl || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (prevActive && typeof prevActive.focus === 'function') {
        prevActive.focus();
      }
    };
  }, [isOpen, suspended]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && !suspended) {
      onCloseRef.current();
    }
  };

  const content = (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className={`fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-2 sm:p-4 overflow-hidden animate-in fade-in duration-200 print:static print:p-0 print:bg-white print:overflow-visible print:block ${
        suspended ? 'invisible pointer-events-none' : ''
      }`}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`bg-zinc-900/95 border border-white/10 rounded-2xl w-full max-w-[calc(100vw-1rem)] ${maxWidthClasses[maxWidth]} shadow-2xl flex flex-col max-h-[min(92vh,92dvh)] overflow-hidden animate-in zoom-in-95 duration-200 outline-none print:static print:max-h-none print:w-full print:max-w-none print:border-none print:shadow-none print:bg-white print:text-black print:overflow-visible`}
      >
        <div
          className={`flex justify-between items-center px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/10 shrink-0 bg-zinc-950/50 ${
            headerClassName || ''
          }`.trim()}
        >
          <h2 id={titleId} className="text-base font-bold text-white tracking-tight print:text-black">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-zinc-400 hover:text-white transition-all duration-150 bg-white/5 hover:bg-white/10 hover:shadow-[0_0_12px_-2px_rgba(255,255,255,0.2)] motion-safe:active:scale-95 rounded-lg p-1.5 backdrop-blur-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 print:hidden"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className={
            bodyClassName ||
            'p-4 sm:p-6 overflow-y-auto overflow-x-hidden flex-1 min-h-0 custom-scrollbar print:overflow-visible print:p-0'
          }
        >
          {children}
        </div>

        {footer && (
          <div className="px-4 sm:px-6 py-3 sm:py-3.5 border-t border-white/10 bg-black/30 shrink-0 rounded-b-2xl print:hidden">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
