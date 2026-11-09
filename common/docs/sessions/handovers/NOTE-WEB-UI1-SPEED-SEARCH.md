# Note for Frontend: speed + search (S1/S2), 10 Oct 2026, from Web UI 1 (d7)

## Written, in the working tree, NOT committed, NOT measured
| File | Change |
|---|---|
| `web-app/src/dashboards/registry.ts` | `preloadGroupsFor(viewIds)`: loads every group of the role, one per idle slot (`requestIdleCallback`), returns a cancel function |
| `web-app/src/dashboards/shell/RoleDashboard.tsx` | calls the preload; keeps the old screen on display until the new one is ready (`shown` state; skeleton only on the very first screen); search on every dashboard; records visits |
| `web-app/src/dashboards/pallav/GlobalSearch.tsx` | `noteVisit`, `usedKey`; screens opened lately rank first on equal score; records picked before come first in their group; "…" row while the server list loads |
| `web-app/src/dashboards/search/api.ts` | `screensOnlyApi` (Guest and Corporate: no server call); company hit opens `hotel.co.statement` (id), enquiry hit opens `hotel.web.enquiry` (id) |
| `ui-shared/dashboards/search.ts` | `searchScreens(items, q, limit, lastUsed)` ties broken by last used |
`npm run build` passes with these changes. VS Code diagnostics: no errors in the five files.

## Not done: the speed numbers
I could not time it. A production build (`npm start`) has no mock sign-in (the mock is dropped by the `NODE_ENV` check in `web-app/src/lib/auth/api.ts`, and `/dev/dashboard` answers 404), so a timing run needs real mode: the Postgres on 5433, the `dev.admin` login from `db/.dev-login.txt`, and the 6-digit code from the server console. My attempt to read the login file was blocked by the permission check, so I stopped. The TODO in PROJECT-STATE section 2 (write the code to a git-ignored `db/.dev-mail.log`) would make this scriptable.
Method that was ready: headless Chrome with `--remote-debugging-port`, a small CDP script (Node 24 global WebSocket), time from a menu click until the title changes and no `[aria-busy]` remains, first and second open of Bills, Revenue, Customers, plus one search. Compare against a build of the previous commit.

## Rough edges seen
- Search hits for bills, advances, customers and staff still open the list with the search text: there is no single-record page for them yet.
- Guest and Corporate search finds only their own screens.
- `NEXT_PUBLIC_API=mock` baked into a production build still leaves sign-in failing (mock is stripped), so do not use it for timing.
