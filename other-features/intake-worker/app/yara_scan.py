# adapted from antivirus on 2026-11-05
"""Local YARA rules (yara-python) on the bytes in memory, before any decoding. Nothing leaves the machine.

app/yara_rules/*.yar, one namespace per file:
  image_polyglot  the whole file: a picture that is also a program, an archive, a PDF, a web page, or carries script
  pdf_active      the whole PDF, and a copy with "#xx" name escapes undone
  trailing_data   only the bytes after the format's end marker
A hit rejects the file. A timeout or an engine error is a retry, never "clean"."""
from __future__ import annotations

import functools
import re
import struct
import time
from pathlib import Path

from . import logs
from .config import YARA_MAX_BYTES, YARA_SECONDS
from .errors import StepError, reject

try:
    import yara
except ImportError:  # pragma: no cover - the worker refuses to start without it (main.py)
    yara = None

RULES_DIR = Path(__file__).with_name("yara_rules")
WHOLE_FILE = ("image_polyglot", "pdf_active")
_HASH_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")
_ESCAPED_NAME = re.compile(rb"/[A-Za-z0-9#]*#[0-9A-Fa-f]{2}")
_ENTROPY_END = re.compile(rb"\xff(?=[^\x00\xd0-\xd7])", re.S)


def available() -> bool:
    return yara is not None


def engine_name() -> str:
    return f"YARA {yara.YARA_VERSION}"


@functools.lru_cache(maxsize=1)
def rules():
    return yara.compile(filepaths={p.stem: str(p) for p in sorted(RULES_DIR.glob("*.yar"))})


def _heic_end(data: bytes) -> int:
    pos = 0
    while pos + 8 <= len(data):
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        if size == 1 and pos + 16 <= len(data):
            size = struct.unpack(">Q", data[pos + 8:pos + 16])[0]
        elif size == 0:
            return len(data)
        if size < 8 or pos + size > len(data):
            return pos
        pos += size
    return pos


def _jpeg_end(data: bytes) -> int | None:
    """End of the first picture, walked segment by segment (a fake FF D9 after a hidden payload does not fool it)."""
    pos, n = 2, len(data)
    while pos + 2 <= n:
        if data[pos] != 0xFF:
            return None
        marker = data[pos + 1]
        if marker == 0xFF:
            pos += 1
            continue
        if marker == 0xD9:
            return pos + 2
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            pos += 2
            continue
        if pos + 4 > n:
            return None
        pos += 2 + struct.unpack(">H", data[pos + 2:pos + 4])[0]
        if marker == 0xDA:
            m = _ENTROPY_END.search(data, pos)
            if not m:
                return None
            pos = m.start()
    return None


def _png_end(data: bytes) -> int | None:
    pos, n = 8, len(data)
    while pos + 12 <= n:
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        end = pos + 12 + size
        if data[pos + 4:pos + 8] == b"IEND":
            return end
        pos = end
    return None


def trailing_bytes(data: bytes, kind: str) -> bytes:
    """Bytes after the format's end ('' when there are none)."""
    if kind == "png":
        end = _png_end(data)
        if end is None:
            i = data.rfind(b"IEND\xaeB`\x82")
            end = i + 8 if i >= 0 else len(data)
        return data[end:]
    if kind == "jpeg":
        end = _jpeg_end(data)
        if end is None:
            i = data.rfind(b"\xff\xd9")
            end = i + 2 if i >= 0 else len(data)
        return data[end:]
    if kind == "webp" and len(data) >= 12:
        end = 8 + struct.unpack("<I", data[4:8])[0]
        end += end & 1
        return data[end:] if end < len(data) else b""
    if kind == "heic":
        return data[_heic_end(data):]
    if kind == "pdf":
        i = data.rfind(b"%%EOF")
        return data[i + 5:].strip() if i >= 0 else b""
    return b""


def _match(compiled, data: bytes, deadline: float):
    left = deadline - time.monotonic()
    if left <= 0:
        raise yara.TimeoutError("time limit")
    return compiled.match(data=data, timeout=max(1, int(left + 0.999)))


def scan(data: bytes, kind: str) -> list[tuple[str, str]]:
    """(rule, description) of every rule that matched; [] when clean. Raises StepError for a refusal or a retry."""
    if yara is None:
        raise StepError("yara_unavailable", "The rule scanner is not installed.", 503, False, "scan")
    if len(data) > YARA_MAX_BYTES:
        raise reject("yara_too_large", "The file is too large for the rule scan.", "scan")
    deadline = time.monotonic() + YARA_SECONDS
    hits: dict[str, str] = {}
    try:
        compiled = rules()
        found = [m for m in _match(compiled, data, deadline) if m.namespace in WHOLE_FILE]
        if kind == "pdf" and _ESCAPED_NAME.search(data):
            normalised = _HASH_ESCAPE.sub(lambda g: bytes([int(g.group(1), 16)]), data)
            found += [m for m in _match(compiled, normalised, deadline) if m.namespace == "pdf_active"]
        tail = trailing_bytes(data, kind)
        if tail:
            found += [m for m in _match(compiled, tail, deadline) if m.namespace == "trailing_data"]
    except yara.TimeoutError:
        raise StepError("yara_timeout", "The rule scan took too long.", 503, False, "scan")
    except yara.Error:
        raise StepError("yara_error", "The rule scanner could not check this file.", 502, False, "scan")
    for m in found:
        hits.setdefault(m.rule, str(m.meta.get("description") or m.rule))
    if hits:
        logs.event("yara_match", step="scan", flags=sorted(hits), bytes=len(data))
    return sorted(hits.items())
