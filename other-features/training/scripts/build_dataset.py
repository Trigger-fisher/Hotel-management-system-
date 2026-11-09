"""Builds the recognition training dataset from guest ID photos. Photos are opened READ-ONLY; nothing is uploaded.

  .venv\\Scripts\\python.exe scripts\\build_dataset.py --photos <photo folder> --out D:\\hmsd\\ds1
        [--labels labels.jsonl] [--pseudo D:\\hmsd\\pl1\\pseudo_labels.jsonl] [--seed 1947] [--ratios 0.8 0.1 0.1]
        [--unkeyed drop|train] [--keep-splits] [--limit N]

Truth comes from two places only:
  * --labels: labels.jsonl written by the accuracy review form (a person checked every field), aligned to the detected text lines;
  * --pseudo: lines that pseudo_label.py accepted because an independent check agreed (checksum, MRZ, QR).
A photo with neither is skipped. A detected line that matches no checked value is NOT used (its text is unverified).

Output (in --out, which must be OUTSIDE the repository, on a short path):
  cards/<split>/<card>.jpg          card crop (area around the text lines)
  lines/<split>/<card>_<nn>.png     one text-line crop per labelled line
  rec_gt_<split>.txt                PaddleOCR format: "lines/<split>/<file>\\t<text>"   (+ rec_gt_<split>_<script>.txt per script)
  lines_<split>.jsonl               per line: card, docType, script, field, source
  fields_<split>.jsonl              per card: field labels (for field accuracy)
  manifest.jsonl                    per card: split, docType, salted HASHES of the guest keys and of the photo path, counts
  summary.json                      counts only
  .salt                             random salt for the hashes (keep it with the dataset; never commit it)

Split: train / validation / test BY GUEST. Photos are joined into one guest when they share an ID number, a name + date of birth,
or the same picture (perceptual hash); one guest is never in two splits. Groups are ordered by sha256(seed, key) and split per
document type (stratified), so the same input and seed always give the same split. Photos with no key cannot be tied to a
guest: by default they are dropped (--unkeyed train puts them in train only, never in validation or test).
The console prints counts only; no names, numbers or file names."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import guard  # noqa: E402  (first: thread caps before numpy / OpenCV / onnxruntime start)
from common import (SPLITS, char_acc, crop_quad, dhash, dob_variants, hkey, iter_photos, load_or_create_salt,  # noqa: E402
                    long_path_warning, nfc, norm, read_image, refuse_inside_repo, script_of, write_image)

LABEL_PREFIX = re.compile(r"^\s*((?:full\s+)?name|dob|d\.o\.b\.?|date\s+of\s+birth|dl\s*no\.?|epic\s*no\.?|passport\s*no\.?|"
                          r"no\.?|number|surname|given\s+names?|father'?s?\s+name|नाम|નામ|जन्म\s+तिथि)\s*[:\-]\s*", re.I)
MATCH_MIN = 0.7
BYTES_PER_PHOTO = 300_000  # estimate: card crop ~150 KB + about 8 line crops
NUMBER_FIELDS = {"documentNumber", "qrLast4"}
SKIP_FIELDS = {"qrLast4", "mrzValid", "composite"}


# ------------------------------------------------------------------ aligning checked values to detected lines
CANONICAL_LABELS = ["Name", "Full Name", "DOB", "D.O.B.", "Date of Birth", "DL No", "DL No.", "EPIC No", "EPIC No.", "Passport No",
                    "Passport No.", "No", "No.", "Number", "Surname", "Given Names", "Given Name", "Father's Name", "Fathers Name",
                    "नाम", "નામ", "जन्म तिथि"]


def canonical_prefix(ocr_prefix: str) -> str | None:
    """A label read by OCR, re-spaced as it is printed ("DOB:" -> "DOB: ", "PassportNo:" -> "Passport No: "). The letters
    (and their case) are the OCR ones, which must spell a known label exactly; OCR often drops spaces, so spacing is canonical."""
    letters = [ch for ch in ocr_prefix if norm(ch)]
    for canon in CANONICAL_LABELS:
        if norm(canon) == norm(ocr_prefix):
            out, k = [], 0
            for ch in canon:
                if norm(ch):
                    out.append(letters[k])
                    k += 1
                else:
                    out.append(ch)
            return "".join(out) + ": "
    return None


def printed_value(field: str, value: str, ocr_rest: str) -> str:
    """The checked value in its printed layout. OCR spacing is NOT trusted (CTC models drop and move spaces):
    Aadhaar numbers are printed 4-4-4; dates use the separator the OCR saw (/ - .); names and other values are taken
    exactly as the person typed them in the review form."""
    digits = re.sub(r"\D", "", value)
    if field == "documentNumber" and re.fullmatch(r"[2-9]\d{11}", digits) and len(norm(value)) == 12:
        return f"{digits[:4]} {digits[4:8]} {digits[8:]}"
    m = re.fullmatch(r"(\d{2})[/\-.](\d{2})[/\-.](\d{4})", value)
    if m:
        sep = next((c for c in ocr_rest if c in "/-."), "/")
        return sep.join(m.groups())
    return value.strip()


def best_field(text: str, fields: dict[str, str]) -> tuple[str, str, float] | None:
    """(field, true line text, score) for the checked field this detected line carries, or None.
    The line must hold the WHOLE value (similarity >= MATCH_MIN and length within 25%), optionally after a known label."""
    best = None
    prefix_m = LABEL_PREFIX.match(text)
    parts = [("", text)]
    if prefix_m and prefix_m.end() < len(text):
        canon = canonical_prefix(text[:prefix_m.end()])
        if canon is None:
            return None  # a label we cannot re-spell with certainty
        parts = [(canon, text[prefix_m.end():])]
    for name, value in fields.items():
        if name in SKIP_FIELDS or not value:
            continue
        candidates = dob_variants(value) if name.lower().startswith("dob") or "birth" in name.lower() else [value]
        for cand in candidates:
            nv = norm(cand)
            if len(nv) < 3:
                continue
            for prefix, rest in parts:
                nr = norm(rest)
                if not nr or abs(len(nr) - len(nv)) > 0.25 * len(nv):
                    continue
                score = char_acc(nr, nv)
                if score >= MATCH_MIN and (best is None or score > best[2]):
                    best = (name, (prefix + printed_value(name, cand, rest)).strip(), score)
    return best


TESS_LANG = {"devanagari": "hin", "gujarati": "guj"}


def review_lines(detected: list[dict], label: dict, img=None, tess=None) -> tuple[list[dict], dict]:
    """Detected lines that carry a field the person checked. A field typed in Devanagari or Gujarati (added in the review
    form with "+ Add a field", e.g. nameHindi) is matched by re-reading the unmatched lines with Tesseract (hin / guj),
    because the Latin RapidOCR model cannot read those scripts; the TRUE text is still the person's value."""
    fields = {f["field"]: nfc(f["final"]) for f in label.get("fields", []) if f.get("final") and not f.get("notOnCard")}
    lines, used, free = [], set(), []
    for det in detected:
        hit = best_field(nfc(det["text"]), {k: v for k, v in fields.items() if k not in used})
        if hit:
            used.add(hit[0])
            lines.append({"quad": det["quad"], "text": hit[1], "field": hit[0], "source": "review"})
        else:
            free.append(det)
    local = {k: v for k, v in fields.items() if k not in used and script_of(v) in TESS_LANG}
    if local and tess is not None and img is not None:
        have = tess.languages()
        for det in free:
            if not local:
                break
            crop = crop_quad(img, det["quad"])
            for k, v in list(local.items()):
                lang = TESS_LANG[script_of(v)]
                if lang not in have:
                    continue
                text, _ = tess.read(crop, lang)
                hit = best_field(nfc(text), {k: v})
                if hit:
                    lines.append({"quad": det["quad"], "text": hit[1], "field": k, "source": "review"})
                    del local[k]
                    break
    return lines, fields


