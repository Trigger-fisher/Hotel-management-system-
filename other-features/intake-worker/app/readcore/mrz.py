# copied from reader on 2026-11-04
"""Machine readable zone (ICAO 9303 TD1, TD2, TD3): find the lines, parse them, VERIFY the check digits.

Nothing is corrected or guessed: a wrong character simply makes `valid` false for that field."""
from __future__ import annotations

import re

WEIGHTS = (7, 3, 1)
_LINE = re.compile(r"^[A-Z0-9<]+$")


def _value(ch: str) -> int:
    if ch.isdigit():
        return int(ch)
    if ch == "<":
        return 0
    return ord(ch) - 55  # A=10 ... Z=35


def check_digit(data: str) -> str:
    return str(sum(_value(c) * WEIGHTS[i % 3] for i, c in enumerate(data)) % 10)


# Characters that are NOT in the MRZ alphabet but that OCR models print for one that is (added in intake-worker on 2026-11-04).
# Only impossible characters are mapped; a wrong letter or digit is never changed (the check digits judge those).
LOOKALIKE = str.maketrans({"«": "<", "‹": "<", ">": "<", "θ": "0", "Θ": "0", "×": "X", "О": "O", "о": "O", "С": "C", "К": "K",
                           "Е": "E", "А": "A", "Р": "P", "М": "M", "Т": "T", "Н": "H", "В": "B", "Х": "X"})


def _normalise(text: str) -> str:
    return re.sub(r"\s+", "", text.translate(LOOKALIKE).upper())


def _join_fragments(cleaned: list[str]) -> list[str]:
    """A long run of < fillers is often read as a separate box after the names: put it back on its line."""
    out: list[str] = []
    for i, line in enumerate(cleaned):
        after = cleaned[i + 1] if i + 1 < len(cleaned) else ""
        if out and line and set(line) == {"<"} and _LINE.match(out[-1] or "~") and out[-1][:1] in "PVIACR" \
                and len(after) in (36, 44) and len(out[-1]) + len(line) <= len(after):
            out[-1] += line  # the names line of a TD3 / TD2 / visa, whose data line follows
        else:
            out.append(line)
    return out


def _ok(data: str, digit: str) -> bool:
    return digit in "0123456789" and check_digit(data) == digit


def _date_ok(yymmdd: str) -> bool:
    if not re.fullmatch(r"\d{6}", yymmdd):
        return False
    month, day = int(yymmdd[2:4]), int(yymmdd[4:6])
    return 1 <= month <= 12 and 1 <= day <= 31


def _field(value: str, valid: bool) -> dict:
    return {"value": value, "valid": bool(valid)}


def _names(raw: str) -> dict:
    surname, _, given = raw.rstrip("<").partition("<<")
    return {"surname": surname.replace("<", " ").strip(), "givenNames": given.replace("<", " ").strip()}


def _common_fields(country: str, doc_type: str, names_raw: str) -> dict:
    names = _names(names_raw)
    return {
        "documentType": _field(doc_type.replace("<", " ").strip(), bool(re.fullmatch(r"[A-Z<]{1,2}", doc_type))),
        "issuingCountry": _field(country.replace("<", ""), bool(re.fullmatch(r"[A-Z<]{3}", country))),
        "surname": _field(names["surname"], bool(re.fullmatch(r"[A-Z<]+", names_raw))),
        "givenNames": _field(names["givenNames"], bool(re.fullmatch(r"[A-Z<]*", names_raw))),
    }


def _parse_td3(l1: str, l2: str) -> dict:
    f = _common_fields(l1[2:5], l1[0:2], l1[5:44])
    f["documentNumber"] = _field(l2[0:9].replace("<", ""), _ok(l2[0:9], l2[9]))
    f["nationality"] = _field(l2[10:13].replace("<", ""), bool(re.fullmatch(r"[A-Z<]{3}", l2[10:13])))
    f["dateOfBirth"] = _field(l2[13:19], _ok(l2[13:19], l2[19]) and _date_ok(l2[13:19]))
    f["sex"] = _field(l2[20], l2[20] in "MFX<")
    f["expiryDate"] = _field(l2[21:27], _ok(l2[21:27], l2[27]) and _date_ok(l2[21:27]))
    personal_ok = _ok(l2[28:42], l2[42]) or (set(l2[28:42]) == {"<"} and l2[42] in "<0")
    f["personalNumber"] = _field(l2[28:42].replace("<", ""), personal_ok)
    f["composite"] = _field("", _ok(l2[0:10] + l2[13:20] + l2[21:43], l2[43]))
    return f


