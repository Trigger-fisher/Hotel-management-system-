# HMS as a SaaS product: improvement plan (13 Oct 2026, for MJ's review)

Written after today's work (reload shell, image compression, per-hotel mail) and a walk through every dashboard in the demo build, plus a look at what
small and mid-size hotels in India buy today (Hotelogix, eZee, Stayflexi, Clock, MyHotelLine: cloud-first, GST-correct billing, OTA dependence, lean
teams, mobile-first staff, contactless guests). Nothing below is built yet. Each item says what it is, who it helps, why, and a rough size
(S = a day, M = two to four days, L = a week or more). Tick what you want; the order of the phases at the end is my recommendation.

## 1. The product in one line, and who uses it

| User | Where | What they must get done fast |
|---|---|---|
| Front desk staff | Hotel dashboard, all day, often on a phone | check a guest in, take money, hand the shift over, answer "which rooms are free tonight" |
| Hotel owner / manager (Hotel Admin) | Hotel dashboard, a few times a day | "how did we do today", who owes us, approve, set prices, staff and payroll |
| Accountant / cashier | Cash, Bills, Ledger, Payroll | record, reconcile, print, month end |
| Guest | Guest portal on a phone | see the bill, pay, order to the room, get the receipt |
| Company travel desk | Company portal | due bills, pay, statement |
| Group Hotel Admin | Group console | the same numbers across hotels |
| Platform (you) | Platform console | onboard hotels, keep them healthy, see usage |

The product is strongest where it came from (Pallav's cash discipline: deposits, handovers, bills, ledgers, payroll). It is weakest where a hotel
decides whether to buy: the first ten minutes (onboarding), the front desk's daily rhythm (rooms, housekeeping, arrivals), and reporting.

## 2. Design consistency: one system, every page, every user

What is inconsistent today (seen in the walk): three generations of screens live side by side (Pallav's Blade ports, the newer kit screens, the
portal redesign). Page heads differ (some have a subtitle line, some none), tiles differ (kpi, stat, pt-stat), the empty state is a plain
sentence on some lists and a card with a button on others, filters are a row on some pages and a "Narrow down" fold on others, phones get a drawer
on the hotel side and a bottom bar on the portals, and the forms validate at different moments.

**The rule:** one page anatomy, one set of parts, one behaviour per situation, for every role. Written into `docs/UI.md` as the contract, enforced by
`check:shared` where a rule can be read from the code.

| # | Rule (S each unless marked) | Pages it touches |
|---|---|---|
| D1 | **Page head**: eyebrow (section) + title + one-line "what this page is for" + the primary action on the right. Always. No page without the sentence. | every screen (about 60) |
| D2 | **Tiles**: one `Kpi` part (icon, label, value, note, optional trend); 4 on desktop, 2 on phones, 1 only under 360 px. Remove the other tile styles. | dashboards, lists with summaries |
| D3 | **Lists**: search box, "Narrow down" filters, latest first, the row opens a detail panel (same drawer on every page), pager at the bottom, 25 rows, `Pager server` everywhere. One `ListPage` part. (M) | the 84 list pages in SEARCH-AUDIT.md |
| D4 | **Empty, loading, error**: `EmptyState` with an icon, a sentence and the next step button; skeleton only on the first load (done, R48); error card with "try again". The same three parts everywhere. | every list and detail |
| D5 | **Forms**: labels above, required marked, inline check on blur, errors next to the box AND a summary at the top, Save + Cancel always at the same place (sticky footer on phones), unsaved-changes guard on leave. One `FormPage` part. (M) | every create/edit form |
| D6 | **Dialogs**: confirm = short title, one sentence, the destructive button red and named ("Delete bill", never "OK"); bottom sheet on phones. | every delete/refund/cancel |
| D7 | **Money and dates**: `₹1,23,456.00`, dates `12 Oct 2026`, times `2:30 pm` (IST), relative "2 h ago" only in logs. One formatter, used everywhere (half the pages already do). | lists, tiles, PDFs |
| D8 | **Status words and colours**: one vocabulary (Paid, Due, Overdue, Cancelled, Refunded; Vacant, Occupied, Needs cleaning, Out of order) with the same badge colour on every page and in both themes. | bills, rooms, enquiries, invitations |
| D9 | **Buttons**: primary (one per page head), secondary, ghost, danger. Icons always on the left. No custom button markup in screens. | all |
| D10 | **Phones**: the hotel dashboard gets the portals' pattern: bottom bar with the 4 most used entries + "More", sticky page head, cards instead of tables beyond 4 columns, 44 px targets. (Your session C's uncommitted work covers most of this.) (M) | hotel, platform, group on phones |
| D11 | **Night mode parity**: every new part has its night tokens; the audit tool (`pm-dashboard/tools/mobile-audit.mjs`) runs light and dark on every page in CI. | all |
| D12 | **Accessibility**: 4.5:1 text contrast (your 11 Oct audit), focus rings, keyboard order, `aria-live` for toasts, screen-reader names on icon buttons. Part of the checklist in UI.md §10. | all |

