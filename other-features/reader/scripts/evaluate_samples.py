"""Run the reader over MJ's real sample files and print ONLY aggregate numbers.

  python scripts/evaluate_samples.py [--samples PATH] [--limit N] [--workers N] [--fresh]

The folder comes from --samples, else the env variable SAMPLES_DIR, else ../samples-local (git-ignored).
It is opened READ-ONLY and never copied, uploaded or modified. Nothing recognised and no file name is
ever printed or written. Progress is saved in a small state file of counters, so an interrupted run resumes.
Does nothing when the folder is missing or empty."""
from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".heic", ".heif", ".avif", ".pdf"}
STATE = Path(__file__).with_name(".evaluate-state.json")  # git-ignored; counters only
SAVE_EVERY = 25


def walk(root: Path):
    """Recursive, sorted, streaming: yields one path at a time, never a full list."""
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


def warn_if_tracked_area(path: Path) -> None:
    try:
        top = subprocess.run(["git", "-C", str(path), "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False)
        if top.returncode != 0:
            return
        ignored = subprocess.run(["git", "-C", str(path), "check-ignore", "-q", str(path)], check=False)
        if ignored.returncode != 0:
            print("WARNING: the samples folder is inside a git repository and is not git-ignored. Move it out or ignore it.")
    except OSError:
        pass


def evaluate_one(path_str: str):
    """Worker: read ONE file (opened read-only) and return numbers only."""
    from app.config import WorkerConfig
    from app.jobs import run_job
    cfg = WorkerConfig(tessdata=os.environ.get("READER_TESSDATA", str(ROOT / ".tessdata")))
    started = time.monotonic()
    try:
        with open(path_str, "rb") as fh:
            data = fh.read()
        result = run_job(data, cfg, [], os.environ.get("EVAL_MODE", "fast"), True)
    except Exception:  # noqa: BLE001 - corrupt or unreadable files are only counted
        return {"error": True}
    scripts = sorted({l["script"] for l in result["lines"] if l["script"]})
    return {"error": False, "pages": result["pages"], "confidence": result["confidence"], "scripts": scripts,
            "blurry": "blurry" in result["flags"], "human": result["needsHumanCheck"],
            "noText": "noTextFound" in result["flags"], "ms": (time.monotonic() - started) * 1000}


def fresh_state() -> dict:
    return {"done": 0, "errors": 0, "pages": 0, "conf_sum": 0.0, "conf_n": 0, "blurry": 0, "human": 0, "no_text": 0,
            "ms": 0.0, "scripts": {}}


def add(state: dict, r: dict) -> None:
    state["done"] += 1
    if r["error"]:
        state["errors"] += 1
        return
    state["pages"] += r["pages"]
    state["ms"] += r["ms"]
    state["blurry"] += r["blurry"]
    state["human"] += r["human"]
    state["no_text"] += r["noText"]
    if not r["noText"]:
        state["conf_sum"] += r["confidence"]
        state["conf_n"] += 1
    for s in r["scripts"]:
        state["scripts"][s] = state["scripts"].get(s, 0) + 1


def report(state: dict) -> None:
    ok = state["done"] - state["errors"]
    pct = lambda n: f"{100 * n / ok:.1f}%" if ok else "n/a"  # noqa: E731
    print(f"files read: {state['done']} (unreadable: {state['errors']}), pages: {state['pages']}")
    print(f"average confidence: {state['conf_sum'] / state['conf_n']:.3f}" if state["conf_n"] else "average confidence: n/a")
    print(f"flagged blurry: {pct(state['blurry'])}   needsHumanCheck: {pct(state['human'])}   no text found: {pct(state['no_text'])}")
    print(f"time per page: {state['ms'] / state['pages']:.0f} ms" if state["pages"] else "time per page: n/a")
    print("files per script: " + (", ".join(f"{k}={v}" for k, v in sorted(state["scripts"].items())) or "none"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--samples", help="folder of sample files (default: SAMPLES_DIR, else ../samples-local)")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many files in total (0 = all)")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    parser.add_argument("--fresh", action="store_true", help="ignore the saved progress and start again")
    args = parser.parse_args()
    folder = Path(args.samples or os.environ.get("SAMPLES_DIR") or ROOT / "samples-local")
    if not folder.is_dir():
        print("No samples folder found: nothing to do.")
        return 0
    first = next(walk(folder), None)
    if first is None:
        print("The samples folder has no images or PDFs: nothing to do.")
        return 0
    warn_if_tracked_area(folder)
    state = fresh_state()
    if not args.fresh and STATE.exists():
        state = json.loads(STATE.read_text())
    skip = state["done"]
    todo = (p for i, p in enumerate(walk(folder)) if i >= skip and (not args.limit or i < args.limit))
    with multiprocessing.Pool(args.workers) as pool:
        # imap (ordered) with chunksize 1: at most one file per worker at a time, and done is always an exact prefix, so resuming is exact.
        for n, result in enumerate(pool.imap(evaluate_one, (str(p) for p in todo), chunksize=1), 1):
            add(state, result)
            if n % SAVE_EVERY == 0:
                STATE.write_text(json.dumps(state))
    STATE.write_text(json.dumps(state))
    report(state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
