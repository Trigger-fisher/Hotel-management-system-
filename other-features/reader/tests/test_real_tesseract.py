"""Tests against the REAL Tesseract engine on invented pictures. Skipped when it is not installed.
Run with -s to see the accuracy numbers."""
import difflib
import re

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.jobs import run_job
from tests.conftest import needs_indic, needs_tesseract, real_config
from tests.imaging import (blur, font, have_fonts, low_contrast, noise, png_bytes, random_lines, rotate_free, scene,
                           shrink, text_page, turn)

pytestmark = needs_tesseract


def accuracy(expected: str, got: str) -> float:
    norm = lambda s: re.sub(r"\s+", " ", s).strip().lower()  # noqa: E731
    return difflib.SequenceMatcher(None, norm(expected), norm(got)).ratio()


def read(img: np.ndarray, **kw):
    return run_job(png_bytes(Image.fromarray(img)), real_config(), kw.pop("languages", []),
                   kw.pop("mode", "fast"), kw.pop("find_document", False))


LINES = random_lines(1, count=8)
EXPECTED = "\n".join(LINES)


def page():
    return np.asarray(text_page(LINES, size=(1000, 800)))


def test_clean_english_page_is_read_accurately():
    result = read(page())
    acc = accuracy(EXPECTED, result["text"])
    print(f"\nclean english: accuracy {acc:.3f}, confidence {result['confidence']}, {result['tookMs']} ms")
    assert acc > 0.95 and set(result["engines"]) <= {"rapidocr", "tesseract"} and result["engines"]


@pytest.mark.parametrize("name,make,floor", [
    ("blur sigma 1.2", lambda a: blur(a, 1.2), 0.9),
    ("noise sigma 20", lambda a: noise(a, 20), 0.9),
    ("low contrast 0.3", lambda a: low_contrast(a, 0.3), 0.85),
    ("half size", lambda a: shrink(a, 0.5), 0.85),
])
def test_degraded_pages_are_still_read_or_flagged(name, make, floor):
    result = read(make(page()))
    acc = accuracy(EXPECTED, result["text"])
    print(f"\n{name}: accuracy {acc:.3f}, flags {result['flags']}, needsHumanCheck {result['needsHumanCheck']}")
    assert acc >= floor or result["needsHumanCheck"]  # either right, or honest about doubt


def test_heavy_blur_is_flagged_never_trusted_silently():
    result = read(blur(page(), 5.0))
    assert "blurry" in result["flags"] and result["needsHumanCheck"] is True


@needs_indic
@pytest.mark.parametrize("turns", [0, 1, 2, 3])
def test_pages_rotated_by_quarter_turns_come_out_upright(turns):
    result = read(turn(page(), turns))
    acc = accuracy(EXPECTED, result["text"])
    print(f"\nrotated {turns * 90} deg: accuracy {acc:.3f}, rotationApplied {result['document']['rotationApplied']}")
    assert acc > 0.9
    assert result["document"]["rotationApplied"] == (360 - 90 * turns) % 360


@needs_indic
@pytest.mark.parametrize("angle", [-8.0, 5.0, 11.0])
def test_skewed_page_is_straightened(angle):
    result = read(rotate_free(page(), angle))
    acc = accuracy(EXPECTED, result["text"])
    print(f"\nskew {angle}: accuracy {acc:.3f}, skewApplied {result['document']['skewApplied']}")
    assert acc > 0.9 and abs(result["document"]["skewApplied"] + angle) < 1.5


@needs_indic
@pytest.mark.skipif(not have_fonts("Nirmala.ttc", "segoeui.ttf"), reason="fonts missing")
def test_mixed_english_hindi_gujarati_card_is_read_per_line():
    nir, seg = font("Nirmala.ttc", 44), font("segoeui.ttf", 44)
    img = Image.new("L", (1400, 560), 255)
    d = ImageDraw.Draw(img)
    rows = [("Name: Ramesh Kumar Shah", seg, "Latin"), ("नाम: रमेश कुमार शाह", nir, "Devanagari"),
            ("નામ: રમેશ કુમાર શાહ", nir, "Gujarati"), ("Date of birth 01/02/1990", seg, "Latin")]
    for i, (text, f, _) in enumerate(rows):
        d.text((40, 40 + i * 100), text, font=f, fill=0)
    result = read(np.asarray(img))
    got = {l["text"]: l["script"] for l in result["lines"]}
    hits = sum(1 for text, _, script in rows if got.get(text) == script)
    scripts = {l["script"] for l in result["lines"]}
    print(f"\nmixed card: {hits}/4 lines exact with the right script; scripts {sorted(scripts)}; "
          f"accuracy {accuracy(chr(10).join(r[0] for r in rows), result['text']):.3f}")
    assert {"Latin", "Devanagari", "Gujarati"} <= scripts and hits >= 3


@needs_indic
def test_photo_of_a_page_on_a_table_is_found_flattened_and_read():
    photo, truth = scene(page(), frame=(1100, 1500), scale=0.75, angle=12, tilt=0.12, seed=2)
    result = read_photo(photo)
    acc = accuracy(EXPECTED, result["text"])
    print(f"\nphoto of a tilted page on a table: accuracy {acc:.3f}, document {result['document']['quad'] is not None}, "
          f"skew {result['document']['skewApplied']}, flags {result['flags']}")
    assert result["document"]["quad"] is not None and acc > 0.85


def read_photo(photo):
    import cv2
    ok, buf = cv2.imencode(".png", photo)
    return run_job(buf.tobytes(), real_config(), [], "fast", True)


def test_accuracy_summary_over_a_small_generated_set():
    """A repeatable number for the README: character accuracy over 12 pages x 3 conditions."""
    scores = {"clean": [], "blur1": [], "noise15": []}
    for seed in range(4):
        lines = random_lines(50 + seed, count=6)
        base = np.asarray(text_page(lines, size=(1000, 650)))
        for name, img in (("clean", base), ("blur1", blur(base, 1.0)), ("noise15", noise(base, 15, seed))):
            scores[name].append(accuracy("\n".join(lines), read(img)["text"]))
    summary = {k: round(float(np.mean(v)), 3) for k, v in scores.items()}
    print(f"\nmean character accuracy over generated pages: {summary}")
    assert summary["clean"] > 0.95
