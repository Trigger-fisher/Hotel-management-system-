import io

import pikepdf
import pytest
from PIL import Image

from app import disarm_pdf
from app.clam import ClamClient, parse_version
from app.config import ConfigError, WorkerConfig, load_settings
from app.errors import ServiceError
from app.pipeline import scan_job
from app.sniff import sniff
from tests.conftest import armed_pdf, jpeg_with_gps, picture, to_bytes
from tests.fake_clamd import FakeClamd, eicar


def cfg(clamd="", **kw) -> WorkerConfig:
    base = dict(clamd=clamd, clamd_timeout=5, max_bytes=5_000_000, max_pixels=4_000_000, max_pages=10,
                job_seconds=60, strip_uri=False)
    return WorkerConfig(**(base | kw))


# ---- clamd protocol and malware ---------------------------------------------

def test_instream_clean_and_infected(clamd):
    client = ClamClient(clamd.address)
    assert client.ping() and parse_version(client.version())[0].startswith("ClamAV")
    assert client.scan(b"ordinary bytes").infected is False
    found = client.scan(b"prefix " + eicar())
    assert found.infected and found.signature == "Eicar-Test-Signature"


def test_large_stream_is_chunked(clamd):
    assert ClamClient(clamd.address).scan(b"a" * 300_000).infected is False


def test_unreachable_scanner_is_an_error_not_clean():
    with pytest.raises(ServiceError) as e:
        scan_job(to_bytes(picture(), "PNG"), cfg(clamd="tcp:127.0.0.1:1"))
    assert e.value.code == "scanner_unavailable"


def test_scanner_error_reply_is_never_clean():
    with FakeClamd(mode="error") as fake, pytest.raises(ServiceError) as e:
        scan_job(to_bytes(picture(), "PNG"), cfg(clamd=fake.address))
    assert e.value.code == "scanner_error"


def test_eicar_in_a_pdf_is_rejected_and_not_passed_on(clamd):
    data = armed_pdf() + b"\n%" + eicar()
    v = scan_job(data, cfg(clamd=clamd.address))
    assert (v.verdict, v.code, v.data) == ("rejected", "malware_found", b"")
    assert v.detail == "Eicar-Test-Signature"


# ---- type and caps -------------------------------------------------------------

def test_png_bytes_named_pdf_are_handled_as_png(clamd):
    assert sniff(to_bytes(picture(), "PNG")[:64]) == "png"
    v = scan_job(to_bytes(picture(), "PNG"), cfg(clamd=clamd.address))
    assert v.verdict == "clean" and v.mime == "image/png"


@pytest.mark.parametrize("data,code", [
    (b"just text", "unsupported_type"),
    (b"MZ\x90\x00" + b"x" * 100, "unsupported_type"),
])
def test_unsupported_types_rejected(data, code):
    assert scan_job(data, cfg()).code == code


def test_every_cap_has_a_code():
    big = to_bytes(picture(), "PNG")
    assert scan_job(big, cfg(max_bytes=100)).code == "file_too_large"
    assert scan_job(big, cfg(max_pixels=100)).code == "too_many_pixels"
    assert scan_job(armed_pdf(), cfg(max_pages=0)).code == "too_many_pages"
    assert scan_job(big[:80], cfg()).code == "image_corrupt"
    assert scan_job(b"%PDF-1.4\n1 0 obj << /Broken", cfg()).code == "pdf_corrupt"


def test_encrypted_pdf_rejected():
    pdf = pikepdf.new()
    pdf.add_blank_page()
    buf = io.BytesIO()
    pdf.save(buf, encryption=pikepdf.Encryption(user="u", owner="o"))
    assert scan_job(buf.getvalue(), cfg()).code == "pdf_encrypted"
    buf = io.BytesIO()
    pdf.save(buf, encryption=pikepdf.Encryption(user="", owner="o"))
    assert scan_job(buf.getvalue(), cfg()).code == "pdf_encrypted"


# ---- disarm: images ------------------------------------------------------------

