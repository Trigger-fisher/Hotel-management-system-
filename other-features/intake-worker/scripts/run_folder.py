"""Run the worker's pipeline over a LOCAL folder of guest ID files, without a database and without any upload.

  python scripts/run_folder.py --in "D:\\HMS-training-data\\GUEST ID ALL" --out "D:\\HMS-Processed-IDs" --limit 50 --seed 1

Same steps as the worker, in its two parts: the FAST part (real type, virus scan when INTAKE_CLAMD points at a clamd, pixel
re-save, quality gate, find the card without the model, read, check) and the BACKGROUND part (model cutter, pairing, enhance,
merge front/back, compress to the cap: default 500 KB, SSIM >= 0.98). Nothing is encrypted or uploaded. The report gives the
form-ready moment (form_seconds) and the saved moment (saved_seconds); --progress logs a "read" event when the form could fill.

* The input folder is opened READ-ONLY and walked as a stream (no list of all files); --limit with --seed takes a random sample
  of that stream (reservoir sampling), so even a huge folder needs little memory.
* A picture (or PDF page) that holds SEVERAL cards gives one final picture PER PERSON: front on top, back below (--multi auto, the
  default, switches when two or more cards are found; on / off force it). --pool also pairs cards ACROSS the files of one folder
  (fronts on one sheet, backs on another): every folder is then one job.
* The final picture is written as FirstName_LastName_IdName.<ext> into --out (a second one with the same name gets _2, _3 ...).
  Files whose name could not be read are called Unknown_<IdName>.
* The console shows only counts. --out gets report.csv and report.html (input paths and flags, one row per input, or per person
  for a multi-card input; field VALUES are never written, only filled/empty): they stay on your PC. --out must not be inside this
  repository. Real photos are never copied into the repository."""
from __future__ import annotations

import argparse
import csv
import html
import json
import os
import random
import threading
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import naming  # noqa: E402

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
STEPS = ["type", "scan", "rebuild", "gate", "read", "enhance", "merge", "compress"]
MULTI_STEPS = ["type", "scan", "rebuild", "gate", "find", "read", "inspect", "group", "cut", "enhance", "merge", "compress"]
ID_NAMES = naming.ID_NAMES
FIELDS = ("name", "dob", "gender", "documentNumber", "address")
POOL_MAX_FILES = 20  # a folder pooled into one job holds at most this many files (else each file is its own job)


def walk(root: Path):
    """Recursive, sorted, streaming; yields one path at a time."""
    stack = [root]
    while stack:
        folder = stack.pop()
        try:
            entries = sorted(os.scandir(folder), key=lambda e: e.name)
        except OSError:
            continue
        dirs = []
        for entry in entries:
            if entry.is_dir(follow_symlinks=False):
                dirs.append(Path(entry.path))
            elif Path(entry.name).suffix.lower() in EXTENSIONS:
                yield Path(entry.path)
        stack.extend(reversed(dirs))


def sample(paths, limit: int, seed: int):
    """Reservoir sample of `limit` paths from a stream (all of them when limit is 0), kept in folder order."""
    if not limit:
        yield from paths
        return
    rng, reservoir = random.Random(seed), []
    for n, path in enumerate(paths):
        if len(reservoir) < limit:
            reservoir.append((n, path))
        elif (j := rng.randrange(n + 1)) < limit:
            reservoir[j] = (n, path)
    yield from (p for _, p in sorted(reservoir))


def clean(part: str) -> str:
    return naming.clean(part)


def output_name(fields: dict, doc_type: str, ext: str, taken: set[str], rare: bool = False) -> str:
    """FirstName_LastName_IdName.ext; the last word of the name is the last name; _Rare at the end for MJ's RARE case."""
    return naming.unique(naming.stem(fields, doc_type, rare), ext, taken)


def passed_steps(error_step: str | None, steps: list[str] = STEPS) -> list[str]:
    if error_step in steps:
        return steps[:steps.index(error_step)]
    return [] if error_step else list(steps)


def inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def pick_clamd() -> str:
    """INTAKE_CLAMD (or the local default) when a clamd answers; '' = not running, the scan step is recorded as skipped."""
    from app.clam import ClamClient
    address = os.environ.get("INTAKE_CLAMD", "tcp:127.0.0.1:3310")
    try:
        return address if ClamClient(address, 3.0).version() else ""  # version() is None when clamd does not answer
    except Exception:  # noqa: BLE001 - any failure to reach clamd means "not running"
        return ""


