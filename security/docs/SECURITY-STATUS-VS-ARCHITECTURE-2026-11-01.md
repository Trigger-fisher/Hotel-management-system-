# Security status against the three-layer architecture, 1 Nov 2026

For MJ. This compares the architecture document (Cloudflare edge, Hostinger VPS, Supabase database, detection, deception, emergency reset, compliance) with what exists in the project today. Written by Claude Code after building steps 1 to 5 of `SECURITY-INTEGRATION-PLAN-2026-11-01.md` and the VPS kit. Nothing has been committed or pushed (R9).

## How to read the status words

| Word | Meaning |
|---|---|
| **Done** | Built and working in the code today, with tests. |
| **Ready, dormant** | The code is built and tested but does nothing until a key or setting is added (a Slack address, an SMS key, a Cloudflare token). |
| **Written, not run** | A script or file exists, but it has never run on the real server, because the server does not exist yet (about 14 Nov 2026). |
| **Partly** | Some of the item exists; the missing part is named. |
| **Different** | Done in another way than the architecture says, and the reason is given. |
| **Not done** | Nothing built yet. |
| **Your action** | Only MJ can do it (a dashboard setting, a key, a decision). |

## 1. Short summary

- **The application itself is strong and active today:** passwords, roles, hotel-by-hotel data isolation, API-key limits, audit log, sign-in locks, rate limits, backups. Three review rounds found no High problem.
- **The new detection, decoy and emergency-reset code is built and tested**, but its alerts are silent until Slack, SMS and Cloudflare keys are added.
- **Everything about the server and the database network (firewall, SSH, origin lock, fail2ban, Docker, IP allow-list) is written but has not run**, because the VPS and Supabase Pro do not exist yet.
- **The biggest real gaps** are: guest ID numbers are stored readable (not encrypted), administrators have no authenticator-app (TOTP) login, there is no Cloudflare WAF or edge rate limit yet, and there is no screen for the security tools.

## 2. Layer 1: Cloudflare (edge)

| Architecture item | Status | Notes |
|---|---|---|
| Domain on Cloudflare, TLS 1.2 or higher, Full (strict), Always Use HTTPS, HSTS | **Done** (by MJ) | Recorded in the plan. DNSSEC is off on purpose. |
| Web Application Firewall (OWASP rules) | **Not done**, Your action | Needs Cloudflare Pro. Checklist row 5 in `CLOUDFLARE-EDGE-RULESET-2026-11-01.md`. |
| Rate limiting at the edge (public API 60 a minute, sign-in 5 a minute) | **Not done**, Your action | Needs Pro. The per-account half cannot be done at the edge. |
| Rate limiting inside the app | **Done** | Every public route limits by address; sign-in locks an account after 5 wrong passwords. |
| Bot check (Turnstile) on login, signup, password reset | **Not done** | Needs Turnstile keys from MJ, then the widget on three forms and a server check. |
| Bot Fight Mode | **Not done**, Your action | Free setting, in the checklist. |
| Geo-block on admin routes only | **Not done**, Your action | Free custom rule, in the checklist. |
| Cloudflare notifications to Slack and email | **Not done**, Your action | Set in the Cloudflare dashboard once the Slack address exists. |
| Cloudflare API token for the reset button | **Not done**, Your action | Zone-limited token; goes in `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID`. |

## 3. Layer 2: Hostinger VPS (application)

| Architecture item | Status | Notes |
|---|---|---|
| Firewall accepts only Cloudflare's addresses | **Written, not run** | `security/deploy/02-cloudflare-ips.sh`. The real Cloudflare list was downloaded and checked. Only port 443 is opened (80 serves nothing). |
| Origin lock: a request that skips Cloudflare is refused | **Written, not run** | `security/deploy/nginx/hms.conf`. Tested locally: no certificate gives 400, unknown names are closed, 12 MB upload limit works. Needs Authenticated Origin Pulls switched on in Cloudflare. |
| SSH keys only, new port, no root login | **Written, not run** | `01-harden-host.sh`, in two phases so it cannot lock you out. |
| Fail2ban on repeated failed logins | **Written, not run** | Bans at Cloudflare (a ban on the server would only block Cloudflare itself). Patterns tested on sample log lines. |
| Docker, non-root, read-only | **Written, not run** | `docker/Dockerfile` and `docker-compose.yml`. Docker is not installed on the development machine, so the image has never been built. |
| Every request checked twice (valid session, and the hotel matches) | **Done** | The hotel always comes from the signed-in session, never from the request; each hotel has its own database schema and role. A group admin asking for another group's record is now reported as a Critical event. |
| Passwords hashed with Argon2id | **Done** | |
| Managers and admins must use two-factor (TOTP) | **Not done** | Today there is an emailed sign-in code that each person may switch on or off (decision 46). Needs your decision. |
| Check script for the finished server | **Written, not run** | `03-verify-hardening.sh`. |

