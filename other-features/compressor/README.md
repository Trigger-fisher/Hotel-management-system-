# HMS compressor

A small service that shrinks PDFs and pictures **without visible loss**. It runs on its own
(Hostinger Linux VPS, in Docker), separate from the website, so large files never pass through
Vercel. Free and open-source tools only.

"Looks identical" is **measured, not guessed**: after each encode the result is decoded and
compared with the source using SSIM on the luminance channel (a standard 0-1 similarity score).
The encoder quality is binary-searched to the lowest setting that still meets the mode's score.

## Modes

| mode | score floor (SSIM) | PDF image DPI cap | notes |
|---|---|---|---|
| `balanced` (default) | 0.985 | 200 | visually identical |
| `strict` | 0.995 | 300 | for digits, IDs, bills, legal text. Never lossy JBIG2, never Ghostscript, never turns text into pictures |
| `max` | 0.970 | 150 | smaller, still fine; pictures limited to 3840 px on the long side; 256-colour PNG allowed when the score holds |
| `lossless` | exact | none | PNG/WebP lossless, JPEG metadata stripped without re-encoding, PDF structure clean-up only |

All thresholds live in `app/modes.py`.

`output`: `auto` (default), `jpeg`, `webp`, `avif`, `png`. `auto` picks per picture: photos try AVIF,
WebP and JPEG and keep the smallest that meets the score; flat graphics and screenshots use PNG or
lossless WebP. Pass `jpeg` when a plain JPG is needed (police or government upload). An explicit
format different from the input is always delivered in that format, even if bigger (note `converted_larger`).
Otherwise the **original is kept when nothing is gained** (for JPEG a metadata-stripped copy of the
original is used, so GPS is still removed).

## Size rule (MJ, 5 Nov 2026: the same rule the intake worker uses)

Every picture is first made as small as the mode's score allows at full size. Then:

1. **150 KB or less**: target met (`X-Target: met`). Nothing else changes, so files that were already small come out
   exactly as before this rule.
2. **Above 150 KB but at most 500 KB**: kept as it is, flagged `targetMissed`.
3. **Above 500 KB**: the 500 KB cap is a **hard maximum**. In order, stopping at the first that fits:
   the picture scaled down to 0.9, 0.8, 0.7 of its size with the score still measured against the full-size
   picture (flag `downscaled`); then the score floor lowered one step at a time (0.98, 0.97, 0.96, 0.95, 0.93, 0.90,
   only the ones below the mode's own floor), each step trying full size first and then the smaller sizes (flag
   `qualityFloorRelaxed`); then the **last resort**: shrunk (0.6x, then 15% smaller each time) at quality 60 until
   it fits (flags `qualityFloorRelaxed`, `lastResortShrink`). The cap is never broken for a picture.

The size step keeps working in the format asked for (`jpeg`, `webp`, `avif`, `png`; PNG only gets smaller sizes,
it has no quality knob). With `auto` it uses the lossy format that already won, or JPEG (WebP when the picture has
transparency).

Exceptions, flagged and never hidden: `lossless` mode never changes a pixel, so a lossless file above the cap is
returned with `sizeCapExceeded`; animated pictures are passed through untouched (also flagged when over).

**PDFs** follow the same cap **per page**: target = pages x 150 KB, cap = pages x 500 KB for the whole file. Over the
cap, only the pictures inside are brought down: DPI 150, 120, 100 at the mode's floor (`downscaled`), then the
relaxed floors (`qualityFloorRelaxed`), then 72 DPI at the lowest quality (`lastResortShrink`), each candidate still
rendered and checked page by page (the last resort only checks that every page renders). Text, fonts and vector
drawings are never touched, so a PDF whose size comes from those cannot be forced under the cap: it is flagged
`sizeCapExceeded` and the smallest checked version is returned.

Both numbers are request options: `targetKb` and `capKb` (whole KB, 1 KB = 1024 bytes; defaults 150 and 500;
`targetKb` may not be above `capKb`; a `capKb` below 150 alone pulls the target down to it). Wrong values are
refused with `bad_size` (400) before any work.

## Speed

Measured with `scripts/bench.py`, which pins itself (and its workers) to 4 CPU cores like the KVM 4 server.
The quality search gives **the same answer as before** (byte-identical on the invented set, see below) with fewer
encodes:

