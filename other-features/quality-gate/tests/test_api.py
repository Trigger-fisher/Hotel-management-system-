import dataclasses
import threading
import time

import pytest
from fastapi.testclient import TestClient

import app.main as main_mod
from app.config import ConfigError, load_settings
from app.main import create_app
from tests.conftest import KEY, png
from tests.imaging import blur
from tests.test_gate import page

ENV = {"GATE_KEY": KEY, "GATE_EXECUTOR": "thread"}
AUTH = {"X-Gate-Key": KEY}
SMALL = png(page(scale=1))


@pytest.fixture()
def client():
    with TestClient(create_app(load_settings(ENV))) as c:
        yield c


def post(c, data=SMALL, headers=AUTH, **fields):
    return c.post("/v1/check", headers=headers, files={"file": ("x.png", data)}, data=fields)


@pytest.mark.parametrize("key", ["", "short", "x" * 31])
def test_refuses_to_start_without_a_real_key(key):
    with pytest.raises(ConfigError):
        load_settings({"GATE_KEY": key})


def test_key_missing_wrong_right(client):
    assert post(client, headers={}).status_code == 401
    assert post(client, headers={"X-Gate-Key": "w" * 40}).status_code == 401
    assert post(client).status_code == 200


def test_health_is_open_and_lists_profiles(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and "multi-id" in body["profiles"] and KEY not in client.get("/health").text


def test_check_returns_verdict_reasons_scores_pages_profile(client):
    body = post(client, profile="document").json()
    assert set(body) >= {"verdict", "reasons", "scores", "pages", "profile"} and body["profile"] == "document"
    blurry = post(client, png(blur(page(), 12)), profile="id-card").json()
    assert blurry["verdict"] == "reject" and blurry["reasons"][0]["code"] == "blurry"
    assert "take it again" in blurry["reasons"][0]["message"]


def test_errors_have_stable_codes(client):
    assert post(client, b"plain text").json()["error"]["code"] == "unsupported_type"
    assert post(client, profile="passport").json()["error"]["code"] == "bad_profile"
    assert client.post("/v1/check", headers=AUTH, data={}).json()["error"]["code"] == "no_file"


def test_caps_over_the_api():
    cfg = load_settings(ENV)
    small = dataclasses.replace(cfg, worker=dataclasses.replace(cfg.worker, max_bytes=500))
    with TestClient(create_app(small)) as c:
        assert post(c).json()["error"]["code"] == "file_too_large"
    tiny = dataclasses.replace(cfg, worker=dataclasses.replace(cfg.worker, max_pixels=1000))
    with TestClient(create_app(tiny)) as c:
        assert post(c).json()["error"]["code"] == "too_many_pixels"


def test_busy_returns_429():
    cfg = dataclasses.replace(load_settings(ENV), max_concurrency=1, queue_size=0)
    release, original = threading.Event(), main_mod.run_check
    main_mod.run_check = lambda *a: (release.wait(5), original(*a))[1]
    try:
        with TestClient(create_app(cfg)) as c:
            t = threading.Thread(target=lambda: post(c))
            t.start()
            time.sleep(0.5)
            second = post(c)
            release.set()
            t.join()
        assert second.status_code == 429 and second.json()["error"]["code"] == "busy"
    finally:
        main_mod.run_check = original


def test_process_pool_works_for_real():
    env = {**ENV, "GATE_EXECUTOR": "process", "GATE_MAX_CONCURRENCY": "1"}
    with TestClient(create_app(load_settings(env))) as c:
        assert post(c).status_code == 200
