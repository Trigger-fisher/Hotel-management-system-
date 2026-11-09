# Brief for Backend: Platform Admin + Super Admin server (10 Oct 2026, Project Manager)

Scope (MJ): ONLY the server side of the Platform Admin and Super Admin consoles. Nothing else (no Group Hotel Admin console server, no Razorpay, no website part 2). Frontend is finished on mock data; the contract is `ui-shared/dashboards/platform.ts` (types + mock API + sample data). Match its shapes and error codes; if something must change, message the Project Manager first.

Read first: `docs/BACKEND.md`, `docs/plans/PLAN-PLATFORM-CONSOLE.md` (MJ's model, assigned plan), `docs/plans/RESEARCH-PLATFORM-CONSOLE.md` (MUST rules), `docs/sessions/handovers/BACKEND-PAUSE-2026-10-10.md`, `docs/DECISIONS.md` (#26 to #33; one agent at a time, Opus 5.5, write all code, one review, fix once). Database: local PostgreSQL 18 on 127.0.0.1:5433 (no Neon). Never print secrets; never commit db/production, db/.dev-*.

## Step 0: your held work (small, first)
You have uncommitted batch-1 work (about 20 files) and 5 review findings. Isolation is the core of this feature, so fix finding 1 first (SECURITY: a hotel SuperAdmin can change a built-in role for EVERY hotel: roleService.ts, repos/postgres/adminUsers.ts), plus findings 2-5 if quick (health text to users-view holders, Payroll Master toggle audit row, password throttle, /health/deep writing 6 rows per call). Review agent C's portal files once. Then commit and push your OWN files with an explicit `git add` list (pull first; Frontend commits are on main). Do not widen scope.

## Rules the server must enforce (research MUSTs + MJ's model)
1. Hotel status machine: invited, onboarding, pending_review, active, suspended, archived, rejected; every change stores who, why, when. Suspended/archived/rejected/pending: sign-in blocked with the contract's messages. Archive keeps data, 90-day grace, restore only inside it; permanent delete only Super Admin, only after an export, typed slug.
2. Invitations: two types (individual hotel, group admin) (member_hotel invites belong to the Group Admin console, later). Single-use token, stored only as a server-keyed hash, 168 h validity (one constant), one active invite per hotel/group, resend = revoke + reissue, statuses pending/accepted/expired/revoked, lists never contain the token. Public onboarding endpoints (no sign-in): GET invite status, POST submit (rate limited, same answer for unknown/expired/used tokens except the friendly pages the contract defines).
3. Onboarding submit creates a PENDING hotel/group + its first account (Hotel Admin, or Group Hotel Admin) with the password chosen on the form (Argon2id), not able to sign in until approved. Approve runs the existing atomic `create-hotel` (schema, role, grants, migrations, seeds, audit) in one transaction; reject/failed creation leaves nothing behind. The new hotel starts EMPTY; the first user is only the Hotel Admin.
4. Roles: Platform Admin: invite, approve/reject, suspend/reactivate, request archive, create/disable/reset/unlock Hotel Admins and Group Admins, groups (invite group, link/unlink hotels), Enter hotel (read-only). Cannot hard-delete, cannot manage Platform Admins or Super Admins, cannot raise own rights. Super Admin: all of that + Platform admins, all users, audit log, sign-in history, platform health, platform settings, archive/restore/permanent delete.
5. Enter hotel: needs a written reason, 60-minute session token, READ-ONLY server-side (the server refuses every write method of hotel routes while the entered-hotel context is active; do not rely on the UI), every action stamped with platform user AND hotel, audited start/end.
6. Isolation: hotel comes only from the verified login or the entered-hotel context (never from body/URL); platform tables in the `platform` schema; hotel data only through that hotel's role. Tests: invite cannot touch another hotel; Platform Admin sees no hotel business data outside Enter hotel; read-only holds on every hotel route family; group scoping.
7. Audit log: actor (id, role, platform-staff-inside-hotel flag), action, targets (hotel id, record), time, IP, user agent, result, reason; append-only, in the platform schema, never deleted by the app; CSV export; sign-in history across hotels; 2-step (emailed code) required for Platform Admin, Super Admin and Group Admin sign-in.
8. Mail: invitation, approval, rejection, temporary-password and lock emails through the existing mail driver (log driver in dev; real SMTP later when MJ gives keys).

## Tasks (one agent at a time)
| ID | Task | Done when |
|---|---|---|
| P0 | Step 0 above | held work committed, finding 1 fixed with a test |
| P1 | Platform migrations (hotels status/history, groups, invitations, onboarding data, platform audit, enter-hotel sessions, platform settings) | migrations apply on fresh and existing DB, lint-sql passes |
| P2 | Services + routes: hotels list/details, status changes, groups, hotel admins, platform users | tests green |
| P3 | Invitations + public onboarding + approve/reject (create-hotel integration, mail) | full path test: invite, submit, approve, new admin signs in to an empty hotel |
| P4 | Enter hotel + server-side read-only guard | every hotel route family refuses writes during a visit; tests |
| P5 | Super Admin routes: all users, audit log (+CSV), sign-in history, platform health, platform settings, archive/restore/delete with export | tests green |
| P6 | Isolation + security tests, then ONE review, fix once, update docs/BACKEND.md (routes, rules), commit | all pass |

Report to the Project Manager with a % table per task ID after each task. Percent basis: code+tests 60, review 20, fixes/docs/commit 20.
