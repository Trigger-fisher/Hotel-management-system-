"""Measure MJ's real photos and print ONLY aggregate numbers, to tune the thresholds.

  python scripts/calibrate.py [--samples PATH] [--profile id-card] [--reject-rate 0.05] [--workers N] [--fresh] [--limit N]

The folder comes from --samples, else the env variable SAMPLES_DIR, else ../samples-local (git-ignored).
It is opened READ-ONLY; nothing is copied, uploaded or modified. No file name and no content is printed or
written. Memory is bounded: files are streamed one per worker, and each score keeps a fixed-size random sample
(reservoir) for percentiles. A small state file of counters and samples makes an interrupted run resumable.
Does nothing when the folder is missing or empty."""
from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import random
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".heic", ".heif", ".avif", ".pdf"}
STATE = Path(__file__).with_name(".calibrate-state.json")  # git-ignored; counters and score samples only
RESERVOIR = 5000
SAVE_EVERY = 100
SCORES = ("blurLaplacian", "blurGradient", "brightness", "contrast", "p99", "p1", "glare", "noise", "blockiness",
          "contentShare", "borderContent", "shortSide", "effectiveDpi", "aspect")
# For --reject-rate: which scores make a picture worse when LOW and which when HIGH.
LOW_IS_BAD = {"blurLaplacian", "blurGradient", "brightness", "contrast", "p99", "contentShare", "shortSide", "effectiveDpi"}


def walk(root: Path):
    """Recursive, sorted, streaming: one path at a time, never a list of all of them."""
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
        if subprocess.run(["git", "-C", str(path), "rev-parse", "--show-toplevel"], capture_output=True, check=False).returncode != 0:
            return
        if subprocess.run(["git", "-C", str(path), "check-ignore", "-q", str(path)], check=False).returncode != 0:
            print("WARNING: the samples folder is inside a git repository and is not git-ignored. Move it out or ignore it.")
    except OSError:
        pass


def measure_one(args):
    """Worker: ONE file opened read-only. Returns numbers, never names or content."""
    path, profile = args
    from app.jobs import WorkerConfig, run_check
    try:
        with open(path, "rb") as fh:
            data = fh.read()
        result = run_check(data, WorkerConfig(max_bytes=500 * 1024 * 1024), profile)
    except Exception:  # noqa: BLE001 - corrupt or unsupported files are only counted
        return {"error": True}
    scores = result["scores"]
    if not scores and result["pages"]:  # a PDF: use its worst page for each score
        scores = {k: min((p["scores"].get(k) for p in result["pages"] if k in p["scores"]), default=None) for k in SCORES}
    return {"error": False, "verdict": result["verdict"], "codes": sorted({r["code"] for r in result["reasons"] if r["severity"] != "info"}),
            "scores": {k: scores[k] for k in SCORES if scores.get(k) is not None}}


def fresh_state() -> dict:
    return {"done": 0, "errors": 0, "verdicts": {}, "codes": {}, "seen": {k: 0 for k in SCORES}, "samples": {k: [] for k in SCORES}}


def add(state: dict, r: dict, rng: random.Random) -> None:
    state["done"] += 1
    if r["error"]:
        state["errors"] += 1
        return
    state["verdicts"][r["verdict"]] = state["verdicts"].get(r["verdict"], 0) + 1
    for code in r["codes"]:
        state["codes"][code] = state["codes"].get(code, 0) + 1
    for key, value in r["scores"].items():
        state["seen"][key] += 1
        sample, n = state["samples"][key], state["seen"][key]
        if len(sample) < RESERVOIR:
            sample.append(value)
        elif (j := rng.randrange(n)) < RESERVOIR:  # reservoir sampling keeps memory fixed
            sample[j] = value


def report(state: dict, profile: str, reject_rate: float) -> None:
    ok = state["done"] - state["errors"]
    print(f"profile: {profile}   files measured: {ok}   unreadable: {state['errors']}")
    if not ok:
        return
    print("verdicts at the current thresholds: " + ", ".join(f"{k}={100 * v / ok:.1f}%" for k, v in sorted(state["verdicts"].items())))
    print("reasons (share of files): " + (", ".join(f"{k}={100 * v / ok:.1f}%" for k, v in sorted(state["codes"].items())) or "none"))
    print(f"{'score':16s}{'p1':>10s}{'p5':>10s}{'p25':>10s}{'p50':>10s}{'p75':>10s}{'p95':>10s}{'p99':>10s}   suggested limit for {reject_rate:.0%} reject rate")
    for key in SCORES:
        values = np.array(state["samples"][key], dtype=float)
        if not len(values):
            continue
        pct = np.percentile(values, [1, 5, 25, 50, 75, 95, 99])
        limit = np.percentile(values, 100 * reject_rate) if key in LOW_IS_BAD else np.percentile(values, 100 * (1 - reject_rate))
        print(f"{key:16s}" + "".join(f"{v:10.2f}" for v in pct) + f"   {'<' if key in LOW_IS_BAD else '>'} {limit:.2f}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--samples", help="folder of sample files (default: SAMPLES_DIR, else ../samples-local)")
    parser.add_argument("--profile", default="generic")
    parser.add_argument("--reject-rate", type=float, default=0.05)
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--fresh", action="store_true")
    args = parser.parse_args()
    folder = Path(args.samples or os.environ.get("SAMPLES_DIR") or ROOT / "samples-local")
    if not folder.is_dir() or next(walk(folder), None) is None:
        print("No samples found: nothing to do.")
        return 0
    warn_if_tracked_area(folder)
    state = fresh_state() if args.fresh or not STATE.exists() else json.loads(STATE.read_text())
    rng = random.Random(state["done"])
    skip = state["done"]
    todo = ((str(p), args.profile) for i, p in enumerate(walk(folder)) if i >= skip and (not args.limit or i < args.limit))
    with multiprocessing.Pool(args.workers) as pool:
        for n, result in enumerate(pool.imap(measure_one, todo, chunksize=1), 1):  # ordered: `done` is an exact prefix
            add(state, result, rng)
            if n % SAVE_EVERY == 0:
                STATE.write_text(json.dumps(state))
    STATE.write_text(json.dumps(state))
    report(state, args.profile, args.reject_rate)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
