"""The dedicated MRZ pass (app/mrzpass.py) and the choice among readings (mrz.choose), copied from intake-worker on 2026-11-05.
Invented MRZs only."""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

from app import mrz, mrzpass
from app.doctypes.mrz_documents import mrz_fields
from app.jobs import run_job
from tests import cards as C
from tests.conftest import needs_tesseract, real_config
from tests.test_helpers import make_td3

LINES = make_td3()


def test_choose_takes_only_a_reading_whose_check_digits_all_pass():
    misread = [LINES[0], LINES[1][:14] + ("8" if LINES[1][14] != "8" else "3") + LINES[1][15:]]
    assert mrz.parse_mrz(misread)["valid"] is False
    found = mrz.choose([misread, LINES])
    assert found["valid"] and found["lines"] == LINES and found["namesAgree"]
    assert mrz.choose([misread])["valid"] is False and mrz.choose([["no mrz here"]]) is None


def test_lines_of_two_readings_are_tried_together_and_disagreement_is_not_trusted():
    found = mrz.choose([[LINES[0][:10], LINES[1]], [LINES[0]]])
    assert found["valid"] and found["lines"] == LINES
    other = make_td3(number="L898902C4")
    assert mrz.choose([LINES, other])["readingsDisagree"] and mrz.choose([LINES, other])["valid"] is False


def test_names_spelled_differently_by_passing_readings_are_doubtful():
    surname = LINES[0][5:LINES[0].index("<<", 5)]
    other = [LINES[0].replace(surname, surname[:-1] + ("A" if surname[-1] != "A" else "B"), 1), LINES[1]]
    found = mrz.choose([LINES, other])
    assert found["valid"] and found["namesAgree"] is False
    name = mrz_fields(found)["name"]
    assert name["doubtful"] and name["confidence"] <= 0.6


def test_the_band_is_found_by_shape_on_an_invented_passport_card():
    img = cv2.cvtColor(np.asarray(C.mrz_card("TD3", "PASSPORT").convert("RGB")), cv2.COLOR_RGB2BGR)
    band = mrzpass.band_from_shape(img)
    assert band is not None and band[1] > 0.5 * img.shape[0]
    assert len(mrzpass.rows_of(mrzpass.prepare(img, band))) == 2
    assert mrzpass.band_from_shape(np.full((600, 950, 3), 245, np.uint8)) is None


def _passport(lines: list[str]) -> np.ndarray:
    from PIL import ImageDraw
    from tests.imaging import font
    img, d = C.canvas((240, 244, 250))
    d.text((40, 30), "PASSPORT", font=font("segoeui.ttf", 44), fill=0)
    d.text((40, 100), "Surname NOVAKORI   Given names TAVEMO", font=font("segoeui.ttf", 34), fill=0)
    for i, text in enumerate(lines):
        d.text((20, img.size[1] - 184 + i * 62), text, font=font("consola.ttf", 40) or font("cour.ttf", 40), fill=0)
    return np.asarray(img.convert("RGB"))


@needs_tesseract
def test_a_blurred_passport_card_reads_its_mrz_fully():
    lines = make_td3(number="XK2819482", dob="890416", sex="M", expiry="350725", nationality="SWE", surname="NOVAKORI",
                     given="TAVEMO", personal="")
    blurred = cv2.GaussianBlur(_passport(lines), (0, 0), 1.6)
    result = run_job(C.png(Image.fromarray(blurred)), real_config(), [], "fast", False)
    print("\nblurred passport card:", result["mrz"] and (result["mrz"]["valid"], result["mrz"].get("readings")))
    assert result["mrz"]["valid"] and result["mrz"]["lines"] == lines


@needs_tesseract
def test_a_letter_read_as_a_digit_where_no_check_digit_covers_it_stays_doubtful():
    """The specimen's country UTO is read as UT0 on the data line: no check digit covers it, so it is never changed."""
    result = run_job(C.png(C.mrz_card("TD3", "PASSPORT")), real_config(), [], "fast", False)
    assert result["mrz"] is None or result["mrz"]["valid"] is False or result["mrz"]["lines"] == C._line("TD3")
