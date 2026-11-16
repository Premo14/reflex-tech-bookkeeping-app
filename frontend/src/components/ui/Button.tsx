import React from 'react';
import { LoadingSpinner } from './LoadingSpinner';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost' | 'info' | 'purple' | 'cyan';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  glow?: boolean;
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-sm touch-glow-emerald focus-visible:ring-emerald-400/70',
  secondary: 'bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20 backdrop-blur-md shadow-sm hover:shadow-[0_0_14px_-2px_rgba(255,255,255,0.14)] active:shadow-[0_0_18px_0_rgba(255,255,255,0.2)] focus-visible:ring-white/40',
  danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 touch-glow-rose focus-visible:ring-rose-400/70',
  warning: 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 border border-amber-500/25 touch-glow-amber focus-visible:ring-amber-400/70',
  ghost: 'bg-transparent hover:bg-white/5 text-zinc-400 hover:text-white active:bg-white/10 focus-visible:ring-white/30',
  info: 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/25 touch-glow-blue focus-visible:ring-blue-400/70',
  purple: 'bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 touch-glow-purple focus-visible:ring-purple-400/70',
  cyan: 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 touch-glow-cyan focus-visible:ring-cyan-400/70',
};

const variantGlowClasses: Record<ButtonVariant, string> = {
  primary: 'glow-emerald',
  secondary: 'shadow-[0_0_14px_-2px_rgba(255,255,255,0.16)]',
  danger: 'glow-rose',
  warning: 'glow-amber',
  ghost: '',
  info: 'glow-blue',
  purple: 'glow-purple',
  cyan: 'glow-cyan',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1.5',
  md: 'px-3.5 py-1.5 text-xs gap-1.5',
  lg: 'px-5 py-2 text-sm gap-2 rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  glow = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center font-semibold transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 rounded-lg whitespace-nowrap cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]';

  const glowClass = glow ? variantGlowClasses[variant] : '';

  return (
    <button
      className={`${baseStyles} ${variantClasses[variant]} ${sizeClasses[size]} ${glowClass} ${className}`.trim()}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading && <LoadingSpinner size={size === 'sm' ? 'xs' : 'sm'} />}
      {children}
    </button>
  );
}
