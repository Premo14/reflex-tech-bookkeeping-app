import React from 'react';

interface CardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

export function Card({ children, className = '', onClick, active = false, ...props }: CardProps) {
  const baseStyles = "w-full text-left flex items-center justify-between p-4 rounded-2xl transition-all duration-300 shadow-sm";
  const stateStyles = active 
    ? "bg-zinc-800 border border-emerald-500/30" 
    : "bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 hover:-translate-y-0.5 backdrop-blur-sm";

  if (onClick) {
    return (
      <button 
        onClick={onClick}
        className={`${baseStyles} ${stateStyles} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }

  return (
    <div className={`${baseStyles} ${stateStyles} ${className}`} {...(props as any)}>
      {children}
    </div>
  );
}
