"""Voter ID (EPIC, India): keywords and the 3 letters + 7 digits number pattern (a pattern CHECK only)."""
from __future__ import annotations

import re

from .base import Context, DocType, keyword_score, make_field

KEYWORDS = ("election commission", "elector", "epic no", "मतदाता", "निर्वाचन", "ચૂંટણી", "મતદાર")
EPIC = re.compile(r"\b([A-Z]{3}\d{7})\b")


class VoterId(DocType):
    name = "voter-id"

    def score(self, ctx: Context) -> float:
        return min(1.0, keyword_score(ctx, KEYWORDS, 0.6) + 0.4 * bool(EPIC.search(ctx.text.upper())))

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        m = EPIC.search(ctx.text.upper())
        if m:
            out["documentNumber"] = make_field(m.group(1), 0.8, "ocr", valid=True)
        return out


DOC_TYPE = VoterId()
