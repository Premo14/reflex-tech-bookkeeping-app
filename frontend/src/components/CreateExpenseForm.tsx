import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import type { ChartAccount } from "../types/models";

interface CreateExpenseFormProps {
  form: any;
  setForm: (form: any) => void;
  accounts: ChartAccount[];
}

export default function CreateExpenseForm({ form, setForm, accounts }: CreateExpenseFormProps) {
  return (
    <div className="space-y-4">
      <Input type="date" label="Date" value={form.timestamp || form.date || ''} onChange={e => {
        const val = e.target.value;
        setForm({ ...form, timestamp: val, date: val });
      }} />
      <Input type="text" label="Vendor" placeholder="e.g. Staples" value={form.vendor || ''} onChange={e => setForm({ ...form, vendor: e.target.value })} />
      <Input type="text" label="Description" placeholder="e.g. Office supplies" value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
      <Input type="number" step="0.01" label="Amount" placeholder="0.00" value={form.amount || ''} onChange={e => setForm({ ...form, amount: e.target.value })} />
      <Select label="Tender" value={form.tender || 'card'} onChange={e => setForm({ ...form, tender: e.target.value })}>
        <option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="other">Other</option>
      </Select>
      <Select label="Category (Optional)" value={form.chartAccountId || ''} onChange={e => setForm({ ...form, chartAccountId: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">None</option>
        {accounts.filter(a => a.type === 'EXPENSE').map(acc => <option key={acc.id} value={acc.id}>{acc.code} — {acc.name}</option>)}
      </Select>
      <Input type="text" label="Notes (Optional)" placeholder="Additional details..." value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
    </div>
  );
}
