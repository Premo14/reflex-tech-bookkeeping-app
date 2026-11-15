import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { useConfirm } from "./ui/confirmContext";
import {
  getBankRules,
  getBankRuleSuggestions,
  type RuleSuggestion,
  createBankRule,
  updateBankRule,
  deleteBankRule,
  applyAllBankRules,
  previewBankRule,
  getChartAccounts,
} from "../services/api";
import type { BankRule, RuleCondition, ChartAccount, BankTransaction } from "../types/models";
import { getGroupedAccounts } from "../utils/accountHierarchy";

export interface BankRulesTabProps {
  initialRuleData?: {
    name?: string;
    descriptionKeyword?: string;
    categoryAccountId?: number | null;
  } | null;
  onRulesApplied?: () => void;
}

const FIELD_OPTIONS = [
  { value: "description", label: "Description / Merchant" },
  { value: "amount", label: "Amount ($)" },
  { value: "transaction_type", label: "Transaction Type (DEBIT/DEP)" },
  { value: "chart_account_id", label: "Bank / Source Account" },
];

const TEXT_OPERATOR_OPTIONS = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "equals exactly" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "regex", label: "matches regex" },
];

const NUMERIC_OPERATOR_OPTIONS = [
  { value: "equals_amount", label: "equals exactly" },
  { value: "greater_than", label: "greater than (>)" },
  { value: "less_than", label: "less than (<)" },
];

function parseRuleConditions(raw: string | RuleCondition[] | undefined): RuleCondition[] {
  if (!raw) return [{ field: "description", operator: "contains", value: "" }];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : [{ field: "description", operator: "contains", value: "" }];
  } catch {
    return [{ field: "description", operator: "contains", value: "" }];
  }
}

