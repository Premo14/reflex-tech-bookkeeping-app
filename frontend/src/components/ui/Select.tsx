import React, { useState, useRef, useEffect, useId, forwardRef } from 'react';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  searchable?: boolean;
  dropdownAlign?: 'left' | 'right';
  dropdownWidth?: string;
  autoWidth?: boolean;
  onChange?: (e: { target: { value: string } }) => void;
}

interface ParsedOption {
  value: string;
  label: React.ReactNode;
  groupLabel?: string;
  disabled?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      className = '',
      children,
      icon,
      value,
      onChange,
      disabled,
      searchable,
      dropdownAlign = 'left',
      dropdownWidth,
      autoWidth,
      id,
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const triggerId = id || `${generatedId}-trigger`;
    const labelId = `${generatedId}-label`;
    const listboxId = `${generatedId}-listbox`;

    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const isAuto =
      autoWidth ||
      className.includes('w-auto') ||
      className.includes('w-max') ||
      className.includes('w-fit');

    // Parse children to extract options with optgroup preservation
    const options: ParsedOption[] = [];
    const processChildren = (kids: React.ReactNode, currentGroup?: string) => {
      React.Children.forEach(kids, (child) => {
        if (!React.isValidElement(child)) return;
        const childProps = child.props as {
          value?: string | number;
          children?: React.ReactNode;
          label?: string;
          disabled?: boolean;
        };
        if (child.type === 'option') {
          options.push({
            value: String(childProps.value ?? ''),
            label: childProps.children,
            groupLabel: currentGroup,
            disabled: Boolean(childProps.disabled),
          });
        } else if (child.type === 'optgroup') {
          processChildren(childProps.children, childProps.label);
        } else if (childProps && childProps.children) {
          processChildren(childProps.children, currentGroup);
        }
      });
    };
    processChildren(children);

