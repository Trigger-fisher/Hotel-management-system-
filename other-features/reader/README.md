# HMS content reader

A standalone service (FastAPI, for the Linux VPS in Docker) that reads the text of an uploaded document or
photo, in many languages and scripts, and tells the truth about how well it could read it. Free and
open-source tools only, pre-trained models only (no training, no GPU), and nothing leaves your own servers.
It is fully self-contained: it calls no other service and shares nothing with the other folders.

## What it does

```
file -> real type from bytes -> PDF? text layer per page (exact, no OCR) / scanned page -> render and OCR
photo -> find the document -> flatten -> upright (0/90/180/270) -> deskew -> measure quality
      -> pass 1: which scripts are on the page (OSD + probes, CONFIRMED by counting characters per Unicode block)
      -> pass 2: read with the right model per script, try preprocessing variants within a time budget,
         keep the best -> merge lines in reading order (right-to-left aware)
      -> QR/barcodes, passport MRZ (check digits verified), Aadhaar/PAN validation
      -> JSON with confidence on every line, flags, and needsHumanCheck
```

* **Engines behind one adapter** (`app/engines/`): PaddleOCR (primary on the VPS, many scripts) and Tesseract
  (backup, 100+ languages, plus OSD for orientation and script). Both are optional at run time; `/health` lists what
  is present. **RapidOCR and Tesseract are tested for real; PaddleOCR is written but untested** (see Limits). RapidOCR's pip package ships Chinese+English (so Latin) models; Devanagari needs its own recognition model, set with READER_RAPID_DEVANAGARI_REC and READER_RAPID_DEVANAGARI_KEYS, otherwise Tesseract reads Devanagari.
* **Mixed languages on one page** (an ID card with English and Hindi): scripts are detected per line, not per page.
  Each candidate script is read by its own model; for every place on the page the most confident reading whose
  letters really belong to that script wins.
* **Preprocessing variants** (original, upscale small text, CLAHE contrast, unsharp, adaptive and Otsu thresholds,
  shadow removal, denoise, dewarp). `fast` tries at most two; `thorough` tries up to seven within a time budget
  (`READER_FAST_BUDGET_S` / `READER_THOROUGH_BUDGET_S` per page) and keeps the best by character-weighted confidence.
* **Quality first**: blur (sharpest-tiles Laplacian variance, size-normalised), contrast, brightness, glare,
  noise, skew, text height. A bad photo returns flags (`blurry`, `tooDark`, `lowContrast`, `glare`,
  `lowResolution`, `noisy`, `partlyCutOff`, `pageCurved`, `lowConfidence`, `noTextFound`) instead of pretending.
* **Helpers that only validate**: QR/barcodes (zxing-cpp), MRZ TD1/TD2/TD3 with check digits per field, Aadhaar
  (Verhoeff) and PAN pattern. They never invent or repair a value; a wrong character just makes `valid` false.

### Document localisation and perspective correction (option `findDocument`, default on)

Before OCR the reader looks for the paper in a photo taken on a table or in a hand: downscaled edge map (Canny),
background-colour distance and bright-paper masks, contours reduced to quadrilaterals (`approxPolyDP`) and scored
(area share, right angles, opposite sides, plausible aspect ratio, how well the shape fills the quad); overlaps
are removed. The best quad is flattened with a four-point perspective transform at the picture's own resolution
(never upscaled, capped at 5000 px), then the orientation is chosen with Tesseract OSD (or by comparing OCR
confidence at the four turns) and the small residual skew is removed. The JSON reports the quad corners, the rotation
applied and the skew angle. **When unsure it keeps more**: no confident quad gives the whole picture with
`documentNotFound`; a quad touching the frame gives the whole picture with `partlyCutOff`; a document that
fills the frame is left alone. Two documents in one photo return a `regions` list, each read separately.
A curled page (average text-line bend of 0.15 line heights or more) is flagged `pageCurved`; a per-line baseline
straightening runs as one more variant and is kept only when it reads better.

