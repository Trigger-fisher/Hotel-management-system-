# S04 Phase 1 - Backend foundation (brief for the Backend session)

**HOLD (MJ, 2026-10-05, later that morning): "do not start the backend yet."** Backend 1 has sent its plan only; it changes nothing, installs nothing and touches no database until the Lead sends "START". This overrides the note below.

**UPDATE (MJ, 2026-10-05, about 9:30 am): STARTED (superseded by the HOLD above). MJ chose option A: start the backend now; all screens are built on web and mobile, UI polish continues in parallel in other sessions.** The timing note below is superseded.

**TIMING (MJ, 2026-10-05 morning): "done, but only after the UI is completed."** The backend starts ONLY after ALL UI work (S03: Guest, Corporate, every Hotel area, login connected, web and mobile) is finished. Do not start this phase, do not message a Backend session, and do not install anything before then.

MJ said (2026-10-05): "you can start work on the backend". Frontend sessions keep building the UI; the backend is its own session ("Backend 1"). **No subagents.** Sonnet, medium effort. No commit/push (R9). Frontend files belong to the UI sessions: this session never edits `web-app/src/components/**`, `web-app/src/dashboards/**`, `Mobile App/**` or `ui-shared/auth/**` (it may ADD files under `web-app/src/app/api/**`, `web-app/src/server/**`, `web-app/src/db/**`, `db/**`, `docs/DATABASE.md`, `docs/API.md`).

## Read first
MASTER.md (sections 3, 4, 7), docs/sessions/reports/S04-backend-pallav-port.md (MJ's decisions), the Pallav source (read-only, path in that file), docs/sessions/reports/S03-dashboards.md.

## Decisions (MJ)
- Behaviour = exact port of Pallav (Laravel). Login follows Pallav's login (username + password, emailed code, forgot password, forced change, 5-try lock, 1 session per user).
- **A separate set of tables per hotel** = one PostgreSQL schema per hotel + a shared `platform` schema.
- Import Pallav's live data later. Port all integrations later (MJ adds the keys to env files).
- PostgreSQL 18 is installed and running on the dev PC (service `postgresql-x64-18`; `psql` is in `C:\Program Files\PostgreSQL\18\bin`, not on PATH). No Docker.

## Phase 1 goals (nothing else yet)
1. **Database setup:** create the dev database and two roles: `hms_owner` (owns tables, runs migrations) and `hms_app` (limited, no DDL, no BYPASSRLS, no superuser). Passwords only in `web-app/.env.local` (git-ignored), never in code.
2. **Schema design:** `platform` schema (hotels, hotel_groups, group_members, users, user_hotels, roles, permissions, role_permissions, sessions, login_attempts, audit_log) and a **hotel schema template**: all Pallav tables (from Pallav's 96 migrations, de-duplicated to the final shape), every table with `created_at/updated_at/deleted_at` where Pallav soft-deletes, money in paise integers, UUID ids, FK + indexes. Write `docs/DATABASE.md` (tables, per-hotel rule, how a hotel is created).
3. **Migration runner:** plain SQL files in `db/migrations/platform/` and `db/migrations/hotel/`; a script that applies hotel migrations to EVERY hotel schema in order and records versions; `create-hotel` script that makes a new schema and applies all migrations.
4. **Server skeleton in Next.js:** `web-app/src/server/db.ts` (connection pool, `withHotel(hotelId, fn)` that opens a transaction, runs `SET LOCAL search_path` to that hotel's schema taken ONLY from the verified session), error format `{ error: { code, message, traceId } }`, request validation, route handler -> service -> data access layering, `/api/v1/health`.
5. **Isolation tests:** a script/test that creates two hotels, writes in hotel 1, and proves hotel 2 cannot read, change or delete it, and `hms_app` cannot touch `platform` writes it must not. A build check fails if a hotel table is missing from the template.
6. **Plan before code (MASTER 6.1 step 2):** send the Lead a short plan with the table list and risks before building step 2-5; the Lead gets MJ's OK.

## APPROVED by MJ (2026-10-05 "all go"): pg, argon2, zod, nodemailer, tsx (install only when the backend starts, after the UI is done). Also approved for the web app: babel-plugin-react-compiler.
Backend 1 session exists (created by MJ). It waits for the Lead's "UI done" message.

## Libraries needing MJ's approval (R11) - ALL APPROVED, kept for reference
| Package | Why | Recommendation |
|---|---|---|
| `pg` (node-postgres) | PostgreSQL driver | Yes (official-standard, no ORM) |
| `argon2` | Password hashing (MASTER 4.2) | Yes |
| `zod` | Server-side request validation | Yes |
| `nodemailer` | Email (emailed login code, reset, invites); dev prints to console | Yes, later in Phase 2 |
| `tsx` (dev only) | Run TypeScript scripts (migrations, create-hotel) | Yes |

## Done when
Dev database exists with both roles; platform schema and hotel template created; two test hotels isolated (tests pass); `/api/v1/health` works; `docs/DATABASE.md` written; report to the Lead with tables list, test output and open questions.
