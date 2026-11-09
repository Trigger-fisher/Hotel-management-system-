"""Speed of one check on INVENTED pictures, the process pinned to 4 cores (MJ, 5 Nov 2026: under 0.3 s per picture).

    python scripts/bench.py [--cores 4] [--repeat 5]

Prints the median and worst seconds per picture and profile. Pictures: a 12 MP phone-style JPEG of an invented card on a table
(id-card), the same of an invented page (document), a 12 MP sheet of 8 invented cards (multi-id), and a 1000 px scan (generic).
No file name or content is printed."""
from __future__ import annotations

import argparse
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def pin(cores: int) -> int:
    """Pin this process to the first `cores` logical processors. Returns how many it is pinned to (0 when it cannot)."""
    mask = (1 << cores) - 1
    try:
        if hasattr(os, "sched_setaffinity"):
            os.sched_setaffinity(0, set(range(cores)))
            return cores
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        k32.SetProcessAffinityMask.argtypes = (wintypes.HANDLE, ctypes.c_size_t)
        k32.SetProcessAffinityMask.restype = wintypes.BOOL
        if k32.SetProcessAffinityMask(k32.GetCurrentProcess(), mask):
            return cores
        print(f"could not pin (Windows error {ctypes.get_last_error()})")
        return 0
    except (OSError, AttributeError):
        return 0


def pictures() -> dict[str, tuple[bytes, str]]:
    import cv2
    import numpy as np

    from tests.conftest import jpeg, png
    from tests.idcards import card, on_table
    from tests.imaging import random_lines, scene, text_page
    from tests.test_gate import sheet
    out = {}
    photo = on_table(card(1), frame=(3000, 4000), scale=0.55, seed=1)
    out["id-card 12 MP jpeg"] = (jpeg(photo, 92), "id-card")
    page = np.asarray(text_page(random_lines(1, 14), size=(2000, 2600), font_size=76))
    doc, _ = scene(page, frame=(3000, 4000), scale=0.8, seed=2)
    out["document 12 MP jpeg"] = (jpeg(doc, 92), "document")
    out["multi-id 12 MP jpeg (8 cards)"] = (jpeg(cv2.resize(sheet(8), (4000, 3000)), 92), "multi-id")
    out["generic 1000 px png"] = (png(page[:1000, :800]), "generic")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cores", type=int, default=4)
    ap.add_argument("--repeat", type=int, default=5)
    args = ap.parse_args()
    pinned = pin(args.cores)
    from app.jobs import WorkerConfig, run_check, set_threads
    set_threads(args.cores)
    cfg = WorkerConfig()
    print(f"pinned to {pinned or 'all'} cores")
    print("wall = elapsed time (depends on what else the machine runs); cpu = this process's CPU time over all its threads,\n"
          "an upper bound of the wall time on an otherwise idle machine")
    worst = {"wall": 0.0, "cpu": 0.0}
    for label, (data, profile) in pictures().items():
        run_check(data, cfg, profile)  # warm-up
        walls, cpus = [], []
        for _ in range(args.repeat):
            t, c = time.perf_counter(), time.process_time()
            run_check(data, cfg, profile)
            walls.append(time.perf_counter() - t)
            cpus.append(time.process_time() - c)
        wall, cpu = statistics.median(walls), statistics.median(cpus)
        worst = {"wall": max(worst["wall"], wall), "cpu": max(worst["cpu"], cpu)}
        print(f"{label:32s} median wall {wall:.3f} s   cpu {cpu:.3f} s   (worst wall {max(walls):.3f} s)")
    print(f"slowest median: wall {worst['wall']:.3f} s, cpu {worst['cpu']:.3f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
