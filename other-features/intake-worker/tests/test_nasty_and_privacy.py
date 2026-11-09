"""Part 10: the nasty-file set and the privacy set."""
import io
import struct
import zlib

import numpy as np
import pytest
from PIL import Image, ImageOps

from app import crypto, mask, yara_scan
from app.errors import StepError
from app.resave import resave, resave_picture, resave_pdf
from tests import cards as C
from tests.conftest import DATA_KEY, HOTEL, make_job, make_pipeline, opened
from tests.fake_clamd import eicar


def png_bytes(img: Image.Image, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", **kw)
    return buf.getvalue()


def rejected(pipeline, job):
    with pytest.raises(StepError) as e:
        pipeline.process(job)
    assert e.value.reject is True
    return e.value


def tiny_pdf(pages: int, extra: str = "") -> bytes:
    """A hand-written PDF (no library): `pages` blank pages; `extra` lets a test add active content."""
    objs = ["<< /Type /Catalog /Pages 2 0 R " + extra + ">>", f"<< /Type /Pages /Count {pages} /Kids [" + " ".join(f"{3 + i} 0 R" for i in range(pages)) + "] >>"]
    objs += [f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents {3 + pages} 0 R >>" for _ in range(pages)]
    objs.append("<< /Length 28 >>\nstream\nBT /F1 12 Tf (hello) Tj ET\nendstream")
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    return out + b"trailer\n<< /Root 1 0 R /Size " + str(len(objs) + 1).encode() + b" >>\n%%EOF"


@pytest.fixture()
def pipe(storage, engines, clamd):
    return make_pipeline(storage, engines, clamd.address)


# ---- nasty files ---------------------------------------------------------------------------

def test_eicar_inside_a_valid_picture_is_rejected(pipe, storage):
    data = png_bytes(C.unknown_card()) + eicar()  # appended after the PNG data
    err = rejected(pipe, make_job(storage, data))
    assert err.code == "malware_found" and not storage.uploads


def test_png_that_decodes_to_40000_by_40000_is_rejected_before_decoding():
    small = png_bytes(Image.new("L", (8, 8)))
    ihdr = struct.pack(">IIBBBBB", 40000, 40000, 8, 0, 0, 0, 0)
    bomb = small[:8] + struct.pack(">I", 13) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr)) + small[33:]
    with pytest.raises(StepError) as e:
        resave_picture(bomb)
    assert e.value.code == "too_many_pixels" and e.value.reject


def test_pdf_with_2000_pages_is_rejected_before_any_page_is_rendered():
    with pytest.raises(StepError) as e:
        resave_pdf(tiny_pdf(2000))
    assert e.value.code == "too_many_pages" and e.value.reject


ACTIVE_PDF = "/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> /Names << /EmbeddedFiles << /Names [(a.exe) 9 0 R] >> >>"


def zip_in_jpeg() -> bytes:
    buf = io.BytesIO()
    C.unknown_card().save(buf, "JPEG")
    return buf.getvalue() + b"PK\x03\x04" + b"\x00" * 26 + b"payload.txt" + b"PK\x05\x06" + b"\x00" * 18


@pytest.mark.skipif(not yara_scan.available(), reason="yara-python is not installed (requirements.txt)")
@pytest.mark.parametrize("data", [tiny_pdf(1, ACTIVE_PDF), zip_in_jpeg()])
def test_the_rule_scan_refuses_active_pdfs_and_polyglots(pipe, storage, data):
    assert rejected(pipe, make_job(storage, data, profile="document", gate_action="warn")).code == "yara_match"


@pytest.fixture()
def resave_only(storage, engines, monkeypatch):
    """The pixel re-save layer on its own (rule scan and clamd off), to prove it is a layer of its own."""
    monkeypatch.setattr(yara_scan, "available", lambda: False)
    return make_pipeline(storage, engines)


def test_pdf_with_javascript_and_an_attachment_becomes_plain_pixels(resave_only, storage):
    pipe = resave_only
    job = make_job(storage, tiny_pdf(1, ACTIVE_PDF), profile="document", gate_action="warn")  # the blank test page would be rejected by the gate
    pipe.process(job)
    out = opened(storage, job)
    assert out[:2] == b"\xff\xd8" or out[:4] == b"\x89PNG"  # a picture, not a PDF
    for needle in (b"%PDF", b"/JavaScript", b"/JS", b"EmbeddedFile"):
        assert needle not in out


def test_jpeg_that_is_also_a_zip_loses_the_zip(resave_only, storage):
    pipe = resave_only
    job = make_job(storage, zip_in_jpeg())
    pipe.process(job)
    out = opened(storage, job)
    assert b"PK\x03\x04" not in out and b"payload.txt" not in out