## 4. Layer 3: Supabase (database)

| Architecture item | Status | Notes |
|---|---|---|
| One hotel can never see another hotel's data | **Different, Done** | The architecture says row security on every table. The project instead gives each hotel its own schema and its own login-less role (decisions 10 and 72), proven by tests. Row security is used on the guest and company portals. Stronger isolation, different method. |
| App connects with a limited account | **Done** | `hms_app`; it switches to the hotel's role per request. |
| Guest personal data encrypted (ID numbers, payment tokens) | **Not done** | Decision 11 (MJ, Oct 2026) chose plain columns. Only the Pathik guest name and integration secrets are sealed. Card numbers are never stored (Razorpay). This is the largest data gap and needs your decision. |
| All database connections use TLS and plain ones are refused | **Written, not run** | `web-app/scripts/check-db-tls.mjs` checks the address and the live connection. Needs the Supabase CA certificate and `sslmode=verify-full`. |
| Supabase allows only the VPS address | **Not done**, Your action | Do it after the TLS check passes from the VPS, or the app is locked out. Vercel's ranges are needed during testing. |
| Backups and restore to a point in time | **Partly** | Nightly per-hotel backup and monthly restore drills exist. Point-in-time restore depends on Supabase Pro. |
| Query audit log (pgaudit) | **Not done** | Needs Supabase; confirm it is available on the plan. |

## 5. Detection and the three alert levels

| Architecture item | Status | Notes |
|---|---|---|
| Info, Warning, Critical levels | **Done** | Info stays in the existing audit log; Warning and Critical go to a new `security_events` table (migration 0173 (was 0160 until the remote used that number for site builds), not yet applied to a real database). |
| Slack message for Warning and Critical | **Ready, dormant** | Needs `HMS_SECURITY_SLACK_WEBHOOK`. Repeats of the same alert are held back for a minute. |
| SMS for Critical only | **Ready, dormant** | MSG91 or Twilio; needs the provider keys and numbers. At most one SMS per kind and address every 10 minutes. |
| Five failed logins on one account | **Done** (as a Warning) | Raised when the account locks. |
| Honeypot hit | **Done** (as a Warning) | You agreed that a plain scan is a Warning, not Critical, because bots scan every site daily. |
| Canary or fake key used | **Done** (Critical) | See section 6. |
| Tenant isolation attempt | **Partly** | Done for group admins reaching another group. Not yet for other kinds of cross-hotel attempts. |
| Someone reaches the server directly, skipping Cloudflare | **Partly** | The event type exists; nothing raises it yet. The nginx origin lock refuses such requests but does not alert. |
| Fail2ban bans | **Partly** | Bans work (once installed); they do not yet raise a Slack alert. |
| Sudden rise in server errors | **Partly** | The existing `HMS_ALERT_WEBHOOK` posts error-level log lines. No rate-based alert. |
| Container monitoring (Falco or Wazuh) | **Not done** | A separate install on the VPS. |
| Database connection and query logs | **Not done** | Supabase and pgaudit. |
| Row security block logged as an event | **Not done** | The database refuses, but the refusal is not turned into an alert. |
| Country of an alert | **Done** | Cloudflare's country code is added as a hint (reliable only behind the origin lock). |
| One dashboard for everything | **Partly** | The data and the interface (events, layer status, resets) exist as APIs for the Super Admin. The screen is not built; your dashboards will be attached later. |

## 6. Deception (decoys and canaries)

