import dataclasses

import httpx
import pytest
from fastapi.testclient import TestClient

from app import safety
from app.config import ConfigError, load_settings
from app.main import create_app
from tests.conftest import KEY

ENV = {"COMPRESSOR_KEY": KEY, "COMPRESSOR_ALLOWED_HOSTS": "files.example.com", "COMPRESSOR_EXECUTOR": "thread"}
AUTH = {"X-Compressor-Key": KEY}


@pytest.fixture()
def client():
    with TestClient(create_app(load_settings(ENV))) as c:
        yield c


def upload(client, data, name="x.jpg", headers=AUTH, **fields):
    return client.post("/v1/compress", headers=headers, files={"file": (name, data)}, data=fields)


# ---- start-up and key --------------------------------------------------------

@pytest.mark.parametrize("key", ["", "short", "x" * 31])
def test_refuses_to_start_without_a_real_key(key):
    with pytest.raises(ConfigError):
        load_settings({"COMPRESSOR_KEY": key})


def test_key_missing_wrong_right(client, jpeg_photo):
    assert upload(client, jpeg_photo, headers={}).status_code == 401
    assert upload(client, jpeg_photo, headers={"X-Compressor-Key": "w" * 40}).status_code == 401
    assert upload(client, jpeg_photo).status_code == 200


