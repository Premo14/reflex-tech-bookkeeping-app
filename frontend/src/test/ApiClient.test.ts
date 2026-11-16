import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as api from '@/services/api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('handles Chart of Accounts CRUD endpoints and query parameters', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accounts: [{ id: 1, code: '1010' }] }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ account: { id: 2, code: '5010' } }))
      .mockResolvedValueOnce(jsonResponse({ account: { id: 2, name: 'Updated' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    expect(await api.getChartAccounts('EXPENSE')).toEqual([{ id: 1, code: '1010' }])
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/accounts?type=EXPENSE',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )

    expect(await api.getChartAccounts()).toEqual([])
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/accounts', expect.any(Object))

    await expect(
      api.createChartAccount({ code: '5010', name: 'Office', type: 'EXPENSE' })
    ).resolves.toEqual({ id: 2, code: '5010' })
    await expect(api.updateChartAccount(2, { name: 'Updated' })).resolves.toEqual({
      id: 2,
      name: 'Updated',
    })
    await expect(api.deleteChartAccount(2)).resolves.toBeUndefined()
  })

  it('parses structured backend error payloads into ApiError and surfaces timeout 408', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Cannot edit locked date', message: 'fallback' }, 403)
    )
    await expect(api.updateTransaction(7, { notes: 'hi' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      message: 'Cannot edit locked date',
      data: { error: 'Cannot edit locked date', message: 'fallback' },
    })

    // Handles malformed non-JSON error body with custom fallback error
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    await expect(api.getSystemHealth()).rejects.toMatchObject({
      status: 502,
      message: 'Failed to fetch system health',
    })

    // AbortError translates cleanly to ApiError 408
    const abortErr = new Error('The operation was aborted')
    abortErr.name = 'AbortError'
    fetchMock.mockRejectedValueOnce(abortErr)
    await expect(api.getSettings()).rejects.toMatchObject({
      status: 408,
      message: expect.stringMatching(/timed out/i),
    })

    // Non-abort network errors propagate as-is
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(api.getSettings()).rejects.toThrow('Failed to fetch')
  })

  it('covers Settings, Directory browser, and Audit logs', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ CompanyName: 'Reflex' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({ currentPath: '/mnt', parentPath: '/', directories: ['inbox'] })
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }]))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))

    expect(await api.getSettings()).toEqual({ CompanyName: 'Reflex' })
    await api.updateSettings('CompanyName', 'Reflex')
    expect(await api.browseHostDirectories('/mnt')).toMatchObject({ currentPath: '/mnt' })
    expect(await api.getAuditLogs()).toEqual([{ id: 1 }])
    expect(await api.getSystemHealth()).toEqual({ status: 'ok' })
  })

  it('covers Transactions & Expenses CRUD, filters, detail responses, and splitExpense', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ transactions: [{ id: 1 }], total: 1 }))
      .mockResolvedValueOnce(jsonResponse({ transaction: { id: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ transaction: { id: 2 } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ expenses: [{ id: 5 }], total: 1 }))
      .mockResolvedValueOnce(jsonResponse({ expense: { id: 5 } }))
      .mockResolvedValueOnce(jsonResponse({ expense: { id: 6 } }))
      .mockResolvedValueOnce(jsonResponse({ expense: { id: 6, vendor: 'Target' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ originalExpense: { id: 6 }, createdExpenses: [], message: 'ok' }))

    const txList = await api.getTransactions({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      accountId: 3,
      search: 'acme',
      status: 'UNLINKED',
      sortBy: 'date',
      sortOrder: 'desc',
      page: 2,
      limit: 25,
    })
    expect(txList).toEqual({ transactions: [{ id: 1 }], total: 1 })
    expect(fetchMock.mock.calls[0][0]).toContain('/api/transactions?')
    expect(fetchMock.mock.calls[0][0]).toContain('status=UNLINKED')

    const txDetail = await api.getTransactionDetail(1)
    expect(txDetail).toEqual({
      transaction: { id: 1 },
      confirmedExpenses: [],
      suggestedExpenses: [],
      suggestedExpenseCandidates: [],
      linkedInvoice: null,
      suggestedInvoices: [],
    })

    await api.createTransaction({
      date: '2026-01-02',
      description: 'Coffee',
      amount: -5,
      transactionType: 'DEBIT',
      chartAccountId: 1,
    })
    await expect(api.deleteTransaction(1)).resolves.toBeUndefined()

    const expList = await api.getExpenses({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      accountId: 3,
      search: 'paper',
      status: 'ALL',
      sortBy: 'amount',
      sortOrder: 'asc',
      page: 1,
      limit: 50,
    })
    expect(expList).toEqual({ expenses: [{ id: 5 }], total: 1 })
    expect(fetchMock.mock.calls[4][0]).not.toContain('status=ALL')

    const expDetail = await api.getExpenseDetail(5)
    expect(expDetail).toEqual({
      expense: { id: 5 },
      confirmedTransactions: [],
      suggestedTransactions: [],
      suggestedTransactionCandidates: [],
    })

    await api.createExpense({
      timestamp: '2026-01-02T12:00:00Z',
      vendor: 'Staples',
      description: 'Paper',
      amount: 25,
      tender: 'card',
    })
    await api.updateExpense(6, { vendor: 'Target' })
    await api.deleteExpense(6)
    await api.splitExpense(6, [{ amount: 12.5, description: 'Part A' }])
  })

  it('covers Reconciliation, Uploads (with 409 duplicate structured error), Summary & Backup', async () => {
    const file = new File(['hello'], 'receipt.pdf', { type: 'application/pdf' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ transactions: [], expenses: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: 'linked' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'cash' }))
      .mockResolvedValueOnce(jsonResponse({ transactions: [], expenses: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: 'uploaded' }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Duplicate receipt', existingExpense: { vendor: 'Dell' } }, 409)
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'linked' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'deleted' }))
      .mockResolvedValueOnce(jsonResponse({ netIncome: 100 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'restored', message: 'done', restored: { expenses: 2 } }))

    await api.getFlaggedItems({ startDate: '2026-01-01', endDate: '2026-02-01' })
    await api.linkExpenseToTransaction(1, 2, 10, true)
    await api.createAndLink({ type: 'transaction', targetId: 2, amount: 50, description: 'Dinner' })
    await api.unlinkExpenseFromTransaction(1, 2)
    await api.markExpenseAsCash(1)
    await api.getUnlinkedItems({
      search: 'cafe',
      page: 1,
      limit: 10,
      targetAmount: 42,
      targetDate: '2026-01-05',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    })

    expect(await api.uploadFile(file)).toEqual({ status: 'uploaded' })
    expect((fetchMock.mock.calls[6][1]?.body as FormData).get('file')).toBe(file)

    await expect(api.uploadReceiptToExpense(1, file, false)).rejects.toMatchObject({
      status: 409,
      data: { existingExpense: { vendor: 'Dell' } },
    })

    await api.uploadReceiptToExpense(1, file, true)
    expect((fetchMock.mock.calls[8][1]?.body as FormData).get('allowDuplicate')).toBe('true')

    await api.deleteReceipt(99)
    await api.getSummary({ startDate: '2026-01-01', endDate: '2026-12-31', accountId: 4 })

    const backupFile = new File(['{}'], 'backup.json', { type: 'application/json' })
    const restored = await api.restoreSystemBackup(backupFile)
    expect(restored.restored.expenses).toBe(2)
    expect((fetchMock.mock.calls[11][1]?.body as FormData).get('backup')).toBe(backupFile)
  })

  it('covers Reports, Download URLs, Review Queue, Exclusion/Deletion, Rules, Invoicing & Demo endpoints', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ report: { ok: true }, counts: {}, invoices: [], status: 'ok' }))
    )

    await api.getProfitLoss('2026-01-01', '2026-12-31')
    expect(await api.getScheduleCReport({ startDate: '2026-01-01', endDate: '2026-12-31', year: 2026 })).toEqual({ ok: true })
    expect(api.getTaxPackDownloadUrl()).toBe('/api/reports/tax-pack')
    expect(api.getTaxPackDownloadUrl({ year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' })).toContain('year=2026')
    await api.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-12-31' })
    await api.getVendorSpendReport({ startDate: '2026-01-01', endDate: '2026-12-31' })
    await api.getARAgingReport({ asOfDate: '2026-06-30', salesDays: 90 })
    await api.getTrialBalance({ startDate: '2026-01-01', endDate: '2026-12-31' })
    expect(api.getTrialBalanceExportUrl()).toBe('/api/reports/trial-balance/export')
    expect(api.getTrialBalanceExportUrl({ startDate: '2026-01-01' })).toContain('startDate=2026-01-01')
    expect(api.getSystemBackupDownloadUrl()).toBe('/api/system/backup/export')

    // Review Queue
    await api.getReviewQueueCounts()
    await api.getReviewQueue('IGNORED')
    await api.resolveReviewItems('allow', [1], [2])
    await api.batchCategorizeItems([1], [2], 50)

    // Closing & Exclusions
    await api.getClosePreflight('2026-03-31')
    await api.previewExclusion('transaction', 1)
    await api.excludeItem('expense', 2, 'PERSONAL', 'Coffee', true)
    await api.restoreItem('transaction', 1)
    await api.restoreItems([{ type: 'expense', id: 2 }])
    await api.previewBulkExclusion([{ type: 'transaction', id: 1 }])
    await api.excludeItems([{ type: 'transaction', id: 1 }], 'DUPLICATE', 'Dup')
    await api.deleteItemsBulk([{ type: 'transaction', id: 1 }])
    await api.restoreDeletedItems([{ type: 'transaction', id: 1 }])
    await api.moveDeletedToExcluded([{ type: 'transaction', id: 1 }], 'OTHER', 'Note')
    await api.deleteItemsPermanent([{ type: 'transaction', id: 1 }])

    // Bank Rules
    await api.getBankRules()
    await api.getBankRuleSuggestions()
    await api.getBankRule(5)
    await api.createBankRule({ name: 'SaaS', conditions: [{ field: 'description', operator: 'contains', value: 'AWS' }] })
    await api.updateBankRule(5, { active: false })
    await api.deleteBankRule(5)
    await api.reorderBankRules([5, 6])
    await api.applyAllBankRules()
    await api.previewBankRule({ matchLogic: 'AND', conditions: [] })

    // Invoicing
    await api.getInvoices({ status: 'PAID', search: 'Acme', year: 2026 })
    await api.getInvoice(10)
    await api.createInvoice({ clientName: 'Acme', items: [] })
    await api.updateInvoice(10, { notes: 'Updated' })
    await api.deleteInvoice(10)
    await api.matchInvoicePayment(10, 99)
    await api.markInvoicePaidCash(10, { paidDate: '2026-05-01' })
    await api.linkExpenseToInvoice(3, 10)
    await api.unlinkExpenseFromInvoice(3)
    await api.unmatchInvoicePayment(10)
    await api.getInvoiceCandidates(10)

    // Demo
    await api.getDemoStatus()
    await api.seedDemoData()
    await api.resetDemoData()
    await api.removeDemoData()

    expect(fetchMock).toHaveBeenCalledTimes(45)
  })
})
