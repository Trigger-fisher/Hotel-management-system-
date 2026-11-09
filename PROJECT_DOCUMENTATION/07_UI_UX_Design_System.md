# 07. UI/UX Design System & Tokens

HMS adopts the **Pallav Design System**, an ink-and-graphite aesthetic designed for clarity, high contrast, and reduced visual fatigue during long front-desk shifts.

## 1. Color Palette & Design Tokens

Defined centrally in `common/ui-shared/tokens.ts`:

### Graphite Palette (Neutral Scales)
- `graphite-50`: `#F6F6F7` (App canvas background in light mode)
- `graphite-100`: `#EDEDF0` (Muted panel borders and dividing lines)
- `graphite-200`: `#E1E1E6` (Standard component borders)
- `graphite-300`: `#B4B4BC` (Inactive icons, secondary borders)
- `graphite-400`: `#8E8E98` (Disabled text and placeholder copy)
- `graphite-500`: `#6B7080` (Muted metadata labels)
- `graphite-600`: `#111114` (Near-black solid primary text)
- `graphite-700`: `#2B2B31` (Button fill, strong headings)
- `graphite-800`: `#3A3A42` (Dark surface cards, active state pills)
- `graphite-900`: `#111114` (Deep brand surface)

### Accent & Metallic Tokens
- `gold`: `#C9A227` (Used sparingly for premium badges, active stars, and VIP highlights)

### Semantic & Status Colors
- **Success** (Confirmed reservations, Paid bills, Clean rooms):
  - Text: `#15803D`, Background: `#DCFCE7`, Border: `#86EFAC`
- **Warning** (Pending payments, Advances, Dirty rooms):
  - Text: `#B45309`, Background: `#FEF3C7`, Border: `#FCD34D`
- **Danger** (Cancelled reservations, Overdue debits, System alerts):
  - Text: `#B91C1C`, Background: `#FEE2E2`, Border: `#FCA5A5`
- **Info** (In-house guests, Announcements):
  - Text: `#1D4ED8`, Background: `#DBEAFE`, Border: `#93C5FD`

---

## 2. Typography

- **Primary Font Family**: System stack with Inter fallbacks:
  `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Indic Script Support**: Noto Sans Gujarati & Noto Sans Devanagari bundled in server fonts for legal invoice rendering.
- **Type Scale**:
  - Page Title: `20px` / `1.3` (Bold `600`)
  - Section Header: `16px` / `1.4` (Semi-bold `600`)
  - Body Text: `14px` / `1.5` (Regular `400`)
  - Table Content: `13px` / `1.4` (Regular `400` / Medium `500`)
  - Badges / Microcopy: `11px` - `12px` (Medium `500` / `600`)

---

## 3. Spacing & Grid System

- **Base Unit**: `4px` grid system.
- Standard form field height: `42px` (desktop), `46px` (mobile touch target).
- Standard button height: `44px` (large primary), `36px` (compact table action).
- Container padding: `24px` on desktop, `16px` on tablet, `12px` on mobile.

---

## 4. Dual-Theme Architecture (Day & Night)

- **Day Mode**: Clean off-white surface (`#FAFAFB`), crisp graphite borders (`#E1E1E6`), dark charcoal text.
- **Night Mode (`pms-dark.css`)**:
  - Implements deep charcoal and graphite surfaces (`#1B1B20`, `#2B2B31`) instead of pure black to eliminate harsh contrast.
  - Dark mode activates either by system preference (`prefers-color-scheme: dark`) or user server preference (`uiTheme: 'dark'`).
- **Calm Motion Principle**: No bounce animations or gratuitous transitions. Only 1px button lift and 3px hover elevation on metric cards.
