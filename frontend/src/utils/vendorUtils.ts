/**
 * Cleans raw bank transaction descriptions into readable vendor names.
 * Strips bank transaction noise such as transaction codes, store numbers,
 * dates, trailing authorization codes, and common banking prefixes.
 */
export function extractCleanVendor(description: string): string {
  if (!description) return "";

  let cleaned = description.trim();

  // Remove common bank wire / statement prefixes (case-insensitive)
  const prefixes = [
    /^(withdrawal\s+(instant\s+issue|debit|ach|pos)?\s*#?\d*)/i,
    /^(deposit\s+(mobile|atm|ach|branch)?\s*#?\d*)/i,
    /^(debit\s+card\s+(purchase|recurring)?\s*)/i,
    /^(pos\s+(purchase|debit)?\s*)/i,
    /^(checkcard\s*)/i,
    /^(recurring\s+payment\s*)/i,
    /^(ach\s+(debit|credit|payment|transfer)\s*)/i,
    /^(online\s+(banking\s+)?transfer\s*(to|from)?\s*)/i,
  ];

  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, "").trim();
  }

  // Remove trailing authorization numbers / terminal IDs (e.g. "24013396218001460092243 5814")
  cleaned = cleaned.replace(/\b\d{10,}\s*\d*\b/g, "").trim();

  // Remove trailing date markers (e.g. "Date 08/06/26" or "08/06/2026")
  cleaned = cleaned.replace(/\bdate\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/i, "").trim();

  // Remove store numbers (e.g. "#17932", "STORE #452", "# 1234")
  cleaned = cleaned.replace(/(#\s*\d+|\bstore\s*#?\s*\d+)/gi, "").trim();

  // Remove repeated whitespace
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

  // If cleaning stripped everything, fall back to the original description
  return cleaned || description.trim();
}
