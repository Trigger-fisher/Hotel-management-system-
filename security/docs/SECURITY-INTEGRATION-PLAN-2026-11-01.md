# Security integration plan (edge, network, incident response), 1 Nov 2026

Written by Atlas (MJ's project assistant), for Claude Code to pick up and build. This adds a layer on top of HMS's existing security; it changes no database schema of the existing tenancy model and no application code that already exists beyond the small wiring points named below. Nothing in this file is applied until MJ says so (per R2 and R9 in `DECISIONS.md`). MJ said "start" on 1 Nov 2026; there is still no commit or push until MJ says so (R9).

## 1. Why this file exists

HMS already has strong application-level security: role-based access, API key scoping (three review rounds, `security/docs/SECURITY-REVIEW-ROUND-2-2026-10-18.md` and `...ROUND-3...`), audit logs, row-level security on the portals (hotel migration 0035), and per-hotel schema isolation proven by tests (`DECISIONS.md` decision 10).

What is missing is the layer around the application: the edge, the server's own network defenses, attack detection with alerting, decoy data, and an emergency response procedure. This file specifies that layer so it can be built without re-deciding anything already settled in `DECISIONS.md`.

## 2. Confirmed stack (MJ, 1 Nov 2026)

- **Edge:** Cloudflare Pro, domain `easyhotelsolutions.in` (nameservers already pointed at Cloudflare, SSL/TLS edge settings already configured: Full strict, Always Use HTTPS, HSTS 6 months with subdomains, TLS 1.2 minimum).
- **Application server:** Hostinger VPS, plan KVM 8 (not yet provisioned; expected around 14 Nov 2026).
- **Database:** Supabase Pro (already the database per decision 72; this plan adds network-level restrictions on top of the existing schema design).

This plan does not change the hosting decision already recorded in `DECISIONS.md` (decision 39: Vercel/Neon for testing, then a paid platform). It assumes the move to the VPS is now set for the reasons above; if that is not final, say so before the VPS-dependent sections (4) are built.

## 3. What this plan does NOT touch

- Tenancy model: schema-per-hotel with a login-less role per hotel stays exactly as designed (decision 10, decision 72).
- Any existing route, service, or the RBAC/API-key rules already reviewed.
- The existing nightly per-hotel backup (`OPERATIONS.md` section 4a) and the main database backup/restore procedure (section 4). This plan adds a restore DRILL requirement, not a new backup mechanism.

## 4. Layer 1: Cloudflare edge

Already done: domain active on Cloudflare, SSL/TLS edge settings as listed in section 2.

Still to configure (Cloudflare Pro, dashboard, no code change):
- Web Application Firewall: OWASP managed ruleset, high sensitivity.
- Rate limiting: public API 60 requests/minute per IP; auth routes (`/login`, `/auth/password/forgot`, sign-in code) 5/minute per IP AND 5/minute per account, since many staff of one hotel share an IP.
- Turnstile bot check on login, signup, and password-reset forms.
- Geo-block on admin and platform routes only (`/admin/*`, `/platform/*`, `/group/*`), never on guest-facing or portal routes, since guests and traveling staff must not be blocked.
- DNSSEC: off (per Cloudflare's own setup recommendation, confirmed already).

No application code changes needed for this section; it is entirely Cloudflare dashboard configuration. Claude Code's role here is limited to documenting the final ruleset in `security/docs/` once MJ has set it, so the configuration is recoverable if Cloudflare settings are ever lost.

## 5. Layer 2: VPS (once the Hostinger KVM 8 is provisioned)

Reference: `common/docs/deploy/DEPLOY-VPS.md` already has the general VPS deployment steps; this section adds the security hardening on top of it.

- UFW: accept inbound only from Cloudflare's published IP ranges, ports 80/443. SSH on a non-default port, key-only, root login disabled.
- mTLS between Cloudflare and Nginx (origin lock), so a request that bypasses Cloudflare and hits the VPS IP directly is refused.
- Fail2ban, configured against the real client IP (the `X-Forwarded-For` handling already flagged as R3-6 in `SECURITY-REVIEW-ROUND-3-2026-10-18.md` must be fixed first, or Fail2ban will ban Cloudflare's own IPs instead of the attacker).
- Docker: application container runs as non-root, read-only filesystem where possible.
- Supabase connection from the VPS: IP allowlist (only the VPS's IP), TLS `verify-full`. This is a network-level restriction; it does not change the existing `hms_app` role or the `SET LOCAL ROLE` per-hotel switching.

This section cannot be built or tested before the VPS exists. It can be written as a deployment script/checklist in advance so it is ready to run the day the VPS is provisioned.

## 6. Layer 3: Database network hardening (Supabase Pro)

The tenancy and access-control design (schema-per-hotel, `hms_app` role switching, RLS on portals) is already correct and is not changed. This section adds only:
- IP allowlist on the Supabase project: only the VPS's IP (and, during the Vercel-hosted testing period, Vercel's IP ranges) may connect.
- Confirm `pgaudit` or equivalent query logging is on for the platform schema (for the detection layer in section 7).
- Confirm backup restore drills (`OPERATIONS.md` section 4, `restore-check`) are run monthly as already documented, not just after a server change.

## 7. Detection and alerting

New, does not exist today. Severity levels, each routed differently:

| Level | Example | Action |
|---|---|---|
| Info | Successful sign-in, normal admin action | Logged only (existing audit log already covers most of this) |
| Warning | Five failed logins on one account, a full-visit write flagged by R3-1/R3-2 patterns, Fail2ban ban | Slack message within 30 seconds |
| Critical | Honeypot/canary triggered, a cross-hotel data access attempt, a Cloudflare-bypass attempt reaching the VPS directly | Slack and SMS immediately; the relevant emergency reset action (section 9) becomes available to a Super Admin |

Build notes for Claude Code:
- Reuse the existing audit log (`platform.audit`, referenced throughout `DECISIONS.md`) as the Info-level source; do not build a second logging system.
- A new lightweight `security_events` table (platform schema) for Warning/Critical events only, with a severity column, so the volume stays small and queries stay fast.
- Alerting is an outbound webhook call (Slack incoming webhook) plus, for Critical only, an SMS API call (provider to be chosen; MSG91 or Twilio both work from India). Both are server-side calls from the existing Next.js API routes, no new service to run.
- The three Medium findings in `SECURITY-REVIEW-ROUND-3-2026-10-18.md` (R3-1, R3-2, R3-3) should be fixed as part of this work, since they are exactly the kind of gap this detection layer is meant to catch faster next time.

## 8. Honeypot and canary tokens

New, does not exist today.
- Decoy routes that no real user ever calls: `/wp-admin`, `/.env`, `/admin/.git`. Any hit is Critical.
- A small number of decoy rows in a non-production-looking table or export, each carrying a canary token (free service, canarytokens.org, or a self-hosted equivalent: a unique URL that alerts on access). This is tracking only; it installs nothing on a visitor's device and is legal, unlike the malware-style "trap" approach MJ raised and that was declined on 31 Oct for exactly that reason.
- Canary-tagged copies should NOT be mixed into the real nightly backups (`OPERATIONS.md` 4a); keep them in a clearly separate, isolated location so a real restore is never contaminated with decoy rows.

## 9. Emergency reset system

New, does not exist today. Three independent actions, each scoped to one layer, so a small Layer 1 event never forces a full database credential rotation:

1. **Reset Layer 1 (Cloudflare):** reapply WAF rules, reset rate-limit counters, confirm the suspicious IP is blocked. Any Super Admin can trigger this.
2. **Reset Layer 2 (VPS/application):** disconnect the affected container from the network, rotate only the exposed credential, redeploy from the last signed commit, run the smoke test (`scripts/smoke.mjs`, already exists) as the health check. Any Super Admin can trigger this.
3. **Reset Layer 3 (database):** rotate the exposed database credential, confirm RLS/schema isolation is intact, restore from the nearest clean backup if data was altered. **Requires two-person approval**, consistent with how MJ already treats destructive Super Admin actions elsewhere in the project.

Each reset ends with an automated health check before the dashboard marks that layer healthy again; a failed check keeps it marked unhealthy for manual review rather than reporting false confidence.

## 10. Build order

Numbered in the order that makes each step testable on its own, not calendar days (several can run in parallel across sessions):

1. Fix R3-1, R3-2, R3-3 from the existing security review (these are already-known gaps, small, and make the detection layer in step 4 meaningful).
2. Finish Cloudflare edge configuration (section 4) — no app code, can happen any time.
3. Build the `security_events` table and the Slack/SMS alerting routes (section 7).
4. Build the honeypot routes and canary-tagged decoy data (section 8).
5. Build the three reset actions and their health checks (section 9), reusing `scripts/smoke.mjs` and the existing restore-check tooling where possible.
6. When the VPS is provisioned (~14 Nov): VPS hardening (section 5) and the Supabase IP allowlist (section 6).
7. End-to-end test: trigger each detection path on purpose (a fake failed-login burst, a honeypot hit, a simulated credential leak) and confirm the right alert fires and the matching reset works.

Steps 1 to 5 do not need the VPS and can start immediately. Step 6 is blocked on the VPS arriving.

## 11. Open items for MJ

- SMS provider for Critical alerts (MSG91 / Twilio / other) — needs an account and API key, same as the SMTP/Razorpay/Google keys already flagged as outstanding in `PROJECT-STATE.md`.
- Confirm the two-person approval for a Layer 3 reset should be the same Super Admin pairing already used elsewhere, or a separate list.
- Confirm this file's home: `security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md`, alongside the existing review rounds.

## 12. Addendum, 1 Nov 2026: what can be built before the paid plans arrive

MJ's note: no Cloudflare Pro, Hostinger VPS or Supabase Pro exists yet (all expected about 14 Nov 2026). The split:

| Step | Needs a paid plan to BUILD? | Needs one to ACTIVATE? |
|---|---|---|
| 1. R3-1/2/3 | No (pure code) | No |
| 2. Cloudflare edge | Free plan covers SSL, Turnstile, basic rules; WAF managed ruleset and rate limiting need Pro | Yes (WAF, rate limits) |
| 3. Detection and alerts | No | Needs the Slack webhook URL and an SMS provider key (env vars) |
| 4. Honeypot and canaries | No | No (works on any host; the canary URL needs a token from canarytokens.org) |
| 5. Reset actions | No (state machine, approval, health checks) | The Layer 1/2/3 executors call Cloudflare, Docker/VPS and Supabase, so they report "not configured" (unhealthy) until connected |
| 6. VPS and Supabase lock | Yes | Yes |

Rule for everything built early: it is dormant until its environment variables are set, it never claims a layer is healthy when its executor is not configured, and activating it on 14 Nov means setting variables, not rewriting code.

Status at the start of this work (checked in code, 1 Nov 2026): R3-1 (`auth/secretSettings.ts`), R3-2 (`WRITE_DENIED` covers `admin/users|roles`), R3-3 (`webhooks: null` for a key) and R3-6 (`http/clientAddress.ts`, last-entry rule with `HMS_PROXY_HOPS`) are already fixed in the code. Behind Cloudflare plus the nginx file in `security/deploy/nginx/hms.conf` (which replaces the header) the right value is `HMS_PROXY_HOPS=1`; with an nginx that appends it is 2. Behind Cloudflare plus Vercel (the testing period) Vercel overwrites the header with Cloudflare's address, so per-IP limits see Cloudflare, not the visitor: do not rely on IP limits or Fail2ban there.

## 13. Build status, 1 Nov 2026 (Claude Code; nothing committed, per R9)

| Step | State |
|---|---|
| 1. R3-1/2/3/6 | Already fixed in the code before this work; re-verified by their tests. |
| 2. Cloudflare | Recorded as a checklist in `CLOUDFLARE-EDGE-RULESET-2026-11-01.md` (MJ sets it in the dashboard; Free vs Pro marked). Turnstile needs keys and widget work, not built. |
| 3. Detection and alerts | Built: platform migration `0173` (`security_events`, `security_resets`), `services/security/{alerts,events}.ts`, Slack (hooks.slack.com only) and SMS (MSG91 or Twilio) for Critical, repeat throttling, `GET /api/v1/platform/security/events`. The five-wrong-passwords lock raises a Warning (`failed_login_burst`) through a new optional `onAccountLocked` hook in `authService`. Dormant until `HMS_SECURITY_*` are set. |
| 4. Honeypot and canaries | Built: `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, `/.env*`, `/admin/.git`, `/.git`, `/phpmyadmin`, `/.aws/credentials` are rewritten by `src/proxy.ts` to a trap route that records a Critical event and answers 404. Canary addresses are on our own server, signed with `HMS_HASH_KEY`; `npm run security:decoy` makes the decoy file (kept as a file, not in the database, so no backup holds decoy rows). |
| 5. Reset system | Built: three layers, layer 3 needs a different Super Admin, every reset ends with a health check, an unconnected layer ends "unhealthy: not connected". Layer 1 works against the Cloudflare API once `CLOUDFLARE_*` are set (blocks an `ip=` address, then checks SSL strict, HTTPS forced, HSTS, the block). Layers 2 and 3 are "not connected" until the VPS and Supabase exist. API keys are denied the whole `/platform/security` family. No screen yet: API only. |
| 6. VPS and Supabase lock | Blocked on the VPS (about 14 Nov). |
| 7. End-to-end test | After 14 Nov, with real Slack and SMS keys. |

Differences from the text above, for MJ to confirm: (a) a reset is available to a Super Admin at any time, not only after a Critical event, so an emergency noticed by a person is never blocked; (b) resets and security events are recorded in `security_events` / `security_resets` with the person's name, not yet in `platform.audit` (that needs new action names in the shared platform contract); (c) the failed-login Warning is the account lock (5 wrong passwords), which is stored in the database and so is right across several servers.

Not verified: the PostgreSQL repository and migration against a real database (this machine has no PostgreSQL; `tests/db/security.repo.test.ts` is written and typechecks but has not run), the MSG91 and Twilio request formats and Cloudflare API calls against the real services (no keys), and the proxy rewrite on a running server.

Update, 1 Nov 2026 (MJ agreed): a bare hit on a decoy address (`honeypot_hit`) is a **Warning** (Slack, no SMS), because bots scan `/wp-admin` and `/.env` on every site daily. Critical (Slack and SMS) is kept for an opened canary, a cross-hotel attempt and a Cloudflare bypass. This changes the "any hit is Critical" line in section 8.

Update, 1 Nov 2026 (later): added (a) the `cross_hotel_attempt` Critical event, raised when a Group Hotel Admin asks for a hotel, invitation or Hotel Admin that EXISTS in another group (an id that does not exist is not reported; the caller gets the same 404 either way); (b) the Cloudflare country code (`CF-IPCountry`) in decoy, canary and honeytoken alerts, as a hint only; (c) honeytokens: a fake API key shaped like ours (never in the key table, Critical when tried) and a fake `/.env` that serves it; (d) the VPS hardening kit in `security/deploy/` and `web-app/scripts/check-db-tls.mjs`, written but not run on a real VPS. Still open: Falco/Wazuh, pgaudit, the dashboard screen, a fake admin login page, TOTP, ID-number encryption, Turnstile.
