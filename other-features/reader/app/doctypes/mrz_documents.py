"""Machine-readable-zone documents: passport (TD3), national ID cards (TD1/TD2), visas and residence permits.
Fields come from the MRZ with the check-digit result of each field as `valid`. Nothing is corrected."""
from __future__ import annotations

from .base import Context, DocType, make_field

MAP = {"documentNumber": "documentNumber", "dateOfBirth": "dob", "expiryDate": "expiry", "nationality": "nationality",
       "issuingCountry": "issuingCountry", "sex": "sex"}


def mrz_fields(mrz: dict) -> dict:
    f = mrz["fields"]
    out = {}
    for source, target in MAP.items():
        if source in f:
            out[target] = make_field(f[source]["value"], 0.95 if f[source]["valid"] else 0.4, "mrz", valid=f[source]["valid"])
    names = f["givenNames"]["value"] + " " + f["surname"]["value"]
    out["name"] = make_field(names.strip(), 0.95 if f["surname"]["valid"] else 0.4, "mrz", valid=f["surname"]["valid"])
    if mrz.get("namesAgree") is False:  # readings that pass every check digit spell the names line differently (2026-11-05)
        out["name"]["doubtful"] = True
        out["name"]["confidence"] = min(out["name"]["confidence"], 0.6)
    out["mrzValid"] = make_field(str(mrz["valid"]).lower(), 1.0, "mrz", valid=mrz["valid"])
    return out


class MrzType(DocType):
    """Subclasses say which MRZ they own by `claims(mrz)`."""

    keywords: tuple[str, ...] = ()

    def claims(self, mrz: dict) -> bool:
        return False

    def score(self, ctx: Context) -> float:
        if not ctx.mrz or not self.claims(ctx.mrz):
            return 0.35 if ctx.has(*self.keywords) and self.keywords else 0.0
        return 1.0 if ctx.mrz["valid"] else 0.8

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        if ctx.mrz:
            out.update(mrz_fields(ctx.mrz))
        return out


def _doc_letter(mrz: dict) -> str:
    return (mrz["lines"][0][:1] or "").upper()


class Passport(MrzType):
    name = "passport"
    keywords = ("passport", "पासपोर्ट", "પાસપોર્ટ", "reisepass", "passeport")

    def claims(self, mrz: dict) -> bool:
        return mrz["format"] == "TD3" and _doc_letter(mrz) == "P"


class Visa(MrzType):
    name = "visa"
    keywords = ("visa", "वीजा", "વિઝા")

    def claims(self, mrz: dict) -> bool:
        return _doc_letter(mrz) == "V"


class ResidencePermit(MrzType):
    name = "residence-permit"
    keywords = ("residence permit", "permis de séjour", "aufenthaltstitel", "permiso de residencia")

    def claims(self, mrz: dict) -> bool:
        second = (mrz["lines"][0][1:2] or "").upper()
        return mrz["format"] in ("TD1", "TD2") and _doc_letter(mrz) == "I" and second == "R" or _doc_letter(mrz) == "R"


class NationalId(MrzType):
    name = "national-id"
    keywords = ("identity card", "national id", "carte d'identité", "personalausweis", "cédula", "ausweis")

    def claims(self, mrz: dict) -> bool:
        letter = _doc_letter(mrz)
        second = (mrz["lines"][0][1:2] or "").upper()
        return mrz["format"] in ("TD1", "TD2") and letter in ("I", "A", "C") and second != "R"


DOC_TYPES = [Passport(), Visa(), ResidencePermit(), NationalId()]
