"""Shared pieces for document types."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .. import fields as generic


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
        return any(w.casefold() in self.lower for w in words)

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
