# Field mapping plan (ID reader)

Written 4 Nov 2026. Owner: MJ. Code: `other-features/reader` (reading and mapping), `other-features/accuracy-check` (measuring).
Companion to `Document-Intake-Flow-v2.pdf` (which is the authority for the whole flow).

## 1. Two jobs, kept apart

| Job | What it does | Where | Typical error |
|---|---|---|---|
| OCR | Turns pixels into text lines with boxes and confidence | `reader/app/engines/` (RapidOCR primary, Tesseract for Gujarati and others, optional PaddleOCR) | Wrong characters (0 vs O, 5 vs S) |
| Mapping | Decides which text is the name, date of birth, number, address | `reader/app/doctypes/`, `fields.py`, `mrz.py`, `codes.py` | Right text in the wrong field, or a field missed |

They are measured separately, because they are fixed differently: OCR is fixed by better pictures and models, mapping by better rules and labels.

## 2. The mapping pipeline (what runs after OCR)

1. **Find the card type.** Every document type scores the text (keywords in English, Hindi and Gujarati, number patterns, QR and MRZ presence). The best score above `THRESHOLD = 0.5` wins. Otherwise the card is `unknown`: all text is kept, no field is invented, `needsHumanCheck` is set.
2. **Run that type's extractor.** Each type has its own file in `doctypes/` (Aadhaar, PAN, passport/visa/residence permit/national ID by MRZ, driving licence, voter ID, employee card). A new type is one new file plus its test; the registry finds it.
3. **Use the strongest evidence first.** Order: machine-readable code (MRZ with check digits, Aadhaar QR) → label lines (`Name`, `DOB`, `Father`) → position and layout (Aadhaar prints the name unlabelled above the date of birth) → number patterns.
4. **Validate, never change.** Validators only check: Aadhaar Verhoeff digit, PAN pattern, MRZ check digits, driving-licence pattern, date sanity. A failed check sets `valid: false` and flags the field. The value is never rewritten or hidden.
5. **Cross-check.** QR name/date of birth against the printed text (mismatch makes the printed field `doubtful`); front against back in `/v1/read-pair` (same person verdict).
6. **Flag.** Every field carries confidence and source (`ocr`, `qr`, `mrz`). `doubtfulFields` and `needsHumanCheck` tell reception what to look at. A field is never reported as certain.

## 3. Fields per card type (target set)

| Type | Fields mapped now | Planned additions |
|---|---|---|
| Aadhaar | name, dob, documentNumber, qrLast4 | gender, address from back |
| PAN | name, dob, documentNumber | father's name |
| Passport / MRZ cards | name, dob, documentNumber, nationality, expiry, issuingCountry, sex, mrzValid | place of birth from the visual zone |
| Driving licence | name, dob, documentNumber | address, validity, vehicle classes |
| Voter ID | name, documentNumber | father/husband name, address |
| Employee card | name, documentNumber | none (not a government ID) |
| Unknown | none (all text kept) | send to review, then add as a new type if it repeats |

Priority order for tuning is MJ's call: Aadhaar, PAN, passport, driving licence, voter ID (to be confirmed).

## 4. Measuring accuracy (built)

- `accuracy-check/review.py`: photo left, fields right. MJ fixes values; each photo is saved as a label (`labels.jsonl`), `results.xlsx` and `report.html` are rewritten, and a renamed copy `FirstName_LastName_IdName` is saved offline. "Confusing - do last" puts hard photos at the end.
- Each field gets one verdict: right, **OCR wrong** (characters), **mapping wrong** (the text is on the card but in another field), missing, or invented. The summary shows each as a percentage per field and per card type, plus card-type accuracy.
- `accuracy-check/check.py make/score`: the same measurement as an Excel/CSV sheet.
- Everything runs on this PC. The photos in `D:\HMS-training-data` are never uploaded and never copied into git.

## 5. Improving accuracy (order of work)

1. **Baseline.** Review about 100 real photos across the priority types. Read the Summary sheet. This shows whether the weak point is OCR or mapping, and which type.
2. **Tuning (no training).** Adjust thresholds, keyword lists, layout rules and orientation margins. Re-run the same 100 photos; the change is kept only if the numbers improve and no type gets worse.
3. **Pseudo-labels.** Run the reader over the full 48k–58k set. Where the QR, MRZ or a valid checksum agrees with the OCR, the result is a free label. Only the rest needs human review.
4. **Fine-tuning (ML).** With the labelled set, split by guest (train / validation / test; the same guest never appears in two splits). Fine-tune the recognition model for the priority cards on a GPU once, and keep it only if the test numbers beat the tuned baseline. Candidate for a later step: a learned field tagger for layouts the rules cannot cover.
5. **Regression set.** Keep a fixed 100-photo test set. Every change to rules or models re-runs it before release.

## 6. Rules that do not change

- No masking of ID numbers (optional `maskIdNumbers`, default off).
- Unknown card is not an error; it goes to review.
- Validators check, they do not edit. Corrections come only from a person.
- Real photos stay on this PC; only aggregate numbers are printed or committed.
- The reader shares nothing with other folders (independence rule; `check-independence.py`).

## 7. Status

| Item | State |
|---|---|
Updated 5 Nov 2026. The whole flow as built today, step by step with measured numbers: `Intake-Flow-Current.md`.

| Item | State |
|---|---|
| Card type registry and extractors | built, tested on invented cards; now also visas (MRV-A/B, older sticker, e-Visa ETA), OCI, PIO, residence permits (TD1/TD2, FRRO), e-Aadhaar letter, old/new PAN, old state licences |
| Aadhaar QR cross-check | built (signature not verified) |
| Front/back pairing | built: only on a checked number or a QR whose number tail is found; name + DOB alone never pairs (`sameNameDobNoNumber`); side by side only when nothing can decide, nothing conflicts and the cards look alike (`pairedByPosition`) |
| Rare namesakes | built: same full name + full DOB, no matching number = two people, file name ends in `_Rare` |
| One guest's documents linked | built: same number, the passport number on a visa/OCI/PIO/permit, or name + DOB + photo match; else `possibleSameGuest` |
| Multi-ID photos (up to 12) | built in intake-worker (`Pipeline.analyse`, folder runner) and reader (`multi=true`); card cutter Segment Anything vit_b; 1-12 invented cards all found, corner error max 0.27 %. Worker job path still single (`multi_not_supported`) until HMS sends one link per person |
| Photo check (YuNet + SFace, offline) | built in intake-worker and reader; unclear ID photo = reject "Photo on the ID is not clear, please retake."; separation of real faces not measured |
| Clarity grade per card (clear / usable / unclear, region reasons) | built in intake-worker and reader; 220/220 damaged invented cards caught, 0/150 clean ones called unclear; JPEG quality below 25 = "picture too compressed" |
| Compression | 150 KB first, 500 KB hard maximum, SSIM 0.98 and an OCR round trip below JPEG 92 |
| Accuracy review form, Excel, report | built, tested on invented cards; now per card and per person (pairing, refusal, clarity, photo, rare) |
| Check-in demo (form last) | built on the PC: one form per guest, clarity and photo outcome shown |
| Speed (plan: one ID both sides under 6 s) | not met: about 12-14 s on this PC; lighter cutter, key-fields-only reading and 4-core parallel work in progress (5 Nov 2026) |
| VPS deployment pack (`deploy/`) | written and checked without Docker; never run |
| Baseline on real photos | waiting for `D:\HMS-training-data` and MJ's order |
| Fine-tuning | `training` folder ready; after the baseline, on MJ's order |
