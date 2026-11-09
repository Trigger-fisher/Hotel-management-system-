"""Local check-in demo: shows the intake flow step by step on this PC, then a check-in form, then a report.

  READER_KEY=... [GATE_KEY=...] [SCANNER_KEY=...] python app.py [--port 8095]      then open http://127.0.0.1:8095

Steps on the page: 1 choose the ID photo, 2 virus scan (optional), 3 photo quality check (optional), 4 read the ID,
5 check-in form filled from the ID (you edit), 6 save, then /report. A single ID is read in two parts (MJ, 5 Nov 2026): one quick
read fills the form at once; the ID picture is cut, merged and compressed AFTER it, in the background, while reception types. A
value the background reading sees differently never changes the form: the field turns yellow with a "please check" line. Each service is called over HTTP and is optional except the reader;
a service that is not running is shown as "skipped". Nothing leaves this PC: the server listens on 127.0.0.1 and the photo is kept
in memory until saved. Saved data: data/checkins.jsonl and a renamed copy images/FirstName_LastName_IdName.ext. Imports nothing from other folders.

Several IDs in one photo (tick the box before choosing the photo): the reader's fast part finds every card without the model,
reads them side by side and pairs front and back per person, so the form step shows one tab per guest at once; each guest's
merged picture (front above back) follows from the reader's background part, and each guest is saved as their own check-in row
and picture. Both reads use the reader's own two parts (picture=later, then GET /v1/picture/{token}); an older reader without
them is still served the old way."""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
import uuid
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).parent
DATA, IMAGES = HERE / "data", HERE / "images"
SERVICES = {
    "scan": (os.environ.get("SCANNER_URL", "http://127.0.0.1:8081"), "/v1/scan", "X-Scanner-Key", "SCANNER_KEY"),
    "gate": (os.environ.get("GATE_URL", "http://127.0.0.1:8084"), "/v1/check", "X-Gate-Key", "GATE_KEY"),
    "read": (os.environ.get("READER_URL", "http://127.0.0.1:8083"), "/v1/read", "X-Reader-Key", "READER_KEY"),
}
UPLOADS: dict[str, dict] = {}  # token -> {name, data, read, multi, people, saved, photo}
SAVE_LOCK = threading.Lock()
ID_NAMES = {"aadhaar": "Aadhaar", "pan": "PAN", "passport": "Passport", "driving-licence": "DrivingLicence", "voter-id": "VoterID",
            "national-id": "NationalID", "visa": "Visa", "residence-permit": "ResidencePermit", "employee-card": "EmployeeCard"}
IMAGE_TYPES = {"png": (".png", "image/png"), "jpeg": (".jpg", "image/jpeg")}
# The reader's photo check outcome, in words for reception (MJ, 4 Nov 2026: clarity grade and photo check on every ID).
PHOTO_TEXT = {"match": "the ID photos match", "mismatch": "the ID photos do NOT look like the same person",
              "unclear": "photo check unclear (portrait small, blurred or glared)", "noPhoto": "no portrait found on the ID",
              "notCompared": "portrait found; no second ID photo to compare with", "unavailable": "photo check not installed on the reader"}
MISMATCH_HINT = ("Compare the guest's face with every ID before saving. Retake the photo if a portrait is glared or blurred; "
                 "otherwise ask the guest for their own ID.")
PHOTO_RETAKE = "Photo on the ID is not clear, please retake."  # MJ's rule (the reader rejects such a card)
PICTURE_WAIT = 300  # seconds a save waits for the background picture of a single ID


