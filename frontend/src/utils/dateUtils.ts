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
 * Formats an ISO date string ("YYYY-MM-DD" or timestamp) as zero-padded "MM/DD/YYYY".
 */
export function formatDateMMDDYYYY(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length === 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
    const [y, m, d] = parts;
    return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y}`;
  }
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return "";
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${m}/${d}/${dt.getFullYear()}`;
}

/**
 * Adds a signed number of calendar days to a "YYYY-MM-DD" string without UTC drift.
 */
export function addDaysToISODate(dateStr: string, days: number): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d + days);
  if (isNaN(dt.getTime())) return "";
  return toLocalISODate(dt);
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

/**
 * Converts standard/accounting payment terms (e.g. "Net 30", "Due Upon Receipt")
 * into clear, plain-English human-readable descriptions.
 */
export function formatPaymentTerms(terms: string | null | undefined): string {
  if (!terms) return "30 days to pay";
  const normalized = terms.trim().toLowerCase();
  if (normalized === "net 30" || normalized === "net30") return "30 days to pay";
  if (normalized === "net 15" || normalized === "net15") return "15 days to pay";
  if (normalized === "net 60" || normalized === "net60") return "60 days to pay";
  if (normalized === "net 90" || normalized === "net90") return "90 days to pay";
  if (normalized.includes("receipt") || normalized.includes("immediate")) return "Due immediately";
  return terms;
}

/**
 * Returns plain-English deadline text (e.g. "Due in 30 days").
 */
export function formatPaymentDeadline(terms: string | null | undefined): string {
  if (!terms) return "Due in 30 days";
  const normalized = terms.trim().toLowerCase();
  if (normalized === "net 30" || normalized === "net30") return "Due in 30 days";
  if (normalized === "net 15" || normalized === "net15") return "Due in 15 days";
  if (normalized === "net 60" || normalized === "net60") return "Due in 60 days";
  if (normalized === "net 90" || normalized === "net90") return "Due in 90 days";
  if (normalized.includes("receipt") || normalized.includes("immediate")) return "Due immediately";
  return `Due: ${terms}`;
}

/**
 * Calculates due date string (YYYY-MM-DD) from issue date and payment terms.
 */
export function calculateDueDateFromTerms(issueDateStr: string, terms: string): string {
  if (!issueDateStr) return "";
  const match = issueDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const base = match 
    ? new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10))
    : new Date(issueDateStr);
  if (isNaN(base.getTime())) return "";

  let days = 30;
  const norm = terms.toLowerCase();
  if (norm.includes("receipt") || norm.includes("immediate")) days = 0;
  else if (norm.includes("15")) days = 15;
  else if (norm.includes("30")) days = 30;
  else if (norm.includes("60")) days = 60;
  else if (norm.includes("90")) days = 90;

  const due = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return toLocalISODate(due);
}
