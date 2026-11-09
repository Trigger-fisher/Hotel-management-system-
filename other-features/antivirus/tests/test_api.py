import dataclasses
import io

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import safety
from app.config import load_settings
from app.main import create_app
from tests.conftest import KEY, armed_pdf, jpeg_with_gps, picture, to_bytes
from tests.fake_clamd import eicar

AUTH = {"X-Scanner-Key": KEY}


def env(clamd_address: str, **extra) -> dict:
    return {"SCANNER_KEY": KEY, "SCANNER_CLAMD": clamd_address, "SCANNER_EXECUTOR": "thread",
            "SCANNER_ALLOWED_HOSTS": "files.example.com", "SCANNER_YARA": "off", **extra}


@pytest.fixture()
def client(clamd):
    with TestClient(create_app(load_settings(env(clamd.address)))) as c:
        yield c


def post(client, data, headers=AUTH, **fields):
    return client.post("/v1/scan", headers=headers, files={"file": ("a.pdf", data)}, data=fields)


def test_key_missing_wrong_right(client):
    png = to_bytes(picture(), "PNG")
    assert post(client, png, headers={}).status_code == 401
    assert post(client, png, headers={"X-Scanner-Key": "w" * 40}).status_code == 401
    assert post(client, png).status_code == 200


def test_health_reports_clamd_and_no_secrets(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["clamd"]["reachable"] is True
    assert body["clamd"]["engine"].startswith("ClamAV") and "2026" in body["clamd"]["signatureDate"]
    assert KEY not in client.get("/health").text


def test_health_degraded_when_clamd_down():
    with TestClient(create_app(load_settings(env("tcp:127.0.0.1:1")))) as c:
        assert c.get("/health").json()["status"] == "degraded"


def test_scan_clean_image_end_to_end(client):
    r = post(client, jpeg_with_gps(), output="jpeg")
    assert r.status_code == 200 and r.headers["X-Verdict"] == "clean"
    assert r.headers["X-Scan-Engine"].startswith("ClamAV") and "gps" in r.headers["X-Disarmed"]
    assert not Image.open(io.BytesIO(r.content)).getexif().get_ifd(0x8825)


def test_scan_pdf_disarmed(client):
    r = post(client, armed_pdf())
    assert r.status_code == 200 and "javascript" in r.headers["X-Disarmed"]
    assert b"/JavaScript" not in r.content


def test_malware_rejected_with_code(client):
    r = post(client, b"%PDF-1.4\n%" + eicar())
    assert r.status_code == 422 and r.headers["X-Verdict"] == "rejected"
    assert r.json()["code"] == "malware_found" and r.content.find(b"%PDF") == -1


def test_unsupported_and_bad_option(client):
    assert post(client, b"plain text").json()["code"] == "unsupported_type"
    r = post(client, to_bytes(picture(), "PNG"), output="tiff")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_option"


def test_scanner_down_gives_503_not_a_verdict():
    with TestClient(create_app(load_settings(env("tcp:127.0.0.1:1")))) as c:
        r = post(c, to_bytes(picture(), "PNG"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "scanner_unavailable"


# ---- scan-url + SSRF -----------------------------------------------------------

def url_job(c, **kw):
    body = {"quarantineUrl": "https://files.example.com/q", "cleanUrl": "https://files.example.com/c"} | kw
    return c.post("/v1/scan-url", headers=AUTH, json=body)


@pytest.mark.parametrize("field,url", [
    ("quarantineUrl", "http://files.example.com/q"),
    ("quarantineUrl", "https://evil.example.org/q"),
    ("quarantineUrl", "https://127.0.0.1/q"),
    ("quarantineUrl", "https://files.example.com:8443/q"),
    ("quarantineUrl", "https://u:p@files.example.com/q"),
    ("cleanUrl", "http://files.example.com/c"),
    ("cleanUrl", "https://169.254.169.254/x"),
    ("quarantineDeleteUrl", "https://evil.example.org/d"),
])
def test_ssrf_refusals(client, field, url):
    r = url_job(client, **{field: url})
    assert r.status_code == 400 and r.json()["error"]["code"] == "url_not_allowed"


def test_private_resolution_refused(client, monkeypatch):
    async def private(_):
        return ["192.168.1.9"]
    monkeypatch.setattr(safety, "resolve_host", private)
    assert url_job(client).status_code == 400


def test_scan_url_requires_key(client):
    r = client.post("/v1/scan-url", json={"quarantineUrl": "https://files.example.com/q",
                                          "cleanUrl": "https://files.example.com/c"})
    assert r.status_code == 401


def _public(monkeypatch):
    async def ok(_):
        return ["93.184.216.34"]
    monkeypatch.setattr(safety, "resolve_host", ok)


def _app(clamd, handler, **extra):
    return create_app(load_settings(env(clamd.address, **extra)), http_transport=httpx.MockTransport(handler))


def test_scan_url_clean_flow_with_delete(clamd, monkeypatch):
    _public(monkeypatch)
    seen = {}

    def handler(req: httpx.Request):
        if req.method == "GET":
            return httpx.Response(200, content=jpeg_with_gps())
        seen[req.method] = req.content
        return httpx.Response(200)

    with TestClient(_app(clamd, handler, SCANNER_QUARANTINE_ACTION="delete")) as c:
        r = url_job(c, quarantineDeleteUrl="https://files.example.com/d", output="jpeg")
    body = r.json()
    assert r.status_code == 200 and body["verdict"] == "clean" and body["quarantine"] == "deleted"
    assert not Image.open(io.BytesIO(seen["PUT"])).getexif().get_ifd(0x8825) and "DELETE" in seen


def test_scan_url_infected_never_uploaded(clamd, monkeypatch):
    _public(monkeypatch)
    methods = []

    def handler(req: httpx.Request):
        methods.append(req.method)
        return httpx.Response(200, content=b"%PDF-1.4\n%" + eicar()) if req.method == "GET" else httpx.Response(200)

    with TestClient(_app(clamd, handler)) as c:
        r = url_job(c)
    assert r.json()["verdict"] == "rejected" and r.json()["code"] == "malware_found"
    assert methods == ["GET"] and r.json()["quarantine"] == "kept"


def test_redirect_to_other_host_refused(clamd, monkeypatch):
    _public(monkeypatch)
    handler = lambda req: httpx.Response(302, headers={"location": "https://files.example.net/x"})
    with TestClient(_app(clamd, handler)) as c:
        assert url_job(c).status_code == 400


def test_download_cap(clamd, monkeypatch):
    _public(monkeypatch)
    app = create_app(dataclasses.replace(load_settings(env(clamd.address)), max_download_bytes=500),
                     http_transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"x" * 5000)))
    with TestClient(app) as c:
        assert url_job(c).status_code == 413


def test_busy_returns_429(clamd):
    import threading, time
    import app.main as main_mod
    cfg = dataclasses.replace(load_settings(env(clamd.address)), max_concurrency=1, queue_size=0)
    release, original = threading.Event(), main_mod.scan_job
    main_mod.scan_job = lambda *a: (release.wait(5), original(*a))[1]
    try:
        with TestClient(create_app(cfg)) as c:
            png = to_bytes(picture(), "PNG")
            t = threading.Thread(target=lambda: post(c, png))
            t.start()
            time.sleep(0.5)
            second = post(c, png)
            release.set()
            t.join()
        assert second.status_code == 429
    finally:
        main_mod.scan_job = original

