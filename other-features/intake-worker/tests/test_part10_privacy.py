"""Part 10, privacy and quality set: no metadata leaves the worker, the pixels before compression are the input pixels, and no
log output of a whole job (every logger, stdout and stderr) carries the invented name, date of birth or number."""
import io
import json
import logging

import numpy as np
import pillow_heif
import pytest
from PIL import Image, ImageOps

from app import logs
from app.resave import resave_picture
from app.store import FakeStore
from app.worker import Worker
from tests import cards as C
from tests import part10_files as F
from tests.conftest import make_job, make_pipeline, opened, settings
from tests.helpers import verhoeff_append

NAME, DOB = "Vikrant Omkar Bhatnagar", "23/07/1984"
NUMBER = verhoeff_append("37419268055")
SPACED = f"{NUMBER[:4]} {NUMBER[4:8]} {NUMBER[8:]}"


@pytest.fixture()
def pipe(storage, engines, clamd):
    return make_pipeline(storage, engines, clamd.address)


def run(pipe, storage, data, job_id="job-privacy", **kw):
    job = make_job(storage, data, job_id=job_id, **kw)
    store = FakeStore()
    store.add({k: v for k, v in job.items() if k not in ("status", "attempts")})
    assert Worker(settings(threads=1), store, pipe.process, report_steps=True).run_once()
    return store.jobs[job_id], job


def no_metadata(out: bytes) -> None:
    img = Image.open(io.BytesIO(out))
    assert not img.getexif() and not img.getexif().get_ifd(0x8825)
    assert not {"exif", "xmp", "icc_profile", "comment", "Author", "XML:com.adobe.xmp", "photoshop"} & set(img.info), img.info.keys()
    for word in F.METADATA_WORDS:
        assert word not in out, word


@pytest.mark.parametrize("kind", ["jpeg", "png", "heic"])
@pytest.mark.parametrize("lossless", [False, True])
def test_a_photo_with_gps_and_device_exif_comes_out_with_no_metadata(pipe, storage, kind, lossless):
    data = {"jpeg": F.jpeg_full_of_metadata, "png": F.png_full_of_metadata, "heic": F.heic_with_gps}[kind]()
    src = Image.open(io.BytesIO(data))
    assert src.getexif().get_ifd(0x8825) and src.getexif()[0x010F] == "InventedCamera"
    row, job = run(pipe, storage, data, lossless=lossless)
    assert row["status"] == "done", row.get("reason_code")
    no_metadata(opened(storage, job))


def test_metadata_is_not_copied_into_the_job_row(pipe, storage):
    row, _ = run(pipe, storage, F.jpeg_full_of_metadata())
    text = json.dumps({k: v for k, v in row.items() if k not in ("created", "started", "finished")}, default=str)
    for word in (w.decode("latin-1") for w in F.METADATA_WORDS if w.isascii() and b"\x00" not in w):
        assert word not in text, word


def _expected(data: bytes) -> np.ndarray:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
        rgba = img.convert("RGBA")
        img = Image.alpha_composite(Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba)
    return np.asarray(img.convert("RGB"))


def _webp_lossless(img):
    buf = io.BytesIO()
    img.save(buf, "WEBP", lossless=True)
    return buf.getvalue()


@pytest.mark.parametrize("name,make", [
    *[(f"jpeg, EXIF orientation {o}", (lambda o=o: F.jpeg_full_of_metadata(orientation=o))) for o in (1, 3, 6, 8)],
    ("png with text, exif and icc", F.png_full_of_metadata),
    ("png with transparency", lambda: F.png_bytes(C.pan_card().convert("RGBA"))),
    ("webp lossless", lambda: _webp_lossless(C.pan_card())),
    *[(f"heic, EXIF orientation {o}", (lambda o=o: F.heic_with_gps(orientation=o))) for o in (1, 6)],
])
def test_the_resaved_pixels_equal_the_input_pixels(name, make):
    data = make()
    got = resave_picture(data).pixels
    expected = _expected(data)
    assert got.dtype == np.uint8 and got.shape == expected.shape and np.array_equal(got, expected), name


def test_heic_pixels_match_libheif_itself():
    data = F.heic_with_gps()
    direct = np.asarray(pillow_heif.open_heif(data, convert_hdr_to_8bit=True).to_pillow().convert("RGB"))
    assert np.array_equal(resave_picture(data).pixels, direct)


