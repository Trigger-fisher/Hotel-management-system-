# Intake flow as built today (5 Nov 2026)

Owner: MJ. This page describes what the code in `other-features` does **today**, not the plan. The plan is
`Document-Intake-Flow-v2.pdf`; the reading and mapping plan is `Field-Mapping-Plan.md`. Every number below was measured on
**invented** pictures on MJ's PC (i7-11600H, 6 cores, CPU only), never on real IDs and never on the VPS.

## MJ's order of 5 Nov 2026

1. **The form first, the picture after.** A job runs in two parts. The FAST part fills the check-in form; the BACKGROUND part (card
   cutter, front/back merge, stack, enhance, compress, name, encrypt, save) runs after it, and no one waits for it.
2. **No QR for now.** QR codes and barcodes are not decoded anywhere in the flow. The code stays behind the setting
   `INTAKE_READ_QR` (off by default) and still works when it is switched on.

## Where each step lives

The whole flow runs inside **one program, `intake-worker`**, with its own copies of the logic from the sibling folders (marked
"copied from <folder>"). The sibling HTTP services (`antivirus`, `quality-gate`, `reader`, `pdf-to-image`, `compressor`) still
work alone; the `reader` carries its own copy of the multi-card, photo and clarity rules (it does not have the two-part split yet).
`checkin-demo` shows the check-in form on a PC (form first, picture after), `flow-viewer` shows each photo going through the two
parts, `id-capture` is the phone camera page, `accuracy-check` measures reading, `training` is ready for MJ's train day, and
`deploy` runs everything on one VPS (written, never run).

## Job status

`queued` -> `processing` (fast part) -> **`read`** (the fields are in the row: the form fills) -> `saving` (background part) ->
`done`. A refused file ends in `rejected`; a job that cannot finish ends in `needs_attention`. A crash in the background part puts
the job back to `read` with its fields; after 3 attempts it is `needs_attention`, fields kept, no picture.

## The FAST part (reception waits for it)

