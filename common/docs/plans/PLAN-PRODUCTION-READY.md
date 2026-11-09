# Plan: fix everything, clean up the code, make it production ready (11 Oct 2026, MJ order)

Rules: DECISIONS #26-#35 (no sub-agents, one task at a time, write all code, one review, fix once, explicit-file commits, never secrets). No NEW libraries or tools without MJ's OK (use tsc / eslint rules / grep for dead code). Hosting is still MJ's decision: everything must be deployable to EITHER a VPS (node + own PostgreSQL) OR a Vercel-style host (hosted PostgreSQL), so the runbook covers both and nothing assumes one.

## Definition of "production ready" (all must be true)
1. FAILS CLOSED: in NODE_ENV=production the app refuses to start when a required variable is missing/weak (database URLs, hash key, public URL, mail config, cookie secret); dev-only switches are ignored or fatal (HMS_DEV_RELAX_LIMITS, NEXT_PUBLIC_HMS_LOCAL_DEMO, log mail driver, dev links, mock mode, quick login, db/.dev-*).
2. SECURE BY DEFAULT: security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors), cookies httpOnly+secure+sameSite, CSRF/origin check on writes, rate limits on every public route, request size limits, no stack traces or raw errors to clients, no secrets/ID numbers in logs, dependency audit clean (npm audit: no high/critical, or documented).
3. CLEAN CODE: no dead code, no unused exports/files/imports, no console.log, no TODO/FIXME without an owner in a doc, no commented-out blocks, no leftover mobile/Neon/MySQL/Pallav-import remnants, no duplicate logic, consistent naming; eslint + tsc strict clean with unused checks on.
4. OPERABLE: health and ready endpoints, structured logs with traceId, graceful shutdown, migration runbook (apply, rollback notes, backup first), backup and restore procedure written and TESTED on a dev copy, environment reference (docs/ENVIRONMENT.md complete), deploy runbook for VPS and for Vercel-style hosting, a smoke-test script.
5. FAST ENOUGH: pagination everywhere lists can grow, indexes on every FK/filter column, no N+1 on the main screens, production build bundle sizes recorded, images/photos served with cache headers.
6. PROVEN: production build (`next build` + `next start`, NODE_ENV=production) against a real database passes a scripted smoke test of every console (sign-in, one read and one write per module); full tests green; fresh-database migration and second-run no-op; migrations on the dev DB.

## Tasks (owner, order)
| # | Task | Owner |
|---|---|---|
| P1 | Production boot checks + config validation (single env module, fail closed), dev switches fatal/ignored in production, tests | Backend |
| P2 | Security hardening: headers/CSP, cookies, origin/CSRF check, rate-limit coverage, size limits, error sanitising, log redaction audit, `npm audit` result | Backend |
| P3 | Performance + data: pagination audit, index audit (every FK and filter column), N+1 scan of main routes, long-running query limits, connection pool sizing doc | Backend |
| P4 | Operability: health/ready, graceful shutdown, structured logs, migration runbook, backup/restore script + test on a dev copy, ENVIRONMENT.md, DEPLOY runbooks (VPS + Vercel-style), smoke-test script | Backend |
| P5 | Server code cleanup: dead code, unused exports/files, console.log, TODO/FIXME, leftovers (mobile, Neon, MySQL, import), duplicates; docs updated | Backend |
| F1 | Frontend production build hygiene: dev/mock/demo code excluded from production (mock stores, quick login, DemoPanel, /dev routes, local-demo badge), env flags, bundle size report, error boundaries on every console, no console.log, robots noindex until MJ decides, cache headers | Frontend 1 |
| F2 | Hotel/platform/group/super admin UI code cleanup: unused exports/components/CSS, duplicated helpers, leftover TODOs, hard-coded demo names, stale comments; docs/UI.md updated | Frontend 1 |
| F3 | Payroll, companies, reports, website, portals, onboarding UI code cleanup (same list), adapters tidy, ui-shared contracts: remove dead types and unused mocks that are not needed by tests or the demo | Frontend 2 |
| F4 | Accessibility and UX completion: every state, every message with a fallback, copy review (plain words, no raw codes), final night/phone pass | Frontend 2 |
| X1 | PROVEN: production build smoke test of every console + full test run + fresh and existing DB migrations + one fix round for what it finds | Backend leads, both Frontends |
| X2 | Final: re-run the module audit, refresh docs (PROJECT-STATE, MASTER-PROMPT, README, ENVIRONMENT, DEPLOY), `git status` clean, push, tag `v1.0.0-rc1` | PM + all |

## What stays 'needs MJ' (cannot be made production ready by us)
Mail/Razorpay/Google keys, the hosting choice and domain/HTTPS certificate, backup destination (Google Drive keys or a disk path), public website, the privacy/data-retention decision with a lawyer (India DPDP).
