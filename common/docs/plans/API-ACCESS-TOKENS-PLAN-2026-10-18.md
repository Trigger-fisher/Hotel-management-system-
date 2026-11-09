# API access tokens: let Claude (and tools) test the live site safely (PM, 18 Oct 2026)

MJ: create an API connection in the Super Admin so Claude can connect to the live site for testing.

## Today
Sign-in is web-only (platform 0111 sessions_web_only): the API accepts the httpOnly session cookie from our own pages; there is no token a tool can use. So Claude can only check public routes (health, 404, headers) on the live site.

## What to build
Super Admin > Platform settings > **API access** (Super Admin only):
- Create a token: name ("Claude testing"), access level **Read only** (default) or **Read and write** (needs a second confirm and a reason), scope: platform console only / one hotel (pick) / all hotels read-only, expiry (1, 7 or 30 days; max 30), optional IP allow-list.
- The token is shown ONCE (copy button) in the form `hms_pat_<random>`; only a keyed hash (HMS_HASH_KEY) is stored; list shows name, level, scope, created by, created, expires, last used, last IP, calls today; Revoke (instant). Expired tokens stop working; max 5 active tokens.
- Every call with a token: `Authorization: Bearer hms_pat_...`; acts as a special service identity "API token: <name>" (never as MJ's own account), checked by the same permission catalog; read-only tokens refuse every non-GET (403) and any route that reveals secrets or personal ID images; audit log entry per write and a daily count per token; rate limit (e.g. 60/min); CSRF rules unchanged for cookies (bearer is not a cookie). Sign-in, password, 2FA, API-access management and payment routes refuse tokens entirely.
- Platform migration (next free number) `platform.api_tokens` (id, name, token_hash unique, level, scope_kind, hotel_id, expires_at, ip_allow, created_by, created_at, last_used_at, last_ip, revoked_at) + Neon SQL file.
- Tests: hash only stored, shown once, read-only blocks writes, expired/revoked refused, scope enforced (one hotel cannot read another), forbidden routes refuse tokens, audit + rate limit.

## How Claude uses it
MJ creates a read-only token and puts it in a git-ignored local file (e.g. `_local/secrets/live-api-token.txt`) himself; Claude's tools read it from there, never print it, never commit it. MJ revokes it when testing is done. No token is ever pasted in chat.

## Owner
d3 (QA tools owner) builds it (server + UI in the Super Admin + a small `pm-dashboard/tools/live-api.mjs` that calls read-only checks with the token); review by the PM before push.
