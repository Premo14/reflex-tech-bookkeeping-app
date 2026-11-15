import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { BankTransaction, ChartAccount, Expense, Invoice } from '@/types/models'

// Mock heavy child feature modals & lists in S16 shell tests; each is tested directly in S17–S23.
vi.mock('@/components/UploadModal', () => ({
  default: ({ isOpen, onClose, onUploadSuccess }: { isOpen: boolean; onClose: () => void; onUploadSuccess: () => void }) =>
    isOpen ? (
      <div data-testid="upload-modal">
        <button onClick={() => { onUploadSuccess(); onClose(); }}>Upload Done</button>
      </div>
    ) : null,
}))
vi.mock('@/components/AccountManager', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <div data-testid="account-manager"><button onClick={onClose}>Close AM</button></div> : null,
}))
vi.mock('@/components/SettingsModal', () => ({
  default: ({ isOpen, onClose, onViewItems }: { isOpen: boolean; onClose: () => void; onViewItems?: (d: string) => void }) =>
    isOpen ? (
      <div data-testid="settings-modal">
        <button onClick={() => onViewItems?.('2026-01-31')}>View Items</button>
        <button onClick={onClose}>Close Settings</button>
      </div>
    ) : null,
}))
vi.mock('@/components/ReportsModal', () => ({
  default: ({ onClose, onViewUncategorized, onOpenInvoiceDetail }: { onClose: () => void; onViewUncategorized?: () => void; onOpenInvoiceDetail?: (id: number) => void }) => (
    <div data-testid="reports-modal">
      <button onClick={() => onViewUncategorized?.()}>View Uncat</button>
      <button onClick={() => onOpenInvoiceDetail?.(77)}>Open Inv 77</button>
      <button onClick={onClose}>Close Reports</button>
    </div>
  ),
}))
vi.mock('@/components/ReviewModal', () => ({
  default: ({ isOpen, statusType, onClose }: { isOpen: boolean; statusType: string; onClose: () => void }) =>
    isOpen ? <div data-testid="review-modal">{statusType}<button onClick={onClose}>Close Review</button></div> : null,
}))
vi.mock('@/components/AppSettingsModal', () => ({
  default: ({ isOpen, initialTab, onClose }: { isOpen: boolean; initialTab?: string; onClose: () => void }) =>
    isOpen ? <div data-testid="app-settings-modal">{initialTab}<button onClick={onClose}>Close App Settings</button></div> : null,
}))
vi.mock('@/components/InvoicingModal', () => ({
  default: ({ isOpen, initialInvoiceId, initialMode, companyName, onClose }: { isOpen: boolean; initialInvoiceId?: number; initialMode?: string; companyName: string; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="invoicing-modal">
        {companyName}:{initialInvoiceId ?? 'none'}:{initialMode}
        <button onClick={onClose}>Close Invoicing</button>
      </div>
    ) : null,
}))
vi.mock('@/components/DetailDrawer', () => ({
  default: ({ type, id, onClose, onCreateRule, onEditInvoice, onPrintInvoice }: {
    type: string | null;
    id: number | null;
    onClose: () => void;
    onCreateRule?: (d: { name: string; descriptionKeyword: string; categoryAccountId?: number | null }) => void;
    onEditInvoice?: (inv: Invoice) => void;
    onPrintInvoice?: (inv: Invoice) => void;
  }) =>
    type ? (
      <div data-testid="detail-drawer">
        {type}:{id}
        <button onClick={() => onCreateRule?.({ name: 'Rule 1', descriptionKeyword: 'ACME', categoryAccountId: 5 })}>Create Rule</button>
        <button onClick={() => onEditInvoice?.({ id: 9 } as Invoice)}>Edit Inv</button>
        <button onClick={() => onPrintInvoice?.({ id: 9 } as Invoice)}>Print Inv</button>
        <button onClick={onClose}>Close Drawer</button>
      </div>
    ) : null,
}))
vi.mock('@/components/TransactionList', () => ({
  default: ({ transactions, onSelect }: { transactions: BankTransaction[]; onSelect: (id: number) => void }) => (
    <div data-testid="tx-list">
      {transactions.map((t) => (
        <button key={t.id} onClick={() => onSelect(t.id)}>Tx:{t.description}</button>
      ))}
    </div>
  ),
}))
vi.mock('@/components/ReceiptList', () => ({
  default: ({ expenses, onSelect }: { expenses: Expense[]; onSelect: (id: number) => void }) => (
    <div data-testid="receipt-list">
      {expenses.map((e) => (
        <button key={e.id} onClick={() => onSelect(e.id)}>Exp:{e.vendor}</button>
      ))}
    </div>
  ),
}))
vi.mock('@/components/InvoiceList', () => ({
  default: ({ invoices, onSelect }: { invoices: Invoice[]; onSelect: (id: number) => void }) => (
    <div data-testid="invoice-list">
      {invoices.map((i) => (
        <button key={i.id} onClick={() => onSelect(i.id)}>Inv:{i.invoiceNumber}</button>
      ))}
    </div>
  ),
}))
vi.mock('@/components/CreateTransactionForm', () => ({
  default: ({ form, setForm }: { form: Record<string, unknown>; setForm: (f: Record<string, unknown>) => void }) => (
    <div data-testid="create-tx-form">
      <button type="button" onClick={() => setForm({ ...form, amount: 85.5, description: 'Wire', chartAccountId: 1, date: '2026-04-05' })}>
        Fill Valid Tx
      </button>
      <button type="button" onClick={() => setForm({ ...form, amount: 0 })}>
        Fill Bad Amount Tx
      </button>
    </div>
  ),
}))
vi.mock('@/components/CreateExpenseForm', () => ({
  default: ({ form, setForm }: { form: Record<string, unknown>; setForm: (f: Record<string, unknown>) => void }) => (
    <div data-testid="create-exp-form">
      <button
        type="button"
        onClick={() =>
          setForm({
            ...form,
            amount: 32.5,
            vendor: 'Staples',
            description: 'Paper',
            timestamp: '2026-04-05',
            receiptFile: new File(['x'], 'r.png', { type: 'image/png' }),
          })
        }
      >
        Fill Valid Exp
      </button>
    </div>
  ),
}))

const sseHandlers = new Map<string, (p: unknown) => void>()
vi.mock('@/utils/useLiveSync', () => ({
  useLiveEvent: (events: string | string[], cb: (p: unknown) => void) => {
    const list = Array.isArray(events) ? events : [events]
    for (const ev of list) {
      sseHandlers.set(ev, cb)
    }
  },
}))

import App from '@/App'
import Sidebar from '@/components/Sidebar'
import * as api from '@/services/api'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    getChartAccounts: vi.fn(),
    getSettings: vi.fn(),
    getReviewQueueCounts: vi.fn(),
    getSystemHealth: vi.fn(),
    getDemoStatus: vi.fn(),
    seedDemoData: vi.fn(),
    resetDemoData: vi.fn(),
    removeDemoData: vi.fn(),
    getTransactions: vi.fn(),
    getExpenses: vi.fn(),
    getInvoices: vi.fn(),
    getSummary: vi.fn(),
    createTransaction: vi.fn(),
    createExpense: vi.fn(),
    uploadReceiptToExpense: vi.fn(),
  }
})

