import { useEffect, useState, useRef } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import ReactDOM from "react-dom";
import ExcludeItemModal from "./ExcludeItemModal";
import { EXCLUSION_REASON_LABELS } from "../utils/ledgerStatus";
import SplitExpenseModal from "./SplitExpenseModal";
import {
  getTransactionDetail, getExpenseDetail,
  updateTransaction, updateExpense,
  deleteTransaction, deleteExpense,
  getUnlinkedItems,
  linkExpenseToTransaction, unlinkExpenseFromTransaction,
  linkExpenseToInvoice, unlinkExpenseFromInvoice,
  createAndLink, uploadReceiptToExpense, deleteReceipt,
  getSettings, getChartAccounts, resolveReviewItems, restoreItem,
  getInvoice, deleteInvoice, matchInvoicePayment, markInvoicePaidCash, unmatchInvoicePayment, getInvoiceCandidates, getInvoices,
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
import { getGroupedAccounts } from "../utils/accountHierarchy";
import { formatDate } from "../utils/dateUtils";
import { formatCurrency } from "../utils/formatCurrency";
import { useLiveEvent } from "../utils/useLiveSync";
import { extractCleanVendor } from "../utils/vendorUtils";
import { ReceiptCanvasPane } from "./detail-drawer/ReceiptCanvasPane";
import { DetailInvoiceView } from "./detail-drawer/DetailInvoiceView";
import { DetailLinkPicker } from "./detail-drawer/DetailLinkPicker";
import { DetailSubModals } from "./detail-drawer/DetailSubModals";
import type {
  ActionChoiceState,
  ActionTarget,
  AllowConfirmState,
  ConflictModalState,
  CreateAndLinkPayload,
  CreateFormState,
  OverAllocatedModalState,
  ReplaceOrAddModalState,
} from "./detail-drawer/types";

const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "CNY", "CHF", "SGD", 
  "HKD", "NZD", "KRW", "MXN", "BRL", "ZAR", "SEK", "NOK", "DKK", "RUB"
];

const TENDERS = [
  "CARD", "CASH", "CHECK", "TRANSFER", "PAYPAL", "VENMO", "ZELLE", "OTHER"
];
import { MoneyInput } from "./ui/MoneyInput";
import { useConfirm } from "./ui/ConfirmDialog";

interface DetailDrawerProps {
  type: "transaction" | "receipt" | "invoice" | null;
  id: number | null;
  onClose: () => void;
  onCreateRule?: (data: { name: string; descriptionKeyword: string; categoryAccountId?: number | null }) => void;
  onOpenInvoices?: () => void;
  onEditInvoice?: (inv: Invoice) => void;
  onPrintInvoice?: (inv: Invoice) => void;
}

