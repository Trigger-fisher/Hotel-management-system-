# copied from reader on 2026-11-04 (extended in intake-worker on 2026-11-04: printed fields, the Indian passport's address page,
# visas MRV-A/B, ID card fronts without an MRZ, dates as YYYY-MM-DD)
"""Machine-readable-zone documents: passport (TD3), national ID cards (TD1/TD2), visas (MRV-A/B) and residence permits.
Fields come from the MRZ with the check-digit result of each field as `valid`. Nothing is corrected. Printed fields (label
lines) fill what the MRZ does not carry (issue date, place of issue, address on the Indian passport's last page, file number).

Sides:
  passport     data page (MRZ, photo) = front; Indian passport last page (address, file number, parents) = back
  national ID  TD1: printed front, MRZ on the back; TD2: MRZ on the front
  visa         one side: MRV-A / MRV-B sticker, an older sticker without an MRZ (labels only), the e-Visa ETA printout
  residence    TD1 / TD2 card (MRZ codes IR, AR, CR, RP) like an ID card; the FRRO permit printout is one page"""
from __future__ import annotations

import re

from .. import ids
from ..mrz import iso_date
from .base import Context, DocType, make_field

MAP = {"documentNumber": "documentNumber", "dateOfBirth": "dob", "expiryDate": "expiry", "nationality": "nationality",
       "issuingCountry": "issuingCountry", "sex": "sex"}
SEX = {"M": "Male", "F": "Female", "X": "Other"}
PERSON = r"([A-Z][A-Za-z .'-]{1,60})"
# Indian (Z4829163), and foreign: letters and digits mixed (C4X7Z2K91, German) or 8-9 digits (US); a 6-digit pin code is not one.
PASSPORT_NO = r"\b((?=[A-Z0-9]{6,9}\b)(?=[A-Z0-9]*[0-9])(?:[A-Z][A-Z0-9]{5,8}|[0-9]{8,9}))\b"
CURRENT_PASSPORT = r"^(?!.*\bold\b).*?\bpassport\s*(?:no|number|nr)\b"
ADDRESS_PAGE = ("file no", "legal guardian", "old passport no", "name of spouse", "name of mother", "name of father")
DATA_PAGE = ("republic of", "country code", "date of expiry", "given name", "surname", "place of birth", "place of issue",
             "type p", "nationality")


def mrz_fields(mrz: dict) -> dict:
    f = mrz["fields"]
    out = {}
    for source, target in MAP.items():
        if source not in f:
            continue
        value, valid = f[source]["value"], f[source]["valid"]
        if target in ("dob", "expiry"):
            value = iso_date(value, "birth" if target == "dob" else "expiry") or value
        elif target == "sex":
            out["gender"] = make_field(SEX.get(value, value), 0.95 if valid else 0.4, "mrz", valid=valid)
        out[target] = make_field(value, 0.95 if valid else 0.4, "mrz", valid=valid)
    names = f["givenNames"]["value"] + " " + f["surname"]["value"]
    # The names line has no check digit. When the OCR lost characters on it (padded), letters may be lost with the fillers
    # ("CHEN<<WEI" read as "CHE<<E"): a clearly printed name on the other side then wins (people.person_fields), and differs.
    sure = 0.6 if mrz.get("padded") else 0.95
    out["name"] = make_field(names.strip(), sure if f["surname"]["valid"] else 0.4, "mrz", valid=f["surname"]["valid"])
    out["mrzValid"] = make_field(str(mrz["valid"]).lower(), 1.0, "mrz", valid=mrz["valid"])
    out["mrzFormat"] = make_field(mrz["format"], 1.0, "mrz")
    if mrz.get("padded") and not mrz.get("namesWhole"):
        out["name"]["doubtful"] = True  # the fillers after the names were cut by the OCR: a part of the name may be missing too
    if mrz.get("namesAgree") is False:
        out["name"]["doubtful"] = True  # readings that pass every check digit spell the names line differently (2026-11-05)
        out["name"]["confidence"] = min(out["name"]["confidence"], 0.6)
    return out


