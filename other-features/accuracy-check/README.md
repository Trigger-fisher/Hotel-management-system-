# accuracy-check

Measures the ID reader on your own photos: OCR accuracy (characters read), mapping accuracy (right text in the right field),
front/back pairing, photo rejection ("Photo on the ID is not clear, please retake."), clarity grade (clear / usable / unclear),
photo outcome and the rare (same name + DOB, no matching number) mark.
Talks to the reader only over HTTP (READER_URL, READER_KEY) and asks for the multi-card answer (multi=true; the form also asks
returnCrops=true). A reader that answers one document, or has no clarity / photo / rare / refusal fields yet, still works: what it
does not report shows as "not reported" and stays out of that accuracy (n/a). A card MJ marks "should be refused" or a person
MJ marks rare that the reader did not report counts as a miss.

## Sheets (check.py, standard library only)

    python check.py make  --photos D:\HMS-training-data\sample --out sheet.csv --limit 50
    (open the three sheets in Excel, fill the check columns, save as CSV)
    python check.py score --sheet sheet.csv

* `sheet.csv`: one row per field per card (`card` = reader's region number). check: Y = right; the correct text = wrong;
  - = field not on the card. Missed field: add a row with photo, card, field, empty extracted, correct text in check.
  `expected_type` once per card.
* `sheet-cards.csv`: one row per card. check_side, check_clarity (Y or clear / usable / unclear), check_rejected (Y or yes / no).
* `sheet-people.csv`: one row per person. check_cards (Y or e.g. 1+2), check_rare (Y or yes / no), check_photo (Y or match /
  mismatch / unclear / noPhoto / notCompared).

Older sheets without the `card` column still score. Output is aggregate numbers only. Sheets hold personal data and are
git-ignored; keep them on this PC.

## Live review form (option B)

    set READER_KEY=...  (same as the running reader)
    .venv\Scripts\python.exe review.py --photos D:\HMS-training-data\sample --images-out D:\HMS-reviewed-images
    open http://127.0.0.1:8090

Photo on the left. On the right, every card the reader cut (its crop, reader's side, type, clarity grade and reasons, photo status,
refused or not) with its fields, then every person (cards paired, evidence, paired by position, rare, photo outcome).
Untouched values count as right. Fix a field, the card's real type / side / clarity, tick "should be refused" when the ID photo is
not clear, fix a person's real cards (1+2), rare, or photo outcome, then Save and Next.

Saves:
* `labels.jsonl` (training labels). Version 2 lines carry `version`, `fields` (each with its `card`), `cards` and `people`; the
  first card's `expectedType` / `detectedType` stay at the top so older readers of the file keep working. Version-1 lines (no
  version field) are still read and become card 1.
* `results.xlsx`: sheets Fields, Cards, People and Summary (fields right, OCR, mapping, missed, invented, character accuracy,
  document type, card side, pairing (per person, and for pairs made by position), photo rejection (wrongly refused / missed),
  clarity (too strict / too lenient), photo outcome, rare).
* `report.html` (open from the form) and a renamed copy of each reviewed photo as FirstName_LastName_IdName (+ `_Rare` when MJ
  marked that person rare) in the images folder.

"Confusing - do last" moves a photo to the end of the queue. Everything stays on this PC (server on 127.0.0.1, no uploads; card
crops stay in memory); originals are never changed.

## Tests

    .venv\Scripts\python.exe -m pip install openpyxl pytest
    .venv\Scripts\python.exe -m pytest -q tests

A fake reader on 127.0.0.1 answers with invented cards (multi with the new fields, multi without them, and the older one-document
answer). openpyxl (MIT) and pytest (MIT).
