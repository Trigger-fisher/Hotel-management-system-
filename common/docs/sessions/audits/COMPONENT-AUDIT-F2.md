# Shared Component audit, Frontend 2 folders (11 Oct 2026)

For the "Shared Component" library (draft page `/dev/shared-component`, owned by Frontend 1). Scope: `groups/payrollCore`, `payrollPay`, `companies`, `overview` (reports), `website`, `guest`, `corporate`, `portal`, `platform`, `group`, the public onboarding pages. Method: grep counts of the class strings and helper definitions (web-app/src, 11 Oct). "Kit has it" = already exported from the kit index `web-app/src/dashboards/pallav/ui/index.ts` (the only place I import shared pieces from).

## A. Markup repeated by hand, no shared component (wanted in the kit)

| # | Component (proposed name, props) | What is repeated | Uses | Spread |
|---|---|---|---|---|
| 1 | `Button` (`variant` primary / outline / ghost / danger, `icon`, `busy` + `busyLabel`, `size`) | `<button className="btn btn-p"><Bi name=.. /> {busy ? 'Saving…' : 'Save'}</button>`; classes `btn btn-p` 120, `btn-outline-p` 69, `btn-ghost` 47, `btn-outline-danger` 10 | 246 | 7 folders |
| 2 | `PortalButton` (same API; Guest/Corporate `pt-btn pt-btn-solid / pt-btn-line`) | `pt-btn` strings | 40 | guest, corporate, portal |
| 3 | `IconButton` (`icon`, `label` (title + aria-label), `tone` danger, `disabled`) | row action `btn-icon` with title + aria-label written by hand | 36 | 3 folders |
| 4 | `Notice` (`tone` info / warning / danger / success, `icon`, `role`, children, optional action) | `alert alert-X d-flex align-items-start gap-2` + `<Bi>` + text + (retry button); also the "offline" and "stale data" notes | 33 (+ 18 hand-made `info-circle` hint lines) | 5 folders |
| 5 | `StatusPill` / `Badge` (`tone` live / locked / unlocked / warn / danger / muted) | `pill pill-live` etc. 21, portal `pt-badge` 6, and five separate maps `PILL` / `DOTS` (group/GroupInvitations, overview/SetupChecklist, platform/Health, hotelParts, SignIns, Groups, Hotels) | 27 + 8 maps | 5 folders |
| 6 | `FieldError`, `FieldHint`, `RequiredMark` | `<div className="field-error">` 17, `<div className="form-text">` 48, `<span className="req">*</span>` 47 | 112 | 6 folders |
| 7 | `FormRow` / use `Field` everywhere | hand-made `label.form-label` + control + error (117 labels; website forms use my `Linked` wrapper over `useLabelLink`) | 117 | 6 folders. Proposal: promote `Linked` into the kit and make `Field` accept a `col`-less block mode |
| 8 | `TabBar` (tabs with counts and dot, active, onChange; `useTabStrip`) | per-screen `TABS` + `startTab()` + `DOTS` copies in 8 list screens (platform Hotels, Groups, Admins, Invitations, SignIns, PlatformStaff; group Hotels, Admins, Invitations); portal `pt-tabs` / `pt-period`; website `WaNav` (`wa-tab`); `SegTabs` | 18 `TABS`, 8 `startTab` | platform, group, guest, corporate, website |
| 9 | `EmptyState` variants in one component (`icon`, `title`, `text`, `action`, `compact`, `tone`) | kit `EmptyState` 80 uses, plus `PtEmpty` (portal, 19), payroll `EmptyRow`, `PmsEmpty` alias | 100 | 5 folders |
| 10 | `AsyncView` (`state`, `rows`, `onRetry`, `stale`) | loading + error + stale-data handling written six ways: `Loaded`/`LoadError` (kit), payroll `useLoaded` + `Wait` + `StaleNote`, portal `PtLoad`, platform `Stale`, website `LoadError`+`PageSkeleton` | ~120 screens | all |
| 11 | `PageBody` (the screen wrapper function `Body`) | a local `function Body(...)` defined in 28 files (payroll 17, admin 4, others) to lay out head + content | 28 | payroll, platform, website, companies |
| 12 | `DataTable` (`columns`, `rows`, `pager`, card-on-phone mode `hms-card-table`) | `div.table-responsive` + `table.table-hover` + `thead` + `Pager server`; `hms-card-table` phone cards | 40 tables | 6 folders |
| 13 | `CellStack` (`main`, `sub`, optional `pill`) | `<span className="cell-main">` + `<span className="cell-sub">` | 98 | 5 folders |
| 14 | `ModalActions` (`onCancel`, `confirmLabel`, `busy`, `danger`) | modal footer Cancel + Save (+ "Saving…") | ~50 modals | all |
| 15 | `Avatar` (initials from name, tone) | `.avatar` with `initials(name)` (payroll `initials`, platform) | 4 + 3 helpers | payroll, platform |
| 16 | `SearchBox` (one component, portal and dashboard looks) | kit `SearchField`, portal `PtSearchBox`, hand-made search inputs | 4 + 3 | 3 folders |
| 17 | `Pager` (one component, `portal` look) | kit `Pager` and portal `PtPager` | 33 + 6 | 7 folders |
| 18 | `Skeleton` (one, `portal` look) | kit `PageSkeleton` and portal `PtSkeleton` | 2 | portal |
| 19 | `MonthNav` / `MonthPicker` | payroll `MonthNav` (payrollCore/pms.tsx), Daily Report day box, Food Plan month select, Attendance month buttons | 5 | payroll, overview |
| 20 | `PageHeader` and `PageFooter` for public pages | auth/onboarding card: HMS brand block on top, "© 2026 HMS" line below (login, onboarding, expired/invalid pages); portals' top bar | 6 public screens | onboarding, auth |
| 21 | `Kpi` for the portals (`pt-card` KPI tiles) | kit `Kpi` is dashboard-only; the portals draw their own tiles | 34 `Kpi` + ~20 `pt-` tiles | 3 folders |
| 22 | `PortalCard` / `PtSection` / `PtLine` | portal-only building blocks (`groups/portal/parts.tsx`) | 44 `pt-card`, 23 `PtSection` | guest, corporate |

