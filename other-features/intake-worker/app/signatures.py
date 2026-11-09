"""Age of the virus signatures for the heartbeat: the official ClamAV date (clamd VERSION) and the last good Sanesecurity
update check in the clamd signature folder (mounted read-only). Older than 48 hours = a "signatures_stale" log line,
at most once an hour per kind; HMS raises the alert from the heartbeat row."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

from . import logs
from .config import SIGNATURES_STALE_HOURS

OFFICIAL = {"main", "daily", "bytecode", "freshclam"}
STAMP = "sanesecurity.checked"
FEED_SUFFIXES = {".ndb", ".hdb", ".hsb", ".ldb", ".cdb", ".ftm", ".ign2", ".fp", ".sfp", ".yar", ".yara", ".mdb", ".msb"}


def official_time(clamd_date: str | None) -> datetime | None:
    """'Mon Nov  3 07:25:00 2026' (clamd's own clock, UTC in the container) -> an aware datetime."""
    if not clamd_date:
        return None
    try:
        return datetime.strptime(" ".join(clamd_date.split()), "%a %b %d %H:%M:%S %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def feed_time(folder: str) -> datetime | None:
    """Last update check of the Sanesecurity feeds that ended without an error (the stamp the clamd image's feeds.sh
    writes), else the newest feed file, else None."""
    if not folder:
        return None
    try:
        stamp = Path(folder) / STAMP
        if stamp.is_file():
            return datetime.fromtimestamp(stamp.stat().st_mtime, timezone.utc)
        times = [p.stat().st_mtime for p in Path(folder).iterdir()
                 if p.is_file() and p.suffix.lower() in FEED_SUFFIXES and p.stem.lower() not in OFFICIAL]
    except OSError:
        return None
    return datetime.fromtimestamp(max(times), timezone.utc) if times else None


def age_hours(now: datetime, when: datetime | None) -> int | None:
    """Hours since `when` when it is older than the limit (-1 = missing), else None."""
    if when is None:
        return -1
    seconds = (now - when).total_seconds()
    return int(seconds // 3600) if seconds > SIGNATURES_STALE_HOURS * 3600 else None


class Watch:
    """Heartbeat helpers. `official` takes clamd's signature date text; `feeds` reads the folder (unset = not watched)."""

    def __init__(self, folder: str, clock=time.monotonic, now=lambda: datetime.now(timezone.utc)) -> None:
        self.folder, self.clock, self.now = folder, clock, now
        self._said: dict[str, float] = {}

    def _alert(self, code: str, when: datetime | None) -> None:
        hours = age_hours(self.now(), when)
        last = self._said.get(code)
        if hours is not None and (last is None or self.clock() - last >= 3600):
            self._said[code] = self.clock()
            logs.event("signatures_stale", code=code, count=hours)

    def official(self, clamd_date: str | None) -> str | None:
        self._alert("clamav_signatures_stale", official_time(clamd_date))
        return clamd_date

    def feeds(self) -> str | None:
        if not self.folder:
            return None
        when = feed_time(self.folder)
        self._alert("sanesecurity_stale", when)
        return when.isoformat(timespec="seconds") if when else None