* the source picture's grey copy for the score is measured once per search instead of on every try;
* the score itself runs on a box-shrunk copy at most 1600 px on the long side (as before);
* for pictures of 1.5 MP and more, the first guess for the quality comes from the same search on a quarter-size
  copy (1/16 of the pixels); from that guess the search walks in steps of 3, 6, 12... to the edge and then bisects
  inside that small bracket. Because the score only rises with quality this ends on the same quality a plain
  bisection over the whole range finds (a test checks this against the old bisection);
* PDF pictures use the same guided search;
* the size step (new) uses a quicker WebP/AVIF effort setting, tries the top quality first and gives up on a size
  at once when even that misses the floor (and then skips the smaller sizes), since it may try several sizes and
  floors.

Measured 5 Nov 2026 on the invented set (35 picture cases, 6 PDF cases; Windows PC pinned to 4 cores):

* **Same results:** 33 of 35 picture results byte-identical to the old code; the other 2 (strict mode with WebP
  output, where only lossless WebP kept 0.995 at 590 KB and 1.6 MB) now come out under 500 KB on purpose, flagged.
  All 6 PDF results identical apart from the random file /ID.
* **Less work:** 23% fewer encoded megapixels over the 33 identical cases. For a 3 MP picture: auto (AVIF) 54 -> 44,
  strict auto 63 -> 45, max auto 54 -> 18, WebP 21 -> 9.5, JPEG 18 -> 17 megapixels encoded. Pictures under 1.5 MP
  do exactly the same work as before.
* **Wall clock:** not a clean number. Other jobs kept the PC at 100% CPU during the runs, and the same case on the
  same code varied by up to 60% between runs, so the seconds printed by `scripts/bench.py` here are not evidence
  either way. Re-run it on the KVM 4 server. The new size step costs extra only for files over the cap: about 5 s
  for the invented 1.2 MB noisy picture and about 3 s for the 1.7 MB PDF here.
* Lossless WebP at the slowest effort (unchanged, so results stay the same) is still the slowest step: tens of
  seconds for a 1 MP noisy picture with `output=webp`.

## What it does

* **Pictures** (JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC/HEIF, AVIF): EXIF rotation applied, then all
  metadata removed (GPS always), converted to sRGB, quality search, pixel and size caps.
  Animated GIF/WebP/AVIF are passed through unchanged.
* **PDFs**: text and vector content is never touched. Structure is cleaned with pikepdf (object
  streams, Flate recompression, unused objects). Embedded pictures are downsampled to the DPI cap
  and re-encoded as JPEG only when at least 10% smaller. Then the original and the result are
  **rendered with PDFium and compared page by page**; if any page misses the score it retries with a
  gentler setting, then falls back to the original. Encrypted or corrupt PDFs are refused. Bilevel
  scans (JBIG2/CCITT) are left alone.
* **Scanned PDFs** (no text at all) in `balanced`/`max`: if Ghostscript is present it is tried as one more
  candidate and must pass the same page check. OCRmyPDF is installed in the image for later features but is
  not used for compression (OCR would add a text layer and change the file).

## Honest expectations

* Scans, big camera pictures, screenshots, and PDFs full of oversized images shrink most (often 70-95%).
* Already-compressed files (a small web JPEG, a PDF of mostly text) barely shrink. The service then
  returns the original (when it is within the cap).
* On the invented test pictures made in code (smooth gradients, so unrealistically easy), measured:
  JPEG 184 KB -> 3.9 KB (balanced), 114 KB (strict, 0.995); PNG 1.13 MB -> 3.9 KB (balanced);
  screenshot-like PNG 79 KB -> 4.9 KB lossless WebP; PDF with a big image and a text line 458 KB -> 48 KB
  (balanced), 152 KB (strict), 27 KB (max). Real photos with sensor noise shrink far less: noise is
  what the score punishes. Measure on your own files.
* With the size rule a big noisy picture is made smaller or less exact to stay under 500 KB; the flags say which.
  A size in KB is promised only as the cap (never above it), not as a saving.
* The score looks at brightness structure only, at most 1600 px on the long side. Colour shifts and
  very fine detail below that scale are not measured. For legal/ID content use `strict`.
* **JBIG2 warning:** lossy JBIG2 "symbol mode" (what some scan tools use) can replace one digit
  with a look-alike one (a 6 for an 8) with no visible artefact. That has altered real invoices and
  papers. `strict` therefore never uses it, and no mode uses it by default; Ghostscript is called with
  monochrome images left as they are.

