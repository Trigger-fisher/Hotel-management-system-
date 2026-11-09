# Backend pause note, 10 Oct 2026 (MJ ordered a stop)

Read `docs/BACKEND.md` first (the one backend document). Nothing is committed from this batch. No agent is running. No file is half-written (the agents stopped at file boundaries).

## Percentages at the moment of the stop
Basis per agent: code + own tests green 60%, the one review 20%, fixes + BACKEND.md + commit 20%.

| Agent / task | % | State |
|---|---|---|
| Batch 1 A: roles look/reorder, profile password, emailed-code | 80% | Code + tests green (admin.users 50, credentials 24); reviewed (findings below); fixes + commit not done |
| Batch 1 B: Shift Handover, Payroll Master/Log, System Log/Force Log/Health, `/health/deep` | 80% | Code + tests green (handover 19, systemAdmin 15); reviewed; fixes + commit not done |
| Batch 1 C: Guest + Corporate portals, recycle adapters, cash PDFs, dev mail log | 60% | Code + tests green (portal.guest 15, portal.corporate 12, recycle.more 8, existing recycle 14); NOT reviewed (reviewer stopped before reading it); fixes + commit not done |
| Batch 2 A2: Website part 2 + media store | 5% | Read only. No file written |
| Batch 2 B2: plain-data cleanup U1 + 3 GST tests | 5% | Read only. No file written. GST tests not located |
| Batch 2 C2: expense catalogue, backup routes, report PDFs, SMTP | 5% | Read only. No file written |
| TOTAL batch 1 | 73% | |
| TOTAL batch 2 | 5% | |

