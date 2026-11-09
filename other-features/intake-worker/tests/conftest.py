"""Test harness: fakes for the database (FakeStore), clamd, and the storage links; invented files only."""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TESSDATA = ROOT / ".tessdata"
HOST = "storage.example.test"

from app import crypto, logs  # noqa: E402
from app.config import Settings  # noqa: E402
from app.pipeline import Deps, Pipeline  # noqa: E402
from app.readcore.config import WorkerConfig as ReadConfig  # noqa: E402
from app.readcore.engines import load_engines  # noqa: E402
from tests.fake_clamd import FakeClamd  # noqa: E402

MASTER = os.urandom(32)
DATA_KEY = os.urandom(32)
HOTEL = "11111111-1111-1111-1111-111111111111"


class Storage:
    """The signed-link storage as a MockTransport: GET returns what was put in, PUT keeps what was uploaded."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.uploads: dict[str, bytes] = {}
        self.requests: list[str] = []

    def transport(self) -> httpx.MockTransport:
        def handler(req: httpx.Request) -> httpx.Response:
            url = str(req.url)
            self.requests.append(req.method)
            if req.method == "GET":
                return httpx.Response(200, content=self.objects[url]) if url in self.objects else httpx.Response(404)
            self.uploads[url] = req.content
            return httpx.Response(200)
        return httpx.MockTransport(handler)


@pytest.fixture(scope="session")
def engines():
    cfg = ReadConfig(tessdata=str(TESSDATA) if TESSDATA.exists() else "")
    return load_engines(cfg)


@pytest.fixture()
def clamd():
    with FakeClamd() as fake:
        yield fake


@pytest.fixture()
def storage():
    return Storage()


def settings(clamd_address: str = "", **kw) -> Settings:
    base = dict(database_url="postgresql://unused", master_key=MASTER, clamd=clamd_address, allow_no_av=not clamd_address,
                allowed_hosts=(HOST,), threads=2, tessdata=str(TESSDATA) if TESSDATA.exists() else "")
    return Settings(**{**base, **kw})


def make_job(storage: Storage, data: bytes, job_id: str = "job-0001", back: bytes | None = None, **kw) -> dict:
    down, up = f"https://{HOST}/q/{job_id}", f"https://{HOST}/id/{job_id}"
    storage.objects[down] = data
    job = {"id": job_id, "hotel_id": HOTEL, "status": "processing", "attempts": 1, "download_url": down, "upload_url": up,
           "back_download_url": None, "wrapped_key": crypto.wrap_key(DATA_KEY, MASTER, HOTEL.encode()), "profile": "id-card",
           "gate_action": "reject", "size_cap_bytes": 1_000_000, "lossless": False, "document_type": None, "type_config": None,
           "mask_id_numbers": False, "languages": None}
    if back is not None:
        job["back_download_url"] = f"https://{HOST}/q/{job_id}-back"
        storage.objects[job["back_download_url"]] = back
    job.update(kw)
    return job


def make_pipeline(storage: Storage, engines, clamd_address: str = "", **kw) -> Pipeline:
    s = settings(clamd_address, **kw)
    client = httpx.Client(transport=storage.transport(), follow_redirects=False)
    return Pipeline(Deps(s, engines, http=client))


def opened(storage: Storage, job: dict) -> bytes:
    """What HMS would do on download: decrypt the uploaded picture."""
    return crypto.decrypt(storage.uploads[job["upload_url"]], DATA_KEY, str(job["id"]).encode())


@pytest.fixture()
def log_lines():
    stream = io.StringIO()
    logs.setup(stream)
    yield stream
    logs.setup()
