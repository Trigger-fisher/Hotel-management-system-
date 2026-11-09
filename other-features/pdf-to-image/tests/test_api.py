import dataclasses
import io
import json
import threading
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

import app.main as main_mod
from app.config import ConfigError, load_settings
from app.main import create_app
from tests.conftest import KEY, PASSWORD, decode, many_pages

ENV = {"CONVERTER_KEY": KEY, "CONVERTER_EXECUTOR": "thread"}
AUTH = {"X-Converter-Key": KEY}


@pytest.fixture()
def client():
    with TestClient(create_app(load_settings(ENV))) as c:
        yield c


def post(client, pdf, headers=AUTH, query="", **fields):
    return client.post(f"/v1/convert{query}", headers=headers, files={"file": ("x.pdf", pdf)},
                       data={k: str(v) for k, v in fields.items()})


@pytest.mark.parametrize("key", ["", "short", "x" * 31])
def test_refuses_to_start_without_a_real_key(key):
    with pytest.raises(ConfigError):
        load_settings({"CONVERTER_KEY": key})


def test_key_missing_wrong_right(client, text_pdf):
    assert post(client, text_pdf, headers={}).status_code == 401
    assert post(client, text_pdf, headers={"X-Converter-Key": "w" * 40}).status_code == 401
    assert post(client, text_pdf, dpi=36).status_code == 200


def test_health_open_without_secrets(client):
    r = client.get("/health")
    body = r.json()
    assert r.status_code == 200 and body["status"] == "ok" and "pdfium" in body["engines"]
    assert KEY not in r.text


def test_zip_of_pages_is_streamed_with_names_and_manifest(client, multi_pdf):
    r = post(client, multi_pdf, dpi=36, format="jpeg")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert "content-length" not in r.headers  # streamed, no total known in advance
    assert (r.headers["X-Pages"], r.headers["X-Rendered-Pages"], r.headers["X-Dpi-Used"], r.headers["X-Engine"]) == ("3", "3", "36.0", "pdfium")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    assert zf.namelist() == ["page-001.jpg", "page-002.jpg", "page-003.jpg", "manifest.json"]
    assert all(decode(zf.read(n)).format == "JPEG" for n in zf.namelist()[:3])
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["pageCount"] == 3 and manifest["pages"][1]["width"] == 396 and manifest["errors"] == []


def test_manifest_can_be_switched_off(client, text_pdf):
    zf = zipfile.ZipFile(io.BytesIO(post(client, text_pdf, dpi=36, manifest="false").content))
    assert zf.namelist() == ["page-001.png"]


def test_page_range_in_zip(client, multi_pdf):
    zf = zipfile.ZipFile(io.BytesIO(post(client, multi_pdf, dpi=36, pages="1,3").content))
    assert zf.namelist()[:2] == ["page-001.png", "page-003.png"]


def test_single_page_via_query(client, multi_pdf):
    r = post(client, multi_pdf, query="?page=2", dpi=72, format="webp")
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert (r.headers["X-Page"], r.headers["X-Width"], r.headers["X-Height"]) == ("2", "792", "612")
    assert decode(r.content).size == (792, 612)
    r = post(client, multi_pdf, query="?page=9")
    assert r.status_code == 422 and r.json()["error"]["code"] == "page_range_empty"
    assert post(client, multi_pdf, query="?page=abc").json()["error"]["code"] == "bad_option"


def test_password_flow_over_the_api(client, encrypted_pdf):
    assert post(client, encrypted_pdf).json()["error"]["code"] == "pdf_password_required"
    assert post(client, encrypted_pdf, password="bad").json()["error"]["code"] == "pdf_bad_password"
    assert post(client, encrypted_pdf, password=PASSWORD, dpi=36).status_code == 200


def test_errors_have_stable_codes_and_statuses(client, text_pdf):
    r = post(client, b"PK\x03\x04 not a pdf")
    assert (r.status_code, r.json()["error"]["code"]) == (415, "unsupported_type")
    r = post(client, b"")
    assert r.status_code == 415
    r = post(client, text_pdf, dpi=9999)
    assert (r.status_code, r.json()["error"]["code"]) == (400, "bad_option")
    r = post(client, b"%PDF-1.4 garbage garbage garbage")
    assert (r.status_code, r.json()["error"]["code"]) == (422, "pdf_corrupt")
    r = client.post("/v1/convert", headers=AUTH, data={"dpi": "72"})
    assert r.json()["error"]["code"] == "no_file"


def test_size_and_page_caps_over_the_api(text_pdf):
    cfg = dataclasses.replace(load_settings(ENV), limits=dataclasses.replace(load_settings(ENV).limits, max_bytes=300, max_pages=2))
    with TestClient(create_app(cfg)) as c:
        assert post(c, text_pdf).json()["error"]["code"] == "file_too_large"
    cfg = dataclasses.replace(load_settings(ENV), limits=dataclasses.replace(load_settings(ENV).limits, max_pages=2))
    with TestClient(create_app(cfg)) as c:
        assert post(c, many_pages(3)).json()["error"]["code"] == "too_many_pages"


def test_temp_dirs_are_removed(client, multi_pdf, tmp_path, monkeypatch):
    import tempfile
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    post(client, multi_pdf, dpi=36)
    post(client, b"not a pdf at all")
    post(client, multi_pdf, query="?page=1", dpi=36)
    assert list(tmp_path.glob("p2i-*")) == []


def test_busy_returns_429(text_pdf):
    cfg = dataclasses.replace(load_settings(ENV), max_concurrency=1, queue_size=0)
    release, original = threading.Event(), main_mod.convert_job
    main_mod.convert_job = lambda *a: (release.wait(5), original(*a))[1]
    try:
        with TestClient(create_app(cfg)) as c:
            t = threading.Thread(target=lambda: post(c, text_pdf, dpi=36))
            t.start()
            time.sleep(0.5)
            second = post(c, text_pdf, dpi=36)
            release.set()
            t.join()
        assert second.status_code == 429 and second.json()["error"]["code"] == "busy"
    finally:
        main_mod.convert_job = original


def test_real_process_pool(text_pdf):
    env = {**ENV, "CONVERTER_EXECUTOR": "process", "CONVERTER_MAX_CONCURRENCY": "1"}
    with TestClient(create_app(load_settings(env))) as c:
        r = post(c, text_pdf, dpi=36)
        assert r.status_code == 200 and zipfile.ZipFile(io.BytesIO(r.content)).namelist()[0] == "page-001.png"
