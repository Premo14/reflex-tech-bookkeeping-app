import React, { useState, useEffect, useRef } from 'react';
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
  const [strVal, setStrVal] = useState(() => formatInitialMoney(value));
  const [isFocused, setIsFocused] = useState(false);
  const lastEmittedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isFocused) {
      setStrVal(formatInitialMoney(value));
    } else if (value !== null && value !== undefined && value !== '') {
      const num = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(num) && lastEmittedRef.current !== null && Math.abs(num - lastEmittedRef.current) > 0.001) {
        setStrVal(String(value));
      }
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setStrVal(raw);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      const val = !allowNegative && parsed < 0 ? Math.abs(parsed) : parsed;
      lastEmittedRef.current = val;
      onChange(val);
    } else if (raw === '' || raw === '-') {
      lastEmittedRef.current = 0;
      onChange(0);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    let parsed = parseFloat(strVal);
    if (isNaN(parsed) || strVal.trim() === '') {
      setStrVal('');
      lastEmittedRef.current = 0;
      onChange(0);
      return;
    }
    if (!allowNegative && parsed < 0) parsed = Math.abs(parsed);
    const roundedCents = Math.round(parsed * 100);
    const finalNum = roundedCents / 100;
    setStrVal(finalNum.toFixed(2));
    lastEmittedRef.current = finalNum;
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
        setIsFocused(true);
        e.target.select();
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
};