def printed_fields(ctx: Context) -> dict:
    """Label lines of passports, visas, OCI and ID cards (English with a Hindi or other part before or after the slash)."""
    out = {}
    surname = ctx.label_value(r"^[^A-Za-z]*(?:surname|nom|name\s*/\s*surname)\b", PERSON, 2)
    given = ctx.label_value(r"^[^A-Za-z]*(?:given\s*names?(?:\(s\))?|prénoms?|vornamen?)", PERSON, 2)
    if surname and given:
        out["name"] = make_field(f"{given['value']} {surname['value']}", min(surname["confidence"], given["confidence"]), "ocr")
    elif name := ctx.label_value(r"^[^A-Za-z]*(?:name|full name|holder['’]?s? name)\b(?!\s*of\b)", PERSON, 1):
        out["name"] = name
    if dob := ctx.label_date(r"(?:date of birth|dob|d\.o\.b|birth date)\b", 2):
        out["dob"] = dob
    if issue := ctx.label_date(r"(?:date of [il1]ssue|[il1]ssue date|issued on|valid from)\b", 2):
        out["issueDate"] = issue
    if expiry := ctx.label_date(r"(?:date of expiry|expiry date|valid until|valid till|valid upto|date of expiration)\b", 2):
        out["expiry"] = expiry
    if nationality := ctx.label_value(r"^[^A-Za-z]*(?:.*/\s*)?nationality\b", r"([A-Z][A-Za-z]{2,30}(?: [A-Z]{3,30})?)", 2):
        out["nationality"] = nationality
    if place := ctx.label_value(r"(?:place of birth)\b", r"([A-Z][A-Za-z ,.'-]{1,40})", 2):
        out["placeOfBirth"] = place
    if place := ctx.label_value(r"(?:place of [il1]ssue)\b", r"([A-Z][A-Za-z ,.'-]{1,40})", 2):
        out["placeOfIssue"] = place
    if passport := ctx.label_value(CURRENT_PASSPORT, PASSPORT_NO, 3):
        out["passportNumber"] = passport
    return out


class MrzType(DocType):
    """Subclasses say which MRZ they own by `claims(mrz)`."""

    keywords: tuple[str, ...] = ()

    def claims(self, mrz: dict) -> bool:
        return False

    def score(self, ctx: Context) -> float:
        if not ctx.mrz or not self.claims(ctx.mrz):
            return self.score_printed(ctx)
        return 1.0 if ctx.mrz["valid"] else 0.8

    def score_printed(self, ctx: Context) -> float:
        return 0.35 if ctx.has(*self.keywords) and self.keywords else 0.0

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        out.update(printed_fields(ctx))
        if ctx.mrz and self.claims(ctx.mrz):
            mrz = mrz_fields(ctx.mrz)
            printed_name = out.get("name")
            out.update(mrz)
            if printed_name and printed_name["source"] == "ocr":
                out["printedName"] = printed_name
        return out


def _doc_letter(mrz: dict) -> str:
    return (mrz["lines"][0][:1] or "").upper()


def _count(ctx: Context, words: tuple[str, ...]) -> int:
    return sum(ctx.has(w) for w in words)


class Passport(MrzType):
    name = "passport"
    keywords = ("passport", "पासपोर्ट", "પાસપોર્ટ", "reisepass", "passeport", "pasaporte", "passaporto")

    def claims(self, mrz: dict) -> bool:
        return mrz["format"] == "TD3" and _doc_letter(mrz) == "P"

    def score_printed(self, ctx: Context) -> float:
        if _count(ctx, ADDRESS_PAGE) >= 2:  # the Indian passport's last page
            return 0.75
        if ctx.has("visa", "overseas citizen", "oci card"):  # a visa or an OCI card names the passport, it is not one
            return 0.3
        return min(0.7, 0.35 * ctx.has(*self.keywords) + 0.25 * (_count(ctx, DATA_PAGE) >= 2) + 0.1 * (_count(ctx, DATA_PAGE) >= 4))

    def extract(self, ctx: Context) -> dict:
        out = super().extract(ctx)
        if not (ctx.mrz and self.claims(ctx.mrz)) and "passportNumber" in out:
            number = out["passportNumber"]["value"]
            indian = ctx.has("republic of india", "भारत गणराज्य", "file no", "legal guardian") or out.get("nationality", {}).get("value", "").upper() in ("IND", "INDIAN")
            out["documentNumber"] = make_field(number, 0.8, "ocr", valid=ids.indian_passport_valid(number) if indian else None)
        if file_no := ctx.label_value(r"\bfile\s*(?:no|number)\b", r"\b([A-Z]{2,3}[0-9]{8,13})\b", 2):
            out["fileNumber"] = file_no
        if old := ctx.label_value(r"\bold passport\s*(?:no|number)\b", PASSPORT_NO, 2):
            out["oldPassportNumber"] = old
        for key, label in (("fatherName", r"name of father|father['’]?s? name"), ("motherName", r"name of mother|mother['’]?s? name"),
                           ("spouseName", r"name of spouse|spouse['’]?s? name")):
            if value := ctx.label_value(rf"^[^A-Za-z]*(?:{label})\b(?:\s*/\s*legal guardian)?", PERSON, 2):
                out[key] = value
        if "address" not in out and (address := ctx.block_after(r"^[^A-Za-z]*address\b", re.compile(r"old passport|file no", re.I), 5)):
            out["address"] = address
        if _count(ctx, ADDRESS_PAGE) >= 2 and not (ctx.mrz and self.claims(ctx.mrz)):
            for key in ("placeOfIssue", "issueDate"):  # on the last page these belong to the OLD passport
                out.pop(key, None)
        out["page"] = make_field("data" if (ctx.mrz and self.claims(ctx.mrz)) or _count(ctx, DATA_PAGE) >= 2 else
                                 "address" if _count(ctx, ADDRESS_PAGE) >= 2 else "unknown", 0.8, "layout")
        return out


