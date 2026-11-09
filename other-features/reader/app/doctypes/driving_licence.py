"""Driving licence: keywords in several languages and the Indian layout SS99 YYYY NNNNNNN (a pattern CHECK only)."""
from __future__ import annotations

import re

from ..fields import DL_PATTERN
from .base import Context, DocType, keyword_score, make_field

KEYWORDS = ("driving licence", "driving license", "driver license", "driver's licence", "permis de conduire", "führerschein",
            "licencia de conducir", "ड्राइविंग", "वाहन चालन", "ડ્રાઇવિંગ", "ડ્રાઈવિંગ", "transport department", "form 7")


class DrivingLicence(DocType):
    name = "driving-licence"

    def score(self, ctx: Context) -> float:
        return min(1.0, keyword_score(ctx, KEYWORDS, 0.6) + 0.4 * bool(DL_PATTERN.search(ctx.text.upper())))

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        m = DL_PATTERN.search(ctx.text.upper())
        if m:
            out["documentNumber"] = make_field(re.sub(r"[\s-]", "", m.group(1)), 0.8, "ocr", valid=True)
        return out


DOC_TYPE = DrivingLicence()