| # | step | what it does | rule / limit |
|---|---|---|---|
| 1 | upload | HMS writes a job row with a signed download link and a signed upload link; the worker pulls it (`FOR UPDATE SKIP LOCKED`, queued jobs before any background part) and downloads into memory | 25 MB; https and the storage host only; nothing written to disk |
| 2 | type check | real type from the bytes: JPEG, PNG, WebP, HEIC, PDF | anything else rejected before decoding |
| 3 | virus scan | worker: YARA rules on the bytes in memory (polyglots, script in a picture, active PDF, anything after the file's end; about 10-35 ms for a 3-4 MB file), then ClamAV over clamd INSTREAM with the official signatures and the Sanesecurity feeds (checked daily) | rule hit (`yara_match`) or infected (`malware_found`) = rejected; a rule engine timeout or error, or clamd unreachable = retried, **never "clean"** |
| 4 | clean pixel re-save | decoded to a fresh lossless pixel array, EXIF turn applied, all metadata dropped; each PDF page drawn at 300 dpi by PDFium and the PDF thrown away | 40 megapixels, 20 pages; password-protected PDF refused (`pdf_encrypted`) |
| 5 | quality gate | blur, glare, dark, small, cut off, blank (profiles `id-card`, `document`, `photo`), judged while step 6 runs | reject or warn, per hotel (`gate_action`); a reject still comes before any reading |
| 6 | find the card | the card cutter's classic finder, WITHOUT the model: card-shaped islands of print, the same edge fit, sleeve trim and upright turn as the cutter. An outline it cannot fit well (`lowContrastEdge`, `ratioOff`: a box on a passport page, a pale card) is dropped; with no card the whole photo is read | a sheet of many cards is not separated here (step 13 does it) |
| 7 | read | type from the registry (Aadhaar, PAN, driving licence, voter ID, passport, visa, OCI, PIO, residence permit, ID cards, employee card, unknown), RapidOCR for Latin and, at the same time, Tesseract for Hindi/Gujarati and for the MRZ strip | a doubtful field is flagged, never guessed; no QR |
| 8 | field checks | Verhoeff (Aadhaar), PAN pattern, MRZ check digits, licence pattern, dates | validators check, never change a value |
| 9 | photo rule | the holder's portrait found on every side that carries one (YuNet; looked for while step 7 reads), compared between cards (SFace), offline | **unclear portrait on a side that must carry one = REJECT** "Photo on the ID is not clear, please retake." (`photo_unclear`, follows `gate_action`) |
| 10 | clarity grade | every card `clear` / `usable` / `unclear` with reasons per region, effective dpi, glare, exposure, contrast, noise, motion, OCR confidence, JPEG quality of the upload | unclear card = `needs_human_check` + a retake line; JPEG quality below 25 = "picture too compressed" |
| 11 | group | front and back of what it found, by the same rules as the background part (number, position, namesakes, RARE) | a worker job keeps one person (`severalPeople` + check when there are more) |
| 12 | write `read` | fields, doubtful fields, flags, clarity, photo outcome, card corners, `timings.formMs` into the job row | **no picture is made or saved**; never the OCR text, never a face embedding |

## The BACKGROUND part (no one waits for it)

| # | step | what it does | rule / limit |
|---|---|---|---|
| 13 | card cutter | MobileSAM (Segment Anything with a small encoder) finds up to 12 cards, straightens each to 85.6:54 | classic finder as fallback (`fallbackFinder`) |
| 14 | read what is new | a card the fast part read in the same place (all corners within 2 % of the card length) keeps that reading; a new card, or one the fast part read with a doubt (unknown type, failed check), is read again | the fast part's pictures stay in the worker's memory for its own background part; after a restart they are downloaded again |
| 15 | photo, clarity, group | as steps 9-11 on the model's cards; one guest's documents linked (same number, the passport number on a visa/OCI/PIO/permit, or name + full DOB + photo match) | name + DOB without a photo match = `possibleSameGuest` (check), never a link |
| 16 | compare | more or fewer cards or people, another pairing or document type, a key value read differently, a photo it would reject | **never changes a field**: `background.disagreements`, flag `backgroundDisagrees`, `needs_human_check` (the form turns yellow); a person only the model found gets its own result with `backgroundOnly` |
| 17 | stack | front above back, same width, white gap, no border; one picture per person per document | a fast person the model cut differently is stored from the fast part's own cards (`unmatched`), never as someone else's picture |
| 18 | enhance | stored copy only: levels, gamma, gentle white balance, mild denoise and sharpen, only where the problem was measured | reading always uses the untouched pixels |
| 19 | compress | **150 KB tried first** (SSIM at least 0.98, OCR round trip below JPEG 92 so key fields stay readable); else the smallest picture that keeps quality, **500 KB hard maximum** | the only lossy step |
| 20 | name | `FirstName_LastName_IdName`; **`_Rare`** at the end for MJ's RARE namesakes | `Unknown_<IdName>` when no name; collisions `_2` |
| 21 | encrypt and save | AES-256-GCM with the hotel's data key, PUT to the signed upload link; status `done` with `result_bytes`, compress scores, `background`, `timings.background` | the background part may write only these columns (`app/store.py` SAVE_COLUMNS, tested); encryption fails = nothing uploaded |
| 22 | check-in form | one form per guest, filled at step 12, yellow when a check is needed, red when the ID photos do not match; the saved picture appears when step 21 is done | built in `checkin-demo` only (local PC); not in HMS yet |

No ID number is masked (optional `mask_id_numbers`, default off). Logs carry ids, step names, codes and numbers only.

## Measured numbers (invented pictures, MJ's PC)

Speed: one invented Aadhaar front photographed on a desk (2400 x 1800, `scripts/bench.py` case `single`), warm models, the process
pinned to 4 cores, 20 runs each. Other programs shared this PC; the CPU load at the time is given, because it moves the numbers a lot.

| what | p50 | p95 | PC load | command |
|---|---|---|---|---|
| BEFORE: form ready = everything done (old one-part code) | 11.33 s | 12.74 s | 76-94 % | old code, the same cases, `Pipeline.analyse` |
| BEFORE, a second run | 14.34 s | 22.18 s | 23-68 % | same |
| AFTER: form ready (fast part) | 2.87 s | 3.40 s | 76-94 % | `python scripts\bench.py --runs 20 --cases single` |
| AFTER: form ready (fast part), with the faster edge fit | **1.67 s** | **2.01 s** | 11-38 % | same |
| AFTER: picture saved, counted from the form-ready moment | 5.64 s | 5.98 s | 11-38 % | same |
| AFTER: two phone photos (front and back), form ready | 6.08 s | 9.36 s | about 70 % (not quiet) | `--cases pair-photo` |

Fast part steps (median, quiet run): re-save 31 ms, find 422 ms with the gate (211 ms) judged alongside, read 1094 ms, photo +
clarity 110 ms. Background part: model cutter 5055 ms, photo + clarity 265 ms, enhance 47 ms, compress 242 ms; no card read again.

Target p95 at most 3 s, aim 2 s: **met on the quiet run (p95 2.01 s), not met while other programs loaded the PC (p95 3.40 s).** The
old code also ran its OCR with 6 threads on the 4 pinned cores (onnxruntime counts all cores); the new code uses one thread per
usable core. Two photos in one job were measured only on a busy PC and are not under 3 s there.

Correctness: the fields the fast part writes, against the old full pipeline, on 125 invented pictures (every drawn kind of
`tests/cards.py`, `tests/idkinds.py`, `tests/visadocs.py` and `tests/sheets.py`, flat, as a phone photo and as a sleeved A4 scan,
plus the bench cases): **112 identical**. The 13 others:

* 5 come from the QR being off: a name or date of birth the old pipeline took from the QR, the PAN "new" form and a name's word
  breaks taken from the QR, an Aadhaar back photo whose type relied on its QR (now `unknown`, with a check).
* 1 is the old pipeline itself: its address on `bench pair-photo` differs between two runs of the same old code.
* 1 is by design: a sheet of ten cards (`bench sheet10`); the fast part reads one card, the background part finds all ten and flags
  `cards`, `people` and `backgroundOnly`.
* 1 asks for a check it did not before (`photo K pan old`): the classic finder could not fit the card, so the whole photo was read
  (same fields); the background part stores the model's cut.
* 6 are MRZ and printed-field reads that flip on a cut differing by at most 0.05 px (the classic finder and the model start from
  different outlines and the edge fit ends a hair apart): better on 2 (a valid passport number, a TD1 back now read), worse on 3
  (two passport data pages scanned in a sleeve, a TD2 front), neutral on 1. All 6 are `needs_human_check`; the background part flags
  the read-differently fields on 3 of them. The MRZ strip stays the least reliable read.

Other numbers (from the folder READMEs, unchanged by the split):

| what | result | source |
|---|---|---|
| Card cutter, sheets of 1 / 2 / 4 / 6 / 12 cards | all found; corner error max 0.11 / 0.12 / 0.15 / 0.18 / 0.27 % of the card diagonal | intake-worker README |
| Card cutter memory | about 1.4 GB per process | intake-worker README |
| Clarity grade | 220 of 220 damaged cards graded unclear; 0 of 150 clean cards called unclear (147 clear, 3 usable) | intake-worker README |
| Photo check, same drawn person | never called a mismatch (portraits 120-180 px tall); found 82-88 of 90 | intake-worker README |
| Photo check, different drawn people | called a match 63-81 % of the time: drawn faces are too alike, so a photo match only counts together with name AND full DOB | intake-worker README |
| Heavy JPEG | invented cards read back their JPEG quality exactly (q20 -> 20) | intake-worker README |
| PDF to image | 150 dpi: PNG 67 ms, JPEG 26 ms per page; 300 dpi: PNG 229 ms, JPEG 77 ms | pdf-to-image README |
| Quality gate blur line | reject from blur sigma 4 (`id-card`), 5 (`document`), 6 (`generic`), 8 (`photo`) on invented pages | quality-gate README |

## Still pending

* **Speed on the VPS:** p95 2.01 s for one photo was measured on a quiet PC, 3.40 s on a busy one; two photos in one job (front and
  back) were not measured on a quiet PC. Measure both on the KVM 4 before more work.
* **Reader service:** its own copy of the flow (used by `checkin-demo`) is not split yet; the demo does the split itself by calling
  the reader twice (one quick read for the form, then the cut and merge for the picture). The reader still reads QR codes.
* **Sheets in the fast part:** a sheet of many cards fills the form from one card; the background part separates the people and
  asks for a check. One photo per ID is the case the fast part is built for.
* **Part 10 tests:** the nasty-file, privacy and failure sets run in `intake-worker` on invented files (see its README, "Part 10
  tests"); every file is rejected with its code or made harmless. Still to do: a real clamd, a real process kill against PostgreSQL,
  the isolation set on a real Supabase project, the reading set (real photos, on MJ's order) and the phone set.
* **Real photos:** no number above comes from a real ID. The baseline on real photos, the clarity thresholds and the photo-match rate
  on real printed portraits wait for MJ's order (train only on order). The `training` folder is ready but has not been run.
* **HMS side:** the job table (`intake-worker/sql/proposal.sql`, now with the `read` and `saving` statuses, never run), signed links,
  the limited database login and the HMS check-in form are not built. One login runs both parts, so only the worker keeps the
  background part from changing a field; HMS may add a trigger for it.
* **VPS:** `deploy/` (one Hostinger KVM 4, all services) is written and checked by `deploy/validate.py` but never run.
* **Worker scan:** YARA rules and the Sanesecurity feeds are now in the worker's own copy; its clamd image (`intake-worker/clamd`) is
  written but never built, and HMS still has to read `feeds_date` from the heartbeat for the 48-hour alert.
* **Known limits:** with the QR off, an Aadhaar back without a readable number pairs only by position; the classic finder misses pale
  cards without a sleeve (the whole photo is read, the background part cuts it); the Aadhaar QR signature is not verified.
* **Fixed (5 Nov 2026, invented pictures):** a heavily compressed picture re-saved as PNG or as a
  quality 95 JPEG is now traced in its pixels and gets "picture too compressed" (quality-gate, intake-worker and reader clarity, own
  copies: 0 of 100 clean drawn cards and 0 of 96 clean gate pictures flagged, 300 of 300 and 288 of 288 re-saved copies flagged; a copy
  resized after the first compression is still not caught). A dedicated MRZ pass raised passport MRZs read fully correct from 66 to 90
  of 100 invented pages (blur, glare, small size, JPEG noise), with 0 silent misreads (was 1); 7 stay doubtful and 3 missing.