# ---- visas, OCI markers and the FRRO permit (added in intake-worker on 2026-11-04) -------------------------------------------
# The Indian e-Visa arrives as an ETA printout (A4): no sticker, no MRZ, an application ID instead of a visa number.
ETA_WORDS = ("electronic travel authorisation", "electronic travel authorization", "e-visa", "evisa", "e-tourist visa",
             "e-business visa", "e-medical visa", "e-conference visa", "eta issue", "eta expiry", "eta grant")
# An OCI "U" visa sticker (lifelong, multiple entry) in a foreign passport, and the OCI card / old booklet, all name a visa.
OCI_WORDS = ("overseas citizen", "oci card", "oci no", "oci registration", "life long", "lifelong", "universal visa",
             "भारत का प्रवासी नागरिक", "ભારતના વિદેશી નાગરિક")
# The FRRO residential permit / registration certificate printout names the visa and the passport, it is neither.
FRRO_WORDS = ("foreigners regional registration", "foreigners registration office", "frro", "residential permit",
              "registration certificate", "e-frro")
APPLICANT = r"^[^A-Za-z]*(?:applicant['’]?s?\s*name|name of (?:the )?applicant)\b"


def oci_marked(ctx: Context) -> bool:
    return ctx.has(*OCI_WORDS)


def frro_marked(ctx: Context) -> bool:
    return ctx.has(*FRRO_WORDS)


class Visa(MrzType):
    """Forms: mrv-a / mrv-b (sticker with an MRZ), printed (an older sticker read from its labels only), eta (the e-Visa printout).
    One side; linked to the same guest's passport by the passport number printed on it (people.link_guests), never stacked."""
    name = "visa"
    keywords = ("visa", "वीजा", "वीसा", "વિઝા", "e-visa", "evisa")

    def claims(self, mrz: dict) -> bool:
        return _doc_letter(mrz) == "V"

    def score(self, ctx: Context) -> float:
        base = super().score(ctx)
        if oci_marked(ctx) or frro_marked(ctx):  # an OCI U-visa or an FRRO permit: the OCI / residence-permit type wins
            return min(base, 0.45)
        return base

    def score_printed(self, ctx: Context) -> float:
        markers = ("no. of entries", "number of entries", "entries", "type of visa", "visa type", "valid from", "duration of stay",
                   "visa no", "visa number", "application id")
        if ctx.has(*ETA_WORDS):
            return 0.9
        return min(0.8, 0.45 * ctx.has(*self.keywords) + 0.3 * (_count(ctx, markers) >= 1))

    def extract(self, ctx: Context) -> dict:
        out = super().extract(ctx)
        if "name" not in out and (name := ctx.label_value(APPLICANT, PERSON, 1)):
            out["name"] = name
        if entries := ctx.label_value(r"(?:no\.? of entries|number of entries|entries)\b", r"\b((?i:single|double|triple|multiple)|[0-9]{1,2}|M|S|D)\b", 1):
            out["entries"] = entries
        if kind := ctx.label_value(r"^[^A-Za-z]*(?:type of visa|visa type|visa category|type|category)\b",
                                   r"\b((?:e-)?[A-Z][A-Za-z -]{0,30})\b", 1):
            out["visaType"] = kind
        if validity := ctx.label_value(r"^[^A-Za-z]*(?:visa validity|validity|duration of stay)\b", r"([0-9A-Za-z][0-9A-Za-z /.-]{1,40})", 1):
            out["validity"] = validity
        eta = ctx.has(*ETA_WORDS)
        if application := ctx.label_value(r"\bapplication\s*(?:id|no|number)\b", r"\b([A-Z0-9]{8,20})\b", 1):
            out["applicationId"] = application
        if "documentNumber" not in out:
            if number := ctx.label_value(r"\bvisa\s*(?:no|number)\b", r"\b([A-Z0-9]{6,12})\b", 1):
                out["documentNumber"] = number  # printed only: no check digit without an MRZ
            elif eta and application:
                out["documentNumber"] = make_field(application["value"], application["confidence"], "ocr")
        mrz = ctx.mrz if ctx.mrz and self.claims(ctx.mrz) else None
        form = "eta" if eta and not mrz else ("mrv-a" if mrz["format"] == "MRV-A" else "mrv-b") if mrz else "printed"
        out["form"] = make_field(form, 0.9, "layout")
        return out


