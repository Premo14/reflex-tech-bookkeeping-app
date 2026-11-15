import { useCallback, useEffect, useRef, useState } from "react";
import TransactionList from "./TransactionList";
import ReceiptList from "./ReceiptList";
import InvoiceList from "./InvoiceList";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Modal } from "./ui/Modal";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import DetailDrawer from "./DetailDrawer";
import {
  getTransactions,
  getExpenses,
  getInvoices,
  createTransaction,
  createExpense,
  getSummary,
  uploadReceiptToExpense,
  ApiError,
} from "../services/api";
import type {
  BankTransaction,
  Expense,
  ChartAccount,
  LedgerSummary,
  Invoice,
  CreateTransactionInput,
  CreateExpenseInput,
} from "../types/models";
import CreateExpenseForm from "./CreateExpenseForm";
import CreateTransactionForm from "./CreateTransactionForm";
import Pagination from "./ui/Pagination";
import { useConfirm } from "./ui/ConfirmDialog";
import { useLiveEvent } from "../utils/useLiveSync";
import { formatCurrency } from "../utils/formatCurrency";

interface LedgerGridProps {
  startDate: string;
  endDate: string;
  accounts: ChartAccount[];
  activeAccountId: number | null;
  viewUnlinkedTrigger?: number;
  viewUncategorizedTrigger?: number;
  onItemsChanged?: () => void;
  onCreateRule?: (data: {
    name: string;
    descriptionKeyword: string;
    categoryAccountId?: number | null;
  }) => void;
  onOpenInvoices?: () => void;
  onEditInvoice?: (inv: Invoice) => void;
  onPrintInvoice?: (inv: Invoice) => void;
}

