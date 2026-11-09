"""Identifier helpers that only VALIDATE. They never invent or repair a value."""
from __future__ import annotations

import re

_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
      [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
      [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
PAN_HOLDER_TYPES = "PCHFATBLJG"  # 4th letter: person, company, HUF, firm, AOP, trust, body, local authority, juridical, government


def verhoeff_valid(number: str) -> bool:
    """True when the last digit is the correct Verhoeff check digit for the digits before it."""
    if not number.isdigit():
        return False
    c = 0
    for i, ch in enumerate(reversed(number)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def aadhaar_valid(text: str) -> bool:
    digits = re.sub(r"[\s-]", "", text)
    return bool(re.fullmatch(r"[2-9]\d{11}", digits)) and verhoeff_valid(digits)


def pan_valid(text: str) -> bool:
    value = text.strip().upper()
    return bool(re.fullmatch(r"[A-Z]{3}[%s][A-Z]\d{4}[A-Z]" % PAN_HOLDER_TYPES, value))


_AADHAAR = re.compile(r"(?<!\d)(\d{4}[ -]?\d{4}[ -]?\d{4})(?!\d)")
_PAN = re.compile(r"\b([A-Z]{5}\d{4}[A-Z])\b")


def find_identifiers(text: str) -> list[dict]:
    """Candidates found in text with a `valid` flag. A candidate that fails is reported as invalid, not fixed."""
    found = [{"type": "aadhaar", "text": m.group(1), "valid": aadhaar_valid(m.group(1))} for m in _AADHAAR.finditer(text)]
    found += [{"type": "pan", "text": m.group(1), "valid": pan_valid(m.group(1))} for m in _PAN.finditer(text)]
    return found
