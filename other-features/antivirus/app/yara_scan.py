"""Second virus engine: local YARA rules (yara-python). Nothing leaves the machine.

Rules live in app/yara_rules/*.yar (each file records its source and licence). Three groups:
  pdf_active      scanned on the whole PDF (and on a copy with "#xx" name escapes undone)
  image_polyglot  scanned on the whole file: an image that is also a program or archive
  trailing_data   scanned ONLY on the bytes after the end marker of an image / PDF
Compiled once per process."""
from __future__ import annotations

import functools
import re
import struct
from pathlib import Path

import yara

RULES_DIR = Path(__file__).with_name("yara_rules")
_HASH_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")


@functools.lru_cache(maxsize=1)
def _rules() -> yara.Rules:
    return yara.compile(filepaths={p.stem: str(p) for p in sorted(RULES_DIR.glob("*.yar"))})


def engine_name() -> str:
    return f"YARA {yara.YARA_VERSION}"


def trailing_bytes(data: bytes, kind: str) -> bytes:
    """Bytes after the format's end marker ('' when none or when the format has no simple marker)."""
    if kind == "png":
        i = data.rfind(b"IEND\xaeB`\x82")
        return data[i + 8:] if i >= 0 else b""
    if kind == "jpeg":
        i = data.rfind(b"\xff\xd9")
        return data[i + 2:] if i >= 0 else b""
    if kind == "gif":
        return b"" if data.endswith(b";") else (data[data.rfind(b";") + 1:] if b";" in data else b"")
    if kind == "webp" and len(data) >= 12:
        end = 8 + struct.unpack("<I", data[4:8])[0]
        end += end & 1
        return data[end:] if end < len(data) else b""
    if kind == "pdf":
        i = data.rfind(b"%%EOF")
        return data[i + 5:].strip() if i >= 0 else b""
    return b""


def scan(data: bytes, kind: str) -> tuple[list[str], int]:
    """Returns (names of matched rules, number of trailing bytes found after the end marker)."""
    rules = _rules()
    hits: set[str] = set()
    for m in rules.match(data=data):
        if m.namespace in ("pdf_active", "image_polyglot"):
            hits.add(m.rule)
    if kind == "pdf":
        normalised = _HASH_ESCAPE.sub(lambda g: bytes([int(g.group(1), 16)]), data)
        if normalised != data:
            hits |= {m.rule for m in rules.match(data=normalised) if m.namespace == "pdf_active"}
    tail = trailing_bytes(data, kind)
    if tail:
        hits |= {m.rule for m in rules.match(data=tail) if m.namespace == "trailing_data"}
    return sorted(hits), len(tail)

