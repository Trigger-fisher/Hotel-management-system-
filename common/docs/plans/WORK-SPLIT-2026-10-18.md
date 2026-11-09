# Work split with helper agents (PM, 18 Oct 2026)

MJ: add agents to go faster, and divide the work so nobody does the same thing twice.
This lifts decision 50 (no sub-agents) for the work below: each session MAY use up to 3 helper agents, only inside its own area. One owner per file set; nobody edits another lane's files.

## Lanes (owner = the session; its helpers work only inside the lane)
| Lane | Owner | Helpers (each a separate, non-overlapping slice) | Files the lane owns |
|---|---|---|---|
| 1 Staff mobile (phase 3) | C (claude-5a) | H1: Dashboard + Billing/bills + cash books; H2: Ledgers + Payroll + Reports; H3: Front Office + Companies + Admin/Settings screens | the screen files of those groups; the SHARED kit (AppKit, PallavShell, hms-overrides.css, nav.ts, routes.ts) is edited ONLY by C itself, never by a helper |
| 2 Platform/Group mobile (phase 4) | B (claude-11) | H1: platform console screens; H2: group console screens | groups/platform/*, groups/group/* screen files only; uses C's kit as it is (asks C for kit changes) |
| 3 Mail | A (Backend) | H1: suppression list + bounce/complaint webhooks + auto-pause; H2: campaign engine (chunks, pause/resume/cancel, progress) | server mail/*, services for mail and campaigns, their tests; migrations: hotel 0044, platform 0130 reserved for A |
| 4 Shell + QA | d3 | H1: ?hotel= page-address parameter (routes.ts rule + proxy.ts, coordinated with C for routes.ts); H2: the final combined checks and sweeps | shell/reload/address code, pm-dashboard/tools |

## Rules for every helper
- Work in its own git worktree (separate checkout, own npm ci, no junctions into the Pilot folder); remove it with `cmd /c rmdir /s /q`.
- Touch only the files of its slice; if it needs a change elsewhere, it asks the lane owner, who asks the other owner.
- Commit with the lane prefix, own paths only (`git add <paths>`, never -A); the lane owner merges helper commits into the Pilot folder in order and runs the lane's tests.
- No dev DB changes, no migrate, no push. Throwaway hms_test only, and only after asking the other lanes to hold it.
- Migration numbers: only A creates hotel/platform migrations in this round (0044 / 0130); anyone else who needs one asks the PM first.
- Each lane reports to the PM after each slice: what is done, tests run, what is left. The PM keeps the overall list; no lane starts a slice listed under another lane.
