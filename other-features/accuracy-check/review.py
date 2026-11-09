"""Live review form: the photo on the left; on the right every CARD the reader cut (its crop, side, type, clarity grade and
reasons, photo status, refused or not, its fields) and every PERSON it formed (cards paired, pairing evidence, pairedByPosition,
rare, photo outcome).

  .venv\\Scripts\\python.exe review.py --photos D:\\HMS-training-data\\sample [--port 8090]
  then open http://127.0.0.1:8090

Fix a field (or tick "not on card"); fix a card's side, clarity grade or "should be refused"; fix a person's cards, rare or photo
outcome; press Save & Next. Untouched values count as right. Each photo is saved as a label in labels.jsonl (version 2: fields
with their card number, cards, people; version-1 lines are still read) and results.xlsx is rewritten with the sheets Fields,
Cards, People and Summary (OCR, mapping, pairing, rejection, clarity, photo outcome and rare accuracy). Runs only on this PC
(127.0.0.1); photos are read-only and never copied; card crops stay in memory. Needs the reader running (READER_URL,
READER_KEY); asks it for the multi-card answer (multi=true, returnCrops=true) and also works with a reader that answers one
document or has no clarity / photo / rare fields yet (those show as "not reported" and stay out of the accuracy).
Uses check.py in this folder for the reader call and the scoring."""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import mimetypes
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import check

IMG = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
TYPES = ["aadhaar", "pan", "passport", "driving-licence", "voter-id", "national-id", "visa", "oci", "pio", "residence-permit",
         "employee-card", "unknown"]
LOCK = threading.Lock()
S = {"photos": [], "labels": {}, "cache": {}, "crops": {}, "deferred": set(), "labels_path": Path("labels.jsonl"),
     "xlsx": Path("results.xlsx")}
COLOURS = {"right": "C6EFCE", "ocr_wrong": "FFC7CE", "mapping_wrong": "FFEB9C", "missing": "FFC7CE", "invented": "FFEB9C",
           "wrong": "FFC7CE", "n/a": "EDEDED"}


def load_labels() -> None:
    p = S["labels_path"]
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rec = check.upgrade(json.loads(line))
                S["labels"][rec["photo"]] = rec


def reader_result(i: int) -> dict:
    """The reader's answer for photo i as {multi, cards, people} (crops kept in memory, served by /crop)."""
    photo = S["photos"][i]
    if photo.name not in S["cache"]:
        try:
            res = check.call_reader(photo, os.environ.get("READER_URL", "http://127.0.0.1:8083"), os.environ.get("READER_KEY", ""), crops=True)
            parsed = check.parse_response(res)
        except Exception as exc:  # noqa: BLE001 - the type only: a message could carry a file name
            return {"multi": False, "cards": [], "people": [], "error": f"Reader call failed ({type(exc).__name__})."}
        for c in parsed["cards"]:
            crop = c.pop("crop", None)
            if crop:
                try:
                    S["crops"][(photo.name, c["card"])] = base64.b64decode(crop)
                except (binascii.Error, ValueError):
                    pass
            c["hasCrop"] = (photo.name, c["card"]) in S["crops"]
        S["cache"][photo.name] = parsed
    return S["cache"][photo.name]


def view_from_reader(parsed: dict) -> dict:
    """The form's starting values: the reader's own answer (MJ changes only what is wrong)."""
    cards = []
    for c in parsed["cards"]:
        cards.append({"card": c["card"], "side": c["side"], "expectedSide": c["side"], "detectedType": c["type"],
                      "expectedType": c["type"] if c["type"] in TYPES else "", "clarity": c["clarity"], "clarityReasons": c["clarityReasons"],
                      "retake": c["retake"], "expectedClarity": c["clarity"] or "", "photoStatus": c["photo"], "rejected": c["rejected"],
                      "rejectReason": c["rejectReason"], "expectedRejected": bool(c["rejected"]), "flags": c["flags"],
                      "hasCrop": c.get("hasCrop", False),
                      "fields": [{"field": f["field"], "extracted": f["value"], "final": f["value"], "notOnCard": False,
                                  "confidence": f["confidence"], "flag": f["flag"], "extra": False} for f in c["fields"]]})
    people = [{**p, "expectedCards": "+".join(map(str, p["cards"])), "expectedRare": bool(p["rare"]),
               "expectedPhotoOutcome": p["photoOutcome"] or ""} for p in parsed["people"]]
    return {"multi": parsed["multi"], "cards": cards, "people": people}


