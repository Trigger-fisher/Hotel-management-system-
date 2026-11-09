# 12 - Next.js 16.3 performance rules + ONE central component library

Task (MJ via the Planner, 2026-10-05): use the top-level Next.js features and optimise; put every reusable piece (date, button, header, table, modal...) in **one place**, reused everywhere, never shown on its own. Brief: `docs/sessions/reports/S03-dashboards.md` → "FRONTEND ARCHITECTURE RULES".
Researched from the **bundled docs of the installed version** (`web-app/node_modules/next/dist/docs/`, Next **16.3.8**, React 19.2.8, Tailwind 4): `01-app/02-guides/{production-checklist, lazy-loading, server-and-client-boundary, single-page-applications, package-bundling, view-transitions, rendering-philosophy}.md` and `03-api-reference/05-config/01-next-config-js/{reactCompiler, cacheComponents, optimizePackageImports}.md`. Scope: frontend only, mock data. No new library without MJ (R11): items that need one are marked **ASK MJ**.

## Part A - Rules (with the doc each comes from)

### A1. Server vs Client components
| # | Rule | Source |
|---|---|---|
| 1 | Server Components are the default and add **zero** client JS. Put `'use client'` only on the leaves that need state, effects or events; props crossing the boundary must be serialisable | production-checklist, server-and-client-boundary |
| 2 | A Client Component is **also rendered on the server** (HTML) and again in the browser; `'use client'` does not mean "browser only". Anything that must be browser-only needs `next/dynamic` with `ssr: false` **inside a Client Component** (not allowed in Server Components) | server-and-client-boundary, lazy-loading |
| 3 | Heavy render work with no browser API or interaction (data → markup, formatting, charts that can be SVG) belongs in a Server Component, not a Client Component | package-bundling "Heavy client workloads" |
| 4 | Static chrome (page shell, brand row, copyright, headings, `loading` skeletons) stays server-rendered; only the interactive island is client | single-page-applications |
| 5 | For an SPA feel use ONE shell and client-side navigation (history API integrates with the router); data for client screens can be passed as a Promise from a Server Component and read with `use()` inside `<Suspense>` | single-page-applications |
| 6 | `searchParams` / `cookies()` make a route **dynamic**. Reading them in the page opts the whole route out of prerendering; keep `/` static and read links in a client effect (current approach) | production-checklist |

### A2. Code splitting and bundle size
| # | Rule | Source |
|---|---|---|
| 1 | Routes split automatically. **Inside one route, split by hand** with `next/dynamic` / `React.lazy` + Suspense: heavy screens, modals, previews, charts, anything not on first paint | lazy-loading |
| 2 | A Server Component that imports a Client Component does **not** get automatic client code splitting. Load client screens from a Client Component with `dynamic(() => import(...))` | lazy-loading note |
| 3 | Load per **screen or group**, not through a registry that imports everything (`registry.ts` eager imports pull every screen into the first bundle) | lazy-loading |
| 4 | Measure with the **built-in** Turbopack analyzer: `npx next experimental-analyze` (v16.1+, **no package needed**). `@next/bundle-analyzer` is NOT needed (ASK MJ otherwise) | package-bundling |
| 5 | No barrel file that drags a whole library into a client chunk: import the one component you need, or list big icon/util packages in `experimental.optimizePackageImports` (we use none; our own icons are local) | package-bundling, optimizePackageImports |
| 6 | No unused dependencies. Today: `next`, `react`, `react-dom` only (good). Keep it that way | production-checklist |
| 7 | Dev-only code (demo panel, mock API, preview pages) behind a **literal** `process.env.NODE_ENV !== "production"` branch so the build drops it; verify by grepping `.next/static` for "Demo accounts" and "Demo@Pass2026" | (house; verified by Web UI 1) |

### A3. Fonts, images, CSS
| # | Rule | Source |
|---|---|---|
| 1 | Fonts only through `next/font` (self-hosted, no external request, no layout shift). One family (Inter) as a CSS variable wired in `@theme inline` | production-checklist |
| 2 | Images only through `<Image>` (sized, lazy, modern formats); static images in `public/`. Icons are inline SVG from the one Icon component (no icon font, no image icons) | production-checklist |
| 3 | One styling approach per layer. Tailwind 4 utilities + CSS variables from tokens for components; global CSS only for tokens and a few shared keyframes. **No second, parallel system** (CSS modules + a second theme file) for the same components | (house) |
| 4 | Theme CSS variables are generated once from `ui-shared/tokens.ts`, injected once (`<style href precedence>` or the layout `<head>`), never per component | (house) |
| 5 | Night mode = `prefers-color-scheme` variable swap (no JS, no flash). `viewport.colorScheme: "light dark"` | (house; 09 §10) |

