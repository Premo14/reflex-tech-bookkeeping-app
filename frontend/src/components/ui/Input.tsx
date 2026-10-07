import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', icon, ...props }, ref) => {
    return (
      <div className="w-full flex flex-col gap-1.5 text-left">
        {label && (
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">
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
            ref={ref}
            className={`
              w-full text-left bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-zinc-500
              focus:outline-none focus:border-emerald-500/50 focus:bg-white/10 focus:ring-1 focus:ring-emerald-500/50
              transition-all duration-200 backdrop-blur-md shadow-sm disabled:opacity-50
              ${icon ? 'pl-9 pr-3 py-2' : 'px-3 py-2'}
              ${error ? 'border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {error && <span className="text-xs text-red-400 pl-1">{error}</span>}
      </div>
    );
  }
);
Input.displayName = 'Input';
