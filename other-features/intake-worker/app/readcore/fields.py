# copied from reader on 2026-11-04
"""Fields for ID-like documents, taken only from what is actually in the read result.
Nothing here guesses a missing value. Every field carries its confidence and where it came from."""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

NAME_MATCH_THRESHOLD = 0.85  # sorted-token similarity at or above this counts as the same name
NAME_MISMATCH_BELOW = 0.6  # below this the names are different people (or unreadable)
DL_PATTERN = re.compile(r"\b([A-Z]{2}[ -]?\d{2}[ -]?(?:19|20)\d{2}[ -]?\d{7})\b")  # Indian licence layout
TITLES = {"mr", "mrs", "ms", "miss", "dr", "shri", "smt", "kumari", "sri", "shree"}
LABEL_NAME = re.compile(r"^\s*(?:full\s+)?name\s*[:\-]\s*(.+)$", re.I)
LABEL_DOB = re.compile(r"(?:dob|date\s+of\s+birth|birth)\W*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", re.I)
DATE = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")
LABEL_ADDRESS = re.compile(r"^\s*address\s*[:\-]?\s*(.*)$", re.I)
PIN = re.compile(r"(?<!\d)[1-9]\d{2} ?\d{3}(?!\d)")
LABEL_NUMBER = re.compile(r"(?:id|no|number)\.?\s*[:\-]\s*([A-Z0-9][A-Z0-9 \-]{5,24})", re.I)


def field(value: str, confidence: float, side: str, source: str) -> dict:
    return {"value": value, "confidence": round(confidence, 3), "side": side, "source": source}


def normalise_name(text: str) -> str:
    """Case, spacing, diacritics, punctuation and titles removed; words sorted so order does not matter."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()
    words = [w for w in re.split(r"[^a-z0-9ऀ-෿؀-ۿ]+", plain) if w and w not in TITLES]
    return " ".join(sorted(words))


def name_similarity(a: str, b: str) -> float:
    na, nb = normalise_name(a), normalise_name(b)
    if not na or not nb:
        return 0.0
    # Transliteration tolerant: compare the joined letters too, so "Mohd Ali" vs "Mohammed Ali" scores sensibly.
    best = max(SequenceMatcher(None, na, nb).ratio(), SequenceMatcher(None, na.replace(" ", ""), nb.replace(" ", "")).ratio())
    # The OCR joins words ("KavitaJoshi"): compare the letters in printed order as well (intake-worker, 2026-11-04).
    pa, pb = (re.sub(r"[^a-z0-9ऀ-෿؀-ۿ]+", "", unicodedata.normalize("NFKD", t).casefold()) for t in (a, b))
    return max(best, SequenceMatcher(None, pa, pb).ratio() if pa and pb else 0.0)


def normalise_dob(day: str, month: str, year: str) -> str:
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def parse_qr_payload(text: str) -> dict[str, str]:
    """Simple `KEY=value;KEY=value` payloads (what a card issuer's QR often carries)."""
    pairs = re.findall(r"([A-Za-z_]+)=([^;\n]+)", text)
    return {k.upper(): v.strip() for k, v in pairs}


def extract_fields(result: dict, side: str) -> dict:
    """{name, dob, documentNumber, address} from one side's read result."""
    out: dict = {}
    lines = result.get("lines", [])
    for i, line in enumerate(lines):
        text, conf = line["text"], line["confidence"]
        if "name" not in out and (m := LABEL_NAME.match(text)):
            out["name"] = field(m.group(1).strip(), conf, side, "ocr")
        if "dob" not in out and (m := LABEL_DOB.search(text)):
            out["dob"] = field(normalise_dob(*m.groups()), conf, side, "ocr")
        if "address" not in out and (m := LABEL_ADDRESS.match(text)):
            rest = [m.group(1).strip()] if m.group(1).strip() else []
            for nxt in lines[i + 1:i + 3]:  # the next lines usually continue the address
                # the pin code ends an Indian address; an MRZ line or another "Label: value" line is not part of it
                # (intake-worker, 2026-11-04)
                if any(PIN.search(r) for r in rest) or "<<" in nxt["text"] or re.match(r"^\s*[A-Za-z][A-Za-z .]{2,25}:\s", nxt["text"]):
                    break
                if not LABEL_NAME.match(nxt["text"]) and not LABEL_DOB.search(nxt["text"]):
                    rest.append(nxt["text"].strip())
            if rest:
                out["address"] = field(", ".join(rest), conf, side, "ocr")
    for code in result.get("codes", []):
        payload = parse_qr_payload(code["text"])
        for key, name in (("NAME", "name"), ("DOB", "dob"), ("ID", "documentNumber"), ("ADDRESS", "address")):
            if key in payload and name not in out:
                value = payload[key]
                if name == "dob" and (m := DATE.search(value)):
                    value = normalise_dob(*m.groups())
                out[name] = field(value, 0.99, side, "qr")  # a decoded code is exact, but not verified
    numbers = _numbers(result, side)
    if numbers:
        out["documentNumber"] = max(numbers, key=lambda n: (n["valid"], n["confidence"]))
    mrz = result.get("mrz")
    if mrz:
        f = mrz["fields"]
        out["name"] = field(f"{f['givenNames']['value']} {f['surname']['value']}".strip(), 0.9 if f["surname"]["valid"] else 0.5, side, "mrz")
        out.setdefault("mrzDob", field(f["dateOfBirth"]["value"], 0.9 if f["dateOfBirth"]["valid"] else 0.4, side, "mrz"))
    return out


def _numbers(result: dict, side: str) -> list[dict]:
    """Document numbers with a type and a validity flag from the checks that exist for them."""
    found = []
    for ident in result.get("identifiers", []):
        if ident["type"] == "vid":  # a Virtual ID can be re-issued at any time: never evidence about a person
            continue
        found.append({**field(re.sub(r"[\s\-/]", "", ident["text"]), 0.9, side, "ocr"), "type": ident["type"], "valid": ident["valid"]})
    mrz = result.get("mrz")
    if mrz:
        number = mrz["fields"]["documentNumber"]
        found.append({**field(number["value"], 0.95 if number["valid"] else 0.4, side, "mrz"), "type": "mrz", "valid": number["valid"]})
    # Driving licence and EPIC numbers come with the identifiers (ids.find_identifiers, changed in intake-worker on 2026-11-04).
    for code in result.get("codes", []):
        payload = parse_qr_payload(code["text"])
        if "ID" in payload:
            from . import ids  # local import keeps the module light
            number = re.sub(r"[\s-]", "", payload["ID"])
            kind = "aadhaar" if re.fullmatch(r"\d{12}", number) else "pan" if ids.pan_valid(number) else "document"
            valid = ids.aadhaar_valid(number) if kind == "aadhaar" else kind == "pan"
            found.append({**field(number, 0.99, side, "qr"), "type": kind, "valid": valid})
    return found


def all_numbers(result: dict, side: str) -> list[dict]:
    return _numbers(result, side)
