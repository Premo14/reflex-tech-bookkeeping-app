import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Modal } from "./ui/Modal";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import Pagination from "./ui/Pagination";
import {
  getReviewQueue,
  getReviewQueueCounts,
  resolveReviewItems,
  restoreItems,
  getFlaggedItems,
  deleteItemsBulk,
  restoreDeletedItems,
  moveDeletedToExcluded,
  deleteItemsPermanent,
  getChartAccounts,
  batchCategorizeItems,
  type ReviewStatusType,
} from "../services/api";
import { useLiveEvent } from "../utils/useLiveSync";
import ExcludeItemModal from "./ExcludeItemModal";
import { EXCLUSION_REASON_LABELS, matchesAmountQuery } from "../utils/ledgerStatus";
import { toCents } from "../utils/formatCurrency";
import DetailDrawer from "./DetailDrawer";
import type { BankTransaction, Expense, ExclusionReason, ChartAccount, Invoice } from "../types/models";
import {
  PAGE_SIZE,
  QUEUE_TABS,
  appendExpenseRow,
  appendTransactionRow,
  appendInvoiceRow,
  computeDaysRemaining,
  computeTargetReopenDate,
  getBannerConfig,
  getErrorMessage,
  isItemDateClosed,
  resolveAllocationIssue,
  type IssueType,
  type ReviewRow,
} from "./review/reviewHelpers";
import { ReviewFilterBar } from "./review/ReviewFilterBar";
import { ReviewBulkToolbar } from "./review/ReviewBulkToolbar";
import { ReviewRowCard } from "./review/ReviewRowCard";
import { ReviewConfirmModals } from "./review/ReviewConfirmModals";

interface ReviewModalProps {
  isOpen: boolean;
  suspended?: boolean;
  onClose: () => void;
  statusType: ReviewStatusType;
  refreshData: () => void;
}