export default function DetailDrawer({ type, id, onClose, onCreateRule, onOpenInvoices, onEditInvoice, onPrintInvoice }: DetailDrawerProps) {
  const { confirm, alert } = useConfirm();
  const activeRequestId = useRef(0);
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
  const [cashPayDate, setCashPayDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [cashPayNotes, setCashPayNotes] = useState("");
  const [isRecordingCashPay, setIsRecordingCashPay] = useState(false);
  const [linkTargetMode, setLinkTargetMode] = useState<"tx" | "expense" | "invoice">("expense");
  const [linkInvoices, setLinkInvoices] = useState<Invoice[]>([]);
  const [isLinkingInvoice, setIsLinkingInvoice] = useState(false);

  const [confirmedExpenses, setConfirmedExpenses] = useState<Expense[]>([]);
  const [suggestedExpenseCandidates, setSuggestedExpenseCandidates] = useState<ScoredExpenseCandidate[]>([]);
  const [confirmedTransactions, setConfirmedTransactions] = useState<BankTransaction[]>([]);
  const [suggestedTransactionCandidates, setSuggestedTransactionCandidates] = useState<ScoredTransactionCandidate[]>([]);

  const [activeExpenseIdx, setActiveExpenseIdx] = useState(0);
  const [activeTxIdx, setActiveTxIdx] = useState(0);

  const [isEditingExpense, setIsEditingExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState<any>({});
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);

  const [isEditingTx, setIsEditingTx] = useState(false);
  const [txForm, setTxForm] = useState<any>({});

  const [unlinked, setUnlinked] = useState<{ transactions: BankTransaction[], expenses: Expense[] }>({ transactions: [], expenses: [] });
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [linkSearch, setLinkSearch] = useState("");
  const [linkStartDate, setLinkStartDate] = useState("");
  const [linkEndDate, setLinkEndDate] = useState("");
  const [linkPage, setLinkPage] = useState(1);
  const [unlinkedTotalPages, setUnlinkedTotalPages] = useState(1);
  const [showSplitCategories, setShowSplitCategories] = useState(false);
  const LINK_LIMIT = 20;

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

  const activeExpense: Expense | null = expensesList[activeExpenseIdx] || (type === "receipt" ? expense : (confirmedExpenses[0] || null));
  const activeTx: BankTransaction | null = transactionsList[activeTxIdx] || (type === "transaction" ? tx : (confirmedTransactions[0] || null));

  const isDeposit = type === "transaction" && tx && tx.amount > 0;

  const formatMoney = formatCurrency;
  const expenseReceiptCount = (activeExpense || expense)?.receipts?.length ?? 0;
  const canAddMoreTransactions = !(expenseReceiptCount > 1 && transactionsList.length >= 1);

  const handleUploadReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const targetExpenseId = activeExpense?.id || expense?.id;
    if (!targetExpenseId) return;

    const doUpload = async (allowDuplicate = false) => {
      try {
        setIsSaving(true);
        await uploadReceiptToExpense(targetExpenseId, file, allowDuplicate);
        loadData(); // reload to show new receipt
      } catch (err: any) {
        if (err.status === 409 && err.data?.existingExpense) {
          const v = err.data.existingExpense.vendor || 'Unknown Vendor';
          const a = err.data.existingExpense.amount || 0;
          const proceed = await confirm({
            title: "Duplicate Receipt Detected",
            message: `This receipt has already been uploaded previously to ${v} ($${a}). Do you want to link it to this expense as well?`,
            confirmText: "Link Receipt",
            variant: "primary"
          });
          if (proceed) {
            await doUpload(true);
          }
        } else {
          await alert({
            title: "Upload Failed",
            message: "Failed to upload receipt: " + err.message,
            variant: "danger"
          });
        }
      } finally {
        setIsSaving(false);
      }
    };

    await doUpload();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteReceipt = async (receiptId: number) => {
    const ok = await confirm({
      title: "Delete Receipt",
      message: "Are you sure? Deleting a receipt completely removes the physical file from the system and cannot be undone.",
      confirmText: "Delete Receipt",
      variant: "danger"
    });
    if (!ok) return;
    try {
      setIsSaving(true);
      await deleteReceipt(receiptId);
      loadData(); // reload
    } catch (err: any) {
      await alert({
        title: "Delete Failed",
        message: "Failed to delete receipt: " + err.message,
        variant: "danger"
      });
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (type && id) requestAnimationFrame(() => setIsVisible(true));
  }, [type, id]);

  useEffect(() => {
    if (!id || !type) return;
    loadData(true);
  }, [id, type]);

  useEffect(() => {
    setIsEditingExpense(false);
    if (activeExpense) {
      setExpenseForm({
        timestamp: activeExpense.timestamp ? activeExpense.timestamp.split('T')[0] : '',
        vendor: activeExpense.vendor,
        description: activeExpense.description,
        amount: activeExpense.amount,
        taxAmount: activeExpense.taxAmount || 0,
        currencyCode: activeExpense.currencyCode || 'USD',
        tender: activeExpense.tender,
        notes: activeExpense.notes || '',
        chartAccountId: activeExpense.chartAccountId || ''
      });
    } else {
      setExpenseForm({});
    }
  }, [activeExpense?.id]);

  useEffect(() => {
    setIsEditingTx(false);
    if (activeTx) {
      setTxForm({
        date: activeTx.date ? activeTx.date.split('T')[0] : '',
        description: activeTx.description,
        amount: activeTx.amount,
        notes: activeTx.notes || '',
        chartAccountId: activeTx.chartAccountId || '',
        categoryAccountId: activeTx.categoryAccountId || ''
      });
    } else {
      setTxForm({});
    }
  }, [activeTx?.id]);

  useEffect(() => {
    if (showLinkPanel) loadUnlinkedData();
  }, [linkSearch, linkStartDate, linkEndDate, linkPage, showLinkPanel, linkTargetMode]);

  const loadUnlinkedData = async () => {
    try {
      const rootAmount = type === "transaction" ? activeTx?.amount : activeExpense?.amount;
      const rootDate = type === "transaction" ? activeTx?.date : activeExpense?.timestamp;
      if (linkTargetMode === "invoice") {
        const res = await getInvoices({ status: "ALL", search: linkSearch || undefined });
        const absAmt = rootAmount ? Math.abs(rootAmount) : 0;
        let candidates = (res.invoices || []).filter((inv) => {
          if (inv.status === "VOID") return false;
          // For transaction deposit payment matching, only show invoices with unpaid balance & no bank tx
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
        targetDate: rootDate ? new Date(rootDate).toISOString() : undefined
      });
      setUnlinked(data);
      const totals = type === "transaction" ? data.totalExpenses : data.totalTxs;
      setUnlinkedTotalPages(Math.ceil((totals || 0) / LINK_LIMIT));
    } catch (err) {
      console.error(err);
    }
  };

  const loadData = async (resetIdx = false) => {
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
      setCashPayDate(new Date().toISOString().split('T')[0]);
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
              const openInvs = (invList.invoices || []).filter(i => i.status !== "PAID" && i.status !== "VOID" && !i.bankTransactionId);
              setAllOpenInvoices(openInvs);
            }
          } catch (invErr) {
            console.error("Failed to load open invoices for deposit matching:", invErr);
          }
        } else {
          setAllOpenInvoices([]);
        }
        
        // Find which transaction in the active expense's bank transactions matches the loaded transaction
        const activeExp = data.confirmedExpenses[0];
        if (activeExp?.bankTransactions && activeExp.bankTransactions.length > 0) {
          const matchIdx = activeExp.bankTransactions.findIndex((t: BankTransaction) => t.id === data.transaction.id);
          setActiveTxIdx(matchIdx >= 0 ? matchIdx : 0);
        } else {
          setActiveTxIdx(0);
        }
        setActiveExpenseIdx(prev => {
          const maxIdx = Math.max(0, data.confirmedExpenses.length - 1);
          return Math.min(prev, maxIdx);
        });

      } else if (type === "receipt") {
        const data = await getExpenseDetail(Number(id));
        if (reqId !== activeRequestId.current) return;
        loadedDate = data.expense.timestamp;
        loadedReview = data.expense.reviewStatus || "";
        setExpense(data.expense);
        setConfirmedTransactions(data.confirmedTransactions);
        setSuggestedTransactionCandidates(data.suggestedTransactionCandidates || []);
        setSuggestedExpenseCandidates([]);
        
        // Find which expense in the active transaction's linked expenses matches the loaded expense
        const activeTxItem = data.confirmedTransactions[0];
        if (activeTxItem?.expenses && activeTxItem.expenses.length > 0) {
          const matchIdx = activeTxItem.expenses.findIndex((e: Expense) => e.id === data.expense.id);
          setActiveExpenseIdx(matchIdx >= 0 ? matchIdx : 0);
        } else {
          setActiveExpenseIdx(0);
        }
        setActiveTxIdx(prev => {
          const maxIdx = Math.max(0, data.confirmedTransactions.length - 1);
          return Math.min(prev, maxIdx);
        });
      } else if (type === "invoice") {
        const data = await getInvoice(Number(id));
        if (reqId !== activeRequestId.current) return;
        const inv = data.invoice;
        loadedDate = inv.issueDate || inv.createdAt;
        loadedReview = "";
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
      if ((loadedReview === 'PENDING' && inClosedDate) || loadedReview === 'IGNORED') closed = true;
      setIsClosed(closed);
    } catch (err) {
      console.error(err);
    } finally {
      if (reqId === activeRequestId.current) {
        setIsLoading(false);
      }
    }
  };

  useLiveEvent(["TRANSACTIONS_UPDATED", "EXPENSES_UPDATED", "RECONCILIATION_UPDATED", "INVOICES_UPDATED"], () => {
    if (!id || !type) return;
    if (isEditingExpense || isEditingTx) {
      setHasBackgroundUpdate(true);
    } else {
      loadData(false);
    }
  });

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose(), 300);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName);
      if (e.key === "Escape") {
        const hasSubModal = showCreateModal || showReceiptModal || Boolean(excludeTarget) ||
          Boolean(ignoreTarget) || Boolean(actionChoiceModal) || Boolean(conflictModalData) ||
          Boolean(overAllocatedModalData) || Boolean(replaceOrAddModalData) || Boolean(allowConfirmTarget);
        if (!hasSubModal) {
          handleClose();
        }
        return;
      }

      if (isInputFocused || showReceiptModal) return;

      if ((e.key === "a" || e.key === "A") && !isClosed) {
        if (type === "transaction" && suggestedExpenseCandidates.length > 0 && suggestedExpenseCandidates[0].score >= 50) {
          handleApproveSuggestedMatch("expense", suggestedExpenseCandidates[0].expense.id);
        } else if (type === "receipt" && suggestedTransactionCandidates.length > 0 && suggestedTransactionCandidates[0].score >= 50) {
          handleApproveSuggestedMatch("tx", suggestedTransactionCandidates[0].transaction.id);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    showCreateModal, showReceiptModal, excludeTarget, ignoreTarget,
    actionChoiceModal, conflictModalData, overAllocatedModalData,
    replaceOrAddModalData, allowConfirmTarget, onClose,
    type, suggestedExpenseCandidates, suggestedTransactionCandidates, isClosed
  ]);

  const validateForm = async (formState: any, isTx: boolean): Promise<boolean> => {
    const amt = Number(formState.amount);
    if (!amt || isNaN(amt) || amt === 0) {
      await alert({ title: "Invalid Amount", message: "Please enter a valid amount." });
      return false;
    }
    const dateField = isTx ? formState.date : formState.timestamp;
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
      const isValid = await validateForm(expenseForm, false);
      if (!isValid) return;

      const categoryChanged = String(activeExpense.chartAccountId || '') !== String(expenseForm.chartAccountId || '');
      await updateExpense(activeExpense.id, {
        timestamp: expenseForm.timestamp ? new Date(expenseForm.timestamp).toISOString() : undefined,
        vendor: expenseForm.vendor,
        description: expenseForm.description,
        amount: Number(expenseForm.amount),
        taxAmount: Number(expenseForm.taxAmount),
        currencyCode: expenseForm.currencyCode,
        tender: expenseForm.tender,
        notes: expenseForm.notes,
        chartAccountId: expenseForm.chartAccountId ? Number(expenseForm.chartAccountId) : (null as any),
      });

      if (categoryChanged && transactionsList.length > 0) {
        await alert({
          title: "Category Synced",
          message: "The category has been synced across all linked items."
        });
      }

      setIsEditingExpense(false);
      loadData();
    } catch (err: any) {
      await alert({ title: "Save Failed", message: err.data?.error || err.message || "Failed to save", variant: "danger" });
    }
  };

  const handleSaveTx = async () => {
    if (!activeTx) return;
    try {
      const isValid = await validateForm(txForm, true);
      if (!isValid) return;

      const categoryChanged = String(activeTx.categoryAccountId || '') !== String(txForm.categoryAccountId || '');
      await updateTransaction(activeTx.id, {
        date: txForm.date ? new Date(txForm.date).toISOString() : undefined,
        description: txForm.description,
        amount: Number(txForm.amount),
        notes: txForm.notes,
        chartAccountId: txForm.chartAccountId ? Number(txForm.chartAccountId) : undefined,
        categoryAccountId: txForm.categoryAccountId ? Number(txForm.categoryAccountId) : (null as any),
      });

      if (categoryChanged && expensesList.length === 1) {
        await alert({
          title: "Category Synced",
          message: "The category has been synced across all linked items."
        });
      }

      setIsEditingTx(false);
      loadData();
    } catch (err: any) {
      await alert({ title: "Save Failed", message: err.data?.error || err.message || "Failed to save", variant: "danger" });
    }
  };

  const handleDeleteExpense = async () => {
    if (!activeExpense) return;
    const ok = await confirm({
      title: "Move Expense to Deleted Items",
      message: "Move this expense to Deleted Items?\n\nIt will be unlinked, removed from your books, and kept in Deleted Items for 30 days before permanent deletion. You can restore it anytime from the sidebar.",
      confirmText: "Move to Deleted Items",
      variant: "danger"
    });
    if (!ok) return;
    try {
      await deleteExpense(activeExpense.id);
      if (type === "receipt" && activeExpense.id === expense?.id) {
        handleClose();
      } else {
        setActiveExpenseIdx(prev => Math.max(0, prev - 1));
        loadData();
      }
    } catch (err: any) {
      await alert({ title: "Delete Failed", message: err.data?.error || err.message || "Failed to delete", variant: "danger" });
    }
  };

  const handleDeleteTx = async () => {
    if (!activeTx) return;
    const ok = await confirm({
      title: "Move Transaction to Deleted Items",
      message: "Move this transaction to Deleted Items?\n\nIt will be unlinked, removed from your books, and kept in Deleted Items for 30 days before permanent deletion. You can restore it anytime from the sidebar.",
      confirmText: "Move to Deleted Items",
      variant: "danger"
    });
    if (!ok) return;
    try {
      await deleteTransaction(activeTx.id);
      if (type === "transaction" && activeTx.id === tx?.id) {
        handleClose();
      } else {
        setActiveTxIdx(prev => Math.max(0, prev - 1));
        loadData();
      }
    } catch (err: any) {
      await alert({ title: "Delete Failed", message: err.data?.error || err.message || "Failed to delete", variant: "danger" });
    }
  };

  const handleUnlink = async () => {
    if (!activeExpense || !activeTx) return;
    const ok = await confirm({
      title: "Remove Link",
      message: `Remove the link between this expense (${formatMoney(activeExpense.amount)}) and transaction (${formatMoney(activeTx.amount)})?`,
      confirmText: "Remove Link",
      variant: "danger"
    });
    if (!ok) return;
    try {
      await unlinkExpenseFromTransaction(activeExpense.id, activeTx.id);
      loadData();
    } catch (err: any) {
      await alert({ title: "Unlink Failed", message: err.data?.error || err.message || "Failed to unlink", variant: "danger" });
    }
  };

  const executeLink = async (expId: number, txId: number, overrideChartAccountId?: number, force: boolean = false) => {
    try {
      await linkExpenseToTransaction(expId, txId, overrideChartAccountId, force);
      setSelectedLinkId(null);
      setShowLinkPanel(false);
      setConflictModalData(null);
      setOverAllocatedModalData(null);
      loadData();
    } catch (err: any) {
      if (err.data?.error === "CATEGORY_MISMATCH") {
        setConflictModalData({
          expenseId: expId,
          transactionId: txId,
          txCategory: err.data.transactionCategory,
          expCategory: err.data.expenseCategory
        });
      } else if (err.data?.error === "OVER_ALLOCATED") {
        setOverAllocatedModalData({
          expenseId: expId,
          transactionId: txId,
          overrideChartAccountId,
          message: err.data.message || err.message
        });
      } else {
        await alert({ title: "Link Failed", message: err.message || "Failed to link", variant: "danger" });
      }
    }
  };

  const executeCreateAndLink = async (payload: CreateAndLinkPayload, overrideChartAccountId?: number, force: boolean = false) => {
    try {
      // Client-side validation
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
      const todayStr = new Date().toISOString().split('T')[0];
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
      // Enforce correct sign for transactions
      if (type === "receipt" && normalizedPayload.transactionType) {
        const out = normalizedPayload.transactionType === 'DEBIT' || normalizedPayload.transactionType === 'PAYMENT';
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
      loadData();
    } catch (err: any) {
      if (err.data?.error === "CATEGORY_MISMATCH") {
        setConflictModalData({
          isCreateMode: true,
          createPayload: payload,
          txCategory: err.data.transactionCategory,
          expCategory: err.data.expenseCategory
        });
      } else if (err.data?.error === "OVER_ALLOCATED") {
        setOverAllocatedModalData({
          isCreateMode: true,
          createPayload: payload,
          overrideChartAccountId,
          message: err.data.message || err.message
        });
      } else {
        await alert({ title: "Create and Link Failed", message: err.message || "Failed to create and link", variant: "danger" });
      }
    }
  };

  const handleMatchInvoicePayment = async (invId: number, txId: number) => {
    setIsMatchingInvoice(true);
    try {
      await matchInvoicePayment(invId, txId);
      await loadData();
      await alert({ title: "Invoice Paid & Linked", message: "Successfully matched bank deposit to invoice. Invoice status set to PAID." });
    } catch (err: any) {
      await alert({ title: "Match Failed", message: err.message || "Failed to match payment", variant: "danger" });
    } finally {
      setIsMatchingInvoice(false);
    }
  };

  const handleUnmatchInvoicePayment = async (invId: number, linkedTxInfo?: BankTransaction | null, invNumber?: string) => {
    const txDesc = linkedTxInfo
      ? `"${linkedTxInfo.description}" (${formatMoney(linkedTxInfo.amount)} on ${formatDate(linkedTxInfo.date)})`
      : "its linked payment record";
    const invLabel = invNumber || `INV-${invId}`;
    const ok = await confirm({
      title: "Unlink Payment",
      message: `Unlink ${txDesc} from invoice ${invLabel}? The invoice will return to SENT status.`,
      confirmText: "Unlink Payment",
      variant: "danger"
    });
    if (!ok) return;

    setIsMatchingInvoice(true);
    try {
      await unmatchInvoicePayment(invId);
      await loadData();
    } catch (err: any) {
      await alert({ title: "Unlink Failed", message: err.message || "Failed to unlink payment", variant: "danger" });
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
    } catch (err: any) {
      await alert({ title: "Cash Payment Failed", message: err.message || "Failed to record cash payment", variant: "danger" });
    } finally {
      setIsRecordingCashPay(false);
    }
  };

  const handleDeleteInvoiceRecord = async (inv: Invoice) => {
    const ok = await confirm({
      title: "Delete Invoice",
      message: `Delete invoice ${inv.invoiceNumber || `INV-${inv.id}`} for ${inv.clientName}?`,
      confirmText: "Delete Invoice",
      variant: "danger"
    });
    if (!ok) return;

    try {
      await deleteInvoice(inv.id);
      handleClose();
    } catch (err: any) {
      await alert({ title: "Delete Failed", message: err.message || "Failed to delete invoice", variant: "danger" });
    }
  };

  const handleUnlinkExpenseInvoice = async (expId: number, invNumber?: string) => {
    const ok = await confirm({
      title: "Unlink Invoice",
      message: `Remove the association between this expense and invoice ${invNumber || ""}?`,
      confirmText: "Unlink",
      variant: "danger"
    });
    if (!ok) return;

    setIsLinkingInvoice(true);
    try {
      await unlinkExpenseFromInvoice(expId);
      await loadData(false);
    } catch (err: any) {
      await alert({ title: "Unlink Failed", message: err.message || "Failed to unlink invoice", variant: "danger" });
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
        } catch (err: any) {
          await alert({ title: "Link Failed", message: err.message || "Failed to link expense to invoice", variant: "danger" });
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

  const handleCardAction = async (action: "EXCLUDE" | "IGNORE", targetType: "transaction" | "expense", targetId: number) => {
    const isLinked = (type === "transaction" && expensesList.length > 0) || (type === "receipt" && transactionsList.length > 0);
    if (!isLinked) {
      if (action === "EXCLUDE") setExcludeTarget({ type: targetType, id: targetId });
      else setIgnoreTarget({ type: targetType, id: targetId });
      return;
    }
    setActionChoiceModal({ action, targetType, targetId });
  };

  const handleApproveSuggestedMatch = async (candidateKind: "expense" | "tx", candidateId: number) => {
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
            message: "This expense has multiple receipt files and is already linked to a transaction."
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
        } else {
          for (const t of confirmedTransactions) await unlinkExpenseFromTransaction(target.id, t.id);
          await resolveReviewItems("ignore_warnings", [], [target.id]);
        }
      } else if (target.linkedChoice === "ALL_LINKED") {
        const tIds = type === "transaction" && tx ? [tx.id] : confirmedTransactions.map((t) => t.id);
        const eIds = type === "receipt" && expense ? [expense.id] : confirmedExpenses.map((e) => e.id);
        await resolveReviewItems("ignore_warnings", tIds, eIds);
      } else {
        if (target.type === "transaction") await resolveReviewItems("ignore_warnings", [target.id], []);
        else await resolveReviewItems("ignore_warnings", [], [target.id]);
      }
      setIgnoreTarget(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to ignore warnings";
      await alert({ title: "Ignore Failed", message: `Failed to ignore: ${msg}`, variant: "danger" });
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
      const msg = err instanceof Error ? err.message : "Failed to replace links";
      await alert({ title: "Replace Links Failed", message: `Failed to replace links: ${msg}`, variant: "danger" });
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
      await resolveReviewItems(
        "allow",
        target.type === "transaction" ? [target.id] : [],
        target.type === "expense" ? [target.id] : []
      );
      setAllowConfirmTarget(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to allow item";
      await alert({ title: "Allow Item Failed", message: `Failed to allow item: ${msg}`, variant: "danger" });
    } finally {
      setIsAllowing(false);
    }
  };

  const renderTransactionPagination = () => {
    const total = transactionsList.length;
    if (total <= 1) return null;

    const goToPrev = () => {
      setActiveTxIdx(prev => Math.max(0, prev - 1));
      setIsEditingTx(false);
    };

    const goToNext = () => {
      setActiveTxIdx(prev => Math.min(total - 1, prev + 1));
      setIsEditingTx(false);
    };

    return (
      <div className="flex items-center justify-center gap-2 mb-4 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={goToPrev}
          disabled={activeTxIdx === 0}
          className="p-0! w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:text-white text-base disabled:opacity-30 transition cursor-pointer shrink-0"
          title="Previous Transaction"
        >
          ‹
        </Button>
        <span className="text-xs text-zinc-400 font-medium px-1">
          {activeTxIdx + 1} / {total}
        </span>
        <div className="flex items-center gap-1.5 px-1">
          {transactionsList.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setActiveTxIdx(i); setIsEditingTx(false); }}
              className={`p-1 cursor-pointer`}
              title={`Transaction ${i + 1}`}
            >
              <span className={`block w-2.5 h-2.5 rounded-full transition-all ${
                i === activeTxIdx ? 'bg-blue-400 scale-125' : 'bg-zinc-600 hover:bg-zinc-400'
              }`} />
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={goToNext}
          disabled={activeTxIdx === total - 1}
          className="p-0! w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:text-white text-base disabled:opacity-30 transition cursor-pointer shrink-0"
          title="Next Transaction"
        >
          ›
        </Button>
      </div>
    );
  };

  const renderExpensePagination = () => {
    const total = expensesList.length;
    if (total <= 1) return null;

    const goToPrev = () => {
      setActiveExpenseIdx(prev => Math.max(0, prev - 1));
      setIsEditingExpense(false);
    };

    const goToNext = () => {
      setActiveExpenseIdx(prev => Math.min(total - 1, prev + 1));
      setIsEditingExpense(false);
    };

    return (
      <div className="flex items-center justify-center gap-2 mb-4 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={goToPrev}
          disabled={activeExpenseIdx === 0}
          className="p-0! w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:text-white text-base disabled:opacity-30 transition cursor-pointer shrink-0"
          title="Previous Expense"
        >
          ‹
        </Button>
        <span className="text-xs text-zinc-400 font-medium px-1">
          {activeExpenseIdx + 1} / {total}
        </span>
        <div className="flex items-center gap-1.5 px-1">
          {expensesList.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setActiveExpenseIdx(i); setIsEditingExpense(false); }}
              className={`p-1 cursor-pointer`}
              title={`Expense ${i + 1}`}
            >
              <span className={`block w-2.5 h-2.5 rounded-full transition-all ${
                i === activeExpenseIdx ? 'bg-emerald-400 scale-125' : 'bg-zinc-600 hover:bg-zinc-400'
              }`} />
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={goToNext}
          disabled={activeExpenseIdx === total - 1}
          className="p-0! w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:text-white text-base disabled:opacity-30 transition cursor-pointer shrink-0"
          title="Next Expense"
        >
          ›
        </Button>
      </div>
    );
  };

  const inputCls = "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors";
  const labelCls = "block text-[11px] font-medium text-zinc-400 mb-0.5 uppercase tracking-wider";
  const btnSmGray = "text-xs text-zinc-400 hover:text-zinc-200 transition";
  const btnSmBlue = "text-xs text-blue-400 hover:text-blue-300 transition";
  const btnSmGreen = "text-xs text-emerald-400 hover:text-emerald-300 transition";

  const itemReviewStatus = type === "transaction" ? tx?.reviewStatus : expense?.reviewStatus;
  const itemAwaitingReview = itemReviewStatus === 'PENDING' && isDateInClosedPeriod;

  const renderLinkPicker = () => {
    if (!showLinkPanel || (type !== "transaction" && type !== "receipt")) return null;
    return (
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
    );
  };

  if (!type || !id) return null;

  return ReactDOM.createPortal(
    <>
      <div className={`fixed inset-0 z-60 bg-black/60 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`} onClick={handleClose} />
      <div className={`fixed inset-y-0 right-0 z-70 w-full lg:w-[85vw] lg:max-w-5xl bg-zinc-950/90 backdrop-blur-3xl border-l border-white/10 flex flex-col shadow-2xl transform transition-transform duration-300 ease-out ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-white">
              {type === "invoice"
                ? `Invoice #${invoice?.invoiceNumber || id} — ${invoice?.clientName || 'Client'}`
                : type === "transaction"
                ? (isDeposit ? "Deposit & Revenue Details" : "Transaction Details")
                : "Expense Details"}
            </h2>
            {isLoading && (
              <LoadingSpinner size="sm" color="text-emerald-400" />
            )}
          </div>
          <Button variant="ghost" onClick={handleClose} className="p-0! w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </Button>
        </div>

        {hasBackgroundUpdate && (
          <div className="mx-4 sm:mx-5 mt-3 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>A background process updated this record. Your unsaved edits are preserved.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button 
                type="button" 
                onClick={() => { setHasBackgroundUpdate(false); loadData(false); }} 
                className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded font-semibold transition cursor-pointer text-xs"
              >
                Reload Record
              </button>
              <button 
                type="button" 
                onClick={() => setHasBackgroundUpdate(false)} 
                className="px-2 py-0.5 text-zinc-400 hover:text-white transition cursor-pointer text-xs"
              >
                Keep My Changes
              </button>
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
                  This item falls in a closed accounting period and was added to the Action Required queue. The books cannot be locked for this period until this item is resolved (either Allowed or Excluded).
                </div>
              )}
              {itemReviewStatus === 'IGNORED' && (
                <div className="bg-purple-500/10 border border-purple-500/20 text-purple-300 p-4 rounded-2xl text-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <span className="font-bold text-purple-400 block mb-1">This item is excluded from your books</span>
                    <p className="text-zinc-300">It does not affect totals or reports and cannot be linked while excluded.</p>
                    {(() => {
                      const reason = type === "transaction" ? tx?.exclusionReason : expense?.exclusionReason;
                      const note = type === "transaction" ? tx?.exclusionNote : expense?.exclusionNote;
                      return (
                        <div className="mt-1 text-xs text-zinc-400">
                          {reason && <span>Reason: <strong className="text-zinc-200">{EXCLUSION_REASON_LABELS[reason] || reason}</strong></span>}
                          {note && <span className="italic ml-2">“{note}”</span>}
                        </div>
                      );
                    })()}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="shrink-0"
                    isLoading={isRestoring}
                    onClick={async () => {
                      setIsRestoring(true);
                      setRestoreError("");
                      try {
                        await restoreItem(type === "receipt" ? "expense" : "transaction", Number(id));
                        await loadData();
                      } catch (err: any) {
                        setRestoreError(err.message || "Failed to restore item");
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
                <div className="p-3 mb-4 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-sm">
                  {restoreError}
                </div>
              )}
              {isClosed && !itemAwaitingReview && itemReviewStatus !== 'IGNORED' && itemReviewStatus !== 'WARNINGS_IGNORED' && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 p-4 rounded-2xl text-sm mb-6">
                  <span className="font-bold block mb-1">Period Closed</span>
                  This item falls within a locked accounting period, so it can't be changed. Unlock the books under Lock Books if you need to adjust it.
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
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch relative">
                
                {/* DIVIDER LINE */}
                <div className="hidden lg:block absolute left-1/2 top-4 bottom-4 w-px bg-zinc-800 -translate-x-1/2 z-0" />

                {/* UNLINK MIDDLE BUTTON */}
                {activeExpense && activeTx && !isClosed && !isEditingExpense && !isEditingTx && (
                  <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                    <Button 
                       onClick={handleUnlink} 
                       variant="secondary" 
                       className="rounded-full shadow-2xl border border-red-500/30 bg-black text-zinc-400 hover:text-red-400 hover:bg-red-500/10 p-2.5 flex flex-col items-center justify-center w-12 h-12 transition-colors cursor-pointer" 
                       title="Unlink Pair"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.73 21a2 2 0 01-3.46 0m9.73-8v-3a2 2 0 00-2-2h-3m-6 0H5a2 2 0 00-2 2v3m12 0l-4 4m0 0l-4-4m4 4V10" /></svg>
                      <span className="text-[8px] font-bold mt-0.5 uppercase tracking-wider">Unlink</span>
                    </Button>
                  </div>
                )}

                {/* EXPENSE COLUMN */}
                <div className={`bg-white/2 border border-white/5 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-lg flex flex-col relative z-10 transition-colors duration-200 ${
                  isEditingExpense ? 'ring-1 ring-emerald-500/20' : ''
                }`}>
                  {isDeposit ? (
                    <div className="flex flex-col h-full space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-white/5">
                        <div className="flex items-center gap-2">
                          <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                          <h3 className="text-sm font-bold text-white tracking-tight">Client Invoice Relationship</h3>
                        </div>
                        {linkedInvoice && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                            PAID & MATCHED
                          </span>
                        )}
                      </div>

                      {linkedInvoice ? (
                        <div className="bg-zinc-900/80 border border-emerald-500/30 rounded-xl p-4 space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="text-xs font-mono font-bold text-emerald-400">{linkedInvoice.invoiceNumber || `INV-${linkedInvoice.id}`}</div>
                              <div className="text-base font-bold text-white mt-0.5">{linkedInvoice.clientName}</div>
                              {linkedInvoice.clientEmail && <div className="text-xs text-zinc-400">{linkedInvoice.clientEmail}</div>}
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-zinc-400">Total Billed</div>
                              <div className="text-base font-bold text-white">{formatMoney(linkedInvoice.totalAmount)}</div>
                              <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">Paid in Full</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-white/5">
                            <div>
                              <span className="text-zinc-400 block text-[11px]">Issue Date</span>
                              <span className="text-zinc-300 font-medium">{formatDate(linkedInvoice.issueDate)}</span>
                            </div>
                            <div>
                              <span className="text-zinc-400 block text-[11px]">Due Date</span>
                              <span className="text-zinc-300 font-medium">{formatDate(linkedInvoice.dueDate)}</span>
                            </div>
                          </div>

                          {!isClosed && (
                            <div className="pt-2 flex justify-end">
                              <Button
                                variant="danger"
                                size="sm"
                                isLoading={isMatchingInvoice}
                                onClick={() => handleUnmatchInvoicePayment(linkedInvoice.id, tx, linkedInvoice.invoiceNumber)}
                                className="text-xs"
                              >
                                Unlink Payment
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4 flex-1 flex flex-col">
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            This deposit can be matched to an outstanding client invoice, or categorized directly to a Revenue account in the right panel.
                          </p>

                          <SuggestedMatchesList
                            title="Suggested Invoice Matches"
                            accent="indigo"
                            isActionLoading={isMatchingInvoice}
                            items={suggestedInvoices.map((sug) => ({
                              id: sug.id,
                              eyebrow: sug.invoiceNumber || `INV-${sug.id}`,
                              title: sug.clientName,
                              subtitle: `Due: ${formatDate(sug.dueDate)} • ${
                                sug.balanceDue !== undefined && sug.balanceDue < sug.totalAmount
                                  ? `Balance: ${formatMoney(sug.balanceDue)} (Total ${formatMoney(sug.totalAmount)})`
                                  : formatMoney(sug.totalAmount)
                              }`,
                              actionLabel: "Match & Mark Paid",
                              onAction: () => tx && handleMatchInvoicePayment(sug.id, tx.id),
                            }))}
                          />

                          {allOpenInvoices.length > 0 && (
                            <div className="p-3.5 bg-zinc-900/40 border border-white/5 rounded-xl space-y-2 min-w-0">
                              <label className="text-xs font-semibold text-zinc-300 block">Select Open Invoice to Match:</label>
                              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center min-w-0">
                                <div className="flex-1 min-w-0">
                                  <Select
                                    value={selectedInvoiceToMatch ? String(selectedInvoiceToMatch) : ""}
                                    onChange={(e) => setSelectedInvoiceToMatch(Number(e.target.value) || null)}
                                    className="text-xs py-1.5! w-full truncate"
                                  >
                                    <option value="">Choose open invoice...</option>
                                    {allOpenInvoices.map((inv) => (
                                      <option key={inv.id} value={inv.id}>
                                        {inv.invoiceNumber || `INV-${inv.id}`} — {inv.clientName} ({inv.balanceDue !== undefined && inv.balanceDue < inv.totalAmount ? `Bal ${formatMoney(inv.balanceDue)} / Tot ${formatMoney(inv.totalAmount)}` : formatMoney(inv.totalAmount)})
                                      </option>
                                    ))}
                                  </Select>
                                </div>
                                <Button
                                  variant="info"
                                  size="sm"
                                  disabled={!selectedInvoiceToMatch}
                                  isLoading={isMatchingInvoice}
                                  onClick={() => {
                                    if (selectedInvoiceToMatch && tx) {
                                      handleMatchInvoicePayment(selectedInvoiceToMatch, tx.id);
                                    }
                                  }}
                                  className="text-xs shrink-0 justify-center"
                                >
                                  Match
                                </Button>
                              </div>
                            </div>
                          )}

                          {!isClosed && (
                            <div className="pt-2 mt-auto space-y-2">
                              <Button
                                variant={showLinkPanel ? "info" : "secondary"}
                                size="sm"
                                onClick={() => {
                                  setLinkTargetMode("invoice");
                                  setShowLinkPanel(p => !p);
                                  setSelectedLinkId(null);
                                }}
                                className="w-full text-xs font-semibold justify-center"
                              >
                                {showLinkPanel ? "Close Link Existing Picker" : "Search & Link Existing Invoice"}
                              </Button>
                              {renderLinkPicker()}
                              {onOpenInvoices && (
                                <button
                                  type="button"
                                  onClick={onOpenInvoices}
                                  className="w-full py-2 px-3 border border-dashed border-white/10 hover:border-indigo-500/40 hover:bg-indigo-500/5 text-zinc-400 hover:text-indigo-300 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                                >
                                  <span>+</span> Create New Invoice for this Deposit
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 border-b border-zinc-800 pb-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          <h2 className="text-base font-bold text-white">Expense Details</h2>
                          {activeExpense && (
                            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${activeExpense.isManual ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}`}>{activeExpense.isManual ? "Manual" : "AI Extracted"}</span>
                          )}
                          {expensesList.length > 1 && <span className="text-xs text-zinc-400 ml-1 whitespace-nowrap">({expensesList.length} linked)</span>}
                        </div>
                        {activeExpense && (
                          isEditingExpense ? (
                            <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingExpense(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveExpense} >Save</Button></div>
                          ) : !isClosed ? (
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setIsSplitModalOpen(true)}
                                className="text-amber-300 border-amber-500/30 hover:bg-amber-500/10 font-medium text-xs"
                                title="Split receipt into multiple items (e.g. personal vs business)"
                              >
                                ✂ Split Receipt
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setIsEditingExpense(true)} className={btnSmGreen}>Edit</Button>
                              <Button variant="danger" size="sm" onClick={handleDeleteExpense} >Delete</Button>
                            </div>
                          ) : null
                        )}
                      </div>

                      {renderExpensePagination()}

                      {(() => {
                        const item = activeExpense;
                        const form = expenseForm;
                        const setForm = setExpenseForm;
                        const editing = isEditingExpense;
                        if (!item) return <div className="py-6 text-zinc-400 text-center text-xs">No Expense Linked</div>;

                        const e = item as Expense;
                        
                        const warnings = [];
                        const eStatus = e.allocationStatus || e.linkStatus || e.reconciliationStatus;
                        if (e.reviewStatus === "PENDING" && isDateInClosedPeriod) warnings.push("This item is pending review for a closed period.");
                        if (e.tender?.toLowerCase() !== "cash") {
                          if (eStatus === "UNLINKED") warnings.push("This expense is unlinked.");
                          if (eStatus === "PARTIALLY_ALLOCATED") warnings.push("This expense is under-allocated.");
                        }
                        if (eStatus === "OVER_ALLOCATED") warnings.push("This expense is over-allocated.");
                        if (!isDeposit && (!e.receipts || e.receipts.length === 0)) warnings.push("This expense does not have a physical receipt file attached to it.");
                        
                        return (
                          <div className="space-y-3.5 flex-1">
                            {e.reviewStatus === "WARNINGS_IGNORED" ? (
                              <div className="mb-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 p-2.5 rounded-xl text-xs flex items-center justify-between italic">
                                <span>Warnings have been ignored for this item.</span>
                                <Button variant="ghost" size="sm" onClick={async () => {
                                  await resolveReviewItems("restore_warnings", [], [e.id]);
                                  await loadData();
                                }} className="text-blue-200 hover:text-white px-2.5 py-0.5 h-auto text-xs not-italic bg-blue-500/20 hover:bg-blue-500/40 rounded">Undo</Button>
                              </div>
                            ) : warnings.length > 0 && !isEditingExpense && (
                                <div className="mb-2 bg-orange-500/10 border border-orange-500/20 text-orange-400 p-2.5 rounded-xl text-xs">
                                    <ul className="list-disc pl-4 space-y-1">
                                        {warnings.map((w, i) => <li key={i}>{w}</li>)}
                                    </ul>
                                </div>
                            )}
                            <div>
                              <label className={labelCls}>Amount</label>
                              {editing ? (
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <label className="text-[11px] text-zinc-400 block mb-0.5">Total</label>
                                    <MoneyInput value={form.amount} onChange={val => setForm({ ...form, amount: val })} />
                                  </div>
                                  <div className="w-24">
                                    <label className="text-[11px] text-zinc-400 block mb-0.5">Tax</label>
                                    <MoneyInput value={form.taxAmount || 0} onChange={val => setForm({ ...form, taxAmount: val })} />
                                  </div>
                                  <div className="w-24">
                                    <label className="text-[11px] text-zinc-400 block mb-0.5">Currency</label>
                                    <Select 
                                      searchable 
                                      dropdownAlign="right"
                                      value={form.currencyCode || 'USD'} 
                                      onChange={ev => setForm({ ...form, currencyCode: ev.target.value })}
                                    >
                                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </Select>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-baseline gap-2">
                                  <p className="text-lg font-bold font-mono text-white">{formatMoney(e.amount)}</p>
                                  {(e.taxAmount > 0 || (e.currencyCode && e.currencyCode !== 'USD')) && (
                                    <p className="text-xs text-zinc-400 font-mono">
                                      {e.currencyCode && e.currencyCode !== 'USD' ? e.currencyCode : ''}
                                      {e.taxAmount > 0 ? ` (Includes ${formatMoney(e.taxAmount)} tax)` : ''}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            <div><label className={labelCls}>Vendor</label>{editing ? <Input type="text" value={form.vendor} onChange={ev => setForm({ ...form, vendor: ev.target.value })} /> : <p className="text-zinc-300">{e.vendor || "Unknown"}</p>}</div>
                            <div><label className={labelCls}>Description</label>{editing ? <Input type="text" value={form.description} onChange={ev => setForm({ ...form, description: ev.target.value })} /> : <p className="text-zinc-300">{e.description}</p>}</div>
                            <div className="flex gap-6">
                              <div><label className={labelCls}>Date</label>{editing ? <Input type="date" value={form.timestamp} onChange={ev => setForm({ ...form, timestamp: ev.target.value })} /> : <p className="text-zinc-300">{formatDate(e.timestamp)}</p>}</div>
                              <div className="flex-1"><label className={labelCls}>Tender</label>{editing ? <Select searchable value={form.tender?.toUpperCase() || ''} onChange={ev => setForm({ ...form, tender: ev.target.value })}><option value="">Unknown</option>{TENDERS.map(t => <option key={t} value={t}>{t}</option>)}</Select> : <p className="text-zinc-300 uppercase">{e.tender || "Unknown"}</p>}</div>
                            </div>
                            <div>
                              <label className={labelCls}>Category</label>
                              {editing ? (
                                <Select searchable value={form.chartAccountId || ''} onChange={ev => setForm({ ...form, chartAccountId: ev.target.value })}>
                                  <option value="">None</option>
                                  {getGroupedAccounts(accounts, ['EXPENSE'], { currentSelectedId: form.chartAccountId }).map(g => (
                                    <optgroup key={g.subClassId} label={g.label}>
                                      {g.options.map(opt => (
                                        <option key={opt.account.id} value={opt.account.id}>
                                          {opt.displayName}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </Select>
                              ) : (e.chartAccount && e.chartAccount.id > 0) ? (
                                <p className="text-zinc-300 text-sm flex items-center gap-2">
                                  <span>{e.chartAccount.code} — {e.chartAccount.name}</span>
                                  {!e.chartAccount.active && (
                                    <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold border border-red-500/30" title="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                                      Archived
                                    </span>
                                  )}
                                </p>
                              ) : <p className="text-zinc-400 italic text-sm">Uncategorized</p>}
                            </div>
                            <div><label className={labelCls}>Notes</label>{editing ? <textarea className={inputCls} rows={3} value={form.notes} onChange={ev => setForm({ ...form, notes: ev.target.value })} /> : <p className="text-zinc-300 whitespace-pre-wrap">{e.notes || <span className="text-zinc-400 italic">No notes</span>}</p>}</div>

                            {e.invoice && (
                              <div className="p-3 bg-indigo-500/10 border border-indigo-500/25 rounded-xl flex items-center justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-300 block">
                                    Linked Client Invoice
                                  </span>
                                  <div className="font-mono font-bold text-white truncate">
                                    {e.invoice.invoiceNumber || `INV-${e.invoice.id}`} — {e.invoice.clientName}
                                  </div>
                                  <div className="text-[11px] text-zinc-400">
                                    {formatMoney(e.invoice.totalAmount)} • {e.invoice.status}
                                  </div>
                                </div>
                                {!isClosed && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    isLoading={isLinkingInvoice}
                                    onClick={() => handleUnlinkExpenseInvoice(e.id, e.invoice?.invoiceNumber)}
                                    className="text-xs text-zinc-300 hover:text-red-400 shrink-0"
                                  >
                                    Unlink
                                  </Button>
                                )}
                              </div>
                            )}
                            
                            <div className="pt-2 flex flex-col gap-2">
                              {e.receipts && e.receipts.length > 0 ? (
                                <div className="flex gap-2">
                                  <Button variant="ghost" onClick={() => { setShowReceiptModal(true); setActiveReceiptIdx(0); }} className="flex-1 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center gap-2 text-sm">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                    View Receipt
                                  </Button>
                                  {!isClosed && (
                                    <Button variant="ghost" onClick={() => fileInputRef.current?.click()} className="bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center text-sm px-3" title="Upload another receipt">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                    </Button>
                                  )}
                                </div>
                              ) : !isClosed ? (
                                <div className="text-center mt-2">
                                  <Button variant="ghost" onClick={() => fileInputRef.current?.click()} className="w-full px-4 py-2 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 transition flex items-center justify-center gap-2 text-sm">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                    Upload Receipt
                                  </Button>
                                </div>
                              ) : null}
                              <input type="file" ref={fileInputRef} className="hidden" accept=".jpg,.jpeg,.png,.pdf,.heic" onChange={handleUploadReceipt} />
                            </div>

                          </div>
                        );
                      })()}

                      {type === "transaction" && !isClosed && (
                        <>
                          <div className="mt-4 pt-3 border-t border-zinc-800 grid grid-cols-2 gap-2">
                            <Button
                              variant={showLinkPanel ? "info" : "secondary"}
                              size="sm"
                              onClick={() => {
                                setShowLinkPanel(p => {
                                  if (!p) setLinkTargetMode("expense");
                                  return !p;
                                });
                                setSelectedLinkId(null);
                              }}
                              className="w-full text-xs font-semibold px-2 py-1.5 justify-center"
                              title={showLinkPanel ? "Close Link Picker" : "Link Existing Expense or Invoice"}
                            >
                              <span className="truncate">
                                {showLinkPanel ? "Close Picker" : "Link Existing"}
                              </span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const targetTx = activeTx || tx;
                                const txDateStr = targetTx?.date ? targetTx.date.split('T')[0] : '';
                                const linkedExpSum = expensesList.reduce((s, ce) => s + ce.amount, 0);
                                const remainingTxAmt = targetTx?.amount ? Math.max(0, Math.abs(targetTx.amount) - linkedExpSum) : 0;
                                const txAmt = remainingTxAmt > 0 ? remainingTxAmt : (targetTx?.amount ? Math.abs(targetTx.amount) : undefined);
                                const txVendor = targetTx?.description || '';
                                const txCatId = targetTx?.categoryAccountId;
                                setCreateForm({
                                  timestamp: txDateStr,
                                  vendor: extractCleanVendor(txVendor),
                                  description: txVendor,
                                  amount: txAmt,
                                  tender: 'card',
                                  chartAccountId: txCatId ? Number(txCatId) : undefined
                                });
                                setShowCreateModal(true);
                              }}
                              className="w-full text-xs font-semibold px-2 py-1.5 justify-center bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition"
                              title="Create New Expense"
                            >
                              <span className="truncate">
                                Create New <span className="hidden xl:inline">Expense</span>
                              </span>
                            </Button>
                          </div>
                          {renderLinkPicker()}
                        </>
                      )}

                      {(() => {
                        const currentExp = activeExpense;
                        if (!currentExp) return null;
                        
                        const hasLinks = transactionsList.length > 0 || (currentExp.bankTransactions && currentExp.bankTransactions.length > 0);
                        if (!hasLinks) return null;

                        const isMultiExpense = expensesList.length > 1;
                        const sumExp = expensesList.reduce((sum, e) => sum + e.amount, 0);
                        const sumTx = transactionsList.reduce((sum, t) => sum + Math.abs(t.amount), 0);

                        // If multiple expenses are linked to the transaction(s), the progress bar and allocation math
                        // are tied to the accumulative sum of the linked expenses.
                        const total = isMultiExpense ? sumExp : currentExp.amount;

                        let expAllocated = 0;
                        if (isMultiExpense) {
                          // In a split transaction (1 Tx -> N Exp):
                          // If the transaction(s) cover or equal the sum of expenses, all expenses are 100% allocated.
                          if (transactionsList.length <= 1 && sumTx >= sumExp) {
                            expAllocated = sumExp;
                          } else {
                            expAllocated = sumTx;
                          }
                        } else {
                          // Single expense:
                          // If covered by a transaction that is >= its amount and balanced, it is 100% absorbed.
                          if (transactionsList.length <= 1 && sumTx >= total && currentExp.allocationStatus === "BALANCED") {
                            expAllocated = total;
                          } else {
                            expAllocated = sumTx;
                          }
                        }

                        const remaining = total - expAllocated;
                        const pct = Math.min(100, Math.max(0, total > 0 ? (expAllocated / total) * 100 : 0));
                        
                        return (
                           <div className="mt-5 pt-4 border-t border-zinc-800">
                              <div className="space-y-2">
                                 <div className="flex justify-between text-xs font-semibold">
                                    <span className="text-zinc-400">Allocated: {formatMoney(expAllocated)}</span>
                                    <span className="text-white">
                                      {formatMoney(total)} Total{isMultiExpense ? ` (${expensesList.length} linked)` : ''}
                                    </span>
                                 </div>
                                 <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                                    <div className={`h-full transition-all ${remaining < -0.01 ? "bg-red-500" : remaining > 0.01 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                                 </div>
                                 {remaining > 0.01 && (
                                    <p className="text-amber-500 text-xs font-medium">⚠️ {formatMoney(remaining)} remaining to allocate.</p>
                                 )}
                                 {remaining < -0.01 && (
                                    <p className="text-red-500 text-xs font-medium">🚨 Over-allocated by {formatMoney(Math.abs(remaining))}.</p>
                                 )}
                              </div>
                           </div>
                        );
                      })()}

                      {(() => {
                        const e = activeExpense;
                        if (!e || e.reviewStatus === "IGNORED") return null;
                        if (isClosed && !itemAwaitingReview) return null;

                        const isPendingClosed = e.reviewStatus === "PENDING" && isDateInClosedPeriod;

                        const eStatus = e.allocationStatus || e.linkStatus || e.reconciliationStatus;
                        const warnings = [];
                        if (e.tender?.toLowerCase() !== "cash") {
                          if (eStatus === "UNLINKED") warnings.push("Unlinked");
                          if (eStatus === "PARTIALLY_ALLOCATED") warnings.push("Under-Allocated");
                        }
                        if (eStatus === "OVER_ALLOCATED") warnings.push("Over");
                        if (!isDeposit && (!e.receipts || e.receipts.length === 0)) warnings.push("No receipt");

                        return (
                          <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-3 justify-end items-center">
                            {isPendingClosed ? (
                              <Button
                                variant="primary"
                                className="text-xs"
                                onClick={() => setAllowConfirmTarget({ type: "expense", id: e.id, date: e.timestamp })}
                              >
                                Allow Item
                              </Button>
                            ) : (
                              e.reviewStatus !== "WARNINGS_IGNORED" && (
                                warnings.length > 0 ? (
                                  <Button variant="ghost" className="text-xs text-orange-400 hover:bg-orange-500/10" onClick={() => handleCardAction("IGNORE", "expense", e.id)}>Ignore Warnings</Button>
                                ) : (
                                  <div title="There are no issues with this item" className="cursor-not-allowed">
                                    <Button variant="ghost" disabled className="text-xs text-zinc-400 pointer-events-none">Ignore Warnings</Button>
                                  </div>
                                )
                              )
                            )}
                            <Button variant="ghost" className="text-xs text-red-400 hover:bg-red-500/10" onClick={() => handleCardAction("EXCLUDE", "expense", e.id)}>Exclude...</Button>
                          </div>
                        );
                      })()}

                    </>
                  )}
                </div>
                
                {/* MOBILE UNLINK BUTTON */}
                {activeExpense && activeTx && !isClosed && !isEditingExpense && !isEditingTx && (
                  <div className="lg:hidden flex justify-center -my-4 relative z-20">
                    <Button 
                       onClick={handleUnlink} 
                       variant="secondary" 
                       className="rounded-full shadow-xl border border-red-500/30 bg-zinc-900 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 px-6 py-2 flex items-center justify-center gap-2 cursor-pointer" 
                       title="Unlink Pair"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.73 21a2 2 0 01-3.46 0m9.73-8v-3a2 2 0 00-2-2h-3m-6 0H5a2 2 0 00-2 2v3m12 0l-4 4m0 0l-4-4m4 4V10" /></svg>
                      <span className="text-xs font-bold uppercase tracking-wider">Unlink</span>
                    </Button>
                  </div>
                )}

                {/* BANK TRANSACTION COLUMN */}
                <div className={`bg-white/2 border border-white/5 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-lg flex flex-col relative z-10 transition-colors duration-200 ${
                  isEditingTx ? 'ring-1 ring-blue-500/20' : ''
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 border-b border-zinc-800 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      <h2 className="text-base font-bold text-white">Bank Transaction</h2>
                      {activeTx && (() => {
                        const isManual = activeTx.isManual || (activeTx.fitId && activeTx.fitId.startsWith("MANUAL-"));
                        return <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${isManual ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}`}>{isManual ? "Manual" : "Bank Import"}</span>;
                      })()}
                      {transactionsList.length > 1 && <span className="text-xs text-zinc-400 ml-1 whitespace-nowrap">({transactionsList.length} linked)</span>}
                    </div>
                    {activeTx && (
                      isEditingTx ? (
                        <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingTx(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveTx} >Save</Button></div>
                      ) : !isClosed ? (
                        <div className="flex flex-wrap gap-1.5"><Button variant="ghost" size="sm" onClick={() => setIsEditingTx(true)} className={btnSmBlue}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteTx} >Delete</Button></div>
                      ) : null
                    )}
                  </div>

                  {renderTransactionPagination()}

                  {(() => {
                    const item = activeTx;
                    const form = txForm;
                    const setForm = setTxForm;
                    const editing = isEditingTx;
                    if (!item) {
                      if (type === "receipt" && activeExpense?.tender?.toLowerCase() === "cash") {
                        return <div className="py-6 text-zinc-400 text-center">Not Applicable (Cash Expense)</div>;
                      }
                      return <div className="py-6 text-zinc-400 text-center">No Bank Transaction Linked</div>;
                    }

                    const t = item as BankTransaction;
                    
                    const warnings = [];
                    const tStatus = t.allocationStatus || t.linkStatus || t.reconciliationStatus;
                    if (t.reviewStatus === "PENDING" && isDateInClosedPeriod) warnings.push("This item is pending review for a closed period.");
                    if (t.amount < 0) {
                      if (tStatus === "UNLINKED") warnings.push("This transaction is unlinked.");
                      if (tStatus === "PARTIALLY_ALLOCATED") warnings.push("This transaction is under-allocated.");
                    }
                    if (tStatus === "OVER_ALLOCATED") warnings.push("This transaction is over-allocated.");
                    
                    return (
                      <div className="space-y-4 flex-1">
                        {t.reviewStatus === "WARNINGS_IGNORED" ? (
                          <div className="mb-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 p-3 rounded-xl text-sm flex items-center justify-between italic">
                            <span>Warnings have been ignored for this item.</span>
                            <Button variant="ghost" size="sm" onClick={async () => {
                              await resolveReviewItems("restore_warnings", [t.id], []);
                              await loadData();
                            }} className="text-blue-200 hover:text-white px-3 py-1 h-auto text-xs not-italic bg-blue-500/20 hover:bg-blue-500/40 rounded">Undo</Button>
                          </div>
                        ) : warnings.length > 0 && !editing && (
                            <div className="mb-2 bg-orange-500/10 border border-orange-500/20 text-orange-400 p-3 rounded-xl text-sm">
                                <ul className="list-disc pl-4 space-y-1">
                                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        )}
                        <div>
                          <label className={labelCls}>Amount</label>
                          {editing ? (
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <MoneyInput allowNegative value={form.amount} onChange={val => {
                                  let amt = val;
                                  const isOutgoing = t.transactionType === 'DEBIT' || t.transactionType === 'PAYMENT';
                                  if (isOutgoing && amt > 0) amt = -amt;
                                  else if (!isOutgoing && amt < 0) amt = Math.abs(amt);
                                  setForm({ ...form, amount: amt });
                                }} />
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-baseline gap-2">
                              <p className="text-lg font-bold font-mono text-white">{formatMoney(t.amount)}</p>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <label className={labelCls}>Description</label>
                            {onCreateRule && !editing && (
                              <button
                                type="button"
                                onClick={() => {
                                  const clean = extractCleanVendor(t.description);
                                  onCreateRule({
                                    name: clean || t.description,
                                    descriptionKeyword: clean || t.description,
                                    categoryAccountId: t.categoryAccountId || null,
                                  });
                                }}
                                className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1 transition-colors cursor-pointer pb-1"
                                title="Create an automated rule for this merchant"
                              >
                                ⚡ Create Rule
                              </button>
                            )}
                          </div>
                          {editing ? <Input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /> : <p className="text-zinc-300">{t.description}</p>}
                        </div>
                        <div className="flex gap-6">
                          <div><label className={labelCls}>Date</label>{editing ? <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /> : <p className="text-zinc-300">{formatDate(t.date)}</p>}</div>
                          <div className="flex-1"><label className={labelCls}>Type</label><p className="text-zinc-300 uppercase mt-2">{t.transactionType}</p></div>
                        </div>
                        <div>
                          <label className={labelCls}>Bank / Card Account</label>
                          {editing ? (
                            <Select searchable value={form.chartAccountId || ''} onChange={e => setForm({ ...form, chartAccountId: e.target.value })}>
                              <option value="">Select bank or card account...</option>
                              {getGroupedAccounts(accounts, ['ASSET', 'LIABILITY'], { currentSelectedId: form.chartAccountId }).map(g => (
                                <optgroup key={g.subClassId} label={g.label}>
                                  {g.options.map(opt => (
                                    <option key={opt.account.id} value={opt.account.id}>
                                      {opt.displayName}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </Select>
                          ) : (t.chartAccount && t.chartAccount.id > 0) ? (
                            <p className="text-zinc-300 text-sm flex items-center gap-2">
                              <span>{t.chartAccount.code} — {t.chartAccount.name}</span>
                              {!t.chartAccount.active && (
                                <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold border border-red-500/30" title="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                                  Archived
                                </span>
                              )}
                            </p>
                          ) : <p className="text-red-400 italic text-sm">No Bank Account</p>}
                        </div>
                        <div>
                          <label className={labelCls}>Category</label>
                          {expensesList.length > 1 ? (
                            <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 overflow-hidden text-xs mt-1 shadow-sm">
                              {/* Header Bar */}
                              <button
                                type="button"
                                onClick={() => setShowSplitCategories(prev => !prev)}
                                className="w-full flex items-center justify-between p-2.5 hover:bg-purple-500/15 transition-colors text-purple-300 text-left cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold uppercase tracking-wider text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">
                                    Split
                                  </span>
                                  <span className="font-medium text-white">
                                    {expensesList.length} Linked Categories
                                  </span>
                                </div>
                                <svg
                                  className={`w-4 h-4 text-purple-400 transition-transform duration-200 ${showSplitCategories ? "rotate-180" : ""}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>

                              {/* Expanded Category Details */}
                              {showSplitCategories && (
                                <div className="border-t border-purple-500/20 divide-y divide-purple-500/15 bg-zinc-950/60">
                                  {expensesList.map((exp, idx) => (
                                    <div
                                      key={exp.id}
                                      onClick={() => setActiveExpenseIdx(idx)}
                                      className={`p-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                                        activeExpenseIdx === idx
                                          ? "bg-purple-500/20 text-white"
                                          : "hover:bg-purple-500/10 text-zinc-300"
                                      }`}
                                      title={`Click to view Expense #${idx + 1} (${formatMoney(exp.amount)}) in left panel`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                                          activeExpenseIdx === idx
                                            ? "bg-purple-400 text-zinc-950 font-bold"
                                            : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                        }`}>
                                          #{idx + 1}
                                        </span>
                                        <div className="min-w-0">
                                          {exp.chartAccount ? (
                                            <div className="flex items-center gap-1.5 truncate">
                                              <span className="font-mono text-purple-300 text-xs font-semibold">
                                                {exp.chartAccount.code}
                                              </span>
                                              <span className="text-zinc-200 text-xs truncate">
                                                {exp.chartAccount.name}
                                              </span>
                                              {!exp.chartAccount.active && (
                                                <span className="text-[9px] bg-red-500/20 text-red-400 px-1 py-0.2 rounded border border-red-500/30">
                                                  Archived
                                                </span>
                                              )}
                                            </div>
                                          ) : (
                                            <span className="text-zinc-400 italic text-xs">Uncategorized</span>
                                          )}
                                          {exp.description && (
                                            <span className="text-[11px] text-zinc-400 truncate block">
                                              {exp.description}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <span className="font-semibold text-white text-xs shrink-0">
                                        {formatMoney(exp.amount)}
                                      </span>
                                    </div>
                                  ))}
                                  <div className="p-2 text-[10px] text-zinc-400 bg-zinc-900/40 text-center italic">
                                    Click a category row to view its receipt details on the left.
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : editing ? (
                            <Select searchable value={form.categoryAccountId || ''} onChange={e => setForm({ ...form, categoryAccountId: e.target.value })}>
                              <option value="">None</option>
                              {getGroupedAccounts(accounts, t.transactionType === 'DEP' ? ['REVENUE', 'EQUITY', 'ASSET', 'LIABILITY'] : ['EXPENSE', 'EQUITY', 'ASSET', 'LIABILITY', 'REVENUE'], { currentSelectedId: form.categoryAccountId }).map(g => (
                                <optgroup key={g.subClassId} label={g.label}>
                                  {g.options.map(opt => (
                                    <option key={opt.account.id} value={opt.account.id}>
                                      {opt.displayName}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </Select>
                          ) : (t.category && t.category.id > 0) ? (
                            <p className="text-zinc-300 text-sm flex items-center gap-2">
                              <span>{t.category.code} — {t.category.name}</span>
                              {!t.category.active && (
                                <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold border border-red-500/30" title="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                                  Archived
                                </span>
                              )}
                            </p>
                          ) : <p className="text-zinc-400 italic text-sm">Uncategorized</p>}
                        </div>
                        <div><label className={labelCls}>Notes</label>{editing ? <textarea className={inputCls} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /> : <p className="text-zinc-300 whitespace-pre-wrap">{t.notes || <span className="text-zinc-400 italic">No notes</span>}</p>}</div>
                      </div>
                    );
                  })()}

                  {type === "receipt" && !isClosed && (
                    <>
                      <div className={`mt-4 pt-3 border-t border-zinc-800 grid gap-2 ${activeExpense?.tender?.toLowerCase() !== "cash" ? "grid-cols-2" : "grid-cols-1"}`}>
                        <Button
                          variant={showLinkPanel ? "info" : "secondary"}
                          size="sm"
                          onClick={() => {
                            const isCashExp = activeExpense?.tender?.toLowerCase() === "cash";
                            setShowLinkPanel(p => {
                              if (!p) setLinkTargetMode(isCashExp ? "invoice" : "tx");
                              return !p;
                            });
                            setSelectedLinkId(null);
                          }}
                          className="w-full text-xs font-semibold px-2 py-1.5 justify-center"
                          title={showLinkPanel ? "Close Link Picker" : "Link Existing Transaction or Invoice"}
                        >
                          <span className="truncate">
                            {showLinkPanel
                              ? "Close Picker"
                              : activeExpense?.tender?.toLowerCase() === "cash"
                                ? "Link to Client Invoice"
                                : "Link Existing"}
                          </span>
                        </Button>
                        {activeExpense?.tender?.toLowerCase() !== "cash" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowCreateModal(true);
                              const remainingAmt = activeExpense ? Math.max(0, activeExpense.amount - transactionsList.reduce((s, ct) => s + Math.abs(ct.amount), 0)) : 0;

                              let defaultBankId: number | undefined = undefined;
                              const tender = activeExpense?.tender?.toLowerCase();
                              if (tender === 'card') {
                                const cc = accounts.find(a => a.type === 'LIABILITY' && a.code.startsWith('20') && a.active);
                                defaultBankId = cc ? cc.id : accounts.find(a => a.type === 'ASSET' && a.code === '1010' && a.active)?.id;
                              } else if (tender === 'cash') {
                                const cashAcc = accounts.find(a => a.code === '1030' && a.active);
                                defaultBankId = cashAcc?.id;
                              } else {
                                const checking = accounts.find(a => a.code === '1010' && a.active);
                                defaultBankId = checking ? checking.id : accounts.find(a => (a.type === 'ASSET' || a.type === 'LIABILITY') && a.active)?.id;
                              }

                              setCreateForm({
                                date: activeExpense?.timestamp ? activeExpense.timestamp.split('T')[0] : '',
                                description: activeExpense?.vendor ? `${activeExpense.vendor}${activeExpense.description ? ` - ${activeExpense.description}` : ''}` : (activeExpense?.description || ''),
                                amount: remainingAmt > 0 ? remainingAmt : activeExpense?.amount,
                                transactionType: 'DEBIT',
                                chartAccountId: defaultBankId,
                                categoryAccountId: activeExpense?.chartAccountId,
                              });
                            }}
                            className="w-full text-xs font-semibold px-2 py-1.5 justify-center bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition"
                            disabled={!canAddMoreTransactions}
                            title="Create New Transaction"
                          >
                            <span className="truncate">
                              Create New <span className="hidden xl:inline">Transaction</span>
                            </span>
                          </Button>
                        )}
                      </div>
                      {renderLinkPicker()}
                    </>
                  )}

                  {(() => {
                    const currentTx = activeTx;
                    if (!currentTx) return null;
                    
                    const hasLinks = expensesList.length > 0 || (currentTx.expenses && currentTx.expenses.length > 0);
                    if (!hasLinks) return null;

                    const isMultiTx = transactionsList.length > 1;
                    const sumTx = transactionsList.reduce((sum, t) => sum + Math.abs(t.amount), 0);
                    const sumExp = expensesList.reduce((sum, e) => sum + e.amount, 0);

                    // If multiple transactions are linked (split expense N:1), the progress bar and allocation math
                    // are tied to the accumulative sum of the transactions.
                    const total = isMultiTx ? sumTx : Math.abs(currentTx.amount);

                    let txAllocated = 0;
                    if (isMultiTx) {
                      // In an N:1 split (multiple transactions funding 1 expense):
                      // If the single expense covers or equals the sum of transactions, the transactions are 100% absorbed.
                      if (expensesList.length <= 1 && sumExp >= sumTx) {
                        txAllocated = sumTx;
                      } else {
                        txAllocated = sumExp;
                      }
                    } else {
                      // Single transaction:
                      // If absorbed by an expense that is >= its amount and balanced, it is 100% absorbed.
                      if (expensesList.length === 1 && sumExp >= total && currentTx.allocationStatus === "BALANCED") {
                        txAllocated = total;
                      } else {
                        txAllocated = sumExp;
                      }
                    }

                    const remaining = total - txAllocated;
                    const pct = Math.min(100, Math.max(0, total > 0 ? (txAllocated / total) * 100 : 0));
                    
                    return (
                      <div className="mt-5 pt-4 border-t border-zinc-800">
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="text-zinc-400">Allocated: {formatMoney(txAllocated)}</span>
                            <span className="text-white">
                              {formatMoney(total)} Total{isMultiTx ? ` (${transactionsList.length} linked)` : ''}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <div className={`h-full transition-all ${remaining < -0.01 ? "bg-red-500" : remaining > 0.01 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                          </div>
                          {remaining > 0.01 && (
                            <p className="text-amber-500 text-xs font-medium">⚠️ {formatMoney(remaining)} remaining to allocate.</p>
                          )}
                          {remaining < -0.01 && (
                            <p className="text-red-500 text-xs font-medium">🚨 Over-allocated by {formatMoney(Math.abs(remaining))}.</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  
                  {(() => {
                    const t = activeTx;
                    if (!t || t.reviewStatus === "IGNORED") return null;
                    if (isClosed && !itemAwaitingReview) return null;
                    
                    const isPendingClosed = t.reviewStatus === "PENDING" && isDateInClosedPeriod;

                    const warnings = [];
                    const tStatus = t.allocationStatus || t.linkStatus || t.reconciliationStatus;
                    if (t.amount < 0) {
                      if (tStatus === "UNLINKED") warnings.push("Unlinked");
                      if (tStatus === "PARTIALLY_ALLOCATED") warnings.push("Under-Allocated");
                    }
                    if (tStatus === "OVER_ALLOCATED") warnings.push("Over");

                    return (
                      <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-3 justify-end items-center">
                        {isPendingClosed ? (
                          <Button
                            variant="primary"
                            className="text-xs"
                            onClick={() => setAllowConfirmTarget({ type: "transaction", id: t.id, date: t.date })}
                          >
                            Allow Item
                          </Button>
                        ) : (
                          t.reviewStatus !== "WARNINGS_IGNORED" && (
                            warnings.length > 0 ? (
                              <Button variant="ghost" className="text-xs text-orange-400 hover:bg-orange-500/10" onClick={() => handleCardAction("IGNORE", "transaction", t.id)}>Ignore Warnings</Button>
                            ) : (
                              <div title="There are no issues with this item" className="cursor-not-allowed">
                                <Button variant="ghost" disabled className="text-xs text-zinc-400 pointer-events-none">Ignore Warnings</Button>
                              </div>
                            )
                          )
                        )}
                        <Button variant="ghost" className="text-xs text-red-400 hover:bg-red-500/10" onClick={() => handleCardAction("EXCLUDE", "transaction", t.id)}>Exclude...</Button>
                      </div>
                    );
                  })()}
                </div>

              </div>
              )}

              {/* SUGGESTED MATCHES */}
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
                            amountLabel: formatMoney(cand.expense.amount),
                            actionLabel: "Approve Link",
                            onAction: () => handleApproveSuggestedMatch("expense", cand.expense.id),
                          }))
                        : suggestedTransactionCandidates.map((cand) => ({
                            id: cand.transaction.id,
                            score: cand.score,
                            reason: cand.reason,
                            title: cand.transaction.description,
                            subtitle: `${formatDate(cand.transaction.date)} • ${cand.transaction.chartAccount?.name || cand.transaction.category?.name || "Checking"}`,
                            amountLabel: formatMoney(cand.transaction.amount),
                            actionLabel: "Approve Link",
                            onAction: () => handleApproveSuggestedMatch("tx", cand.transaction.id),
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
          onExcluded={() => { setExcludeTarget(null); handleClose(); }}
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
