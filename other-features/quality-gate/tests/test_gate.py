import io

import cv2
import numpy as np
import pikepdf
import pytest
from PIL import Image

from app.errors import GateError
from app.jobs import WorkerConfig, run_check
from app.profiles import MULTI_ADVICE
from tests.conftest import jpeg, png
from tests.imaging import (blur, darken, low_contrast, noise, random_lines, scene, shrink, text_page)

CFG = WorkerConfig()
ORDER = {"accept": 0, "warn": 1, "reject": 2}


def page(scale=2, seed=1):
    """A sharp text page; scale 2 gives 2000 x 2600 pixels (about 170 dpi on A4)."""
    return np.asarray(text_page(random_lines(seed, 14), size=(1000 * scale, 1300 * scale), font_size=38 * scale))


def check(arr, profile="document"):
    return run_check(png(arr), CFG, profile)


def codes(result, severity=None):
    return {r["code"] for r in result["reasons"] if severity in (None, r["severity"])}


# ---- blur --------------------------------------------------------------------------------------

@pytest.mark.parametrize("profile", ["document", "id-card", "generic", "photo"])
def test_blur_verdict_gets_worse_with_strength_and_the_rejection_point_is_in_range(profile):
    base = page()
    sigmas = (0, 1, 2, 3, 4, 5, 6, 8, 10, 14)
    blurry = [("blurry" in codes(check(blur(base, s), profile), "reject")) for s in sigmas[1:]]
    first = next((s for s, b in zip(sigmas[1:], blurry) if b), None)
    print(f"\n{profile}: first sigma (at 2000 px) that rejects as blurry = {first}")
    assert blurry == sorted(blurry)  # once rejected, stays rejected
    expected = {"document": (3, 8), "id-card": (2, 6), "generic": (3, 8), "photo": (6, 14)}[profile]
    assert first is not None and expected[0] <= first <= expected[1]


def test_sharp_page_is_not_flagged_blurry():
    for profile in ("document", "id-card", "generic"):
        assert "blurry" not in codes(check(page(), profile))


def test_profiles_differ_on_the_same_slightly_soft_image():
    soft = blur(page(), 4)
    assert "blurry" in codes(check(soft, "id-card"), "reject")
    assert "blurry" not in codes(check(soft, "photo"))
    assert ORDER[check(soft, "id-card")["verdict"]] > ORDER[check(soft, "generic")["verdict"]] or "blurry" in codes(check(soft, "generic"))


def test_blur_is_size_independent():
    """The same scene at 1x and 2x resolution (blur scaled with it) gets the same blur verdict."""
    base1 = page(scale=1)
    base2 = cv2.resize(base1, None, fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
    for sigma in (0.6, 1.2, 2.5, 4.0):
        a = {r["severity"] for r in check(blur(base1, sigma), "generic")["reasons"] if r["code"] == "blurry"}
        b = {r["severity"] for r in check(blur(base2, 2 * sigma), "generic")["reasons"] if r["code"] == "blurry"}
        assert a == b, sigma


def test_motion_blur_direction_is_hinted():
    k = np.zeros((41, 41), np.float32)
    k[20, :] = 1 / 41
    horizontal = check(cv2.filter2D(page(), -1, k), "document")
    assert "blurry" in codes(horizontal) and any(r["code"] == "motionBlurHint" and "horizontal" in r["message"] for r in horizontal["reasons"])
    vertical = check(cv2.filter2D(page(), -1, k.T), "document")
    assert any(r["code"] == "motionBlurHint" and "vertical" in r["message"] for r in vertical["reasons"])


# ---- exposure, contrast, noise, blank, size -------------------------------------------------------

def test_dark_bright_low_contrast_noise_blank_and_tiny():
    base = page()
    assert "tooDark" in codes(check(darken(base, 0.2)), "reject")
    assert "tooDark" in codes(check(darken(base, 0.45)))  # warn
    assert "washedOut" in codes(check(np.clip(base.astype(float) * 0.3 + 190, 0, 255).astype(np.uint8)))
    assert "lowContrast" in codes(check(low_contrast(base, 0.12)), "reject")
    assert "noisy" in codes(check(noise(base, 90)), "reject")
    blank = check(np.full((1000, 800), 235, np.uint8))
    assert blank["verdict"] == "reject" and codes(blank) == {"blank"}
    assert "tooSmall" in codes(check(shrink(base, 0.2)), "reject")
    assert "lowResolution" in codes(check(shrink(base, 0.3)))


def test_glare_is_found_on_grey_paper_only():
    grey = np.minimum(page(), 220).astype(np.uint8)
    grey[300:1500, 400:1500] = 255
    assert "glare" in codes(check(grey, "id-card"), "reject")
    white = page().copy()
    white[300:1500, 400:1500] = 255
    assert "glare" not in codes(check(white, "id-card"))  # honest limit: white paper hides glare


def test_content_cut_off_at_the_frame_edge_and_small_in_frame():
    base = page()
    cut = base[:, 300:1000]  # text runs into both side borders
    assert "cutOff" in codes(check(cut, "id-card"))
    small, _ = scene(shrink(base, 0.5), frame=(1400, 1800), scale=0.18, seed=2, clutter=False)
    assert "documentSmallInFrame" in codes(check(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), "id-card"))