Measured on 24 invented photos (random scale, rotation up to 30 degrees, keystone, clutter, noise): the quad was
recovered within 3% of the image diagonal in **20 of 24**; 2 more were pages that really stick out of the frame
and were correctly flagged `partlyCutOff`; **2 failed** (small page, low contrast against clutter). The flattened
page matched the original with a median SSIM of 0.79.


## Document types (kind=id)

Pass `kind=id` to `/v1/read` (or `/v1/read-url`) and the reader detects the **document type** from evidence and extracts that type's fields, each with
confidence and its source (`mrz`, `qr` or `ocr`) and a `valid` flag where a check exists. The registry is `app/doctypes/`: **adding a type means
adding one small file there plus its tests**; the registry finds it by itself. Built in: `aadhaar` (Verhoeff number, and the QR cross-check below), `pan`
(number pattern), `passport` (MRZ TD3), `visa` and `residence-permit` and `national-id` (MRZ TD1/TD2), `driving-licence` and `voter-id` (keywords in several
languages plus a number pattern), `employee-card`. **Unknown is not an error**: all text is read, `documentType.type` is `unknown`, no field is invented,
`unknownDocumentType` is flagged and `needsHumanCheck` is set, so reception can type the fields. Validators only CHECK, they never change or hide a value.

**Aadhaar QR cross-check**: the QR (old XML form, or the secure QR: a big number that is a gzip of fields) is decoded and its name, date of birth and last
four digits are compared with the OCR text; a mismatch makes the OCR field `doubtful`. The secure QR's digital **signature is not verified** (the UIDAI
public certificate is not bundled). **No ID is masked.** Measured on invented cards drawn in code (Aadhaar with a QR, PAN, driving licence, voter ID, employee
card, an unknown club card): type detected 5 of 5, number read 5 of 5, the unknown card was kept as unknown. The passport card drawn with an MRZ strip was typed as
`passport` in the worker's end-to-end run, with most fields passing their check digits and one OCR slip (nationality) correctly failing and being flagged; the MRZ
strip is the least reliable read, so every wrong character shows up as `valid: false` instead of being stored silently. The MRZ parser itself is tested on generated lines.
## Output JSON

```
{ pages, text,
  lines: [{ text, page, bbox:[x0,y0,x1,y1], confidence, script, region? }],
  quality: { blur, contrast, brightness, glare, noise, skew, resolutionDpi, overall },
  codes: [{ type, text }], mrz: { format, valid, fields:{name:{value,valid}}, lines } | null,
  identifiers: [{ type:"aadhaar"|"pan", text, valid }],
  flags: [...], needsHumanCheck: bool, engines: [...], confidence, tookMs,
  document: { found, quad, rotationApplied, skewApplied, pageImage:{width,height}, scripts },   // pictures
  regions: [...],                                                                                // several documents
  pageInfo: [{ page, source:"text-layer"|"ocr", width, height, unit:"pt"|"px" }] }              // PDFs
```
`bbox` is in the pixels of the straightened page image (`unit` px) or in PDF points for text-layer pages.
Every line has a confidence; low confidence, a serious flag, an invalid MRZ or an invalid identifier sets
`needsHumanCheck`. A field is never reported as certain. There is no `language` field: a language guess inside
Latin needs a detector library that is not included.

## API

All calls except `/health` need `X-Reader-Key: <READER_KEY>` (constant time; the service refuses to start without a
32+ character key). Errors: `{"error": {"code", "message"}}`.

* `GET /health`: `{status, engines:{paddleocr, tesseract:{present, languages}}, codes:{zxingcpp}}`. No secrets.
* `POST /v1/read` multipart: `file`, optional `languages` (hints such as `hi,gu,en`), `mode` (`fast` default | `thorough`),
  `findDocument` (default true).