ID_STOP = re.compile(r":|\b(?:height|eyes|place of birth|date|card no|document no|nationality|sex|signature)\b", re.I)
ID_NUMBER = r"^[^A-Za-z]*(?:.*/\s*)?(?:document|card|id|identity card)\s*(?:no|number|nr|n°)\b"


class NationalId(MrzType):
    name = "national-id"
    keywords = ("identity card", "national id", "carte d'identité", "carte nationale", "personalausweis", "cédula", "ausweis",
                "documento nacional de identidad", "carta d'identità", "identiteitskaart", "id card")

    def claims(self, mrz: dict) -> bool:
        letter = _doc_letter(mrz)
        second = (mrz["lines"][0][1:2] or "").upper()
        return mrz["format"] in ("TD1", "TD2") and letter in ("I", "A", "C") and second != "R"  # IR / AR / CR: residence permits

    def score_printed(self, ctx: Context) -> float:
        if not ctx.has(*self.keywords):
            return 0.0
        number = ctx.label_value(ID_NUMBER, r"\b([A-Z0-9]{6,12})\b", 1) is not None
        return min(0.7, 0.4 + 0.15 * number + 0.1 * bool(re.search(r"\d{1,2}[./-]\d{1,2}[./-]\d{4}", ctx.text)))

    def extract(self, ctx: Context) -> dict:
        out = super().extract(ctx)
        if "documentNumber" not in out and (number := ctx.label_value(ID_NUMBER, r"\b([A-Z0-9]{6,12})\b", 1)):
            out["documentNumber"] = number  # printed only: no check digit, so no `valid`
        # A foreign card's address: the label line and at most one more line that is not another label or the MRZ.
        if address := ctx.block_after(r"^[^A-Za-z]*(?:address|adresse|anschrift|domicilio|indirizzo)\b", ID_STOP, 1):
            out["address"] = address
        return out


class ResidencePermit(NationalId):
    """A foreign residence permit card (TD1 / TD2 with the MRZ document codes IR, AR, CR or RP: printed front, MRZ back for TD1)
    or the FRRO residential permit / registration certificate printout (one page, form `frro`). Added in intake-worker on
    2026-11-04: the printed number and the address are read as on ID cards."""
    name = "residence-permit"
    keywords = ("residence permit", "permis de séjour", "titre de séjour", "aufenthaltstitel", "permiso de residencia",
                "residence card", "permesso di soggiorno", "verblijfsvergunning", "uppehållstillstånd")

    def claims(self, mrz: dict) -> bool:
        code = "".join(mrz["lines"][0][:2]).upper()
        return mrz["format"] in ("TD1", "TD2") and (code in ("IR", "AR", "CR", "RP") or code[:1] == "R")

    def score_printed(self, ctx: Context) -> float:
        if frro_marked(ctx):
            return 0.85
        return 0.6 if ctx.has(*self.keywords) else 0.0

    def extract(self, ctx: Context) -> dict:
        out = super().extract(ctx)
        frro = frro_marked(ctx) and not (ctx.mrz and self.claims(ctx.mrz))
        if frro:
            out.pop("address", None)
            if number := ctx.label_value(r"\b(?:rp|rc|registration|permit|residential permit|frro)\s*(?:no|number)\b",
                                         r"\b([A-Z0-9]{6,20})\b", 1):
                out["documentNumber"] = number
            if visa := ctx.label_value(r"\bvisa\s*(?:no|number)\b", r"\b([A-Z0-9]{6,12})\b", 1):
                out["visaNumber"] = visa
            if purpose := ctx.label_value(r"^[^A-Za-z]*(?:purpose|visa type|type of visa|category)\b", r"\b([A-Z][A-Za-z -]{1,30})\b", 1):
                out["purpose"] = purpose
            if address := ctx.block_after(r"^[^A-Za-z]*(?:address in india|address)\b", ID_STOP, 3):
                out["address"] = address
        out["form"] = make_field("frro" if frro else "card", 0.9, "layout")
        return out


DOC_TYPES = [Passport(), Visa(), ResidencePermit(), NationalId()]
