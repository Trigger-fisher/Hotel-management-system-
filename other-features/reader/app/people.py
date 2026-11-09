# copied from intake-worker on 2026-11-04 (grouping, comparing and merging of app/people.py; cutting and reading stay in multi.py)
"""Group the cards cut from one photo into PEOPLE: decide FRONT or BACK of every card, pair them by evidence, merge the fields.

Matching evidence, strongest first (each pair reports the one it used):
  aadhaarNumber   the same Aadhaar number, valid Verhoeff check digit, on both cards                         STRONG
  documentNumber  the same other ID number (PAN, voter ID, licence, MRZ, a card's QR ID) on both cards       STRONG
  qrNameDob       one card's QR carries the name and date of birth of the other AND its number tail is found
                  on the other card (its number, or its own QR)                                              STRONG
  mrzNameDob      the machine-readable zone's name and date of birth against the printed ones on the other   weak
  nameAndDob      the same printed name and date of birth                                                    weak
  qrNameDobOnly   a QR's name and date of birth, but its number tail cannot be checked                       weak
  address         the same address: it only supports one of the above
MJ's namesake rule (4 Nov 2026, copied from intake-worker on 2026-11-04): two cards are one card shown twice (duplicateCard) or one
person's front and back ONLY with STRONG evidence. Weak evidence never makes a duplicate; it pairs a front with a back only when
NEITHER card has a checked number or a QR AND the two ID photos match (app/faces; flag pairedByNameDobAndPhoto). Otherwise the cards
stay apart, flagged sameNameDobNoNumber (needs a human check). A clear photo MISMATCH blocks a pair or a duplicate whatever else
agrees (photoMismatch). Two valid numbers of one kind that differ are a CONFLICT and the two cards are never put together. A
different date of birth (or a QR whose last four digits differ from the other card's number) blocks every pair except a number
match, which is then flagged. Layout (the clearly nearest card of the other side) is only a SUGGESTION (layoutSuggestsPair, the
region listed in `suggested`), never a pair. A pair is never forced: a front without a back stays alone (unpairedSide), so does a
back. Two cards of DIFFERENT known document types are never paired. Two people of different documents are LINKED
(sameGuestOtherDocument) only on STRONG evidence: the same checked number, a visa / OCI / residence permit printing a passport
number found in the photo (passportNumber), or the full name AND full date of birth AND matching ID photos (nameAndDob +
photoMatch). Name and date of birth without a photo match is only a suggestion (possibleSameGuest); a clear photo mismatch blocks
the link (photoMismatch)."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import faces
from . import thresholds as T
from .clarity import expects_portrait
from .doctypes.aadhaar import parse_qr as aadhaar_qr
from .fields import DATE, NAME_MATCH_THRESHOLD, NAME_MISMATCH_BELOW, name_similarity, normalise_dob, parse_qr_payload

SCORES = {"aadhaarNumber": 1.0, "documentNumber": 0.9, "qrNameDob": 0.8, "mrzNameDob": 0.75, "nameAndDob": 0.7, "qrNameDobOnly": 0.65}
# MJ's namesake rule (4 Nov 2026): only these make two cards one card (a duplicate) or one person's front and back.
STRONG = {"aadhaarNumber", "documentNumber", "qrNameDob"}
SINGLE_TYPES = {"pan", "visa", "oci"}  # one side holds everything
FRONT_IS_ENOUGH = {"passport", "employee-card"}  # the back (address page) is welcome but not expected
NO_EVIDENCE_KINDS = {"vid"}  # a Virtual ID can be re-issued: never evidence for or against a person
NO_CHECK_KINDS = {"oci", "pio"}  # their numbers have no check digit: read by label and pattern, they count as document numbers
DL_BACK = re.compile(r"\b(MCWG|MCWOG|LMV|HMV|HGMV|HPMV|TRANS|MGV|COV)\b|class of vehicle|vehicle class|hazardous|badge", re.I)
VOTER_FRONT = re.compile(r"elector['’]?s?\s*name|father['’]?s?\s*name|husband['’]?s?\s*name", re.I)
PASSPORT_BACK = re.compile(r"file\s*no|legal guardian|old passport|name of spouse|name of mother", re.I)
LAYOUT_SCORE = 0.3
LAYOUT_REACH = 1.6  # a layout partner is at most this many card lengths away (centre to centre)
LAYOUT_MARGIN = 1.5  # ...and the next candidate is at least this much farther: otherwise it is ambiguous
POSITION_SCORE = 0.5  # confidence of a front and back paired by position (pairedByPosition)
LOOK_SIDE = 400  # the look-alike measures are taken on a copy this long
DISTINCT_FORMS = {"oci", "visa", "residence-permit"}  # two forms of one type are different documents (OCI card and U-visa ...)
CARD_FLAGS_FOR_CHECK = {"cutOff", "lowContrastEdge", "fallbackFinder", "orientationUnsure", "regionTooSmall"}
PERSON_FLAGS_FOR_CHECK = {"pairedByLayoutOnly", "unpairedSide", "unknownSide", "ambiguousPair", "evidenceConflict", "addressPageMissing",
                          "sameNameDobNoNumber", "photoMismatch", "possibleSameGuest", "layoutSuggestsPair", "unclearCard",
                          "keyFieldUnclear"}
GENDER = re.compile(r"\b(male|female|transgender)\b|पुरुष|महिला|પુરુષ|સ્ત્રી", re.I)
GENDER_WORDS = {"पुरुष": "Male", "પુરુષ": "Male", "महिला": "Female", "સ્ત્રી": "Female"}
FRONT_WORDS = re.compile(r"\b(dob|d\.o\.b|date of birth|year of birth|yob)\b|जन्म|જન્મ", re.I)
BACK_WORDS = re.compile(r"\baddress\b|पता|સરનામું", re.I)
PIN = re.compile(r"(?<!\d)[1-9]\d{2} ?\d{3}(?!\d)")
ID_NAMES = {"aadhaar": "Aadhaar", "pan": "PAN", "passport": "Passport", "visa": "Visa", "oci": "OCI",
            "driving-licence": "DrivingLicence", "voter-id": "VoterID", "national-id": "NationalID",
            "residence-permit": "ResidencePermit", "employee-card": "EmployeeCard", "unknown": "Document"}


@dataclass
class Card:
    index: int  # 1-based region id, reading order
    image: np.ndarray | None  # BGR, upright (None in tests that only group)
    quad: np.ndarray
    score: float
    flags: list[str]
    result: dict = field(default_factory=dict)  # reader result of this card alone
    doc: dict = field(default_factory=dict)  # {type, confidence, fields, doubtfulFields, needsHumanCheck}
    side: str = "unknown"  # front | back | single | unknown
    keys: dict = field(default_factory=dict)
    face: object = None  # app.faces.Portrait (its embedding stays in memory only) or None when not looked for
    clarity: dict = field(default_factory=dict)  # app.clarity.assess result
    marks: set = field(default_factory=set)  # flags the grouping puts on this card (sameNameDobNoNumber, photoMismatch ...)
    photo_checks: list = field(default_factory=list)  # [{withRegion, use, outcome, score}]: outcomes only, never an embedding
    look: dict = field(default_factory=dict)  # colour and print-style measures for the position pairing (numbers only, in memory)
    jpeg_quality: float | None = None  # JPEG quality of the ORIGINAL upload this card came from (app/clarity.jpeg_quality)

    @property
    def kind(self) -> str:
        return (self.doc or {}).get("type", "unknown")

    @property
    def centre(self) -> np.ndarray:
        return np.asarray(self.quad, np.float32).reshape(4, 2).mean(axis=0)

    @property
    def size(self) -> float:
        q = np.asarray(self.quad, np.float32).reshape(4, 2)
        return float(max(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[3] - q[0])))


@dataclass
class Person:
    cards: list[Card]  # front first, then back
    evidence: str  # aadhaarNumber | documentNumber | qrNameDob | mrzNameDob | nameAndDob | position | singleDocument | none
    confidence: float
    flags: list[str] = field(default_factory=list)
    duplicates: list[Card] = field(default_factory=list)
    guest: int = 0  # people with the same guest number are one guest with several documents (1-based)
    linked: list[int] = field(default_factory=list)  # the other people (1-based positions) of the same guest
    link_evidence: list[str] = field(default_factory=list)
    name_hints: list[str] = field(default_factory=list)
    possible: list[int] = field(default_factory=list)  # people (1-based) who MAY be the same guest (name + DOB, no photo match)
    suggested: list[int] = field(default_factory=list)  # regions the layout suggests as this card's other side (not paired)
    photo_checks: list[dict] = field(default_factory=list)  # guest-link photo outcomes
    rare: bool = False  # MJ's RARE rule: another person of this document type has the same full name and full date of birth
    look: dict = field(default_factory=dict)  # pairedByPosition: the look-alike numbers (size, colour, print style)


# ---- what one card offers ------------------------------------------------------------------------------------------

def _iso(text: str | None) -> str | None:
    if not text:
        return None
    if m := DATE.search(text):
        return normalise_dob(*m.groups())
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text) or re.fullmatch(r"\d{4}", text):
        return text
    return None


def _norm(number: str) -> str:
    return re.sub(r"[\s\-/]", "", number).upper()


def keys_of(result: dict, doc: dict) -> dict:
    """What a card offers for matching: valid numbers by kind, QR payloads, printed name, dob, address, gender."""
    numbers: dict[str, set[str]] = {}
    printed: set[str] = set()  # every number read, checked or not: it can only CONFIRM a checked number on the other card
    kind = doc.get("type", "unknown")
    for ident in result.get("identifiers", []):
        if ident["type"] in NO_EVIDENCE_KINDS:
            continue
        printed.add(_norm(ident["text"]))
        if ident.get("valid"):
            numbers.setdefault(ident["type"], set()).add(_norm(ident["text"]))
    mrz = result.get("mrz")
    if mrz and mrz["fields"]["documentNumber"].get("valid"):
        numbers.setdefault("mrz", set()).add(_norm(mrz["fields"]["documentNumber"]["value"]))
        if kind in ("passport", "visa", "national-id", "residence-permit"):
            numbers.setdefault(kind, set()).add(_norm(mrz["fields"]["documentNumber"]["value"]))
    fields = doc.get("fields", {})
    number = fields.get("documentNumber")
    if number and number.get("valid") and kind not in ("aadhaar", "pan"):
        # reader addition: a checked number of an unknown card (QR ID, licence pattern) still pairs, by its own type
        numbers.setdefault(kind if kind != "unknown" else number.get("type", "document"), set()).add(_norm(number["value"]))
    elif number and kind in NO_CHECK_KINDS and number.get("valid") is not False and len(_norm(number["value"])) >= 7:
        numbers.setdefault(kind, set()).add(_norm(number["value"]))  # no check digit exists: the labelled, well-formed number counts
    if number:
        printed.add(_norm(number["value"]))
    if kind == "passport" and fields.get("fileNumber"):
        numbers.setdefault("passportFile", set()).add(_norm(fields["fileNumber"]["value"]))
    qrs = []
    for code in result.get("codes", []):
        parsed = aadhaar_qr(code.get("text", ""))
        if parsed:
            qrs.append({"name": parsed.get("name") or None, "dob": _iso(parsed.get("dob")), "last4": parsed.get("last4") or None})
            continue
        payload = parse_qr_payload(code.get("text", ""))
        if payload:
            ident = _norm(payload.get("ID", ""))
            qrs.append({"name": payload.get("NAME"), "dob": _iso(payload.get("DOB")), "last4": ident[-4:] or None})
    value = lambda k: fields[k]["value"] if k in fields and fields[k].get("source") in ("ocr", "mrz") else None  # noqa: E731
    text = "\n".join(line["text"] for line in result.get("lines", []))
    g = GENDER.search(text)
    gender = (GENDER_WORDS.get(g.group(0)) or g.group(0).title()) if g else None
    if not gender and fields.get("gender"):
        gender = fields["gender"]["value"] if fields["gender"]["value"] in ("Male", "Female", "Transgender", "Other") else None
    name_source = fields.get("name", {}).get("source")
    return {"numbers": numbers, "printed": printed, "qr": qrs, "name": value("name"), "dob": value("dob"), "address": value("address"),
            "gender": gender, "text": text, "type": kind, "mrz": (mrz or {}).get("format") if mrz else None,
            "nameFromMrz": name_source == "mrz", "form": fields.get("form", {}).get("value"),
            "page": fields.get("page", {}).get("value"),
            "passportRef": _norm(fields["passportNumber"]["value"]) if fields.get("passportNumber") else None}


def _generic_side(keys: dict) -> str:
    text = keys["text"]
    front = 2 * bool(keys["name"]) + 2 * bool(keys["dob"]) + bool(keys["gender"]) + bool(FRONT_WORDS.search(text))
    back = 3 * bool(keys["address"]) + bool(BACK_WORDS.search(text)) + bool(PIN.search(text))
    if front == back == 0:
        return "unknown"
    return "front" if front > back else "back" if back > front else "unknown"


def side_of(keys: dict) -> str:
    """front | back | single | unknown, by document type (see the module text)."""
    kind, text = keys.get("type", "unknown"), keys["text"]
    if kind in SINGLE_TYPES or (kind == "aadhaar" and keys.get("form") == "letter"):
        return "single"
    if kind == "passport":
        if keys.get("mrz") or keys.get("page") == "data":
            return "front"
        if keys.get("page") == "address" or PASSPORT_BACK.search(text):
            return "back"
        return _generic_side(keys)
    if kind in ("national-id", "residence-permit") and keys.get("mrz"):
        return "back" if keys["mrz"] == "TD1" else "front"
    if kind == "driving-licence":
        if DL_BACK.search(text) and not (keys["name"] and keys["dob"]):
            return "back"
        if keys["name"] or keys["dob"]:
            return "front"
        return "back" if keys["address"] else "unknown"
    if kind == "voter-id":
        if VOTER_FRONT.search(text) or (keys["name"] and not keys["address"]):
            return "front"
        if keys["address"] or BACK_WORDS.search(text):
            return "back"
        return "unknown"
    return _generic_side(keys)


def prepare(card: Card) -> Card:
    """Fill keys and side from the card's result and document."""
    card.keys = keys_of(card.result, card.doc)
    card.side = side_of(card.keys)
    return card