export default function ReviewModal({ isOpen, suspended = false, onClose, statusType, refreshData }: ReviewModalProps) {
  const [rows, setRows] = useState<RowState>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [issueFilter, setIssueFilter] = useState("ALL");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [info, setInfo] = useState("");
  const [drawerConfig, setDrawerConfig] = useState<{ type: "transaction" | "expense" | "invoice" | null; id: number | null }>({
    type: null,
    id: null,
  });
  const [showAllowConfirm, setShowAllowConfirm] = useState(false);
  const [showExcludeModal, setShowExcludeModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPermanentDeleteConfirm, setShowPermanentDeleteConfirm] = useState(false);
  const [showMoveToExcludedModal, setShowMoveToExcludedModal] = useState(false);
  const [moveToExcludedReason, setMoveToExcludedReason] = useState<ExclusionReason | "">("");
  const [moveToExcludedNote, setMoveToExcludedNote] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [isBulkCategorizing, setIsBulkCategorizing] = useState(false);

  const selectAllRef = useRef<HTMLInputElement>(null);
  const activeRequestId = useRef(0);

  const [activeTab, setActiveTab] = useState<ReviewStatusType>(statusType);
  const [tabCounts, setTabCounts] = useState<Record<ReviewStatusType, number>>({
    PENDING: 0,
    IGNORED: 0,
    WARNINGS_IGNORED: 0,
    DELETED: 0,
  });
  const [isBannerExpanded, setIsBannerExpanded] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const isPending = activeTab === "PENDING";
  const isIgnored = activeTab === "IGNORED";
  const isWarningsIgnored = activeTab === "WARNINGS_IGNORED";

  const fetchTabCounts = useCallback(async () => {
    try {
      const data = await getReviewQueueCounts();
      setTabCounts({
        PENDING: data.pending ?? 0,
        IGNORED: data.excluded ?? 0,
        WARNINGS_IGNORED: data.warningsIgnored ?? 0,
        DELETED: data.deleted ?? 0,
      });
    } catch (err) {
      console.error("Failed to fetch review queue counts:", err);
    }
  }, []);

  useLiveEvent(["QUEUE_UPDATED", "RECONCILIATION_UPDATED"], () => {
    if (isOpen) {
      fetchTabCounts();
    }
  });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (typeFilter !== "ALL") count++;
    if (issueFilter !== "ALL") count++;
    if (accountFilter !== "ALL") count++;
    if (categoryFilter !== "ALL") count++;
    if (sortBy !== "date_desc") count++;
    return count;
  }, [typeFilter, issueFilter, accountFilter, categoryFilter, sortBy]);

  const resetFilters = useCallback(() => {
    setTypeFilter("ALL");
    setIssueFilter("ALL");
    setAccountFilter("ALL");
    setCategoryFilter("ALL");
    setSortBy("date_desc");
  }, []);

  const bannerConfig = useMemo(() => getBannerConfig(activeTab), [activeTab]);

  const loadData = useCallback(async (targetTab: ReviewStatusType, silent = true) => {
    const reqId = ++activeRequestId.current;
    if (!silent) setIsLoading(true);

    try {
      const queueRes = await getReviewQueue(targetTab);
      if (reqId !== activeRequestId.current) return;

      const closedDate = queueRes.booksClosedDate || "";
      const rowMap = new Map<string, ReviewRow>();

      if (targetTab === "PENDING") {
        (queueRes.transactions || []).forEach((tx: BankTransaction) => {
          const isClosed = tx.reviewStatus === "PENDING" && isItemDateClosed(closedDate, tx.date);
          const issues: IssueType[] = [];
          if (isClosed) {
            issues.push("CLOSED_PERIOD");
          }
          if (tx.allocationStatus && tx.allocationStatus !== "BALANCED") {
            issues.push(resolveAllocationIssue(tx.allocationStatus, tx.linkStatus));
          }
          if (issues.length === 0) {
            issues.push(isClosed ? "CLOSED_PERIOD" : "UNLINKED");
          }
          appendTransactionRow(rowMap, closedDate, tx, issues);
        });
        (queueRes.expenses || []).forEach((exp: Expense) => {
          const isClosed = exp.reviewStatus === "PENDING" && isItemDateClosed(closedDate, exp.timestamp);
          const issues: IssueType[] = [];
          if (isClosed) {
            issues.push("CLOSED_PERIOD");
          }
          if (exp.allocationStatus && exp.allocationStatus !== "BALANCED") {
            issues.push(resolveAllocationIssue(exp.allocationStatus, exp.linkStatus));
          }
          if (issues.length === 0) {
            issues.push(isClosed ? "CLOSED_PERIOD" : "UNLINKED");
          }
          appendExpenseRow(rowMap, closedDate, exp, issues);
        });
        (queueRes.invoices || []).forEach((inv: Invoice) => {
          const isClosed = inv.reviewStatus === "PENDING" && isItemDateClosed(closedDate, inv.issueDate);
          const issues: IssueType[] = [];
          if (isClosed) {
            issues.push("CLOSED_PERIOD");
          }
          if (inv.status === "OVERDUE") {
            issues.push("OVERDUE");
          } else if (inv.status === "SENT") {
            issues.push("UNPAID");
          } else if (inv.status === "PARTIALLY_PAID") {
            issues.push("UNDER_ALLOCATED");
          }
          if (issues.length === 0) {
            issues.push(isClosed ? "CLOSED_PERIOD" : "UNPAID");
          }
          appendInvoiceRow(rowMap, closedDate, inv, issues);
        });

        try {
          const flagged = await getFlaggedItems();
          if (reqId !== activeRequestId.current) return;
          (flagged.transactions || []).forEach((tx: BankTransaction) => {
            const issue = resolveAllocationIssue(tx.allocationStatus, tx.linkStatus);
            appendTransactionRow(rowMap, closedDate, tx, [issue]);
          });
          (flagged.expenses || []).forEach((exp: Expense) => {
            const issue = resolveAllocationIssue(exp.allocationStatus, exp.linkStatus);
            appendExpenseRow(rowMap, closedDate, exp, [issue]);
          });
        } catch (err) {
          setErrors((prev) => [...prev, `Failed to load flagged items: ${getErrorMessage(err, "network error")}`]);
        }
      } else if (targetTab === "IGNORED") {
        (queueRes.transactions || []).forEach((tx: BankTransaction) => {
          appendTransactionRow(rowMap, closedDate, tx, ["IGNORED"]);
        });
        (queueRes.expenses || []).forEach((exp: Expense) => {
          appendExpenseRow(rowMap, closedDate, exp, ["IGNORED"]);
        });
        (queueRes.invoices || []).forEach((inv: Invoice) => {
          appendInvoiceRow(rowMap, closedDate, inv, ["IGNORED"]);
        });
      } else if (targetTab === "WARNINGS_IGNORED") {
        (queueRes.transactions || []).forEach((tx: BankTransaction) => {
          const subIssue = resolveAllocationIssue(tx.allocationStatus, tx.linkStatus);
          appendTransactionRow(rowMap, closedDate, tx, ["WARNINGS_IGNORED", subIssue]);
        });
        (queueRes.expenses || []).forEach((exp: Expense) => {
          const subIssue = resolveAllocationIssue(exp.allocationStatus, exp.linkStatus);
          appendExpenseRow(rowMap, closedDate, exp, ["WARNINGS_IGNORED", subIssue]);
        });
        (queueRes.invoices || []).forEach((inv: Invoice) => {
          const subIssue: IssueType = inv.status === "OVERDUE" ? "OVERDUE" : "UNPAID";
          appendInvoiceRow(rowMap, closedDate, inv, ["WARNINGS_IGNORED", subIssue]);
        });
      } else if (targetTab === "DELETED") {
        (queueRes.transactions || []).forEach((tx: BankTransaction) => {
          appendTransactionRow(rowMap, closedDate, tx, ["DELETED"], {
            deletedAt: tx.deletedAt,
            daysRemaining: computeDaysRemaining(tx.deletedAt),
            clearReason: true,
          });
        });
        (queueRes.expenses || []).forEach((exp: Expense) => {
          appendExpenseRow(rowMap, closedDate, exp, ["DELETED"], {
            deletedAt: exp.deletedAt,
            daysRemaining: computeDaysRemaining(exp.deletedAt),
            clearReason: true,
          });
        });
        (queueRes.invoices || []).forEach((inv: Invoice) => {
          appendInvoiceRow(rowMap, closedDate, inv, ["DELETED"], {
            deletedAt: inv.deletedAt,
            daysRemaining: computeDaysRemaining(inv.deletedAt),
            clearReason: true,
          });
        });
      }

      if (reqId !== activeRequestId.current) return;
      const allRows = Array.from(rowMap.values());
      setRows(allRows);
      setTabCounts((prev) => ({ ...prev, [targetTab]: allRows.length }));

      setSelected((prev) => {
        const next = new Set<string>();
        for (const k of prev) {
          if (rowMap.has(k)) next.add(k);
        }
        return next;
      });
    } catch (err) {
      if (reqId !== activeRequestId.current) return;
      setErrors([getErrorMessage(err, "Failed to load review items")]);
    } finally {
      if (reqId === activeRequestId.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const resetTabState = useCallback(
    (targetTab: ReviewStatusType) => {
      setActiveTab(targetTab);
      setSearch("");
      resetFilters();
      setErrors([]);
      setInfo("");
      setSelected(new Set());
      setBulkCategory("");
      setCurrentPage(1);
      setRows([]);
    },
    [resetFilters]
  );

  useEffect(() => {
    if (!isOpen) return;
    resetTabState(statusType);
    getChartAccounts()
      .then((data) => setAccounts(data || []))
      .catch(() => {});
    fetchTabCounts();
    loadData(statusType, false);
  }, [isOpen, statusType, resetTabState, fetchTabCounts, loadData]);

  const switchTab = (newTab: ReviewStatusType) => {
    if (newTab === activeTab) return;
    resetTabState(newTab);
    loadData(newTab, false);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortBy, typeFilter, issueFilter, accountFilter, categoryFilter]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (typeFilter !== "ALL" && r.type !== typeFilter) return false;
      if (issueFilter !== "ALL") {
        if (isIgnored) {
          if (issueFilter === "LOCKED") {
            if (!r.isLocked) return false;
          } else if (issueFilter === "OPEN") {
            if (r.isLocked) return false;
          } else if (
            issueFilter === "DUPLICATE" ||
            issueFilter === "PERSONAL" ||
            issueFilter === "CLOSED_PERIOD" ||
            issueFilter === "OTHER"
          ) {
            if (r.reason !== issueFilter) return false;
          } else if (!r.issues.includes(issueFilter as IssueType)) {
            return false;
          }
        } else if (!r.issues.includes(issueFilter as IssueType)) {
          return false;
        }
      }
      if (accountFilter !== "ALL" && r.bankAccountId !== Number(accountFilter)) {
        return false;
      }
      if (categoryFilter !== "ALL") {
        if (categoryFilter === "UNCATEGORIZED") {
          if (r.categoryAccountId) return false;
        } else if (r.categoryAccountId !== Number(categoryFilter)) {
          return false;
        }
      }
      if (!q) return true;
      if (matchesAmountQuery(r.amount, q)) return true;

      const haystack = [
        r.title,
        r.subtitle,
        r.note,
        r.bankAccount && r.bankAccount.id > 0 ? `${r.bankAccount.code} ${r.bankAccount.name}` : "",
        r.categoryAccount && r.categoryAccount.id > 0 ? `${r.categoryAccount.code} ${r.categoryAccount.name}` : "",
        r.categoryAccountId ? "" : "uncategorized",
        r.transactionType || "",
        EXCLUSION_REASON_LABELS[r.reason] || r.reason,
        r.issues.join(" "),
        r.isLocked ? "locked closed period" : "open",
        r.daysRemaining !== undefined ? `${r.daysRemaining} days left` : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "date_asc":
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        case "amount_desc":
          return toCents(Math.abs(b.amount)) - toCents(Math.abs(a.amount));
        case "amount_asc":
          return toCents(Math.abs(a.amount)) - toCents(Math.abs(b.amount));
        default:
          return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
    });
    return sorted;
  }, [rows, isIgnored, search, sortBy, typeFilter, issueFilter, accountFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return visibleRows.slice(start, start + PAGE_SIZE);
  }, [visibleRows, currentPage]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const somePageSelected = paginatedRows.some((r) => selected.has(r.key));
  const allPageSelected = paginatedRows.length > 0 && paginatedRows.every((r) => selected.has(r.key));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = paginatedRows.length > 0 && somePageSelected && !allPageSelected;
    }
  }, [paginatedRows, somePageSelected, allPageSelected]);

  const toggleAllPage = () => {
    const next = new Set(selected);
    if (allPageSelected) {
      paginatedRows.forEach((r) => next.delete(r.key));
    } else {
      paginatedRows.forEach((r) => next.add(r.key));
    }
    setSelected(next);
  };

  const selectedRows = useMemo(() => visibleRows.filter((r) => selected.has(r.key)), [visibleRows, selected]);
  const totalSelected = selectedRows.length;

  const afterAction = useCallback(async () => {
    refreshData();
    fetchTabCounts();
    await loadData(activeTab, true);
  }, [refreshData, fetchTabCounts, loadData, activeTab]);

  const canMassAllow = isPending && totalSelected > 0 && selectedRows.every((r) => r.issues.includes("CLOSED_PERIOD"));
  const canIgnoreWarnings = isPending && totalSelected > 0 && selectedRows.every((r) => !r.issues.includes("CLOSED_PERIOD"));
  const canSendToQueue = isIgnored && totalSelected > 0 && selectedRows.every((r) => r.isLocked);
  const canDirectRestore = isIgnored && totalSelected > 0 && selectedRows.every((r) => !r.isLocked);

  const targetOpenDateStr = useMemo(() => computeTargetReopenDate(selectedRows), [selectedRows]);

  const handleResolve = useCallback(
    async (action: "pending" | "ignore_warnings" | "restore_warnings") => {
      if (totalSelected === 0) return;
      setIsResolving(true);
      setErrors([]);
      setInfo("");
      try {
        await resolveReviewItems(
          action,
          selectedRows.filter((r) => r.type === "transaction").map((r) => r.id),
          selectedRows.filter((r) => r.type === "expense").map((r) => r.id),
          selectedRows.filter((r) => r.type === "invoice").map((r) => r.id)
        );
        if (action === "ignore_warnings") {
          setInfo(`Silenced reconciliation warnings for ${totalSelected} item(s).`);
        } else if (action === "restore_warnings") {
          setInfo(`Restored reconciliation warnings for ${totalSelected} item(s).`);
        } else {
          setInfo(`Sent ${totalSelected} item(s) to the Review Queue.`);
        }
        await afterAction();
      } catch (err) {
        setErrors([getErrorMessage(err, "Action failed")]);
      } finally {
        setIsResolving(false);
      }
    },
    [totalSelected, selectedRows, afterAction]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement | null)?.tagName || "";
      if (["INPUT", "TEXTAREA", "SELECT"].includes(targetTag)) {
        return;
      }
      if (e.key === "Escape") {
        if (
          !showAllowConfirm &&
          !showExcludeModal &&
          !showDeleteConfirm &&
          !showPermanentDeleteConfirm &&
          !showMoveToExcludedModal &&
          !drawerConfig.id
        ) {
          onClose();
        }
      } else if (e.key === "c" || e.key === "C") {
        if (selected.size > 0) setSelected(new Set());
      } else if (e.key === "x" || e.key === "X") {
        if (selectedRows.length > 0 && isPending) setShowExcludeModal(true);
      } else if (e.key === "w" || e.key === "W") {
        if (canIgnoreWarnings) {
          void handleResolve("ignore_warnings");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    selected,
    selectedRows,
    canIgnoreWarnings,
    isPending,
    onClose,
    showAllowConfirm,
    showExcludeModal,
    showDeleteConfirm,
    showPermanentDeleteConfirm,
    showMoveToExcludedModal,
    drawerConfig.id,
    handleResolve,
  ]);

  const executeAllow = async () => {
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      const res = await resolveReviewItems(
        "allow",
        selectedRows.filter((r) => r.type === "transaction").map((r) => r.id),
        selectedRows.filter((r) => r.type === "expense").map((r) => r.id),
        selectedRows.filter((r) => r.type === "invoice").map((r) => r.id)
      );
      setShowAllowConfirm(false);
      let msg = "Items allowed.";
      if (res.rolledBack && res.booksClosedDate) {
        msg += ` The books were reopened back to ${res.booksClosedDate}.`;
      }
      if (res.autoApproved && res.autoApproved > 0) {
        msg += ` ${res.autoApproved} subsequent pending item(s) were automatically approved.`;
      }
      setInfo(msg);
      await afterAction();
    } catch (err) {
      setErrors([getErrorMessage(err, "Failed to allow items")]);
    } finally {
      setIsResolving(false);
    }
  };

  const handleBulkCategorize = async () => {
    if (!bulkCategory || totalSelected === 0) return;
    setIsBulkCategorizing(true);
    setErrors([]);
    setInfo("");
    try {
      const txIds = selectedRows.filter((r) => r.type === "transaction").map((r) => r.id);
      const expIds = selectedRows.filter((r) => r.type === "expense").map((r) => r.id);
      const invIds = selectedRows.filter((r) => r.type === "invoice").map((r) => r.id);
      const res = await batchCategorizeItems(txIds, expIds, Number(bulkCategory), invIds);
      setInfo(res.message || `Successfully categorized ${res.count} item(s).`);
      setBulkCategory("");
      await afterAction();
    } catch (err) {
      setErrors([getErrorMessage(err, "Failed to batch categorize items.")]);
    } finally {
      setIsBulkCategorizing(false);
    }
  };

  const handleRestore = async () => {
    if (totalSelected === 0) return;
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      const targets = selectedRows.map((r) => ({ type: r.type, id: r.id }));
      const res = await restoreItems(targets);
      const count = (res.affected || []).length || totalSelected;
      setInfo(`Restored ${count} item(s) to the books (linked items are restored together).`);
      await afterAction();
    } catch (err) {
      setErrors([getErrorMessage(err, "Failed to restore items")]);
    } finally {
      setIsResolving(false);
    }
  };

  const executeBulkDelete = async () => {
    if (totalSelected === 0) return;
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      const targets = selectedRows.map((r) => ({ type: r.type, id: r.id }));
      const res = await deleteItemsBulk(targets);
      setShowDeleteConfirm(false);
      setInfo(`Moved ${res.deletedCount || totalSelected} item(s) to Deleted Items (kept for 30 days).`);
      await afterAction();
    } catch (err) {
      setErrors([getErrorMessage(err, "Failed to delete items")]);
    } finally {
      setIsResolving(false);
    }
  };

  const executeRestoreDeleted = async () => {
    if (totalSelected === 0) return;
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      const targets = selectedRows.map((r) => ({ type: r.type, id: r.id }));
      const res = await restoreDeletedItems(targets);
      setInfo(`Restored ${res.restoredCount || totalSelected} item(s) back to active books.`);
      await afterAction();
    } catch (err) {
      setErrors([getErrorMessage(err, "Failed to restore items")]);
    } finally {
      setIsResolving(false);
    }
  };

  const executeMoveToExcluded = async () => {
    if (totalSelected === 0 || !moveToExcludedReason) return;
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      const targets = selectedRows.map((r) => ({ type: r.type, id: r.id }));
      const res = await moveDeletedToExcluded(targets, moveToExcludedReason, moveToExcludedNote);
      setShowMoveToExcludedModal(false);
      setMoveToExcludedReason("");
      setMoveToExcludedNote("");
      setInfo(`Moved ${res.movedCount || totalSelected} item(s) to Excluded Items.`);
      await afterAction();
    } catch (err) {
      setErrors([getErrorMessage(err, "Failed to move items to excluded")]);
    } finally {
      setIsResolving(false);
    }
  };

  const executePermanentDelete = async () => {
    if (totalSelected === 0) return;
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      const targets = selectedRows.map((r) => ({ type: r.type, id: r.id }));
      const res = await deleteItemsPermanent(targets);
      setShowPermanentDeleteConfirm(false);
      setInfo(`Permanently removed ${res.deletedCount || totalSelected} item(s).`);
      await afterAction();
    } catch (err) {
      setErrors([getErrorMessage(err, "Failed to permanently delete items")]);
    } finally {
      setIsResolving(false);
    }
  };

  const modalTitle = (
    <div className="flex items-center gap-3">
      <span>
        {isPending
          ? "Action Required"
          : isIgnored
          ? "Excluded Items"
          : isWarningsIgnored
          ? "Warnings Ignored"
          : "Deleted Items"}
      </span>
      {!isLoading && rows.length > 0 && (
        <span
          className={`px-2.5 py-0.5 rounded-full text-xs font-bold border font-mono tabular-nums ${
            isPending
              ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
              : isIgnored
              ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
              : isWarningsIgnored
              ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          }`}
        >
          {rows.length}
        </span>
      )}
      {isLoading && <LoadingSpinner size="xs" color="text-zinc-400" className="ml-1" />}
    </div>
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        suspended={suspended || Boolean(drawerConfig.type)}
        onClose={onClose}
        title={modalTitle}
        maxWidth="4xl"
        bodyClassName="p-4 sm:p-5 overflow-hidden flex-1 flex flex-col min-h-0"
      >
        <div className="flex flex-col flex-1 min-h-0 h-[72vh] max-h-[72vh]">
          {/* QUEUE NAVIGATION TABS */}
          <div
            role="tablist"
            aria-label="Review queues"
            className="flex items-center gap-1.5 p-1 bg-zinc-900 border border-white/10 rounded-xl mb-3 overflow-x-auto no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0"
          >
            {QUEUE_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const count = isActive ? rows.length : tabCounts[tab.id] ?? 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => switchTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer touch-glow-emerald ${
                    isActive
                      ? "bg-zinc-800 text-white shadow-sm border border-white/10 glow-border-emerald"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border font-mono tabular-nums ${tab.badgeColor}`}>
                    {count}
                  </span>
                  {isActive && isLoading && <LoadingSpinner size="xs" color="text-zinc-400" className="ml-1" />}
                </button>
              );
            })}
          </div>

          {/* COLLAPSIBLE EXPLANATORY BANNER */}
          <div className={`p-2.5 mb-2.5 border rounded-xl text-xs transition-colors shrink-0 ${bannerConfig.containerClass}`}>
            <button
              type="button"
              aria-expanded={isBannerExpanded}
              onClick={() => setIsBannerExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between gap-2 text-left cursor-pointer select-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-xs truncate">{bannerConfig.title}</span>
                <span className="text-[11px] opacity-75 hidden sm:inline truncate">— {bannerConfig.summary}</span>
              </div>
              <span className="shrink-0 text-[11px] font-medium opacity-80 hover:opacity-100 flex items-center gap-1">
                <span>{isBannerExpanded ? "Hide details" : "Show details"}</span>
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${isBannerExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            {isBannerExpanded && (
              <div className="mt-2 pt-2 border-t border-white/10 text-xs leading-relaxed opacity-90">
                {bannerConfig.description}
              </div>
            )}
          </div>

          <ReviewFilterBar
            activeTab={activeTab}
            search={search}
            onSearchChange={setSearch}
            isFiltersOpen={isFiltersOpen}
            onToggleFilters={() => setIsFiltersOpen((prev) => !prev)}
            activeFilterCount={activeFilterCount}
            onResetFilters={resetFilters}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            issueFilter={issueFilter}
            onIssueFilterChange={setIssueFilter}
            accountFilter={accountFilter}
            onAccountFilterChange={setAccountFilter}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            accounts={accounts}
          />

          <ReviewBulkToolbar
            activeTab={activeTab}
            selectAllRef={selectAllRef}
            allPageSelected={allPageSelected}
            onToggleAllPage={toggleAllPage}
            paginatedCount={paginatedRows.length}
            visibleRows={visibleRows}
            selectedRows={selectedRows}
            onSelectAllVisible={() => setSelected(new Set(visibleRows.map((r) => r.key)))}
            onClearSelection={() => setSelected(new Set())}
            accounts={accounts}
            bulkCategory={bulkCategory}
            onBulkCategoryChange={setBulkCategory}
            isBulkCategorizing={isBulkCategorizing}
            onBulkCategorize={handleBulkCategorize}
            isResolving={isResolving}
            canMassAllow={canMassAllow}
            canIgnoreWarnings={canIgnoreWarnings}
            canSendToQueue={canSendToQueue}
            canDirectRestore={canDirectRestore}
            onShowDeleteConfirm={() => setShowDeleteConfirm(true)}
            onShowExcludeModal={() => setShowExcludeModal(true)}
            onShowAllowConfirm={() => setShowAllowConfirm(true)}
            onShowPermanentDeleteConfirm={() => setShowPermanentDeleteConfirm(true)}
            onShowMoveToExcludedModal={() => setShowMoveToExcludedModal(true)}
            onIgnoreWarnings={() => void handleResolve("ignore_warnings")}
            onSendToQueue={() => void handleResolve("pending")}
            onRestoreIgnored={() => void handleRestore()}
            onRestoreWarnings={() => void handleResolve("restore_warnings")}
            onRestoreDeleted={() => void executeRestoreDeleted()}
            onOpenSingleDrawer={() => setDrawerConfig({ type: selectedRows[0].type, id: selectedRows[0].id })}
          />

          {errors.length > 0 && (
            <div role="alert" className="p-3 mb-2 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-sm space-y-1">
              {errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
          {info && (
            <div role="status" className="p-3 mb-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-lg text-sm">
              {info}
            </div>
          )}

          {/* LIST */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              <div className="py-20 flex flex-col items-center justify-center space-y-3">
                <LoadingSpinner size="lg" color="text-emerald-500" />
                <span className="text-xs text-zinc-400 font-medium">Loading review items…</span>
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="text-center text-zinc-400 py-12 space-y-1">
                <p className="font-medium text-zinc-300">
                  {rows.length === 0
                    ? isPending
                      ? "Nothing is waiting for review."
                      : isIgnored
                      ? "No excluded items."
                      : isWarningsIgnored
                      ? "No items with ignored warnings."
                      : "No deleted items."
                    : "No items match your search or filters."}
                </p>
                {rows.length === 0 && (
                  <p className="text-xs text-zinc-400 max-w-md mx-auto">
                    {isPending
                      ? "All transactions and expenses are reconciled and approved."
                      : isIgnored
                      ? "Items excluded from your books will appear here. You can restore them anytime while the period remains open."
                      : isWarningsIgnored
                      ? "Items whose reconciliation warnings were silenced will appear here so you can review or restore warnings."
                      : "Deleted items are kept for 30 days before being permanently removed. They are not included in your books or reports."}
                  </p>
                )}
              </div>
            ) : (
              paginatedRows.map((row) => (
                <ReviewRowCard
                  key={row.key}
                  row={row}
                  activeTab={activeTab}
                  isSelected={selected.has(row.key)}
                  onToggleSelect={toggle}
                  onOpenDrawer={(r) => setDrawerConfig({ type: r.type, id: r.id })}
                />
              ))
            )}
          </div>

          <div className="shrink-0 pt-2">
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </div>
      </Modal>

      <ReviewConfirmModals
        totalSelected={totalSelected}
        isResolving={isResolving}
        showAllowConfirm={showAllowConfirm}
        targetOpenDateStr={targetOpenDateStr}
        onCloseAllow={() => setShowAllowConfirm(false)}
        onConfirmAllow={() => void executeAllow()}
        showDeleteConfirm={showDeleteConfirm}
        onCloseDelete={() => setShowDeleteConfirm(false)}
        onConfirmDelete={() => void executeBulkDelete()}
        showPermanentDeleteConfirm={showPermanentDeleteConfirm}
        onClosePermanentDelete={() => setShowPermanentDeleteConfirm(false)}
        onConfirmPermanentDelete={() => void executePermanentDelete()}
        showMoveToExcludedModal={showMoveToExcludedModal}
        moveToExcludedReason={moveToExcludedReason}
        moveToExcludedNote={moveToExcludedNote}
        onMoveToExcludedReasonChange={setMoveToExcludedReason}
        onMoveToExcludedNoteChange={setMoveToExcludedNote}
        onCloseMoveToExcluded={() => {
          setShowMoveToExcludedModal(false);
          setMoveToExcludedReason("");
          setMoveToExcludedNote("");
        }}
        onConfirmMoveToExcluded={() => void executeMoveToExcluded()}
      />

      {/* BULK EXCLUDE MODAL */}
      <ExcludeItemModal
        isOpen={showExcludeModal}
        onClose={() => setShowExcludeModal(false)}
        targets={selectedRows.map((r) => ({ type: r.type, id: r.id }))}
        onExcluded={async () => {
          setShowExcludeModal(false);
          setInfo(`Excluded ${totalSelected} item(s) from the books.`);
          await afterAction();
        }}
      />

      {/* DETAIL DRAWER RENDERED OVER THE SUSPENDED MODAL */}
      {drawerConfig.type && drawerConfig.id && (
        <DetailDrawer
          type={drawerConfig.type === "expense" ? "receipt" : drawerConfig.type}
          id={drawerConfig.id}
          onClose={() => {
            setDrawerConfig({ type: null, id: null });
            void afterAction();
          }}
        />
      )}
    </>
  );
}

type RowState = ReviewRow[];
