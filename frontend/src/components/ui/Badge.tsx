import React from 'react';

export type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'purple' | 'cyan';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
  glow?: boolean;
}

const badgeVariantClasses: Record<BadgeVariant, string> = {
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  danger: 'bg-red-500/10 text-red-400 border-red-500/25',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/25',
  neutral: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  purple: 'bg-purple-500/10 text-purple-400 border-purple-500/25',
  cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/25',
};

const badgeGlowClasses: Record<BadgeVariant, string> = {
  success: 'glow-emerald',
  danger: 'glow-rose',
  warning: 'glow-amber',
  info: 'glow-blue',
  neutral: '',
  purple: 'glow-purple',
  cyan: 'glow-cyan',
};

export function Badge({
  variant = 'neutral',
  children,
  className = '',
  size = 'md',
  glow = false,
}: BadgeProps) {
  const sizes = {
    sm: 'px-1.5 py-0.5 text-[9px]',
    md: 'px-2 py-0.5 text-[10px]',
  };

  const glowClass = glow ? badgeGlowClasses[variant] : '';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-wider border backdrop-blur-sm ${badgeVariantClasses[variant]} ${sizes[size]} ${glowClass} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
