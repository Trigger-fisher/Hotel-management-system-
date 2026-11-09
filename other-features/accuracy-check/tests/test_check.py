"""check.py: reader call, multi / old answers, CSV sheets and scoring. Invented data only."""
from __future__ import annotations

import csv
from argparse import Namespace
from pathlib import Path

import check
from conftest import KEY, multi_new, multi_old, single_old


def test_call_asks_for_multi_and_crops(reader, photos):
    check.call_reader(photos / "a.png", reader.url, KEY, crops=True)
    form = reader.requests[-1]["form"]
    assert reader.requests[-1]["path"] == "/v1/read" and reader.requests[-1]["key"] == KEY
    assert form["multi"] == "true" and form["returnCrops"] == "true" and form["kind"] == "id"
    check.call_reader(photos / "a.png", reader.url, KEY)
    assert reader.requests[-1]["form"]["returnCrops"] == "false"


def test_parse_multi_with_new_fields():
    p = check.parse_response(multi_new())
    assert p["multi"] and [c["card"] for c in p["cards"]] == [1, 2, 3, 4]
    c1, c2, c3, c4 = p["cards"]
    assert (c1["clarity"], c1["rejected"], c1["photo"]) == ("clear", False, "found")
    assert c2["clarityReasons"] == ["glare"]
    assert c3["rejected"] is True and c3["rejectReason"] == "photoBlurred" and c3["photo"] == "unclear"
    assert c4["rejected"] is False and c3["crop"]
    p1, p2 = p["people"]
    assert p1["cards"] == [1, 2] and p1["evidence"] == "aadhaarNumber" and not p1["pairedByPosition"] and p1["rare"] is False
    assert p2["pairedByPosition"] and p2["rare"] is True and p2["photoOutcome"] == "unclear" and p2["rejectReason"] == "photo_unclear"
    assert "doubtful" in next(f for f in c1["fields"] if f["field"] == "dob")["flag"]  # the person's doubtful field marks the card row


def test_parse_multi_without_new_fields_reports_none():
    p = check.parse_response(multi_old())
    assert all(c["clarity"] is None and c["rejected"] is None and c["photo"] is None and not c["crop"] for c in p["cards"])
    p1, p2 = p["people"]
    assert p1["rare"] is None and p1["photoOutcome"] is None
    assert p2["pairedByPosition"] and p2["evidence"] == "layout"  # the reader's own word for a layout-only pair


def test_parse_single_old_answer():
    p = check.parse_response(single_old())
    assert not p["multi"] and len(p["cards"]) == 1 and p["people"][0]["cards"] == [1]
    c = p["cards"][0]
    assert c["type"] == "pan" and c["side"] == "single" and c["clarity"] is None and c["rejected"] is None
    assert "doubtful" in next(f for f in c["fields"] if f["field"] == "dob")["flag"]


def test_upgrade_keeps_version_1_records():
    old = {"photo": "x.png", "expectedType": "pan", "detectedType": "pan",
           "fields": [{"field": "name", "extracted": "Meena Shah", "final": "Meena Shah", "notOnCard": False}]}
    new = check.upgrade(old)
    assert new["version"] == 2 and new["fields"][0]["card"] == 1 and new["cards"][0]["expectedType"] == "pan" and new["people"] == []
    st = check.summarise([new])
    assert st["right"] == 100.0 and st["type"]["pct"] == 100.0 and st["clarity"]["judged"] == 0 and st["pairing"]["judged"] == 0


