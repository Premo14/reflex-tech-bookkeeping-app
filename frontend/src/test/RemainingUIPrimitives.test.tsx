import { describe, it, expect, vi } from 'vitest'
import { useState, type ReactElement } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Input } from '@/components/ui/Input'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Select } from '@/components/ui/Select'
import { Tooltip, TooltipProvider, useTooltip } from '@/components/ui/Tooltip'
import { ConfirmationProvider, ConfirmModal, useConfirm } from '@/components/ui/ConfirmDialog'
import Pagination from '@/components/ui/Pagination'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

describe('Input', () => {
  it('associates label, icon, error alert state, and aria-invalid', () => {
    render(
      <Input
        label="Vendor Name"
        placeholder="Acme"
        icon={<span data-testid="search-ic">Q</span>}
        error="Vendor required"
      />
    )
    const input = screen.getByLabelText('Vendor Name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Vendor required')
    expect(screen.getByTestId('search-ic')).toBeInTheDocument()
  })
})

describe('MoneyInput', () => {
  it('renders dollar prefix, formats blur decimals, handles negatives & empty values, and blocks scientific keys', async () => {
    const onChange = vi.fn()
    const ControlledHarness = ({ allowNegative = false }: { allowNegative?: boolean }) => {
      const [val, setVal] = useState<number>(42.5)
      return (
        <div>
          <MoneyInput
            label="Total"
            value={val}
            allowNegative={allowNegative}
            onChange={(next) => {
              setVal(next)
              onChange(next)
            }}
          />
          <button type="button" onClick={() => setVal(-75.25)}>
            Force External
          </button>
        </div>
      )
    }

    const { rerender } = render(<ControlledHarness />)

    expect(screen.getByText('$')).toBeInTheDocument()
    const input = screen.getByLabelText('Total') as HTMLInputElement
    expect(input.value).toBe('42.50')

    // Blocks e, E, +, and '-' when allowNegative is false
    expect(fireEvent.keyDown(input, { key: 'e' })).toBe(false)
    expect(fireEvent.keyDown(input, { key: '-' })).toBe(false)

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '-19.995' } })
    expect(onChange).toHaveBeenLastCalledWith(19.995)

    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(20)
    expect(input.value).toBe('20.00')

    // Clearing input resets to 0 on change & blur
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(0)
    fireEvent.blur(input)
    expect(input.value).toBe('0.00')

    // External prop update while focused syncs string
    rerender(<ControlledHarness allowNegative />)
    fireEvent.focus(input)
    fireEvent.click(screen.getByRole('button', { name: 'Force External' }))
    expect(input.value).toBe('-75.25')
    expect(fireEvent.keyDown(input, { key: '-' })).toBe(true)
  })
})

