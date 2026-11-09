# S03 - Role dashboards from Hotel Pallav (FRONTEND ONLY) - brief from the Lead

MJ (2026-10-05): move the current Hotel Pallav system into HMS.
- Pallav **guest portal** -> the **Guest** dashboard (`guest_user`).
- Pallav **company portal** -> the **Corporate** dashboard (`corporate_user`).
- **Everything else** in Pallav -> the **Hotel** dashboard (`hotel_admin`, `hotel_user`) for now. MJ will move some features to other roles later.
- Frontend only: screens + typed mock data. No API, no database.
- All three at once, **web and mobile side by side**, built by Lead-run agents in parallel.
- Look: Pallav, more premium. **Design is owned by the review session hms-7e** (`docs/design/ui-review/`), which reviews and orders polish. Builders follow `docs/design/ui-review/09-PALLAV-DESIGN-SPEC.md` and `00-PREMIUM-STANDARD.md` as the baseline.

**DESIGN SPEC (mandatory, from hms-7e): `docs/design/ui-review/10-DASHBOARD-DESIGN-SPEC.md`.** Read it before styling. Key rules: money/numbers/dates right-aligned via formatINR/formatDate; no gradients except the primary button and brand tile; every list has skeleton, empty, error + Retry, offline; destructive actions use ConfirmDialog; one look across Guest, Corporate and Hotel; font weights 400-700 only; page titles in ink (not purple); KPI icon tiles solid soft tints (no gradients); single-colour BarChart; no clock/weather/spinning icons; mobile active tab = p50 pill. Check its section 8 "instant send-back" list before finishing.

