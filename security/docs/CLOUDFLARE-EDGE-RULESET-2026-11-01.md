# Cloudflare edge ruleset (target and record), 1 Nov 2026

Part of `SECURITY-INTEGRATION-PLAN-2026-11-01.md` section 4. Cloudflare is configured in its dashboard, not in code; this file is the written copy, so the settings can be rebuilt if the account is ever lost. **Fill the "Set on" column as each line is done; a line without a date is not done.** Written by Claude Code from the plan; nothing here has been applied by Claude.

Domain `easyhotelsolutions.in`. Zone settings already done by MJ (1 Nov 2026): SSL/TLS Full (strict), Always Use HTTPS, HSTS 6 months with subdomains, minimum TLS 1.2, DNSSEC off.

## Free plan now, Pro on about 14 Nov 2026

| # | Setting | Free plan? | Value | Set on |
|---|---|---|---|---|
| 1 | Turnstile widget on `/login`, sign-up and password reset | Yes | Managed mode; the site key goes in the page, the secret key is checked by the server (not built yet: needs the keys from MJ) | |
| 2 | Bot Fight Mode | Yes | On | |
| 3 | Block known bad paths at the edge | Yes (custom rules, 5 on Free) | Block `/wp-admin*`, `/xmlrpc.php`, `/.env*`, `/.git*` **only after** a week of the app's own decoy alerts, or the alerts never fire (the app's decoy routes are the detector; Cloudflare blocking first hides them). Until then leave them to the app. | |
| 4 | Geo-block `/admin/*`, `/platform/*`, `/group/*` | Yes (custom rule) | Allow India and the countries the owners travel from; never apply to guest or portal paths | |
| 5 | WAF managed rules (OWASP) | **Pro** | Sensitivity high | |
| 6 | Rate limit, public API | **Pro** | 60 requests a minute per IP on `/api/v1/public/*` | |
| 7 | Rate limit, sign-in | **Pro** | 5 a minute per IP on `/login`, `/api/v1/auth/*`. The 5 a minute **per account** part cannot be done at the edge (Cloudflare cannot see the account); the app already limits sign-ins per account and locks after 5 wrong passwords | |
| 8 | API token for the emergency reset | Yes | Create a token limited to this zone: Zone Settings read, Firewall Services edit. Put it in `CLOUDFLARE_API_TOKEN` with the zone id in `CLOUDFLARE_ZONE_ID` | |

## What the app checks after an edge reset

`POST /api/v1/platform/security/resets` with layer 1 blocks the address named as `ip=...` in the reason, then confirms: SSL mode strict, Always Use HTTPS on, HSTS on, and the address blocked. If any fails the layer shows unhealthy. The WAF ruleset and rate limits (rows 5 to 7) are **not** re-applied by the app yet: export them from the dashboard once set and add the export here.

## Notes

- Per-IP rules only mean something once the app counts the right number of proxies (`HMS_PROXY_HOPS=1` with the nginx file in `security/deploy/`; see `common/docs/deploy/DEPLOY-VPS.md`).
- Turnstile needs app work (the widget on three forms and a server-side check of its token). It is not part of the first build; ask for it when the keys exist.