type TransactionFormState = Partial<CreateTransactionInput> & { timestamp?: string };
type ExpenseFormState = Partial<Expense> & { date?: string; receiptFile?: File | null };

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const apiErrMsg = err.data?.error;
    if (typeof apiErrMsg === "string" && apiErrMsg) return apiErrMsg;
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function LedgerGrid({
  startDate,
  endDate,
  accounts,
  activeAccountId,
  viewUnlinkedTrigger,
  viewUncategorizedTrigger,
  onItemsChanged,
  onCreateRule,
  onOpenInvoices,
  onEditInvoice,
  onPrintInvoice,
}: LedgerGridProps) {
  const { alert } = useConfirm();
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);

  const [sourceDocTab, setSourceDocTab] = useState<"receipts" | "invoices">("receipts");
  const [txFilter, setTxFilter] = useState("ALL");
  const [expFilter, setExpFilter] = useState("ALL");
  const [invFilter, setInvFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [mobileTab, setMobileTab] = useState<"expenses" | "invoices" | "transactions">("expenses");
  const [drawerOffset, setDrawerOffset] = useState(0);
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );

  const [drawerConfig, setDrawerConfig] = useState<{
    type: "transaction" | "receipt" | "invoice" | null;
    id: number | null;
  }>({ type: null, id: null });
  const [isTxLoading, setIsTxLoading] = useState(true);
  const [isExpLoading, setIsExpLoading] = useState(true);
  const [isInvLoading, setIsInvLoading] = useState(true);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);

  const [showAddTx, setShowAddTx] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [txForm, setTxForm] = useState<TransactionFormState>({ transactionType: "DEBIT" });
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>({ tender: "card" });

  const [txPage, setTxPage] = useState(1);
  const [txTotalPages, setTxTotalPages] = useState(1);
  const [expPage, setExpPage] = useState(1);
  const [expTotalPages, setExpTotalPages] = useState(1);
  const LIMIT = 50;

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const txReqIdRef = useRef(0);
  const expReqIdRef = useRef(0);
  const invReqIdRef = useRef(0);
  const summaryReqIdRef = useRef(0);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const loadTransactions = useCallback(
    async (silent = false) => {
      const reqId = ++txReqIdRef.current;
      if (!silent) setIsTxLoading(true);
      try {
        const txData = await getTransactions({
          startDate,
          endDate,
          accountId: activeAccountId === null ? undefined : activeAccountId,
          search: searchQuery,
          status: txFilter,
          sortBy: sortField,
          sortOrder,
          page: txPage,
          limit: LIMIT,
        });
        if (reqId !== txReqIdRef.current) return;
        setTransactions(txData.transactions || []);
        setTxTotalPages(Math.max(1, Math.ceil((txData.total || 0) / LIMIT)));
      } catch (err) {
        console.error("Failed to load transactions:", err);
      } finally {
        if (reqId === txReqIdRef.current) setIsTxLoading(false);
      }
    },
    [startDate, endDate, activeAccountId, searchQuery, txFilter, sortField, sortOrder, txPage]
  );

  const loadExpenses = useCallback(
    async (silent = false) => {
      const reqId = ++expReqIdRef.current;
      if (!silent) setIsExpLoading(true);
      try {
        const expData = await getExpenses({
          startDate,
          endDate,
          accountId: activeAccountId === null ? undefined : activeAccountId,
          search: searchQuery,
          status: expFilter,
          sortBy: sortField,
          sortOrder,
          page: expPage,
          limit: LIMIT,
        });
        if (reqId !== expReqIdRef.current) return;
        setExpenses(expData.expenses || []);
        setExpTotalPages(Math.max(1, Math.ceil((expData.total || 0) / LIMIT)));
      } catch (err) {
        console.error("Failed to load expenses:", err);
      } finally {
        if (reqId === expReqIdRef.current) setIsExpLoading(false);
      }
    },
    [startDate, endDate, activeAccountId, searchQuery, expFilter, sortField, sortOrder, expPage]
  );

  const loadInvoices = useCallback(
    async (silent = false) => {
      const reqId = ++invReqIdRef.current;
      if (!silent) setIsInvLoading(true);
      try {
        const res = await getInvoices({
          status: invFilter !== "ALL" ? invFilter : undefined,
          search: searchQuery || undefined,
        });
        if (reqId !== invReqIdRef.current) return;
        setInvoices(res.invoices || []);
      } catch (err) {
        console.error("Failed to load invoices:", err);
      } finally {
        if (reqId === invReqIdRef.current) setIsInvLoading(false);
      }
    },
    [invFilter, searchQuery]
  );

  const loadSummary = useCallback(
    async (silent = false) => {
      const reqId = ++summaryReqIdRef.current;
      if (!silent) setIsSummaryLoading(true);
      try {
        const summaryData = await getSummary({
          startDate,
          endDate,
          accountId: activeAccountId === null ? undefined : activeAccountId,
        });
        if (reqId !== summaryReqIdRef.current) return;
        setSummary(summaryData);
      } catch (err) {
        console.error("Failed to load summary:", err);
      } finally {
        if (reqId === summaryReqIdRef.current) setIsSummaryLoading(false);
      }
    },
    [startDate, endDate, activeAccountId]
  );

  const loadGridData = useCallback(
    async (silent = false) => {
      await Promise.all([
        loadTransactions(silent),
        loadExpenses(silent),
        loadInvoices(silent),
        loadSummary(silent),
      ]);
    },
    [loadTransactions, loadExpenses, loadInvoices, loadSummary]
  );

  // Per-resource effects avoid duplicate mounts while keeping filter changes crisp.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadTransactions(false);
    });
    return () => {
      active = false;
    };
  }, [loadTransactions]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadExpenses(false);
    });
    return () => {
      active = false;
    };
  }, [loadExpenses]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadInvoices(false);
    });
    return () => {
      active = false;
    };
  }, [loadInvoices]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadSummary(false);
    });
    return () => {
      active = false;
    };
  }, [loadSummary]);

  // Real-time live background event listeners
  useLiveEvent("TRANSACTIONS_UPDATED", () => {
    void loadTransactions(true);
    void loadInvoices(true);
    void loadSummary(true);
  });

  useLiveEvent("EXPENSES_UPDATED", () => {
    void loadExpenses(true);
    void loadSummary(true);
  });

  useLiveEvent(["INVOICES_UPDATED", "ACCOUNTS_UPDATED"], () => {
    void loadInvoices(true);
    void loadSummary(true);
  });

  useLiveEvent("RECONCILIATION_UPDATED", () => {
    void loadTransactions(true);
    void loadExpenses(true);
    void loadInvoices(true);
    void loadSummary(true);
  });

  useEffect(() => {
    if (!viewUnlinkedTrigger || viewUnlinkedTrigger <= 0) return;
    const t = setTimeout(() => {
      setTxFilter("NEEDS_ATTENTION");
      setExpFilter("NEEDS_ATTENTION");
      setTxPage(1);
      setExpPage(1);
    }, 0);
    return () => clearTimeout(t);
  }, [viewUnlinkedTrigger]);

  useEffect(() => {
    if (!viewUncategorizedTrigger || viewUncategorizedTrigger <= 0) return;
    const t = setTimeout(() => {
      setTxFilter("UNCATEGORIZED");
      setExpFilter("UNCATEGORIZED");
      setTxPage(1);
      setExpPage(1);
    }, 0);
    return () => clearTimeout(t);
  }, [viewUncategorizedTrigger]);

  // Reset drawer if resized to desktop
  useEffect(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < 768);
      if (window.innerWidth >= 1024) setDrawerOffset(0);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleCreateTransaction = async () => {
    let amt = Number(txForm.amount);
    if (!amt || Number.isNaN(amt) || amt === 0) {
      await alert({ title: "Invalid Amount", message: "Please enter a valid amount." });
      return;
    }
    if (!txForm.date) {
      await alert({ title: "Missing Date", message: "Please select a date." });
      return;
    }
    if (!txForm.chartAccountId) {
      await alert({
        title: "Missing Bank Account",
        message: "Please select a Bank or Credit Card account for this transaction.",
      });
      return;
    }

    // Enforce correct sign for transactions
    const out = txForm.transactionType === "DEBIT" || txForm.transactionType === "PAYMENT";
    if (out && amt > 0) amt = -amt;
    else if (!out && amt < 0) amt = Math.abs(amt);

    setIsSaving(true);
    try {
      const payload: CreateTransactionInput = {
        description: txForm.description || "Unknown Transaction",
        amount: amt,
        date: new Date(txForm.date).toISOString(),
        transactionType: txForm.transactionType || "DEBIT",
        chartAccountId: Number(txForm.chartAccountId),
        categoryAccountId: txForm.categoryAccountId ? Number(txForm.categoryAccountId) : undefined,
        notes: txForm.notes,
      };
      await createTransaction(payload);
      setShowAddTx(false);
      setTxForm({ transactionType: "DEBIT" });
      await loadGridData();
    } catch (err: unknown) {
      await alert({
        title: "Error",
        message: getErrorMessage(err, "Failed to create transaction"),
        variant: "danger",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenAddTx = () => {
    let defaultBankId: number | undefined;
    if (activeAccountId) {
      const activeAcc = accounts.find((a) => a.id === activeAccountId);
      if (activeAcc && (activeAcc.type === "ASSET" || activeAcc.type === "LIABILITY")) {
        defaultBankId = activeAcc.id;
      }
    }
    if (!defaultBankId) {
      const primaryChecking = accounts.find((a) => a.code === "1010" && a.active);
      if (primaryChecking) defaultBankId = primaryChecking.id;
    }
    const todayStr = new Date().toISOString().split("T")[0];
    setTxForm({ date: todayStr, transactionType: "DEBIT", chartAccountId: defaultBankId });
    setShowAddTx(true);
  };

  const handleOpenAddExpense = () => {
    const todayStr = new Date().toISOString().split("T")[0];
    setExpenseForm({ timestamp: todayStr, date: todayStr, tender: "card" });
    setShowAddExpense(true);
  };

  const handleCreateExpense = async () => {
    const amt = Number(expenseForm.amount);
    if (!amt || Number.isNaN(amt) || amt === 0) {
      await alert({ title: "Invalid Amount", message: "Please enter a valid amount." });
      return;
    }
    const dateField = expenseForm.timestamp || expenseForm.date;
    if (!dateField) {
      await alert({ title: "Missing Date", message: "Please select a date." });
      return;
    }

    setIsSaving(true);
    try {
      const payload: CreateExpenseInput = {
        vendor: expenseForm.vendor || "Unknown Vendor",
        description: expenseForm.description || "Expense",
        amount: amt,
        timestamp: new Date(dateField).toISOString(),
        tender: expenseForm.tender || "card",
        chartAccountId: expenseForm.chartAccountId ? Number(expenseForm.chartAccountId) : undefined,
        notes: expenseForm.notes,
      };
      const createdExpense = await createExpense(payload);
      if (expenseForm.receiptFile && createdExpense?.id) {
        try {
          await uploadReceiptToExpense(createdExpense.id, expenseForm.receiptFile);
        } catch (uploadErr) {
          console.error("Failed to upload attached receipt:", uploadErr);
        }
      }
      setShowAddExpense(false);
      setExpenseForm({ tender: "card" });
      await loadGridData();
    } catch (err: unknown) {
      await alert({
        title: "Error",
        message: getErrorMessage(err, "Failed to create expense"),
        variant: "danger",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const buildExportUrl = (endpoint: string) => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (activeAccountId) params.set("accountId", String(activeAccountId));
    if (searchQuery) params.set("search", searchQuery);
    const qs = params.toString();
    return qs ? `${endpoint}?${qs}` : endpoint;
  };

  const exportTransactionsCSV = () => {
    window.location.href = buildExportUrl("/api/transactions/export");
  };

  const exportExpensesCSV = () => {
    window.location.href = buildExportUrl("/api/expenses/export");
  };

  const netIncomeValue = summary
    ? summary.netIncome ?? summary.totalIncome - summary.totalExpenses
    : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#050505]">
      {/* TOOLBAR */}
      <div className="px-4 sm:px-6 py-2.5 sm:py-3 border-b border-white/5 flex flex-wrap gap-3 items-center justify-between bg-[#0a0a0c] shrink-0">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Input
              type="text"
              aria-label="Search ledger"
              placeholder={isNarrow ? "Search txs and exps..." : "Search transactions and expenses..."}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setTxPage(1);
                setExpPage(1);
              }}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              }
            />
          </div>
          <div className="w-auto shrink-0">
            <Select
              aria-label="Sort ledger items"
              value={`${sortField}-${sortOrder}`}
              onChange={(e) => {
                const [f, o] = e.target.value.split("-");
                setSortField(f);
                setSortOrder(o as "asc" | "desc");
              }}
              className="py-1.5! text-xs! whitespace-nowrap"
              autoWidth
              dropdownAlign="right"
              icon={
                <svg className="w-4 h-4 text-zinc-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                  />
                </svg>
              }
            >
              <option value="date-desc">Date (Newest)</option>
              <option value="date-asc">Date (Oldest)</option>
              <option value="amount-desc">Amount (Highest)</option>
              <option value="amount-asc">Amount (Lowest)</option>
            </Select>
          </div>
          <div className="relative" ref={exportMenuRef}>
            <Button
              variant="secondary"
              size="sm"
              aria-haspopup="menu"
              aria-expanded={isExportMenuOpen}
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Export
              <svg
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
                  isExportMenuOpen ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </Button>
            {isExportMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 bg-zinc-900/95 border border-white/10 rounded-xl shadow-2xl z-50 py-1.5 backdrop-blur-xl glow-border-emerald"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    exportTransactionsCSV();
                    setIsExportMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/5 touch-glow-blue flex items-center gap-2 cursor-pointer transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  Export Transactions (CSV)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    exportExpensesCSV();
                    setIsExportMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/5 touch-glow-emerald flex items-center gap-2 cursor-pointer transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  Export Expenses (CSV)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SUMMARY BAR */}
      <div
        className={`px-4 sm:px-6 py-2.5 sm:py-3 border-b border-white/5 bg-[#0a0a0c]/80 shrink-0 transition-opacity duration-200 ${
          isSummaryLoading && summary ? "opacity-60" : ""
        }`}
      >
        {!summary ? (
          <div className="flex items-center gap-3 py-0.5 text-zinc-400 text-xs font-medium">
            <LoadingSpinner size="sm" color="text-emerald-500" />
            <span>Calculating ledger summary (income, expenses, cashflow)…</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 lg:gap-x-8 gap-y-2.5">
            <div className="flex flex-col" title="Total business revenue / bank deposits received in this period">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5 flex items-center gap-1.5">
                Income (Revenue)
                {isSummaryLoading && <LoadingSpinner size="xs" color="text-zinc-500" />}
              </span>
              <span className="text-base xl:text-lg font-bold font-mono tabular-nums text-emerald-400 tracking-tight">
                {formatCurrency(summary.totalIncome)}
              </span>
            </div>
            <div className="flex flex-col" title="Total business expenses and receipts logged in this period">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5 flex items-center gap-1.5">
                Expenses
                {isSummaryLoading && <LoadingSpinner size="xs" color="text-zinc-500" />}
              </span>
              <span className="text-base xl:text-lg font-bold font-mono tabular-nums text-red-400 tracking-tight">
                {formatCurrency(summary.totalExpenses)}
              </span>
            </div>
            <div className="flex flex-col" title="Net profit or loss (Total Income minus Total Expenses)">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5 flex items-center gap-1.5">
                Net Profit / Loss
                {isSummaryLoading && <LoadingSpinner size="xs" color="text-zinc-500" />}
              </span>
              <span
                className={`text-base xl:text-lg font-bold font-mono tabular-nums tracking-tight ${
                  netIncomeValue >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {formatCurrency(netIncomeValue)}
              </span>
            </div>
            <div className="flex flex-col" title="Net change across physical bank accounts (all deposits minus all debits)">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5 flex items-center gap-1.5">
                Bank Cash Flow
                {isSummaryLoading && <LoadingSpinner size="xs" color="text-zinc-500" />}
              </span>
              <span
                className={`text-base xl:text-lg font-bold font-mono tabular-nums tracking-tight ${
                  summary.netCashflow >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {formatCurrency(summary.netCashflow)}
              </span>
            </div>

            <div className="flex flex-col items-start xl:items-end xl:pl-6 xl:border-l border-white/5 ml-auto max-w-full">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5 flex items-center gap-1.5">
                Status
                {isSummaryLoading && <LoadingSpinner size="xs" color="text-zinc-500" />}
              </span>
              {summary.unlinkedExpCount > 0 || summary.unlinkedTxCount > 0 ? (
                <Button
                  variant="warning"
                  size="sm"
                  glow
                  onClick={() => {
                    setTxFilter("NEEDS_ATTENTION");
                    setExpFilter("NEEDS_ATTENTION");
                    setTxPage(1);
                    setExpPage(1);
                  }}
                  className="max-w-full py-1! px-2.5! text-xs!"
                  title="Filter both lists to show items requiring your attention"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span className="truncate font-mono tabular-nums">
                    {summary.unlinkedTxCount + summary.unlinkedExpCount} Need Attention (
                    {summary.unlinkedTxCount} Tx / {summary.unlinkedExpCount} Exp)
                  </span>
                </Button>
              ) : (
                <span
                  className="flex items-center text-left whitespace-nowrap gap-1.5 text-xs font-semibold text-zinc-400 px-2.5 py-1 max-w-full"
                  title="All Caught Up"
                >
                  <svg className="w-4 h-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="truncate hidden xl:inline text-emerald-400">All Caught Up</span>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* GRID */}
      <div
        className="flex-1 overflow-hidden flex flex-col relative z-20 bg-[#050505] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] lg:shadow-none transition-[margin-top] duration-150 ease-out"
        style={{
          marginTop: `-${Math.min(220, Math.max(0, drawerOffset))}px`,
        }}
      >
        {/* Mobile Tabs & Drag Handle */}
        <div
          className="lg:hidden h-6 w-full bg-[#0e0e10] flex items-center justify-center cursor-row-resize border-t border-white/10 shrink-0 touch-none relative z-10"
          title="Drag or tap to expand/collapse view"
          onClick={() => setDrawerOffset((prev) => (prev > 50 ? 0 : 200))}
          onTouchStart={(e) => {
            const startY = e.touches[0].clientY;
            const startOffset = drawerOffset;
            const onMove = (ev: TouchEvent) => {
              const delta = startY - ev.touches[0].clientY;
              setDrawerOffset(Math.min(220, Math.max(0, startOffset + delta)));
            };
            const onEnd = () => {
              document.removeEventListener("touchmove", onMove);
              document.removeEventListener("touchend", onEnd);
            };
            document.addEventListener("touchmove", onMove);
            document.addEventListener("touchend", onEnd);
          }}
          onMouseDown={(e) => {
            const startY = e.clientY;
            const startOffset = drawerOffset;
            const onMove = (ev: MouseEvent) => {
              const delta = startY - ev.clientY;
              setDrawerOffset(Math.min(220, Math.max(0, startOffset + delta)));
            };
            const onEnd = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onEnd);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onEnd);
          }}
        >
          <div className="w-10 h-1.5 rounded-full bg-zinc-600 pointer-events-none" />
        </div>

        {/* Mobile 3-Tab Switcher */}
        <div className="lg:hidden flex border-b border-white/5 shrink-0 bg-[#0a0a0c]" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "expenses"}
            onClick={() => {
              setMobileTab("expenses");
              setSourceDocTab("receipts");
            }}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer touch-glow-emerald ${
              mobileTab === "expenses"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-zinc-400 hover:text-zinc-300"
            }`}
          >
            <span>Receipts</span>
            <span className="text-[10px] text-zinc-400 font-normal font-mono tabular-nums">
              ({expenses.length})
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "invoices"}
            onClick={() => {
              setMobileTab("invoices");
              setSourceDocTab("invoices");
            }}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer touch-glow-purple ${
              mobileTab === "invoices"
                ? "border-purple-500 text-purple-300"
                : "border-transparent text-zinc-400 hover:text-zinc-300"
            }`}
          >
            <span>Invoices</span>
            <span className="text-[10px] text-zinc-400 font-normal font-mono tabular-nums">
              ({invoices.length})
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "transactions"}
            onClick={() => setMobileTab("transactions")}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer touch-glow-blue ${
              mobileTab === "transactions"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-zinc-400 hover:text-zinc-300"
            }`}
          >
            <span>Bank</span>
            <span className="text-[10px] text-zinc-400 font-normal font-mono tabular-nums">
              ({transactions.length})
            </span>
          </button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/5 relative">
          {/* SOURCE DOCUMENTS COLUMN (RECEIPTS & CLIENT INVOICES) */}
          <div
            className={`flex-col bg-[#050505] min-h-0 ${
              mobileTab === "expenses" || mobileTab === "invoices" ? "flex" : "hidden lg:flex"
            }`}
          >
            <div className="px-2.5 sm:px-4 py-2 flex justify-between items-center gap-2 bg-[#0c0c0f] border-b border-white/5 shrink-0 min-w-0">
              {/* Mobile / Tablet Header Label */}
              <div className="lg:hidden flex items-center gap-2 font-bold text-xs text-white shrink-0 min-w-0">
                {mobileTab === "invoices" || sourceDocTab === "invoices" ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="truncate">Invoices ({invoices.length})</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="truncate">Receipts ({expenses.length})</span>
                  </>
                )}
              </div>

              {/* Desktop Dynamic Segmented Tab Switcher */}
              <div className="hidden lg:flex items-center gap-1 bg-zinc-950/90 p-0.5 rounded-lg border border-white/10 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSourceDocTab("receipts");
                    setMobileTab("expenses");
                  }}
                  data-tooltip="Receipts & Expense Slips"
                  title="Receipts & Expense Slips"
                  aria-label="Receipts & Expense Slips"
                  aria-pressed={mobileTab === "invoices" ? false : sourceDocTab === "receipts"}
                  className={`px-2 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer touch-glow-emerald ${
                    (mobileTab === "invoices" ? false : sourceDocTab === "receipts")
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 glow-emerald"
                      : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                  }`}
                >
                  <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="hidden 2xl:inline">Receipts & Slips</span>
                  <span className="hidden xl:inline 2xl:hidden">Receipts</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-zinc-200 font-mono tabular-nums">
                    {expenses.length}
                  </span>
                  {isExpLoading && <LoadingSpinner size="xs" color="text-emerald-400" className="ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceDocTab("invoices");
                    setMobileTab("invoices");
                  }}
                  data-tooltip="Client Invoices & Receivables"
                  title="Client Invoices & Receivables"
                  aria-label="Client Invoices & Receivables"
                  aria-pressed={mobileTab === "invoices" || sourceDocTab === "invoices"}
                  className={`px-2 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer touch-glow-purple ${
                    mobileTab === "invoices" || sourceDocTab === "invoices"
                      ? "bg-purple-500/15 text-purple-200 border border-purple-500/30 glow-purple"
                      : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                  }`}
                >
                  <svg className="w-3.5 h-3.5 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="hidden 2xl:inline">Client Invoices</span>
                  <span className="hidden xl:inline 2xl:hidden">Invoices</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-zinc-200 font-mono tabular-nums">
                    {invoices.length}
                  </span>
                  {isInvLoading && <LoadingSpinner size="xs" color="text-purple-400" className="ml-0.5" />}
                </button>
              </div>

              {/* Controls for Active Document Sub-Tab */}
              {mobileTab === "invoices" || sourceDocTab === "invoices" ? (
                <div className="flex gap-1.5 sm:gap-2 items-center shrink-0 min-w-0">
                  <div className="w-auto shrink-0">
                    <Select
                      aria-label="Filter invoices"
                      value={invFilter}
                      onChange={(e) => setInvFilter(e.target.value)}
                      className="py-1! sm:py-1.5! text-xs! whitespace-nowrap"
                      autoWidth
                      dropdownAlign="right"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="DRAFT">Draft</option>
                      <option value="SENT">Sent</option>
                      <option value="PARTIALLY_PAID">Partially Paid</option>
                      <option value="PAID">Paid</option>
                      <option value="OVERDUE">Overdue</option>
                    </Select>
                  </div>
                  {onOpenInvoices && (
                    <Button
                      variant="secondary"
                      onClick={onOpenInvoices}
                      title="Create Client Invoice (+)"
                      aria-label="Create Client Invoice"
                      className="p-1.5! shrink-0 touch-glow-purple"
                      size="sm"
                    >
                      <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                      </svg>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex gap-1.5 sm:gap-2 items-center shrink-0 min-w-0">
                  <div className="w-auto shrink-0">
                    <Select
                      aria-label="Filter receipts"
                      value={expFilter}
                      onChange={(e) => {
                        setExpFilter(e.target.value);
                        setExpPage(1);
                      }}
                      className="py-1! sm:py-1.5! text-xs! whitespace-nowrap"
                      autoWidth
                      dropdownAlign="right"
                    >
                      <option value="ALL">All</option>
                      <option value="NEEDS_ATTENTION">Needs Attention</option>
                      <option value="UNCATEGORIZED">Uncategorized</option>
                      <option value="UNLINKED">Unlinked</option>
                      <option value="BALANCED">Balanced</option>
                      <option value="PARTIALLY_ALLOCATED">Under-Allocated</option>
                      <option value="OVER_ALLOCATED">Over-Allocated</option>
                    </Select>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={handleOpenAddExpense}
                    title="Add Manual Expense (+)"
                    aria-label="Add Manual Expense"
                    className="p-1.5! shrink-0 touch-glow-emerald"
                    size="sm"
                  >
                    <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                  </Button>
                </div>
              )}
            </div>

            {/* List Body for Active Document Sub-Tab */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24">
              {mobileTab === "invoices" || sourceDocTab === "invoices" ? (
                isInvLoading && invoices.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center space-y-3">
                    <LoadingSpinner size="lg" color="text-purple-500" />
                    <span className="text-xs text-zinc-400">Loading invoices…</span>
                  </div>
                ) : (
                  <div className={isInvLoading ? "opacity-60 transition-opacity" : "transition-opacity"}>
                    <InvoiceList
                      invoices={invoices}
                      filter={invFilter}
                      searchQuery={searchQuery}
                      sortField={sortField}
                      sortOrder={sortOrder}
                      onSelect={(id) => setDrawerConfig({ type: "invoice", id })}
                      onOpenCreate={onOpenInvoices}
                    />
                  </div>
                )
              ) : isExpLoading && expenses.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3">
                  <LoadingSpinner size="lg" color="text-emerald-500" />
                  <span className="text-xs text-zinc-400">Loading expenses…</span>
                </div>
              ) : (
                <div className={isExpLoading ? "opacity-60 transition-opacity" : "transition-opacity"}>
                  <ReceiptList
                    expenses={expenses}
                    filter={expFilter}
                    searchQuery={searchQuery}
                    sortField={sortField}
                    sortOrder={sortOrder}
                    onSelect={(id) => setDrawerConfig({ type: "receipt", id })}
                  />
                  <Pagination currentPage={expPage} totalPages={expTotalPages} onPageChange={setExpPage} />
                </div>
              )}
            </div>
          </div>

          {/* BANK TRANSACTIONS COLUMN */}
          <div className={`flex-col bg-[#050505] min-h-0 ${mobileTab === "transactions" ? "flex" : "hidden lg:flex"}`}>
            <div className="px-4 sm:px-6 py-3.5 flex justify-between items-center gap-2 bg-[#0c0c0f] border-b border-white/5 shrink-0 min-w-0">
              <h2 className="text-base sm:text-lg font-bold flex items-center gap-2 text-white tracking-tight shrink-0 whitespace-nowrap">
                <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                  />
                </svg>
                <span>Bank Transactions</span>
                {isTxLoading && <LoadingSpinner size="xs" color="text-blue-400" className="ml-1" />}
              </h2>
              <div className="flex gap-2 items-center shrink-0">
                <div className="w-auto shrink-0">
                  <Select
                    aria-label="Filter transactions"
                    value={txFilter}
                    onChange={(e) => {
                      setTxFilter(e.target.value);
                      setTxPage(1);
                    }}
                    className="py-1.5! text-xs! whitespace-nowrap"
                    autoWidth
                    dropdownAlign="right"
                  >
                    <option value="ALL">All</option>
                    <option value="NEEDS_ATTENTION">Needs Attention</option>
                    <option value="UNCATEGORIZED">Uncategorized</option>
                    <option value="UNLINKED">Unlinked</option>
                    <option value="BALANCED">Balanced</option>
                    <option value="PARTIALLY_ALLOCATED">Under-Allocated</option>
                    <option value="OVER_ALLOCATED">Over-Allocated</option>
                  </Select>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleOpenAddTx}
                  title="Add Transaction"
                  aria-label="Add Transaction"
                  className="p-1.5! touch-glow-blue"
                  size="sm"
                >
                  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24">
              {isTxLoading && transactions.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3">
                  <LoadingSpinner size="lg" color="text-blue-500" />
                  <span className="text-xs text-zinc-400">Loading bank transactions…</span>
                </div>
              ) : (
                <div className={isTxLoading ? "opacity-60 transition-opacity" : "transition-opacity"}>
                  <TransactionList
                    transactions={transactions}
                    filter={txFilter}
                    searchQuery={searchQuery}
                    sortField={sortField}
                    sortOrder={sortOrder}
                    onSelect={(id) => setDrawerConfig({ type: "transaction", id })}
                  />
                  <Pagination currentPage={txPage} totalPages={txTotalPages} onPageChange={setTxPage} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DetailDrawer
        type={drawerConfig.type}
        id={drawerConfig.id}
        onClose={() => {
          setDrawerConfig({ type: null, id: null });
          void loadGridData();
          onItemsChanged?.();
        }}
        onCreateRule={onCreateRule}
        onOpenInvoices={onOpenInvoices}
        onEditInvoice={(inv) => {
          setDrawerConfig({ type: null, id: null });
          onEditInvoice?.(inv);
        }}
        onPrintInvoice={(inv) => {
          setDrawerConfig({ type: null, id: null });
          onPrintInvoice?.(inv);
        }}
      />

      {/* ADD TRANSACTION MODAL */}
      <Modal
        isOpen={showAddTx}
        onClose={() => setShowAddTx(false)}
        title="Add Transaction"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={() => setShowAddTx(false)}>
              Cancel
            </Button>
            <Button variant="primary" glow onClick={handleCreateTransaction} isLoading={isSaving}>
              Create Transaction
            </Button>
          </div>
        }
      >
        <CreateTransactionForm
          form={txForm}
          setForm={setTxForm}
          accounts={accounts}
          defaultBankAccountId={txForm.chartAccountId}
        />
      </Modal>

      {/* ADD EXPENSE MODAL */}
      <Modal
        isOpen={showAddExpense}
        onClose={() => setShowAddExpense(false)}
        title="Add Expense"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={() => setShowAddExpense(false)}>
              Cancel
            </Button>
            <Button variant="primary" glow onClick={handleCreateExpense} isLoading={isSaving}>
              Create Expense
            </Button>
          </div>
        }
      >
        <CreateExpenseForm form={expenseForm} setForm={setExpenseForm} accounts={accounts} />
      </Modal>
    </div>
  );
}