def view_from_label(rec: dict) -> dict:
    cards = []
    for c in rec.get("cards", []):
        cards.append({**c, "hasCrop": (rec["photo"], c["card"]) in S["crops"],
                      "fields": [f for f in rec.get("fields", []) if (f.get("card") or 1) == c["card"]]})
    return {"multi": rec.get("multi", False), "cards": cards, "people": rec.get("people", [])}


def verdicts(rec: dict) -> list[dict]:
    """Kept for callers of the old form: field verdicts of one record."""
    return check.field_verdicts(rec.get("fields", []))


def _style(ws, col: int, verdict: str) -> None:
    from openpyxl.styles import PatternFill
    ws.cell(ws.max_row, col).fill = PatternFill("solid", fgColor=COLOURS.get(verdict, "FFFFFF"))


def _yn(v) -> str:
    return "not reported" if v is None else ("yes" if v else "no")


def _pct(s: dict):
    return "n/a" if s["pct"] is None else s["pct"]


def write_xlsx() -> dict:
    from openpyxl import Workbook
    from openpyxl.styles import Font
    labels = list(S["labels"].values())
    st = check.summarise(labels)
    wb = Workbook()
    ws = wb.active
    ws.title = "Fields"
    ws.append(["photo", "card", "expected type", "detected type", "field", "extracted", "correct value", "confidence", "flags", "verdict"])
    for rec in labels:
        types = {c["card"]: c for c in rec.get("cards", [])}
        for v in check.field_verdicts(rec.get("fields", [])):
            c = types.get(v["card"], {})
            ws.append([rec["photo"], v["card"], c.get("expectedType", ""), c.get("detectedType", ""), v["field"], v.get("extracted", ""),
                       "(not on card)" if v.get("notOnCard") else v.get("final", ""), v.get("confidence"), v.get("flag", ""), v["verdict"]])
            _style(ws, 10, v["verdict"])
    wc = wb.create_sheet("Cards")
    wc.append(["photo", "card", "side (reader)", "real side", "side verdict", "detected type", "real type", "type verdict",
               "clarity (reader)", "clarity reasons", "real clarity", "clarity verdict", "photo status", "refused (reader)",
               "refusal reason", "should be refused", "refusal verdict", "flags"])
    for rec in labels:
        for c in rec.get("cards", []):
            cv = check.card_verdicts(c)
            wc.append([rec["photo"], c["card"], c.get("side") or "", c.get("expectedSide") or "", cv["side"], c.get("detectedType", ""),
                       c.get("expectedType", ""), cv["type"], c.get("clarity") or "not reported", "; ".join(c.get("clarityReasons") or []),
                       c.get("expectedClarity") or "", cv["clarity"], c.get("photoStatus") or "not reported", _yn(c.get("rejected")),
                       c.get("rejectReason", ""), _yn(c.get("expectedRejected")) if c.get("expectedRejected") is not None else "",
                       cv["rejected"], " ".join(c.get("flags") or [])])
            for col, k in ((5, "side"), (8, "type"), (12, "clarity"), (17, "rejected")):
                _style(wc, col, cv[k])
    wp = wb.create_sheet("People")
    wp.append(["photo", "person", "cards (reader)", "real cards", "pairing verdict", "sides", "evidence", "paired by position",
               "rare (reader)", "real rare", "rare verdict", "photo outcome (reader)", "real photo outcome", "photo verdict",
               "clarity grade", "refusal reason", "flags"])
    for rec in labels:
        for p in rec.get("people", []):
            pv = check.person_verdicts(p)
            wp.append([rec["photo"], p["person"], "+".join(map(str, p.get("cards") or [])), p.get("expectedCards") or "", pv["pairing"],
                       "+".join(p.get("sides") or []), p.get("evidence", ""), "yes" if p.get("pairedByPosition") else "no",
                       _yn(p.get("rare")), _yn(p.get("expectedRare")) if p.get("expectedRare") is not None else "", pv["rare"],
                       p.get("photoOutcome") or "not reported", p.get("expectedPhotoOutcome") or "", pv["photo"],
                       p.get("clarity") or "", p.get("rejectReason", ""), " ".join(p.get("flags") or [])])
            for col, k in ((5, "pairing"), (11, "rare"), (14, "photo")):
                _style(wp, col, pv[k])
    sm = wb.create_sheet("Summary")
    sm.append(["field", "rows", "right %", "OCR wrong", "mapping wrong", "missing", "invented"])
    for f, s in st["perField"].items():
        sm.append([f, s["rows"], round(100 * s.get("right", 0) / s["rows"], 1), s.get("ocr_wrong", 0), s.get("mapping_wrong", 0),
                   s.get("missing", 0), s.get("invented", 0)])
    sm.append([])
    sm.append(["Measure", "right %", "right", "judged", "notes"])
    sm.append(["Photos reviewed", len(labels)])
    sm.append(["Cards", st["cards"]])
    sm.append(["People", st["people"]])
    sm.append(["Fields right % (OCR + mapping)", st["right"]])
    sm.append(["OCR errors %", st["ocr"]])
    sm.append(["Mapping errors %", st["mapping"]])
    sm.append(["Missed %", st["missing"]])
    sm.append(["Invented %", st["invented"]])
    sm.append(["Average character accuracy %", "n/a" if st["charAcc"] is None else st["charAcc"]])
    notes = {"clarity": lambda s: f"too strict {s.get('tooStrict', 0)}, too lenient {s.get('tooLenient', 0)}",
             "rejected": lambda s: f"wrongly refused {s.get('wrongReject', 0)}, missed refusals {s.get('missedReject', 0)}"}
    for label, k in (("Document type right %", "type"), ("Card side right %", "side"), ("Pairing right % (per person)", "pairing"),
                     ("Paired by position right %", "position"), ("Photo rejection right % (per card)", "rejected"),
                     ("Clarity grade right % (per card)", "clarity"), ("Photo outcome right % (per person)", "photo"),
                     ("Rare right % (per person)", "rare")):
        s = st[k]
        sm.append([label, _pct(s), s["right"], s["judged"], notes[k](s) if k in notes else ""])
    for sheet in (ws, wc, wp, sm):
        for c in sheet[1]:
            c.font = Font(bold=True)
        for col in sheet.columns:
            sheet.column_dimensions[col[0].column_letter].width = 18
    try:
        wb.save(S["xlsx"])
        saved = True
    except PermissionError:
        saved = False  # the file is open in Excel; labels.jsonl is still saved
    return {"photos": st["photos"], "rows": st["rows"], "right": st["right"], "ocr": st["ocr"], "mapping": st["mapping"],
            "missing": st["missing"], "excelSaved": saved, "typeRight": st["type"]["pct"], "pairing": st["pairing"]["pct"],
            "rejection": st["rejected"]["pct"], "clarity": st["clarity"]["pct"], "photo": st["photo"]["pct"]}


