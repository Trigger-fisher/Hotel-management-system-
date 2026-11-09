# deploy: all other-features on one VPS

One Hostinger **KVM 4** VPS (4 vCPU, 16 GB RAM, Ubuntu 24.04) running every other-features service with Docker Compose.

> **NEVER RUN.** This pack was written on a Windows PC with no Docker. `validate.py` and `tests/` only check that the files
> fit together (YAML parses, every folder, Dockerfile, copied file, model script and setting name exists, limits add up, nginx
> points at the right ports, scripts have Linux line endings). No image has been built and no container has been started.
> Expect to fix small things on the first install day.

## What runs

| service | built from | port | reachable from internet | memory / CPU limit |
|---|---|---|---|---|
| nginx (TLS, the only open door) | `nginx:1.27-alpine` | 80, 443 | yes | 256 MB / 0.5 |
| compressor | `../compressor/Dockerfile` | 8080 inside | via `compressor.<domain>` | 1 GB / 1.5 |
| antivirus (+ its own clamd, freshclam, Sanesecurity, YARA) | `../antivirus/Dockerfile` | 8081 inside | via `scanner.<domain>` | 3 GB / 1.0 |
| pdf-to-image | `../pdf-to-image/Dockerfile` | 8082 inside | via `pdf.<domain>` | 1 GB / 1.5 |
| reader (card cutter + photo check) | `../reader/Dockerfile` | 8083 inside | via `reader.<domain>` | 3 GB / 2.0 |
| quality-gate | `../quality-gate/Dockerfile` | 8084 inside | via `gate.<domain>` | 512 MB / 1.0 |
| intake-worker (card cutter + photo check) | `../intake-worker/Dockerfile` | none | no (pulls jobs from the database) | 3.5 GB / 2.0 |
| clamd (for the worker; freshclam + Sanesecurity) | `../intake-worker/clamd/Dockerfile` (on `clamav/clamav:1.4`) | 3310 inside | no (worker only) | 2 GB / 0.5 |
| certbot (on demand only) | `certbot/certbot:v2.11.0` | - | - | - |

Memory limits add up to **14.25 GB**, leaving about 1.75 GB for Ubuntu and Docker, plus a 4 GB swap file (step 3). CPU limits are
caps, not reservations: they add up to more than 4 so a busy service can use idle cores. Why these numbers: the card cutter
(Segment Anything) needs about 1.4-1.5 GB per process while cutting (intake-worker and reader READMEs), so the reader runs one job at
a time (`READER_MAX_CONCURRENCY=1`) and the worker two threads (`INTAKE_THREADS=2`); the antivirus README asks for 3 GB because clamd
briefly doubles its memory when it reloads signatures; the worker's own clamd reloads without doubling
(`CLAMD_CONF_ConcurrentDatabaseReload=no`) and fits 2 GB.

**Networks.** `services`: nginx and the five HTTP services. `intake`: the worker and its clamd only, so nothing reachable through
nginx can talk to the worker. Only nginx publishes ports. Containers can make outgoing connections (signature updates, the storage
hosts in each `*_ALLOWED_HOSTS`, Supabase).

**Models.** Building the reader and the intake-worker images runs each folder's own `scripts/get_model.py` (Segment Anything vit_b,
375 MB, Apache-2.0) and `scripts/get_face_models.py` (YuNet MIT, SFace Apache-2.0); each file is checked against its recorded SHA-256
and the build fails on a mismatch. `scripts/health.sh` runs `get_model.py` again inside both containers to re-check the hash.

