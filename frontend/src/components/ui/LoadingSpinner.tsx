import React from 'react';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface LoadingSpinnerProps {
  size?: SpinnerSize;
  className?: string;
  color?: string; // Tailwind text color class, e.g. "text-emerald-500" or "text-zinc-400"
}

const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-8 h-8',
  xl: 'w-10 h-10',
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  className = '',
  color = 'currentColor',
}) => {
  const sizeClass = sizeClasses[size] || sizeClasses.md;
  const isCustomColor = color !== 'currentColor' && color.startsWith('text-');

  return (
    <svg
      className={`animate-spin shrink-0 ${sizeClass} ${isCustomColor ? color : ''} ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      aria-label="Loading"
      role="status"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke={isCustomColor ? 'currentColor' : color}
        strokeWidth="3.5"
      />
      <path
        className="opacity-85"
        fill={isCustomColor ? 'currentColor' : color}
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
};

export default LoadingSpinner;
