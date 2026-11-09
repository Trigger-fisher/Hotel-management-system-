"""Dataset builder on INVENTED cards: no guest in two splits, fixed seed, stratified, privacy, label alignment."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import pytest

import build_dataset as bd
from common import TRAINING_DIR


def records_from_truth(truth):
    out = []
    for t in truth:
        fields = dict(t["fields"])
        out.append({"photo": t["photo"], "docType": t["docType"], "keys": bd.guest_keys(fields), "dhash": None, "guest": t["guest"]})
    return out


def test_split_never_puts_a_guest_in_two_splits(invented):
    recs = records_from_truth(invented["truth"])
    splits = bd.assign_splits(recs, seed=1947)
    by_guest = defaultdict(set)
    for r in recs:
        if r["photo"] in splits:
            by_guest[r["guest"]].add(splits[r["photo"]])
    assert by_guest and all(len(s) == 1 for s in by_guest.values())
    assert bd.leak_check(recs, splits) == []


def test_split_is_fixed_by_seed_and_changes_with_another_seed():
    recs = [{"photo": f"p{i}", "docType": ["aadhaar", "pan"][i % 2], "keys": [f"id:{1000000 + i}"], "dhash": None} for i in range(200)]
    a, b, c = bd.assign_splits(recs, 1947), bd.assign_splits(recs, 1947), bd.assign_splits(recs, 7)
    assert a == b and a != c


def test_split_is_stratified_by_document_type():
    recs = [{"photo": f"{t}{i}", "docType": t, "keys": [f"id:{t}{i:06d}"], "dhash": None}
            for t, n in (("aadhaar", 300), ("pan", 100), ("passport", 40)) for i in range(n)]
    splits = bd.assign_splits(recs, 1947, (0.8, 0.1, 0.1))
    for t, n in (("aadhaar", 300), ("pan", 100), ("passport", 40)):
        got = [splits[r["photo"]] for r in recs if r["docType"] == t]
        assert got.count("test") == round(n * 0.1) and got.count("val") == round(n * 0.1)


def test_shared_number_or_name_joins_photos():
    recs = [{"photo": "a", "docType": "aadhaar", "keys": ["id:234567890123", "n:kiran shah"], "dhash": None},
            {"photo": "b", "docType": "aadhaar", "keys": ["id:234567890123"], "dhash": None},  # back side: number only
            {"photo": "c", "docType": "voter-id", "keys": ["id:abc1234567", "n:kiran shah"], "dhash": None},  # no dob
            {"photo": "d", "docType": "pan", "keys": [], "dhash": "ff00"},  # same picture as e
            {"photo": "e", "docType": "pan", "keys": ["id:abcpe1234f"], "dhash": "ff00"}]
    recs += [{"photo": f"x{i}", "docType": "aadhaar", "keys": [f"id:{i}"], "dhash": None} for i in range(40)]
    for seed in range(20):
        s = bd.assign_splits(recs, seed)
        assert s["a"] == s["b"] == s["c"] and s["d"] == s["e"]


def test_unkeyed_photos_are_dropped_or_train_only():
    recs = [{"photo": f"u{i}", "docType": "pan", "keys": [], "dhash": None} for i in range(10)]
    assert bd.assign_splits(recs, 1, unkeyed="drop") == {}
    assert set(bd.assign_splits(recs, 1, unkeyed="train").values()) == {"train"}


def test_label_alignment_uses_printed_layout_not_ocr_spacing():
    fields = {"name": "Vikram Desai", "dob": "1958-11-13", "documentNumber": "381590830164"}
    assert bd.best_field("VikramDesai", fields)[1] == "Vikram Desai"
    assert bd.best_field("DOB:13/11/1958", fields)[1] == "DOB: 13/11/1958"
    assert bd.best_field("38159O830164", fields)[1] == "3815 9083 0164"  # OCR slip O/0, true digits kept
    assert bd.best_field("Surname: DESAI", fields) is None  # part of the name is not the name field
    assert bd.best_field("Government of India", fields) is None
    assert bd.best_field("PassportNo:W1228106", {"documentNumber": "W1228106"})[1] == "Passport No: W1228106"


def test_refuses_output_inside_the_repository(invented):
    with pytest.raises(SystemExit, match="refused"):
        bd.build(invented["photos"], TRAINING_DIR / "dataset-x", labels=invented["labels"], ocr=lambda img: [])
    assert not (TRAINING_DIR / "dataset-x").exists()


def test_end_to_end_build_with_invented_cards(invented, truth_ocr, tmp_path):
    out = tmp_path / "ds"
    ocr = truth_ocr(invented["truth"])
    s = bd.build(invented["photos"], out, labels=invented["labels"], ocr=ocr, quiet=True)
    assert s["leaks"] == 0 and s["cards_train"] > 0 and s["cards_test"] > 0
    for split in ("train", "val", "test"):
        for line in (out / f"rec_gt_{split}.txt").read_text(encoding="utf-8").splitlines():
            rel, text = line.split("\t")
            assert (out / rel).exists() and text
    # privacy: no name, number, date of birth or file name in the manifest or the summary
    manifest = (out / "manifest.jsonl").read_text(encoding="utf-8") + (out / "summary.json").read_text(encoding="utf-8")
    for t in invented["truth"]:
        for v in list(t["fields"].values()) + [t["photo"], t["guest"]]:
            assert str(v) not in manifest
    # no guest in two splits (checked with the invented ground truth, which the builder never saw)
    card_split = {json.loads(x)["card"]: json.loads(x)["split"] for x in (out / "manifest.jsonl").read_text().splitlines()}
    from common import hkey, load_or_create_salt
    salt = load_or_create_salt(out)
    by_guest = defaultdict(set)
    for t in invented["truth"]:
        card = hkey(salt, "photo", t["photo"])[:16]
        if card in card_split:
            by_guest[t["guest"]].add(card_split[card])
    assert all(len(v) == 1 for v in by_guest.values())


def test_refuses_a_non_empty_output_folder(invented, truth_ocr, tmp_path):
    out = tmp_path / "busy"
    out.mkdir()
    (out / "x.txt").write_text("x")
    with pytest.raises(SystemExit, match="not empty"):
        bd.build(invented["photos"], out, labels=invented["labels"], ocr=truth_ocr(invented["truth"]), quiet=True)


def test_real_rapidocr_and_tesseract_on_a_few_invented_cards(invented, tmp_path):
    """The real engines: RapidOCR detects and reads; local-script names are matched with Tesseract when its data is present."""
    photos = tmp_path / "few"
    photos.mkdir()
    keep = [t for t in invented["truth"] if t["docType"] in ("aadhaar", "pan", "voter-id")][:5]
    for t in keep:
        (photos / t["photo"]).write_bytes((invented["photos"] / t["photo"]).read_bytes())
    s = bd.build(photos, tmp_path / "ds", labels=invented["labels"], quiet=True)
    total = sum(v for k, v in s.items() if k.startswith("lines_") and k.count("_") == 1)
    assert total >= 8  # most name / number / date lines were found and labelled
