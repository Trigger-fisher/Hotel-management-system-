"""Front and back of one ID: read both, decide which is which, merge the fields, and judge `samePerson`
from evidence in the data only (numbers with check digits, or name plus date of birth). Never a face
comparison, never a biometric. A mismatch or unknown is a flag for the caller, never a block."""
from __future__ import annotations

import io

from PIL import Image

from .config import WorkerConfig
from .errors import ReaderError
from .fields import (NAME_MATCH_THRESHOLD, NAME_MISMATCH_BELOW, all_numbers, extract_fields, name_similarity)
from .jobs import run_job

MERGES = ("none", "stack", "pdf")
GAP = 40  # white band between the sides in a stacked image


def _read_side(data: bytes | None, cfg: WorkerConfig, languages, mode, find_document, engines) -> tuple[dict | None, dict | None]:
    """(result, error). A side that cannot be read does not stop the other one."""
    if data is None:
        return None, {"code": "side_missing", "message": "This side was not sent."}
    try:
        return run_job(data, cfg, languages, mode, find_document, engines=engines), None
    except ReaderError as exc:
        if exc.code in ("busy", "timeout"):
            raise
        return None, {"code": exc.code, "message": exc.message}


def classify(result: dict | None) -> dict:
    """Which side does this look like? Front: a name and a date of birth. Back: an address and a printed code."""
    if not result:
        return {"front": 0, "back": 0}
    fields = extract_fields(result, "x")
    front = int("name" in fields) + int("dob" in fields) + int("documentNumber" in fields and not result.get("codes"))
    back = int("address" in fields) * 2 + int(bool(result.get("codes")))
    return {"front": front, "back": back}


def judge(front: dict | None, back: dict | None) -> dict:
    """{verdict: match|mismatch|unknown, reasons: [...], evidence: {...}}"""
    reasons: list[dict] = []
    if front is None or back is None:
        return {"verdict": "unknown", "reasons": [{"code": "sideMissingOrUnreadable",
                                                   "message": "One side could not be read, so the two cannot be compared."}],
                "evidence": {}}
    fa, fb = extract_fields(front, "front"), extract_fields(back, "back")
    evidence: dict = {}
    verdicts: list[str] = []

    # 1. Document numbers of the same kind on both sides.
    na, nb = all_numbers(front, "front"), all_numbers(back, "back")
    for a in na:
        for b in nb:
            if a["type"] != b["type"]:
                continue
            if a["value"] == b["value"] and a["valid"] and b["valid"]:
                verdicts.append("match")
                reasons.append({"code": "documentNumberMatch", "message": f"The same valid {a['type']} number is on both sides."})
                evidence["documentNumber"] = {"type": a["type"], "equal": True}
            elif a["valid"] and b["valid"]:
                verdicts.append("mismatch")
                reasons.append({"code": "documentNumberDiffers", "message": f"Both sides carry a valid {a['type']} number, and they differ."})
                evidence["documentNumber"] = {"type": a["type"], "equal": False}
            else:
                verdicts.append("unknown")
                reasons.append({"code": "documentNumberUnverified", "message": "A number on one side failed its check digit, so it cannot prove anything."})
            break
        else:
            continue
        break

    # 2. Name and date of birth.
    name_a, name_b = fa.get("name"), fb.get("name")
    dob_a, dob_b = fa.get("dob"), fb.get("dob")
    if name_a and name_b:
        similarity = name_similarity(name_a["value"], name_b["value"])
        evidence["nameSimilarity"] = round(similarity, 3)
        if dob_a and dob_b:
            evidence["dobEqual"] = dob_a["value"] == dob_b["value"]
        if similarity >= NAME_MATCH_THRESHOLD and dob_a and dob_b and dob_a["value"] == dob_b["value"]:
            verdicts.append("match")
            reasons.append({"code": "nameAndDobMatch", "message": "The names are the same after normalising, and so are the dates of birth."})
        elif dob_a and dob_b and dob_a["value"] != dob_b["value"]:
            verdicts.append("mismatch")
            reasons.append({"code": "dobDiffers", "message": "The dates of birth on the two sides differ."})
        elif similarity < NAME_MISMATCH_BELOW:
            verdicts.append("mismatch")
            reasons.append({"code": "nameDiffers", "message": "The names on the two sides are clearly different."})
        else:
            verdicts.append("unknown")
            reasons.append({"code": "nameSimilarButNotConfirmed", "message": "The names look alike but the date of birth could not confirm it."})

    if not verdicts:
        return {"verdict": "unknown", "reasons": [{"code": "notEnoughEvidence",
                                                   "message": "The two sides share no number, or name with date of birth, to compare."}],
                "evidence": evidence}
    if evidence.get("documentNumber", {}).get("equal") is False:
        # Two different VALID numbers (check digits pass) outweigh a similar name: this is strong evidence.
        return {"verdict": "mismatch", "reasons": reasons, "evidence": evidence}
    if "mismatch" in verdicts and "match" in verdicts:
        reasons.append({"code": "conflictingEvidence", "message": "Some evidence agrees and some disagrees: a person should look."})
        return {"verdict": "unknown", "reasons": reasons, "evidence": evidence}
    verdict = "mismatch" if "mismatch" in verdicts else "match" if "match" in verdicts else "unknown"
    return {"verdict": verdict, "reasons": reasons, "evidence": evidence}