* `POST /v1/read-url` JSON `{sourceUrl, languages?, mode?, findDocument?}`: downloads from an allow-listed https link
  (no private/loopback IPs, no cross-host redirects, size cap, nothing else) and answers like `/v1/read`.
* `POST /v1/read-pair` multipart `front`, `back`, optional `merge` = `none` (default, JSON) | `stack` | `pdf`
  (a ZIP with `record.json` and `merged.png` / `merged.pdf`), plus the options above. See "Front and back" below.
* Codes: `unauthorized` 401; `bad_option`, `no_file`, `url_not_allowed` 400; `unsupported_type` 415;
  `file_too_large`, `download_too_large` 413; `too_many_pixels`, `too_many_pages`, `image_corrupt`, `pdf_corrupt`,
  `pdf_encrypted` 422; `busy` 429; `no_engine` 503; `download_failed` 502; `timeout` 504.

Real type comes from the bytes only. Limits: size, pixels, pages and a time limit per job. Work runs in a bounded
process pool (`READER_MAX_CONCURRENCY` plus `READER_QUEUE_SIZE` waiting, then 429). Temporary files live in per-call
temp directories that are always removed. File names and contents are never logged.

## Front and back of one ID (`/v1/read-pair`)

Reads both sides with the same pipeline and decides which is which from the content (a front has a name and date of
birth; a back an address and a printed code). Your labels are kept; a contradiction only adds the flag
`sideLabelsContradict`. The record has the merged fields (each with confidence, the side it came from, its source
`ocr`/`qr`/`mrz`, and any conflicting value) and `samePerson`: `match`, `mismatch` or `unknown`, with reasons,
built **only from evidence in the data**: the same valid document number on both sides (Aadhaar check digit, PAN
pattern, passport MRZ with check digits, driving-licence pattern), or the same name and date of birth after
normalising case, spacing, diacritics, titles and word order with a transliteration-tolerant fuzzy match
(`NAME_MATCH_THRESHOLD = 0.85` in `app/fields.py`). Two different valid numbers are a mismatch even if the names look alike;
agreeing and disagreeing evidence together is `unknown`. No face comparison here (the photo check is used by
`multi=true` and `kind=id`, see below). A mismatch or unknown
never blocks by itself: it sets `needsHumanCheck` as a flag for the caller. A missing or unreadable side gives
`unknown` and the other side is still returned. Measured on invented cards (photo box, name, number, date of birth;
back with address and a QR): same person, swapped labels, different numbers, a spelling variation, a missing
side and an unreadable side all gave the expected verdict with the real Tesseract engine.

## Several IDs in one photo (`/v1/read` with `multi=true`)

Options: `maxRegions` (1-12, default 12), `returnCrops=true` (every cut card as base64 PNG), `merge=stack` (one picture
per person). Steps:

1. **Cut** (`app/cardcut.py`, an own copy of the intake worker's cutter, 2026-11-04): Segment Anything vit_b (Meta,
   Apache-2.0) finds every card; one straight line per side, snapped to the card's own edge in the full-resolution
   photo, removes tilt, keystone and mild perspective; a plain sleeve strip is trimmed (`sleeveTrimmed`), a shadow line
   left outside; output is upright, exactly ID-1 shaped. Reader changes in this copy (marked "reader change" in the code),
   because pale-tinted cards were cut about 3% off (their margin trimmed as if it were sleeve, the sleeve left on the
   other side, or a side leaning the wrong way after a glare streak bent the mask): a strip is only trimmed as sleeve when
   its colour matches the paper; a further strip must be the same colour as the sleeve strip already trimmed; the walk
   may follow a side that leans up to 3.5% (was 1.2%); the ID-1 shape test that keeps sides untrimmed starts at 1.2%
   (was 4%); a card still short on one axis has its bounding side moved out to the real edge (`sideExtended`). On 20
   invented sheets (160 cards, pale fronts and backs in sleeves) the original cut 14 of 150 whole cards about 2.9% of the
   diagonal off; this copy 0, worst corner 0.19%. A card the classic finder (`app/cards.py`) sees where the cutter found
   nothing (very small cards) is added with `fallbackFinder`; without the model file or torch the whole sheet uses the
   classic path. Other flags: `cutOff`, `lowContrastEdge`, `orientationUnsure`, `rotated90/180/270`, `ratioOff`.