def test_health_is_open_and_has_no_secrets(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and "gs" in body["tools"]
    assert KEY not in client.get("/health").text


# ---- /v1/compress end to end -------------------------------------------------

def test_compress_end_to_end(client, jpeg_photo):
    r = upload(client, jpeg_photo, mode="balanced", output="jpeg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert int(r.headers["X-Original-Bytes"]) == len(jpeg_photo)
    assert int(r.headers["X-Result-Bytes"]) == len(r.content) < len(jpeg_photo)
    assert float(r.headers["X-Saved-Percent"]) > 0
    assert float(r.headers["X-Quality-Score"]) >= 0.985
    assert r.headers["X-Mode"] == "balanced" and r.headers["X-Output-Type"] == "image/jpeg"


def test_size_options_and_headers(client, jpeg_photo):
    r = upload(client, jpeg_photo, mode="balanced", output="jpeg")
    assert r.headers["X-Target"] == "met"
    assert r.headers["X-Target-Bytes"] == "153600" and r.headers["X-Cap-Bytes"] == "512000"
    r = upload(client, jpeg_photo, mode="strict", output="jpeg", targetKb="10", capKb="40")
    assert r.status_code == 200 and len(r.content) <= 40 * 1024
    assert r.headers["X-Target"] == "missed" and r.headers["X-Cap-Bytes"] == str(40 * 1024)
    assert "targetMissed" in r.headers["X-Notes"]


@pytest.mark.parametrize("fields", [{"targetKb": "0"}, {"capKb": "x"}, {"targetKb": "600", "capKb": "500"}])
def test_bad_size_options_are_400(client, jpeg_photo, fields):
    r = upload(client, jpeg_photo, **fields)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_size"


def test_file_name_is_ignored(client, png_text):
    r = upload(client, png_text, name="report.jpg")  # PNG bytes with a .jpg name
    assert r.status_code == 200 and r.headers["X-Output-Type"] in ("image/png", "image/webp")


def test_refusals_have_stable_codes(client):
    r = upload(client, b"just some text")
    assert r.status_code == 415 and r.json()["error"]["code"] == "unsupported_type"
    r = client.post("/v1/compress", headers=AUTH, data={"mode": "balanced"})
    assert r.status_code in (400, 422)


def test_busy_returns_429(jpeg_photo):
    cfg = dataclasses.replace(load_settings(ENV), max_concurrency=1, queue_size=0)
    app = create_app(cfg)
    # Fill the only slot by shrinking capacity to zero via a zero-size queue and one in-flight job.
    import threading
    release = threading.Event()
    import app.main as main_mod
    original = main_mod.run_job
    main_mod.run_job = lambda *a: (release.wait(5), original(*a))[1]
    try:
        with TestClient(app) as c:
            results = []
            t = threading.Thread(target=lambda: results.append(upload(c, jpeg_photo)))
            t.start()
            import time
            time.sleep(0.5)
            second = upload(c, jpeg_photo)
            release.set()
            t.join()
        assert second.status_code == 429 and second.json()["error"]["code"] == "busy"
    finally:
        main_mod.run_job = original


# ---- compress-url and SSRF ---------------------------------------------------

def url_job(client, **kw):
    body = {"sourceUrl": "https://files.example.com/in", "targetUrl": "https://files.example.com/out"} | kw
    return client.post("/v1/compress-url", headers=AUTH, json=body)


@pytest.mark.parametrize("field,url", [
    ("sourceUrl", "http://files.example.com/in"),          # not https
    ("sourceUrl", "https://evil.example.org/in"),          # host not allowed
    ("sourceUrl", "https://127.0.0.1/in"),                 # number address
    ("sourceUrl", "https://files.example.com:8443/in"),    # odd port
    ("sourceUrl", "https://user:pw@files.example.com/in"), # login in address
    ("targetUrl", "http://files.example.com/out"),
    ("targetUrl", "https://169.254.169.254/latest"),
])
def test_ssrf_refusals(client, field, url):
    r = url_job(client, **{field: url})
    assert r.status_code == 400 and r.json()["error"]["code"] == "url_not_allowed"


def test_allowed_host_resolving_to_private_ip_refused(client, monkeypatch):
    async def private(_host):
        return ["10.0.0.5"]
    monkeypatch.setattr(safety, "resolve_host", private)
    r = url_job(client)
    assert r.status_code == 400 and "private" in r.json()["error"]["message"]


def test_url_requires_key(client):
    r = client.post("/v1/compress-url", json={"sourceUrl": "https://files.example.com/a",
                                              "targetUrl": "https://files.example.com/b"})
    assert r.status_code == 401


def _public(monkeypatch):
    async def ok(_host):
        return ["93.184.216.34"]
    monkeypatch.setattr(safety, "resolve_host", ok)


def test_compress_url_happy_path(jpeg_photo, monkeypatch):
    _public(monkeypatch)
    uploaded = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=jpeg_photo)
        uploaded["body"], uploaded["type"] = request.content, request.headers["content-type"]
        return httpx.Response(200)

    app = create_app(load_settings(ENV), http_transport=httpx.MockTransport(handler))
    with TestClient(app) as c:
        r = url_job(c, output="jpeg")
    assert r.status_code == 200
    summary = r.json()
    assert summary["originalBytes"] == len(jpeg_photo) and summary["resultBytes"] == len(uploaded["body"])
    assert uploaded["type"] == "image/jpeg"
    assert summary["target"] == "met" and summary["targetBytes"] == 153_600 and summary["capBytes"] == 512_000


def test_compress_url_bad_size_option(client):
    r = url_job(client, capKb=0)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_size"


def test_redirect_to_other_host_refused(monkeypatch):
    _public(monkeypatch)
    handler = lambda req: httpx.Response(302, headers={"location": "https://files.example.net/x"})
    app = create_app(load_settings(ENV), http_transport=httpx.MockTransport(handler))
    with TestClient(app) as c:
        r = url_job(c)
    assert r.status_code == 400 and r.json()["error"]["code"] == "url_not_allowed"


def test_download_size_cap(monkeypatch):
    _public(monkeypatch)
    cfg = dataclasses.replace(load_settings(ENV), max_download_bytes=1000)
    handler = lambda req: httpx.Response(200, content=b"x" * 5000)
    app = create_app(cfg, http_transport=httpx.MockTransport(handler))
    with TestClient(app) as c:
        r = url_job(c)
    assert r.status_code == 413 and r.json()["error"]["code"] == "download_too_large"


def test_process_pool_works_for_real(jpeg_photo):
    env = {**ENV, "COMPRESSOR_EXECUTOR": "process", "COMPRESSOR_MAX_CONCURRENCY": "1"}
    with TestClient(create_app(load_settings(env))) as c:
        assert upload(c, jpeg_photo, output="jpeg").status_code == 200
