# Full-scope check and fix (task 11), plan of 11 Oct 2026 (MJ: "after completing all, run full scope check and fix all the issues")

Starts when tasks 1-10 of PLAN-COMPLETE-PROJECT.md are done (approvals A/B/D executed, guest menu + enquiry mail screens pushed, portals live-tested). Rules: no sub-agents, one task at a time, ONE review, then ONE fix round that fixes EVERYTHING found (no "later" except the keys/decision list), explicit-file commits, never secrets.

## Phase 1: machine checks (each owner runs, results written to docs/sessions/reports/FULL-CHECK-RESULTS.md as a table: command, result, failures)
| Owner | Commands |
|---|---|
| Backend | `npm run test:server`; `npm run test:db` (alone, one run); `npx tsc --noEmit` (whole project, with NODE_OPTIONS=--max-old-space-size=3072 if needed); `npm run lint:sql`; `npm run seeds:check`; migrations on a FRESH database AND on the existing dev DB (second run is a no-op) |
| Frontend 1 | root `npm test`; `npm run lint` (web-app); `npm run build` (production, with and without NEXT_PUBLIC_HMS_LOCAL_DEMO); tsc for web-app |
| Frontend 2 | eslint over all UI folders; type-check of ui-shared + adapters; docs links check (no dead file references in docs/UI.md, BACKEND.md, PROJECT-STATE.md) |

## Phase 2: review (read-only; one pass per owner; findings written with file:line, severity, proposed fix)
| Owner | Scope |
|---|---|
| Backend | every route family (auth, platform, group, hotel modules, portals, website, media): validation on every body, permission gate on every route, hotel id only from session/visit, money in paise, audit rows for every change, no secret/ID number in logs, rate limits, idempotency on creates, SQL parameterised, migration safety on live data (add nullable, backfill, NOT NULL), error sentences have fallbacks, no raw errors to the client |
| Frontend 1 | hotel dashboard, platform, group, super admin screens in REAL mode: every screen has loading/empty/error/offline; no hard-coded Hotel Sunrise names in real mode; no console or network errors on a tour of each login; all forms: labels, validation, double-submit protection; read-only visits hold on every screen |
| Frontend 2 | payroll, companies pieces, reports, website, guest and corporate portals, onboarding public pages: same list; night mode contrast; phone width; keyboard order; docs match the UI |

## Phase 3: ONE fix round
Each owner fixes ALL their findings (blockers, bugs, small items), re-runs only the checks touched, then the Phase 1 commands once more. Findings that belong to another owner go to that owner with file:line. Anything that truly needs MJ (keys, decisions) goes to the "Later" list, nothing else.

## Phase 4: final
1. Re-run the MODULE AUDIT (Frontend 2) -> new official percentage in docs/sessions/audits/AUDIT-2026-10-11.md and pm-dashboard/data/modules.json.
2. Refresh docs/PROJECT-STATE.md, docs/MASTER-PROMPT.md, docs/README.md, docs/BACKEND.md section 13 (what is done, what is later).
3. Each owner pushes with explicit file lists; Project Manager checks `git status` is clean and origin/main equals local main; no .env, db/.dev-*, db/production, dumps committed.
4. Project Manager publishes the final report page and tells MJ what remains (only keys and decisions).

## Percent basis
Phase 1 25, Phase 2 25, Phase 3 40, Phase 4 10.
