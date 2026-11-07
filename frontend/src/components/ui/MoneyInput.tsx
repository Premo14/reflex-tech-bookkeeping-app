import React, { useState, useEffect } from 'react';
import { Input } from './Input';

interface MoneyInputProps {
  value: any;
  onChange: (val: number) => void;
  placeholder?: string;
  className?: string;
  allowNegative?: boolean;
  label?: string;
}

export const MoneyInput = ({ value, onChange, placeholder = "0.00", className = "", allowNegative = false, label }: MoneyInputProps) => {
  const formatInitial = (v: any) => {
    if (v === null || v === undefined || v === "") return "";
    const p = parseFloat(v);
    return isNaN(p) ? "" : p.toFixed(2);
  };
  const [strVal, setStrVal] = useState(formatInitial(value));
  const [isFocused, setIsFocused] = useState(false);
  const lastEmittedRef = React.useRef<number | null>(null);

  useEffect(() => {
    if (!isFocused) {
      setStrVal(formatInitial(value));
    } else {
      const num = parseFloat(value);
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
    } else if (raw === "" || raw === "-") {
      lastEmittedRef.current = 0;
      onChange(0);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    let parsed = parseFloat(strVal);
    if (isNaN(parsed) || strVal === "") {
      setStrVal("");
      lastEmittedRef.current = 0;
      onChange(0);
      return;
    }
    if (!allowNegative && parsed < 0) parsed = Math.abs(parsed);
    const formatted = parsed.toFixed(2);
    setStrVal(formatted);
    const finalNum = parseFloat(formatted);
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
      type="number"
      step="0.01"
      label={label}
      placeholder={placeholder}
      className={className}
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
