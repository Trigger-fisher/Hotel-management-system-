# The native shell: phones, tablets and the installable app (5 Nov 2026)

What was added so the staff dashboard, the guest portal and the company portal feel like an app on a phone or a tablet, without changing what any screen does. Five commits in the redesign copy: installable app, tablet layout, phone feel, brand, this note. The theme (graphite and gold, day and night) is untouched; every new rule uses the theme variables and lives in `web-app/public/pallav/hms-overrides.css` (bundled into `pallav-last.css` by `npm run pallav:css`, bundle v44) or in `web-app/src/app/globals.css` for the sign-in family.

## 1. Installable app

| Piece | Where |
|---|---|
| Web app manifest: `display: standalone`, `start_url /`, theme colour `#111114` and background `#FAFAFB` from `common/ui-shared/tokens.ts` (`auth.background.stops[0]`, `color.bg`), orientation any, lang en-IN | `web-app/src/app/manifest.ts` (Next's route: served at `/manifest.webmanifest`, the `<link rel="manifest">` is written by Next) |
| Icons 192 and 512 (plain) and 192 and 512 maskable (the mark inside the inner 56% so the safe zone of any launcher shape keeps it whole), `apple-icon.png` 180 | `web-app/public/icons/*.png`, `web-app/src/app/apple-icon.png`; rendered with the project's `sharp` from `public/brand/mark-night.svg` (the gold building mark on the graphite square); the script is not in the repository, the PNGs are |
| Apple tags: `apple-mobile-web-app-capable`, title, `black-translucent` status bar; `applicationName`; no telephone auto-links | `metadata` in `web-app/src/app/layout.tsx` |
| `viewport-fit=cover` | `viewport` in `layout.tsx` |
| Safe areas: the top bar under the notch and beside the corners in landscape, the page column's gutters, the bottom bar, the sticky bars, the sheets, the hotel pop-up and the side drawer | `hms-overrides.css`, block "Installable app" (phones only) |

Not done on purpose: no service worker and no offline cache (the app always shows live data; a stale page would show stale money). No Apple start-up images (one PNG per device size; the standalone window opens on the manifest's background colour instead). `web-app/security-headers.ts` needed nothing: the manifest and icons are same-origin and `default-src 'self'` already covers `manifest-src`.

Test on a phone: open the site in Chrome (Android) or Safari (iOS), use "Add to Home Screen" or "Install app". The icon is the gold mark on graphite; the installed app opens full screen (no address bar) with the graphite status bar, and the top bar and bottom bar keep clear of the notch and the home strip. Turn the phone sideways: the page keeps a gutter beside the rounded corners. In Chrome DevTools: Application > Manifest shows every field and the four icons with "maskable" marked.

## 2. Tablets (768 to 1180 px)

- The side menu is an icon rail (68 px) up to 1180 px (Pallav folded it only under 1081 px). On a touch device the first tap on any rail item opens the rail with its words (`sidebar-peeking`); the second tap picks the page; a tap anywhere outside closes it. With a mouse it opens on hover as before. Rail items are 44 px tall on touch. Where: `PallavShell.tsx` (the `expand` and `away` handlers), `hms-overrides.css` block "Tablets".
- List + detail in two panes: Reservations (`hotel.fo.reservations` -> `hotel.fo.reservation`) and In-house guests (`hotel.fo.inHouse` -> `hotel.fo.stay`). When a record is opened from its list the list stays on the left (sticky, scrolling on its own) and the record opens on the right, no page change; opening another record from the list replaces the one on the right (the stack stays list + record, Back returns to the list alone). The list pane draws DetailCard in its phone shape and tables as card rows (`usePhoneTables` labels them). Where: `RoleDashboard.tsx` (`PANE_LISTS`, `PANE_MEDIA`, the second `useScreen`, `.hms-panes`), `MobileNav.tsx` (`usePhoneTables` pane query), `hms-overrides.css` block "Tablets". A screen needed no new prop: the list pane is the ordinary list screen with its own params.
- Conversations already drew two panes from 761 px (`conversations.css .cv-layout`, GmailPage `gm-main.is-split`); nothing changed there. Bills have no detail page in Pallav (a bill opens in a pop-up), so there is nothing to pair.

Test on a tablet (or DevTools at 1024 x 768 and 820 x 1180 with touch on): the rail shows icons only; tap an icon, the rail opens with words; tap the page name; tap the page, the rail closes. Open Front desk > Reservations, open a card's "Open": the list stays left, the booking opens right; open another card: it replaces the right pane; the browser Back goes to the previous record, then to the list. The same on In-house guests with "Account". Above 1180 px and under 768 px nothing changed.

## 3. Phones (under 768 px)

| Item | How | Where |
|---|---|---|
| Page transitions | The new page slides in from the right when going deeper, from the left when coming back, fades on a menu switch; 200 to 220 ms, CSS only, off under `prefers-reduced-motion` | `RoleDashboard.tsx` writes `data-nav` (`forward`, `back`, `switch`) on `#dash-content` from the stack length; `hms-overrides.css` block "Native feel" |
| Bottom bar hides on scroll | Every bar (staff, company and now the guest tab bar) slips away while scrolling down past 120 px and returns on the first scroll up; open More sheet holds it | `MobileNav.tsx` `useBarAway`; the guest bar's rule out-specifies guest-glass.css (decision 71 said the guest bar never hides; MJ's order of 5 Nov 2026 asks for the same bar behaviour on every dashboard, so it now hides too) |
| Pull to refresh | A finger pulled down from the top of a page shows a ring under the top bar that follows the finger; past 72 px release reloads the screen through the soft-refresh bus (`softRefreshAll`: every `useAsync` loader of the screen, the same reload F5 runs, behind the old data). Not inside a dialog, a sheet, a field, or while the page is scrolled | `web-app/src/dashboards/shell/PullToRefresh.tsx`, mounted in `RoleDashboard`; CSS `.hms-ptr` |
| 44 px touch targets | Buttons, small buttons, row actions, DetailCard footers, tabs, pills, pager and menu rows, dropdown items, the title block of the top bar | `hms-overrides.css` block "Native feel" |
| No sideways page scroll | The page clips at the viewport (`overflow-x: clip` on html and body), wide tables, tab strips and media scroll inside their own box | same block; checked in headless Chrome at 360 px on the staff Overview, Reservations, In-house, Bills, Email, the guest Home, Bills, Room service and the company Overview, Due bills, Ledger: `scrollWidth` equals the viewport on all of them |
| Bottom sheets for row actions | A kit `Dropdown` with three or more items opens as a bottom sheet with a scrim and a grip, drawn under `<body>` through a portal (a card's backdrop filter would otherwise trap a fixed sheet inside it); fewer items keep the small menu | `web-app/src/dashboards/pallav/ui/Dropdown.tsx` (`.dd-sheet`, `.dd-scrim`); checked on Email > a thread's snooze menu |
| Phone search from the title | A tap on the top bar's title opens the page search (the same field the search icon opens, typing into the page's own box) | `PallavShell.tsx` dispatches `hms:phone-search`; `PhoneSearch.tsx` listens |

Test on a phone (or DevTools at 360 x 780 with touch): open a reservation from the list (slides in from the right), press Back (slides in from the left), tap a menu entry (fades). Scroll down a long list: the bottom bar slips away; scroll up a little: it returns. At the top of Reservations pull down: the ring follows the finger and turns into a spinner, the list reloads (the slim progress line at the very top runs), nothing blanks. Tap the page title: the search field opens over the bar. On Email open a thread and tap the clock (snooze): a bottom sheet with the three times. Swipe sideways on any page: nothing moves.

## 4. Brand

- `public/brand/logo-day.svg` (charcoal and gold) and `logo-night.svg` (gold) are the full logos; `mark-day.svg` and `mark-night.svg` are their building marks (the `#building-icon` group cut out).
- Dashboard rail: the building mark alone in the 40 px logo square, the day file by day and the night file by night (`html[data-theme]`); the hotel's own name stays the brand text. The name and the line under it sit tight everywhere the shell stacks that pair (rail brand, top bar title block, person chips): 15 px bold over 11.5 px muted, line height 1.15, 1 px apart.
- Sign-in banner, the signed-in app bar and the public website header and footer: the full logo (`components/BrandLogo.tsx`), the night file when the device is in dark mode, cropped to its artwork by CSS (`globals.css .hms-brand-logo`).
- Known: in both logo files the word "Hotel Solutions" is drawn past the file's own `viewBox` (day: the text ends at x 1870 in a 1785 wide box), so the browser cuts the last letter. That is in the source files, not in the page; a wider `viewBox` in the files fixes it everywhere at once.

## Checks run

- `npx tsc --noEmit -p web-app/tsconfig.json`: no errors in any touched file (the project has other errors; not mine).
- `cd web-app && npm run check:shared`: total 131 before and after; none in a touched file (all pre-existing in conversations, platform, admin and portal screens, `opengraph-image.tsx`, `ui-kit.css`).
- `npx eslint` on every touched TSX file: clean.
- `npm run pallav:css` after each edit of `hms-overrides.css`; `VERSION` in `assets.ts` 40 -> 44.
- Headless Chrome (the Playwright Chromium already on the machine, driven over CDP) against the running dev server at :3100 in demo mode: the checks named above, screenshots kept outside the repository.

## Not done, on purpose

- No service worker, no offline cache, no push.
- No Apple start-up images.
- No swipe-from-the-edge Back gesture (the browser's own gesture does it in the installed app).
- Tablet panes only for the two Front Office lists; Conversations already had them, Bills have no detail page. Other lists (Companies, Platform hotels) can be added to `PANE_LISTS` when their detail pages are wanted side by side.
- The row-action bottom sheet covers the kit `Dropdown`; the top bar's user and year menus keep their menus.
- The logo files were used as given (not re-drawn); the clipped last letter is theirs.