def deferred_path() -> Path:
    return S["labels_path"].with_name("confusing.json")


def apply_order() -> None:
    names = set(json.loads(deferred_path().read_text(encoding="utf-8"))) if deferred_path().exists() else set()
    S["deferred"] = names
    S["photos"] = [p for p in S["photos"] if p.name not in names] + [p for p in S["photos"] if p.name in names]


def defer(name: str) -> None:
    with LOCK:
        S["deferred"].add(name)
        deferred_path().write_text(json.dumps(sorted(S["deferred"])), encoding="utf-8")
        apply_order()


def _v(s) -> str:
    return "n/a" if s is None else f"{s}%"


def write_report() -> None:
    """report.html: summary on top, every reviewed photo with its cards, people and fields, confusing photos last."""
    from html import escape
    st = write_xlsx()
    names = [n for n in S["labels"] if n not in S["deferred"]] + [n for n in S["labels"] if n in S["deferred"]]
    parts = ["<!doctype html><meta charset=utf-8><title>Reader accuracy report</title><style>body{font:14px system-ui;margin:24px;max-width:1100px}"
             "table{border-collapse:collapse;width:100%;margin:6px 0 16px}td,th{border:1px solid #ccc;padding:5px;text-align:left}"
             ".right{background:#c6efce}.ocr_wrong,.missing,.wrong{background:#ffc7ce}.mapping_wrong,.invented{background:#ffeb9c}h3{margin-bottom:0}</style>",
             "<h1>Reader accuracy report</h1>",
             f"<p>Photos reviewed: <b>{st['photos']}</b> &middot; fields right <b>{st['right']}%</b> &middot; OCR errors <b>{st['ocr']}%</b> &middot; "
             f"mapping errors <b>{st['mapping']}%</b> &middot; missed <b>{st['missing']}%</b> &middot; card type right <b>{_v(st['typeRight'])}</b><br>"
             f"pairing right <b>{_v(st['pairing'])}</b> &middot; photo rejection right <b>{_v(st['rejection'])}</b> &middot; "
             f"clarity right <b>{_v(st['clarity'])}</b> &middot; photo outcome right <b>{_v(st['photo'])}</b></p>"]
    for n in names:
        rec = S["labels"][n]
        tag = " &mdash; <i>confusing photo</i>" if n in S["deferred"] else ""
        parts.append(f"<h3>{escape(n)}{tag}</h3>")
        parts.append("<table><tr><th>Card</th><th>Side</th><th>Type (real / reader)</th><th>Clarity (reader / real)</th><th>Reasons</th>"
                     "<th>Refused (reader / should)</th></tr>")
        for c in rec.get("cards", []):
            cv = check.card_verdicts(c)
            parts.append(f"<tr><td>{c['card']}</td><td class={cv['side'].replace('/', '')}>{escape(str(c.get('side') or ''))}</td>"
                         f"<td class={cv['type'].replace('/', '')}>{escape(c.get('expectedType', ''))} / {escape(c.get('detectedType', ''))}</td>"
                         f"<td class={cv['clarity'].replace('/', '')}>{escape(str(c.get('clarity') or 'not reported'))} / {escape(str(c.get('expectedClarity') or ''))}</td>"
                         f"<td>{escape('; '.join(c.get('clarityReasons') or []))}</td>"
                         f"<td class={cv['rejected'].replace('/', '')}>{_yn(c.get('rejected'))} {escape(c.get('rejectReason', ''))} / {_yn(c.get('expectedRejected'))}</td></tr>")
        parts.append("</table>")
        if rec.get("people"):
            parts.append("<table><tr><th>Person</th><th>Cards (reader / real)</th><th>Evidence</th><th>By position</th><th>Rare (reader / real)</th>"
                         "<th>Photo (reader / real)</th></tr>")
            for p in rec["people"]:
                pv = check.person_verdicts(p)
                parts.append(f"<tr><td>{p['person']}</td><td class={pv['pairing'].replace('/', '')}>{'+'.join(map(str, p.get('cards') or []))} / {escape(str(p.get('expectedCards') or ''))}</td>"
                             f"<td>{escape(p.get('evidence', ''))}</td><td>{'yes' if p.get('pairedByPosition') else 'no'}</td>"
                             f"<td class={pv['rare'].replace('/', '')}>{_yn(p.get('rare'))} / {_yn(p.get('expectedRare'))}</td>"
                             f"<td class={pv['photo'].replace('/', '')}>{escape(str(p.get('photoOutcome') or 'not reported'))} / {escape(str(p.get('expectedPhotoOutcome') or ''))}</td></tr>")
            parts.append("</table>")
        parts.append("<table><tr><th>Card</th><th>Field</th><th>Reader read</th><th>Correct</th><th>Result</th><th>Confidence</th></tr>")
        for v in check.field_verdicts(rec.get("fields", [])):
            parts.append(f"<tr class={v['verdict']}><td>{v['card']}</td><td>{escape(v['field'])}</td><td>{escape(str(v.get('extracted', '')))}</td>"
                         f"<td>{'(not on card)' if v.get('notOnCard') else escape(str(v.get('final', '')))}</td><td>{v['verdict'].replace('_', ' ')}</td>"
                         f"<td>{v.get('confidence') or ''}</td></tr>")
        parts.append("</table>")
    S["xlsx"].with_name("report.html").write_text("".join(parts), encoding="utf-8")


