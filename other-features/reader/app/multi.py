"""Several IDs in one photo: cut every card (app/cardcut: Segment Anything, tight perspective cut, sleeve trimmed, upright; the
classic finder in app/cards when the cutter finds nothing), read each card on its own, then GROUP the cards into people with
the evidence rules of app/people (Aadhaar number, other ID number, QR name and date of birth, MRZ, name and date of birth;
layout only when unambiguous, then needsHumanCheck). A pairing is never forced.

Response shape (unchanged keys): cards, regions [{regionId, quad, side, documentType, fields, confidence, flags,
needsHumanCheck, crop?}], people [{personId, regions, evidence, confidence, fields, samePerson, flags, needsHumanCheck, image?}],
flags, needsHumanCheck. People also carry documentType, doubtfulFields, suggestedName (FirstName_LastName_IdName), duplicates,
guest and linked; with merge=stack every person gets one picture (front above back, or the single card) as PNG, or JPEG when
the PNG would be larger than MAX_IMAGE_BYTES (imageFormat says which).

Added 4 Nov 2026 (MJ: namesake rule, photo check, clarity check; app/inspection): every region carries `clarity` (grade clear /
usable / unclear, reasons, a retake line, per-region grades for photo, name/DOB, number line, MRZ, QR) and `photo` (portrait
status and the photo outcomes it took part in); every person carries `clarity` (worst card grade, each card's grade and reasons,
retake advice, unclearFields), `photo` (outcome match / mismatch / unclear / noPhoto / notCompared / unavailable, portraits,
checks), possibleSameGuestAs and suggestedPartner. Face embeddings never leave memory."""
from __future__ import annotations

import base64
import os
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

from . import cardcut, cards, clarity, faces
from .doctypes import read_document
from .fields import extract_fields
from .inspection import inspect_card, person_blocks, region_blocks
from .pair import judge, stack_images
from .people import Card, document_type, group, keys_of, needs_check, person_fields, prepare, side_of, suggested_name
from .preprocess import rotate_cw
from .reader import ReadOptions, Reader, decode_image

MAX_REGIONS = 12
MIN_CARD_LONG_SIDE = 600  # below this (in the photo's own pixels) a card is too small to read reliably
MAX_IMAGE_BYTES = 500 * 1024  # a person's picture stays under this
QUICK_DOUBT = {"lowContrastEdge", "ratioOff"}  # outlines the quick finder could not fit well are not cards
READ_THREADS = int(os.environ.get("READER_READ_THREADS", "3"))  # cards of one sheet read side by side
TRUSTED_READ_CONFIDENCE = 0.85  # a card read without the orientation check is read again when it reads worse than this


def _read_card(reader: Reader, crop: np.ndarray, opts: ReadOptions, upright: bool) -> dict:
    """One cut card, on its own Reader (cards are read side by side). `upright`: the cutter turned it upright with confidence, so
    the orientation check is skipped; a front that then reads poorly or without a name is read again with the check, and the
    better reading is kept (copied from intake-worker on 2026-11-05)."""
    def fresh() -> Reader:
        one = Reader(reader.engines, reader.cfg)
        one.job_end = reader.job_end
        return one
    png = _png(crop)
    sub = ReadOptions(languages=opts.languages, mode=opts.mode, find_document=False, skip_orientation=upright)
    result = fresh().read_image(png, sub)
    if not upright:
        return result
    doc = read_document(result)
    back = side_of(keys_of(result, {**doc, "fields": {**extract_fields(result, "x"), **doc["fields"]}})) == "back"
    if back or (result["confidence"] >= TRUSTED_READ_CONFIDENCE and "name" in doc["fields"]):
        return result
    again = fresh().read_image(png, ReadOptions(languages=opts.languages, mode=opts.mode, find_document=False))
    named = "name" in read_document(again)["fields"]
    return again if (named, again["confidence"]) > ("name" in doc["fields"], result["confidence"]) else result


def _png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes()


def fit_image(png: bytes, limit: int = MAX_IMAGE_BYTES) -> tuple[bytes, str]:
    """The PNG when it fits, else the best JPEG quality that fits (the picture is shrunk only when even quality 40 does not)."""
    if len(png) <= limit:
        return png, "png"
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    while True:
        for quality in (90, 80, 70, 60, 50, 40):
            ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
            if len(buf) <= limit:
                return buf.tobytes(), "jpeg"
        img = cv2.resize(img, None, fx=0.85, fy=0.85, interpolation=cv2.INTER_AREA)