## 3. Upgrades to what exists (by dashboard)

### Hotel dashboard (front desk, manager, cashier)
| # | Upgrade | Why | Size |
|---|---|---|---|
| H1 | **Today board** on the Dashboard: arrivals, departures, in-house count, rooms to clean, cash in the drawer, open bills, pending Pathik — each tile opens its list filtered. Replace the current "shift first" layout for front desk roles; the manager keeps the money tiles. | the first screen must answer "what do I do now" | M |
| H2 | **Front Desk room board**: colour by status, tap a room = card with guest, nights, balance and the three actions (check out, add charge, move room); drag to move is not needed. Add **housekeeping status** (clean / dirty / inspecting) with a one-tap toggle and a "rooms to clean" list for housekeeping staff. | the most used screen of any PMS; housekeeping is missing entirely | L |
| H3 | **Check-in in one screen**: guest, ID photo (phone camera), room, plan, advance, members; Pathik fields filled from the same form; the printable registration card. Today it is spread over check-in, members and Pathik details. | fewer clicks for the commonest job | M |
| H4 | **Check-out = bill**: a "Check out" button on the room that opens the bill with the stay charges pre-posted, GST split hotel/food, settle (cash/UPI/card/company), print/PDF/email in one flow. | the second commonest job | M |
| H5 | **Reservations calendar** (rooms × days, drag to extend, colour by status) with a "free tonight" quick answer and overbooking refusal. | staff think in a grid, not a list | L |
| H6 | **Bills & Advances**: inline "Pay ›" from the list, part payments with the remaining shown, refund with reason, share by email (hotel's own sender, done today) and a WhatsApp-free "copy link" to the guest's portal bill. | fewer clicks, fewer disputes | M |
| H7 | **Cash**: Shift Handover with a denomination counter (notes × count) and variance vs system cash; "Record deposit/expense" as a bottom sheet from any page. | cashiers count notes; variance is the point of a handover | S |
| H8 | **Reports**: Daily Report, Food Plan, Revenue by month, Occupancy % and ADR (average rate), Company ageing (30/60/90), GST summary (GSTR-1 ready CSV) — one Reports page, each with date range, PDF and CSV. | owners ask for occupancy/ADR; accountants need GST exports | M |
| H9 | **Rates**: seasons and weekday/weekend prices per plan, extra-person price, a "what will room 204 cost for 3 nights from Friday" preview on the reservation form. | plan rates per date exist; seasons do not | M |
| H10 | **Notifications in the app**: a bell with "3 handovers waiting, 2 bills overdue, Pathik needs attention", per role; optional daily summary email to the owner at 9 pm (hotel's own sender). | owners want the summary without opening the app | M |
| H11 | **Users & roles**: role templates (Front desk, Cashier, Housekeeping, Manager, Accountant) to pick at invite, "what can this person see" preview, last-seen per user. | onboarding staff takes minutes, not an afternoon | S |
| H12 | **Settings**: a guided "Set up your hotel" that is also the Settings home: hotel profile, GST, rooms & types, plans & rates, staff, mail (test button, done), Pathik, website. Progress shown; each card opens the real page. | the checklist exists for new hotels; make it the settings map for everyone | S |

### Guest portal
| # | Upgrade | Size |
|---|---|---|
| G1 | **Pay** really working: Razorpay checkout from the bill (per business), receipt PDF after, "paid" lands on the hotel's bill in seconds (webhook). The Razorpay skeleton exists. | L |
| G2 | **Stay card** on the dashboard: room, nights left, check-out time, "Extend my stay" request, "Need something?" (towels, water, late check-out) that creates a hotel request. | M |
| G3 | Order to room: item photos (compressed, done today), "my usual", order status (received / preparing / on the way), estimated time from the hotel's setting. | M |
| G4 | One-tap sign-in link by email (magic link) for guests who forget the password. | S |

### Company portal
| # | Upgrade | Size |
|---|---|---|
| C1 | Statement download for any period (PDF + CSV), with GST; "Pay several bills together" (Razorpay) and a remittance note the hotel sees. | M |
| C2 | Multiple hotels of one group in one statement; per-hotel ageing on the dashboard. | S |
| C3 | Credit limit and "approval needed above ₹X" shown to the company and enforced at check-in on the hotel side. | M |

### Platform console (you) and Group console
| # | Upgrade | Size |
|---|---|---|
| P1 | **Health per hotel**: last sign-in, bills this month, mail failures, Pathik backlog, storage used, database size; a red/amber/green row. | M |
| P2 | **Plans & billing for the SaaS itself**: Free / Standard / Pro per hotel, room count, trial end, invoice to the hotel (Razorpay), "suspended for non-payment" state (the lifecycle already exists). | L |
| P3 | **Onboarding in 10 minutes**: invitation → form → approval → "Set up your hotel" with sample data toggle ("load 10 demo rooms and 5 demo bills" that can be wiped). | M |
| P4 | Announcements: a message every hotel admin sees on the dashboard once (maintenance, new feature). | S |
| P5 | Group console: consolidated P&L, occupancy and cash across hotels, export. | M |

## 4. New features (not in the system today)

| # | Feature | Who asks for it | Size | Notes |
|---|---|---|---|---|
| N1 | **Housekeeping** (room status, task list, inspection, lost & found) | every hotel with more than 10 rooms | L | part of H2 |
| N2 | **Online booking engine on the hotel website** (availability from Reservations, rates from H9, advance by Razorpay) | hotels that pay OTA commissions | L | the public website API exists; this turns enquiries into bookings |
| N3 | **Channel manager connection** (MakeMyTrip/Goibibo, Booking.com, Agoda via a connector such as eZee Centrix or Staah: two-way rates, availability, bookings) | hotels on OTAs (most of them) | L | integration work, not UI; decide the partner first |
| N4 | **Night audit**: an end-of-day run that posts room charges for every in-house stay, closes the day, locks edits (force mode to reopen), produces the Daily Report | accountants, owners | M | the "accounting day" concept exists in Books |
| N5 | **Guest profiles & history**: one guest across stays, preferences, ID on file (compressed, private store), "returning guest" badge at check-in, birthday/anniversary list | front desk, marketing | M | Customers exists; link it to stays |
| N6 | **Inventory & purchases (light)**: stock items, purchase entries, consumption per day, low-stock alert; feeds Expenses | restaurants, housekeeping stores | L | |
| N7 | **Maintenance tickets**: room out of order with reason, assigned, due, photo; blocks the room on the board | all | S | |
| N8 | **Document templates**: registration card, GST invoice, receipt, letters — editable header/footer per hotel, logo, signature, terms | all | M | pdfkit exists |
| N9 | **Audit trail viewer** per record ("who changed this bill and when") from the detail panel | owners, disputes | S | the log rows exist |
| N10 | **Data export & backups** the hotel can run: "download all my data" (CSV zip) and the nightly backup for real (the Backup tab is a stub) | trust, compliance | M | |
| N11 | **Two languages in the UI** (English, Gujarati; Hindi later): a language switch per user, staff-facing pages first | staff in Gujarat | L | copy already lives in `ui-shared` |
| N12 | **Phone app wrapper** (PWA: install to home screen, offline read of today's board, camera for ID) | front desk, housekeeping | M | no store app needed |
| N13 | **WhatsApp**: kept out on your decision (R47). An SMS/e-mail alternative for guest receipts is covered by the hotel's own mail. | | | |

## 5. Under the hood (needed for the above and for 10,000 users)

| # | Item | Size |
|---|---|---|
| T1 | Connection pool sized for Vercel + Neon (small pool per function, pooled address), measured with a load test (k6) on the live URL; publish the numbers. | S |
| T2 | Short caches for session, permission catalog and hotel settings (30–60 s); ETag on list reads. | S |
| T3 | Prefetch the dashboard chunk from the sign-in page so a reload is near-instant after today's outline. | S |
| T4 | Photos served with long cache headers through a signed route + thumbnails at upload. | S |
| T5 | Error alerts (Sentry/Axiom free tier) on the logger; uptime check on `/health`. | S |
| T6 | Nightly backup of Neon to object storage, restore drill documented. | M |
| T7 | Pin Node 22.x; make the two flaky tests deterministic; run the headless UI audit in CI. | S |
| T8 | Row-level security as a second fence inside each hotel schema for the tables the portals read (guest/company rows). | M |

## 6. Recommended order

**Phase 1, consistency (2 weeks): D1–D12, H12, H11, T7.** No new tables; every page gets the same anatomy; phones fixed on the hotel side. Visible
on day one to every user, low risk, and it is the base the rest is built on.

**Phase 2, the front desk day (3–4 weeks): H1, H2 (+N1, N7), H3, H4, H7, N4, N9.** This is what a hotel compares with eZee/Hotelogix in a demo.

**Phase 3, money (3 weeks): G1, C1, H6, H8, N8, T1–T6.** Payments that really settle, reports owners ask for, and the production safety items.

**Phase 4, growth (4+ weeks): P2, P3, N2, N3, H9, H5, N5, P1.** Selling the product: plans, bookings from the website, OTA connection, onboarding.

Later: N6, N11, N12, C3, P5, T8.

## 7. Done so far (13 Oct, all on `main`)

| Item | State |
|---|---|
| T1 pool on Vercel, T2 session cache, T3 chunk prefetch, T4 admin photos cached, T5 alert webhook, T7 Node 22 + deterministic tests | done |
| H1 Front desk today row on the dashboard | done (arriving, leaving, in house + rooms ready, rooms to clean; only for people with the Front Office) |
| H8 Occupancy report (occupancy %, ADR, RevPAR per night and month, CSV) | done (`hotel.reports.occupancy`) |
| H10 Notification bell | done (every hotel page; departures due, Pathik needing staff, no handover, open salaries, arrivals, rooms to clean, empty cash book) |
| H11 Role templates (Front Desk, Cashier, Housekeeping, Manager, Accountant) | done (Roles > Add role > Start from) |
| D10 phone tiles two by two on every dashboard | done |
| C1 statement CSV beside the PDF (any period, the same rows and limits) | done; "Pay several bills together" waits on Razorpay (G1) |
| H8 company ageing (0-30 / 31-60 / 61-90 / over 90 days) on the Company Ledger, with CSV | done |
| H8 GST summary (Reports > GST Summary: per bill taxable and GST, hotel/food, B2B/B2C, GSTR-1 CSV) | done |
| H10 daily summary email to the owner at 9 pm through the hotel's own sender (Settings > Email > Daily summary to; needs Neon SQL 0119) | done |
| P4 announcements: the Super Admin publishes a message every hotel admin (or everyone) sees on the dashboard until dismissed (Platform console > Announcements; needs Neon SQL 0120) | done |
| H12 Settings as a map: eight areas with their state and a link to the page (Settings, top) | done; the new-hotel checklist stays as it is |
| G2 "Need something?" on the guest home (towels, water, cleaning, late check-out, extend my stay, something else) reaching Front Office > Guest Requests and the bell; needs Neon SQL 0031 | done; the stay card itself was already there |
| P1 health per hotel: last activity and a "quiet for 14 days" flag; a hotel's own mail server failing is flagged; the Pathik backlog and last run per hotel, the guest bills of the month per hotel (count and total; 13 Oct, session 2); storage per hotel (what its tables take on disk, under the Database cell) and the last nightly backup with its age (13 Oct, session 3) | done; a red/amber/green row is the status pill (Healthy / Needs attention / Down) |
| N9 audit trail from the record: "History" inside a bill's and an advance's card (who changed it, when, what), per the person's own grants | done: bills, advances, company profiles, customers (session 2), reservations, stays (the guest card) and staff (a History button on every row; the lines come from the Payroll Log; 13 Oct, session 3). Hotel migration 0034 indexes both logs by record (needs Neon SQL 0034) |
| G3 guest ordering: the "When should it reach you?" choices left-aligned in plain words (they drew right-aligned and uppercase inside the form block) | done (13 Oct, session 3); item photos, "my usual" and order status stay open |
| Small things from the per-role audit (session 3): a long KPI note on the hotel dashboard wraps instead of ending in dots; the Group dashboard's second tile row is two half-width tiles; both portals show money with paise (D7; the guest portal showed whole rupees); "Recent activity" titles on the payroll and group dashboards wrap to two lines; the Email Marketing card gives the campaign column its room | done |
| Already in the system before the plan (found while building): housekeeping clean/dirty with a one-tap toggle and out-of-order rooms (N1/N7 in part), the handover denomination counter (H7), the setup checklist (H12 in part), the per-record system log (N9 in part) | - |
| T6 backups: `db:cli backup` and `restore-check` exist and are documented (`docs/OPERATIONS.md` section 4); Neon keeps its own point-in-time history. The scheduled copy to object storage is built (13 Oct, session 3): `/api/v1/cron/backup` nightly at 02:00 IST copies every live hotel's records (the Super Admin export format, gzip) into the private bucket under `backups/<hotel>/`, records each run in `platform.hotel_backups` (needs Neon SQL 0122), keeps 14 daily copies and the Sunday copy for 8 weeks, and Platform health's "Last backup" column reads it; `db:cli backup-check` is the read-back drill; loading one hotel back is documented as a manual procedure (`docs/OPERATIONS.md` 4a) | done |
| T8 row-level security as the portals' second fence (hotel migration 0035: policies on customers, company profiles, bills, advances, stays, reservations, charges and guest requests read the transaction's `hms.scope_kind` / `hms.scope_id`, which withHotel sets for a guest or company account; staff and the workers pass untouched) | done in code (13 Oct, session 3); needs Neon SQL 0035 after 0034, and `npm run test:db` on the dev database first (`tests/db/portalRls.test.ts` was written here without a PostgreSQL to run it) |
| H6 Bills: a Pay button on every due or part-paid row opens the settle pop-up without opening the card; part payments: a settlement that leaves money owing shows as "Part paid · balance due" and takes further payments (five instalments in all) until cleared; the pop-up shows what was already received and keeps the reference | done (13 Oct, session 3); refund with reason and the guest's "copy link" stay open |
| T2 ETags on list reads: 77 staff and platform list and report GETs answer with a weak ETag and `private, no-cache`, and 304 to a matching If-None-Match; the portals, My Profile, Pathik, search and settings stay `no-store` | done (13 Oct, session 3; `docs/BACKEND.md` 6.1) |
| Phase 2 to 4 | open |
| Reload: the sidebar and header stay on screen through a normal browser reload (shell snapshot; also on a far server) | done |
| PDFs: measured columns (no wrapped money), wrapping headers, print time in the footer; the guest bill's Summary band with the balance due | done |
| Email Marketing follow-ups (13 Oct, session 2): the send queues its outbox rows 25 at a time (a few thousand addresses in seconds); the owner's daily summary gets a "Campaigns" section on a day a campaign was sent (campaigns, addresses, delivered, failed, waiting); Platform health already flags a hotel whose campaign mails fail (the hotel's own outbox rows count) | done |
| **Pathik from one place** (MJ, 13 Oct, decision 61): the online runner is kicked by check-ins, check-outs, Run now and page opens, with Vercel's daily cron as the safety net; one function carries the browser; run records (needs Neon SQL 0033) and the runner card on the Pathik page; a Pathik column on Platform health | done; the first real submit waits for MJ (`docs/pathik/PATHIK-ONLINE.md`) |
| CRM removed from the menu; **Email Marketing** in its place: campaigns to customers, companies and past guests from the hotel's own mail server, a test to yourself, unsubscribe links and opt-outs, delivered / failed / waiting per campaign (needs Neon SQL 0032 and 0121) | done |

## 8. What I need from you

1. Tick or strike items in sections 2–4 (or say "all of Phase 1").
2. Three decisions that shape the design: (a) phones for hotel staff: bottom bar like the portals, yes/no; (b) Razorpay stays the payment partner, yes/no;
   (c) the OTA partner for N3 (eZee Centrix, Staah, or none for now).
3. Whether I may change Pallav's look where consistency needs it (e.g. one tile style), or must keep each ported page pixel-close to the Blade.

Once Phase 1 is approved I start with D1–D4 and H12 (the parts and the page head), screen by screen, with before/after screenshots in `docs/sessions/`.
