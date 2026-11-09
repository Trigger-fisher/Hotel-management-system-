# Project Manager handover, 12 Oct 2026 (session at its token limit; MJ opens the next one)

Written by the outgoing Project Manager session from what it actually did. Verify against `git status` and the files before you trust any line.

## 1. What MJ asked this session to do (in order)
1. Act as master project manager; read all documents, especially the planner ones.
2. Build a good-looking dashboard to control the project: tasks, live report of done/pending overall and per person, in the Hotel Pallav theme.
3. Make it able to start new Claude sessions, keep them after a PC restart, show tokens per session live, hand over automatically at 5 lakh (500000) tokens into a new session of the same role, no hallucination, low token cost; project manager decides sub-agents (max 2, only if required); sessions use only Haiku, Sonnet, Opus (latest, medium effort); old session hands over before a new one starts; a chatbot for the project manager in a cloud (artifact) copy usable from anywhere.
4. "Make it more premium and accurate."
5. "Remove the employee user full, I do not want to give it in the pilot."
6. "Wait, I will create a new session" (this handover).

## 2. What exists (all under `pm-dashboard/`, NOT committed)
| File | What |
|---|---|
| `server.mjs` | Local server, 127.0.0.1:4100, no packages. Tasks, session registry, live tokens, launcher, auto handover, snapshot for the cloud copy. REWRITTEN today after the review (see section 4). **Not yet restarted on the new code.** |
| `lib/usage.mjs` | Reads `~/.claude/projects/<folder>/<id>.jsonl` incrementally; counts each message id once; main conversation vs sub-agents; cache re-reads shown separately. Tested on real files. |
| `lib/handover.mjs` | Builds the handover from recorded facts only (prompts, last reply, files and commands that succeeded, task state, git). Rewritten after review; **not yet run on a real transcript after the rewrite.** |
| `index.html` | Premium local dashboard. **Still has the UI findings listed in section 5.** |
| `pm.mjs` | `node pm-dashboard/pm.mjs doing\|review\|done <taskId> ["note"]` lets a session update the dashboard without a model. |
| `start-dashboard.cmd`, `install-autostart.cmd` | Start now / start at Windows sign-in (installer written, **never run**). |
| `data/tasks.json` | 53 tasks (seeded 9 Oct from the docs; roles are the old names, see 5). `data/modules.json`: 22-module audit of 9 Oct. `data/config.json` holds a secret admin key: git-ignored, never print it. |

Cloud copy (artifact, private): https://claude.ai/artifact/YaWHRjwVFMSRV3xVLq3v9Q . It shows a snapshot pushed by this session, can queue task changes and session requests (`requests` collection), and has a chat with the project manager (uses the page's own Claude access). It cannot reach the PC by itself. Sync is done by the Project Manager session: read `pm-dashboard/data/snapshot.json`, `ArtifactData set snapshot/current` with file_path; list `requests` with status pending, apply with POST /api/apply (header X-PM-Admin = the key in data/config.json), mark them applied. Last sync 9 Oct (stale).

## 3. Verified vs not verified
Verified by running it (9 Oct): token counting on this machine's real session files; handover file generation (first version); the exact claude flags (`--session-id --model claude-haiku-5-5 --effort medium --disallowedTools Agent --name ... prompt`) with one real Haiku call; `--session-id` creates the transcript where the reader looks; server API with token and admin key; screenshot of the local page.
NOT verified: opening a real terminal window (the tool environment has no desktop). The review found the window launch was broken for paths with spaces (fixed in code today, untested). Auto handover has not run end to end. `install-autostart.cmd` never run. Cloud page chat never used.

