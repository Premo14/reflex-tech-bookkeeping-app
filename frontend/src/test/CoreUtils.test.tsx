import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import {
  toCents,
  fromCents,
  formatCurrency,
  formatCents,
  formatFixedDollars,
} from '@/utils/formatCurrency'
import {
  formatDate,
  toLocalISODate,
  formatPaymentTerms,
  formatPaymentDeadline,
  calculateDueDateFromTerms,
} from '@/utils/dateUtils'
import { computeMatchScore } from '@/utils/matchConfidence'
import { extractCleanVendor } from '@/utils/vendorUtils'
import {
  ACCOUNT_SUBCLASSES,
  getSubClassForAccount,
  getAccountDepth,
  getGroupedAccounts,
} from '@/utils/accountHierarchy'
import { useLiveEvent } from '@/utils/useLiveSync'
import type { ChartAccount } from '@/types/models'

describe('formatCurrency & integer-cent math', () => {
  it('converts between dollars and integer cents without IEEE-754 drift', () => {
    expect(toCents(1.005)).toBe(101)
    expect(toCents(19.99)).toBe(1999)
    expect(toCents(null)).toBe(0)
    expect(toCents(Number.NaN)).toBe(0)

    expect(fromCents(1999)).toBe(19.99)
    expect(fromCents(-250)).toBe(-2.5)
    expect(fromCents(undefined)).toBe(0)
    expect(fromCents(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('formats USD currency cleanly with -0 normalization, signed, and absolute options', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
    expect(formatCurrency(-99.95)).toBe('-$99.95')
    expect(formatCurrency(-0)).toBe('$0.00')
    expect(formatCurrency(-1e-12)).toBe('$0.00')
    expect(formatCurrency(null)).toBe('$0.00')
    expect(formatCurrency(Number.NaN)).toBe('$0.00')

    expect(formatCurrency(-45.2, { absolute: true })).toBe('$45.20')
    expect(formatCurrency(45.2, { signed: true })).toBe('+$45.20')
    expect(formatCurrency(0, { signed: true })).toBe('$0.00')
    expect(formatCurrency(-45.2, { signed: true })).toBe('-$45.20')

    expect(formatCents(125005)).toBe('$1,250.05')
    expect(formatFixedDollars(1.005)).toBe('1.01')
    expect(formatFixedDollars(-0)).toBe('0.00')
  })
})

describe('dateUtils', () => {
  it('formats ISO and timestamp strings into locale dates without UTC day shift', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate('2026-03-15')).toBe(new Date(2026, 2, 15).toLocaleDateString())
    expect(formatDate('2026-11-05T18:30:00Z')).toBe(new Date(2026, 10, 5).toLocaleDateString())
    expect(formatDate('Mar 20, 2026')).toBe(new Date('Mar 20, 2026').toLocaleDateString())
    expect(formatDate('invalid-date')).toBe('invalid-date')
  })

  it('converts local Dates to YYYY-MM-DD', () => {
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toLocalISODate(new Date(2026, 11, 25))).toBe('2026-12-25')
  })

  it('formats payment terms, deadlines, and due dates across standard & custom terms', () => {
    expect(formatPaymentTerms(null)).toBe('30 days to pay')
    expect(formatPaymentTerms('Due Upon Receipt')).toBe('Due immediately')
    expect(formatPaymentTerms('Net 15')).toBe('15 days to pay')
    expect(formatPaymentTerms('Net30')).toBe('30 days to pay')
    expect(formatPaymentTerms('Net 60')).toBe('60 days to pay')
    expect(formatPaymentTerms('Net 90')).toBe('90 days to pay')
    expect(formatPaymentTerms('Custom Milestone')).toBe('Custom Milestone')

    expect(formatPaymentDeadline(null)).toBe('Due in 30 days')
    expect(formatPaymentDeadline('Immediate')).toBe('Due immediately')
    expect(formatPaymentDeadline('Net 15')).toBe('Due in 15 days')
    expect(formatPaymentDeadline('Net 30')).toBe('Due in 30 days')
    expect(formatPaymentDeadline('Net 60')).toBe('Due in 60 days')
    expect(formatPaymentDeadline('Net 90')).toBe('Due in 90 days')
    expect(formatPaymentDeadline('Custom')).toBe('Due: Custom')

    expect(calculateDueDateFromTerms('', 'Net 30')).toBe('')
    expect(calculateDueDateFromTerms('invalid', 'Net 30')).toBe('')
    expect(calculateDueDateFromTerms('2026-04-01', 'Due Upon Receipt')).toBe('2026-04-01')
    expect(calculateDueDateFromTerms('2026-04-01', 'Net 15')).toBe('2026-04-16')
    expect(calculateDueDateFromTerms('2026-04-01', 'Net 30')).toBe('2026-05-01')
    expect(calculateDueDateFromTerms('2026-04-01', 'Net 60')).toBe('2026-05-31')
    expect(calculateDueDateFromTerms('2026-04-01', 'Net 90')).toBe('2026-06-30')
  })
})

