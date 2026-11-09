"""Quality flags and reader logic, using invented pictures and a FAKE engine (no real OCR needed)."""
import io

import numpy as np
import pikepdf
import pytest

from app import codes, quality
from app.config import WorkerConfig
from app.engines.base import Osd
from app.errors import ReaderError
from app.jobs import run_job
from tests.fake_engine import FakeEngine, line
from tests.imaging import (blur, darken, low_contrast, noise, png_bytes, random_lines, shrink, text_page, to_bgr)
from PIL import Image

CFG = WorkerConfig(job_seconds=60)


def good_page(seed=0):
    return np.asarray(text_page(random_lines(seed)))


# ---- quality measurement ------------------------------------------------------------------

def test_sharp_page_has_no_flags():
    q = quality.measure(good_page())
    assert q.flags == [] and q.overall > 0.7


@pytest.mark.parametrize("make,flag", [
    (lambda a: blur(a, 4.0), "blurry"),
    (lambda a: darken(a, 0.2), "tooDark"),
    (lambda a: low_contrast(a, 0.2), "lowContrast"),
    (lambda a: noise(a, 45), "noisy"),
    (lambda a: shrink(a, 0.3), "lowResolution"),
])
def test_each_problem_is_flagged(make, flag):
    assert flag in quality.measure(make(good_page())).flags


def test_glare_patch_is_flagged():
    page = np.minimum(good_page(), 225).astype(np.uint8)  # photographed paper is grey-white, not pure white
    page[100:700, 150:750] = 255  # a blown-out reflection covering the text
    assert "glare" in quality.measure(page).flags


def test_blur_score_orders_by_strength():
    scores = [quality.blur_score(blur(good_page(), s)) for s in (0.01, 1.0, 2.0, 4.0)]
    assert scores == sorted(scores, reverse=True)


def test_blur_flag_is_independent_of_image_size():
    page = good_page()
    big = np.asarray(Image.fromarray(page).resize((page.shape[1] * 2, page.shape[0] * 2), Image.LANCZOS))
    assert ("blurry" in quality.measure(page).flags) == ("blurry" in quality.measure(big).flags)
    soft, soft_big = blur(page, 3.5), blur(big, 7.0)
    assert ("blurry" in quality.measure(soft).flags) == ("blurry" in quality.measure(soft_big).flags)


def test_dpi_is_reported_for_pdfs_and_none_for_photos():
    assert quality.measure(good_page(), dpi=100).resolution_dpi == 100
    assert "lowResolution" in quality.measure(good_page(), dpi=100).flags


# ---- reader with a fake engine -----------------------------------------------------------------

def run(data, engine, **kw):
    return run_job(data, CFG, kw.pop("languages", []), kw.pop("mode", "fast"), kw.pop("find_document", False), engines=[engine])


def png_page(seed=0):
    return png_bytes(Image.fromarray(good_page(seed)))


def test_lines_get_script_confidence_and_flags():
    engine = FakeEngine({"Latin": [line("Name Ramesh", 50), line("Room 204", 120, conf=0.9)]},
                        osd=Osd(0, "Latin", 1.0))
    result = run(png_page(), engine)
    assert [l["text"] for l in result["lines"]] == ["Name Ramesh", "Room 204"]
    assert all(l["script"] == "Latin" and 0 <= l["confidence"] <= 1 for l in result["lines"])
    assert result["text"] == "Name Ramesh\nRoom 204" and result["needsHumanCheck"] is False
    assert result["engines"] == ["fake"] and result["pages"] == 1 and "tookMs" in result


def test_mixed_scripts_on_one_page_are_kept_per_line():
    engine = FakeEngine({"Latin": [line("Name Ramesh", 50), line("गलत", 130, conf=0.2)],
                         "Devanagari": [line("नाम रमेश", 130, conf=0.93), line("Ramesh", 50, conf=0.3)]},
                        osd=Osd(0, None, 1.0))
    result = run(png_page(), engine, languages=["hi", "en"])
    by_text = {l["text"]: l["script"] for l in result["lines"]}
    assert by_text == {"Name Ramesh": "Latin", "नाम रमेश": "Devanagari"}  # the better reading wins per place on the page


def test_low_confidence_sets_needs_human_check():
    engine = FakeEngine({"Latin": [line("maybe 1234", 50, conf=0.4), line("dubious", 120, conf=0.5)]}, osd=Osd(0, "Latin", 1))
    result = run(png_page(), engine)
    assert "lowConfidence" in result["flags"] and result["needsHumanCheck"] is True


def test_blurry_photo_returns_flags_instead_of_pretending():
    from tests.imaging import blur as b
    data = png_bytes(Image.fromarray(b(good_page(), 5.0)))
    result = run(data, FakeEngine({"Latin": [line("text", 50)]}, osd=Osd(0, "Latin", 1)))
    assert "blurry" in result["flags"] and result["needsHumanCheck"] is True


def test_no_text_found_is_flagged():
    result = run(png_page(), FakeEngine({}, osd=Osd(0, "Latin", 1)))
    assert result["lines"] == [] and "noTextFound" in result["flags"] and result["needsHumanCheck"]