2. **Read** each card on its own; `regionTooSmall` (card under 600 px in the photo) returns no fields and asks for
   smaller groups.
3. **Group** (`app/people.py`, copied from the intake worker): front, back or single side by document type; pairs by
   `aadhaarNumber`, `documentNumber`, `qrNameDob`, `mrzNameDob`, `nameAndDob` (address only supports). Two valid numbers
   of one kind that differ never pair; a different date of birth blocks everything but a number match
   (`evidenceConflict`). Equal evidence for two partners gives `ambiguousPair` and no pair; a front alone is
   `unpairedSide`; PAN, visa and OCI are `singleDocument`; different documents of one guest are linked (`guest`,
   `linked`, `sameGuestOtherDocument`), never merged. **MJ's namesake rule (4 Nov 2026, copied from the intake worker):**
   a duplicate (`duplicateCard`, `duplicates`) or a front/back pair needs STRONG evidence: the same checked number, or a
   QR whose number tail is found on the other card (`qrNameDob`; without the tail it is only `qrNameDobOnly`). A name and
   date of birth alone keep the cards apart (`sameNameDobNoNumber`, a person decides); they pair a front and back only
   when neither card has a number or QR AND the two ID photos match (`pairedByNameDobAndPhoto`). Layout is only a
   suggestion (`layoutSuggestsPair`, `suggestedPartner`), never a pair. Guests are linked only on a number, a printed
   passport number (`passportNumber`) or name + date of birth + matching photos (`nameAndDob`, `photoMatch`); name and
   date of birth alone are `possibleSameGuest` (`possibleSameGuestAs`). A clear photo mismatch blocks a pair, a
   duplicate and a link (`photoMismatch`). OCI and PIO numbers (no check digit) count as document numbers.
4. **Inspect** (`app/inspection.py`, `app/faces.py`, `app/clarity.py`, `app/thresholds.py`, copied from the intake worker):
   see "Photo check and clarity" below.

Each person: `personId, regions, evidence, confidence, documentType, fields` (front wins, address from the back,
disagreements in `conflicts`), `doubtfulFields, suggestedName` (`FirstName_LastName_IdName`), `samePerson, flags,
duplicates, guest, linked, needsHumanCheck`, and with `merge=stack` `image` (front above back, white gap) plus
`imageFormat`: PNG, or JPEG when the PNG is over 500 KB (never over 500 KB).

Model: `python scripts/get_model.py` (copies `--from` a local file or downloads; SHA-256 checked) to `models/sam_vit_b.pth`
or `READER_CARDCUT_MODEL`. Torch is CPU only (`requirements.txt` uses the PyTorch CPU index). Measured on invented sleeved
sheets on this PC (i7-11600H): the cutter's own sheets 1/2/4/6/12 cards all found, corner error max 0.27% of the
diagonal (the same numbers as the original); a sleeved sheet of three guests (front + back, one back without a number,
one card off the edge) gave 3 people paired by number or QR, named correctly, in about 20-27 s with reading; eight cards
(four guests) through checkin-demo gave 4 merged pictures of 113-485 KB in about 32 s.
About 1.4 GB of memory per process while cutting.

## Two parts: the form first, the picture after (`picture=later`, 5 Nov 2026)

The reader's own copy of the intake worker's split, so a check-in form fills in seconds and the picture follows.

