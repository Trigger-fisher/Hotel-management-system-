"""MJ's size rule (150 KB first, 500 KB hard maximum) and the faster quality search. Invented pictures only."""
import io

import numpy as np
import pytest
from PIL import Image

from app.errors import CompressorError
from app.images import Q_RANGE, _encode, _search
from app.jobs import run_job
from app.limits import Deadline, Limits
from app.modes import DEFAULT_CAP, DEFAULT_TARGET, KB, MODES, SizeRule, size_rule
from app.pdfs import JPEG_Q, _lowest_jpeg
from app.quality import Reference, ssim
from tests.conftest import noisy_photo, pdf_with_image, photo_like, to_bytes

LIMITS = Limits()


def decode(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


@pytest.fixture(scope="module")
def big_noisy() -> bytes:
    # 1800x1350 with heavy noise: about 1.5 MB as JPEG 95, far above 500 KB at the balanced score
    return to_bytes(noisy_photo(1800, 1350, 9.0), "JPEG", quality=95)


@pytest.fixture(scope="module")
def mid_noisy() -> bytes:
    return to_bytes(noisy_photo(900, 700, 3.0, seed=3), "JPEG", quality=95)


# ---- options -----------------------------------------------------------------

def test_defaults_are_mjs_numbers():
    assert DEFAULT_TARGET == 153_600 and DEFAULT_CAP == 512_000
    assert size_rule() == SizeRule(153_600, 512_000)
    assert size_rule("", None) == SizeRule(153_600, 512_000)
    assert size_rule("100", "300") == SizeRule(100 * KB, 300 * KB)
    assert size_rule(None, "80") == SizeRule(80 * KB, 80 * KB)  # a small cap alone pulls the target down


@pytest.mark.parametrize("target,cap", [("0", None), ("-5", None), ("1.5", None), ("abc", None),
                                        ("400", "300"), (None, "999999999")])
def test_bad_size_options_refused(target, cap):
    with pytest.raises(CompressorError) as e:
        size_rule(target, cap)
    assert e.value.code == "bad_size" and e.value.status == 400


# ---- pictures ----------------------------------------------------------------

def test_small_picture_meets_target(jpeg_photo):
    out = run_job(jpeg_photo, "balanced", "auto", LIMITS)
    assert out.result_bytes <= DEFAULT_TARGET and out.target == "met"
    assert "targetMissed" not in out.notes


def test_over_target_under_cap_is_kept_and_flagged(mid_noisy):
    out = run_job(mid_noisy, "balanced", "jpeg", LIMITS, SizeRule(20 * KB, 2000 * KB))
    assert out.result_bytes > 20 * KB and out.target == "missed" and "targetMissed" in out.notes
    assert "downscaled" not in out.notes and "qualityFloorRelaxed" not in out.notes
    assert ssim(decode(mid_noisy), decode(out.data)) >= MODES["balanced"].ssim_min - 0.002


@pytest.mark.parametrize("output", ["auto", "jpeg", "png"])
def test_cap_is_a_hard_maximum(big_noisy, output):
    out = run_job(big_noisy, "balanced", output, LIMITS)
    assert out.result_bytes <= DEFAULT_CAP
    assert "targetMissed" in out.notes and ("downscaled" in out.notes or "qualityFloorRelaxed" in out.notes)
    if output != "auto":
        assert out.fmt == output


def test_cap_holds_for_webp_output():
    # small picture and cap: lossless WebP at its slowest effort (tried as before) takes minutes on a big noisy one
    src = to_bytes(noisy_photo(500, 380, 3.0, seed=8), "JPEG", quality=95)
    out = run_job(src, "balanced", "webp", LIMITS, SizeRule(10 * KB, 20 * KB))
    assert out.fmt == "webp" and out.result_bytes <= 20 * KB and "targetMissed" in out.notes


def test_cap_beats_strict_floor_and_says_so(jpeg_photo):
    # lossless WebP (the only WebP that keeps 0.995 here) is about 590 KB: the cap wins, flagged
    out = run_job(jpeg_photo, "strict", "webp", LIMITS)
    assert out.fmt == "webp" and out.result_bytes <= DEFAULT_CAP
    assert "qualityFloorRelaxed" in out.notes and "targetMissed" in out.notes


def test_floor_relaxed_step_by_step_before_last_resort(big_noisy):
    out = run_job(big_noisy, "strict", "jpeg", LIMITS, SizeRule(100 * KB, 250 * KB))
    assert out.result_bytes <= 250 * KB
    assert "qualityFloorRelaxed" in out.notes
    assert out.score >= 0.0


def test_last_resort_shrink_never_breaks_the_cap(big_noisy):
    out = run_job(big_noisy, "balanced", "jpeg", LIMITS, SizeRule(3 * KB, 6 * KB))
    assert out.result_bytes <= 6 * KB
    assert "lastResortShrink" in out.notes and "qualityFloorRelaxed" in out.notes
    assert decode(out.data).size[0] < 1800


def test_lossless_never_changes_pixels_only_flags(mid_noisy):
    src = to_bytes(decode(mid_noisy), "PNG")
    out = run_job(src, "lossless", "png", LIMITS, SizeRule(50 * KB, 100 * KB))
    assert "sizeCapExceeded" in out.notes and out.result_bytes > 100 * KB
    assert np.array_equal(np.asarray(decode(src)), np.asarray(decode(out.data).convert("RGB")))


# ---- PDFs: the same cap, per page --------------------------------------------

def test_pdf_cap_per_page(big_noisy):
    pdf = pdf_with_image(decode(big_noisy))
    out = run_job(pdf, "balanced", "auto", LIMITS, SizeRule(20 * KB, 60 * KB))
    assert out.fmt == "pdf" and out.result_bytes <= 60 * KB
    assert "targetMissed" in out.notes and "downscaled" in out.notes


def test_pdf_under_target_unchanged_flags():
    pdf = pdf_with_image(photo_like(900, 600))
    out = run_job(pdf, "balanced", "auto", LIMITS)
    assert out.target == "met" and "targetMissed" not in out.notes


def test_pdf_that_cannot_fit_is_flagged_not_broken(big_noisy):
    pdf = pdf_with_image(decode(big_noisy))
    out = run_job(pdf, "balanced", "auto", LIMITS, SizeRule(1 * KB, 1 * KB))
    assert "sizeCapExceeded" in out.notes and out.result_bytes < len(pdf)


# ---- speed changes keep the same answer ---------------------------------------

def _plain_bisection(img, fmt, floor, strict):
    lo, hi = Q_RANGE[fmt]
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        data = _encode(img, fmt, quality=mid, strict=strict)
        if ssim(img, decode(data)) >= floor:
            best, hi = data, mid - 1
        else:
            lo = mid + 1
    return best


@pytest.mark.parametrize("fmt", ["jpeg", "webp"])
@pytest.mark.parametrize("floor", [0.90, 0.97, 0.985, 0.995])
@pytest.mark.parametrize("start", [None, 35, 60, 99])
def test_guided_search_equals_plain_bisection(fmt, floor, start):
    img = noisy_photo(360, 270, 2.0, seed=5)
    want = _plain_bisection(img, fmt, floor, strict=False)
    got = _search(img, fmt, floor, False, Deadline(60), None, start)
    assert (got.data if got else None) == want


@pytest.mark.parametrize("floor", [0.97, 0.985, 0.995])
def test_pdf_guided_search_equals_plain_bisection(floor):
    img = photo_like(500, 400, seed=2)
    lo, hi = JPEG_Q
    want = None
    while lo <= hi:
        mid = (lo + hi) // 2
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=mid, optimize=True, subsampling=2)
        if ssim(img, decode(buf.getvalue())) >= floor:
            want, hi = buf.getvalue(), mid - 1
        else:
            lo = mid + 1
    mode = MODES["balanced"].__class__("t", floor, None, None)
    assert _lowest_jpeg(img, mode, Deadline(60)) == want


def test_reference_score_equals_ssim():
    a = photo_like(2400, 1000, seed=4)  # bigger than the SSIM size: the shrunk grey copy is used
    b = decode(to_bytes(a, "JPEG", quality=70))
    assert Reference(a).score(b) == ssim(a, b)
    small = a.resize((1200, 500), Image.LANCZOS)
    assert 0.0 < Reference(a).score(small) <= 1.0
