"""The 'inspect' step (MJ, 4 Nov 2026: "check the image also in all, so we know in advance when it is not clear"): the photo check
(app/faces) and the clarity check (app/clarity) on every card, and what the API returns of them. Follows intake-worker's pipeline
(copied from intake-worker on 2026-11-04 and shaped to the reader's regions / people answer).

Returned (numbers and fixed phrases only; a face embedding never leaves memory):
  region  clarity {grade, reasons, advice, scores, regions {photo, nameDob, number, mrz, qr: {grade, sharpness, glare, source}}, ocr}
          photo   {status, reasons, quality?, checks [{withRegion, use, outcome, score}]}
  person  clarity {grade, cards [{region, side, grade, reasons, advice}], advice, unclearFields}
          photo   {outcome, portraits [{region, side, status, reasons}], checks [...]}
          flags   unclearCard, keyFieldUnclear, photoUnclear (plus the grouping's photoMismatch, sameNameDobNoNumber ...)
  single  the same clarity and photo blocks on /v1/read with kind=id."""
from __future__ import annotations

import numpy as np

from . import clarity, faces, geometry
from .people import SINGLE_TYPES, keys_of, side_of
from .preprocess import rotate_cw

KEY_FIELDS = ("documentNumber", "dob", "name")


def inspect_card(card) -> None:
    """Photo and clarity of one cut card (people.Card), on the untouched upright pixels. The embedding stays on card.face."""
    source_scale = card.size / max(card.image.shape[:2]) if card.size else 1.0
    card.face = faces.find_portrait(card.image, source_scale)
    card.clarity = clarity.assess(card.image, card.result, card.doc, card.kind, card.side, card.size or None, card.face,
                                  getattr(card, "jpeg_quality", None))


def region_blocks(card) -> tuple[dict, dict]:
    """(clarity, photo) for one region entry."""
    photo = {**(card.face.public() if card.face is not None else {"status": "notChecked", "reasons": []}),
             "checks": list(card.photo_checks)}
    return dict(card.clarity), photo


def photo_outcome(portraits: list[dict], checks: list[dict], flags: list[str]) -> str:
    """One word for a person's photo check: mismatch | match | unclear | noPhoto | notCompared | unavailable."""
    outcomes = {c["outcome"] for c in checks}
    if "mismatch" in outcomes or "photoMismatch" in flags:
        return "mismatch"
    if "match" in outcomes:
        return "match"
    if outcomes or "photoUnclear" in flags or any(p["status"] == "unclear" for p in portraits):
        return "unclear"
    if portraits and all(p["status"] == "unavailable" for p in portraits):
        return "unavailable"
    if not any(p["status"] == "found" for p in portraits):
        return "noPhoto"
    return "notCompared"  # a clear portrait, but no other card to compare it with


def person_blocks(person, fields: dict, flags: list[str]) -> tuple[dict, dict, list[str]]:
    """(clarity, photo, extra flags) for one person: every card's grade, the retake lines, the key fields read from an unclear
    card or region, and the photo outcomes of its cards and of its guest links."""
    cards = [{"region": c.index, "side": c.side, "grade": c.clarity.get("grade", "clear"), "reasons": c.clarity.get("reasons", []),
              "advice": c.clarity.get("advice")} for c in person.cards if c.clarity]
    by_side = {c.side: c for c in person.cards}
    unclear = sorted({k for k in KEY_FIELDS if k in fields
                      and k in clarity.unclear_fields(by_side.get(fields[k].get("side"), person.cards[0]).clarity, [k])})
    extra = []
    if any(c["grade"] == "unclear" for c in cards):
        extra.append("unclearCard")
    if unclear:
        extra.append("keyFieldUnclear")
    advice = [c["advice"] for c in cards if c.get("advice")]
    summary = {"grade": clarity.worst(c["grade"] for c in cards), "cards": cards, "advice": " ".join(dict.fromkeys(advice)) or None,
               "unclearFields": unclear}
    portraits = [{"region": c.index, "side": c.side, **c.face.public()} for c in person.cards if c.face is not None]
    checks = [x for c in person.cards for x in c.photo_checks] + list(person.photo_checks)
    photo = {"outcome": photo_outcome(portraits, checks, flags + extra), "portraits": portraits, "checks": checks}
    return summary, photo, extra


def document_view(img: np.ndarray, result: dict) -> tuple[np.ndarray, float]:
    """(the document as the reader saw it: flattened from its quad and turned upright, its long side in source pixels)."""
    document = result.get("document") or {}
    quad = document.get("quad")
    view, long_px = img, float(max(img.shape[:2]))
    if quad is not None and len(np.asarray(quad).reshape(-1, 2)) == 4:
        corners = np.asarray(quad, np.float32).reshape(4, 2)
        view = geometry.warp(img, corners)
        long_px = clarity.source_long_px(corners, max(img.shape[:2]))
    turn = int(document.get("rotationApplied") or 0)
    return (rotate_cw(view, turn) if turn else view), long_px


def inspect_single(img: np.ndarray, result: dict, doc: dict, jpeg_q: float | None = None) -> dict:
    """Clarity and photo for one ID picture (/v1/read with kind=id). Updates result: clarity, photo, flags, needsHumanCheck, and
    `rejected` when MJ's photo rule rejects the card (an unclear ID photo). `jpeg_q` = the original upload's JPEG quality."""
    view, long_px = document_view(img, result)
    kind = doc.get("type", "unknown")
    side = "single" if kind in SINGLE_TYPES else side_of(keys_of(result, doc))
    if side == "unknown":
        side = "front"
    portrait = faces.find_portrait(view, long_px / max(view.shape[:2]))
    card = clarity.assess(view, result, doc, kind, side, long_px, portrait, jpeg_q)
    fields = doc.get("fields", {})
    form = (fields.get("form") or {}).get("value")
    unclear = sorted(k for k in KEY_FIELDS if k in fields and k in clarity.unclear_fields(card, [k]))
    flags = []
    if card["grade"] == "unclear":
        flags.append("unclearCard")
    if unclear:
        flags.append("keyFieldUnclear")
    if portrait.status in ("none", "unclear") and clarity.expects_portrait(kind, side, form):
        flags.append("photoUnclear")
    if card.get("photoReject"):  # MJ's rule: an unclear ID photo rejects the card (a retake is asked for)
        result["rejected"] = {"code": "photo_unclear", "message": clarity.PHOTO_RETAKE, "reason": card["photoReject"]["reason"]}
    portraits = [{"side": side, **portrait.public()}]
    faces.forget([portrait])
    result["clarity"] = {**card, "side": side, "unclearFields": unclear}
    result["photo"] = {"outcome": photo_outcome(portraits, [], flags), "portraits": portraits, "checks": []}
    result["flags"] = list(dict.fromkeys(list(result.get("flags", [])) + flags))
    result["needsHumanCheck"] = bool(result.get("needsHumanCheck")) or bool({"unclearCard", "keyFieldUnclear"} & set(flags))
    return result
