"""Pseudo-label rules on INVENTED values: a line is free only when an independent check agrees."""
from __future__ import annotations

import json

import pseudo_label as pl
from common import mrz_check_digit, secure_qr_payload, verhoeff_append

AADHAAR = verhoeff_append("23456789012")
SPACED = f"{AADHAAR[:4]} {AADHAAR[4:8]} {AADHAAR[8:]}"


def line(text, y, conf=0.95):
    return {"quad": [[10, y], [500, y], [500, y + 30], [10, y + 30]], "text": text, "conf": conf}


def td3(number="L898902C3", dob="740812"):
    l1 = "P<UTOERIKSSON<<ANNA<MARIA".ljust(44, "<")
    n = number.ljust(9, "<")
    exp, p = "320415", "<" * 14
    body = n + mrz_check_digit(n) + "UTO" + dob + mrz_check_digit(dob) + "F" + exp + mrz_check_digit(exp) + p + mrz_check_digit(p)
    return l1, body + mrz_check_digit(body[0:10] + body[13:20] + body[21:43])


def rules(verdict):
    return sorted(a["rule"] for a in verdict["accepted"].values())


def test_valid_aadhaar_is_free_and_a_misread_digit_is_not():
    ok = pl.judge([line(SPACED, 100), line("Government of India", 10)], [])
    assert rules(ok) == ["verhoeff"] and ok["fields"]["documentNumber"] == AADHAAR
    assert ok["reasons"] == {"unverifiedLines": 1}
    bad = SPACED[:-1] + str((int(SPACED[-1]) + 1) % 10)
    v = pl.judge([line(bad, 100)], [])
    assert not v["accepted"] and v["reasons"]["aadhaarCheckFailed"] == 1


def test_label_before_the_number_is_allowed():
    v = pl.judge([line(f"Aadhaar No: {SPACED}", 100)], [])
    assert rules(v) == ["verhoeff"]


def test_pan_needs_pattern_holder_letter_and_confidence():
    assert rules(pl.judge([line("ABCPE1234F", 50)], [])) == ["pan-pattern"]
    assert not pl.judge([line("ABCPE1234F", 50, conf=0.6)], [])["accepted"]  # read unsure
    v = pl.judge([line("ABCXE1234F", 50)], [])  # X is not a holder type
    assert not v["accepted"] and v["reasons"]["panUnsure"] == 1


def test_mrz_lines_with_check_digits_are_free_but_name_line_is_not():
    l1, l2 = td3()
    v = pl.judge([line(l1, 500), line(l2, 560)], [])
    assert rules(v) == ["mrz-check-digits"]
    accepted_text = [a["text"] for a in v["accepted"].values()]
    assert accepted_text == [l2]  # line 1 (names) has no check digit
    broken = l2[:14] + ("1" if l2[14] != "1" else "2") + l2[15:]  # one birth-date digit misread
    assert not pl.judge([line(l1, 500), line(broken, 560)], [])["accepted"]


def test_mrz_nationality_is_not_under_a_check_digit_so_it_must_match_the_issuer():
    """Found on invented passports: OCR read UTO as UT0 and all check digits still passed."""
    l1, l2 = td3()
    slipped = l2[:12] + "0" + l2[13:]
    assert not pl.judge([line(l1, 500), line(slipped, 560)], [])["accepted"]
    sex_slip = l2[:20] + "E" + l2[21:]
    assert not pl.judge([line(l1, 500), line(sex_slip, 560)], [])["accepted"]


def test_qr_name_and_dob_confirm_the_printed_lines():
    qr = secure_qr_payload("Kiran Shah", "05-06-1991", AADHAAR[-4:])
    v = pl.judge([line("KIRAN SHAH", 100), line("DOB: 05/06/1991", 150), line(SPACED, 300)], [qr])
    assert rules(v) == ["qr-dob", "qr-name", "verhoeff"]
    assert v["fields"] == {"name": "KIRAN SHAH", "dob": "1991-06-05", "documentNumber": AADHAAR}
    assert v["reasons"] == {}


def test_qr_mismatch_goes_to_review():
    qr = secure_qr_payload("Kiran Shah", "05-06-1991", AADHAAR[-4:])
    v = pl.judge([line("Kiran Shan", 100), line("DOB: 05/06/1990", 150)], [qr])
    assert not v["accepted"]
    assert v["reasons"]["qrNameNotMatched"] == 1 and v["reasons"]["unverifiedLines"] == 2


def test_a_name_starting_like_a_label_is_not_split():
    assert pl.split_label("PANKAJ MEHTA") == ("", "PANKAJ MEHTA")
    assert pl.split_label("Name: Pankaj") == ("Name: ", "Pankaj")


def test_run_writes_free_labels_and_review_list(invented, truth_ocr, tmp_path):
    out = tmp_path / "pl"
    s = pl.run(invented["photos"], out, ocr=truth_ocr(invented["truth"], slips=False), quiet=True)
    assert s["photos"] == len(invented["truth"])
    assert s["linesAccepted"] > 0 and s["photosNeedReview"] > 0
    recs = [json.loads(x) for x in (out / "pseudo_labels.jsonl").read_text(encoding="utf-8").splitlines()]
    truth = {t["photo"]: t for t in invented["truth"]}
    for r in recs:  # every free label is exactly what was drawn on the invented card
        drawn = {ln["text"].replace(" ", "") for ln in truth[r["photo"]]["lines"]}
        for ln in r["lines"]:
            assert ln["text"].replace(" ", "") in drawn
    again = pl.run(invented["photos"], out, ocr=truth_ocr(invented["truth"], slips=False), quiet=True)
    assert again.get("photos", 0) == 0 and again["alreadyDone"] == len(invented["truth"])  # resumable


def test_no_wrong_free_label_when_ocr_slips(invented, truth_ocr, tmp_path):
    """OCR slips (dropped spaces, O/0 swaps) must never become a free label."""
    out = tmp_path / "pls"
    for seed in range(3):
        pl.run(invented["photos"], out / str(seed), ocr=truth_ocr(invented["truth"], slips=True, seed=seed), quiet=True)
        truth = {t["photo"]: {ln["text"].replace(" ", "") for ln in t["lines"]} for t in invented["truth"]}
        path = out / str(seed) / "pseudo_labels.jsonl"
        for x in path.read_text(encoding="utf-8").splitlines():
            r = json.loads(x)
            for ln in r["lines"]:
                assert ln["text"].replace(" ", "") in truth[r["photo"]], ln["rule"]


def test_pseudo_labels_feed_the_dataset_builder(invented, truth_ocr, tmp_path):
    import build_dataset as bd
    pl.run(invented["photos"], tmp_path / "pl", ocr=truth_ocr(invented["truth"], slips=False), quiet=True)
    s = bd.build(invented["photos"], tmp_path / "ds", pseudo=tmp_path / "pl" / "pseudo_labels.jsonl", quiet=True)
    assert s.get("src_pseudo", 0) > 0 and s["leaks"] == 0