| Item | Status | Notes |
|---|---|---|
| Decoy addresses: `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, `/.env`, `/.git`, `/admin/.git`, `/phpmyadmin`, `/.aws/credentials` | **Done** | The caller sees a plain 404. Not yet tried on a running server. |
| Fake `/.env` file with bait inside | **Done** | Contains an invented database address, a fake API key and a canary link. |
| Fake API key shaped like a real one | **Done** | Never works; trying it is a Critical alert, and the caller gets the normal "invalid key" answer. |
| Canary link (our own address, nothing installed on anyone's device) | **Done** | Opening it is a Critical alert. Guessing an address records nothing. |
| Decoy guest file with canary links | **Partly** | `npm run security:decoy` makes it. **Your action:** run it and put the file where an intruder would look (never in the project or the backups). |
| Fake admin login page | **Not done** | Needs a page in the interface; best done with your dashboards. |
| Fake records inside the database | **Not done, on purpose** | They would end up in backups and could contaminate a restore. Decoys are kept as files. |

## 7. Emergency reset (three layers)

| Item | Status | Notes |
|---|---|---|
| Each layer resets alone; every reset ends with a health check; an unhealthy result stays unhealthy | **Done** | A layer that is not connected ends "unhealthy: not connected", never "healthy". |
| Layer 3 needs two different Super Admins | **Done** | The database itself also refuses an approver who is the requester. |
| Resets cannot be run with an API key | **Done** | The whole security area is closed to API keys. |
| Layer 1 (Cloudflare) | **Partly, ready, dormant** | Blocks a named address and checks SSL strict, HTTPS forced and HSTS on. It does **not** yet re-apply WAF rules or clear rate-limit counters (they do not exist until Pro and the ruleset are set). |
| Layer 2 (server) | **Not done** | Needs the VPS. None of these steps exist yet: cut the container off the network, end the affected sessions, rotate the exposed credential, read-only mode, redeploy from signed code, login and isolation health check. |
| Layer 3 (database) | **Not done** | Needs Supabase. Missing: rotate the credential, check row security everywhere, restore to a point in time, run the cross-hotel test suite as the health check. |
| One button for a full reset of all layers, with two approvals | **Not done** | |
| Reset available only after a Critical alert | **Different** | Any Super Admin can run a reset at any time, so a real emergency is never blocked. Tell me if you want the plan's version. |
| Resets recorded in the platform audit log | **Not done** | They are recorded in their own table with the person's name; the audit log needs new action names in the shared contract. |

## 8. Compliance and data handling

| Item | Status | Notes |
|---|---|---|
| Card numbers never stored; gateway tokens only | **Done** | Razorpay. |
| DPDP Act 2023 handling | **Not done** | Mentioned in the product documents only. No consent record, erasure request or breach-notice feature exists. |
| Foreign guests reported by C-Form | **Not done** | No implementation found. |

## 9. What only MJ can do

1. Create the Slack incoming webhook and choose the SMS provider (MSG91 needs an approved template; Twilio needs an account).
2. Cloudflare dashboard: the free settings now (Bot Fight Mode, geo-block rule, notifications), the Pro settings on 14 Nov (WAF, rate limits), Authenticated Origin Pulls, an Origin certificate, a zone-limited API token.
3. Turnstile site and secret keys.
4. Run `npm run security:decoy` and plant the file.
5. When the VPS arrives: the admin user with a key, then the scripts in `security/deploy/README.md` in order. When Supabase Pro arrives: CA certificate, then the IP allow-list.

## 10. Decisions needed from MJ

1. **Guest ID numbers and personal data:** encrypt them? This reverses decision 11 and needs a migration of existing data. Recommended before real guests are loaded.
2. **TOTP for administrators:** make it mandatory for managers and admins (reverses part of decision 46), or keep the emailed code optional?
3. **Reset availability:** always for a Super Admin (as built), or only after a Critical alert (as the plan says)?
4. **Layer 3 approvers:** any other Super Admin, or a fixed pair?
5. **Reset records:** also write them to the platform audit log (needs shared contract changes)?

## 11. Suggested order from here

1. Add the Slack webhook (turns on the Warning alerts at once) and plant the decoy file.
2. Decisions 1 and 2 above, then build them.
3. Attach your dashboards to the security APIs; add the fake login page then.
4. On 14 Nov: Cloudflare Pro settings, then the VPS kit in order, then Supabase TLS and the IP allow-list, then the plan's step 7 (trigger every detection path on purpose and confirm the alert and the matching reset).
5. Afterwards: layer 2 and layer 3 reset steps, Falco or Wazuh, pgaudit, DPDP and C-Form.

## 12. What was and was not checked

- **Checked by tests:** alerts, event severity, decoys, canaries, fake key, country hint, reset rules (two people, health check, not-connected), the group cross-tenant report, the API-key block. The full server test suite passes except two announcement tests that fail because of a separate change made on 1 Nov (the new "important" field), unrelated to security.
- **Checked by hand on the development machine:** the nginx file (live), the fail2ban patterns, the shell script syntax and argument checks, the sshd directives, the Cloudflare address list.
- **Not checked:** the new database tables on a real PostgreSQL (none on this machine; `tests/db/security.repo.test.ts` is written and compiles), the SMS and Cloudflare calls against the real services (no keys), the decoy and fake-key behaviour on a running server, and everything in section 3 on a real VPS.
- **Not related to this work:** two interface lint errors in `Notch.tsx` and a type error in `layout.tsx` already exist.
