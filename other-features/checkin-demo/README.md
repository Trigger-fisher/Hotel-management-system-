# checkin-demo

Local guest check-in demo that shows the intake flow step by step: choose ID photo, virus scan, quality check, read the ID, check-in form filled from the ID, save, report.
Offline (127.0.0.1 only). Standard library only. Calls the other services over HTTP (reader required; scanner and quality gate optional, shown as skipped when not running).

    set READER_KEY=...   (and GATE_KEY, SCANNER_KEY when those services run)
    python app.py        ->  http://127.0.0.1:8095

Saved: data/checkins.jsonl (guest data), images/FirstName_LastName_IdName.ext (renamed copy), /report (table) and /report.csv (Excel). Both folders are git-ignored.

## The form first, the picture after (MJ, 5 Nov 2026)

A single ID is read in two parts. Step 4 is ONE quick read (`mode=fast`, no cutting, no merging): the form fills as soon as it
answers. Then, in the background while reception types the phone, room and nights, the demo asks the reader to cut the card, merge
front and back and compress the picture (`multi=true&merge=stack&maxRegions=2`); the page shows it as the step "After the form: cut,
merge and save the ID picture" and puts the picture above the form when it is ready. That reading never changes the form: a value
it reads differently (name, date of birth, ID number, address), a second person, or a card it cannot match to the form turns the
field yellow with "The saved picture was read differently (...): please check these values", and the saved row gets `needsHumanCheck`
and `picture.differ` (field names only). When the background cannot match the card, the photo as taken is saved instead of a picture
of someone else. Saving waits for the picture if reception is quicker than the background part.

Since the reader has its own two parts (5 Nov 2026) the demo makes ONE reader call per photo: `picture=later` returns the form's
answer with a token, and the demo fetches the picture and what the reader's background part read differently from
`GET /v1/picture/{token}` (field names and codes only). An older reader without the split is still served the old way (a second call).

## Several IDs in one photo

Tick "This photo holds several IDs" before choosing the photo (a sheet with the front and back of each guest's card). The reader is
called with `multi=true&picture=later`: its fast part finds every card without the model, reads them side by side and pairs front and
back per person, so the tabs appear at once; each guest's merged picture (front above back, under 500 KB) follows from its background
part ("After the form: cut, merge and save the ID picture"). A guest only the background found becomes one more tab with a "!", and a
value it read differently turns that field yellow. The form is still the last step: after the flow steps it shows one tab per guest,
each filled from that guest's merged fields, with the merged picture above the form; yellow fields and a "!" on the tab mean please check (a front
without a back, a pair made by position only, a doubtful value). Each guest is saved as their own row in data/checkins.jsonl and their
own picture images/FirstName_LastName_IdName.png (or .jpg). The report shows where each row came from ("guest 2 of 3 in one photo
(front + back, aadhaarNumber)") and the flags.

## Clarity and photo check (4 Nov 2026)

Each guest's form (and the single-ID form) shows the reader's clarity grade (clear / usable / unclear), its reasons ("card
blurred", "glare on card (6%)", "front: number line blurred" ...), the key fields read from an unclear part, and the photo check
outcome (the ID photos match, do not match, unclear, no portrait, nothing to compare). Yellow box = an unclear card or key field;
red box (and a red mark on the tab) = the ID photos do not look like the same person. Both carry a retake hint: the reader's own
line ("Retake this card: ..."), and for a photo mismatch "compare the guest's face with every ID; retake if a portrait is glared or
blurred, otherwise ask for the guest's own ID". The saved row keeps the grade, photo outcome and reasons (never a score list); the
report and CSV show "clarity" and "photo check".

Tests (standard library, a fake reader on 127.0.0.1, invented guests): `python -m unittest discover -s tests -v`
