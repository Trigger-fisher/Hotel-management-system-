import io
import shutil
import tempfile
from pathlib import Path

import numpy as np
import pikepdf
import pytest

from app import render
from app.config import Limits
from app.convert import convert_job
from app.errors import ConvertError
from app.options import (DPI_MAX, DPI_MIN, expand_pages, parse_options, parse_pages, scale_for)
from tests.conftest import PASSWORD, decode, many_pages

LIMITS = Limits()


def run(tmp_path: Path, pdf: bytes, limits: Limits = LIMITS, **form) -> dict:
    work = Path(tempfile.mkdtemp(dir=tmp_path))
    src = work / "in.pdf"
    src.write_bytes(pdf)
    out = work / "out"
    out.mkdir()
    manifest = convert_job(str(src), str(out), parse_options({k: str(v) for k, v in form.items()}), limits)
    manifest["_dir"] = out
    return manifest


def image_of(m: dict, i: int = 0):
    return decode((m["_dir"] / m["pages"][i]["file"]).read_bytes())


# ---- option parsing and maths ----------------------------------------------------

def test_pages_parsing_and_expansion():
    assert parse_pages("1-3,5,8-") == ((1, 3), (5, 5), (8, None))
    assert expand_pages(parse_pages("1-3,5,8-"), 10) == [1, 2, 3, 5, 8, 9, 10]
    assert expand_pages(parse_pages("2-99"), 4) == [2, 3, 4]
    assert expand_pages(parse_pages("7"), 4) == []
    assert expand_pages(None, 3) == [1, 2, 3]


@pytest.mark.parametrize("spec", ["0", "3-1", "a", "1,,2", "1-2-3", "-5", ""])
def test_bad_pages_rejected(spec):
    with pytest.raises(ConvertError) as e:
        parse_pages(spec)
    assert e.value.code == "bad_option"


@pytest.mark.parametrize("form", [
    {"dpi": DPI_MIN - 1}, {"dpi": DPI_MAX + 1}, {"dpi": "abc"}, {"maxSide": 10}, {"dpi": 100, "maxSide": 500},
    {"format": "gif"}, {"colorMode": "sepia"}, {"rotation": 45}, {"box": "art"}, {"background": "red"},
    {"background": "transparent", "format": "jpeg"}, {"jpegQuality": 0}, {"pngCompress": 10},
    {"renderForms": "maybe"}, {"bwThreshold": 300},
])
def test_options_are_bounded(form):
    with pytest.raises(ConvertError) as e:
        parse_options({k: str(v) for k, v in form.items()})
    assert e.value.code == "bad_option"


def test_defaults():
    o = parse_options({})
    assert (o.dpi, o.format, o.color_mode, o.box, o.annotations, o.forms, o.rotation) == (150, "png", "rgb", "crop", True, True, None)


def test_scale_math_and_clamp():
    o = parse_options({"dpi": "150"})
    scale, clamped = scale_for(612, 792, o, 100_000_000)
    assert round(612 * scale) == 1275 and round(792 * scale) == 1650 and not clamped
    scale, _ = scale_for(612, 792, parse_options({"maxSide": "1000"}), 100_000_000)
    assert round(792 * scale) == 1000
    scale, clamped = scale_for(14400, 14400, o, 100_000_000)
    assert clamped and (14400 * scale) ** 2 <= 100_000_000


# ---- converting -------------------------------------------------------------------

def test_text_pdf_page_count_size_and_content(tmp_path, text_pdf):
    m = run(tmp_path, text_pdf, dpi=150)
    assert (m["pageCount"], m["renderedPages"], m["engine"]) == (1, 1, "pdfium")
    img = image_of(m)
    assert img.size == (1275, 1650) and m["pages"][0]["dpiUsed"] == 150.0
    assert img.convert("L").getextrema()[0] < 60  # dark text pixels exist


def test_image_pdf_renders_the_picture(tmp_path, image_pdf):
    img = image_of(run(tmp_path, image_pdf, dpi=72)).convert("RGB")
    assert img.size == (400, 300)
    assert img.getpixel((5, 5))[0] > 150 and img.getpixel((200, 150))[2] > 150  # red corner, blue middle