def merge_fields(front: dict | None, back: dict | None) -> dict:
    """One value per field: the most confident one, with the side it came from and any disagreement."""
    fa = extract_fields(front, "front") if front else {}
    fb = extract_fields(back, "back") if back else {}
    merged: dict = {}
    for name in sorted(set(fa) | set(fb)):
        options = [d[name] for d in (fa, fb) if name in d]
        best = max(options, key=lambda o: o["confidence"])
        entry = dict(best)
        others = [o for o in options if o is not best and o["value"] != best["value"]]
        if others:
            entry["conflicts"] = [{"value": o["value"], "side": o["side"], "confidence": o["confidence"]} for o in others]
        merged[name] = entry
    return merged


def stack_images(front: bytes, back: bytes) -> bytes:
    """Front above back, same width (the narrower side is scaled up to the wider), white gap between."""
    a, b = (Image.open(io.BytesIO(x)).convert("RGB") for x in (front, back))
    width = max(a.width, b.width)
    a, b = (im if im.width == width else im.resize((width, round(im.height * width / im.width)), Image.LANCZOS) for im in (a, b))
    canvas = Image.new("RGB", (width, a.height + GAP + b.height), "white")
    canvas.paste(a, (0, 0))
    canvas.paste(b, (0, a.height + GAP))
    out = io.BytesIO()
    canvas.save(out, "PNG")
    return out.getvalue()


def two_page_pdf(front: bytes, back: bytes) -> bytes:
    a, b = (Image.open(io.BytesIO(x)).convert("RGB") for x in (front, back))
    out = io.BytesIO()
    a.save(out, "PDF", save_all=True, append_images=[b], resolution=150.0)
    return out.getvalue()


def run_pair(front: bytes | None, back: bytes | None, cfg: WorkerConfig, languages: list[str], mode: str,
             find_document: bool, merge: str, engines=None) -> tuple[dict, bytes | None, str]:
    """(record, merged file bytes or None, merged file extension)."""
    if merge not in MERGES:
        raise ReaderError("bad_option", "merge must be none, stack or pdf.", 400)
    if front is None and back is None:
        raise ReaderError("no_file", "Send at least one side in the fields front and back.", 400)
    first, first_error = _read_side(front, cfg, languages, mode, find_document, engines)
    second, second_error = _read_side(back, cfg, languages, mode, find_document, engines)
    labelled = {"front": first, "back": second}
    flags: list[str] = []
    scores = {"front": classify(first), "back": classify(second)}
    detected = None
    if first and second:
        straight = scores["front"]["front"] + scores["back"]["back"]
        swapped = scores["front"]["back"] + scores["back"]["front"]
        if swapped > straight:
            detected = "swapped"
            flags.append("sideLabelsContradict")  # the caller's labels are kept; this is only a flag
        elif straight > swapped:
            detected = "asLabelled"
    record = {
        "sides": {k: ({"result": v} if v else {"error": err}) for (k, v), err in
                  zip(labelled.items(), (first_error, second_error))},
        "detectedSides": detected,
        "merged": merge_fields(first, second),
        "samePerson": judge(first, second),
        "flags": flags + ([] if first and second else ["sideMissingOrUnreadable"]),
        "needsHumanCheck": bool((first or {}).get("needsHumanCheck") or (second or {}).get("needsHumanCheck")
                                or not (first and second) or detected == "swapped"),
    }
    if record["samePerson"]["verdict"] != "match":
        record["needsHumanCheck"] = True  # a flag for the caller's flow; it blocks nothing by itself
    merged_bytes, ext = None, ""
    if merge != "none" and front is not None and back is not None:
        merged_bytes, ext = (stack_images(front, back), "png") if merge == "stack" else (two_page_pdf(front, back), "pdf")
    return record, merged_bytes, ext