def make_pipeline(clamd: str):
    from app.config import Settings
    from app.pipeline import Deps, Pipeline
    from app.readcore.config import WorkerConfig as ReadConfig
    from app.readcore.engines import load_engines
    settings = Settings(database_url="", master_key=b"", clamd=clamd, allow_no_av=not clamd, threads=1,
                        auto_enhance=os.environ.get("AUTO_ENHANCE", "true").strip().lower() != "false",
                        tessdata=os.environ.get("INTAKE_TESSDATA", str(ROOT / ".tessdata")),
                        read_qr=os.environ.get("INTAKE_READ_QR", "false").strip().lower() == "true")
    engines = load_engines(ReadConfig(tessdata=settings.tessdata))
    return Pipeline(Deps(settings, engines))


def filled(fields: dict) -> str:
    """Which fields were read, never their values."""
    return " ".join(f"{k}:{'filled' if (fields.get(k) or {}).get('value') else 'empty'}" for k in FIELDS)


def _ext(fmt: str) -> str:
    return "png" if fmt == "png" else "webp" if fmt == "webp" else "jpg"


def clarity_columns(values: dict) -> dict:
    """Clarity grade (the worst card) and, per card, its grade and reasons; the photo outcomes. Fixed phrases and numbers only:
    no field value, no name, never a face embedding."""
    c = values.get("clarity") or {}
    cards = " | ".join(f"card {x['card']} {x['side']}: {x['grade']}" + (f" ({'; '.join(x['reasons'])})" if x["reasons"] else "")
                       for x in c.get("cards", []))
    photo = values.get("photo") or {}
    portraits = " ".join(f"card {x['card']}: {x['status']}" + (f" ({'; '.join(x['reasons'])})" if x.get("reasons") else "")
                         for x in photo.get("portraits", []))
    checks = " ".join(f"{x.get('use')} {x.get('outcome')}" + (f" {x['score']:.2f}" if x.get("score") is not None else "")
                      for x in photo.get("checks", []))
    return {"clarity": c.get("grade", ""), "clarity_cards": cards, "unclear_fields": " ".join(c.get("unclearFields", [])),
            "retake": c.get("advice") or "", "photo": (portraits + (" / " + checks if checks else "")).strip()}


def _times(values: dict) -> dict:
    """The form-ready moment (fast part) and the saved moment (fast + background part), in seconds."""
    t = values.get("timings") or {}
    form = (t.get("formMs") or 0) / 1000
    return {"form_seconds": round(form, 2), "saved_seconds": round(form + ((t.get("background") or {}).get("ms") or 0) / 1000, 2)}


def _disagreements(values: dict) -> str:
    """What the background part saw differently from the form: codes and field NAMES only, never a value."""
    found = (values.get("background") or {}).get("disagreements") or []
    return " ".join(d["code"] + (":" + d["field"] if d.get("field") else "") for d in found)


def _person_row(values: dict, blob: bytes, skipped: list[str]) -> dict:
    p = values["person"]
    rejected = values.get("status") == "rejected"  # MJ's photo rule: the card is refused, no picture is saved
    row = {**clarity_columns(values), "possible_same_guest": "+".join(map(str, p.get("possibleSameGuestAs", []))),
           "suggested_partner": "+".join(map(str, p.get("suggestedPartner", []))),
           "rare": "yes" if values.get("rare") else "", "paired_by_position": "yes" if p.get("pairedByPosition") else "",
           "steps_passed": ">".join(s for s in values["steps"] if s not in skipped), "steps_skipped": ">".join(skipped),
           "flags": " ".join(values["flags"]), "doc_type": values["document_type"]["type"],
           "person": p["index"], "cards": "+".join(map(str, p["cards"])), "sides": "+".join(p["sides"]), "evidence": p["evidence"],
           "duplicates": "+".join(map(str, p["duplicates"])), "rare_flag": bool(values.get("rare")),
           "guest": p.get("guest", ""), "same_guest_as": "+".join(map(str, p.get("sameGuestAs", [])))}
    if rejected:  # fixed phrases only: the reason per card and the retake line, never a field value
        reasons = "; ".join(f"card {c['card']}: {c['reason']}" for c in values["reject"]["cards"])
        return {**row, "status": "rejected: " + values["reject"]["code"], "blob": None, "fields": {},
                "fmt": "jpeg", "bytes_after": 0, "fixes": "", "filled": "", "retake": values["reject"]["message"],
                "clarity_cards": (row["clarity_cards"] + " | rejected: " + reasons).strip(" |")}
    return {**row, "status": "done" + (" (check)" if values["needs_human_check"] else ""), **_times(values),
            "background": _disagreements(values), "fixes": " ".join(values["scores"].get("enhance", [])),
            "bytes_after": len(blob), "blob": blob, "fields": values["fields"], "fmt": values["scores"]["format"], "filled": filled(values["fields"])}