# ---- comparing two cards -------------------------------------------------------------------------------------------

def _same_person_name(a: str | None, b: str | None) -> bool:
    return bool(a and b and name_similarity(a, b) >= NAME_MATCH_THRESHOLD)


def _dob_differs(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    if len(a) == 4 or len(b) == 4:  # a year of birth only
        return a[:4] != b[:4]
    return a != b


def same_kind(a: Card, b: Card) -> bool:
    """Can these two cards be one document? The same type, or one of them unknown (an unread side)."""
    return a.kind == b.kind or "unknown" in (a.kind, b.kind)


def compare(a: Card, b: Card) -> dict:
    """{evidence: [codes, strongest first], score, conflict: hard (never together), soft: [codes that disagree]}."""
    ka, kb = a.keys, b.keys
    found, soft, hard = [], [], False
    if not same_kind(a, b):
        return {"evidence": [], "score": 0.0, "conflict": True, "soft": ["otherDocumentType"], "strong": False,
                "photo": {"outcome": "unclear", "score": None, "reason": "otherDocumentType"}}
    for kind in set(ka["numbers"]) & set(kb["numbers"]):
        if kind in NO_EVIDENCE_KINDS:
            continue
        if ka["numbers"][kind] & kb["numbers"][kind]:
            found.append("aadhaarNumber" if kind == "aadhaar" else "documentNumber")
        else:
            hard = True  # two valid numbers of the same kind that differ
    if not found and not hard:  # a checked number on one card printed (unchecked) on the other
        checked_a = set().union(*ka["numbers"].values()) if ka["numbers"] else set()
        checked_b = set().union(*kb["numbers"].values()) if kb["numbers"] else set()
        if checked_a & kb.get("printed", set()) or checked_b & ka.get("printed", set()):
            found.append("documentNumber")
    for x, y in ((ka, kb), (kb, ka)):
        numbers_y = (set().union(*y["numbers"].values()) if y["numbers"] else set()) | y.get("printed", set())
        for qr in x["qr"]:
            if qr["last4"] and y["numbers"].get("aadhaar") and not any(n.endswith(qr["last4"]) for n in y["numbers"]["aadhaar"]):
                soft.append("qrNumberDiffers")
            # the QR's number tail found on the other card (its number, or its own QR): only then is the QR a strong match
            tail = bool(qr["last4"]) and (any(n.endswith(qr["last4"]) for n in numbers_y) or any(q["last4"] == qr["last4"] for q in y["qr"]))
            targets = [(y["name"], y["dob"])] + [(q["name"], q["dob"]) for q in y["qr"]]
            for name, dob in targets:
                if _same_person_name(qr["name"], name) and qr["dob"] and dob and not _dob_differs(qr["dob"], dob):
                    found.append("qrNameDob" if tail else "qrNameDobOnly")
                elif _dob_differs(qr["dob"], dob) and _same_person_name(qr["name"], name):
                    soft.append("qrDobDiffers")
    if ka["name"] and kb["name"] and ka["dob"] and kb["dob"]:
        if _dob_differs(ka["dob"], kb["dob"]):
            soft.append("dobDiffers")
        elif _same_person_name(ka["name"], kb["name"]):
            found.append("mrzNameDob" if ka.get("nameFromMrz") != kb.get("nameFromMrz") else "nameAndDob")
    found = sorted(set(found), key=lambda e: -SCORES[e])
    score = SCORES[found[0]] if found else 0.0
    if found and ka["address"] and kb["address"] and name_similarity(ka["address"], kb["address"]) >= NAME_MATCH_THRESHOLD:
        found.append("address")
        score += 0.05
    if soft and found and found[0] not in ("aadhaarNumber", "documentNumber"):
        found, score = [], 0.0  # only a number match outweighs a disagreement
    photo = faces.compare(a.face, b.face) if (a.face is not None and b.face is not None) else \
        {"outcome": "unclear", "score": None, "reason": "not checked"}
    return {"evidence": found, "score": score, "conflict": hard, "soft": sorted(set(soft)),
            "strong": bool(found) and found[0] in STRONG, "photo": photo}


def _has_id(card: Card) -> bool:
    """Does the card carry a checked number or a QR? (Then name + date of birth may never pair it: MJ's namesake rule.)"""
    return bool(card.keys.get("numbers")) or bool(card.keys.get("qr"))


def _record(a: Card, b: Card, use: str, photo: dict) -> None:
    """Keep the photo outcome of a comparison that mattered (both cards had a portrait to look at)."""
    if photo.get("reason") in ("not checked", "no photo", "otherDocumentType", "face models not installed"):
        return
    a.photo_checks.append({"withRegion": b.index, "use": use, "outcome": photo["outcome"], "score": photo["score"]})
    b.photo_checks.append({"withRegion": a.index, "use": use, "outcome": photo["outcome"], "score": photo["score"]})


# ---- grouping ----------------------------------------------------------------------------------------------------------

def _better(a: Card, b: Card) -> bool:
    """Is `a` the better copy to keep? Fewer card flags, then the higher reading confidence, then the cutter's score."""
    return (-len(a.flags), a.result.get("confidence", 0), a.score) > (-len(b.flags), b.result.get("confidence", 0), b.score)


def _dedupe(cards: list[Card]) -> tuple[list[Card], dict[int, list[Card]]]:
    """Two cards of the same side are one card shown twice ONLY with a matching number or a matching QR (number tail + name and
    date of birth), and no clear photo mismatch. A name and date of birth alone keep them apart (sameNameDobNoNumber): they may be
    namesakes; a person decides."""
    kept: list[Card] = []
    copies: dict[int, list[Card]] = {}
    for card in cards:
        twin = None
        if card.side in ("front", "back", "single"):
            for k in kept:
                if k.side == card.side and k.kind == card.kind:
                    c = compare(k, card)
                    if not c["evidence"] or c["conflict"]:
                        continue
                    _record(k, card, "duplicate", c["photo"])
                    if c["strong"]:
                        if c["photo"]["outcome"] == "mismatch":  # same number, clearly another face: never one card, a person checks
                            k.marks.add("photoMismatch")
                            card.marks.add("photoMismatch")
                            continue
                        twin = k
                        break
                    # a name and date of birth alone (a photo match or mismatch changes nothing): namesakes, kept apart (RARE)
                    k.marks.add("sameNameDobNoNumber")
                    card.marks.add("sameNameDobNoNumber")
        if twin is None:
            kept.append(card)
            continue
        keep, drop = (card, twin) if _better(card, twin) else (twin, card)
        kept[kept.index(twin)] = keep
        copies[keep.index] = copies.pop(twin.index, []) + [drop]
    return kept, copies


def _layout_partner(card: Card, others: list[Card]) -> Card | None:
    """The nearest card of the other side, when it is clearly the nearest and close enough."""
    near = sorted(((math.dist(card.centre, o.centre), o) for o in others
                   if 0.7 <= o.size / max(card.size, 1) <= 1.4), key=lambda t: (t[0], t[1].index))
    if not near or near[0][0] > LAYOUT_REACH * max(card.size, near[0][1].size):
        return None
    if len(near) > 1 and near[1][0] < LAYOUT_MARGIN * near[0][0]:
        return None
    return near[0][1]


def group(cards: list[Card]) -> list[Person]:
    """People in the order of their first card. Never forces a pair."""
    kept, copies = _dedupe(cards)
    fronts = [c for c in kept if c.side == "front"]
    backs = [c for c in kept if c.side == "back"]
    checks = {(f.index, b.index): compare(f, b) for f in fronts for b in backs}
    people: list[Person] = []
    used: set[int] = set()
    ambiguous: set[int] = set()
    candidates, refused = [], []
    for f in fronts:
        for b in backs:
            c = checks[(f.index, b.index)]
            if not c["evidence"] or c["conflict"]:
                continue
            _record(f, b, "pair", c["photo"])
            if c["strong"] and c["photo"]["outcome"] == "mismatch":  # a clear photo mismatch blocks the pair, whatever else agrees
                f.marks.add("photoMismatch")
                b.marks.add("photoMismatch")
            elif c["strong"]:
                candidates.append((c["score"], f, b, c["evidence"][0]))
            elif not _has_id(f) and not _has_id(b) and c["photo"]["outcome"] == "match":
                candidates.append((c["score"], f, b, c["evidence"][0]))  # name + DOB, no number or QR anywhere, photos match
            else:
                refused.append((f, b))
    candidates.sort(key=lambda t: (-t[0], t[1].index, t[2].index))
    for score, f, b, evidence in candidates:
        if f.index in used or b.index in used:
            continue
        rivals = [s for s, f2, b2, _ in candidates if (f2 is f) != (b2 is b) and s >= score - 1e-9
                  and f2.index not in used and b2.index not in used]
        if rivals:  # another card offers the same strength of evidence: a person must choose
            ambiguous |= {f.index, b.index}
            continue
        c = checks[(f.index, b.index)]
        flags = ["evidenceConflict"] if c["soft"] else []
        if c["photo"]["outcome"] == "match" and not c["strong"]:
            flags.append("pairedByNameDobAndPhoto")
        people.append(Person([f, b], evidence, round(min(score, 1.0), 2), flags))
        used |= {f.index, b.index}

    # Layout (the clearly nearest card of the other side) is a SUGGESTION (MJ's rule, 4 Nov 2026), and a PAIR only when the two
    # cards also look alike, nothing conflicts, neither number nor QR could decide and the front's portrait is clear (MJ, 4 Nov 2026).
    suggested: dict[int, int] = {}
    open_fronts = [f for f in fronts if f.index not in used and f.index not in ambiguous]
    open_backs = [b for b in backs if b.index not in used and b.index not in ambiguous]
    for f in open_fronts:
        b = _layout_partner(f, open_backs)
        if b is None or _layout_partner(b, open_fronts) is not f:
            continue
        c = checks[(f.index, b.index)]
        if c["conflict"] or c["soft"] or c["photo"]["outcome"] == "mismatch":
            continue
        alike = position_pair(f, b, c)
        if alike is not None:
            person = Person([f, b], "position", POSITION_SCORE, ["pairedByPosition"])
            person.look = alike
            people.append(person)
            used |= {f.index, b.index}
            continue
        suggested[f.index], suggested[b.index] = b.index, f.index
    for f, b in refused:  # a name and date of birth alone: kept apart (only the cards left without a partner)
        for x in (f, b):
            if x.index not in used:
                x.marks.add("sameNameDobNoNumber")

    for card in kept:
        if card.index in used:
            continue
        if card.side == "single":
            people.append(Person([card], "singleDocument", 1.0, []))
            continue
        if card.side == "front" and card.kind in FRONT_IS_ENOUGH and card.index not in ambiguous:
            flags = ["addressPageMissing"] if card.kind == "passport" and _indian(card) else []
            people.append(Person([card], "none", 0.0, flags))
            continue
        flags = ["unpairedSide"] if card.side in ("front", "back") else ["unknownSide"]
        if card.index in ambiguous:
            flags.append("ambiguousPair")
        person = Person([card], "none", 0.0, flags)
        if card.index in suggested:
            person.flags.append("layoutSuggestsPair")
            person.suggested = [suggested[card.index]]
        people.append(person)
    for p in people:
        p.duplicates = [d for c in p.cards for d in copies.get(c.index, [])]
        if p.duplicates:
            p.flags.append("duplicateCard")
        p.flags += sorted(set().union(*(c.marks for c in p.cards)) - set(p.flags))
        if any(_portrait_unclear(c) for c in p.cards):
            p.flags.append("photoUnclear")
    people = sorted(people, key=lambda p: min(c.index for c in p.cards))
    mark_rare(people)
    link_guests(people)
    return people


# Copied from intake-worker on 2026-11-05 (commit 2a12285f): RARE namesakes and pairing by position. The reader's cards are BGR.

def _other_form(a: dict, b: dict) -> bool:
    """Two documents of one type that are different documents (OCI card and OCI U-visa, visa sticker and ETA printout)."""
    return a.get("type") in DISTINCT_FORMS and bool(a.get("form") and b.get("form")) and a.get("form") != b.get("form")


def mark_rare(people: list[Person]) -> None:
    """MJ's RARE rule (4 Nov 2026): two people of the same document type with the same full name and the same FULL date of birth
    were kept apart because no valid number or QR matched (or two numbers differ). They stay separate people, reception is not
    warned for this, and both are marked rare (the saved file name ends in _Rare). A year of birth alone is not enough."""
    keys = [_person_key(p) for p in people]
    for i in range(len(people)):
        for j in range(i + 1, len(people)):
            a, b = keys[i], keys[j]
            if a["type"] != b["type"] or a["type"] == "unknown" or _other_form(a, b):
                continue
            if a["dob"] and a["dob"] == b["dob"] and _same_person_name(a["name"], b["name"]):
                people[i].rare = people[j].rare = True
    for p in people:
        if p.rare and "rare" not in p.flags:
            p.flags.append("rare")


def _look(card: Card) -> dict:
    """How a card looks, for the position pairing: its base colour (Lab median of the lighter half of the card: the card stock,
    not the print), its print style (normalised histogram of the gradient strength) and its share of edge pixels. Measured on a
    copy 400 px long; cached on the card."""
    if card.look:
        return card.look
    bgr = card.image
    f = LOOK_SIDE / max(bgr.shape[:2])
    small = cv2.resize(bgr, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else bgr
    lab = cv2.cvtColor(np.ascontiguousarray(small), cv2.COLOR_BGR2LAB).astype(np.float32)
    light = lab[..., 0] >= np.percentile(lab[..., 0], 50)
    gray = cv2.cvtColor(np.ascontiguousarray(small), cv2.COLOR_BGR2GRAY)
    g = gray.astype(np.float32)
    mag = np.hypot(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
    style = np.histogram(np.log1p(mag[mag > 8]), bins=10, range=(math.log1p(8), math.log1p(1500)))[0].astype(np.float32)
    card.look = {"colour": np.median(lab[light], axis=0) if light.any() else lab.reshape(-1, 3).mean(axis=0),
                 "style": style / max(float(style.sum()), 1.0), "edges": float((cv2.Canny(gray, 50, 150) > 0).mean())}
    return card.look


def look_alike(a: Card, b: Card) -> dict:
    """{alike, sizeRatio, colourDelta, styleDistance, edgeRatio}: the same size, card colour and print style (thresholds in
    app/thresholds.py). Numbers only."""
    qa, qb = np.asarray(a.quad, np.float32).reshape(4, 2), np.asarray(b.quad, np.float32).reshape(4, 2)
    sides = lambda q: sorted((float(np.linalg.norm(q[1] - q[0])), float(np.linalg.norm(q[3] - q[0]))))  # noqa: E731
    (sa, la), (sb, lb) = sides(qa), sides(qb)
    size = max(max(la, lb) / max(min(la, lb), 1.0), max(sa, sb) / max(min(sa, sb), 1.0))
    la_, lb_ = _look(a), _look(b)
    colour = float(np.linalg.norm(la_["colour"] - lb_["colour"]))
    blank = not la_["style"].any() and not lb_["style"].any()  # two cards without any print: the same style
    style = 0.0 if blank else float(cv2.compareHist(la_["style"], lb_["style"], cv2.HISTCMP_BHATTACHARYYA))
    edges = max(la_["edges"], lb_["edges"]) / max(min(la_["edges"], lb_["edges"]), 1e-4)
    alike = size <= T.get("PAIR_SIZE_RATIO_MAX") and colour <= T.get("PAIR_COLOUR_DELTA_MAX") \
        and style <= T.get("PAIR_STYLE_DISTANCE_MAX") and edges <= T.get("PAIR_EDGE_RATIO_MAX")
    return {"alike": bool(alike), "sizeRatio": round(size, 3), "colourDelta": round(colour, 2), "styleDistance": round(style, 3),
            "edgeRatio": round(edges, 2)}


def _tails(card: Card) -> set[str]:
    """The last four digits of every number read on a card (checked or not) and of its QR's number."""
    k = card.keys
    numbers = (set().union(*k["numbers"].values()) if k.get("numbers") else set()) | set(k.get("printed", set()))
    tails = {re.sub(r"\D", "", n)[-4:] for n in numbers if len(re.sub(r"\D", "", n)) >= 4}
    return tails | {q["last4"] for q in k.get("qr", []) if q.get("last4")}


def position_pair(f: Card, b: Card, c: dict) -> dict | None:
    """MJ's side-by-side rule (4 Nov 2026): a front and the back next to it are paired WITHOUT a readable matching number or QR only
    when (the caller already checked they are each other's single nearest card of the other side on the same picture): no number
    or QR could decide; nothing conflicts (date of birth, gender, number tails); the front's portrait is clear; and the two cards
    look alike (look_alike). Returns the look-alike numbers when paired, else None (the pair stays a suggestion)."""
    if _has_id(f) and _has_id(b):
        return None
    if c["conflict"] or c["soft"] or c["photo"]["outcome"] == "mismatch":
        return None
    kf, kb = f.keys, b.keys
    if kf.get("gender") and kb.get("gender") and kf["gender"] != kb["gender"]:
        return None
    if _dob_differs(kf.get("dob"), kb.get("dob")):
        return None
    tf, tb = _tails(f), _tails(b)
    if tf and tb and not tf & tb:
        return None
    if f.image is None or b.image is None or f.face is None or getattr(f.face, "status", "") != "found":
        return None
    alike = look_alike(f, b)
    return alike if alike["alike"] else None


def _portrait_unclear(card: Card) -> bool:
    """A side that carries the holder's portrait, where none was found or it was too small, blurred or glared."""
    return card.face is not None and getattr(card.face, "status", "") in ("none", "unclear") \
        and expects_portrait(card.kind, card.side, card.keys.get("form"))


def _indian(card: Card) -> bool:
    nationality = card.doc.get("fields", {}).get("nationality", {}).get("value", "")
    return nationality.upper() in ("IND", "INDIAN")


# ---- one guest, several documents ------------------------------------------------------------------------------------

def _person_key(p: Person) -> dict:
    name = next((c.keys.get("name") for c in p.cards if c.keys.get("name")), None)
    dobs = {c.keys.get("dob") for c in p.cards if c.keys.get("dob")}
    full = {d for d in dobs if d and len(d) == 10}
    gender = next((c.keys.get("gender") for c in p.cards if c.keys.get("gender")), None)
    refs = {c.keys.get("passportRef") for c in p.cards if c.keys.get("passportRef")}
    numbers = set().union(*(set().union(*c.keys.get("numbers", {}).values()) for c in p.cards if c.keys.get("numbers"))) \
        if any(c.keys.get("numbers") for c in p.cards) else set()
    kind = document_type(p)["type"]
    form = next((c.keys.get("form") for c in p.cards if c.keys.get("form")), None)
    return {"name": name, "dob": next(iter(full)) if len(full) == 1 else None, "gender": gender, "refs": refs, "numbers": numbers,
            "type": kind, "form": form if kind in DISTINCT_FORMS else None, "faces": [c.face for c in p.cards]}


def _same_guest(a: dict, b: dict) -> tuple[list[str] | None, str, dict | None]:
    """(evidence, note, photo outcome) for two people of DIFFERENT document types. Evidence (a link) only when STRONG:
    passportNumber: a visa, OCI or residence permit prints the passport number of a passport in the photo (unless the date of
    birth or the gender disagrees or the names are clearly different people); documentNumber: the same checked number on both;
    nameAndDob + photoMatch: the full name AND the full date of birth agree AND the ID photos match.
    note: 'possible' = name and full date of birth agree but the photos do not match (or cannot be compared): only a suggestion
    (possibleSameGuest), never a link; 'photoMismatch' = the evidence above, but the photos clearly differ: no link, a person checks."""
    if a["type"] == b["type"] or "unknown" in (a["type"], b["type"]):
        return None, "", None
    if a["gender"] and b["gender"] and a["gender"] != b["gender"]:
        return None, "", None
    if a["dob"] and b["dob"] and a["dob"] != b["dob"]:
        return None, "", None
    same_name = _same_person_name(a["name"], b["name"])
    name_and_dob = bool(a["dob"] and b["dob"] and same_name)
    by_number = bool(a["refs"] & b["numbers"] or b["refs"] & a["numbers"])
    if by_number and a["name"] and b["name"] and name_similarity(a["name"], b["name"]) < NAME_MISMATCH_BELOW:
        by_number = False  # the number names this passport, but the holder is clearly someone else: reception decides
    shared = bool(a["numbers"] & b["numbers"])
    if not (by_number or shared or name_and_dob):
        return None, "", None
    photo = faces.compare_sets(a["faces"], b["faces"])
    if photo["outcome"] == "mismatch":
        return None, "photoMismatch", photo
    evidence = (["documentNumber"] if shared else []) + (["passportNumber"] if by_number else [])
    if name_and_dob and photo["outcome"] == "match":
        evidence = ["nameAndDob", "photoMatch"] + evidence
    if evidence:
        return evidence, "", photo
    return None, "possible", photo


def link_guests(people: list[Person]) -> None:
    """Mark people who are one guest with different documents. Never merges their pictures. A person who matches TWO people of the
    same other type is linked to neither of them (a namesake is possible). A name and date of birth without a photo match is only
    a suggestion (possibleSameGuest); a clear photo mismatch blocks the link (photoMismatch)."""
    keys = [_person_key(p) for p in people]
    links: dict[int, dict[int, list[str]]] = {i: {} for i in range(len(people))}
    for i in range(len(people)):
        for j in range(i + 1, len(people)):
            ev, note, photo = _same_guest(keys[i], keys[j])
            if photo is not None and photo.get("score") is not None:
                people[i].photo_checks.append({"withPerson": j + 1, "use": "guest", "outcome": photo["outcome"], "score": photo["score"]})
                people[j].photo_checks.append({"withPerson": i + 1, "use": "guest", "outcome": photo["outcome"], "score": photo["score"]})
            if ev:
                links[i][j], links[j][i] = ev, ev
            elif note == "possible":
                people[i].possible.append(j + 1)
                people[j].possible.append(i + 1)
            elif note == "photoMismatch":
                for k in (i, j):
                    if "photoMismatch" not in people[k].flags:
                        people[k].flags.append("photoMismatch")
    for p in people:
        if p.possible:
            p.flags.append("possibleSameGuest")
            # word breaks only (respace keeps every letter as read): a possible same guest's name with exactly the same letters
            p.name_hints += [keys[m - 1]["name"] for m in p.possible if keys[m - 1]["name"]]
    for i in range(len(people)):
        by_type: dict[str, list[int]] = {}
        for j in links[i]:
            by_type.setdefault(keys[j]["type"], []).append(j)
        for js in by_type.values():
            if len(js) > 1:
                for j in js:
                    links[i].pop(j, None)
                    links[j].pop(i, None)
    guest, seen = 0, set()
    for i in range(len(people)):
        if i in seen:
            continue
        guest += 1
        stack, members = [i], []
        while stack:
            k = stack.pop()
            if k in seen:
                continue
            seen.add(k)
            members.append(k)
            stack += list(links[k])
        for k in members:
            people[k].guest = guest
            people[k].linked = sorted(m + 1 for m in members if m != k)
            if people[k].linked:
                people[k].link_evidence = sorted({e for m in links[k].values() for e in m})
                people[k].flags.append("sameGuestOtherDocument")
                people[k].name_hints = [keys[m]["name"] for m in members if m != k and keys[m]["name"]] + people[k].name_hints


# ---- fields of one person ----------------------------------------------------------------------------------------------

def person_fields(person: Person) -> tuple[dict, list[str]]:
    """(fields, doubtful field names). The front's value wins unless the back is more sure; the address comes from the back.
    A value the two cards disagree on is kept, marked with `conflicts`, and listed as doubtful."""
    front = person.cards[0]
    fields = {k: {**v, "side": front.side} for k, v in front.doc.get("fields", {}).items()}
    doubtful = list(front.doc.get("doubtfulFields", []))
    for other in person.cards[1:]:
        for k, f in other.doc.get("fields", {}).items():
            mine = fields.get(k)
            if mine is None or (k == "address" and other.side == "back") or f["confidence"] > mine["confidence"]:
                entry = {**f, "side": other.side}
                if mine and mine["value"] != f["value"]:
                    entry["conflicts"] = [{"value": mine["value"], "side": mine["side"]}]
                fields[k] = entry
            elif mine["value"] != f["value"] and k in ("name", "dob", "documentNumber"):
                mine.setdefault("conflicts", []).append({"value": f["value"], "side": other.side})
        doubtful += other.doc.get("doubtfulFields", [])
    gender = next((c.keys.get("gender") for c in person.cards if c.keys.get("gender")), None)
    if gender and "gender" not in fields:
        fields["gender"] = {"value": gender, "confidence": 0.8, "source": "ocr", "side": "front"}
    doubtful += [k for k, f in fields.items() if f.get("conflicts") and k in ("name", "dob", "documentNumber")]
    if fields.get("name"):
        sources = [("qr", q.get("name")) for c in person.cards for q in c.keys.get("qr", [])] + \
                  [("otherSide", c.keys.get("name")) for c in person.cards] + [("sameGuest", n) for n in person.name_hints]
        for source, candidate in sources:
            if spaced := respace(fields["name"]["value"], candidate):
                fields["name"] = {**fields["name"], "value": spaced, "spacingFrom": source}
                break
    return fields, list(dict.fromkeys(doubtful))


def _letters(text: str) -> str:
    return re.sub(r"[^0-9a-z]", "", (text or "").casefold())


def respace(value: str, candidate: str | None) -> str | None:
    """OCR often joins the words of a name (ANILMEHRA). When a second source has EXACTLY the same letters with more word breaks,
    only the breaks are taken from it; the letters and their case stay as read. Anything else returns None."""
    if not candidate or candidate.count(" ") <= value.count(" ") or _letters(candidate) != _letters(value) or not _letters(value):
        return None
    letters = iter(ch for ch in value if ch.isalnum())
    out = []
    for ch in candidate.strip():
        if ch.isalnum():
            out.append(next(letters))
        elif ch == " " and out and out[-1] != " ":
            out.append(" ")
    return "".join(out).strip()


def document_type(person: Person) -> dict:
    """The front's type unless it is unknown and the back knows better."""
    docs = [c.doc for c in person.cards if c.doc]
    if not docs:
        return {"type": "unknown", "confidence": 0.0}
    known = [d for d in docs if d.get("type", "unknown") != "unknown"]
    best = known[0] if known else docs[0]
    return {"type": best.get("type", "unknown"), "confidence": best.get("confidence", 0.0)}


def needs_check(person: Person) -> bool:
    flags = set(person.flags) - ({"sameNameDobNoNumber"} if person.rare else set())  # RARE: reception is not warned (MJ)
    return bool(flags & PERSON_FLAGS_FOR_CHECK
                or any(set(c.flags) & CARD_FLAGS_FOR_CHECK or c.doc.get("needsHumanCheck") for c in person.cards))


# ---- the file name ---------------------------------------------------------------------------------------------------

def _clean(part: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", part.title())[:30]


def suggested_name(fields: dict, doc_type: str, rare: bool = False) -> str:
    """FirstName_LastName_IdName (no extension); Unknown_<IdName> when no name was read; "_Rare" at the end for MJ's RARE namesakes.
    Only letters and digits survive."""
    words = [w for w in re.split(r"\s+", (fields.get("name", {}).get("value") or "").strip()) if _clean(w)]
    first, last = (_clean(words[0]), _clean(words[-1])) if len(words) >= 2 else (_clean(words[0]), "") if words else ("", "")
    id_name = ID_NAMES.get(doc_type, "Document")
    stem = "_".join(p for p in (first, last, id_name) if p) if first else f"Unknown_{id_name}"
    return stem + "_Rare" if rare else stem
