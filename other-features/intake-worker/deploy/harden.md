# VPS hardening for the intake worker (written, NOT tested here)

The VPS has **no open port**. One worker container and one clamd container run from Docker Compose. Everything below is a
checklist for the day it is installed; none of it has been run.

1. **SSH**: move it to a non-standard port; `PasswordAuthentication no`, `PermitRootLogin no`, key only. Install `fail2ban`
   with the sshd jail. Create a normal user with `docker` access; the worker never needs root on the host.
2. **Firewall**: run `deploy/ufw.sh` (deny all inbound except SSH; **outbound allow-list**). Also set the same rules in the
   hosting panel's firewall. Outbound allowed ONLY to: Supabase (database port and storage host), the ClamAV signature mirror
   (`database.clamav.net`), the Sanesecurity mirror fangfrisch uses (`mirror.seichter.de`, port 80, files SHA-256 checked),
   and the OS package mirror. Everything else blocked. DNS and time as needed.
3. **Updates**: `unattended-upgrades` for security updates; `freshclam` runs twice a day and fangfrisch checks the Sanesecurity feeds
   once a day inside the clamd container (`clamd/`); rebuild the worker and clamd
   image **monthly** with updated packages (`docker compose build --pull`), then `docker compose up -d`.
4. **Containers** (already in `docker-compose.yml`): non-root user, read-only root file system, `no-new-privileges`, memory and CPU
   limits, a small tmpfs for scratch, a private network, **no published ports**.
5. **Secrets**: an environment file `/etc/intake-worker.env`, mode `0600`, owner root, holding only `INTAKE_DATABASE_URL`
   (the limited login) and `INTAKE_MASTER_KEY`. No storage keys exist on the VPS: the worker uses the signed links in the job row.
6. **Signature age alert**: the heartbeat row carries the ClamAV signature date and the oldest good Sanesecurity check (`feeds_date`).
   HMS alerts the owner when either is older than 48 hours (or `feeds_date` is empty),
   when the heartbeat is older than 2 minutes, and when the oldest queued job is older than 5 minutes (for 10 minutes).
7. **Logs**: structured, only job ids, step names, codes and numbers. No file content, names, ID numbers, signed links or keys.
   Ship them nowhere outside the allow-list.
8. **Backups of the VPS** are not needed: it holds no data. The ID store and the job table belong to HMS's encrypted backup set.

## Retention facts (notes only: HMS owns retention, not the worker)

* `quarantine`: deleted by HMS when the job is done or rejected, or after 24 hours.
* `id-store`: one encrypted final picture per person per document; retention period set per hotel (default 2 years); then the nightly
  job deletes it and writes a ledger entry; a guest erase request deletes picture, fields and job rows.
* `intake_jobs`: rows older than 90 days are trimmed to status and timings. `worker_heartbeat`: rows older than 7 days are deleted.
