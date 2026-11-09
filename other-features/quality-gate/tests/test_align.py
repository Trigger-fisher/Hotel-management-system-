"""The checks aligned with the intake worker on 5 Nov 2026: compression measured on the original upload, the id-card portrait hint,
the multi-id advice line, half-size decoding of large JPEGs and the invented calibration table. Invented pictures only."""
import io
import os
import statistics
import time

import cv2
import numpy as np
import pytest
from PIL import Image

from app.compression import jpeg_quality
from app.jobs import WorkerConfig, _load, run_check
from app.profiles import MESSAGES
from tests import idcards as C
from tests.conftest import jpeg, png

CFG = WorkerConfig()


def codes(result, severity=None):
    return {r["code"] for r in result["reasons"] if severity in (None, r["severity"])}


# ---- heavy JPEG compression, read from the original file ----------------------------------------------------------------------

def test_jpeg_quality_is_read_from_the_original_files_table():
    photo = C.on_table(C.card(1), seed=1)
    for q in (20, 45, 80, 95):
        assert abs(jpeg_quality(jpeg(photo, q)) - q) <= 1
    assert jpeg_quality(png(photo)) is None and jpeg_quality(b"\xff\xd8\xff garbage") is None and jpeg_quality(b"") is None


def test_heavily_compressed_upload_is_rejected_with_the_compression_reason():
    photo = C.on_table(C.card(2), seed=2)
    clean = run_check(jpeg(photo, 92), CFG, "id-card")
    assert "tooCompressed" not in codes(clean) and clean["scores"]["jpegQuality"] == 92.0
    mid = run_check(jpeg(photo, 35), CFG, "id-card")
    assert "tooCompressed" in codes(mid, "warn")
    bad = run_check(jpeg(photo, 12), CFG, "id-card")
    assert "tooCompressed" in codes(bad, "reject") and bad["verdict"] == "reject"
    message = next(r["message"] for r in bad["reasons"] if r["code"] == "tooCompressed")
    assert message.startswith("Picture too compressed") and "original photo" in message
    # the photo profile is lenient: 35 is fine for a hotel picture
    assert "tooCompressed" not in codes(run_check(jpeg(photo, 35), CFG, "photo"))
    # a PNG has no table: no compression score, no reason
    assert "jpegQuality" not in run_check(png(photo), CFG, "id-card")["scores"]


def test_a_hard_compressed_copy_saved_again_at_high_quality_is_traced_in_its_pixels():
    photo = C.on_table(C.card(3), seed=3)
    once = cv2.imdecode(np.frombuffer(jpeg(photo, 12), np.uint8), cv2.IMREAD_COLOR)
    again = run_check(jpeg(once, 95), CFG, "id-card")
    assert again["scores"]["jpegQualityTraced"] == 12 and again["scores"]["jpegQuality"] == 12
    assert "tooCompressed" in codes(again, "reject") and "jpegBlocking" not in codes(again)
    clean = run_check(jpeg(photo, 95), CFG, "id-card")
    assert "jpegQualityTraced" not in clean["scores"] and clean["scores"]["jpegQuality"] == 95.0
    assert not {"jpegBlocking", "tooCompressed"} & codes(clean)


@pytest.mark.parametrize("q, severity", [(20, "reject"), (35, "warn")])
def test_a_hard_compressed_copy_saved_again_as_png_gets_the_compression_reason(q, severity):
    photo = C.on_table(C.card(4), seed=4)
    once = cv2.imdecode(np.frombuffer(jpeg(photo, q), np.uint8), cv2.IMREAD_COLOR)
    r = run_check(png(once), CFG, "id-card")
    assert r["scores"]["jpegQuality"] == q and "tooCompressed" in codes(r, severity)
    assert "jpegBlocking" not in codes(r)


