import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import type { ChartAccount } from "../types/models";

interface CreateTransactionFormProps {
  form: any;
  setForm: (form: any) => void;
  accounts: ChartAccount[];
}

export default function CreateTransactionForm({ form, setForm, accounts }: CreateTransactionFormProps) {
  const isOutgoingTx = form.transactionType === 'DEBIT' || form.transactionType === 'PAYMENT';
  const filteredTxAccounts = accounts.filter(a => isOutgoingTx ? a.type === 'EXPENSE' : a.type === 'REVENUE');

  return (
    <div className="space-y-4">
      <Input type="date" label="Date" value={form.date || form.timestamp || ''} onChange={e => {
        const val = e.target.value;
        setForm({ ...form, date: val, timestamp: val });
      }} />
      <Input type="text" label="Description" placeholder="e.g. Office Supplies — Staples" value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
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
      <div>
        <Input type="number" step="0.01" label="Amount" placeholder={isOutgoingTx ? "e.g. -89.99" : "e.g. 1500.00"} value={form.amount || ''} onChange={e => setForm({ ...form, amount: e.target.value })} />
        <p className="text-[11px] text-zinc-400 mt-2 font-medium pl-1">{isOutgoingTx ? "⬇ Money out — enter as negative (e.g. -89.99)" : "⬆ Money in — enter as positive (e.g. 1500.00)"}</p>
      </div>
      <Select label="Category (Optional)" value={form.chartAccountId || ''} onChange={e => setForm({ ...form, chartAccountId: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">None</option>
        {(filteredTxAccounts.length > 0 ? filteredTxAccounts : accounts).map(acc => <option key={acc.id} value={acc.id}>{acc.code} — {acc.name}</option>)}
      </Select>
      <Input type="text" label="Notes (Optional)" placeholder="Additional details..." value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
    </div>
  );
}