Pallav source (read-only copy, never edit, never copy its PHP/Blade code, only its screens, fields and behaviour):
`C:\Users\infoj\AppData\Local\Temp\claude\c--Users-infoj-Desktop-HMS\3f2494f1-979c-4f1e-81df-95398e5b6159\scratchpad\pallav`
(routes/web.php, app/Http/Controllers/**, resources/views/**, public/assets/*.css). Summary: `docs/design/PALLAV_UI_REVIEW_2026-10-04.md`.

## FRONTEND ARCHITECTURE RULES (MJ, 2026-10-05 night; apply to ALL web work, mobile follows the same idea)
MJ: "in the frontend use the top level of Next.js features and optimize that, and make the components for each thing like date, buttons, header, all of them saved in one place, not visible to the user, so every component is reused. The review session must research Next.js and make the UI most efficient and optimized when the task starts."
1. **Top-level Next.js (16 / React 19) features, used properly:** App Router, Server Components by default (add `'use client'` only where state or events are needed, push it to the leaves), `next/font` (Inter), `next/image`, `next/dynamic` / `React.lazy` code splitting for heavy screens (reports, calendars, charts), route-level `loading.tsx` / `error.tsx` / `not-found.tsx`, streaming with Suspense, metadata API, caching and revalidation rules, React Compiler if it is already in the Next config, server actions only when the real backend arrives. Keep the SPA feel (one shell, client navigation) while using these.
2. **One component library, one place:** `web-app/src/components/ui/**` (and `Mobile App/src/ui/**`) holds EVERY reusable piece: Button, IconButton, TextField, PasswordField, DateInput, MoneyInput, Select, Checkbox, Toggle, Modal, ConfirmDialog, Toast, Card, PageHeader, TopBar/Header, Sidebar, Tabs, DataTable, FilterBar, StatusPill, KpiTile, EmptyState, Skeleton, Spinner, Icon, formatters. Internal only (not routes, never shown on their own). **No screen may define its own button, date picker, header, table or modal**; it imports from the library. Move the existing kit pieces (`src/dashboards/kit/**`, `src/components/auth/*`) into this one library, keep one implementation per component, delete duplicates, and update imports. Add a barrel `index.ts`. Document the list in `docs/COMPONENTS.md`.
2b. **MJ (later, same night): "I want a component for everything, like an error message too, which we use multiple times."** The rule is: **anything used (or likely to be used) more than once is a component in the library**, including feedback pieces: `ErrorMessage` / `Alert` (inline error, warning, success, info), `FieldError` (under inputs), `ErrorState` (full-area error with Retry and the friendly text from `errorText`), `EmptyState`, `LoadingState` / `Skeleton`, `Notice` (note box), `Toast`, `ConfirmDialog`, `OfflineBanner`, `SectionTitle`, `Badge` / `StatusPill`, `Avatar`, `KeyValue`, `MoneyText`, `DateText`, `Tabs`, `FilterBar`. Message TEXT also lives in one place (`ui-shared`: `errorText`, `dashErrorText`, `copy`), never typed inline in a screen. Any screen that builds its own error box, empty state, loader or note is a must-fix. Update `docs/COMPONENTS.md` with each new component.

3. **Optimize:** small client bundles (check with `next build` output and `@next/bundle-analyzer` only if MJ approves the package), no unused dependencies, memoize only where measured, virtualize or paginate long lists, debounce search, avoid re-renders, images sized and lazy, fonts self-hosted via next/font, no layout shift, fast first paint, Lighthouse-style targets (LCP under 2.5 s, CLS under 0.1, INP under 200 ms) on the preview.
4. **Review session (hms-7e) does the research** on current Next.js best practices (official Next.js docs and release notes for the installed version), writes `docs/design/ui-review/12-NEXTJS-PERFORMANCE-AND-COMPONENTS.md` with concrete rules and a checklist, then audits the web app against it and sends findings to the Lead. It is the first thing it does when work resumes.

## Status update (2026-10-05, 02:14)
- Done on web and mobile: dashboard kit + shell, Guest dashboard (7 screens). Mobile also wrote Corporate (8 screens, browser check pending). Next: Corporate on web, then Hotel areas in order (overview, frontOffice, billing, cash, companies, payrollCore, payrollPay, website, admin), then hook dashboards into SignedIn.
- Each role has its OWN dashboard (MJ). The Guest/Corporate/Hotel chips in the preview are a dev tool only. Other roles' dashboards come later.
- **Connect each role to its own dashboard FIRST after resume (MJ: "move the corporate, guest and hotel to each their dashboard in all")**: after sign-in `guest_user` opens Guest, `corporate_user` opens Corporate, `hotel_admin` and `hotel_user` open Hotel (map `dashboardForRole` in ui-shared/dashboards/nav.ts), on web and mobile. Other roles keep the placeholder landing. Real app has no dashboard switcher. Test logins (password Demo@Pass2026): guest@demo.hms, corporate@demo.hms, staff, 9876543210.
- **ZERO AGENTS (MJ, latest order):** no subagents, no Workflow, anywhere. Each session does its own work. Sonnet medium only.
- **PRIORITY at resume:** the ENTIRE Guest and Corporate dashboards, web and mobile, as SPA in the same Hotel Pallav portal design (resources/views/portal/**), user friendly, and identical across web and mobile. Then the login connection, then the Hotel areas.
- All sessions are paused by MJ and RESUME at about 03:44. After that, subagents are allowed again and should all be kept working. Use **Sonnet only (medium effort)** for sessions and agents. The review session resumes too (spec 10, day + night).

## Rules (MASTER.md applies)
- TypeScript strict, no `any`. **No new libraries** (R11). Web: Next.js + React only. Mobile: only packages already in `Mobile App/package.json`.
- Every screen: loading (skeleton), empty, error (with Retry), success, offline (R8). Never show raw errors (use `dashErrorText`).
- Money in **paise** integers; show with `formatINR` (`₹1,23,456.00`, Indian grouping). Dates `formatDate` (`04 Oct 2026`), times `formatTime` (12-hour IST). Amount in words: `amountInWords`. All in `ui-shared/dashboards/format.ts`.
- Numbers right-aligned in tables, text left. Phone: tables become cards. 44px touch targets. WCAG 2.1 AA. Night mode follows the device (no toggle) using `ui-shared/tokens.ts` (`color`, `auth.night`).
- Text in English, plain and short. Labels/columns from the Pallav screen, improved where unclear.
- Destructive actions use a confirm dialog. Create/edit happen in a modal (web) or full-screen sheet (mobile), like Pallav.
- PDFs / prints / emails: show a button that opens a **preview** in the app (no PDF library); real PDF comes with the backend.
- **Never edit another agent's files.** Never edit `ui-shared/auth/**`, `ui-shared/tokens.ts`, `ui-shared/dashboards/{format,common,nav,index}.ts`, `src/dashboards/{types,registry}.ts`, or the auth files (`web-app/src/components/auth/**`, `web-app/src/app/**`, `Mobile App/src/{auth,steps,ui,app}/**`). Need a change there? Say so in your final report.
- No commit, no push. Don't start dev servers (already running: web http://localhost:3001, Expo :8081).

## Structure (both apps, same names)
```
ui-shared/dashboards/            format.ts, common.ts, nav.ts (Lead) + <group>.ts (one per module agent)
<App>/src/dashboards/
  types.ts        ScreenProps, ScreenMap (Lead)
  registry.ts     imports every groups/<g>/index (Lead)
  kit/            building blocks (kit agent of that app)
  shell/          RoleDashboard + frame + navigation (kit agent of that app)
  groups/<group>/ screens of one module group (that group's agent) - index.ts(x) exports `screens: ScreenMap`
```
Module groups (`moduleGroups` in nav.ts): guest, corporate, overview, frontOffice, billing, cash, companies, payrollCore, payrollPay, website, admin. View ids and menu: `ui-shared/dashboards/nav.ts` (`nav`, `subNav`). Detail/form views a module needs beyond the menu use ids under the same prefix, e.g. `hotel.fo.reservation` with `params.id`.

## Module contract file: `ui-shared/dashboards/<group>.ts`
Pure TypeScript, no React, no imports outside ui-shared. Contains:
1. Types for every record (fields from the Pallav model/view; money `...Paise: number`; dates ISO strings).
2. `create<Group>Api(clock?: MockClock)` returning async functions that resolve `DashResult<T>` via `mockCall` (list with `ListQuery`/`Page`, get, create, update, delete/cancel as Pallav allows). Keep an in-memory store so create/edit/delete visibly work during a session.
3. Realistic Indian mock data (hotel "Hotel Sunrise, Rajkot", rupee amounts, Indian names, GSTINs like `24ABCDE1234F1Z5`), 8-30 rows per list, including edge cases (zero, long names, cancelled, overdue).
4. `<group>Copy`: screen titles, column headers, empty-state text, button labels.

## Kit API (both apps implement the SAME names and props; `onPress` everywhere, not onClick)
Exported from `src/dashboards/kit/index.ts(x)`:
| Component / hook | Props (summary) |
|---|---|
| `useAsync<T>(load: () => Promise<DashResult<T>>, deps: unknown[])` | returns `{ state: AsyncState<T>, reload() }`; `AsyncState = {status:'loading'} \| {status:'error', error: DashError} \| {status:'ready', data: T}` |
| `AsyncView<T>` | `{ state, onRetry, isEmpty?: (d:T)=>boolean, empty?: {title, body, action?}, skeleton?: 'list'\|'cards'\|'detail', children: (data:T)=>ReactNode }` |
| `PageHeader` | `{ title, subtitle?, actions?: ReactNode, onBack?: () => void }` |
| `Card` | `{ title?, subtitle?, actions?, children, padded?: boolean }` |
| `KpiGrid` / `KpiTile` | `{ kpis: Kpi[] }` / `{ kpi: Kpi }` (Kpi in common.ts) |
| `StatusPill` | `{ tone: Tone, label: string }` |
| `FilterBar` | `{ tabs?: {id,label,count?}[], activeTab?, onTab?, search?, onSearch?, searchPlaceholder?, summary?: string, onReset?, children?: ReactNode (extra filters) }` |
| `DataTable<T>` | `{ columns: Column<T>[], rows: T[], rowKey: (r:T)=>string, onRowPress?: (r:T)=>void, page?: {page,pageSize,total,onPage:(p:number)=>void} }`; `Column<T> = { id, header, render: (r:T)=>ReactNode, align?: 'left'\|'right'\|'center', width?: number, primary?: boolean }`. Mobile renders cards: `primary` column as title, others as label/value rows |
| `KeyValue` | `{ items: {label: string, value: ReactNode}[], columns?: 1\|2 }` |
| `MoneyText` | `{ paise: number, tone?: Tone, compact?: boolean }` (tabular, right-aligned) |
| `Button` | `{ label, onPress, variant?: 'primary'\|'secondary'\|'ghost'\|'danger', icon?: string, busy?: boolean, disabled?: boolean, size?: 'sm'\|'md' }` |
| `IconButton` | `{ icon, label (a11y), onPress, tone? }` |
| `Modal` | `{ open, title, onClose, children, footer?: ReactNode, size?: 'sm'\|'md'\|'lg' }` (mobile: full-screen sheet) |
| `ConfirmDialog` | `{ open, title, body, confirmLabel, tone?: 'danger'\|'violet', busy?, onConfirm, onCancel }` |
| `Field` | `{ label, error?, hint?, required?, children }` |
| `TextInput` | `{ value, onChange:(v:string)=>void, placeholder?, keyboard?: 'text'\|'number'\|'email'\|'phone', multiline?, disabled? }` |
| `MoneyInput` | `{ paise: number\|null, onChange:(p:number\|null)=>void }` (types rupees, stores paise) |
| `DateInput` | `{ value: string (YYYY-MM-DD), onChange }` (web: native date input; mobile: masked text DD-MM-YYYY, no new libs) |
| `Select` | `{ value, onChange, options: {value,label}[], placeholder? }` |
| `Checkbox` / `Toggle` | `{ checked, onChange, label }` |
| `Tabs` | `{ tabs: {id,label,count?}[], active, onChange }` |
| `EmptyState` | `{ icon?, title, body, action?: ReactNode }` |
| `useToast()` | `{ show: (t: {tone:'success'\|'error'\|'info', text: string}) => void }` (needs `ToastProvider` in the shell) |
| `Icon` | `{ name: string, size?: number, color? }` - must cover every icon name in nav.ts plus: plus, edit, trash, search, filter, x, check, chevronRight, chevronLeft, more, download, printer, eye, refresh, phone, mail, mapPin, clock, alert, info, star, lock, logout, menu |
| `BarChart` | `{ data: {label, value}[], format?: (v:number)=>string }` simple bars, no chart library |
| `Section`, `Row`, `Stack`, `Grid` | layout helpers `{ gap?, children }` (Grid: `{ min: number }` responsive columns) |

## Shell (kit agent of each app)
- `src/dashboards/shell/RoleDashboard.tsx`: `export function RoleDashboard(props: { user: AuthUser; onSignOut: () => void; onLockScreen: () => void })` and `export function hasDashboard(role: Role): boolean` (uses `dashboardForRole`).
- Navigation is in-app state (SPA, no page reloads): a stack of `{ viewId, params }`; `navigate` pushes, `back` pops. Unknown view -> friendly "Coming soon" screen. Screens come from `allScreens` in registry.ts.
- Web frame (Pallav): collapsible violet sidebar with `nav[kind]` sections; second panel for `subNav` (Payroll, Website); sticky top bar with page title, hotel/company name, user menu (My profile, Lock screen, Sign out). Below 1024px the sidebar becomes a drawer.
- Mobile frame: header with title + back; bottom tab bar with the first 4 items of `nav[kind]` + "More" (all sections, grouped); `subNav` opens as a list screen; Android back pops the stack, then asks before leaving.
- `ToastProvider` around the frame.
- Until the auth teams wire it in, add a **dev-only preview**: web `web-app/src/app/dev/dashboard/page.tsx` (renders RoleDashboard with a demo user picked by `?role=guest|corporate|hotel`, returns notFound() in production); mobile: export `DashboardPreview` from shell (the Lead asks the auth team to link it from the demo panel).

## Done (each agent)
- Web: `npx tsc --noEmit` and `npx eslint src/dashboards` pass for your files. Mobile: `npx tsc --noEmit` and `npx expo lint` pass for your files. If another agent's unfinished file breaks the build, say which one in your report, don't fix it.
- Final report to the Lead (short): screens built (web + mobile), mock data, anything skipped, questions for MJ.
