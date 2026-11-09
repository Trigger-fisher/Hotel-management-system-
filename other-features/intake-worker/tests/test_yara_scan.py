"""The scan step's YARA rules and the signature-age watch. Invented files only (gradients, noise, hand-written PDFs)."""
from __future__ import annotations

import io
import os
import time
import zipfile
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from PIL import Image

from app import signatures, yara_scan
from app.errors import StepError
from tests import cards as C
from tests.conftest import make_job, make_pipeline
from tests.fake_clamd import eicar

yara = pytest.importorskip("yara", reason="yara-python is not installed (requirements.txt)")


def photo(width=640, height=480, fmt="JPEG", seed=1, **kw) -> bytes:
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 255, width, dtype=np.float32)[None, :, None]
    y = np.linspace(0, 255, height, dtype=np.float32)[:, None, None]
    pixels = (x * 0.6 + y * 0.4 + rng.normal(0, 28, (height, width, 3))).clip(0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, fmt, **kw)
    return buf.getvalue()


def pdf(extra: str = "") -> bytes:
    objs = ["<< /Type /Catalog /Pages 2 0 R " + extra + ">>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
            "<< /Length 28 >>\nstream\nBT /F1 12 Tf (hello) Tj ET\nendstream"]
    out = b"%PDF-1.4\n"
    for i, o in enumerate(objs, 1):
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    return out + b"trailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF\n"


def zip_file() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("run.bat", "echo invented test payload")
    return buf.getvalue()


def rules_hit(data: bytes, kind: str) -> list[str]:
    return [rule for rule, _ in yara_scan.scan(data, kind)]


ELF = b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 56
PHP = b"<?php system($_GET['c']); ?>"


@pytest.mark.parametrize("data,kind", [
    (photo(), "jpeg"), (photo(fmt="PNG"), "png"), (photo(fmt="WEBP", quality=80), "webp"), (pdf(), "pdf"),
    (photo(exif=Image.Exif()), "jpeg"), (photo(progressive=True, quality=92), "jpeg"),
])
def test_clean_pictures_and_pdfs_pass(data, kind):
    assert yara_scan.scan(data, kind) == []


def test_a_jpeg_that_is_also_a_zip_is_refused():
    hits = rules_hit(photo() + zip_file(), "jpeg")
    assert "polyglot_zip_archive" in hits and "trailing_executable_or_archive" in hits


def test_a_jpeg_with_a_script_tail_is_refused():
    hits = rules_hit(photo() + PHP, "jpeg")
    assert "image_embedded_script" in hits and "trailing_script" in hits


@pytest.mark.parametrize("tail", [b"<script>fetch('/x')</script>", b"#!/bin/sh\nrm -rf /tmp/x\n",
                                  b"<%@ page import=\"java.io.*\" %>", b"powershell -nop -w hidden -enc AAAA"])
def test_other_script_tails_are_refused(tail):
    assert rules_hit(photo(fmt="PNG") + tail, "png")


def test_a_program_hidden_behind_a_fake_end_marker_is_still_found():
    data = photo() + ELF + b"\xff\xd9"
    assert yara_scan.trailing_bytes(data, "jpeg").startswith(ELF)
    assert "trailing_executable_or_archive" in rules_hit(data, "jpeg")
    png = photo(fmt="PNG")
    assert "trailing_executable_or_archive" in rules_hit(png + ELF + png[-12:], "png")


def test_web_page_and_pdf_inside_a_picture_are_refused():
    page = b"<html><body><iframe src=x></iframe></body></html>"
    assert "polyglot_html_document" in rules_hit(photo()[:-2] + page + b"\xff\xd9", "jpeg")
    assert "polyglot_pdf_document" in rules_hit(photo(fmt="PNG") + pdf(), "png")


def test_pdf_active_content_is_refused_even_when_hex_escaped():
    assert "pdf_javascript" in rules_hit(pdf("/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> "), "pdf")
    assert "pdf_javascript" in rules_hit(pdf("/OpenAction << /S /J#61vaScript /JS (x) >> "), "pdf")
    assert "pdf_launch_action" in rules_hit(pdf("/OpenAction << /S /Launch /F (cmd.exe) >> "), "pdf")
    assert "pdf_embedded_file" in rules_hit(pdf("/Names << /EmbeddedFiles << /Names [(a.exe) 9 0 R] >> >> "), "pdf")
    assert "trailing_script" in rules_hit(pdf() + b"<script>x()</script>", "pdf")


def test_random_bytes_after_a_photo_are_not_a_false_alarm():
    """A phone's motion photo appends a video after the picture: random-looking bytes must not match a rule."""
    rng = np.random.default_rng(7)
    base = photo()
    for _ in range(8):
        tail = b"\x00\x00\x00\x18ftypmp42" + rng.integers(0, 256, 2_000_000, dtype=np.uint8).tobytes()
        assert yara_scan.scan(base + tail, "jpeg") == []


def test_a_rule_hit_in_the_pipeline_is_a_refusal_with_a_code_and_clamd_is_not_asked(storage, engines, clamd):
    pipe = make_pipeline(storage, engines, clamd.address)
    buf = io.BytesIO()
    C.unknown_card().save(buf, "JPEG")
    with pytest.raises(StepError) as e:
        pipe.process(make_job(storage, buf.getvalue() + zip_file()))
    assert e.value.code == "yara_match" and e.value.reject and e.value.step == "scan"
    assert clamd.scanned == 0 and not storage.uploads


