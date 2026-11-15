const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();

export interface FormatCurrencyOptions {
  currency?: string;
  absolute?: boolean;
  signed?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

function getFormatter(
  currency: string,
  minimumFractionDigits = 2,
  maximumFractionDigits = 2
): Intl.NumberFormat {
  const key = `${currency}:${minimumFractionDigits}:${maximumFractionDigits}`;
  let formatter = CURRENCY_FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    });
    CURRENCY_FORMATTERS.set(key, formatter);
  }
  return formatter;
}

/**
 * Converts a dollar number to exact integer cents to avoid IEEE-754 drift.
 */
export function toCents(amount: number | null | undefined): number {
  if (amount == null || !Number.isFinite(amount)) {
    return 0;
  }
  const sign = amount < 0 ? -1 : 1;
  // Add a 1e-12 ULP nudge before rounding to avoid 1.005 -> 100 IEEE-754 half-cent truncation.
  const rounded = sign * Math.round((Math.abs(amount) + 1e-12) * 100);
  return rounded === 0 ? 0 : rounded;
}

/**
 * Converts exact integer cents back to dollars.
 */
export function fromCents(cents: number | null | undefined): number {
  if (cents == null || !Number.isFinite(cents)) {
    return 0;
  }
  return Math.round(cents) / 100;
}

/**
 * Formats a dollar value as canonical USD (or configured ISO currency) with -0 normalization.
 */
export function formatCurrency(
  amount: number | null | undefined,
  options: FormatCurrencyOptions = {}
): string {
  const {
    currency = 'USD',
    absolute = false,
    signed = false,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  } = options;

  let value = amount == null || !Number.isFinite(amount) ? 0 : amount;
  if (absolute) {
    value = Math.abs(value);
  }
  if (Math.abs(value) < 1e-9) {
    value = 0;
  }

  const formatted = getFormatter(currency, minimumFractionDigits, maximumFractionDigits).format(value);
  if (signed && value > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

/**
 * Formats an integer-cent value directly using formatCurrency.
 */
export function formatCents(
  cents: number | null | undefined,
  options?: FormatCurrencyOptions
): string {
  return formatCurrency(fromCents(cents), options);
}

/**
 * Formats a plain fixed-decimal dollar string (e.g., for CSV export) using exact cent rounding.
 */
export function formatFixedDollars(amount: number | null | undefined): string {
  return fromCents(toCents(amount)).toFixed(2);
}
