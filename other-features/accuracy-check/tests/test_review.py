"""review.py against the fake reader: item view, crops, save, labels.jsonl version 2, Excel sheets. Invented data only."""
from __future__ import annotations

import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest
from openpyxl import load_workbook

import review
from conftest import single_old


@pytest.fixture()
def form(reader, photos, tmp_path):
    review.S.update(photos=sorted(photos.glob("*.png")), labels={}, cache={}, crops={}, deferred=set(),
                    labels_path=tmp_path / "labels.jsonl", xlsx=tmp_path / "results.xlsx", images_out=tmp_path / "out")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), review.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    yield base
    srv.shutdown()


def get(url):
    with urllib.request.urlopen(url) as r:
        return r.status, r.read()


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def corrected(item: dict) -> dict:
    """What the page sends after MJ's marks: card 2 clarity should be clear, card 3 should not be refused, person 2 is card 3 only,
    a dob read wrong, an invented field."""
    cards, fields = [], []
    for c in item["cards"]:
        c = dict(c)
        for f in c.pop("fields"):
            fields.append({**f, "card": c["card"]})
        c.pop("hasCrop")
        cards.append(c)
    cards[1]["expectedClarity"] = "clear"
    cards[2]["expectedRejected"] = False
    people = [dict(p) for p in item["people"]]
    people[1]["expectedCards"] = "3"
    for f in fields:
        if f["card"] == 1 and f["field"] == "dob":
            f["final"] = "01/02/1991"
        if f["card"] == 4 and f["field"] == "address":
            f["notOnCard"] = True
    return {"photo": item["photo"], "multi": item["multi"], "cards": cards, "people": people, "fields": fields}


def test_page_and_item_view(form, reader):
    status, html = get(form + "/")
    assert status == 200 and b"Pairing right" in html and b"should be refused" in html
    item = json.loads(get(form + "/api/item?i=0")[1])
    assert reader.requests[-1]["form"]["multi"] == "true" and reader.requests[-1]["form"]["returnCrops"] == "true"
    assert item["multi"] and len(item["cards"]) == 4 and len(item["people"]) == 2
    c3 = item["cards"][2]
    assert c3["clarity"] == "unclear" and c3["rejected"] is True and c3["expectedRejected"] is True and c3["hasCrop"]
    assert "crop" not in json.dumps(item["cards"][0]).replace("hasCrop", "")  # crops are served separately, from memory
    status, png = get(form + "/crop?i=0&c=3")
    assert status == 200 and png.startswith(b"\x89PNG")
    p2 = item["people"][1]
    assert p2["pairedByPosition"] and p2["expectedCards"] == "3+4" and p2["expectedRare"] is True


def test_save_writes_v2_label_and_four_sheets(form, tmp_path):
    item = json.loads(get(form + "/api/item?i=0")[1])
    stats = post(form + "/api/save", corrected(item))
    assert stats["excelSaved"] and stats["pairing"] == 50.0 and stats["clarity"] == 75.0 and stats["rejection"] == 75.0
    rec = json.loads((tmp_path / "labels.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert rec["version"] == 2 and rec["expectedType"] == "aadhaar" and len(rec["cards"]) == 4 and len(rec["people"]) == 2
    assert all("card" in f for f in rec["fields"]) and "crop" not in json.dumps(rec)
    wb = load_workbook(tmp_path / "results.xlsx")
    assert wb.sheetnames == ["Fields", "Cards", "People", "Summary"]
    assert wb["Cards"].max_row == 5 and wb["People"].max_row == 3
    people = [[c.value for c in r] for r in wb["People"].iter_rows(min_row=2)]
    assert people[1][2:5] == ["3+4", "3", "wrong"] and people[1][7] == "yes"
    summary = {r[0].value: r[1].value for r in wb["Summary"].iter_rows() if r[0].value}
    assert summary["Pairing right % (per person)"] == 50.0 and summary["Clarity grade right % (per card)"] == 75.0
    assert summary["Photo rejection right % (per card)"] == 75.0 and summary["Paired by position right %"] == 0.0
    assert summary["OCR errors %"] > 0 and summary["Invented %"] > 0
    assert (tmp_path / "report.html").exists()
    exported = list((tmp_path / "out").iterdir())
    assert [p.name for p in exported] == ["Asha_Verma_Aadhaar.png"]
    again = json.loads(get(form + "/api/item?i=0")[1])  # a saved photo comes back with MJ's marks
    assert again["labelled"] and again["cards"][1]["expectedClarity"] == "clear" and again["people"][1]["expectedCards"] == "3"


def test_old_reader_single_answer(form, reader, tmp_path):
    reader.answer = single_old
    item = json.loads(get(form + "/api/item?i=1")[1])
    assert not item["multi"] and len(item["cards"]) == 1 and item["cards"][0]["clarity"] is None
    stats = post(form + "/api/save", corrected_single(item))
    assert stats["clarity"] is None and stats["rejection"] is None and stats["pairing"] == 100.0 and stats["right"] == 100.0


def corrected_single(item):
    c = dict(item["cards"][0])
    fields = [{**f, "card": 1} for f in c.pop("fields")]
    c.pop("hasCrop")
    return {"photo": item["photo"], "multi": False, "cards": [c], "people": item["people"], "fields": fields}


def test_version_1_labels_still_load(form, tmp_path):
    old = {"photo": "a.png", "expectedType": "pan", "detectedType": "pan",
           "fields": [{"field": "name", "extracted": "Meena Shah", "final": "Meena Shah", "notOnCard": False, "confidence": 0.9, "flag": "", "extra": False}]}
    (tmp_path / "labels.jsonl").write_text(json.dumps(old) + "\n", encoding="utf-8")
    review.load_labels()
    item = json.loads(get(form + "/api/item?i=0")[1])
    assert item["labelled"] and item["cards"][0]["expectedType"] == "pan" and item["cards"][0]["fields"][0]["final"] == "Meena Shah"
    assert item["stats"]["right"] == 100.0


def test_reader_down_shows_error_without_detail(form, monkeypatch):
    monkeypatch.setenv("READER_URL", "http://127.0.0.1:9")
    review.S["cache"].clear()
    item = json.loads(get(form + "/api/item?i=0")[1])
    assert item["error"].startswith("Reader call failed") and item["cards"] == []
    assert Path(review.S["photos"][0]).name not in item["error"]
