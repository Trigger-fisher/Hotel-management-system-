# Lead / planner notes, 10 Oct 2026

Written by the Lead at the start of a new session on the new PC (`D:\Hotel Management System`). Source: MASTER-PROMPT.md, PROJECT-STATE.md, DECISIONS.md, git status. Nothing has been built or run in this session yet.

## 1. Where we are
- Last real work: 06 Oct 2026 (usage limit hit). The last commits are doc and folder-rename only (`Web App` -> `web-app` for Vercel, mobile app removed, speed findings documented).
- Pilot = web app only (Next.js 16) + PostgreSQL 18 (own instance, port 5433). No mobile app. No data encryption. Pallav data not imported.
- Done: database, server for most modules, every web screen rebuilt in Pallav's markup. Mostly still on mock data; only sign-in, preferences, search and cash are wired.
- Not done: exact list is `docs/PROJECT-STATE.md` section 4.

## 2. What changed on this machine (must check first)
| # | Observation | Action |
|---|---|---|
| 1 | Repo is now at `D:\Hotel Management System` (docs say `C:\Users\infoj\Desktop\HMS`) | Treat doc paths as old; do not "fix" them everywhere |
| 2 | Memory folder is empty, so nothing carried over | Save the key facts (see section 6) |
| 3 | Uncommitted: `.gitignore` (M); untracked `db/full-schema.sql`, `db/schema-part-1..3.sql`, `db/production/`, `pm-dashboard/` | Find out what they are (looks like a production-schema export for deploy, and a PM dashboard tool). Review before any commit; they may contain data or secrets |
| 4 | `pm-dashboard/` has `tasks.json`, `registry.json`, `snapshot.json`, `briefs/` | Not in any HMS doc; ask MJ whether it is his (Atlas) tracker, and whether it should be in git |
| 5 | Secrets: `db/.env.local`, `web-app/.env.local` are git-ignored; MJ's backup was in `C:\Users\infoj\Desktop\HMS-secrets-backup\` | Confirm they exist on this PC; otherwise regenerate with the setup commands in PROJECT-STATE section 2 |
| 6 | `web-app/node_modules` exists; DB instance state unknown | `npm run db:pg -- status` then `ensure` |

## 3. Rules I am working under (newest wins, DECISIONS.md)
- Plain English, short, tables. No guessed percentages: per-page status + reviewer pixel scoreboard.
- Push to `main` when a piece finishes; never force-push; never commit secrets (`git add -A -n` first).
- No constant test or type-check runs; one full review and one full test at the end.
- Max 2 to 3 sessions at once (8 GB RAM). Web first, then backend gaps.
- MASTER.md R2 / R3 / R9 are superseded (no "wait for go", no commit gate).
- Never touch Pallav's MySQL.

## 4. Plan (in order)
1. Resolve the untracked files (section 2, items 3 and 4). Do not commit blind.
2. Start environment: db `ensure`, `npm run dev`, confirm `http://localhost:3000`.
3. Check possibly half-edited files: Books move (`ui-shared/dashboards/overview.ts`, `BooksScreen.tsx`, `adapters/overview.ts`) and roles icon/accent/inherits (see `WORKER-B-STOP-NOTE.md`). Last commit says the roles type error was fixed in a test; verify with a single-file check, not a full tsc.
4. Brief sessions (ask MJ which are open and their roles):
   - Worker B: finish roles; Payroll Master/Log; System Health/Log/Force log; Razorpay; profile emailed-code switch + `PUT /profile/password`; Website part 2; Guest (13 calls) and Corporate (17 calls) portal routes; Shift Handover; remaining recycle adapters; remaining PDFs.
   - Web UI 1: speed fixes S1/S2 first (preload groups on idle, keep old screen until new one is ready, search on all dashboards, open exact record), then pixel fixes above 1.5%, wire billing and front office.
   - Web UI 2: finish Books move, live-test wired groups, then admin, website, portals.
   - Reviewer: only when a screen needs a pixel check.
5. Small TODO from the state doc: make the dev mail driver also append sign-in codes to git-ignored `db/.dev-mail.log` (`web-app/src/server/compose/mail.ts`).
6. When web is complete: real integrations (SMTP, Razorpay, Google; need MJ's keys), final full review + test, mobile-trace cleanup, deploy plan (Hostinger VPS, or Vercel since the folder was renamed for it; ask MJ which).

## 5. Open questions for MJ
| # | Question | My recommendation |
|---|---|---|
| A | What are `db/full-schema.sql`, `db/schema-part-*.sql`, `db/production/`, `pm-dashboard/`? Commit them? | Keep `db/production` and schema files only if secret-free; keep `pm-dashboard` out of git unless you want it |
| B | Deploy target: Hostinger VPS (docs) or Vercel (folder rename suggests it)? Vercel can't run HMS's own Postgres with per-hotel roles, so a hosted Postgres would be needed | Decide before deploy planning; does not block web work |
| C | Which Claude sessions are open now, and which roles? | I brief each from its stop note |
| 33 | Live weather in top bar (Open-Meteo, free) | Yes |
| 36 | Rupee grouping Pallav 126,000.00 vs lakh 1,26,000.00 | Keep Pallav's |
| 25 | Website enquiry limits | 5 per hour per visitor |
| 34 | Hotel User sees Reports? | Yes, hideable by permission |

## 6. To remember (for the memory folder)
- Role: I am Lead/planner for MJ; coordinate sessions; own `ui-shared/`, docs, decisions.
- MJ's working style: see section 3. Newest rules in `docs/DECISIONS.md` and `docs/MASTER-PROMPT.md`.
- Repo moved to `D:\Hotel Management System` on 10 Oct 2026.

## 7. Risks
- Half-edited files from 06 Oct (Books, roles) could hide type errors; whole-project `tsc` can run out of memory (use the `NODE_OPTIONS` command in PROJECT-STATE section 5).
- Web screens are mostly mock-wired: "looks done" is not "works live". Live-server testing per group is the real gap.
- 8 GB RAM and a nearly full C: drive; limit sessions and clean temp screenshots/Chrome profiles.
