# HMS Product Playbook (Product Manager + Master Planner)

Owner: **Planning 1** (the Lead), acting as **Product Manager and master planner** (MJ, 2026-10-05).
MJ is the product owner and has the final say. MASTER.md rules always win over this file.
This is the one file the planner works from: what we build, for whom, why, in what order, how we judge "done", and what the teams have learned.

---

## 1. Product in one paragraph

HMS is one connected platform for **Indian hotels**: run the property (front office, billing, cash, companies, payroll, website, admin), serve guests and corporate customers through their own dashboards, and later connect POS, channel manager, booking engine and a hospitality network. The first real customer and the behaviour reference is **Hotel Pallav** (its Laravel app, `github.com/Mihir-Jungiwala/hotel-pallav-account`). We are moving Pallav's whole account system into HMS **unchanged in behaviour**, rebuilt as a modern SPA (Next.js web + Expo mobile) on a multi-hotel backend.

**Vision (plan v1):** make hotel management simple, efficient and accessible, and become one of the world's leading hotel technology platforms.

## 2. Users and their dashboards (every role has its OWN dashboard)

| Role | Who in a hotel | Dashboard now | Notes |
|---|---|---|---|
| Guest User | A staying or past guest | **Guest** (Pallav guest portal: home, rooms, order, bills, history, profile) | Built web + mobile |
| Corporate User | Travel desk of a company that books and pays for staff stays | **Corporate** (Pallav company portal: dashboard, rooms, bills, payments, ledger, team, profile) | Built web + mobile |
| Hotel Admin | Owner or GM of one hotel | **Hotel** (everything else in Pallav) | Built web + mobile; MJ will move some features to other roles later |
| Hotel User | Staff (front desk, accounts, F&B) | **Hotel**, filtered by permissions | Same dashboard, admin-only items hidden |
| Group Hotel Admin | Runs a chain or group of hotels | Placeholder | Sees only member hotels |
| Platform Admin | HMS company staff who create hotels and groups | Placeholder | Create hotel / group lives here (not built) |
| Super Admin | HMS owner | Placeholder | Everything, all audited |

Custom Users: removed (MJ). Never invent a dashboard or feature for a role MJ has not explained.

## 3. Products (sold separately, one system)

| Product | What | Status |
|---|---|---|
| HMS core | Hotel operations (Pallav port) | UI built; backend not started |
| POS | Restaurant/bar billing, post to room | Later |
| Channel Manager | Sync rates, rooms, bookings with OTAs | Later |
| Booking Engine | Hotel's own direct booking | Later (Pallav has a public website + enquiries, which we port) |
| Hospitality Network | Jobs and network for hotel staff | Later |

## 4. Hotel industry primer (what the planner must know)

### 4.1 Core vocabulary
| Term | Meaning | Where in HMS |
|---|---|---|
| PMS | Property Management System: rooms, reservations, check-in/out, folios | Front Office |
| Reservation -> Check-in -> Stay -> Check-out | The guest lifecycle; a reservation becomes a stay at check-in | Front Office |
| GRC / GR no. | Guest Registration Card number, filled at check-in (ID proof, address, nationality) | Check-in, Bills |
| Folio | The running account of a stay (room nights, food, laundry, taxes, payments) | Stay account |
| Advance / deposit | Money taken before or during the stay, adjusted in the final bill; refundable | Guest Advances |
| City ledger / company ledger | Credit given to companies; bills "billed to company" are paid later | Companies, Ledger, Corporate dashboard |
| Debit bill / settle | A bill left unpaid (on credit), settled later, sometimes in instalments | Bills |
| Night audit | End-of-day close: post room charges, reconcile cash, roll the business date | Not in Pallav as a screen (Pallav has daily cash + shift handover); future |
| Shift handover | Cash count by denomination when a shift ends | Daily Cash |
| Housekeeping status | Vacant clean, vacant dirty, occupied, out of order | Room board |
| Rate plans / meal plans | EP (room only), CP (with breakfast), MAP (2 meals), AP (all meals) | Rates, Food plan report |
| ARI | Availability, Rates, Inventory: what a channel manager pushes to OTAs | Website calendar now; Channel Manager later |
| OTA | Booking.com, MakeMyTrip, Agoda, Goibibo, Expedia | Channel Manager later |
| KPIs | Occupancy %, ADR (average daily rate), RevPAR (revenue per available room) | Hotel dashboard (future enrichments) |
| No-show, early check-in, late check-out | Common charge cases | Reservations |

