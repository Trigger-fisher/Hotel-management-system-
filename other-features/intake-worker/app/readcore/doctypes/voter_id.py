# copied from reader on 2026-11-04 (extended in intake-worker on 2026-11-04: both sides, relation, gender, date of birth, address)
"""Voter ID (EPIC, India): keywords and the number of 3 letters + 7 digits (a pattern CHECK only; EPIC has no check digit).
Front: Elector's name, father's / husband's name, the EPIC number, the photo.
Back: the EPIC number again, sex, date of birth (or age on a date), address, the Electoral Registration Officer's signature."""
from __future__ import annotations

import re

from .base import Context, DocType, keyword_score, make_field

KEYWORDS = ("election commission", "elector", "epic no", "मतदाता", "निर्वाचन", "निर्वाचक", "ચૂંટણી", "મતદાર",
            "electoral registration officer", "elector photo identity", "भारत निर्वाचन आयोग", "ભારતનું ચૂંટણી પંચ")
NAME_LABEL = r"^[^A-Za-z]*(?:elector['’]?s?\s*name|name)\b"
RELATION = r"^[^A-Za-z]*(?:father['’]?s?|husband['’]?s?|mother['’]?s?|relation['’]?s?)\s*name\b"
STOP = re.compile(r"^\W*(?:date|dob|sex|gender|age|epic|electoral|place|facsimile)\b", re.I)
PERSON_NAME = r"([A-Z][A-Za-z .'-]{2,60})"


class VoterId(DocType):
    name = "voter-id"

    def score(self, ctx: Context) -> float:
        epics = [i for i in ctx.identifiers if i["type"] == "epic"]
        return min(1.0, keyword_score(ctx, KEYWORDS, 0.6) + 0.4 * any(i["valid"] for i in epics))

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        epics = [i for i in ctx.identifiers if i["type"] == "epic"]
        if epics:
            out["documentNumber"] = make_field(epics[0]["text"], 0.85, "ocr", valid=epics[0]["valid"])
        if name := ctx.label_value(NAME_LABEL, PERSON_NAME):
            out["name"] = name
        if relation := ctx.label_value(RELATION, PERSON_NAME):
            out["relationName"] = relation
        if "dob" not in out and (dob := ctx.label_date(r"^\W*(?:date of birth|dob|d\.o\.b)\b")):
            out["dob"] = dob
        if age := ctx.label_value(r"\bage as on\b", r"(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\s*[:\-]?\s*\d{2,3})"):
            out["ageOn"] = age
        if gender := ctx.gender():
            out["gender"] = gender
        if "address" not in out and (address := ctx.block_after(r"^\W*address\b", STOP)):
            out["address"] = address
        return out


DOC_TYPE = VoterId()