def _parse_td2(l1: str, l2: str) -> dict:
    f = _common_fields(l1[2:5], l1[0:2], l1[5:36])
    f["documentNumber"] = _field(l2[0:9].replace("<", ""), _ok(l2[0:9], l2[9]))
    f["nationality"] = _field(l2[10:13].replace("<", ""), bool(re.fullmatch(r"[A-Z<]{3}", l2[10:13])))
    f["dateOfBirth"] = _field(l2[13:19], _ok(l2[13:19], l2[19]) and _date_ok(l2[13:19]))
    f["sex"] = _field(l2[20], l2[20] in "MFX<")
    f["expiryDate"] = _field(l2[21:27], _ok(l2[21:27], l2[27]) and _date_ok(l2[21:27]))
    f["optionalData"] = _field(l2[28:35].replace("<", ""), True)
    f["composite"] = _field("", _ok(l2[0:10] + l2[13:20] + l2[21:35], l2[35]))
    return f


def _parse_td1(l1: str, l2: str, l3: str) -> dict:
    f = _common_fields(l1[2:5], l1[0:2], l3[0:30])
    f["documentNumber"] = _field(l1[5:14].replace("<", ""), _ok(l1[5:14], l1[14]))
    f["dateOfBirth"] = _field(l2[0:6], _ok(l2[0:6], l2[6]) and _date_ok(l2[0:6]))
    f["sex"] = _field(l2[7], l2[7] in "MFX<")
    f["expiryDate"] = _field(l2[8:14], _ok(l2[8:14], l2[14]) and _date_ok(l2[8:14]))
    f["nationality"] = _field(l2[15:18].replace("<", ""), bool(re.fullmatch(r"[A-Z<]{3}", l2[15:18])))
    f["composite"] = _field("", _ok(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29], l2[29]))
    return f


def _parse_visa(l1: str, l2: str) -> dict:
    """Machine-readable visa, MRV-A (2 x 44) or MRV-B (2 x 36). Added in intake-worker on 2026-11-04: a visa has no composite
    check digit and its optional data carries none either (ICAO 9303 part 7)."""
    width = len(l1)
    f = _common_fields(l1[2:5], l1[0:2], l1[5:width])
    f["documentNumber"] = _field(l2[0:9].replace("<", ""), _ok(l2[0:9], l2[9]))
    f["nationality"] = _field(l2[10:13].replace("<", ""), bool(re.fullmatch(r"[A-Z<]{3}", l2[10:13])))
    f["dateOfBirth"] = _field(l2[13:19], _ok(l2[13:19], l2[19]) and _date_ok(l2[13:19]))
    f["sex"] = _field(l2[20], l2[20] in "MFX<")
    f["expiryDate"] = _field(l2[21:27], _ok(l2[21:27], l2[27]) and _date_ok(l2[21:27]))
    f["optionalData"] = _field(l2[28:width].replace("<", ""), True)
    return f


def iso_date(yymmdd: str, kind: str = "birth", today: "object | None" = None) -> str | None:
    """YYMMDD -> YYYY-MM-DD. Birth dates take the century that keeps them in the past; expiry dates are always 20YY. Added in
    intake-worker on 2026-11-04 so MRZ dates compare with printed dates."""
    import datetime
    if not re.fullmatch(r"\d{6}", yymmdd or ""):
        return None
    yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:])
    now = today or datetime.date.today()
    year = 2000 + yy if kind != "birth" or 2000 + yy <= now.year else 1900 + yy
    try:
        return datetime.date(year, mm, dd).isoformat()
    except ValueError:
        return None


def _pad(line: str, width: int, names_only: bool = False) -> str | None:
    """The OCR often drops part of a long run of < fillers at the END of the names line. Only that line is padded (never a line
    that carries check digits); the caller marks the MRZ as padded."""
    first_ok = line[:1].isalpha() if names_only else line[:1] in "PVIACR"
    if width - 12 <= len(line) < width and first_ok and _LINE.match(line):
        return line.ljust(width, "<")
    return None