## B. Helper functions defined many times (should be ONE function in ui-shared or the kit)

| Helper | Defined in (files) | Note |
|---|---|---|
| `MONTHS` (month names) | 13 | one export from `ui-shared/dashboards/format.ts` |
| `TODAY` (the mock "today") | 12 | payroll screens each read it; one `todayIst()` |
| `rupees` (paise to a rupee text) | 10 | `formatINR` exists; these are input-text variants |
| `plural` | 7 | one `plural(n, 'word')` |
| `money` | 5 | alias of `formatINR` |
| `monthName` / `monthLong` / `monthTitle` / `thisMonth` | 10 | one month formatter set |
| `dayLabel` / `dayTitle` | 7 | one day formatter |
| `ago` | 3 | relative time |
| `count` | 3 | thousands grouping |
| `startTab` | 8 | disappears with `TabBar` |
| `oneOf` (adapters) | 6 | one in `adapters/shared` |
| `enc` (encodeURIComponent) | 4 | one in `client.ts` |
| `toInput` | 3 | form input mapper |
| `trailOf` | 3 | breadcrumb trail |
| `StatusPill`, `PILL`, `DOTS` | 3 + 5 + 3 | see A5 |

## C. Already shared and used well (no action)
`Modal`, `Dialog`, `Dropdown`, `SegTabs`, `Field`, `FormSection`, `PickGroup`, `WizardSteps`, `RupeeInput`, `AmountTile`, `PmsDate`, `PmsSelect`, `FilterBar`, `FilterMenu`, `KpiGrid`, `PageHead`, `useTableView`/`Th`, `useToast`, `useLabelLink`.

## D. Order I suggest to Frontend 1 (biggest payoff first)
Button + IconButton (246+36 uses), Notice (33), StatusPill (27), FieldError/FieldHint/RequiredMark (112), TabBar (18), AsyncView (all screens), CellStack (98), DataTable (40), ModalActions (~50), the helpers in section B. Each is a drop-in: same classes and look, so my replacement is mechanical.

## E. Colours and typography (Frontend 2 folders), scan of 11 Oct 2026

Scope: TSX of payroll, companies, reports, website, guest, corporate, onboarding, platform, group, and the CSS files of those areas (`portal.css`, `pms-payroll.css`, `payroll-look.css`, `crm.css`, `company.css`, `company-ledger.css`, `website-admin.css`, `staff-emails.css`, `catalog.css`, `auth.css`, `hms-overrides.css`).

