# Plan: make every page very fast (MJ, 11 Oct 2026)

Measure on the PRODUCTION build (`next build` + `next start`, NODE_ENV=production) against the real database, real mode, not on `next dev`. Numbers go in docs/sessions/reports/SPEED-RESULTS.md (before/after, per console and per page). No new libraries without MJ's OK.

## Budgets (must pass on this PC, local network)
| What | Budget |
|---|---|
| Page change inside a console (click -> new screen shown with data) | under 150 ms for cached screens, under 400 ms with a server call |
| First sign-in page load (cold) | under 1.5 s; LCP under 2 s |
| API answer for list/detail calls (server time, p95) | under 150 ms; writes under 300 ms |
| Initial JavaScript per console (gzip) | recorded; target under 250 KB for the sign-in page, under 450 KB for a console shell; each screen group lazy-loaded |
| Search box: first results | under 100 ms from the screen list, server results under 300 ms |
| Large lists (1000+ rows) | paged or virtualised; scroll stays smooth (no layout shift) |
| Photos/logos | resized, cached with long max-age and ETag |

## Frontend tasks (Frontend 1 shell/perf, Frontend 2 its screens)
S1 measure: route-change and first-load times per console and per page group (script with headless Chrome, 3 runs, median); bundle sizes per route (from the build output). S2 fix the biggest: preload next likely screen groups on idle, keep the old screen until the new one is ready, no request waterfalls (parallel fetches, one call per screen where possible), cache lists with short TTL and revalidate on focus, debounce search, avoid re-render storms (memo/keys), split heavy screens (charts, pdf, editors) and import them on demand, remove duplicated CSS/JS, compress and size images, font loading with swap and preload of the used faces only, no layout shift. S3 mock code and demo data are not in the production bundle (see the mock split task). S4 re-measure, record before/after.

## Backend tasks
B1 measure server time per route family (logs with duration, p50/p95) under a small load script (20 parallel users, 60 s) on the production build; find the slowest 20 routes. B2 fix: missing indexes, N+1 queries, over-fetching columns, unpaged lists, repeated permission/session lookups (cache per request), expensive PDFs (stream, limit), heavy transactions; connection pool size; gzip/br compression for JSON, ETag/Cache-Control on safe GETs and media; DB statement timeouts stay. B3 re-measure, record before/after, check no correctness test fails.

## Done when
All budgets pass or each exception is written down with the reason and a plan; SPEED-RESULTS.md has before/after tables; tests green; the production smoke test still passes.