const sampleAccounts: ChartAccount[] = [
  { id: 1, code: '1010', name: 'Checking', type: 'ASSET', description: '', active: true, createdAt: '', updatedAt: '' },
  { id: 2, code: '1011', name: 'Sub Checking', type: 'ASSET', parentId: 1, description: '', active: true, createdAt: '', updatedAt: '' },
  { id: 3, code: '5010', name: 'Old Inactive', type: 'EXPENSE', parentId: 999, description: '', active: false, createdAt: '', updatedAt: '' },
]

describe('App Shell (App, LedgerPage, Header, Sidebar, LedgerGrid)', () => {
  beforeEach(() => {
    sseHandlers.clear()
    vi.clearAllMocks()
    vi.mocked(api.getChartAccounts).mockResolvedValue(sampleAccounts)
    vi.mocked(api.getSettings).mockResolvedValue({ CompanyName: '', BooksClosedDate: '2025-12-31' })
    vi.mocked(api.getReviewQueueCounts).mockResolvedValue({ pending: 3, excluded: 1, warningsIgnored: 2, deleted: 4 })
    vi.mocked(api.getSystemHealth).mockResolvedValue({
      status: 'ok',
      company: 'Test',
      timestamp: '',
      database: { status: 'ok' },
      fileProcessor: { status: 'ok' },
      aiEngine: { status: 'ready', ready: true },
      storage: { inboxPath: '', processedPath: '', inboxWritable: true, processedWritable: true, status: 'ok' },
    })
    vi.mocked(api.getDemoStatus).mockResolvedValue({
      active: false,
      counts: { statements: 0, transactions: 0, expenses: 0, receipts: 0, invoices: 0 },
    })
    vi.mocked(api.getTransactions).mockResolvedValue({
      transactions: [{ id: 10, isManual: false, date: '2026-04-01', description: 'AWS', amount: -25, fitId: '', transactionType: 'DEBIT', allocationStatus: 'UNLINKED', reviewStatus: 'ACTIVE', chartAccountId: 1 }],
      total: 1,
    })
    vi.mocked(api.getExpenses).mockResolvedValue({
      expenses: [{ id: 20, isManual: false, timestamp: '2026-04-01', vendor: 'Apple', description: 'Cable', amount: 19.99, taxAmount: 0, currencyCode: 'USD', tender: 'card', allocationStatus: 'UNLINKED', reviewStatus: 'ACTIVE', createdAt: '', updatedAt: '' }],
      total: 1,
    })
    vi.mocked(api.getInvoices).mockResolvedValue({
      status: 'ok',
      invoices: [{ id: 30, invoiceNumber: 'INV-001', clientName: 'Acme', clientEmail: '', clientAddress: '', issueDate: '2026-04-01', dueDate: '2026-05-01', items: '[]', subtotal: 500, taxRate: 0, taxAmount: 0, totalAmount: 500, notes: '', paymentTerms: 'Net 30', status: 'SENT', createdAt: '', updatedAt: '' }],
      summary: { totalInvoiced: 500, totalPaid: 0, totalUnpaid: 500, overdueCount: 0, invoiceCount: 1 },
    })
    vi.mocked(api.getSummary).mockResolvedValue({
      totalIncome: 1200,
      totalDebits: 300,
      totalExpenses: 300,
      netIncome: 900,
      netCashflow: 900,
      unlinkedTxCount: 2,
      unlinkedExpCount: 1,
      transactionCount: 5,
      expenseCount: 3,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders App, falls back to "Unnamed Company", loads ledger data without duplicate initial fetches, and opens child workflows', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Unnamed Company').length).toBeGreaterThanOrEqual(1)
    })

    // Per-resource effects should invoke each list endpoint ONCE on initial mount
    expect(api.getTransactions).toHaveBeenCalledTimes(1)
    expect(api.getExpenses).toHaveBeenCalledTimes(1)
    expect(api.getInvoices).toHaveBeenCalledTimes(1)
    expect(api.getSummary).toHaveBeenCalledTimes(1)

    // Summary metrics use canonical formatCurrency
    expect(screen.getByText('$1,200.00')).toBeInTheDocument()
    expect(screen.getByText('$300.00')).toBeInTheDocument()
    expect(screen.getAllByText('$900.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('3 Need Attention (2 Tx / 1 Exp)')).toBeInTheDocument()

    // Needs Attention button filters both columns
    await user.click(screen.getByText('3 Need Attention (2 Tx / 1 Exp)'))
    await waitFor(() => {
      expect(api.getTransactions).toHaveBeenCalledWith(expect.objectContaining({ status: 'NEEDS_ATTENTION' }))
    })

    // Desktop tab switch between Receipts & Slips and Client Invoices
    await user.click(screen.getByRole('button', { name: 'Client Invoices & Receivables' }))
    expect(screen.getByTestId('invoice-list')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Receipts & Expense Slips' }))
    expect(screen.getByTestId('receipt-list')).toBeInTheDocument()

    // Account Switcher dropdown in Header (hierarchy, search, select, All Accounts)
    const acctBtn = screen.getByRole('button', { name: 'Select active account' })
    await user.click(acctBtn)
    const searchInput = screen.getByPlaceholderText('Filter accounts...')
    await user.type(searchInput, '1011')
    expect(screen.getByText('Sub Checking')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear account filter' }))
    await user.click(screen.getByText(/Sub Checking/))
    expect(acctBtn).toHaveTextContent('↳ 1011 — Sub Checking')

    // Demo sandbox seed / reset / remove workflow
    vi.mocked(api.seedDemoData).mockResolvedValue({
      status: 'ok',
      demo: { active: true, counts: { statements: 1, transactions: 2, expenses: 2, receipts: 2, invoices: 1 } },
    })
    await user.click(screen.getByRole('button', { name: /Seed Demo Data/i }))
    await waitFor(() => expect(api.seedDemoData).toHaveBeenCalled())

    vi.mocked(api.removeDemoData).mockResolvedValue({
      status: 'ok',
      demo: { active: false, counts: { statements: 0, transactions: 0, expenses: 0, receipts: 0, invoices: 0 } },
    })
    await user.click(screen.getByRole('button', { name: /Remove Demo Data/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove Demo Data' }))
    await waitFor(() => expect(api.removeDemoData).toHaveBeenCalled())

    // Open Reports & trigger deep links (uncategorized + invoice detail)
    await user.click(screen.getByRole('button', { name: /Reports/i }))
    expect(screen.getByTestId('reports-modal')).toBeInTheDocument()
    await user.click(screen.getByText('View Uncat'))
    await user.click(screen.getByText('Open Inv 77'))
    expect(screen.getByTestId('invoicing-modal')).toHaveTextContent('Unnamed Company:77:inspect')
    await user.click(screen.getByText('Close Invoicing'))

    // Drawer create rule -> opens AppSettingsModal on rules tab
    await user.click(screen.getByText('Tx:AWS'))
    expect(screen.getByTestId('detail-drawer')).toHaveTextContent('transaction:10')
    await user.click(screen.getByText('Create Rule'))
    expect(screen.getByTestId('app-settings-modal')).toHaveTextContent('rules')
  })

  it('validates & submits manual transaction and expense creation and handles export menu', async () => {
    const user = userEvent.setup()
    vi.mocked(api.createTransaction).mockResolvedValue({ id: 99 } as BankTransaction)
    vi.mocked(api.createExpense).mockResolvedValue({ id: 88 } as Expense)
    vi.mocked(api.uploadReceiptToExpense).mockResolvedValue({ status: 'ok' })

    render(<App />)
    await waitFor(() => expect(screen.getByText('Tx:AWS')).toBeInTheDocument())

    // Create Transaction -> invalid then valid
    await user.click(screen.getByRole('button', { name: 'Add Transaction' }))
    await user.click(screen.getByText('Fill Bad Amount Tx'))
    await user.click(screen.getByRole('button', { name: 'Create Transaction' }))
    const errDlg = await screen.findByRole('dialog', { name: 'Invalid Amount' })
    await user.click(within(errDlg).getByRole('button', { name: 'OK' }))

    await user.click(screen.getByText('Fill Valid Tx'))
    await user.click(screen.getByRole('button', { name: 'Create Transaction' }))
    await waitFor(() =>
      expect(api.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -85.5, transactionType: 'DEBIT', chartAccountId: 1 })
      )
    )

    // Create Expense with attached receipt file
    await user.click(screen.getByRole('button', { name: 'Add Manual Expense' }))
    await user.click(screen.getByText('Fill Valid Exp'))
    await user.click(screen.getByRole('button', { name: 'Create Expense' }))
    await waitFor(() => expect(api.createExpense).toHaveBeenCalled())
    expect(api.uploadReceiptToExpense).toHaveBeenCalledWith(88, expect.any(File))

    // Export Menu open & Escape dismissal
    await user.click(screen.getByRole('button', { name: /Export/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('exercises Sidebar review queue, date filters, custom range, and collapse toggles directly', async () => {
    const user = userEvent.setup()
    const setStartDate = vi.fn()
    const setEndDate = vi.fn()
    const setIsSidebarOpen = vi.fn()
    const onOpenReview = vi.fn()
    const onOpenSettings = vi.fn()

    render(
      <Sidebar
        startDate=""
        setStartDate={setStartDate}
        endDate=""
        setEndDate={setEndDate}
        isSidebarOpen={true}
        setIsSidebarOpen={setIsSidebarOpen}
        pendingCount={2}
        excludedCount={1}
        warningsIgnoredCount={3}
        deletedCount={4}
        booksClosedDate="2025-12-31"
        onOpenReview={onOpenReview}
        onOpenSettings={onOpenSettings}
        companyName="Reflex Tech"
      />
    )

    await user.click(screen.getByText('Action Required'))
    expect(onOpenReview).toHaveBeenCalledWith('PENDING')
    await user.click(screen.getByText('Excluded Items'))
    expect(onOpenReview).toHaveBeenCalledWith('IGNORED')
    await user.click(screen.getByText('Warnings Ignored'))
    expect(onOpenReview).toHaveBeenCalledWith('WARNINGS_IGNORED')
    await user.click(screen.getByText('Deleted Items'))
    expect(onOpenReview).toHaveBeenCalledWith('DELETED')

    await user.click(screen.getByText('Closed Books'))
    expect(setEndDate).toHaveBeenCalledWith('2025-12-31')
    await user.click(screen.getByText('This Month'))
    expect(setStartDate).toHaveBeenCalled()
    await user.click(screen.getByText('Last Month'))
    await user.click(screen.getByText('This Year'))

    await user.click(screen.getByText('Custom Range'))
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-02-01' } })
    expect(setStartDate).toHaveBeenCalledWith('2026-02-01')
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-02-28' } })
    expect(setEndDate).toHaveBeenCalledWith('2026-02-28')

    // Toggle accordion sections closed and open
    await user.click(screen.getByRole('button', { name: /Review Queue/i }))
    expect(screen.queryByText('Action Required')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Review Queue/i }))
    await user.click(screen.getByRole('button', { name: /Date Filters/i }))
    expect(screen.queryByText('Closed Books')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Date Filters/i }))

    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(onOpenSettings).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Close sidebar' }))
    expect(setIsSidebarOpen).toHaveBeenCalledWith(false)
  })

  it('covers tax-season Lock Books banner, Reset Demo failure alert, SSE refreshes, filters, mobile tabs, and All Caught Up state', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getSettings).mockResolvedValue({ CompanyName: 'Reflex', BooksClosedDate: '2024-12-31' })
    vi.mocked(api.getSummary).mockResolvedValue({
      totalIncome: 100,
      totalDebits: 400,
      totalExpenses: 400,
      netIncome: -300,
      netCashflow: -300,
      unlinkedTxCount: 0,
      unlinkedExpCount: 0,
      transactionCount: 1,
      expenseCount: 1,
    })
    vi.mocked(api.getSystemHealth).mockResolvedValue({
      status: 'ok',
      company: 'Reflex',
      timestamp: '',
      database: { status: 'ok' },
      fileProcessor: { status: 'ok' },
      aiEngine: { status: 'downloading', ready: false },
      storage: { inboxPath: '', processedPath: '', inboxWritable: true, processedWritable: true, status: 'ok' },
    })

    render(<App />)
    await waitFor(() => expect(screen.getByText('All Caught Up')).toBeInTheDocument())
    expect(screen.getByText('Private AI: Initializing...')).toBeInTheDocument()
    expect(screen.getAllByText('-$300.00').length).toBeGreaterThanOrEqual(1)

    // Header modals: Lock Books, Manage, Upload Files + Settings onViewItems trigger
    await user.click(screen.getAllByRole('button', { name: /Lock Books/i })[0])
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument()
    await user.click(screen.getByText('View Items'))
    await user.click(screen.getByText('Close Settings'))

    await user.click(screen.getByRole('button', { name: /Manage/i }))
    expect(screen.getByTestId('account-manager')).toBeInTheDocument()
    await user.click(screen.getByText('Close AM'))

    await user.click(screen.getByRole('button', { name: /Upload Files/i }))
    expect(screen.getByTestId('upload-modal')).toBeInTheDocument()
    await user.click(screen.getByText('Upload Done'))

    // Reset Demo Data confirm -> API failure shows danger alert
    vi.mocked(api.resetDemoData).mockRejectedValueOnce(new Error('Reset crashed'))
    await user.click(screen.getByRole('button', { name: /Reset Demo Data/i }))
    const resetDlg = await screen.findByRole('dialog', { name: 'Reset Demo Data?' })
    await user.click(within(resetDlg).getByRole('button', { name: 'Reset Demo Data' }))
    const errDlg = await screen.findByRole('dialog', { name: 'Demo Reset Failed' })
    expect(within(errDlg).getByText('Reset crashed')).toBeInTheDocument()
    await user.click(within(errDlg).getByRole('button', { name: 'OK' }))

    // ReviewModal & Drawer -> Edit Inv / Print Inv paths
    await user.click(screen.getByText('Action Required'))
    expect(screen.getByTestId('review-modal')).toBeInTheDocument()
    await user.click(screen.getByText('Close Review'))

    await user.click(screen.getByText('Tx:AWS'))
    await user.click(screen.getByText('Edit Inv'))
    expect(screen.getByTestId('invoicing-modal')).toHaveTextContent(':9:edit')
    await user.click(screen.getByText('Close Invoicing'))

    await user.click(screen.getByText('Tx:AWS'))
    await user.click(screen.getByText('Print Inv'))
    expect(screen.getByTestId('invoicing-modal')).toHaveTextContent(':9:print')
    await user.click(screen.getByText('Close Invoicing'))

    // Search, Filter & Sort Selects, and Mobile Tab Switcher
    await user.type(screen.getByLabelText('Search ledger'), 'AWS')
    fireEvent.click(screen.getByLabelText('Sort ledger items'))
    const bankTab = screen.getByRole('tab', { name: /Bank/i })
    await user.click(bankTab)
    expect(bankTab).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: /Invoices/i }))
    await user.click(screen.getByRole('tab', { name: /Receipts/i }))

    // Mobile hamburger button
    await user.click(screen.getByRole('button', { name: 'Open navigation sidebar' }))

    // SSE real-time notifications trigger background refreshes + SETTINGS_UPDATED reopen
    const countBeforeSSE = vi.mocked(api.getReviewQueueCounts).mock.calls.length
    vi.mocked(api.getSettings).mockResolvedValueOnce({ CompanyName: 'Reflex', BooksClosedDate: '' })
    for (const ev of ['QUEUE_UPDATED', 'ACCOUNTS_UPDATED', 'SETTINGS_UPDATED', 'TRANSACTIONS_UPDATED', 'EXPENSES_UPDATED', 'INVOICES_UPDATED', 'RECONCILIATION_UPDATED']) {
      sseHandlers.get(ev)?.({})
    }
    await waitFor(() =>
      expect(vi.mocked(api.getReviewQueueCounts).mock.calls.length).toBeGreaterThan(countBeforeSSE)
    )
  })

  it('exercises LedgerGrid filters, sorting, mobile drag handle, CSV export URLs, and LedgerPage Header Invoices flow', async () => {
    const user = userEvent.setup()
    const origLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/' },
    })

    try {
      vi.mocked(api.createTransaction).mockRejectedValueOnce(new Error('Tx rejected'))
      vi.mocked(api.createExpense).mockRejectedValueOnce(new Error('Exp rejected'))

      render(<App />)
      await waitFor(() => expect(screen.getByText('Tx:AWS')).toBeInTheDocument())

      // Header Invoices CTA -> closes InvoicingModal
      const header = screen.getByRole('banner')
      await user.click(within(header).getByRole('button', { name: /Invoices/i }))
      expect(screen.getByTestId('invoicing-modal')).toBeInTheDocument()
      await user.click(screen.getByText('Close Invoicing'))

      // Change Sort order
      await user.click(screen.getByLabelText('Sort ledger items'))
      await user.click(screen.getByRole('option', { name: 'Amount (Highest)' }))

      // Change Transaction & Receipt filters
      await user.click(screen.getByLabelText('Filter transactions'))
      await user.click(screen.getByRole('option', { name: 'Balanced' }))
      await user.click(screen.getByLabelText('Filter receipts'))
      await user.click(screen.getByRole('option', { name: 'Uncategorized' }))

      // Create Transaction error dialog & Cancel
      await user.click(screen.getByRole('button', { name: 'Add Transaction' }))
      await user.click(screen.getByText('Fill Valid Tx'))
      await user.click(screen.getByRole('button', { name: 'Create Transaction' }))
      const txErr = await screen.findByRole('dialog', { name: 'Error' })
      await user.click(within(txErr).getByRole('button', { name: 'OK' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      // Create Expense error dialog & Cancel
      await user.click(screen.getByRole('button', { name: 'Add Manual Expense' }))
      await user.click(screen.getByText('Fill Valid Exp'))
      await user.click(screen.getByRole('button', { name: 'Create Expense' }))
      const expErr = await screen.findByRole('dialog', { name: 'Error' })
      await user.click(within(expErr).getByRole('button', { name: 'OK' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      // Switch to Invoices tab and filter invoices
      await user.click(screen.getByRole('button', { name: 'Client Invoices & Receivables' }))
      await user.click(screen.getByLabelText('Filter invoices'))
      await user.click(screen.getByRole('option', { name: 'Paid' }))

      // Export CSV menu item clicks update window.location.href
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('menuitem', { name: /Export Transactions/i }))
      expect(window.location.href).toContain('/api/transactions/export')

      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('menuitem', { name: /Export Expenses/i }))
      expect(window.location.href).toContain('/api/expenses/export')

      // Mobile drag handle click & drag simulation
      const dragHandle = screen.getByTitle('Drag or tap to expand/collapse view')
      await user.click(dragHandle)
      fireEvent.mouseDown(dragHandle, { clientY: 200 })
      fireEvent.mouseMove(document, { clientY: 140 })
      fireEvent.mouseUp(document)
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: origLocation,
      })
    }
  })
})