### E1. TSX: colours
Already clean: colour in TSX uses `var(--p50|p700|p800|line2|pt-bg|pt-muted|pt-p800)` almost everywhere. The only literals:
| File:line | Literal | Use | Token to use |
|---|---|---|---|
| payrollCore/Statuses.tsx:195 | `'#8B5CF6'` | default colour of a new attendance mark (user data) | `--p500` (read with `getComputedStyle`) or keep as data default |
| payrollPay/Reports.tsx:176 | `color: '#fff'` | text on a user-coloured status chip | `--white` (new, mode-independent) |
| website/parts.tsx:152 | `hsl(${h} 55% 78%) ...` | generated placeholder picture from a hue (data driven) | keep; documented as a generated gradient |
| user colours `s.color` (Attendance.tsx:226, Statuses.tsx:82/126, Reports.tsx:125/176) | data from Master Data | data, not a token |

### E2. TSX: literal typography and spacing (inline `style`)
115 inline style props. Font sizes by value: 11.5px x14, 12.5px x13, 12px x8, 10.5px x6, 13px x10, 19px x6 (`.kpi-value`), 16px x3, 24px x1. Weights: `fontWeight: 600/800` x6. Spacing literals (`margin: '0 0 10px'`, `padding: '3px 5px'`, `width/height 20/26/34`) x15.
Proposed type tokens (new, names for Frontend 1 to confirm): `--fs-2xs` 10.5px, `--fs-xs` 11.5px, `--fs-sm` 12.5px, `--fs-md` 13px, `--fs-lg` 16px, `--fs-kpi` 19px, `--fs-stat` 24px, with classes `.fs-2xs ... .fs-stat`; spacing from Bootstrap's scale (`mb-2`, `p-1`) instead of inline margins. Files: payrollCore/Attendance.tsx (9), payrollCore/Companies.tsx (4), payrollPay/Reports.tsx (9), SalaryUpdate.tsx (8), MealPrice.tsx (6), Meals.tsx (3), Master.tsx (3), corporate/ProfileScreen.tsx (12), guest/Profile.tsx (2), Rooms/Ledger pages (5: `color: var(--pt-muted); fontSize: 13` on a note paragraph, repeated 7 times: becomes `.pt-note`).