### A4. Loading, errors, streaming, caching
| # | Rule | Source |
|---|---|---|
| 1 | Provide `app/loading.tsx` (skeleton), `app/error.tsx` (have it), `app/not-found.tsx`, and `app/global-error.tsx` + `app/global-not-found.tsx` for uncaught root errors | production-checklist |
| 2 | Wrap slow parts in `<Suspense>` with a skeleton that has the **same shape** as the real content (no layout shift) | production-checklist, streaming |
| 3 | Fetch in parallel, never in waterfalls. Cache static responses; `Cache Components` (`cacheComponents: true`, `use cache`, `cacheLife`, `cacheTag`) is the 16.x way to choose what is cached. Not needed while data is mock; **revisit when the real API arrives (step 6)** | cacheComponents, caching |
| 4 | Navigation: use `<Link>` (prefetch). Inside our SPA shell, view changes are client state; **keep each view lazily loaded and prefetch the next likely one on hover/idle** | linking-and-navigating |
| 5 | `<ViewTransition>` (React canary in the App Router, no config) animates step/view changes; give shared elements a `name`, set `default="none"` to stop unrelated crossfades, and respect `prefers-reduced-motion` | view-transitions |
| 6 | **React Compiler**: `reactCompiler: true` in `next.config.ts` auto-memoises components so manual `useMemo/useCallback` is rarely needed. It needs `babel-plugin-react-compiler` (a dev dependency) → **ASK MJ** (R11). Mobile already runs it (Expo setting) | reactCompiler |

### A5. Runtime performance targets (measure on `next build && next start`, not dev)
LCP < 2.5 s · CLS < 0.1 · INP < 200 ms (Lighthouse in incognito, `useReportWebVitals` if wanted). Lists: paginate or virtualise beyond ~100 rows; **debounce search (250-300 ms)**; no re-render storms (keep state low in the tree; split contexts); no layout shift when skeletons swap for data.

## Part B - One component library (rule set)

**Where:** `web-app/src/components/ui/**` is the ONLY home of reusable UI. (Mobile: `Mobile App/src/ui/**`, same names.) Internal only: no route, no page, not reachable from a URL. A barrel `index.ts` exports everything; screens import from `@/components/ui`.

| # | Rule |
|---|---|
| 1 | **No screen defines its own** button, link, icon, spinner, field, select, checkbox, date or money input, header, card, table, pill, tab, modal, toast, empty/error/loading state, KPI tile, key-value list or note. They import them. A local helper is allowed only if it is used by **one** screen and is **layout-only** (spacing/grid), not a look |
| 2 | One implementation per component. Two files that export the same name (e.g. two `Icon`, `Spinner`, `Checkbox`) = send back |
| 3 | One theme: a single set of CSS variables built from `ui-shared/tokens.ts` (auth, dashboard and library all read it). No second theme file |
| 4 | One date/money/number formatter: `ui-shared/dashboards/format.ts` (`formatINR`, `formatDate`, `formatTime`, `amountInWords`). `toLocaleString`, `Intl` or `toFixed` inside screens or kit = send back (counts use one shared `formatCount`) |
| 5 | Props are the same as the mobile kit (S03 "Kit API"). Variants are props (`variant`, `size`, `tone`), never copies of a component |
| 6 | Every component ships its own states (hover, focus-visible, pressed, disabled, busy, error), keyboard behaviour, ARIA, night colours and reduced-motion handling, so screens cannot forget them |
| 7 | Documented in `docs/UI.md` (list, props, a11y notes). A new component is added to the library and the doc first, then used |
| 8 | Library files are Server Components by default; only interactive ones (`Modal`, `Select`, `Tabs`, `Toast`, `DataTable` with paging...) carry `'use client'`, pushed as small as possible. Pure display parts (`Card`, `StatusPill`, `KpiTile`, `MoneyText`, `PageHeader`, `KeyValue`, `Icon`, `Skeleton`, `EmptyState`) must NOT be client components |
| 9 | Heavy members (`Modal`, `DataTable` sorter, `BarChart`, previews) are lazy-loaded where used so they are not in the first bundle |

## Part B2 - "A component for everything" (MJ, same night; brief item 2b)

MJ: "I want a component for everything, like an error message too, which we use multiple times." **Anything used, or likely to be used, more than once is a component in the library**, including feedback pieces:

