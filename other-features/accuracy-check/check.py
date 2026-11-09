"""Accuracy check for the ID reader: OCR, field mapping, front/back pairing, photo rejection, clarity grade and photo outcome.

  python check.py make  --photos D:\\HMS-training-data\\sample --out sheet.csv [--limit 50]
      Sends each photo to the running reader (HTTP, kind=id, multi=true) and writes three sheets:
        sheet.csv         one row per extracted field of every card (column `card` = the reader's region number)
        sheet-cards.csv   one row per CARD: side, type, clarity grade and reasons, photo status, rejected + reason
        sheet-people.csv  one row per PERSON: cards paired, pairing evidence, pairedByPosition, rare, photo outcome
  (open the sheets in Excel, fill the check columns, save as CSV)
  python check.py score --sheet sheet.csv
      Prints aggregate numbers only: document type, OCR, mapping, pairing, rejection, clarity, photo outcome, rare.

Check columns (blank = not judged):
  sheet.csv          check          Y = right; the right text = wrong (type what the card says); - = not on the card (invented).
                                    A missed field: add a row with photo, card, field, empty `extracted`, the right text in check.
                     expected_type  once per card (first row of the card): aadhaar, pan, passport, driving-licence, ...
  sheet-cards.csv    check_side     Y or the right side (front / back / single)
                     check_clarity  Y or the right grade (clear / usable / unclear)
                     check_rejected Y or the right answer (yes = the ID photo is unclear and the card must be refused, no = keep)
  sheet-people.csv   check_cards    Y or the right cards of this person (1+2, or 3 alone)
                     check_rare     Y or yes / no (same full name and DOB as another person here, no matching number)
                     check_photo    Y or the right photo outcome (match / mismatch / unclear / noPhoto / notCompared)

Talks to the reader only over HTTP (READER_URL, READER_KEY). Works with a reader that answers the multi-card shape (regions,
people) and with an older reader that answers one document (fields at the top) or has no clarity / photo / rare fields yet:
anything the reader does not report is left out of that accuracy (n/a), never counted as right.
Imports nothing from other folders. Photos are opened read-only, never copied; the sheets hold extracted personal data, so keep
them on this PC (they are git-ignored)."""
from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import os
import re
import sys
import urllib.request
import uuid
from collections import defaultdict
from pathlib import Path

LABEL_VERSION = 2  # labels.jsonl records: 1 = one card per photo (no version field), 2 = cards + people
COLUMNS = ["photo", "card", "expected_type", "detected_type", "field", "extracted", "confidence", "flags", "check"]
CARD_COLUMNS = ["photo", "card", "side", "detected_type", "clarity", "clarity_reasons", "photo_status", "rejected",
                "rejected_reason", "flags", "check_side", "check_clarity", "check_rejected"]
PEOPLE_COLUMNS = ["photo", "person", "cards", "sides", "evidence", "paired_by_position", "rare", "photo_outcome", "clarity",
                  "rejected_reason", "check_cards", "check_rare", "check_photo"]
EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".pdf"}
GRADES = ["clear", "usable", "unclear"]
OUTCOMES = ["match", "mismatch", "unclear", "noPhoto", "notCompared", "unavailable"]
SIDES = ["front", "back", "single", "unknown"]
PHOTO_RETAKE = "Photo on the ID is not clear, please retake."  # MJ's rule, the reader's fixed phrase
POSITION_EVIDENCE = {"position", "layout"}
POSITION_FLAGS = {"pairedByPosition", "pairedByLayoutOnly"}


# ---------------------------------------------------------------- reader call and response parsing

