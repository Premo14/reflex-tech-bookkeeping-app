/**
 * Computes transparent match confidence percentage and breakdown reasons
 * between a bank transaction and an expense/receipt, matching Ramp & Keeper Tax style UX.
 */

import { formatCurrency } from "./formatCurrency";

export interface MatchScoreResult {
  score: number;        // 0 to 100
  label: "Guaranteed Match" | "High Confidence" | "Likely Match" | "Suggested";
  badgeVariant: "success" | "info" | "warning";
  reasons: string[];
}

export function computeMatchScore(
  txAmount: number,
  txDateStr: string,
  txDescription: string,
  expAmount: number,
  expDateStr: string,
  expVendor: string
): MatchScoreResult {
  const absTx = Math.abs(txAmount);
  const absExp = Math.abs(expAmount);
  const diffAmt = Math.abs(absTx - absExp);
  const exactAmount = diffAmt < 0.005;

  let tipVariance = false;
  if (!exactAmount && absExp > 0 && absTx > absExp) {
    const tipPct = (absTx - absExp) / absExp;
    if (tipPct <= 0.15) {
      tipVariance = true;
    }
  }

  // Date difference in days (guard against missing or malformed date strings)
  const txDate = new Date(txDateStr);
  const expDate = new Date(expDateStr);
  const hasValidDates =
    Boolean(txDateStr && expDateStr) &&
    Number.isFinite(txDate.getTime()) &&
    Number.isFinite(expDate.getTime());
  const diffDays = hasValidDates
    ? Math.round(Math.abs(txDate.getTime() - expDate.getTime()) / (1000 * 3600 * 24))
    : Number.POSITIVE_INFINITY;

  // Vendor / Description similarity
  const cleanVendor = (expVendor || "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
  const cleanTxDesc = (txDescription || "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
  
  let vendorMatched = false;
  if (cleanVendor && cleanTxDesc) {
    const vendorTokens = cleanVendor.split(/\s+/).filter(t => t.length > 2);
    for (const tok of vendorTokens) {
      if (cleanTxDesc.includes(tok)) {
        vendorMatched = true;
        break;
      }
    }
  }

  const reasons: string[] = [];
  let points = 0;

  if (exactAmount) {
    points += 50;
    reasons.push(`Exact amount (${formatCurrency(absExp)})`);
  } else if (tipVariance) {
    points += 35;
    reasons.push(`Tip adjusted (+${formatCurrency(absTx - absExp)} / within 15%)`);
  }

  if (diffDays === 0) {
    points += 30;
    reasons.push("Same-day transaction");
  } else if (diffDays <= 2) {
    points += 20;
    reasons.push(`Settled in ${diffDays} day${diffDays > 1 ? "s" : ""}`);
  } else if (diffDays <= 4) {
    points += 10;
    reasons.push(`Within ${diffDays} days`);
  }

  if (vendorMatched) {
    points += 20;
    reasons.push(`Vendor match ("${expVendor}")`);
  }

  // Cap between 40 and 100 for any item surfaced by reconciler
  const score = Math.min(100, Math.max(45, points));

  let label: MatchScoreResult["label"];
  let badgeVariant: MatchScoreResult["badgeVariant"];

  if (score >= 95) {
    label = "Guaranteed Match";
    badgeVariant = "success";
  } else if (score >= 80) {
    label = "High Confidence";
    badgeVariant = "info";
  } else {
    label = "Likely Match";
    badgeVariant = "warning";
  }

  return {
    score,
    label,
    badgeVariant,
    reasons,
  };
}
