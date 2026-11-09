# HMS quality gate

A standalone service (FastAPI, for the Linux VPS in Docker) that only **judges** an uploaded picture or PDF:
is the data proper, or is it too blurry, dark, glary, small or cut off to be useful? It does **not** compress, scan
for viruses, convert or read text, and it calls no other service. Classical computer vision only (OpenCV, numpy,
Pillow, pypdfium2): no machine learning, no training, no GPU. Fully self-contained.

## Verdicts

`accept` (fine), `warn` (usable, but a person should look) or `reject`. Every reason has a stable `code`, a
`severity` (`reject`, `warn` or `info`) and one plain "what to do" sentence, for example
*"The photo is too blurry. Hold the phone steady and take it again."* Every raw score is returned so thresholds can
be tuned. The overall verdict is the worst severity found.

## What it checks

Pictures: blur (two measures at a fixed 1000 px size so a big and a small copy of a scene compare equally: the
sharpest tiles' Laplacian variance and Sobel gradient strength; **reject only when both are low, warn when either
is**), motion blur (camera shake direction from the x/y gradient ratio, with a hint), size and effective dpi,
exposure (too dark / washed out from histogram ends, brightness for photos), glare (blown-out blobs, only on grey
photographed paper), low contrast, noise, nearly blank, extreme aspect ratio, content cut off at the frame edge,
document too small in the frame, heavy compression, plus a moire hint score. Animated pictures: the first frame is
judged and `animatedImage` is added.

**Heavy compression (aligned with the intake worker, 5 Nov 2026).** For a JPEG upload the quality (libjpeg scale 1-100) is read
from the **original file's own quantisation table**, before anything decodes or resamples it (`app/compression.py`, copied from
intake-worker). Below the profile's limits the reason is `tooCompressed`, *"Picture too compressed. Send the original photo, not a
compressed copy (for example one forwarded through a chat app)."* Limits (warn, reject): `id-card` and `multi-id` 45 / 25 (the intake
worker's clarity grade calls a card usable below 45 and unclear below 25), `document` 40 / 20, `generic` 35 / 15, `photo` 30 / 12.
Phone cameras save at 85-97, chat apps at about 70-80; at quality 12 and below the table saturates and reads 13-16. The score is
`scores.jpegQuality`.

**A hard-compressed copy saved again (5 Nov 2026).** A picture compressed hard and then saved again as PNG or as a high-quality JPEG
keeps the traces of the first compression in its pixels while its own table reads high (or a PNG has none). `traced_quality()` in
`app/compression.py` finds them: the 8 x 8 blocks of the upload (the centre 1024 px, at most 512 blocks with print in them) are compressed
again with every candidate quality's table (libjpeg scale 5-47); a block that comes back unchanged (mean change at most 1 grey level) at
one quality and at least 0.5 worse at both neighbouring qualities is a trace of that quality; 7% or more of the blocks with that dip
name the earlier quality (5-45). Pixels the first decoder clipped at 0 or 255 are let past the clip for two rounds before the
comparison, so black print on white paper keeps its trace. The grid is taken from the top-left corner, plus the phase of the strongest
block edges when a cut copy shows them 1.3 times stronger. It runs for every PNG and WebP and for every JPEG whose table reads 46 or
more, beside the other measures. The lower of the table and the traced quality becomes `scores.jpegQuality` (the traced one is also
`scores.jpegQualityTraced`), so the copy gets the same `tooCompressed` reason and limits as a low-quality JPEG. When a JPEG is traced, the
block grid score is no longer used for it; when it is not (resized after the first compression, for example), a JPEG keeps the grid rule
for a copy saved again (`jpegBlocking` from 1.9 / 3.0, or 1.4 / 2.0 when decoded at half size). PNG, WebP and HEIC without a trace keep
the old grid rule (1.35 / 1.8).

`scripts/calibrate_recompression.py --cards 12` (invented cards of `tests/idcards.py`, each as a flat scan and as a photo on an invented
table; 5 Nov 2026):

| truth \ result | not flagged | flagged (earlier quality below 45) |
|---|---|---|
| clean: PNG and fresh JPEG at quality 90, 95 and 100 (96) | **96** | 0 |
| first saved at quality 10, 15, 20, 25, 30 or 35, then saved again as PNG or as a quality 95 JPEG (288) | 0 | **288** |
| extra: quality 20, cut by 3 and 5 px, saved as PNG (24) | 7 | 17 |

Every one of the 288 reads back its first quality exactly (q10 -> 10 ... q35 -> 35). The cut copies are found on all 12 photos but only
on 5 of the 12 flat scans (the block edges of a plain drawn card are too weak to show the shifted grid). Time on this PC, the trace
alone on a 2000 x 1500 picture: fastest 19 ms, median 41 ms, while other jobs kept the CPU 85-95% busy; with the decode of the upload
median 61 ms. It runs side by side with the other measures in the thread pool.