def parse_mrz(lines: list[str]) -> dict | None:
    """Find the first MRZ among OCR lines. Returns {format, valid, fields, lines, padded} or None."""
    cleaned = _join_fragments([_normalise(t) for t in lines])
    for i in range(len(cleaned)):
        if not _LINE.match(cleaned[i] or "~"):
            continue
        n = len(cleaned[i])
        group = None
        padded = False
        nxt = cleaned[i + 1] if i + 1 < len(cleaned) else ""
        names_whole = True
        if n != len(nxt) and len(nxt) in (44, 36) and _LINE.match(nxt) and (fixed := _pad(cleaned[i], len(nxt))):
            names_whole = _names_whole(cleaned[i][5:])
            cleaned[i], n, padded = fixed, len(fixed), True
        if n == 44 and len(nxt) == 44 and _LINE.match(nxt):
            group = ("MRV-A", cleaned[i:i + 2], _parse_visa) if cleaned[i][0] == "V" else ("TD3", cleaned[i:i + 2], _parse_td3)
        elif n == 36 and len(nxt) == 36 and _LINE.match(nxt):
            group = ("MRV-B", cleaned[i:i + 2], _parse_visa) if cleaned[i][0] == "V" else ("TD2", cleaned[i:i + 2], _parse_td2)
        elif n == 30 and i + 2 < len(cleaned) and len(nxt) == 30 and _LINE.match(nxt) and _LINE.match(cleaned[i + 2] or "~"):
            third = cleaned[i + 2] if len(cleaned[i + 2]) == 30 else _pad(cleaned[i + 2], 30, names_only=True)
            if third:
                if third != cleaned[i + 2]:
                    padded, names_whole = True, _names_whole(cleaned[i + 2])
                group = ("TD1", [cleaned[i], nxt, third], _parse_td1)
        if group:
            fmt, mrz_lines, parser = group
            fields = parser(*mrz_lines)
            checked = ("documentNumber", "dateOfBirth", "expiryDate") + (("composite",) if "composite" in fields else ())
            valid = all(fields[k]["valid"] for k in checked) and all(v["valid"] for v in fields.values())
            return {"format": fmt, "valid": valid, "fields": fields, "lines": mrz_lines, "padded": padded, "namesWhole": names_whole}
    return None


def _data_part(found: dict) -> tuple[str, ...]:
    """The lines the check digits cover: TD1 lines 1 and 2, the second line of every other format."""
    lines = found["lines"]
    return (found["format"], *(lines[:2] if found["format"] == "TD1" else lines[1:2]))


def _names_part(found: dict) -> str:
    lines = found["lines"]
    return (lines[2] if found["format"] == "TD1" else lines[0]).rstrip("<")


def _pool(candidates: list[list[str]], limit: int = 12) -> list[str]:
    out: list[str] = []
    for texts in candidates:
        for line in _join_fragments([_normalise(t) for t in texts]):
            if len(line) >= 26 and _LINE.match(line) and line not in out:
                out.append(line)
    return out[:limit]


def choose(candidates: list[list[str]]) -> dict | None:
    """The MRZ from several readings of one page (the first read, then the dedicated MRZ pass; added in intake-worker on
    2026-11-05). Only a reading whose check digits ALL pass is taken; lines of different readings are also tried together, since
    the check digits judge each combination. Nothing is corrected. When no reading passes, the first MRZ found is returned as it
    was read (valid False: doubtful). When readings that pass disagree on a checked line, none is trusted (valid False,
    `readingsDisagree`). The names line carries no check digit: `namesAgree` is False when the passing readings spell it
    differently (the most frequent spelling is kept, and the name is marked doubtful)."""
    parsed = [found for texts in candidates if texts and (found := parse_mrz(texts))]
    good = [p for p in parsed if p["valid"]]
    if not good and len(candidates) > 1:
        pool = _pool(candidates)
        for a in pool:
            for b in pool:
                if a == b:
                    continue
                if len(a) == len(b) == 30:
                    good += [p for c in pool if c not in (a, b) and (p := parse_mrz([a, b, c])) and p["valid"]]
                elif (p := parse_mrz([a, b])) and p["valid"]:
                    good.append(p)
    if not good:
        return {**parsed[0], "readings": len(candidates)} if parsed else None
    if len({_data_part(p) for p in good}) > 1:
        return {**good[0], "valid": False, "readingsDisagree": True, "readings": len(candidates)}
    voters = [p for p in good if not p.get("padded")] or good  # a names line read short (padded) may have lost letters too
    spellings = [_names_part(p) for p in voters]
    best = max(voters, key=lambda p: spellings.count(_names_part(p)))
    return {**best, "namesAgree": len(set(spellings)) == 1, "readings": len(candidates),
            "agreeing": spellings.count(_names_part(best))}


def _names_whole(names: str) -> bool:
    """Were the names complete before padding? Yes when the surname, the << separator and given names were read and the line
    still ended in fillers (<<): only fillers can then be missing."""
    surname, sep, given = names.partition("<<")
    return bool(surname.strip("<") and sep and given.strip("<") and names.endswith("<<"))
