# 10 - Dashboards = the Pallav app shell, improved (web + mobile)

**Task (S03, MJ via the Lead, 2026-10-05):** Pallav guest portal → **Guest** dashboard, company portal → **Corporate** dashboard, everything else → **Hotel** dashboard. Frontend only, mock data. MJ: "for the design it will handle by the review, design it is trained". Brief: `docs/sessions/reports/S03-dashboards.md` (kit API, structure, rules).
Same method as [09](09-PALLAV-DESIGN-SPEC.md): **[P]** = Pallav's look, kept. **[+]** = improvement with a reason. Values from Pallav's `pms.css`, `pms-sidebar.css`, `pms-header.css`, `pms-dash.css`, `pms-filterbar.css`, `pms-dark.css` (look only, never its code). Scoring: [00-PREMIUM-STANDARD.md](00-PREMIUM-STANDARD.md), every screen in day **and** night.

**Findings go to the Lead (hms-c0), who routes them to the builder agents.** I don't order the S03 agents directly (Lead's request).

## 1. The one big idea

Pallav's character = **violet floating sidebar + glass top bar + calm white cards on cream**. Keep that. Pallav's weakness = **too much effect** (gradients on every button, rainbow gradient icons, constant motion, 800 weight and uppercase everywhere, purple titles, centred tables). Premium HMS = Pallav's frame with **quiet, precise content**.

## 2. Web frame

| Part | Spec |
|---|---|
| Page | `bg #FBF9FF` (night `#0D0A14`) |
| **Sidebar** | **[P]** floating card, 10px gutter from the screen edges, radius 22, solid `#5B21B6`, shadow `0 22px 44px -22px rgba(42,15,94,.65)`, width 244, collapses to 68 (icons only, tooltip on hover/focus). [P] Auto-collapse below 1280px; [+] below 1024px it becomes a **drawer** (slides in from the left, 260 ms, scrim, focus trapped, Esc closes) |
| Sidebar top | Brand: the auth brand tile (§2 of 09) + "HMS" 16/800 white + hotel/company name 11/600 white 72% |
| Section labels | **[P]** uppercase + hairline after. [+] 11px / 700 / .12em, white **72%** (Pallav 9.5px at ~60% = 4.2:1, too small and fails AA) |
| Items | **[P]** 13.5px / 600, white 82%, radius 13, height 40 (hit area 44), icon in a 32px tile `rgba(255,255,255,.08)` radius 10, 18px icon. Hover: tile .14, text white. **Active: white icon tile with a p700 icon, white text, 3px white marker on the left** [+] marker glow reduced to `0 0 6px rgba(255,255,255,.5)` |
| Second panel (subNav: Payroll, Website) | **[P]** a second floating white card (radius 22, gutter 10) next to the sidebar, width 232, list of items 13.5/500 ink2, active = p50 bg + p700 text + 3px p700 marker |
| Sidebar foot | Profile card: avatar 32 (initials, white tile, p700 text) + name 13/600 + role 11 white 72%. [+] **No pinging online dot, no ripple** |
| **Top bar** | **[P]** sticky glass card in the same gutter: `rgba(255,255,255,.82)` + `backdrop-filter: blur(16px) saturate(170%)`, radius 22, height 64, padding 0 20; shadow deepens after the page scrolls (`shadow.sm` → `shadow.md`). Left: page icon tile 36 (p50 bg, p700 icon) + page title. Right: hotel/company name chip, user menu (avatar + name ▾ → My profile, Lock screen, Sign out) |
| Page title | [+] 20px / 700 / -0.02em, **ink** (Pallav 19/800 purple: purple titles everywhere drowned the accent). Subtitle 13 muted |
| [+] Removed from Pallav's top bar | live clock with seconds, blinking colon, weather, greeting pills, page-icon spin/sheen on every load, icon pop on hover. One quiet date chip ("Mon, 05 Oct 2026") is allowed on the Overview only |
| Content | max width 1280, padding 24 (≥ 1440: 32), vertical rhythm 20 between sections |

## 3. Mobile frame

| Part | Spec |
|---|---|
| Header | 56 + safe area, `surface` (night `#15111F`), 1px bottom hairline (`border` / night `#261F38`). Title 17/700 ink, centred on iOS / left on Android; back chevron (44 hit) when the stack has history. Right: one IconButton max (e.g. add) |
| **Bottom tab bar** | First 4 items of `nav[kind]` + **More**. Height 56 + safe area, `surface` + top hairline, [P]-style **active = icon inside a p50 pill (64×32, radius 16) in p700 + label 11/600 p700**; inactive icon/label `textMuted`. No gradients |
| More | A list screen grouped by `nav` sections: section label 11/700/.12em uppercase muted, rows 52 tall with the 32px icon tile (p50 bg, p700 icon), chevron right. Profile card on top, Lock screen + Sign out at the bottom |
| subNav | Opens as a list screen like More |
| Back | Android back pops the stack; at the root it asks "Leave HMS?" (ConfirmDialog) |
| Brand | The violet appears in: active tab pill, primary buttons, the profile card on More (violet card like the sidebar). Not a violet header (keeps content calm) |

