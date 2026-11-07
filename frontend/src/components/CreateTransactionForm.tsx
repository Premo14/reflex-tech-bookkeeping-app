import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { MoneyInput } from "./ui/MoneyInput";
import type { ChartAccount } from "../types/models";
import { getGroupedAccounts } from "../utils/accountHierarchy";

interface CreateTransactionFormProps {
  form: any;
  setForm: (form: any) => void;
  accounts: ChartAccount[];
  defaultBankAccountId?: number | null;
}

export default function CreateTransactionForm({ form, setForm, accounts, defaultBankAccountId }: CreateTransactionFormProps) {
  const isOutgoingTx = form.transactionType === 'DEBIT' || form.transactionType === 'PAYMENT';

  // Grouped bank & credit card accounts (ASSET + LIABILITY)
  const bankGroups = getGroupedAccounts(accounts, ['ASSET', 'LIABILITY'], {
    currentSelectedId: form.chartAccountId || defaultBankAccountId,
  });

  // Grouped categories based on transaction type (including transfers & equity for single-entry bookkeeping)
  const catTypes: ('EXPENSE' | 'REVENUE' | 'EQUITY' | 'ASSET' | 'LIABILITY')[] =
    form.transactionType === 'DEP'
      ? ['REVENUE', 'EQUITY', 'ASSET', 'LIABILITY']
      : ['EXPENSE', 'EQUITY', 'ASSET', 'LIABILITY', 'REVENUE'];
  const categoryGroups = getGroupedAccounts(accounts, catTypes, {
    currentSelectedId: form.categoryAccountId,
  });

  return (
    <div className="space-y-4">
      {/* BANK / SOURCE ACCOUNT (REQUIRED) */}
      <div>
        <Select
          searchable
          label="Bank / Card Account (Required)"
          value={form.chartAccountId || defaultBankAccountId || ''}
          onChange={e => setForm({ ...form, chartAccountId: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">Select bank or credit card account...</option>
          {bankGroups.map(group => (
            <optgroup key={group.subClassId} label={group.label}>
              {group.options.map(opt => (
                <option key={opt.account.id} value={opt.account.id}>
                  {opt.displayName}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <Input type="date" label="Date" value={form.date || form.timestamp || ''} onChange={e => {
            const val = e.target.value;
            setForm({ ...form, date: val, timestamp: val });
          }} />
        </div>
        <div className="flex-1">
          <Select label="Type" value={form.transactionType || 'DEBIT'} onChange={e => {
            const type = e.target.value;
            let amt = Number(form.amount) || 0;
            const out = type === 'DEBIT' || type === 'PAYMENT';
            if (out && amt > 0) amt = -amt;
            else if (!out && amt < 0) amt = Math.abs(amt);
            setForm({ ...form, transactionType: type, amount: amt !== 0 ? amt : '' });
          }}>
            <option value="DEBIT">Debit (money out)</option>
            <option value="DEP">Deposit (money in)</option>
            <option value="PAYMENT">Payment (money out)</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
      </div>

      <div>
        <MoneyInput allowNegative label="Amount" placeholder="e.g. 89.99" value={form.amount} onChange={val => {
          let amt = val;
          if (isOutgoingTx && amt > 0) amt = -amt;
          else if (!isOutgoingTx && amt < 0) amt = Math.abs(amt);
          setForm({ ...form, amount: amt });
        }} />
        <p className="text-[11px] text-zinc-400 mt-2 font-medium pl-1">
          {isOutgoingTx ? "⬇ Outgoing transaction — automatically recorded as negative" : "⬆ Incoming transaction — automatically recorded as positive"}
        </p>
      </div>

      <Input type="text" label="Description" placeholder="e.g. Office Supplies — Staples" value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />

      {/* CATEGORY (OPTIONAL) */}
      <div>
        <Select
          searchable
          label="Category (Optional)"
          value={form.categoryAccountId || ''}
          onChange={e => setForm({ ...form, categoryAccountId: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">None (Uncategorized)</option>
          {categoryGroups.map(group => (
            <optgroup key={group.subClassId} label={group.label}>
              {group.options.map(opt => (
                <option key={opt.account.id} value={opt.account.id}>
                  {opt.displayName}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>

      <Input type="text" label="Notes (Optional)" placeholder="Additional details..." value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
    </div>
  );
}
