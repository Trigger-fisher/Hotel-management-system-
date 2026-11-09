"""Many ID cards in one picture (or in several pictures of one job): cut every card, read it, decide FRONT or BACK, and group
the cards into PEOPLE. Grouping logic follows the reader's multi.py (copied from reader on 2026-11-04 and extended here).

Matching evidence, strongest first (each pair reports the one it used):
  aadhaarNumber   the same Aadhaar number, valid Verhoeff check digit, on both cards                         STRONG
  documentNumber  the same other ID number (PAN, voter ID, licence, MRZ) on both cards                       STRONG
  qrNameDob       one card's QR carries the name and date of birth of the other AND its number tail is found
                  on the other card (its number, or its own QR)                                              STRONG
  mrzNameDob      the MRZ's name and date of birth = the other side's printed ones                           weak
  nameAndDob      the same printed name and date of birth                                                    weak
  qrNameDobOnly   a QR's name and date of birth, but its number tail cannot be checked                        weak
  address         the same address: it only supports one of the above
MJ's namesake rule (4 Nov 2026): two cards are one card shown twice (duplicateCard) or one person's front and back ONLY with STRONG
evidence. Weak evidence never makes a duplicate; it pairs a front with a back only when NEITHER card has a checked number or a QR AND
the two ID photos match (app/faces). Otherwise the cards stay apart, flagged sameNameDobNoNumber. A clear photo MISMATCH blocks a
pair or a duplicate that a number supports (photoMismatch, a person checks). Two valid numbers of one kind that differ are a CONFLICT
and the two cards are never put together. A different date of birth (or a QR whose last four digits differ from the other card's
number) blocks every pair except a number match, which is then flagged.
RARE (MJ, 4 Nov 2026): two people of one document type with the same full name and the same FULL date of birth that no number or
QR joined stay two people; reception is not warned for it, the people are marked rare (flag rare, file name ..._Rare).
Layout (the clearly nearest card of the other side on the same picture) is a SUGGESTION (layoutSuggestsPair, the card listed in
`suggested`); it becomes a PAIR (evidence position, flag pairedByPosition) only when no number or QR could decide, nothing conflicts
(date of birth, gender, number tails), the front's portrait is clear and the two cards look alike (size, card colour, print style)
(MJ, 4 Nov 2026). A pair is never forced: a front without a back stays alone (unpairedSide), so does a back. A second copy of the
same side of one person is kept once.

Document types (added 2026-11-04). Sides depend on the type: PAN, visa, OCI and the e-Aadhaar letter are SINGLE (one page holds
everything: a person on their own, never unpaired); a passport's data page or an employee card is complete without a back; Aadhaar,
driving licence, voter ID and ID cards have a front and a back. Two cards of DIFFERENT known types are never paired, never treated
as copies and never stacked into one picture. Two people of different document types are LINKED (flag sameGuestOtherDocument, one
picture per document still) only on STRONG evidence: the same checked number, or a visa, OCI, PIO or residence permit that prints the
passport number of a passport in the job (guestEvidence passportNumber, unless the date of birth or gender disagrees or the names
clearly differ), or the full name AND full date of birth AND matching ID photos (nameAndDob + photoMatch); and the match must be the
only one of its kind. Name and date of birth without a photo match is only a suggestion (possibleSameGuest, `possible`); a clear
photo mismatch blocks the link (photoMismatch).
Different FORMS of one type (OCI card and OCI U-visa sticker, visa sticker and ETA printout, permit card and FRRO printout) are
separate documents of one guest, never copies (added 2026-11-04)."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Callable

import cv2
import numpy as np

from . import faces
from . import thresholds as T
from .clarity import expects_portrait
from .gatecore import cards as classic
from .readcore import preprocess
from .readcore.doctypes.aadhaar import parse_qr as aadhaar_qr
from .readcore.fields import DATE, NAME_MATCH_THRESHOLD, NAME_MISMATCH_BELOW, name_similarity, normalise_dob, parse_qr_payload

MAX_CARDS = 12
COUNT_SIDE = 900  # the automatic multi-card switch measures on a copy this large
SCORES = {"aadhaarNumber": 1.0, "documentNumber": 0.9, "qrNameDob": 0.8, "mrzNameDob": 0.75, "nameAndDob": 0.7, "qrNameDobOnly": 0.65}
# MJ's namesake rule (4 Nov 2026): only these make two cards one card (a duplicate) or one person's front and back. The others
# (a name and date of birth, from print, the MRZ or a QR whose number tail cannot be checked) pair a front with a back only when
# NEITHER card has a number or QR AND the two ID photos match.
STRONG = {"aadhaarNumber", "documentNumber", "qrNameDob"}
SINGLE_TYPES = {"pan", "visa", "oci", "pio"}  # one side holds everything
# Types whose FORMS are different documents of one guest (an OCI card and the OCI U-visa sticker, a visa sticker and an ETA
# printout, a residence permit card and the FRRO printout): never copies of each other, each may be linked to the guest.
DISTINCT_FORMS = {"oci", "visa", "residence-permit"}
REF_TYPES = {"visa", "oci", "pio", "residence-permit"}  # they print the guest's passport number
FRONT_IS_ENOUGH = {"passport", "employee-card"}  # the back (address page) is welcome but not expected
TWO_SIDED = {"aadhaar", "driving-licence", "voter-id", "national-id", "residence-permit"}
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
CARD_FLAGS_FOR_CHECK = {"cutOff", "lowContrastEdge", "fallbackFinder"}
GENDER = re.compile(r"\b(male|female|transgender)\b|पुरुष|महिला|પુરુષ|સ્ત્રી", re.I)
GENDER_WORDS = {"पुरुष": "Male", "પુરુષ": "Male", "महिला": "Female", "સ્ત્રી": "Female"}
FRONT_WORDS = re.compile(r"\b(dob|d\.o\.b|date of birth|year of birth|yob)\b|जन्म|જન્મ", re.I)
BACK_WORDS = re.compile(r"\baddress\b|पता|સરનામું", re.I)
PIN = re.compile(r"(?<!\d)[1-9]\d{2} ?\d{3}(?!\d)")


@dataclass
class Cut:
    """The cutter's result shape (app/cardcut.CardCut), used for the classic fallback finder."""
    image: np.ndarray  # BGR
    quad: np.ndarray
    score: float
    flags: list[str]