@pytest.mark.parametrize("fmt,mime_mode", [("png", "PNG"), ("jpeg", "JPEG"), ("webp", "WEBP"),
                                           ("avif", "AVIF"), ("tiff", "TIFF"), ("bmp", "BMP")])
def test_every_format_decodes(tmp_path, text_pdf, fmt, mime_mode):
    m = run(tmp_path, text_pdf, dpi=72, format=fmt)
    img = image_of(m)
    assert img.format == mime_mode and img.size == (612, 792)
    assert m["pages"][0]["file"].endswith({"jpeg": ".jpg"}.get(fmt, "." + fmt))


def test_max_side(tmp_path, text_pdf):
    img = image_of(run(tmp_path, text_pdf, maxSide=800))
    assert max(img.size) == 800


def test_color_modes(tmp_path, image_pdf):
    gray = image_of(run(tmp_path, image_pdf, colorMode="gray"))
    assert gray.mode == "L"
    bw = image_of(run(tmp_path, image_pdf, colorMode="bw"))
    assert bw.mode == "1" and set(np.unique(np.asarray(bw.convert("L")))) <= {0, 255}


def test_background_colour_and_transparency(tmp_path, text_pdf):
    red = image_of(run(tmp_path, text_pdf, dpi=72, background="#ff0000")).convert("RGB")
    assert red.getpixel((2, 2)) == (255, 0, 0)
    clear = image_of(run(tmp_path, text_pdf, dpi=72, background="transparent"))
    assert clear.mode == "RGBA" and clear.getpixel((2, 2))[3] == 0


def test_rotation_auto_honours_page_rotate_and_force_overrides(tmp_path, multi_pdf):
    m = run(tmp_path, multi_pdf, dpi=72)
    assert [(p["width"], p["height"]) for p in m["pages"]] == [(612, 792), (792, 612), (300, 300)]
    m0 = run(tmp_path, multi_pdf, dpi=72, rotation=0)
    assert (m0["pages"][1]["width"], m0["pages"][1]["height"]) == (612, 792)  # forced upright
    m90 = run(tmp_path, multi_pdf, dpi=72, rotation=90)
    assert (m90["pages"][0]["width"], m90["pages"][0]["height"]) == (792, 612)


def test_page_ranges_and_file_names(tmp_path, multi_pdf):
    m = run(tmp_path, multi_pdf, dpi=36, pages="2-")
    assert [p["file"] for p in m["pages"]] == ["page-002.png", "page-003.png"]
    assert m["pageCount"] == 3
    with pytest.raises(ConvertError) as e:
        run(tmp_path, multi_pdf, pages="9")
    assert e.value.code == "page_range_empty"


def test_names_widen_for_long_documents(tmp_path):
    m = run(tmp_path, many_pages(1200), Limits(max_pages=2000), dpi=36, pages="1,1000")
    assert [p["file"] for p in m["pages"]] == ["page-0001.png", "page-1000.png"]


# ---- passwords ---------------------------------------------------------------------

def test_password_missing_wrong_right(tmp_path, encrypted_pdf):
    for sub, form, code in (("m", {}, "pdf_password_required"), ("w", {"password": "nope"}, "pdf_bad_password")):
        with pytest.raises(ConvertError) as e:
            run(tmp_path, encrypted_pdf, **form)
        assert e.value.code == code
    m = run(tmp_path, encrypted_pdf, dpi=36, password=PASSWORD)
    assert m["renderedPages"] == 1


# ---- robustness ---------------------------------------------------------------------

def test_corrupt_and_not_a_pdf(tmp_path):
    with pytest.raises(ConvertError) as e:
        run(tmp_path, b"%PDF-1.4\n1 0 obj << /Broken garbage garbage")
    assert e.value.code == "pdf_corrupt"
    with pytest.raises(ConvertError) as e:
        run(tmp_path, b"PK\x03\x04 a zip file pretending")
    assert e.value.code == "unsupported_type"


def test_missing_xref_is_rebuilt(tmp_path, text_pdf):
    broken = text_pdf[: text_pdf.rindex(b"xref")]  # cut the cross-reference table and trailer
    assert run(tmp_path, broken, dpi=36)["renderedPages"] == 1