| Group | Components (one each) |
|---|---|
| Feedback | `Alert`/`ErrorMessage` (inline error, warning, success, info), `FieldError` (under inputs), `ErrorState` (full-area error with Retry + friendly text from `errorText`), `EmptyState`, `LoadingState`/`Skeleton`, `Notice` (note box), `OfflineBanner`, `Toast`, `ConfirmDialog` |
| Display | `Badge`/`StatusPill`, `Avatar`, `KeyValue`, `MoneyText`, `DateText`, `SectionTitle`, `Tabs`, `FilterBar` |
| Message text | ONE place: `ui-shared` (`errorText`, `dashErrorText`, `copy`). **Never typed inline in a screen** |

**Must-fix triggers (web and mobile):** a screen that builds its own error box, empty state, loader/spinner, note/notice, avatar, badge, toast or confirm; any user-facing message string typed inline in a screen or component; any new piece that is used twice but not in the library; a component added without an entry in `docs/UI.md`.

Audit commands I run (read-only): `grep -rn "<button\|<table\|<input\|<select" src/dashboards/groups`, a search for local `function (Note|Notice|Alert|Empty|Loading|Spinner|Avatar|Badge|Error)\w*` definitions outside the library, and a search for hard-coded sentences in JSX in screens (text longer than 3 words not coming from `copy`/`*Copy`/`errorText`).

## Part C - Audit of web-app (2026-10-05)