@dataclass
class Card:
    index: int  # 0-based over the whole job, reading order
    picture: int  # which picture (file or PDF page) it came from
    image: np.ndarray  # RGB, upright (the stored copy is made from this)
    quad: np.ndarray
    score: float
    flags: list[str]
    result: dict = field(default_factory=dict)  # reader result
    doc: dict = field(default_factory=dict)  # {type, fields, doubtful, unknown, ...}
    side: str = "unknown"  # front | back | single | unknown
    keys: dict = field(default_factory=dict)
    face: object = None  # app.faces.Portrait (its embedding stays in memory only) or None when not looked for
    clarity: dict = field(default_factory=dict)  # app.clarity.assess result
    marks: set = field(default_factory=set)  # flags the grouping puts on this card (sameNameDobNoNumber, photoMismatch ...)
    photo_checks: list = field(default_factory=list)  # [{with, use, outcome, score}]: outcomes only, never an embedding
    jpeg_quality: float | None = None  # JPEG quality of the ORIGINAL upload this card came from (app/clarity.jpeg_quality)
    look: dict = field(default_factory=dict)  # colour and print-style measures for the position pairing (numbers only, in memory)

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
    guest: int = 0  # people with the same guest number are one guest with several documents (1-based, set by link_guests)
    linked: list[int] = field(default_factory=list)  # the other people (1-based positions) of the same guest
    link_evidence: list[str] = field(default_factory=list)
    name_hints: list[str] = field(default_factory=list)  # the names read on the same guest's other documents
    possible: list[int] = field(default_factory=list)  # people (1-based) who MAY be the same guest (name + DOB, no photo match)
    suggested: list[int] = field(default_factory=list)  # cards (1-based) the layout suggests as this card's other side (not paired)
    photo_checks: list[dict] = field(default_factory=list)  # guest-link photo outcomes
    rare: bool = False  # MJ's RARE rule: another person of this document type has the same full name and full date of birth
    look: dict = field(default_factory=dict)  # pairedByPosition: the look-alike numbers (size, colour, print style)


