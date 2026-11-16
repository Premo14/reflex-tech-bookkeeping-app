# Reflex Tech Bookkeeping Platform — Design System & Style Guide

**Design Tenet**: Modern, sleek, tactile, and high-density UI/UX inspired by **GitHub** and **Resend**, enriched with **vibrant financial color coding** and **subtle glowing touchpoints**.

---

## 1. Core Visual Principles

1. **GitHub Precision & Density**:
   - Deep dark mode surfaces (`#050505` canvas, `zinc-900` / `zinc-950` cards, `border-white/10` crisp hairline borders).
   - High information density with clean, compact typography (`text-xs`, `text-sm`).
   - Monospace tabular numerals (`font-mono tabular-nums tracking-tight`) for all financial figures, dates, and bank balances.
2. **Resend Sleekness & Radiance**:
   - Smooth, subtle glassmorphism (`backdrop-blur-md`, `bg-white/[0.02]` to `bg-white/[0.05]`).
   - Ambient glowing touchpoints on primary action buttons, active tabs, and key financial metrics.
   - Tasteful restraint: No over-the-top neon or garish distractions. Glows must be subtle ambient halos (`0 0 16px -2px rgba(..., 0.25)`).
3. **Tactile Micro-Interactions**:
   - Seamless micro-press depression: `active:scale-[0.98]` on buttons and clickable cards.
   - Smooth cubic-bezier transitions (`150ms - 200ms cubic-bezier(0.16, 1, 0.3, 1)`).
   - Instantaneous, jitter-free tooltips with zero top-left visual snapping.

---

## 2. Vibrant Financial Color Palette

Every color carries strict, consistent financial semantics across the entire application:

| Semantic Domain | Primary Color Token | Subtle Glow Token | Application |
| :--- | :--- | :--- | :--- |
| **Revenue & Health** | `emerald-400` / `emerald-500` | `glow-emerald` (`rgba(16,185,129,0.25)`) | Deposits, gross income, net profit, GAAP Assets, `BALANCED` status |
| **Liquidity & Banking** | `cyan-400` / `cyan-500` | `glow-cyan` (`rgba(6,182,212,0.25)`) | Cash flow, bank register, active sync, live SSE indicators, checking/savings |
| **Invoicing & Clients** | `purple-400` / `purple-500` | `glow-purple` (`rgba(168,85,247,0.25)`) | Client invoices, accounts receivable (A/R), contractor 1099-NEC, payees |
| **Tax & Review Warnings** | `amber-400` / `amber-500` | `glow-amber` (`rgba(245,158,11,0.25)`) | IRS Schedule C, Form 1040-ES, review queue warnings, unlinked items, partial matches |
| **Expenses & Outflows** | `rose-400` / `red-400` | `glow-rose` (`rgba(244,63,94,0.25)`) | Operating expenses, GAAP Liabilities, overdue invoices, burn rate, lockout barriers |
| **Double-Entry & Audit** | `blue-400` / `blue-500` | `glow-blue` (`rgba(59,130,246,0.25)`) | Trial balance verification, GAAP debit/credit legs, audit logs, system rules |

---

## 3. Typography Scale & Formatting Standards

### Font Family Hierarchy
- **UI Interface & Labels**: System sans-serif (`font-sans`), `font-medium` for regular text, `font-semibold` / `font-bold` for headers.
- **Financial Numbers & Dates**: Monospace tabular numerals (`font-mono tabular-nums tracking-tight`) to ensure currency columns align vertically.

### Standardized Sizing
- **Micro Badges & Timestamps**: `text-[9px]` or `text-[10px]` uppercase tracking-wider.
- **Card Metadata & Table Secondary Info**: `text-xs` (12px) text-zinc-400.
- **Primary Body & Table Cell Values**: `text-xs` or `text-sm` (13-14px) text-zinc-100.
- **Section Headers & Metric Cards**: `text-sm` font-semibold text-white.
- **Modal Headers & Large Totals**: `text-base` or `text-lg` font-bold text-white.

### Canonical Currency Formatting
**NEVER** use naked `.toFixed(2)` or manual string concatenations like `'$' + val`.  
Always use standard currency formatters with exact 2-decimal precision:
```tsx
// Correct Canonical Usage:
formatCurrency(transaction.Amount)       // -> "$1,234.50" or "-$45.00"
formatCurrency(invoice.BalanceDue)       // -> "$850.00"
```

---

## 4. Glowing Touchpoints & CSS Utilities

Add or use these standardized glow utilities in `index.css`:

```css
/* Ambient Glowing Touchpoints */
.glow-emerald { box-shadow: 0 0 16px -2px rgba(16, 185, 129, 0.25); }
.glow-cyan    { box-shadow: 0 0 16px -2px rgba(6, 182, 212, 0.25); }
.glow-purple  { box-shadow: 0 0 16px -2px rgba(168, 85, 247, 0.25); }
.glow-amber   { box-shadow: 0 0 16px -2px rgba(245, 158, 11, 0.25); }
.glow-rose    { box-shadow: 0 0 16px -2px rgba(244, 63, 94, 0.25); }
.glow-blue    { box-shadow: 0 0 16px -2px rgba(59, 130, 246, 0.25); }

/* Resend-Style Hairline Glowing Borders */
.glow-border-emerald { box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.25), 0 0 12px rgba(16, 185, 129, 0.12); }
.glow-border-purple  { box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.25), 0 0 12px rgba(168, 85, 247, 0.12); }
.glow-border-cyan    { box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.25), 0 0 12px rgba(6, 182, 212, 0.12); }

/* Glass Surfaces */
.surface-glass {
  background: rgba(13, 17, 23, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

---

## 5. Canonical Shared UI Component Inventory & Reusability Mandate

Hermes and all developers **MUST** reuse these canonical components instead of writing one-off inline HTML elements:

### 1. `Button` (`frontend/src/components/ui/Button.tsx`)
- **Variants**: `'primary'` (emerald), `'secondary'` (glass zinc), `'danger'` (rose), `'warning'` (amber), `'ghost'` (transparent), `'info'` (blue), `'purple'` (invoicing), `'cyan'` (banking).
- **Sizes**: `'sm'` (`px-2.5 py-1 text-xs`), `'md'` (`px-3.5 py-1.5 text-xs`), `'lg'` (`px-5 py-2 text-sm`).
- **Props**: `isLoading?: boolean`, `glow?: boolean`.
- **Anti-Pattern**: Writing `<button className="px-3 py-1 bg-emerald-500 ...">` raw in components.

### 2. `Badge` (`frontend/src/components/ui/Badge.tsx`)
- **Variants**: `'success'` (emerald), `'danger'` (rose), `'warning'` (amber), `'info'` (blue), `'purple'`, `'cyan'`, `'neutral'`.
- **Sizes**: `'sm'` (`text-[9px]`), `'md'` (`text-[10px]`).
- **Props**: `glow?: boolean`.
- **Anti-Pattern**: Writing `<span className="px-2 py-0.5 rounded-full text-xs ...">` with ad-hoc colors.

### 3. `Card` (`frontend/src/components/ui/Card.tsx`)
- **Purpose**: Container for metric cards, list items, drawer sections, and summary panels.
- **Features**: Smooth hover lift (`hover:-translate-y-0.5`), subtle glass border (`border-white/10`), active highlight.
- **Anti-Pattern**: Handcrafting custom `div` containers with differing border radiuses and background opacities.

### 4. `Modal` (`frontend/src/components/ui/Modal.tsx`)
- **Features**: Pre-styled backdrop blur, animated zoom-in (`animate-in zoom-in-95`), responsive max-widths (`sm`, `md`, `lg`, `xl`, `2xl`, `4xl`, `6xl`), sticky header and footer, Escape key listener.
- **Anti-Pattern**: Writing raw fixed-position backdrop overlays from scratch.

### 5. `Input` & `MoneyInput` (`frontend/src/components/ui/`)
- **Features**: Crisp dark surface, focus ring with subtle emerald glow, standardized error states, currency dollar adornment.
- **Anti-Pattern**: Unstyled native `<input type="text">` or custom regex parsers on float inputs.

### 6. `Select` (`frontend/src/components/ui/Select.tsx`)
- **Features**: Custom dark dropdown with keyboard navigation, search filtering, and categorized option groups.

### 7. `Tooltip` (`frontend/src/components/ui/Tooltip.tsx`)
- **Features**: Pre-calculated coordinates, zero top-left snap artifacts, snappy directional zoom animation.

---

## 6. Audit & Refactoring Rules for Autonomous Loops

When Hermes performs an audit pass on UI components:
1. **Identify Raw Elements**: Scan for `<button>`, `<span className="...rounded-full...">`, and inline `toFixed(2)`.
2. **Replace with Canonical Primitives**: Drop in `Button`, `Badge`, `Card`, or `formatCurrency` preserving all handlers (`onClick`, `disabled`, `type`).
3. **Verify Responsiveness**: Ensure replacement does not disrupt mobile breakpoints (320px–390px).
4. **Compile & Test Gate**: Run `docker compose exec frontend sh -c "npx tsc -b && npm run build"` to guarantee zero TypeScript or build regressions.
