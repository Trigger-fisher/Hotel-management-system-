# HMS antivirus scanner

A separate service (FastAPI, for the Linux VPS in Docker) that makes uploaded **PDFs and pictures safe
before the hotel system ever sees them**. Free and open-source tools only. It works on its own and has
no dependency on any other service: it only scans, disarms and judges.

## The flow

```
Guest's browser
   |  (1) quick filter in the browser (browser/fileCheck.js): convenience only
   v
QUARANTINE bucket  (private: nothing can open it, no public URL)
   |  short-lived link
   v
Scanner service on the VPS  (this folder)
   |  real type -> size/page/pixel caps -> ClamAV scan -> disarm and rebuild -> verdict
   +--- rejected: nothing is passed on; quarantine copy deleted or reported
   v  clean
CLEAN bucket  ->  HMS API receives only the ID of a CLEAN file
```

A virus therefore never travels through the HMS API: the API is only ever given the ID of a file that
already passed.

## The four layers (engines)

1. **Browser quick filter** (`browser/fileCheck.js`, no dependencies, `node --test`). Real type from magic
   bytes (never the name or content type), size cap, and a byte scan of PDFs for `/JS`, `/JavaScript`,
   `/Launch`, `/OpenAction`, `/AA`, `/EmbeddedFile(s)`, `/RichMedia`, `/XFA`, `/SubmitForm`, `/GoToR`
   (also when hidden as `/J#53`) and `/Encrypt`. Returns `{ok, code, message}`. **It is a convenience,
   never security**: an attacker simply skips it. Its value is a fast friendly "no" for honest users.
2. **Virus scan with ClamAV** (clamd). The service talks to clamd with the documented `INSTREAM` protocol
   over a unix or TCP socket using plain sockets (no extra library), with timeouts and a size limit.
   Signatures are refreshed by `freshclam` inside the image. If clamd cannot answer, the result is an
   error (`503 scanner_unavailable`), **never "clean"**; a clamd `ERROR` reply is also never "clean".