def run_one(pipeline, gate_action: str, path: Path, cap: int, profile: str, languages, multi: bool | None = None) -> dict:
    """One input file. A multi-card input returns the row with `people`: one row per person (see finish)."""
    from app.errors import StepError
    started = time.perf_counter()
    row = {"input": str(path), "status": "", "steps_passed": "", "steps_failed": "", "steps_skipped": "", "flags": "", "fixes": "",
           "bytes_before": 0, "bytes_after": 0, "seconds": 0.0, "doc_type": "", "blob": None, "fields": {}, "fmt": "jpeg"}
    try:
        with open(path, "rb") as fh:  # read-only
            data = fh.read()
        row["bytes_before"] = len(data)
        job = {"id": "local", "profile": profile, "gate_action": gate_action, "size_cap_bytes": cap, "languages": languages, "multi": multi}
        result = pipeline.analyse([data], job)
        if isinstance(result, list):
            skipped = ["scan"] if result and "ClamAV" not in result[0][0]["scan_engine"] else []
            row["people"] = [_person_row(v, b, skipped) for v, b in result]
            row.update(status="done" if result else "done (no cards)", steps_passed=">".join(s for s in MULTI_STEPS if s not in skipped))
        else:
            values, blob = result
            skipped = ["scan"] if "ClamAV" not in values["scan_engine"] else []
            row.update(status="done" + (" (check)" if values["needs_human_check"] else ""), **_times(values),
                       background=_disagreements(values),
                       steps_passed=">".join(s for s in values["steps"] if s not in skipped), steps_skipped=">".join(skipped),
                       flags=" ".join(values["flags"]), fixes=" ".join(values["scores"].get("enhance", [])), bytes_after=len(blob),
                       doc_type=values["document_type"]["type"], blob=blob, fields=values["fields"], fmt=values["scores"]["format"],
                       filled=filled(values["fields"]), **clarity_columns(values))
    except StepError as err:
        steps = MULTI_STEPS if multi else STEPS
        row.update(status=("rejected: " if err.reject else "error: ") + err.code, steps_passed=">".join(passed_steps(err.step, steps)),
                   steps_failed=err.step or "", flags=err.step or "")
        if err.code == "photo_unclear":  # MJ's photo rule: the retake line for reception
            row["retake"] = err.message
    except Exception as err:  # noqa: BLE001 - one bad file never stops the run
        row.update(status="error: " + type(err).__name__)
    row["seconds"] = round(time.perf_counter() - started, 2)
    return row


def run_pool(pipeline, gate_action: str, paths: list[Path], cap: int, profile: str, languages) -> dict:
    """Several files of one folder as ONE job: the cards of every file are grouped into people together."""
    from app.errors import StepError
    started = time.perf_counter()
    row = {"input": " | ".join(str(p) for p in paths), "status": "", "steps_passed": "", "steps_failed": "", "steps_skipped": "",
           "flags": "", "fixes": "", "bytes_before": 0, "bytes_after": 0, "seconds": 0.0, "doc_type": "", "blob": None, "fields": {}, "fmt": "jpeg"}
    job = {"id": "local", "profile": profile, "gate_action": gate_action, "size_cap_bytes": cap, "languages": languages, "multi": True}
    cards, info, bad = [], None, []
    for path in paths:
        try:
            with open(path, "rb") as fh:  # read-only
                data = fh.read()
            row["bytes_before"] += len(data)
            these, sheet = pipeline.sheet_cards([data], job)
        except StepError as err:
            bad.append(f"{path.name}:{err.code}")
            continue
        except Exception as err:  # noqa: BLE001 - one bad file never stops the pool
            bad.append(f"{path.name}:{type(err).__name__}")
            continue
        pages = info["pages"] if info else 0
        for card in these:  # numbered across the whole pool
            card.index, card.picture = len(cards), card.picture + pages
            cards.append(card)
        info = sheet if info is None else {**info, "pages": pages + sheet["pages"], "flags": list(dict.fromkeys(info["flags"] + sheet["flags"])),
                                           "gate": info["gate"] + sheet["gate"]}
    # File names stay in the report's steps_failed column: the status is summed up on the console, which shows no file names.
    row["steps_failed"] = " ".join(bad)
    try:
        if info is None:
            row.update(status="rejected: " + " ".join(dict.fromkeys(b.rsplit(":", 1)[1] for b in bad)))
        else:
            result = pipeline.people_results(cards, job, None, info)
            skipped = ["scan"] if "ClamAV" not in info["engine"] else []
            row["people"] = [_person_row(v, b, skipped) for v, b in result]
            row.update(status="done" + (" (some files refused)" if bad else ""),
                       steps_passed=">".join(s for s in MULTI_STEPS if s not in skipped))
    except StepError as err:
        row.update(status=("rejected: " if err.reject else "error: ") + err.code, steps_failed=err.step or "")
    except Exception as err:  # noqa: BLE001
        row.update(status="error: " + type(err).__name__)
    row["seconds"] = round(time.perf_counter() - started, 2)
    return row