def _classic_cuts(img: np.ndarray, limit: int) -> list[cardcut.CardCut]:
    """The old finder: corners, flattened, turned to landscape. Every card carries fallbackFinder."""
    h, w = img.shape[:2]
    out = []
    for quad in cards.find_cards(img, limit):
        crop = cards.flatten(img, quad)
        if crop.shape[0] > crop.shape[1]:
            crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)
        flags = ["fallbackFinder"]
        if quad[:, 0].min() <= 2 or quad[:, 1].min() <= 2 or quad[:, 0].max() >= w - 3 or quad[:, 1].max() >= h - 3:
            flags.append("cutOff")
        out.append(cardcut.CardCut(crop, cardcut.order_corners(quad), 0.5, flags))
    return out


def cut(img: np.ndarray, limit: int, engines: list | None = None, quick: bool = False) -> list[cardcut.CardCut]:
    """Up to `limit` cards in reading order. The cutter first; a card the classic finder sees where the cutter found nothing
    (cards too small for the cutter, for example) is added with fallbackFinder when it carries print.
    `quick` (the fast part, copied from intake-worker on 2026-11-05): the cutter's classic finder only, no model; an outline it
    could not fit well is dropped, and with no card at all the whole photo is read as one."""
    if quick:
        found = [c for c in cardcut.cut_cards(img, limit, engines=engines, use_model=False) if not QUICK_DOUBT & set(c.flags)]
        if not found:
            h, w = img.shape[:2]
            whole = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
            found = [cardcut.CardCut(np.ascontiguousarray(img), whole, 0.3, ["quickFinder", "wholePicture"])]
        return found
    found = cardcut.cut_cards(img, limit, engines=engines)
    extra = [c for c in _classic_cuts(img, limit)
             if all(cardcut._overlap(c.quad, f.quad) < 0.2 for f in found) and cardcut._printed(img, c.quad)]
    if not extra:
        return found
    return cardcut._reading_order(found + extra)[:limit]


def _native_long_side(quad: np.ndarray) -> float:
    q = np.asarray(quad, np.float32).reshape(4, 2)
    return float(max(np.linalg.norm(q[(i + 1) % 4] - q[i]) for i in range(4)))