def test_a_lossless_job_stores_exactly_the_input_pixels(pipe, storage):
    """Before compression nothing changes the pixels: with the hotel's lossless setting and no enhance the stored picture IS
    the input picture, pixel for pixel."""
    img = C.aadhaar_front(name=NAME, dob=DOB, number=SPACED)
    row, job = run(pipe, storage, F.png_full_of_metadata(img), lossless=True, auto_enhance=False)
    assert row["status"] == "done"
    out = opened(storage, job)
    assert out[:4] == b"RIFF" and out[8:12] == b"WEBP"  # WebP lossless (the hotel's "keep an exact copy")
    assert np.array_equal(np.asarray(Image.open(io.BytesIO(out)).convert("RGB")), np.asarray(img.convert("RGB")))


def text_pdf(lines: list[str]) -> bytes:
    body = b"BT /F1 14 Tf 20 160 Td " + b" ".join(b"(%s) Tj 0 -20 Td" % t.encode() for t in lines) + b" ET"
    return F.build_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        F.stream(body),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ])


def test_no_log_output_of_whole_jobs_carries_the_invented_name_dob_or_number(storage, engines, clamd, capfd):
    """Every logger at DEBUG (the worker's own and every library's), plus whatever reaches stdout and stderr, during a read job,
    a PDF whose text layer holds the name and number, a rejected file and a job whose scanner is down."""
    card = C.aadhaar_front(name=NAME, dob=DOB, number=SPACED)
    # a PNG full of metadata: the quality-95 JPEG of this drawn card reads "374 9268 0559" (one digit lost, also on the commit this
    # work started from), so its number fails the check and its name is not taken; the JPEG metadata itself has its own tests above
    files = {"job-read": F.png_full_of_metadata(card), "job-pdf": text_pdf([NAME, f"DOB {DOB}", SPACED]),
             "job-bad": b"MZ" + NAME.encode() + NUMBER.encode(), "job-noscan": F.png_bytes(card)}
    capfd.readouterr()
    intake = logging.getLogger("intake")
    before = list(intake.handlers)
    stream = io.StringIO()
    logs.setup(stream)
    everything = io.StringIO()
    handler = logging.StreamHandler(everything)
    handler.setFormatter(logging.Formatter("%(name)s %(levelname)s %(message)s"))
    root = logging.getLogger()
    old_level = root.level
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    intake.addHandler(handler)
    try:
        pipe = make_pipeline(storage, engines, clamd.address)
        store = FakeStore()
        jobs = [make_job(storage, files["job-read"], job_id="job-read"),
                make_job(storage, files["job-pdf"], job_id="job-pdf", profile="document", gate_action="warn"),
                make_job(storage, files["job-bad"], job_id="job-bad")]
        for j in jobs:
            store.add({k: v for k, v in j.items() if k not in ("status", "attempts")})
        worker = Worker(settings(clamd.address, threads=1), store, pipe.process, report_steps=True)
        while worker.run_once():
            pass
        down = make_pipeline(storage, engines, "tcp:127.0.0.1:1")
        store.add({k: v for k, v in make_job(storage, files["job-noscan"], job_id="job-noscan").items() if k not in ("status", "attempts")})
        Worker(settings("tcp:127.0.0.1:1", threads=1), store, down.process, report_steps=True).run_once()
    finally:
        root.removeHandler(handler)
        root.setLevel(old_level)
        intake.handlers[:] = before
    out, err = capfd.readouterr()
    read = store.jobs["job-read"]
    assert read["status"] == "done" and NAME in json.dumps(read.get("fields"))  # the name WAS read: the logs had the chance
    assert store.jobs["job-pdf"]["status"] == "done" and store.jobs["job-bad"]["status"] == "rejected"
    assert store.jobs["job-noscan"]["status"] == "queued"
    worker_lines = stream.getvalue()
    assert worker_lines.count("job_start") == 4 and "job_done" in worker_lines and "job_failed" in worker_lines
    text = "\n".join([worker_lines, everything.getvalue(), out, err])
    forbidden = [NAME, *NAME.split(), DOB, DOB.replace("/", "-"), "1984-07-23", NUMBER, SPACED, NUMBER[-8:], C.SPACED, C.AADHAAR,
                 "InventedCamera", "https://", "token="]
    for word in forbidden:
        assert word not in text, word
    for line in worker_lines.splitlines():
        assert set(json.loads(line)) <= logs.ALLOWED
    names = sorted({line.split(" ", 1)[0] for line in everything.getvalue().splitlines() if line.strip()})
    print(f"\n{len(text.splitlines())} lines of log and console output searched (loggers: {', '.join(names)}), "
          "none carries the name, DOB or number")