def test_extreme_aspect_ratio_and_jpeg_blocking():
    strip = page()[:300]
    assert "extremeAspect" in codes(check(strip, "id-card"))
    block = jpeg(cv2.resize(page(scale=1), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), quality=3)
    # a JPEG upload is judged by its own quantisation table (tooCompressed); the block grid is the evidence for other formats
    assert "tooCompressed" in codes(run_check(block, CFG, "document"), "reject")
    as_png = png(cv2.imdecode(np.frombuffer(block, np.uint8), cv2.IMREAD_GRAYSCALE))
    assert "jpegBlocking" in codes(run_check(as_png, CFG, "document"))


def test_scores_are_reported_so_thresholds_can_be_tuned():
    result = check(page())
    for key in ("blurLaplacian", "blurGradient", "brightness", "contrast", "glare", "noise", "blockiness", "moire",
                "contentShare", "borderContent", "megapixels", "aspect", "effectiveDpi"):
        assert key in result["scores"]
    assert result["thresholds"]["blurry"]["reject_lap"] > 0 and result["profile"] == "document"


def test_thresholds_can_be_overridden_by_environment(monkeypatch):
    soft = blur(page(), 4)
    assert "blurry" not in codes(check(soft, "photo"))
    monkeypatch.setenv("GATE_THRESHOLDS", '{"photo": {"blurry": {"reject_lap": 100000, "reject_grad": 100000}}}')
    assert "blurry" in codes(check(soft, "photo"), "reject")


def test_animated_image_judges_the_first_frame():
    frames = [Image.fromarray(page(scale=1)), Image.fromarray(255 - page(scale=1))]  # different frames: Pillow merges identical ones
    buf = io.BytesIO()
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:])
    assert "animatedImage" in codes(run_check(buf.getvalue(), CFG, "document"))


def test_rotated_photo_in_a_scene_is_still_judged():
    photo, _ = scene(page(), frame=(1600, 2000), scale=0.8, angle=10, seed=1)
    assert check(photo, "document")["verdict"] in ("accept", "warn", "reject")


def test_detection_rate_on_the_generated_set():
    """Bad pictures (blur, dark, low contrast, noise, blank, tiny, glare) must be flagged; good ones must pass."""
    base = page(seed=3)
    grey = np.minimum(base, 220).astype(np.uint8)
    grey[300:1500, 400:1500] = 255
    bad = [blur(base, 7), blur(base, 12), darken(base, 0.2), low_contrast(base, 0.12), noise(base, 45),
           np.full_like(base, 240), shrink(base, 0.2), grey]
    good = [page(seed=s) for s in range(4, 12)]
    flagged = sum(check(b, "id-card")["verdict"] != "accept" for b in bad)
    passed = sum(check(g, "document")["verdict"] != "reject" for g in good)
    print(f"\nflagged {flagged}/{len(bad)} bad pictures; {passed}/{len(good)} good pictures not rejected")
    assert flagged >= len(bad) - 1 and passed == len(good)


# ---- caps and errors -------------------------------------------------------------------------------