Measured/read directly (no `next build` yet: `tsc` currently fails in `ui-shared/dashboards/website.ts`, which is dashboards work, so I couldn't produce bundle sizes; see C5).

### C1. What is already good
Server `page.tsx`/`layout.tsx` with `metadata`/`viewport`; `next/font` Inter via variable; theme CSS generated from tokens once (`lib/theme.ts`) and `theme-color` for both modes; auth entry uses `next/dynamic` (ssr:false) with a skeleton; dev-only preview and demo code gated behind literal `NODE_ENV` (the preview page even uses `await import`); `ViewTransition` for step changes; only 3 runtime dependencies; no hard-coded hex in auth; icons are inline SVG; `error.tsx` exists.

### C2. Findings (must fix unless marked)
| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **Must** | **Two parallel component libraries.** `src/components/ui` (auth: Button, Feedback, Icon, Spinner, TextField, Tailwind) and `src/dashboards/kit` (13 files: Button, Data, Form, Icon, Layout, Overlay, States, Toast, CSS modules). Both define **Icon** and **Spinner**; **Checkbox** exists in `ui/Feedback.tsx` and `kit/Form.tsx`; two Button systems; two theme variable families (`--hms-*`/`--r-*` in `lib/theme.ts`, `--d-*` in `kit/theme.ts`) and two styling methods (Tailwind vs `kit.module.css` 27.8 KB + `shell.module.css` 12.5 KB) | Merge into `src/components/ui` with ONE implementation each; one theme file; one styling method (Tailwind + variables). Move `kit/` and `components/auth/*` shared parts there, delete duplicates, update imports, add the barrel and `docs/UI.md` |
| 2 | **Must** | **Screen groups re-implement shared pieces.** `groups/companies/ui.tsx` (Txt, Spread, Wrap, Cell, Avatar, Panel, FormSection, Divider, Timeline, Paper...), `groups/website/parts.tsx` (Txt, Line, Grow, Inset, Divider, PhotoBox, IconTile, Notice, ListRow, StickyBar), `groups/payrollCore/shared.tsx` (TwoLine, Swatch...), `groups/frontOffice/shared.tsx` (Cell, TotalRow, Note), `groups/cash/shared.tsx` (Note, TotalBar, Words...). Duplicates: **Txt ×2, Divider ×2, Cell ×2, Note ×3, errorText ×3, useSubmit ×2 (also in auth), TwoLine/Notice/Note overlap, Avatar vs auth Avatar** | Move the genuinely shared ones (Avatar, Divider, Note/Notice, KeyValue-like rows, TotalRow/TotalBar, Timeline, paper preview shell) into the library; keep only layout-only single-screen helpers local; ONE `errorText`/`useSubmit` in the library or `ui-shared` |
| 3 | **Must** | **Raw `<button>` and `<table>` in screens**: `<button` in 8 group files (cash/shared, corporate/parts, frontOffice/Board+Rooms, guest/Order, payrollCore/Home+shared, website/parts) and 5 `<table>` (billing Previews ×2, cash ×2, companies) with their own CSS (`paperTable`, `miniTable`) | Use `Button`/`IconButton`/`DataTable`; for printable "paper" previews add ONE `PaperTable` to the library |
| 4 | **Must** | **Everything loads up front.** `dashboards/registry.ts` imports all 11 groups eagerly (≈ 9,000 lines: guest 2,218, corporate 1,339, website 1,358, frontOffice 1,012, payrollCore 934, billing 882, companies 806, cash 354) so one Hotel/Guest user downloads every module. Only `AuthApp` and the demo panel use `next/dynamic` | Registry maps `viewId → () => import('./groups/<g>/<Screen>')` and the shell renders it through `dynamic`/`lazy` + Suspense with the group skeleton. A Guest user must never download Hotel code. Verify with `next experimental-analyze` |
| 5 | **Must** | **No route-level fallbacks beyond `error.tsx`**: missing `app/loading.tsx`, `app/not-found.tsx`, `app/global-error.tsx`, `app/global-not-found.tsx` | Add them (branded, with night mode, accessible) |
| 6 | Should | **Client-heavy by default.** 30/30 auth component files and 34/53 group files are `'use client'`. Pure display pieces in `kit` (`Card`, `PageHeader`, `KeyValue`, `StatusPill`, `KpiTile`, `MoneyText`, `Icon`) are probably inside client files (`Layout.tsx`, `Data.tsx` mix interactive and display) | Split display and interactive components into separate files so display ones are Server Components. Keep `AuthApp` as the client island |
| 7 | Should | **Auth app is `ssr:false`**: the server sends only an empty 420 px card skeleton, so first paint shows no form and LCP waits for the JS chunk | Server-render the signIn card (it needs no browser API); read `window`/history in an effect after mount. Re-measure LCP/CLS on `next start` and keep the skeleton the same size as the real card |
| 8 | Should | **Inline styles**: `style={{` in 8 files (kit Layout ×6, Data ×4, States ×4, companies/ui ×4, website/parts ×3...) | Replace with classes/variables; only dynamic numbers (widths, bar heights) may stay inline |
| 9 | Should | **Two CSS bundles** `globals.css` (11.7 KB) + `ui-kit.css` (8.7 KB) + module CSS (40 KB) loaded on every route | After the merge: one global CSS (tokens, keyframes) + Tailwind utilities; check `inlineCss`/chunking only if CSS blocks LCP |
| 10 | Should | **`reactCompiler` is off** (`next.config.ts` has none); lists and big forms re-render fully | **ASK MJ** to approve `babel-plugin-react-compiler`; then enable and delete hand-written memoisation (mobile already has it) |
| 11 | Should | Search/filter inputs: confirm 250-300 ms debounce and pagination on lists > 100 rows (cash has `useDebounced`; others unverified) | One shared `useDebouncedValue` hook in the library; `FilterBar` debounces itself |
| 12 | Note | `next.config.ts` is lean (headers, turbopack root). Nothing to add for images (no raster images yet). `optimizePackageImports` not needed (no icon package) | - |

### C3. Targets after the fixes (to verify with `next build && next start`)
First-load JS for `/` (sign-in) **< 130 KB gzip**; Guest dashboard route chunk loads only guest code; no module/group chunk shared by two roles unless the library; LCP < 2.5 s, CLS < 0.1, INP < 200 ms; zero duplicate component names across `components/ui`.

### C4. Checklist for every web PR / report (copy into the Web UI report)
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` pass; build output pasted (route sizes).
- [ ] `npx next experimental-analyze` checked; no group/page pulls another role's screens.
- [ ] No new package. No duplicate component name. No raw `<button>`/`<table>`/`<input>`/`<select>` in screens. No `toLocaleString`/`Intl`/`toFixed` in screens.
- [ ] **No screen builds its own error box, empty state, loader, note, avatar, badge, toast or confirm** (B2); message text comes from `ui-shared` (`errorText`, `dashErrorText`, `copy`), never inline.
- [ ] Every new reusable piece is in `components/ui`, exported from the barrel, listed in `docs/UI.md`.
- [ ] Display components are Server Components; `'use client'` only where state/events are needed.
- [ ] Heavy screens/modals/charts use `dynamic`/`lazy` with a same-shape skeleton.
- [ ] Loading, empty, error, offline states from the library; `loading.tsx`/`not-found.tsx`/`global-error.tsx` exist.
- [ ] Night mode via variables only; no hard-coded hex; reduced motion respected.
- [ ] Dev-only code behind a literal `NODE_ENV` check; `.next/static` has no demo strings.

### C5. Not measured yet (honest gaps)
`next build` is blocked by 4 type errors in `ui-shared/dashboards/website.ts`, so I have no real bundle numbers or Lighthouse scores yet; the findings above come from reading the code. I will re-check with real numbers when the build is green.
