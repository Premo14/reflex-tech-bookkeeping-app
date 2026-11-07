import React, { useState, useEffect, useMemo, useRef } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Badge } from "./ui/Badge";
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
  type ReviewStatusType,
} from "../services/api";
import { useLiveEvent } from "../utils/useLiveSync";
import ExcludeItemModal, { EXCLUSION_REASON_LABELS } from "./ExcludeItemModal";
import DetailDrawer from "./DetailDrawer";
import { getGroupedAccounts } from "../utils/accountHierarchy";
import { formatDate } from "../utils/dateUtils";
import type { BankTransaction, Expense, ExclusionReason, ChartAccount } from "../types/models";

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  statusType: ReviewStatusType;
  refreshData: () => void;
}

type IssueType = "CLOSED_PERIOD" | "UNLINKED" | "UNDER_ALLOCATED" | "OVER_ALLOCATED" | "IGNORED" | "WARNINGS_IGNORED" | "DELETED";

type Row = {
  key: string;
  type: "transaction" | "expense";
  id: number;
  title: string;
  subtitle: string;
  date: string;
  amount: number;
  transactionType?: string;
  reason: string;
  note: string;
  issues: IssueType[];
  hasSuggestions: boolean;
  isLocked: boolean;
  deletedAt?: string;
  daysRemaining?: number;
  bankAccountId?: number;
  bankAccount?: ChartAccount;
  categoryAccountId?: number;
  categoryAccount?: ChartAccount;
};