describe('Select', () => {
  it('supports optgroups, search filtering, mouse selection, outside click, and full keyboard navigation', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <div>
        <button type="button">Outside</button>
        <Select label="Category" searchable value="5050" error="Pick a category" onChange={onChange}>
          <optgroup label="Operating">
            <option value="5050">Office Supplies</option>
            <option value="5060">Supplies &amp; Materials</option>
          </optgroup>
          <option value="5090">Meals</option>
        </Select>
      </div>
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Pick a category')
    const trigger = screen.getByRole('button', { name: 'Category' })
    expect(trigger).toHaveTextContent('Office Supplies')

    // Open with ArrowDown, navigate with End / Home / ArrowUp / ArrowDown, confirm with Enter
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('Operating')).toBeInTheDocument()

    const container = trigger.closest('div[class*="flex-col"]')!
    fireEvent.keyDown(container, { key: 'End' })
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-opt-2'))
    fireEvent.keyDown(container, { key: 'Home' })
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-opt-0'))
    fireEvent.keyDown(container, { key: 'ArrowUp' })
    fireEvent.keyDown(container, { key: 'ArrowDown' })
    fireEvent.keyDown(container, { key: 'ArrowDown' })
    fireEvent.keyDown(container, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ target: { value: '5060' } })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // Search filtering + Escape close
    await user.click(trigger)
    const search = screen.getByPlaceholderText('Search...')
    await user.type(search, 'zzz-nomatch')
    expect(screen.getByText('No options found')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'Meals')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(container, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // Outside click dismisses
    await user.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('TooltipProvider and Tooltip', () => {
  it('throws outside TooltipProvider', () => {
    const Bad = () => {
      useTooltip()
      return null
    }
    expect(() => render(<Bad />)).toThrow(/TooltipProvider/)
  })

  it('triggers tooltips via pointermove, keyboard focusin, native title interception, and placement flipping', () => {
    vi.useFakeTimers()
    try {
      const TooltipHelper = () => {
        const { showTooltip, hideTooltip } = useTooltip()
        return (
          <div>
            <Tooltip content="Top tip" position="top" delay={50}>
              <button type="button">Btn Top</button>
            </Tooltip>
            <button type="button" title="Native Suppressed" data-tooltip-position="bottom">
              Btn Bottom
            </button>
            <button
              type="button"
              onClick={(e) => showTooltip(e.currentTarget, 'Left tip', 'left', 0)}
              onBlur={() => hideTooltip()}
            >
              Manual Left
            </button>
            <button
              type="button"
              onClick={(e) => showTooltip(e.currentTarget, 'Right tip', 'right', 0)}
            >
              Manual Right
            </button>
          </div>
        )
      }

      render(
        <TooltipProvider defaultDelay={50}>
          <TooltipHelper />
        </TooltipProvider>
      )

      const topBtn = screen.getByRole('button', { name: 'Btn Top' })
      vi.spyOn(topBtn, 'getBoundingClientRect').mockReturnValue({
        top: 2, left: 200, bottom: 22, right: 260, width: 60, height: 20, x: 200, y: 2, toJSON: () => {},
      })

      // Keyboard focus shows immediately
      fireEvent.focusIn(topBtn)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Top tip')
      fireEvent.focusOut(topBtn)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      // Native title intercepted via pointermove + timer
      const bottomBtn = screen.getByRole('button', { name: 'Btn Bottom' })
      vi.spyOn(bottomBtn, 'getBoundingClientRect').mockReturnValue({
        top: window.innerHeight - 10, left: 100, bottom: window.innerHeight, right: 180, width: 80, height: 10, x: 100, y: window.innerHeight - 10, toJSON: () => {},
      })
      fireEvent(bottomBtn, new MouseEvent('pointermove', { bubbles: true }))
      act(() => {
        vi.advanceTimersByTime(60)
      })
      expect(screen.getByRole('tooltip')).toHaveTextContent('Native Suppressed')
      expect(bottomBtn).not.toHaveAttribute('title')

      // Escape dismisses and restores native title
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      expect(bottomBtn).toHaveAttribute('title', 'Native Suppressed')

      // Manual left & right placements + pointerdown, scroll, resize dismiss
      fireEvent.click(screen.getByRole('button', { name: 'Manual Left' }))
      expect(screen.getByRole('tooltip')).toHaveTextContent('Left tip')
      fireEvent(window, new Event('scroll'))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Manual Right' }))
      expect(screen.getByRole('tooltip')).toHaveTextContent('Right tip')
      fireEvent(window, new Event('resize'))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Manual Right' }))
      fireEvent(document, new MouseEvent('pointerdown', { bubbles: true }))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      // Non-element children pass through unchanged
      render(<Tooltip content="Ignored">{'plain text' as unknown as ReactElement}</Tooltip>)
      expect(screen.getByText('plain text')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ConfirmationProvider & ConfirmModal', () => {
  it('throws useConfirm outside provider', () => {
    const Bad = () => {
      useConfirm()
      return null
    }
    expect(() => render(<Bad />)).toThrow(/ConfirmationProvider/)
  })

  it('handles confirm (object + string), alert, and Escape key resolution', async () => {
    const user = userEvent.setup()
    const results: unknown[] = []

    const Harness = () => {
      const { confirm, alert } = useConfirm()
      return (
        <div>
          <button
            type="button"
            onClick={async () => results.push(await confirm({ title: 'Delete?', message: 'Sure', variant: 'danger' }))}
          >
            Trigger Confirm
          </button>
          <button type="button" onClick={async () => results.push(await confirm('Quick confirm'))}>
            String Confirm
          </button>
          <button
            type="button"
            onClick={async () => {
              await alert('Saved ok', 'Done')
              results.push('alerted')
            }}
          >
            Trigger Alert
          </button>
        </div>
      )
    }

    render(
      <ConfirmationProvider>
        <Harness />
        <ConfirmModal isOpen={false} title="Hidden" message="Nope" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </ConfirmationProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Trigger Confirm' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('glow-border-rose')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(results).toContain(true))

    await user.click(screen.getByRole('button', { name: 'String Confirm' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(results).toContain(false))

    await user.click(screen.getByRole('button', { name: 'Trigger Alert' }))
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(results).toContain('alerted'))
  })
})

describe('Pagination & LoadingSpinner', () => {
  it('hides Pagination when totalPages <= 1 and navigates when multi-page', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const { rerender } = render(<Pagination currentPage={1} totalPages={1} onPageChange={onPageChange} />)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()

    rerender(<Pagination currentPage={2} totalPages={5} onPageChange={onPageChange} />)
    expect(screen.getByText('Page 2 of 5')).toHaveClass('tabular-nums')
    await user.click(screen.getByRole('button', { name: 'Prev' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3)
  })

  it('applies tailwind text color class vs raw stroke on LoadingSpinner', () => {
    const { rerender } = render(<LoadingSpinner size="lg" color="text-emerald-400" />)
    const svg1 = screen.getByRole('status', { name: 'Loading' })
    expect(svg1.getAttribute('class')).toContain('text-emerald-400')

    rerender(<LoadingSpinner color="#22d3ee" />)
    const circle = screen.getByRole('status').querySelector('circle')
    expect(circle).toHaveAttribute('stroke', '#22d3ee')
  })
})