def test_summarise_pairing_rejection_clarity():
    rec = {"version": 2, "photo": "s.png", "fields": [
        {"card": 1, "field": "name", "extracted": "Asha Verma", "final": "Asha Verma", "notOnCard": False},
        {"card": 1, "field": "dob", "extracted": "01/02/1990", "final": "01/02/1991", "notOnCard": False},
        {"card": 2, "field": "name", "extracted": "01/02/1990", "final": "Ravi Kumar", "notOnCard": False},  # other card's text: OCR, not mapping
    ], "cards": [
        {"card": 1, "side": "front", "expectedSide": "front", "clarity": "clear", "expectedClarity": "clear", "rejected": False, "expectedRejected": False},
        {"card": 2, "side": "back", "expectedSide": "front", "clarity": "unclear", "expectedClarity": "usable", "rejected": True, "expectedRejected": False},
        {"card": 3, "side": "front", "expectedSide": "front", "clarity": "clear", "expectedClarity": "unclear", "rejected": False, "expectedRejected": True},
        {"card": 4, "side": "back", "expectedSide": "back", "clarity": None, "expectedClarity": None, "rejected": None, "expectedRejected": True},
    ], "people": [
        {"person": 1, "cards": [1, 2], "expectedCards": "1+2", "rare": False, "expectedRare": False, "photoOutcome": "match", "expectedPhotoOutcome": "match"},
        {"person": 2, "cards": [3, 4], "pairedByPosition": True, "expectedCards": "3", "rare": None, "expectedRare": True,
         "photoOutcome": None, "expectedPhotoOutcome": "unclear"},
    ]}
    st = check.summarise([rec])
    assert st["ocr"] == round(100 * 2 / 3, 1) and st["mapping"] == 0.0
    assert (st["side"]["right"], st["side"]["judged"]) == (3, 4)
    assert (st["clarity"]["right"], st["clarity"]["judged"], st["clarity"]["tooStrict"], st["clarity"]["tooLenient"]) == (1, 3, 1, 1)
    assert st["rejected"]["judged"] == 4 and st["rejected"]["right"] == 1
    assert st["rejected"]["wrongReject"] == 1 and st["rejected"]["missedReject"] == 2  # card 4: reader silent, MJ says refuse
    assert (st["pairing"]["right"], st["pairing"]["judged"]) == (1, 2)
    assert (st["position"]["right"], st["position"]["judged"]) == (0, 1)
    assert (st["rare"]["right"], st["rare"]["judged"]) == (1, 2)  # an unreported rare person MJ marks counts as missed
    assert (st["photo"]["right"], st["photo"]["judged"]) == (1, 1)  # unreported photo outcome stays out


def _fill(path: Path, col: str, values: dict) -> None:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
        names = list(rows[0].keys())
    for r in rows:
        key = (r["photo"], r.get("card") or r.get("person"), r.get("field"))
        r[col] = values.get(key, values.get(key[:2], r[col]))
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, names)
        w.writeheader()
        w.writerows(rows)


def test_make_and_score_sheets(reader, photos, tmp_path, capsys):
    out = tmp_path / "sheet.csv"
    assert check.make(Namespace(photos=str(photos), out=str(out), limit=1)) == 0
    cards, people = check.side_sheets(str(out))
    assert cards.exists() and people.exists()
    text = out.read_text(encoding="utf-8-sig")
    assert "photo,card," in text and text.count("a.png") == 8
    _fill(out, "check", {("a.png", "1", "name"): "Y", ("a.png", "1", "dob"): "01/02/1991", ("a.png", "3", "name"): "Y"})
    _fill(cards, "check_clarity", {("a.png", "1"): "Y", ("a.png", "2"): "clear", ("a.png", "3"): "Y"})
    _fill(cards, "check_rejected", {("a.png", "1"): "Y", ("a.png", "3"): "no"})
    _fill(people, "check_cards", {("a.png", "1"): "Y", ("a.png", "2"): "3"})
    _fill(people, "check_rare", {("a.png", "2"): "Y"})
    capsys.readouterr()
    assert check.score(Namespace(sheet=str(out))) == 0
    printed = " ".join(capsys.readouterr().out.split())
    assert "Pairing right (per person) 50.0% (1/2)" in printed
    assert "Clarity grade right 66.7% (2/3) tooStrict: 1" in printed
    assert "Photo rejection right 50.0% (1/2) wrongReject: 1" in printed
    assert "paired by position 0.0% (0/1)" in printed
    assert "Asha" not in printed and "Ravi" not in printed  # aggregate numbers only on the console


def test_score_old_sheet_without_card_column(tmp_path, capsys):
    out = tmp_path / "old.csv"
    with open(out, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["photo", "expected_type", "detected_type", "field", "extracted", "confidence", "flags", "check"])
        w.writerow(["x.png", "pan", "pan", "name", "Meena Shah", "0.9", "", "Y"])
        w.writerow(["x.png", "", "pan", "dob", "09/09/1999", "0.6", "", "09/09/1998"])
    assert check.score(Namespace(sheet=str(out))) == 0
    printed = " ".join(capsys.readouterr().out.split())
    assert "Document type right 100.0% (1/1)" in printed and "Fields fully right: 50.0%" in printed
