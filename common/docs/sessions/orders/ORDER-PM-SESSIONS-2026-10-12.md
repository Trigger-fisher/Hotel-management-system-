# Orders for four new sessions (from the Project Manager, 12 Oct 2026)

Each session reads ONLY its own section plus the shared reading list. Sessions A to D own different files, so they can work at the same time without touching each other.

## Shared reading list (everyone, in this order, before touching anything)
1. `docs/DECISIONS.md` (all decisions, especially 33 to 58; newest wins; where it disagrees with `MASTER.md`, DECISIONS wins).
2. `docs/PROJECT-STATE.md`.
3. `docs/sessions/handovers/HANDOVER-PM-2026-10-12.md` (what the previous Project Manager session did, what is verified and what is not).
4. `docs/MASTER-PROMPT.md`.
5. Your section's extra reading below.
Then reply in 10 lines or fewer: what you understood, what you will do first, and anything unclear. Do not start work before that reply.

## Rules for all four (from MJ)
- Plain English, short answers, tables. No jargon without a one-line meaning.
- NO sub-agents (decision 50). Do the work yourself.
- Do only your tasks. Do not edit files owned by another session (listed per section).
- Run only the single file or test you changed. No full test suite, no repeated whole-project type-check. One type-check per finished task is fine (`NODE_OPTIONS=--max-old-space-size=3072 npx tsc --noEmit -p . --incremental --tsBuildInfoFile %TEMP%\hms-web.tsbuildinfo` from `web-app/`).
- Never print or write passwords, keys or sign-in codes. `pm-dashboard/data/config.json` holds a secret admin key: never print it, never commit it.
- Do NOT commit or push (nothing is pushed until the Project Manager says).
- Never guess. If a file, route or number matters, open it and check. If unsure, say so.
- Other sessions (Backend, Frontend 1, Frontend 2, Pathik UI, d7) are editing the repository right now. Run `git status` first; never revert or overwrite changes you did not make.
- Finish by reporting in 5 lines: what changed, what was tested (and what was NOT), problems, next step. When the Command Centre server is running, mark your tasks: `node pm-dashboard/pm.mjs doing|review|done <taskId> "note"`.

---

## A. Employee User removal: database and server check
Owns: `db/migrations/platform/0115_remove_employee_user.sql`, `web-app/src/server/**`, `web-app/tests/**` (only for this change), `db/scripts/create-user.ts`.
Dashboard task id: t064.
Extra reading: `Backend Review/00-RULES-FOR-BUILDERS.md`, `Backend Review/01-BACKEND-STANDARD.md`, `docs/DATABASE.md`, `db/migrations/platform/0006_account_role_and_subject.sql`, `0102_hotel_lifecycle.sql`, `0103_groups.sql`, `0107_platform_audit.sql`.
Background: MJ removed the Employee User role from the pilot (decision 58). The previous session already edited the code (list in the handover, section 5) and wrote migration 0115, but ran nothing.
Tasks, in order:
1. `git status`. Confirm no other session created another file numbered 0115 or higher in `db/migrations/platform` (if one exists, renumber ours to the next free number and say so).
2. Read 0115 line by line against the four role CHECK constraints it replaces. Confirm the auto-generated names (`hotel_status_history_actor_role_check`, `group_history_actor_role_check`, `audit_log_actor_role_check`) are the real ones on the dev database (query `pg_constraint`), and that `audit_log` is not partitioned in a way that breaks them. Fix the migration if anything differs. Never edit an already-applied migration.
3. Start HMS's own PostgreSQL (`npm run db:pg -- ensure` in `web-app/`), apply with `npm run db:cli -- migrate` on the DEV database. Confirm: no user has `employee_user`, the new constraints exist, old history rows still read.
4. Search the whole repository (code, tests, docs/specs, fixtures) for `employee_user`, `Employee User`, `employee landing`, quick-login `employee`. Remove what remains, except payroll "employee" staff records (different thing) and old migrations (immutable).
5. One type-check of `web-app`. Run only the test files that touch platform users, roles or the platform console. Report failures with their owner; do not fix other sessions' code.
Done when: migration applied, constraints verified, no leftover reference, type-check clean (or failures listed).

