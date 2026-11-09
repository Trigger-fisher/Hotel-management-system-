# Live site check after a deployment (R39, 12 Oct 2026)

For MJ or the Project Manager, in a normal browser (not private), on https://www.easyhotelsolutions.in. About 15 minutes. Write PASS or FAIL and one line of what you saw next to each step. Never paste a password, a sign-in code or a cookie value into a chat or a file.
Accounts: usernames only here; the passwords are the ones MJ chose (the temporary ones for dev are in `db/.dev-login.txt` on the PC, which is not the live site). Use one account of each kind that exists on the live site: Super Admin (`mj.super`), Hotel Admin with the Super Admin level (`mj.hoteladmin`), a hotel user, a guest account, a company account, and a platform admin or group admin if you made them.

## 0. Before you start
1. Open the site in a fresh window. Expect the sign-in page with the HMS look, and `https://` with the padlock.
2. Open `https://www.easyhotelsolutions.in/api/v1/health` : expect `ok`. Open `.../api/v1/health/ready` : expect `ok` for the database (a 503 right after a quiet spell is Neon waking up: reload once).

## 1. The sign-in cookie (browser developer tools: F12 > Application (Chrome) / Storage (Firefox) > Cookies > the site)
1. Before signing in there is NO cookie called `__Host-hms_session`.
2. Sign in as `mj.hoteladmin` (if the emailed code is switched on for the account, enter the code; by default it is off).
3. After signing in there is exactly ONE cookie `__Host-hms_session` with: Path `/`, HttpOnly ticked, Secure ticked, SameSite `Lax`, no Domain, and NO expiry date (it is a session cookie). The session token itself is not in Local Storage or Session Storage (a remembered page name may be).
4. In the Console type `document.cookie`: it must NOT show `__Host-hms_session` (HttpOnly hides it).
5. Sign out: the cookie is gone and the sign-in page shows.

## 2. Refresh behaviour (decision 49), for each role in section 3
For each role, sign in, then:
1. Open a page that is not the dashboard (for a hotel admin: Front Office > Rooms; for a guest: Bills; for a company: Ledger) and press F5. Expect: NO sign-in page, not even a flash, and the SAME page.
2. Press Ctrl+Shift+R. The browser does not tell the page it is a hard reload, so it behaves like F5: the same page (this is expected).
3. Open the site in a NEW tab (typed address): expect the dashboard of that role, still signed in (the cookie is shared by the tabs).
4. Close all tabs of the site, open the site again: you are still signed in (the session lasts 2 hours of no activity) and you land on the dashboard.
5. Sign out in one tab, then press F5 in another: the sign-in page shows.

## 3. One session per role (what each person must see)
| Role | Sign in with | Expect after sign-in | Must NOT see |
|---|---|---|---|
| Super Admin | `mj.super` | the Platform console (Hotels, Groups and the other console pages) | any hotel menu |
| Platform Admin / Group Hotel Admin | their accounts | the console / the group portal | other groups' hotels |
| Hotel Admin with Super Admin level | `mj.hoteladmin` | the hotel dashboard, Settings, Recycle bin | the Platform console |
| Hotel user | a hotel user | only the menus its role allows | Settings of the hotel, Platform |
| Guest | a guest account | Dashboard, Bills, History, Order to room, My profile | "Book a room", "People with me", a header search box |
| Company | a company account | Dashboard, Accounts (Due bills, Payment history, Ledger), Company profile | "Team", "Book a room", a pay button on the dashboard |
For EACH role also check:
1. Only ONE browser session at a time per person: sign in as the same account in a second browser; the first browser is signed out at its next click and shows the sign-in page.
2. A guest or company account that is not linked to a record shows the friendly "Your account is not set up yet" page, never "Not allowed".
3. The hotel selector (guest and company with more than one hotel) filters every list and the dashboard; "All" is the default.
4. Lists show the NEWEST first and have their own search bar; the header has no search box.

## 4. Hotel website handoff (only if a hotel website is live)
1. In the hotel (as `mj.hoteladmin`): Website > Settings: note the Sign in address shown (`https://www.easyhotelsolutions.in/?hotel=<slug>`), tick Website live and add the website domain.
2. Open that address signed out: the sign-in page says "Sign in to <hotel name>".
3. Sign in with an account linked to that hotel: you land in that hotel. Sign in with an account linked only to another hotel: you land in your own hotel as usual and nothing breaks.
4. Open `https://www.easyhotelsolutions.in/api/v1/public/hotels/<slug>/brand`: JSON with the hotel name. With the switch off it answers 404.

## 5. If something fails
Note the time, the role, the page and the exact sentence on the screen; copy the `traceId` if the page shows one. Tell the Project Manager. Do not retry with a password more than three times (the account locks after five wrong tries).