### 4.2 India-specific rules (verify with MJ's CA before coding; never hard-code rates, MASTER 4.4)
- **Pallav has no GST table** (finding, 2026-10-05): staff type the GST percent at check-out (0 to 28, pre-filled 5) and bills store typed GST amounts. HMS keeps that (the default becomes a hotel setting; each stay or bill stores the percent used). Automatic slabs = question #19 for MJ.
- **GST on rooms depends on the tariff per night** and changes by government notification. As of the Sept 2025 GST reform, rooms up to ₹7,500 a night are taxed at a lower rate without input credit and rooms above at a higher rate. Restaurant GST also depends on the hotel's room tariffs. **Store tax rules as data with effective dates**; show GSTIN on B2B bills.
- **B2B GST invoices**: company GSTIN, place of supply; **e-invoicing** applies above the government turnover threshold (check for each hotel).
- **Form C**: foreign guests must be reported to the FRRO (online) within 24 hours of arrival. Future feature; keep nationality, passport and visa fields ready.
- **Police / local reporting** of guest details in many cities.
- **ID proof** (Aadhaar, passport, licence, voter ID, PAN): store encrypted, show only the last 4 digits (MASTER 4.3). Aadhaar must never be shown or printed in full.
- **DPDP Act 2023** (personal data protection): purpose-limited collection, consent, breach duty, deletion on request. Matters for guests, staff payroll data and portal customers.
- **Payroll**: deductions such as PF, ESI, professional tax and TDS exist in Indian payroll; Pallav models deductions as configurable items. Port exactly, don't add statutory logic without MJ.
- Money format `₹1,23,456.00` (Indian grouping), dates `04 Oct 2026`, 12-hour IST, amount in words with Lakh/Crore.
- Financial year 1 Apr to 31 Mar (Pallav "Books").

### 4.3 What hotel staff need from software (product principles)
1. **Speed at the desk**: check-in under 2 minutes, fewest taps, keyboard-friendly on web.
2. **Money must be exact and auditable**: paise integers, no floats, every change logged, nothing hard-deleted.
3. **Works on shared front-desk PCs**: one session per user, screen lock, no "remember me" by default on shared PCs.
4. **Phone-first for owners**: owners check cash, occupancy and dues on a phone.
5. **Offline-tolerant feel**: clear offline message, never lose a form.
6. **Plain language**: staff are not accountants; Indian English, short sentences.

## 5. Tech we use (and what the teams learned)

| Part | Choice | Key learnings (from UI Review docs 04, 05, 12 and the teams) |
|---|---|---|
| Web | Next.js 16.3, React 19.2, TypeScript strict, App Router, React Compiler on | Single-page feel with one shell; lazy-load each dashboard group (`registry.ts`) so a guest never downloads hotel code; `loading/not-found/global-error` pages; push `'use client'` to leaves; `next/font` Inter. **Never run `next build` inside web-app while the shared dev server (port 3001) is open**: build into a temporary directory instead |
| Mobile | Expo SDK 57, React Native 0.86, expo-router, Reanimated 4 | One screen hosts the dashboard; Android back pops the in-app stack; `hms://` links do nothing in Expo Go (use `exp://<host>:8081/--/...`); keyboard, 200% text and screen readers need a real phone |
| Shared | `ui-shared/` (tokens, auth contract, dashboard contracts per group, formats, nav, labels) | Text and numbers only from here (`copy`, `dashLabels`, `formatINR`...). Contract files `ui-shared/dashboards/<group>.ts` hold types + mock API + mock data |
| Components | ONE library: web `src/components/ui`, mobile `src/ui/kit` (`docs/UI.md`) | Anything used twice is a component (errors, empty, loading, notes, avatars, dates, emails, money). Destructive actions = `dangerGhost` + `ConfirmDialog`. Phone lists = 8 per page + Load more |
| Backend (planned) | Next.js `/api/v1`, MySQL 8.4 on HMS's own instance (decided by MJ), `mysql2`, `argon2`, `zod`, `nodemailer`, `tsx` (approved) | **Database per hotel** + shared `platform` database; hotel chosen only from the verified login and reached through that hotel's own MySQL user; migration runner applies to every hotel database; isolation tests every build |
| Design | Hotel Pallav look, improved: violet `#5B21B6` family, cream page, white cards, Inter, always day unless the person turns night on with the moon button (never the device; MJ, 5 Nov 2026) | Specs: `docs/design/ui-review/09` (sign-in), `10` (dashboards). Premium bar: `docs/design/ui-review/00` (10 dimensions, pass = average 4.5, nothing below 4) |