# ---- cutting -------------------------------------------------------------------------------------------------------

def _reading_order(cuts: list) -> list:
    """Top-to-bottom rows, left-to-right inside a row."""
    if not cuts:
        return cuts
    info = [(c, np.asarray(c.quad).reshape(4, 2)) for c in cuts]
    height = float(np.median([q[:, 1].max() - q[:, 1].min() for _, q in info]))
    info.sort(key=lambda t: t[1][:, 1].mean())
    rows: list[list] = []
    for item in info:
        if rows and abs(item[1][:, 1].mean() - np.mean([q[:, 1].mean() for _, q in rows[-1]])) < 0.5 * height:
            rows[-1].append(item)
        else:
            rows.append([item])
    return [c for row in rows for c, q in sorted(row, key=lambda t: t[1][:, 0].mean())]


def classic_cut(bgr: np.ndarray, max_cards: int = MAX_CARDS) -> list[Cut]:
    """The old card finder (gatecore), used when app/cardcut is not there yet."""
    h, w = bgr.shape[:2]
    out = []
    for quad in classic.find_cards(bgr, max_cards)[:max_cards]:
        crop = classic.flatten(bgr, quad)
        if crop.shape[0] > crop.shape[1]:
            crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)
        flags = ["fallbackFinder"]
        if quad[:, 0].min() <= 2 or quad[:, 1].min() <= 2 or quad[:, 0].max() >= w - 3 or quad[:, 1].max() >= h - 3:
            flags.append("cutOff")
        out.append(Cut(crop, quad.astype(np.float32), 0.5, flags))
    return _reading_order(out)


def cut(rgb: np.ndarray, max_cards: int = MAX_CARDS, quick: bool = False) -> list:
    """Cards in one picture (RGB in), as CardCut-like objects (BGR images). The cutter in app/cardcut is used when present;
    `quick`: its classic finder only, no model (the fast part of a job)."""
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    try:
        from .cardcut import cut_cards  # owned by the cutter; imported lazily
    except ImportError:
        return classic_cut(bgr, max_cards)
    return cut_cards(bgr, max_cards, use_model=not quick)


