import React from 'react';

export type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'purple';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}

export function Badge({ variant = 'neutral', children, className = '', size = 'md' }: BadgeProps) {
  const variants: Record<BadgeVariant, string> = {
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    danger: "bg-red-500/10 text-red-400 border-red-500/20",
    warning: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    neutral: "bg-zinc-800 text-zinc-400 border-zinc-700",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20"
  };

  const sizes = {
    sm: "px-1.5 py-0.5 text-[9px]",
    md: "px-2 py-0.5 text-[10px]"
  };

  return (
    <span className={`rounded-full font-bold uppercase tracking-wider border backdrop-blur-sm ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
}
