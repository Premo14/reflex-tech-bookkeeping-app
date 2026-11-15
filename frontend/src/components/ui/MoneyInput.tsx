import React, { useState } from 'react';
import { Input } from './Input';

interface MoneyInputProps {
  value: number | string | null | undefined;
  onChange: (val: number) => void;
  placeholder?: string;
  className?: string;
  allowNegative?: boolean;
  label?: string;
  error?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
}

const formatInitialMoney = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined || v === '') return '';
  const p = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(p) ? '' : (Math.round(p * 100) / 100).toFixed(2);
};

interface EditState {
  draft: string;
  basePropValue: number | string | null | undefined;
}

export const MoneyInput = ({
  value,
  onChange,
  placeholder = '0.00',
  className = '',
  allowNegative = false,
  label,
  error,
  disabled,
  id,
  name,
}: MoneyInputProps) => {
  const [isFocused, setIsFocused] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [lastEmitted, setLastEmitted] = useState<number | null>(null);

  const computeFocusedDisplay = (): string => {
    if (editState === null) {
      return formatInitialMoney(value);
    }
    if (value !== editState.basePropValue && value !== null && value !== undefined && value !== '') {
      const num = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(num) && lastEmitted !== null && Math.abs(num - lastEmitted) > 0.001) {
        return String(value);
      }
    }
    return editState.draft;
  };

  const strVal = isFocused ? computeFocusedDisplay() : formatInitialMoney(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setEditState({ draft: raw, basePropValue: value });
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      const val = !allowNegative && parsed < 0 ? Math.abs(parsed) : parsed;
      setLastEmitted(val);
      onChange(val);
    } else if (raw === '' || raw === '-') {
      setLastEmitted(0);
      onChange(0);
    }
  };

  const handleBlur = () => {
    const currentRaw = strVal;
    setIsFocused(false);
    setEditState(null);
    let parsed = parseFloat(currentRaw);
    if (isNaN(parsed) || currentRaw.trim() === '') {
      setLastEmitted(0);
      onChange(0);
      return;
    }
    if (!allowNegative && parsed < 0) parsed = Math.abs(parsed);
    const roundedCents = Math.round(parsed * 100);
    const finalNum = roundedCents / 100;
    setLastEmitted(finalNum);
    onChange(finalNum);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const forbidden = ['e', 'E', '+'];
    if (!allowNegative) forbidden.push('-');
    if (forbidden.includes(e.key)) {
      e.preventDefault();
    }
  };

  return (
    <Input
      id={id}
      name={name}
      type="number"
      step="0.01"
      label={label}
      error={error}
      disabled={disabled}
      placeholder={placeholder}
      icon={<span className="font-mono text-xs font-bold text-zinc-400">$</span>}
      className={`font-mono tabular-nums ${className}`.trim()}
      value={strVal}
      onChange={handleChange}
      onFocus={(e) => {
        setEditState({ draft: formatInitialMoney(value), basePropValue: value });
        setIsFocused(true);
        e.target.select();
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
};
