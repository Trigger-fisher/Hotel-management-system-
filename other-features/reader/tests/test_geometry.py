import cv2
import numpy as np
import pytest

from app import geometry, quality
from tests.imaging import (corner_error, noise, random_lines, scene, ssim_gray, text_page)


def page_array(seed=0):
    return np.asarray(text_page(random_lines(seed)))


def generated_set(n=24):
    for seed in range(n):
        rng = np.random.default_rng(100 + seed)
        page = page_array(seed)
        scale, angle, tilt = rng.uniform(0.45, 0.85), rng.uniform(-30, 30), rng.uniform(0, 0.25)
        bg = tuple(int(x) for x in rng.integers(40, 170, 3))
        photo, truth = scene(page, scale=scale, angle=angle, tilt=tilt, seed=seed, bg_colour=bg)
        yield page, photo, truth


def test_document_found_on_generated_photos():
    """Real success rate on 24 invented photos (random scale, rotation up to 30 degrees, keystone, clutter, noise)."""
    ok = cut_off = 0
    similarities = []
    total = 0
    for page, photo, truth in generated_set():
        total += 1
        region = geometry.localise(photo, True)[0]
        inside = (truth[:, 0].min() > 0 and truth[:, 1].min() > 0 and truth[:, 0].max() < photo.shape[1] - 1
                  and truth[:, 1].max() < photo.shape[0] - 1)
        if region.quad is None:
            cut_off += 1 if (not inside and "partlyCutOff" in region.flags) else 0
            continue
        diag = float(np.hypot(*photo.shape[:2]))
        if corner_error(region.quad, truth) / diag < 0.03:
            ok += 1
            flat = cv2.cvtColor(region.image, cv2.COLOR_BGR2GRAY)
            similarities.append(ssim_gray(cv2.resize(flat, (page.shape[1], page.shape[0]), interpolation=cv2.INTER_AREA), page))
    # Pages that really stick out of the frame must be flagged, not guessed: those count as correct too.
    rate = (ok + cut_off) / total
    print(f"\ndocument localisation: {ok} found within 3% of the diagonal, {cut_off} correctly flagged "
          f"partlyCutOff, of {total}; flattened-vs-original SSIM median {np.median(similarities):.2f}")
    assert rate >= 0.8
    assert np.median(similarities) > 0.6


def test_flattened_page_is_upright_and_matches_original_text_region():
    page = page_array(3)
    photo, truth = scene(page, scale=0.65, angle=15, tilt=0.12, seed=3)
    region = geometry.localise(photo, True)[0]
    assert region.quad is not None and corner_error(region.quad, truth) < 25
    flat = cv2.cvtColor(region.image, cv2.COLOR_BGR2GRAY)
    assert flat.shape[0] > flat.shape[1]  # portrait page stays portrait
    assert ssim_gray(cv2.resize(flat, (page.shape[1], page.shape[0]), interpolation=cv2.INTER_AREA), page) > 0.7
    assert max(flat.shape) <= geometry.MAX_OUT_SIDE


def test_never_upscales_beyond_source_resolution():
    photo, truth = scene(page_array(1), frame=(500, 700), scale=0.6, angle=5, seed=1)
    flat = geometry.localise(photo, True)[0].image
    longest_edge = max(np.linalg.norm(truth[1] - truth[0]), np.linalg.norm(truth[2] - truth[1]),
                       np.linalg.norm(truth[3] - truth[2]), np.linalg.norm(truth[0] - truth[3]))
    assert max(flat.shape[:2]) <= longest_edge * 1.1


def test_off_switch_returns_the_whole_photo():
    photo, _ = scene(page_array(0), scale=0.6, seed=0)
    regions = geometry.localise(photo, False)
    assert len(regions) == 1 and regions[0].quad is None and regions[0].image.shape == photo.shape and regions[0].flags == []