ID_NAMES = {"aadhaar": "Aadhaar", "pan": "PAN", "passport": "Passport", "driving-licence": "DrivingLicence", "voter-id": "VoterID",
            "national-id": "NationalID", "visa": "Visa", "oci": "OCI", "pio": "PIO", "residence-permit": "ResidencePermit",
            "employee-card": "EmployeeCard"}


def clean(part: str) -> str:
    return "".join(c for c in part if c.isalnum()).strip()


def export_image(rec: dict) -> None:
    """Copies the reviewed photo into the images folder as FirstName_LastName_IdName.ext (+ _Rare when MJ marked a person in it
    rare). The name comes from the first card with a corrected name. The original is untouched. Local copy only: this PC, no
    network. A photo re-saved after a correction replaces its earlier copy."""
    src = next((p for p in S["photos"] if p.name == rec["photo"]), None)
    if src is None or not S.get("images_out"):
        return
    named = [f for f in rec["fields"] if f["field"] == "name" and f.get("final") and not f.get("notOnCard")]
    name_field = named[0]["final"] if named else ""
    card = named[0].get("card", 1) if named else 1
    words = [clean(w) for w in name_field.split() if clean(w)]
    first, last = (words[0], words[-1]) if len(words) > 1 else (words[0] if words else "Unknown", "Unknown" if len(words) < 2 else "")
    ctype = next((c.get("expectedType") for c in rec.get("cards", []) if c["card"] == card), rec.get("expectedType", ""))
    idn = ID_NAMES.get(ctype or "", "Document")
    rare = any(p.get("expectedRare") for p in rec.get("people", []) if card in check.parse_cards(p.get("expectedCards")))
    out = S["images_out"]
    out.mkdir(parents=True, exist_ok=True)
    old = rec.get("exportedAs")
    if old and (out / old).exists():
        (out / old).unlink()
    stem = f"{first}_{last}_{idn}" + ("_Rare" if rare else "")
    target, n = out / f"{stem}{src.suffix.lower()}", 2
    while target.exists():
        target = out / f"{stem}_{n}{src.suffix.lower()}"
        n += 1
    target.write_bytes(src.read_bytes())
    rec["exportedAs"] = target.name


