# MJ's update list (started 12 Oct 2026, kept by Project Manager 2)
Each item gets a decision number, an order, an owner and a state. Newest at the bottom.

| # | Update | Decision | Order | Owner | State |
|---|---|---|---|---|---|
| 1 | Emailed sign-in code optional for every account (default off, a person may switch it on) | 46 | ORDER-OPTIONAL-SIGNIN-CODE.md | Backend + UI | ordered 12 Oct |

Earlier updates of MJ (11 Oct), added to this list from `git log` and `docs/DECISIONS.md` on 12 Oct so the list is complete (state = what is in main; none has been run on the real Pathik site):

| # | Update | Decision | Order | Owner | State |
|---|---|---|---|---|---|
| 2 | Pathik "In Pathik now": the guests Pathik shows as active, kept only while active (replaced every read, 24 h stale), with a drop-down detail (contact, email, address, check-in and check-out, document type, room, serial, Copy details) | 41, 42 | ORDER-PATHIK-ACTIVE-LIST.md, ORDER-PATHIK-ACTIVE-DETAIL.md | Backend, Pathik Backend, Pathik UI | built (hotel migrations 0026, 0027); live check on the real Pathik pending MJ's go |
| 3 | Pathik active list encrypted at rest (name, contact, email, address sealed with the vault key) | 43 | ORDER-PATHIK-ACTIVE-DETAIL.md | Backend | built (0027) |
| 4 | Pathik "Refresh now": a button that asks the running worker for a new read now (worker polls every 20 s, 30 s floor per hotel; the kept list is replaced, not deleted) | 44, 45 | ORDER-PATHIK-REFRESH-NOW.md | Backend, Pathik Backend, Pathik UI | built (migration 0028); to be tried by MJ with the worker left running |
| 5 | Pathik check interval chosen in Settings (5, 10, 15, 30 or 60 minutes, default 15) | 45 | ORDER-PATHIK-REFRESH-NOW.md | Backend, Pathik UI, Pathik Backend | built (0028) |
| 6 | Pathik demo mode: the worker fills the Add Guest form and stops at Submit for a person to press it; optional key-by-key typing for the client (`PATHIK_MANUAL_SUBMIT`, `PATHIK_DEMO_TYPING_MS`) | 44 addendum | ORDER-PATHIK-REFRESH-NOW.md | Pathik Backend | built |
| 7 | Hosting for testing: Vercel Hobby + Neon free at https://www.easyhotelsolutions.in, mail by Gmail and cron-job.org; go-live later on Vercel Pro or a VPS | 39 | - | MJ, Backend | database made by the SQL parts, later hotel migrations and accounts by SQL (as MJ reported); photo bucket, Deployment Protection off, apex-to-www redirect still open (`docs/deploy/NEON-GO-LIVE.md`) |
| 8 | Guest, Company and Employee portals understandable: a friendly 'not linked' page instead of 'Not allowed', a way for the hotel to link an account to its record, plain help text and empty states | 47 | ORDER-PORTALS-UNDERSTANDABLE.md | Backend (server), UI (screens) | ordered 12 Oct |
| 9 | Company portal redesign (one login per company, no Teams/Users/Book room, editable company contact info but not prices, My profile like Super Admin, Accounts = Due bills / Payment history / Ledger in the Handover design, calmer dashboard without pay buttons) and multi-hotel selector in the sidebar for Company and Guest portals | 48 | ORDER-CORPORATE-PORTAL.md | Backend (server), UI (screens) | ordered 12 Oct |
| 10 | Refresh keeps the session and the same page for every role; a new visit goes to the dashboard | 49 | ORDER-REFRESH-KEEPS-PAGE.md | UI (client), Backend (session cookie check) | ordered 12 Oct |
| 11 | Header search removed everywhere; every list page has its own search bar, same capability and position as Handover | 51 | ORDER-PAGE-SEARCH.md | d7 (audit), UI (screens), Backend (routes) | ordered 12 Oct |
| 12 | Guest portal redesign: read-only profile, no Book a room, hotel selector, Bills (all) and History (payments) in the company design, latest first on every list, room service only while staying with schedule and hotel-set restaurant hours, Add member with ID scan (OCR) and rejection limits, persons on every bill | 52 | ORDER-GUEST-PORTAL.md | Backend, UI, d7 (OCR options) | ordered 12 Oct; Add member part removed by decision 59 |
| 13 | Mobile layout of the Guest and Company portals from the eTrafficEYE mobile structure, in HMS's theme, mobile only | 53 | ORDER-PORTAL-MOBILE.md | UI | ordered 12 Oct |
| 14 | Page search on every list page (UI: component and header search removed; remaining pages in progress) | 51 | ORDER-PAGE-SEARCH.md | UI, Backend | in progress |
| 15 | Data: no 'hotel super' account: mj.hotelsuper removed, mj.hoteladmin gets the Super Admin level | 53 | (SQL given to MJ) | PM | SQL given 12 Oct |
| 16 | One top-level pathik/ folder (worker and docs moved), a python/ folder for future Python services (OCR), and a per-hotel Pathik Submit setting (Automatic or Manual, default Manual) | 54 | ORDER-PATHIK-FOLDER-AND-SUBMIT-MODE.md | d7 (move), Backend (0029), UI (setting), PM (python/) | ordered 12 Oct |
| 17 | Hotel websites hosted separately and managed from HMS: public API, Sign in button handing off to HMS with the hotel in the address, that hotel the default for the session only; direct sign-in shows all | 55 | ORDER-HOTEL-WEBSITE-CONNECT.md | d7 (design), Backend, UI, later a website template | ordered 12 Oct |
