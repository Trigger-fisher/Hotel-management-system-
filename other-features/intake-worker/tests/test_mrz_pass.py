"""The dedicated MRZ pass (app/readcore/mrzpass.py) and the choice among readings (mrz.choose), 5 Nov 2026. Invented passports only."""
from __future__ import annotations

import cv2
import numpy as np

from app.readcore import mrz, mrzpass
from app.readcore.doctypes.mrz_documents import mrz_fields
from scripts.measure_mrz import DAMAGES, holders, page
from tests.conftest import make_pipeline
from tests.idkinds import td3

LINES = td3("SWE", "NOVAKORI", "TAVEMO LUNE", "XK2819482", "SWE", "890416", "M", "350725")


def _swap(line: str, at: int, ch: str) -> str:
    return line[:at] + ch + line[at + 1:]


def test_choose_takes_only_a_reading_whose_check_digits_all_pass():
    misread = [LINES[0], _swap(LINES[1], 14, "8" if LINES[1][14] != "8" else "3")]  # a digit of the birth date misread
    assert mrz.parse_mrz(misread)["valid"] is False
    found = mrz.choose([misread, LINES])
    assert found["valid"] and found["lines"] == LINES and found["namesAgree"]
    alone = mrz.choose([misread])  # nothing passes: kept as read, doubtful, never corrected
    assert alone["valid"] is False and alone["lines"] == misread
    assert mrz.choose([["no mrz here"]]) is None


def test_lines_of_two_readings_are_tried_together():
    names_bad = ["P<SWENOVAK0RI<<TAVEMO<LUNE", LINES[1][:20] + "?" + LINES[1][21:]]  # line 1 short and odd, line 2 broken
    data_ok = ["P<SWE", LINES[1]]  # line 2 right, line 1 cut off
    found = mrz.choose([names_bad, data_ok, [LINES[0]]])
    assert found["valid"] and found["lines"][1] == LINES[1] and found["lines"][0] == LINES[0]


def test_readings_that_pass_but_disagree_are_not_trusted():
    other = td3("SWE", "NOVAKORI", "TAVEMO LUNE", "XK2819483", "SWE", "890416", "M", "350725")  # another number, its own check digits
    found = mrz.choose([LINES, other])
    assert found["valid"] is False and found["readingsDisagree"]


def test_names_spelled_differently_by_passing_readings_are_doubtful():
    other = [LINES[0].replace("TAVEMO", "TAVENO"), LINES[1]]
    found = mrz.choose([LINES, other])
    assert found["valid"] and found["namesAgree"] is False
    name = mrz_fields(found)["name"]
    assert name["doubtful"] and name["confidence"] <= 0.6
    agree = mrz.choose([LINES, list(LINES)])
    assert agree["namesAgree"] and not mrz_fields(agree)["name"].get("doubtful")


def test_a_names_line_read_short_does_not_outvote_a_whole_one():
    short = ["P<SWENOVAKORI<<TAVEM<LUNE".ljust(34, "<"), LINES[1]]  # fillers and a letter lost: padded when parsed
    assert mrz.parse_mrz(short)["padded"]
    found = mrz.choose([short, LINES])
    assert found["lines"] == LINES and not found.get("padded") and found["namesAgree"]


def test_the_band_is_found_by_shape_and_split_into_its_two_rows():
    h = holders(1)[0]
    rgb, truth = page(h)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    band = mrzpass.band_from_shape(bgr)
    assert band is not None and band[1] > 0.7 * bgr.shape[0]
    img = mrzpass.prepare(bgr, band)
    assert len(mrzpass.rows_of(img)) == 2
    seen = []
    got = list(mrzpass.readings(img, lambda row: seen.append(row.shape) or "X"))
    assert [name for name, _ in got] == list(mrzpass.ORDER) and all(len(texts) == 2 for _, texts in got)
    assert mrzpass.band_from_shape(np.full((600, 950, 3), 245, np.uint8)) is None  # a blank card has no MRZ
    assert mrzpass.mrz_like(truth[1]) and not mrzpass.mrz_like("Government of India")


def test_a_blurred_passport_page_reads_its_mrz_fully_with_the_pass(storage, engines):
    """On invented pages blurred 1.8 px the first read alone found no MRZ that passed (scripts/measure_mrz.py: 0 of 10)."""
    pipe = make_pipeline(storage, engines)
    for h in holders(2):
        rgb, truth = page(h)
        result, doc = pipe.read_card(DAMAGES["blur 1.8"](rgb, 0), {}, upright=True)
        assert result["mrz"]["valid"] and result["mrz"]["lines"] == truth
        assert doc["fields"]["documentNumber"]["value"] == h["number"] and doc["fields"]["documentNumber"]["valid"]
