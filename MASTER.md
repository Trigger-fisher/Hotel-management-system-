# MASTER.md - HMS Pilot: the one file to work from

> **06 Oct 2026: START WITH `docs/MASTER-PROMPT.md`, `docs/DECISIONS.md` and `docs/PROJECT-STATE.md`.** They are newer than this file and win where they differ (this file's R2, R3, R7 (side by side web and mobile: there is NO mobile app now), R9, the Expo/mobile sections, the MySQL lines, encryption and the Pallav data import are superseded).
> **Read this whole file at the start of every session.** It is the top source of truth. It replaces `documentation/CLAUDE.md` (kept only as history).
> If a task conflicts with this file, **stop and ask MJ**. Never guess.
> Owner: **MJ** (product owner, final say on everything). Builder: **Claude Code**. Reviewer: **Atlas** (AI project manager).
> **Database decision, 2026-10-06 (MJ): PostgreSQL is FINAL.** This supersedes every MySQL line in sections 3 and 4.1 below until Backend review rewrites them: HMS's own Postgres instance on 127.0.0.1:5433 (never the existing Postgres install), ONE database with one schema and one login-less role per hotel (hotel A cannot read hotel B), no per-hotel passwords (HMS_TENANT_KEY retires; HMS_DATA_KEYS stays).
> Last updated: 2026-10-06 (MJ: database = PostgreSQL, final, "first set the PostgreSQL"; sections 3 and 4.1 say schema-per-hotel with a role per hotel). Before that, 2026-10-05 (MJ: database = MySQL; sections 3 and 4.1 say database-per-hotel with a MySQL user per hotel). Before that, 2026-10-05 (MJ #8: sections 3, 4.1, 4.2 rewritten for a separate set of tables per hotel and Pallav's login with the sign-in safety fixes). Earlier: 2026-10-04 (S01; Custom Users removed; R3 new session per feature; R4 sessions may talk; fresh start in Desktop\HMS: web app in `web-app/`, mobile app in `Mobile App/`).

---

## 1. The 12 rules MJ gave (never break these)

| # | Rule | MJ's words |
|---|---|---|
| R1 | **One feature at a time, in MJ's order.** Work only on the feature marked **NOW** in the Feature Queue (section 5). Never start, plan, or build any other feature, even if it looks related or easy. | "make sure the features is going one by one and what I told to do first it will not go otherwise" |
| R2 | **Nothing starts until MJ says "go".** Plans, questions and reports are fine. Code, installs, deletes and messages to other sessions are not, until MJ says "go" for that step. | "do not start no when i told you then start only" |
| R3 | **One Claude Code session works at a time, and every feature gets its own new session.** Inside it, work runs in **3 agent teams in parallel: Backend, Web UI, Mobile UI** (section 6.2), each on its own files. | "I do not want to run all the session at one time", "multiple AI agents in a task divided into 3 teams backend, web and mobile UI" |
| R4 | **Agents and sessions may talk to each other** to share info and hand over work (MJ, 2026-10-04: "yes all the agents and seesion can alk to each other"). They still follow R1, R2 and R9: no starting another feature, no building without MJ's "go", no commit/push. | "yes all the agents and seesion can alk to each other" (replaces the old "never message other sessions" rule) |
| R5 | **MJ explains each feature in their own words.** Write it down, ask max 5 gap questions with your recommended answer for each. Never invent features or business rules. | "I will explain all things as per feature" |
| R6 | **Never cut scope** from MJ's plan (`documentation/MJ_PLAN_v1_2026-10-04.pdf`). The pilot builds everything in it, feature by feature. You may only suggest order. | "we will implement all the things this have" |
| R7 | **Web and mobile are built side by side** for every feature, on the same API, and tested together. | "I want to build the app side by side so testing done togather" |
| R8 | **Full optimisation and a fallback for every error.** Every screen and API call has loading, empty, error and success states, and a friendly fallback, never a crash or raw error. | "I want full optimize and fallback for any error" |
| R9 | **No commit, no push** until MJ has seen the app running live on their PC and says "commit" / "push". | "no once it is local live i see and then push" |
| R10 | **Docs grow with the project.** After every task, update the docs and the session handoff (section 10). | "the documentation will upgrade with the project" |
| R11 | **Only the approved stack** (section 3). No new language, framework, server, library or tool without MJ's OK. | "in this we will only use next ... sql", "add the native" |
| R12 | **Simple, plain English** to MJ. Short answers, tables, no jargon without a one-line meaning. | (working style) |

---

## 2. The product

**Vision (plan v1):** "To make hotel management simple, efficient, and accessible while building one of the world's leading hotel technology platforms." One connected platform for Indian hotels.

**Products (sold separately, work as one system):**

| Product | What it is |
|---|---|
| HMS | Core hotel operations (rooms, reservations, check-in/out, billing, housekeeping, night audit, reports) |
| POS | Restaurant, bar and outlet billing; post bills to the guest's room |
| Channel Manager | Sync rooms, rates and bookings with OTAs |
| Booking Engine | The hotel's own direct booking for guests |
| Hospitality Network | Professional network and jobs for hotel staff |

Removed for now: AI Assistant. Google sign-in. SMS/WhatsApp (email only). Custom Users (MJ, 2026-10-04).

**Roles (plan v1):** Super Admin > Platform Admin > Group Hotel Admin > Hotel Admin (in a group or standalone) > Hotel User. Plus Corporate User, Guest User. (Employee User is removed from the pilot, MJ 12 Oct 2026.) Each role creates users only at its own level and below.
- **Super Admin:** full control of the whole platform; every action audit logged.
- **Platform Admin:** creates every hotel and group.
- **Hotel groups:** link hotels; the Group Hotel Admin sees only its member hotels.
- **Hotel User permissions:** per module and action: View Only / View & Create / View & Edit / Full Access.

Full product detail: `docs/PRD.md`. Terms: `docs/GLOSSARY.md`.

---

## 3. Pilot stack (locked, ADR-PILOT-1)

| Part | Choice |
|---|---|
| Web + API | **Next.js** (App Router, TypeScript strict), screens and API in one app, in `web-app/`. API at `/api/v1`, used by web and mobile |
| Mobile | **React Native with Expo** (TypeScript) in `Mobile App/`, built side by side with web |
| Shared | `ui-shared/`: design tokens and API types shared by web and mobile |
| Database | **PostgreSQL 18** (MJ, 2026-10-06: final, no more switching), installed directly on the dev machine (no Docker). **One database `hms`: a shared `platform` schema plus a separate schema (its own set of tables) for every hotel**, each hotel schema reachable only through that hotel's own database role. On the dev PC HMS runs its OWN PostgreSQL instance (port 5433, data under the user's AppData), never touching any other PostgreSQL install; a separate test database is used only by automated tests. Hotel Pallav's old MySQL data is only a read-only import source |
| Hosting | Hostinger KVM VPS, Mumbai |
| Email | Email only. In dev, emails are printed to the console |
| Not allowed without MJ's OK | Redis, Docker, Java/Spring Boot, PHP/Laravel, Python, any separate backend server, any new library |

The old Spring Boot code in `backend/` is replaced. Delete it only after MJ says so.

---

## 4. Security rules (pilot)

### 4.1 Hotel isolation (a separate set of tables per hotel; MJ, 2026-10-05, replaces "one schema + RLS")
1. Shared data (hotels, groups, users and logins, roles, permissions, sessions, platform audit) lives in the **`platform` schema**. Every hotel's business data lives in **its own schema** created from one hotel template (the same tables for every hotel).
2. **Each hotel schema is reachable only through that hotel's own NOLOGIN role** (`hotel_<32 hex>_rw`, privileges on that schema only). The app's own role has **no privileges on any hotel schema**; every request switches to the signed-in hotel's role (`SET LOCAL ROLE`) with a fixed `search_path`. A wrong schema name gets "permission denied" from PostgreSQL itself.
3. The hotel comes **only from the verified login**. **Never** take the hotel from the request body, URL or query. Schema and role names are built only from validated UUIDs.
4. Migrations run through one runner that applies every hotel migration to **every** hotel schema in order; creating a hotel is all-or-nothing. A **build check fails** if a hotel table is missing from the template, a grant is wrong, or a migration is not applied everywhere.
5. **Cross-hotel tests** run on every build: Hotel 1 tries to read, change and delete Hotel 2 data and gets nothing.
6. Group admins read only their member hotels through a separate, audited path. Super/Platform Admin access is separate and audited.

### 4.2 Login (MJ, 2026-10-05: follow Hotel Pallav, with the sign-in safety fixes)
- Sign in with **username + password**, then a **6-digit code sent by email** when the account requires it (Pallav's flow). The emailed code is **always required for admin roles**. No authenticator app and no recovery codes.
- Forgot password: username, then an **emailed code**, then set a new password. First sign-in or an admin reset forces a password change.
- Password rule: 8 to 128 characters with an uppercase letter, a lowercase letter, a number and a special character (MJ).
- Passwords hashed with **Argon2id**; emailed codes and lookup identifiers stored only as **server-keyed hashes**. Use proven libraries, not hand-written crypto.
- **Sign-in safety fixes (MJ #13):** after repeated failures the account locks for a **limited time** (15 minutes, growing up to 24 hours), never forever; a lock caused by someone else's wrong guesses **does not sign the owner out**; messages **never reveal whether an account exists**; emailed codes have **guess limits**; the person is **emailed** on password change, account lock and sign-in from a new phone.
- Sessions: **one active web session per user**, ending after **120 minutes idle**; the phone app keeps a **90-day sign-in token** in the phone's secure storage. Web session token in an httpOnly secure cookie.
- Pallav's users moved into HMS set a **new password** through an emailed reset link (no old password hashes kept).
- Local dev Super Admin: username `mihir`, MJ's email, weak dev password only from local `.env`, never in git, never in production.

### 4.3 Encryption (pilot, simple)
- HTTPS on every connection. Server disk encryption.
- Encrypted in the database (AES-256-GCM, one key from env, never in git): **government ID numbers** (Aadhaar, passport, visa, PAN, licence, voter ID) and **2FA secrets**. Users see only the **last 4 digits** of ID numbers.
- Hashed, never encrypted: passwords, recovery codes, reset/invite tokens.
- Never stored: card numbers, CVV, PIN (payment gateway keeps them).
- **Never log** passwords, tokens, ID numbers or payment data.
- The full three-key design (plan v1) is **deferred to before scaling**.

### 4.4 Data rules
- Money in **paise** (integer), currency INR. Never floats.
- Time stored in UTC (`timestamptz`), shown in IST. Stay nights use `date`.
- IDs: UUID (v7 preferred).
- Never hard delete money or booking records (soft delete).
- Audit log for changes on bookings, rates, folios, payments, users and roles.
- Never hardcode tax rates, prices or hotel settings.
- GST (MJ #19, 2026-10-05): follow Pallav: staff type the GST percent at check-out (0 to 28) with an editable hotel default (5); Pallav's formula and rounding; every stay and bill stores the percent it used. Automatic GST slabs by date and room tariff are decided later at check-out with MJ's CA.

---

## 5. FEATURE QUEUE (MJ controls this list)

**How it works:**
- Exactly **one** feature is **NOW**. Only that feature may be planned, built, tested or documented in detail.
- Only **MJ** adds features, sets the order, or moves a feature to NOW. Claude Code never reorders, skips or starts the next one on its own.
- A feature becomes **DONE** only when MJ has seen it working live on web **and** mobile and says it is done. Then Claude Code asks MJ which feature is next.
- If MJ asks for something outside the NOW feature, do exactly that small request, note it in the session file, and go back to NOW. Do not plan other features.

| Order | Feature | Status | Notes |
|---|---|---|---|
| 0 | Pilot foundation: Next.js full-stack app, Expo app, PostgreSQL with RLS, migrations, both apps talking to the API, delete old `backend/` (with MJ's OK) | **WAITING FOR MJ "go"** | Needed by every feature. MJ decides if this runs first or as part of Authentication |
| 1 | Authentication (sign-in, 2FA, sessions), web + mobile | WAITING | MJ's login feedback below. Spec: PRD PL-F02 to PL-F04 |
| - | All other features from plan v1 | NOT ORDERED | MJ explains and orders them one by one |

**MJ's feedback for Authentication (2026-10-04):**
- Remove the day/night mode from the login page.
- MJ does not like the overall design: make it clearly better.
- The captions (login page text) are weak: research good hotel/SaaS login pages online and study this project first, then write.

---

## 6. How every feature is built

### 6.1 Steps (in this order, inside one session)

| Step | What | MJ gate |
|---|---|---|
| 1. Explain | MJ explains the feature. Write it as a feature block in `docs/PRD.md`. Ask max 5 gap questions, each with a recommended answer | MJ answers |
| 2. Plan | Short plan: goal, screens, data, API, security, tests, risks, agents to use | **MJ says "go"** |
| 3. UI | Web and mobile screens side by side, on a typed mock API, with all states (R8) | **MJ sees and approves the screens** |
| 4. Database | Tables with `hotel_id`, RLS policies, migrations, sensitive-data check (section 4.3) | - |
| 5. API | Next.js API matching the mock contract, server validation, tests | - |
| 6. Connect | Web and mobile switch from mock to the real API; end-to-end tests on both | **MJ sees it live on their PC** |
| 7. Close | Reviews, docs updated, handoff, report. Commit/push only if MJ says so | **MJ says "done"** |

### 6.2 Three agent teams (MJ, 2026-10-04: "multiple AI agents in a task divided into 3 teams backend, web and mobile UI")

The session's main Claude is the **Lead**. It plans, splits the task, starts the teams in parallel, checks their work, and talks to MJ. Agents never talk to MJ.

**Before the teams start, the Lead fixes the contract** (`ui-shared/`: API request/response types, error codes, mock data). All three teams build against it, so they can work at the same time without waiting.

| Team | Owns (files) | Agents (run in parallel inside the team) |
|---|---|---|
| **Backend team** | `web-app/src/app/api/**`, `web-app/src/server/**`, `web-app/src/db/**` (Next.js API, services, database, RLS, migrations) | hms-architect (plan), backend-builder (API + services), db-guardian (tables, RLS, migrations), test-engineer (API and cross-hotel tests), security-auditor (login, isolation, private data) |
| **Web UI team** | `web-app/src/app/**` except `api/`, `web-app/src/components/**`, web styles | research agent (online + project, before design), frontend-builder (Next.js screens), test-engineer (web tests), code-reviewer |
| **Mobile UI team** | `Mobile App/**` | frontend-builder (Expo screens), test-engineer (mobile tests), code-reviewer |
| **Shared (Lead only)** | `ui-shared/**`, `docs/**` | hotel-domain-expert (hotel rules, GST, Form C) when needed, docs-keeper (docs at the end) |

How a task runs:
1. Lead writes the plan and the contract; MJ says "go" (R2).
2. All three teams start in parallel (usually 6 to 9 agents in total). Each team stays inside its own files.
3. Web and mobile build on the mock contract first; Backend builds the real API to the same contract.
4. Lead switches web and mobile to the real API and runs the end-to-end tests on **both** together (R7).
5. Reviewers check each team's work; builders fix every "must fix" finding (max 3 rounds, then ask MJ).

Rules: no two agents edit the same file; only the Lead changes the contract (and tells all teams); every agent prompt includes the task, plan, files in scope, docs to read and "done" criteria; the Lead checks results itself (runs the tests).

### 6.3 Risk
- **High** (login, isolation, money, bookings, deletes, migrations): tests first, rollback plan, explicit MJ "go".
- If the same error comes back 3 times: stop, explain what you tried and give MJ 2 options.

---

## 7. Coding standards

**API (Next.js server code):** route handler -> service -> data access; business logic only in services; typed request/response; validate every request on the server; one error format:
```json
{ "error": { "code": "BOOKING_NOT_FOUND", "message": "Booking not found", "traceId": "..." } }
```
Create endpoints for bookings and payments accept an `Idempotency-Key` header.

**Web and mobile:** TypeScript strict, no `any`; follow `docs/DESIGN_SYSTEM.md`; reuse components; every screen has loading, empty, error and success states (R8); forms validate on the client and the server still validates; shared tokens and API types from `ui-shared/`.

**Database:** snake_case, plural table names; `created_at`, `updated_at`, `deleted_at` on main tables; foreign keys and indexes on every FK and filter column; CHECK constraints for rules; migrations safe on live data (add nullable, backfill, then NOT NULL); RLS per section 4.1.

**Secrets:** never in code or git; env variables listed in `docs/BACKEND.md` section 10.

---

## 8. UI and design rules
- Design system: `docs/DESIGN_SYSTEM.md` (tokens shared through `ui-shared/`).
- Look and feel reference: the Hotel Pallav app (`documentation/UI_THEME_REFERENCE_HOTEL_PALLAV.md`), improved; look only, never its code.
- WCAG 2.1 AA contrast. Works on phone, tablet and desktop.
- Dates `04 Oct 2026`, 12-hour IST, money `₹1,23,456.00` (assumptions until MJ confirms).
- Before redesigning anything: research online and study this project first (MJ, 2026-10-04).

---

## 9. Sessions and files

- **One session at a time** (R3). Each feature has a session file in `docs/sessions/S<NN>-<feature>.md` (from `_TEMPLATE.md`), listed in `docs/sessions/INDEX.md`.
- Commands: `/new-feature <name>` (only for the feature MJ moved to NOW), `/continue-session S<NN>`, `/end-session`.
- **Session start:** read this file, `docs/PROGRESS.md`, `docs/sessions/INDEX.md`, `docs/LESSONS.md`, the NOW feature's session file and docs; run `git status`; reply to MJ with: current feature and step, last thing done, next step, open questions. Then wait (R2).
- **Session end:** update docs (section 10), write the Handoff in the session file (in progress, exact next step, files touched, uncommitted work, tests, open questions), update INDEX.md, send the report (section 12).
- Shared docs: small edits only, re-read right before each edit; never rewrite a whole shared doc.
- When the conversation gets long: save the handoff and tell MJ "Context is getting long. Handoff saved. Please start a new session."

---

## 10. Docs to keep updated

| After | Update |
|---|---|
| Every task | `docs/PROGRESS.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, the session file |
| MJ explains or changes a feature | `docs/PRD.md` |
| Screens and flows | `docs/UX_FLOWS.md`, `docs/DESIGN_SYSTEM.md` |
| Structure or big choices | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` |
| Tables, migrations, endpoints, security, env variables, tests, errors (all backend) | `docs/BACKEND.md` (the one backend document) |
| Every MJ correction or repeatable mistake | `docs/LESSONS.md` |
| This file | Only when MJ approves |

Note (2026-10-04): ARCHITECTURE, DATABASE, API, SECURITY, ENVIRONMENT, TESTING and CODE_STYLE still describe the old Spring Boot design. Rewrite them for the pilot stack as part of Feature 0, before building on them.

---

## 11. Git
- No commit, no push until MJ says (R9). Then: conventional commits (`feat:`, `fix:`, `docs:`), only the files of the task, never `.env` or secrets.
- Before the first commit, git needs MJ's name and email set (with MJ's OK).
- Never force push, never rewrite history on `main`, never merge without MJ.
- Remote: https://github.com/Mihir-Jungiwala/Hotel-Management-System.git

---

## 12. Definition of done and report

**Done means:** matches the approved plan; works on **web and mobile**; hotel isolation tested; server-side auth and validation; every error has a fallback; tests, lint, type check and build pass; sensitive data handled per section 4.3; no unrelated files changed; docs and session handoff updated; MJ has seen it live.

**Report to MJ (short, plain English):**
```
## <Feature> - step <n>
Status: Done / Blocked / Needs MJ
| What changed | ... |
| Tested | web: ... mobile: ... |
| Problems | ... |
Next step: ...
Questions for MJ (max 5, each with my recommendation): ...
```

---

## 13. Lessons (always follow; full log in docs/LESSONS.md)
1. Hotel id comes only from the verified login, never from client input.
2. Never cut or postpone scope from MJ's plan; only suggest order.
3. Read MJ's plan as page images (diagrams hold decisions). If the feature is not named, ask.
4. One session = one feature. Side requests: do only what was asked.
5. Never rewrite a whole shared doc; re-read before editing.
6. Commit/push only on MJ's exact words for that action, never on a general "go".
7. Test-first tests must not break the build for others.
8. No copies of another module's logic.
9. Input normalisers that feed unique keys reject invisible Unicode and are tested on every code point.
10. Sessions and agents may talk to each other (MJ, 2026-10-04), but MJ's gates (R1, R2, R9) still apply. One step, report, wait.

---

## 14. Open questions waiting for MJ
1. Feature 0 (foundation) first, or as part of Authentication?
2. OK to delete the old Spring Boot `backend/` folder?
3. Authentication defaults (PRD / S02 file P1 to P6, G1): refresh 7 days from last use with 30-day cap; first Super Admin by a setup command; same-device re-login replaces the session; 30-min screen lock on shared PCs; invite valid 72 h; self sign-up 18+ with consent; extra screen 13 "require 2FA" for Super Admin. (Recommended: yes to all.)
4. UI: placeholder "HMS" logo; one platform theme; date/money formats. (Recommended: yes.)
5. Housekeeping: delete Expo template's `mobile/.claude/` and `mobile/AGENTS.md`. (Recommended: yes.)
