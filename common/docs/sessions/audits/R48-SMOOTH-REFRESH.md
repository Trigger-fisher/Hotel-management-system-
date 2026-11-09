# R48 Smooth refresh (session D, 12 Oct 2026)

MJ: refreshing or saving must not blank or redraw the page; old data stays while the new data loads. Measured on the mock hotel preview with every mock answer delayed by 600 ms (a real server also takes time).

## Why a refresh felt heavy (causes, all found in code)

| # | Cause | Where | Effect |
|---|---|---|---|
| 1 | `useAsync` answered `loading` again on EVERY reload or change of its inputs | `web-app/src/components/ui/useAsync.ts`, 114 calls in 76 files | each screen that shows a skeleton or an empty list on `loading` went blank after every save, filter, tab or Refresh |
| 2 | Three separate local fixes, so only part of the app was covered | `useLast` (billing/shared.tsx), `useLastReady` (cash/shared.tsx), `useLoaded` (payrollCore/load.tsx): about 40 files | In House search, Reservations tabs, Pathik "In Pathik now" Refresh and the admin lists were NOT covered |
| 3 | Refresh and save use a `version` or `tick` counter inside the inputs | Users, Roles, Settings, Profile, SignIns, Masters*, Pathik, Enquiries | the counter changed the inputs, so cause 1 hit after every save |
| 4 | Every answer was a brand-new object tree | same hook | all rows re-rendered and effects keyed on the data re-ran, even when nothing changed |
| 5 | Nothing told the person a refresh was running | only Pathik had a spinner | silence, or a blank page |
| 6 | Not a cause, left as it is: `RoleDashboard` remounts the screen when the page, the stack depth, the "same menu entry again" counter or the portal hotel changes | `shell/RoleDashboard.tsx` viewKey | intended: a new page, "start afresh" on a second click, a hotel switch |

## What changed

| Change | File |
|---|---|
| `useAsync`: on `reload()` the old answer stays `ready` while the new one loads (`refreshing: true`); only the first load is `loading`. New option `{ keep: true }` keeps the old answer when the inputs change too (filters, tabs, pages, a refresh tick). Without `keep`, changed inputs still blank (they may name another record or company: the old rows must not show) | `components/ui/useAsync.ts` |
| New answers reuse every unchanged part of the old one (rows matched by `id`); identical data returns the same object, one changed row touches only that row | `components/ui/shareUnchanged.ts` (6 tests: `tests/shareUnchanged.test.ts`, all pass) |
| One slim progress line at the top of the page while any screen refreshes behind old data; it never shows on a first load and moves nothing | `components/ui/refreshActivity.ts`, `dashboards/shell/RefreshLine.tsx`, `public/pallav/hms-overrides.css`, mounted in `RoleDashboard.tsx` |
| `keep: true` added where the inputs are a counter or a filter of the same list: Pathik (3 lists), In House, Reservations, Guest Enquiries, Razorpay payments, Users, Roles, Settings, Profile, Sign-ins, Master Data (3 panels), Website Settings | `dashboards/groups/*` (17 call sites) |
| Dev only: `sessionStorage['hms-mock-latency'] = '600'` delays every mock answer | `lib/api/mode.ts` (not in production builds) |

## Measured (tools/refresh-metrics.mjs, 600 ms mock latency, headless Chrome, hotel preview)

| Flow | Before: time the list is blank | After |
|---|---|---|
| Pathik "In Pathik now": Refresh button | 611 ms (5 rows to 0) | 0 ms; slim line shows; same 5 rows stay |
| In House: type in the search box | 618 ms (10 rows to 0) | 0 ms; typed text kept; DOM nodes changed 18 to 1 |
| Reservations: switch the view tab | 611 ms (10 rows to 0) | 0 ms |
| Bills: Paid tab, Guest Enquiries tab | 0 ms (already covered by `useLast`) | 0 ms |

Not measured: render counts with React DevTools (only DOM nodes changed, a rough proxy), real-server timings, 4 of the 17 opted-in screens by hand.

## How the portals adopt it (B and C)

Nothing to do for a screen that calls `useAsync(..., [])` and `reload()` after a save: it keeps its data now. For a list with page, search or tab inputs of the SAME hotel add `{ keep: true }` as the third argument, e.g. `groups/corporate/AccountList.tsx`: `useAsync(() => fetch({ search, page, pageSize }), [search, page, pageSize, ...deps], { keep: true })` (leave it off if `...deps` holds the hotel or a record id; the hotel switch already remounts the screen). Do not add your own `useLast` on top.

## Not done (proposals)

| Item | Note |
|---|---|
| Optimistic update after a save | no safe generic form. Candidates: switch a menu item on/off, move a list item, mark a salary payment paid. Each needs its own rollback; propose per screen |
| Scroll position when a whole page remounts | unchanged on purpose; refreshes no longer remount |
| Screens with their own load state (not `useAsync`) | not found in this pass; the Pathik refresh flow has its own poller but now reads through `useAsync` |

## Reload, like Vercel (13 Oct 2026, session "Local session visibility")

MJ's two screen recordings (HMS vs the Vercel dashboard on a reload) compared frame by frame: HMS went dashboard, violet sign-in splash (about 3 frames), white page (2 to 3 frames), outline, data; Vercel kept its side bar and page frame from the first frame and only the content area showed grey placeholders. What changed:

| Change | File |
|---|---|
| A browser that had a dashboard open paints the neutral dashboard outline on the FIRST frame of a reload: an inline script in the page head reads one localStorage word (`hms-shell`, written by the dashboard, cleared when the session ends) before the first paint and sets `<html data-shell="app" data-theme=... data-sk-collapsed>`; CSS then shows the outline instead of the violet sign-in placeholder. The outline has the real shell's widths (rail 244 / 68 px, top bar 69 px) so nothing moves when the shell arrives | `app/layout.tsx`, `app/globals.css` (.hms-sk-app), `components/ui/AppShellSkeleton.tsx`, `dashboards/shell/shellFlag.ts`, `components/auth/AuthShell.tsx` |
| The same outline stands in while the dashboard code loads and while Pallav's stylesheets load (they are preloaded with the page now), instead of a blank "Canvas" div and the violet page | `components/auth/steps/SignedInStep.tsx`, `dashboards/pallav/PallavFrame.tsx`, `dashboards/pallav/assets.ts` |
| F5 and Ctrl+R inside a dashboard refresh every screen in place (every `useAsync` registers its reload; the slim line runs; an "Up to date" toast ends it; the session is re-checked). Ctrl+Shift+R, Ctrl+F5, Shift+F5 and a second F5 within two seconds are real reloads | `components/ui/softRefresh.ts`, `dashboards/shell/SoftRefresh.tsx`, `useAsync.ts` |
| The mock keeps its session in the tab (sessionStorage), so a reload of the demo build restores it like the real cookie session (before: every reload of the demo landed on sign-in) | `ui-shared/auth-pallav/mock.ts`, `lib/auth/api.ts`, `AuthApp.tsx` |

Measured on the local demo production build (`NEXT_PUBLIC_HMS_LOCAL_DEMO=1 next build`, headless Chrome 1280x720, CDP screencast, `scripts/_reload-frames.tmp.mjs` and `_timing.tmp.mjs` in the session's scratchpad): F5 = 0 document navigations, same sidebar, "Up to date" after about 1 s; hard reload = old page, then the outline at about 140 ms (no violet, no white frame), the real shell at 1.0 to 1.5 s, data right after. The gap between the outline and the real shell is the dashboard's JavaScript (dynamic chunks) and the mock's answer time; the outline hides it.
