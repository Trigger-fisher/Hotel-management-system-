# VPS hardening kit (security plan 2026-11-01, sections 5 and 6)

Written before the server exists (Hostinger KVM 8, expected about 14 Nov 2026). **Nothing here has run on a real VPS.** What was checked on a development machine: the shell scripts' syntax and argument checks, the sshd directives (`sshd -t`), the nginx file with a live test (origin lock, forged `X-Forwarded-For`, unknown name, 12 MB limit), the fail2ban patterns against sample log lines, and the Cloudflare list download. What was NOT checked: UFW, fail2ban, Docker and systemd on the server itself, and Cloudflare Authenticated Origin Pulls. Run each step in order and read its output.

| Order | File | What it does |
|---|---|---|
| 1 | `01-harden-host.sh` | SSH on a new port, keys only, no root; UFW default deny. Two phases so you cannot lock yourself out. Dry run unless `--apply`. |
| 2 | `02-cloudflare-ips.sh` | Opens 443 for Cloudflare's ranges only; writes the nginx real-ip file. |
| 3 | `nginx/hms.conf` | Origin lock (Cloudflare client certificate), real visitor address, 12 MB limit, closes the connection for any other name or address. |
| 4 | `fail2ban/` | Bans repeated failed sign-ins and decoy scans **at Cloudflare** (a ban in this server's firewall would only block Cloudflare itself). |
| 5 | `docker/` | The app as an unprivileged, read-only container reachable from this machine only. |
| 6 | `../../web-app/scripts/check-db-tls.mjs` | Proves the app talks to Supabase over verified TLS. |
| 7 | `03-verify-hardening.sh` | Checks all of the above from outside and inside. Changes nothing. |

## Before you start (things only MJ can do)
1. Create an admin user with your public key (`adduser deploy`, `usermod -aG sudo deploy`, add the key). Do not continue without it: the script refuses.
2. Cloudflare dashboard: create an **Origin certificate** (SSL/TLS > Origin Server), save as `/etc/ssl/cloudflare/origin.pem` and `origin.key` (key mode 600). Switch on **Authenticated Origin Pulls** and save Cloudflare's CA as `/etc/ssl/cloudflare/authenticated_origin_pull_ca.pem`.
3. Cloudflare API token limited to the zone (Firewall Services edit, Zone Settings read). Put `Authorization: Bearer <token>` in `/etc/fail2ban/cloudflare.header` (root, mode 600) and the zone id in `/etc/fail2ban/cloudflare.zone`. The same token and zone id go into the app's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` (security plan section 9).
4. Supabase: download the project's CA certificate; use `sslmode=verify-full&sslrootcert=/path/to/it.crt` in `DATABASE_URL`; in the dashboard restrict the allowed addresses to this VPS's address (section 6 of the plan). Do the allow-list **after** `check-db-tls.mjs` passes from the VPS, or you lock the app out.

## Design choices to know
- **Port 80 is not opened.** Cloudflare reaches the origin on 443 (SSL mode Full strict); Always Use HTTPS is done at Cloudflare. The plan said 80 and 443; 80 would serve nothing.
- **`HMS_PROXY_HOPS=1`.** With this nginx file the visitor arrives as a single replaced `X-Forwarded-For` entry. Use `2` only if you change nginx to append (`$proxy_add_x_forwarded_for`).
- **Do not block `/.env` or `/wp-admin` at Cloudflare.** The app serves bait there and alerts (security plan section 8); a block at the edge hides the hit. fail2ban bans an address only after 5 hits.
- **Falco / Wazuh / pgaudit are not here.** Container monitoring and query auditing are separate installs; the plan lists them under detection and they are still open.
- The Docker image keeps dev dependencies (the app's `next.config.ts` and the build need them); it is larger than it could be, on purpose, because pruning them was not tested.
