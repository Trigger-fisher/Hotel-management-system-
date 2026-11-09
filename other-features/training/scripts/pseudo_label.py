"""Free labels from unlabelled photos: a line is kept ONLY when an independent check agrees with what OCR read.

  .venv\\Scripts\\python.exe scripts\\pseudo_label.py --photos <photo folder> --out D:\\hmsd\\pl1 [--limit N]
        [--link-review-to D:\\hmsd\\review1]

Rules (each accepted line records which rule accepted it):
  verhoeff          a line that is exactly an Aadhaar number (optionally after a known label) and passes the Verhoeff check digit
  pan-pattern       a line that is exactly a PAN (AAA P A 9999 A, holder letter checked) read with confidence >= 0.85
  mrz-check-digits  MRZ lines whose every character is covered by passing ICAO check digits (number, birth, expiry, composite).
                    Name lines of an MRZ have no check digit and are never accepted.
  qr-name / qr-dob  the Aadhaar QR's name / date of birth equals the OCR line (after case, spacing and punctuation are ignored)
Everything else goes to needs_review.jsonl (with the reasons), which is the work list for the accuracy review form
(accuracy-check/review.py). --link-review-to makes hard links of those photos in a folder for the form (same drive; no copies).

Writes (in --out, outside the repository): pseudo_labels.jsonl (accepted lines with their boxes, per photo), needs_review.jsonl,
summary.json. Resumable: photos already in the outputs are skipped. The console prints counts only."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import guard  # noqa: E402  (first: thread caps)
from common import (AADHAAR_RE, aadhaar_valid, iter_photos, long_path_warning, mrz_clean, mrz_verified_lines, nfc,  # noqa: E402
                    norm, pan_valid, parse_aadhaar_qr, read_image, refuse_inside_repo)

LABEL = re.compile(r"^\s*((?:full\s+)?name|dob|d\.o\.b\.?|date\s+of\s+birth|year\s+of\s+birth|yob|aadhaar\s*no\.?|"
                   r"your\s+aadhaar\s+no\.?|pan|permanent\s+account\s+number|नाम|નામ|जन्म\s+तिथि)\s*[:\-]\s*", re.I)
PAN_MIN_CONF = 0.85
KEYWORDS = {"driving-licence": ("driving licence", "driving license", "transport department"),
            "voter-id": ("election commission", "elector", "epic"), "pan": ("income tax", "permanent account number"),
            "aadhaar": ("aadhaar", "uidai", "government of india")}


EXACT_LABELS = {"Name", "NAME", "DOB", "D.O.B.", "D.O.B", "Date of Birth", "Date of birth", "DATE OF BIRTH", "Year of Birth", "YOB",
                "Aadhaar No", "Aadhaar No.", "Your Aadhaar No", "Your Aadhaar No.", "PAN", "Permanent Account Number", "नाम", "નામ", "जन्म तिथि"}


def split_label(text: str) -> tuple[str, str]:
    """(printed label + ": ", rest) when the line starts with a label spelled EXACTLY as printed labels are (case and
    letters checked, because a label is not under any check digit), else ("", text). "D0B:" or "DoB:" is not a label."""
    m = LABEL.match(text)
    if not m or m.end() >= len(text):
        return "", text
    word = re.sub(r"[\s:\-]+$", "", text[:m.end()])
    word = re.sub(r"\s+", " ", word)
    return (word + ": ", text[m.end():]) if word in EXACT_LABELS else ("", text)


DATE_ONLY = re.compile(r"\s*(\d{2})([/\-.])(\d{2})\2(\d{4})\s*")


def date_digits(text: str) -> str | None:
    m = re.search(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", text or "")
    return f"{int(m.group(1)):02d}{int(m.group(2)):02d}{m.group(3)}" if m else None


def consistent_case(text: str) -> bool:
    """All capitals, or every word Capitalised: a single odd letter case ("SHAh") is an OCR slip, not a free label."""
    words = [w for w in text.split() if w.isalpha()]
    return bool(words) and (all(w.isupper() for w in words) or all(w[0].isupper() and w[1:].islower() for w in words))


def judge(lines: list[dict], codes: list[str]) -> dict:
    """Pure decision step (no I/O, testable): which detected lines are free labels, which need a person, and why."""
    order = sorted(range(len(lines)), key=lambda i: (lines[i]["quad"][0][1] + lines[i]["quad"][2][1]) / 2)
    texts = [nfc(lines[i]["text"]) for i in order]
    accepted: dict[int, dict] = {}
    reasons = Counter()
    fields: dict[str, str] = {}
    qr = next((q for q in (parse_aadhaar_qr(c) for c in codes) if q), None)
    for pos, i in enumerate(order):
        text, conf = texts[pos], float(lines[i].get("conf", 0))
        prefix, rest = split_label(text)
        compact = re.sub(r"[\s-]", "", rest)
        if AADHAAR_RE.fullmatch(rest.strip()):
            if aadhaar_valid(compact):
                printed = f"{compact[:4]} {compact[4:8]} {compact[8:]}"  # Aadhaar is printed 4-4-4; OCR spacing is not trusted
                accepted[i] = {"rule": "verhoeff", "field": "documentNumber", "text": prefix + printed}
                fields["documentNumber"] = compact
                if qr and qr.get("last4") and not compact.endswith(qr["last4"]):
                    reasons["qrLast4Mismatch"] += 1
            else:
                reasons["aadhaarCheckFailed"] += 1
            continue
        if re.fullmatch(r"[A-Z]{5}\d{4}[A-Z]", rest.strip()):
            if pan_valid(rest) and conf >= PAN_MIN_CONF:
                accepted[i] = {"rule": "pan-pattern", "field": "documentNumber", "text": prefix + rest.strip()}
                fields["documentNumber"] = rest.strip()
            else:
                reasons["panUnsure"] += 1
            continue
        if qr:
            name = " ".join(rest.split())
            if (qr.get("name") and norm(name) and norm(name) == norm(qr["name"]) and consistent_case(name)
                    and re.fullmatch(r"[^\W\d_]+(?: [^\W\d_]+)*", name)):
                accepted[i] = {"rule": "qr-name", "field": "name", "text": prefix + name}
                fields["name"] = name
                continue
            dm = DATE_ONLY.fullmatch(rest)
            if dm and date_digits(rest) == date_digits(qr.get("dob", "")):
                dd = date_digits(rest)
                accepted[i] = {"rule": "qr-dob", "field": "dob", "text": prefix + rest.strip()}
                fields["dob"] = f"{dd[4:]}-{dd[2:4]}-{dd[:2]}"
                continue
    for pos, fmt in mrz_verified_lines(texts).items():
        i = order[pos]
        accepted[i] = {"rule": "mrz-check-digits", "field": f"mrz{fmt}", "text": mrz_clean(texts[pos])}
        line = mrz_clean(texts[pos])
        if fmt in ("TD3", "TD2"):
            fields.setdefault("documentNumber", line[0:9].replace("<", ""))
    if qr and qr.get("name") and "name" not in fields:
        reasons["qrNameNotMatched"] += 1  # the printed name differs from the QR (or was misread): a person must look
    unverified = len(lines) - len(accepted)
    if unverified:
        reasons["unverifiedLines"] += unverified
    return {"accepted": accepted, "fields": fields, "reasons": dict(reasons), "qr": bool(qr)}


def guess_type(lines: list[dict], fields: dict, accepted: dict) -> str:
    rules = {a["rule"] for a in accepted.values()}
    if "verhoeff" in rules or any(r.startswith("qr-") for r in rules):
        return "aadhaar"
    if "pan-pattern" in rules:
        return "pan"
    if "mrz-check-digits" in rules:
        return "passport"
    text = " ".join(ln["text"] for ln in lines).casefold()
    for dtype, words in KEYWORDS.items():
        if any(w in text for w in words):
            return dtype
    return "unknown"


def read_codes(img) -> list[str]:
    try:
        import zxingcpp
        return [r.text for r in zxingcpp.read_barcodes(img)]
    except Exception:  # noqa: BLE001 - codes are optional evidence
        return []


def done_photos(out: Path) -> set[str]:
    seen = set()
    for name in ("pseudo_labels.jsonl", "needs_review.jsonl", "nothing_read.jsonl"):
        p = out / name
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    seen.add(json.loads(line)["photo"])
    return seen


def run(photos: Path, out: Path, limit: int = 0, ocr=None, codes_reader=read_codes, link_review_to: Path | None = None,
        limits: "guard.Limits | None" = None, stop: "guard.StopFlag | None" = None, quiet: bool = False) -> dict:
    reason = refuse_inside_repo(out)
    if reason:
        raise SystemExit(f"refused: {reason}")
    photos, out = Path(photos).resolve(), Path(out).resolve()
    if out == photos or photos in out.parents:
        raise SystemExit("refused: the output folder must not be inside the photo folder")
    limits = limits or guard.Limits.from_env()
    disk = guard.check_disk(out, 50_000_000, limits)
    if disk:
        raise SystemExit(f"refused: {disk}")
    out.mkdir(parents=True, exist_ok=True)
    if ocr is None:
        from common import RapidLines
        ocr = RapidLines()
    seen = done_photos(out)
    counts = Counter()
    with open(out / "pseudo_labels.jsonl", "a", encoding="utf-8") as fp, open(out / "needs_review.jsonl", "a", encoding="utf-8") as fr, \
            open(out / "nothing_read.jsonl", "a", encoding="utf-8") as fn:
        for n, path in enumerate(iter_photos(photos)):
            if (limit and n >= limit) or (stop and stop.stopped):
                break
            rel = path.relative_to(photos).as_posix()
            if rel in seen:
                counts["alreadyDone"] += 1
                continue
            guard.wait_for_ram(limits, stop=stop)
            img = read_image(path)
            counts["photos"] += 1
            if img is None:
                counts["unreadable"] += 1
                fn.write(json.dumps({"photo": rel, "why": "unreadable"}) + "\n")
                continue
            if hasattr(ocr, "for_photo"):  # test engines that replay invented ground truth
                ocr.for_photo(path.name)
            lines = ocr(img)
            if not lines:
                counts["noText"] += 1
                fn.write(json.dumps({"photo": rel, "why": "no text"}) + "\n")
                continue
            verdict = judge(lines, codes_reader(img))
            acc = verdict["accepted"]
            dtype = guess_type(lines, verdict["fields"], acc)
            counts["linesSeen"] += len(lines)
            counts["linesAccepted"] += len(acc)
            for a in acc.values():
                counts["rule_" + a["rule"]] += 1
            if acc:
                fp.write(json.dumps({"photo": rel, "docType": dtype, "fields": verdict["fields"],
                                     "lines": [{"quad": lines[i]["quad"], "text": a["text"], "rule": a["rule"], "field": a["field"]}
                                               for i, a in sorted(acc.items())]}, ensure_ascii=False) + "\n")
                counts["photosWithFreeLabels"] += 1
            if verdict["reasons"]:
                fr.write(json.dumps({"photo": rel, "docType": dtype, "accepted": len(acc), "lines": len(lines),
                                     "reasons": verdict["reasons"]}) + "\n")
                counts["photosNeedReview"] += 1
                for k in verdict["reasons"]:
                    counts["why_" + k] += 1
                if link_review_to:
                    target = Path(link_review_to) / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        if not target.exists():
                            os.link(path, target)
                        counts["reviewLinks"] += 1
                    except OSError:
                        counts["reviewLinkFailed"] += 1
            else:
                counts["photosFullyFree"] += 1
            if not quiet and counts["photos"] % 100 == 0:
                print(f"\r{counts['photos']} photos", end="", flush=True)
    summary = dict(sorted(counts.items()))
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--photos", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--link-review-to")
    guard.add_args(ap)
    a = ap.parse_args()
    limits = guard.apply(guard.from_args(a))
    stop = guard.StopFlag()
    warn = long_path_warning(Path(a.out))
    if warn:
        print(warn)
    s = run(Path(a.photos), Path(a.out), a.limit, link_review_to=Path(a.link_review_to) if a.link_review_to else None,
            limits=limits, stop=stop)
    print()
    for k, v in s.items():
        print(f"{k:28s} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
