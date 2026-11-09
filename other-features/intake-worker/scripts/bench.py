"""Speed check of the two parts of a job on INVENTED cards, pinned to 4 CPUs (the KVM 4 server). Run from the intake-worker folder:

    .venv\\Scripts\\python.exe scripts\\bench.py [--runs 20] [--cases single,pair-photo,pair-scan,sheet10] [--fast-only] [--dump out.json]

Cases: one Aadhaar-like card, front and back as two phone photos (pair-photo) or two 300 dpi A4 scans (pair-scan), the front
alone (single), and 300 dpi A4 sheets of two, four and ten cards, invented guests front and back (sheet2, sheet4, sheet10). Every
picture is drawn in code; nothing is read from disk except the models. Each case runs once to warm the models, then --runs times;
prints p50, p95, min and max seconds of the FAST part (the form is ready) and of the BACKGROUND part (the picture is saved), the
median of each step, the people in the form, and the whole PC's CPU load while the case ran. --fast-only times the fast part alone.
INTAKE_OCR_THREADS is set to 4 unless given. --dump writes every case's results (timings left out, the final pictures as SHA-256)
so two versions of the code can be compared."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
CORES = 4


def pin(cores: int = CORES) -> str:
    if hasattr(os, "sched_setaffinity"):
        os.sched_setaffinity(0, set(range(cores)))
        return f"pinned to CPUs 0-{cores - 1} (sched_setaffinity)"
    if sys.platform == "win32":
        import ctypes
        kernel = ctypes.windll.kernel32
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        if kernel.SetProcessAffinityMask(ctypes.c_void_p(kernel.GetCurrentProcess()), ctypes.c_size_t((1 << cores) - 1)):
            return f"pinned to CPUs 0-{cores - 1} (SetProcessAffinityMask)"
    return "NOT pinned (no affinity call on this system)"


def _jpeg(bgr, quality: int = 90) -> bytes:
    import cv2
    return cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])[1].tobytes()


def _phone_photo(card, seed: int):
    """A phone-like photo (2400 x 1800) of one card lying on a desk, turned a little, with mild keystone and noise."""
    import cv2
    import numpy as np
    from tests.cardsheet import place_card
    rng = np.random.default_rng(seed)
    W, H, ppm = 2400, 1800, 17.5
    desk = np.full((H, W, 3), (196, 204, 210), np.float32) + np.linspace(-10, 10, W, dtype=np.float32)[None, :, None]
    rgba = np.dstack([np.asarray(card.convert("RGB"))[..., ::-1], np.full(card.size[::-1], 255, np.uint8)])
    rgba = cv2.resize(rgba, (int(85.6 * ppm), int(54 * ppm)), interpolation=cv2.INTER_AREA)
    place_card(desk, rgba, (W / 2 + rng.uniform(-60, 60), H / 2 + rng.uniform(-40, 40)), 0, float(rng.uniform(1.5, 4) * rng.choice([-1, 1])),
               None, ppm, 0.008, rng)
    img = cv2.GaussianBlur(np.clip(desk, 0, 255).astype(np.uint8), (0, 0), 0.8).astype(np.float32) + rng.normal(0, 2.0, desk.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def cases() -> dict[str, list[bytes]]:
    import numpy as np
    from PIL import Image
    from tests import faces as F
    from tests import sheets as S

    def front(i: int):
        img = np.asarray(S.front(S.GUESTS[i], with_qr=False).convert("RGB"))
        return Image.fromarray(F.put_photo(img, F.photo(F.identity(i + 2), 0), (40, 190, 190, 370)))

    g = S.GUESTS[0]
    scan = lambda card, seed: _jpeg(S.sleeved_sheet([card], seed=seed, cut_last=False)[0])  # noqa: E731
    cards10 = [c for i in range(5) for c in (front(i), S.back(S.GUESTS[i]))]
    return {
        "single": [_jpeg(_phone_photo(front(0), 1))],
        "pair-photo": [_jpeg(_phone_photo(front(0), 1)), _jpeg(_phone_photo(S.back(g), 2))],
        "pair-scan": [scan(front(0), 3), scan(S.back(g), 4)],
        "sheet2": [_jpeg(S.sleeved_sheet(cards10[:2], seed=5, cut_last=False)[0])],
        "sheet4": [_jpeg(S.sleeved_sheet(cards10[:4], seed=5, cut_last=False)[0])],
        "sheet10": [_jpeg(S.sleeved_sheet(cards10, seed=5, cut_last=False)[0])],
    }


class Load:
    """The whole PC's CPU load (all cores, every program) sampled every half second while a case runs."""

    def __init__(self) -> None:
        import threading
        self.samples: list[float] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        try:
            import psutil
        except ImportError:
            return
        psutil.cpu_percent(None)
        while not self._stop.wait(0.5):
            self.samples.append(psutil.cpu_percent(None))

    def __enter__(self) -> "Load":
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._thread.join()

    def text(self) -> str:
        if not self.samples:
            return "PC load not measured (psutil missing)"
        s = sorted(self.samples)
        return f"PC load {s[len(s) // 10]:.0f}-{s[min(len(s) - 1, (9 * len(s)) // 10)]:.0f} % (p10-p90), median {statistics.median(s):.0f} %"