### 5.1 Running the dev database (MySQL)
HMS's own MySQL 8.4 listens on **127.0.0.1:3307** (data under `%LOCALAPPDATA%\HMS\mysql`). After a PC restart, start it again from the `web-app` folder: `npm run db:cli -- instance start` (also `stop` and `status`; plain `npx tsx` fails on `server-only`). Hotel Pallav's own MySQL (port 3306, `C:\ProgramData\MySQL\...`) is never modified; it is only started on 127.0.0.1 for a read-only export at data-import time.

## 6. How the work is organised (sessions)

| Session | Role |
|---|---|
| **Planning 1** (this) | Product Manager + master planner: priorities, briefs, shared contracts (`ui-shared`), decisions log, reports to MJ |
| Web UI 1 | Builds the web app |
| Mobile UI 1 | Builds the mobile app |
| UI reviewer | Scores screens against the premium bar, findings to the planner |
| Backend 1 | Builds the backend (on HOLD) |
| **Backend review** (former UI reviewer, renamed; MJ trains it as the backend MASTER) | Gives Backend 1 tasks, reviews, talks to it directly until production ready. MJ authorised it to START Backend 1 once set up as master |
| Communication, hms-5e | New sessions; roles to confirm with MJ |

Rules: zero subagents (MJ); Sonnet/Opus as MJ sets; no commit/push without MJ's exact word (R9); builders never edit each other's files; findings route through the planner unless MJ says the reviewer orders directly.

## 7. Status (2026-10-05, ~10:00)

| Area | Web | Mobile | Review |
|---|---|---|---|
| Login (16 screens, Pallav look, night mode) | Done | Done | Web scored ~4.2 then review skipped by MJ |
| Login opens the right dashboard | Done | Done | |
| Guest, Corporate dashboards | Done | Done | Web PASSED (4.5); mobile ~4.6 |
| Hotel: 9 areas (overview, front office, billing, cash, companies, payroll x2, website, admin) | Done | Done | Web 4.4-4.6 (last 3 areas round 1 fixes open); mobile ~4.5-4.6 |
| Backend, data import, integrations | 0% | | Backend on HOLD (MJ) |

Overall ≈ 50% (screens 50% weight done; backend 40% and import/integrations 10% not started).

## 8. Roadmap (planner's proposed order; MJ decides)