@pytest.mark.parametrize("name,data", [
    ("executable named .jpg", b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 200),
    ("svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ("text", b"just some text"),
    ("zip", b"PK\x03\x04" + b"\x00" * 100),
])
def test_other_types_are_rejected_before_decoding(pipe, storage, name, data):
    err = rejected(pipe, make_job(storage, data))
    assert err.code == "unsupported_type" and not storage.uploads


def test_a_26_mb_photo_is_rejected(pipe, storage):
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (26 * 1024 * 1024)
    assert rejected(pipe, make_job(storage, big)).code == "file_too_large"


def test_encrypted_and_corrupt_pdf_and_corrupt_picture():
    for data, code in ((b"%PDF-1.4 broken broken", "pdf_corrupt"), (b"\xff\xd8\xff\xe0" + b"\x00" * 50, "image_corrupt")):
        with pytest.raises(StepError) as e:
            resave(data)
        assert e.value.code == code and e.value.reject


def test_a_scanner_that_cannot_answer_is_a_retry_not_a_pass(storage, engines):
    pipe = make_pipeline(storage, engines, "tcp:127.0.0.1:1")
    with pytest.raises(StepError) as e:
        pipe.process(make_job(storage, png_bytes(C.unknown_card())))
    assert e.value.code == "scanner_unavailable" and not e.value.reject and not storage.uploads


# ---- privacy and quality ----------------------------------------------------------------------

def jpeg_with_gps(orientation=1) -> bytes:
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "InventedCamera"
    exif.get_ifd(0x8825).update({1: "N", 2: (12.0, 30.0, 0.0), 3: "E", 4: (77.0, 10.0, 0.0)})
    buf = io.BytesIO()
    C.aadhaar_front().save(buf, "JPEG", quality=95, exif=exif.tobytes())
    return buf.getvalue()


def test_gps_exif_is_gone_from_the_final_picture(pipe, storage):
    src = jpeg_with_gps()
    assert Image.open(io.BytesIO(src)).getexif().get_ifd(0x8825)
    job = make_job(storage, src)
    pipe.process(job)
    out = Image.open(io.BytesIO(opened(storage, job)))
    assert not out.getexif() and not out.getexif().get_ifd(0x8825) and b"InventedCamera" not in opened(storage, job)


@pytest.mark.parametrize("orientation", [1, 3, 6, 8])
def test_resaved_pixels_equal_the_input_pixels(orientation):
    """Part 10: the output pixels equal the input pixels before compression (the EXIF turn is applied, the values are untouched)."""
    src = jpeg_with_gps(orientation)
    expected = np.asarray(ImageOps.exif_transpose(Image.open(io.BytesIO(src))).convert("RGB"))
    got = resave_picture(src).pixels
    assert got.shape == expected.shape and np.array_equal(got, expected)


def test_png_pixels_are_identical_and_a_pdf_page_is_rendered_at_300_dpi():
    img = C.pan_card()
    src = png_bytes(img)
    assert np.array_equal(resave_picture(src).pixels, np.asarray(img.convert("RGB")))
    page = resave_pdf(tiny_pdf(1))[0]
    assert abs(page.pixels.shape[1] - round(200 / 72 * 300)) <= 1 and "hello" in page.hint_text


def test_nothing_is_masked_by_default_and_masking_is_a_setting(pipe, storage):
    job = make_job(storage, png_bytes(C.aadhaar_front()))
    result = pipe.process(job)
    assert result["scores"]["maskedNumbers"] == 0
    lines = [{"text": C.SPACED, "bbox": (40, 520, 640, 590)}, {"text": "Name Ramesh", "bbox": (40, 190, 400, 240)}]
    before = np.full((700, 1100, 3), 255, np.uint8)
    after, count = mask.mask_aadhaar(before, lines)
    assert count == 1 and (after[540, 100] == 0).all() and (after[540, 620] == 255).all()  # first eight digits painted, last four kept
    same, none = mask.mask_aadhaar(before, [{"text": "1234 5678 9012", "bbox": (0, 0, 100, 20)}])  # fails the Verhoeff check
    assert none == 0 and np.array_equal(same, before)


def test_the_final_picture_is_encrypted_and_only_the_job_can_open_it(pipe, storage):
    job = make_job(storage, png_bytes(C.pan_card()))
    pipe.process(job)
    sealed = storage.uploads[job["upload_url"]]
    assert sealed[:2] not in (b"\xff\xd8", b"\x89P")
    assert crypto.decrypt(sealed, DATA_KEY, b"job-0001")[:2] in (b"\xff\xd8", b"\x89P")
    with pytest.raises(StepError):
        crypto.decrypt(sealed, DATA_KEY, b"another-job")  # bound to its job
    with pytest.raises(StepError):
        crypto.decrypt(sealed[:-1] + bytes([sealed[-1] ^ 1]), DATA_KEY, b"job-0001")  # tampering is detected


def test_a_wrong_master_key_stops_the_job_and_uploads_nothing(storage, engines, clamd):
    pipe = make_pipeline(storage, engines, clamd.address)
    job = make_job(storage, png_bytes(C.pan_card()), wrapped_key=crypto.wrap_key(DATA_KEY, b"\x01" * 32, HOTEL.encode()))
    with pytest.raises(StepError) as e:
        pipe.process(job)
    assert e.value.code == "key_unwrap_failed" and not storage.uploads


def test_links_outside_the_allow_list_are_refused(storage, engines, clamd):
    pipe = make_pipeline(storage, engines, clamd.address)
    job = make_job(storage, png_bytes(C.pan_card()))
    job["download_url"] = "https://evil.example.org/x"
    with pytest.raises(StepError) as e:
        pipe.process(job)
    assert e.value.code == "link_not_allowed"
    job2 = make_job(storage, png_bytes(C.pan_card()), job_id="job-2")
    job2["upload_url"] = "http://" + job2["upload_url"][8:]
    with pytest.raises(StepError) as e:
        pipe.process(job2)
    assert e.value.code == "link_not_allowed"
