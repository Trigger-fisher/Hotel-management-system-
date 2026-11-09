"""The clamd image's feed stamp (clamd/stamp.py): the stamp carries the OLDEST good Sanesecurity check, so one feed that keeps
failing turns the worker's 48-hour alert on. Runs on an invented fangfrisch refresh log; no download."""
from __future__ import annotations

import importlib.util
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app import signatures

CLAMD = Path(__file__).resolve().parents[1] / "clamd"
spec = importlib.util.spec_from_file_location("clamd_stamp", CLAMD / "stamp.py")
stamp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stamp)

URLS = ["http://mirror.example.test/sanesecurity/badmacro.ndb", "http://mirror.example.test/sanesecurity/rogue.hdb"]


def refresh_log(tmp_path, rows) -> str:
    db = str(tmp_path / "db.sqlite")
    with sqlite3.connect(db) as con:
        con.execute("CREATE TABLE refreshlog (url TEXT PRIMARY KEY, digest TEXT, path TEXT NOT NULL, provider TEXT, updated DATETIME)")
        con.executemany("INSERT INTO refreshlog VALUES (?, 'x', 'p', 'sanesecurity', ?)", rows)
    return db


def test_the_stamp_is_the_oldest_good_check(tmp_path):
    db = refresh_log(tmp_path, [(URLS[0], "2026-11-05 06:00:00.000000"), (URLS[1], "2026-11-02 06:00:00.000000")])
    when = stamp.oldest_check(db, URLS)
    assert when == datetime(2026, 11, 2, 6, tzinfo=timezone.utc)
    path = tmp_path / signatures.STAMP
    stamp.write_stamp(str(path), when)
    assert signatures.feed_time(str(tmp_path)) == when
    assert signatures.age_hours(datetime(2026, 11, 5, 6, tzinfo=timezone.utc), when) == 72


def test_a_feed_never_checked_leaves_the_stamp_alone(tmp_path):
    db = refresh_log(tmp_path, [(URLS[0], "2026-11-05 06:00:00.000000")])
    assert stamp.oldest_check(db, URLS) is None
    assert stamp.oldest_check(db, []) is None


def test_the_feeds_script_writes_the_stamp_the_worker_reads():
    text = (CLAMD / "feeds.sh").read_text(encoding="utf-8")
    assert f"/var/lib/clamav/{signatures.STAMP}" in text and "stamp.py" in text
    assert b"\r" not in (CLAMD / "feeds.sh").read_bytes() and b"\r" not in (CLAMD / "entry.sh").read_bytes()


def test_the_config_enables_only_sanesecuritys_own_sets_checked_daily():
    pytest.importorskip("fangfrisch", reason="fangfrisch is installed in the clamd image only")
    urls = stamp.enabled_urls(str(CLAMD / "fangfrisch.conf"))
    names = sorted(os.path.basename(u) for u in urls)
    assert names == ["badmacro.ndb", "foxhole_filename.cdb", "foxhole_generic.cdb", "foxhole_js.cdb", "foxhole_js.ndb",
                     "hackingteam.hsb", "malwarehash.hsb", "rogue.hdb", "sanesecurity.ftm", "shelter.ldb", "sigwhitelist.ign2"]