def canonical(out) -> list:
    """The results without timings, each final picture as its SHA-256: equal for two versions that decide the same."""
    items = out if isinstance(out, list) else [out]
    rows = []
    for values, blob in items:
        v = {k: x for k, x in values.items() if k != "timings"}
        rows.append({"values": v, "picture": hashlib.sha256(blob).hexdigest(), "bytes": len(blob)})
    return rows


def _p95(times: list[float]) -> float:
    times = sorted(times)
    return times[min(len(times) - 1, int(round(0.95 * len(times))) - 1)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--cases", default="single,pair-photo,pair-scan,sheet10")
    ap.add_argument("--dump", default="")
    ap.add_argument("--fast-only", action="store_true")
    args = ap.parse_args()
    print(pin())
    os.environ.setdefault("INTAKE_OCR_THREADS", str(CORES))  # as on the 4-core server: one onnxruntime thread per core
    from app.config import Settings
    from app.pipeline import Deps, Pipeline
    from app.readcore.config import WorkerConfig
    from app.readcore.engines import load_engines

    tessdata = ROOT / ".tessdata"
    td = str(tessdata) if tessdata.exists() else ""
    engines = load_engines(WorkerConfig(tessdata=td))
    pipe = Pipeline(Deps(Settings(allow_no_av=True, tessdata=td), engines))
    job = {"id": "bench", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": 512_000, "languages": None}
    made = cases()
    dump = {}

    def both(files):
        t0 = time.perf_counter()
        fast = pipe.fast(files, dict(job))
        t1 = time.perf_counter()
        if args.fast_only:
            return fast, [(p, b"") for p in fast.people], t1 - t0, 0.0
        out = pipe.background(fast.handoff, dict(job), fast.people)
        return fast, out if fast.handoff.multi else out[0], t1 - t0, time.perf_counter() - t1

    for name in args.cases.split(","):
        files = made[name]
        _, out, f0, b0 = both(files)
        dump[name] = canonical(out)
        form, saved, steps, bsteps = [], [], {}, {}
        with Load() as load:
            for _ in range(args.runs):
                fast, out, f, b = both(files)
                form.append(f)
                saved.append(b)
                for step, ms in fast.people[0]["timings"]["steps"].items():
                    steps.setdefault(step, []).append(ms)
                first = (out if isinstance(out, list) else [out])[0][0]
                for step, ms in ((first.get("timings") or {}).get("background") or {}).get("steps", {}).items():
                    bsteps.setdefault(step, []).append(ms)
                if canonical(out) != dump[name]:
                    print(f"  {name}: a run gave a different result")
        people = len(out) if isinstance(out, list) else 1
        cards = (fast.people[0].get("person") or {}).get("cardsFound")
        print(f"{name:11s} form people {len(fast.people):2d} (cards {cards}), saved people {people:2d}  first run: form {f0:5.1f} s, "
              f"saved {b0:5.1f} s later ({len(form)} runs after it); {load.text()}")
        print(f"            FORM READY (fast part)  p50 {statistics.median(form):5.2f} s  p95 {_p95(form):5.2f} s  "
              f"min {min(form):5.2f}  max {max(form):5.2f}")
        print("            fast steps (median ms): " + ", ".join(f"{k} {int(statistics.median(v))}" for k, v in steps.items()))
        if args.fast_only:
            continue
        print(f"            BACKGROUND (saving)     p50 {statistics.median(saved):5.2f} s  p95 {_p95(saved):5.2f} s  "
              f"min {min(saved):5.2f}  max {max(saved):5.2f}")
        total = [a + b for a, b in zip(form, saved)]
        print(f"            both parts              p50 {statistics.median(total):5.2f} s  p95 {_p95(total):5.2f} s")
        print("            background steps (median ms): " + ", ".join(f"{k} {int(statistics.median(v))}" for k, v in bsteps.items()))
    if args.dump:
        Path(args.dump).write_text(json.dumps(dump, sort_keys=True, indent=1, default=str), encoding="utf-8")
        print(f"results written to {args.dump}")


if __name__ == "__main__":
    main()
