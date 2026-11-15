import React from 'react';

export type CardGlow = 'emerald' | 'cyan' | 'purple' | 'amber' | 'rose' | 'blue' | 'none';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  glowColor?: CardGlow;
}

const activeGlowMap: Record<CardGlow, string> = {
  emerald: 'bg-zinc-900/90 border border-emerald-500/40 glow-border-emerald',
  cyan: 'bg-zinc-900/90 border border-cyan-500/40 glow-border-cyan',
  purple: 'bg-zinc-900/90 border border-purple-500/40 glow-border-purple',
  amber: 'bg-zinc-900/90 border border-amber-500/40 glow-border-amber',
  rose: 'bg-zinc-900/90 border border-rose-500/40 glow-border-rose',
  blue: 'bg-zinc-900/90 border border-blue-500/40 glow-border-blue',
  none: 'bg-zinc-800 border border-white/20',
};

const touchGlowMap: Record<CardGlow, string> = {
  emerald: 'touch-glow-emerald',
  cyan: 'touch-glow-cyan',
  purple: 'touch-glow-purple',
  amber: 'touch-glow-amber',
  rose: 'touch-glow-rose',
  blue: 'touch-glow-blue',
  none: '',
};

export function Card({
  children,
  className = '',
  onClick,
  active = false,
  glowColor = 'emerald',
  onKeyDown,
  ...props
}: CardProps) {
  const isCol = className.includes('flex-col');
  const layoutStyles = isCol ? 'flex flex-col' : 'flex items-center justify-between';
  const baseStyles = `w-full text-left ${layoutStyles} p-4 rounded-2xl transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-sm backdrop-blur-sm`;
  const stateStyles = active
    ? activeGlowMap[glowColor]
    : `bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/15 motion-safe:hover:-translate-y-0.5 ${touchGlowMap[glowColor]}`;

  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
          }
        }}
        className={`${baseStyles} ${stateStyles} cursor-pointer motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505] ${className}`.trim()}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={`${baseStyles} ${stateStyles} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