def test_truncated_file_is_handled_cleanly(tmp_path, multi_pdf):
    try:
        m = run(tmp_path, multi_pdf[: len(multi_pdf) * 2 // 3], dpi=36)
        assert m["renderedPages"] >= 1  # recovered some pages
    except ConvertError as e:
        assert e.code in ("pdf_corrupt", "all_pages_failed")


def test_zero_page_pdf(tmp_path):
    buf = io.BytesIO()
    pikepdf.new().save(buf)
    with pytest.raises(ConvertError) as e:
        run(tmp_path, buf.getvalue())
    assert e.value.code in ("no_pages", "pdf_corrupt")


def test_javascript_is_never_executed_just_rendered(tmp_path, javascript_pdf):
    assert run(tmp_path, javascript_pdf, dpi=36)["renderedPages"] == 1


def test_huge_page_is_clamped_and_reported(tmp_path, huge_page_pdf):
    small_cap = Limits(max_pixels_per_page=4_000_000)
    p = run(tmp_path, huge_page_pdf, small_cap, dpi=150)["pages"][0]
    assert p["clamped"] is True and p["dpiUsed"] < 150
    assert p["width"] * p["height"] <= 4_000_000


def test_one_bad_page_does_not_kill_the_job(tmp_path, multi_pdf, monkeypatch):
    original = render.PdfiumDocument.render

    def flaky(self, index, max_pixels):
        if index == 1:
            raise RuntimeError("damaged font")
        return original(self, index, max_pixels)

    monkeypatch.setattr(render.PdfiumDocument, "render", flaky)
    m = run(tmp_path, multi_pdf, dpi=36)
    assert [p["page"] for p in m["pages"]] == [1, 3]
    assert m["errors"] == [{"page": 2, "code": "render_failed", "message": "The page could not be drawn."}]
    with pytest.raises(ConvertError) as e:
        run(tmp_path, multi_pdf, dpi=36, strictPages="true")
    assert e.value.code == "page_failed"


def test_all_pages_failing_is_an_error(tmp_path, text_pdf, monkeypatch):
    monkeypatch.setattr(render.PdfiumDocument, "render", lambda *a: (_ for _ in ()).throw(RuntimeError("x")))
    with pytest.raises(ConvertError) as e:
        run(tmp_path, text_pdf)
    assert e.value.code == "all_pages_failed"


def test_caps(tmp_path):
    pdf = many_pages(5)
    with pytest.raises(ConvertError) as e:
        run(tmp_path, pdf, Limits(max_pages=4))
    assert e.value.code == "too_many_pages"
    with pytest.raises(ConvertError) as e:
        run(tmp_path, pdf, Limits(max_total_pixels=100_000), dpi=72)
    assert e.value.code == "output_too_large"
    with pytest.raises(ConvertError) as e:
        run(tmp_path, pdf, Limits(job_seconds=-1))
    assert e.value.code == "timeout"


# ---- other engines (only when installed) ----------------------------------------------

@pytest.mark.skipif(shutil.which("pdftoppm") is None or shutil.which("pdfinfo") is None, reason="poppler not installed")
def test_pdfium_matches_poppler(tmp_path, image_pdf):
    import numpy as np
    from app.options import parse_options as po
    src = tmp_path / "in.pdf"
    src.write_bytes(image_pdf)
    opts = po({"dpi": "72"})
    ext = render.ExternalDocument("poppler", str(src), opts, str(tmp_path), render._page_sizes(str(src), None))
    a = np.asarray(ext.render(0, 10**8).image.convert("L"), dtype=float)
    b = np.asarray(render.PdfiumDocument(str(src), opts).render(0, 10**8).image.convert("L"), dtype=float)
    assert a.shape == b.shape and np.abs(a - b).mean() < 8


@pytest.mark.skipif(shutil.which("gs") is None, reason="Ghostscript not installed")
def test_pdfium_matches_ghostscript(tmp_path, image_pdf):
    import numpy as np
    src = tmp_path / "in.pdf"
    src.write_bytes(image_pdf)
    opts = parse_options({"dpi": "72"})
    ext = render.ExternalDocument("gs", str(src), opts, str(tmp_path), render._page_sizes(str(src), None))
    a = np.asarray(ext.render(0, 10**8).image.convert("L"), dtype=float)
    b = np.asarray(render.PdfiumDocument(str(src), opts).render(0, 10**8).image.convert("L"), dtype=float)
    assert a.shape == b.shape and np.abs(a - b).mean() < 8