## 4. Review result (3 independent reviewers + second-reader check, 33 confirmed findings)
Already fixed in `server.mjs`, `lib/usage.mjs`, `lib/handover.mjs`, `pm.mjs` today: window launch quoting for folders with spaces + BOM script; previous session stays active until the new session's file appears (else marked failed); lost-update race (re-read and write synchronously after slow work); resume runs from the conversation's own folder; quiet check uses sub-agent activity too; effort fixed to medium; monotonic task order; correct previous-session choice and generations; auto-rotate backoff per session; git failures no longer shown as "clean"; handover lists only successful actions, includes queued prompts, skips compaction summaries; own-property checks; clickjacking and CSP headers and Origin check; metric named in handover; completion note appended, not replacing task notes.
STILL OPEN (index.html): refresh skips render and goes stale while a modal/select is focused (set `last` only after rendering, re-render on close); full innerHTML re-render destroys two-click confirms and in-flight buttons; render errors reported as "server not reachable"; relative times do not refresh (add minute bucket to key); banner ignores per-session auto-handover flag; over/warn derived from rounded pct (use `s.over` which the server now provides, and floor the percent); sparkline and limit line follow different metrics (label it); modal needs aria-labelledby, focus trap, submit guard. Sub-agent cap of 1 or 2 is an instruction only (only 0 is enforced by disabling the tool); say so in the UI.

## 5. Decisions and facts the next session must respect
- Decision 50 (MJ 12 Oct): NO sub-agents in any session for now. The server now defaults `allowAgents=false`, so every session starts with the agent tool disabled. The earlier "up to 2" plan only applies if MJ turns agents on.
- Decision 58 (new, MJ 12 Oct): **Employee User role removed from the pilot.** Done: `ui-shared/auth/types.ts`, `ui-shared/auth/copy.ts`, `ui-shared/auth-pallav/mock.ts` (type, copy, demo user, quick-login rows), `db/scripts/create-user.ts`, `web-app/src/dashboards/pallav/PallavShell.tsx`, `services/platform/views.ts`, `services/platform/userService.ts`, `repos/memory/platformConsole.ts`, `repos/postgres/platformConsole.ts`, `MASTER.md`, `docs/PRODUCT-PLAYBOOK.md`, `docs/DECISIONS.md` (decision 58). New migration `db/migrations/platform/0115_remove_employee_user.sql` (converts any such account to Hotel User, replaces the role CHECKs, history checks NOT VALID). **Not run:** no type-check, no tests, migration not applied. Other sessions edit the same tree at the same time (platform console files, `BillsScreen.tsx` were changing). Before applying 0115, check no other session created a 0115 file; run `npm run db:cli -- migrate` on the dev database, then one type-check of web-app and the platform tests. Payroll "employee" staff records are a different thing and were not touched. Old docs under `docs/specs` may still mention the role in passing.
- The role list in the dashboard is now: Project Manager, Backend, Frontend 1, Frontend 2, Pathik UI, d7 (+ the older Worker B / Backend 1 / Web UI 1 / Web UI 2 / Reviewer kept so the 53 seeded tasks still have an owner). Reassign tasks to the current names, or add roles in `pm-dashboard/data/owners.json`.
- Token limit rule: 500000 counted on the session's own conversation (new input + new cache writes + output); sub-agent tokens are shown separately; cache re-reads are never counted. This outgoing session was at about 99 percent (493k) of that limit and also used about 1.4M tokens in sub-agents for the 9 Oct audit.

## 6. Next steps, in order
1. Restart the server on the new code: stop the old `node server.mjs`, run `pm-dashboard/start-dashboard.cmd`; open http://127.0.0.1:4100; check the page loads and `/api/state` works.
2. Test auto handover safely with `PM_DRY_RUN=1` and a synthetic transcript over the limit (older than 25 s): expect handover file, new session record `launchPending`, previous session retired only after the new file appears.
3. Test one real window launch by hand with Start session for a role (MJ decides), confirm the window opens in `D:\Hotel Management System`, and the new transcript appears.
4. Fix the open index.html findings (section 4), then re-run a small review.
5. Employee User: apply migration 0115 and verify (section 5).
6. Run `install-autostart.cmd` only if MJ agrees; re-sync the cloud copy and fix its equivalent UI points; republish.
7. Reassign the seeded tasks to the current session names; re-run the 22-module audit (9 Oct data is old: many other sessions have changed the code since, e.g. platform console, Pathik, portals).
8. Do not commit or push: `docs/DECISIONS.md` says nothing is pushed until the Project Manager says during the final hold.
