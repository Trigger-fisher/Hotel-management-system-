"""YARA engine tests. Invented files only; EICAR is built in memory."""
from __future__ import annotations

import io

import pikepdf
import pytest

from app import yara_scan
from app.pipeline import scan_job
from tests.conftest import armed_pdf, picture, to_bytes
from tests.fake_clamd import eicar
from tests.test_pipeline import cfg


def ycfg(clamd="", **kw):
    return cfg(clamd, yara="reject", **kw)


def pdf_with(**root_items) -> bytes:
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(200, 200))
    for k, v in root_items.items():
        setattr(pdf.Root, k, v)
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def clean_pdf() -> bytes:
    return pdf_with()


def test_clean_pdf_and_clean_images_pass():
    v = scan_job(clean_pdf(), ycfg())
    assert v.verdict == "clean" and "YARA" in v.engine
    for fmt in ("PNG", "JPEG", "GIF", "WEBP"):
        assert scan_job(to_bytes(picture(), fmt), ycfg()).verdict == "clean", fmt


def test_pdf_with_javascript_and_launch_caught_by_yara():
    v = scan_job(armed_pdf(), ycfg())
    assert (v.verdict, v.code) == ("rejected", "yara_match")
    assert "pdf_javascript" in v.detail and "pdf_launch_action" in v.detail and "pdf_embedded_file" in v.detail


def test_javascript_alone_caught():
    js = pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert(1)"))
    v = scan_job(pdf_with(OpenAction=js), ycfg())
    assert v.code == "yara_match" and "pdf_javascript" in v.detail


def test_hash_escaped_name_is_normalised():
    raw = clean_pdf().replace(b"%%EOF", b"1 0 obj << /S /J#61vaScript /J#53 (x) >> endobj\n%%EOF")
    assert "pdf_javascript" in yara_scan.scan(raw, "pdf")[0]


def test_report_mode_notes_and_still_disarms():
    v = scan_job(armed_pdf(), cfg(yara="report"))
    assert v.verdict == "clean" and any(n.startswith("yara:pdf_javascript") for n in v.notes)


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "GIF", "WEBP"])
def test_executable_after_end_marker_is_rejected(fmt):
    data = to_bytes(picture(), fmt) + b"MZ" + b"\x90" * 20 + b"This program cannot be run in DOS mode.\r\n"
    v = scan_job(data, ycfg())
    assert (v.verdict, v.code) == ("rejected", "yara_match")


def test_script_after_end_marker_is_rejected():
    v = scan_job(to_bytes(picture(), "PNG") + b"<?php system($_GET['c']); ?>", ycfg())
    assert v.code == "yara_match" and "trailing_script" in v.detail


def test_archive_after_end_marker_is_rejected():
    v = scan_job(to_bytes(picture(), "JPEG") + b"PK\x03\x04" + b"0" * 30, ycfg())
    assert v.code == "yara_match" and "trailing_executable_or_archive" in v.detail


def test_polyglot_zip_inside_image():
    zipish = b"PK\x03\x04aaaa" + b"PK\x01\x02bbbb" + b"PK\x05\x06cccc"
    v = scan_job(to_bytes(picture(), "PNG") + zipish, ycfg())
    assert v.code == "yara_match" and "polyglot_zip_archive" in v.detail


def test_plain_trailing_data_is_flagged_but_not_rejected():
    data = to_bytes(picture(), "PNG") + b"just some invented bytes"
    assert yara_scan.scan(data, "png") == ([], 24)
    v = scan_job(data, ycfg())
    assert v.verdict == "clean" and "trailing_data" in v.notes


def test_engines_named_together_with_clamd(clamd):
    v = scan_job(to_bytes(picture(), "PNG"), ycfg(clamd.address))
    assert "+YARA" in v.engine and v.engine.startswith("ClamAV") or v.engine.startswith("fake")


def test_eicar_whole_file_caught_by_clamd_before_yara(clamd):
    v = scan_job(eicar(), ycfg(clamd.address))
    assert (v.code, v.detail) == ("malware_found", "Eicar-Test-Signature")



def _real():
    import os
    from app.clam import ClamClient
    a = os.environ.get("SCANNER_CLAMD_TEST", "")
    return a if a and ClamClient(a, 3).ping() else None


@pytest.mark.skipif(_real() is None, reason="no real clamd reachable (set SCANNER_CLAMD_TEST)")
def test_real_clamav_plus_yara_pipeline():
    a = _real()
    whole = scan_job(eicar(), ycfg(a))
    assert (whole.code, whole.detail) == ("malware_found", "Eicar-Test-Signature")
    assert whole.engine.startswith("ClamAV") and "YARA" in whole.engine
    assert scan_job(to_bytes(picture(), "PNG"), ycfg(a)).verdict == "clean"
    assert scan_job(clean_pdf(), ycfg(a)).verdict == "clean"
    assert scan_job(armed_pdf(), ycfg(a)).code == "yara_match"
    assert scan_job(to_bytes(picture(), "PNG") + b"<?php eval($_POST[1]); ?>", ycfg(a)).code == "yara_match"