**Virus signatures.** The antivirus container runs freshclam (12 checks a day) and fangfrisch (Sanesecurity feeds, hourly check)
itself. The worker's clamd container (built from `../intake-worker/clamd`) runs its own freshclam (twice a day) and its own fangfrisch
(Sanesecurity's own sets, checked daily, SHA-256 checked, clamd reloaded after an update) and keeps `sanesecurity.checked` at the
oldest good feed check; the worker reads it through a read-only mount of `clamd-db` and reports it in its heartbeat, and HMS alerts when
it or the official signature date is older than 48 hours. Signatures live in Docker volumes, survive restarts and are never backed up
(they are re-downloaded). The first start takes a few minutes while they download; both healthchecks allow 5 minutes.
`scripts/health.sh` prints both signature dates.

**Nothing personal on the VPS.** No service writes guest pictures or fields to disk (the worker is read-only with a 64 MB tmpfs;
the HTTP services stream through a tmpfs `/tmp`). Logs carry ids, step names and numbers only, are capped at 3 x 10 MB per
container, and nginx logs paths without query strings. Backups hold settings only (see "Backup").

## Licences (all allow commercial use)

Docker Engine (Apache-2.0), nginx (BSD-2-Clause), certbot (Apache-2.0), ClamAV image (GPL-2.0, run as a separate program, not
linked), ufw (GPL-3.0, an OS tool), gnupg (GPL-3.0, an OS tool). Python checks here: PyYAML (MIT), pytest (MIT). Each service's own
licences are in its folder's README.

## Install, step by step (MJ)

Commands run on the VPS as root (or with `sudo`) unless they say otherwise.

1. **VPS.** In hPanel create the KVM 4 with **Ubuntu 24.04**, add your SSH key. Log in: `ssh root@<vps-ip>`.
   Harden SSH as in `other-features/intake-worker/deploy/harden.md` (key only, no root password login, fail2ban).
2. **Docker.** Install Docker Engine and the compose plugin from Docker's own apt repository:
   ```
   apt-get update && apt-get install -y ca-certificates curl gnupg git
   install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list
   apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   docker compose version
   ```
3. **Swap (4 GB)**, so a short memory peak slows down instead of killing a container:
   ```
   fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```
4. **Copy the code.** `git clone <your private repo url> /opt/hms` (or copy the `other-features` folder with `scp -r`).
   Then `cd /opt/hms/other-features/deploy`. Every command below runs in this folder.
5. **Fill `.env`.** `cp .env.example .env && chmod 600 .env && nano .env`
   * `HMS_DOMAIN` (your own domain, for example `example.com`), `LETSENCRYPT_EMAIL`.
   * Every `*_KEY`: a **different** random value each: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
   * `INTAKE_MASTER_KEY`: `python3 -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"`.
   * `INTAKE_DATABASE_URL`: the limited `intake_worker` login (see `intake-worker/sql/proposal.sql`, not yet created in Supabase).
   * Each `*_ALLOWED_HOSTS`: the exact storage host names the service may fetch from.
   * Leave `HMS_TAG=current`. Leave the limits as they are unless you know why.
   Compose refuses to start while a key or the database URL is missing.
6. **DNS.** At your domain registrar add five A records to the VPS IP: `compressor`, `scanner`, `pdf`, `reader`, `gate`.
7. **Firewall.** `SSH_PORT=22 sh scripts/ufw.sh` (use your SSH port; run it from hPanel's browser terminal the first time so a
   mistake cannot lock you out). Add the same rules in hPanel's VPS firewall.
8. **Certificate.** When the DNS answers (`ping reader.<domain>` shows the VPS IP): `sh scripts/first-certs.sh`.
9. **Build** (downloads and checks the models; 20-40 minutes the first time): `docker compose build`
10. **Start.** `docker compose up -d`
11. **Check.** `sh scripts/health.sh`. Every container should say `healthy` (antivirus and clamd need up to 5 minutes the first
    time), each `/health` answers, each `https://<name>.<domain>/health` gives `200`, both models say present, signature dates are
    today. Then open `https://reader.<domain>/health` in a browser.
12. **Certificate renewal.** `crontab -e` and add:
    `17 3 * * * sh /opt/hms/other-features/deploy/scripts/renew-certs.sh >> /var/log/hms-renew.log 2>&1`
13. **Backup** once now (step "Backup" below) and copy the file to your PC.

## Everyday

* **Health:** `sh scripts/health.sh`
* **Logs of one service:** `docker compose logs --tail 100 reader` (ids and step names only)
* **Restart one service:** `docker compose restart reader`
* **Stop everything / start again:** `docker compose down` / `docker compose up -d` (signatures and certificates stay in volumes)

## Update

```
sh scripts/update.sh
```
It pulls the code (`git pull --ff-only`), builds new images tagged with the git commit (fresh OS packages, models re-checked),
writes the new tag into `.env` (`HMS_TAG`), starts them and waits up to 10 minutes for every service to be healthy. If they are
not, it **rolls back by itself** to the previous tag. Every switch is written to `state/deploy-history.log`. Monthly, even without
code changes, rebuild for OS security fixes: `docker compose build --pull && docker compose up -d`.

## Roll back

```
sh scripts/rollback.sh            # to the tag before the current one
sh scripts/rollback.sh 1a2b3c4    # to a given tag (see state/deploy-history.log)
```
Old images stay on the VPS until you remove them (`docker image prune` removes unused ones; keep the last two tags).

## Backup

```
sh scripts/backup.sh
```
Writes `backups/hms-settings-<date>.tar.gz.gpg`, encrypted with a passphrase you type (keep it in your password manager), holding
only `.env`, the deploy history and the TLS certificate. Nothing personal exists on the VPS, so nothing personal is backed up:
guest pictures, fields and jobs live in HMS's encrypted store and database, which HMS backs up. Signatures, models and images are
rebuilt, not backed up. Restore on a new VPS: steps 1-4, then `gpg -d <file> | tar -xzf -`, put `hms/env` back as `.env`
(`chmod 600`), and continue from step 6.

## Checks on the PC (Windows)

```
cd other-features\deploy
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install pyyaml==6.0.2 pytest==8.3.4
.\.venv\Scripts\python.exe validate.py
.\.venv\Scripts\python.exe -m pytest -q
```

## Known problems (found by these checks, 5 Nov 2026)

* **The reader image will not build as committed:** `reader/.dockerignore` excludes `scripts`, but `reader/Dockerfile` copies
  `scripts/get_model.py` and `scripts/get_face_models.py`. Fix in the reader folder: remove `scripts` from its `.dockerignore`
  (or ignore only the scripts it does not need). `validate.py` reports it and a test marks it as expected-to-fail until fixed.
* The antivirus and intake-worker build contexts send local folders that the images do not need (`antivirus/.tools-venv`,
  `antivirus/clamav-local`, `intake-worker/models`); on the VPS they do not exist after a fresh clone, so it only matters when
  building on the PC.

## Not done / not proven

* Never built or started; the VPS timings (the worker README asks for them) are not measured.
* The worker's healthcheck only proves the image starts; its real liveness is the heartbeat row (HMS alerts after 2 minutes).
* Outgoing traffic from containers is not limited to an allow-list (ufw does not filter Docker's forwarded traffic); doing it needs
  `DOCKER-USER` iptables rules with the provider's address ranges.
* The HTTP services are not run with a read-only root file system (only the worker is); untested under that setting.
* `CLAMD_CONF_ConcurrentDatabaseReload=no` for the worker's clamd is not verified against the `clamav/clamav:1.4` image. Check on
  install day: `docker compose exec clamd grep -i ConcurrentDatabaseReload /etc/clamav/clamd.conf`. If the image ignores it, clamd
  can briefly need about 3 GB while reloading: watch `docker stats` after the first signature update and, if it is killed, raise
  its limit to 3g and lower the compressor or pdf-to-image limit to stay inside 14.5 GB.
* Sharing one clamd between antivirus and the worker would save about 2 GB, at the cost of coupling them; not done.
* The worker's clamd image (`../intake-worker/clamd`) is written but never built: not verified that `clamav/clamav:1.4` starts from
  `/init`, reads `FRESHCLAM_CHECKS`, and that `python3 -m venv` works in its Alpine base. Check on install day:
  `docker compose logs clamd | grep -i -e freshclam -e feeds` and `sh scripts/health.sh` (the Sanesecurity line must show a date).
  With `ConcurrentDatabaseReload=no`, a scan waits a few seconds while clamd reloads (after freshclam or a feed update, a few times a day).
