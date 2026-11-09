"""Evaluation maths and the keep rule, on hand-made numbers and invented line images."""
from __future__ import annotations

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

import evaluate as ev


def row(pred, truth, dtype="aadhaar", script="latin", field=None):
    return {"pred": pred, "truth": truth, "docType": dtype, "script": script, "field": field}


def test_character_word_line_and_field_accuracy():
    m = ev.score([row("Kiran Shah", "Kiran Shah", field="name"),       # perfect
                  row("Kiran Shan", "Kiran Shah", field="name"),       # 1 char, 1 word wrong
                  row("DOB:01/02/1990", "DOB: 01/02/1990", field="dob")])  # a lost space: chars 1 wrong, field still right
    o = m["overall"]
    assert o["lines"] == 3
    assert o["charAcc"] == pytest.approx(1 - 2 / (10 + 10 + 15), abs=1e-4)
    # words: 0 + 1 + (["DOB:01/02/1990"] vs ["DOB:", "01/02/1990"] = 2 edits) over 2 + 2 + 2 true words
    assert o["wordAcc"] == pytest.approx(1 - 3 / 6, abs=1e-4)
    assert o["lineExact"] == pytest.approx(1 / 3, abs=1e-4)
    assert o["fieldAcc"] == pytest.approx(2 / 3, abs=1e-4)
    assert m["field"]["aadhaar/name"]["fieldAcc"] == 0.5


def test_per_type_and_per_script_groups():
    m = ev.score([row("ABCPE1234F", "ABCPE1234F", "pan"), row("x", "y", "voter-id", "gujarati")])
    assert m["docType"]["pan"]["charAcc"] == 1.0 and m["docType"]["voter-id"]["charAcc"] == 0.0
    assert set(m["script"]) == {"latin", "gujarati"}


def metrics(overall, types):
    return {"overall": {"charAcc": overall}, "docType": {t: {"lines": n, "charAcc": c, "fieldAcc": f} for t, (n, c, f) in types.items()}}


def test_keep_rule():
    base = metrics(0.90, {"aadhaar": (100, 0.90, 0.80), "pan": (100, 0.90, 0.80), "rare": (5, 0.9, 0.9)})
    better = metrics(0.93, {"aadhaar": (100, 0.95, 0.85), "pan": (100, 0.90, 0.80), "rare": (5, 0.5, 0.1)})
    assert ev.decide(base, better)["keep"]  # "rare" has under 20 lines, so it does not block
    one_type_worse = metrics(0.95, {"aadhaar": (100, 0.99, 0.95), "pan": (100, 0.89, 0.80), "rare": (5, 0.9, 0.9)})
    d = ev.decide(base, one_type_worse)
    assert not d["keep"] and any("pan" in r for r in d["reasons"])
    field_worse = metrics(0.95, {"aadhaar": (100, 0.99, 0.79), "pan": (100, 0.95, 0.80), "rare": (5, 0.9, 0.9)})
    assert not ev.decide(base, field_worse)["keep"]
    equal = metrics(0.90, {"aadhaar": (100, 0.90, 0.80), "pan": (100, 0.90, 0.80), "rare": (5, 0.9, 0.9)})
    assert not ev.decide(base, equal)["keep"]  # must be strictly better overall
    assert "no document type gets worse" in d["rule"]


def test_ctc_greedy_decoding_collapses_repeats_and_blanks():
    rec = ev.CtcRecognizer(ev.bundled_rec_model(), threads=1)
    a, b = rec.chars.index("A"), rec.chars.index("B")
    seq = [a, a, 0, a, b, b, 0, 0]
    prob = np.zeros((1, len(seq), len(rec.chars)), dtype=np.float32)
    for t, c in enumerate(seq):
        prob[0, t, c] = 1
    rec.sess = type("S", (), {"run": lambda self, o, i: [prob], "get_inputs": lambda self: [type("I", (), {"name": "x"})()]})()
    assert rec([np.zeros((48, 100, 3), np.uint8)]) == ["AAB"]


def test_base_model_reads_an_invented_line():
    img = Image.new("RGB", (520, 64), "white")
    ImageDraw.Draw(img).text((10, 6), "ABCPE1234F 2026", font=ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 44), fill="black")
    rec = ev.CtcRecognizer(ev.bundled_rec_model(), threads=2)
    assert rec([np.asarray(img)[:, :, ::-1].copy()])[0].replace(" ", "") == "ABCPE1234F2026"


def test_report_contains_numbers_and_the_rule(tmp_path):
    base = ev.score([row("a b", "a b", field="name")])
    cand = ev.score([row("a b", "a b", field="name")])
    ev.write_report(tmp_path, base, cand, ev.decide(base, cand, 1), {"split": "test", "script": None, "base": "b", "candidate": "c"})
    md = (tmp_path / "report.md").read_text(encoding="utf-8")
    assert "REJECT" in md and "Rule:" in md and (tmp_path / "report.json").exists()