def test_image_gps_exif_and_trailing_payload_removed(clamd):
    src = jpeg_with_gps()
    assert Image.open(io.BytesIO(src)).getexif().get_ifd(0x8825)
    v = scan_job(src, cfg(clamd=clamd.address))
    assert v.verdict == "clean" and {"gps", "trailing_data", "reencoded"} <= set(v.disarmed)
    out = Image.open(io.BytesIO(v.data))
    assert not out.getexif().get_ifd(0x8825) and 0x010F not in out.getexif()
    assert b"TRAILING-PAYLOAD" not in v.data and out.size == (300, 200)


def test_plain_jpg_when_asked():
    for kind, fmt in (("webp", "WEBP"), ("png", "PNG"), ("bmp", "BMP"), ("tiff", "TIFF")):
        v = scan_job(to_bytes(picture(), fmt), cfg(), output="jpeg")
        assert v.verdict == "clean" and sniff(v.data[:64]) == "jpeg", kind


def test_formats_stay_usable_by_default():
    expected = {"PNG": "png", "JPEG": "jpeg", "GIF": "gif", "WEBP": "webp", "BMP": "png", "TIFF": "png"}
    for fmt, kind in expected.items():
        v = scan_job(to_bytes(picture(), fmt), cfg())
        assert sniff(v.data[:64]) == kind, fmt


def test_text_chunk_in_png_removed():
    from PIL.PngImagePlugin import PngInfo
    info = PngInfo()
    info.add_text("Comment", "hidden note")
    v = scan_job(to_bytes(picture(), "PNG", pnginfo=info), cfg())
    assert "text_chunks" in v.disarmed and b"hidden note" not in v.data


def test_animated_gif_rebuilt():
    frames = [picture().copy() for _ in range(3)]
    gif = to_bytes(frames[0], "GIF", save_all=True, append_images=frames[1:], duration=50)
    v = scan_job(gif, cfg())
    assert v.verdict == "clean" and Image.open(io.BytesIO(v.data)).n_frames >= 1


# ---- disarm: PDFs ---------------------------------------------------------------

def test_pdf_comes_out_without_javascript_and_openaction():
    src = armed_pdf()
    assert b"/JavaScript" in src and b"/OpenAction" in src
    v = scan_job(src, cfg())
    assert v.verdict == "clean"
    assert {"javascript", "open_action", "launch", "embedded_files", "auto_actions"} <= set(v.disarmed)
    out = pikepdf.open(io.BytesIO(v.data))
    assert not disarm_pdf.residual(out, strip_uri=False)
    for needle in (b"/JS", b"/JavaScript", b"/OpenAction", b"/Launch", b"/EmbeddedFile", b"/AA"):
        assert needle not in v.data
    assert len(out.pages) == 1


def test_pdf_text_survives_rebuild():
    v = scan_job(armed_pdf(), cfg())
    pdf = pikepdf.open(io.BytesIO(v.data))
    assert b"Hello invented page" in pdf.pages[0].Contents.read_bytes()


def test_uri_links_kept_unless_setting_says_strip():
    kept = pikepdf.open(io.BytesIO(scan_job(armed_pdf(), cfg()).data))
    assert any("/A" in a for a in kept.pages[0].Annots)
    v = scan_job(armed_pdf(), cfg(strip_uri=True))
    assert "uri" in v.disarmed
    pdf = pikepdf.open(io.BytesIO(v.data))
    assert not any("/A" in a for a in pdf.pages[0].Annots)


# ---- config ------------------------------------------------------------------------

@pytest.mark.parametrize("key", ["", "short", "x" * 31])
def test_refuses_to_start_without_a_real_key(key):
    with pytest.raises(ConfigError):
        load_settings({"SCANNER_KEY": key})


def test_bad_clamd_address_refused():
    with pytest.raises(ConfigError):
        load_settings({"SCANNER_KEY": "k" * 40, "SCANNER_CLAMD": "http://x"})


# ---- real ClamAV (skipped unless a clamd answers) ------------------------------------

def _real_clamd() -> str | None:
    import os
    addr = os.environ.get("SCANNER_CLAMD_TEST", "")
    if addr and ClamClient(addr, 3).ping():
        return addr
    return None


@pytest.mark.skipif(_real_clamd() is None, reason="no real clamd reachable (set SCANNER_CLAMD_TEST)")
def test_real_clamav_flags_eicar_and_passes_clean():
    client = ClamClient(_real_clamd(), 30)
    assert client.scan(eicar()).infected
    assert not client.scan(to_bytes(picture(), "PNG")).infected


