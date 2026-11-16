import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Button } from "./ui/Button";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { Tooltip } from "./ui/Tooltip";
import { useConfirm } from "./ui/confirmContext";
import ExcludeItemModal from "./ExcludeItemModal";
import SplitExpenseModal from "./SplitExpenseModal";
import { EXCLUSION_REASON_LABELS } from "../utils/ledgerStatus";
import {
  getTransactionDetail,
  getExpenseDetail,
  updateTransaction,
  updateExpense,
  deleteTransaction,
  deleteExpense,
  getUnlinkedItems,
  linkExpenseToTransaction,
  unlinkExpenseFromTransaction,
  linkExpenseToInvoice,
  unlinkExpenseFromInvoice,
  createAndLink,
  uploadReceiptToExpense,
  deleteReceipt,
  getSettings,
  getChartAccounts,
  resolveReviewItems,
  restoreItem,
  getInvoice,
  deleteInvoice,
  matchInvoicePayment,
  markInvoicePaidCash,
  unmatchInvoicePayment,
  getInvoiceCandidates,
  getInvoices,
  type CreateAndLinkInput,
} from "../services/api";
import type {
  BankTransaction,
  Expense,
  ChartAccount,
  Invoice,
  ScoredDepositCandidate,
  ScoredExpenseCandidate,
  ScoredTransactionCandidate,
} from "../types/models";
import { SuggestedMatchesList } from "./SuggestedMatchesList";
import { formatDate } from "../utils/dateUtils";
import { formatCurrency } from "../utils/formatCurrency";
import { useLiveEvent } from "../utils/useLiveSync";
import { ReceiptCanvasPane } from "./detail-drawer/ReceiptCanvasPane";
import { DetailInvoiceView } from "./detail-drawer/DetailInvoiceView";
import { DetailLinkPicker } from "./detail-drawer/DetailLinkPicker";
import { DetailSubModals } from "./detail-drawer/DetailSubModals";
import { DetailExpenseColumn } from "./detail-drawer/DetailExpenseColumn";
import { DetailTransactionColumn } from "./detail-drawer/DetailTransactionColumn";
import { getErrorDisplayMessage, parseApiError } from "./detail-drawer/helpers";
import type {
  ActionChoiceState,
  ActionTarget,
  AllowConfirmState,
  ConflictModalState,
  CreateAndLinkPayload,
  CreateFormState,
  ExpenseEditFormState,
  LinkTargetMode,
  OverAllocatedModalState,
  ReplaceOrAddModalState,
  TxEditFormState,
} from "./detail-drawer/types";

interface DetailDrawerProps {
  type: "transaction" | "receipt" | "invoice" | null;
  id: number | null;
  suspended?: boolean;
  onClose: () => void;
  onCreateRule?: (data: { name: string; descriptionKeyword: string; categoryAccountId?: number | null }) => void;
  onOpenInvoices?: () => void;
  onEditInvoice?: (inv: Invoice) => void;
  onPrintInvoice?: (inv: Invoice) => void;
}

const LINK_LIMIT = 20;

