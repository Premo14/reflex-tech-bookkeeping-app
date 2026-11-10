import { useEffect, useState, useRef } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import Pagination from "./ui/Pagination";
import ReactDOM from "react-dom";
import ExcludeItemModal, { EXCLUSION_REASON_LABELS } from "./ExcludeItemModal";
import SplitExpenseModal from "./SplitExpenseModal";
import {
  getTransactionDetail, getExpenseDetail,
  updateTransaction, updateExpense,
  deleteTransaction, deleteExpense,
  getUnlinkedItems,
  linkExpenseToTransaction, unlinkExpenseFromTransaction,
  createAndLink, uploadReceiptToExpense, deleteReceipt,
  getSettings, getChartAccounts, resolveReviewItems, restoreItem
} from "../services/api";
import type { BankTransaction, Expense, ChartAccount } from "../types/models";
import CreateExpenseForm from "./CreateExpenseForm";
import CreateTransactionForm from "./CreateTransactionForm";
import { getGroupedAccounts } from "../utils/accountHierarchy";
import { formatDate } from "../utils/dateUtils";
import { useLiveEvent } from "../utils/useLiveSync";
import { extractCleanVendor } from "../utils/vendorUtils";
import { computeMatchScore } from "../utils/matchConfidence";

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
  type: "transaction" | "receipt" | null;
  id: number | null;
  onClose: () => void;
  onCreateRule?: (data: { name: string; descriptionKeyword: string; categoryAccountId?: number | null }) => void;
}

