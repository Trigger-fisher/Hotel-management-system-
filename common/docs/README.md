# HMS documentation index

**Pilot scope (MJ, 06 Oct 2026): web app only. There is NO mobile app; the Mobile App folder and mobile-only files were deleted. Older documents below that mention a mobile app, Expo or the bottom dock are history and no longer apply.**

Start here when you are new (or when MJ opens a new Claude session): paste `MASTER-PROMPT.md`.

## The main documents (this folder)

| File | What it is |
|---|---|
| `MASTER-PROMPT.md` | The prompt to paste into a new session so nobody has to re-explain anything |
| `DECISIONS.md` | Every binding decision by MJ (newest wins), open questions, what is superseded |
| `PROJECT-STATE.md` | Repository layout, how to run it, what is done, the exact list of what is not |
| `BACKEND.md` | **The one backend document**: stack, layers, database, security, API wrapper and every route, module pattern, testing, environment, checklist, open backend work. Keep it current; do not add other backend docs |
| `UI.md` | The one UI guide: theme, Bootstrap, shell, helpers, how to write a screen, known UI gaps |
| `ENVIRONMENT.md` | Every setting the server reads, which are required in production, pool sizing |
| `OPERATIONS.md` | Running it: health and readiness, logs, backup and restore check, shutdown, incidents |
| `SECURITY.md` | Security rules and how they are met |
| `PRODUCT-PLAYBOOK.md` | Product and hotel-domain background, roles, early decisions log |
| `../MASTER.md` | The older rulebook from 4 Oct (partly superseded; see DECISIONS.md) |

## Folders (17 Oct 2026: sorted by kind, MJ)

| Folder | What is in it |
|---|---|
| `deploy/` | Going live: `DEPLOY-VPS.md`, `DEPLOY-HOSTED.md` (Vercel), `SUPABASE-MOVE-2026-10-18.md` (the database), `WEBSITE-CONNECT.md` |
| `pathik/` | Pathik (police guest register): the plan, the online runner, the PC worker, the test steps, the privacy review |
| `plans/` | Plans, research and designs: product improvement plan, production-ready plan, platform console, speed, component library, the 17 Oct work plan, front-desk requirements, the R48 shell design, the UI library master list (`UI-LIBRARY-MASTER-LIST-2026-10-24.md`, research only), the WhatsApp plan (`WHATSAPP-PLAN-2026-10-24.md`) and the Conversations plan (`CONVERSATIONS-PLAN-2026-10-24.md`: one inbox for email and WhatsApp), both plan only and waiting for MJ's decision |
| `specs/` | Behaviour of each module, ported from Pallav (file and line references) |
| `design/` | The UI standard and Pallav parity reviews (`design/ui-review/`, formerly `UI Review/`), the first Pallav UI review |
| `fixes/` | Write-ups of specific production fixes (sign-in 500 from instrumentation, 2FA mail sender) |
| `sessions/orders/` | Orders and briefs given to sessions, MJ's request lists |
| `sessions/handovers/` | Hand-overs, stop and pause notes, lead notes, resume notes |
| `sessions/reports/` | Work reports and results of each session and run (S02 to S08, B5 to B8, production pass, speed, stabilisation, live checks) |
| `sessions/audits/` | Audits, walks and check lists (screens, components, search, mobile, consistency, refresh) |
| `sessions/assets/` | Pictures and data the session documents use: Pallav's demo data as JSON (`S08-fixtures/`), screenshots, frame captures, report sources |

Where to start for: the newest hand-over, `sessions/handovers/`; the last checks of a feature, `sessions/reports/` and `sessions/audits/`; what MJ asked, `sessions/orders/`.

Note: the last section of PROJECT-STATE.md and DECISIONS.md lists the few dormant mobile traces still in the code and how to clean them.