3. **Local YARA rules** (second engine, yara-python, pp/yara_rules/*.yar, see below). Runs on the original bytes before disarm.
4. **Disarm and rebuild** (content disarm and reconstruction), the strongest layer because it does not
   depend on knowing the threat:
   * **Pictures** are decoded and encoded again from pixels only (EXIF/GPS, ICC, text chunks, XMP and
     trailing bytes do not survive). Formats stay usable: JPEG stays JPEG, PNG stays PNG, HEIC/AVIF
     become JPEG/AVIF, BMP/TIFF become PNG, animated GIF/WebP are rebuilt frame by frame. Pass
     `output=jpeg` for a plain JPG (police or government upload). JPEG is written at quality 92 with full
     colour detail; a separate step could shrink it afterwards.
   * **PDFs** are rebuilt: only the pages are copied into a brand-new PDF, then every active part is removed:
     JavaScript, open/auto actions (`/OpenAction`, `/AA`), `Launch`, `SubmitForm`, `GoToR`/`GoToE`,
     `ImportData`, multimedia and rich media, 3D, `XFA`, attachments (`/EF`, file-attachment
     annotations), and the form logic. Plain web links (`/URI`) are kept unless `SCANNER_STRIP_URI=true`.
     The rebuilt file is walked again and refused (`disarm_failed`) if anything active is still reachable.
     Encrypted or corrupt PDFs are refused. Text, vectors and pictures render the same; bookmarks,
     interactive form fields and document-level metadata are not carried over.

## Honest limits

* **No scanner catches everything.** ClamAV is signature based and misses brand-new threats; that is why
  layer 3 exists (it works without knowing the threat). Layer 3 cannot help against a flaw inside a
  viewer's *image decoder* that survives re-encoding of valid pixels (unlikely, since the pixels are
  re-encoded by a different library than the one that decoded them).
* **A browser check can be bypassed.** It is never relied on.
* Only PDF and the picture types listed above are accepted; Office files, ZIPs and so on are refused.
* Re-encoding a JPEG is a second lossy generation (quality 92, 4:4:4). If a pixel-exact original is
  legally required, keep it in the private quarantine bucket under your own retention rules.
* Quarantine deletion needs a presigned DELETE link (`quarantineDeleteUrl`); without it the copy is only
  reported as `kept`. Set a bucket lifecycle rule as well.

## API

`GET /health` (open): `{status: ok|degraded, version, clamd: {configured, reachable, engine, signatureDate}}`. No secrets.

`POST /v1/scan` multipart: `file`, optional `output` (`auto` keeps the type; `jpeg` makes pictures come out as a plain JPG). Header `X-Scanner-Key: <SCANNER_KEY>`
(constant-time compare; the service refuses to start without a 32+ character key).
* clean: `200`, body is the cleaned file; headers `X-Verdict: clean`, `X-Scan-Engine`, `X-Disarmed` (comma list of what was removed, e.g. `javascript,open_action,gps`).
* rejected: `422` JSON `{verdict:"rejected", code, message, scanEngine, signature?}` and header `X-Verdict: rejected`.
  The file is never returned.

`POST /v1/scan-url` JSON `{quarantineUrl, cleanUrl, quarantineDeleteUrl?, output?}`:
downloads from the short-lived quarantine link, scans and disarms, `PUT`s the
clean file to `cleanUrl`, then (setting `SCANNER_QUARANTINE_ACTION=delete` and a delete URL) `DELETE`s the
quarantine copy. Answers JSON `{verdict, scanEngine, disarmed, notes, outputType, resultBytes, quarantine:
kept|deleted|delete_failed}` or `{verdict:"rejected", code, message}`. SSRF protection:
https only, port 443, no login in the URL, no numeric hosts, hosts only from `SCANNER_ALLOWED_HOSTS` (all three
URLs), every resolved IP must be public, redirects only to the same host (max 3, each re-checked), download size cap.

Rejection codes (verdicts): `malware_found`, `unsupported_type`, `file_too_large`, `too_many_pixels`,
`too_many_frames`, `too_many_pages`, `image_corrupt`, `pdf_corrupt`, `pdf_encrypted`, `disarm_failed`.
Service errors (`{"error": {code, message}}`): `unauthorized` 401, `bad_option`/`no_file`/`url_not_allowed` 400,
`download_too_large` 413, `busy` 429, `scanner_unavailable` 503, `scanner_error` 502,
`download_failed`/`upload_failed` 502, `timeout` 504.

A bounded process pool does the CPU work (`SCANNER_MAX_CONCURRENCY` workers plus `SCANNER_QUEUE_SIZE` waiting),
then answers `429 busy`. Temp data lives in memory only; names and contents are never logged.

## Environment

See `.env.example`. Required: `SCANNER_KEY`. Others: `SCANNER_CLAMD` (default `unix:/var/run/clamav/clamd.ctl`),
`SCANNER_ALLOWED_HOSTS`, `SCANNER_QUARANTINE_ACTION`, `SCANNER_STRIP_URI`, `SCANNER_MAX_CONCURRENCY` (2),
`SCANNER_QUEUE_SIZE` (4), `SCANNER_MAX_UPLOAD_MB` (100), `SCANNER_MAX_MEGAPIXELS` (100), `SCANNER_MAX_PDF_PAGES` (300),
`SCANNER_JOB_TIMEOUT_S` (300), `SCANNER_CLAMD_TIMEOUT_S` (60). Default port 8081.

## Run and test locally (Windows PowerShell)

```
cd other-features\antivirus
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest          # uses an in-memory fake clamd
cd browser; node --test                       # browser module
```

The EICAR test string is built in memory at run time and split in the source; it is never written to disk
(Windows Defender would quarantine such a file). Tests against a real ClamAV are skipped unless
`SCANNER_CLAMD_TEST` points to a reachable clamd (for example `tcp:127.0.0.1:3310`).

## Deploy on the VPS

0. (Docker) nothing extra: the image installs fangfrisch and starts the extra-signature updater (see Extra free signature feeds).
1. Create **two private buckets**: `quarantine` (browser may only upload with a short-lived presigned PUT; nobody can read it)
   and `clean` (readable by HMS). Add a lifecycle rule that deletes quarantine objects after a day.
2. Copy this folder to the server, `cp .env.example .env`, set a random `SCANNER_KEY` and `SCANNER_ALLOWED_HOSTS`
   (both bucket hosts).
3. `docker compose up -d --build`. The first start downloads ClamAV signatures; `/health` shows `degraded` until clamd answers.
4. Put Nginx with HTTPS in front using `nginx.conf` (body size and timeouts). Give the container about 3 GB RAM.
5. Check `GET /health`: `clamd.reachable: true` and a recent `signatureDate`.

**Real ClamAV result:** ClamAV 1.5.4 for Windows (signatures main 63 / daily / bytecode, about 3.3 million) was run here, and the INSTREAM client flagged the in-memory EICAR test string as `Eicar-Test-Signature` and passed a clean picture. Note that ClamAV's EICAR signature only fires when EICAR is the whole file, so a PDF with EICAR appended is only caught by the fake engine in the tests; the disarm layer removes active content either way.

**Untested here (no Docker on this PC):** the Dockerfile (including the fangfrisch install), the extra-sigs loop and supervisord entry, supervisord config, docker-compose and Nginx snippet were written without Docker, and the
real-ClamAV path was only exercised if the install listed in the report succeeded.

## How HMS will use it later (described only, no HMS code changed)

1. The page asks HMS for a presigned PUT link into the quarantine bucket and runs `fileCheck.js` first (friendly feedback).
2. The browser uploads straight to quarantine (so big files bypass Vercel's size limit).
3. HMS calls `POST /v1/scan-url` with the quarantine link, a presigned PUT link for the clean bucket and a delete link.
4. On `verdict: clean`, HMS stores the **clean file's ID** on the guest record; on `rejected` it shows the plain message.
5. The HMS API and database only ever receive IDs of clean files, never raw uploads.

## Possible flow (not built)

Browser -> quarantine bucket -> this scanner -> clean bucket; later steps (judging quality, reading, compressing) would be separate services. Nothing here calls them, and no setting here implements it.


## Order inside the scan

size cap -> **ClamAV INSTREAM on every file whatever its type** (a whole-file EICAR or an .exe is `malware_found`, not
merely "unsupported") -> real type from bytes -> **YARA** -> disarm/rebuild -> verdict. The verdict's `scanEngine`
names every engine that ran, for example `ClamAV 1.5.4+YARA 4.5.4`; a YARA rejection answers `422`
`{code: "yara_match", signature: "yara:pdf_javascript,pdf_launch_action"}` (rule names). With `SCANNER_YARA=report`
a match is only listed in `X-Notes` (`yara:<rule>`) and the file is still disarmed. Bytes found after an image's end
marker (PNG IEND, JPEG FFD9, GIF trailer, WebP RIFF length) or after a PDF's last `%%EOF` add the note `trailing_data`
(they are removed by the rebuild anyway) and are rejected when they hold a script or a program/archive header.

## YARA rule set (`app/yara_rules`)

| File | What it catches |
| --- | --- |
| `pdf_active.yar` | JavaScript (`/JS`, `/JavaScript`), `Launch` actions, embedded files/attachments, rich media/3D/movies, auto action plus a remote action (`SubmitForm`, `GoToR`, `ImportData`). Names written with `#xx` escapes (`/J#61vaScript`) are un-escaped first. |
| `image_polyglot.yar` | an image that is also a Windows executable, ELF, ZIP (all three record types), RAR, 7-Zip, Java class or shebang script. Only multi-byte signatures, since pixel data can contain any 4 bytes. |
| `trailing_data.yar` | applied only to bytes after the end marker: PHP/HTML/shell/PowerShell/cmd/VBS script code, executables, archives, OLE files. |

Every file starts with a comment giving its source and licence: all rules are **written for this project** from
standard file-format knowledge, with no text copied from public rule sets (their licences are mixed or unclear).
They are deliberately broad on PDFs: a PDF with JavaScript is refused instead of silently cleaned. If you prefer
"clean and disarm", set `SCANNER_YARA=report`. Add your own rules as extra `*.yar` files in that folder (the namespace is
the file name; only `pdf_active`, `image_polyglot` and `trailing_data` are acted on).

## Extra free signature feeds for ClamAV

ClamAV's own `freshclam` databases (main, daily, bytecode) stay as they are. On top of them
`deploy/clamav/fangfrisch.conf` fetches third-party feeds with **fangfrisch** (GPL-3.0 downloader, run as a separate
program in its own virtualenv, so its licence does not touch this service). It is started by supervisord
(`extra-sigs` program, checks hourly, each feed has a 4 h interval, SHA-256 integrity check, then `clamdscan --reload`).
Docker volume `fangfrisch-db` remembers the fetch times. Tested on the PC: all enabled files downloaded with their
integrity check and `clamscan -d` loaded them without errors.

**Used (verified 4 Nov 2026 from the real source)**

* **Sanesecurity, only its own malware databases:** `badmacro.ndb`, `foxhole_filename.cdb`, `foxhole_generic.cdb`,
  `foxhole_js.cdb`, `foxhole_js.ndb`, `hackingteam.hsb`, `malwarehash.hsb`, `rogue.hdb`, `shelter.ldb`, plus
  `sigwhitelist.ign2` (false-positive list) and `sanesecurity.ftm`. Terms, from https://sanesecurity.com/legal/ : "You can use the
  SaneSecurity signatures free of charge in commercial products" (a donation and an email with the company and product
  name are *requested*, not required); "No Signature copying, duplication or reproduction is permitted without the
  permission of the owners"; selling is forbidden; use at your own risk. Therefore each server downloads its own copy
  from the mirror and nothing is re-hosted or baked into an image. Download rules (https://sanesecurity.com/usage/linux-scripts/):
  use the recommended script (fangfrisch), do not poll too often (mirrors block abusive IPs; abuse leads to donor-only
  mirrors). **Action for MJ:** send Sanesecurity the short "company and product" email they ask for, and consider a donation.

**Left out because the licence/terms could not be verified, or they do not permit this use**

* **URLhaus (abuse.ch):** the ClamAV file needs an authenticated account (auth.abuse.ch) and the platform terms
  (https://abuse.ch/terms-of-use/) allow free use for **not-for-profit** purposes only; commercial use "may require a paid
  subscription" via Spamhaus. A hotel system is commercial, so it is off. No CC0 claim could be confirmed for URLhaus
  (CC0 is stated only for Feodo Tracker, SSL Blacklist and YARAify).
* **Sanesecurity's mirrored third-party sets** (winnow/OITC, bofhland, porcupine, MiscreantPunch, malware.expert): no terms
  verified for them (malware.expert is described by the updater project as non-free). Spam, phish and junk lists are
  off as well: this is a document scanner, not a mail filter.
* **SecuriteInfo, MalwarePatrol** (free tiers need an account and have their own terms), **InterServer**, and the
  `ditekshen`/`twinclams` sets: terms not verified.
* **VirusTotal and every service that receives files:** excluded by decision.

Linux Malware Detect is covered below (notes only).

## Optional: Linux Malware Detect (notes only, not wired in)

LMD (rfxn) is released under the **GNU GPL v2** ("without restrictions on usage or redistribution", from its README).
It is a host scanner aimed at web-hosting directories, not a stream scanner, so nothing here calls it. If MJ wants it
on the VPS anyway:

1. On the host (not in this container): `./install.sh` from the LMD release (installs to `/usr/local/maldetect`,
   daily cron, `maldet -u` updates signatures). With ClamAV present LMD links its signatures into ClamAV's database
   directory (`rfxn.hdb`, `rfxn.ndb`, `rfxn.yara`), validates them with `clamscan -d` first and then signals clamd.
2. Use it to sweep the **quarantine and clean bucket mirrors or the temp disk** from a cron job (`maldet -a /path`),
   not in the request path. Reports go to its own log; wire alerts through the host's mail.
3. Inside this image the same effect is possible by mounting LMD's signature files into `/var/lib/clamav`; that
   is not done because the LMD signature licence text should be read again at install time and the gain over
   Sanesecurity plus YARA is small for PDFs and pictures.

## Hardening notes

* The scanner container has no outbound need except `freshclam` and the Sanesecurity mirror (plain HTTP with SHA-256 files
  checked by fangfrisch). Allow only those hosts in the VPS firewall; the scan itself never calls out except to the
  allowed bucket hosts.
* Run `docker compose` with `read_only: true` and tmpfs for `/tmp` once tested; the app writes nothing (memory only).
  `/var/lib/clamav` and `/var/lib/fangfrisch` are the only writable volumes.
* A failed or stale feed never means "clean": clamd keeps the last good files; watch `/health` `signatureDate` and alert if
  it is older than two days.
* YARA rules are compiled once per worker process; a broken rule file stops the worker with a clear error (fail closed),
  it never silently disables the engine. `SCANNER_YARA=off` is for development.
* Memory: the extra Sanesecurity files add little (a few hundred KB); keep the 3 GB limit.
* Tests never write EICAR to disk (Windows Defender) and never scan real photos.