def post_file(step: str, name: str, data: bytes, extra: dict) -> tuple[int, dict, dict]:
    base, path, header, env = SERVICES[step]
    key = os.environ.get(env, "")
    if not key:
        return 0, {"skipped": f"{env} not set"}, {}
    b = uuid.uuid4().hex
    parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in extra.items()]
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    parts += [f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="photo{Path(name).suffix}"\r\nContent-Type: {ctype}\r\n\r\n'.encode(),
              data, f"\r\n--{b}--\r\n".encode()]
    req = urllib.request.Request(base + path, data=b"".join(parts), method="POST",
                                 headers={header: key, "Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            body = r.read()
            hdrs = dict(r.headers)
            try:
                return r.status, json.loads(body), hdrs
            except ValueError:  # scanner returns the cleaned file; only its headers matter here
                return r.status, {}, hdrs
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read()), {}
        except ValueError:
            return e.code, {"error": str(e)}, {}
    except OSError:
        return 0, {"skipped": "service is not running"}, {}


def run_step(token: str, step: str) -> dict:
    up = UPLOADS[token]
    started = time.monotonic()
    if step == "scan":
        code, body, hdrs = post_file("scan", up["name"], up["data"], {})
        if code == 0:
            out = {"status": "skipped", "detail": body["skipped"]}
        else:
            verdict = hdrs.get("X-Verdict") or body.get("verdict", "")
            out = {"status": "ok" if verdict not in ("rejected", "infected") and code < 400 else "reject",
                   "detail": f"virus scan verdict: {verdict or code}; the picture is re-saved clean ({hdrs.get('X-Scan-Engine', 'engine n/a')})"}
    elif step == "gate":
        code, body, _ = post_file("gate", up["name"], up["data"], {"profile": "multi-id" if up.get("multi") else "id-card"})
        if code == 0:
            out = {"status": "skipped", "detail": body["skipped"]}
        else:
            msgs = "; ".join(r.get("message", r.get("code", "")) for r in body.get("reasons", [])) or "no problems found"
            out = {"status": {"accept": "ok", "warn": "warn", "reject": "reject"}.get(body.get("verdict"), "warn"),
                   "detail": f"quality verdict: {body.get('verdict', code)}. {msgs}"}
    elif up.get("multi"):
        out = read_several(token, up)
    else:
        # FAST part (MJ, 5 Nov 2026): one quick read fills the form; the reader cuts, merges and compresses the picture after it
        # (picture=later, fetched by fetch_picture); an older reader without the split gets the second call (save_picture)
        code, body, _ = post_file("read", up["name"], up["data"], {"kind": "id", "mode": "fast", "findDocument": "true", "picture": "later"})
        if code == 0:
            return {"status": "reject", "detail": "The reader is not available: " + body["skipped"], "ms": 0}
        if code >= 400:
            return {"status": "reject", "detail": _error(body, code), "ms": 0}
        up["read"] = body
        up["review"] = review(body.get("clarity"), body.get("photo"), body.get("flags") or [], body.get("rejected"))
        dtype = (body.get("documentType") or {}).get("type", "unknown")
        out = {"status": "reject" if body.get("rejected") else "warn" if body.get("needsHumanCheck") else "ok",
               "detail": f"card type: {dtype}; {len(body.get('fields') or {})} fields read"
                         + ("; please check the flagged values" if body.get("needsHumanCheck") else ""),
               "prefill": prefill(body), "review": up["review"]}
        if not body.get("rejected"):
            up["picture"] = {"status": "saving", "started": time.monotonic()}
            up["picture_done"] = threading.Event()
            later = (body.get("picture") or {}).get("token")
            threading.Thread(target=fetch_picture if later else save_picture, args=(up, later) if later else (up,), daemon=True).start()
            out["picture"] = "saving"
    out["ms"] = round((time.monotonic() - started) * 1000)
    return out


def _norm(value) -> str:
    return "".join(str(value or "").split()).casefold()


def save_picture(up: dict) -> None:
    """BACKGROUND part of a single ID: the reader cuts the card, merges front and back and compresses the picture. Its reading
    never changes the form: a value it reads differently is listed (field names) and the form asks for a check."""
    try:
        code, body, _ = post_file("read", up["name"], up["data"], {"kind": "id", "mode": "fast", "multi": "true", "merge": "stack",
                                                                  "maxRegions": "2"})
        fast = {k: (v or {}).get("value") for k, v in ((up.get("read") or {}).get("fields") or {}).items()}
        people = (body.get("people") or []) if code and code < 400 else []
        mine = next((p for p in people if fast.get("documentNumber") and
                     _norm((p.get("fields") or {}).get("documentNumber", {}).get("value")) == _norm(fast["documentNumber"])), None)
        mine = mine or next((p for p in people if fast.get("name") and
                             _norm((p.get("fields") or {}).get("name", {}).get("value")) == _norm(fast["name"])), None)
        differ: list[str] = []
        if code == 0 or code >= 400:
            status, detail = "skipped", "the picture could not be prepared; the photo as taken is kept"
        elif mine is None:
            status, differ = "warn", ["card"]
            detail = "the saving step did not find the card the form was filled from; the photo as taken is kept"
        else:
            theirs = {k: (v or {}).get("value") for k, v in (mine.get("fields") or {}).items()}
            differ = [k for k in ("name", "dob", "documentNumber", "address") if k in fast and k in theirs and _norm(fast[k]) != _norm(theirs[k])]
            if len(people) > 1:
                differ.append("morePeople")
            if mine.get("image"):
                up["picture"].update(image=base64.b64decode(mine["image"]),
                                     ext=IMAGE_TYPES.get(mine.get("imageFormat", "png"), IMAGE_TYPES["png"])[0])
            kb = round(len(up["picture"].get("image") or b"") / 1024)
            status = "warn" if differ else "ok"
            detail = f"card cut, merged and compressed ({kb} KB)" + (f"; read differently: {', '.join(differ)} - please check" if differ else "")
        up["picture"].update(status=status, detail=detail, differ=differ,
                             ms=round((time.monotonic() - up["picture"]["started"]) * 1000))
    except Exception:  # noqa: BLE001 - the form stays; the photo as taken is kept
        up["picture"].update(status="skipped", detail="the picture could not be prepared; the photo as taken is kept", differ=[])
    finally:
        up["picture_done"].set()


def get_json(path: str, timeout: float) -> tuple[int, dict]:
    base, _, header, env = SERVICES["read"]
    req = urllib.request.Request(base + path, headers={header: os.environ.get(env, "")})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except ValueError:
            return e.code, {}
    except (OSError, ValueError):
        return 0, {}


def differ_of(disagreements: list) -> list[str]:
    """What the reader's background part saw differently, as field names and plain codes (never a value)."""
    words = {"unmatched": "card", "people": "morePeople"}
    return list(dict.fromkeys(d.get("field") if d.get("code") == "field" else words.get(d.get("code"), d.get("code"))
                              for d in disagreements or [] if d.get("code")))


def fetch_picture(up: dict, token: str) -> None:
    """BACKGROUND part from the reader's own split (5 Nov 2026): wait for GET /v1/picture/{token}. It never changes the form: a
    value read differently is listed (field names) and the form asks for a check; a card it cannot match keeps the photo as taken."""
    try:
        deadline, code, body = time.monotonic() + PICTURE_WAIT, 0, {}
        while time.monotonic() < deadline:
            code, body = get_json(f"/v1/picture/{token}?wait=60", 90)
            if code != 200 or body.get("status") != "saving":
                break
        if code != 200 or body.get("status") != "done":
            up["picture"].update(status="skipped", detail="the picture could not be prepared; the photo as taken is kept", differ=[])
        elif up.get("multi"):
            sheet_pictures(up, body)
        else:
            person = (body.get("people") or [{}])[0]
            differ = differ_of(person.get("disagreements"))
            if person.get("image"):
                up["picture"].update(image=base64.b64decode(person["image"]),
                                     ext=IMAGE_TYPES.get(person.get("imageFormat") or "png", IMAGE_TYPES["png"])[0])
            kb = round(len(up["picture"].get("image") or b"") / 1024)
            if "card" in differ:
                detail = "the saving step did not find the card the form was filled from; the photo as taken is kept"
            else:
                detail = f"card cut, merged and compressed ({kb} KB)" + (f"; read differently: {', '.join(differ)} - please check" if differ else "")
            up["picture"].update(status="warn" if differ else "ok", detail=detail, differ=differ)
    except Exception:  # noqa: BLE001 - the form stays; the photo as taken is kept
        up["picture"].update(status="skipped", detail="the picture could not be prepared; the photo as taken is kept", differ=[])
    finally:
        up["picture"]["ms"] = round((time.monotonic() - up["picture"]["started"]) * 1000)
        up["picture_done"].set()


def sheet_pictures(up: dict, body: dict) -> None:
    """Each guest of a several-ID photo gets the reader's picture; a guest only the background found becomes a new tab to check."""
    saved, flagged, extra = 0, 0, 0
    for item in body.get("people") or []:
        differ = differ_of(item.get("disagreements"))
        if item.get("backgroundOnly"):
            entry = person_entry({**item, "flags": ["backgroundOnly"], "needsHumanCheck": True, "evidence": "none"})
            entry["differ"] = differ
            up["people"].append(entry)
            extra += 1
            continue
        index = int(item.get("personId") or 0) - 1
        if not 0 <= index < len(up["people"]):
            continue
        person = up["people"][index]
        if item.get("image"):
            person["image"] = base64.b64decode(item["image"])
            person["ext"] = IMAGE_TYPES.get(item.get("imageFormat") or "png", IMAGE_TYPES["png"])[0]
            saved += 1
        person["differ"] = differ
        if differ:
            person["needsHumanCheck"] = True
            flagged += 1
    detail = f"{saved} pictures cut, merged and compressed" + (f"; {flagged} read differently - please check" if flagged else "") \
        + (f"; {extra} more guest(s) found - please check" if extra else "")
    up["picture"].update(status="warn" if flagged or extra else "ok", detail=detail, differ=[])


def people_view(token: str, up: dict) -> list[dict]:
    """The guests as the page's tabs draw them."""
    return [{**p["prefill"], "label": p["label"], "image": f"/api/image?token={token}&person={i}" if p["image"] else "",
             "evidence": p["evidence"], "flags": p["flags"], "check": p["needsHumanCheck"], "review": p["review"],
             "differ": p.get("differ") or []}
            for i, p in enumerate(up["people"])]


def picture_state(token: str) -> dict:
    up = UPLOADS.get(token) or {}
    pic = up.get("picture")
    if not pic:
        return {"status": "none"}
    out = {k: pic.get(k) for k in ("status", "detail", "differ", "ms") if pic.get(k) is not None}
    if pic.get("image"):
        out["image"] = f"/api/image?token={token}&picture=1"
    if up.get("multi") and pic.get("status") != "saving":
        out["people"] = people_view(token, up)
    return out


def _error(body: dict, code: int) -> str:
    err = body.get("error")
    return str((err.get("message") if isinstance(err, dict) else err) or body.get("message") or code)


def read_several(token: str, up: dict) -> dict:
    """One photo, several IDs: one person per guest, each with merged fields. The reader's fast part answers first (every card
    found without the model, read side by side, grouped); each guest's merged picture (front above back) follows from its
    background part. An older reader without the split answers both at once (merge=stack)."""
    code, body, _ = post_file("read", up["name"], up["data"], {"kind": "id", "mode": "fast", "multi": "true", "merge": "stack",
                                                              "maxRegions": "12", "picture": "later"})
    if code == 0:
        return {"status": "reject", "detail": "The reader is not available: " + body["skipped"]}
    if code >= 400:
        return {"status": "reject", "detail": _error(body, code)}
    up["read"] = body
    up["people"] = [person_entry(p) for p in body.get("people") or []]
    up["saved"] = set()
    if not up["people"]:
        return {"status": "reject", "detail": f"No readable ID card was found ({body.get('cards', 0)} cards cut). "
                                              "Photograph the IDs in smaller groups."}
    checks = sum(p["needsHumanCheck"] for p in up["people"])
    rejected = sum(bool(p["rejected"]) for p in up["people"])
    detail = (f"{body.get('cards', 0)} cards cut, {len(up['people'])} guests "
              f"({sum(len(p['regions']) == 2 for p in up['people'])} with front and back merged)"
              + (f"; {checks} need a check" if checks else "")
              + (f"; {rejected} rejected (photo on the ID not clear)" if rejected else ""))
    out = {"status": "warn" if checks or body.get("needsHumanCheck") else "ok", "detail": detail, "people": people_view(token, up)}
    later = (body.get("picture") or {}).get("token")
    if later:
        up["picture"] = {"status": "saving", "started": time.monotonic()}
        up["picture_done"] = threading.Event()
        threading.Thread(target=fetch_picture, args=(up, later), daemon=True).start()
        out["picture"] = "saving"
    return out


def review(clarity: dict | None, photo: dict | None, flags: list, rejected: dict | None = None) -> dict:
    """What the guest's form shows of the reader's clarity grade and photo check: level 'mismatch' (red: the ID photos do not
    match), 'unclear' (yellow: a card or a key field is unclear) or 'ok', the grade, the reasons, the photo outcome and a retake hint.
    Works for a person of a several-ID photo (clarity.cards) and for a single ID (clarity.reasons); an older reader without
    these blocks gives an empty review."""
    clarity, photo = clarity or {}, photo or {}
    if clarity.get("cards"):
        reasons = [f"{c.get('side', 'card')}: {r}" if len(clarity["cards"]) > 1 else r
                   for c in clarity["cards"] for r in c.get("reasons") or []]
    else:
        reasons = list(clarity.get("reasons") or [])
    outcome = photo.get("outcome") or ""
    grade = clarity.get("grade") or ""
    unclear_fields = list(clarity.get("unclearFields") or [])
    retake = clarity.get("advice") or ""
    if rejected:  # MJ's rule: an unclear ID photo rejects the card; it cannot be saved until the guest's ID is photographed again
        reasons = list(dict.fromkeys([str(c.get("reason")) for c in rejected.get("cards") or [] if c.get("reason")]
                                     + ([rejected["reason"]] if rejected.get("reason") else []) + reasons))
        return {"level": "rejected", "grade": grade or "unclear", "reasons": reasons, "unclearFields": unclear_fields,
                "photo": outcome, "photoText": PHOTO_TEXT.get(outcome, ""), "retake": rejected.get("message") or PHOTO_RETAKE}
    if outcome == "mismatch" or "photoMismatch" in flags:
        outcome, level = "mismatch", "mismatch"
        retake = (retake + " " if retake else "") + MISMATCH_HINT
    elif grade == "unclear" or unclear_fields or "keyFieldUnclear" in flags:
        level = "unclear"
        retake = retake or "Retake this card: hold it flat, in even light, filling most of the picture."
    else:
        level = "ok" if grade or outcome else ""
    return {"level": level, "grade": grade, "reasons": reasons, "unclearFields": unclear_fields, "photo": outcome,
            "photoText": PHOTO_TEXT.get(outcome, ""), "retake": retake}


def person_entry(p: dict) -> dict:
    """What the demo keeps of one person from the reader's answer."""
    fields = p.get("fields") or {}
    dtype = (p.get("documentType") or {}).get("type", "unknown")
    pre = prefill_fields(fields, dtype, p.get("doubtfulFields") or [])
    ext = IMAGE_TYPES.get(p.get("imageFormat", "png"), IMAGE_TYPES["png"])[0]
    name = " ".join(x for x in (pre["firstName"], pre["lastName"]) if x) or "Unknown guest"
    return {"prefill": pre, "label": name, "image": base64.b64decode(p["image"]) if p.get("image") else b"", "ext": ext,
            "type": dtype, "fields": {k: v.get("value") for k, v in fields.items()}, "evidence": p.get("evidence", "none"),
            "regions": list(p.get("regions") or []), "flags": list(p.get("flags") or []),
            "needsHumanCheck": bool(p.get("needsHumanCheck")), "suggestedName": p.get("suggestedName", ""),
            "rare": bool(p.get("rare")), "rejected": p.get("rejected"),
            "review": review(p.get("clarity"), p.get("photo"), list(p.get("flags") or []), p.get("rejected"))}


def prefill_fields(fields: dict, dtype: str, doubtful: list) -> dict:
    f = {k: (v.get("value", "") if isinstance(v, dict) else v) or "" for k, v in fields.items()}
    words = str(f.get("name") or "").split()
    return {"firstName": words[0] if words else "", "lastName": " ".join(words[1:]) if len(words) > 1 else "", "dob": f.get("dob", ""),
            "idType": dtype, "idNumber": f.get("documentNumber", ""), "address": f.get("address", ""), "doubtful": list(doubtful)}


def prefill(read: dict) -> dict:
    return prefill_fields(read.get("fields") or {}, (read.get("documentType") or {}).get("type", "unknown"), read.get("doubtfulFields") or [])


def clean(s: str) -> str:
    return "".join(c for c in s if c.isalnum())


def image_stem(form: dict, rare: bool = False) -> str:
    """FirstName_LastName_IdName (the last word of the last name); "_Rare" at the end for MJ's RARE namesakes (no warning shown)."""
    last = form.get("lastName", "").split()
    stem = (f"{clean(form.get('firstName', '')) or 'Unknown'}_{clean(last[-1]) if last else 'Unknown'}_"
            f"{ID_NAMES.get(form.get('idType'), 'Document')}")
    return stem + "_Rare" if rare else stem


def save_checkin(body: dict) -> dict:
    """One save at a time (the server is threaded): a double click can never write a guest twice. A single ID's picture is
    still being prepared in the background when reception is quick: the save waits for it (the form is never held up)."""
    done = (UPLOADS.get(body.get("token")) or {}).get("picture_done")
    if done is not None:
        done.wait(PICTURE_WAIT)
    with SAVE_LOCK:
        return _save_checkin(body)


def _save_checkin(body: dict) -> dict:
    up = UPLOADS.get(body.get("token"))
    if up is None:  # the photo was saved already (its last guest too) or never uploaded: never a second row without the ID
        return {"saved": False, "error": "this photo is already saved; choose the ID photo again"}
    DATA.mkdir(exist_ok=True)
    form = body["form"]
    person, index = None, body.get("person")
    if up and index is not None and up.get("people"):
        index = int(index)
        if not 0 <= index < len(up["people"]):
            return {"saved": False, "error": "no such guest in this photo"}
        if index in up["saved"]:
            return {"saved": False, "error": "this guest is already saved"}
        person = up["people"][index]
    rejected = person.get("rejected") if person else ((up or {}).get("read") or {}).get("rejected")
    if rejected:  # MJ's rule: an unclear ID photo rejects the card; nothing is saved until the ID is photographed again
        return {"saved": False, "error": rejected.get("message") or PHOTO_RETAKE}
    exported = ""
    pic = (up or {}).get("picture") or {}
    if up:
        data, ext = (person["image"], person["ext"]) if person and person["image"] else \
            (pic["image"], pic["ext"]) if not person and pic.get("image") else (up["data"], Path(up["name"]).suffix.lower() or ".jpg")
        IMAGES.mkdir(exist_ok=True)
        stem = image_stem(form, bool(person and person.get("rare")))
        target, n = IMAGES / f"{stem}{ext}", 2
        while any(p.stem.lower() == target.stem.lower() for p in IMAGES.iterdir()):  # Windows ignores case; .png and .jpg share a name
            target, n = IMAGES / f"{stem}_{n}{ext}", n + 1
        target.write_bytes(data)
        exported = target.name
    if person:
        reader = {"type": person["type"], "fields": person["fields"], "needsHumanCheck": person["needsHumanCheck"]}
        if person.get("differ"):  # what the background part saw differently: field names only
            reader["picture"] = {"differ": person["differ"]}
        origin = {"photo": up["photo"], "index": index + 1, "of": len(up["people"]), "evidence": person["evidence"],
                  "cards": len(person["regions"]), "flags": person["flags"]}
    else:
        read = (up or {}).get("read") or {}
        reader = {"type": (read.get("documentType") or {}).get("type"), "fields": {k: v.get("value") for k, v in (read.get("fields") or {}).items()},
                  "needsHumanCheck": bool(read.get("needsHumanCheck") or pic.get("differ"))}
        if pic.get("status"):  # what the background part saw differently: field names only
            reader["picture"] = {"status": pic["status"], "differ": pic.get("differ") or []}
        origin = None
    seen = person["review"] if person else (up or {}).get("review")
    if seen and seen.get("level"):  # grade, photo outcome and reasons only (never a score list or an embedding)
        reader["review"] = {k: seen[k] for k in ("level", "grade", "photo", "reasons")}
    rec = {"id": secrets.token_hex(4), "savedAt": time.strftime("%Y-%m-%d %H:%M:%S"), "form": form, "image": exported, "reader": reader}
    if origin:
        rec["person"] = origin
    with open(DATA / "checkins.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    if person:
        up["saved"].add(index)
        if len(up["saved"]) < len(up["people"]):
            return {"saved": True, "id": rec["id"], "image": exported, "remaining": len(up["people"]) - len(up["saved"])}
    UPLOADS.pop(body["token"], None)
    return {"saved": True, "id": rec["id"], "image": exported, "remaining": 0}


def _rows() -> list[dict]:
    p = DATA / "checkins.jsonl"
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def source_text(r: dict) -> str:
    """Where the row came from: a single ID photo, or guest i of n from one photo of several IDs."""
    p = r.get("person")
    if not p:
        return "single ID photo"
    how = "front + back" if p.get("cards") == 2 else "one card"
    return f"guest {p['index']} of {p['of']} in one photo ({how}, {p.get('evidence', 'none')})"


def review_text(r: dict) -> str:
    """The saved clarity grade and photo outcome of a row, in one line ('' for rows saved before the check existed)."""
    seen = (r.get("reader") or {}).get("review") or {}
    parts = ([f"clarity {seen['grade']}"] if seen.get("grade") else []) + ([f"photo {seen['photo']}"] if seen.get("photo") else [])
    return ", ".join(parts)


def report_html() -> str:
    rows = _rows()
    changed = total = several = 0
    body = []
    for r in rows:
        f, rd = r["form"], r["reader"]["fields"]
        edits = [k for k, a, b in (("name", f"{f.get('firstName', '')} {f.get('lastName', '')}".strip(), rd.get("name", "")), ("dob", f.get("dob", ""), rd.get("dob", "")),
                                   ("idNumber", f.get("idNumber", ""), rd.get("documentNumber", "")), ("address", f.get("address", ""), rd.get("address", "")))
                 if rd.get(k if k != "idNumber" else "documentNumber") is not None and a.strip() != (b or "").strip()]
        total += 1
        changed += bool(edits)
        several += "person" in r
        flags = ", ".join(x for x in ((r.get("person") or {}).get("flags") or []) + [review_text(r)] if x)
        body.append(f"<tr><td>{escape(r['savedAt'])}</td><td>{escape(f.get('firstName', ''))} {escape(f.get('lastName', ''))}</td><td>{escape(f.get('idType', ''))}</td>"
                    f"<td>{escape(f.get('idNumber', ''))}</td><td>{escape(f.get('dob', ''))}</td><td>{escape(f.get('room', ''))}</td><td>{escape(f.get('nights', ''))}</td>"
                    f"<td>{escape(f.get('phone', ''))}</td><td>{escape(r['image'])}</td><td>{escape(source_text(r))}{'<br><small>' + escape(flags) + '</small>' if flags else ''}</td>"
                    f"<td>{'edited: ' + ', '.join(edits) if edits else 'as read'}</td></tr>")
    return ("<!doctype html><meta charset=utf-8><title>Check-in report</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%}"
            "td,th{border:1px solid #ccc;padding:6px;text-align:left}th{background:#262626;color:#f6d878}small{color:#666}</style><h1>Check-in report</h1>"
            f"<p>{total} check-ins &middot; {several} from photos with several IDs &middot; {total - changed} filled from the ID with no edits &middot; {changed} needed a correction. "
            "<a href=/report.csv>Download CSV</a> (opens in Excel) &middot; <a href=/>New check-in</a></p><table><tr><th>Saved</th><th>Guest</th><th>ID type</th><th>ID number</th>"
            "<th>Date of birth</th><th>Room</th><th>Nights</th><th>Phone</th><th>Image file</th><th>From</th><th>Reader result</th></tr>" + "".join(body) + "</table>")


def report_csv() -> bytes:
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["saved", "first name", "last name", "id type", "id number", "date of birth", "address", "phone", "email", "room", "nights", "check-in date",
                "image", "from", "evidence", "clarity", "photo check"])
    for r in _rows():
        f = r["form"]
        seen = (r.get("reader") or {}).get("review") or {}
        w.writerow([r["savedAt"], f.get("firstName"), f.get("lastName"), f.get("idType"), f.get("idNumber"), f.get("dob"), f.get("address"), f.get("phone"),
                    f.get("email"), f.get("room"), f.get("nights"), f.get("checkin"), r["image"], source_text(r), (r.get("person") or {}).get("evidence", ""),
                    seen.get("grade", ""), seen.get("photo", "")])
    return ("﻿" + buf.getvalue()).encode("utf-8")


PAGE = r"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Check-in demo</title>
<style>body{margin:0;font:15px system-ui;background:#f4f1ea;color:#222}header{background:#262626;color:#f6d878;padding:12px 20px;display:flex;justify-content:space-between}
main{max-width:980px;margin:18px auto;padding:0 16px;display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){main{grid-template-columns:1fr}}
.card{background:#fff;border-radius:10px;padding:16px}h2{margin:0 0 10px;font-size:16px}.step{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #eee}
.dot{width:22px;height:22px;border-radius:50%;background:#ccc;flex:none;text-align:center;color:#fff;font-size:13px;line-height:22px}
.ok .dot{background:#2e9e4f}.warn .dot{background:#d99a00}.reject .dot{background:#c0392b}.skipped .dot{background:#999}.run .dot{background:#2b6cb0}
.small{color:#666;font-size:13px}label{display:block;margin:8px 0 2px;font-size:13px;color:#555}input,select,textarea{width:100%;padding:7px;box-sizing:border-box;font:inherit}
input.doubt,textarea.doubt{background:#fff3cd}button{padding:10px 18px;border:0;border-radius:6px;background:#262626;color:#f6d878;font:inherit;cursor:pointer;margin-top:12px}button:disabled{opacity:.5;cursor:default}
img{max-width:100%;border-radius:6px;margin-top:10px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}label.inline{display:flex;gap:8px;align-items:center;margin-top:10px}label.inline input{width:auto}
#tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}#tabs button{margin:0;padding:6px 10px;background:#eee;color:#222;font-size:13px}#tabs button.on{background:#262626;color:#f6d878}
#tabs button.done::after{content:" \2713";color:#2e9e4f}#tabs button.check::before{content:"! ";color:#d99a00}#tabs button.bad::before{content:"\00d7 ";color:#c0392b}
.seen{margin:10px 0 4px;padding:8px 10px;border-radius:6px;font-size:13px;border:1px solid #cfe3d5;background:#eef7f0}.seen.unclear{background:#fff3cd;border-color:#d99a00}
.seen.mismatch,.seen.rejected{background:#fde2e1;border-color:#c0392b}.seen ul{margin:4px 0;padding-left:18px}.seen .retake{margin-top:4px;font-weight:600}</style>
<header><b>Guest check-in (local demo)</b><a style="color:#f6d878" href=/report target=_blank>Report</a></header>
<main><div class=card><h2>1. Choose the ID photo</h2><label class=inline><input type=checkbox id=multi> This photo holds several IDs (front and back of each guest)</label>
<input type=file id=file accept="image/*" style="margin-top:8px"><img id=pv hidden>
<p class=small>Offline: the photo stays on this PC.</p><h2 style="margin-top:16px">What the system does</h2><div id=steps></div></div>
<div class=card id=formcard><h2>5. Check-in form</h2><p class=small id=hint>Fills in after the ID is read. Yellow = please check (unclear picture or value). Red = the ID photos do not match.</p>
<div id=tabs hidden></div><div id=seen class=seen hidden role=status></div><img id=mpv hidden alt="Merged ID picture: front above back">
<div class=row><div><label>First name</label><input id=firstName></div><div><label>Last name</label><input id=lastName></div></div>
<div class=row><div><label>Date of birth</label><input id=dob placeholder=YYYY-MM-DD></div><div><label>ID type</label><select id=idType></select></div></div>
<label>ID number</label><input id=idNumber><label>Address</label><textarea id=address rows=2></textarea>
<div class=row><div><label>Phone</label><input id=phone></div><div><label>Email</label><input id=email></div></div>
<div class=row><div><label>Room</label><input id=room></div><div><label>Nights</label><input id=nights type=number value=1 min=1></div></div>
<label>Check-in date</label><input id=checkin type=date><button id=save disabled>6. Save check-in</button> <span id=msg class=small></span></div></main>
<script>
const $=id=>document.getElementById(id),TYPES=%TYPES%;let token=null,people=null,current=-1;
const FIELDS=['firstName','lastName','dob','idType','idNumber','address','phone','email','room','nights','checkin'],READ=['firstName','lastName','dob','idNumber','address'];
const DOUBT={firstName:'name',lastName:'name',dob:'dob',idNumber:'documentNumber',address:'address'};
$('idType').innerHTML=TYPES.concat(['unknown']).map(t=>`<option>${t}</option>`).join('');const today=new Date().toISOString().slice(0,10);$('checkin').value=today;
const STEPS=[['scan','2. Virus scan and clean re-save'],['gate','3. Photo quality check'],['read','4. Read the ID']];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function draw(state){$('steps').innerHTML=STEPS.concat(state.picture?[['picture','After the form: cut, merge and save the ID picture']]:[]).map(([k,t])=>{const s=state[k]||{status:'wait'};return `<div class="step ${s.status}"><span class=dot>${{ok:'✓',warn:'!',reject:'×',skipped:'-',run:'…',wait:''}[s.status]||''}</span><div><b>${t}</b><div class=small>${esc(s.detail||'')} ${s.ms!=null?'('+s.ms+' ms)':''}</div></div></div>`}).join('')}
function fill(p){for(const id of READ){$(id).value=p[id]||'';$(id).classList.toggle('doubt',(p.doubtful||[]).includes(DOUBT[id]))}$('idType').value=TYPES.includes(p.idType)?p.idType:'unknown'}
function seen(r){const el=$('seen');if(!r||!r.level){el.hidden=true;el.innerHTML='';return}el.hidden=false;el.className='seen '+r.level;
const head=r.level==='rejected'?'Rejected: photo on the ID is not clear':r.level==='mismatch'?'Photo mismatch: check this guest in person':r.level==='unclear'?'ID picture unclear: please check':'ID picture clear';
el.innerHTML='<b>'+head+'</b><div>Clarity: '+esc(r.grade||'not graded')+(r.unclearFields&&r.unclearFields.length?' (unclear: '+esc(r.unclearFields.join(', '))+')':'')+'</div>'
+(r.reasons&&r.reasons.length?'<ul>'+r.reasons.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')
+(r.photoText?'<div>Photo check: '+esc(r.photoText)+'</div>':'')+(r.retake&&r.level!=='ok'?'<div class=retake>'+esc(r.retake)+'</div>':'')}
function values(){const v={};for(const id of FIELDS)v[id]=$(id).value;return v}
function setValues(v){for(const id of FIELDS)$(id).value=v[id]??''}
function tabs(){$('tabs').innerHTML=people.map((p,i)=>`<button type=button class="${i===current?'on':''} ${p.saved?'done':''} ${['mismatch','rejected'].includes((p.review||{}).level)?'bad':p.check?'check':''}" data-i=${i}>${i+1}. ${esc(p.label)}</button>`).join('');
for(const b of $('tabs').querySelectorAll('button'))b.onclick=()=>show(+b.dataset.i)}
function show(i){if(current>=0&&!people[current].saved)people[current].values=values();current=i;const p=people[i];
if(p.values)setValues(p.values);else{setValues({nights:'1',checkin:today});fill(p)}
for(const id of READ)$(id).classList.toggle('doubt',(p.doubtful||[]).includes(DOUBT[id])||(p.differ||[]).includes(DOUBT[id]));
seen(p.review);if(p.differ&&p.differ.length){const el=$('seen');el.hidden=false;if(!el.classList.contains('mismatch')&&!el.classList.contains('rejected'))el.className='seen unclear';
 el.innerHTML+='<div class=retake>The saved picture was read differently ('+esc(p.differ.join(', '))+'): please check these values.</div>'}$('mpv').hidden=!p.image;if(p.image)$('mpv').src=p.image;$('save').disabled=!!p.saved;$('save').textContent=p.saved?'Saved':'6. Save guest '+(i+1);
$('hint').textContent=(p.check?'Please check this guest (flags: '+(p.flags.join(', ')||'doubtful values')+'). ':'')+'Filled from '+(p.evidence==='none'?'one card':'the merged front and back ('+p.evidence+')')+'. Add phone, room and nights.';tabs()}
draw({});
$('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;$('pv').src=URL.createObjectURL(f);$('pv').hidden=false;$('save').disabled=true;$('msg').textContent='';
people=null;current=-1;$('tabs').hidden=true;$('mpv').hidden=true;seen(null);$('save').textContent='6. Save check-in';
const state={};draw(state);const r=await fetch('/api/upload?multi='+($('multi').checked?1:0)+'&name='+encodeURIComponent(f.name),{method:'POST',body:f});token=(await r.json()).token;
for(const [k] of STEPS){state[k]={status:'run',detail:'working...'};draw(state);const s=await (await fetch('/api/step?token='+token+'&step='+k,{method:'POST'})).json();state[k]=s;draw(state);
if(s.status==='reject'&&k!=='gate'){return}
if(k==='read'&&s.people){people=s.people;$('tabs').hidden=false;show(0);
 if(s.picture){state.picture={status:'run',detail:'saving in the background: the forms are ready to use'};draw(state);watchSheet(token,state)}}
else if(k==='read'&&s.prefill){fill(s.prefill);seen(s.review);$('hint').textContent='Filled from the ID. Check the values, add phone, room and nights.';$('save').disabled=false;
 if(s.picture){state.picture={status:'run',detail:'saving in the background: the form is ready to use'};draw(state);watch(token,state)}}}};
async function watch(t,state){for(;;){await new Promise(r=>setTimeout(r,700));if(t!==token)return;
 const p=await (await fetch('/api/picture?token='+t)).json();if(p.status==='saving')continue;if(p.status==='none')return;
 state.picture={status:{ok:'ok',warn:'warn'}[p.status]||'skipped',detail:p.detail||'',ms:p.ms};draw(state);
 if(p.image){$('mpv').src=p.image;$('mpv').hidden=false}
 if(p.differ&&p.differ.length){for(const id of READ)if(p.differ.includes(DOUBT[id]))$(id).classList.add('doubt');
  const el=$('seen');el.hidden=false;if(!el.classList.contains('mismatch')&&!el.classList.contains('rejected'))el.className='seen unclear';
  el.innerHTML+='<div class=retake>The saved picture was read differently ('+esc(p.differ.join(', '))+'): please check these values.</div>'}
 return}}
async function watchSheet(t,state){for(;;){await new Promise(r=>setTimeout(r,700));if(t!==token)return;
 const p=await (await fetch('/api/picture?token='+t)).json();if(p.status==='saving')continue;if(p.status==='none')return;
 state.picture={status:{ok:'ok',warn:'warn'}[p.status]||'skipped',detail:p.detail||'',ms:p.ms};draw(state);
 (p.people||[]).forEach((q,i)=>{if(i<people.length){Object.assign(people[i],{image:q.image,differ:q.differ,check:q.check,flags:q.flags})}else people.push(q)});
 tabs();if(current>=0)show(current);return}}
$('save').onclick=async()=>{const form=values();const body={token,form};if(people)body.person=current;$('msg').textContent='Saving...';
const r=await (await fetch('/api/save',{method:'POST',body:JSON.stringify(body)})).json();
if(!r.saved){$('msg').textContent=r.error||'Not saved';return}
$('msg').innerHTML='Saved. Image: '+esc(r.image||'-')+' &middot; <a href=/report target=_blank>open report</a>';$('save').disabled=true;
if(people){people[current].saved=true;people[current].values=form;const next=people.findIndex(p=>!p.saved);if(next>=0){show(next);$('msg').innerHTML+=' &middot; '+r.remaining+' guest(s) left'}else{tabs();$('save').textContent='All guests saved'}}}
</script>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/":
            self.send(200, PAGE.replace("%TYPES%", json.dumps(list(ID_NAMES))).encode(), "text/html; charset=utf-8")
        elif u.path == "/report":
            self.send(200, report_html().encode(), "text/html; charset=utf-8")
        elif u.path == "/report.csv":
            self.send(200, report_csv(), "text/csv; charset=utf-8")
        elif u.path == "/api/picture":
            self.send(200, json.dumps(picture_state(q.get("token", [""])[0])).encode())
        elif u.path == "/api/image":
            up = UPLOADS.get(q.get("token", [""])[0]) or {}
            people = up.get("people") or []
            i = q.get("person", [""])[0]
            pic = up.get("picture") or {}
            if q.get("picture") and pic.get("image"):
                self.send(200, pic["image"], "image/jpeg" if pic["ext"] == ".jpg" else "image/png")
            elif i.isdigit() and int(i) < len(people) and people[int(i)]["image"]:
                p = people[int(i)]
                self.send(200, p["image"], "image/jpeg" if p["ext"] == ".jpg" else "image/png")
            else:
                self.send(404, b"not found", "text/plain")
        else:
            self.send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if u.path == "/api/upload":
            token = secrets.token_hex(8)
            UPLOADS[token] = {"name": q.get("name", ["photo.jpg"])[0], "data": raw, "read": None, "multi": q.get("multi", ["0"])[0] == "1",
                              "people": [], "saved": set(), "photo": secrets.token_hex(4)}
            self.send(200, json.dumps({"token": token}).encode())
        elif u.path == "/api/step" and q.get("token", [""])[0] in UPLOADS and q.get("step", [""])[0] in SERVICES:
            self.send(200, json.dumps(run_step(q["token"][0], q["step"][0])).encode())
        elif u.path == "/api/save":
            self.send(200, json.dumps(save_checkin(json.loads(raw))).encode())
        else:
            self.send(404, b"{}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8095)
    a = ap.parse_args()
    print(f"Open http://127.0.0.1:{a.port}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
