# Order: Company (corporate) portal redesign + multi-hotel portals (decision 48, MJ, 12 Oct 2026)
UPDATING ONLY, NO TESTING (MJ: zero testing for now; commit message "tests not run, per MJ"). Backend does the server, UI the screens; different files, no overlap. Agree the route and field names by message, Backend publishes the contract in its first commit message or docs/BACKEND.md so UI can follow.

## What MJ wants (company portal)
1. REMOVE the Teams and Users pages: one login per company only.
2. COMPANY PROFILE: the company can update its information (name of contact person, address, city, state, pincode, email, mobile, phone, GST number, extra contacts), but NOT the price and percentages (discount %, GST %, TCS %, TDS %): those show read-only ("set by the hotel") and only the hotel changes them in its own Companies screen.
3. MY PROFILE: show the user's profile details like the Super Admin user's profile page (one person: display name, username, email, mobile, change password, theme, last sign-in, the sign-in code switch). Reuse that same screen/component.
4. REMOVE "Book room" (menu, page, routes' use).
5. ACCOUNTS group with three pages, named: **Due bills** (open bills with a balance, the better name for what was "bills due"), **Payment history** (payments and advances received), **Ledger** (running statement: date, what, debit, credit, balance). ALL THREE use the same design as the Handover page: a list where each row opens a drop-down with its detail, built from the shared kit (reuse the Handover list/dropdown components, tabs, tokens, search, pager). Consistency is the point.
6. DASHBOARD: calmer and more useful, not overwhelming: a few clear cards (total due, last payment, bills this month, credit/advance), one short "needs attention" list (oldest due bills), recent payments, and nothing noisy. REMOVE every direct pay button/CTA from the dashboard (paying stays only where the bill is opened).
7. HOTEL SELECTOR in the sidebar, same pattern as the Payroll company selector: default "All hotels"; the person picks one hotel and EVERY page refreshes for that hotel only. A company (and a guest) can be linked to several hotels, so the portal must be multi-hotel. Same for the GUEST portal.

## Backend [f948b5] (server)
1. Multi-hotel scope: a portal login may have several rows in platform.user_hotels (one per hotel, each with its own subject_kind/subject_id = that hotel's company/guest record). New `GET /corporate/hotels` and `GET /guest/hotels` -> `[{ hotelId, name }]` of the hotels this login is linked to (active ones). Every corporate and guest data route accepts `?hotel=<hotelId>|all` (default `all`): `all` runs the read in each linked hotel's schema and MERGES the rows (each row carries `hotelId` and `hotelName`; sort by date; totals summed per currency/hotel as the screen needs); a hotel the person is not linked to = 403/404. Keep it fast (parallel reads, limit per hotel).
2. Corporate routes: remove Teams/Users routes and their services (or answer 404/410 and mark them removed); remove Book room routes; add `GET/PUT /corporate/profile` where PUT accepts ONLY the editable contact fields (strict schema: discount/gst/tcs/tds in the body = 422), with `?hotel=` required for PUT (the company edits its record in one hotel at a time; GET returns the read-only price/percent fields with a flag `setByHotel: true`); `GET /corporate/accounts/due-bills`, `/payment-history`, `/ledger` (paged, search, `hotel` filter, rows shaped for a drop-down: a header line + a `detail` block); `GET /corporate/dashboard` reshaped for the calm dashboard (cards + attention list + recent payments, no pay links).
3. My profile for portal accounts: the same profile routes a hotel user has (name, username, email, mobile, password change, theme, sign-in code), for guest and corporate accounts too.
4. Hotel side: the hotel keeps full control of price/percent fields (Companies screen) — unchanged.
5. docs/BACKEND.md: the contract. Local commit, hash to me.

## UI [be5337] (screens)
1. Company portal sidebar: remove Teams, Users and Book room; groups: Dashboard, Accounts (Due bills, Payment history, Ledger), Company profile, My profile (+ whatever bills/stays pages exist today stay unless MJ said otherwise). Remove the pages and their copy.
2. Hotel selector at the top of the sidebar (reuse the Payroll company selector component/pattern exactly): "All hotels" default, then the linked hotels; the choice is remembered for the session and is passed as `?hotel=` to every call; every page reloads for it; show the hotel name on rows when "All hotels" is selected. Same selector in the Guest portal.
3. Accounts pages: Due bills, Payment history, Ledger, each using the SAME list + drop-down component and layout as Handover (shared kit; no new one-off CSS), with search, filters/tabs as Handover has, pager, mobile layout, empty states.
4. Company profile page: editable contact fields; the price/percent block read-only with the note "Set by the hotel. Ask the hotel to change them."; Save with the shared kit's form pattern.
5. My profile for the company login: reuse the Super Admin profile screen component (one person's details).
6. Dashboard: rebuild as described (cards, attention list, recent payments), no pay buttons/CTAs, calm spacing, day and night, 390 px.
7. Mock mode with two or three hotels so the selector shows. UI.md updated. Local commit, hash to me.

## d7 [1a94a6]
Docs later, after both parts are in. Nothing now.