## API

All calls except `/health` need header `X-Compressor-Key: <COMPRESSOR_KEY>` (checked in constant time).
Errors are JSON `{"error": {"code", "message"}}` with a stable code.

`GET /health` -> `{status, version, tools:{gs,qpdf,pdftoppm,tesseract,ocrmypdf,jbig2,pngquant,oxipng}, formats:{avif}}`.

`POST /v1/compress` multipart: `file`, `mode` (default balanced), `output` (default auto), `targetKb` (default 150),
`capKb` (default 500). Response body is the compressed file; headers: `X-Original-Bytes`, `X-Result-Bytes`,
`X-Saved-Percent`, `X-Quality-Score`, `X-Mode`, `X-Output-Type`, `X-Notes` (includes the size-rule flags),
`X-Target` (`met`/`missed`), `X-Target-Bytes`, `X-Cap-Bytes`.

`POST /v1/compress-url` JSON `{sourceUrl, targetUrl, mode?, output?, targetKb?, capKb?}`: downloads the source, compresses,
`PUT`s the result to `targetUrl`, and answers JSON `{originalBytes, resultBytes, savedPercent, qualityScore,
mode, outputType, notes, target, targetBytes, capBytes}` (always JSON; no `?json=1` switch is needed). This is how big files travel:
browser -> storage bucket -> this service -> bucket. SSRF protection: https only, port 443, no login in the
URL, no numeric hosts, host must be in `COMPRESSOR_ALLOWED_HOSTS` (both URLs), every resolved IP must be
public, redirects only to the same host (max 3, each re-checked), download size cap. Note: DNS is checked
right before connecting, so keep the allow-list to storage hosts you control.

Codes: `unauthorized` 401, `bad_mode`/`bad_output`/`bad_size`/`no_file`/`lossless_unsupported_output`/`url_not_allowed` 400,
`unsupported_type` 415, `too_large`/`download_too_large` 413, `too_many_pixels`/`too_many_pages`/`image_corrupt`/
`pdf_corrupt`/`pdf_encrypted`/`quality_not_reachable` 422, `busy` 429, `download_failed`/`upload_failed` 502, `timeout` 504.

## Safety

Real type from magic bytes only; limits on size, pixels (checked from the header before decoding), pages and
a cooperative time limit per job; every job runs in a worker process with its own temp directory that is always
removed; no shell strings (argument lists only); file names and contents are never logged; interactive API docs
are switched off; the key is checked before an upload is read.

## Queue

A bounded process pool (`COMPRESSOR_MAX_CONCURRENCY` workers) plus a short waiting line (`COMPRESSOR_QUEUE_SIZE`).
When both are full the answer is `429 busy` with `Retry-After`. Redis and a real job queue are a **later step**
(not built).

## Environment

See `.env.example`. `COMPRESSOR_KEY` (32+ characters) is required: the service refuses to start without it.
Others: `COMPRESSOR_ALLOWED_HOSTS`, `COMPRESSOR_MAX_CONCURRENCY` (2), `COMPRESSOR_QUEUE_SIZE` (4),
`COMPRESSOR_MAX_UPLOAD_MB` (100), `COMPRESSOR_MAX_MEGAPIXELS` (100), `COMPRESSOR_MAX_PDF_PAGES` (300),
`COMPRESSOR_JOB_TIMEOUT_S` (300).

## Run locally (Windows PowerShell)

```
cd other-features\compressor
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:COMPRESSOR_KEY = "<a random string of 32+ characters>"
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8080
.\.venv\Scripts\python.exe -m pytest
```

## Deploy on the VPS

1. Install Docker and the compose plugin. Copy this folder to the server.
2. `cp .env.example .env`, set a long random `COMPRESSOR_KEY` and `COMPRESSOR_ALLOWED_HOSTS` (the bucket host).
3. `docker compose up -d --build` (binds 127.0.0.1:8080 only).
4. Put Nginx with HTTPS in front using `nginx.conf` (body size and timeouts).
5. Check `GET /health` shows the optional tools. Tune CPU/memory limits in `docker-compose.yml`.

**Untested:** the Docker files, Nginx snippet and every Linux-tool path (Ghostscript, oxipng) were written on
Windows without Docker; the tests for them are skipped where the tool is missing. Treat the first VPS
run as the test. Note `scikit-image` and `scipy` are heavy; if the image size matters they could later be
replaced by a small own SSIM.
