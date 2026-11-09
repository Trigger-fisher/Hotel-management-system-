# Hotel Pallav app: UI review (2026-10-04)

Source: https://github.com/Mihir-Jungiwala/hotel-pallav-account (commit ae0dd7c, Laravel + Bootstrap 5.3).
Purpose: reference for the HMS look and feel (MASTER.md section 8). Copy the look only, never the code.

## 1. Tech
Bootstrap 5.3.3 (CDN) plus ~30 hand-written CSS files, Bootstrap Icons 1.11, Inter font (Playfair Display on the public site), Flatpickr dates, Tom Select dropdowns, Chart.js on the dashboard, dompdf for PDFs. No build step.

## 2. Design tokens
| Token | Value |
|---|---|
| Violet scale | p50 `#F7F4FF` · p100 `#EFE9FE` · p200 `#DFD3FD` · p300 `#C6B0FB` · p400 `#A886F7` · p500 `#8B5CF6` · p600 `#7C3AED` · p700 `#6D28D9` · p800 `#5B21B6` · p900 `#4A1A8F` |
| Background / surface | cream `#FBF9FF` / white |
| Text | ink `#1B1235`, ink2 `#4A4262`, muted `#7A7392` (fails AA at small sizes) |
| Borders | `#E9E2FA`, `#D9CEF6` |
| Accent | gold `#C9A227` (rare) |
| Success / Warning / Danger / Info | `#15803D` on `#DCFCE7` · `#B45309` on `#FEF3C7` · `#B91C1C` on `#FEE2E2` · `#1D4ED8` on `#DBEAFE` |
| Room states | vacant `#10B981`, occupied `#6D28D9`, dirty `#F59E0B`, out of order `#DC2626` |
| Type | body 14px; labels 13px/600; table head 11.5px/700 uppercase; KPI 25px/800; tabular numbers for money |
| Radius | 10 / 14 / 18 / 24, pills 999 |
| Shadows | 5 levels tinted `rgba(42,15,94,…)`; focus ring `0 0 0 3px rgba(139,92,246,.22)` |
| Motion | `cubic-bezier(.16,1,.3,1)`, spring `(.34,1.56,.64,1)`, 120/220/380 ms, reduced-motion respected |
| Dark mode | Yes, but two conflicting dark palettes |

## 3. Layout
- Violet sidebar (244px, collapses to 68px) with grouped menu: Overview, Guest Billing, Daily Cash, Companies, Staff, Reports, Front Office, Website, Administration.
- Second panel for module menus (Payroll). Sticky frosted top bar: page title, greeting/clock/weather pills, year menu, theme toggle, user menu.
- No phone layout: no drawer, small touch targets (30 to 32px).

## 4. Components worth copying
KPI tiles (icon, label, big number, trend chip) · filter bar (tabs with counts, "Showing N", Reset) · status pills with tinted backgrounds · modals with confirm dialog · toasts · empty states with friendly copy ("All clear") · skeleton loading and busy buttons · room board tiles with a coloured stripe · branded error pages.

## 5. Login (current)
Violet full-screen background, one white card. "Welcome back / Sign in with your username and password." Username + password only, 2FA by emailed 6-digit code, forgot password in 2 steps, forced password change on first sign-in, 5 wrong tries locks the account, 1 session per user.

## 6. Problems to fix in HMS
1. Contrast: muted text and sidebar labels fail WCAG AA.
2. Money shown with Western grouping in most pages (should be `₹1,23,456.00`); chart says "Rs".
3. Time format mixed (12h and 24h).
4. All table cells centred, numbers not right-aligned.
5. 510 inline styles, 590 `!important`, 37 CSS files, duplicated tokens.
6. No mobile layout.
7. Too much decoration: gradients on every button, live clock, weather, moving blobs.
8. Hidden scrollbars.
9. No spacing scale, ~15 breakpoints.
10. Error pages have no dark mode.

## 7. Keep vs improve (for HMS)
| Keep | Improve |
|---|---|
| Violet scale + cream/ink neutrals, gold accent | One shared token file for web, mobile, email, PDF (`ui-shared/`) |
| Tinted status pills | Light and dark tokens that pass AA |
| Radius, shadows, focus ring | One `formatINR` (en-IN) and one date/time helper |
| KPI tile, filter bar, empty states, toasts | Tables: numbers right, sticky head, card view on phone |
| Calm login card + email code flow | Phone-first layout: bottom tabs (mobile), drawer (web) |
| Motion tokens | Solid primary buttons, less decoration |
| `04 Oct 2026` dates, Lakh/Crore amount in words | 4px spacing scale, 3 to 4 breakpoints, 44px touch targets |

## 8. Screens in the app (summary)
| Module | Screens |
|---|---|
| Auth | 4 (login, email code, forgot, change password) |
| Dashboard | 1 |
| Revenue, Expenses, Shift Handover | 3 (+ receipt PDFs) |
| Bill Master (advances, bills) | 2 |
| Companies, Ledger, Customers, CRM | 7 |
| Reports | 1 (only 2 of 9 report types switched on) |
| Books (accounting years) | 1 |
| Payroll | ~22 |
| Front Office (room board, rooms, reservations, in-house, check-in, folio) | 8 |
| Website admin | 10 |
| Users, Roles, Profile | 4 |
| Masters, Settings, System (health, logs, recycle bin, Razorpay) | ~10 |
| Guest / Company portal | 13 (not finished: no real portal login, sample data) |
| Public website | 4 + 404 |

Roles in Pallav: Viewer < Editor < Admin < SuperAdmin (editable, per-user extra permissions). Permission format `module.action` (view/create/edit/delete/export).
Mobile: read-only API (login, dashboard, revenue, expenses, handovers, rooms, staff); no mobile app code.
Unfinished: portal sign-in, WhatsApp sending, Razorpay payment creation, 7 hidden report types.