### E3. CSS: colours with NO token (182 of 348 uses; 98 distinct hex)
The sheets define tokens only for the violet scale (`--p50..p900`), neutrals (`--ink`, `--ink2`, `--muted`, `--line`, `--line2`, `--surface`, `--surface-2`) and two portal colours (`--pt-ok #12A150`, `--pt-warn #D97706`). There is NO token for the status colours, so every sheet re-types them, five greens, five reds and five ambers:
| Proposed token (light / night) | Literals found today (uses) |
|---|---|
| `--ok` text (#15803D / #6EE7B7) | #15803D (5), #047857 (4), #0B7A3B (4), #16A34A (1), #12A150 (5), #166534 (1); night: #6EE7B7 (7), #34D399 (4), #86EFAC (2), #4ADE80 (1), #A7F3D0 (2) |
| `--ok-bg` (#DDF6E8 / rgba) | #DDF6E8 (4), #DCFCE7 (2), #D1FAE5 (1), #F0FDF4 (1), #BBF7D0 (1) |
| `--bad` text (#BE123C / #FCA5A5) | #DC2626 (13), #B91C1C (9), #991B1B (2), #9B1C1C (2), #E11D48 (3), #C2410C (3); night: #FCA5A5 (10), #F87171 (3), #FDA4AF (1), #FB7185 (1) |
| `--bad-bg` (#FEE2E2) | #FEE2E2 (6), #FEF2F2 (3), #FDE8E8 (2), #FBD5D5 (2), #FECACA (4), #FFF1F2 (1) |
| `--warn` text (#B45309 / #FBBF24) | #B45309 (5), #D97706 (5), #9A5B00 (2), #9A3412 (2); night: #FCD34D (7), #FBBF24 (3), #E3C867 (1) |
| `--warn-bg` (#FEF3C7) | #FEF3C7 (3), #FFEDD5 (2), #FFF7E6 (1) |
| `--link` (day #6D28D9 / night #6EA8FE) | #6EA8FE (1), #9EC5FE (1) in hms-overrides.css |
| `--accent-solid` (#6D28D9 in BOTH modes, white text on it passes 7:1) | #6D28D9 (12): my night fixes in hms-overrides.css; today they must not use `--p700` because that turns light at night |
| `--brand-deep-1..4` (gradient stops of hero cards) | #2A0F5E (7), #4C1D95 (2), #3B1373 (1), #2E1065 (1), #1A0B3B (2), #1E1236 (1) |
| `--brand-soft-1..4` (light violets on dark gradients) | #C9B2FF (2), #CDBBFF (2), #D6C5FF (1), #EDE5FF (2), #DDD6FE (3) |
| `--white` (#fff, same in both modes, for text on colour) | #FFF (106 uses, mostly `color: #fff` on gradient buttons; today `--white` exists in `hms-overrides.css` only) |
Matches an existing token (166 uses): #FBF9FF = `--surface-2` (11), #8B5CF6 = `--p500` (6), #5B21B6 = `--p800` (6), #1B1235 = `--ink` (2), #4A1A8F = `--p900`, #DFD3FD = `--p200`, #C6B0FB = `--p300`, #4A4262 = `--ink2`. They are mostly in `hms-overrides.css` day/night fix rules where the literal is deliberate (the token flips at night); those move to `--accent-solid` once it exists.

### E4. CSS: typography
- Families: only `Inter` and `Playfair Display` (brand name), both set in `portal.css:9/181/182` and `hms-overrides.css:5-7`; icons use `bootstrap-icons`. Proposed `--font-body`, `--font-brand`.
- Sizes in px across these sheets: 9, 9.5, 10, 10.5 (26x), 11 (29x), 11.5 (25x), 12 (42x), 12.5 (45x), 13 (41x), 13.5 (30x), 14 (32x), 14.5, 15 (19x), 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 34, 38, 44: 29 distinct sizes, with half-pixel steps. They are Pallav's own sizes (the pixel gate depends on them). Proposal: a 9-step scale `--fs-2xs 10.5, --fs-xs 11.5, --fs-sm 12.5, --fs-md 13.5, --fs-base 14, --fs-lg 16, --fs-xl 19, --fs-2xl 24, --fs-3xl 30`; the in-between values (9, 9.5, 10, 11, 12, 13, 14.5, 15, 17, 18...) round to the nearest step ONLY if MJ accepts a 1-2% pixel difference from Pallav; otherwise the scale is documented but the sheets stay as they are.
- Weights: 100 (1), 500 (4), 600 (30), 650 (18), 700 (68), 750 (9), 800 (91). Proposed `--fw-regular 500`, `--fw-semibold 600`, `--fw-bold 700`, `--fw-black 800`; 650 and 750 are variable-font steps used by Pallav and fold into 600 / 800.

### E5. What I will do after Frontend 1 adds the tokens
1. TSX: replace the inline `fontSize` styles with `.fs-*` classes, the repeated note paragraph with `.pt-note`, `color: '#fff'` with `var(--white)`; remove inline margins/paddings in favour of Bootstrap utilities. Look unchanged.
2. CSS in my files: replace the status literals with `--ok/--bad/--warn` (+ `-bg`), `#6D28D9` with `--accent-solid`, link blues with `--link`; check day and night contrast (4.5:1) with the contrast sweep after each file.
3. Pallav's vendored sheets keep their literal sizes unless MJ accepts the pixel difference (decision for MJ).

## F. New Shared Component files by Frontend 2 (11 Oct 2026) and tokens needed

New files in `web-app/src/dashboards/pallav/ui/` (no index change needed to exist; Frontend 1 adds the exports): `Alert.tsx`, `StatusChip.tsx`, `FieldMessage.tsx` (FieldError, FieldHint, RequiredMark), `ModalFooter.tsx`, `CellStack.tsx`, `EmptyState.tsx`, `Skeleton.tsx`. They use only existing classes (`alert`, `pill`, `pt-badge`, `field-error`, `form-text`, `req`, `cell-main`, `cell-sub`, `empty-state`, `pt-empty`, `skel`, `kpi-grid`), so they look the same as the hand-written markup.

Tokens needed (no variable exists today):
| Component | Missing | Proposed token |
|---|---|---|
| StatusChip | a red chip (no `.pill-danger`, `.pt-badge.bad`) | `--bad` / `--bad-bg` (section E3) |
| StatusChip | portal chip colours are literals in portal.css (#DDF6E8 / #0B7A3B, #FFF1D6 / #9A5B00) | `--ok-bg` / `--ok`, `--warn-bg` / `--warn` |
| Alert | Bootstrap's own alert colours are used; Pallav has no tokens for them | `--ok`, `--bad`, `--warn`, `--info` pairs |
| ModalFooter | the danger button uses Bootstrap's `btn-danger` (#DC3545); the dashboards use `btn-outline-danger` | a `Button variant="danger"` from Frontend 1 |
| Skeleton | inline heights and widths (px) on `.skel` blocks | `--skel-h-sm/md/lg` or classes `.skel-line`, `.skel-title` |
