# Folder move and docs sort, 17 Oct 2026 (MJ's order; done by session D)

**For every session: reopen in `D:\Hotel Management System - Pilot`.** The old `D:\Hotel Management System` is gone (only an empty `web-app` shell may be left until session D's window closes; delete it then).

## What moved

- The whole project folder, item by item (git history kept, `main` unchanged apart from the docs commit). Code folders `web-app`, `ui-shared`, `db`, `pathik`, `python` are exactly as before: Vercel, imports and scripts are unaffected.
- `docs/` sorted by kind (index: `docs/README.md`): the main documents stay in `docs/`; new `deploy/`, `neon-sql/`, `pathik/`, `plans/`, `fixes/`, `design/` (formerly `UI Review/` and `documentation/`), and `sessions/orders`, `sessions/handovers`, `sessions/reports`, `sessions/audits`, `sessions/assets`. 392 links in code comments and docs point to the new places. Applied migrations and seeds keep their old comments (their checksums must not change).
- Loose HMS files from `D:\` (old SQL, notes, the Pathik worker token, scratch files, the `hms-*` snapshot and hotel-setup folders) are in `_local/`, which `.gitignore` keeps out of git. See `_local/README.md`.
- Untracked docs of other sessions moved with the rest and are still untracked: `docs/neon-sql/NEON-SQL-0031-GUEST-ROUND3.sql`, `docs/plans/FRONT-DESK-REQUIREMENTS-2026-10-17.md`, `docs/plans/R48-SHELL-DESIGN.md`, `docs/plans/WORK-PLAN-2026-10-17.md`, `docs/sessions/audits/MOBILE-AUDIT-2026-10-12.md`, `docs/sessions/assets/img/`.

## Checked from the new folder

Unit tests 191/191, server tests 1882 pass / 0 fail, TypeScript clean (a stale `web-app/.next/dev` cache from an old dev-server run lists deleted routes; it is rebuilt by the next dev run). The other sessions' git worktrees were repaired (`git worktree repair`). `pm-dashboard/tools/guest-shots.mjs` points at the new folder.

## Not done

The docs commit is local only: push when the PM or MJ says so. Old addresses in session history docs (what happened back then) were left as written.