1. **Finish UI polish to the premium bar** (web Payroll Pay/Website/Admin fixes; real-phone checks by MJ in Expo Go: keyboard, large text, screen reader).
2. **MJ live walkthrough** of web + mobile, then MJ's "commit" (R9) for the UI.
3. **Backend Phase 1 foundation** (on MJ's START): DB, roles, platform + per-hotel schemas, migration runner, isolation tests, health endpoint.
4. **Backend per area, Hotel first** (MJ): golden tests against Pallav behaviour, then swap each group's mock for the real API, web and mobile together.
5. **Login backend** (after MJ confirms Pallav-style login screens vs the built ones).
6. **Guest and Corporate backend**.
7. **Data import from Pallav** (after MJ approves tables), then **integrations** (email, Razorpay, Google Drive backup, Google Business Profile) with MJ's keys.
8. Later products: POS, Channel Manager, Booking Engine, Network; dashboards for the remaining roles as MJ explains them.

## 9. Open decisions waiting for MJ

| # | Decision | Planner's recommendation |
|---|---|---|
| 1 | Which session is the backend master (hms-5e, hms-3e or the renamed "Backend review"), and who reviews UI now | MJ to confirm names |
| 2 | Permissions: Pallav grid (View/Add/Edit/Delete/PDF per module) vs 4 levels | Both: the grid, plus four quick presets |
| 3 | Backend Phase 1 plan approval; postgres superuser access via `web-app/.env.local` (PGSUPERUSER_URL), never in chat | Approve when MJ lifts the HOLD |
| 4 | Port Pallav's `health_checks` and `feature_errors` (needed by System Health), skip other `feature_*` tooling tables | Yes |
| 5 | Update MASTER.md 3 / 4.1 to "a separate set of tables per hotel" | Yes |
| 6 | Login: follow Pallav (username + password + emailed code) or keep the built HMS login | Decide before the login backend |

## 10. Decisions log (most recent first)

| Date | Decision (MJ) |
|---|---|
| 2026-10-05 | (relayed) #19 A: GST the Pallav way (typed percent 0-28, editable hotel default 5, Pallav formula and rounding, percent saved on each stay and bill); automatic slabs later with MJ's CA. Replaces the "dated GST table" wording of #6 |
| 2026-10-05 | (relayed) Database = **MySQL** ("you will not need my permission" for the setup): HMS runs its own MySQL 8.4 instance (port 3307, AppData), database + MySQL user per hotel; the existing MySQL data (hotel_pallav, hotel_pallav_php) is never touched. #17 "commit": first local commit adad002 (no push) |
| 2026-10-05 | (relayed) #7 B no APP_KEY / no import of Pallav's encrypted fields; #8 A MASTER 3, 4.1, 4.2 rewritten (done); #9 A Pallav login (username + password + emailed code; built login screens must change); #10 A Pallav numbering made concurrency-safe; #13 A all sign-in safety fixes; #14 A "someone else changed this" version check; #15 A local git repo (created, no commits until MJ says "commit") |
| 2026-10-05 | (relayed) #11: skip MJ's real-phone test for now (keyboard, large text, screen reader stay "checked in code only") |
| 2026-10-05 | (relayed) #6: GST rates in a dated table; results identical to Pallav's |
| 2026-10-05 | (relayed) #12: imported Pallav users set a NEW password via an emailed reset link; no bcrypt-verify library |
| 2026-10-05 | (relayed via Communication) Backend MASTER = "Backend review" (also stays UI reviewer); permissions = the 4 levels only; mask Aadhaar/ID to last 4. Backend start + DB access to be confirmed by MJ in the Planning 1 chat |
| 2026-10-05 | Planner becomes Product Manager + master planner; learns domain and tech |
| 2026-10-05 | Backend on HOLD; a backend master session will give Backend 1 tasks until production ready |
| 2026-10-05 | Separate set of tables per hotel; move Pallav data; port all integrations; Hotel first |
| 2026-10-05 | One component library; component for everything repeated; top-level Next.js features; React Compiler approved |
| 2026-10-05 | Each role has its own dashboard; Guest/Corporate/Hotel built now from Pallav |
| 2026-10-05 | Zero subagents; auth review skipped; night mode follows device; Pallav design improved; password 8+ chars with upper/lower/number/special; remember-device on; Custom Users removed |

## Decision log, 06 Oct 2026 (MJ)
- PostgreSQL is FINAL (HMS-owned instance on 127.0.0.1:5433, one database, schema + login-less role per hotel). MySQL work is frozen then removed after review.
- UI: 100% same as Hotel Pallav in day AND night mode, exact pages and navigation for the Hotel user; calm motion; user-switchable day/night; smart search bar. UI sessions paused until PG1/PG2 are accepted.
- #20 A (GSTIN settings), #21 A (fix quirk a), #22 (PDF always, pdfkit), #23 B (salary payment version), #28 (keep 3 readability fixes), #29 (dock stays), #30 (SPA auth stays), #31 (Pallav run locally as reference).

## Update 06 Oct 2026 (MJ): no mobile app in the pilot
The Mobile App folder and all mobile-only files were deleted. The pilot is the web app only (phone-width layouts follow Pallav's responsive CSS). Every mention of a mobile app, Expo, the bottom dock or mobile percentages elsewhere in this file is history. Current rules and state: docs/DECISIONS.md, docs/PROJECT-STATE.md.
