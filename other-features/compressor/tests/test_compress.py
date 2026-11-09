import io
import struct
import zlib

import numpy as np
import pikepdf
import pypdfium2 as pdfium
import pytest
from PIL import Image

from app import tools
from app.errors import CompressorError
from app.images import avif_supported, strip_jpeg
from app.jobs import run_job
from app.limits import Limits
from app.modes import MODES, MAX_CAP, SizeRule
from app.quality import ssim
from app.sniff import sniff
from tests.conftest import pdf_with_image, photo_like, to_bytes

LIMITS = Limits()
NO_CAP = SizeRule(MAX_CAP, MAX_CAP)


def decode(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


# ---- type sniffing -----------------------------------------------------------

def test_sniff_uses_bytes_not_names(png_text):
    assert sniff(png_text[:64]) == "png"  # a file called x.jpg with PNG bytes is a PNG
    assert sniff(b"%PDF-1.7\n") == "pdf"
    assert sniff(b"MZ\x90\x00 not a picture") is None
    assert sniff(b"\x00\x00\x00\x18ftypheic....") == "heic"
    assert sniff(b"\x00\x00\x00\x1cftypavif....") == "avif"


def test_unknown_bytes_refused():
    with pytest.raises(CompressorError) as e:
        run_job(b"hello, plain text file", "balanced", "auto", LIMITS)
    assert e.value.code == "unsupported_type"


# ---- quality thresholds ------------------------------------------------------

@pytest.mark.parametrize("mode", ["balanced", "strict", "max"])
@pytest.mark.parametrize("fmt", ["jpeg", "webp", "avif"])
def test_mode_threshold_holds(jpeg_photo, mode, fmt):
    if fmt == "avif" and not avif_supported():
        pytest.skip("AVIF encoder not available")
    # A cap far away: this checks the score floor alone (strict WebP is otherwise brought under 500 KB, see test_size_rule).
    out = run_job(jpeg_photo, mode, fmt, LIMITS, NO_CAP)
    assert out.fmt == fmt
    # Recompute the score independently from the finished file.
    assert ssim(decode(jpeg_photo), decode(out.data)) >= MODES[mode].ssim_min - 0.002


def test_photo_shrinks_a_lot(jpeg_photo):
    out = run_job(jpeg_photo, "balanced", "auto", LIMITS)
    assert out.result_bytes < out.original_bytes * 0.8


def test_strict_is_not_smaller_than_max(jpeg_photo):
    strict = run_job(jpeg_photo, "strict", "jpeg", LIMITS)
    maxed = run_job(jpeg_photo, "max", "jpeg", LIMITS)
    assert strict.result_bytes >= maxed.result_bytes


def test_original_kept_when_nothing_gained():
    tiny = to_bytes(photo_like(64, 48), "JPEG", quality=25)
    out = run_job(tiny, "balanced", "auto", LIMITS)
    assert out.result_bytes <= len(tiny)


def test_flat_graphic_stays_exact(png_text):
    out = run_job(png_text, "balanced", "auto", LIMITS)
    assert out.fmt in ("png", "webp")
    assert np.array_equal(np.asarray(decode(png_text).convert("RGB")), np.asarray(decode(out.data).convert("RGB")))


def test_lossless_png_is_pixel_exact(png_text):
    out = run_job(png_text, "lossless", "auto", LIMITS)
    assert np.array_equal(np.asarray(decode(png_text)), np.asarray(decode(out.data).convert("RGB")))
    assert out.result_bytes <= len(png_text)


def test_lossless_jpeg_keeps_pixels_without_reencoding(jpeg_photo):
    out = run_job(jpeg_photo, "lossless", "auto", LIMITS)
    assert out.fmt == "jpeg" and out.score == 1.0
    assert np.array_equal(np.asarray(decode(jpeg_photo)), np.asarray(decode(out.data)))


def test_lossless_refuses_lossy_output(jpeg_photo):
    with pytest.raises(CompressorError) as e:
        run_job(jpeg_photo, "lossless", "avif", LIMITS)
    assert e.value.code == "lossless_unsupported_output"


def test_bad_mode_and_output(jpeg_photo):
    with pytest.raises(CompressorError) as e:
        run_job(jpeg_photo, "tiny", "auto", LIMITS)
    assert e.value.code == "bad_mode"
    with pytest.raises(CompressorError) as e:
        run_job(jpeg_photo, "balanced", "bmp", LIMITS)
    assert e.value.code == "bad_output"


# ---- metadata ----------------------------------------------------------------

def _jpeg_with_gps(orientation: int = 1) -> bytes:
    img = photo_like(400, 300)
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "InventedCamera"
    exif.get_ifd(0x8825).update({1: "N", 2: (12.0, 30.0, 0.0), 3: "E", 4: (77.0, 10.0, 0.0)})
    return to_bytes(img, "JPEG", quality=90, exif=exif.tobytes())


@pytest.mark.parametrize("mode", ["balanced", "lossless"])
def test_gps_and_exif_are_stripped(mode):
    src = _jpeg_with_gps()
    assert decode(src).getexif().get_ifd(0x8825)  # sanity: the sample really had GPS
    out = run_job(src, mode, "auto", LIMITS)
    exif = decode(out.data).getexif()
    assert not exif.get_ifd(0x8825) and 0x010F not in exif


def test_orientation_is_applied_or_kept():
    src = _jpeg_with_gps(orientation=6)  # 400x300 stored, shown as 300x400
    out = run_job(src, "balanced", "jpeg", LIMITS)
    assert decode(out.data).size == (300, 400)
    lossless = run_job(src, "lossless", "auto", LIMITS)
    assert decode(lossless.data).getexif().get(0x0112) == 6  # rotation tag survives, GPS does not


def test_strip_jpeg_rejects_garbage():
    assert strip_jpeg(b"not a jpeg", 1) is None


# ---- caps --------------------------------------------------------------------

def test_size_cap(jpeg_photo):
    with pytest.raises(CompressorError) as e:
        run_job(jpeg_photo, "balanced", "auto", Limits(max_bytes=1000))
    assert e.value.code == "too_large"


def test_pixel_cap(jpeg_photo):
    with pytest.raises(CompressorError) as e:
        run_job(jpeg_photo, "balanced", "auto", Limits(max_pixels=10_000))
    assert e.value.code == "too_many_pixels"


def test_bomb_like_png_refused_without_decoding():
    small = to_bytes(Image.new("L", (8, 8), 0), "PNG")
    ihdr = struct.pack(">IIBBBBB", 60000, 60000, 8, 0, 0, 0, 0)  # claims 3.6 gigapixels
    crc = struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
    bomb = small[:8] + struct.pack(">I", 13) + b"IHDR" + ihdr + crc + small[33:]
    with pytest.raises(CompressorError) as e:
        run_job(bomb, "balanced", "auto", LIMITS)
    assert e.value.code == "too_many_pixels"


def test_corrupt_image_refused(jpeg_photo):
    with pytest.raises(CompressorError) as e:
        run_job(jpeg_photo[:600], "balanced", "auto", LIMITS)
    assert e.value.code == "image_corrupt"


# ---- PDFs --------------------------------------------------------------------

@pytest.fixture(scope="module")
def sample_pdf() -> bytes:
    return pdf_with_image(photo_like(1800, 1200))


def page_text(data: bytes) -> str:
    doc = pdfium.PdfDocument(data)
    try:
        page = doc[0]
        text = page.get_textpage().get_text_range()
        page.close()
        return text
    finally:
        doc.close()


@pytest.mark.parametrize("mode", ["balanced", "strict", "max"])
def test_pdf_shrinks_and_keeps_text(sample_pdf, mode):
    out = run_job(sample_pdf, mode, "auto", LIMITS)
    assert out.fmt == "pdf"
    assert out.result_bytes < out.original_bytes
    assert "Total due 4321.00" in page_text(out.data)  # text layer untouched
    assert out.score >= MODES[mode].ssim_min


def test_pdf_lossless_keeps_content(sample_pdf):
    out = run_job(sample_pdf, "lossless", "auto", LIMITS)
    assert "images" not in "".join(out.notes)
    assert out.score >= 0.9999


def test_encrypted_pdf_refused(sample_pdf):
    pdf = pikepdf.open(io.BytesIO(sample_pdf))
    buf = io.BytesIO()
    pdf.save(buf, encryption=pikepdf.Encryption(user="a", owner="b"))
    with pytest.raises(CompressorError) as e:
        run_job(buf.getvalue(), "balanced", "auto", LIMITS)
    assert e.value.code == "pdf_encrypted"


def test_owner_only_encrypted_pdf_refused(sample_pdf):
    pdf = pikepdf.open(io.BytesIO(sample_pdf))
    buf = io.BytesIO()
    pdf.save(buf, encryption=pikepdf.Encryption(user="", owner="b"))
    with pytest.raises(CompressorError) as e:
        run_job(buf.getvalue(), "balanced", "auto", LIMITS)
    assert e.value.code == "pdf_encrypted"


def test_corrupt_pdf_refused():
    with pytest.raises(CompressorError) as e:
        run_job(b"%PDF-1.4\n1 0 obj << /Broken", "balanced", "auto", LIMITS)
    assert e.value.code == "pdf_corrupt"


def test_pdf_page_cap(sample_pdf):
    with pytest.raises(CompressorError) as e:
        run_job(sample_pdf, "balanced", "auto", Limits(max_pages=0))
    assert e.value.code == "too_many_pages"


@pytest.mark.skipif(not tools.available()["gs"], reason="Ghostscript not installed")
def test_ghostscript_path_runs(sample_pdf, tmp_path):
    out = tools.ghostscript(sample_pdf, str(tmp_path), 150, 0.4, 60)
    assert out is not None and out.startswith(b"%PDF")


@pytest.mark.skipif(not tools.available()["oxipng"], reason="oxipng not installed")
def test_oxipng_path_runs(png_text, tmp_path):
    out = tools.oxipng(png_text, str(tmp_path))
    assert out is not None and decode(out).size == decode(png_text).size