    const filteredOptions =
      searchable && searchQuery
        ? options.filter(
            (opt) =>
              String(opt.label).toLowerCase().includes(searchQuery.toLowerCase()) ||
              opt.value.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : options;

    const selectedOption = options.find((opt) => opt.value === String(value ?? ''));
    const selectedLabel = selectedOption ? selectedOption.label : 'Select...';

    useEffect(() => {
      function handleClickOutside(event: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
      if (isOpen && searchable) {
        const timer = window.setTimeout(() => searchInputRef.current?.focus(), 20);
        return () => window.clearTimeout(timer);
      }
    }, [isOpen, searchable]);

    const openDropdown = (initialIndex?: number) => {
      if (disabled) return;
      const selectedIdx = options.findIndex((o) => o.value === String(value ?? ''));
      setHighlightedIndex(initialIndex ?? (selectedIdx >= 0 ? selectedIdx : 0));
      setIsOpen(true);
    };

    const closeDropdown = (returnFocus = false) => {
      setIsOpen(false);
      setSearchQuery('');
      setHighlightedIndex(-1);
      if (returnFocus) {
        triggerRef.current?.focus();
      }
    };

    const selectOption = (opt: ParsedOption) => {
      if (opt.disabled) return;
      onChange?.({ target: { value: opt.value } });
      closeDropdown(true);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (disabled) return;

      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDropdown();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          openDropdown(Math.max(0, options.length - 1));
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        closeDropdown(true);
        return;
      }

      if (filteredOptions.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = highlightedIndex < filteredOptions.length - 1 ? highlightedIndex + 1 : 0;
        setHighlightedIndex(next);
        optionRefs.current[next]?.scrollIntoView?.({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = highlightedIndex > 0 ? highlightedIndex - 1 : filteredOptions.length - 1;
        setHighlightedIndex(prev);
        optionRefs.current[prev]?.scrollIntoView?.({ block: 'nearest' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        setHighlightedIndex(0);
        optionRefs.current[0]?.scrollIntoView?.({ block: 'nearest' });
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = filteredOptions.length - 1;
        setHighlightedIndex(last);
        optionRefs.current[last]?.scrollIntoView?.({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          e.preventDefault();
          selectOption(filteredOptions[highlightedIndex]);
        }
      }
    };

    let lastRenderedGroup: string | undefined;

    return (
      <div
        className={`${isAuto ? 'w-auto' : 'w-full'} flex flex-col gap-1.5 text-left ${isOpen ? 'relative z-50' : ''}`}
        ref={dropdownRef}
        onKeyDown={handleKeyDown}
      >
        {label && (
          <label
            id={labelId}
            htmlFor={triggerId}
            className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1 cursor-pointer"
          >
            {label}
          </label>
        )}
        <div className={`relative ${isOpen ? 'z-50' : ''}`}>
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none z-10">
              {icon}
            </div>
          )}

          <button
            id={triggerId}
            ref={triggerRef}
            type="button"
            onClick={() => (isOpen ? closeDropdown() : openDropdown())}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-labelledby={label ? labelId : undefined}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={isOpen ? listboxId : undefined}
            aria-activedescendant={
              isOpen && highlightedIndex >= 0 ? `${generatedId}-opt-${highlightedIndex}` : undefined
            }
            className={`
              ${isAuto ? 'w-auto' : 'w-full'} min-h-[38px] bg-white/5 border ${
              isOpen
                ? 'border-emerald-500/70 ring-1 ring-emerald-500/40 glow-border-emerald'
                : 'border-white/10 hover:border-white/20 focus-visible:border-emerald-500/60 focus-visible:ring-1 focus-visible:ring-emerald-500/40'
            }
              rounded-lg text-sm text-zinc-200 touch-glow-emerald focus:outline-none cursor-pointer
              flex items-center justify-between gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap
              ${icon ? 'pl-9 pr-3 py-2' : 'px-3 py-2'}
              ${error ? 'border-red-500/60 ring-1 ring-red-500/40' : ''}
              ${className}
            `.trim()}
          >
            <span className="whitespace-nowrap flex-1 text-left truncate">{selectedLabel}</span>
            <svg
              className={`w-4 h-4 text-zinc-400 shrink-0 ml-1.5 transition-transform duration-200 ${isOpen ? 'rotate-180 text-emerald-400' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isOpen && (
            <div
              className={`absolute top-full ${
                dropdownAlign === 'right' ? 'right-0' : 'left-0'
              } mt-2 min-w-full ${
                dropdownWidth || (isAuto ? 'w-max min-w-[200px]' : 'w-full')
              } max-w-[calc(100vw-32px)] border border-white/10 rounded-xl shadow-2xl z-50 py-1.5 animate-in fade-in zoom-in-95 duration-200 backdrop-blur-xl bg-zinc-900/95 max-h-[340px] flex flex-col`}
            >
              {searchable && (
                <div className="px-2 pb-1.5 border-b border-white/10 shrink-0">
                  <input
                    id={`${generatedId}-search`}
                    name="selectSearch"
                    aria-label="Filter options"
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setHighlightedIndex(0);
                    }}
                    className="w-full bg-black/50 border border-white/10 rounded-md text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
              )}
              <div
                id={listboxId}
                role="listbox"
                aria-labelledby={label ? labelId : undefined}
                className="overflow-y-auto overflow-x-hidden custom-scrollbar flex-1 min-w-0"
              >
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((opt, i) => {
                    const isNewGroup = opt.groupLabel && opt.groupLabel !== lastRenderedGroup;
                    if (opt.groupLabel) {
                      lastRenderedGroup = opt.groupLabel;
                    }
                    const isSelected = String(value ?? '') === opt.value;
                    const isHighlighted = i === highlightedIndex;

                    return (
                      <React.Fragment key={`${opt.value}-${i}`}>
                        {isNewGroup && (
                          <div className="px-3.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400/90 border-t border-white/5 first:border-0 sticky top-0 bg-zinc-900/95 backdrop-blur-md z-10 select-none whitespace-nowrap">
                            {opt.groupLabel}
                          </div>
                        )}
                        <button
                          id={`${generatedId}-opt-${i}`}
                          ref={(el) => {
                            optionRefs.current[i] = el;
                          }}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={opt.disabled}
                          onMouseEnter={() => setHighlightedIndex(i)}
                          onClick={() => selectOption(opt)}
                          className={`w-full min-h-[36px] text-left px-3.5 py-2 text-sm transition-colors flex items-center justify-between gap-4 cursor-pointer disabled:opacity-40
                            ${
                              isSelected
                                ? 'bg-emerald-500/15 text-emerald-400 font-bold'
                                : isHighlighted
                                ? 'bg-white/10 text-white'
                                : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                            }
                          `.trim()}
                          title={typeof opt.label === 'string' ? opt.label : undefined}
                        >
                          <span className="whitespace-nowrap pr-2">{opt.label}</span>
                          {isSelected && (
                            <svg
                              className="w-4 h-4 text-emerald-400 shrink-0 ml-auto"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </React.Fragment>
                    );
                  })
                ) : (
                  <div className="px-3 py-2 text-sm text-zinc-500 text-center whitespace-nowrap">
                    No options found
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hidden native select for form accessibility/refs if needed */}
          <select ref={ref} value={value} className="hidden" onChange={() => {}} aria-hidden="true" tabIndex={-1} {...props}>
            {children}
          </select>
        </div>
        {error && (
          <span className="text-xs text-red-400 pl-1" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }
);
Select.displayName = 'Select';
