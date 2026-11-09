# Hotel Management System (HMS)

A multi-hotel management system rebuilt from Hotel Pallav: billing, front office, cash book, companies/CRM, payroll, reports, administration, the hotel website's back office, Guest and Corporate portals, and a Platform / Group console that onboards and oversees hotels. Web only (Next.js); there is no mobile app.

## Where to start
1. `common/docs/DECISIONS.md` (binding decisions) and `common/docs/PROJECT-STATE.md` (what is done, how to run it).
2. `common/docs/UI.md` (the one UI guide), `common/docs/BACKEND.md` (the one backend document).
3. `common/docs/plans/PLAN-COMPLETE-PROJECT.md` (the open work, in order).
`MASTER.md` is older; the three files above win where they differ.

## Layout
| No. | Folder | What |
|---|---|---|
| 1 | `website/` | The company website (not started) |
| 2 | `web-app/` | The web app: Next.js 16 app with screens (`src/dashboards`), server (`src/server`), API routes (`src/app/api/v1`) |
| 3 | `desktop-app/` | The desktop app (not started) |
| 4 | `security/` | Security reviews and notes |
| 5 | `ai/` | AI and reading services (the planned ID-reading service) |
| 6 | `other-features/` | Features that belong to none of the above |
| 7 | `website-templates/` | The hotel websites: 10 templates, the shared site kit, one folder per hotel (not started) |
| | `common/` | Everything the folders above share: `common/db/` (PostgreSQL migrations, seeds, scripts), `common/ui-shared/` (contracts shared by screens and server), `common/scripts/` (the mail worker), `common/docs/` (project documents; start with `common/docs/GENERAL.md`) |

Each of the seven folders keeps its own documents in its own `docs/` folder.

## Run (Windows, PowerShell, from `web-app/`)
- Test mode (fake data, no database): `npm run dev`, open `http://localhost:3000` (the website; **Sign in** at the top right, or `http://localhost:3000/login`). Password `Demo@Pass2026`, emailed code `123456`; users `mihir`, `anita`, `staff`, `guest`, `corporate`, `platform`, `superadmin`, `groupadmin` (the sign-in page lists them).
- Real mode: `npm run db:pg -- ensure`, `npm run db:cli -- setup`, then `/login?api=real`. Dev logins are written to `common/db/.dev-login.txt` (git-ignored; never commit or print it).
- Checks: `npm run test:server`, `npm run test:db` (alone), `npx tsc --noEmit`, `npm run lint`.

## Status (11 Oct 2026; refreshed before the release tag)
| Check | Result |
|---|---|
| Module audit (`common/docs/sessions/audits/AUDIT-2026-10-11c.md`, 31 modules) | 87.9% overall: Database 91.7, Server 93.3, Screens 98.2, Wiring 68.3 |
| Shared Components (`npm run check:shared`) | 0 violations |
| Demo strings in the production bundle | 0 |

Audit evidence: `cd web-app && node scripts/audit-modules.mjs` (procedure: `common/docs/sessions/audits/AUDIT-CHECKLIST.md`). Hosting: Vercel plus Supabase first, for testing, at https://www.easyhotelsolutions.in (`common/docs/deploy/SUPABASE-MOVE-2026-10-18.md`, reference `common/docs/deploy/DEPLOY-HOSTED.md`), then MJ's VPS (`common/docs/deploy/DEPLOY-VPS.md`).

Secrets, `.env*`, `common/db/production/` and `common/db/.dev-login.txt` are never committed.
