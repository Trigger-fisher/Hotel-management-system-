import dataclasses

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import safety
from app.config import ConfigError, load_settings
from app.engines.base import Osd
from app.main import create_app
from tests.conftest import KEY, needs_tesseract, real_config
from tests.fake_engine import FakeEngine, line
from tests.imaging import png_bytes, random_lines, text_page

ENV = {"READER_KEY": KEY, "READER_EXECUTOR": "thread", "READER_ALLOWED_HOSTS": "files.example.com"}
AUTH = {"X-Reader-Key": KEY}
PNG = png_bytes(text_page(random_lines(0, 8), size=(800, 600)))


def make_client(**kw):
    engine = FakeEngine({"Latin": [line("Hello reader", 50)]}, osd=Osd(0, "Latin", 1))
    return TestClient(create_app(load_settings(ENV), engines=[engine], **kw))


@pytest.fixture()
def client():
    with make_client() as c:
        yield c


def post(c, data=PNG, headers=AUTH, **fields):
    return c.post("/v1/read", headers=headers, files={"file": ("x.png", data)}, data={k: str(v) for k, v in fields.items()})


@pytest.mark.parametrize("key", ["", "short", "x" * 31])
def test_refuses_to_start_without_a_real_key(key):
    with pytest.raises(ConfigError):
        load_settings({"READER_KEY": key})


def test_key_missing_wrong_right(client):
    assert post(client, headers={}).status_code == 401
    assert post(client, headers={"X-Reader-Key": "w" * 40}).status_code == 401
    assert post(client).status_code == 200


def test_health_open_without_secrets(client):
    r = client.get("/health")
    assert r.status_code == 200 and "engines" in r.json() and KEY not in r.text


def test_read_returns_the_documented_json(client):
    body = post(client, languages="en", mode="fast", findDocument="false").json()
    for key in ("pages", "text", "lines", "quality", "codes", "mrz", "flags", "needsHumanCheck", "engines", "tookMs", "document"):
        assert key in body
    assert body["lines"][0]["text"] == "Hello reader" and set(body["lines"][0]) >= {"text", "page", "bbox", "confidence", "script"}


def test_errors_have_stable_codes(client):
    assert post(client, b"plain text").json()["error"]["code"] == "unsupported_type"
    assert post(client, mode="slow").json()["error"]["code"] == "bad_option"
    assert post(client, languages="not a code!").json()["error"]["code"] == "bad_option"
    assert post(client, findDocument="maybe").json()["error"]["code"] == "bad_option"
    assert client.post("/v1/read", headers=AUTH, data={"mode": "fast"}).json()["error"]["code"] == "no_file"


def test_caps_over_the_api():
    cfg = load_settings(ENV)
    small = dataclasses.replace(cfg, worker=dataclasses.replace(cfg.worker, max_bytes=500))
    with TestClient(create_app(small, engines=[FakeEngine({})])) as c:
        assert post(c).json()["error"]["code"] == "file_too_large"
    tiny = dataclasses.replace(cfg, worker=dataclasses.replace(cfg.worker, max_pixels=1000))
    with TestClient(create_app(tiny, engines=[FakeEngine({})])) as c:
        assert post(c).json()["error"]["code"] == "too_many_pixels"


@pytest.mark.parametrize("field,url", [
    ("sourceUrl", "http://files.example.com/a.png"), ("sourceUrl", "https://evil.example.org/a.png"),
    ("sourceUrl", "https://127.0.0.1/a.png"), ("sourceUrl", "https://files.example.com:8443/a.png"),
    ("sourceUrl", "https://u:p@files.example.com/a.png"),
])
def test_ssrf_refusals(client, field, url):
    r = client.post("/v1/read-url", headers=AUTH, json={field: url})
    assert r.status_code == 400 and r.json()["error"]["code"] == "url_not_allowed"


def test_read_url_flow_and_guards(monkeypatch):
    async def public(_):
        return ["93.184.216.34"]
    monkeypatch.setattr(safety, "resolve_host", public)
    engine = FakeEngine({"Latin": [line("From a link", 50)]}, osd=Osd(0, "Latin", 1))
    ok = httpx.MockTransport(lambda req: httpx.Response(200, content=PNG))
    with TestClient(create_app(load_settings(ENV), engines=[engine], http_transport=ok)) as c:
        r = c.post("/v1/read-url", headers=AUTH, json={"sourceUrl": "https://files.example.com/a.png", "findDocument": False})
        assert r.status_code == 200 and r.json()["lines"][0]["text"] == "From a link"
        assert c.post("/v1/read-url", json={"sourceUrl": "https://files.example.com/a.png"}).status_code == 401
    redirect = httpx.MockTransport(lambda req: httpx.Response(302, headers={"location": "https://files.example.net/x"}))
    with TestClient(create_app(load_settings(ENV), engines=[engine], http_transport=redirect)) as c:
        assert c.post("/v1/read-url", headers=AUTH, json={"sourceUrl": "https://files.example.com/a.png"}).status_code == 400
    cfg = dataclasses.replace(load_settings(ENV), max_download_bytes=100)
    with TestClient(create_app(cfg, engines=[engine], http_transport=ok)) as c:
        assert c.post("/v1/read-url", headers=AUTH, json={"sourceUrl": "https://files.example.com/a.png"}).status_code == 413


@needs_tesseract
def test_real_engine_end_to_end_through_the_api_with_a_process_pool():
    env = {**ENV, "READER_EXECUTOR": "process", "READER_MAX_CONCURRENCY": "1",
           "READER_TESSDATA": real_config().tessdata}
    with TestClient(create_app(load_settings(env))) as c:
        r = c.post("/v1/read", headers=AUTH, files={"file": ("a.png", PNG)}, data={"findDocument": "false"})
        body = r.json()
        assert r.status_code == 200 and set(body["engines"]) & {"rapidocr", "tesseract"} and len(body["text"]) > 40
        assert c.get("/health").json()["engines"]["tesseract"]["present"] is True
