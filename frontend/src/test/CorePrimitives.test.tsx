import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Button, type ButtonVariant } from '@/components/ui/Button'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import { Card, type CardGlow } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'

describe('Button', () => {
  it('renders all 8 semantic variants with subtle glow tokens when glow=true', () => {
    const expectedGlow: Record<ButtonVariant, string> = {
      primary: 'glow-emerald',
      secondary: 'shadow-[0_0_14px_-2px_rgba(255,255,255,0.16)]',
      danger: 'glow-rose',
      warning: 'glow-amber',
      ghost: 'text-zinc-400',
      info: 'glow-blue',
      purple: 'glow-purple',
      cyan: 'glow-cyan',
    }
    ;(Object.keys(expectedGlow) as ButtonVariant[]).forEach((variant) => {
      const { unmount } = render(
        <Button variant={variant} glow>
          btn-{variant}
        </Button>
      )
      const btn = screen.getByRole('button', { name: `btn-${variant}` })
      expect(btn.className).toContain(expectedGlow[variant])
      unmount()
    })
  })

  it('supports sizes, loading spinner, aria-busy, and disabled state', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(
      <Button size="sm" isLoading onClick={onClick}>
        Saving
      </Button>
    )
    const btn = screen.getByRole('button', { name: /saving/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn.querySelector('svg')).toBeInTheDocument()
    await user.click(btn)
    expect(onClick).not.toHaveBeenCalled()

    rerender(
      <Button size="lg" onClick={onClick}>
        Confirm
      </Button>
    )
    const lgBtn = screen.getByRole('button', { name: /confirm/i })
    expect(lgBtn).toHaveClass('px-5', 'py-2', 'rounded-xl')
    await user.click(lgBtn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Badge', () => {
  it('renders all variants, sizes, and optional glow halos', () => {
    const expectedGlow: Record<BadgeVariant, string> = {
      success: 'glow-emerald',
      danger: 'glow-rose',
      warning: 'glow-amber',
      info: 'glow-blue',
      neutral: 'bg-zinc-800',
      purple: 'glow-purple',
      cyan: 'glow-cyan',
    }
    ;(Object.keys(expectedGlow) as BadgeVariant[]).forEach((variant) => {
      const { unmount } = render(
        <Badge variant={variant} size="sm" glow>
          tag-{variant}
        </Badge>
      )
      const badge = screen.getByText(`tag-${variant}`)
      expect(badge).toHaveClass('text-[9px]')
      expect(badge.className).toContain(expectedGlow[variant])
      unmount()
    })
  })
})

describe('Card', () => {
  it('renders static layout vs flex-col and active glow borders', () => {
    const glows: CardGlow[] = ['emerald', 'cyan', 'purple', 'amber', 'rose', 'blue', 'none']
    glows.forEach((glowColor) => {
      const { unmount } = render(
        <Card active glowColor={glowColor} className="flex-col">
          Card-{glowColor}
        </Card>
      )
      const el = screen.getByText(`Card-${glowColor}`)
      expect(el).toHaveClass('flex-col')
      if (glowColor !== 'none') {
        expect(el.className).toContain(`glow-border-${glowColor}`)
      }
      unmount()
    })
  })

  it('acts as an accessible button when onClick is provided without hijacking child events', async () => {
    const user = userEvent.setup()
    const onCardClick = vi.fn()
    const onInnerClick = vi.fn((e: React.MouseEvent) => e.stopPropagation())
    const onCustomKeyDown = vi.fn()

    render(
      <Card onClick={onCardClick} onKeyDown={onCustomKeyDown}>
        <span>Outer Label</span>
        <button type="button" onClick={onInnerClick}>
          Inner Action
        </button>
      </Card>
    )

    const card = screen.getByRole('button', { name: /Outer Label/i })
    await user.click(card)
    expect(onCardClick).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onCustomKeyDown).toHaveBeenCalledTimes(1)
    expect(onCardClick).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(card, { key: ' ' })
    expect(onCardClick).toHaveBeenCalledTimes(3)

    // Keydown originating on nested button must not activate card
    const inner = screen.getByRole('button', { name: 'Inner Action' })
    fireEvent.keyDown(inner, { key: 'Enter' })
    expect(onCardClick).toHaveBeenCalledTimes(3)
  })
})

describe('Modal', () => {
  it('returns null when closed', () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()} title="Hidden">
        Secret
      </Modal>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('handles portal mounting, close button, Escape key, backdrop click, footer, and suspended state', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal
        isOpen
        onClose={onClose}
        title="Audit Dialog"
        maxWidth="2xl"
        footer={<button type="button">Save Changes</button>}
      >
        <input aria-label="First field" />
        <button type="button">Middle action</button>
      </Modal>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const titleEl = screen.getByText('Audit Dialog')
    expect(dialog).toHaveAttribute('aria-labelledby', titleEl.id)
    expect(dialog.className).toContain('max-w-2xl')
    expect(screen.getByText('Save Changes')).toBeInTheDocument()

    // Focus trap cycles forward & backward
    const closeBtn = screen.getByRole('button', { name: 'Close modal' })
    const saveBtn = screen.getByRole('button', { name: 'Save Changes' })
    expect(closeBtn).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(saveBtn).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(closeBtn).toHaveFocus()

    // Escape closes modal
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    // Backdrop click closes modal; click inside dialog does not
    fireEvent.click(screen.getByLabelText('First field'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(dialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(2)

    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(3)

    // Suspended blocks Escape & backdrop dismiss and applies invisible styling
    rerender(
      <Modal isOpen suspended onClose={onClose} title="Audit Dialog">
        <span>Busy</span>
      </Modal>
    )
    const suspendedDialog = screen.getByRole('dialog')
    expect(suspendedDialog.parentElement?.className).toContain('invisible')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(suspendedDialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