def count_cards(rgb: np.ndarray) -> int:
    """Cheap count for the automatic multi-card switch (no model): blobs that differ from the paper colour (the median of the
    picture's border), are filled like a rectangle, have a card-like shape and a similar size."""
    h, w = rgb.shape[:2]
    scale = min(1.0, COUNT_SIDE / max(h, w))
    small = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else rgb
    lab = cv2.cvtColor(small, cv2.COLOR_RGB2LAB).astype(np.float32)
    t = max(2, int(0.02 * min(lab.shape[:2])))
    border = np.concatenate([lab[:t].reshape(-1, 3), lab[-t:].reshape(-1, 3), lab[:, :t].reshape(-1, 3), lab[:, -t:].reshape(-1, 3)])
    paper = np.median(border, axis=0)
    dist = cv2.GaussianBlur(np.linalg.norm(lab - paper, axis=2), (5, 5), 0)
    level = max(4.0, 3.0 * float(np.percentile(np.linalg.norm(border - paper, axis=1), 90)))  # above the paper's own unevenness
    by_colour = cv2.morphologyEx((dist > level).astype(np.uint8) * 255, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    # White cards on white paper: their outline and print still make edges. Close them into blobs, fill, and open away thin glare lines.
    grey = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(grey, (3, 3), 0), 20, 60)
    k = max(9, int(0.03 * max(grey.shape)))
    closed = cv2.morphologyEx(cv2.dilate(edges, np.ones((3, 3), np.uint8)), cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    filled = np.zeros_like(closed)
    cv2.drawContours(filled, cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], -1, 255, -1)
    by_edges = cv2.morphologyEx(filled, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    return max(_card_blobs(by_colour), _card_blobs(by_edges))


def _card_blobs(mask: np.ndarray) -> int:
    """Blobs filled like a rectangle with a card-like shape, of similar size (at least 40% of the biggest)."""
    areas = []
    for cnt in cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        area = cv2.contourArea(cnt)
        if area < 0.01 * mask.size or area > 0.9 * mask.size:
            continue
        (_, _), (rw, rh), _ = cv2.minAreaRect(cnt)
        if area / max(rw * rh, 1) >= 0.8 and 1.2 <= max(rw, rh) / max(min(rw, rh), 1) <= 2.2:
            areas.append(area)
    return sum(a >= 0.4 * max(areas) for a in areas) if areas else 0


# ---- reading one card ------------------------------------------------------------------------------------------------

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
        if kind in ("passport", "visa", "national-id", "residence-permit"):  # the same number printed on the other side
            numbers.setdefault(kind, set()).add(_norm(mrz["fields"]["documentNumber"]["value"]))
    fields = doc.get("fields", {})
    number = fields.get("documentNumber")
    if number and number.get("valid") and kind not in ("aadhaar", "pan", "unknown"):
        numbers.setdefault(kind, set()).add(_norm(number["value"]))
    elif number and kind in NO_CHECK_KINDS and number.get("valid") is not False and len(_norm(number["value"])) >= 7:
        numbers.setdefault(kind, set()).add(_norm(number["value"]))  # no check digit exists: the labelled, well-formed number counts
    if number:
        printed.add(_norm(number["value"]))
    if kind == "passport" and fields.get("fileNumber"):  # the address page and (where printed) the data page carry it
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
    text = "\n".join(l["text"] for l in result.get("lines", []))
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
    """front | back | single | unknown, by document type.
    PAN, visa, OCI, e-Aadhaar letter: single.  Passport: MRZ or data-page labels = front (data page), address page = back.
    ID card with a TD1 MRZ: the MRZ side is the back; TD2: front.  Driving licence: classes of vehicle without a name and date of
    birth = back.  Voter ID: the elector's / father's name = front, address without it = back.
    Others (Aadhaar card, employee card, unknown): front = printed name, date of birth, gender; back = address, the word Address,
    a pin code."""
    kind, text = keys.get("type", "unknown"), keys["text"]
    if kind in SINGLE_TYPES or (kind == "aadhaar" and keys.get("form") == "letter") \
            or (kind == "residence-permit" and keys.get("form") == "frro"):
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


def read_cards(cuts_per_picture: list[list], read: Callable[[np.ndarray, bool], tuple[dict, dict]], map_fn=map) -> list[Card]:
    """cuts_per_picture[i] = the cuts of picture i. `read(rgb, upright) -> (reader result, document)`; `upright` is True when the
    cutter turned the card upright with confidence (no orientationUnsure or fallbackFinder flag), so the reader can skip its own
    orientation check (speed, MJ 5 Nov 2026). `map_fn` lets the caller read in threads."""
    cards: list[Card] = []
    for picture, cuts in enumerate(cuts_per_picture):
        for c in cuts:
            rgb = cv2.cvtColor(np.ascontiguousarray(c.image), cv2.COLOR_BGR2RGB)
            cards.append(Card(len(cards), picture, rgb, np.asarray(c.quad, np.float32), float(c.score), list(c.flags)))
    trusted = lambda k: not {"orientationUnsure", "fallbackFinder"} & set(k.flags)  # noqa: E731
    for card, (result, doc) in zip(cards, map_fn(lambda k: read(k.image, trusted(k)), cards)):
        turn = (result.get("document") or {}).get("rotationApplied") or 0
        if turn:  # the reader found the card upside down (or on its side): the stored copy is turned the same way
            card.image = preprocess.rotate_cw(card.image, int(turn))
        card.result, card.doc = result, doc
        card.keys = keys_of(result, doc)
        card.side = side_of(card.keys)
    return cards


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
    if not same_kind(a, b):  # two different known document types are never one document
        return {"evidence": [], "score": 0.0, "conflict": True, "soft": ["otherDocumentType"], "strong": False,
                "photo": {"outcome": "unclear", "score": None, "reason": "otherDocumentType"}}
    for kind in set(ka["numbers"]) & set(kb["numbers"]):
        if kind in NO_EVIDENCE_KINDS:
            continue
        if ka["numbers"][kind] & kb["numbers"][kind]:
            found.append("aadhaarNumber" if kind == "aadhaar" else "documentNumber")
        else:
            hard = True  # two valid numbers of the same kind that differ
    if not found and not hard:  # a checked number on one card printed (unchecked) on the other: e.g. MRZ back, printed front
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
            # the machine-readable zone's name and date of birth against the printed ones on the other side
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
    a.photo_checks.append({"with": b.index + 1, "use": use, "outcome": photo["outcome"], "score": photo["score"]})
    b.photo_checks.append({"with": a.index + 1, "use": use, "outcome": photo["outcome"], "score": photo["score"]})


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
                if k.side == card.side and k.kind == card.kind and not _other_form(k.keys, card.keys):
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
    """The nearest card of the other side on the same picture, when it is clearly the nearest and close enough."""
    near = sorted(((math.dist(card.centre, o.centre), o) for o in others
                   if o.picture == card.picture and 0.7 <= o.size / max(card.size, 1) <= 1.4), key=lambda t: (t[0], t[1].index))
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
    # A sheet of fronts and a sheet of backs laid out the same way (MJ's scans, 5 Nov 2026): the card in the same place pairs, only
    # when number-matched pairs between the two sheets confirm the layout and none contradicts it (sheet_layout_pairs).
    confirmed = [(p.cards[0], p.cards[1]) for p in people if len(p.cards) == 2 and p.evidence in STRONG]
    for f, b, alike in sheet_layout_pairs(kept, confirmed, open_fronts, open_backs, checks):
        person = Person([f, b], "position", POSITION_SCORE, ["pairedBySheetPosition"])
        person.look = alike
        people.append(person)
        used |= {f.index, b.index}
    open_fronts = [f for f in open_fronts if f.index not in used]
    open_backs = [b for b in open_backs if b.index not in used]
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
            person.suggested = [suggested[card.index] + 1]
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


SHEET_TOL = 0.12  # two cards are "in the same place" when their centres differ by less than this share of the sheet layout
_MAPPINGS = {"same": lambda x, y: (x, y), "mirrorX": lambda x, y: (1 - x, y), "mirrorY": lambda x, y: (x, 1 - y),
             "turned": lambda x, y: (1 - x, 1 - y)}


def _layout_bounds(cards: list[Card]) -> dict[int, tuple[float, float, float, float]]:
    """Per picture, the box around all its cards' centres (a scan's margins and offsets do not matter)."""
    out: dict[int, list] = {}
    for c in cards:
        out.setdefault(c.picture, []).append(c.centre)
    return {pic: (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
            for pic, pts in out.items()}


def _place(card: Card, bounds: dict) -> tuple[float, float]:
    x0, y0, x1, y1 = bounds[card.picture]
    cx, cy = card.centre
    return ((cx - x0) / (x1 - x0) if x1 > x0 else 0.5, (cy - y0) / (y1 - y0) if y1 > y0 else 0.5)


def sheet_layout_pairs(kept: list[Card], confirmed: list[tuple[Card, Card]], open_fronts: list[Card], open_backs: list[Card],
                       checks: dict) -> list[tuple[Card, Card, dict]]:
    """Fronts on one picture and backs on another, laid out the same way (or mirrored, or turned). The layout counts only when
    the pairs already matched by number between those two pictures ALL sit in the same place under exactly one mapping. Then an
    open front pairs with the open back in its place when that back is the only one there and position_pair agrees (nothing
    conflicts, the front's portrait is clear, the two cards look alike)."""
    bounds = _layout_bounds(kept)
    out: list[tuple[Card, Card, dict]] = []
    taken: set[int] = set()
    sheets = {(f.picture, b.picture) for f, b in confirmed if f.picture != b.picture}
    for pf, pb in sorted(sheets):
        proof = [(f, b) for f, b in confirmed if f.picture == pf and b.picture == pb]
        fits = [name for name, m in _MAPPINGS.items()
                if all(math.dist(m(*_place(f, bounds)), _place(b, bounds)) < SHEET_TOL for f, b in proof)]
        if len(fits) != 1:  # no mapping, or several (too little proof to tell them apart): nothing is paired by place
            continue
        m = _MAPPINGS[fits[0]]
        backs_here = [b for b in open_backs if b.picture == pb and b.index not in taken]
        for f in (f for f in open_fronts if f.picture == pf and f.index not in taken):
            spot = m(*_place(f, bounds))
            near = sorted((math.dist(spot, _place(b, bounds)), b.index, b) for b in backs_here)
            if not near or near[0][0] >= SHEET_TOL or (len(near) > 1 and near[1][0] < 2 * SHEET_TOL):
                continue
            b = near[0][2]
            c = checks[(f.index, b.index)]
            alike = position_pair(f, b, c)
            if alike is None:
                continue
            out.append((f, b, {**alike, "layout": fits[0], "proof": len(proof)}))
            taken |= {f.index, b.index}
            backs_here = [x for x in backs_here if x.index != b.index]
    return out


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
    rgb = card.image
    f = LOOK_SIDE / max(rgb.shape[:2])
    small = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else rgb
    lab = cv2.cvtColor(np.ascontiguousarray(small), cv2.COLOR_RGB2LAB).astype(np.float32)
    light = lab[..., 0] >= np.percentile(lab[..., 0], 50)
    gray = cv2.cvtColor(np.ascontiguousarray(small), cv2.COLOR_RGB2GRAY)
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
    when (the caller already checked they are each other's single nearest card of the other side on the same picture):
      * no number or QR could decide (not both cards carry one: two that match pair by number, two that differ conflict);
      * nothing conflicts: no hard or soft disagreement, the same gender and date of birth where both are read, and no differing
        number tails;
      * the front's portrait is clear (found, not too small, blurred or glared);
      * the two cards look alike: the same size, card colour and print style (look_alike).
    Returns the look-alike numbers when paired, else None (the pair stays a suggestion)."""
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
    if f.face is None or getattr(f.face, "status", "") != "found":
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
    """Name, full date of birth and gender of a person, from any of its cards (the front first)."""
    name = next((c.keys.get("name") for c in p.cards if c.keys.get("name")), None)
    dobs = {c.keys.get("dob") for c in p.cards if c.keys.get("dob")}
    full = {d for d in dobs if d and len(d) == 10}
    gender = next((c.keys.get("gender") for c in p.cards if c.keys.get("gender")), None)
    kind = document_type(p)["type"]
    refs = {c.keys.get("passportRef") for c in p.cards if c.keys.get("passportRef")} if kind in REF_TYPES else set()
    numbers = set().union(*(set().union(*c.keys.get("numbers", {}).values()) for c in p.cards if c.keys.get("numbers"))) \
        if any(c.keys.get("numbers") for c in p.cards) else set()
    # A passport's own number as printed (a data page whose MRZ was not read has no checked number): the target of a reference.
    own = numbers | set().union(*(c.keys.get("printed", set()) for c in p.cards)) if kind == "passport" else set()
    form = next((c.keys.get("form") for c in p.cards if c.keys.get("form")), None)
    return {"name": name, "dob": next(iter(full)) if len(full) == 1 else None, "gender": gender, "refs": refs, "numbers": numbers,
            "own": own, "type": kind, "form": form if kind in DISTINCT_FORMS else None, "faces": [c.face for c in p.cards]}


def _other_form(a: dict, b: dict) -> bool:
    """Two documents of one type that are different documents (OCI card and OCI U-visa, visa sticker and ETA printout)."""
    return a.get("type") in DISTINCT_FORMS and bool(a.get("form") and b.get("form")) and a.get("form") != b.get("form")


def _same_guest(a: dict, b: dict) -> tuple[list[str] | None, str, dict | None]:
    """(evidence, note, photo outcome) for two people of DIFFERENT documents. Evidence (a link) only when STRONG:
    passportNumber: a visa, OCI, PIO or residence permit prints the passport number of a passport in the job (unless the date of
    birth or the gender disagrees or the names are clearly different people); documentNumber: the same checked number on both;
    nameAndDob + photoMatch: the full name AND the full date of birth agree AND the ID photos match.
    note: 'possible' = name and full date of birth agree but the photos do not match (or cannot be compared): only a suggestion
    (possibleSameGuest), never a link; 'photoMismatch' = the evidence above, but the photos clearly differ: no link, a person checks."""
    if (a["type"] == b["type"] and not _other_form(a, b)) or "unknown" in (a["type"], b["type"]):
        return None, "", None
    if a["gender"] and b["gender"] and a["gender"] != b["gender"]:
        return None, "", None
    if a["dob"] and b["dob"] and a["dob"] != b["dob"]:
        return None, "", None
    same_name = _same_person_name(a["name"], b["name"])
    name_and_dob = bool(a["dob"] and b["dob"] and same_name)
    by_number = bool(a["refs"] & b["own"] or b["refs"] & a["own"])
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
    """Mark people who are one guest with different documents (Aadhaar + PAN, passport + visa ...). Never merges their pictures.
    A person who matches TWO people of the same other type is linked to neither of them (a namesake is possible). A name and date
    of birth without a photo match is only a suggestion (possibleSameGuest); a clear photo mismatch blocks the link (photoMismatch)."""
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
    for i in range(len(people)):  # one partner per other document type, or none
        by_type: dict[tuple, list[int]] = {}
        for j in links[i]:
            by_type.setdefault((keys[j]["type"], keys[j]["form"]), []).append(j)
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

def person_fields(person: Person) -> tuple[dict, list[str], dict[str, int]]:
    """(fields, doubtful field names, which card (0 = first) gave each field). The front's value wins unless the back is more sure;
    the address comes from the back. A value the two cards disagree on is kept, marked with `conflicts`, and listed as doubtful."""
    front = person.cards[0]
    fields = {k: {**v, "side": front.side} for k, v in front.doc.get("fields", {}).items()}
    origin = {k: 0 for k in fields}
    doubtful = list(front.doc.get("doubtful", []))
    for i, other in enumerate(person.cards[1:], 1):
        for k, f in other.doc.get("fields", {}).items():
            mine = fields.get(k)
            if mine is None or (k == "address" and other.side == "back") or f["confidence"] > mine["confidence"]:
                entry = {**f, "side": other.side}
                if mine and mine["value"] != f["value"]:
                    entry["conflicts"] = [{"value": mine["value"], "side": mine["side"]}]
                fields[k], origin[k] = entry, i
            elif mine["value"] != f["value"] and k in ("name", "dob", "documentNumber"):
                mine.setdefault("conflicts", []).append({"value": f["value"], "side": other.side})
        doubtful += other.doc.get("doubtful", [])
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
    return fields, list(dict.fromkeys(doubtful)), origin


def _letters(text: str) -> str:
    return re.sub(r"[^0-9a-z]", "", (text or "").casefold())


def respace(value: str, candidate: str | None) -> str | None:
    """The OCR often joins the words of a name (ANILMEHRA). When a second source (the card's QR, the other side, the same guest's
    other document) has EXACTLY the same letters with more word breaks, only the breaks are taken from it: the letters and their
    case stay as read. Anything else returns None (nothing is changed)."""
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
    known = [d for d in docs if not d.get("unknown")]
    best = known[0] if known else docs[0]
    return {"type": best["type"], "guessed": best.get("guessedType", best["type"]), "confidence": best.get("confidence", 0.0)}