## 4. Kit components (look)

| Component | Spec |
|---|---|
| **Card** | **[P]** white, radius 18, 1px `border #E9E2FA`, `shadow.sm`. Header: title 15/600 ink + subtitle 13 muted + actions right, padding 16/20, hairline under it. [+] **No gradient header** (Pallav p50→white) |
| **KpiTile** | **[P]** padding 16/18, radius 18, card style. Icon tile 40 radius 12, label **[P]** 11.5/700/.06em uppercase muted, value [+] **26/700/-0.02em tabular** (Pallav 25/800), optional trend chip (pill 11.5/600, success/danger tint). [+] Icon tiles are **solid soft tints**, not gradients: in `success` tint, out `danger` tint, due `warning` tint, month `violet` (p50/p700), as Pallav's own night mode does. [+] No corner glow; hover lift 1px max (web) |
| KpiGrid | `Grid min 220`, gap 16 |
| **StatusPill** | **[P]** radius 999, 11.5/700, padding 3/9, tinted bg + fg per tone (success / warning / danger / info / violet p50-p700 / neutral surfaceMuted-textSecondary), optional 6px dot. [+] **No pulsing dot** |
| **FilterBar** | **[P]** underline tabs with count chips (count = pill 11/700, p50/p700 when active, surfaceMuted/textMuted otherwise), active underline 2px p700 sliding 220 ms easeOut ([+] no spring overshoot). Search input 40 tall with search icon, "Showing N of M" 13 muted, Reset as ghost link. Phone: tabs scroll sideways, search full width under them |
| **DataTable (web)** | **[P]** header 11.5/700/.06em uppercase, `p800` on `p50` (8.3:1), height 40, sticky. Rows 52, 13.5/20 ink, hairline between rows. [+] **Text left, numbers/money/dates right** (Pallav centred every cell with !important), tabular numbers. [P] Row hover `p50` [+] **without** the gradient bar. Pressable rows get a chevron in the last column and pointer cursor. Pagination: "1-20 of 143" + prev/next IconButtons, right-aligned |
| **DataTable (mobile)** | Cards: radius 14, padding 14, `surface` + border, gap 10. Top line: `primary` column 15/600 ink + StatusPill right. Then label/value rows (label 12 muted left, value 13.5 ink right, money tabular). Chevron if pressable. Pagination = "Load more" secondary button |
| **KeyValue** | label 12/600 muted uppercase-off (sentence case), value 14 ink; 2 columns ≥ 640 |
| **MoneyText** | `formatINR`, tabular, right-aligned, negative/out in danger only when the meaning is "owed/overdue" (not for every expense) |
| **Button** | primary = **the auth gradient button** (09 §5) without the arrow by default; secondary = outline (white, `borderStrong`, p700 text); ghost = text p700, hover p50; danger = solid `#B91C1C`, hover `#991B1B`. md 44 tall, sm 36 visual / 44 hit. Radius 12. Icon 18 + 8 gap. Busy = spinner + label, same width |
| **IconButton** | 40 visual / 44 hit, radius 12, muted icon, hover p50 + p700 icon; danger tone hover `#FEF2F2` + `#B91C1C` |
| **Modal (web)** | **[P]** radius 24, `shadow.lg`, scrim `rgba(27,18,53,.45)`. Header: title 18/700 + close IconButton, hairline. Body padding 24. Footer: hairline, buttons right (Cancel secondary, then primary). Sizes sm 420 / md 560 / lg 760. Motion [+] fade + scale .98→1, 220 ms easeOut (Pallav .94 with spring overshoot). Focus trapped, Esc closes, focus returns to the opener |
| **Modal (mobile)** | Full-screen sheet from the bottom, header with Cancel (left) / title / Save (right) |
| **ConfirmDialog** | sm modal; icon circle 40 (danger tint or p50) + title 17/700 + body 14 ink2; danger confirm button red |
| **Field / inputs** | Same as auth inputs (09 §5): label 13/600 ink2 above, 44 tall (dashboard density) [auth stays 48], radius 11, 16px text on mobile / 14px allowed on web ≥ 1024 with pointer:fine, inputBorder `#8F86A8`, focus p500 + ring .22, error border + message 13 danger. Required = "(required)" text after the label, not only `*` |
| MoneyInput | "₹" prefix inside the input (muted), tabular, right-aligned digits |
| DateInput | web native date input styled like TextInput; mobile masked DD-MM-YYYY with a calendar icon |
| Select | TextInput look + chevron-down; web native `<select>` styled (no default look) |
| Checkbox / Toggle | Checkbox as auth. Toggle 44×26 track, on = p700, thumb white with `shadow.sm` |
| **Tabs** | Same as FilterBar tabs |
| **EmptyState** | **[P]** 56 icon tile radius 16, [+] **p50 bg + p700 icon** (not a gradient), title 15/600, body 13.5 muted (max 360 wide), one action button. Friendly copy ("All clear. No bookings for today.") |
| **Skeleton** | **[P]** shimmer `p50 → p100 → p50`, 1.4 s; [+] static under reduced motion. Shapes match the real layout (list rows / cards / detail), no layout jump when data arrives |
| Error | Card with danger icon circle, `dashErrorText`, Retry (secondary). Never raw errors |
| Offline | Info banner at the top of the content area (same as auth OfflineBanner) |
| **Toast** | **[P]** glass: `rgba(255,255,255,.86)` + blur 20 saturate 180%, radius 14, `shadow.lg`, tone icon in a 28 tint circle, text 13.5 ink, 4 s with a 2px progress line; web: top-right, slides in 220 ms; mobile: top under the header. [+] No spring overshoot; announced politely |
| **BarChart** | [+] one colour: bars `p600` (5.7:1 vs white; night `#A78BFA`), radius 6 top corners, gridlines `border`, labels 12 muted, values tabular on hover/focus (and always on phone). No rainbow, no chart library |
| **Icon** | One line icon set, 1.75 stroke, 16/18/20 sizes, `currentColor`. Mobile: expo-symbols with matching meaning |

