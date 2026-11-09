# Portal: "All hotels" view for companies and guests (PM, 18 Oct 2026)

MJ (screenshot of the portal sidebar card "HOTEL / Hotel Demo"): add an option like the Payroll company switcher so that a company that works with several hotels can see the bills of ALL its hotels together, or filter to one hotel. Several hotels send invoices to the same company.

## Behaviour
- The hotel card in the portal sidebar (and the phone hotel bar / popover) gets a first entry **All hotels** (default when the account is linked to 2+ hotels; with one hotel nothing changes). Choosing one hotel filters everything to it, as today.
- Pages that become cross-hotel in "All hotels": Dashboard totals, Due bills, Bills / Payment history, Stays, Accounts / Statements, Notifications. Each list gets a **Hotel** column (a pill on phones) and a Hotel filter chip (same filter pattern as the other lists); totals show per hotel and overall.
- Opening a row opens it in that hotel's context (the bill, the stay); paying stays per hotel (a bill is paid to its own hotel). No "pay several bills" (online payments are out of scope).
- The choice is remembered per account (client store) and shown in the URL query (?hotel=<slug>) so a link keeps the filter.
- Company profile (Company > Company profile): one profile per hotel relationship; in "All hotels" it shows the company's details with a table "Hotels you work with" (hotel, since, outstanding), and each hotel row opens that hotel's profile view.

## Backend (B)
- Hotels live in separate schemas, so a cross-hotel read loops over the hotels the portal account is linked to (platform.user_hotels / the company's links) and runs each hotel's query in ITS OWN scoped transaction (RLS company scope per hotel, exactly as 0035); results are merged in the service with hotel id + name on every row. Never one query across schemas; never a hotel the account is not linked to; no IDs of other hotels' data leak.
- Cap and speed: at most N linked hotels per call (e.g. 25), queries in parallel with a small concurrency, a hotel that fails is reported as "unavailable" in the answer (partial result), not a 500. Paging across hotels: keyset by (date, hotel, id) with a per-hotel limit, merged.
- API: the existing portal routes take `hotel=all|<hotel id>`; answers carry `hotel: { id, name }` per row and `hotels` totals. A portal summary route returns the linked hotels for the selector (id, name, outstanding, unread).
- Same for guests (guest account linked to several hotels), built once.
- Tests: two/three hotels, a company linked to 2 of 3, a failing hotel, IDOR (a company cannot see a hotel it is not linked to), paging order, totals.

## Frontend (C)
- Selector entry "All hotels" in sidebar card, popover and phone hotel bar; Hotel column/pill and filter chip on the lists above; totals by hotel; company profile "Hotels you work with" table; empty/loading/error states; mock data with 3 hotels; phone friendly; existing look.

## Order
After Notifications and the My-profile removal: 1. B contract + backend, 2. C UI, 3. d3 QA (company + guest portals at 390 and 1280, two hotels), 4. Neon SQL only if a migration is needed (none expected: the links exist).