* **Fast part:** `POST /v1/read` with `kind=id` and `picture=later` (with or without `multi=true`). A sheet is cut by the cutter's
  classic finder WITHOUT the model (`cut(..., quick=True)`, flag `quickFinder`; the crowded-sheet finder copied from the intake worker:
  the paper colour from the scan's ring, touching cards cut apart along the emptiest lines; an outline it cannot fit well is dropped and
  with nothing found the whole photo is read, `wholePicture`), every card is read side by side (`READER_READ_THREADS`, default 3; a card
  the cutter turned upright skips the orientation check and RapidOCR's per-line turn check, and is read again with the check when it
  reads poorly or without a name), grouped per guest and inspected. No picture is made. A single ID is read as before. The answer is the
  usual JSON plus `picture: {token, status: "saving"}`.
* **Background part:** `app/twoparts.py`, in its own pool (`READER_BACKGROUND_CONCURRENCY`, default 1), so a form never waits behind a
  picture: the model cuts, every person gets one picture (front above back, under 500 KB) and what it read differently is listed in
  `disagreements` (codes `cards`, `people`, `pairing`, `documentType`, `photo`, `field` with the field's name, `unmatched`,
  `backgroundOnly`; never a value). It never changes a value of the fast answer. A card cut a little differently is linked to the fast
  card it overlaps (70 % of the smaller outline); a guest only the model found comes as `backgroundOnly` with its fields; a guest the
  model cut differently gets a picture of the fast part's own cut, never someone else's.
* `GET /v1/picture/{token}?wait=60` (the key is needed; `wait` 0-120 s): `{"status": "saving"}` while it works, then once
  `{"status": "done", "cards", "people": [{personId, status, image, imageFormat, disagreements, flags, needsHumanCheck}], "tookMs"}`
  (or `{"status": "failed", "error": {"code"}}`); the answer is dropped after it is given, or `READER_PICTURE_SECONDS` (600) after it
  is ready. Without `picture=later` the API is unchanged.
* **No QR for now:** QR and barcodes are not decoded (`READER_READ_QR=false`, the default; `true` turns the reading and the `qrNameDob`
  pairing back on, tested). **PDFium** is used by one thread at a time (`app/pdfsafe.py`), and Pillow's bomb guard stays on (100 MP).

Measured on invented sleeved sheets (`tests/sheets.py`, fronts and backs, warm, the process pinned to 4 cores; see
`other-features/docs/Intake-Flow-Current.md` for the PC load): see the table there ("Reader").

## Photo check and clarity (`/v1/read` with `kind=id`, single or `multi=true`)

Added 4 Nov 2026 (MJ), copied from the intake worker (commit cbebe2fa). Only keys were added; nothing was removed or renamed.

* **Photo check.** The holder's printed portrait is found with **YuNet** (MIT) and compared with **SFace** (Apache-2.0),
  both from opencv_zoo at a pinned commit, run offline through OpenCV. `python scripts/get_face_models.py` fetches them (or
  copies `--from` a folder), checks their SHA-256 and puts them in `READER_FACE_MODELS_DIR` (default `models/faces`,
  git-ignored). Cosine score >= 0.363 = `match`, < 0.15 = `mismatch`, between = `unclear`. A photo match is only extra
  evidence; a clear mismatch blocks a pair, a duplicate or a guest link. Without the model files every portrait is
  `unavailable` and the grouping works as before on numbers. **The face embedding never leaves memory**: it is dropped
  once grouping is done; only the outcome and a 2-decimal score are returned. No InsightFace or other non-commercial model.
* **Clarity** per card: sharpness, motion hint, glare, exposure, contrast, noise, effective dpi (from the card's size in
  the photo), the photo / name-DOB / number / MRZ / QR regions and the OCR confidence give `clear`, `usable` or
  `unclear`, with reasons ("card blurred", "glare on card (6%)", "number line blurred" ...) and a retake line. A key field
  (name, date of birth, number) read from an unclear card or region adds `keyFieldUnclear`; an unclear card adds
  `unclearCard`; both set `needsHumanCheck`. Thresholds are in `app/thresholds.py`; each can be overridden by
  `READER_` + its name (for example `READER_CLARITY_DPI_UNCLEAR=140`, `READER_FACE_MISMATCH_BELOW=0.12`).
