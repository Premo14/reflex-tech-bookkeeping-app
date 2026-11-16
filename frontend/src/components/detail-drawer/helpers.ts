import type { BankTransaction, Expense } from "../../types/models";
import { toCents } from "../../utils/formatCurrency";
import { normalizeAllocationStatus } from "../../utils/ledgerStatus";
import type { ConflictCategoryRef } from "./types";

export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "INR",
  "CNY",
  "CHF",
  "SGD",
  "HKD",
  "NZD",
  "KRW",
  "MXN",
  "BRL",
  "ZAR",
  "SEK",
  "NOK",
  "DKK",
  "RUB",
];

export const TENDERS = ["CARD", "CASH", "CHECK", "TRANSFER", "PAYPAL", "VENMO", "ZELLE", "OTHER"];

export interface ParsedApiErrorData {
  error?: string;
  message?: string;
  existingExpense?: { vendor?: string; amount?: number };
  transactionCategory?: ConflictCategoryRef;
  expenseCategory?: ConflictCategoryRef;
}

export interface ParsedApiError {
  status?: number;
  message: string;
  data?: ParsedApiErrorData;
}

/** Extracts HTTP status, message, and typed error payload from unknown thrown values. */
export function parseApiError(err: unknown, fallbackMessage = "Request failed"): ParsedApiError {
  if (typeof err === "object" && err !== null) {
    const obj = err as { status?: unknown; message?: unknown; data?: unknown };
    return {
      status: typeof obj.status === "number" ? obj.status : undefined,
      message: typeof obj.message === "string" && obj.message ? obj.message : fallbackMessage,
      data: typeof obj.data === "object" && obj.data !== null ? (obj.data as ParsedApiErrorData) : undefined,
    };
  }
  return { message: fallbackMessage };
}

/** Picks a human-readable error message from `err.data?.error`, `err.message`, or fallback. */
export function getErrorDisplayMessage(err: unknown, fallbackMessage: string): string {
  const parsed = parseApiError(err, fallbackMessage);
  return parsed.data?.error || parsed.message || fallbackMessage;
}

/** Computes exact integer-cent allocated vs total amounts for the expense panel. */
export function computeExpenseAllocationCents(
  currentExp: Expense,
  expensesList: Expense[],
  transactionsList: BankTransaction[]
): { allocatedCents: number; totalCents: number } {
  const isMultiExpense = expensesList.length > 1;
  const sumExpCents = expensesList.reduce((sum, e) => sum + toCents(e.amount), 0);
  const sumTxCents = transactionsList.reduce((sum, t) => sum + Math.abs(toCents(t.amount)), 0);
  const totalCents = isMultiExpense ? sumExpCents : toCents(currentExp.amount);

  if (isMultiExpense) {
    return {
      allocatedCents: transactionsList.length <= 1 && sumTxCents >= sumExpCents ? sumExpCents : sumTxCents,
      totalCents,
    };
  }

  const isBalanced = normalizeAllocationStatus(currentExp.allocationStatus) === "BALANCED";
  return {
    allocatedCents: transactionsList.length <= 1 && sumTxCents >= totalCents && isBalanced ? totalCents : sumTxCents,
    totalCents,
  };
}

/** Computes exact integer-cent allocated vs total amounts for the bank transaction panel. */
export function computeTxAllocationCents(
  currentTx: BankTransaction,
  transactionsList: BankTransaction[],
  expensesList: Expense[]
): { allocatedCents: number; totalCents: number } {
  const isMultiTx = transactionsList.length > 1;
  const sumTxCents = transactionsList.reduce((sum, t) => sum + Math.abs(toCents(t.amount)), 0);
  const sumExpCents = expensesList.reduce((sum, e) => sum + toCents(e.amount), 0);
  const totalCents = isMultiTx ? sumTxCents : Math.abs(toCents(currentTx.amount));

  if (isMultiTx) {
    return {
      allocatedCents: expensesList.length <= 1 && sumExpCents >= sumTxCents ? sumTxCents : sumExpCents,
      totalCents,
    };
  }

  const isBalanced = normalizeAllocationStatus(currentTx.allocationStatus) === "BALANCED";
  return {
    allocatedCents: expensesList.length === 1 && sumExpCents >= totalCents && isBalanced ? totalCents : sumExpCents,
    totalCents,
  };
}