## What is done (uncommitted files, all under `web-app/` unless stated)
- **A (roles/profile):** modified `src/server/services/admin/{roleService,accountService,userSchemas}.ts`, `services/auth/{credentialPort,credentialService}.ts`, `repos/memory/adminUsers.ts`, `tests/server/admin.users.test.ts`; new routes `src/app/api/v1/admin/roles/order/`, `profile/password/`, `profile/emailed-code/`.
- **B (handover/system/payroll admin):** new `repos/{handovers,systemAdmin}.ts` (+ `memory/`, `postgres/`), `services/handover/`, `services/systemAdmin/`, `compose/{handover,handoverRecycle,systemAdmin}.ts`, routes `handover/`, `system/`, `health/deep/`, `payroll/master/`, `payroll/log/`, tests `handover.test.ts`, `systemAdmin.test.ts`; additive edit in `compose/admin.ts`.
- **C (portals etc.):** new `repos/portal.ts` (+ `memory/`, `postgres/`), `services/guest/`, `services/corporate/`, `services/cash/receiptService.ts`, `compose/{portal,cashReceipts}.ts`, routes `guest/`, `corporate/`, `revenue/deposits/[id]/pdf/`, `expense/entries/[id]/pdf/`, tests `portal.guest`, `portal.corporate`, `admin.recycle.more`, `helpers/portalWorld.ts`; edited `compose/{recycle,mail,cash,admin}.ts`, `repos/postgres/frontOffice.ts`, `repos/{payrollPay,memory/payrollPay,postgres/payrollPay}.ts`, `services/payrollPay/mealsService.ts`; repo-root `.gitignore` (+ `db/.dev-mail.log`).
- Docs edited and not committed: `docs/BACKEND.md` (Neon parked paragraph, dev test accounts), `docs/DECISIONS.md` (Project Manager's #26-31), this note.
- Also untracked and NOT mine, do not commit: `db/full-schema.sql`, `db/schema-part-1..3.sql`, `db/production/`, `pm-dashboard/`. `web-app/tsconfig.json` differs only in line endings. Frontend's `ui-shared/**` and `web-app/src/dashboards|lib/**` edits belong to Frontend.
- Dev data: user `ui.super` (hotel_admin / super_admin) created on `hotel-demo`; its password is only in `db/.dev-login.txt`.

## Confirmed review findings for A and B (fix before commit)
1. **Security, roles:** a hotel SuperAdmin can change a built-in (shared, `hotel_id IS NULL`) role for every hotel. `roleService.ts:135,151-154`, `repos/postgres/adminUsers.ts:172-200`: `update()` now writes `icon`, `accent`, `inherits` to the shared row; `setGrants`/`description` already could. Fix: refuse or ignore those fields for built-in roles (409/422), or give each hotel its own copy.
2. `services/systemAdmin/healthService.ts:133,136`: the backup check copies the stored `backup.last_result` text into the message that `/health/deep` shows to any `users`-view holder. Fix: drop it or show a fixed ok/failed word.
3. `services/systemAdmin/payrollAdminService.ts:148-156` and `payroll/master/items/[id]/toggle/route.ts`: toggle writes no `user_audit_logs` row and the route does not pass `requestMeta`. Fix: pass meta, write `payroll_master.toggled` in the same unit.
4. `profile/password/route.ts`: no throttle (each wrong try costs an argon2 verify). Add `limits: [{ name: "profile-password", max: 10, windowSeconds: 60, by: "user" }]` (Pallav has none; MJ's judgement).
5. `GET /health/deep` inserts 6 `health_checks` rows per call for a view-only user (low).
Not reviewed (reviewer ran out before it): all of Batch C, plus `services/systemAdmin/logDocuments.ts` and the test bodies. The reviewer also did not run the tests.

## Open decisions for MJ / Lead
- Emailed code switches ON at once; the ui-shared mock wants a confirm-with-test-code step (needs a new `auth_codes` purpose = platform migration).
- Guest portal hides company-billed bills/stays (C's safety choice): keep?
- U1 plain data: B2 found most hits are stale comments. Real decisions left: customer `idProofNumber` full vs last 4 (Aadhaar), the front-office ID-proof DTO (`services/frontOffice/dto.ts:20`), and the deliberate last-4 cut on PDFs and the guest portal (`profileDocuments.ts:28`, `payrollCore/companyDocument.ts:9`, `guestService.ts:92`). Stale "sealed" comments to rewrite are listed by file in B2's report (repos/payrollCore.ts, repos/admin.ts, payrollPay.ts, website.ts, employeeService.ts, settingsService.ts, auth*.ts). Optional: drop `datakey|datakeys|blindindex` from `logger/redact.ts:15`.
- Contract requests (Lead): roles (`icon` = full class, `level`, `{order}`), handover (`version`, shift string), system pages (UUID ids, list result shapes), `pageSize` 10/25/50/100 for the web Payroll Log, portal shapes (use server `totals`, widen `PaymentMethod`, corporate `cancelBooking` needs `version`), website settings (`whatsapp`, base64 photo bytes, clearing a secret).

## Exact next steps, in order
1. Fix review findings 1-5 above (each is a few lines).
2. Review Batch C (portals: guest scope by mobile digits must never match other people; corporate crossing companies; the `[id]` routes; recycle adapters; mail log) with one reviewer.
3. Update `docs/BACKEND.md`: route rows from the agent reports (handover §7.2, system §7.7, payroll admin §7.6, portals §7.7, cash PDFs §7.8, recycle kinds, `/health/deep` §6.3, dev mail log done in §10) and remove the built items from §13.
4. Commit only when MJ says. Then use an explicit `git add` list (never `git add -A`; never `.env*`, `db/.dev-*`, `db/production`, `pm-dashboard`, Frontend's files), check `git diff --cached --name-only`, `git pull --rebase`, `git push` (no force).
5. Batch 2 from scratch: Website part 2 + media store (A2 notes: gallery uses part `website.gallery`; content, services, policies, nearby use `website.content`; settings/Google use `website.settings` plus SuperAdmin or ability `website.secrets`; the six tables have no `version` or `deleted_at`; `repos/website.ts` and `services/website/contentService.ts` already exist; wrapper reads JSON only so use base64 upload; planned git-ignore line `web-app/.data/`); U1 cleanup (B2 notes above, plus find and fix the 3 failing GST-settings tests); C2: expense catalogue (SuperAdmin only, mirrors both businesses, hard delete; category 1-80 chars unique per business; item price 0-9999999.99), backup routes (status/settings, no Google keys), remaining report PDFs (Daily Report and Food Plan PDFs; company profile, guest profile, ledger summary, payroll company details need checking), real SMTP sender with `nodemailer` behind the mail driver (env names `SMTP_HOST|PORT|USER|PASS|FROM`, `MAIL_DRIVER=log|smtp`).

## Rules to keep
`docs/DECISIONS.md` newest rule wins; local PostgreSQL only (no Neon); one heavy process at a time on this PC; do not run the whole suite or whole-project tsc; report status to the Project Manager starting with percentages.
