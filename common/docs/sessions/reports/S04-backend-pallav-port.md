# S04 - Backend: exact port of the Hotel Pallav Laravel system (PLANNED, NOT STARTED)

MJ (2026-10-05): "when the UI task is completed you can move on to the backend of all this, and make you follow the exact frontend and backend from the Laravel account Hotel Pallav I gave, nothing a single thing is changed, but in SPA."

**Starts only after the dashboards UI (S03) is finished and MJ says "go" (R2).**

## Goal
Every screen already built (Guest, Corporate, Hotel dashboards) gets its real backend, behaving EXACTLY like Pallav: same fields, validations, calculations (bills, GST, ledgers, payroll, salary slips), permissions, reports, emails, PDFs and audit rules. Not a redesign: a port into the approved stack (Next.js `/api/v1`, PostgreSQL), replacing the mock APIs in `ui-shared/dashboards/<group>.ts`.

## Source of truth (read-only)
Pallav repo copy: `C:\Users\infoj\AppData\Local\Temp\claude\c--Users-infoj-Desktop-HMS\3f2494f1-979c-4f1e-81df-95398e5b6159\scratchpad\pallav` (routes/web.php, routes/api.php, app/Http/Controllers/**, app/Models/**, app/Support/**, app/Services/**, database/migrations (96), tests/**, resources/views for PDFs/emails).
Size: ~96 migrations, ~54 models, ~43 support classes, ~32 controllers + 21 payroll controllers, 15 payroll tests.

## Approach (proposal)
1. Per module group (same 11 groups as the UI): read the Laravel code, write a short behaviour spec (rules and formulas), build tables + API + tests that reproduce the Laravel results with the same inputs (golden tests taken from Pallav's own `tests/`).
2. Swap the mock API for the real one in web and mobile, one group at a time, MJ sees each live.
3. Security and structure from MASTER.md: PostgreSQL with `hotel_id` + Row Level Security, server-side hotel id only, money in paise, audit log, Argon2id, etc.

## MJ's decisions (2026-10-05)
1. **Login: follow Hotel Pallav** (username + password, emailed one-time code, forgot-password by emailed code, forced password change, 5 wrong tries locks the account, one session per user, 90-day mobile token). NOT the HMS login built in S02. **Consequence: the S02 login screens (authenticator-app 2FA, recovery codes, mobile/email sign-in, remember device, invite flow) differ from Pallav and will need a UI change. MJ to confirm the exact login screens before the auth backend starts.**
2. **Multi-tenant database, fully isolated** per hotel (plan: one PostgreSQL, `hotel_id` + forced Row Level Security + cross-hotel tests on every build, MASTER 4.1; tell MJ if "fully isolated" must mean a separate database per hotel).
3. **Move the data: yes** (one-time import of the live Pallav data, after MJ approves the tables).
4. **Port everything, yes** (Razorpay, Google Drive backup, Google Business Profile, SMTP email, website enquiries). MJ will add the keys; they live only in env files, never in git.
5. **Order: Hotel first, then Guest and Corporate.**
2b. **ANSWER (MJ, 2026-10-05 night): "I want a separate table for each hotel."** Each hotel gets its OWN set of tables, completely separate from every other hotel. Plan: one PostgreSQL database, one **schema per hotel** (`hotel_<id>`), each holding its own copy of all the Pallav tables; a small shared `platform` schema holds hotels, groups, users/logins, roles and the audit of platform admins. The app connects with a limited role and sets `search_path` to the signed-in hotel's schema from the verified login only (never from the request). Group admins read only their member hotels' schemas through a separate audited path. **This replaces "one schema + Row Level Security" in MASTER.md sections 3 and 4.1; MJ to approve updating MASTER.** Needed: a migration runner that applies every migration to every hotel schema (and new hotels get a fresh schema), cross-hotel tests on every build.
2c. **MJ: "you can start work on the backend."** Treated as the "go" for step 1 (Plan and foundation). New libraries still need MJ's OK (R11).
6. **Make the design user friendly** (MJ's wording; scope to confirm: the dashboards/screens).

## Open questions for MJ (R5, max 5, with my recommendation) - ANSWERED, kept for history
1. **Login backend:** copy Pallav's login (username + password + emailed code) exactly, or the HMS login already built in the UI (username/mobile/email, authenticator-app 2FA, recovery codes)? Recommend: HMS login (the UI is built and approved); keep Pallav's rules for roles and permissions.
2. **Database:** Pallav is single-hotel on its own database. HMS needs many hotels in one PostgreSQL. Recommend: port every table to PostgreSQL with `hotel_id` and Row Level Security (MASTER 4.1).
3. **Pallav's real data:** move the live Pallav data into HMS (one-time import), or start empty? Recommend: build an import script last, after MJ approves the tables.
4. **Integrations:** Pallav has Razorpay payments, Google Drive backup, Google Business Profile, SMTP email, website enquiries. Port all of them, or email + core first? Recommend: core + email first, then Razorpay, then Google (needs MJ's keys and approval).
5. **Order:** which group first? Recommend: Guest/Corporate portals' data, then cash, billing, front office, companies, payroll, website, admin (same as UI order).

## Rules that apply (MASTER.md)
R1 one feature at a time, R2 nothing starts without "go", R9 no commit/push until MJ sees it live, R11 no new libraries without OK (a PostgreSQL driver/ORM and an email library will need approval), high-risk work (money, migrations, isolation) = tests first + rollback plan.
