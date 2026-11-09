# R48 Shell on the server: design (session D, 12 Oct 2026)

Goal (MJ): on a reload (F5, hard refresh, new tab) the sidebar and top bar are part of the FIRST HTML, drawn from the verified session, and only the content area shows skeletons while its data loads. Same behaviour as Vercel's dashboard. No shortcut (no localStorage shell, no fake skeleton shell).

## Today (measured by reading the code)

`/` serves a client-only app: `AuthEntry` loads `AuthApp` with `dynamic({ ssr: false })`, so the first HTML is a sign-in-looking outline. After the JavaScript runs, `AuthApp` asks `GET /api/v1/auth/session` (the "restoring" step, up to 5 tries), then loads `RoleDashboard` with a second `dynamic({ ssr: false })` (blank panel), then the screen group chunk, then the data. So a reload shows: white, sign-in outline, blank, dashboard with skeleton sidebar, then data.

## Chosen architecture

1. **`app/page.tsx` becomes an async server component** (`dynamic = "force-dynamic"`). It reads the httpOnly session cookie with `headers()`, verifies it with the EXISTING session resolver (`createSessionResolver().resolveSession(request)`, read-only: no idle extension, same as `GET /auth/session` with `touch: false`) and builds a **ShellSeed**: the user as the shell needs it to draw (id, display name, role, hotel name and food name, group name, pathik availability flag, grants and abilities for the menu filter, theme preference). No e-mail, no mobile number, no token, no guest or bill data. The same fields the browser receives from `/auth/session` a moment later; the seed is the display subset.
2. **`AuthEntry` takes `seed` as a prop.** With a seed, `AuthApp` starts in the `signedIn` step (a seed session: user = the seed, `expiresAt` unknown) and renders `RoleDashboard` at once. Without a seed (no cookie, expired, revoked, replaced) it behaves exactly as today (sign-in; mock mode never has a seed).
3. **Both `ssr: false` boundaries go** (`AuthApp`, `RoleDashboard`), so the server renders the real `PallavShell` (sidebar, top bar, footer, bottom bar of the portals) from the seed. The content region renders its own `PageSkeleton` on the server (the screen groups stay lazy `import()` calls in the browser, they are not server-rendered).
4. **Background verification.** After hydration `AuthApp` runs the existing `restoreOutcome` once: `session` swaps the seed for the full user (e-mail etc.) and arms the idle timers; `over` (401) forgets the last view and shows sign-in; `unreachable` keeps the shell and shows the existing "cannot reach the server" note in the content area. No auth decision is made from client state: every API route still verifies the cookie itself.
5. **Hydration safety.** The server and the first client render must match. Things that differ today and move to "after hydration": the greeting and the clock in the top bar, the sidebar collapsed flags kept in `localStorage`, the remembered last page (`lastView`, decision 49: the first render is the default page, an effect then restores the remembered page; the content is a skeleton anyway), `matchMedia` based phone layout, `apiMode()` (production is always `real`; in development a seed is only made when the build is real).
6. **Client navigation** stays as is: one route, one persistent `RoleDashboard`; screens swap inside the content area (R48 smooth refresh keeps data on screen). Reloading `/` re-runs the server render only for the shell and the verification query.
7. **Caching.** `Cache-Control: private, no-store, max-age=0` and `Vary: Cookie` on `/` (next.config `headers()` plus the dynamic render's own header), so no shared cache (browser back-forward cache excluded, CDN, proxy) can keep or serve HTML with a name in it. A `pageshow` handler reloads when a page comes back from the back-forward cache.
8. **Sign-out and user switch.** Sign-out clears the cookie (existing route) and the client state; a signed-out tab shows sign-in. The next sign-in is client-side and renders the new user's shell from the new session; no stored shell exists to flash the old one. Back button after sign-out: `no-store` makes the page ineligible for the cache and `pageshow` guards the rest.

## Per situation

| Situation | What the server does | What the person sees |
|---|---|---|
| Valid session, hotel staff | seed from session | sidebar and top bar in the first HTML, content skeleton, data |
| No cookie, expired, revoked, replaced | no seed | sign-in as today |
| Hotel suspended or archived, blocked account | resolver refuses: no seed | sign-in with its own message as today |
| Guest or company login | seed, portal kind | portal sidebar/top bar and bottom bar in the first HTML, hotel selector from the client store |
| Platform or group visit inside a hotel | the visit is client state (the console switches to the visited hotel after the page runs) | platform shell first, the visit banner after hydration (visits are read-only and re-entered after a reload as today) |
| JavaScript slow or failing | the HTML already has the sidebar and top bar | a visible, non-interactive shell until the scripts run; links work after hydration |

## Safety requirements and how each is met and tested

| # | Requirement | Where and test |
|---|---|---|
| 1 | HTML with user data never cacheable by a shared cache | `Cache-Control: private, no-store` + `Vary: Cookie` on `/`; test of the header on a production build and of `next.config` headers |
| 2 | only display fields in the HTML | `ShellSeed` type with an explicit allow-list; test renders the page and scans the HTML for e-mail, token, mobile |
| 3 | cookie flags and CSRF unchanged | no change to cookie code; existing tests stay |
| 4 | no auth decision from client state | server resolver on every request; API routes unchanged; test: a forged seed in the page cannot call an API |
| 5 | stolen or stale shell shows only the nav | the seed has no data beyond display fields |
| 6 | no flash of another user's shell | no stored shell; test: sign out, back, sign in as another account |
| 7 | works with JS slow or failing | the shell is in the HTML; measured with CPU 4x and Fast 3G |
| 8 | decision 49 | F5 returns to the remembered page and tab, a fresh visit opens the dashboard (existing `lastView`, restored after hydration) |

## Risks I see before starting

The shell and `AuthApp` were written client-only; the first server render may expose browser-only code that has to be moved into effects (listed in 5). A hydration mismatch shows as a console warning in development and as a flash in production, so every one found is fixed, not suppressed. If a part cannot be made safe, it stays client-side and the sidebar still comes from the server.

## Measure (production build, `npm run build` then `npm start`, CPU 4x, Fast 3G)

Before and after, for hotel admin, guest and company: ms until the first sidebar paint, ms of white page (navigation start to first non-white paint), ms until content data. Numbers go into `R48-SMOOTH-REFRESH.md`.