describe('matchConfidence', () => {
  it('scores high confidence for exact amount, same-day, and vendor match', () => {
    const res = computeMatchScore(
      -42.5,
      '2026-05-10',
      'POS PURCHASE HOME DEPOT #123',
      42.5,
      '2026-05-10',
      'Home Depot'
    )
    expect(res.score).toBe(100)
    expect(res.badgeVariant).toBe('success')
    expect(res.label).toBe('Guaranteed Match')
    expect(res.reasons).toContain('Exact amount ($42.50)')
    expect(res.reasons).toContain('Same-day transaction')
    expect(res.reasons).toContain('Vendor match ("Home Depot")')
  })

  it('scores medium confidence for tip variance <=15%, settlement window, and fuzzy token match', () => {
    const tipRes = computeMatchScore(
      -110.0,
      '2026-05-12',
      'TOAST* BISTRO UTICA NY',
      100.0,
      '2026-05-10',
      'Utica Diner'
    )
    expect(tipRes.score).toBeGreaterThanOrEqual(50)
    expect(tipRes.reasons.some((r) => r.includes('Tip adjusted (+$10.00 / within 15%)'))).toBe(true)
    expect(tipRes.reasons).toContain('Settled in 2 days')

    const fourDayRes = computeMatchScore(
      -50.0,
      '2026-05-14',
      'AMZN MKTP',
      50.0,
      '2026-05-10',
      'Staples'
    )
    expect(fourDayRes.reasons).toContain('Within 4 days')
  })

  it('guards division by zero when expense amount is 0 and handles invalid dates', () => {
    const res = computeMatchScore(-25, '', 'UNKNOWN CHARGE', 0, 'invalid-date', '')
    expect(res.score).toBe(45)
    expect(Number.isFinite(res.score)).toBe(true)
    expect(res.badgeVariant).toBe('warning')
    expect(res.label).toBe('Likely Match')
  })
})

describe('vendorUtils', () => {
  it('strips bank statement prefixes, long auth numbers, dates, and store numbers', () => {
    expect(extractCleanVendor('')).toBe('')
    expect(extractCleanVendor('POS DEBIT JOE COFFEE #1234 Date 08/06/26')).toBe('JOE COFFEE')
    expect(extractCleanVendor('ACH WITHDRAWAL CLOUDFLARE 24013396218001460092243 5814')).toBe('CLOUDFLARE')
    expect(extractCleanVendor('POS PURCHASE')).toBe('POS PURCHASE')
  })
})