def test_the_trace_reads_the_earlier_quality_and_leaves_clean_pictures_alone():
    from app.compression import earlier_quality, traced_quality
    card = C.card(5)
    assert traced_quality(png(card)) is None and traced_quality(jpeg(card, 100)) is None and traced_quality(jpeg(card, 90)) is None
    for q in (10, 25, 35):
        once = cv2.imdecode(np.frombuffer(jpeg(card, q), np.uint8), cv2.IMREAD_COLOR)
        assert traced_quality(png(once)) == q and traced_quality(jpeg(once, 95)) == q
    shrunk = cv2.resize(cv2.imdecode(np.frombuffer(jpeg(card, 20), np.uint8), cv2.IMREAD_COLOR), None, fx=0.7, fy=0.7,
                        interpolation=cv2.INTER_AREA)
    assert traced_quality(png(shrunk)) is None  # resized after the compression: the 8 px grid is gone (a known limit)
    assert earlier_quality(np.zeros((40, 40), np.uint8)) == (None, 0.0) and traced_quality(b"not a picture") is None


def test_a_jpeg_cut_short_is_still_reported_as_damaged():
    data = jpeg(C.on_table(C.card(0), seed=0), 90)
    assert run_check(data[: len(data) // 2], CFG, "id-card")["reasons"][0]["code"] == "imageCorrupt"


# ---- the id-card portrait hint ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("seed", [0, 1, 4])
def test_a_clear_portrait_gives_no_hint_and_is_reported_found(seed):
    r = run_check(jpeg(C.on_table(C.card(seed), seed=seed), 92), CFG, "id-card")
    assert r["info"]["portrait"]["found"] is True and r["info"]["portrait"]["why"] == []
    assert "portraitUnclear" not in codes(r) and r["verdict"] == "accept"


@pytest.mark.parametrize("seed", [0, 1, 4])
def test_a_blurred_or_glared_portrait_on_a_sharp_card_gives_mjs_retake_sentence(seed):
    blurred = run_check(jpeg(C.on_table(C.blur_photo(C.card(seed), 4), seed=seed), 92), CFG, "id-card")
    hint = next(r for r in blurred["reasons"] if r["code"] == "portraitUnclear")
    assert hint["severity"] == "warn" and hint["message"] == "Photo on the ID is not clear, please retake." and "photo blurred" in hint["why"]
    assert "blurry" not in codes(blurred)  # the card itself is sharp: only the photo is named
    glared = run_check(jpeg(C.on_table(C.glare_photo(C.card(seed)), seed=seed), 92), CFG, "id-card")
    assert "glare over the photo" in next(r for r in glared["reasons"] if r["code"] == "portraitUnclear")["why"]


def test_no_portrait_no_hint_and_other_profiles_do_not_look():
    side = run_check(jpeg(C.on_table(C.card(2, with_photo=False), seed=2), 92), CFG, "id-card")
    assert side["info"]["portrait"] == {"found": False} and "portraitUnclear" not in codes(side)
    doc = run_check(jpeg(C.on_table(C.blur_photo(C.card(2), 4), seed=2), 92), CFG, "document")
    assert "portrait" not in doc["info"] and "portraitUnclear" not in codes(doc)
    assert MESSAGES["portraitUnclear"] == "Photo on the ID is not clear, please retake."


def test_portrait_limits_can_be_overridden(monkeypatch):
    data = jpeg(C.on_table(C.card(1), seed=1), 92)
    assert "portraitUnclear" not in codes(run_check(data, CFG, "id-card"))
    monkeypatch.setenv("GATE_THRESHOLDS", '{"id-card": {"portraitUnclear": {"sharp_warn": 5.0}}}')
    r = run_check(data, CFG, "id-card")
    assert "portraitUnclear" in codes(r) and r["thresholds"]["portraitUnclear"]["sharp_warn"] == 5.0


# ---- large JPEGs decoded at half size --------------------------------------------------------------------------------------------

def test_a_large_jpeg_is_decoded_at_half_size_and_judged_like_the_whole_picture():
    photo = C.on_table(C.card(5), frame=(3000, 4000), scale=0.55, seed=5)
    data = jpeg(photo, 92)
    half = _load(data, 10 ** 9)
    whole = _load(data, 10 ** 9, allow_half=False)
    assert half.up == 2 and half.img.shape[:2] == (1500, 2000) and half.full_size == (4000, 3000)
    assert whole.up == 1 and whole.full_size == (4000, 3000)
    r = run_check(data, CFG, "id-card")
    assert r["scores"]["width"] == 4000 and r["scores"]["height"] == 3000 and r["verdict"] == "accept"
    from app.metrics import measure_image
    a, b = measure_image(half.img, half.full_size, 4), measure_image(whole.img, whole.full_size)
    for key in ("blurLaplacian", "blurGradient", "contrast", "noise"):
        assert abs(a[key] - b[key]) <= 0.12 * max(abs(b[key]), 1.0), key
    assert abs(a["contentLongSidePx"] - b["contentLongSidePx"]) <= 0.03 * b["contentLongSidePx"]


def test_exif_turned_jpeg_reports_the_upright_size():
    photo = C.on_table(C.card(1), seed=1)  # 2000 x 1500
    buf = io.BytesIO()
    pil = Image.fromarray(photo[..., ::-1])
    exif = pil.getexif()
    exif[0x0112] = 6  # stored sideways: shown turned 90 degrees
    pil.save(buf, "JPEG", quality=92, exif=exif)
    loaded = _load(buf.getvalue(), 10 ** 9)
    assert loaded.full_size == (1500, 2000) and loaded.img.shape[:2] == (2000, 1500)


def test_a_large_multi_id_jpeg_is_judged_like_the_same_sheet_as_png():
    """A 12 MP sheet takes the fast path (cards found on a quarter-size colour copy, judged on the whole grey picture)."""
    from tests.test_gate import sheet
    big = cv2.resize(sheet(6, blur_index=2), (4000, 3000), interpolation=cv2.INTER_CUBIC)
    fast = run_check(jpeg(big, 93), CFG, "multi-id")
    slow = run_check(png(big), CFG, "multi-id")
    assert fast["info"]["cards"] == slow["info"]["cards"] == 6
    assert fast["info"]["unreadable"] == slow["info"]["unreadable"] == 1
    # the cards come in size order, and six cards of nearly one size may swap places: compare them as sorted lists
    key = lambda r: r["scores"]["longSidePx"]  # noqa: E731
    for a, b in zip(sorted(fast["info"]["regions"], key=key), sorted(slow["info"]["regions"], key=key)):
        assert abs(key(a) - key(b)) <= 0.02 * key(b)
    blurred = lambda res: min(res["info"]["regions"], key=lambda r: r["scores"]["blurLaplacian"])  # noqa: E731
    assert blurred(fast)["readable"] is False and blurred(slow)["readable"] is False
    assert fast["scores"]["width"] == 4000 and fast["scores"]["height"] == 3000


# ---- invented calibration --------------------------------------------------------------------------------------------------------

def test_invented_calibration_table_damaged_against_clean():
    from scripts.calibrate_invented import run
    out = run(cards=3)
    t = out["table"]
    print("\ntruth \\ verdict  accept  warn  reject")
    for truth in ("clean", "damaged"):
        print(f"{truth:14s} {t[truth]['accept']:7d} {t[truth]['warn']:5d} {t[truth]['reject']:7d}")
    damaged, clean = sum(t["damaged"].values()), sum(t["clean"].values())
    assert t["clean"]["reject"] == 0  # no clean invented picture is refused
    assert t["damaged"]["accept"] <= 1  # damaged invented pictures are warned or rejected (12 cards: 143/144, README)
    assert t["damaged"]["reject"] >= 0.6 * damaged and t["clean"]["warn"] <= 0.1 * clean


# ---- speed (MJ, 5 Nov 2026: under 0.3 s per picture on 4 cores) -----------------------------------------------------------------

@pytest.mark.skipif(os.environ.get("GATE_SPEED_TEST") != "1", reason="timing test: set GATE_SPEED_TEST=1 on an otherwise idle machine")
def test_one_picture_takes_under_0_3_s_on_4_cores():
    from scripts.bench import pictures, pin
    pin(4)
    cfg = WorkerConfig(cpu_threads=4)
    for label, (data, profile) in pictures().items():
        if profile == "multi-id":
            continue  # a sheet of 8 cards is 8 pictures' work: reported by scripts/bench.py, not held to the one-picture limit
        run_check(data, cfg, profile)
        times = []
        for _ in range(5):
            t = time.perf_counter()
            run_check(data, cfg, profile)
            times.append(time.perf_counter() - t)
        print(f"\n{label}: median {statistics.median(times):.3f} s")
        assert statistics.median(times) < 0.3, label