def test_eicar_passes_the_rules_and_is_caught_by_clamd(storage, engines, clamd):
    data = photo(fmt="PNG") + eicar()
    assert yara_scan.scan(data, "png") == []
    pipe = make_pipeline(storage, engines, clamd.address)
    with pytest.raises(StepError) as e:
        pipe.process(make_job(storage, data))
    assert e.value.code == "malware_found" and e.value.reject


def test_a_clean_file_names_both_engines(storage, engines, clamd):
    pipe = make_pipeline(storage, engines, clamd.address)
    engine = pipe.scan(photo())
    assert "ClamAV" in engine and "YARA" in engine and clamd.scanned == 1


class _Broken:
    def __init__(self, error):
        self.error = error

    def match(self, **kw):
        raise self.error


@pytest.mark.parametrize("error,code", [(yara.TimeoutError("slow"), "yara_timeout"), (yara.Error("broken"), "yara_error")])
def test_an_engine_timeout_or_error_is_a_retry_never_clean(monkeypatch, error, code):
    monkeypatch.setattr(yara_scan, "rules", lambda: _Broken(error))
    with pytest.raises(StepError) as e:
        yara_scan.scan(photo(), "jpeg")
    assert e.value.code == code and not e.value.reject


def test_the_time_limit_is_passed_to_the_engine(monkeypatch):
    seen = []

    class Spy:
        def match(self, data, timeout):
            seen.append(timeout)
            return []

    monkeypatch.setattr(yara_scan, "rules", lambda: Spy())
    yara_scan.scan(photo() + b"x", "jpeg")
    assert seen and all(1 <= t <= yara_scan.YARA_SECONDS for t in seen)


def test_too_large_for_the_rule_scan_is_refused(monkeypatch):
    monkeypatch.setattr(yara_scan, "YARA_MAX_BYTES", 1000)
    with pytest.raises(StepError) as e:
        yara_scan.scan(photo(), "jpeg")
    assert e.value.code == "yara_too_large" and e.value.reject


def test_without_the_rule_engine_the_worker_does_not_scan_as_clean(monkeypatch, storage, engines, clamd):
    monkeypatch.setattr(yara_scan, "available", lambda: False)
    pipe = make_pipeline(storage, engines, clamd.address, allow_no_av=False)
    with pytest.raises(StepError) as e:
        pipe.scan(photo())
    assert e.value.code == "yara_unavailable" and not e.value.reject


def test_a_rule_hit_logs_rule_names_only(log_lines):
    yara_scan.scan(photo() + PHP, "jpeg")
    text = log_lines.getvalue()
    assert "yara_match" in text and "image_embedded_script" in text and "system" not in text and "GET" not in text


def test_scan_of_a_3_mb_photo_is_quick():
    data = photo(2600, 1950, quality=95)
    assert len(data) > 2_500_000
    yara_scan.scan(data, "jpeg")
    start = time.perf_counter()
    for _ in range(5):
        assert yara_scan.scan(data, "jpeg") == []
    assert (time.perf_counter() - start) / 5 < 0.2


# ---- signature age (heartbeat and the 48-hour alert) -------------------------------------------

def test_official_date_from_clamd_and_its_age():
    when = signatures.official_time("Tue Nov  3 07:25:00 2026")
    assert when == datetime(2026, 11, 3, 7, 25, tzinfo=timezone.utc)
    assert signatures.age_hours(when + timedelta(hours=47), when) is None
    assert signatures.age_hours(when + timedelta(hours=49), when) == 49
    assert signatures.age_hours(when, None) == -1


def test_feeds_folder_age_ignores_the_official_files(tmp_path):
    (tmp_path / "daily.cld").write_bytes(b"x")
    assert signatures.feed_time(str(tmp_path)) is None
    (tmp_path / "foxhole_generic.cdb").write_bytes(b"x")
    old = time.time() - 72 * 3600
    os.utime(tmp_path / "foxhole_generic.cdb", (old, old))
    assert abs(signatures.feed_time(str(tmp_path)).timestamp() - old) < 2


def test_the_feeds_stamp_wins_over_the_files(tmp_path):
    (tmp_path / "badmacro.ndb").write_bytes(b"x")
    old = time.time() - 72 * 3600
    os.utime(tmp_path / "badmacro.ndb", (old, old))
    (tmp_path / signatures.STAMP).write_bytes(b"")
    assert time.time() - signatures.feed_time(str(tmp_path)).timestamp() < 60


def test_stale_signatures_are_logged_at_most_once_an_hour(tmp_path, log_lines):
    (tmp_path / "foxhole_generic.cdb").write_bytes(b"x")
    old = time.time() - 50 * 3600
    os.utime(tmp_path / "foxhole_generic.cdb", (old, old))
    clock = [0.0]
    watch = signatures.Watch(str(tmp_path), clock=lambda: clock[0])
    assert watch.feeds()
    watch.feeds()
    assert log_lines.getvalue().count("sanesecurity_stale") == 1
    clock[0] = 3601
    watch.feeds()
    assert log_lines.getvalue().count("sanesecurity_stale") == 2
    watch.official("Tue Nov  3 07:25:00 2020")
    assert "clamav_signatures_stale" in log_lines.getvalue()


def test_fresh_signatures_say_nothing(tmp_path, log_lines):
    (tmp_path / "foxhole_generic.cdb").write_bytes(b"x")
    watch = signatures.Watch(str(tmp_path))
    watch.feeds()
    watch.official(datetime.now(timezone.utc).strftime("%a %b %d %H:%M:%S %Y"))
    assert "stale" not in log_lines.getvalue()
    assert signatures.Watch("").feeds() is None
