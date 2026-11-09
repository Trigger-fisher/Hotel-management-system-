# copied from reader on 2026-11-04
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


# Added in intake-worker on 2026-11-04 (not in the reader): VID, driving licence, EPIC and Indian passport checks.
# Indian RTO state / union territory codes (old and new ones both appear on licences still in use).
STATE_CODES = frozenset("AN AP AR AS BR CH CG CT DD DL DN GA GJ HR HP JK JH KA KL LA LD MP MH MN ML MZ NL OD OR PB PY RJ SK TN TS TG "
                        "TR UP UK UA WB".split())
FIRST_DL_YEAR = 1950


def dl_parts(text: str) -> dict | None:
    """{state, rto, year, serial, form} of an Indian licence number, or None when the layout is not a licence layout.
    new  SS RR YYYY NNNNNNN (MH12 20110012345, GJ01 20190001234; spaces, hyphens or slashes allowed)
    old  SS-RR/NNNNN/YYYY (state formats from before 2019: serial first, year last)."""
    t = text.strip().upper()
    if m := re.fullmatch(r"([A-Z]{2})[ -]?(\d{2})[ \-/]?((?:19|20)\d{2})[ \-/]?(\d{7})", t):
        return {"state": m[1], "rto": m[2], "year": int(m[3]), "serial": m[4], "form": "new"}
    if m := re.fullmatch(r"([A-Z]{2})[ -]?(\d{2})[ \-/](\d{3,7})[ \-/]((?:19|20)\d{2})", t):
        return {"state": m[1], "rto": m[2], "year": int(m[4]), "serial": m[3], "form": "old"}
    return None


def dl_valid(text: str) -> bool:
    """A licence number CHECK (no check digit exists): a known state code, an RTO number above 00 and a believable year."""
    import datetime
    p = dl_parts(text)
    return bool(p and p["state"] in STATE_CODES and p["rto"] != "00" and FIRST_DL_YEAR <= p["year"] <= datetime.date.today().year)


def epic_valid(text: str) -> bool:
    """Voter ID (EPIC): three letters and seven digits. A pattern check only; EPIC has no check digit."""
    return bool(re.fullmatch(r"[A-Z]{3}\d{7}", text.strip().upper()))


def indian_passport_valid(text: str) -> bool:
    """Indian passport number: one letter and seven digits, the first digit not zero. A pattern check only (the MRZ check digit,
    when the data page is read, is the real check)."""
    return bool(re.fullmatch(r"[A-Z][1-9]\d{6}", text.strip().upper()))


# 12 digits; not when they are part of a 16-digit Virtual ID (VID) printed on e-Aadhaar letters and new cards.
_AADHAAR = re.compile(r"(?<!\d)(?<!\d[ -])(\d{4}[ -]?\d{4}[ -]?\d{4})(?![ -]?\d)")
_VID = re.compile(r"(?<!\d)(\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4})(?![ -]?\d)")
_PAN = re.compile(r"\b([A-Z]{5}\d{4}[A-Z])\b")
_DL = re.compile(r"(?<![A-Z0-9])([A-Z]{2}[ -]?\d{2}(?:[ \-/]?(?:19|20)\d{2}[ \-/]?\d{7}|[ \-/]\d{3,7}[ \-/](?:19|20)\d{2}))(?![A-Z0-9/])")
_EPIC = re.compile(r"\b([A-Z]{3}\d{7})\b")


def find_identifiers(text: str) -> list[dict]:
    """Candidates found in text with a `valid` flag. A candidate that fails is reported as invalid, not fixed."""
    found = [{"type": "aadhaar", "text": m.group(1), "valid": aadhaar_valid(m.group(1))} for m in _AADHAAR.finditer(text)]
    found += [{"type": "vid", "text": m.group(1), "valid": verhoeff_valid(re.sub(r"[\s-]", "", m.group(1)))} for m in _VID.finditer(text)]
    found += [{"type": "pan", "text": m.group(1), "valid": pan_valid(m.group(1))} for m in _PAN.finditer(text)]
    upper = text.upper()
    found += [{"type": "driving-licence", "text": m.group(1), "valid": dl_valid(m.group(1))} for m in _DL.finditer(upper)]
    found += [{"type": "epic", "text": m.group(1), "valid": epic_valid(m.group(1))} for m in _EPIC.finditer(upper)]
    return found
