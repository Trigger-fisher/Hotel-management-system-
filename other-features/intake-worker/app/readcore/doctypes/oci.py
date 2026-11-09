"""OCI (Overseas Citizen of India), added in intake-worker on 2026-11-04, and the legacy PIO card. Held by foreign nationals of
Indian origin: the OCI number, the holder's name, date of birth, nationality and the FOREIGN passport number. Every form stands on
its own (no back to pair) and is linked to the guest's passport by that passport number (people.link_guests).

Forms of the OCI: `card` (the current OCI card), `booklet` (the old OCI booklet's data page: "Certificate of Registration"), and
`u-visa` (the "U" lifelong multiple-entry visa sticker in the foreign passport: its MRZ is a visa MRZ, but the type is OCI, the
OCI number is the document number and the sticker's own visa number is kept apart as visaNumber).
No check digit exists for the OCI or PIO number; it is shown as read."""
from __future__ import annotations

import re

from .base import Context, DocType, keyword_score, make_field
from .mrz_documents import mrz_fields, printed_fields

KEYWORDS = ("overseas citizen of india", "overseas citizenship of india", "oci card", "भारत का प्रवासी नागरिक", "प्रवासी भारतीय नागरिक",
            "ભારતના વિદેશી નાગરિક", "overseas citizen")
NUMBER_LABEL = r"\b(?:oc[il1|]\s*(?:card\s*)?|registration\s*|card\s*|certificate\s*)(?:no|number)\b"
NUMBER = r"\b([A-Z]\s?[0-9]{6,8})\b"
BOOKLET = ("certificate of registration", "registration certificate", "section 7a", "section 7 a")
U_VISA = ("life long", "lifelong", "universal visa", "multiple entry life", "visa type u", "type u")
PIO_WORDS = ("person of indian origin", "pio card", "p.i.o", "persons of indian origin")


def _u_visa(ctx: Context) -> bool:
    return ctx.has("visa") and (ctx.has(*U_VISA) or bool(re.search(r"\btype(?: of visa)?\s*[:\-]?\s*U\b", ctx.text, re.I)))


def _number(ctx: Context) -> dict | None:
    f = ctx.label_value(NUMBER_LABEL, NUMBER, 1)
    if f:
        f["value"] = f["value"].replace(" ", "")
    return f


class Oci(DocType):
    name = "oci"

    def score(self, ctx: Context) -> float:
        if ctx.has(*PIO_WORDS) and not ctx.has(*KEYWORDS):
            return 0.0
        number = _number(ctx) is not None
        u_visa = _u_visa(ctx) and (number or ctx.has("oci"))
        return min(1.0, max(keyword_score(ctx, KEYWORDS, 0.7) + 0.2 * number, 0.9 if u_visa else 0.0))

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        out.update(printed_fields(ctx))
        u_visa = _u_visa(ctx)
        if u_visa and ctx.mrz and ctx.mrz["lines"][0][:1].upper() == "V":
            mrz = mrz_fields(ctx.mrz)
            visa_number = mrz.pop("documentNumber", None)
            printed_name = out.get("name")
            out.update(mrz)
            if printed_name and printed_name["source"] == "ocr":
                out["printedName"] = printed_name
            if visa_number:
                out["visaNumber"] = visa_number
        if number := _number(ctx):
            out["documentNumber"] = number
        if gender := ctx.gender():
            out.setdefault("gender", gender)
        form = "u-visa" if u_visa else "booklet" if ctx.has(*BOOKLET) else "card"
        out["form"] = make_field(form, 0.9, "layout")
        return out


class Pio(DocType):
    """The Person of Indian Origin card (legacy, merged into OCI in 2015 but still shown). One page, the foreign passport number."""
    name = "pio"

    def score(self, ctx: Context) -> float:
        number = ctx.label_value(r"\b(?:pio\s*(?:card\s*)?|card\s*)(?:no|number)\b", NUMBER, 1) is not None
        return min(1.0, keyword_score(ctx, PIO_WORDS, 0.75) + 0.2 * number)

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        out.update(printed_fields(ctx))
        if number := ctx.label_value(r"\b(?:pio\s*(?:card\s*)?|card\s*)(?:no|number)\b", NUMBER, 1):
            number["value"] = number["value"].replace(" ", "")
            out["documentNumber"] = number
        if gender := ctx.gender():
            out["gender"] = gender
        return out


DOC_TYPES = [Oci(), Pio()]
