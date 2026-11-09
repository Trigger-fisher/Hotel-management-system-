"""PAN card (India): the 10-character pattern AAAPA9999A and income-tax keywords."""
from __future__ import annotations

from .base import Context, DocType, keyword_score, make_field

KEYWORDS = ("income tax department", "permanent account number", "आयकर विभाग", "आयकर", "आવકવેરા")


class Pan(DocType):
    name = "pan"

    def score(self, ctx: Context) -> float:
        pans = [i for i in ctx.identifiers if i["type"] == "pan"]
        return min(1.0, 0.55 * any(i["valid"] for i in pans) + 0.15 * bool(pans) + keyword_score(ctx, KEYWORDS, 0.45))

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        pans = [i for i in ctx.identifiers if i["type"] == "pan"]
        if pans:
            best = max(pans, key=lambda i: i["valid"])
            out["documentNumber"] = make_field(best["text"], 0.9, "ocr", valid=best["valid"])
        # On a PAN card the printed lines are: name, father's name, date of birth.
        return out


DOC_TYPE = Pan()