def read_sheet(reader: Reader, data: bytes, opts: ReadOptions, max_regions: int = MAX_REGIONS, return_crops: bool = False,
               merge: str = "none", quick: bool = False) -> dict:
    """`quick`: the FAST part (no model, no picture): every card the classic finder cuts, read side by side, grouped into people;
    the picture comes from the background part (app/twoparts.py)."""
    merge = "none" if quick else merge
    img = decode_image(data, reader.cfg.max_pixels)
    jpeg_q = clarity.jpeg_quality(data)  # read from the ORIGINAL upload, before the cutter resamples any card
    # one extra so "too many" can be told from "exactly the limit"
    cuts = cut(img, max_regions + 1, reader.engines, quick=True) if quick else cut(img, max_regions + 1, reader.engines)
    flags: list[str] = []
    if len(cuts) > max_regions:
        flags.append("tooManyCards")
        cuts = cuts[:max_regions]
    crops = [np.ascontiguousarray(c.image) for c in cuts]
    upright = [not ({"orientationUnsure", "wholePicture", "fallbackFinder"} & set(c.flags)) for c in cuts]
    with ThreadPoolExecutor(max_workers=max(1, min(READ_THREADS, len(cuts)))) as pool:  # cards read side by side (speed, 5 Nov 2026)
        results = list(pool.map(lambda job: _read_card(reader, job[0], opts, job[1]), zip(crops, upright)))
    regions_out, readable, region_cards = [], [], []
    for i, (c, crop, result) in enumerate(zip(cuts, crops, results), 1):
        turn = int((result.get("document") or {}).get("rotationApplied") or 0)
        if turn:  # the reader found the card on its side or upside down: the stored copy is turned the same way
            crop = rotate_cw(crop, turn)
        doc = read_document(result)
        pairing = {**extract_fields(result, "x"), **doc["fields"]}  # label lines and code payloads help to PAIR unknown types
        card = prepare(Card(i, crop, np.asarray(c.quad, np.float32), float(c.score), list(c.flags), result, {**doc, "fields": pairing}))
        card.jpeg_quality = jpeg_q
        small = _native_long_side(c.quad) < MIN_CARD_LONG_SIDE
        rflags = list(c.flags) + list(result["flags"]) + (["regionTooSmall", "lowResolutionForIdCount"] if small else [])
        entry = {"regionId": i, "quad": [[round(float(x), 1), round(float(y), 1)] for x, y in c.quad], "side": card.side,
                 "documentType": {k: doc[k] for k in ("type", "confidence")}, "fields": doc["fields"],
                 "confidence": result["confidence"], "cutScore": round(float(c.score), 3), "flags": list(dict.fromkeys(rflags)),
                 "rotationApplied": turn,
                 "needsHumanCheck": bool(result["needsHumanCheck"] or doc["needsHumanCheck"] or small
                                         or set(c.flags) & {"cutOff", "lowContrastEdge", "orientationUnsure"})}
        if small:
            entry["advice"] = "Photograph the IDs in smaller groups (4 or fewer per photo)."
            entry["fields"] = {}  # never silently return text from an unreadable region
            card.clarity = clarity.assess(crop, None, None, "unknown", "unknown", _native_long_side(c.quad), None, jpeg_q)
        else:
            readable.append(card)
        if return_crops:
            entry["crop"] = base64.b64encode(_png(crop)).decode()
        regions_out.append(entry)
        region_cards.append(card)
    with ThreadPoolExecutor(max_workers=max(1, min(READ_THREADS, len(readable)))) as pool:
        list(pool.map(inspect_card, readable))  # photo + clarity on each untouched upright card, side by side
    persons = group(readable)
    for entry, card in zip(regions_out, region_cards):  # after grouping: the photo checks each card took part in are known
        entry["clarity"], entry["photo"] = region_blocks(card)
        if card.clarity.get("grade") == "unclear":
            entry["flags"].append("unclearCard")
            entry["needsHumanCheck"] = True
            if card.clarity.get("advice"):
                entry["retake"] = card.clarity["advice"]
        if card.clarity.get("photoReject"):  # MJ's rule: an unclear ID photo rejects the card
            entry["rejected"] = {"code": "photo_unclear", "message": clarity.PHOTO_RETAKE, "reason": card.clarity["photoReject"]["reason"]}
    faces.forget(c.face for c in region_cards)  # the embeddings were only needed for grouping: dropped now, never returned
    people = []
    for n, person in enumerate(persons, 1):
        fields, doubtful = person_fields(person)
        dtype = document_type(person)
        pair = len(person.cards) == 2
        verdict = judge(person.cards[0].result, person.cards[1].result) if pair else None
        seen, photo, extra = person_blocks(person, fields, list(person.flags))
        flags = list(dict.fromkeys(list(person.flags) + extra))
        rejected = [{"region": c.index, "side": c.side, "reason": c.clarity["photoReject"]["reason"]}
                    for c in person.cards if (c.clarity or {}).get("photoReject")]
        if rejected and "photoUnclear" not in flags:
            flags.append("photoUnclear")
        entry = {"personId": n, "regions": [c.index for c in person.cards], "evidence": person.evidence,
                 "confidence": person.confidence, "documentType": dtype, "fields": fields, "doubtfulFields": doubtful,
                 "suggestedName": suggested_name(fields, dtype["type"], person.rare), "rare": person.rare,
                 "pairedByPosition": person.evidence == "position", "samePerson": verdict, "flags": flags,
                 "duplicates": [d.index for d in person.duplicates], "guest": person.guest, "linked": person.linked,
                 "possibleSameGuestAs": person.possible, "suggestedPartner": person.suggested,
                 "clarity": seen, "photo": photo,
                 "needsHumanCheck": needs_check(person) or bool(doubtful) or bool(extra)
                 or (verdict is not None and verdict["verdict"] == "mismatch")}
        if person.look:
            entry["lookAlike"] = person.look
        if rejected:  # MJ's rule: an unclear ID photo rejects the card; no picture is made for this person
            entry["status"] = "rejected"
            entry["rejected"] = {"code": "photo_unclear", "message": clarity.PHOTO_RETAKE, "cards": rejected}
            people.append(entry)
            continue
        entry["status"] = "accepted"
        if merge == "stack":
            png = stack_images(_png(person.cards[0].image), _png(person.cards[1].image)) if pair else _png(person.cards[0].image)
            picture, fmt = fit_image(png)
            entry["image"], entry["imageFormat"] = base64.b64encode(picture).decode(), fmt
        people.append(entry)
    flags += ["noCardsFound"] if not cuts else []
    return {"cards": len(cuts), "regions": regions_out, "people": people, "flags": flags,
            "needsHumanCheck": bool(flags) or any(r["needsHumanCheck"] for r in regions_out) or any(p["needsHumanCheck"] for p in people)}
