"""Safe logging. A log line may carry ONLY the allow-listed keys below, with plain numbers or short codes as values.
Never file content, names, ID numbers, signed links, keys or free-form error text."""
from __future__ import annotations

import json
import logging
import re
import sys

ALLOWED = {"event", "job", "step", "status", "code", "ms", "attempt", "attempts", "queued", "threads", "version",
           "pages", "bytes", "flags", "count", "sleep"}
_UNSAFE = re.compile(r"https?://|[A-Za-z0-9+/_-]{40,}|\d{8,}")  # links, long tokens, long digit runs

log = logging.getLogger("intake")


def setup(stream=None) -> None:
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))
    log.handlers[:] = [handler]
    log.setLevel(logging.INFO)
    log.propagate = False
    # their INFO and DEBUG lines carry the signed links (httpx, httpcore) and the EXIF values, GPS included (PIL)
    for noisy in ("httpx", "httpcore", "PIL"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def safe(value):
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [safe(v) for v in value][:20]
    text = str(value)[:60]
    return "[redacted]" if _UNSAFE.search(text) else text


def event(name: str, **fields) -> None:
    line = {"event": name}
    for key, value in fields.items():
        if key in ALLOWED:
            line[key] = safe(value)
    log.info(json.dumps(line, separators=(",", ":")))
