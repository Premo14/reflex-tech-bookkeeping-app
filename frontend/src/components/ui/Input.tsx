import React, { forwardRef, useId } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', icon, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || (label ? generatedId : undefined);
    const errorId = error ? `${generatedId}-error` : undefined;

    return (
      <div className="w-full flex flex-col gap-1.5 text-left">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1 cursor-pointer"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none z-10">
              {icon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={`
              w-full text-left bg-white/5 border border-white/10 hover:border-white/20 rounded-lg text-sm text-white placeholder-zinc-500
              focus:outline-none focus:border-emerald-500/60 focus:bg-white/[0.08] focus:ring-1 focus:ring-emerald-500/40 focus:shadow-[0_0_12px_-2px_rgba(16,185,129,0.28)]
              transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] backdrop-blur-md shadow-sm disabled:opacity-50
              ${icon ? 'pl-8 pr-3 py-2' : 'px-3 py-2'}
              ${error ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/40 focus:shadow-[0_0_12px_-2px_rgba(244,63,94,0.28)]' : ''}
              ${className}
            `.trim()}
            {...props}
          />
        </div>
        {error && (
          <span id={errorId} className="text-xs text-red-400 pl-1" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';