def test_reading_order_is_rtl_aware():
    engine = FakeEngine({"Arabic": [line("ثلاثة", 50, x0=20, x1=200, conf=.9), line("واحد", 50, x0=400, x1=600, conf=.9)]},
                        osd=Osd(0, None, 1))
    result = run(png_page(), engine, languages=["ar"])
    assert result["text"].split("  ")[0] == "واحد"  # the right-hand word is read first


def test_invalid_mrz_and_identifier_need_a_person():
    from tests.test_helpers import make_td3
    l1, l2 = make_td3()
    bad = l2[:1] + "X" + l2[2:]
    engine = FakeEngine({"Latin": [line(l1, 50, x1=700), line(bad, 120, x1=700), line("PAN ABCPE1234F", 200)]}, osd=Osd(0, "Latin", 1))
    result = run(png_page(), engine)
    assert result["mrz"]["valid"] is False and result["needsHumanCheck"] is True
    assert {"type": "pan", "text": "ABCPE1234F", "valid": True} in result["identifiers"]


def test_no_engine_for_pictures_is_a_clear_refusal():
    with pytest.raises(ReaderError) as e:
        run_job(png_page(), CFG, [], "fast", False, engines=[])
    assert e.value.code == "no_engine"


def test_bad_inputs_have_stable_codes():
    engine = FakeEngine({})
    for data, code in ((b"plain text", "unsupported_type"), (png_page()[:90], "image_corrupt")):
        with pytest.raises(ReaderError) as e:
            run(data, engine)
        assert e.value.code == code
    with pytest.raises(ReaderError) as e:
        run_job(png_page(), WorkerConfig(max_bytes=100), [], "fast", False, engines=[engine])
    assert e.value.code == "file_too_large"
    with pytest.raises(ReaderError) as e:
        run_job(png_page(), WorkerConfig(max_pixels=100), [], "fast", False, engines=[engine])
    assert e.value.code == "too_many_pixels"
    with pytest.raises(ReaderError) as e:
        run(png_page(), engine, mode="slow")
    assert e.value.code == "bad_option"


# ---- PDFs ----------------------------------------------------------------------------------------

def text_pdf(texts: list[str]) -> bytes:
    pdf = pikepdf.new()
    font = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)
    for text in texts:
        page = pdf.add_blank_page(page_size=(612, 792))
        page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
        page.Contents = pdf.make_stream(
            f"BT /F1 20 Tf 50 700 Td ({text}) Tj ET BT /F1 20 Tf 50 650 Td (Second line of {text}) Tj ET".encode())
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def test_text_pdf_uses_the_text_layer_without_ocr():
    engine = FakeEngine({})
    result = run(text_pdf(["Invoice number 4711", "Page two content here"]), engine)
    assert result["pages"] == 2 and engine.calls == []  # no OCR call was made
    assert "Invoice number 4711" in result["text"] and "Page two content here" in result["text"]
    assert {p["source"] for p in result["pageInfo"]} == {"text-layer"}
    assert all(l["confidence"] == 1.0 and l["page"] in (1, 2) for l in result["lines"])
    assert result["engines"] == ["pdf-text"] and result["needsHumanCheck"] is False


def test_pdf_page_without_text_is_rendered_and_read():
    pdf = pikepdf.open(io.BytesIO(text_pdf(["Has text layer"])))
    blank = pdf.add_blank_page(page_size=(612, 792))  # no text: must go to OCR
    buf = io.BytesIO()
    pdf.save(buf)
    engine = FakeEngine({"Latin": [line("scanned words", 60)]}, osd=Osd(0, "Latin", 1))
    result = run(buf.getvalue(), engine)
    sources = {p["page"]: p["source"] for p in result["pageInfo"]}
    assert sources == {1: "text-layer", 2: "ocr"}
    assert {l["page"] for l in result["lines"]} == {1, 2}


def test_pdf_refusals():
    engine = FakeEngine({})
    pdf = pikepdf.open(io.BytesIO(text_pdf(["x" * 30])))
    buf = io.BytesIO()
    pdf.save(buf, encryption=pikepdf.Encryption(user="u", owner="o"))
    with pytest.raises(ReaderError) as e:
        run(buf.getvalue(), engine)
    assert e.value.code == "pdf_encrypted"
    with pytest.raises(ReaderError) as e:
        run(b"%PDF-1.4 broken broken broken", engine)
    assert e.value.code == "pdf_corrupt"
    with pytest.raises(ReaderError) as e:
        run_job(text_pdf(["a" * 30, "b" * 30]), WorkerConfig(max_pages=1), [], "fast", False, engines=[engine])
    assert e.value.code == "too_many_pages"


# ---- QR / barcodes -------------------------------------------------------------------------------------

@pytest.mark.skipif(not codes.available(), reason="zxing-cpp not installed")
def test_qr_code_is_decoded():
    import zxingcpp
    qr = zxingcpp.write_barcode(zxingcpp.BarcodeFormat.QRCode, "HMS-INVENTED-1234", width=300, height=300)
    img = np.asarray(qr)
    img = img if img.ndim == 2 else img[..., 0]
    page = np.full((600, 800), 255, np.uint8)
    page[100:100 + img.shape[0], 100:100 + img.shape[1]] = img
    found = codes.read_codes(to_bgr(Image.fromarray(page)))
    assert any(c["text"] == "HMS-INVENTED-1234" and "QR" in c["type"] for c in found)