def build_label(body: dict) -> dict:
    """A version-2 label from the form: fields carry their card number; the first card's types stay at the top for older readers
    of labels.jsonl (training's build_dataset reads photo, expectedType, detectedType and fields)."""
    cards = [{k: c.get(k) for k in ("card", "side", "expectedSide", "detectedType", "expectedType", "clarity", "clarityReasons",
                                     "expectedClarity", "photoStatus", "rejected", "rejectReason", "expectedRejected", "flags")}
             for c in body.get("cards", [])]
    for c in cards:
        c["card"] = int(c["card"])
        c["clarityReasons"] = c["clarityReasons"] or []
        c["flags"] = c["flags"] or []
        c["rejectReason"] = c["rejectReason"] or ""
    people = [{k: p.get(k) for k in ("person", "cards", "sides", "evidence", "pairedByPosition", "rare", "photoOutcome", "clarity",
                                      "rejected", "rejectReason", "flags", "expectedCards", "expectedRare", "expectedPhotoOutcome")}
              for p in body.get("people", [])]
    fields = [{"card": int(f.get("card") or 1), "field": f["field"], "extracted": f.get("extracted", ""), "final": f.get("final", ""),
               "notOnCard": bool(f.get("notOnCard")), "confidence": f.get("confidence"), "flag": f.get("flag", ""), "extra": bool(f.get("extra"))}
              for f in body.get("fields", []) if f.get("field")]
    first = cards[0] if cards else {}
    return {"version": check.LABEL_VERSION, "photo": body["photo"], "multi": bool(body.get("multi")),
            "expectedType": first.get("expectedType", "") or "", "detectedType": first.get("detectedType", "") or "",
            "fields": fields, "cards": cards, "people": people}


def save(body: dict) -> dict:
    with LOCK:
        rec = build_label(body)
        old = S["labels"].get(rec["photo"])
        if old and old.get("exportedAs"):
            rec["exportedAs"] = old["exportedAs"]
        export_image(rec)
        S["labels"][rec["photo"]] = rec
        with open(S["labels_path"], "w", encoding="utf-8") as fh:
            for r in S["labels"].values():
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        write_report()
        return write_xlsx()