COLS = ["n", "input", "person", "status", "cards", "sides", "evidence", "paired_by_position", "duplicates", "rare", "guest",
        "same_guest_as", "possible_same_guest", "suggested_partner", "clarity", "clarity_cards", "unclear_fields", "retake", "photo", "steps_passed", "steps_failed", "steps_skipped",
        "flags", "background", "fixes", "filled", "bytes_before", "bytes_after", "form_seconds", "saved_seconds", "seconds", "doc_type", "output"]


def write_report(out: Path, rows: list[dict]) -> None:
    with open(out / "report.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(r.get(c, '')))}</td>" for c in COLS) + "</tr>" for r in rows)
    done = sum(bool(r.get("output")) for r in rows)
    inputs = len({r["input"] for r in rows})
    (out / "report.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Run report</title><style>body{font:14px system-ui;margin:20px}"
        "table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}th{background:#eee}</style>"
        f"<h1>Run report</h1><p>{inputs} inputs, {done} pictures saved. This file stays on this PC (it lists input paths).</p>"
        "<table><tr>" + "".join(f"<th>{c}</th>" for c in COLS) + f"</tr>{body}</table>", encoding="utf-8")


def load_previous(out: Path) -> dict[str, list[dict]]:
    """Resume: rows of an earlier run that finished (saved or rejected), by input (a multi-card input has one row per person);
    errors are tried again."""
    path = out / "report.csv"
    if not path.exists():
        return {}
    found: dict[str, list[dict]] = {}
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            found.setdefault(r["input"], []).append(r)
    return {k: v for k, v in found.items() if all(r["status"].startswith(("done", "rejected")) for r in v)}


