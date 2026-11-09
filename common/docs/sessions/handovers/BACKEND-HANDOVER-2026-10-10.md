# Backend hand-over, 10 Oct 2026

Read `docs/BACKEND.md` first. It is now the ONLY backend document (stack, layers, database, security, wrapper, every route, module pattern, testing, environment, checklist, open work in section 13).

## Done this session
- Read the whole backend doc set, the project rules and the Next.js 16 route-handler docs; checked the real code layout (210 routes, services, repos memory/postgres, compose).
- Merged `Backend Review/*` (11 files), `docs/API.md`, `docs/api/*` (7), `DATABASE`, `SECURITY`, `ENVIRONMENT`, `ERROR_HANDLING`, `TESTING`, `MODULE-PATTERN` into `docs/BACKEND.md` and removed the old files with `git rm` (staged, NOT committed; they stay in git history). Stale content was corrected (Postgres not MySQL, plain data not sealed, no mobile).
- Updated pointers in `MASTER.md`, `docs/MASTER-PROMPT.md`, `docs/DECISIONS.md`, `docs/PROJECT-STATE.md`, `docs/README.md`.
- No code, tests or database were touched or run.

## Uncommitted state to commit
`docs/BACKEND.md` (new), the deleted files above, the five edited docs, this note, `docs/sessions/handovers/LEAD-NOTES-2026-10-10.md`. Do NOT commit `db/full-schema.sql`, `db/schema-part-*.sql`, `db/production/`, `pm-dashboard/`, `.gitignore` until reviewed for secrets/data (ask MJ).

## Next backend tasks (from PROJECT-STATE section 4 and BACKEND.md section 13), in order
1. Check half-edited files first with a single-file check, not full tsc: roles work (`services/admin/roleService.ts`, `repos/adminUsers.ts`, `repos/postgres/adminUsers.ts`, `repos/memory/adminUsers.ts`, `services/admin/userSchemas.ts`) and the Books files (`ui-shared/dashboards/overview.ts`, `BooksScreen.tsx`, `adapters/overview.ts`).
2. Finish roles icon/accent/inherits: the 5 steps in BACKEND.md section 13.
3. Payroll Master and Payroll Log editing.
4. System Health, System Log, Force Log viewers (+ `/health/deep`).
5. Profile emailed-code switch and signed-in `PUT /profile/password`.
6. Razorpay (needs MJ's keys), Website part 2 + media store, Guest (13 calls) and Corporate (17 calls) portal routes, Shift Handover, remaining recycle-bin adapters, remaining PDFs.
7. Small TODO: dev mail log file in `web-app/src/server/compose/mail.ts`.
8. Plain-data cleanup (U1) is not finished: sealing/last-4 code still in about 18 server files; decide per field with the Lead.
9. At the end: one full review and one full test run (3 GST-settings server tests were failing and never reviewed).

## Environment checks before building
`npm run db:pg -- status` then `ensure`; confirm `db/.env.local` and `web-app/.env.local` exist on this PC (else `npm run db:cli -- setup`).

## Rules to keep
Newest rule wins (`docs/DECISIONS.md`). Plain English, short. No constant test runs. Never print secrets. Keep `docs/BACKEND.md` as the single backend document and update it with every change.
