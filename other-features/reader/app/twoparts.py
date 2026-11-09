"""The reader in two parts (copied from intake-worker's split on 2026-11-05: the form first, the picture after).

FAST part (POST /v1/read with picture=later): a sheet is cut by the classic finder without the model, every card is read side by
side and grouped into people (multi.read_sheet quick=True); a single ID is read as before. That answer fills the form.
BACKGROUND part (picture_part, GET /v1/picture/{token}): the model cuts the cards, every person gets the stored picture (front
above back, under 500 KB) and what the background reads differently is listed. It never changes a value of the fast answer: a
disagreement is a flag (backgroundDisagrees) and a check."""
from __future__ import annotations

import base64
import time

import cv2
import numpy as np

from . import cardcut
from .config import WorkerConfig
from .engines import load_engines
from .multi import _png, fit_image, read_sheet
from .pair import stack_images
from .preprocess import rotate_cw
from .reader import ReadOptions, Reader, decode_image

COMPARED = ("name", "dob", "gender", "documentNumber", "address", "passportNumber", "visaNumber", "expiry", "nationality")
SINGLE_COMPARED = ("name", "dob", "documentNumber", "address")
QUAD_MATCH = 0.02  # the same card: every corner within this share of the card's long side
LOOSE_MATCH = 0.7  # the same card cut a little differently: this share of the smaller outline is shared


def _value(field) -> str:
    return "".join(str((field or {}).get("value") if isinstance(field, dict) else field or "").split()).casefold()


def _quad(q) -> np.ndarray:
    return np.asarray(q, np.float32).reshape(4, 2)


def same_card(a, b) -> float:
    """1.0 for the same place, else the share of the smaller outline both cover (0 when apart)."""
    a, b = _quad(a), _quad(b)
    long_side = max(np.linalg.norm(a[1] - a[0]), np.linalg.norm(a[3] - a[0]), 1.0)
    if float(np.linalg.norm(a - b, axis=1).max()) <= QUAD_MATCH * long_side:
        return 1.0
    inter, _ = cv2.intersectConvexConvex(a, b)
    smaller = min(abs(cv2.contourArea(a)), abs(cv2.contourArea(b)))
    return float(inter / smaller) if smaller > 0 else 0.0


def _region_map(fast_regions: list[dict], full_regions: list[dict]) -> dict[int, int]:
    """Background region id -> the fast region id of the same card."""
    out: dict[int, int] = {}
    for r in full_regions:
        best = max(((same_card(f["quad"], r["quad"]), f["regionId"]) for f in fast_regions if f["regionId"] not in out.values()),
                   default=(0.0, None))
        if best[1] is not None and best[0] >= LOOSE_MATCH:
            out[r["regionId"]] = best[1]
    return out


def _fast_picture(img: np.ndarray, regions: list[dict]) -> tuple[str, str] | None:
    """A picture of a fast person the model cut differently, from the fast part's own cuts (never someone else's picture)."""
    crops = []
    for r in regions:
        q = _quad(r["quad"])
        crop = cardcut._warp(img, q, cardcut._out_size(q, False), False)
        turn = int(r.get("rotationApplied") or 0)
        crops.append(rotate_cw(crop, turn) if turn else crop)
    if not crops:
        return None
    png = stack_images(_png(crops[0]), _png(crops[1])) if len(crops) == 2 else _png(crops[0])
    data, fmt = fit_image(png)
    return base64.b64encode(data).decode(), fmt


