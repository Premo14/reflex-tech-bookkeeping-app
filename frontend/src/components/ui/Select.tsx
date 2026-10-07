import React, { useState, useRef, useEffect, forwardRef } from 'react';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  onChange?: (e: { target: { value: any } }) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className = '', children, icon, value, onChange, disabled, ...props }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      function handleClickOutside(event: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Parse children to extract options
    const options: { value: any; label: React.ReactNode }[] = [];
    const processChildren = (kids: React.ReactNode) => {
      React.Children.forEach(kids, child => {
        if (!React.isValidElement(child)) return;
        const props = child.props as any;
        if (child.type === 'option') {
          options.push({ value: props.value, label: props.children });
        } else if (props && props.children) {
          processChildren(props.children);
        }
      });
    };
    processChildren(children);

    const selectedOption = options.find(opt => String(opt.value) === String(value));
    const selectedLabel = selectedOption ? selectedOption.label : 'Select...';

    return (
      <div className="w-full flex flex-col gap-1.5 text-left" ref={dropdownRef}>
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
          
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            className={`
              w-full bg-black border ${isOpen ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-white/10 hover:border-white/20'} 
              rounded-lg text-sm text-zinc-300 transition-all duration-200 shadow-sm
              flex items-center justify-between gap-3 disabled:opacity-50 disabled:cursor-not-allowed
              ${icon ? 'pl-9 pr-3 py-2' : 'pl-3 pr-3 py-2'}
              ${error ? 'border-red-500/50 ring-1 ring-red-500/50' : ''}
              ${className}
            `}
          >
            <span className="truncate">{selectedLabel}</span>
            <svg className={`w-4 h-4 text-zinc-400 shrink-0 ml-2 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isOpen && (
            <div className="absolute top-full left-0 mt-2 min-w-full w-max max-w-[300px] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-50 py-1.5 animate-in fade-in zoom-in-95 duration-200 overflow-hidden backdrop-blur-xl bg-zinc-900/90 max-h-[300px] overflow-y-auto custom-scrollbar">
              {options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange?.({ target: { value: opt.value } });
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-3
                    ${String(value) === String(opt.value) ? 'bg-emerald-500/10 text-emerald-400 font-bold' : 'text-zinc-300 hover:bg-white/5 hover:text-white'}
                  `}
                >
                  <span className="truncate">{opt.label}</span>
                  {String(value) === String(opt.value) && (
                    <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  )}
                </button>
              ))}
            </div>
          )}
          
          {/* Hidden native select for form accessibility/refs if needed */}
          <select ref={ref} value={value} className="hidden" onChange={() => {}} {...props}>
            {children}
          </select>
        </div>
        {error && <span className="text-xs text-red-400 pl-1">{error}</span>}
      </div>
    );
  }
);
Select.displayName = 'Select';