def test_errors_have_stable_codes():
    with pytest.raises(GateError) as e:
        run_check(b"plain text", CFG)
    assert e.value.code == "unsupported_type"
    with pytest.raises(GateError) as e:
        run_check(png(page(scale=1)), WorkerConfig(max_bytes=100))
    assert e.value.code == "file_too_large"
    with pytest.raises(GateError) as e:
        run_check(png(page(scale=1)), WorkerConfig(max_pixels=1000))
    assert e.value.code == "too_many_pixels"
    with pytest.raises(GateError) as e:
        run_check(png(page(scale=1)), CFG, "passport")
    assert e.value.code == "bad_profile"
    assert run_check(png(page(scale=1))[:80], CFG)["reasons"][0]["code"] == "imageCorrupt"


# ---- PDFs ---------------------------------------------------------------------------------------------

def build_pdf(pages: list[dict]) -> bytes:
    pdf = pikepdf.new()
    font = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)
    for spec in pages:
        size = spec.get("size", (612, 792))
        pg = pdf.add_blank_page(page_size=size)
        content, resources = "", pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
        if spec.get("text"):
            content += "".join(f"BT /F1 14 Tf 40 {size[1] - 60 - i * 22} Td (Invented line {i} of the page text here) Tj ET\n" for i in range(30))
        if "image" in spec:
            arr = spec["image"]
            buf = io.BytesIO()
            Image.fromarray(arr).save(buf, "JPEG", quality=90)
            im = pikepdf.Stream(pdf, buf.getvalue())
            im.Type, im.Subtype, im.Width, im.Height = pikepdf.Name.XObject, pikepdf.Name.Image, arr.shape[1], arr.shape[0]
            im.BitsPerComponent, im.ColorSpace, im.Filter = 8, pikepdf.Name.DeviceGray, pikepdf.Name.DCTDecode
            resources.XObject = pikepdf.Dictionary(Im0=im)
            content += f"q {size[0]} 0 0 {size[1]} 0 0 cm /Im0 Do Q\n"
        pg.Resources = resources
        pg.Contents = pdf.make_stream(content.encode())
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


def test_pdf_good_text_page_is_accepted_and_reports_the_text_layer():
    r = run_check(build_pdf([{"text": True}]), CFG, "document")
    assert r["verdict"] == "accept" and r["pages"][0]["textLayer"] is True and r["info"]["textLayerPages"] == 1


def test_pdf_blank_page_warns_and_all_blank_rejects():
    mixed = run_check(build_pdf([{"text": True}, {}]), CFG, "document")
    assert mixed["verdict"] == "warn" and mixed["pages"][1]["reasons"][0]["code"] == "blankPage"
    assert run_check(build_pdf([{}, {}]), CFG, "document")["verdict"] == "reject"


def test_pdf_scanned_page_blur_and_low_image_dpi():
    sharp = page(scale=2)[:2600, :2000]
    scan = lambda arr: build_pdf([{"image": arr}])  # noqa: E731
    assert run_check(scan(sharp), CFG, "document")["verdict"] != "reject"
    soft = run_check(scan(blur(sharp, 9)), CFG, "document")
    assert soft["verdict"] == "reject" and "blurry" in {r["code"] for r in soft["reasons"]} and soft["reasons"][0]["pages"] == [1]
    low = run_check(scan(shrink(sharp, 0.18)), CFG, "document")  # 360 px across a 612 pt page = 42 dpi
    assert low["verdict"] == "reject" and "lowImageDpi" in {r["code"] for r in low["reasons"]}


def test_pdf_mixed_page_sizes_are_reported():
    r = run_check(build_pdf([{"text": True}, {"text": True, "size": (300, 400)}]), CFG, "document")
    assert r["info"]["mixedPageSizes"] is True and any(x["code"] == "mixedPageSizes" for x in r["reasons"])


def test_pdf_encrypted_corrupt_zero_pages_and_page_cap(monkeypatch):
    good = build_pdf([{"text": True}])
    buf = io.BytesIO()
    pikepdf.open(io.BytesIO(good)).save(buf, encryption=pikepdf.Encryption(user="u", owner="o"))
    assert run_check(buf.getvalue(), CFG)["reasons"][0]["code"] == "pdfEncrypted"
    assert run_check(b"%PDF-1.4 garbage garbage garbage", CFG)["reasons"][0]["code"] == "pdfCorrupt"
    empty = io.BytesIO()
    pikepdf.new().save(empty)
    assert run_check(empty.getvalue(), CFG)["reasons"][0]["code"] in ("noPages", "pdfCorrupt")
    monkeypatch.setattr("app.pdfs.PDF_MAX_PAGES", 1)
    assert run_check(build_pdf([{"text": True}, {"text": True}]), CFG)["reasons"][0]["code"] == "tooManyPages"


