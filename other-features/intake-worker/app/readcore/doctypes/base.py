# copied from reader on 2026-11-04
"""Shared pieces for document types."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .. import fields as generic

# Gender words in English, Hindi and Gujarati (added in intake-worker on 2026-11-04). "Sex: M" on licences and voter IDs.
GENDER = re.compile(r"\b(male|female|transgender)\b|पुरुष|महिला|પુરુષ|સ્ત્રી", re.I)
SEX_LETTER = re.compile(r"\b(?:sex|gender)\s*[:/\-]?\s*([MFT])\b", re.I)
GENDER_WORDS = {"पुरुष": "Male", "પુરુષ": "Male", "महिला": "Female", "સ્ત્રી": "Female"}
DATE_TEXT = r"(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4})"


def make_field(value: str, confidence: float, source: str, valid: bool | None = None, doubtful: bool = False) -> dict:
    out = {"value": value, "confidence": round(confidence, 3), "source": source}
    if valid is not None:
        out["valid"] = valid
    if doubtful:
        out["doubtful"] = True
    return out


@dataclass
class Context:
    lines: list[dict]  # reader lines: text, confidence
    text: str  # all text, one string
    lower: str
    codes: list[dict]
    mrz: dict | None
    side: str = "front"
    identifiers: list[dict] = field(default_factory=list)

    @classmethod
    def from_result(cls, result: dict, side: str = "front") -> "Context":
        text = "\n".join(l["text"] for l in result.get("lines", []))
        return cls(result.get("lines", []), text, text.casefold(), result.get("codes", []), result.get("mrz"), side,
                   result.get("identifiers", []))

    def has(self, *words: str) -> bool:
        """Keyword search. Spaces do not count (the OCR often joins upper-case words: OVERSEASCITIZEN OFINDIA). Changed in
        intake-worker on 2026-11-04."""
        squeezed = re.sub(r"\s+", "", self.lower)
        return any(w.casefold() in self.lower or re.sub(r"\s+", "", w.casefold()) in squeezed for w in words)

    # ---- label helpers (added in intake-worker on 2026-11-04) -----------------------------------------------------------
    @staticmethod
    def _label(label: "re.Pattern | str") -> re.Pattern:
        """A label pattern in which every space may also be missing (Date ofBirth, Givennames)."""
        return re.compile(label.replace(" ", r"\s*"), re.I) if isinstance(label, str) else label

    def _below(self, i: int, below: int) -> list[dict]:
        """Lines under line i: by position when the reader gave boxes (the nearest lines below that overlap it sideways, so a
        two-column layout keeps label and value together), else simply the next lines."""
        line = self.lines[i]
        box = line.get("bbox")
        if not box or len(box) != 4 or box[3] <= box[1]:
            return self.lines[i + 1:i + 1 + below]
        x0, y0, x1, y1 = box
        h = y1 - y0
        found = []
        for j, other in enumerate(self.lines):
            b = other.get("bbox")
            if j == i or not b or len(b) != 4:
                continue
            if not (y1 - 0.4 * h <= b[1] <= y1 + 3.0 * h):
                continue
            overlap = min(x1, b[2]) - max(x0, b[0])
            if overlap > 0 or abs(b[0] - x0) <= 0.3 * max(x1 - x0, 1):
                found.append((b[1], abs(b[0] - x0), other))
        return [o for _, _, o in sorted(found, key=lambda t: (t[0], t[1]))][:below]

    def label_value(self, label: "re.Pattern | str", value: "re.Pattern | str | None" = None, below: int = 1) -> dict | None:
        """The value printed after a label on the same line ("DOB: 14/03/1981"), or BELOW it when the label stands alone
        ("नाम / Name" above the name, as on the new PAN card and passports). `value`, when given, must be found in the candidate."""
        lab = self._label(label)
        val = re.compile(value) if isinstance(value, str) else value  # labels ignore case, values do not (names start upper case)
        for i, line in enumerate(self.lines):
            m = lab.search(line["text"])
            if not m:
                continue
            raw = line["text"][m.end():]
            # "Given Name(s) / दिया गया नाम": what follows a slash is the label in the other language, not the value
            rest = "" if raw.lstrip().startswith("/") else raw.strip(" :-/|.\t")
            candidates = ([(rest, line["confidence"])] if rest else []) + \
                [(n["text"].strip(), n["confidence"]) for n in self._below(i, below)]
            for text, conf in candidates:
                if not text:
                    continue
                if val is None:
                    return make_field(text, conf, "ocr")
                if vm := val.search(text):
                    return make_field(vm.group(1) if vm.groups() else vm.group(0), conf, "ocr")
        return None

    def label_date(self, label: str, below: int = 1) -> dict | None:
        """A date after a label, as YYYY-MM-DD."""
        f = self.label_value(label, DATE_TEXT, below)
        m = generic.DATE.search(f["value"]) if f else None
        if not m:
            return None
        f["value"] = generic.normalise_dob(*m.groups())
        return f

    def block_after(self, label: str, stop: "re.Pattern | None" = None, most: int = 4) -> dict | None:
        """An address-like block: the rest of the label line plus the next lines, up to and including the line with a pin code."""
        lab = self._label(label)
        pin = re.compile(r"(?<!\d)[1-9]\d{2} ?\d{3}(?!\d)")
        for i, line in enumerate(self.lines):
            m = lab.search(line["text"])
            if not m:
                continue
            parts = [line["text"][m.end():].strip(" :-/|\t")]
            if pin.search(parts[0]):
                return make_field(parts[0], line["confidence"], "ocr")
            for nxt in self.lines[i + 1:i + 1 + most]:
                if (stop is not None and stop.search(nxt["text"])) or "<<" in nxt["text"]:  # never into an MRZ
                    break
                parts.append(nxt["text"].strip())
                if pin.search(nxt["text"]):
                    break
            text = ", ".join(p for p in parts if p)
            return make_field(text, line["confidence"], "ocr") if text else None
        return None

    def gender(self) -> dict | None:
        if g := GENDER.search(self.text):
            return make_field(GENDER_WORDS.get(g.group(0)) or g.group(0).title(), 0.85, "ocr")
        if s := SEX_LETTER.search(self.text):
            return make_field({"M": "Male", "F": "Female", "T": "Transgender"}[s.group(1).upper()], 0.85, "ocr")
        return None

    def generic_fields(self) -> dict:
        """name / dob / address from label lines and code payloads (see fields.py), re-labelled with their source."""
        raw = generic.extract_fields({"lines": self.lines, "codes": self.codes, "mrz": None, "identifiers": []}, self.side)
        return {k: make_field(v["value"], v["confidence"], v["source"]) for k, v in raw.items() if k in ("name", "dob", "address", "documentNumber")}


class DocType:
    name = "base"

    def score(self, ctx: Context) -> float:  # 0..1
        return 0.0

    def extract(self, ctx: Context) -> dict:
        return ctx.generic_fields()


def keyword_score(ctx: Context, words: tuple[str, ...], weight: float) -> float:
    return weight if ctx.has(*words) else 0.0


def first_match(pattern: str, text: str, flags: int = 0) -> str | None:
    m = re.search(pattern, text, flags)
    return m.group(1) if m else None
