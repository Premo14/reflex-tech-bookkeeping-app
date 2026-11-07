/**
 * Timezone-safe date formatting utilities.
 * 
 * When parsing date strings like "2026-01-01" (YYYY-MM-DD), `new Date("2026-01-01")` parses
 * as UTC midnight. In American/western timezones (UTC-4 to UTC-8), `toLocaleDateString()`
 * shifts back to the previous day (e.g. 12/31/2025).
 * 
 * `formatDate` parses the year, month, and day components directly so that date-only
 * strings always display the intended calendar day regardless of local timezone.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  
  // Match YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, y, m, d] = match;
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return date.toLocaleDateString();
  }
  
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? String(dateStr) : parsed.toLocaleDateString();
}

/**
 * Returns a local calendar date as "YYYY-MM-DD" without UTC timezone conversion shifts.
 */
export function toLocalISODate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