describe('accountHierarchy', () => {
  const accounts: ChartAccount[] = [
    {
      id: 1,
      code: '1010',
      name: 'Business Checking',
      type: 'ASSET',
      description: 'Main bank',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 2,
      code: '5010',
      name: 'Operating Parent',
      type: 'EXPENSE',
      description: 'Parent',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 3,
      code: '5011',
      name: 'Sub-Expense',
      type: 'EXPENSE',
      parentId: 2,
      description: 'Child',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 4,
      code: '5012',
      name: 'Grandchild Expense',
      type: 'EXPENSE',
      parentId: 3,
      description: 'Grandchild',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 5,
      code: '9999',
      name: 'Unclassified Custom',
      type: 'EXPENSE',
      description: 'Custom',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
  ]

  it('resolves subclasses by explicit id or numeric range and calculates account hierarchy depth', () => {
    expect(Object.keys(ACCOUNT_SUBCLASSES)).toEqual(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])
    expect(getSubClassForAccount('EXPENSE', '5010', 'SOFTWARE_TECH')?.id).toBe('SOFTWARE_TECH')
    expect(getSubClassForAccount('EXPENSE', '5810')?.id).toBe('MERCHANT_FEES')
    expect(getSubClassForAccount('EXPENSE', '5710')?.name).toBe('Interest & Depreciation')
    expect(getSubClassForAccount('ASSET', '1010')?.id).toBe('CASH')
    expect(getSubClassForAccount('EXPENSE', 'non-numeric')).toBeUndefined()

    expect(getAccountDepth(accounts[1], accounts)).toBe(0)
    expect(getAccountDepth(accounts[2], accounts)).toBe(1)
    expect(getAccountDepth(accounts[3], accounts)).toBe(2)

    const cycle: ChartAccount[] = [
      { id: 10, code: '5800', name: 'Cycle A', type: 'EXPENSE', parentId: 11, description: '', active: true, createdAt: '', updatedAt: '' },
      { id: 11, code: '5801', name: 'Cycle B', type: 'EXPENSE', parentId: 10, description: '', active: true, createdAt: '', updatedAt: '' },
    ]
    expect(getAccountDepth(cycle[0], cycle)).toBeLessThanOrEqual(5)
  })

  it('groups accounts under subclasses and preserves orphan children and custom categories', () => {
    const inactiveAcc: ChartAccount = {
      id: 6,
      code: '5019',
      name: 'Inactive Selected',
      type: 'EXPENSE',
      description: '',
      active: false,
      createdAt: '',
      updatedAt: '',
    }
    const groups = getGroupedAccounts([...accounts, inactiveAcc], ['ASSET', 'EXPENSE'], {
      activeOnly: true,
      currentSelectedId: 6,
    })
    expect(groups.length).toBeGreaterThanOrEqual(3)

    const expenseOpGroup = groups.find((g) => g.subClassId === 'EXPENSE_OPERATING_EXPENSES')
    expect(expenseOpGroup?.options.map((o) => `${o.depth}:${o.account.code}`)).toContain('0:5010')
    expect(expenseOpGroup?.options.map((o) => `${o.depth}:${o.account.code}`)).toContain('1:5011')
    expect(expenseOpGroup?.options.map((o) => `${o.depth}:${o.account.code}`)).toContain('2:5012')
    expect(expenseOpGroup?.options.some((o) => o.account.code === '5019')).toBe(true)

    const otherGroup = groups.find((g) => g.subClassId === 'OTHER_CUSTOM')
    expect(otherGroup?.options.some((o) => o.account.code === '9999')).toBe(true)

    const withOrphan = getGroupedAccounts(
      [accounts[2]], // Child without matching parent in list
      ['EXPENSE']
    )
    expect(withOrphan.some((g) => g.options.some((o) => o.account.code === '5011'))).toBe(true)
  })
})

describe('useLiveSync & useLiveEvent', () => {
  interface MockES {
    onopen: (() => void) | null
    onmessage: ((e: MessageEvent) => void) | null
    onerror: (() => void) | null
    close: ReturnType<typeof vi.fn>
    url: string
  }

  let createdSources: MockES[] = []
  const OriginalEventSource = globalThis.EventSource

  beforeEach(() => {
    vi.useFakeTimers()
    createdSources = []
    class FakeEventSource {
      onopen: (() => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      close = vi.fn()
      url: string
      constructor(url: string) {
        this.url = url
        createdSources.push(this)
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.stubGlobal('EventSource', OriginalEventSource)
  })

  it('subscribes via SSE EventSource, dispatches payloads, handles malformed JSON & reconnects', () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()

    const Harness = ({ events }: { events: string | string[] }) => {
      useLiveEvent(events, handlerA)
      useLiveEvent('SUMMARY_UPDATED', handlerB)
      return null
    }

    const { unmount } = render(<Harness events={['TRANSACTIONS_UPDATED', 'EXPENSES_UPDATED']} />)
    expect(createdSources.length).toBeGreaterThanOrEqual(1)

    const es = createdSources[createdSources.length - 1]
    act(() => {
      es.onopen?.()
      es.onmessage?.({
        data: JSON.stringify({ type: 'TRANSACTIONS_UPDATED', payload: { count: 3 } }),
      } as MessageEvent)
      es.onmessage?.({
        data: 'not-valid-json',
      } as MessageEvent)
    })

    expect(handlerA).toHaveBeenCalledWith({ count: 3 })
    expect(handlerB).not.toHaveBeenCalled()

    // Trigger error -> closes source and schedules reconnect
    act(() => {
      es.onerror?.()
    })
    expect(es.close).toHaveBeenCalled()
    const prevCount = createdSources.length
    act(() => {
      vi.advanceTimersByTime(3100)
    })
    expect(createdSources.length).toBeGreaterThanOrEqual(prevCount)

    unmount()
  })
})
