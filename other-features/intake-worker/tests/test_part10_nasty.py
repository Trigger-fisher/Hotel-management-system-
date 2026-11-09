"""Part 10, nasty-file set: every file is rejected with the right code, or made harmless, without crashing and within the time
limits. Each file goes through the whole worker (FakeStore job row, real pipeline, fake clamd unless a real one is given)."""
import io
import os
import socket
import threading
import time

import httpx
import pypdfium2 as pdfium
import pytest
from PIL import Image

from app import pipeline as _pipeline  # noqa: F401  (imports every module that touches Pillow's settings)
from app.clam import ClamClient
from app.config import MAX_PIXELS, MAX_PDF_PIXELS, STEP_SECONDS
from app.errors import StepError
from app.pipeline import Deps, Pipeline
from app.readcore import pdfsafe
from app.resave import real_type, resave, resave_pdf, resave_picture
from app.store import FakeStore
from app.worker import Worker
from tests import cards as C
from tests import part10_files as F
from tests.conftest import make_job, make_pipeline, opened, settings
from tests.fake_clamd import eicar

QUICK = 5.0  # seconds: a refused file is refused at once (the step limit is STEP_SECONDS)


@pytest.fixture()
def pipe(storage, engines, clamd):
    return make_pipeline(storage, engines, clamd.address)


def through_worker(pipe, storage, data, job_id="job-nasty", **kw):
    job = make_job(storage, data, job_id=job_id, **kw)
    store = FakeStore()
    store.add({k: v for k, v in job.items() if k not in ("status", "attempts")})
    worker = Worker(settings(threads=1), store, pipe.process)
    started = time.perf_counter()
    assert worker.run_once()
    return store.jobs[job_id], time.perf_counter() - started, job


REFUSED = {
    **{name: (data, "unsupported_type", "type") for name, data in F.eicar_files().items()},
    "png 40000 x 40000": (F.png_bomb(), "too_many_pixels", "rebuild"),
    "png 9000 x 9000 (under Pillow's own guard)": (F.png_bomb(9000, 9000), "too_many_pixels", "rebuild"),
    "jpeg 40000 x 40000": (F.jpeg_bomb(), "too_many_pixels", "rebuild"),
    "pdf of 2000 pages": (F.pages_pdf(2000), "too_many_pages", "rebuild"),
    **{name: (data, "unsupported_type", "type") for name, data in F.executables().items()},
    **{name: (data, "unsupported_type", "type") for name, data in F.svg_files().items()},
    "26 MB photo": (F.noise_png(26), "file_too_large", "download"),
    "password-protected pdf": (F.encrypted_pdf(), "pdf_encrypted", "rebuild"),
    "truncated jpeg": (F.truncated(F.jpeg_bytes(C.aadhaar_front())), "image_corrupt", "rebuild"),
    "truncated png": (F.truncated(F.png_bytes(C.aadhaar_front())), "image_corrupt", "rebuild"),
    "jpeg header only": (b"\xff\xd8\xff\xe0" + b"\x00" * 50, "image_corrupt", "rebuild"),
    "broken pdf": (b"%PDF-1.4 broken broken", "pdf_corrupt", "rebuild"),
    "empty file": (b"", "unsupported_type", "type"),
}


@pytest.mark.parametrize("name", list(REFUSED))
def test_a_nasty_file_is_rejected_with_its_code_and_nothing_is_saved(pipe, storage, clamd, name):
    data, code, step = REFUSED[name]
    row, seconds, _ = through_worker(pipe, storage, data)
    print(f"\n{name}: {row['status']} {row['reason_code']} at {row['step']} in {seconds * 1000:.0f} ms")
    assert (row["status"], row["reason_code"], row["step"]) == ("rejected", code, step)
    assert row["attempts"] == 1 and not storage.uploads
    assert seconds < QUICK < STEP_SECONDS
    if step in ("download", "type"):
        assert clamd.scanned == 0  # refused before the scan, before any decoding


def test_eicar_bytes_never_reach_a_decoder():
    with pytest.raises(StepError) as e:
        real_type(eicar())
    assert e.value.code == "unsupported_type" and e.value.step == "type"


def test_eicar_hidden_in_a_valid_picture_is_found_by_the_scan(pipe, storage, clamd):
    row, seconds, _ = through_worker(pipe, storage, F.png_bytes(C.unknown_card()) + eicar())
    assert (row["status"], row["reason_code"], row["step"]) == ("rejected", "malware_found", "scan")
    assert clamd.scanned == 1 and not storage.uploads and seconds < QUICK


REAL_CLAMD = os.environ.get("INTAKE_TEST_CLAMD", "tcp:127.0.0.1:3310")


@pytest.mark.skipif(not ClamClient(REAL_CLAMD, 1.0).ping(), reason="no clamd running on this PC (set INTAKE_TEST_CLAMD)")
def test_a_real_clamd_finds_eicar():
    assert ClamClient(REAL_CLAMD).scan(eicar()).infected


