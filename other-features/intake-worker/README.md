# intake-worker

The one program that runs on the VPS in "Document intake flow, version 2". The VPS has **no open port**. This worker **pulls jobs from a
database table** (`intake_jobs`, `SELECT ... FOR UPDATE SKIP LOCKED`), does every step **in memory** (nothing is written to disk),
uploads **one final encrypted picture** through a signed link that is inside the job row, and writes the result into the row. No Nginx, no
public API, no storage keys on the VPS: only one limited database login and the master key that unwraps hotel data keys.

It is fully self-contained. It imports from no other folder and calls no service. Where it needs logic that also exists in a sibling folder
(file typing, the ClamAV client, quality checks, reading, MRZ/QR/ID checks, pairing), it holds its **own copy**, marked
`copied from <folder> on 2026-11-04` (`app/readcore`, `app/gatecore`, `app/clam.py`, `tests/`). The sibling folders stay as they are and still
work alone. This folder is covered by `check-independence.py`.

## Two parts: the form first, the picture after (MJ, 5 Nov 2026)

A job runs in two parts with a status in between, so the check-in form fills in seconds and the picture is saved afterwards.

| part | steps | ends with |
|---|---|---|
| FAST (reception waits) | download, type, ClamAV, clean re-save, quality gate (judged while the card is found), find the card WITHOUT the model (the cutter's classic finder plus its edge fit and upright turn; the whole photo when nothing is found), read, field checks (Verhoeff, PAN pattern, MRZ check digits, dates), photo rule and clarity grade, front/back grouping of what it found | status `read`: fields, flags, clarity, photo outcome, card corners and timings (`formMs`) in the row. No picture is made or saved |
| BACKGROUND (no one waits) | the model cutter (MobileSAM), reading only the cards the fast part did not read, photo and clarity, grouping again (more cards, pairs, one guest's documents), enhance, stack, compress (150 KB first, 500 KB max), name, encrypt, upload | status `done`: `result_bytes`, compress scores, `background` (what it saw differently), `timings.background` |

* `Pipeline.process_fast(job)` and `Pipeline.process_background(job)` are the two worker calls (`process(job)` runs both, for tests);
  `Pipeline.fast(files, job)` and `Pipeline.background(handoff, job, forms)` are the same on in-memory files (`analyse` runs both and
  calls `EVENTS.ready` in between).
* The background part keeps the fast part's reading of every card it cuts in the same place (all four corners within 2 % of the card
  length): only cards the fast part did not see, or read with a doubt (unknown type, a failed check, the reader's own check), are read
  again, as a second opinion that can only add a flag. When the fast part found no card and read the whole photo, every card the model
  finds on that photo belongs to it. The quick finder's own outline score does not ask for a check (the model's cut is checked); an
  outline it cannot fit well (`lowContrastEdge`, `ratioOff`) is dropped and the whole photo is read. The fast part's pictures and cards stay in the worker's memory for
  its own background part (at most 8 jobs); another worker, or a retry after a crash, downloads again and reads every card again.
* **It never changes a field.** `app/store.py` lets the background part write only `SAVE_COLUMNS` (never `fields`). When it finds
  more or fewer cards or people, a different pairing or document type, a key value read differently (name, dob, gender, number,
  address, passport and visa numbers, expiry, nationality), or a photo it would reject, it adds the code to
  `background.disagreements`, flags `backgroundDisagrees` and sets `needs_human_check`: the form turns yellow. A person only the model
  found gets its own result with `backgroundOnly` (a worker job keeps one picture: the fast part's person). A fast person the model
  cut differently is stored from the fast part's own cards (`unmatched`), never as someone else's picture.
* **Retry-safe.** A crash in the background part puts the job back to `read` (`background_attempts` + 1, the fields untouched); after
  3 attempts `needs_attention`, fields kept, no picture. A job stuck in `saving` for 9 minutes goes back to `read`.
* **Priority.** A queued job's fast part is always taken first. A background part is taken only when nothing is queued and fewer than
  `INTAKE_BACKGROUND_THREADS` (default threads - 1) background parts run, so one thread is always free for the next form.
* **No QR (MJ, 5 Nov 2026).** QR and barcodes are not decoded in either part (`INTAKE_READ_QR=false`, the default); the code stays
  and `INTAKE_READ_QR=true` turns it back on (tested). Without it there is no Aadhaar QR cross-check, no `qrLast4`, and no pairing
  by a QR (`qrNameDob`): a back without a number pairs only by position or stays a lonely side.
* **Speed, same answer.** The other scripts (Hindi, Gujarati) and the MRZ strip are read by Tesseract AT THE SAME TIME as RapidOCR
  reads Latin and are used only where the plain order would have read them; the portrait is looked for while the card is read;
  onnxruntime runs one thread per CPU the process may use (`INTAKE_OCR_THREADS`; a process pinned to 4 of 6 cores ran 6 threads).
* **A sheet of many IDs fills the form fast (MJ, 5 Nov 2026).** The quick finder finds every card of a sheet without the model: the
  sheet's colour comes from the scan's outer ring (a sheet full of cards made the old estimate take a card's tint), and an island that is
  not card shaped (sleeves touching: two columns of five on an A4 page) is cut along the emptiest straight lines one card pitch apart
  (`cardcut._split`; a way counts only when every piece is card shaped; a piece must show a card edge on every side, so a photo box or a
  coloured band is never a card). The cards are edge-fitted and read side by side (`INTAKE_CUT_THREADS`, `INTAKE_READ_THREADS`); a card the
  cutter turned upright skips the orientation check and RapidOCR's per-line turn check. `Pipeline.analyse`, the folder runner and the
  bench get one form per guest at form-ready time; a worker job still keeps one person (`severalPeople`). The background part links a
  model cut to the fast card it overlaps (70 % of the smaller outline) when the corners differ by more than 2 %, so no guest is stored twice.
* **Attempt guard.** Just before the upload the background part asks the row whether it still holds the job (`Store.owns`: status `saving`
  and the same `background_attempts`; the check renews `saving_started_at`). A swept attempt that wakes up late uploads and writes nothing
  (`job_superseded` in the log).
* **PDFium one thread at a time.** `app/readcore/pdfsafe.py` holds one lock for every PDFium call (re-save, the reader's PDF path, the gate
  copy, the tests); every bitmap is closed inside it and the lock is taken for good at exit before pypdfium2 unloads the library. Eight
  threads drawing invented PDFs crashed natively in 3 of 3 runs before (0x80000003, 0xC0000409, the heap corruption 0xc0000374 seen in the
  full suite), 0 of 3 after.
* **Exact copy (`lossless` in the job row).** The hotel's "ID pictures: keep an exact copy (bigger files)", set by the Super Admin on the
  hotel's Integrations tab (HMS platform 0196 `hotels.id_photo_exact_copy`, copied into the job row): WebP lossless (about a third smaller
  than PNG; a 1200 x 1554 front and back photo is 522 KB against 774 KB), no enhance, no OCR round trip; above the cap it is flagged
  `sizeCapExceeded`, never made smaller.

## The steps (per job)

| step | what | limits / failure |
|---|---|---|
| 4 download | GET the signed link from the job row into memory (https and the storage host only) | 25 MB; a failure is retried |
| 5a type | real type from the bytes: JPEG, PNG, WebP, HEIC, PDF only | other types rejected before any decoding |
| 5b scan | **YARA rules** on the bytes in memory before any decoding (`app/yara_scan.py`, `app/yara_rules`), then ClamAV over the clamd INSTREAM protocol; the worker's clamd loads the official signatures **and the Sanesecurity feeds** (see "Scan" below) | rule hit = rejected (`yara_match`); infected = rejected (`malware_found`); rule engine timeout or error, or clamd unreachable = retried, **never "clean"** |
| 5c re-save | pictures decoded to a fresh **lossless pixel array** (EXIF orientation applied as a lossless turn, all metadata dropped, transparency on white); every PDF page rendered at **300 dpi** by PDFium and the PDF discarded | 40 megapixels (checked from the header, before anything else opens the file), 20 pages (checked before rendering), 40 megapixels per PDF page and 175 megapixels per PDF (oversized pages are drawn smaller), Pillow bomb guard on; a PDF is a PDF only when `%PDF-` is at byte 0 |
| 6 gate | blur, glare, dark, small, cut off, blank, on the re-saved pixels; profiles `id-card`, `document`, `photo` | reject, or warn and carry on: `gate_action` in the job row |
| 7 read | find and straighten the card, type from the registry (Aadhaar/e-Aadhaar, PAN, passport, visa, driving licence, voter ID, more, other), OCR (RapidOCR; Tesseract for Gujarati and other scripts), MRZ check digits, Verhoeff, front/back same-person verdict; QR/barcodes and the Aadhaar QR cross-check only with `INTAKE_READ_QR=true` (off) | a doubtful field is **flagged, never guessed**; unknown types are kept as plain pictures with `needs_human_check` |
| 7a photo + clarity | the holder's portrait found on each card side (YuNet) and compared between cards (SFace) as extra evidence; every card graded clear / usable / unclear with reasons (see "Photo check" and "Clarity check" below) | an unclear card or a key field read from an unclear region = `needs_human_check` + a retake line; an unclear ID photo where the side must carry one = rejected (`photo_unclear`, follows `gate_action`); a JPEG below quality 25 = "picture too compressed"; embeddings never leave memory |
| 7b enhance (stored copy only) | after reading: levels stretch (percentiles), gamma for a dark picture, gentle white balance, mild denoise (strength follows the measured noise), mild unsharp mask, at most 2x enlargement of a tiny card. Each fix runs only when its problem was measured; a clean picture is left byte-identical. Names of the fixes are in scores.enhance; switch: `AUTO_ENHANCE` (default true) or `auto_enhance` in the job row. OCR, field checks and evidence use the untouched re-saved pixels | |
| 8 merge + compress | front over back, one picture; the **only lossy step**: size cap **500 KB** (512000 bytes, `size_cap_bytes` per hotel). Order: lossless PNG when a small picture already fits; else the **best JPEG quality that fits** (bisection) with SSIM at least **0.98** against the enhanced picture; else WebP; else scale down in steps (last resort, flag `downscaled`); else the larger picture is kept and `sizeCapExceeded` is flagged (quality wins over size, as the plan says). With the hotel's exact copy (`lossless`): WebP lossless, no enhance, `sizeCapExceeded` above the cap. Below JPEG 92 an **OCR round trip** re-reads each side that supplied a key field and the key fields must be unchanged, else the next quality down is tried | 
| 9 encrypt + upload | AES-256-GCM with the hotel's data key (unwrapped from the job row with the master key); PUT to the signed upload link; fields, flags, scores and timings written to the row (never the full OCR text); status `done` | if encryption fails the job stops with `needs_attention` and **nothing is uploaded** |

A picture with several cards (fronts and backs of several people) takes the multi-card path instead of steps 7-8 as one card: cut every card
(`app/cardcut.py`), read each alone, group them into people (`app/people.py`), then enhance, stack and compress to 500 KB **per person**. See
the two sections at the end.

HMS deletes the quarantine object, not the worker. The worker never sees the hotel database.

**No ID is masked.** The only masking is the optional job-row setting `mask_id_numbers` (default **false**): when a hotel switches it on, the first
eight digits of a valid Aadhaar number are painted over in the final picture (`app/mask.py`, own test). It does nothing by default.

**Document types** come from the built-in registry. A job may also carry an optional `document_type` hint and a `type_config` JSON (name, keywords,
a regular expression per field), so a type can be added from the Super Admin list without changing worker code; the reader still guesses the type
and returns it as `guessed` for reception to confirm.

## The queue

* `FOR UPDATE SKIP LOCKED` pull, every second with jitter, one job per thread; threads = cores minus one. Queued jobs (fast part) first,
  then `read` jobs (background part, at most `INTAKE_BACKGROUND_THREADS` at once).
* Heartbeat row every 30 s in `worker_heartbeat` (last seen, version, queue depth, **ClamAV signature date**, **oldest good Sanesecurity check**
  in `feeds_date`). HMS alerts on: heartbeat older than 2 minutes, oldest queued job older than 5 minutes (for 10), either signature date older
  than 48 hours. The worker also logs `signatures_stale` (code `clamav_signatures_stale` or `sanesecurity_stale`, count = hours, -1 = none yet)
  at most once an hour.
* A job in `processing` for over 3 minutes goes back to `queued` (attempts + 1); after 3 attempts `needs_attention` with the **step name only**.
  A job in `saving` for over 9 minutes goes back to `read` (background_attempts + 1), its fields kept.
* A rejected file is never retried; a system error is.
* The worker writes the name of each step into the row as it starts (`step`), so a killed job keeps where it stopped. Only the latest claim
  may write its result (`attempts` must still match): a "dead" attempt that wakes up after the sweep changes nothing (`job_superseded`).
* Database unreachable: sleep with backoff (1, 2, 4 ... up to 30 s) and retry; nothing is lost. When it goes away just as a job is finished,
  the result is kept in memory and written when it is back (up to 120 s of backoff, under the 3-minute sweep); after that the sweeper
  re-queues the job. SIGTERM: finish the current job, then stop.

`sql/proposal.sql` is a **proposal only** (never run anywhere): the table, the pull and sweep indexes, the `intake_worker` role and its grants
(SELECT on `intake_jobs`, UPDATE on its own result columns, INSERT on `worker_heartbeat`, nothing else). HMS owns the real migration.

## Scan

Two engines, both inside the VPS, both in the fast part of the flow.

**YARA** (yara-python 4.5.4, Apache-2.0; YARA BSD-3-Clause), on the downloaded bytes in memory before anything is decoded. Rules in
`app/yara_rules` (copied from antivirus on 2026-11-05 and adapted, original rules, no third-party rule text), compiled once when the worker starts
(a broken rule file stops the start):

* `image_polyglot`, on the whole file: a picture that is also a Windows or Linux program, a ZIP/RAR/7-Zip archive, a Java class or a shebang
  script, a PDF, a web page, or carries script code (`<?php`, `<script`, JSP/ASP, WScript, encoded PowerShell, HTA).
* `pdf_active`, on the whole PDF and on a copy with `#xx` name escapes undone: JavaScript, Launch, attached files, rich media/Flash/3D, an
  open action that leaves the file.
* `trailing_data`, only on the bytes after the real end of the file: JPEG and PNG are walked marker by marker / chunk by chunk (a fake end
  marker after a hidden payload does not fool it), WebP by its RIFF length, HEIC by its last box, PDF after the last `%%EOF`. Scripts,
  programs and archives there are refused. Phones may append a motion-photo video there, so only strings of five bytes or more, or a header at
  the very start of the tail, count (a test appends 8 x 2 MB of random bytes to a photo: no hit).

A hit refuses the file with code `yara_match` and the rule's plain sentence; the log line carries the rule names only. Limits: 10 s for all rule
passes of one file (`YARA_SECONDS`) and the 25 MB intake limit (`YARA_MAX_BYTES`, refused as `yara_too_large`). A timeout (`yara_timeout`) or an
engine error (`yara_error`) is retried, never "clean". Without yara-python the worker does not start (`INTAKE_ALLOW_NO_AV=true`, tests and folder
runs only, skips it). A clean result names both engines in `scan_engine`, for example `ClamAV 1.4.2 + YARA 4.5.4`.

Cost of the rule scan on this PC (i7-11600H, Windows, warm, median and max of 30, invented gradient-plus-noise pictures), measured with
`python scripts\bench_scan.py` while other test jobs were running on the same PC (a quiet run before that gave 16.0 ms for the JPEG):

| file | size | median | max |
|---|---|---|---|
| JPEG 2600x1950, quality 95 | 4.04 MB | 25.6 ms | 46.0 ms |
| same JPEG + 2 MB appended "video" | 6.05 MB | 51.2 ms | 101.4 ms |
| PNG 1400x1000 | 3.86 MB | 22.9 ms | 30.3 ms |
| PDF with that JPEG as its page | 4.05 MB | 25.3 ms | 56.8 ms |
| WebP 2600x1950 | 2.90 MB | 15.4 ms | 19.4 ms |

Compiling the rules: 3.8 ms, once per start. Target for a 3 MB photo was under 50 ms: met (a 4 MB JPEG takes 16-26 ms; the max under load
was 46 ms). The cost grows with the file size (about 6-8 ms per MB). A PDF is scanned a second time with `#xx` escapes undone only when it has
an escaped name, which halved the PDF time (49-56 ms before, under the same load). Before this change the scan step was ClamAV alone, so the
rule scan adds these milliseconds and nothing else.

**ClamAV** (`clamd/`, the worker's own clamd image, written without Docker and **never built**): the official `clamav/clamav:1.4` image with
freshclam twice a day (`FRESHCLAM_CHECKS=2`), plus the **Sanesecurity** feeds through **fangfrisch 1.9.3** (the downloader Sanesecurity recommends;
GPL-3.0, its own virtualenv, run as a separate program): only Sanesecurity's own sets (`badmacro.ndb`, `foxhole_filename.cdb`,
`foxhole_generic.cdb`, `foxhole_js.cdb`, `foxhole_js.ndb`, `hackingteam.hsb`, `malwarehash.hsb`, `rogue.hdb`, `shelter.ldb`, `sigwhitelist.ign2`,
`sanesecurity.ftm`), checked once a day, SHA-256 checked, `clamdscan --reload` after an update. Terms (https://sanesecurity.com/legal/, checked
4 Nov 2026 for the antivirus folder): free in commercial products, a donation and an email naming the product are requested, no re-hosting, so
every server downloads its own copy. `clamd/feeds.sh` loops hourly (fangfrisch only downloads when the day has passed, so the loop just retries a
failed check) and after each run `clamd/stamp.py` sets `/var/lib/clamav/sanesecurity.checked` to the **oldest** good check among the eleven files
(fangfrisch's refresh log), so one feed that keeps failing ages the stamp. The worker mounts that folder read only (`INTAKE_SIGNATURES_DIR`) and
puts the stamp time in the heartbeat. Outbound for the clamd container: `database.clamav.net` (freshclam) and `mirror.seichter.de` (fangfrisch's
Sanesecurity mirror, plain HTTP, every file SHA-256 checked).

Tests (`tests/test_yara_scan.py`, `tests/test_clamd_feeds.py`, the nasty-file set): clean JPEG (also with EXIF and progressive), PNG, WebP and PDF
pass; a ZIP-in-JPEG, a JPEG with a PHP tail, script tails in a PNG, an ELF hidden behind a fake JPEG end marker, a web page in a JPEG, a PDF in a
PNG, PDFs with JavaScript (also `#xx`-escaped), Launch or an attached file are refused before clamd is asked; the EICAR string passes the rules
and is caught by clamd. **clamd itself did not run here** (no Docker on this PC): the clamd path is tested with the folder's in-memory stand-in
(`tests/fake_clamd.py`). yara-python is not in the main project's `.venv`; it was installed into a separate `.venv-extra` that sees the main
environment through a `.pth` file. Install it with `pip install -r requirements.txt`; without it the YARA tests skip.

## Logging

Structured JSON with only these keys: event, job (a random id), step, status, code, ms, attempt(s), counts. No file content, names, ID numbers,
signed links or keys: a scrubber blanks any value that looks like a link, a long token or a long number. A test searches the captured logs.
The `httpx`, `httpcore` and `PIL` loggers are held at WARNING: at DEBUG, Pillow prints every EXIF value it reads (GPS, camera owner), and
httpx prints the signed links.

## Part 10 tests (plan part 10, 5 Nov 2026)

Invented files only, made by `tests/part10_files.py` in memory (the EICAR string is assembled at run time and never written to disk).
Every file goes through the whole worker: a `FakeStore` row, the real pipeline, the mock storage links and the fake clamd.

| set | file | what happens (code, step) |
|---|---|---|
| nasty | EICAR string alone (and after spaces) | `unsupported_type` at `type`, before the scan and before any decoding |
| nasty | EICAR appended to a valid PNG | `malware_found` at `scan` (fake clamd; a real clamd is tested when one answers at `INTAKE_TEST_CLAMD`, default `tcp:127.0.0.1:3310`: none on this PC, skipped) |
| nasty | scanner refuses, never answers, hangs up, answers nonsense or an error | `scanner_unavailable` / `scanner_error` at `scan`, back to `queued`; after 3 attempts `needs_attention`; **never "clean"** |
| nasty | PNG 40,000 x 40,000; PNG 9,000 x 9,000; JPEG 40,000 x 40,000 | `too_many_pixels` at `rebuild`, from the header |
| nasty | PDF of 2,000 pages | `too_many_pages` at `rebuild`, before any page is drawn |
| nasty | 20 PDF pages of 200 x 200 inches | drawn at 175 MP in all (40 MP per page at most) in 1.4 s (3.4 s with the whole suite running); was 800 MP |
| nasty | PDF with JavaScript on open, an embedded file and a file-attachment annotation | done: one picture, no `%PDF`, `/JS`, attachment name or payload left |
| nasty | JPEG that is also a ZIP | done: the ZIP part is gone |
| nasty | Windows exe, exe with a JPEG inside, exe with `%PDF-` in its first kilobyte, ELF, shell script, HTML (all "named .jpg"); SVG, SVG with prolog, SVG with BOM, SVGZ; empty file | `unsupported_type` at `type` |
| nasty | 26 MB photo (a real PNG); more than 25 MB sent without a length | `file_too_large` at `download`, the stream is cut at 25 MB |
| nasty | password-protected PDF (RC4, with a user password; it opens with the password, so it is refused for the right reason) | `pdf_encrypted` at `rebuild` |
| nasty | truncated JPEG, truncated PNG, JPEG header only, broken PDF | `image_corrupt` / `pdf_corrupt` at `rebuild` |
| nasty | HEIC with GPS | done, no metadata |
| privacy | JPEG, PNG and HEIC with GPS, camera make, model, owner, serial, XMP, ICC profile, comment, PNG text; lossy and lossless | the stored picture has no EXIF, XMP, ICC, comment or text chunk, and none of the invented values; nor does the job row |
| privacy | JPEG (EXIF orientation 1, 3, 6, 8), PNG, PNG with transparency, WebP lossless, HEIC (1, 6) | the re-saved pixels equal the input pixels (EXIF turn applied, transparency on white); HEIC equals libheif's own decode |
| privacy | a lossless job, no enhance | the stored WebP lossless picture is the input picture pixel for pixel |
| privacy | four whole jobs (a read card, a PDF whose text layer holds the name and number, a rejected file, a job whose scanner is down) with every logger at DEBUG, stdout and stderr captured | no line carries the invented name, a part of it, the DOB, the number, a link or an EXIF value |
| failure | a job stopped at the start of `read` | the row says `processing` at `read`; the sweep re-queues it, a second worker finishes it (attempt 2); the first attempt's late result is dropped |
| failure | killed at `read` three times | `needs_attention`, step `read`, code `stuck`, no message |
| failure | database down while idle; down when the result is ready; down for too long; step name not writable | backoff 1, 2, 4, 8, 16 (then 30) s and resume; the result is written in the same attempt; the sweeper re-queues it; the job still finishes |
| failure | an idle worker, one new job | picked up 0.61 s after it was queued (plan: within 2 s) |
| failure | 50 invented one-picture jobs (Aadhaar, PAN, licence, voter ID; PNG and JPEG) queued at once, real pipeline, 3 threads | all 50 done on the first attempt; drained in 65.3 s; queued to done p95 64.1 s; work per job p50 3.7 s, p95 5.7 s |

Every refused file above is refused in under 50 ms (a scanner that never answers: 1 s, the test's client timeout; the worker's is 30 s).
Measured on MJ's PC (i7-11600H, 6 cores) on 5 Nov 2026 with
`.\.venv\Scripts\python.exe -m pytest tests/test_part10_nasty.py tests/test_part10_privacy.py tests/test_part10_failure.py -s`. The 50-job drain is the whole job (cutter included), not only the fast part that
fills the form. Before these tests the same files found: a JPEG bomb crashed the worker (`internal`, retried, then `needs_attention`)
instead of being rejected, a scanner failure was stored without its step name, Pillow's DEBUG lines carried the EXIF values, and a
result finished while the database was away was lost and redone after the 3-minute sweep.

Not covered here: a real `kill -9` of the process against PostgreSQL (the `FakeStore` lives in one process, so the dead worker is a thread
stopped for good), a real clamd, and memory use of the bombs (refused from the header, so nothing is allocated).

## Limits of what was measured (honest)

* Tests ran on this Windows PC with the real RapidOCR 1.4.4 + onnxruntime, real Tesseract 5.4 and real PDFium; **clamd and the database were fakes**
  (an in-memory clamd speaking INSTREAM, an in-memory `FakeStore` with the same rules). The `PgStore` SQL and the Docker files are **untested**.
* **Speed of the two parts (5 Nov 2026)**, `scripts\bench.py --runs 20 --cases single` (one invented Aadhaar front photographed on a
  desk, 2400 x 1800, warm, pinned to 4 cores, 20 runs; other programs shared the PC, so the load is given):

  | | p50 | p95 | PC load |
  |---|---|---|---|
  | before: the old one-part code, form ready = all done | 11.33 s | 12.74 s | 76-94 % |
  | after: form ready (fast part) | 2.87 s | 3.40 s | 76-94 % |
  | after, with the faster edge fit: form ready (fast part) | **1.67 s** | **2.01 s** | 11-38 % |
  | after: picture saved, after the form | 5.64 s | 5.98 s | 11-38 % |
  | after: two phone photos in one job (`pair-photo`), form ready | 6.08 s | 9.36 s | about 70 % |

  Target p95 at most 3 s for one image: met on the quiet run, not on the busy one. Fast part steps (median, quiet): find 422 ms with
  the gate (211 ms) alongside it, read 1094 ms, photo + clarity 110 ms. The edge fit of the cutter (`_snap`, `_side_strip`) computes the
  same numbers faster (all tilts at once, the gradient per channel): quads, flags, scores and card pixels identical on 86 invented
  photos and scans with both finders. The old plan's 6 s for both sides is not measured on a quiet PC.
* **Fast fields = old fields**: on 125 invented pictures (every drawn kind, flat, as a phone photo, as a sleeved scan, the bench cases)
  112 are identical; the 13 others are QR-derived (5), the old code itself varying between runs (1), a sheet of ten cards by design (1),
  a card the classic finder could not fit and the whole photo read (1, same fields, now a check), and MRZ or printed fields that flip on a
  cut a hair (at most 0.05 px) apart (6: 2 better, 3 worse, 1 neutral, all `needs_human_check`). Details in
  `docs/Intake-Flow-Current.md`.

* The isolation set (hotel A's link cannot write into hotel B's folder, the 60-second download link) needs a real Supabase project: skipped here.
  The grants in the proposal are checked as text; they were never run.
* The passport MRZ strip is read less reliably than the rest; the MRZ pass below took the share read fully correct on invented pages
  from 66 to 90 of 100. What is still not read stays doubtful (`mrzValid` false) and is flagged for a person.

## MRZ pass (`app/readcore/mrzpass.py`, 5 Nov 2026)

When the first read of a card has no MRZ whose check digits all pass (or its names line was read short), the MRZ rows are found: the
lines the first read placed (three or more `<`), else a band of two or three long, evenly tall lines in the lower half of the upright
page (blackhat, horizontal gradient, closing), else the same on the page turned a half turn (a card turned the wrong way up). The band
is cut out with a margin, scaled so its letters are about 40 px tall, split into rows by its ink profile, and each row is read alone
by RapidOCR's recogniser (no detection; Tesseract on one line with the MRZ characters only when RapidOCR is missing) after up to four
binarisations: grey, sharpened, Otsu, lighting flattened. It stops at the first reading that passes with the names line whole.
`mrz.choose()` picks among all readings (the first read and every pass reading, and their lines tried together): only a reading whose
check digits ALL pass is taken; passing readings that differ on a checked line are not trusted (`readingsDisagree`, MRZ doubtful); a
names line (no check digit) spelled differently by passing readings marks the name doubtful (`namesAgree: false`, confidence 0.6);
a names line read short is outvoted by a whole one. Nothing is corrected: a letter read as a digit where no check digit covers it (a
country code UTO read UT0) leaves the MRZ doubtful. A card with no MRZ-like line and no MRZ-shaped band skips the pass; a band that
reads without a single `<` stops after one reading.

`scripts/measure_mrz.py --people 10` (10 invented holders, a passport data page drawn like `tests/idkinds.passport_foreign`, read as
the pipeline reads a cut card; correct = both lines exactly right with every check digit passing; wrong = every check passing but a
character differs, a silent misread):

| damage (10 pages each) | before: correct / doubtful / wrong / missing | after |
|---|---|---|
| clean | 10 / 0 / 0 / 0 | 10 / 0 / 0 / 0 |
| blur 1.2 px | 7 / 2 / 0 / 1 | 10 / 0 / 0 / 0 |
| blur 1.8 px | 0 / 6 / 0 / 4 | 6 / 1 / 0 / 3 |
| glare over part of the MRZ | 10 / 0 / 0 / 0 | 10 / 0 / 0 / 0 |
| half size | 9 / 0 / 0 / 1 | 10 / 0 / 0 / 0 |
| 0.4 size | 9 / 0 / 0 / 1 | 10 / 0 / 0 / 0 |
| JPEG 35 | 6 / 4 / 0 / 0 | 10 / 0 / 0 / 0 |
| JPEG 20 | 6 / 2 / 1 / 1 | 10 / 0 / 0 / 0 |
| noise 8 + JPEG 60 | 6 / 3 / 0 / 1 | 10 / 0 / 0 / 0 |
| 0.6 size + blur 1 + JPEG 50 | 3 / 6 / 0 / 1 | 4 / 6 / 0 / 0 |
| **all** | **66 / 23 / 1 / 10** | **90 / 7 / 0 / 3** |

The one silent misread before (JPEG 20) passed every check digit with a character that differs from the truth; after, none. Cost
(this PC, other jobs keeping it 70-95% busy): the pass alone is 0 s on most pages (the first read already passes), 1.95 s at the 90th
percentile and 3.05 s at most; a card with no MRZ costs about 16 ms (median of 10 invented Aadhaar, PAN and licence cards) where
the old bottom-strip Tesseract read cost about 0.37 s. The whole card read went from a median of 6.3 s to 6.3 s in these runs (the
load moved more than the pass). The invented pages use Consolas, not the OCR-B face real passports print; real pages wait for MJ's
order.
* SSIM uses an own OpenCV implementation (luminance) instead of scikit-image, which pulls in a large dependency.

## Run and test locally (Windows PowerShell)

```
cd other-features\intake-worker
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts\get_model.py
.\.venv\Scripts\python.exe scripts\get_face_models.py
.\.venv\Scripts\python.exe -m pytest -s
```
`.tessdata` (git-ignored) holds the Tesseract language files for the tests; `models/` (git-ignored) holds the card cutter model that
`scripts/get_model.py` fetches and checks (without it the cutter tests skip and the fallback finder is used) and the two face models that
`scripts/get_face_models.py` fetches and checks into `models/faces` (without them the photo tests skip and every photo outcome is "unclear").
Settings: see `.env.example` (`INTAKE_DATABASE_URL`, `INTAKE_MASTER_KEY`, `INTAKE_CLAMD`, `INTAKE_ALLOWED_HOSTS`, `INTAKE_SIGNATURES_DIR`, `INTAKE_THREADS`,
`INTAKE_BACKGROUND_THREADS`, `INTAKE_OCR_THREADS`, `INTAKE_READ_QR` (off), `AUTO_ENHANCE`, `CARDCUT_MODEL`, `FACE_MODELS_DIR`, and any
`CLARITY_*` / `FACE_*` threshold from `app/thresholds.py`). The worker
refuses to start without a 32-byte master key and a database URL, and never starts without a scanner.

## VPS

`docker-compose.yml`: two containers only (worker + clamd, the clamd built from `clamd/`), no published ports, non-root, read-only root file system, `no-new-privileges`, memory and CPU
limits, a small tmpfs, a private network. `deploy/harden.md` and `deploy/ufw.sh` (deny all inbound except SSH on a non-standard port, key only, fail2ban,
an outbound allow-list, unattended upgrades, daily freshclam, monthly image rebuild) are **written but not run**. Retention facts (HMS owns retention: quarantine
24 h, id-store per hotel setting, job rows trimmed after 90 days, heartbeat 7 days) are noted in `deploy/harden.md`.

## Possible flow (not built)

HMS writes the job row and the signed links; the worker does the rest; HMS makes the profile. Nothing here calls another service.

## Several cards in one picture: one picture per person (`app/people.py`)

A sheet (photo or PDF page) with up to 12 cards, fronts and backs of several people, gives **one final picture per person**: front on top,
back below, same width, a white gap, no border, then the usual enhance and the 500 KB compress with the SSIM rule. `Pipeline.analyse` returns a
**list** of (values, picture) instead of one when `multi` is true in the job, or when it is not set and the profile is `id-card` and the
upload is a photo (MJ, 5 Nov 2026: every ID photo takes the card path, one card or many; a PDF with a text layer and `multi: false` keep the
page-reading path). The worker's job also takes the card path and keeps ONE person (the first; `severalPeople` + a check when the fast
part found more); `multi: true` there is refused with `multi_not_supported` until HMS sends one link per person.

* Cutting: `app/cardcut.cut_cards` (see "Card cutter" below; without the model file or torch it uses its own fallback, flag `fallbackFinder`).
  `people.classic_cut` is only a last resort when `app/cardcut` cannot be imported at all. Each card is read alone (fast, en/hi/gu) on
  the untouched pixels; side: front = printed name, date of birth, gender; back = address, the word Address, a pin code.
* Pairing evidence, strongest first: same valid Aadhaar number (Verhoeff), same other ID number, a QR's name and date of birth matching the other
  card WITH its number tail found on the other card (all three STRONG); then the weak ones: the MRZ's or the printed name and date of birth, a QR's
  name and date of birth whose number tail cannot be checked; address only as support.
* **Namesake rule (MJ, 4 Nov 2026).** Two cards are one card shown twice (`duplicateCard`) or one person's front and back ONLY with strong
  evidence. A name and full date of birth alone never make a duplicate; they pair a front with a back only when NEITHER card has a checked number
  or a QR AND the two ID photos match (then `pairedByNameDobAndPhoto`). Otherwise the cards stay apart with `sameNameDobNoNumber`.
* **RARE (MJ, 4 Nov 2026).** Two people of one document type with the same full name and the same FULL date of birth that no valid number
  or QR joined (none read, or two different numbers) stay two people, never merged. Reception is NOT warned for this reason
  (`sameNameDobNoNumber` alone no longer sets `needs_human_check` when the case is rare); instead `rare: true`, flag `rare`, the file name
  ends in `_Rare` (`Rajiv_Sheth_Aadhaar_Rare.jpg`, then `_Rare_2`) and the report says `rare=yes`. A year of birth alone is not the rare
  case (it still needs a check); a photo match or mismatch changes nothing here (a mismatch only confirms two people).
  OCI and PIO numbers have no check digit: a labelled, well-formed one counts as a document number (a number whose check FAILS, like a
  misread Aadhaar, never does).
  A clear photo mismatch blocks a pair or a duplicate that a number supports (`photoMismatch` + needs check). Two valid numbers of one kind
  that differ = never together. A different date of birth blocks everything except a number match (then `evidenceConflict`). Layout (the
  clearly nearest card of the other side on the same picture, each the other's) is a SUGGESTION: `layoutSuggestsPair`, the card in
  `person.suggestedPartner`. Equal evidence for two partners: `ambiguousPair`, nothing paired. A lonely side: `unpairedSide`.
* **Side-by-side pairing (MJ, 4 Nov 2026).** The suggested front and back are PAIRED (evidence `position`, flag `pairedByPosition`,
  `person.pairedByPosition`, report column `paired_by_position`) only when: no number or QR could decide (not both cards carry one); nothing
  conflicts (no date of birth, gender, QR or number-tail disagreement); the front's portrait is clear; and the two cards look alike:
  sizes within 8%, card colour (Lab median of the lighter half) within 6, print style (Bhattacharyya distance of the gradient-strength
  histograms) within 0.30, edge share within 3x (`PAIR_*` in `app/thresholds.py`; the numbers are in `person.lookAlike`). On invented cards
  one document's two sides differed in colour by 0-5.4 and two different documents by 3-23, so the look-alike check is a GUARD, not proof:
  the pair also needs the same (or an unread) document type and the single-nearest layout. Otherwise it stays a suggestion. Two
  different documents of one guest still link only by a number, or full name + DOB + photo match.
* Each person: `fields` (name, dob, gender, documentNumber, address from the back) with confidence, `person` (cards, sides, evidence, duplicates,
  guest links, `possibleSameGuestAs`, `suggestedPartner`), `clarity`, `photo`, `suggested_name` (`FirstName_LastName_IdName`, `app/naming.py`).
* Limit: the automatic switch misses cards that are as light as the paper in a photo (no outline to see). Use `multi` / `--multi on` for sheets.

### ID kinds (types, sides, pairing, names)

| kind (IdName) | detected by | fields | sides / pairing |
|---|---|---|---|
| Aadhaar: old laminated, PVC with secure QR, e-Aadhaar letter (`Aadhaar`) | Verhoeff number, keywords en/hi/gu, QR (XML or secure), letter words (Enrolment No., Your Aadhaar No.) | name, dob (or year), gender, number, address, VID (never evidence), form card/letter | card: front/back by number or QR name+dob; letter: single |
| PAN, old and new with QR (`PAN`) | pattern + income-tax keywords | name (label below on the new card, unlabelled on the old), father's name, dob, number, form | single |
| Driving licence: smart card, old state formats (`DrivingLicence`) | keywords, `ids.dl_valid` (state code, RTO, year; MH12 20110012345, GJ01 20190001234, MH-12/0034567/2008) | name, dob, S/D/W of, address, issue, validity, vehicle classes | front/back by the licence number; back = classes of vehicle |
| Voter ID / EPIC (`VoterID`) | keywords, 3 letters + 7 digits | name, relation, dob or age, gender, address | front/back by EPIC |
| Passport: Indian data page + last page, any country (`Passport`) | TD3 MRZ with check digits; printed labels; last-page words (File No., Legal Guardian, Old Passport No.) | MRZ fields (dates as YYYY-MM-DD), nationality, expiry, issue, places, file number, old passport, parents, address | data page = front (complete alone; Indian: flag `addressPageMissing`), last page = back, paired by passport number |
| Visa (`Visa`): sticker MRV-A / MRV-B (form `mrv-a`/`mrv-b`), older sticker without an MRZ (`printed`), e-Visa ETA printout (`eta`) | MRZ starting V (no composite digit); visa words + Visa No / Type / Entries / Valid labels; ETA words (Electronic Travel Authorisation, e-Visa, ETA issue/expiry) | MRZ or printed fields, passport number, visa number (ETA: application ID), type, entries, valid from/until, validity, form | single; linked to the passport |
| OCI (`OCI`): card, old booklet data page (`booklet`), U-visa sticker in the foreign passport (`u-visa`) | Overseas Citizen of India words, OCI / registration number; U-visa = a visa with Type U / lifelong (beats the visa type) | OCI number, name, dob, nationality, foreign passport number; U-visa: MRZ fields, the sticker's own number as `visaNumber` | single; linked to the passport |
| PIO card, legacy (`PIO`) | Person of Indian Origin words + PIO card number | PIO number, name, dob, nationality, passport number | single; linked to the passport |
| ID cards TD1/TD2 (`NationalID`) | MRZ (I/A/C, not IR/AR/CR) or ID-card words + a number label | MRZ or printed fields, address | TD1: printed front, MRZ back; paired when the checked MRZ number is printed on the other side, or MRZ name+dob = printed (`mrzNameDob`) |
| Residence permit (`ResidencePermit`): TD1/TD2 card (MRZ codes IR, AR, CR, RP), FRRO residential permit / registration certificate printout (`frro`) | MRZ code, residence-permit words in several languages; FRRO words (Foreigners Regional Registration Office, Residential Permit, e-FRRO) | as ID cards; FRRO: RP number, name, dob, nationality, passport number, visa number, visa type, valid till, address in India | card: as ID cards; FRRO: single; linked to the passport |
| Employee card (`EmployeeCard`) | keywords | name, number | front alone is complete |
| Unknown (`Document`) | nothing above 0.5 | none (reception types them) | flagged `unknownDocumentType` |

Two cards of different known kinds are never paired, never treated as copies and never stacked. Two people of different kinds are
linked as one guest (`person.guest`, `person.sameGuestAs`, flag `sameGuestOtherDocument`, one picture per document) only on STRONG
evidence, with no gender clash and no second candidate of the same kind: the same checked number (`documentNumber`), or a visa, OCI,
PIO or residence permit that prints the passport number of a passport in the same job (`guestEvidence: passportNumber`; an older
visa sticker carries no date of birth; not when the date of birth or gender disagrees or the names are clearly someone else's), or
the same name AND full date of birth AND matching ID photos (`nameAndDob`, `photoMatch`). Name and date of birth without a photo
match is only a suggestion: `possibleSameGuest`, `person.possibleSameGuestAs`, needs check, never a link. A clear photo mismatch
blocks any link (`photoMismatch`). Different forms of one kind (OCI card and OCI U-visa, visa sticker and ETA, permit card and FRRO printout) are separate
documents of one guest, never copies. A name the OCR read without spaces is spaced only from a second source with exactly the same
letters (the card's QR, the other side, the same guest's other document). An MRZ names line the OCR read short (padded) loses to a
clearly printed name on the other side, and the clash is shown as `conflicts` + needsHumanCheck.

Gujarati: labels in Gujarati before the English ones (Aadhaar, licence) are read through Tesseract `guj` (the default languages are
en/hi/gu); the key fields come from the English half. PDF files (an e-Aadhaar, an ETA) go through the worker's own PDF path: each
page drawn at 300 dpi, the text layer used as a hint; a password-protected PDF (as UIDAI sends the e-Aadhaar) is refused with
`pdf_encrypted` and the hotel must send an unprotected copy. Orientation: a WEAK Tesseract OSD "turn it" (below 0.6) is checked by a
quick upright read before the page is turned (an upright visa sticker was called upside down). Tested on INVENTED drawings only
(`tests/idkinds.py`, `tests/visadocs.py`, `tests/test_idkinds.py`, `tests/test_visas.py`), never on real photos.

## Local folder runner (no database, no upload)

    .\.venv\Scripts\python.exe scripts\run_folder.py --in <folder> --out <folder> [--limit N --seed S --workers N --no-resume]

Runs the same `Pipeline.analyse` as the worker on a folder (read-only, recursive, jpg/jpeg/png/webp/pdf): type, scan (skipped and recorded when clamd is not
running; INTAKE_CLAMD picks the address), re-save, gate, read, enhance, merge, compress to 500 KB, in the worker's two parts. Report columns
`form_seconds` (the form could fill) and `saved_seconds` (the picture was saved), and `background` (what the background part saw differently:
codes and field names, never a value); `--progress` writes a `read` event at the form-ready moment. `INTAKE_READ_QR=true` turns QR reading on. Writes `FirstName_LastName_IdName.ext` into `--out`
(collisions `_2`, unknown name `Unknown_<IdName>`), plus `report.csv` / `report.html` (steps passed/failed/skipped, flags, fixes, size before/after, seconds).
The console shows counts only. A stopped run resumes (inputs finished in report.csv are skipped; errors are retried). `--out` must be outside the repository.
`AUTO_ENHANCE=false` turns the enhance step off. `--multi auto|on|off` (one picture per person for multi-card inputs; report rows per person with
cards, sides, evidence, flags, and fields as filled/empty only) and `--pool` (pairs cards across the files of one folder, for fronts on one sheet
and backs on another; at most 20 files per folder) are for sheets of several cards. Report columns `clarity` (the person's worst card),
`clarity_cards` (each card's grade and reasons), `unclear_fields`, `retake`, `photo` (each portrait found / none / unclear and each photo
outcome with its score), `possible_same_guest`, `suggested_partner`, `rare` (yes for MJ's RARE case), `paired_by_position`: fixed phrases
and numbers only, never a field value or an embedding. A card refused by the photo rule is a row `rejected: photo_unclear` with the reason
per card in `clarity_cards` and "Photo on the ID is not clear, please retake." in `retake`; no picture is saved for it.

## Card cutter (`app/cardcut.py`)

`cut_cards(img, max_cards=12)` returns one `CardCut` per card on a scanned sheet (image, quad in source pixels TL,TR,BR,BL of the upright card,
score 0..1, flags), in reading order (rows top to bottom, then left to right). `model_available()` is false when the model file or torch is missing;
the worker then still cuts with card-shaped islands of print plus the copied classic finder, flag `fallbackFinder`. `use_model=False` takes
that same classic path on purpose (the job's fast part, flag `quickFinder`, never shown).

* **Finding**: Segment Anything (Meta, vit_b) on a 1024 px copy, prompted with a 6x6 point grid, then a 16x16 grid only where print lies outside
  every card found (at most 48 more points). Masks must be card shaped (ID-1 85.6:54), filled and printed; blank paper is never a card.
* **Cutting**: one straight line per side of the mask (rounded corners left out), four corners from the intersections (keystone and mild perspective
  removed, not only rotation). Each side is then snapped to the card's own edge on the full-resolution scan, in a band of 3 % outside / 6 % inside,
  with the side allowed to lean. When a sleeve leaves a second, outer edge, the strip between is trimmed only when it is plain and paper coloured
  (`sleeveTrimmed`); coloured print at the edge stops the trim. A thin dark shadow or sleeve rim at the edge stays outside the card.
* **Output**: exactly 85.6:54, long side 1000-1200 px (native when larger is not needed; never more than 1.5x upscale), cubic. Cards running off the
  scan are kept with their true proportions, the missing part white, flag `cutOff`. Other flags: `rotated90|180|270` (how the card lay),
  `lowContrastEdge` (a side kept from the mask fit), `orientationUnsure`, `ratioOff`.
* **Orientation**: landscape from the side lengths; up or down from where the coloured header bands sit; only when that is unsure, an OCR read of
  both turns (RapidOCR without its per-line turning, or the caller's engines; Tesseract OSD when given).
* **Model (5 Nov 2026: MobileSAM is the default)**: `CARDCUT_ARCH=vit_t` uses MobileSAM (the same prompt encoder and mask decoder as SAM with a
  small TinyViT image encoder); `CARDCUT_ARCH=vit_b` brings Segment Anything vit_b back. On every test sheet below MobileSAM gave the SAME numbers
  (found, corner error, sleeve strip, upright), and on 4 cores the cut of a 10-card sheet went from 11.0 s to 7.9 s.
* **Model file**: `CARDCUT_MODEL` (default `models/mobile_sam.pt`, or `models/sam_vit_b.pth` with vit_b; git-ignored). `scripts/get_model.py
  [--arch vit_t|vit_b]` copies a local copy or downloads and checks SHA-256: MobileSAM from
  `https://github.com/ChaoningZhang/MobileSAM/raw/f706ad9c4eb7f219c00d9050e46328518ffb65d2/weights/mobile_sam.pt`
  (`6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f`, 40,728,226 bytes); vit_b from
  `https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth` (`ec2df62732614e57411cdcf32a23ffdf28910380d03139ee0f4fcbe91eb8c912`,
  375,042,383 bytes). The Dockerfile runs it at build time. Loaded with `weights_only=True` (no pickled code) and `mmap=True`.
* **Licence**: MobileSAM code and weights are Apache-2.0 (its LICENSE file at the pinned commit `f706ad9c4eb7f219c00d9050e46328518ffb65d2`);
  segment-anything code and the vit_b weights are Apache-2.0 (LICENSE file and the README's "The model is licensed under the Apache 2.0 license" at
  commit `dca509fe793f601edb92606367a655c15ac00fdf`); timm: Apache-2.0; torch / torchvision CPU wheels: BSD-3-Clause.
* **Packages**: torch 2.5.1+cpu and torchvision 0.20.1+cpu from the PyTorch CPU index (newer torchvision fails on Windows with
  `operator torchvision::nms does not exist`), segment-anything from the pinned commit's archive.
* **Memory**: SAM's global attention is computed two heads at a time (identical numbers, checked): peak working set about 1.4 GB for a 12-card sheet
  (3.1 GB before). The compose memory limit is 3 GB.

Measured on invented sheets only (`tests/cardsheet.py`: drawn cards in clear sleeves with glare, 1-6 degrees turned, mild keystone, quarter turns,
some running off the sheet; no real ID was used), this PC (i7-11600H, 6 cores, CPU only), `tests/test_cardcut.py`:

| sheet | found | corner error mean / max (% of card diagonal) | sleeve strip left (px) | upright | time (quiet PC) |
|---|---|---|---|---|---|
| 1 card, A4 300 dpi | 1/1 | 0.09 / 0.11 | 1.1 | 1/1 | 6.4 s |
| 2 cards | 2/2 | 0.09 / 0.12 | 1.3 | 2/2 | 6.8 s |
| 4 cards, all four turns | 4/4 | 0.09 / 0.15 | 1.6 | 4/4 | 9.6 s |
| 6 cards, one cut off | 6/6 | 0.10 / 0.18 | 2.0 | 6/6 | 10.3 s |
| 12 cards, A3 200 dpi, two cut off | 12/12 | 0.13 / 0.27 | 3.0 (1.5x upscaled) | 12/12 | 12.3 s |

Time is about 6-6.5 s of Segment Anything (4.5 s of it the image encoder) plus about 0.2 s per card, plus about 2 s for each card without colour
bands (the OCR orientation check). With other programs busy on the PC the same runs took 13-24 s. The VPS has 2 CPUs: measure there.
Not yet seen: real scans after this change (MJ said not to test on real photos now); the fallback finder misses pale cards without a sleeve.

## Photo check (`app/faces.py`, MJ, 4 Nov 2026)

The holder's printed portrait is found on every card side (Aadhaar front, PAN, licence front, voter front, passport data page, OCI, visa,
PIO, permit, ID card front) and portraits are compared between cards, offline, as EXTRA evidence for the grouping above.

* **Models** (opencv_zoo at commit `48b10fa505aeb51fbd127fc60a5c660040e823b7`, run by OpenCV's `FaceDetectorYN` / `FaceRecognizerSF`):
  YuNet `face_detection_yunet_2026may.onnx` (MIT: the folder's LICENSE and README, "All files in this directory are licensed under MIT
  License"; SHA-256 `ebafce4e...c22f0f0`, 229,738 bytes; the 2026may file has the dynamic input OpenCV 5's ONNX engine needs) and SFace
  `face_recognition_sface_2021dec.onnx` (Apache-2.0: the folder's LICENSE and README; SHA-256 `0ba9fbfa...087c34e79`, 38,696,353 bytes).
  Full hashes in `scripts/get_face_models.py`, which downloads or copies and checks them into `FACE_MODELS_DIR` (default `models/faces`,
  git-ignored). No InsightFace or any model with a non-commercial licence.
* **Outcome**: cosine similarity >= 0.363 (the SFace paper / OpenCV default) = `match`: it SUPPORTS a pair or a guest link, never proves
  identity. Below 0.15 = `mismatch` (our choice, not the paper's: far under the match line so a soft, small print of the same person lands
  in "unclear" rather than "mismatch"): it BLOCKS a pair, a duplicate or a guest link even when names (or numbers) agree, flag `photoMismatch`
  + needs check. In between, or no portrait, or one too small (< 40 px face in the source), blurred or glared: `unclear`, no evidence
  either way (`photoUnclear` on a side that should carry a portrait). Thresholds in `app/thresholds.py` (`FACE_*`, env overridable).
* **Unclear ID photo = REJECT (MJ, 4 Nov 2026).** On a side that must carry the holder's portrait (Aadhaar front, PAN, licence front,
  voter front, passport data page, OCI, visa sticker, residence-permit card, e-Aadhaar letter) a portrait that is missing, blurred,
  glared or too small rejects that card: code `photo_unclear`, a short reason ("no photo found on the ID", "photo on the ID blurred",
  "glare over the photo on the ID", "photo on the ID too small") and the retake line "Photo on the ID is not clear, please retake.".
  Single card: the job is refused (`StepError photo_unclear`, step read). Sheet: that person's result is `status: rejected` with
  `reject.cards` (nothing enhanced, compressed or stored, no fields), the other people go on. Backs, address pages, the ETA and FRRO
  printouts are not checked; PIO and foreign ID-card fronts are reported (`photoUnclear`) but not rejected (not on MJ's list). It follows
  `gate_action` like every quality finding: `reject` (the default) rejects; `warn` keeps the card graded unclear with `photoUnclear`,
  `unclearCard` and the retake line, for a person to check. When the face models are not installed nothing is rejected (not judged).
  Nothing about the face is stored.
* **Privacy**: the face embedding (128 numbers) is computed in memory only and dropped right after grouping (`faces.forget`). It is
  never written to disk, logs, reports or the database. Only the outcome (match / mismatch / unclear) and the score rounded to 2 decimals
  are kept in the job result (`photo.checks`), plus each portrait's status and quality numbers (`photo.portraits`). A test runs the folder
  runner on an invented sheet and scans every file it wrote, the console and the logs for the embeddings (raw float32/float64 bytes and
  printed values): none found.

**Measured honestly** (`scripts/measure_faces.py`: 30 INVENTED drawn people x 3 photos, each printed into a card's photo box, the card
softened, noised and saved as JPEG like a 300 dpi scan, the portrait found on the card):

| portrait printed | found | same person: lowest / 5th pct / mean | different people: highest / 95th pct / mean | same called mismatch | different called match | different called mismatch |
|---|---|---|---|---|---|---|
| 120 px tall | 82/90 | 0.19 / 0.53 / 0.80 | 0.84 / 0.66 / 0.41 | 0% | 62.9% | 6.6% |
| 160 px tall | 88/90 | 0.54 / 0.63 / 0.85 | 0.83 / 0.68 / 0.47 | 0% | 77.5% | 0.2% |
| 180 px tall | 87/90 | 0.67 / 0.76 / 0.89 | 0.83 / 0.69 / 0.49 | 0% | 81.3% | 0.2% |

Cost on this PC: about 24 ms per card to find the portrait and compute its embedding, about 76 ms per card for the clarity check
(step `inspect`, 3 cards at a time).

What this shows: the same invented person is never called a mismatch, even printed 120 px tall. It does NOT show how well different
REAL people are told apart: drawn faces come from one drawing style and sit close together for a face model, so different drawn people
"match" most of the time (real different people score far lower with SFace; its own evaluation is 99.4% on LFW, not measured here). So a
`photoMatch` is only trusted together with the same name AND full date of birth, and the real false-match rate on printed Indian ID
portraits must be measured on consented real photos before anyone leans on it more. The mismatch line is conservative for the same reason.

## Clarity check (`app/clarity.py`, MJ, 4 Nov 2026: "if the image is not clear, we must know")

After cutting and reading, every card is scored on its untouched pixels (scaled to 1000 px long): edge steepness in the worse direction
(catches motion blur) and the tile Laplacian variance, glare share (blown-out blobs; a QR's white left out), mean brightness, contrast
(1st-99th percentile), noise (Immerkaer), effective dpi of the card in the SOURCE picture (cutter quad vs the document's printed size: ID-1
85.6 mm, passport/OCI page 125 mm, visa 120 mm, A4 297 mm), a motion-blur hint, and the reader's confidence of the key fields. Regions: the
portrait (the face box, else the type's photo box), the name/DOB block and the number line (the OCR line holding the value, else the
type's usual place), the MRZ (lines with `<<`, else the bottom band) and the QR (zxing, or OpenCV's finder for one that cannot be read).

Each card gets `clear` / `usable` / `unclear` and plain reasons ("number line blurred", "glare over photo", "QR unreadable", "card too small:
140 dpi", "picture too dark", "card blurred (motion blur, horizontal)", "name read with low confidence (0.55)", "no photo found (glare on
card)"). An unclear card sets `needs_human_check`, flag `unclearCard` and a retake line ("Retake this card: hold the phone steady ...").
A person whose name, date of birth or number came from an unclear card or region gets `keyFieldUnclear` and `clarity.unclearFields`. The
job result carries `clarity` (grade, every card's grade and reasons, the retake lines) and the raw scores per card in `scores.cards`; the
single-card path does the same per picture. Thresholds: `app/thresholds.py` (`CLARITY_*`, env overridable).

Calibrated on INVENTED cards (`scripts/calibrate_clarity.py`: 25 cards of five kinds with an invented portrait, 20 versions each):

| truth \ grade | clear | usable | unclear |
|---|---|---|---|
| clear (clean, blur 0.7 px, noise 3, JPEG 80, 260 dpi, a little darker): 150 | 147 | 3 | **0** |
| degraded (blur 2.5 / 3.5 px, motion 15 px, noise 22, 120 dpi, dark, low contrast, glare over photo / number / name): 220 | 0 | 0 | **220** |
| borderline, not scored (blur 1.5 px, 170 dpi, noise 9, JPEG 5): 100 | 41 | 50 | 9 |

All 220 damaged cards were caught; no clean card was called unclear. The same run after the photo-reject rule (5 Nov 2026) gives the
same clear and degraded rows; 9 borderline versions are now unclear (their portrait too soft or small for the photo rule).

**Heavy JPEG (MJ, 4 Nov 2026).** The JPEG quality of the ORIGINAL upload is estimated from its luminance quantisation table (libjpeg
scale; read before the re-save, so the cutter's resampling cannot hide it) and given to every card cut from that file
(`scores.cards[].clarity.jpegQuality`). Below 25: unclear, reason "picture too compressed", retake advice "send the original photo, not a
compressed copy"; below 45: usable (`CLARITY_JPEG_Q_*`). Invented cards saved by libjpeg read back exactly (q20 -> 20; q12 and below
saturate at 13-16).

**A hard-compressed copy saved again (5 Nov 2026).** A picture compressed hard and then saved again as PNG or as a high-quality JPEG
keeps traces of the first compression in its pixels. `clarity.jpeg_quality()` now returns the lower of the file's own table and the
quality traced in its pixels (`traced_quality`, the same logic as quality-gate's `app/compression.py`, own copy): the 8 x 8 blocks of the
upload (centre 1024 px, at most 512 blocks with print) are compressed again with every candidate quality's table (libjpeg 5-47); a block
that comes back unchanged at one quality and at least 0.5 grey levels worse at both neighbours is a trace; 7% of the blocks name the
earlier quality (5-45). Pixels the first decoder clipped at 0 or 255 are let past the clip for two rounds first, so black print on
white paper keeps its trace. It runs on the original bytes in the intake step (fast part), for every PNG and WebP and for every JPEG
whose table reads 46 or more; the copy then gets the same "picture too compressed" grade as a low-quality JPEG.
`scripts/calibrate_recompression.py` (the 25 drawn cards of `calibrate_clarity.py`, pure white paper and black print):

| truth \ result | not flagged | flagged (below 45) |
|---|---|---|
| clean: PNG and fresh JPEG at quality 90, 95 and 100 (100) | **100** | 0 |
| first saved at quality 10, 15, 20, 25, 30 or 35, then saved again as PNG or as a quality 95 JPEG (300) | 0 | **300** |

Each of the 300 reads back its first quality exactly. Time of the trace alone per card (1000 x 630): fastest 18 ms, median 29 ms with
one BLAS thread (`OPENBLAS_NUM_THREADS=1`) and 80 ms with the default threads, both while other jobs kept this PC 70-95% busy; reading the
upload's table and decoding it add about 6 ms (median) at this size. Limits: a copy resized, turned by a quarter turn or cut unevenly after the
first compression loses the trace (quality-gate measured 5 of 12 flat scans found after a 3 px cut, 12 of 12 photos); a first
compression above quality 45 is not traced; HEIC is not traced; phone makers' own tables are only approximated by the libjpeg
scale. Other limits: the
type's usual places are only known for some sides (Aadhaar, licence and voter fronts, MRZ documents), elsewhere a region is judged only
where the reader placed its value; real phone photos and scans have not been graded yet (MJ's rule: invented pictures only).

Tests (`tests/test_photo_and_clarity.py`, invented cards and drawn faces from `tests/faces.py` only): the namesake rule with stand-in
portraits; two namesakes with misread numbers and different faces kept apart (`photoMismatch` / `sameNameDobNoNumber`) and one card shown
twice with a misread number kept apart too; one guest's Aadhaar and PAN linked by name + DOB + photo match, and NOT linked when the
PAN carries someone else's face; clarity grades and reasons on a clean, a blurred and a glared card in one job and on the single-card
path; the calibration table on a share of the cards; thresholds from the environment; no embedding in any file the folder runner
writes, in the console or in the logs, and only outcomes in the job result.

`tests/test_intake_rules.py` (MJ's decisions of 4 Nov 2026, invented cards and drawn faces only): rare namesakes (stand-ins, and two
invented PAN cards through the folder runner: `_Rare` names, `rare=yes`, nothing on the console); the photo verdict per side; cards with no
photo and a blurred photo rejected in a sheet while the clear one goes on, the same with `gate_action` warn, and the single-card refusal
(an Aadhaar back and an ETA never refused for it); the position rules (portrait, gender, DOB, number tails, colour, size, crowding,
other picture) and a full run where an alike back is paired by position and the usual differently coloured back stays a suggestion;
the JPEG quality estimate and a q15 sheet graded "picture too compressed" (q92 not).