PAGE = r"""<!doctype html><meta charset=utf-8><title>Reader review</title>
<style>
body{margin:0;font:14px system-ui;background:#f4f1ea;color:#222}header{display:flex;gap:16px;align-items:center;padding:10px 16px;background:#262626;color:#f6d878;flex-wrap:wrap}
header b{color:#fff}main{display:grid;grid-template-columns:1fr 1.15fr;gap:14px;padding:14px;height:calc(100vh - 74px);box-sizing:border-box}
.photo{background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:auto}.photo img{max-width:100%;max-height:100%}
.panel{background:#fff;border-radius:8px;padding:14px;overflow:auto}table{width:100%;border-collapse:collapse}td{padding:3px;vertical-align:top}
input[type=text],select{width:100%;padding:5px;font:inherit;box-sizing:border-box}input.bad,select.bad{background:#ffe3e3}input.ok,select.ok{background:#e4f6e4}
.flag{color:#b45309;font-size:12px}.card,.person{border:1px solid #ddd;border-radius:8px;padding:10px;margin:0 0 12px}.card h4,.person h4{margin:0 0 6px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}.grid label{font-size:12px;color:#555}.crop{max-width:100%;max-height:160px;display:block;margin:4px 0 8px}
.unclear{color:#b00;font-weight:600}.usable{color:#b45309}.clear{color:#166534}
button{padding:9px 16px;font:inherit;cursor:pointer;margin-right:8px;border:0;border-radius:6px;background:#262626;color:#f6d878}button.alt{background:#ddd;color:#222}
</style>
<header><span>Photo <b id=pos></b></span><span>Fields right <b id=sRight>-</b></span><span>OCR err <b id=sOcr>-</b></span><span>Mapping err <b id=sMap>-</b></span><span>Type right <b id=sType>-</b></span><span>Pairing right <b id=sPair>-</b></span><span>Rejection right <b id=sRej>-</b></span><span>Clarity right <b id=sClar>-</b></span><span>Photo right <b id=sPhoto>-</b></span><span id=xl></span></header>
<main><div class=photo><img id=img></div><div class=panel>
<p id=err style="color:#b00"></p><p id=mode class=flag></p>
<div id=cards></div><h3>People</h3><div id=people></div>
<p><button onclick="go(1)">Save &amp; Next</button><button class=alt onclick="go(-1,true)">Back</button><button class=alt onclick="go(1,true)">Skip</button><button class=alt onclick="confusing()">Confusing - do last</button> <a href="/report" target=_blank>Open report</a></p>
<p class=flag>Untouched values count as right. Fields: edit a wrong value, tick "not on card" if the reader invented it. Card: fix the side, the clarity grade, or tick "should be refused" when the ID photo is not clear. Person: fix the cards that belong together (1+2), rare, or the photo outcome.</p></div></main>
<script>
let i=0,cur=null;const $=id=>document.getElementById(id);const TYPES=%TYPES%,GRADES=%GRADES%,OUTCOMES=%OUTCOMES%,SIDES=%SIDES%;
const esc=s=>(s??'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const opts=(list,v,blank)=>(blank?`<option value="">${blank}</option>`:'')+list.map(t=>`<option ${t===v?'selected':''}>${t}</option>`).join('');
function mark(el,orig){const f=()=>{const v=el.type==='checkbox'?el.checked:el.value;el.classList.toggle('bad',v!==orig);el.classList.toggle('ok',v===orig)};el.addEventListener('input',f);el.addEventListener('change',f);f()}
function fieldRow(tb,f){const tr=document.createElement('tr');tr.innerHTML=`<td style="width:24%"><input type=text class=fn value="${esc(f.field)}" ${f.extra?'':'readonly'}></td><td><input type=text class=fv value="${esc(f.final??f.extracted)}"><div class=flag>${esc(f.flag)} ${f.confidence!=null?'conf '+f.confidence:''}</div></td><td style="width:90px"><label><input type=checkbox class=no ${f.notOnCard?'checked':''}> not on card</label></td>`;
tr.dataset.ex=f.extracted??'';tr.dataset.conf=f.confidence??'';tr.dataset.flag=f.flag||'';mark(tr.querySelector('.fv'),tr.dataset.ex);tb.appendChild(tr)}
function cardBox(c){const d=document.createElement('div');d.className='card';d.dataset.json=JSON.stringify(c);
const rej=c.rejected==null?'not reported':(c.rejected?'yes ('+esc(c.rejectReason)+')':'no');
d.innerHTML=`<h4>Card ${c.card} &middot; reader: ${esc(c.side)} &middot; ${esc(c.detectedType||'(no type)')} &middot; clarity <span class="${esc(c.clarity||'')}">${esc(c.clarity||'not reported')}</span> &middot; photo ${esc(c.photoStatus||'not reported')} &middot; refused ${rej}</h4>
${c.hasCrop?`<img class=crop src="/crop?i=${i}&c=${c.card}">`:''}<div class=flag>${esc((c.clarityReasons||[]).join('; '))} ${esc(c.retake||'')}</div>
<div class=grid><div><label>Real type</label><select class=etype>${opts(TYPES,c.expectedType,'(choose)')}</select></div><div><label>Real side</label><select class=eside>${opts(SIDES,c.expectedSide||c.side)}</select></div>
<div><label>Real clarity</label><select class=eclar>${opts(GRADES,c.expectedClarity||'','(not judged)')}</select></div><div><label>&nbsp;</label><label><input type=checkbox class=erej ${c.expectedRejected?'checked':''}> should be refused (photo not clear)</label></div></div>
<table class=tb></table><button class=alt onclick="fieldRow(this.previousElementSibling,{field:'',extracted:'',extra:true})">+ Add a field the reader missed</button>`;
mark(d.querySelector('.eside'),c.side||'');mark(d.querySelector('.eclar'),c.clarity||'');mark(d.querySelector('.erej'),!!c.rejected);
const tb=d.querySelector('.tb');(c.fields||[]).forEach(f=>fieldRow(tb,f));$('cards').appendChild(d)}
function personBox(p){const d=document.createElement('div');d.className='person';d.dataset.json=JSON.stringify(p);const own=(p.cards||[]).join('+');
d.innerHTML=`<h4>Person ${p.person} &middot; cards ${own} (${esc((p.sides||[]).join('+'))}) &middot; evidence ${esc(p.evidence||'none')}${p.pairedByPosition?' &middot; <b>paired by position</b>':''} &middot; rare ${p.rare==null?'not reported':(p.rare?'yes':'no')} &middot; photo ${esc(p.photoOutcome||'not reported')}${p.rejectReason?' &middot; refused: '+esc(p.rejectReason):''}</h4>
<div class=grid><div><label>Real cards of this person</label><input type=text class=ecards value="${esc(p.expectedCards??own)}"></div><div><label>Real photo outcome</label><select class=ephoto>${opts(OUTCOMES,p.expectedPhotoOutcome||'','(not judged)')}</select></div><div><label>&nbsp;</label><label><input type=checkbox class=erare ${p.expectedRare?'checked':''}> rare (same name + DOB, no number)</label></div></div>`;
mark(d.querySelector('.ecards'),own);mark(d.querySelector('.ephoto'),p.photoOutcome||'');mark(d.querySelector('.erare'),!!p.rare);$('people').appendChild(d)}
async function load(){const r=await (await fetch('/api/item?i='+i)).json();cur=r;$('pos').textContent=(i+1)+' / '+r.total;$('img').src='/photo?i='+i;$('cards').innerHTML='';$('people').innerHTML='';$('err').textContent=r.error||'';
$('mode').textContent=r.multi?'':'The reader answered one document (older answer): one card, one person.';(r.cards||[]).forEach(cardBox);(r.people||[]).forEach(personBox);if(!(r.people||[]).length)$('people').textContent='(none)';stats(r.stats)}
const pc=v=>v==null?'-':v+'%';
function stats(s){if(!s)return;$('sRight').textContent=s.right+'%';$('sOcr').textContent=s.ocr+'%';$('sMap').textContent=s.mapping+'%';$('sType').textContent=pc(s.typeRight);$('sPair').textContent=pc(s.pairing);$('sRej').textContent=pc(s.rejection);$('sClar').textContent=pc(s.clarity);$('sPhoto').textContent=pc(s.photo);$('xl').textContent=s.excelSaved?'results.xlsx saved ('+s.photos+' photos)':'CLOSE results.xlsx in Excel to save it'}
function collect(){const cards=[],fields=[];document.querySelectorAll('.card').forEach(d=>{const c=JSON.parse(d.dataset.json);delete c.fields;delete c.hasCrop;
c.expectedType=d.querySelector('.etype').value;c.expectedSide=d.querySelector('.eside').value;c.expectedClarity=d.querySelector('.eclar').value||null;c.expectedRejected=d.querySelector('.erej').checked;cards.push(c);
d.querySelectorAll('.tb tr').forEach(tr=>{const name=tr.querySelector('.fn').value.trim();if(!name)return;fields.push({card:c.card,field:name,extracted:tr.dataset.ex,final:tr.querySelector('.fv').value.trim(),notOnCard:tr.querySelector('.no').checked,confidence:tr.dataset.conf===''?null:+tr.dataset.conf,flag:tr.dataset.flag,extra:!tr.querySelector('.fn').readOnly})})});
const people=[...document.querySelectorAll('.person')].map(d=>{const p=JSON.parse(d.dataset.json);p.expectedCards=d.querySelector('.ecards').value.trim();p.expectedRare=d.querySelector('.erare').checked;p.expectedPhotoOutcome=d.querySelector('.ephoto').value||null;return p});
return {photo:cur.photo,multi:cur.multi,cards,people,fields}}
async function go(d,skip){if(!skip&&cur&&!cur.error){const s=await (await fetch('/api/save',{method:'POST',body:JSON.stringify(collect())})).json();stats(s)}
i=Math.max(0,Math.min(cur.total-1,i+d));load()}
async function confusing(){await fetch('/api/defer',{method:'POST',body:JSON.stringify({photo:cur.photo})});load()}
load();
</script>"""


