# Handover, session C (UI / mobile, company and guest portals), 18 Oct 2026

For: claude-d3, who continues the remaining work alone. Everything below is committed on `main` in the Pilot folder (local, not pushed). Last commit of C: `b61b9f5`.
Checks at the end: tsc clean on the whole web-app, eslint clean on `src/dashboards` and `src/lib/api/adapters`, root tests 200/200 (`node --test tests/*.test.ts`).

## Helper agents (staff mobile, phase 3): stopped, nothing to merge
MJ's stop came before any helper committed. All five branches have no commits beyond their start point and no code changes in their worktrees (only dev logs).

| Slice | Screens | Branch / worktree | Last commit | State |
|---|---|---|---|---|
| H1 | Dashboard, Guest Advances, Bills, Revenue, Expenses, Shift Handover | c-h1 / D:\hms-wt\h1 | 2088298 (= start) | not started (was installing) |
| H2 | Company Ledger + Statement, Payroll, the 4 Reports | c-h2 / D:\hms-wt\h2 | 2088298 (= start) | not started |
| H3 | Front Office | c-h3 / D:\hms-wt\h3 | 2088298 (= start) | not started; nothing under companies/admin |
| H4 | Companies (except the ledgers) | c-h4 / D:\hms-wt\h4 | b61b9f5 (= start) | not started |
| H5 | Admin / Settings (not PlatformSettings / PlatformApiAccess) | c-h5 / D:\hms-wt\h5 | b61b9f5 (= start) | not started |

Each slice has an empty phone stylesheet on main, loaded after `hms-overrides.css` (`web-app/public/pallav/phone-h1.css` .. `phone-h5.css`, listed in `pallav/assets.ts` LAST). Use them or fold the rules into `hms-overrides.css` and drop the files (then also remove them from `assets.ts`).
The worktrees can be removed with `git worktree remove D:\hms-wt\hN --force` and `git branch -D c-hN` once nobody needs them; if a folder must be deleted by hand use `cmd /c rmdir /s /q` (never PowerShell `Remove-Item -Recurse`: it follows the `.next` junctions and empties packages in node_modules; that happened once today and `npm install` fixed it).
Screenshot tool used for all checks: `D:\hms-tools\shots.mjs` (headless Chrome over CDP; env BASE, CDP_PORT, WAIT, TAG, EXPR, EXPR2, URL; labels are exact texts or `js:` expressions, no `|` inside them).

## Done (main)
- **Mail provider UI** (b0a6ae2, pushed by the PM): hotel Settings > Email (platform or own mail, provider form) and Platform settings > Mail. Shared `admin/MailProviderFields.tsx`.
- **Notifications** (f006009, a3fc21d): hotel Companies > Notifications (send with preview, history, detail with read receipts, withdraw); company portal page, sidebar badge, bell, phone tab badge; unread store `groups/notifications/unread.ts`.
- **All hotels, company portal** (20c07c2): selector shows dues and unread per hotel (`/corporate/hotels/summary`), Hotel chips on the lists, quiet "N hotels could not be reached" note, Company profile "Hotels you work with".
- **Mobile kit + company phase 1** (7f96fa9, 8cb0ae1, c612011): back arrow on detail pages, tabs Home/Bills/Payments/Alerts/More, bottom-sheet modals and dialogs, sticky Pay bar, page slide-in, pressed states, Load more by cursor (`groups/portal/AppKit.tsx`: StickyActions, useCursorList, LoadMore, PdfAction).
- **Guest portal** (49425f6, 1fc0d49, 040fe03, 872028a, 2f0784a, efea917): Home without paying; bill page with Pay; tabs Home/Bills/Order/Help/More; Order to room (read-only "Ordering from", hotel choice under All hotels, your orders with status and cancel countdown, cart bar + order sheet, menu categories/veg/photos); Help page (requests + messages to the hotel); PDFs (bill, receipt, statement); profile editing and sign-ins.
- **Hotel desk** (672699f): Front Office > Room service orders (steps, cancel with reason, guests' cancel window) and Guest messages (answer / close).
- **Menu Round 3** (1215939): Master Data item form with category, veg and photo.
- **Staff phones, first fixes** (c4efe08, 65f827b): one-line app bar title, Front Office tabs scroll, table cards keep a cell's second line, stacked page heads without the empty flex-basis height.

## Not done / next steps
1. Staff mobile phase 3 per slice (table above): look at every screen at 360/390/430 light and dark and polish (sticky main action on forms, cramped cards, filter rows). A sweep of all 34 hotel menu pages at 360/390/430 already shows no sideways scroll and no console errors.
2. PlatformSettings.tsx and PlatformApiAccess.tsx phone polish (layout/CSS only; mail contract is A's, API access logic d3's).
3. Mail sender identities UI (A's 28ae2d0 contract in `mailProviders.ts`): Super Admin "Mail senders" and hotel Settings > Email "My own domain" with the DNS records card. Not started.
4. `?hotel=` page-address parameter (d3's shell code); the selector choice is in the client store only.
5. Not yet seen in a browser: the portal loading skeleton states, the hotel notification form at 390 dark (desktop and 390 light were checked).

## Known issues
- Hotel staff app bar at 360: the title is now cut with an ellipsis; five buttons remain beside it (bell, year, theme, force, user).
- Notification detail at 360: the title and the Important/Active chips are tight side by side.
- `phone-h1..h5.css` are empty files that each cost a small request until they are used or removed.