* **Picture too compressed** (copied from intake-worker on 2026-11-05): `clarity.jpeg_quality()` is the lower of the JPEG's own
  quantisation table and an earlier compression traced in the pixels (`traced_quality`: the upload's 8 x 8 blocks compressed again
  with every candidate table; a block that comes back unchanged at one quality and worse at both neighbours is a trace). So a
  hard-compressed copy saved again as PNG or as a quality 95 JPEG is graded like the low-quality JPEG it came from. Calibrated in
  intake-worker (`scripts/calibrate_recompression.py`: 0 of 100 clean cards flagged, 300 of 300 re-saved copies flagged with their
  first quality read back exactly) and quality-gate; this folder's test reads q15 and q30 back from a PNG and from a q95 JPEG. A copy
  resized after the first compression loses the trace.
* **MRZ pass** (copied from intake-worker on 2026-11-05, `app/mrzpass.py`): when the first read has no MRZ whose check digits all
  pass, the MRZ rows are found (the lines the first read placed, else a band of two or three long even lines in the lower half of the
  upright page, else the same on the page turned a half turn), cut out, scaled to letters about 40 px tall and read row by row by
  RapidOCR's recogniser after up to four binarisations (grey, sharpened, Otsu, lighting flattened), stopping at the first reading that
  passes. `mrz.choose()` keeps only a reading whose check digits ALL pass (lines of different readings are tried together); readings
  that pass but differ on a checked line are not trusted (`readingsDisagree`); a names line spelled differently by passing readings
  makes the name doubtful (`namesAgree: false`). Nothing is corrected: a letter read as a digit where no check digit covers it (the
  specimen's country UTO read UT0) keeps the MRZ doubtful. A page with no MRZ costs about 15 ms (it was one Tesseract read of the
  bottom strip, about 0.4 s). Measured in intake-worker (`scripts/measure_mrz.py`).

Answer (`multi=true`): every region gains `clarity` {grade, reasons, advice, scores, regions, ocr}, `photo` {status,
reasons, quality?, checks [{withRegion, use, outcome, score}]} and, when unclear, `retake`. Every person gains `clarity`
{grade (worst card), cards [{region, side, grade, reasons, advice}], advice, unclearFields}, `photo` {outcome
match / mismatch / unclear / noPhoto / notCompared / unavailable, portraits, checks}, `possibleSameGuestAs` and
`suggestedPartner`. A single ID (`kind=id`) gains the same `clarity` (plus side and unclearFields) and `photo` blocks.