**Portrait hint (`id-card` only).** The gate does not know the card's type and runs no face model, so this is a **warning, never the
rule** (the intake worker's face check decides). It finds the card (the multi-id card finder), flattens it to 1000 px, and looks for a
photo-like block: 16 px tiles that differ from the card's paper colour, grouped, taller than wide (1.0-2.0), 2-30% of the card, with
texture and real photo content (bands across the card are dropped first). Inside it: edge steepness (copied from intake-worker
`app/faces.py`), the share blown out to white (copied from intake-worker `app/clarity.py`) and its height in the stored picture.
Steepness below 0.30, glare above 0.15 or a portrait under 80 px tall gives `portraitUnclear` (warn) with MJ's sentence *"Photo on the
ID is not clear, please retake."* and a `why` list (`photo blurred`, `glare over the photo`, `photo too small`). `info.portrait` reports
`found`, `sharpness`, `glare`, `heightPx` and the box. Invented cards: a crisp portrait 0.40-0.63, the portrait alone blurred 2.5 px
0.15-0.27 and 4 px 0.10-0.18; glare over it 0.52-0.60 blown out. Override with `{"id-card": {"portraitUnclear": {"sharp_warn": 0.25}}}`.

PDFs: corrupt, encrypted, zero pages, page cap; every page is rendered at 150 dpi and judged. Pages **with a text
layer** are vector, so blur and resolution rules are skipped (`textLayer: true` is reported). Scanned pages get the
picture checks; embedded pictures below a minimum effective dpi give `lowImageDpi`; blank pages give `blankPage` (a
warning, and a rejection when every page is blank); mixed page sizes are noted. The overall verdict follows the
worst page; each reason lists the pages it applies to.

## Profiles (all thresholds live in `app/profiles.py`)

| profile | for | stricter than the others on |
|---|---|---|
| `id-card` | ID photos | blur, glare, cut-off, resolution, document size in frame |
| `document` | bills, forms, scans | resolution, exposure |
| `photo` | hotel and website photos | exposure only; lenient on blur and text |
| `generic` | default | moderate everywhere |
| `multi-id` | one photo with several cards | judged **per card** (see below) |

Limits are constants with comments in one table. Override without code changes through `GATE_THRESHOLDS` (a JSON string
or a file path), for example `{"id-card": {"blurry": {"reject_lap": 300}, "glare": {"warn": 0.01}}}`. The response includes
the effective `thresholds` for the profile. Measured on invented text pages (blur sigma at 2000 px width where the
verdict first becomes `reject` for blur): `document` 5, `id-card` 4, `generic` 6, `photo` 8. Those numbers come from
synthetic pages, not real photos: **calibrate on MJ's real photos** (below).

### Several cards in one photo (`multi-id`)

A simple card finder (own copy, edges + background colour + paper masks, quad fitting, overlap removal; up to 12 cards)
flattens each card and judges blur, glare, exposure, noise and size **per card**, on the card's interior (4% of each side left out:
a sliver of table along the found edge is a sharp step that hid a blurred card's softness). The limits match the intake worker:
**up to 12 cards per photo, each at least about 600 px on its long side** in the stored picture (`thresholds.multi`). The reply
names how many cards are unreadable (and how many of those are too small), never which person, and ends with one advice line:
*"1 of 4 cards cannot be read. Photograph at most 12 cards per photo, laid flat and not touching, close enough that each card is at
least about 600 pixels long; with a low-resolution camera, use fewer cards per photo."* The same line is in `info.advice` whenever
there is a multi-id reason. Rejects when half or more are unreadable, warns when some are, rejects when more than 12 are found or
none is found. The whole sheet is not judged for blur or glare itself. Touching cards can merge into one region.
Invented sheets: 1, 2, 4, 6 cards all found and readable; 10 and 12 cards of about 540 px all found and all called too small; 12 cards
of about 770 px in a 3800 x 2600 photo all found and readable; 1 or 2 blurred cards out of 4 or 6 named exactly.

## API

`GET /health` (open): `{status, version, profiles}`. No secrets.

`POST /v1/check` multipart `file`, optional `profile`; header `X-Gate-Key: <GATE_KEY>` (constant time; the service refuses
to start without a 32+ character key). Answer: `{verdict, reasons:[{code, severity, message, pages?}], scores:{...},
pages:[{page, verdict, reasons, textLayer, scores}], profile, info, thresholds}`.
Errors `{"error": {"code", "message"}}`: `unauthorized` 401, `bad_profile`, `no_file` 400, `unsupported_type` 415 (type from
the magic bytes only), `file_too_large` 413, `too_many_pixels` 422, `busy` 429, `timeout` 504. A damaged picture or PDF is
a **reject verdict** (`imageCorrupt`, `pdfCorrupt`, `pdfEncrypted`, `noPages`, `tooManyPages`), not an API error.
Work runs in a bounded process pool (`GATE_MAX_CONCURRENCY` + `GATE_QUEUE_SIZE`, then 429); per-call memory only; names and
contents are never logged. **There is no URL or flow endpoint yet; the flow is decided later.**

Reason codes: `blurry`, `motionBlurHint`, `tooDark`, `washedOut`, `lowContrast`, `glare`, `noisy`, `blank`, `tooSmall`,
`lowResolution`, `extremeAspect`, `cutOff`, `documentSmallInFrame`, `jpegBlocking`, `tooCompressed`, `portraitUnclear`, `animatedImage`, `lowImageDpi`, `blankPage`,
`mixedPageSizes`, `cardsUnreadable`, `tooManyCards`, `noCardsFound`, `imageCorrupt`, `pdfCorrupt`, `pdfEncrypted`, `noPages`, `tooManyPages`.

## Browser quick check (`browser/gateCheck.js`)

A dependency-free module for instant feedback on a canvas before upload: size and dimensions, a downscaled blur and
brightness estimate, glare share, the JPEG quality read from the file's own quantisation table (`jpegQuality(bytes)`, the
server's estimate and limits: `tooCompressed`), and for `multi-id` the card count and the size of the smallest card with the
server's advice line (`advice`), with the same codes and messages. The trace of an earlier compression is on the server only. **It is a convenience; the server is the real gate** (anyone can skip browser code). Its limits are tuned
on synthetic data and need calibrating. Tested with `node --test` on synthetic ImageData.

## Calibration numbers on invented pictures

`scripts/calibrate_invented.py [--cards 12] [--metrics]` photographs invented cards (`tests/idcards.py`: made-up words and numbers, a
drawn portrait from `tests/faces.py`, copied from intake-worker) on an invented table, saves them as phone-style JPEGs (quality 92) and
judges each clean and damaged form with the `id-card` profile. On 12 invented cards (5 Nov 2026):

| truth \ verdict | accept | warn | reject |
|---|---|---|---|
| clean (84: as taken, a PNG scan, blur 0.7, noise 3, JPEG 80, a little darker, turned 12 degrees) | 81 | 3 | 0 |
| damaged (144: blur 3 and 5, motion 25 px, noise 25, dark, low contrast, low resolution, JPEG 10 and 20, glare over the card, portrait blurred, glare over the portrait) | 1 | 47 | 96 |

Damaged caught (warn or reject) 143/144, rejected 96/144; clean rejected 0/84, warned 3/84 (two "blur 0.7" and one "a little darker"
under the id-card blur warning). Blur 3 and 5, dark, low contrast, low resolution, JPEG 10 and 20 and glare over the card are rejected
12/12; motion 25 px and noise 25 are warned 12/12; a blurred portrait on a sharp card is warned 11/12 (the miss: the finder took a
smaller block), glare over the portrait 12/12. The portrait was found on 83/84 clean pictures. **Invented pictures only**: these numbers
show the rules work as designed, not how real phone photos behave; calibrate on real photos below when MJ says so.

## Speed

MJ's target (5 Nov 2026): under 0.3 s per picture with the process pinned to 4 cores. What makes it fast: a JPEG of 3000 px or more
is decoded at half size by the decoder itself (DCT scaling; every measure works at 1000 px or less, sizes are still reported in the
stored picture's pixels); JPEGs decode through OpenCV (BGR directly, EXIF turn applied; a file that does not end on its end marker
goes through Pillow so a cut-short picture is still `imageCorrupt`); one shared 1000 px copy instead of one resize per measure;
histogram percentiles; vectorised tile statistics; the whole-picture scores, the portrait hint and the cards of a multi-id photo run
side by side in a small thread pool (`GATE_CPU_THREADS`, default 4). A multi-id photo is decoded twice side by side: a quarter-size
colour copy where the cards are found, and the whole grey picture on which they are judged (never enlarged: a card shrunk by the
decoder and enlarged again would look softer than it is).

`scripts/bench.py --cores 4` (invented pictures, pinned with the Windows affinity mask; "cpu" is the process's CPU time over all its
threads, an upper bound of the wall time on an idle machine). On the development PC, while other jobs were using 75-95% of the CPU:

| picture | median wall | cpu |
|---|---|---|
| id-card, 12 MP JPEG | 0.18 s | 0.22-0.23 s |
| document, 12 MP JPEG | 0.12 s | 0.11-0.13 s |
| generic, 1000 px PNG | 0.08 s | 0.08-0.11 s |
| multi-id, 12 MP JPEG with 8 cards | 0.42 s (about 0.05 s a card) | 0.70-0.77 s |

Before this work the same pictures took 0.75 s, 2.2 s, 0.45 s and 2.2 s. A sheet of 8 cards is 8 cards' work and stays above
0.3 s; one picture of one card is under it.

The trace of an earlier compression (5 Nov 2026) runs beside the other measures. Measured with and without it in the same run (the
four pictures above, 9 checks each, pinned to 4 cores, the PC busier than for the table): fastest 0.255 / 0.246 s (id-card), 0.185 /
0.163 s (document), 0.090 / 0.091 s (generic), 0.42 / 0.46 s (multi-id); the medians (0.34 / 0.36, 0.26 / 0.31, 0.16 / 0.13, 0.70 /
0.76 s) moved with the load more than with the trace. On that busy PC the id-card median was over the 0.3 s target with and without it. The timing test (`tests/test_align.py`) runs only with `GATE_SPEED_TEST=1` on an
otherwise idle machine, because a busy machine makes any wall-clock limit flaky.

## Calibrating with real photos (aggregate numbers only)

`scripts/calibrate.py` measures your photos and prints only counts and percentile tables per score (p1..p99), the share
rejected at the current thresholds, and a **suggested limit for a chosen reject rate**. It never prints or writes file names
or content, opens the folder read-only, does nothing if the folder is missing or empty, and works on about 58,000 files:
a streaming folder walk (no list of all paths), one file per worker, multiprocessing, fixed-size random samples (reservoirs)
for percentiles, a small state file of counters so an interrupted run resumes (`--fresh` restarts, `--limit N` stops early),
and a one-line warning if the folder is inside a git repository and not git-ignored. Point it at the folder in either way:

```
.\.venv\Scripts\python.exe scripts\calibrate.py --samples D:\HMS-training-data --profile id-card --reject-rate 0.05
$env:SAMPLES_DIR = "D:\HMS-training-data"; .\.venv\Scripts\python.exe scripts\calibrate.py
```
The default is `samples-local\` in this folder (git-ignored and docker-ignored). Keep large collections outside the repository.

## Honest limits

* A classical blur score can be fooled by very textured content (looks sharp) or very smooth content (looks blurry), and heavy
  noise inflates the Laplacian score (the gradient score helps, but not fully).
* A plain white card scores like a blank page; glare cannot be seen on pure white paper.
* The gate cannot know whether a number is readable. Only OCR can say that; a picture can pass every check and still be unreadable.
* Directional (motion) blur is detected from the x/y gradient balance and can miss slight shake on pages with few strokes.
* Thresholds shipped here were tuned on invented images. They are starting points until calibrated on real photos.
* The portrait hint is a classical photo-block finder, not a face detector: it can miss a portrait (1 in 84 invented clean pictures,
  1 in 12 blurred portraits) or take another photo-like block (a coloured logo, a hologram) for one. That is why it only warns.
  A real ID's portrait sits on busy security printing; the drawn cards here are plainer.
* A JPEG's quality comes from its table, or from the trace of an earlier compression when the picture was saved again at its own size.
  A copy that was resized, turned by a quarter turn or cut unevenly after the first compression loses the trace (the block grid score
  may still warn); one first compressed above quality 45 is not traced at all. The trace was calibrated on invented cards only.

## Environment

See `.env.example`. Required: `GATE_KEY`. Others: `GATE_DEFAULT_PROFILE`, `GATE_MAX_CONCURRENCY` (2), `GATE_QUEUE_SIZE` (4),
`GATE_MAX_UPLOAD_MB` (50), `GATE_MAX_MEGAPIXELS` (100), `GATE_JOB_TIMEOUT_S` (120), `GATE_CPU_THREADS` (4), `GATE_THRESHOLDS`.
Default port 8084. Keep `GATE_MAX_CONCURRENCY` x `GATE_CPU_THREADS` at or under the cores the container gets.

## Run and test locally (Windows PowerShell)

```
cd other-features\quality-gate
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:GATE_KEY = "<a random string of 32+ characters>"
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8084
.\.venv\Scripts\python.exe -m pytest -s
.\.venv\Scripts\python.exe scripts\calibrate_invented.py --cards 12
.\.venv\Scripts\python.exe scripts\calibrate_recompression.py --cards 12
.\.venv\Scripts\python.exe scripts\bench.py --cores 4
cd browser; node --test
```

## Deploy on the VPS

Copy this folder, `cp .env.example .env`, set `GATE_KEY`, `docker compose up -d --build` (binds 127.0.0.1:8084), and put Nginx with
HTTPS in front using `nginx.conf`. The Docker files and Nginx snippet are untested.

## Possible flow (not built)

The intended position is after the safety scan and the pixel re-save, so the checks run on the re-saved pixels, and before the reader.

Judge a picture after a safety scan and before any reading step. Nothing in this folder calls another service or reads another folder.
