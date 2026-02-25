# colour-themes-for-front-end-design

Colour palette, typography, spacing, and visual language for tx-agent-kit web + mobile frontends.

## Brand Identity

tx-agent-kit is an **agent-first execution platform**. The visual language should communicate:
- **Precision** — clean lines, deliberate spacing, sharp typography
- **Trust** — subdued, confident palette; no gimmicks
- **Depth** — layered surfaces, soft shadows, subtle gradients that create visual hierarchy

## Colour Palette

### Core Tokens (CSS custom properties)

```css
:root {
  color-scheme: light;

  /* ── Background tiers ─────────────────────────── */
  --bg:            #f5f7fb;    /* page canvas — warm neutral grey */
  --surface:       #ffffff;    /* cards, modals, panels */
  --surface-2:     #f0f2f7;    /* inset/secondary surfaces */
  --surface-3:     #e8ebf2;    /* tertiary — table rows, hover states */

  /* ── Text hierarchy ───────────────────────────── */
  --text:          #111827;    /* primary body text — near-black */
  --text-secondary:#4b5563;    /* descriptions, helper text */
  --muted:         #6b7280;    /* labels, placeholders, captions */
  --text-inverse:  #ffffff;    /* text on dark/primary backgrounds */

  /* ── Accent / Brand ───────────────────────────── */
  --primary:        #4f46e5;   /* indigo-600 — primary actions */
  --primary-hover:  #4338ca;   /* indigo-700 — hover/active */
  --primary-subtle: #eef2ff;   /* indigo-50  — badges, highlights */
  --primary-ring:   rgba(79, 70, 229, 0.25); /* focus ring */

  /* ── Semantic states ──────────────────────────── */
  --success:        #059669;   /* emerald-600 */
  --success-subtle: #ecfdf5;   /* emerald-50 */
  --warning:        #d97706;   /* amber-600 */
  --warning-subtle: #fffbeb;   /* amber-50 */
  --danger:         #dc2626;   /* red-600 */
  --danger-subtle:  #fef2f2;   /* red-50 */
  --info:           #2563eb;   /* blue-600 */
  --info-subtle:    #eff6ff;   /* blue-50 */

  /* ── Borders & dividers ───────────────────────── */
  --border:         #e5e7eb;   /* grey-200 — default border */
  --border-strong:  #d1d5db;   /* grey-300 — emphasis border */
  --divider:        #f3f4f6;   /* grey-100 — subtle dividers */

  /* ── Shadows ──────────────────────────────────── */
  --shadow-sm:   0 1px 2px rgba(0,0,0,0.04);
  --shadow-md:   0 4px 12px rgba(0,0,0,0.06);
  --shadow-lg:   0 8px 24px rgba(0,0,0,0.08);
  --shadow-xl:   0 16px 48px rgba(0,0,0,0.10);
  --shadow-glow: 0 0 0 3px var(--primary-ring);

  /* ── Radius ───────────────────────────────────── */
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   14px;
  --radius-xl:   20px;
  --radius-full: 9999px;

  /* ── Transitions ──────────────────────────────── */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 120ms;
  --duration-normal: 200ms;
}
```

### Dark Mode (future — define tokens, do not ship yet)

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg:            #0f1117;
    --surface:       #1a1d27;
    --surface-2:     #242835;
    --surface-3:     #2e3343;
    --text:          #f3f4f6;
    --text-secondary:#d1d5db;
    --muted:         #9ca3af;
    --primary:       #818cf8;
    --primary-hover: #6366f1;
    --primary-subtle:#1e1b4b;
    --border:        #374151;
    --border-strong: #4b5563;
    --divider:       #1f2937;
  }
}
```

## Typography

| Role           | Family                                | Weight | Size     |
|----------------|---------------------------------------|--------|----------|
| Headings       | `"Inter", "Segoe UI", sans-serif`     | 700    | 1.75rem–2.25rem |
| Subheadings    | `"Inter", "Segoe UI", sans-serif`     | 600    | 1rem–1.25rem |
| Body           | `"Inter", "Segoe UI", sans-serif`     | 400    | 0.9375rem (15px) |
| Captions/Label | `"Inter", "Segoe UI", sans-serif`     | 500    | 0.8125rem (13px) |
| Monospace      | `"IBM Plex Mono", monospace`          | 400    | 0.875rem |

**Line heights**: headings 1.25, body 1.6, captions 1.4.

## Spacing Scale

Use an 4px base unit: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`.

- Component internal padding: 16–24px
- Card padding: 24–32px
- Section gaps: 32–48px
- Page gutters: 16px mobile, 24px tablet, 32px desktop

## Component Patterns

### Cards
- Background: `var(--surface)`
- Border: `1px solid var(--border)`
- Radius: `var(--radius-lg)` (14px)
- Shadow: `var(--shadow-sm)` at rest, `var(--shadow-md)` on hover/focus-within
- Padding: 24px (32px for hero cards)

### Buttons
- **Primary**: `var(--primary)` bg, white text, 600 weight, `var(--radius-md)` radius
- **Secondary**: `var(--surface)` bg, `var(--text)` text, `var(--border)` border
- **Ghost**: transparent bg, `var(--text-secondary)` text, no border
- **Danger**: `var(--danger)` bg, white text
- Height: 40px default, 44px large, 36px small
- Focus: `var(--shadow-glow)` ring

### Form Inputs
- Border: `1px solid var(--border)`
- Radius: `var(--radius-md)`
- Padding: 10px 14px
- Focus: `border-color: var(--primary)` + `var(--shadow-glow)`
- Error: `border-color: var(--danger)`
- Label: `var(--text)` 500 weight, 13px size, 4px margin-bottom

### Auth Page Layout
- Centred single-column (max 420px) for sign-in/sign-up
- Optional left-panel brand illustration on wider viewports (split layout)
- Logo + wordmark at top
- Social proof or feature callouts as supporting content

## Principles

1. **Consistency over novelty** — reuse tokens; do not inline one-off colours.
2. **Semantic naming** — use `--danger` not `--red`; the palette can shift without renaming.
3. **Accessible contrast** — all text/background combos must meet WCAG 2.1 AA (4.5:1 body, 3:1 large text).
4. **Progressive enhancement** — the page must be fully usable without JS-driven animations.
5. **Mobile-first** — design at 360px, then expand; never the other way around.
