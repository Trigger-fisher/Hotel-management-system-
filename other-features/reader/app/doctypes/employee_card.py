"""Company or employee card: employee/staff keywords and an "ID/Emp No" label. No validator exists for these numbers."""
from __future__ import annotations

import re

from .base import Context, DocType, keyword_score, make_field

KEYWORDS = ("employee", "emp id", "emp no", "staff", "कर्मचारी", "કર્મચારી", "company id", "employee id")
NUMBER = re.compile(r"(?:emp(?:loyee)?\.?\s*(?:id|no|number)|staff\s*(?:id|no))\s*[:\-]?\s*([A-Z0-9\-]{3,16})", re.I)


class EmployeeCard(DocType):
    name = "employee-card"

    def score(self, ctx: Context) -> float:
        return min(1.0, keyword_score(ctx, KEYWORDS, 0.55) + 0.2 * bool(NUMBER.search(ctx.text)))

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        m = NUMBER.search(ctx.text)
        if m:
            out["documentNumber"] = make_field(m.group(1), 0.75, "ocr")
        return out


DOC_TYPE = EmployeeCard()