const PAGE_SIZE = 15;

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const QUEUE_TABS: { id: ReviewStatusType; label: string; badgeColor: string }[] = [
  { id: "PENDING", label: "Action Required", badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  { id: "IGNORED", label: "Excluded Items", badgeColor: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  { id: "WARNINGS_IGNORED", label: "Warnings Ignored", badgeColor: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  { id: "DELETED", label: "Deleted Items", badgeColor: "text-red-400 bg-red-500/10 border-red-500/20" },
];

export default function ReviewModal({ isOpen, onClose, statusType, refreshData }: ReviewModalProps) {
  const [rows, setRows] = useState<Row[]>([]);
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
  const [drawerConfig, setDrawerConfig] = useState<{ type: "transaction" | "expense" | null; id: number | null }>({ type: null, id: null });
  const [showAllowConfirm, setShowAllowConfirm] = useState(false);
  const [showExcludeModal, setShowExcludeModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPermanentDeleteConfirm, setShowPermanentDeleteConfirm] = useState(false);
  const [showMoveToExcludedModal, setShowMoveToExcludedModal] = useState(false);
  const [moveToExcludedReason, setMoveToExcludedReason] = useState<ExclusionReason | "">("");
  const [moveToExcludedNote, setMoveToExcludedNote] = useState("");

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

  const isPending = activeTab === 'PENDING';
  const isIgnored = activeTab === 'IGNORED';
  const isWarningsIgnored = activeTab === 'WARNINGS_IGNORED';
  const isDeleted = activeTab === 'DELETED';

  const fetchTabCounts = async () => {
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
  };

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

  const resetFilters = () => {
    setTypeFilter("ALL");
    setIssueFilter("ALL");
    setAccountFilter("ALL");
    setCategoryFilter("ALL");
    setSortBy("date_desc");
  };

  const bannerConfig = useMemo(() => {
    if (isPending) {
      return {
        containerClass: "bg-amber-500/10 border-amber-500/20 text-amber-300",
        badgeClass: "text-amber-400 bg-amber-500/20 border-amber-500/30",
        title: "About Action Required Items",
        summary: "Items needing attention before reconciliation can be approved.",
        description: "These items have not yet been approved or reconciled. They may have been imported inside a closed period, lack links, or have allocation mismatches. Open them to resolve via the Detail Drawer, allow closed-period items, or exclude items from your books.",
      };
    }
    if (isIgnored) {
      return {
        containerClass: "bg-purple-500/10 border-purple-500/20 text-purple-300",
        badgeClass: "text-purple-400 bg-purple-500/20 border-purple-500/30",
        title: "About Excluded Items",
        summary: "Kept for records but omitted from reports, totals, and reconciliation.",
        description: "Excluded items are kept for your records but are left out of reports, totals and linking. Restore puts them (and anything linked to them) back in your books. Items in a locked period can't be restored directly; you can send those to the Review Queue instead.",
      };
    }
    if (isWarningsIgnored) {
      return {
        containerClass: "bg-blue-500/10 border-blue-500/20 text-blue-300",
        badgeClass: "text-blue-400 bg-blue-500/20 border-blue-500/30",
        title: "About Warnings Ignored",
        summary: "Included in books with reconciliation warnings silenced.",
        description: "These items are included in your books, but their reconciliation warnings have been silenced so you can close your books without errors. You can turn warnings back on (Restore Warnings) or exclude items if needed.",
      };
    }
    return {
      containerClass: "bg-red-500/10 border-red-500/20 text-red-300",
      badgeClass: "text-red-400 bg-red-500/20 border-red-500/30",
      title: "About 30-Day Deleted Retention",
      summary: "Held in retention for 30 days before permanent automatic purge.",
      description: "Deleted items are kept for 30 days before being permanently removed. They are not included in your books or reports. You can restore them to active books, move them to Excluded Items, or delete them permanently.",
    };
  }, [isPending, isIgnored, isWarningsIgnored]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(statusType);
      setSearch("");
      setSortBy("date_desc");
      setTypeFilter("ALL");
      setIssueFilter("ALL");
      setAccountFilter("ALL");
      setCategoryFilter("ALL");
      setErrors([]);
      setInfo("");
      setSelected(new Set());
      setCurrentPage(1);
      setRows([]);
      getChartAccounts().then((data) => setAccounts(data || [])).catch(() => {});
      fetchTabCounts();
      loadData(statusType, false);
    }
  }, [isOpen, statusType]);

  const switchTab = (newTab: ReviewStatusType) => {
    if (newTab === activeTab) return;
    setActiveTab(newTab);
    setSearch("");
    setSortBy("date_desc");
    setTypeFilter("ALL");
    setIssueFilter("ALL");
    setAccountFilter("ALL");
    setCategoryFilter("ALL");
    setErrors([]);
    setInfo("");
    setSelected(new Set());
    setCurrentPage(1);
    setRows([]);
    loadData(newTab, false);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortBy, typeFilter, issueFilter, accountFilter, categoryFilter]);

  const loadData = async (targetTab: ReviewStatusType = activeTab, silent = true) => {
    const reqId = ++activeRequestId.current;
    if (!silent) setIsLoading(true);
    try {
      const queueRes = await getReviewQueue(targetTab);
      if (reqId !== activeRequestId.current) return;
      const closedDate = queueRes.booksClosedDate || "";

      const rowMap = new Map<string, Row>();

      const addOrUpdateRow = (
        type: "transaction" | "expense",
        id: number,
        title: string,
        subtitle: string,
        date: string,
        amount: number,
        transactionType: string | undefined,
        reason: string,
        note: string,
        issue: IssueType,
        hasSuggestions: boolean,
        extra?: {
          bankAccountId?: number;
          bankAccount?: ChartAccount;
          categoryAccountId?: number;
          categoryAccount?: ChartAccount;
          deletedAt?: string;
          daysRemaining?: number;
        }
      ) => {
        const key = `${type}-${id}`;
        const dateStr = date ? date.split("T")[0] : "";
        const isLocked = Boolean(closedDate && dateStr && dateStr <= closedDate);

        const bankAccount = (extra?.bankAccount && extra.bankAccount.id > 0) ? extra.bankAccount : undefined;
        const bankAccountId = (bankAccount && bankAccount.id > 0) ? bankAccount.id : ((extra?.bankAccountId && extra.bankAccountId > 0) ? extra.bankAccountId : undefined);
        const categoryAccount = (extra?.categoryAccount && extra.categoryAccount.id > 0) ? extra.categoryAccount : undefined;
        const categoryAccountId = (categoryAccount && categoryAccount.id > 0) ? categoryAccount.id : ((extra?.categoryAccountId && extra.categoryAccountId > 0) ? extra.categoryAccountId : undefined);

        if (rowMap.has(key)) {
          const existing = rowMap.get(key)!;
          if (!existing.issues.includes(issue)) {
            existing.issues.push(issue);
          }
          if (hasSuggestions) existing.hasSuggestions = true;
          if (extra?.deletedAt) existing.deletedAt = extra.deletedAt;
          if (extra?.daysRemaining !== undefined) existing.daysRemaining = extra.daysRemaining;
          if (bankAccountId && !existing.bankAccountId) {
            existing.bankAccountId = bankAccountId;
            existing.bankAccount = bankAccount;
          }
          if (categoryAccountId && !existing.categoryAccountId) {
            existing.categoryAccountId = categoryAccountId;
            existing.categoryAccount = categoryAccount;
          }
        } else {
          rowMap.set(key, {
            key,
            type,
            id,
            title,
            subtitle,
            date,
            amount,
            transactionType,
            reason,
            note,
            issues: [issue],
            hasSuggestions,
            isLocked,
            deletedAt: extra?.deletedAt,
            daysRemaining: extra?.daysRemaining,
            bankAccountId,
            bankAccount,
            categoryAccountId,
            categoryAccount,
          });
        }
      };

      if (targetTab === "PENDING") {
        (queueRes.transactions || []).forEach((t: BankTransaction) => {
          addOrUpdateRow(
            "transaction",
            t.id,
            t.description,
            t.transactionType,
            t.date,
            t.amount,
            t.transactionType,
            t.exclusionReason || "",
            t.exclusionNote || "",
            "CLOSED_PERIOD",
            Boolean((t as any).suggestedExpenseId || t.hasSuggestions),
            {
              bankAccountId: t.chartAccountId || undefined,
              bankAccount: t.chartAccount || undefined,
              categoryAccountId: t.categoryAccountId || undefined,
              categoryAccount: t.category || undefined,
            }
          );
        });
        (queueRes.expenses || []).forEach((e: Expense) => {
          addOrUpdateRow(
            "expense",
            e.id,
            `${e.vendor}${e.description ? " – " + e.description : ""}`,
            e.tender,
            e.timestamp,
            e.amount,
            undefined,
            e.exclusionReason || "",
            e.exclusionNote || "",
            "CLOSED_PERIOD",
            false,
            {
              bankAccountId: (e.bankTransactions && e.bankTransactions[0]?.chartAccountId) || undefined,
              bankAccount: (e.bankTransactions && e.bankTransactions[0]?.chartAccount) || undefined,
              categoryAccountId: e.chartAccountId || undefined,
              categoryAccount: e.chartAccount || undefined,
            }
          );
        });

        // Also fetch flagged items
        try {
          const flagged = await getFlaggedItems();
          if (reqId !== activeRequestId.current) return;
          (flagged.transactions || []).forEach((t: BankTransaction) => {
            const s = t.allocationStatus || t.linkStatus;
            let issue: IssueType = "UNLINKED";
            if (s === "PARTIALLY_ALLOCATED") issue = "UNDER_ALLOCATED";
            if (s === "OVER_ALLOCATED") issue = "OVER_ALLOCATED";
            addOrUpdateRow(
              "transaction",
              t.id,
              t.description,
              t.transactionType,
              t.date,
              t.amount,
              t.transactionType,
              t.exclusionReason || "",
              t.exclusionNote || "",
              issue,
              Boolean((t as any).suggestedExpenseId || t.hasSuggestions),
              {
                bankAccountId: t.chartAccountId || undefined,
                bankAccount: t.chartAccount || undefined,
                categoryAccountId: t.categoryAccountId || undefined,
                categoryAccount: t.category || undefined,
              }
            );
          });
          (flagged.expenses || []).forEach((e: Expense) => {
            const s = e.allocationStatus || e.linkStatus;
            let issue: IssueType = "UNLINKED";
            if (s === "PARTIALLY_ALLOCATED") issue = "UNDER_ALLOCATED";
            if (s === "OVER_ALLOCATED") issue = "OVER_ALLOCATED";
            addOrUpdateRow(
              "expense",
              e.id,
              `${e.vendor}${e.description ? " – " + e.description : ""}`,
              e.tender,
              e.timestamp,
              e.amount,
              undefined,
              e.exclusionReason || "",
              e.exclusionNote || "",
              issue,
              false,
              {
                bankAccountId: (e.bankTransactions && e.bankTransactions[0]?.chartAccountId) || undefined,
                bankAccount: (e.bankTransactions && e.bankTransactions[0]?.chartAccount) || undefined,
                categoryAccountId: e.chartAccountId || undefined,
                categoryAccount: e.chartAccount || undefined,
              }
            );
          });
        } catch (err: any) {
          setErrors((prev) => [...prev, `Failed to load flagged items: ${err.message || "network error"}`]);
        }
      } else if (targetTab === "IGNORED") {
        (queueRes.transactions || []).forEach((t: BankTransaction) => {
          addOrUpdateRow(
            "transaction",
            t.id,
            t.description,
            t.transactionType,
            t.date,
            t.amount,
            t.transactionType,
            t.exclusionReason || "",
            t.exclusionNote || "",
            "IGNORED",
            false,
            {
              bankAccountId: t.chartAccountId || undefined,
              bankAccount: t.chartAccount || undefined,
              categoryAccountId: t.categoryAccountId || undefined,
              categoryAccount: t.category || undefined,
            }
          );
        });
        (queueRes.expenses || []).forEach((e: Expense) => {
          addOrUpdateRow(
            "expense",
            e.id,
            `${e.vendor}${e.description ? " – " + e.description : ""}`,
            e.tender,
            e.timestamp,
            e.amount,
            undefined,
            e.exclusionReason || "",
            e.exclusionNote || "",
            "IGNORED",
            false,
            {
              bankAccountId: (e.bankTransactions && e.bankTransactions[0]?.chartAccountId) || undefined,
              bankAccount: (e.bankTransactions && e.bankTransactions[0]?.chartAccount) || undefined,
              categoryAccountId: e.chartAccountId || undefined,
              categoryAccount: e.chartAccount || undefined,
            }
          );
        });
      } else if (targetTab === "WARNINGS_IGNORED") {
        (queueRes.transactions || []).forEach((t: BankTransaction) => {
          const s = t.allocationStatus || t.linkStatus;
          let subIssue: IssueType = "UNLINKED";
          if (s === "PARTIALLY_ALLOCATED") subIssue = "UNDER_ALLOCATED";
          else if (s === "OVER_ALLOCATED") subIssue = "OVER_ALLOCATED";

          const extra = {
            bankAccountId: t.chartAccountId || undefined,
            bankAccount: t.chartAccount || undefined,
            categoryAccountId: t.categoryAccountId || undefined,
            categoryAccount: t.category || undefined,
          };

          addOrUpdateRow(
            "transaction",
            t.id,
            t.description,
            t.transactionType,
            t.date,
            t.amount,
            t.transactionType,
            t.exclusionReason || "",
            t.exclusionNote || "",
            "WARNINGS_IGNORED",
            Boolean((t as any).suggestedExpenseId || t.hasSuggestions),
            extra
          );
          addOrUpdateRow(
            "transaction",
            t.id,
            t.description,
            t.transactionType,
            t.date,
            t.amount,
            t.transactionType,
            t.exclusionReason || "",
            t.exclusionNote || "",
            subIssue,
            Boolean((t as any).suggestedExpenseId || t.hasSuggestions),
            extra
          );
        });
        (queueRes.expenses || []).forEach((e: Expense) => {
          const s = e.allocationStatus || e.linkStatus;
          let subIssue: IssueType = "UNLINKED";
          if (s === "PARTIALLY_ALLOCATED") subIssue = "UNDER_ALLOCATED";
          else if (s === "OVER_ALLOCATED") subIssue = "OVER_ALLOCATED";

          const extra = {
            bankAccountId: (e.bankTransactions && e.bankTransactions[0]?.chartAccountId) || undefined,
            bankAccount: (e.bankTransactions && e.bankTransactions[0]?.chartAccount) || undefined,
            categoryAccountId: e.chartAccountId || undefined,
            categoryAccount: e.chartAccount || undefined,
          };

          addOrUpdateRow(
            "expense",
            e.id,
            `${e.vendor}${e.description ? " – " + e.description : ""}`,
            e.tender,
            e.timestamp,
            e.amount,
            undefined,
            e.exclusionReason || "",
            e.exclusionNote || "",
            "WARNINGS_IGNORED",
            false,
            extra
          );
          addOrUpdateRow(
            "expense",
            e.id,
            `${e.vendor}${e.description ? " – " + e.description : ""}`,
            e.tender,
            e.timestamp,
            e.amount,
            undefined,
            e.exclusionReason || "",
            e.exclusionNote || "",
            subIssue,
            false,
            extra
          );
        });
      } else if (targetTab === "DELETED") {
        (queueRes.transactions || []).forEach((t: BankTransaction) => {
          const delAt = t.deletedAt;
          let daysLeft = 30;
          if (delAt) {
            const daysPassed = Math.floor((Date.now() - new Date(delAt).getTime()) / (1000 * 60 * 60 * 24));
            daysLeft = Math.max(0, 30 - daysPassed);
          }
          addOrUpdateRow(
            "transaction",
            t.id,
            t.description,
            t.transactionType,
            t.date,
            t.amount,
            t.transactionType,
            "",
            "",
            "DELETED",
            false,
            {
              bankAccountId: t.chartAccountId || undefined,
              bankAccount: t.chartAccount || undefined,
              categoryAccountId: t.categoryAccountId || undefined,
              categoryAccount: t.category || undefined,
              deletedAt: delAt,
              daysRemaining: daysLeft,
            }
          );
        });
        (queueRes.expenses || []).forEach((e: Expense) => {
          const delAt = e.deletedAt;
          let daysLeft = 30;
          if (delAt) {
            const daysPassed = Math.floor((Date.now() - new Date(delAt).getTime()) / (1000 * 60 * 60 * 24));
            daysLeft = Math.max(0, 30 - daysPassed);
          }
          addOrUpdateRow(
            "expense",
            e.id,
            `${e.vendor}${e.description ? " – " + e.description : ""}`,
            e.tender,
            e.timestamp,
            e.amount,
            undefined,
            "",
            "",
            "DELETED",
            false,
            {
              bankAccountId: (e.bankTransactions && e.bankTransactions[0]?.chartAccountId) || undefined,
              bankAccount: (e.bankTransactions && e.bankTransactions[0]?.chartAccount) || undefined,
              categoryAccountId: e.chartAccountId || undefined,
              categoryAccount: e.chartAccount || undefined,
              deletedAt: delAt,
              daysRemaining: daysLeft,
            }
          );
        });
      }

      if (reqId !== activeRequestId.current) return;
      const allRows = Array.from(rowMap.values());
      setRows(allRows);
      setTabCounts((prev) => ({ ...prev, [targetTab]: allRows.length }));

      // Preserve selection for items that still exist
      setSelected((prev) => {
        const next = new Set<string>();
        for (const k of prev) {
          if (rowMap.has(k)) next.add(k);
        }
        return next;
      });
    } catch (err: any) {
      if (reqId !== activeRequestId.current) return;
      setErrors([err.message || "Failed to load review items"]);
    } finally {
      if (reqId === activeRequestId.current) {
        setIsLoading(false);
      }
    }
  };

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
          } else if (issueFilter === "DUPLICATE" || issueFilter === "PERSONAL" || issueFilter === "CLOSED_PERIOD" || issueFilter === "OTHER") {
            if (r.reason !== issueFilter) return false;
          } else if (!r.issues.includes(issueFilter as IssueType)) {
            return false;
          }
        } else {
          if (!r.issues.includes(issueFilter as IssueType)) return false;
        }
      }
      if (accountFilter !== "ALL") {
        const accId = Number(accountFilter);
        if (r.bankAccountId !== accId) return false;
      }
      if (categoryFilter !== "ALL") {
        if (categoryFilter === "UNCATEGORIZED") {
          if (r.categoryAccountId) return false;
        } else {
          const catId = Number(categoryFilter);
          if (r.categoryAccountId !== catId) return false;
        }
      }
      if (!q) return true;
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
        String(Math.abs(r.amount)),
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
          return Math.abs(b.amount) - Math.abs(a.amount);
        case "amount_asc":
          return Math.abs(a.amount) - Math.abs(b.amount);
        default:
          return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
    });
    return sorted;
  }, [rows, search, sortBy, typeFilter, issueFilter, accountFilter, categoryFilter]);

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

  const toggle = (key: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
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

  const selectedRows = visibleRows.filter((r) => selected.has(r.key));
  const totalSelected = selectedRows.length;

  const afterAction = async () => {
    refreshData();
    fetchTabCounts();
    await loadData(activeTab, true);
  };

  // Allow calculations for PENDING items
  const canMassAllow = isPending && totalSelected > 0 && selectedRows.every((r) => r.issues.includes("CLOSED_PERIOD"));
  const canIgnoreWarnings = isPending && totalSelected > 0 && selectedRows.every((r) => !r.issues.includes("CLOSED_PERIOD"));

  const oldestAllowedDate = useMemo(() => {
    const allowedRows = selectedRows.filter((r) => r.issues.includes("CLOSED_PERIOD"));
    if (allowedRows.length === 0) return null;
    let oldest = new Date(allowedRows[0].date);
    for (const r of allowedRows) {
      const d = new Date(r.date);
      if (d < oldest) oldest = d;
    }
    return oldest;
  }, [selectedRows]);

  const targetOpenDateStr = useMemo(() => {
    if (!oldestAllowedDate) return null;
    const d = new Date(oldestAllowedDate);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }, [oldestAllowedDate]);

  const executeAllow = async () => {
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      const res = await resolveReviewItems(
        "allow",
        selectedRows.filter((r) => r.type === "transaction").map((r) => r.id),
        selectedRows.filter((r) => r.type === "expense").map((r) => r.id)
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
    } catch (err: any) {
      setErrors([err.message || "Failed to allow items"]);
    } finally {
      setIsResolving(false);
    }
  };

  const handleResolve = async (action: "pending" | "ignore_warnings" | "restore_warnings") => {
    if (totalSelected === 0) return;
    setIsResolving(true);
    setErrors([]);
    setInfo("");
    try {
      await resolveReviewItems(
        action,
        selectedRows.filter((r) => r.type === "transaction").map((r) => r.id),
        selectedRows.filter((r) => r.type === "expense").map((r) => r.id)
      );
      if (action === "ignore_warnings") {
        setInfo(`Silenced reconciliation warnings for ${totalSelected} item(s).`);
      } else if (action === "restore_warnings") {
        setInfo(`Restored reconciliation warnings for ${totalSelected} item(s).`);
      } else if (action === "pending") {
        setInfo(`Sent ${totalSelected} item(s) to the Review Queue.`);
      }
      await afterAction();
    } catch (err: any) {
      setErrors([err.message || "Action failed"]);
    } finally {
      setIsResolving(false);
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
    } catch (err: any) {
      setErrors([err.message || "Failed to restore items"]);
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
    } catch (err: any) {
      setErrors([err.message || "Failed to delete items"]);
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
    } catch (err: any) {
      setErrors([err.message || "Failed to restore items"]);
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
    } catch (err: any) {
      setErrors([err.message || "Failed to move items to excluded"]);
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
    } catch (err: any) {
      setErrors([err.message || "Failed to permanently delete items"]);
    } finally {
      setIsResolving(false);
    }
  };

  const canSendToQueue = isIgnored && totalSelected > 0 && selectedRows.every((r) => r.isLocked);
  const canDirectRestore = isIgnored && totalSelected > 0 && selectedRows.every((r) => !r.isLocked);

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
          className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
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
      {isLoading && (
        <LoadingSpinner size="xs" color="text-zinc-400" className="ml-1" />
      )}
    </div>
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        suspended={Boolean(drawerConfig.type)}
        onClose={onClose}
        title={modalTitle}
        maxWidth="4xl"
        bodyClassName="p-6 overflow-hidden flex-1 flex flex-col min-h-0"
      >
        <div className="flex flex-col flex-1 min-h-0 h-[72vh] max-h-[72vh]">
          {/* QUEUE NAVIGATION TABS */}
          <div className="flex items-center gap-1.5 p-1 bg-zinc-900 border border-white/10 rounded-xl mb-3 overflow-x-auto no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
            {QUEUE_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const count = isActive ? rows.length : (tabCounts[tab.id] ?? 0);
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? "bg-zinc-800 text-white shadow-sm border border-white/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold border ${tab.badgeColor}`}>
                    {count}
                  </span>
                  {isActive && isLoading && (
                    <LoadingSpinner size="xs" color="text-zinc-400" className="ml-1" />
                  )}
                </button>
              );
            })}
          </div>

          {/* COLLAPSIBLE EXPLANATORY BANNER */}
          <div className={`p-2.5 mb-2.5 border rounded-xl text-xs transition-colors shrink-0 ${bannerConfig.containerClass}`}>
            <div 
              className="flex items-center justify-between gap-2 cursor-pointer select-none"
              onClick={() => setIsBannerExpanded((prev) => !prev)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-xs truncate">{bannerConfig.title}</span>
                <span className="text-[11px] opacity-75 hidden sm:inline truncate">— {bannerConfig.summary}</span>
              </div>
              <button
                type="button"
                className="shrink-0 text-[11px] font-medium opacity-80 hover:opacity-100 flex items-center gap-1 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsBannerExpanded((prev) => !prev);
                }}
              >
                <span>{isBannerExpanded ? "Hide details" : "Show details"}</span>
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${isBannerExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {isBannerExpanded && (
              <div className="mt-2 pt-2 border-t border-white/10 text-xs leading-relaxed opacity-90">
                {bannerConfig.description}
              </div>
            )}
          </div>

          {/* TOOLBAR: SEARCH & FILTER ACCORDION TOGGLE */}
          <div className="shrink-0 mb-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  type="text"
                  placeholder="Search description, vendor, reason, amount…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  }
                />
              </div>
              <Button
                variant={isFiltersOpen || activeFilterCount > 0 ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setIsFiltersOpen((prev) => !prev)}
                className="flex items-center gap-1.5 whitespace-nowrap h-[38px] px-3 font-semibold text-xs border border-white/10 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span>Sort & Filter</span>
                {activeFilterCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                    {activeFilterCount}
                  </span>
                )}
                <svg
                  className={`w-3 h-3 transition-transform duration-200 ${isFiltersOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </Button>
            </div>

            {/* ACCORDION CONTENT: 5 FILTER / SORT CONTROLS */}
            {isFiltersOpen && (
              <div className="p-3 bg-zinc-900/90 border border-white/10 rounded-xl space-y-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-white/5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Filters & Sorting
                  </span>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="text-[11px] text-zinc-400 hover:text-emerald-400 transition-colors font-medium cursor-pointer"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                  <Select label="Item Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="py-1.5! text-xs!">
                    <option value="ALL">All items</option>
                    <option value="transaction">Bank transactions</option>
                    <option value="expense">Expenses</option>
                  </Select>
                  <Select label="Issue / Status" value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)} className="py-1.5! text-xs!">
                    <option value="ALL">{isIgnored ? "All reasons / states" : "All issues"}</option>
                    {isPending && <option value="CLOSED_PERIOD">Closed Period</option>}
                    {isPending && <option value="UNLINKED">Unlinked</option>}
                    {isPending && <option value="UNDER_ALLOCATED">Under-Allocated</option>}
                    {isPending && <option value="OVER_ALLOCATED">Over-Allocated</option>}
                    {isIgnored && (
                      <>
                        <optgroup label="Filter by Reason">
                          <option value="DUPLICATE">Duplicate entry</option>
                          <option value="PERSONAL">Personal expense</option>
                          <option value="CLOSED_PERIOD">Declined during review</option>
                          <option value="OTHER">Other</option>
                        </optgroup>
                        <optgroup label="Filter by Accounting Period">
                          <option value="LOCKED">Locked period</option>
                          <option value="OPEN">Open period</option>
                        </optgroup>
                      </>
                    )}
                    {isWarningsIgnored && (
                      <>
                        <option value="UNLINKED">Unlinked</option>
                        <option value="UNDER_ALLOCATED">Under-Allocated</option>
                        <option value="OVER_ALLOCATED">Over-Allocated</option>
                        <option value="CLOSED_PERIOD">Closed Period</option>
                      </>
                    )}
                    {isDeleted && <option value="DELETED">Deleted Items</option>}
                  </Select>
                  <Select label="Bank Account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="py-1.5! text-xs!">
                    <option value="ALL">All accounts</option>
                    {getGroupedAccounts(accounts, ['ASSET', 'LIABILITY']).map((g) => (
                      <optgroup key={g.subClassId} label={g.label}>
                        {g.options.map((opt) => (
                          <option key={opt.account.id} value={opt.account.id}>
                            {opt.displayName}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <Select label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="py-1.5! text-xs!">
                    <option value="ALL">All categories</option>
                    <option value="UNCATEGORIZED">⚠️ Uncategorized</option>
                    {getGroupedAccounts(accounts, ['EXPENSE', 'REVENUE', 'EQUITY', 'ASSET', 'LIABILITY']).map((g) => (
                      <optgroup key={g.subClassId} label={g.label}>
                        {g.options.map((opt) => (
                          <option key={opt.account.id} value={opt.account.id}>
                            {opt.displayName}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <Select label="Sort By" value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="py-1.5! text-xs!">
                    <option value="date_desc">Newest first</option>
                    <option value="date_asc">Oldest first</option>
                    <option value="amount_desc">Amount: high to low</option>
                    <option value="amount_asc">Amount: low to high</option>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* SELECTION ROW & ACTION BUTTONS */}
          <div className="flex flex-wrap justify-between items-center gap-3 mb-2">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleAllPage}
                  disabled={paginatedRows.length === 0}
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 accent-emerald-500 cursor-pointer"
                />
                <span>
                  {visibleRows.length > PAGE_SIZE
                    ? `${paginatedRows.length} on page (${visibleRows.length} total)`
                    : `${visibleRows.length} shown`}
                  {" · "}
                  <strong className={totalSelected > 0 ? "text-white" : "text-zinc-400"}>
                    {totalSelected} selected
                  </strong>
                </span>
              </label>
              {visibleRows.length > paginatedRows.length && totalSelected < visibleRows.length && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set(visibleRows.map((r) => r.key)))}
                  className="text-xs text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
                >
                  Select all {visibleRows.length}
                </button>
              )}
              {totalSelected > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-zinc-400 hover:text-white hover:underline cursor-pointer"
                >
                  Clear selection
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {isPending && (
                <>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={() => setShowExcludeModal(true)}
                  >
                    Exclude Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canIgnoreWarnings}
                    onClick={() => handleResolve("ignore_warnings")}
                    isLoading={isResolving}
                  >
                    Ignore Warnings
                  </Button>
                  {totalSelected === 1 && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setDrawerConfig({ type: selectedRows[0].type, id: selectedRows[0].id })}
                    >
                      Open in Drawer
                    </Button>
                  )}
                  {canMassAllow && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!canMassAllow}
                      onClick={() => setShowAllowConfirm(true)}
                      isLoading={isResolving}
                    >
                      Allow Selected ({totalSelected})
                    </Button>
                  )}
                </>
              )}
              {isIgnored && (
                <>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canSendToQueue}
                    onClick={() => handleResolve("pending")}
                    isLoading={isResolving}
                  >
                    Send to Review Queue
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!canDirectRestore}
                    onClick={handleRestore}
                    isLoading={isResolving}
                  >
                    Restore Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                </>
              )}
              {isWarningsIgnored && (
                <>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={() => setShowExcludeModal(true)}
                  >
                    Exclude Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={() => handleResolve("restore_warnings")}
                    isLoading={isResolving}
                  >
                    Restore Warnings
                  </Button>
                </>
              )}
              {isDeleted && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={() => setShowMoveToExcludedModal(true)}
                    isLoading={isResolving}
                  >
                    Move to Excluded {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={() => setShowPermanentDeleteConfirm(true)}
                    isLoading={isResolving}
                  >
                    Delete Permanently {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={totalSelected === 0}
                    onClick={executeRestoreDeleted}
                    isLoading={isResolving}
                  >
                    Restore Selected {totalSelected > 0 ? `(${totalSelected})` : ""}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Contextual help explaining disabled action states */}
          {totalSelected > 0 && isPending && !canMassAllow && !canIgnoreWarnings && (
            <p className="text-xs text-zinc-400 mb-2">
              Selection contains both closed-period items and unlinked/open items. Handle closed-period items separately (Allow or Exclude).
            </p>
          )}
          {totalSelected > 0 && isPending && !canMassAllow && canIgnoreWarnings && (
            <p className="text-xs text-zinc-400 mb-2">
              Allow is only for closed-period items. For unlinked items, link them or ignore their warnings.
            </p>
          )}
          {totalSelected > 0 && isPending && canMassAllow && !canIgnoreWarnings && (
            <p className="text-xs text-zinc-400 mb-2">
              Warnings cannot be silenced on closed-period items. Allow or Exclude them instead.
            </p>
          )}
          {totalSelected > 0 && isIgnored && !canSendToQueue && !canDirectRestore && (
            <p className="text-xs text-zinc-400 mb-2">
              Selection contains both locked-period and open-period items. Items in a locked period cannot be restored directly; handle them separately.
            </p>
          )}
          {totalSelected > 0 && isIgnored && canSendToQueue && (
            <p className="text-xs text-zinc-400 mb-2">
              Selected item(s) fall in a locked accounting period. They cannot be restored directly; click "Send to Review Queue" to review reopening the books.
            </p>
          )}
          {totalSelected > 0 && isIgnored && canDirectRestore && (
            <p className="text-xs text-zinc-400 mb-2">
              Restore Selected will return these item(s) to your books.
            </p>
          )}
          {totalSelected > 0 && isWarningsIgnored && (
            <p className="text-xs text-zinc-400 mb-2">
              Restore Warnings will turn reconciliation warnings back on for the selected item(s).
            </p>
          )}
          {totalSelected > 0 && isDeleted && (
            <p className="text-xs text-zinc-400 mb-2">
              Restore Selected returns items to active books. Move to Excluded keeps them permanently out of your books. Delete Permanently erases them immediately.
            </p>
          )}

          {errors.length > 0 && (
            <div className="p-3 mb-2 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-sm space-y-1">
              {errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
          {info && (
            <div className="p-3 mb-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-lg text-sm">{info}</div>
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
                  <p className="text-xs text-zinc-500 max-w-md mx-auto">
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
              paginatedRows.map((r) => {
                const isSelected = selected.has(r.key);
                const isCredit = r.type === "transaction" && r.transactionType === "CREDIT";

                return (
                  <div
                    key={r.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDrawerConfig({ type: r.type, id: r.id })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDrawerConfig({ type: r.type, id: r.id });
                      }
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                      isSelected ? "bg-emerald-500/5 border-emerald-500/30" : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggle(r.key, e as any)}
                      className="w-4 h-4 shrink-0 rounded border-zinc-700 bg-zinc-900 accent-emerald-500 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            r.type === "transaction" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"
                          }`}
                        >
                          {r.type === "transaction" ? "Transaction" : "Expense"}
                        </span>
                        {isDeleted && <Badge variant="danger" size="sm">DELETED</Badge>}
                        {isDeleted && (
                          <Badge variant="warning" size="sm">
                            {r.daysRemaining !== undefined ? `${r.daysRemaining}d left` : "30d left"}
                          </Badge>
                        )}
                        {r.issues.includes("CLOSED_PERIOD") && <Badge variant="warning" size="sm">CLOSED PERIOD</Badge>}
                        {r.issues.includes("UNLINKED") && <Badge variant="neutral" size="sm">UNLINKED</Badge>}
                        {r.issues.includes("UNDER_ALLOCATED") && <Badge variant="warning" size="sm">UNDER-ALLOCATED</Badge>}
                        {r.issues.includes("OVER_ALLOCATED") && <Badge variant="danger" size="sm">OVER-ALLOCATED</Badge>}
                        {r.issues.includes("WARNINGS_IGNORED") && <Badge variant="info" size="sm">WARNINGS SILENCED</Badge>}
                        {r.hasSuggestions && <Badge variant="neutral" size="sm">SUGGESTED LINK</Badge>}
                        {isIgnored && r.isLocked && <Badge variant="warning" size="sm">LOCKED PERIOD</Badge>}
                        {isIgnored && (
                          <Badge variant="purple" size="sm">
                            {r.reason ? (EXCLUSION_REASON_LABELS[r.reason] || r.reason) : "EXCLUDED"}
                          </Badge>
                        )}
                        <p className="font-semibold text-white truncate ml-1">{r.title}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-zinc-400">
                        <span>{formatDate(r.date)} · {r.subtitle}</span>
                        {isDeleted && r.deletedAt && <span>· Deleted {formatDate(r.deletedAt)}</span>}
                        {r.bankAccount && r.bankAccount.id > 0 && (
                          <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono border border-white/5 inline-flex items-center">
                            {r.bankAccount.code} {r.bankAccount.name}
                            {!r.bankAccount.active && (
                              <span className="text-red-400 ml-1 font-sans font-semibold">(Archived)</span>
                            )}
                          </span>
                        )}
                        {r.categoryAccount && r.categoryAccount.id > 0 ? (
                          <span className="text-[10px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded font-medium border border-emerald-500/20 inline-flex items-center">
                            {r.categoryAccount.code} {r.categoryAccount.name}
                            {!r.categoryAccount.active && (
                              <span className="text-red-400 ml-1 font-sans font-semibold">(Archived)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded font-medium border border-amber-500/20 inline-flex items-center">
                            Uncategorized
                          </span>
                        )}
                      </div>
                      {isIgnored && r.note && <p className="text-xs text-zinc-400 mt-0.5 italic truncate">“{r.note}”</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className={`font-bold ${isCredit ? "text-emerald-400" : "text-white"}`}>
                        {isCredit ? `+${formatMoney(Math.abs(r.amount))}` : `-${formatMoney(Math.abs(r.amount))}`}
                      </p>
                      <button
                        className="text-[10px] text-zinc-400 hover:text-emerald-400 font-semibold uppercase tracking-wider transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerConfig({ type: r.type, id: r.id });
                        }}
                      >
                        View Details →
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 pt-2">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      </Modal>

      {/* CONFIRM MODAL FOR ALLOW */}
      <Modal
        isOpen={showAllowConfirm}
        onClose={() => setShowAllowConfirm(false)}
        title="Reopen Books to Allow Items"
        maxWidth="md"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={() => setShowAllowConfirm(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={executeAllow} isLoading={isResolving}>
              Confirm & Reopen Books
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p>
            Allowing {totalSelected} item(s) will reopen your books back to{" "}
            <strong className="text-white">{targetOpenDateStr}</strong> (the day before the oldest allowed item).
          </p>
          <p className="text-xs text-zinc-400">
            Any subsequent items dated after this reopened date will automatically become open. Linked transactions and expenses move together.
          </p>
        </div>
      </Modal>

      {/* CONFIRM MODAL FOR SOFT DELETE */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Move Items to Deleted Items"
        maxWidth="md"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={executeBulkDelete} isLoading={isResolving}>
              Delete Selected ({totalSelected})
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p>
            Are you sure you want to delete <strong className="text-white">{totalSelected} item(s)</strong>?
          </p>
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-xs leading-relaxed">
            Items will be removed from your books and active reports immediately. They will be kept in <strong>Deleted Items</strong> for 30 days before being permanently purged. You can restore them anytime from the sidebar.
          </div>
        </div>
      </Modal>

      {/* CONFIRM MODAL FOR PERMANENT HARD DELETE */}
      <Modal
        isOpen={showPermanentDeleteConfirm}
        onClose={() => setShowPermanentDeleteConfirm(false)}
        title="Permanently Delete Items"
        maxWidth="md"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={() => setShowPermanentDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={executePermanentDelete} isLoading={isResolving}>
              Permanently Delete ({totalSelected})
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p className="font-semibold text-red-400">
            Warning: This action cannot be undone.
          </p>
          <p>
            Are you sure you want to permanently erase <strong className="text-white">{totalSelected} item(s)</strong>? All records, receipt attachments, and associations will be completely removed from the database immediately without waiting for the 30-day retention period.
          </p>
        </div>
      </Modal>

      {/* MODAL FOR MOVING DELETED TO EXCLUDED */}
      <Modal
        isOpen={showMoveToExcludedModal}
        onClose={() => {
          setShowMoveToExcludedModal(false);
          setMoveToExcludedReason("");
          setMoveToExcludedNote("");
        }}
        title="Move to Excluded Items"
        maxWidth="md"
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button
              variant="ghost"
              onClick={() => {
                setShowMoveToExcludedModal(false);
                setMoveToExcludedReason("");
                setMoveToExcludedNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!moveToExcludedReason || (moveToExcludedReason === "OTHER" && !moveToExcludedNote.trim())}
              onClick={executeMoveToExcluded}
              isLoading={isResolving}
            >
              Move to Excluded ({totalSelected})
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            Moving {totalSelected} item(s) from Deleted Items to Excluded Items will permanently keep them for your records (out of active books) without being purged after 30 days.
          </p>
          <Select
            label="Reason (required)"
            value={moveToExcludedReason}
            onChange={(e) => setMoveToExcludedReason(e.target.value as ExclusionReason)}
          >
            <option value="">Select a reason…</option>
            <option value="DUPLICATE">{EXCLUSION_REASON_LABELS.DUPLICATE}</option>
            <option value="PERSONAL">{EXCLUSION_REASON_LABELS.PERSONAL}</option>
            <option value="CLOSED_PERIOD">{EXCLUSION_REASON_LABELS.CLOSED_PERIOD}</option>
            <option value="OTHER">{EXCLUSION_REASON_LABELS.OTHER}</option>
          </Select>

          <div>
            <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
              Note {moveToExcludedReason === "OTHER" ? "(required)" : "(optional)"}
            </label>
            <textarea
              value={moveToExcludedNote}
              onChange={(e) => setMoveToExcludedNote(e.target.value)}
              rows={3}
              placeholder="Add context for your records…"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
            />
          </div>
        </div>
      </Modal>

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
            afterAction();
          }}
        />
      )}
    </>
  );
}