# ---- several cards in one photo --------------------------------------------------------------------------

def card_image(seed: int, size=(850, 540)) -> np.ndarray:
    return np.asarray(text_page([f"GUEST CARD {seed}", f"Name Anna {seed}", f"No {1000 + seed} 4567", "DOB 01/02/1990"],
                                size=size, font_size=40, step=96))


def sheet(n: int, card_scale=0.2, blur_index: int | None = None, frame=(2400, 3200), seed=0, blur_sigma: float = 9) -> np.ndarray:
    cols = 4
    canvas = np.full((*frame, 3), (90, 120, 150), np.uint8)
    rng = np.random.default_rng(seed)
    for i in range(n):
        r, c = divmod(i, cols)
        centre = (frame[1] * (c + 0.5) / cols, frame[0] * (r + 0.5) / 4)
        img = card_image(i)
        if i == blur_index:
            img = blur(img, blur_sigma)  # on the 850 px card, before it is shrunk to about 640 px
        photo, corners = scene(img, frame=frame, scale=card_scale, angle=float(rng.uniform(-8, 8)), seed=i, centre=centre, clutter=False, noise_sigma=0.0)
        mask = cv2.fillConvexPoly(np.zeros(frame, np.uint8), corners.astype(np.int32), 255)
        canvas = np.where(mask[..., None] > 0, photo, canvas)
    return canvas.astype(np.uint8)


def test_multi_id_counts_cards_and_names_how_many_are_unreadable():
    good = run_check(png(sheet(4)), CFG, "multi-id")
    assert good["info"]["cards"] == 4 and good["verdict"] == "accept"
    bad = run_check(png(sheet(4, blur_index=1)), CFG, "multi-id")
    assert bad["info"]["unreadable"] == 1
    message = next(r["message"] for r in bad["reasons"] if r["code"] == "cardsUnreadable")
    assert message.startswith("1 of 4 cards cannot be read. ") and "at most 12 cards per photo" in message and "600 pixels" in message
    assert bad["info"]["advice"] == MULTI_ADVICE and "advice" not in good["info"]
    assert bad["verdict"] == "warn" and all(set(r["scores"]) <= {"blurLaplacian", "blurGradient", "glare", "longSidePx"} for r in bad["info"]["regions"])


def test_multi_id_too_small_cards_and_too_many_cards():
    tiny = run_check(png(sheet(4, card_scale=0.12)), CFG, "multi-id")
    assert tiny["info"]["unreadable"] >= 3 and tiny["verdict"] == "reject" and tiny["info"]["tooSmall"] >= 3
    message = next(r["message"] for r in tiny["reasons"] if r["code"] == "cardsUnreadable")
    assert "too small" in message and message.endswith(MULTI_ADVICE)
    many = run_check(png(sheet(14, card_scale=0.17)), CFG, "multi-id")
    assert "tooManyCards" in {r["code"] for r in many["reasons"]} and many["verdict"] == "reject"
    assert next(r["message"] for r in many["reasons"] if r["code"] == "tooManyCards").startswith("More than 12 cards")


def test_multi_id_twelve_cards_of_600_px_pass_and_the_limits_are_in_the_thresholds():
    """12 cards in a 4 x 3 grid, each about 700 px long in the photo: all found and all readable; the limits are reported."""
    twelve = run_check(png(sheet(12, card_scale=0.2, frame=(2600, 3800), seed=3)), CFG, "multi-id")
    print(f"\n12 cards: found {twelve['info']['cards']}, unreadable {twelve['info']['unreadable']}, "
          f"smallest {min(r['scores']['longSidePx'] for r in twelve['info']['regions'])} px")
    assert twelve["info"]["cards"] == 12 and twelve["info"]["unreadable"] == 0 and twelve["verdict"] == "accept"
    assert twelve["thresholds"]["multi"] == {"max_cards": 12, "min_card_long_side_px": 600, "reject_unreadable_share": 0.5}


def test_multi_id_empty_picture():
    assert "noCardsFound" in {r["code"] for r in run_check(png(np.full((800, 1000, 3), 120, np.uint8)), CFG, "multi-id")["reasons"]}