def jobs_of(paths, pool: bool):
    """(key, [paths]) per job: one file each, or with --pool one job per folder (up to POOL_MAX_FILES files)."""
    if not pool:
        for p in paths:
            yield str(p), [p]
        return
    folders: dict[Path, list[Path]] = {}
    for p in paths:
        folders.setdefault(p.parent, []).append(p)
    for files in folders.values():
        if 1 < len(files) <= POOL_MAX_FILES:
            yield " | ".join(str(p) for p in files), files
        else:
            for p in files:
                yield str(p), [p]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="src", required=True, help="folder of input files (read-only, recursive)")
    ap.add_argument("--out", required=True, help="folder for the final pictures and the report")
    ap.add_argument("--limit", type=int, default=0, help="random sample of this many files (0 = all)")
    ap.add_argument("--seed", type=int, default=1, help="seed for the random sample")
    ap.add_argument("--workers", type=int, default=1, help="files processed at the same time (default 1)")
    ap.add_argument("--no-resume", action="store_true", help="process everything again (default: skip inputs already finished in report.csv)")
    ap.add_argument("--cap", type=int, default=512_000, help="size cap per picture in bytes (default 512000)")
    ap.add_argument("--profile", default="id-card", choices=["id-card", "document", "photo"])
    ap.add_argument("--gate", default="reject", choices=["reject", "warn"], help="reject blurry files, or warn and carry on")
    ap.add_argument("--languages", default="en,hi,gu", help="reading hints, comma separated")
    ap.add_argument("--multi", default="auto", choices=["auto", "on", "off"], help="one picture per person for multi-card inputs (default auto)")
    ap.add_argument("--pool", action="store_true", help="pair cards across the files of one folder (fronts and backs on different sheets)")
    ap.add_argument("--progress", default="", help="write a live event log (one JSON line per step and result: input path, step, milliseconds, "
                                                   "output name, flags; never a field value) for the flow viewer")
    args = ap.parse_args()
    src, out = Path(args.src), Path(args.out)
    if not src.is_dir():
        print("The input folder does not exist.")
        return 1
    if inside(out, ROOT.parent.parent):
        print("--out must not be inside the repository: real photos and reports never go there.")
        return 1
    out.mkdir(parents=True, exist_ok=True)
    clamd = pick_clamd()
    pipeline = make_pipeline(clamd)
    scan_note = "virus scan: ClamAV" if clamd else "virus scan: SKIPPED (clamd not reachable; set INTAKE_CLAMD=tcp:host:port)"
    languages = [x for x in args.languages.split(",") if x]
    multi = {"auto": None, "on": True, "off": False}[args.multi]
    previous = {} if args.no_resume else load_previous(out)
    taken = {p.stem.lower() for p in out.iterdir() if p.is_file() and p.suffix.lower() in (".jpg", ".png", ".webp")}
    rows: list[dict] = []
    lock = threading.Lock()
    events = threading.Lock()
    progress = Path(args.progress) if args.progress else None
    if progress:
        progress.parent.mkdir(parents=True, exist_ok=True)
        progress.write_text("", encoding="utf-8")

    def emit(event: dict) -> None:
        if progress is None:
            return
        with events, open(progress, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"t": round(time.time(), 2), **event}, ensure_ascii=False) + "\n")

    def save(row: dict) -> None:
        row["output"] = ""
        if row.get("blob") is not None:
            name = output_name(row["fields"], row["doc_type"], _ext(row["fmt"]), taken, bool(row.get("rare_flag")))
            (out / name).write_bytes(row["blob"])
            row["output"] = name
        for key in ("blob", "fields", "fmt", "rare_flag"):
            row.pop(key, None)
        row["n"] = len(rows) + 1
        rows.append(row)
        emit({"event": "saved", **{k: row.get(k, "") for k in ("input", "output", "status", "flags", "doc_type", "sides", "evidence", "cards",
                                                              "bytes_before", "bytes_after", "seconds", "filled", "retake", "clarity",
                                                              "clarity_cards", "photo", "fixes", "rare", "paired_by_position",
                                                              "form_seconds", "saved_seconds", "background")}})

    def finish(row: dict) -> None:
        with lock:
            persons = row.pop("people", None)
            if persons is None:
                save(row)
            elif not persons:
                save({**row, "flags": "noCardsFound"})
            for person in persons or []:  # one row (and one picture) per person, the input's own columns repeated
                save({**{k: row[k] for k in ("input", "steps_failed", "bytes_before", "seconds")}, **person})
            if len(rows) % 25 == 0:
                write_report(out, rows)  # a stopped run keeps its report, so it can resume
            print(f"\r{len(rows)} rows, {sum(bool(r.get('output')) for r in rows)} pictures saved", end="", flush=True)  # counts only

    todo = []
    for key, paths in jobs_of(sample(walk(src), args.limit, args.seed), args.pool):
        if key in previous:
            for old in previous[key]:
                old["n"] = len(rows) + 1
                rows.append(old)
        else:
            todo.append(paths)

    def work(paths: list[Path]) -> dict:
        from app.pipeline import EVENTS
        key = str(paths[0])
        emit({"event": "start", "input": key})
        EVENTS.cb = lambda done, ms, nxt: emit({"event": "step", "input": key, "done": done, "ms": ms, "next": nxt})
        # the form-ready moment: the fast part is done, the fields are known (filled/empty only), the picture is not saved yet
        EVENTS.ready = lambda persons, ms: emit({"event": "read", "input": key, "ms": ms, "people": len(persons),
                                                 "status": " ".join(p.get("status", "") for p in persons),
                                                 "check": sum(bool(p.get("needs_human_check")) for p in persons),
                                                 "filled": filled((persons[0].get("fields") or {}) if persons else {})})
        try:
            if len(paths) > 1:
                return run_pool(pipeline, args.gate, paths, args.cap, args.profile, languages)
            return run_one(pipeline, args.gate, paths[0], args.cap, args.profile, languages, multi)
        finally:
            EVENTS.cb = None
            EVENTS.ready = None

    resumed = len(rows)
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for row in pool.map(work, todo):
            finish(row)
    write_report(out, rows)
    kinds: dict[str, int] = {}
    for r in rows:
        status = str(r["status"])
        kind = status.split(" ")[0] + (" " + status.split(": ")[1].split(" ")[0] if ": " in status else "")
        kinds[kind] = kinds.get(kind, 0) + 1
    saved = sum(bool(r.get("output")) for r in rows)
    print(f"\n{len(todo)} jobs run, {resumed} rows resumed, {saved} pictures saved. Rows: " + ", ".join(f"{k} x{v}" for k, v in sorted(kinds.items()))
          + f". {scan_note}. Report: report.csv and report.html in the output folder.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