export default function DetailDrawer({ type, id, onClose, onCreateRule }: DetailDrawerProps) {
  const { confirm, alert } = useConfirm();
  const activeRequestId = useRef(0);
  const [hasBackgroundUpdate, setHasBackgroundUpdate] = useState(false);
  const [tx, setTx] = useState<BankTransaction | null>(null);
  const [expense, setExpense] = useState<Expense | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);

  const [confirmedExpenses, setConfirmedExpenses] = useState<Expense[]>([]);
  const [suggestedExpenses, setSuggestedExpenses] = useState<Expense[]>([]);
  const [confirmedTransactions, setConfirmedTransactions] = useState<BankTransaction[]>([]);
  const [suggestedTransactions, setSuggestedTransactions] = useState<BankTransaction[]>([]);

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
  const [createForm, setCreateForm] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [activeReceiptIdx, setActiveReceiptIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isClosed, setIsClosed] = useState(false);
  const [isDateInClosedPeriod, setIsDateInClosedPeriod] = useState(false);
  const [excludeTarget, setExcludeTarget] = useState<{type: "transaction"|"expense", id: number, linkedChoice?: "ONLY_THIS" | "ALL_LINKED"} | null>(null);
  const [ignoreTarget, setIgnoreTarget] = useState<{type: "transaction"|"expense", id: number, linkedChoice?: "ONLY_THIS" | "ALL_LINKED"} | null>(null);
  const [actionChoiceModal, setActionChoiceModal] = useState<{ action: "EXCLUDE" | "IGNORE", targetType: "transaction" | "expense", targetId: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [conflictModalData, setConflictModalData] = useState<any>(null);
  const [overAllocatedModalData, setOverAllocatedModalData] = useState<any>(null);
  const [replaceOrAddModalData, setReplaceOrAddModalData] = useState<any>(null);
  const [allowConfirmTarget, setAllowConfirmTarget] = useState<{ type: "transaction" | "expense"; id: number; date: string } | null>(null);
  const [isAllowing, setIsAllowing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
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

  const formatMoney = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
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
  }, [linkSearch, linkStartDate, linkEndDate, linkPage, showLinkPanel]);

  const loadUnlinkedData = async () => {
    try {
      const rootAmount = type === "transaction" ? activeTx?.amount : activeExpense?.amount;
      const rootDate = type === "transaction" ? activeTx?.date : activeExpense?.timestamp;
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
        setSuggestedExpenses(data.suggestedExpenses);
        
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
        setSuggestedTransactions(data.suggestedTransactions);
        
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

  useLiveEvent(["TRANSACTIONS_UPDATED", "EXPENSES_UPDATED", "RECONCILIATION_UPDATED"], () => {
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

      if (isInputFocused) return;

      if (showReceiptModal) {
        const receipts = activeExpense?.receipts || [];
        if (receipts.length > 1) {
          if (e.key === "ArrowLeft") {
            setActiveReceiptIdx(prev => Math.max(0, prev - 1));
          } else if (e.key === "ArrowRight") {
            setActiveReceiptIdx(prev => Math.min(receipts.length - 1, prev + 1));
          }
        }
      } else {
        if ((e.key === "a" || e.key === "A") && !isClosed) {
          if (type === "transaction" && suggestedExpenses.length > 0) {
            handleApproveSuggestedExpense(suggestedExpenses[0].id);
          } else if (type === "receipt" && suggestedTransactions.length > 0) {
            handleApproveSuggestedTx(suggestedTransactions[0].id);
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    showCreateModal, showReceiptModal, excludeTarget, ignoreTarget,
    actionChoiceModal, conflictModalData, overAllocatedModalData,
    replaceOrAddModalData, allowConfirmTarget, onClose,
    type, suggestedExpenses, suggestedTransactions, activeExpense, isClosed
  ]);

  const validateForm = async (formState: any, isTx: boolean): Promise<boolean> => {
    let amt = Number(formState.amount);
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

  const executeCreateAndLink = async (payload: any, overrideChartAccountId?: number, force: boolean = false) => {
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

      // Enforce correct sign for transactions
      if (type === "receipt" && payload.transactionType) {
        const out = payload.transactionType === 'DEBIT' || payload.transactionType === 'PAYMENT';
        if (out && amt > 0) amt = -amt;
        else if (!out && amt < 0) amt = Math.abs(amt);
        payload.amount = amt;
      }

      if (payload.chartAccountId) payload.chartAccountId = Number(payload.chartAccountId);
      if (payload.categoryAccountId) payload.categoryAccountId = Number(payload.categoryAccountId);

      const fullPayload = {
        ...payload,
        type,
        targetId: Number(id),
      };
      if (overrideChartAccountId !== undefined) {
        fullPayload.overrideChartAccountId = overrideChartAccountId;
      }
      if (force) {
        fullPayload.force = true;
      }
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

  const handleLink = async () => {
    if (selectedLinkId === null) return;
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

  const handleApproveSuggestedExpense = async (expId: number) => {
    if (!tx) return;
    if (expensesList.length > 0) {
      setReplaceOrAddModalData({ suggestedExpId: expId, isCreateMode: false, isSuggested: true });
      return;
    }
    await executeLink(expId, tx.id);
  };

  const handleApproveSuggestedTx = async (txId: number) => {
    if (!expense) return;
    if (transactionsList.length > 0) {
      setReplaceOrAddModalData({ suggestedTxId: txId, isCreateMode: false, isSuggested: true });
      return;
    }
    await executeLink(expense.id, txId);
  };

  const handleCreate = async () => {
    setIsSaving(true);
    try {
      if (type === "transaction" && tx) {
        const payload: any = { type: "transaction", targetId: tx.id, ...createForm, amount: Number(createForm.amount) };
        if (createForm.timestamp) payload.timestamp = new Date(createForm.timestamp).toISOString();
        if (createForm.date) payload.date = new Date(createForm.date).toISOString();
        if (createForm.chartAccountId) payload.chartAccountId = Number(createForm.chartAccountId);
        
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
        const payload: any = { type: "receipt", targetId: expense.id, ...createForm, amount: Number(createForm.amount) };
        if (createForm.date) payload.date = new Date(createForm.date).toISOString();
        if (createForm.timestamp) payload.timestamp = new Date(createForm.timestamp).toISOString();
        if (createForm.chartAccountId) payload.chartAccountId = Number(createForm.chartAccountId);
        if (createForm.categoryAccountId) payload.categoryAccountId = Number(createForm.categoryAccountId);
        
        if (transactionsList.length > 0) {
          setReplaceOrAddModalData({ createPayload: payload, isCreateMode: true });
          return;
        }
        await executeCreateAndLink(payload);
      }
      setCreateForm({});
    } finally { setIsSaving(false); }
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

  const inputCls = "w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-white focus:outline-none focus:border-zinc-500 transition-colors";
  const labelCls = "block text-xs font-medium text-zinc-400 mb-1";
  const btnSmGray = "text-xs text-zinc-400 hover:text-zinc-200 transition";
  const btnSmBlue = "text-xs text-blue-400 hover:text-blue-300 transition";
  const btnSmGreen = "text-xs text-emerald-400 hover:text-emerald-300 transition";

  const itemReviewStatus = type === "transaction" ? tx?.reviewStatus : expense?.reviewStatus;
  const itemAwaitingReview = itemReviewStatus === 'PENDING' && isDateInClosedPeriod;

  const renderLinkPicker = () => {
    if (!showLinkPanel) return null;
    return (
      <div className="border border-white/10 bg-zinc-900/90 rounded-2xl p-5 backdrop-blur-md mt-4 shadow-xl">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-4 border-b border-zinc-800 pb-3 gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>Link Existing {type === "transaction" ? "Expense" : "Transaction"}</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">Select a matching record to link.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400 font-medium">From</span>
              <Input type="date" value={linkStartDate} onChange={(e) => { setLinkStartDate(e.target.value); setLinkPage(1); }} className="text-xs py-1 w-32" title="Start Date" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400 font-medium">To</span>
              <Input type="date" value={linkEndDate} onChange={(e) => { setLinkEndDate(e.target.value); setLinkPage(1); }} className="text-xs py-1 w-32" title="End Date" />
            </div>
            <Input type="text" placeholder="Search Amount / Text..." value={linkSearch} onChange={(e) => { setLinkSearch(e.target.value); setLinkPage(1); }} className="w-full sm:w-40 text-xs py-1 flex-1" />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto border border-zinc-800 rounded-md bg-zinc-950 mb-3">
          {((type === "transaction" && unlinked.expenses.length === 0) || (type === "receipt" && unlinked.transactions.length === 0)) ? (
            <div className="p-6 text-center text-zinc-400 text-sm">No unlinked items available.</div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {type === "transaction" && unlinked.expenses.map(e => (
                <li key={e.id}>
                  <Card active={selectedLinkId === e.id} onClick={() => setSelectedLinkId(e.id)} className="flex-col! items-start! gap-1 cursor-pointer hover:bg-zinc-800/50">
                    <div className="w-full flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{formatMoney(e.amount)}</span>
                        {e.allocationStatus === "PARTIALLY_ALLOCATED" && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Under-Allocated</span>
                        )}
                        {e.chartAccount && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-purple-500/10 text-purple-300 border border-purple-500/20">
                            {e.chartAccount.code} {e.chartAccount.name}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-zinc-400">{formatDate(e.timestamp)}</span>
                    </div>
                    <div className="text-sm text-zinc-400 truncate w-full">{e.vendor} — {e.description}</div>
                  </Card>
                </li>
              ))}
              {type === "receipt" && unlinked.transactions.map(t => (
                <li key={t.id}>
                  <Card active={selectedLinkId === t.id} onClick={() => setSelectedLinkId(t.id)} className="flex-col! items-start! gap-1 cursor-pointer hover:bg-zinc-800/50">
                    <div className="w-full flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{formatMoney(t.amount)}</span>
                        {t.allocationStatus === "PARTIALLY_ALLOCATED" && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Under-Allocated</span>
                        )}
                        {t.chartAccount && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-blue-500/10 text-blue-300 border border-blue-500/20">
                            {t.chartAccount.code} {t.chartAccount.name}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-zinc-400">{formatDate(t.date)}</span>
                    </div>
                    <div className="text-sm text-zinc-400 truncate w-full">{t.description}</div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <Pagination currentPage={linkPage} totalPages={unlinkedTotalPages} onPageChange={setLinkPage} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setShowLinkPanel(false); setSelectedLinkId(null); }}>Cancel</Button>
            {selectedLinkId !== null && (
              <Button variant="info" size="sm" onClick={handleLink}>Confirm Link</Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!type || !id) return null;

  return ReactDOM.createPortal(
    <>
      <div className={`fixed inset-0 z-60 bg-black/60 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`} onClick={handleClose} />
      <div className={`fixed inset-y-0 right-0 z-70 w-full lg:w-[85vw] lg:max-w-5xl bg-zinc-950/90 backdrop-blur-3xl border-l border-white/10 flex flex-col shadow-2xl transform transition-transform duration-300 ease-out ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">{type === "transaction" ? "Transaction Details" : "Expense Details"}</h2>
            {isLoading && (
              <LoadingSpinner size="sm" color="text-emerald-400" />
            )}
          </div>
          <Button variant="ghost" onClick={handleClose} className="p-0! w-8 h-8 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </Button>
        </div>

        {hasBackgroundUpdate && (
          <div className="mx-6 mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>A background process updated this record. Your unsaved edits are preserved.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button 
                type="button" 
                onClick={() => { setHasBackgroundUpdate(false); loadData(false); }} 
                className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg font-semibold transition cursor-pointer"
              >
                Reload Record
              </button>
              <button 
                type="button" 
                onClick={() => setHasBackgroundUpdate(false)} 
                className="px-2.5 py-1 text-zinc-400 hover:text-white transition cursor-pointer"
              >
                Keep My Changes
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch relative">
                
                {/* DIVIDER LINE */}
                <div className="hidden lg:block absolute left-1/2 top-4 bottom-4 w-px bg-zinc-800 -translate-x-1/2 z-0" />

                {/* UNLINK MIDDLE BUTTON */}
                {activeExpense && activeTx && !isClosed && !isEditingExpense && !isEditingTx && (
                  <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                    <Button 
                       onClick={handleUnlink} 
                       variant="secondary" 
                       className="rounded-full shadow-2xl border border-red-500/30 bg-black text-zinc-400 hover:text-red-400 hover:bg-red-500/10 p-3 flex flex-col items-center justify-center w-14 h-14 transition-colors cursor-pointer" 
                       title="Unlink Pair"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.73 21a2 2 0 01-3.46 0m9.73-8v-3a2 2 0 00-2-2h-3m-6 0H5a2 2 0 00-2 2v3m12 0l-4 4m0 0l-4-4m4 4V10" /></svg>
                      <span className="text-[9px] font-bold mt-0.5 uppercase tracking-wider">Unlink</span>
                    </Button>
                  </div>
                )}

                {/* EXPENSE COLUMN */}
                <div className={`bg-white/2 border border-white/5 rounded-2xl p-6 backdrop-blur-md shadow-lg flex flex-col relative z-10 transition-colors duration-200 ${
                  isEditingExpense ? 'ring-1 ring-emerald-500/20' : ''
                }`}>
                  {isDeposit ? (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-400 text-center h-full">
                      <svg className="w-12 h-12 mb-3 opacity-20 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <h3 className="text-lg font-bold text-emerald-400/50 mb-2">Income Categorization</h3>
                      <p className="max-w-xs text-sm">Deposits don't require expense receipts. Edit the transaction details to assign a Revenue Account.</p>
                      {!isEditingTx && !activeTx?.categoryAccountId && (
                        <Button variant="primary" onClick={() => setIsEditingTx(true)} className="mt-4">Categorize Deposit</Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-zinc-800 pb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          <h2 className="text-xl font-bold">Expense Details</h2>
                          {activeExpense && (
                            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${activeExpense.isManual ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}`}>{activeExpense.isManual ? "Manual" : "AI Extracted"}</span>
                          )}
                          {expensesList.length > 1 && <span className="text-xs text-zinc-400 ml-1 whitespace-nowrap">({expensesList.length} linked)</span>}
                        </div>
                        {activeExpense && (
                          isEditingExpense ? (
                            <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingExpense(false)} className={btnSmGray}>Cancel</Button><Button variant="primary" size="sm" onClick={handleSaveExpense} >Save</Button></div>
                          ) : !isClosed ? (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setIsSplitModalOpen(true)}
                                className="text-amber-300 border-amber-500/30 hover:bg-amber-500/10 font-medium"
                                title="Split receipt into multiple items (e.g. personal vs business)"
                              >
                                ✂ Split Receipt
                              </Button>
                              <Button variant="ghost" onClick={() => setIsEditingExpense(true)} className={btnSmGreen}>Edit</Button>
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
                        if (!item) return <div className="py-6 text-zinc-400 text-center">No Expense Linked</div>;

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
                          <div className="space-y-4 flex-1">
                            {e.reviewStatus === "WARNINGS_IGNORED" ? (
                              <div className="mb-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 p-3 rounded-xl text-sm flex items-center justify-between italic">
                                <span>Warnings have been ignored for this item.</span>
                                <Button variant="ghost" size="sm" onClick={async () => {
                                  await resolveReviewItems("restore_warnings", [], [e.id]);
                                  await loadData();
                                }} className="text-blue-200 hover:text-white px-3 py-1 h-auto text-xs not-italic bg-blue-500/20 hover:bg-blue-500/40 rounded">Undo</Button>
                              </div>
                            ) : warnings.length > 0 && !isEditingExpense && (
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
                                    <label className="text-xs text-zinc-400 block mb-1">Total</label>
                                    <MoneyInput value={form.amount} onChange={val => setForm({ ...form, amount: val })} />
                                  </div>
                                  <div className="w-24">
                                    <label className="text-xs text-zinc-400 block mb-1">Tax</label>
                                    <MoneyInput value={form.taxAmount || 0} onChange={val => setForm({ ...form, taxAmount: val })} />
                                  </div>
                                  <div className="w-24">
                                    <label className="text-xs text-zinc-400 block mb-1">Currency</label>
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
                                  <p className="text-xl font-semibold">{formatMoney(e.amount)}</p>
                                  {(e.taxAmount > 0 || (e.currencyCode && e.currencyCode !== 'USD')) && (
                                    <p className="text-sm text-zinc-400">
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
                              onClick={() => { setShowLinkPanel(p => !p); setSelectedLinkId(null); }}
                              className="w-full text-xs font-semibold px-2 py-1.5 justify-center"
                              title={showLinkPanel ? "Close Link Picker" : "Link Existing Expense"}
                            >
                              <span className="truncate">
                                {showLinkPanel ? "Close Picker" : (
                                  <>Link Existing <span className="hidden xl:inline">Expense</span></>
                                )}
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
                                const txAmtStr = remainingTxAmt > 0 ? String(remainingTxAmt) : (targetTx?.amount ? String(Math.abs(targetTx.amount)) : '');
                                const txVendor = targetTx?.description || '';
                                const txCatId = targetTx?.categoryAccountId || '';
                                setCreateForm({
                                  timestamp: txDateStr,
                                  vendor: extractCleanVendor(txVendor),
                                  description: txVendor,
                                  amount: txAmtStr,
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
                                    <Button variant="ghost" disabled className="text-xs text-zinc-500 pointer-events-none">Ignore Warnings</Button>
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
                <div className={`bg-white/2 border border-white/5 rounded-2xl p-6 backdrop-blur-md shadow-lg flex flex-col relative z-10 transition-colors duration-200 ${
                  isEditingTx ? 'ring-1 ring-blue-500/20' : ''
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-zinc-800 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <svg className="w-5 h-5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      <h2 className="text-xl font-bold">Bank Transaction</h2>
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
                        <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setIsEditingTx(true)} className={btnSmBlue}>Edit</Button><Button variant="danger" size="sm" onClick={handleDeleteTx} >Delete</Button></div>
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
                              <p className="text-xl font-semibold">{formatMoney(t.amount)}</p>
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
                                            <span className="text-zinc-500 italic text-xs">Uncategorized</span>
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

                  {type === "receipt" && !isClosed && activeExpense?.tender?.toLowerCase() !== "cash" && (
                    <>
                      <div className="mt-4 pt-3 border-t border-zinc-800 grid grid-cols-2 gap-2">
                        <Button
                          variant={showLinkPanel ? "info" : "secondary"}
                          size="sm"
                          onClick={() => { setShowLinkPanel(p => !p); setSelectedLinkId(null); }}
                          className="w-full text-xs font-semibold px-2 py-1.5 justify-center"
                          title={showLinkPanel ? "Close Link Picker" : "Link Existing Transaction"}
                        >
                          <span className="truncate">
                            {showLinkPanel ? "Close Picker" : (
                              <>Link Existing <span className="hidden xl:inline">Transaction</span></>
                            )}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowCreateModal(true);
                            const remainingAmt = activeExpense ? Math.max(0, activeExpense.amount - transactionsList.reduce((s, ct) => s + Math.abs(ct.amount), 0)) : 0;

                            let defaultBankId: number | '' = '';
                            const tender = activeExpense?.tender?.toLowerCase();
                            if (tender === 'card') {
                              const cc = accounts.find(a => a.type === 'LIABILITY' && a.code.startsWith('20') && a.active);
                              defaultBankId = cc ? cc.id : (accounts.find(a => a.type === 'ASSET' && a.code === '1010' && a.active)?.id || '');
                            } else if (tender === 'cash') {
                              const cashAcc = accounts.find(a => a.code === '1030' && a.active);
                              defaultBankId = cashAcc ? cashAcc.id : '';
                            } else {
                              const checking = accounts.find(a => a.code === '1010' && a.active);
                              defaultBankId = checking ? checking.id : (accounts.find(a => (a.type === 'ASSET' || a.type === 'LIABILITY') && a.active)?.id || '');
                            }

                            setCreateForm({
                              date: activeExpense?.timestamp ? activeExpense.timestamp.split('T')[0] : '',
                              description: activeExpense?.vendor ? `${activeExpense.vendor}${activeExpense.description ? ` - ${activeExpense.description}` : ''}` : (activeExpense?.description || ''),
                              amount: remainingAmt > 0 ? remainingAmt : (activeExpense?.amount || ''),
                              transactionType: 'DEBIT',
                              chartAccountId: defaultBankId,
                              categoryAccountId: activeExpense?.chartAccountId || '',
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
                                <Button variant="ghost" disabled className="text-xs text-zinc-500 pointer-events-none">Ignore Warnings</Button>
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

              {/* SUGGESTED MATCHES */}
              {type === "transaction" && suggestedExpenses.length > 0 && (
                <div className="border border-blue-900/50 bg-blue-900/10 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      <h3 className="text-base font-bold text-blue-400">Suggested Match{suggestedExpenses.length > 1 ? 'es' : ''}</h3>
                    </div>
                    {!isClosed && (
                      <span className="text-[11px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700">
                        Press <kbd className="font-mono text-zinc-200 font-bold">A</kbd> to quick-approve
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-300 text-xs mb-3.5">Review scoring details below and approve if correct.</p>
                  <div className="space-y-3">
                    {suggestedExpenses.map(e => {
                      const matchInfo = computeMatchScore(
                        activeTx?.amount || 0,
                        activeTx?.date || '',
                        activeTx?.description || '',
                        e.amount,
                        e.timestamp,
                        e.vendor
                      );

                      return (
                        <div key={e.id} className="border border-blue-900/40 bg-zinc-950 rounded-xl p-3.5 flex flex-col gap-2.5">
                          <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 pb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                matchInfo.score >= 90 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                matchInfo.score >= 75 ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                                'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}>
                                {matchInfo.score}% {matchInfo.label}
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {matchInfo.reasons.map((r, ri) => (
                                  <span key={ri} className="text-[10px] text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                                    ✓ {r}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <Button 
                              variant="primary" 
                              size="sm"
                              onClick={() => handleApproveSuggestedExpense(e.id)} 
                              className="font-bold text-xs shrink-0"
                            >
                              Approve Link
                            </Button>
                          </div>

                          <div className="text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><span className="text-zinc-500 text-[10px] block">Amount</span> <span className="font-bold text-white">{formatMoney(e.amount)}</span></div>
                            <div><span className="text-zinc-500 text-[10px] block">Date</span> <span className="text-zinc-300">{formatDate(e.timestamp)}</span></div>
                            <div><span className="text-zinc-500 text-[10px] block">Vendor</span> <span className="text-zinc-300 truncate block">{e.vendor || 'Unknown'}</span></div>
                            <div><span className="text-zinc-500 text-[10px] block">Category</span> <span className="text-zinc-300 truncate block">{e.chartAccount?.name || 'Uncategorized'}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {type === "receipt" && suggestedTransactions.length > 0 && (
                <div className="border border-blue-900/50 bg-blue-900/10 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      <h3 className="text-base font-bold text-blue-400">Suggested Match{suggestedTransactions.length > 1 ? 'es' : ''}</h3>
                    </div>
                    {!isClosed && (
                      <span className="text-[11px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700">
                        Press <kbd className="font-mono text-zinc-200 font-bold">A</kbd> to quick-approve
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-300 text-xs mb-3.5">Review scoring details below and approve if correct.</p>
                  <div className="space-y-3">
                    {suggestedTransactions.map(t => {
                      const matchInfo = computeMatchScore(
                        t.amount,
                        t.date,
                        t.description,
                        activeExpense?.amount || 0,
                        activeExpense?.timestamp || '',
                        activeExpense?.vendor || ''
                      );

                      return (
                        <div key={t.id} className="border border-blue-900/40 bg-zinc-950 rounded-xl p-3.5 flex flex-col gap-2.5">
                          <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 pb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                matchInfo.score >= 90 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                matchInfo.score >= 75 ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                                'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}>
                                {matchInfo.score}% {matchInfo.label}
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {matchInfo.reasons.map((r, ri) => (
                                  <span key={ri} className="text-[10px] text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                                    ✓ {r}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <Button 
                              variant="primary" 
                              size="sm"
                              onClick={() => handleApproveSuggestedTx(t.id)} 
                              className="font-bold text-xs shrink-0"
                            >
                              Approve Link
                            </Button>
                          </div>

                          <div className="text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><span className="text-zinc-500 text-[10px] block">Amount</span> <span className="font-bold text-white">{formatMoney(t.amount)}</span></div>
                            <div><span className="text-zinc-500 text-[10px] block">Date</span> <span className="text-zinc-300">{formatDate(t.date)}</span></div>
                            <div className="col-span-2"><span className="text-zinc-500 text-[10px] block">Description</span> <span className="text-zinc-300 truncate block">{t.description}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </>
          )}
        </div>
      </div>

      {/* RECEIPT IMAGE MODAL */}
      {showReceiptModal && (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-4xl w-full flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-zinc-700 flex justify-between items-center">
              <h3 className="font-bold text-lg">Physical Receipt</h3>
              <Button variant="ghost" onClick={() => setShowReceiptModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </Button>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-zinc-950 min-h-[50vh]">
              {(() => {
                const receipts = activeExpense?.receipts;
                return receipts && receipts.length > 0 ? (
                    <div className="w-full flex flex-col items-center py-4 relative">
                      {receipts.length > 1 && (
                        <div className="flex w-full justify-between px-4 absolute top-1/2 -translate-y-1/2 z-10">
                          <Button variant="ghost" className="bg-black/50 text-white rounded-full p-2 hover:bg-black/70" onClick={() => setActiveReceiptIdx(Math.max(0, activeReceiptIdx - 1))} disabled={activeReceiptIdx === 0}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                          </Button>
                          <Button variant="ghost" className="bg-black/50 text-white rounded-full p-2 hover:bg-black/70" onClick={() => setActiveReceiptIdx(Math.min(receipts.length - 1, activeReceiptIdx + 1))} disabled={activeReceiptIdx === receipts.length - 1}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                          </Button>
                        </div>
                      )}
                      
                      {(() => {
                        const receipt = receipts[activeReceiptIdx];
                        if (!receipt) {
                          if (activeReceiptIdx > 0) setTimeout(() => setActiveReceiptIdx(0), 0);
                          return null;
                        }
                        const filename = receipt.documentUri.split('/').pop();
                        const fileUrl = `/api/images/${filename}`;
                        const isPdf = receipt.fileExt.toLowerCase() === '.pdf';
                        return (
                          <div key={receipt.id} className="w-full flex flex-col items-center">
                            {isPdf ? (
                              <iframe src={fileUrl} className="w-full h-[75vh] rounded-md bg-white border border-zinc-700" title={`Receipt ${receipt.id}`} />
                            ) : (
                              <img src={fileUrl} alt={`Receipt ${receipt.id}`} className="max-w-full max-h-[75vh] object-contain rounded-md border border-zinc-700" />
                            )}
                            <p className="text-zinc-400 text-xs mt-4 mb-2">{filename}</p>
                            {receipts.length > 1 && (
                              <p className="text-zinc-500 text-xs font-semibold">Image {activeReceiptIdx + 1} of {receipts.length}</p>
                            )}
                            {!isClosed && (
                              <div className="mt-4">
                                <Button variant="danger" size="sm" onClick={() => handleDeleteReceipt(receipt.id)} disabled={isSaving}>
                                  {isSaving ? "Deleting..." : "Delete Receipt"}
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-400 min-h-[50vh]">
                    <p>No physical receipt attached.</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* CREATE & LINK MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-bold text-lg">Create & Link {type === "transaction" ? "Expense" : "Transaction"}</h3>
              <Button variant="ghost" onClick={() => setShowCreateModal(false)} className="text-zinc-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </Button>
            </div>
            <div className="p-5 space-y-4">
              {type === "transaction" ? (
                <CreateExpenseForm form={createForm} setForm={setCreateForm} accounts={accounts} />
              ) : (
                <CreateTransactionForm form={createForm} setForm={setCreateForm} accounts={accounts} />
              )}
            </div>
            <div className="p-5 border-t border-zinc-800 flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button variant="ghost" onClick={handleCreate} disabled={isSaving} className="px-5 py-2 bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {isSaving ? 'Saving…' : 'Create & Link'}
              </Button>
            </div>
          </div>
        </div>
      )}

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

      {ignoreTarget && (
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="font-bold text-lg text-white">Ignore Warnings</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl text-sm text-orange-200/90 leading-relaxed">
                <p className="font-bold text-orange-400 mb-1">Are you sure?</p>
                This will mark the item as reviewed and ignore any warnings (like missing receipts or rule mismatches). The item stays in the books, but no longer requires review.
              </div>
              {ignoreTarget.linkedChoice && (
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-xl text-sm font-medium">
                  {ignoreTarget.linkedChoice === "ONLY_THIS" 
                    ? "You chose to sever the link(s) and only ignore warnings for this specific item." 
                    : "You chose to keep the link(s) intact and ignore warnings for all linked items."}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-800/50">
              <Button variant="ghost" onClick={() => setIgnoreTarget(null)}>Cancel</Button>
              <Button 
                variant="primary" 
                disabled={isSaving}
                className="bg-orange-600 hover:bg-orange-500 text-white border-transparent"
                onClick={async () => {
                  setIsSaving(true);
                  try {
                    if (ignoreTarget.linkedChoice === "ONLY_THIS") {
                      if (ignoreTarget.type === "transaction") {
                        for (const e of confirmedExpenses) await unlinkExpenseFromTransaction(e.id, ignoreTarget.id);
                      } else {
                        for (const t of confirmedTransactions) await unlinkExpenseFromTransaction(ignoreTarget.id, t.id);
                      }
                      
                      if (ignoreTarget.type === "transaction") await resolveReviewItems("ignore_warnings", [ignoreTarget.id], []);
                      else await resolveReviewItems("ignore_warnings", [], [ignoreTarget.id]);
                    } else if (ignoreTarget.linkedChoice === "ALL_LINKED") {
                      const tIds = type === "transaction" && tx ? [tx.id] : confirmedTransactions.map(t => t.id);
                      const eIds = type === "receipt" && expense ? [expense.id] : confirmedExpenses.map(e => e.id);
                      await resolveReviewItems("ignore_warnings", tIds, eIds);
                    } else {
                      if (ignoreTarget.type === "transaction") await resolveReviewItems("ignore_warnings", [ignoreTarget.id], []);
                      else await resolveReviewItems("ignore_warnings", [], [ignoreTarget.id]);
                    }
                    setIgnoreTarget(null);
                    await loadData();
                  } catch (err: any) {
                    await alert({ title: "Ignore Failed", message: "Failed to ignore: " + err.message, variant: "danger" });
                  } finally {
                    setIsSaving(false);
                  }
                }}
              >
                {isSaving ? "Ignoring..." : "Confirm Ignore"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {actionChoiceModal && (
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="font-bold text-lg text-white">Linked Items Detected</h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                This item is currently linked to {actionChoiceModal.targetType === "transaction" ? "one or more expenses" : "a bank transaction"}. How would you like to proceed?
              </p>
            </div>
            <div className="p-5 space-y-3">
              <button 
                className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors"
                onClick={() => {
                  const data = actionChoiceModal;
                  setActionChoiceModal(null);
                  
                  if (data.action === "EXCLUDE") {
                    setExcludeTarget({ type: data.targetType, id: data.targetId, linkedChoice: "ONLY_THIS" });
                  } else {
                    setIgnoreTarget({ type: data.targetType, id: data.targetId, linkedChoice: "ONLY_THIS" });
                  }
                }}
              >
                <div className="font-medium text-white">Unlink & {actionChoiceModal.action === "EXCLUDE" ? "Exclude" : "Ignore"} Only This Item</div>
                <div className="text-xs text-zinc-400 mt-1">Sever the link(s) and only apply the action to the selected item.</div>
              </button>
              
              <button 
                className="w-full p-4 border border-zinc-700 rounded-lg hover:border-red-500 hover:bg-red-500/10 text-left transition-colors"
                onClick={() => {
                  const data = actionChoiceModal;
                  setActionChoiceModal(null);
                  
                  if (data.action === "EXCLUDE") {
                    setExcludeTarget({ type: data.targetType, id: data.targetId, linkedChoice: "ALL_LINKED" });
                  } else {
                    setIgnoreTarget({ type: data.targetType, id: data.targetId, linkedChoice: "ALL_LINKED" });
                  }
                }}
              >
                <div className="font-medium text-white">{actionChoiceModal.action === "EXCLUDE" ? "Exclude" : "Ignore"} All Linked Items</div>
                <div className="text-xs text-zinc-400 mt-1">Keep the link(s) intact and apply the action to the entire group.</div>
              </button>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end bg-zinc-800/50">
              <Button variant="ghost" onClick={() => setActionChoiceModal(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {conflictModalData && (
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="font-bold text-lg text-white">Category Mismatch</h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">The items you are trying to link have conflicting categories. Which category should both items use?</p>
            </div>
            <div className="p-5 space-y-3">
              <button 
                className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors"
                onClick={() => {
                  if (conflictModalData.isCreateMode) {
                    executeCreateAndLink(conflictModalData.createPayload, conflictModalData.txCategory.id);
                  } else {
                    executeLink(conflictModalData.expenseId, conflictModalData.transactionId, conflictModalData.txCategory.id);
                  }
                }}
              >
                <div className="font-medium text-white flex items-center gap-2">
                  <span>{conflictModalData.txCategory.code} — {conflictModalData.txCategory.name}</span>
                  {!conflictModalData.txCategory.active && (
                    <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold border border-red-500/30" title="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                      Archived
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-400 mt-1">Use the Bank Transaction's category</div>
              </button>
              
              <button 
                className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors"
                onClick={() => {
                  if (conflictModalData.isCreateMode) {
                    executeCreateAndLink(conflictModalData.createPayload, conflictModalData.expCategory.id);
                  } else {
                    executeLink(conflictModalData.expenseId, conflictModalData.transactionId, conflictModalData.expCategory.id);
                  }
                }}
              >
                <div className="font-medium text-white flex items-center gap-2">
                  <span>{conflictModalData.expCategory.code} — {conflictModalData.expCategory.name}</span>
                  {!conflictModalData.expCategory.active && (
                    <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold border border-red-500/30" title="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                      Archived
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-400 mt-1">Use the Expense's category</div>
              </button>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end bg-zinc-800/50">
              <Button variant="ghost" onClick={() => setConflictModalData(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {replaceOrAddModalData && (
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="font-bold text-lg text-white">Already Linked</h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                This {type === "transaction" ? "transaction" : "expense"} is already linked to another item. Do you want to add this new link (e.g., for a split payment) or replace the existing linked item(s) entirely?
              </p>
            </div>
            <div className="p-5 space-y-3">
              <button 
                className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors"
                onClick={() => {
                  const data = replaceOrAddModalData;
                  setReplaceOrAddModalData(null);
                  if (data.isSuggested) {
                    if (data.suggestedExpId && tx) executeLink(data.suggestedExpId, tx.id);
                    if (data.suggestedTxId && expense) executeLink(expense.id, data.suggestedTxId);
                  } else if (data.isCreateMode) {
                    executeCreateAndLink(data.createPayload);
                  } else {
                    if (type === "transaction" && tx) executeLink(data.selectedLinkId, tx.id);
                    else if (expense) executeLink(expense.id, data.selectedLinkId);
                  }
                }}
              >
                <div className="font-medium text-white">Add to Existing (Split)</div>
                <div className="text-xs text-zinc-400 mt-1">Keep current links and add this new one.</div>
              </button>
              
              <button 
                className="w-full p-4 border border-zinc-700 rounded-lg hover:border-red-500 hover:bg-red-500/10 text-left transition-colors"
                onClick={async () => {
                  const data = replaceOrAddModalData;
                  setReplaceOrAddModalData(null);
                  setIsSaving(true);
                  try {
                    // Unlink existing first
                    if (type === "transaction" && tx) {
                      for (const e of confirmedExpenses) await unlinkExpenseFromTransaction(e.id, tx.id);
                    } else if (type === "receipt" && expense) {
                      for (const t of confirmedTransactions) await unlinkExpenseFromTransaction(expense.id, t.id);
                    }
                    
                    // Then execute the link
                    if (data.isSuggested) {
                      if (data.suggestedExpId && tx) await executeLink(data.suggestedExpId, tx.id);
                      if (data.suggestedTxId && expense) await executeLink(expense.id, data.suggestedTxId);
                    } else if (data.isCreateMode) {
                      await executeCreateAndLink(data.createPayload);
                    } else {
                      if (type === "transaction" && tx) await executeLink(data.selectedLinkId, tx.id);
                      else if (expense) await executeLink(expense.id, data.selectedLinkId);
                    }
                  } catch (err: any) {
                    await alert({ title: "Replace Links Failed", message: "Failed to replace links: " + err.message, variant: "danger" });
                  } finally {
                    setIsSaving(false);
                    loadData(true);
                  }
                }}
              >
                <div className="font-medium text-white">Replace Existing</div>
                <div className="text-xs text-zinc-400 mt-1">Remove current links and only keep this new one.</div>
              </button>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end bg-zinc-800/50">
              <Button variant="ghost" onClick={() => setReplaceOrAddModalData(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {overAllocatedModalData && (
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="font-bold text-lg text-white">Amount Mismatch</h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{overAllocatedModalData.message}</p>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-800/50">
              <Button variant="ghost" onClick={() => setOverAllocatedModalData(null)}>Cancel</Button>
              <Button 
                variant="primary" 
                onClick={() => {
                  if (overAllocatedModalData.isCreateMode) {
                    executeCreateAndLink(overAllocatedModalData.createPayload, overAllocatedModalData.overrideChartAccountId, true);
                  } else {
                    executeLink(overAllocatedModalData.expenseId, overAllocatedModalData.transactionId, overAllocatedModalData.overrideChartAccountId, true);
                  }
                }}
              >
                Link Anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      {allowConfirmTarget && (
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="font-bold text-lg text-white">Reopen Books to Allow Item</h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                Allowing this item will approve it and reopen your books back to{" "}
                <strong className="text-white">
                  {(() => {
                    const d = new Date(allowConfirmTarget.date);
                    d.setDate(d.getDate() - 1);
                    return d.toISOString().split("T")[0];
                  })()}
                </strong>{" "}
                (the day before this item). Any linked items and subsequent pending items will be approved automatically.
              </p>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-800/50">
              <Button variant="ghost" onClick={() => setAllowConfirmTarget(null)}>Cancel</Button>
              <Button
                variant="primary"
                isLoading={isAllowing}
                onClick={async () => {
                  setIsAllowing(true);
                  try {
                    await resolveReviewItems(
                      "allow",
                      allowConfirmTarget.type === "transaction" ? [allowConfirmTarget.id] : [],
                      allowConfirmTarget.type === "expense" ? [allowConfirmTarget.id] : []
                    );
                    setAllowConfirmTarget(null);
                    await loadData();
                  } catch (err: any) {
                    await alert({ title: "Allow Item Failed", message: "Failed to allow item: " + err.message, variant: "danger" });
                  } finally {
                    setIsAllowing(false);
                  }
                }}
              >
                Confirm & Reopen Books
              </Button>
            </div>
          </div>
        </div>
      )}
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