class _Silent:
    """A scanner address that accepts the connection and then never answers (or answers nonsense, or hangs up)."""

    def __init__(self, reply: bytes | None) -> None:
        self.reply = reply
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.conns = []
        threading.Thread(target=self._serve, daemon=True).start()

    @property
    def address(self) -> str:
        return f"tcp:127.0.0.1:{self.sock.getsockname()[1]}"

    def _serve(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.conns.append(conn)
            if self.reply is not None:
                threading.Thread(target=self._answer, args=(conn,), daemon=True).start()

    def _answer(self, conn) -> None:
        try:
            conn.settimeout(5)
            seen = b""
            while not seen.endswith(b"\x00\x00\x00\x00") and self.reply != b"":
                part = conn.recv(65536)
                if not part:
                    break
                seen = (seen + part)[-8:]
            conn.sendall(self.reply)
        except OSError:
            pass
        finally:
            conn.close()

    def close(self) -> None:
        self.sock.close()
        for c in self.conns:
            c.close()


@pytest.mark.parametrize("behaviour,reply,code", [
    ("refuses the connection", "refused", "scanner_unavailable"),
    ("accepts and never answers", None, "scanner_unavailable"),
    ("hangs up without a word", b"", {"scanner_error", "scanner_unavailable"}),
    ("answers nonsense", b"PONG\x00", "scanner_error"),
    ("answers with an error", b"INSTREAM size limit exceeded. ERROR\x00", "scanner_error"),
])
def test_a_scanner_that_cannot_answer_never_yields_clean(storage, engines, behaviour, reply, code):
    fake = None if reply == "refused" else _Silent(reply)
    address = "tcp:127.0.0.1:1" if fake is None else fake.address
    try:
        client = httpx.Client(transport=storage.transport(), follow_redirects=False)
        pipe = Pipeline(Deps(settings(address), engines, http=client, clam=ClamClient(address, 1.0)))
        data = F.png_bytes(C.unknown_card()) + eicar()
        row, seconds, _ = through_worker(pipe, storage, data)
        print(f"\nscanner {behaviour}: {row['status']} {row['reason_code']} in {seconds * 1000:.0f} ms")
        codes = code if isinstance(code, set) else {code}
        assert row["status"] == "queued" and row["reason_code"] in codes and row["step"] == "scan"  # retried, never passed
        assert not storage.uploads and seconds < QUICK
    finally:
        if fake:
            fake.close()


def test_pillow_bomb_guard_is_on_after_every_module_is_imported():
    assert Image.MAX_IMAGE_PIXELS is not None and Image.MAX_IMAGE_PIXELS >= MAX_PIXELS


def test_huge_pdf_pages_are_drawn_within_the_pixel_budget():
    """20 pages of 200 x 200 inches each: 40 MP per page at most, MAX_PDF_PIXELS for the whole document."""
    started = time.monotonic()
    pictures = resave_pdf(F.pages_pdf(20, (14400, 14400)))
    seconds = time.monotonic() - started
    total = sum(p.pixels.shape[0] * p.pixels.shape[1] for p in pictures)
    print(f"\n20 huge pages: {total / 1e6:.0f} MP drawn in {seconds:.1f} s")
    assert len(pictures) == 20 and total <= MAX_PDF_PIXELS * 1.01
    assert all(p.pixels.shape[0] * p.pixels.shape[1] <= MAX_PIXELS for p in pictures)
    assert seconds < STEP_SECONDS


def test_the_password_pdf_is_a_real_encrypted_pdf():
    with pdfsafe.LOCK:  # PDFium is used by one thread at a time in this process, tests included
        doc = pdfium.PdfDocument(F.encrypted_pdf(), password="invented-pass")  # opens with the password: refused for the right reason
        assert len(doc) == 1
        doc.close()


def test_a_file_larger_than_25_mb_sent_without_a_length_is_cut_off_while_downloading(engines, clamd):
    sent = []

    def handler(req):
        def body():
            for _ in range(40):
                sent.append(1)
                yield b"\x89PNG\r\n\x1a\n" + b"\x00" * (1024 * 1024)
        return httpx.Response(200, content=body())
    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)
    pipe = Pipeline(Deps(settings(clamd.address), engines, http=client))
    from tests.conftest import Storage
    job = make_job(Storage(), b"")
    with pytest.raises(StepError) as e:
        pipe.process(job)
    assert e.value.code == "file_too_large" and e.value.step == "download" and len(sent) <= 27


def test_pdf_with_javascript_and_an_attachment_is_refused_by_the_rules(pipe, storage):
    data = F.active_pdf()
    with pdfsafe.LOCK:  # closed here, never left to the garbage collector of another thread
        doc = pdfium.PdfDocument(data)
        assert doc.count_attachments() == 1  # the attachment really is in the file
        doc.close()
    row, seconds, _ = through_worker(pipe, storage, data, profile="document", gate_action="warn")
    assert (row["status"], row["reason_code"], row["step"]) == ("rejected", "yara_match", "scan")
    assert not storage.uploads and seconds < QUICK


def test_jpeg_that_is_also_a_zip_is_refused_by_the_rules(pipe, storage):
    data = F.jpeg_bytes(C.aadhaar_front()) + b"PK\x03\x04\x14\x00" + b"\x00" * 24 + b"payload.txt" + F.PAYLOAD + b"PK\x05\x06" + b"\x00" * 18
    row, seconds, _ = through_worker(pipe, storage, data)
    assert (row["status"], row["reason_code"], row["step"]) == ("rejected", "yara_match", "scan")
    assert not storage.uploads and seconds < QUICK

def test_heic_with_gps_is_read_and_comes_out_without_metadata(pipe, storage):
    data = F.heic_with_gps()
    assert Image.open(io.BytesIO(data)).getexif().get_ifd(0x8825)
    row, seconds, job = through_worker(pipe, storage, data)
    assert row["status"] == "done" and seconds < STEP_SECONDS
    out = opened(storage, job)
    img = Image.open(io.BytesIO(out))
    assert not img.getexif() and not {"exif", "xmp", "icc_profile", "comment", "XML:com.adobe.xmp"} & set(img.info)
    for word in F.METADATA_WORDS:
        assert word not in out, word


def test_every_refusal_is_a_step_error_and_never_a_crash():
    for name, (data, code, _) in REFUSED.items():
        try:
            resave(data)
        except StepError as err:
            assert err.reject and err.code == code, name
        else:
            raise AssertionError(name)
