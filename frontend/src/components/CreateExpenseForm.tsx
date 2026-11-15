import { useId } from "react";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { MoneyInput } from "./ui/MoneyInput";
import type { ChartAccount, Expense } from "../types/models";
import { getGroupedAccounts } from "../utils/accountHierarchy";

export type ManualExpenseFormState = Partial<Expense> & {
  date?: string;
  receiptFile?: File | null;
};

interface CreateExpenseFormProps {
  form: ManualExpenseFormState;
  setForm: (form: ManualExpenseFormState) => void;
  accounts: ChartAccount[];
}

const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "CNY", "CHF", "SGD",
  "HKD", "NZD", "KRW", "MXN", "BRL", "ZAR", "SEK", "NOK", "DKK", "RUB",
];

const TENDERS = [
  "CARD", "CASH", "CHECK", "TRANSFER", "PAYPAL", "VENMO", "ZELLE", "OTHER",
];

export default function CreateExpenseForm({
  form,
  setForm,
  accounts,
}: CreateExpenseFormProps) {
  const fileInputId = useId();
  const categoryGroups = getGroupedAccounts(accounts, ["EXPENSE"], {
    currentSelectedId: form.chartAccountId,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="flex-1">
          <Input
            type="date"
            label="Date"
            value={form.timestamp || form.date || ""}
            onChange={(e) => {
              const val = e.target.value;
              setForm({ ...form, timestamp: val, date: val });
            }}
          />
        </div>
        <div className="w-full sm:w-1/2">
          <Select
            searchable
            label="Tender"
            value={form.tender?.toUpperCase() || "CARD"}
            onChange={(e) => setForm({ ...form, tender: e.target.value })}
          >
            <option value="">Unknown</option>
            {TENDERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="flex-1">
          <MoneyInput
            label="Total"
            value={form.amount}
            onChange={(val) => setForm({ ...form, amount: val })}
          />
        </div>
        <div className="flex gap-3 sm:gap-4">
          <div className="w-28 sm:w-24">
            <MoneyInput
              label="Tax"
              value={form.taxAmount || 0}
              onChange={(val) => setForm({ ...form, taxAmount: val })}
            />
          </div>
          <div className="w-28 sm:w-24">
            <Select
              searchable
              label="Currency"
              value={form.currencyCode || "USD"}
              onChange={(ev) =>
                setForm({ ...form, currencyCode: ev.target.value })
              }
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <Input
        type="text"
        label="Vendor"
        placeholder="e.g. Staples"
        value={form.vendor || ""}
        onChange={(e) => setForm({ ...form, vendor: e.target.value })}
      />
      <Input
        type="text"
        label="Description"
        placeholder="e.g. Office supplies"
        value={form.description || ""}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />
      <Select
        searchable
        label="Category (Optional)"
        value={form.chartAccountId || ""}
        onChange={(e) =>
          setForm({
            ...form,
            chartAccountId: e.target.value ? Number(e.target.value) : undefined,
          })
        }
      >
        <option value="">None (Uncategorized)</option>
        {categoryGroups.map((group) => (
          <optgroup key={group.subClassId} label={group.label}>
            {group.options.map((opt) => (
              <option key={opt.account.id} value={opt.account.id}>
                {opt.displayName}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <Input
        type="text"
        label="Notes (Optional)"
        placeholder="Additional details..."
        value={form.notes || ""}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
      />

      <div>
        <label
          htmlFor={fileInputId}
          className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5"
        >
          Receipt Attachment (Optional)
        </label>
        <input
          id={fileInputId}
          type="file"
          accept=".png,.jpg,.jpeg,.heic,.pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setForm({ ...form, receiptFile: file || null });
          }}
          className="w-full text-xs text-zinc-400 rounded-lg border border-white/10 bg-zinc-900/60 p-1.5 touch-glow-emerald file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-emerald-500/25 file:text-xs file:font-semibold file:bg-emerald-500/10 file:text-emerald-300 hover:file:bg-emerald-500/20 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
        />
        {form.receiptFile && (
          <div className="flex items-center justify-between gap-2 mt-1.5">
            <p className="text-[11px] text-emerald-400 truncate">
              ✓ {form.receiptFile.name} attached
            </p>
            <button
              type="button"
              onClick={() => setForm({ ...form, receiptFile: null })}
              className="text-[11px] text-zinc-400 hover:text-rose-400 touch-glow-rose px-1.5 py-0.5 rounded cursor-pointer"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