# ------------------------------------------------------------------ guest keys and the split
def guest_keys(fields: dict[str, str]) -> list[str]:
    """Keys that tie photos to one guest. Joining two different guests is harmless (they just share a split); missing a join
    would leak a person into two splits. So the name alone is a key too (a voter card has no date of birth, an Aadhaar back
    has no name): two guests with the same name always land in the same split."""
    keys = []
    number = norm(fields.get("documentNumber", ""))
    if len(number) >= 6:
        keys.append("id:" + number)
    name = " ".join(sorted(norm(w) for w in re.split(r"\s+", fields.get("name", "")) if norm(w)))
    if len(name) >= 4:
        keys.append(f"n:{name}")
    dob = fields.get("dob", "")
    if name and dob:
        keys.append(f"nd:{name}|{dob}")
    return keys


class Union:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def join(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def assign_splits(records: list[dict], seed: int, ratios=(0.8, 0.1, 0.1), unkeyed: str = "drop",
                  frozen: dict[str, str] | None = None, salt: bytes = b"") -> dict[str, str]:
    """photo -> split. records: [{photo, docType, keys:[plain keys], dhash}]. Plain keys stay in memory only."""
    uf = Union()
    for r in records:
        nodes = [f"k:{k}" for k in r["keys"]] + ([f"h:{r['dhash']}"] if r.get("dhash") else [])
        uf.find(f"p:{r['photo']}")
        for n in nodes:
            uf.join(f"p:{r['photo']}", n)
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        groups[uf.find(f"p:{r['photo']}")].append(r)
    out: dict[str, str] = {}
    by_type: dict[str, list[tuple[str, list[dict]]]] = defaultdict(list)
    for root, members in groups.items():
        keys = sorted({k for m in members for k in m["keys"]})
        if not keys:
            if unkeyed == "train":
                for m in members:
                    out[m["photo"]] = "train"
            continue  # dropped: cannot be tied to a guest
        if frozen:
            old = {frozen.get(hkey(salt, "guest", k)) for k in keys} - {None}
            if old:
                split = sorted(old, key=SPLITS.index)[-1] if len(old) > 1 else old.pop()  # a conflict goes to the rarer split
                for m in members:
                    out[m["photo"]] = split
                continue
        dtype = Counter(m["docType"] for m in members).most_common()
        dtype = sorted(dtype, key=lambda kv: (-kv[1], kv[0]))[0][0]
        order = hashlib.sha256(f"{seed}:{keys[0]}".encode()).hexdigest()
        by_type[dtype].append((order, members))
    for dtype, items in by_type.items():
        items.sort(key=lambda t: t[0])
        n = len(items)
        n_test = round(n * ratios[2]) if n >= 10 else (1 if n >= 3 else 0)
        n_val = round(n * ratios[1]) if n >= 10 else (1 if n >= 5 else 0)
        for i, (_, members) in enumerate(items):
            split = "test" if i < n_test else "val" if i < n_test + n_val else "train"
            for m in members:
                out[m["photo"]] = split
    return out


def leak_check(records: list[dict], splits: dict[str, str]) -> list[str]:
    """Keys or picture hashes found in more than one split (must be empty)."""
    seen: dict[str, set] = defaultdict(set)
    for r in records:
        s = splits.get(r["photo"])
        if not s:
            continue
        for k in r["keys"] + ([f"h:{r['dhash']}"] if r.get("dhash") else []):
            seen[k].add(s)
    return [k for k, v in seen.items() if len(v) > 1]


# ------------------------------------------------------------------ main build
def load_jsonl(path: Path | None) -> dict[str, dict]:
    out = {}
    if path and Path(path).exists():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if line.strip():
                rec = json.loads(line)
                out[rec["photo"]] = rec
    return out


def build(photos: Path, out: Path, labels: Path | None = None, pseudo: Path | None = None, seed: int = 1947,
          ratios=(0.8, 0.1, 0.1), unkeyed: str = "drop", keep_splits: bool = False, limit: int = 0, ocr=None,
          quiet: bool = False, limits: "guard.Limits | None" = None, stop: "guard.StopFlag | None" = None, tess=None) -> dict:
    reason = refuse_inside_repo(out)
    if reason:
        raise SystemExit(f"refused: {reason}")
    limits = limits or guard.Limits.from_env()
    n_photos = sum(1 for _ in iter_photos(photos)) if not limit else limit
    disk = guard.check_disk(out, int(n_photos * BYTES_PER_PHOTO), limits)
    if disk:
        raise SystemExit(f"refused: {disk}")
    photos, out = Path(photos).resolve(), Path(out).resolve()
    if out == photos or photos in out.parents:
        raise SystemExit("refused: the output folder must not be inside the photo folder (photos stay read-only)")
    if out.exists() and any(out.iterdir()) and not keep_splits:
        raise SystemExit("refused: the output folder is not empty (use a new folder, or --keep-splits to rebuild with the same split)")
    frozen: dict[str, str] = {}
    if keep_splits and (out / "manifest.jsonl").exists():
        for line in (out / "manifest.jsonl").read_text(encoding="utf-8").splitlines():
            rec = json.loads(line)
            for k in rec.get("keys", []):
                frozen[k] = rec["split"]
    salt = load_or_create_salt(out)
    review, pseudo_recs = load_jsonl(labels), load_jsonl(pseudo)
    if review and ocr is None:
        from common import RapidLines
        ocr = RapidLines()
    if tess is None and review:
        from common import TesseractLine
        t = TesseractLine(tessdata=os.environ.get("TRAIN_TESSDATA", r"D:\hmst\tessdata" if Path(r"D:\hmst\tessdata").is_dir() else ""))
        tess = t if t.available() else None
    counts = Counter()
    records, cards = [], {}
    for i, path in enumerate(iter_photos(photos)):
        if (limit and i >= limit) or (stop and stop.stopped):
            break
        guard.wait_for_ram(limits, stop=stop)
        rel = path.relative_to(photos).as_posix()
        lab, ps = review.get(rel) or review.get(path.name), pseudo_recs.get(rel)
        counts["photos"] += 1
        if not lab and not ps:
            counts["skippedNoLabel"] += 1
            continue
        img = read_image(path)
        if img is None:
            counts["unreadable"] += 1
            continue
        lines, fields, dtype = [], {}, "unknown"
        if lab:
            dtype = lab.get("expectedType") or lab.get("detectedType") or "unknown"
            if hasattr(ocr, "for_photo"):  # test engines that replay invented ground truth
                ocr.for_photo(path.name)
            got, fields = review_lines(ocr(img), lab, img, tess)
            lines += got
        if ps:
            dtype = dtype if lab else (ps.get("docType") or "unknown")
            for k, v in (ps.get("fields") or {}).items():
                fields.setdefault(k, v)
            taken = {ln.get("field") for ln in lines if ln.get("field")}
            for ln in ps.get("lines", []):
                if ln.get("field") and ln["field"] in taken:
                    continue
                lines.append({"quad": ln["quad"], "text": nfc(ln["text"]), "field": ln.get("field"), "source": "pseudo:" + ln.get("rule", "")})
        lines = [ln for ln in lines if ln["text"]]
        if not lines:
            counts["noUsableLine"] += 1
            continue
        card = hkey(salt, "photo", rel)[:16]
        records.append({"photo": rel, "docType": dtype, "keys": guest_keys(fields), "dhash": dhash(img)})
        cards[rel] = {"card": card, "path": path, "docType": dtype, "lines": lines, "fields": fields}
        if not quiet and counts["photos"] % 200 == 0:
            print(f"\r{counts['photos']} photos read", end="", flush=True)
    splits = assign_splits(records, seed, ratios, unkeyed, frozen, salt)
    leaks = leak_check(records, splits)
    if leaks:
        raise SystemExit(f"internal error: {len(leaks)} guest key(s) in two splits; nothing was written")
    files = {s: open(out / f"rec_gt_{s}.txt", "w", encoding="utf-8", newline="\n") for s in SPLITS}
    per_script = {}
    meta = {s: open(out / f"lines_{s}.jsonl", "w", encoding="utf-8") for s in SPLITS}
    fmeta = {s: open(out / f"fields_{s}.jsonl", "w", encoding="utf-8") for s in SPLITS}
    manifest = open(out / "manifest.jsonl", "w", encoding="utf-8")
    try:
        for rec in records:
            split = splits.get(rec["photo"])
            if not split:
                counts["droppedUnkeyed"] += 1
                continue
            c = cards[rec["photo"]]
            img = read_image(c["path"])
            quads = [q for ln in c["lines"] for q in ln["quad"]]
            xs, ys = [p[0] for p in quads], [p[1] for p in quads]
            h, w = img.shape[:2]
            mx, my = 0.04 * (max(xs) - min(xs)) + 10, 0.04 * (max(ys) - min(ys)) + 10
            x0, y0, x1, y1 = (max(0, int(min(xs) - mx)), max(0, int(min(ys) - my)), min(w, int(max(xs) + mx)), min(h, int(max(ys) + my)))
            write_image(out / "cards" / split / f"{c['card']}.jpg", img[y0:y1, x0:x1], 92)
            field_lines = defaultdict(list)
            for n, ln in enumerate(c["lines"]):
                rel_line = f"lines/{split}/{c['card']}_{n:02d}.png"
                crop = crop_quad(img, ln["quad"])
                if min(crop.shape[:2]) < 4:
                    counts["tinyLine"] += 1
                    continue
                write_image(out / rel_line, crop)
                script = script_of(ln["text"])
                files[split].write(f"{rel_line}\t{ln['text']}\n")
                key = (split, script)
                if key not in per_script:
                    per_script[key] = open(out / f"rec_gt_{split}_{script}.txt", "w", encoding="utf-8", newline="\n")
                per_script[key].write(f"{rel_line}\t{ln['text']}\n")
                meta[split].write(json.dumps({"image": rel_line, "card": c["card"], "docType": c["docType"], "script": script,
                                              "field": ln.get("field"), "source": ln["source"]}) + "\n")
                if ln.get("field"):
                    field_lines[ln["field"]].append(rel_line)
                counts[f"lines_{split}"] += 1
                counts[f"lines_{split}_{script}"] += 1
                counts["src_" + ln["source"].split(":")[0]] += 1
            fmeta[split].write(json.dumps({"card": c["card"], "docType": c["docType"], "fields": c["fields"],
                                           "fieldLines": field_lines}, ensure_ascii=False) + "\n")
            manifest.write(json.dumps({"card": c["card"], "split": split, "docType": c["docType"],
                                       "keys": [hkey(salt, "guest", k) for k in rec["keys"]],
                                       "photo": hkey(salt, "photo", rec["photo"]), "lines": len(c["lines"]),
                                       "fields": sorted(c["fields"])}) + "\n")
            counts[f"cards_{split}"] += 1
            counts[f"cards_{split}_{c['docType']}"] += 1
    finally:
        for fh in [*files.values(), *meta.values(), *fmeta.values(), *per_script.values(), manifest]:
            fh.close()
    groups = Counter()
    seen_group = set()
    for rec in records:
        s = splits.get(rec["photo"])
        g = tuple(sorted(rec["keys"]))
        if s and g and (g, s) not in seen_group:
            seen_group.add((g, s))
            groups[s] += 1
    summary = {"seed": seed, "ratios": list(ratios), "unkeyed": unkeyed, **dict(sorted(counts.items())),
               "distinctKeySetsPerSplit": dict(groups), "leaks": 0}
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--photos", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--labels")
    ap.add_argument("--pseudo")
    ap.add_argument("--seed", type=int, default=1947)
    ap.add_argument("--ratios", type=float, nargs=3, default=(0.8, 0.1, 0.1))
    ap.add_argument("--unkeyed", choices=("drop", "train"), default="drop")
    ap.add_argument("--keep-splits", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    guard.add_args(ap)
    a = ap.parse_args()
    limits = guard.apply(guard.from_args(a))
    stop = guard.StopFlag()
    if abs(sum(a.ratios) - 1) > 1e-6:
        print("ratios must add up to 1")
        return 2
    warn = long_path_warning(Path(a.out))
    if warn:
        print(warn)
    s = build(Path(a.photos), Path(a.out), Path(a.labels) if a.labels else None, Path(a.pseudo) if a.pseudo else None,
              a.seed, tuple(a.ratios), a.unkeyed, a.keep_splits, a.limit, limits=limits, stop=stop)
    print()
    for k, v in s.items():
        print(f"{k:32s} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
