import React, { useState, useRef, useEffect, forwardRef } from 'react';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  searchable?: boolean;
  dropdownAlign?: 'left' | 'right';
  dropdownWidth?: string;
  autoWidth?: boolean;
  onChange?: (e: { target: { value: any } }) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className = '', children, icon, value, onChange, disabled, searchable, dropdownAlign = 'left', dropdownWidth, autoWidth, ...props }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const isAuto = autoWidth || className.includes('w-auto') || className.includes('w-max') || className.includes('w-fit');

    useEffect(() => {
      function handleClickOutside(event: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
      if (isOpen && searchable && searchInputRef.current) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (!isOpen) {
        setSearchQuery('');
      }
    }, [isOpen, searchable]);

    // Parse children to extract options with optgroup preservation
    interface ParsedOption {
      value: any;
      label: React.ReactNode;
      groupLabel?: string;
    }

    const options: ParsedOption[] = [];
    const processChildren = (kids: React.ReactNode, currentGroup?: string) => {
      React.Children.forEach(kids, child => {
        if (!React.isValidElement(child)) return;
        const props = child.props as any;
        if (child.type === 'option') {
          options.push({ value: props.value, label: props.children, groupLabel: currentGroup });
        } else if (child.type === 'optgroup') {
          processChildren(props.children, props.label);
        } else if (props && props.children) {
          processChildren(props.children, currentGroup);
        }
      });
    };
    processChildren(children);

    const filteredOptions = searchable && searchQuery
      ? options.filter(opt => String(opt.label).toLowerCase().includes(searchQuery.toLowerCase()) || String(opt.value).toLowerCase().includes(searchQuery.toLowerCase()))
      : options;

    const selectedOption = options.find(opt => String(opt.value) === String(value));
    const selectedLabel = selectedOption ? selectedOption.label : 'Select...';

    // Helper for rendering options with optgroup headings
    let lastRenderedGroup: string | undefined = undefined;

    return (
      <div className={`${isAuto ? 'w-auto' : 'w-full'} flex flex-col gap-1.5 text-left`} ref={dropdownRef}>
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
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            className={`
              ${isAuto ? 'w-auto' : 'w-full'} bg-black border ${isOpen ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-white/10 hover:border-white/20'} 
              rounded-lg text-sm text-zinc-300 transition-all duration-200 shadow-sm
              flex items-center justify-between gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap
              ${icon ? 'pl-9 pr-3 py-2' : 'pl-3 pr-3 py-2'}
              ${error ? 'border-red-500/50 ring-1 ring-red-500/50' : ''}
              ${className}
            `}
          >
            <span className="whitespace-nowrap flex-1 text-left">{selectedLabel}</span>
            <svg className={`w-4 h-4 text-zinc-400 shrink-0 ml-1.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isOpen && (
            <div className={`absolute top-full ${dropdownAlign === 'right' ? 'right-0' : 'left-0'} mt-2 min-w-full ${dropdownWidth || 'w-max min-w-[200px]'} max-w-[calc(100vw-32px)] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-50 py-1.5 animate-in fade-in zoom-in-95 duration-200 backdrop-blur-xl bg-zinc-900/95 max-h-[340px] flex flex-col`}>
              {searchable && (
                <div className="px-2 pb-1.5 border-b border-white/10 shrink-0">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-md text-sm text-zinc-300 px-2 py-1.5 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              )}
              <div role="listbox" className="overflow-y-auto overflow-x-hidden custom-scrollbar flex-1 min-w-0">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((opt, i) => {
                    const isNewGroup = opt.groupLabel && opt.groupLabel !== lastRenderedGroup;
                    if (opt.groupLabel) {
                      lastRenderedGroup = opt.groupLabel;
                    }

                    return (
                      <React.Fragment key={i}>
                        {isNewGroup && (
                          <div className="px-3.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400/90 border-t border-white/5 first:border-0 sticky top-0 bg-zinc-900/95 backdrop-blur-md z-10 select-none whitespace-nowrap">
                            {opt.groupLabel}
                          </div>
                        )}
                        <button
                          type="button"
                          role="option"
                          aria-selected={String(value) === String(opt.value)}
                          onClick={() => {
                            onChange?.({ target: { value: opt.value } });
                            setIsOpen(false);
                          }}
                          className={`w-full text-left px-3.5 py-2 text-sm transition-colors flex items-center justify-between gap-4
                            ${String(value) === String(opt.value) ? 'bg-emerald-500/10 text-emerald-400 font-bold' : 'text-zinc-300 hover:bg-white/5 hover:text-white'}
                          `}
                          title={typeof opt.label === 'string' ? opt.label : undefined}
                        >
                          <span className="whitespace-nowrap pr-2">{opt.label}</span>
                          {String(value) === String(opt.value) && (
                            <svg className="w-4 h-4 text-emerald-500 shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                          )}
                        </button>
                      </React.Fragment>
                    );
                  })
                ) : (
                  <div className="px-3 py-2 text-sm text-zinc-500 text-center whitespace-nowrap">No options found</div>
                )}
              </div>
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