export default function DetailDrawer({
  type,
  id,
  suspended = false,
  onClose,
  onCreateRule,
  onOpenInvoices,
  onEditInvoice,
  onPrintInvoice,
}: DetailDrawerProps) {
  const { confirm, alert } = useConfirm();
  const activeRequestId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [hasBackgroundUpdate, setHasBackgroundUpdate] = useState(false);
  const [tx, setTx] = useState<BankTransaction | null>(null);
  const [expense, setExpense] = useState<Expense | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);

  // Invoice & Deposit Relationship State
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceCandidates, setInvoiceCandidates] = useState<ScoredDepositCandidate[]>([]);
  const [linkedInvoice, setLinkedInvoice] = useState<Invoice | null>(null);
  const [suggestedInvoices, setSuggestedInvoices] = useState<Invoice[]>([]);
  const [allOpenInvoices, setAllOpenInvoices] = useState<Invoice[]>([]);
  const [selectedInvoiceToMatch, setSelectedInvoiceToMatch] = useState<number | null>(null);
  const [isMatchingInvoice, setIsMatchingInvoice] = useState(false);
  const [showCashPayPanel, setShowCashPayPanel] = useState(false);
  const [cashPayDate, setCashPayDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [cashPayNotes, setCashPayNotes] = useState("");
  const [isRecordingCashPay, setIsRecordingCashPay] = useState(false);
  const [linkTargetMode, setLinkTargetMode] = useState<LinkTargetMode>("expense");
  const [linkInvoices, setLinkInvoices] = useState<Invoice[]>([]);
  const [isLinkingInvoice, setIsLinkingInvoice] = useState(false);

  const [confirmedExpenses, setConfirmedExpenses] = useState<Expense[]>([]);
  const [suggestedExpenseCandidates, setSuggestedExpenseCandidates] = useState<ScoredExpenseCandidate[]>([]);
  const [confirmedTransactions, setConfirmedTransactions] = useState<BankTransaction[]>([]);
  const [suggestedTransactionCandidates, setSuggestedTransactionCandidates] = useState<ScoredTransactionCandidate[]>([]);

  const [activeExpenseIdx, setActiveExpenseIdx] = useState(0);
  const [activeTxIdx, setActiveTxIdx] = useState(0);

  const [isEditingExpense, setIsEditingExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState<Partial<ExpenseEditFormState>>({});
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);

  const [isEditingTx, setIsEditingTx] = useState(false);
  const [txForm, setTxForm] = useState<Partial<TxEditFormState>>({});

  const [unlinked, setUnlinked] = useState<{ transactions: BankTransaction[]; expenses: Expense[] }>({
    transactions: [],
    expenses: [],
  });
  const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
  const [showLinkPanel, setShowLinkPanel] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>({});
  const [isSaving, setIsSaving] = useState(false);

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [activeReceiptIdx, setActiveReceiptIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isClosed, setIsClosed] = useState(false);
  const [isDateInClosedPeriod, setIsDateInClosedPeriod] = useState(false);
  const [excludeTarget, setExcludeTarget] = useState<ActionTarget | null>(null);
  const [ignoreTarget, setIgnoreTarget] = useState<ActionTarget | null>(null);
  const [actionChoiceModal, setActionChoiceModal] = useState<ActionChoiceState | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [conflictModalData, setConflictModalData] = useState<ConflictModalState | null>(null);
  const [overAllocatedModalData, setOverAllocatedModalData] = useState<OverAllocatedModalState | null>(null);
  const [replaceOrAddModalData, setReplaceOrAddModalData] = useState<ReplaceOrAddModalState | null>(null);
  const [allowConfirmTarget, setAllowConfirmTarget] = useState<AllowConfirmState | null>(null);
  const [isAllowing, setIsAllowing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [receiptZoom, setReceiptZoom] = useState(1);
  const [receiptRotation, setReceiptRotation] = useState(0);

  const [linkSearch, setLinkSearch] = useState("");
  const [linkStartDate, setLinkStartDate] = useState("");
  const [linkEndDate, setLinkEndDate] = useState("");
  const [linkPage, setLinkPage] = useState(1);
  const [unlinkedTotalPages, setUnlinkedTotalPages] = useState(1);
  const [showSplitCategories, setShowSplitCategories] = useState(false);

  // List of expenses to display/tab through
  const expensesList: Expense[] = (() => {
    if (type === "transaction") {
      return confirmedExpenses;
    }
    if (!expense) return [];
    if (confirmedTransactions.length > 0) {
      const activeConfirmedTx = confirmedTransactions[activeTxIdx];
      if (activeConfirmedTx?.expenses && activeConfirmedTx.expenses.length > 1) {
        return activeConfirmedTx.expenses;
      }
    }
    return [expense];
  })();

  // List of transactions to display/tab through
  const transactionsList: BankTransaction[] = (() => {
    if (type === "receipt") {
      return confirmedTransactions;
    }
    if (!tx) return [];
    if (confirmedExpenses.length > 0) {
      const activeConfirmedExp = confirmedExpenses[activeExpenseIdx] || confirmedExpenses[0];
      if (activeConfirmedExp?.bankTransactions && activeConfirmedExp.bankTransactions.length > 0) {
        return activeConfirmedExp.bankTransactions;
      }
    }
    return [tx];
  })();

  const activeExpense: Expense | null =
    expensesList[activeExpenseIdx] || (type === "receipt" ? expense : confirmedExpenses[0] || null);
  const activeTx: BankTransaction | null =
    transactionsList[activeTxIdx] || (type === "transaction" ? tx : confirmedTransactions[0] || null);

  const isDeposit = Boolean(type === "transaction" && tx && tx.amount > 0);
  const expenseReceiptCount = (activeExpense || expense)?.receipts?.length ?? 0;
  const canAddMoreTransactions = !(expenseReceiptCount > 1 && transactionsList.length >= 1);

  const loadData = useCallback(
    async (resetIdx = false) => {
      const reqId = ++activeRequestId.current;
      setIsLoading(true);
      if (resetIdx) {
        setActiveExpenseIdx(0);
        setActiveTxIdx(0);
        setSuggestedExpenseCandidates([]);
        setSuggestedTransactionCandidates([]);
        setInvoice(null);
        setInvoiceCandidates([]);
        setLinkedInvoice(null);
        setSuggestedInvoices([]);
        setAllOpenInvoices([]);
        setSelectedInvoiceToMatch(null);
        setShowCashPayPanel(false);
        setCashPayNotes("");
        setCashPayDate(new Date().toISOString().split("T")[0]);
      }
      setIsEditingExpense(false);
      setIsEditingTx(false);
      setShowLinkPanel(false);
      setShowSplitCategories(false);
      setHasBackgroundUpdate(false);

      let loadedDate = "";
      let loadedReview = "";
      try {
        const accs = await getChartAccounts();
        if (reqId !== activeRequestId.current) return;
        setAccounts(accs);

        if (type === "transaction") {
          const data = await getTransactionDetail(Number(id));
          if (reqId !== activeRequestId.current) return;
          loadedDate = data.transaction.date;
          loadedReview = data.transaction.reviewStatus;
          setTx(data.transaction);
          setConfirmedExpenses(data.confirmedExpenses);
          setSuggestedExpenseCandidates(data.suggestedExpenseCandidates || []);
          setSuggestedTransactionCandidates([]);
          setLinkedInvoice(data.linkedInvoice || null);
          setSuggestedInvoices(data.suggestedInvoices || []);

          if (data.transaction.amount > 0 && !data.linkedInvoice) {
            try {
              const invList = await getInvoices();
              if (reqId === activeRequestId.current) {
                const openInvs = (invList.invoices || []).filter(
                  (i) => i.status !== "PAID" && i.status !== "VOID" && !i.bankTransactionId
                );
                setAllOpenInvoices(openInvs);
              }
            } catch (invErr) {
              console.error("Failed to load open invoices for deposit matching:", invErr);
            }
          } else {
            setAllOpenInvoices([]);
          }

          const activeExp = data.confirmedExpenses[0];
          if (activeExp?.bankTransactions && activeExp.bankTransactions.length > 0) {
            const matchIdx = activeExp.bankTransactions.findIndex((t) => t.id === data.transaction.id);
            setActiveTxIdx(matchIdx >= 0 ? matchIdx : 0);
          } else {
            setActiveTxIdx(0);
          }
          setActiveExpenseIdx((prev) => Math.min(prev, Math.max(0, data.confirmedExpenses.length - 1)));
        } else if (type === "receipt") {
          const data = await getExpenseDetail(Number(id));
          if (reqId !== activeRequestId.current) return;
          loadedDate = data.expense.timestamp;
          loadedReview = data.expense.reviewStatus || "";
          setExpense(data.expense);
          setConfirmedTransactions(data.confirmedTransactions);
          setSuggestedTransactionCandidates(data.suggestedTransactionCandidates || []);
          setSuggestedExpenseCandidates([]);

          const activeTxItem = data.confirmedTransactions[0];
          if (activeTxItem?.expenses && activeTxItem.expenses.length > 0) {
            const matchIdx = activeTxItem.expenses.findIndex((e) => e.id === data.expense.id);
            setActiveExpenseIdx(matchIdx >= 0 ? matchIdx : 0);
          } else {
            setActiveExpenseIdx(0);
          }
          setActiveTxIdx((prev) => Math.min(prev, Math.max(0, data.confirmedTransactions.length - 1)));
        } else if (type === "invoice") {
          const data = await getInvoice(Number(id));
          if (reqId !== activeRequestId.current) return;
          const inv = data?.invoice || (data as unknown as Invoice);
          if (!inv) return;
          loadedDate = inv.issueDate || inv.createdAt || "";
          loadedReview = inv.reviewStatus || "";
          setInvoice(inv);
          if (inv.bankTransaction) {
            setTx(inv.bankTransaction);
            setConfirmedTransactions([inv.bankTransaction]);
          } else {
            setTx(null);
            setConfirmedTransactions([]);
            try {
              const candData = await getInvoiceCandidates(inv.id);
              if (reqId === activeRequestId.current) {
                setInvoiceCandidates(candData.candidates || []);
              }
            } catch (candErr) {
              console.error("Failed to load invoice candidates:", candErr);
            }
          }
        }

        const settings = await getSettings();
        if (reqId !== activeRequestId.current) return;
        const targetDate: Date | null = loadedDate ? new Date(loadedDate) : null;
        let inClosedDate = false;
        if (targetDate && settings["BooksClosedDate"]) {
          const closedDate = new Date(settings["BooksClosedDate"]);
          targetDate.setHours(0, 0, 0, 0);
          closedDate.setHours(0, 0, 0, 0);
          inClosedDate = targetDate <= closedDate;
        }
        setIsDateInClosedPeriod(inClosedDate);

        let closed = inClosedDate;
        if ((loadedReview === "PENDING" && inClosedDate) || loadedReview === "IGNORED") closed = true;
        setIsClosed(closed);
      } catch (err) {
        console.error(err);
      } finally {
        if (reqId === activeRequestId.current) {
          setIsLoading(false);
        }
      }
    },
    [id, type]
  );

  const rootAmount = type === "transaction" ? activeTx?.amount : activeExpense?.amount;
  const rootDate = type === "transaction" ? activeTx?.date : activeExpense?.timestamp;

  const loadUnlinkedData = useCallback(async () => {
    try {
      if (linkTargetMode === "invoice") {
        const res = await getInvoices({ status: "ALL", search: linkSearch || undefined });
        const absAmt = rootAmount ? Math.abs(rootAmount) : 0;
        let candidates = (res.invoices || []).filter((inv) => {
          if (inv.status === "VOID") return false;
          if (type === "transaction" && (inv.status === "PAID" || inv.bankTransactionId)) return false;
          if (linkStartDate && inv.issueDate && inv.issueDate.split("T")[0] < linkStartDate) return false;
          if (linkEndDate && inv.issueDate && inv.issueDate.split("T")[0] > linkEndDate) return false;
          return true;
        });
        if (absAmt > 0) {
          candidates = candidates.sort((a, b) => {
            const diffA = Math.abs((a.balanceDue ?? a.totalAmount) - absAmt);
            const diffB = Math.abs((b.balanceDue ?? b.totalAmount) - absAmt);
            return diffA - diffB;
          });
        }
        setLinkInvoices(candidates);
        setUnlinkedTotalPages(1);
        return;
      }

      const data = await getUnlinkedItems({
        search: linkSearch,
        startDate: linkStartDate,
        endDate: linkEndDate,
        page: linkPage,
        limit: LINK_LIMIT,
        targetAmount: rootAmount ? Math.abs(rootAmount) : undefined,
        targetDate: rootDate ? new Date(rootDate).toISOString() : undefined,
      });
      setUnlinked(data);
      const totals = type === "transaction" ? data.totalExpenses : data.totalTxs;
      setUnlinkedTotalPages(Math.ceil((totals || 0) / LINK_LIMIT));
    } catch (err) {
      console.error(err);
    }
  }, [
    type,
    rootAmount,
    rootDate,
    linkTargetMode,
    linkSearch,
    linkStartDate,
    linkEndDate,
    linkPage,
  ]);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => onClose(), 300);
  }, [onClose]);

  const executeLink = useCallback(
    async (expId: number, txId: number, overrideChartAccountId?: number, force = false) => {
      try {
        await linkExpenseToTransaction(expId, txId, overrideChartAccountId, force);
        setSelectedLinkId(null);
        setShowLinkPanel(false);
        setConflictModalData(null);
        setOverAllocatedModalData(null);
        void loadData();
      } catch (err: unknown) {
        const parsed = parseApiError(err, "Failed to link");
        if (parsed.data?.error === "CATEGORY_MISMATCH" && parsed.data.transactionCategory && parsed.data.expenseCategory) {
          setConflictModalData({
            expenseId: expId,
            transactionId: txId,
            txCategory: parsed.data.transactionCategory,
            expCategory: parsed.data.expenseCategory,
          });
        } else if (parsed.data?.error === "OVER_ALLOCATED") {
          setOverAllocatedModalData({
            expenseId: expId,
            transactionId: txId,
            overrideChartAccountId,
            message: parsed.data.message || parsed.message,
          });
        } else {
          await alert({ title: "Link Failed", message: parsed.message, variant: "danger" });
        }
      }
    },
    [alert, loadData]
  );

  const handleApproveSuggestedMatch = useCallback(
    async (candidateKind: "expense" | "tx", candidateId: number) => {
      if (candidateKind === "expense") {
        if (!tx) return;
        if (expensesList.length > 0) {
          setReplaceOrAddModalData({ suggestedExpId: candidateId, isCreateMode: false, isSuggested: true });
          return;
        }
        await executeLink(candidateId, tx.id);
        return;
      }

      if (!expense) return;
      if (transactionsList.length > 0) {
        setReplaceOrAddModalData({ suggestedTxId: candidateId, isCreateMode: false, isSuggested: true });
        return;
      }
      await executeLink(expense.id, candidateId);
    },
    [tx, expense, expensesList.length, transactionsList.length, executeLink]
  );

  useEffect(() => {
    if (type && id) requestAnimationFrame(() => setIsVisible(true));
  }, [type, id]);

  useEffect(() => {
    if (!id || !type) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData(true);
    });
    return () => {
      active = false;
    };
  }, [id, type, loadData]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setIsEditingExpense(false);
      if (activeExpense) {
        setExpenseForm({
          timestamp: activeExpense.timestamp ? activeExpense.timestamp.split("T")[0] : "",
          vendor: activeExpense.vendor,
          description: activeExpense.description,
          amount: activeExpense.amount,
          taxAmount: activeExpense.taxAmount || 0,
          currencyCode: activeExpense.currencyCode || "USD",
          tender: activeExpense.tender,
          notes: activeExpense.notes || "",
          chartAccountId: activeExpense.chartAccountId || "",
        });
      } else {
        setExpenseForm({});
      }
    });
    return () => {
      active = false;
    };
  }, [activeExpense]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setIsEditingTx(false);
      if (activeTx) {
        setTxForm({
          date: activeTx.date ? activeTx.date.split("T")[0] : "",
          description: activeTx.description,
          amount: activeTx.amount,
          notes: activeTx.notes || "",
          chartAccountId: activeTx.chartAccountId || "",
          categoryAccountId: activeTx.categoryAccountId || "",
        });
      } else {
        setTxForm({});
      }
    });
    return () => {
      active = false;
    };
  }, [activeTx]);

  useEffect(() => {
    if (!showLinkPanel) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadUnlinkedData();
    });
    return () => {
      active = false;
    };
  }, [showLinkPanel, loadUnlinkedData]);

  useLiveEvent(["TRANSACTIONS_UPDATED", "EXPENSES_UPDATED", "RECONCILIATION_UPDATED", "INVOICES_UPDATED"], () => {
    if (!id || !type) return;
    if (isEditingExpense || isEditingTx) {
      setHasBackgroundUpdate(true);
    } else {
      void loadData(false);
    }
  });

  const prevSuspendedRef = useRef(suspended);
  useEffect(() => {
    if (prevSuspendedRef.current && !suspended && id && type) {
      void loadData(false);
    }
    prevSuspendedRef.current = suspended;
  }, [suspended, id, type, loadData]);

  useEffect(() => {
    if (!id || !type || suspended) return;
    const prevActive = document.activeElement as HTMLElement | null;
    return () => {
      if (prevActive && typeof prevActive.focus === "function") {
        prevActive.focus();
      }
    };
  }, [id, type, suspended]);

  useEffect(() => {
    if (suspended) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName);
      if (e.key === "Escape") {
        const hasSubModal =
          showCreateModal ||
          showReceiptModal ||
          Boolean(excludeTarget) ||
          Boolean(ignoreTarget) ||
          Boolean(actionChoiceModal) ||
          Boolean(conflictModalData) ||
          Boolean(overAllocatedModalData) ||
          Boolean(replaceOrAddModalData) ||
          Boolean(allowConfirmTarget);
        if (!hasSubModal) {
          handleClose();
        }
        return;
      }

      if (isInputFocused || showReceiptModal) return;

      if ((e.key === "a" || e.key === "A") && !isClosed) {
        if (type === "transaction" && suggestedExpenseCandidates.length > 0 && suggestedExpenseCandidates[0].score >= 50) {
          void handleApproveSuggestedMatch("expense", suggestedExpenseCandidates[0].expense.id);
        } else if (type === "receipt" && suggestedTransactionCandidates.length > 0 && suggestedTransactionCandidates[0].score >= 50) {
          void handleApproveSuggestedMatch("tx", suggestedTransactionCandidates[0].transaction.id);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    showCreateModal,
    showReceiptModal,
    excludeTarget,
    ignoreTarget,
    actionChoiceModal,
    conflictModalData,
    overAllocatedModalData,
    replaceOrAddModalData,
    allowConfirmTarget,
    handleClose,
    handleApproveSuggestedMatch,
    type,
    suggestedExpenseCandidates,
    suggestedTransactionCandidates,
    isClosed,
    suspended,
  ]);

  const handleUploadReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const targetExpenseId = activeExpense?.id || expense?.id;
    if (!targetExpenseId) return;

    const doUpload = async (allowDuplicate = false) => {
      try {
        setIsSaving(true);
        await uploadReceiptToExpense(targetExpenseId, file, allowDuplicate);
        void loadData();
      } catch (err: unknown) {
        const parsed = parseApiError(err, "Failed to upload receipt");
        if (parsed.status === 409 && parsed.data?.existingExpense) {
          const v = parsed.data.existingExpense.vendor || "Unknown Vendor";
          const a = parsed.data.existingExpense.amount || 0;
          const proceed = await confirm({
            title: "Duplicate Receipt Detected",
            message: `This receipt has already been uploaded previously to ${v} (${formatCurrency(a)}). Do you want to link it to this expense as well?`,
            confirmText: "Link Receipt",
            variant: "primary",
          });
          if (proceed) {
            await doUpload(true);
          }
        } else {
          await alert({
            title: "Upload Failed",
            message: `Failed to upload receipt: ${parsed.message}`,
            variant: "danger",
          });
        }
      } finally {
        setIsSaving(false);
      }
    };

    await doUpload();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteReceipt = async (receiptId: number) => {
    const ok = await confirm({
      title: "Delete Receipt",
      message: "Are you sure? Deleting a receipt completely removes the physical file from the system and cannot be undone.",
      confirmText: "Delete Receipt",
      variant: "danger",
    });
    if (!ok) return;
    try {
      setIsSaving(true);
      await deleteReceipt(receiptId);
      void loadData();
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to delete receipt");
      await alert({
        title: "Delete Failed",
        message: `Failed to delete receipt: ${parsed.message}`,
        variant: "danger",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const validateEditForm = async (
    formState: Partial<ExpenseEditFormState> | Partial<TxEditFormState>,
    isTx: boolean
  ): Promise<boolean> => {
    const amt = Number(formState.amount);
    if (!amt || isNaN(amt) || amt === 0) {
      await alert({ title: "Invalid Amount", message: "Please enter a valid amount." });
      return false;
    }
    const dateField = isTx
      ? (formState as Partial<TxEditFormState>).date
      : (formState as Partial<ExpenseEditFormState>).timestamp;
    if (!dateField) {
      await alert({ title: "Missing Date", message: "Please select a date." });
      return false;
    }
    if (isTx && !formState.chartAccountId) {
      await alert({ title: "Missing Bank Account", message: "Please select a bank or credit card account." });
      return false;
    }
    return true;
  };

  const handleSaveExpense = async () => {
    if (!activeExpense) return;
    try {
      const isValid = await validateEditForm(expenseForm, false);
      if (!isValid) return;

      const categoryChanged = String(activeExpense.chartAccountId || "") !== String(expenseForm.chartAccountId || "");
      await updateExpense(activeExpense.id, {
        timestamp: expenseForm.timestamp ? new Date(expenseForm.timestamp).toISOString() : undefined,
        vendor: expenseForm.vendor,
        description: expenseForm.description,
        amount: Number(expenseForm.amount),
        taxAmount: Number(expenseForm.taxAmount),
        currencyCode: expenseForm.currencyCode,
        tender: expenseForm.tender,
        notes: expenseForm.notes,
        chartAccountId: expenseForm.chartAccountId ? Number(expenseForm.chartAccountId) : null,
      });

      if (categoryChanged && transactionsList.length > 0) {
        await alert({
          title: "Category Synced",
          message: "The category has been synced across all linked items.",
        });
      }

      setIsEditingExpense(false);
      void loadData();
    } catch (err: unknown) {
      await alert({ title: "Save Failed", message: getErrorDisplayMessage(err, "Failed to save"), variant: "danger" });
    }
  };

  const handleSaveTx = async () => {
    if (!activeTx) return;
    try {
      const isValid = await validateEditForm(txForm, true);
      if (!isValid) return;

      const categoryChanged = String(activeTx.categoryAccountId || "") !== String(txForm.categoryAccountId || "");
      await updateTransaction(activeTx.id, {
        date: txForm.date ? new Date(txForm.date).toISOString() : undefined,
        description: txForm.description,
        amount: Number(txForm.amount),
        notes: txForm.notes,
        chartAccountId: txForm.chartAccountId ? Number(txForm.chartAccountId) : undefined,
        categoryAccountId: txForm.categoryAccountId ? Number(txForm.categoryAccountId) : null,
      });

      if (categoryChanged && expensesList.length === 1) {
        await alert({
          title: "Category Synced",
          message: "The category has been synced across all linked items.",
        });
      }

      setIsEditingTx(false);
      void loadData();
    } catch (err: unknown) {
      await alert({ title: "Save Failed", message: getErrorDisplayMessage(err, "Failed to save"), variant: "danger" });
    }
  };

  const handleDeleteExpense = async () => {
    if (!activeExpense) return;
    const ok = await confirm({
      title: "Move Expense to Deleted Items",
      message:
        "Move this expense to Deleted Items?\n\nIt will be unlinked, removed from your books, and kept in Deleted Items for 30 days before permanent deletion. You can restore it anytime from the sidebar.",
      confirmText: "Move to Deleted Items",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteExpense(activeExpense.id);
      if (type === "receipt" && activeExpense.id === expense?.id) {
        handleClose();
      } else {
        setActiveExpenseIdx((prev) => Math.max(0, prev - 1));
        void loadData();
      }
    } catch (err: unknown) {
      await alert({ title: "Delete Failed", message: getErrorDisplayMessage(err, "Failed to delete"), variant: "danger" });
    }
  };

  const handleDeleteTx = async () => {
    if (!activeTx) return;
    const ok = await confirm({
      title: "Move Transaction to Deleted Items",
      message:
        "Move this transaction to Deleted Items?\n\nIt will be unlinked, removed from your books, and kept in Deleted Items for 30 days before permanent deletion. You can restore it anytime from the sidebar.",
      confirmText: "Move to Deleted Items",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteTransaction(activeTx.id);
      if (type === "transaction" && activeTx.id === tx?.id) {
        handleClose();
      } else {
        setActiveTxIdx((prev) => Math.max(0, prev - 1));
        void loadData();
      }
    } catch (err: unknown) {
      await alert({ title: "Delete Failed", message: getErrorDisplayMessage(err, "Failed to delete"), variant: "danger" });
    }
  };

  const handleUnlink = async () => {
    if (!activeExpense || !activeTx) return;
    const ok = await confirm({
      title: "Remove Link",
      message: `Remove the link between this expense (${formatCurrency(activeExpense.amount)}) and transaction (${formatCurrency(activeTx.amount)})?`,
      confirmText: "Remove Link",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await unlinkExpenseFromTransaction(activeExpense.id, activeTx.id);
      void loadData();
    } catch (err: unknown) {
      await alert({ title: "Unlink Failed", message: getErrorDisplayMessage(err, "Failed to unlink"), variant: "danger" });
    }
  };

  const executeCreateAndLink = async (
    payload: CreateAndLinkPayload,
    overrideChartAccountId?: number,
    force = false
  ) => {
    try {
      let amt = Number(payload.amount);
      if (!amt || isNaN(amt) || amt === 0) {
        await alert({ title: "Invalid Amount", message: "Please enter a valid amount." });
        return;
      }
      const dateField = type === "receipt" ? payload.date : payload.timestamp;
      if (!dateField) {
        await alert({ title: "Missing Date", message: "Please select a date." });
        return;
      }
      const todayStr = new Date().toISOString().split("T")[0];
      if (dateField > todayStr) {
        await alert({ title: "Invalid Date", message: "Date cannot be in the future." });
        return;
      }

      if (type === "receipt" && !payload.chartAccountId) {
        await alert({ title: "Missing Bank Account", message: "Please select a bank or credit card account." });
        return;
      }

      if (type === "transaction" && !payload.chartAccountId) {
        await alert({ title: "Missing Category", message: "Please select an expense category." });
        return;
      }

      const normalizedPayload: CreateAndLinkPayload = { ...payload };
      if (type === "receipt" && normalizedPayload.transactionType) {
        const out = normalizedPayload.transactionType === "DEBIT" || normalizedPayload.transactionType === "PAYMENT";
        if (out && amt > 0) amt = -amt;
        else if (!out && amt < 0) amt = Math.abs(amt);
        normalizedPayload.amount = amt;
      }

      if (normalizedPayload.chartAccountId) normalizedPayload.chartAccountId = Number(normalizedPayload.chartAccountId);
      if (normalizedPayload.categoryAccountId) normalizedPayload.categoryAccountId = Number(normalizedPayload.categoryAccountId);

      const fullPayload: CreateAndLinkInput = {
        ...normalizedPayload,
        type: type === "transaction" ? "transaction" : "receipt",
        targetId: Number(id),
        ...(overrideChartAccountId !== undefined ? { overrideChartAccountId } : {}),
        ...(force ? { force: true } : {}),
      };
      await createAndLink(fullPayload);
      setConflictModalData(null);
      setOverAllocatedModalData(null);
      setShowCreateModal(false);
      void loadData();
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to create and link");
      if (parsed.data?.error === "CATEGORY_MISMATCH" && parsed.data.transactionCategory && parsed.data.expenseCategory) {
        setConflictModalData({
          isCreateMode: true,
          createPayload: payload,
          txCategory: parsed.data.transactionCategory,
          expCategory: parsed.data.expenseCategory,
        });
      } else if (parsed.data?.error === "OVER_ALLOCATED") {
        setOverAllocatedModalData({
          isCreateMode: true,
          createPayload: payload,
          overrideChartAccountId,
          message: parsed.data.message || parsed.message,
        });
      } else {
        await alert({ title: "Create and Link Failed", message: parsed.message, variant: "danger" });
      }
    }
  };

  const handleMatchInvoicePayment = async (invId: number, txId: number) => {
    setIsMatchingInvoice(true);
    try {
      await matchInvoicePayment(invId, txId);
      await loadData();
      await alert({
        title: "Invoice Paid & Linked",
        message: "Successfully matched bank deposit to invoice. Invoice status set to PAID.",
      });
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to match payment");
      await alert({ title: "Match Failed", message: parsed.message, variant: "danger" });
    } finally {
      setIsMatchingInvoice(false);
    }
  };

  const handleUnmatchInvoicePayment = async (
    invId: number,
    linkedTxInfo?: BankTransaction | null,
    invNumber?: string
  ) => {
    const txDesc = linkedTxInfo
      ? `"${linkedTxInfo.description}" (${formatCurrency(linkedTxInfo.amount)} on ${formatDate(linkedTxInfo.date)})`
      : "its linked payment record";
    const invLabel = invNumber || `INV-${invId}`;
    const ok = await confirm({
      title: "Unlink Payment",
      message: `Unlink ${txDesc} from invoice ${invLabel}? The invoice will return to SENT status.`,
      confirmText: "Unlink Payment",
      variant: "danger",
    });
    if (!ok) return;

    setIsMatchingInvoice(true);
    try {
      await unmatchInvoicePayment(invId);
      await loadData();
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to unlink payment");
      await alert({ title: "Unlink Failed", message: parsed.message, variant: "danger" });
    } finally {
      setIsMatchingInvoice(false);
    }
  };

  const handleMarkInvoicePaidCash = async (invId: number) => {
    setIsRecordingCashPay(true);
    try {
      const res = await markInvoicePaidCash(invId, {
        paidDate: cashPayDate,
        notes: cashPayNotes.trim() || undefined,
      });
      setShowCashPayPanel(false);
      setCashPayNotes("");
      await loadData();
      await alert({
        title: "Marked Paid in Cash",
        message: res.message || "Invoice marked paid in cash and recorded to Cash on Hand (1030).",
      });
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to record cash payment");
      await alert({ title: "Cash Payment Failed", message: parsed.message, variant: "danger" });
    } finally {
      setIsRecordingCashPay(false);
    }
  };

  const handleDeleteInvoiceRecord = async (inv: Invoice) => {
    const ok = await confirm({
      title: "Delete Invoice",
      message: `Delete invoice ${inv.invoiceNumber || `INV-${inv.id}`} for ${inv.clientName}?\n\nIt will be moved to Deleted Items for 30 days before permanent deletion. You can restore it anytime from the sidebar.`,
      confirmText: "Delete Invoice",
      variant: "danger",
    });
    if (!ok) return;

    try {
      await deleteInvoice(inv.id);
      handleClose();
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to delete invoice");
      await alert({ title: "Delete Failed", message: parsed.message, variant: "danger" });
    }
  };

  const handleUnlinkExpenseInvoice = async (expId: number, invNumber?: string) => {
    const ok = await confirm({
      title: "Unlink Invoice",
      message: `Remove the association between this expense and invoice ${invNumber || ""}?`,
      confirmText: "Unlink",
      variant: "danger",
    });
    if (!ok) return;

    setIsLinkingInvoice(true);
    try {
      await unlinkExpenseFromInvoice(expId);
      await loadData(false);
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to unlink invoice");
      await alert({ title: "Unlink Failed", message: parsed.message, variant: "danger" });
    } finally {
      setIsLinkingInvoice(false);
    }
  };

  const handleLink = async () => {
    if (selectedLinkId === null) return;
    if (linkTargetMode === "invoice") {
      if (type === "transaction" && tx) {
        await handleMatchInvoicePayment(selectedLinkId, tx.id);
        setShowLinkPanel(false);
        setSelectedLinkId(null);
      } else if (type === "receipt" && activeExpense) {
        setIsLinkingInvoice(true);
        try {
          await linkExpenseToInvoice(activeExpense.id, selectedLinkId);
          setShowLinkPanel(false);
          setSelectedLinkId(null);
          await loadData(false);
        } catch (err: unknown) {
          const parsed = parseApiError(err, "Failed to link expense to invoice");
          await alert({ title: "Link Failed", message: parsed.message, variant: "danger" });
        } finally {
          setIsLinkingInvoice(false);
        }
      }
      return;
    }

    const isAlreadyLinked = type === "transaction" ? expensesList.length > 0 : transactionsList.length > 0;
    if (isAlreadyLinked) {
      setReplaceOrAddModalData({ selectedLinkId, isCreateMode: false });
      return;
    }
    if (type === "transaction" && tx) await executeLink(selectedLinkId, tx.id);
    else if (expense) await executeLink(expense.id, selectedLinkId);
  };

  const handleCardAction = (
    action: "EXCLUDE" | "IGNORE",
    targetType: ActionTarget["type"],
    targetId: number
  ) => {
    const isLinked =
      (type === "transaction" && expensesList.length > 0) ||
      (type === "receipt" && transactionsList.length > 0) ||
      (type === "invoice" &&
        Boolean(invoice?.bankTransactionId || (invoice?.linkedExpenses && invoice.linkedExpenses.length > 0)));
    if (!isLinked) {
      if (action === "EXCLUDE") setExcludeTarget({ type: targetType, id: targetId });
      else setIgnoreTarget({ type: targetType, id: targetId });
      return;
    }
    setActionChoiceModal({ action, targetType, targetId });
  };

  const handleCreate = async () => {
    setIsSaving(true);
    try {
      if (type === "transaction" && tx) {
        const payload: CreateAndLinkPayload = {
          ...createForm,
          type: "transaction",
          targetId: tx.id,
          amount: Number(createForm.amount),
          timestamp: createForm.timestamp ? new Date(createForm.timestamp).toISOString() : undefined,
          date: createForm.date ? new Date(createForm.date).toISOString() : undefined,
          chartAccountId: createForm.chartAccountId ? Number(createForm.chartAccountId) : undefined,
        };

        if (expensesList.length > 0) {
          setReplaceOrAddModalData({ createPayload: payload, isCreateMode: true });
          return;
        }
        await executeCreateAndLink(payload);
      } else if (type === "receipt" && expense) {
        if (!canAddMoreTransactions) {
          await alert({
            title: "Cannot Link Transaction",
            message: "This expense has multiple receipt files and is already linked to a transaction.",
          });
          return;
        }
        const payload: CreateAndLinkPayload = {
          ...createForm,
          type: "receipt",
          targetId: expense.id,
          amount: Number(createForm.amount),
          date: createForm.date ? new Date(createForm.date).toISOString() : undefined,
          timestamp: createForm.timestamp ? new Date(createForm.timestamp).toISOString() : undefined,
          chartAccountId: createForm.chartAccountId ? Number(createForm.chartAccountId) : undefined,
          categoryAccountId: createForm.categoryAccountId ? Number(createForm.categoryAccountId) : undefined,
        };

        if (transactionsList.length > 0) {
          setReplaceOrAddModalData({ createPayload: payload, isCreateMode: true });
          return;
        }
        await executeCreateAndLink(payload);
      }
      setCreateForm({});
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmIgnore = async (target: ActionTarget) => {
    setIsSaving(true);
    try {
      if (target.linkedChoice === "ONLY_THIS") {
        if (target.type === "transaction") {
          for (const e of confirmedExpenses) await unlinkExpenseFromTransaction(e.id, target.id);
          await resolveReviewItems("ignore_warnings", [target.id], []);
        } else if (target.type === "expense") {
          for (const t of confirmedTransactions) await unlinkExpenseFromTransaction(target.id, t.id);
          await resolveReviewItems("ignore_warnings", [], [target.id]);
        } else if (target.type === "invoice") {
          await resolveReviewItems("ignore_warnings", [], [], [target.id]);
        }
      } else if (target.linkedChoice === "ALL_LINKED") {
        const tIds = type === "transaction" && tx ? [tx.id] : confirmedTransactions.map((t) => t.id);
        const eIds = type === "receipt" && expense ? [expense.id] : confirmedExpenses.map((e) => e.id);
        const iIds = type === "invoice" && invoice ? [invoice.id] : [];
        if (iIds.length > 0) {
          await resolveReviewItems("ignore_warnings", tIds, eIds, iIds);
        } else {
          await resolveReviewItems("ignore_warnings", tIds, eIds);
        }
      } else {
        if (target.type === "transaction") await resolveReviewItems("ignore_warnings", [target.id], []);
        else if (target.type === "expense") await resolveReviewItems("ignore_warnings", [], [target.id]);
        else if (target.type === "invoice") await resolveReviewItems("ignore_warnings", [], [], [target.id]);
      }
      setIgnoreTarget(null);
      await loadData();
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to ignore warnings");
      await alert({ title: "Ignore Failed", message: `Failed to ignore: ${parsed.message}`, variant: "danger" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectActionChoice = (choice: "ONLY_THIS" | "ALL_LINKED", data: ActionChoiceState) => {
    setActionChoiceModal(null);
    if (data.action === "EXCLUDE") {
      setExcludeTarget({ type: data.targetType, id: data.targetId, linkedChoice: choice });
    } else {
      setIgnoreTarget({ type: data.targetType, id: data.targetId, linkedChoice: choice });
    }
  };

  const handleResolveConflict = (chosenCategoryId: number, data: ConflictModalState) => {
    if (data.isCreateMode) {
      void executeCreateAndLink(data.createPayload, chosenCategoryId);
    } else {
      void executeLink(data.expenseId, data.transactionId, chosenCategoryId);
    }
  };

  const handleAddSplitLink = (data: ReplaceOrAddModalState) => {
    setReplaceOrAddModalData(null);
    if (data.isSuggested) {
      if (data.suggestedExpId && tx) void executeLink(data.suggestedExpId, tx.id);
      if (data.suggestedTxId && expense) void executeLink(expense.id, data.suggestedTxId);
    } else if (data.isCreateMode && data.createPayload) {
      void executeCreateAndLink(data.createPayload);
    } else if (data.selectedLinkId !== undefined) {
      if (type === "transaction" && tx) void executeLink(data.selectedLinkId, tx.id);
      else if (expense) void executeLink(expense.id, data.selectedLinkId);
    }
  };

  const handleReplaceLinks = async (data: ReplaceOrAddModalState) => {
    setReplaceOrAddModalData(null);
    setIsSaving(true);
    try {
      if (type === "transaction" && tx) {
        for (const e of confirmedExpenses) await unlinkExpenseFromTransaction(e.id, tx.id);
      } else if (type === "receipt" && expense) {
        for (const t of confirmedTransactions) await unlinkExpenseFromTransaction(expense.id, t.id);
      }

      if (data.isSuggested) {
        if (data.suggestedExpId && tx) await executeLink(data.suggestedExpId, tx.id);
        if (data.suggestedTxId && expense) await executeLink(expense.id, data.suggestedTxId);
      } else if (data.isCreateMode && data.createPayload) {
        await executeCreateAndLink(data.createPayload);
      } else if (data.selectedLinkId !== undefined) {
        if (type === "transaction" && tx) await executeLink(data.selectedLinkId, tx.id);
        else if (expense) await executeLink(expense.id, data.selectedLinkId);
      }
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to replace links");
      await alert({ title: "Replace Links Failed", message: `Failed to replace links: ${parsed.message}`, variant: "danger" });
    } finally {
      setIsSaving(false);
      void loadData(true);
    }
  };

  const handleConfirmOverAllocated = (data: OverAllocatedModalState) => {
    if (data.isCreateMode) {
      void executeCreateAndLink(data.createPayload, data.overrideChartAccountId, true);
    } else {
      void executeLink(data.expenseId, data.transactionId, data.overrideChartAccountId, true);
    }
  };

  const handleConfirmAllowClosed = async (target: AllowConfirmState) => {
    setIsAllowing(true);
    try {
      if (target.type === "invoice") {
        await resolveReviewItems("allow", [], [], [target.id]);
      } else {
        await resolveReviewItems(
          "allow",
          target.type === "transaction" ? [target.id] : [],
          target.type === "expense" ? [target.id] : []
        );
      }
      setAllowConfirmTarget(null);
      await loadData();
    } catch (err: unknown) {
      const parsed = parseApiError(err, "Failed to allow item");
      await alert({ title: "Allow Item Failed", message: `Failed to allow item: ${parsed.message}`, variant: "danger" });
    } finally {
      setIsAllowing(false);
    }
  };

  const itemReviewStatus =
    type === "transaction"
      ? tx?.reviewStatus
      : type === "invoice"
      ? invoice?.reviewStatus
      : expense?.reviewStatus;
  const itemAwaitingReview = itemReviewStatus === "PENDING" && isDateInClosedPeriod;

  const linkPickerNode =
    showLinkPanel && (type === "transaction" || type === "receipt") ? (
      <DetailLinkPicker
        type={type}
        tx={tx}
        activeExpense={activeExpense}
        linkTargetMode={linkTargetMode}
        onSelectMode={(mode) => {
          setLinkTargetMode(mode);
          setSelectedLinkId(null);
          setLinkPage(1);
        }}
        linkStartDate={linkStartDate}
        onLinkStartDateChange={(value) => {
          setLinkStartDate(value);
          setLinkPage(1);
        }}
        linkEndDate={linkEndDate}
        onLinkEndDateChange={(value) => {
          setLinkEndDate(value);
          setLinkPage(1);
        }}
        linkSearch={linkSearch}
        onLinkSearchChange={(value) => {
          setLinkSearch(value);
          setLinkPage(1);
        }}
        linkInvoices={linkInvoices}
        unlinkedExpenses={unlinked.expenses}
        unlinkedTransactions={unlinked.transactions}
        selectedLinkId={selectedLinkId}
        onSelectLinkId={setSelectedLinkId}
        linkPage={linkPage}
        unlinkedTotalPages={unlinkedTotalPages}
        onLinkPageChange={setLinkPage}
        isLinkingInvoice={isLinkingInvoice}
        isMatchingInvoice={isMatchingInvoice}
        onCancel={() => {
          setShowLinkPanel(false);
          setSelectedLinkId(null);
        }}
        onConfirmLink={handleLink}
      />
    ) : null;

  if (!type || !id) return null;

  return ReactDOM.createPortal(
    <>
      <div
        className={`fixed inset-0 z-[105] bg-black/60 transition-opacity duration-300 ${
          isVisible ? "opacity-100" : "opacity-0"
        } ${suspended ? "invisible pointer-events-none" : ""}`}
        onClick={handleClose}
      />
      <div
        className={`fixed inset-y-0 right-0 z-[110] w-full lg:w-[85vw] lg:max-w-5xl bg-zinc-950/90 backdrop-blur-3xl border-l border-white/10 flex flex-col shadow-2xl transform transition-transform duration-300 ease-out ${
          isVisible ? "translate-x-0" : "translate-x-full"
        } ${suspended ? "invisible pointer-events-none" : ""}`}
      >
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-white">
              {type === "invoice"
                ? `Invoice #${invoice?.invoiceNumber || id} — ${invoice?.clientName || "Client"}`
                : type === "transaction"
                ? isDeposit
                  ? "Deposit & Revenue Details"
                  : "Transaction Details"
                : "Expense Details"}
            </h2>
            {isLoading && <LoadingSpinner size="sm" color="text-emerald-400" />}
          </div>
          <Button
            variant="ghost"
            onClick={handleClose}
            aria-label="Close detail drawer"
            className="p-0! w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {hasBackgroundUpdate && (
          <div className="mx-4 sm:mx-5 mt-3 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>A background process updated this record. Your unsaved edits are preserved.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setHasBackgroundUpdate(false);
                  void loadData(false);
                }}
                className="px-2! py-0.5! bg-amber-500/20! hover:bg-amber-500/30! text-amber-300! text-xs"
              >
                Reload Record
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHasBackgroundUpdate(false)}
                className="px-2! py-0.5! text-zinc-400 hover:text-white text-xs"
              >
                Keep My Changes
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">
          {isLoading ? (
            <div className="py-24 flex flex-col items-center justify-center space-y-3">
              <LoadingSpinner size="lg" color="text-emerald-500" />
              <span className="text-xs text-zinc-400 font-medium">Loading details…</span>
            </div>
          ) : (
            <>
              {itemAwaitingReview && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 p-4 rounded-2xl text-sm">
                  <span className="font-bold block mb-1">Action Required</span>
                  This item falls in a closed accounting period and was added to the Action Required queue. The books
                  cannot be locked for this period until this item is resolved (either Allowed or Excluded).
                </div>
              )}

              {itemReviewStatus === "IGNORED" && (
                <div className="bg-purple-500/10 border border-purple-500/20 text-purple-300 p-4 rounded-2xl text-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <span className="font-bold text-purple-400 block mb-1">This item is excluded from your books</span>
                    <p className="text-zinc-300">
                      It does not affect totals or reports and cannot be linked while excluded.
                    </p>
                    {(() => {
                      const reason =
                        type === "transaction"
                          ? tx?.exclusionReason
                          : type === "invoice"
                          ? invoice?.exclusionReason
                          : expense?.exclusionReason;
                      const note =
                        type === "transaction"
                          ? tx?.exclusionNote
                          : type === "invoice"
                          ? invoice?.exclusionNote
                          : expense?.exclusionNote;
                      return (
                        <div className="mt-1 text-xs text-zinc-400">
                          {reason && (
                            <span>
                              Reason:{" "}
                              <strong className="text-zinc-200">{EXCLUSION_REASON_LABELS[reason] || reason}</strong>
                            </span>
                          )}
                          {note && <span className="italic ml-2">“{note}”</span>}
                        </div>
                      );
                    })()}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="shrink-0 touch-glow-emerald"
                    isLoading={isRestoring}
                    onClick={async () => {
                      setIsRestoring(true);
                      setRestoreError("");
                      try {
                        await restoreItem(
                          type === "invoice" ? "invoice" : type === "receipt" ? "expense" : "transaction",
                          Number(id)
                        );
                        await loadData();
                      } catch (err: unknown) {
                        const parsed = parseApiError(err, "Failed to restore item");
                        setRestoreError(parsed.message);
                      } finally {
                        setIsRestoring(false);
                      }
                    }}
                  >
                    Restore Item
                  </Button>
                </div>
              )}

              {restoreError && (
                <div role="alert" className="p-3 mb-4 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-sm">
                  {restoreError}
                </div>
              )}

              {isClosed &&
                !itemAwaitingReview &&
                itemReviewStatus !== "IGNORED" &&
                itemReviewStatus !== "WARNINGS_IGNORED" && (
                  <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 p-4 rounded-2xl text-sm mb-6">
                    <span className="font-bold block mb-1">Period Closed</span>
                    This item falls within a locked accounting period, so it can&apos;t be changed. Unlock the books
                    under Lock Books if you need to adjust it.
                  </div>
                )}

              {type === "invoice" && invoice ? (
                <DetailInvoiceView
                  invoice={invoice}
                  invoiceCandidates={invoiceCandidates}
                  isMatchingInvoice={isMatchingInvoice}
                  isLinkingInvoice={isLinkingInvoice}
                  showCashPayPanel={showCashPayPanel}
                  onToggleCashPayPanel={() => setShowCashPayPanel((prev) => !prev)}
                  cashPayDate={cashPayDate}
                  onCashPayDateChange={setCashPayDate}
                  cashPayNotes={cashPayNotes}
                  onCashPayNotesChange={setCashPayNotes}
                  isRecordingCashPay={isRecordingCashPay}
                  onMarkPaidCash={handleMarkInvoicePaidCash}
                  onMatchPayment={handleMatchInvoicePayment}
                  onUnmatchPayment={handleUnmatchInvoicePayment}
                  onUnlinkExpense={handleUnlinkExpenseInvoice}
                  onDeleteInvoice={handleDeleteInvoiceRecord}
                  onEditInvoice={onEditInvoice}
                  onPrintInvoice={onPrintInvoice}
                  isClosed={isClosed}
                  itemAwaitingReview={itemAwaitingReview}
                  isDateInClosedPeriod={isDateInClosedPeriod}
                  onRestoreInvoiceWarnings={async (invId) => {
                    await resolveReviewItems("restore_warnings", [], [], [invId]);
                    await loadData();
                  }}
                  onAllowInvoiceClosed={setAllowConfirmTarget}
                  onCardAction={handleCardAction}
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch relative">
                  <div className="hidden lg:block absolute left-1/2 top-4 bottom-4 w-px bg-zinc-800 -translate-x-1/2 z-0" />

                  {activeExpense && activeTx && !isClosed && !isEditingExpense && !isEditingTx && (
                    <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                      <Tooltip content="Unlink Pair">
                        <Button
                          onClick={handleUnlink}
                          variant="secondary"
                          aria-label="Unlink Pair"
                          className="rounded-full shadow-2xl border border-red-500/30 bg-black text-zinc-400 hover:text-red-400 hover:bg-red-500/10 p-2.5 flex flex-col items-center justify-center w-12 h-12 touch-glow-red"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M13.73 21a2 2 0 01-3.46 0m9.73-8v-3a2 2 0 00-2-2h-3m-6 0H5a2 2 0 00-2 2v3m12 0l-4 4m0 0l-4-4m4 4V10"
                            />
                          </svg>
                          <span className="text-[8px] font-bold mt-0.5 uppercase tracking-wider">Unlink</span>
                        </Button>
                      </Tooltip>
                    </div>
                  )}

                  <DetailExpenseColumn
                    type={type === "transaction" ? "transaction" : "receipt"}
                    isDeposit={isDeposit}
                    tx={tx}
                    activeTx={activeTx}
                    activeExpense={activeExpense}
                    expensesList={expensesList}
                    transactionsList={transactionsList}
                    activeExpenseIdx={activeExpenseIdx}
                    onSelectExpenseIdx={(idx) => {
                      setActiveExpenseIdx(idx);
                      setIsEditingExpense(false);
                    }}
                    accounts={accounts}
                    linkedInvoice={linkedInvoice}
                    suggestedInvoices={suggestedInvoices}
                    allOpenInvoices={allOpenInvoices}
                    selectedInvoiceToMatch={selectedInvoiceToMatch}
                    onChangeSelectedInvoiceToMatch={setSelectedInvoiceToMatch}
                    isMatchingInvoice={isMatchingInvoice}
                    isLinkingInvoice={isLinkingInvoice}
                    onMatchInvoicePayment={handleMatchInvoicePayment}
                    onUnmatchInvoicePayment={handleUnmatchInvoicePayment}
                    onUnlinkExpenseInvoice={handleUnlinkExpenseInvoice}
                    onOpenInvoices={onOpenInvoices}
                    showLinkPanel={showLinkPanel}
                    onToggleDepositLinkPanel={() => {
                      setLinkTargetMode("invoice");
                      setShowLinkPanel((p) => !p);
                      setSelectedLinkId(null);
                    }}
                    onToggleExpenseLinkPanel={() => {
                      setShowLinkPanel((p) => {
                        if (!p) setLinkTargetMode("expense");
                        return !p;
                      });
                      setSelectedLinkId(null);
                    }}
                    linkPickerNode={type === "transaction" ? linkPickerNode : null}
                    isClosed={isClosed}
                    itemAwaitingReview={itemAwaitingReview}
                    isDateInClosedPeriod={isDateInClosedPeriod}
                    isEditingExpense={isEditingExpense}
                    expenseForm={expenseForm}
                    onChangeExpenseForm={setExpenseForm}
                    onStartEditExpense={() => {
                      if (activeExpense) {
                        setExpenseForm({
                          timestamp: activeExpense.timestamp ? activeExpense.timestamp.split("T")[0] : "",
                          vendor: activeExpense.vendor,
                          description: activeExpense.description,
                          amount: activeExpense.amount,
                          taxAmount: activeExpense.taxAmount || 0,
                          currencyCode: activeExpense.currencyCode || "USD",
                          tender: activeExpense.tender,
                          notes: activeExpense.notes || "",
                          chartAccountId: activeExpense.chartAccountId || "",
                        });
                      }
                      setIsEditingExpense(true);
                    }}
                    onCancelEditExpense={() => setIsEditingExpense(false)}
                    onSaveExpense={() => void handleSaveExpense()}
                    onDeleteExpense={() => void handleDeleteExpense()}
                    onOpenSplitModal={() => setIsSplitModalOpen(true)}
                    onRestoreExpenseWarnings={async (expId) => {
                      await resolveReviewItems("restore_warnings", [], [expId]);
                      await loadData();
                    }}
                    onOpenReceiptModal={() => {
                      setShowReceiptModal(true);
                      setActiveReceiptIdx(0);
                    }}
                    fileInputRef={fileInputRef}
                    onUploadReceipt={handleUploadReceipt}
                    onOpenCreateExpenseModal={(prefill) => {
                      setCreateForm(prefill);
                      setShowCreateModal(true);
                    }}
                    onAllowExpenseClosed={setAllowConfirmTarget}
                    onCardAction={handleCardAction}
                  />

                  {activeExpense && activeTx && !isClosed && !isEditingExpense && !isEditingTx && (
                    <div className="lg:hidden flex justify-center -my-4 relative z-20">
                      <Button
                        onClick={handleUnlink}
                        variant="secondary"
                        className="rounded-full shadow-xl border border-red-500/30 bg-zinc-900 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 px-6 py-2 flex items-center justify-center gap-2 touch-glow-red"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M13.73 21a2 2 0 01-3.46 0m9.73-8v-3a2 2 0 00-2-2h-3m-6 0H5a2 2 0 00-2 2v3m12 0l-4 4m0 0l-4-4m4 4V10"
                          />
                        </svg>
                        <span className="text-xs font-bold uppercase tracking-wider">Unlink</span>
                      </Button>
                    </div>
                  )}

                  <DetailTransactionColumn
                    type={type === "transaction" ? "transaction" : "receipt"}
                    activeTx={activeTx}
                    activeExpense={activeExpense}
                    transactionsList={transactionsList}
                    expensesList={expensesList}
                    activeTxIdx={activeTxIdx}
                    activeExpenseIdx={activeExpenseIdx}
                    onSelectTxIdx={(idx) => {
                      setActiveTxIdx(idx);
                      setIsEditingTx(false);
                    }}
                    onSelectActiveExpenseIdx={setActiveExpenseIdx}
                    accounts={accounts}
                    isClosed={isClosed}
                    itemAwaitingReview={itemAwaitingReview}
                    isDateInClosedPeriod={isDateInClosedPeriod}
                    isEditingTx={isEditingTx}
                    txForm={txForm}
                    onChangeTxForm={setTxForm}
                    onStartEditTx={() => {
                      if (activeTx) {
                        setTxForm({
                          date: activeTx.date ? activeTx.date.split("T")[0] : "",
                          description: activeTx.description,
                          amount: activeTx.amount,
                          notes: activeTx.notes || "",
                          chartAccountId: activeTx.chartAccountId || "",
                          categoryAccountId: activeTx.categoryAccountId || "",
                        });
                      }
                      setIsEditingTx(true);
                    }}
                    onCancelEditTx={() => setIsEditingTx(false)}
                    onSaveTx={() => void handleSaveTx()}
                    onDeleteTx={() => void handleDeleteTx()}
                    onRestoreTxWarnings={async (txId) => {
                      await resolveReviewItems("restore_warnings", [txId], []);
                      await loadData();
                    }}
                    showSplitCategories={showSplitCategories}
                    onToggleSplitCategories={() => setShowSplitCategories((prev) => !prev)}
                    onCreateRule={onCreateRule}
                    showLinkPanel={showLinkPanel}
                    onToggleTxLinkPanel={() => {
                      const isCashExp = activeExpense?.tender?.toLowerCase() === "cash";
                      setShowLinkPanel((p) => {
                        if (!p) setLinkTargetMode(isCashExp ? "invoice" : "tx");
                        return !p;
                      });
                      setSelectedLinkId(null);
                    }}
                    canAddMoreTransactions={canAddMoreTransactions}
                    onOpenCreateTxModal={(prefill) => {
                      setCreateForm(prefill);
                      setShowCreateModal(true);
                    }}
                    linkPickerNode={type === "receipt" ? linkPickerNode : null}
                    onAllowTxClosed={setAllowConfirmTarget}
                    onCardAction={handleCardAction}
                  />
                </div>
              )}

              {((type === "transaction" && suggestedExpenseCandidates.length > 0) ||
                (type === "receipt" && suggestedTransactionCandidates.length > 0)) && (
                <div className="p-4 bg-blue-950/20 border border-blue-900/40 rounded-2xl">
                  <SuggestedMatchesList
                    title={type === "transaction" ? "Suggested Expense Matches" : "Suggested Transaction Matches"}
                    subtitleText="Review scored match candidates below and approve if correct."
                    items={
                      type === "transaction"
                        ? suggestedExpenseCandidates.map((cand) => ({
                            id: cand.expense.id,
                            score: cand.score,
                            reason: cand.reason,
                            title: cand.expense.vendor || "Unknown Vendor",
                            subtitle: `${formatDate(cand.expense.timestamp)} • ${cand.expense.chartAccount?.name || "Uncategorized"}`,
                            amountLabel: formatCurrency(cand.expense.amount),
                            actionLabel: "Approve Link",
                            onAction: () => void handleApproveSuggestedMatch("expense", cand.expense.id),
                          }))
                        : suggestedTransactionCandidates.map((cand) => ({
                            id: cand.transaction.id,
                            score: cand.score,
                            reason: cand.reason,
                            title: cand.transaction.description,
                            subtitle: `${formatDate(cand.transaction.date)} • ${cand.transaction.chartAccount?.name || cand.transaction.category?.name || "Checking"}`,
                            amountLabel: formatCurrency(cand.transaction.amount),
                            actionLabel: "Approve Link",
                            onAction: () => void handleApproveSuggestedMatch("tx", cand.transaction.id),
                          }))
                    }
                    showQuickApproveHint={
                      !isClosed &&
                      ((type === "transaction"
                        ? suggestedExpenseCandidates[0]?.score
                        : suggestedTransactionCandidates[0]?.score) ?? 0) >= 50
                    }
                    actionDisabled={isClosed}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ReceiptCanvasPane
        isOpen={showReceiptModal}
        receipts={activeExpense?.receipts || []}
        activeReceiptIdx={activeReceiptIdx}
        onChangeActiveReceiptIdx={setActiveReceiptIdx}
        zoom={receiptZoom}
        onChangeZoom={setReceiptZoom}
        rotation={receiptRotation}
        onChangeRotation={setReceiptRotation}
        isClosed={isClosed}
        isSaving={isSaving}
        onDeleteReceipt={handleDeleteReceipt}
        onClose={() => setShowReceiptModal(false)}
      />

      {excludeTarget && (
        <ExcludeItemModal
          isOpen={true}
          onClose={() => setExcludeTarget(null)}
          itemType={excludeTarget.type}
          itemId={excludeTarget.id}
          linkedChoice={excludeTarget.linkedChoice}
          onBeforeSubmit={async () => {
            if (excludeTarget.linkedChoice === "ONLY_THIS") {
              if (excludeTarget.type === "transaction") {
                for (const e of confirmedExpenses) await unlinkExpenseFromTransaction(e.id, excludeTarget.id);
              } else {
                for (const t of confirmedTransactions) await unlinkExpenseFromTransaction(excludeTarget.id, t.id);
              }
            }
          }}
          onExcluded={() => {
            setExcludeTarget(null);
            handleClose();
          }}
        />
      )}

      <DetailSubModals
        type={type}
        accounts={accounts}
        isSaving={isSaving}
        isAllowing={isAllowing}
        showCreateModal={showCreateModal}
        createForm={createForm}
        onChangeCreateForm={setCreateForm}
        onCloseCreateModal={() => setShowCreateModal(false)}
        onSubmitCreate={handleCreate}
        ignoreTarget={ignoreTarget}
        onCloseIgnoreModal={() => setIgnoreTarget(null)}
        onConfirmIgnore={handleConfirmIgnore}
        actionChoiceModal={actionChoiceModal}
        onCloseActionChoice={() => setActionChoiceModal(null)}
        onSelectActionChoice={handleSelectActionChoice}
        conflictModalData={conflictModalData}
        onCloseConflictModal={() => setConflictModalData(null)}
        onResolveConflict={handleResolveConflict}
        replaceOrAddModalData={replaceOrAddModalData}
        onCloseReplaceOrAddModal={() => setReplaceOrAddModalData(null)}
        onAddSplitLink={handleAddSplitLink}
        onReplaceLinks={handleReplaceLinks}
        overAllocatedModalData={overAllocatedModalData}
        onCloseOverAllocatedModal={() => setOverAllocatedModalData(null)}
        onConfirmOverAllocated={handleConfirmOverAllocated}
        allowConfirmTarget={allowConfirmTarget}
        onCloseAllowConfirm={() => setAllowConfirmTarget(null)}
        onConfirmAllowClosed={handleConfirmAllowClosed}
      />

      {isSplitModalOpen && activeExpense && (
        <SplitExpenseModal
          isOpen={true}
          onClose={() => setIsSplitModalOpen(false)}
          expense={activeExpense}
          accounts={accounts}
          onSplitSuccess={async () => {
            await loadData();
          }}
        />
      )}
    </>,
    document.body
  );
}