## B. Command Centre engine: restart and end-to-end tests
Owns: `pm-dashboard/server.mjs`, `pm-dashboard/lib/*`, `pm-dashboard/pm.mjs`, `pm-dashboard/*.cmd`. Does NOT edit `index.html` (session C).
Dashboard task ids: t060, t061, t062, t067.
Extra reading: every file in `pm-dashboard/` (`server.mjs`, `lib/usage.mjs`, `lib/handover.mjs`, `pm.mjs`), and section 3 and 4 of the handover.
Tasks, in order:
1. Stop the old `node server.mjs` that is still running the old code, start the new one (`pm-dashboard/start-dashboard.cmd`), check `http://127.0.0.1:4100` and `/api/state` work. Fix any startup error in the rewritten `server.mjs`.
2. Run `lib/handover.mjs` on a REAL transcript (the previous Project Manager session file under `~/.claude/projects/d--/`) and read the output: it must contain no invented facts, list only successful files and commands, and name the prompts MJ typed. Fix defects.
3. Dry-run test of automatic handover with `PM_DRY_RUN=1` in a throwaway copy of `data/` (do not touch real registry data): a synthetic transcript over the limit and older than 25 seconds must produce a handover file and a new session record in `launchPending`; the old session must be retired only after the new session's conversation file appears, and marked failed after two minutes if it never does. Test also: two ticks at once, a failed launch, restart of the server in the middle (registry must survive).
4. With MJ present, start ONE real session from the dashboard and confirm a window opens in `D:\Hotel Management System` with the right model and the agent tool disabled (decision 50). Test Resume on that session after closing its window, and on an adopted session stored in the drive-root folder.
5. Only if MJ agrees: run `install-autostart.cmd`, restart Windows, confirm the dashboard and the sessions list are back.
Done when: each test above has a written result (pass, or the defect and its fix).

## C. Command Centre interface and cloud copy
Owns: `pm-dashboard/index.html` and the cloud artifact https://claude.ai/artifact/YaWHRjwVFMSRV3xVLq3v9Q (read it with the Artifact tool, action read; build on what comes back). Does NOT edit `server.mjs` (session B); if you need a server change, ask B or the Project Manager.
Dashboard task ids: t063, t065.
Extra reading: `pm-dashboard/index.html`, section 2 and 4 of the handover. The Artifact tool's design and capability notes load with the Artifact tool.
Tasks, in order:
1. Fix the open interface findings (handover section 4, "STILL OPEN"): stale data while a pop-up is open (set `last` only after rendering and re-render on close); full re-render destroying two-click confirms and in-flight buttons (keep armed state across renders, disarm after 5 seconds, per-button in-flight guard); render errors wrongly shown as "server not reachable"; relative times that never refresh; the automatic-handover banner ignoring each session's own flag; use the server's `s.over` and floor the percent; label the sparkline as conversation tokens and draw the limit line only when the counted metric is the conversation; dialog `aria-labelledby`, Tab focus trap, double-submit guard; failed and handing-over session states; the Sub-agents text must say that 1 or 2 is an instruction, only "none" is enforced; show the new role names. Honour decision 50: the sub-agent selector offers only "None" unless `S.config.allowAgents` is true.
2. Check the page at desktop and phone width, light and dark, once. Keep every number exact.
3. Make the same corrections in the cloud artifact where they apply (stale banner, role names, agents), then republish to the SAME URL. The cloud copy cannot reach the PC; keep the honest wording about the last sync time.
Done when: the local page and the cloud page both load without console errors, and each finding is fixed or listed as not fixed with a reason.

## D. Project audit and task board refresh (read-only on code)
Owns: `pm-dashboard/data/tasks.json`, `pm-dashboard/data/modules.json`, and a new report `docs/sessions/audits/AUDIT-2026-10-12.md`. Does NOT edit application code, `server.mjs` or `index.html`.
Dashboard task id: t066.
Extra reading: `docs/API.md`, `docs/api/*.md`, `docs/sessions/reports/HOTEL-REAL-WIRING.md`, `docs/sessions/reports/PLATFORM-REAL-WIRING.md`, the newest `docs/sessions/ORDER-*.md` files, `docs/design/ui-review/17-PARITY-SCOREBOARD.md`.
Background: the 22-module audit in `data/modules.json` is from 9 Oct and the task list was seeded from the 9 Oct documents. Many sessions have changed the code since (platform console, portals, Pathik, wiring).
Tasks, in order:
1. Redo the module audit yourself (no sub-agents), module by module, from the code only: database (tables and a Postgres repository), server (services and routes), web screens, wiring to the server. Add modules that now exist (Platform console, Pathik, Guest portal, Corporate portal if built, Hotel website). Each status is done, partial, none, or unknown, with a one-line evidence path. Re-check every gap you list by searching for it once more before writing it. Write `data/modules.json` in the same shape as the current file (`{checkedAt, items:[{module, database, backend, screens, wiring, gaps, evidence}]}`; use `checkedAt` = the current time in milliseconds).
2. Compare `data/tasks.json` with the real state and the newest orders. Mark finished tasks done, correct wrong notes, add missing open work, and reassign owners to the CURRENT session names (Backend, Frontend 1, Frontend 2, Pathik UI, d7, Project Manager). Keep ids stable. Do not invent work: every task must trace to a document or to code you opened.
3. Write `docs/sessions/audits/AUDIT-2026-10-12.md`: a table per module, the ten largest gaps in plain English, and what you could not verify.
Done when: modules.json and tasks.json are valid JSON that the dashboard loads, and the report lists every claim with a file path.