def test_no_document_falls_back_with_a_flag():
    rng = np.random.default_rng(5)
    clutter = noise(np.full((700, 900, 3), 120, np.uint8), 40, seed=5)
    for _ in range(40):
        cv2.line(clutter, (int(rng.integers(0, 900)), int(rng.integers(0, 700))),
                 (int(rng.integers(0, 900)), int(rng.integers(0, 700))), (int(rng.integers(0, 255)),) * 3, 3)
    regions = geometry.localise(clutter, True)
    assert len(regions) == 1 and regions[0].quad is None and regions[0].image.shape == clutter.shape
    # random clutter may form a shape touching the frame: either honest flag is fine, cropping is not\n    assert set(regions[0].flags) & {"documentNotFound", "partlyCutOff"}


def test_document_filling_the_frame_is_kept_whole_without_flags():
    img = cv2.cvtColor(page_array(2), cv2.COLOR_GRAY2BGR)
    region = geometry.localise(img, True)[0]
    assert region.quad is None and region.flags == [] and region.image.shape == img.shape


def test_partly_cut_off_document_is_flagged_and_kept_whole():
    photo, _ = scene(page_array(0), scale=0.7, centre=(1150, 500), seed=0)  # runs off the right edge
    region = geometry.localise(photo, True)[0]
    assert region.quad is None and "partlyCutOff" in region.flags and region.image.shape == photo.shape


def test_two_documents_give_two_regions():
    card = np.asarray(text_page(["GUEST CARD", "Name Anna Maria", "Room 204 Floor 2"], size=(700, 440), font_size=34, step=80))
    left, truth_l = scene(card, frame=(900, 1500), scale=0.4, angle=4, seed=7, centre=(380, 450), clutter=False)
    right, truth_r = scene(card, frame=(900, 1500), scale=0.4, angle=-5, seed=7, centre=(1120, 450), clutter=False)
    mask_right = cv2.fillConvexPoly(np.zeros(left.shape[:2], np.uint8), truth_r.astype(np.int32), 255)
    both = np.where(mask_right[..., None] > 0, right, left)
    regions = geometry.localise(both, True)
    assert len(regions) == 2
    centres = sorted(float(np.mean(r.quad[:, 0])) for r in regions)
    assert abs(centres[0] - 380) < 90 and abs(centres[1] - 1120) < 90


# ---- curled pages ---------------------------------------------------------------------------------

def wavy(page: np.ndarray, amplitude=14.0) -> np.ndarray:
    h, w = page.shape
    xs, ys = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(page, xs, ys + (amplitude * np.sin(xs / w * np.pi * 1.5)).astype(np.float32),
                     cv2.INTER_CUBIC, borderValue=255)


def test_curved_text_lines_are_detected_and_flat_pages_are_not():
    page = page_array(4)
    flat_curves, _ = geometry.line_curves(page)
    curved_curves, _ = geometry.line_curves(wavy(page))
    assert geometry.curl_amount(flat_curves, 28) < geometry.CURL_FLAG
    assert geometry.curl_amount(curved_curves, 28) >= geometry.CURL_FLAG


def test_straighten_reduces_the_bend():
    page = wavy(page_array(4))
    curves, scale = geometry.line_curves(page)
    fixed = geometry.straighten(page, curves, scale)
    before = np.median([np.abs(c.offset).max() for c in curves])
    after_curves, _ = geometry.line_curves(fixed)
    after = np.median([np.abs(c.offset).max() for c in after_curves])
    assert after < before * 0.6


# ---- skew ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("angle", [-9.0, -3.0, 2.0, 7.5])
def test_skew_is_estimated_and_removed(angle):
    from tests.imaging import rotate_free
    from app.preprocess import deskew
    page = page_array(0)
    tilted = rotate_free(page, angle)
    estimate = quality.estimate_skew(tilted)
    assert abs(estimate - (-angle)) < 0.8 or abs(estimate - angle) < 0.8  # sign convention checked below
    fixed = deskew(tilted, estimate)
    assert abs(quality.estimate_skew(fixed)) < 0.8