## 5. Type and numbers (dashboards)

| Use | Size / weight |
|---|---|
| Page title | 20/28, 700, -0.02em, ink |
| Card / section title | 15/22, 600 |
| Body / table | 13.5–14 / 20, 400 |
| Labels | 13/18, 600 ink2 |
| Table head, KPI label, section label | 11–11.5, 700, .06–.12em, uppercase (the only uppercase) |
| KPI value | 26/32, 700, tabular |
| Weights | 400 / 500 / 600 / 700 only [+] (Pallav used 800 almost everywhere). 800 only on the brand name |
| Money | `formatINR` → `₹1,23,456.00` (Indian grouping), tabular, right-aligned. Never "Rs", never Western grouping |
| Dates / times | `formatDate` → `05 Oct 2026`; `formatTime` → `3:45 pm` IST. Never raw ISO, never 24-hour mix |

## 6. Motion (dashboards)

Only: page change fade + 6px rise 180 ms; drawer 260 ms; modal 220 ms; tab underline 220 ms; toast 220 ms; skeleton shimmer; button press .97 / hover lift 1px. **[+] Removed:** breathing logo, pinging dots, blur-in menu stagger, page-icon spin and sheen, ripple, rotating icons, corner-glow growth. Reduced motion: fades only, static skeleton.

## 7. Night mode (follows the device, no toggle)

Uses `color` + `auth.night` tokens. Mapping:

| Part | Night |
|---|---|
| Page | `#0D0A14` |
| Cards, modal, header, tab bar, second panel | `#15111F`, border `#261F38` (cards `#33294B` where they need an edge), shadows black-based |
| Inputs, table head, skeleton base, inset areas | `#1B1628`; table head text `#C6BEE2` (9.9:1) uppercase |
| Sidebar | `#2E1065` (night middle stop), border `#33294B`; item text white 82% (10.5:1), section labels white 72% (8.3:1); active tile white + p700 icon |
| Top bar glass | `rgba(21,17,31,.82)` + blur |
| Text | `#EFEAFB` / `#C6BEE2` / `#9A92B8` |
| Pills, KPI tints, notes | tint .16–.18 bg + light fg (as `auth.night.note` / Pallav dark KPI tints: in `#6EE7B7`, due `#FCD34D`, out `#FDA4AF`, month `#C4B5FD`) |
| Row hover | `rgba(139,92,246,.08)` |
| Bars | `#A78BFA` (6.8:1) |
| Toast | `rgba(21,17,31,.86)` glass |

## 8. Dashboard instant send-back list (adds to 00 §3)

1. Numbers, money or dates centred or left-aligned in tables; Western grouping; "Rs"; raw ISO dates; 24-hour times.
2. Tables on phones without the card view, or any horizontal **page** scroll (a table may scroll inside its card on web only).
3. Gradient or rainbow icon tiles; gradients on anything except the primary button, the auth page and the brand tile.
4. Purple page titles, 800 weight or uppercase outside the allowed places.
5. Constant motion (clock seconds, weather, pulsing/breathing anything).
6. A list without skeleton, empty, error + Retry, and offline states.
7. Modals without focus trap / Esc / return focus (web), or mobile forms not full-screen sheets.
8. Destructive action without a ConfirmDialog.
9. Sidebar that doesn't collapse / become a drawer, or a mobile tab bar that hides behind the home indicator.
10. Different look between Guest, Corporate and Hotel dashboards beyond their menus (one kit, one look).

## 9. What I need from the Lead per build

Web screenshots (1440 + 390) and mobile screenshots of: the frame for each role (sidebar expanded + collapsed + drawer; mobile tabs + More), one list screen per module (loaded, empty, loading, error), one detail, one create/edit modal + sheet, one confirm dialog, a toast, the Overview with KPIs and the bar chart, in **day and night**. Plus gate output (tsc + eslint per app). I'll also open the preview at `http://localhost:3001/dev/dashboard?role=guest|corporate|hotel`.