export default function BankRulesTab({
  initialRuleData,
  onRulesApplied,
}: BankRulesTabProps) {
  const { confirm, alert } = useConfirm();
  const [rules, setRules] = useState<BankRule[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResultMsg, setApplyResultMsg] = useState<string | null>(null);

  // Edit / Create view state
  const [isEditing, setIsEditing] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [matchLogic, setMatchLogic] = useState<"AND" | "OR">("AND");
  const [conditions, setConditions] = useState<RuleCondition[]>([
    { field: "description", operator: "contains", value: "" },
  ]);
  const [categoryAccountId, setCategoryAccountId] = useState<number | null>(null);
  const [renamedVendor, setRenamedVendor] = useState("");
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [autoExclude, setAutoExclude] = useState(false);
  const [exclusionReason, setExclusionReason] = useState("PERSONAL");
  const [notes, setNotes] = useState("");
  const [applyImmediately, setApplyImmediately] = useState(true);

  // Live match preview state
  const [previewMatches, setPreviewMatches] = useState<{
    count: number;
    samples: BankTransaction[];
  } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rulesData, accountsData, suggData] = await Promise.all([
        getBankRules(),
        getChartAccounts(),
        getBankRuleSuggestions().catch(() => ({ suggestions: [] })),
      ]);
      setRules(rulesData || []);
      setAccounts(accountsData || []);
      setSuggestions(suggData?.suggestions || []);
    } catch (err: unknown) {
      console.error("Failed to load rules:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleApplyAllRules = useCallback(async () => {
    setIsApplying(true);
    setApplyResultMsg(null);
    try {
      const res = await applyAllBankRules();
      setApplyResultMsg(
        `Applied rules to ${res.appliedCount} open transaction${
          res.appliedCount === 1 ? "" : "s"
        }.`
      );
      if (onRulesApplied) onRulesApplied();
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setApplyResultMsg(`Failed to apply rules: ${msg}`);
    } finally {
      setIsApplying(false);
    }
  }, [onRulesApplied, loadData]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  // Handle prefill if opened from "Create Rule from Transaction"
  useEffect(() => {
    if (!initialRuleData) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setRuleName(initialRuleData.name || "");
      setConditions([
        {
          field: "description",
          operator: "contains",
          value: initialRuleData.descriptionKeyword || "",
        },
      ]);
      setCategoryAccountId(initialRuleData.categoryAccountId || null);
      setRenamedVendor(initialRuleData.name || "");
      setMatchLogic("AND");
      setAutoConfirm(false);
      setAutoExclude(false);
      setNotes("");
      setEditingRuleId(null);
      setIsEditing(true);
    });
    return () => {
      active = false;
    };
  }, [initialRuleData]);

  // Live preview matching debounced
  useEffect(() => {
    let active = true;
    const valid = conditions.filter((c) => c.value && c.value.trim() !== "");
    if (!isEditing || valid.length === 0) {
      void Promise.resolve().then(() => {
        if (active) setPreviewMatches(null);
      });
      return () => {
        active = false;
      };
    }

    const timer = setTimeout(async () => {
      if (active) setIsPreviewLoading(true);
      try {
        const res = await previewBankRule({
          matchLogic,
          conditions: valid,
        });
        if (active) {
          setPreviewMatches({
            count: res.matchCount,
            samples: res.sampleMatches || [],
          });
        }
      } catch {
        if (active) setPreviewMatches(null);
      } finally {
        if (active) setIsPreviewLoading(false);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [conditions, matchLogic, isEditing]);

  const handleStartCreate = () => {
    setEditingRuleId(null);
    setRuleName("");
    setMatchLogic("AND");
    setConditions([{ field: "description", operator: "contains", value: "" }]);
    setCategoryAccountId(null);
    setRenamedVendor("");
    setAutoConfirm(false);
    setAutoExclude(false);
    setExclusionReason("PERSONAL");
    setNotes("");
    setPreviewMatches(null);
    setIsEditing(true);
  };

  const handleAdoptSuggestion = (s: RuleSuggestion) => {
    setEditingRuleId(null);
    setRuleName(s.suggestedName);
    setMatchLogic("AND");
    setConditions([{ field: "description", operator: "contains", value: s.payeeKeyword }]);
    setCategoryAccountId(s.categoryAccountId);
    setRenamedVendor(s.payeeKeyword);
    setAutoConfirm(true);
    setAutoExclude(false);
    setExclusionReason("PERSONAL");
    setNotes(`Auto-generated from ${s.matchingTxCount} recurring transactions`);
    setPreviewMatches(null);
    setIsEditing(true);
  };

  const handleStartEdit = (rule: BankRule) => {
    setEditingRuleId(rule.id);
    setRuleName(rule.name);
    setMatchLogic(rule.matchLogic || "AND");
    setConditions(parseRuleConditions(rule.conditions));
    setCategoryAccountId(rule.categoryAccountId || null);
    setRenamedVendor(rule.renamedVendor || "");
    setAutoConfirm(rule.autoConfirm);
    setAutoExclude(rule.autoExclude);
    setExclusionReason(rule.exclusionReason || "PERSONAL");
    setNotes(rule.notes || "");
    setPreviewMatches(null);
    setIsEditing(true);
  };

  const handleConditionChange = (
    index: number,
    field: keyof RuleCondition,
    value: string
  ) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], [field]: value };
    if (field === "field") {
      if (value === "amount") {
        updated[index].operator = "equals_amount";
      } else {
        updated[index].operator = "contains";
      }
    }
    setConditions(updated);
  };

  const handleAddCondition = () => {
    setConditions([
      ...conditions,
      { field: "description", operator: "contains", value: "" },
    ]);
  };

  const handleRemoveCondition = (index: number) => {
    if (conditions.length <= 1) return;
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const handleSaveRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) {
      await alert({
        title: "Rule Name Required",
        message: "Please enter a memorable name for this rule.",
      });
      return;
    }

    const validConditions = conditions.filter((c) => c.value.trim() !== "");
    if (validConditions.length === 0) {
      await alert({
        title: "Condition Required",
        message: "Please define at least one valid condition with a value.",
      });
      return;
    }

    if (!categoryAccountId && !autoExclude && !renamedVendor.trim()) {
      await alert({
        title: "Action Required",
        message: "A rule must assign a category, set an exclusion, or rename the merchant.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const priority = editingRuleId
        ? rules.find((r) => r.id === editingRuleId)?.priority || rules.length + 1
        : rules.length + 1;

      if (editingRuleId) {
        await updateBankRule(editingRuleId, {
          name: ruleName.trim(),
          priority,
          matchLogic,
          conditions: validConditions,
          categoryAccountId: categoryAccountId || null,
          renamedVendor: renamedVendor.trim() || undefined,
          autoConfirm,
          autoExclude,
          exclusionReason: autoExclude ? exclusionReason : undefined,
          notes: notes.trim() || undefined,
          active: true,
          applyImmediately,
        });
      } else {
        await createBankRule({
          name: ruleName.trim(),
          priority,
          matchLogic,
          conditions: validConditions,
          categoryAccountId: categoryAccountId || null,
          renamedVendor: renamedVendor.trim() || undefined,
          autoConfirm,
          autoExclude,
          exclusionReason: autoExclude ? exclusionReason : undefined,
          notes: notes.trim() || undefined,
          active: true,
          applyImmediately,
        });
      }

      setIsEditing(false);
      await loadData();

      if (applyImmediately) {
        await handleApplyAllRules();
      }
    } catch (err: unknown) {
      console.error("Failed to save rule:", err);
      await alert({
        title: "Error Saving Rule",
        message: err instanceof Error && err.message ? err.message : "Failed to save bank rule.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRule = async (id: number) => {
    const confirmed = await confirm({
      title: "Delete Bank Rule",
      message: "Are you sure you want to delete this rule? Past transactions categorized by it will remain untouched.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      await deleteBankRule(id);
      await loadData();
    } catch (err: unknown) {
      await alert({
        title: "Delete Failed",
        message: err instanceof Error && err.message ? err.message : "Failed to delete rule.",
      });
    }
  };

  const handleToggleRuleActive = async (rule: BankRule) => {
    try {
      await updateBankRule(rule.id, { active: !rule.active });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r))
      );
    } catch (err: unknown) {
      await alert({
        title: "Update Failed",
        message: err instanceof Error && err.message ? err.message : "Failed to update rule status.",
      });
    }
  };

  const activeRulesCount = rules.filter((r) => r.active).length;

  const groupedAccounts = getGroupedAccounts(
    accounts,
    ["EXPENSE", "REVENUE", "ASSET", "LIABILITY", "EQUITY"],
    { activeOnly: false }
  );

  return (
    <div className="space-y-4">
      {/* HEADER / ACTIONS BAR */}
      {!isEditing && (
        <div className="surface-glass flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl border border-white/10">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Automated Bank Rules
              </span>
              <Badge variant="success" glow>
                {activeRulesCount} Active Rule{activeRulesCount === 1 ? "" : "s"}
              </Badge>
            </div>
            <p className="text-xs text-zinc-400">
              Rules automatically normalize messy descriptions, assign categories, and pre-approve recurring debits on ingestion.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleApplyAllRules}
              disabled={isApplying || rules.length === 0}
              className="text-xs font-semibold touch-glow-emerald"
            >
              {isApplying ? (
                <>
                  <LoadingSpinner size="xs" className="mr-1.5" /> Applying...
                </>
              ) : (
                <>
                  <svg aria-hidden="true" className="w-3.5 h-3.5 text-indigo-400 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Run All Rules
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              glow
              onClick={handleStartCreate}
              className="text-xs font-semibold flex items-center gap-1.5"
            >
              <svg aria-hidden="true" className="w-4 h-4 text-zinc-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              New Rule
            </Button>
          </div>
        </div>
      )}

      {applyResultMsg && (
        <div role="status" className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
          <span>{applyResultMsg}</span>
          <button
            type="button"
            aria-label="Dismiss rule status"
            onClick={() => setApplyResultMsg(null)}
            className="text-emerald-400 hover:text-white text-xs ml-2 cursor-pointer transition-colors"
          >
            &times;
          </button>
        </div>
      )}

      {/* SMART RULE SUGGESTIONS */}
      {!isEditing && suggestions.length > 0 && (
        <div className="surface-glass p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 space-y-2 mb-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
              <span aria-hidden="true">💡</span> Smart Rule Suggestions ({suggestions.length})
            </span>
            <span className="text-[11px] text-zinc-400">
              Detected recurring categorizations
            </span>
          </div>
          <div className="space-y-1.5">
            {suggestions.map((s, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-950/60 border border-white/5 hover:border-indigo-500/30 transition-colors text-xs"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] text-zinc-200 bg-zinc-900 px-1.5 py-0.5 rounded border border-white/5">
                    &ldquo;{s.payeeKeyword}&rdquo;
                  </span>
                  <span className="text-zinc-400 text-[11px]">&rarr;</span>
                  <span className="text-indigo-300 font-medium text-[11px]">
                    {s.categoryCode} {s.categoryName}
                  </span>
                  <span className="text-zinc-500 text-[10px]">
                    ({s.matchingTxCount} transactions)
                  </span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAdoptSuggestion(s)}
                  className="text-[11px] py-1 px-2.5 h-auto text-indigo-300 hover:text-white"
                >
                  Create Rule
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RULES LIST VIEW */}
      {!isEditing && (
        <div className="space-y-2">
          {isLoading ? (
            <div className="p-8 text-center text-zinc-400 text-xs flex items-center justify-center gap-2">
              <LoadingSpinner size="sm" /> Loading rules...
            </div>
          ) : rules.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-zinc-900/50 border border-white/10 space-y-2">
              <div className="text-zinc-500 text-3xl">⚡</div>
              <p className="text-sm font-semibold text-zinc-300">No Bank Rules Created Yet</p>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Create rules to automatically categorize recurring charges like software subscriptions, utility bills, and payroll transfers as soon as they hit your account.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleStartCreate}
                className="mt-2 text-xs"
              >
                + Create First Rule
              </Button>
            </div>
          ) : (
            <div className="space-y-2 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
              {rules.map((rule) => {
                const targetAccount = accounts.find((a) => a.id === rule.categoryAccountId);
                const condList = parseRuleConditions(rule.conditions);

                return (
                  <div
                    key={rule.id}
                    className={`p-3.5 rounded-xl border transition-all ${
                      rule.active
                        ? "surface-glass border-white/10 hover:border-white/20"
                        : "bg-zinc-900/30 border-white/5 opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-zinc-100">
                            {rule.name}
                          </span>
                          <Badge variant="neutral" size="sm">
                            Priority #{rule.priority}
                          </Badge>
                          {!rule.active && (
                            <Badge variant="neutral" size="sm">
                              Paused
                            </Badge>
                          )}
                          {rule.autoConfirm && (
                            <Badge variant="success" size="sm" glow>
                              Auto-Approve
                            </Badge>
                          )}
                          {rule.autoExclude && (
                            <Badge variant="purple" size="sm">
                              Auto-Exclude ({rule.exclusionReason})
                            </Badge>
                          )}
                        </div>

                        {/* Conditions summary */}
                        <div className="text-xs text-zinc-400 flex items-center gap-1.5 flex-wrap">
                          <span className="text-zinc-400 text-[11px] uppercase font-bold">
                            When:
                          </span>
                          {condList.map((cond, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5 font-mono text-[11px] text-zinc-300"
                            >
                              {cond.field} {cond.operator} &ldquo;{cond.value}&rdquo;
                              {idx < condList.length - 1 && (
                                <strong className="text-indigo-400 ml-1.5">
                                  {rule.matchLogic}
                                </strong>
                              )}
                            </span>
                          ))}
                        </div>

                        {/* Action summary */}
                        <div className="text-xs text-zinc-300 flex items-center gap-2 flex-wrap pt-0.5">
                          <span className="text-zinc-400 text-[11px] uppercase font-bold">
                            Then:
                          </span>
                          {targetAccount ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-medium text-xs">
                              <span className="font-mono text-[10px] text-indigo-400">
                                {targetAccount.code}
                              </span>
                              {targetAccount.name}
                            </span>
                          ) : (
                            <span className="text-zinc-500 italic text-[11px]">
                              No category assigned
                            </span>
                          )}

                          {rule.renamedVendor && (
                            <span className="text-zinc-400 text-[11px]">
                              &rarr; Rename to:{" "}
                              <strong className="text-zinc-200">
                                {rule.renamedVendor}
                              </strong>
                            </span>
                          )}

                          <span className="text-zinc-400">•</span>
                          <span className="text-zinc-500 text-[11px]">
                            Applied {rule.applyCount || 0} times
                          </span>
                        </div>
                      </div>

                      {/* Right: Toggle Switch & Actions */}
                      <div className="flex items-center gap-2 shrink-0 pt-0.5">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={rule.active}
                          aria-label={
                            rule.active
                              ? `Pause rule ${rule.name}`
                              : `Activate rule ${rule.name}`
                          }
                          onClick={() => handleToggleRuleActive(rule)}
                          className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer touch-glow-emerald ${
                            rule.active ? "bg-emerald-600" : "bg-zinc-700"
                          }`}
                          title={
                            rule.active
                              ? "Rule is active (click to pause)"
                              : "Rule is paused (click to activate)"
                          }
                        >
                          <div
                            className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                              rule.active ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>

                        <button
                          type="button"
                          aria-label={`Edit rule ${rule.name}`}
                          onClick={() => handleStartEdit(rule)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors touch-glow-emerald cursor-pointer"
                          title="Edit Rule"
                        >
                          <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>

                        <button
                          type="button"
                          aria-label={`Delete rule ${rule.name}`}
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors touch-glow-red cursor-pointer"
                          title="Delete Rule"
                        >
                          <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* RULE EDIT / CREATE VIEW */}
      {isEditing && (
        <form onSubmit={handleSaveRule} noValidate className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <h3 className="text-sm font-semibold text-zinc-200">
              {editingRuleId ? "Edit Bank Rule" : "Create New Bank Rule"}
            </h3>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              &larr; Back to Rules
            </button>
          </div>

          {/* Rule Name & Match Logic */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label htmlFor="bank-rule-name" className="text-xs font-medium text-zinc-300">
                Rule Name <span className="text-red-400">*</span>
              </label>
              <Input
                id="bank-rule-name"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="e.g. AWS Cloud Hosting, Office Rent, Starbucks"
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="bank-rule-logic" className="text-xs font-medium text-zinc-300">
                Condition Logic
              </label>
              <Select
                id="bank-rule-logic"
                value={matchLogic}
                onChange={(e) => setMatchLogic(e.target.value as "AND" | "OR")}
                className="w-full text-xs"
              >
                <option value="AND">All conditions must match (AND)</option>
                <option value="OR">Any condition can match (OR)</option>
              </Select>
            </div>
          </div>

          {/* Conditions List */}
          <div className="surface-glass space-y-2 p-3.5 rounded-xl border border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Matching Criteria
              </span>
              <button
                type="button"
                onClick={handleAddCondition}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer transition-colors"
              >
                + Add Condition
              </button>
            </div>

            <div className="space-y-2">
              {conditions.map((cond, index) => {
                const isNumeric = cond.field === "amount";
                const opOptions = isNumeric
                  ? NUMERIC_OPERATOR_OPTIONS
                  : TEXT_OPERATOR_OPTIONS;

                return (
                  <div
                    key={index}
                    className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                  >
                    <Select
                      aria-label={`Condition ${index + 1} field`}
                      value={cond.field}
                      onChange={(e) =>
                        handleConditionChange(index, "field", e.target.value)
                      }
                      className="text-xs sm:w-44"
                    >
                      {FIELD_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </Select>

                    <Select
                      aria-label={`Condition ${index + 1} operator`}
                      value={cond.operator}
                      onChange={(e) =>
                        handleConditionChange(index, "operator", e.target.value)
                      }
                      className="text-xs sm:w-36"
                    >
                      {opOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>

                    <Input
                      aria-label={`Condition ${index + 1} value`}
                      type={isNumeric ? "number" : "text"}
                      step={isNumeric ? "0.01" : undefined}
                      value={cond.value}
                      onChange={(e) =>
                        handleConditionChange(index, "value", e.target.value)
                      }
                      placeholder={
                        isNumeric
                          ? "e.g. 50.00"
                          : cond.operator === "regex"
                          ? "e.g. (?i)starbucks|peet"
                          : "e.g. UBER, AWS, GUSTO"
                      }
                      className="text-xs flex-1 font-mono"
                    />

                    {conditions.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove condition ${index + 1}`}
                        onClick={() => handleRemoveCondition(index)}
                        className="p-2 text-zinc-400 hover:text-red-400 touch-glow-red rounded-lg transition-colors self-center cursor-pointer"
                        title="Remove condition"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Live preview feedback */}
            {conditions.some((c) => c.value.trim() !== "") && (
              <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  {isPreviewLoading ? (
                    <span className="flex items-center gap-1.5 text-zinc-400">
                      <LoadingSpinner size="xs" /> Testing against past transactions...
                    </span>
                  ) : previewMatches ? (
                    <span>
                      Matches{" "}
                      <strong className="text-emerald-400 font-semibold font-mono tabular-nums">
                        {previewMatches.count}
                      </strong>{" "}
                      existing transactions in your ledger.
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* Action Settings */}
          <div className="surface-glass space-y-3 p-3.5 rounded-xl border border-white/10">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">
              Actions to Apply
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="bank-rule-category" className="text-xs font-medium text-zinc-300">
                  Assign Category Account
                </label>
                <Select
                  id="bank-rule-category"
                  value={categoryAccountId?.toString() || ""}
                  onChange={(e) =>
                    setCategoryAccountId(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  className="w-full text-xs"
                >
                  <option value="">-- No Category (Leave Unassigned) --</option>
                  {groupedAccounts.map((grp) => (
                    <optgroup key={grp.subClassId} label={grp.label}>
                      {grp.options.map((opt) => (
                        <option key={opt.account.id} value={opt.account.id}>
                          {opt.displayName}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <label htmlFor="bank-rule-vendor" className="text-xs font-medium text-zinc-300">
                  Normalize Merchant Name
                </label>
                <Input
                  id="bank-rule-vendor"
                  value={renamedVendor}
                  onChange={(e) => setRenamedVendor(e.target.value)}
                  placeholder="e.g. Amazon Web Services, Uber, Chevron"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="bank-rule-notes" className="text-xs font-medium text-zinc-300">
                Audit Notes / Description
              </label>
              <Input
                id="bank-rule-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional explanation, e.g. Monthly cloud hosting write-off"
                className="text-xs"
              />
            </div>

            <div className="pt-2 border-t border-white/5 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={autoConfirm}
                  onChange={(e) => setAutoConfirm(e.target.checked)}
                  className="rounded bg-zinc-800 border-zinc-700 text-emerald-500 focus:ring-0"
                />
                <span>
                  <strong>Auto-Approve:</strong> Automatically mark matching transactions as Approved (skip manual review queue).
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={autoExclude}
                  onChange={(e) => setAutoExclude(e.target.checked)}
                  className="rounded bg-zinc-800 border-zinc-700 text-purple-500 focus:ring-0"
                />
                <span>
                  <strong>Auto-Exclude:</strong> Automatically flag matching transactions as excluded from books.
                </span>
              </label>

              {autoExclude && (
                <div className="pl-6 flex items-center gap-2">
                  <label htmlFor="bank-rule-exclusion-reason" className="text-xs text-zinc-400">
                    Exclusion Reason:
                  </label>
                  <Select
                    id="bank-rule-exclusion-reason"
                    value={exclusionReason}
                    onChange={(e) => setExclusionReason(e.target.value)}
                    className="text-xs w-48"
                  >
                    <option value="PERSONAL">Personal Expense</option>
                    <option value="DUPLICATE">Duplicate Item</option>
                    <option value="OTHER">Other Reason</option>
                  </Select>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer text-xs text-indigo-300 pt-1">
                <input
                  type="checkbox"
                  checked={applyImmediately}
                  onChange={(e) => setApplyImmediately(e.target.checked)}
                  className="rounded bg-zinc-800 border-zinc-700 text-indigo-500 focus:ring-0"
                />
                <span>
                  <strong>Apply immediately</strong> to matching transactions in open periods upon saving.
                </span>
              </label>
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsEditing(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              glow
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <LoadingSpinner size="sm" className="mr-1.5" /> Saving...
                </>
              ) : editingRuleId ? (
                "Update Rule"
              ) : (
                "Create Rule"
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