Measured here on INVENTED cards and drawn faces only (`tests/test_photo_and_clarity.py`): a clean front graded clear, the
same front blurred (3 px) and with a lamp reflection over the number graded unclear with those reasons; two namesakes with
unreadable numbers and different drawn faces kept apart (`photoMismatch`, score 0.12); the same card twice without a valid
number kept apart (`sameNameDobNoNumber`) although the photos match. Drawn faces are not real faces: the separation of
real portraits is not measured here (see the intake worker's README for its numbers).

## Honest limits

* No system reads every language equally well. Rare scripts and handwriting are weaker; this is printed-text OCR.
* A blurry or low-light ID photo can misread digits. That is why every value has a confidence, flags exist, and a
  person must check anything flagged `needsHumanCheck`.
* Field extraction for arbitrary countries' ID cards is **not universal**. The passport MRZ is (it is a standard);
  the "Name:/DOB:" label rules, Aadhaar, PAN and licence helpers cover only those layouts.
* Document finding can fail on curled or folded paper, a hand or finger over an edge, a dark document on a dark table,
  or strong glare; it then falls back to the whole picture and says so. Dewarping is a simple per-line method.
* Real glare cannot be told from white paper on a perfectly white scan; `glare` is reported only for photographed
  (grey-white) paper.
* **Tested for real here:** Tesseract 5.4 with English, Hindi, Gujarati and the other language data listed in
  `/health`; mixed English+Hindi+Gujarati cards; rotation 0/90/180/270; skew up to 11 degrees; blur, noise,
  low contrast and small text. **Written but untested:** the PaddleOCR adapter (paddlepaddle was too large to install
  on this PC), Docker, Nginx. Measured character accuracy on invented pages: clean 1.00; mild blur, noise and
  low contrast stayed at about 1.0 with honest flags; heavy blur (sigma 5) is flagged `blurry`. These pages are
  easier than real photos: treat them as a regression check, not as a promise.
* Aadhaar numbers and IDs are sensitive: the reader returns what is in the picture and logs nothing.

## Environment

See `.env.example`. Required: `READER_KEY`. Others: `READER_ALLOWED_HOSTS`, `READER_MAX_CONCURRENCY` (2),
`READER_QUEUE_SIZE` (4), `READER_MAX_UPLOAD_MB` (50), `READER_MAX_MEGAPIXELS` (100), `READER_MAX_PAGES` (100),
`READER_JOB_TIMEOUT_S` (300), `READER_FAST_BUDGET_S` (20), `READER_THOROUGH_BUDGET_S` (90), `READER_TESSERACT`,
`READER_TESSDATA`, `READER_USE_PADDLE`. Default port 8083.

## Run and test locally (Windows PowerShell)

```
cd other-features\reader
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:READER_KEY = "<a random string of 32+ characters>"
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8083
.\.venv\Scripts\python.exe -m pytest -s
```
Tesseract for Windows: UB Mannheim build (`winget install UB-Mannheim.TesseractOCR`); extra language files go into a
`.tessdata` folder in this directory (git-ignored) and `READER_TESSDATA` points to it. Tests that need the real engine
are skipped when it is absent.

## Real sample photos (aggregate numbers only)

`scripts/evaluate_samples.py` runs the reader over your own photos and prints ONLY counts: files, unreadable files,
files per script, average confidence, share flagged blurry / needsHumanCheck / no text, time per page. It never prints
or writes recognised text or file names, opens the folder read-only, never copies or uploads anything, and does nothing if
the folder is missing or empty. Point it at the folder in either way:

```
.\.venv\Scripts\python.exe scripts\evaluate_samples.py --samples D:\HMS-training-data
$env:SAMPLES_DIR = "D:\HMS-training-data"; .\.venv\Scripts\python.exe scripts\evaluate_samples.py
```
The default is `samples-local\` in this folder (git-ignored and docker-ignored). Keep large collections OUTSIDE the
repository. It walks the folder with a streaming iterator (never a list of all paths), handles one file per worker at a
time with multiprocessing, tolerates corrupt files (they are counted), saves a small counters file so an interrupted
run resumes (`--fresh` starts over, `--limit N` stops early), and prints a one-line warning if the folder is inside a git
repository and not git-ignored.

## Deploy on the VPS

1. Copy this folder to the server; `cp .env.example .env`; set a random `READER_KEY` and `READER_ALLOWED_HOSTS`.
2. `docker compose up -d --build` (installs Tesseract with many language packs; binds 127.0.0.1:8083).
3. Optional PaddleOCR: uncomment the `pip install paddlepaddle paddleocr` line in the Dockerfile; models download on
   first use (about 1 GB of memory with several languages, CPU only); mount a volume to keep them. Use at least 4 GB RAM.
4. Nginx with HTTPS in front using `nginx.conf`. Check `GET /health` for the engines and installed languages.

Docker files, Nginx and PaddleOCR are untested.

## Possible flow (not built)

A scanner/antivirus step first, then this reader on the cleaned original before any lossy compression. Nothing in this
folder calls another service, reads another folder, or shares configuration with one.