def page() -> bytes:
    return (PAGE.replace("%TYPES%", json.dumps(TYPES)).replace("%GRADES%", json.dumps(check.GRADES))
            .replace("%OUTCOMES%", json.dumps(check.OUTCOMES)).replace("%SIDES%", json.dumps(check.SIDES))).encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D401 - keep the console quiet (no file names)
        pass

    def send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        i = int(q.get("i", ["0"])[0]) if q.get("i", ["0"])[0].isdigit() else 0
        if u.path == "/":
            self.send(200, page(), "text/html; charset=utf-8")
        elif u.path == "/report":
            with LOCK:
                write_report()
            self.send(200, S["xlsx"].with_name("report.html").read_bytes(), "text/html; charset=utf-8")
        elif u.path == "/photo" and i < len(S["photos"]):
            p = S["photos"][i]
            self.send(200, p.read_bytes(), mimetypes.guess_type(p.name)[0] or "application/octet-stream")
        elif u.path == "/crop" and i < len(S["photos"]) and q.get("c", [""])[0].isdigit():
            crop = S["crops"].get((S["photos"][i].name, int(q["c"][0])))
            if crop is None:
                self.send(404, b"not found", "text/plain")
            else:
                self.send(200, crop, "image/png")
        elif u.path == "/api/item" and i < len(S["photos"]):
            photo = S["photos"][i]
            label = S["labels"].get(photo.name)
            r = {"photo": photo.name, "total": len(S["photos"]), "labelled": bool(label), "stats": None}
            if label:
                r.update(view_from_label(label))
            else:
                parsed = reader_result(i)
                r.update(view_from_reader(parsed))
                if parsed.get("error"):
                    r["error"] = parsed["error"]
            if i == 0 or label:
                r["stats"] = write_xlsx() if S["labels"] else None
            self.send(200, json.dumps(r).encode(), "application/json")
        else:
            self.send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/api/save", "/api/defer"):
            return self.send(404, b"not found", "text/plain")
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if self.path == "/api/defer":
            defer(body["photo"])
            return self.send(200, b"{}", "application/json")
        self.send(200, json.dumps(save(body)).encode(), "application/json")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--photos", required=True)
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--labels", default="labels.jsonl")
    ap.add_argument("--xlsx", default="results.xlsx")
    ap.add_argument("--images-out", default="reviewed-images", help="folder for the renamed copies (FirstName_LastName_IdName), offline on this PC")
    a = ap.parse_args()
    S["images_out"] = Path(a.images_out)
    if not os.environ.get("READER_KEY"):
        print("Set READER_KEY (same as the running reader).")
        return 2
    S["photos"] = sorted(p for p in Path(a.photos).rglob("*") if p.suffix.lower() in IMG)
    S["labels_path"], S["xlsx"] = Path(a.labels), Path(a.xlsx)
    if not S["photos"]:
        print("No photos found (PDFs are not shown in the form).")
        return 1
    load_labels()
    apply_order()
    print(f"{len(S['photos'])} photos. Open http://127.0.0.1:{a.port}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