def call_reader(path: Path, url: str, key: str, crops: bool = False) -> dict:
    boundary = uuid.uuid4().hex
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    parts = []
    form = [("kind", "id"), ("mode", "thorough"), ("findDocument", "true"), ("multi", "true"),
            ("returnCrops", "true" if crops else "false")]
    for name, value in form:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo{path.suffix}"\r\nContent-Type: {ctype}\r\n\r\n'.encode())
    parts.append(path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(url.rstrip("/") + "/v1/read", data=b"".join(parts), method="POST",
                                 headers={"X-Reader-Key": key, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def _grade(block) -> str | None:
    if isinstance(block, str):
        return block or None
    if isinstance(block, dict) and block.get("grade"):
        return str(block["grade"])
    return None


def _reject_reason(block: dict) -> str:
    """The reason code of a refusal in a region or person block (several shapes accepted), or ''."""
    for key in ("reject", "rejected"):
        r = block.get(key)
        if isinstance(r, dict):
            return str(r.get("code") or r.get("reason") or r.get("message") or "rejected")
        if isinstance(r, str) and r:
            return r
    if block.get("rejectReason"):
        return str(block["rejectReason"])
    clar = block.get("clarity") if isinstance(block.get("clarity"), dict) else {}
    pr = clar.get("photoReject")
    if pr:
        return str(pr.get("reason") or pr.get("code") or "photo_unclear") if isinstance(pr, dict) else "photo_unclear"
    if block.get("status") == "rejected" or block.get("rejected") is True:
        return "rejected"
    if PHOTO_RETAKE in str(block.get("retake") or "") or PHOTO_RETAKE in str(clar.get("advice") or ""):
        return "photo_unclear"
    return ""


def _reject_reported(block: dict) -> bool:
    return any(k in block for k in ("reject", "rejected", "rejectReason", "clarity", "status"))


def _field_rows(fields: dict, doubtful: set) -> list[dict]:
    rows = []
    for k, f in (fields or {}).items():
        f = f if isinstance(f, dict) else {"value": f}
        flag = " ".join(x for x in ("doubtful" if k in doubtful or f.get("doubtful") else "",
                                    "invalid" if f.get("valid") is False else "") if x)
        rows.append({"field": k, "value": "" if f.get("value") is None else str(f.get("value")), "confidence": f.get("confidence"), "flag": flag})
    return rows


def _card(block: dict, n: int, doubtful: set) -> dict:
    clar = block.get("clarity")
    photo = block.get("photo")
    reason = _reject_reason(block)
    reported = _reject_reported(block)
    reasons = list(clar.get("reasons") or []) if isinstance(clar, dict) else []
    return {"card": int(block.get("regionId") or n), "side": block.get("side") or ("single" if "regionId" not in block else "unknown"),
            "type": (block.get("documentType") or {}).get("type", "") if isinstance(block.get("documentType"), dict) else str(block.get("documentType") or ""),
            "fields": _field_rows(block.get("fields") or {}, doubtful),
            "clarity": _grade(clar), "clarityReasons": [str(r) for r in reasons],
            "retake": str(block.get("retake") or (clar.get("advice") if isinstance(clar, dict) else "") or ""),
            "photo": (photo.get("status") or photo.get("outcome")) if isinstance(photo, dict) else None,
            "rejected": True if reason else (False if reported else None), "rejectReason": reason,
            "flags": [str(f) for f in block.get("flags") or []], "crop": block.get("crop")}


def _rare(p: dict) -> bool | None:
    if isinstance(p.get("rare"), bool):
        return p["rare"]
    if "rare" in (p.get("flags") or []) or str(p.get("suggestedName") or "").endswith("_Rare"):
        return True
    return None


def parse_response(res: dict) -> dict:
    """The reader's answer as {multi, cards, people}. A multi answer (regions + people) is used as it is; an older one-document
    answer becomes one card and one person. Values the reader does not report are None (left out of that accuracy)."""
    doubtful_all = set(res.get("doubtfulFields") or [])
    if isinstance(res.get("regions"), list):
        cards = [_card(r, i, set()) for i, r in enumerate(res["regions"], 1)]
        by_id = {c["card"]: c for c in cards}
        people = []
        for i, p in enumerate(res.get("people") or [], 1):
            regions = [int(x) for x in p.get("regions") or p.get("cards") or []]
            doubt = set(p.get("doubtfulFields") or [])
            for r in regions:  # the person's doubtful fields mark the card rows too
                for f in by_id.get(r, {}).get("fields", []):
                    if f["field"] in doubt and "doubtful" not in f["flag"]:
                        f["flag"] = (f["flag"] + " doubtful").strip()
            ev = p.get("evidence")
            evidence = "+".join(map(str, ev)) if isinstance(ev, list) else str(ev or "")
            flags = [str(f) for f in p.get("flags") or []]
            photo = p.get("photo")
            reason = _reject_reason(p)
            rej_cards = (p.get("reject") or {}).get("cards") if isinstance(p.get("reject"), dict) else None
            for rc in rej_cards or []:  # a refusal listed on the person marks its cards
                c = by_id.get(int(rc.get("card") or rc.get("region") or 0)) if isinstance(rc, dict) else None
                if c is not None and not c["rejected"]:
                    c["rejected"], c["rejectReason"] = True, str(rc.get("reason") or reason or "photo_unclear")
            people.append({
                "person": int(p.get("personId") or i), "cards": regions,
                "sides": [by_id[r]["side"] for r in regions if r in by_id], "evidence": evidence,
                "pairedByPosition": bool(p.get("pairedByPosition")) or evidence in POSITION_EVIDENCE or bool(POSITION_FLAGS & set(flags)),
                "rare": _rare(p), "photoOutcome": (photo.get("outcome") or None) if isinstance(photo, dict) else (photo or None),
                "clarity": _grade(p.get("clarity")), "rejected": True if reason else (False if _reject_reported(p) else None),
                "rejectReason": reason, "flags": flags})
        return {"multi": True, "cards": cards, "people": people, "flags": [str(f) for f in res.get("flags") or []]}
    card = _card({**res, "documentType": res.get("documentType") or {}}, 1, doubtful_all)
    clar = res.get("clarity") if isinstance(res.get("clarity"), dict) else {}
    card["side"] = clar.get("side") or "single"
    person = {"person": 1, "cards": [1], "sides": [card["side"]], "evidence": "singleDocument", "pairedByPosition": False,
              "rare": _rare(res), "photoOutcome": (res.get("photo") or {}).get("outcome") if isinstance(res.get("photo"), dict) else None,
              "clarity": card["clarity"], "rejected": card["rejected"], "rejectReason": card["rejectReason"], "flags": card["flags"]}
    return {"multi": False, "cards": [card], "people": [person], "flags": card["flags"]}


# ---------------------------------------------------------------- labels (labels.jsonl) and scoring shared with review.py

def upgrade(rec: dict) -> dict:
    """A labels.jsonl record of any version as version 2 (cards + people). A version-1 record (one card, no version field) keeps
    its fields; they become card 1."""
    if int(rec.get("version") or 1) >= 2:
        return rec
    fields = [{**f, "card": f.get("card") or 1} for f in rec.get("fields", [])]
    card = {"card": 1, "side": "single", "expectedSide": None, "detectedType": rec.get("detectedType", ""),
            "expectedType": rec.get("expectedType", ""), "clarity": None, "clarityReasons": [], "expectedClarity": None,
            "photoStatus": None, "rejected": None, "rejectReason": "", "expectedRejected": None, "flags": []}
    return {**rec, "version": LABEL_VERSION, "multi": False, "fields": fields, "cards": [card], "people": []}


def norm(s: str) -> str:
    return re.sub(r"[^0-9a-z\u0900-\u097f\u0a80-\u0aff]", "", (s or "").casefold())


def lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def char_acc(got: str, truth: str) -> float:
    n = max(len(got), len(truth))
    return 1.0 if n == 0 else 1 - lev(got, truth) / n


def pct(a: float, b: float) -> str:
    return "n/a" if b == 0 else f"{100 * a / b:.1f}%"


def field_verdicts(fields: list[dict]) -> list[dict]:
    """One verdict per field: right / ocr_wrong / mapping_wrong / missing / invented. Mapping is judged within the same card."""
    truths_by_card: dict = defaultdict(set)
    for f in fields:
        if f.get("final") and not f.get("notOnCard"):
            truths_by_card[f.get("card") or 1].add(norm(f["final"]))
    out = []
    for f in fields:
        got, final = norm(f.get("extracted", "")), norm(f.get("final", ""))
        if f.get("notOnCard"):
            v = "invented" if got else "right"
        elif not got:
            v = "missing" if final else "right"
        elif got == final:
            v = "right"
        elif got in truths_by_card[f.get("card") or 1] - {final}:
            v = "mapping_wrong"
        else:
            v = "ocr_wrong"
        out.append({**f, "card": f.get("card") or 1, "verdict": v,
                    "charAcc": round(char_acc(got, final), 3) if v == "ocr_wrong" else (1.0 if v == "right" else None)})
    return out


def parse_cards(text) -> list[int]:
    return sorted({int(x) for x in re.findall(r"\d+", str(text or ""))})


def _verdict(got, truth, positive=None) -> str:
    """right / wrong / n/a. n/a when not judged (truth None) or the reader did not report the value (got None), except that a
    positive truth (a card that should be refused, a rare person) the reader did not report counts as a miss."""
    if truth is None or truth == "":
        return "n/a"
    if got is None:
        return "wrong" if positive is not None and truth == positive else "n/a"
    return "right" if got == truth else "wrong"


def card_verdicts(card: dict) -> dict:
    return {"side": _verdict(card.get("side"), card.get("expectedSide")),
            "type": _verdict(norm(card.get("detectedType", "")), norm(card.get("expectedType") or "") or None),
            "clarity": _verdict(card.get("clarity"), card.get("expectedClarity")),
            "rejected": _verdict(card.get("rejected"), card.get("expectedRejected"), positive=True)}


def person_verdicts(p: dict) -> dict:
    exp = p.get("expectedCards")
    exp_cards = parse_cards(exp) if exp not in (None, "") else None
    return {"pairing": _verdict(sorted(p.get("cards") or []), exp_cards),
            "rare": _verdict(p.get("rare"), p.get("expectedRare"), positive=True),
            "photo": _verdict(p.get("photoOutcome"), p.get("expectedPhotoOutcome") or None)}


def summarise(labels: list[dict]) -> dict:
    """Every accuracy from version-2 label records (review form or filled sheets)."""
    per = defaultdict(lambda: defaultdict(int))
    tot, chars = defaultdict(int), []
    acc = {k: defaultdict(int) for k in ("type", "side", "clarity", "rejected", "pairing", "position", "rare", "photo")}
    for rec in labels:
        for v in field_verdicts(rec.get("fields", [])):
            per[v["field"]]["rows"] += 1
            per[v["field"]][v["verdict"]] += 1
            tot["rows"] += 1
            tot[v["verdict"]] += 1
            if v["charAcc"] is not None:
                chars.append(v["charAcc"])
        for c in rec.get("cards", []):
            cv = card_verdicts(c)
            for k in ("type", "side", "clarity", "rejected"):
                acc[k][cv[k]] += 1
            if cv["clarity"] == "wrong" and c.get("clarity") in GRADES and c.get("expectedClarity") in GRADES:
                worse = GRADES.index(c["clarity"]) > GRADES.index(c["expectedClarity"])
                acc["clarity"]["tooStrict" if worse else "tooLenient"] += 1
            if cv["rejected"] == "wrong":
                acc["rejected"]["wrongReject" if c.get("rejected") else "missedReject"] += 1
        for p in rec.get("people", []):
            pv = person_verdicts(p)
            acc["pairing"][pv["pairing"]] += 1
            if p.get("pairedByPosition"):
                acc["position"][pv["pairing"]] += 1
            acc["rare"][pv["rare"]] += 1
            acc["photo"][pv["photo"]] += 1
    n = tot["rows"] or 1

    def rate(k):
        judged = acc[k]["right"] + acc[k]["wrong"]
        return {"right": acc[k]["right"], "judged": judged, "pct": round(100 * acc[k]["right"] / judged, 1) if judged else None,
                **{x: acc[k][x] for x in ("tooStrict", "tooLenient", "wrongReject", "missedReject") if acc[k][x]}}

    return {"photos": len(labels), "rows": tot["rows"], "perField": {f: dict(s) for f, s in sorted(per.items())},
            "right": round(100 * tot["right"] / n, 1), "ocr": round(100 * tot["ocr_wrong"] / n, 1),
            "mapping": round(100 * tot["mapping_wrong"] / n, 1), "missing": round(100 * tot["missing"] / n, 1),
            "invented": round(100 * tot["invented"] / n, 1), "charAcc": round(100 * sum(chars) / len(chars), 1) if chars else None,
            "cards": sum(len(r.get("cards", [])) for r in labels), "people": sum(len(r.get("people", [])) for r in labels),
            **{k: rate(k) for k in acc}}


# ---------------------------------------------------------------- make / score (CSV sheets)

def side_sheets(out: str) -> tuple[Path, Path]:
    p = Path(out)
    return p.with_name(p.stem + "-cards" + p.suffix), p.with_name(p.stem + "-people" + p.suffix)


def yn(v) -> str:
    return "" if v is None else ("yes" if v else "no")


def make(args) -> int:
    key = os.environ.get("READER_KEY", "")
    if not key:
        print("Set READER_KEY (same as the running reader).")
        return 2
    url = os.environ.get("READER_URL", "http://127.0.0.1:8083")
    photos = sorted(p for p in Path(args.photos).rglob("*") if p.suffix.lower() in EXT)
    if args.limit:
        photos = photos[: args.limit]
    if not photos:
        print("No photos found.")
        return 1
    cards_path, people_path = side_sheets(args.out)
    rows = 0
    with open(args.out, "w", newline="", encoding="utf-8-sig") as fh, open(cards_path, "w", newline="", encoding="utf-8-sig") as fc, \
            open(people_path, "w", newline="", encoding="utf-8-sig") as fp:
        w, wc, wp = csv.writer(fh), csv.writer(fc), csv.writer(fp)
        w.writerow(COLUMNS)
        wc.writerow(CARD_COLUMNS)
        wp.writerow(PEOPLE_COLUMNS)
        for i, p in enumerate(photos, 1):
            try:
                parsed = parse_response(call_reader(p, url, key))
            except Exception as exc:  # noqa: BLE001
                w.writerow([p.name, "", "", "ERROR", "", type(exc).__name__, "", "", ""])
                continue
            for c in parsed["cards"]:
                wc.writerow([p.name, c["card"], c["side"], c["type"], c["clarity"] or "", "; ".join(c["clarityReasons"]), c["photo"] or "",
                             yn(c["rejected"]), c["rejectReason"], " ".join(c["flags"]), "", "", ""])
                if not c["fields"]:
                    w.writerow([p.name, c["card"], "", c["type"], "", "", "", "no fields read", ""])
                    rows += 1
                for f in c["fields"]:
                    w.writerow([p.name, c["card"], "", c["type"], f["field"], f["value"], "" if f["confidence"] is None else f["confidence"], f["flag"], ""])
                    rows += 1
            for pr in parsed["people"]:
                wp.writerow([p.name, pr["person"], "+".join(map(str, pr["cards"])), "+".join(pr["sides"]), pr["evidence"],
                             yn(pr["pairedByPosition"]), yn(pr["rare"]), pr["photoOutcome"] or "", pr["clarity"] or "", pr["rejectReason"], "", "", ""])
            print(f"\r{i}/{len(photos)}", end="", flush=True)
    print(f"\nWrote {rows} field rows to {args.out}, cards to {cards_path.name}, people to {people_path.name}. "
          f"Fill the check columns, then run: python check.py score --sheet {args.out}")
    return 0


def _read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def _judged(reader_value, check: str, conv=lambda s: s):
    c = (check or "").strip()
    if not c:
        return None
    return reader_value if c.upper() == "Y" else conv(c)


def _yes(s: str):
    s = (s or "").strip().lower()
    return True if s in ("yes", "y", "true", "1") else (False if s in ("no", "n", "false", "0") else None)


def sheets_to_labels(field_rows: list[dict], card_rows: list[dict], people_rows: list[dict]) -> list[dict]:
    """Filled CSV sheets as version-2 label records, so the same scoring is used for the sheets and the review form."""
    recs: dict[str, dict] = {}

    def rec(photo):
        return recs.setdefault(photo, {"version": LABEL_VERSION, "photo": photo, "fields": [], "cards": [], "people": []})

    exp_types: dict = {}
    for r in field_rows:
        card = int(r.get("card") or 1) if str(r.get("card") or "1").isdigit() else 1
        if (r.get("expected_type") or "").strip():
            exp_types[(r["photo"], card)] = r["expected_type"].strip()
        rec(r["photo"]).setdefault("_det", {}).setdefault(card, r.get("detected_type", ""))
        c = (r.get("check") or "").strip()
        if not c or not r.get("field"):
            continue
        final = r["extracted"] if c.upper() == "Y" else ("" if c == "-" else c)
        rec(r["photo"])["fields"].append({"card": card, "field": r["field"], "extracted": r.get("extracted", ""), "final": final,
                                          "notOnCard": c == "-"})
    seen_cards = set()
    for r in card_rows:
        card = int(r["card"])
        seen_cards.add((r["photo"], card))
        rec(r["photo"])["cards"].append({
            "card": card, "side": r.get("side") or None, "expectedSide": _judged(r.get("side") or None, r.get("check_side")),
            "detectedType": r.get("detected_type", ""), "expectedType": exp_types.get((r["photo"], card), ""),
            "clarity": r.get("clarity") or None, "expectedClarity": _judged(r.get("clarity") or None, r.get("check_clarity"), str.lower),
            "rejected": _yes(r.get("rejected")), "rejectReason": r.get("rejected_reason", ""),
            "expectedRejected": _judged(_yes(r.get("rejected")), r.get("check_rejected"), _yes)})
    for (photo, card), t in exp_types.items():  # an old sheet without a cards sheet: type scoring still works
        if (photo, card) not in seen_cards:
            rec(photo)["cards"].append({"card": card, "detectedType": rec(photo).get("_det", {}).get(card, ""), "expectedType": t})
    for r in people_rows:
        rec(r["photo"])["people"].append({
            "person": int(r["person"]), "cards": parse_cards(r.get("cards")), "pairedByPosition": _yes(r.get("paired_by_position")) or False,
            "expectedCards": _judged(r.get("cards"), r.get("check_cards")),
            "rare": _yes(r.get("rare")), "expectedRare": _judged(_yes(r.get("rare")), r.get("check_rare"), _yes),
            "photoOutcome": r.get("photo_outcome") or None, "expectedPhotoOutcome": _judged(r.get("photo_outcome") or None, r.get("check_photo"))})
    for r in recs.values():
        r.pop("_det", None)
    return list(recs.values())


def _line(name: str, s: dict) -> str:
    extra = "".join(f"   {k}: {v}" for k, v in s.items() if k not in ("right", "judged", "pct"))
    return f"{name:<28}{pct(s['right'], s['judged']):>8}  ({s['right']}/{s['judged']}){extra}"


def score(args) -> int:
    rows = _read(Path(args.sheet))
    cards_path, people_path = side_sheets(args.sheet)
    labels = sheets_to_labels(rows, _read(cards_path), _read(people_path))
    st = summarise(labels)
    judged_any = st["rows"] or any(st[k]["judged"] for k in ("type", "side", "clarity", "rejected", "pairing", "rare", "photo"))
    if not judged_any:
        print("No rows have a check value yet.")
        return 1
    print(f"Photos in sheets: {st['photos']}   field rows judged: {st['rows']}   cards: {st['cards']}   people: {st['people']}")
    print(_line("Document type right", st["type"]))
    if st["rows"]:
        print(f"\n{'field':<18}{'rows':>6}{'right':>8}{'OCR wrong':>11}{'mapping wrong':>15}{'missing':>9}{'invented':>10}")
        for f, s in st["perField"].items():
            print(f"{f:<18}{s['rows']:>6}{pct(s.get('right', 0), s['rows']):>8}{s.get('ocr_wrong', 0):>11}{s.get('mapping_wrong', 0):>15}"
                  f"{s.get('missing', 0):>9}{s.get('invented', 0):>10}")
        print(f"\nFields fully right:       {st['right']}%")
        print(f"OCR errors (wrong chars): {st['ocr']}%   average character accuracy on read values: "
              f"{'n/a' if st['charAcc'] is None else str(st['charAcc']) + '%'}")
        print(f"Mapping errors (right text, wrong field): {st['mapping']}%")
        print(f"Missed by reader: {st['missing']}%   Invented by reader: {st['invented']}%")
    print()
    print(_line("Card side right", st["side"]))
    print(_line("Pairing right (per person)", st["pairing"]))
    print(_line("  paired by position", st["position"]))
    print(_line("Photo rejection right", st["rejected"]))
    print(_line("Clarity grade right", st["clarity"]))
    print(_line("Photo outcome right", st["photo"]))
    print(_line("Rare right", st["rare"]))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make")
    m.add_argument("--photos", required=True)
    m.add_argument("--out", default="sheet.csv")
    m.add_argument("--limit", type=int, default=0)
    s = sub.add_parser("score")
    s.add_argument("--sheet", required=True)
    args = ap.parse_args()
    return make(args) if args.cmd == "make" else score(args)


if __name__ == "__main__":
    sys.exit(main())