def compare_sheet(fast: dict, full: dict, img: np.ndarray) -> dict:
    fast_regions = {r["regionId"]: r for r in fast.get("regions") or []}
    mapped = _region_map(list(fast_regions.values()), full.get("regions") or [])
    common = []
    if full.get("cards", 0) != fast.get("cards", 0):
        common.append({"code": "cards", "fast": fast.get("cards", 0), "background": full.get("cards", 0)})
    if len(full.get("people") or []) != len(fast.get("people") or []):
        common.append({"code": "people", "fast": len(fast.get("people") or []), "background": len(full.get("people") or [])})
    used: set[int] = set()
    out = []
    for person in fast.get("people") or []:
        mine = set(person.get("regions") or [])
        best, overlap = None, 0
        for j, other in enumerate(full.get("people") or []):
            shared = len({mapped.get(r) for r in other.get("regions") or []} & mine)
            if j not in used and shared > overlap:
                best, overlap = j, shared
        disagree = list(common)
        entry = {"personId": person["personId"]}
        if person.get("status") == "rejected":  # the fast part refused this person (photo rule): no picture
            out.append({**entry, "status": "rejected", "disagreements": disagree, "needsHumanCheck": False})
            continue
        other = None
        if best is not None:
            used.add(best)
            other = full["people"][best]
        if other is None:
            disagree.append({"code": "unmatched"})
        else:
            theirs = sorted(mapped.get(r) or 0 for r in other.get("regions") or [])
            if theirs != sorted(mine):
                disagree.append({"code": "pairing", "fast": sorted(mine), "background": theirs})
            if (other.get("documentType") or {}).get("type") != (person.get("documentType") or {}).get("type"):
                disagree.append({"code": "documentType", "background": (other.get("documentType") or {}).get("type")})
            if other.get("status") == "rejected":
                disagree.append({"code": "photo"})
            else:
                for k in COMPARED:
                    a, b = (person.get("fields") or {}).get(k), (other.get("fields") or {}).get(k)
                    if _value(a) != _value(b):
                        disagree.append({"code": "field", "field": k})
        if other is not None and other.get("image"):
            image, fmt = other["image"], other.get("imageFormat", "png")
        else:
            made = _fast_picture(img, [fast_regions[r] for r in person.get("regions") or [] if r in fast_regions])
            image, fmt = made if made else (None, None)
        out.append({**entry, "status": "done", "image": image, "imageFormat": fmt, "disagreements": disagree,
                    "flags": ["backgroundDisagrees"] if disagree else [], "needsHumanCheck": bool(disagree or person.get("needsHumanCheck"))})
    for j, other in enumerate(full.get("people") or []):
        if j in used:
            continue  # a person only the model found: the form never showed it
        out.append({"personId": None, "backgroundOnly": True, "status": other.get("status", "accepted"),
                    "documentType": other.get("documentType"), "fields": other.get("fields"), "suggestedName": other.get("suggestedName"),
                    "image": other.get("image"), "imageFormat": other.get("imageFormat"),
                    "disagreements": common + [{"code": "backgroundOnly"}], "flags": ["backgroundOnly", "backgroundDisagrees"],
                    "needsHumanCheck": True})
    return {"status": "done", "cards": full.get("cards", 0), "people": out}


def compare_single(fast: dict, full: dict) -> dict:
    """A single ID: the background cuts the card (front and back when both are in the photo) and stores its picture; the person
    is found by its document number, else its name."""
    fields = fast.get("fields") or {}
    people = [p for p in full.get("people") or [] if p.get("status") != "rejected"]
    mine = next((p for p in people if _value(fields.get("documentNumber")) and
                 _value((p.get("fields") or {}).get("documentNumber")) == _value(fields.get("documentNumber"))), None)
    mine = mine or next((p for p in people if _value(fields.get("name")) and
                         _value((p.get("fields") or {}).get("name")) == _value(fields.get("name"))), None)
    disagree = []
    if mine is None:
        disagree.append({"code": "unmatched"})
    else:
        theirs = mine.get("fields") or {}
        disagree += [{"code": "field", "field": k} for k in SINGLE_COMPARED
                     if k in fields and k in theirs and _value(fields[k]) != _value(theirs[k])]
        if len(full.get("people") or []) > 1:
            disagree.append({"code": "people", "fast": 1, "background": len(full["people"])})
    person = {"personId": 1, "status": "done", "image": (mine or {}).get("image"), "imageFormat": (mine or {}).get("imageFormat"),
              "disagreements": disagree, "flags": ["backgroundDisagrees"] if disagree else [],
              "needsHumanCheck": bool(disagree or fast.get("needsHumanCheck"))}
    return {"status": "done", "cards": full.get("cards", 0), "people": [person]}


def picture_part(data: bytes, cfg: WorkerConfig, languages: list[str], mode: str, fast: dict, single: bool, max_regions: int,
                 engines=None) -> dict:
    """The BACKGROUND part: model cut, one picture per person, compared with the fast answer. Runs in the background pool."""
    started = time.monotonic()
    reader = Reader(load_engines(cfg) if engines is None else engines, cfg)
    opts = ReadOptions(languages=languages, mode=mode, find_document=False)
    full = read_sheet(reader, data, opts, 2 if single else max(1, min(max_regions, 12)), False, "stack")
    out = compare_single(fast, full) if single else compare_sheet(fast, full, decode_image(data, cfg.max_pixels))
    out["tookMs"] = int((time.monotonic() - started) * 1000)
    return out
