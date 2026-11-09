"""Speed check on invented pictures, pinned to 4 CPU cores (the KVM 4 server). Run from the compressor folder:

    .venv\\Scripts\\python.exe scripts\\bench.py            (Windows)
    .venv/bin/python scripts/bench.py                     (Linux)

Prints, per invented case: result size, notes and seconds; then the time for the whole set run one job at a time and
run on 4 worker processes at once (what the service does with COMPRESSOR_MAX_CONCURRENCY=4). No file is read from disk
and nothing is written: every picture is drawn in code."""
from __future__ import annotations

import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
CORES = 4


def pin(cores: int = CORES) -> str:
    """Limit this process (and the workers it starts) to the first `cores` CPUs."""
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ.setdefault(name, "1")
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


def cases():
    from tests.conftest import noisy_photo, pdf_with_image, photo_like, text_like, to_bytes

    def jpeg(img, q=95):
        return to_bytes(img, "JPEG", quality=q)

    out = [
        ("photo 1200x900", jpeg(photo_like(1200, 900, 1), 97), "balanced", "auto"),
        ("photo 2000x1500 jpeg", jpeg(photo_like(2000, 1500, 2), 97), "balanced", "jpeg"),
        ("photo 2000x1500 strict", jpeg(photo_like(2000, 1500, 2), 97), "strict", "jpeg"),
        ("noisy 1000x750", jpeg(noisy_photo(1000, 750, 4.0, 4)), "balanced", "auto"),
        ("noisy 1800x1350 over cap", jpeg(noisy_photo(1800, 1350, 9.0)), "balanced", "jpeg"),
        ("text page", to_bytes(text_like(), "PNG", compress_level=1), "balanced", "auto"),
        ("pdf with photo", pdf_with_image(photo_like(1800, 1200)), "balanced", "auto"),
        ("pdf over cap", pdf_with_image(noisy_photo(1800, 1350, 9.0)), "balanced", "auto"),
    ]
    return out


def one(case):
    from app.jobs import run_job
    from app.limits import Limits

    name, data, mode, output = case
    t = time.perf_counter()
    o = run_job(data, mode, output, Limits())
    return name, len(data), o.result_bytes, ",".join(o.notes), time.perf_counter() - t


def main() -> None:
    print(pin())
    work = cases()
    t0 = time.perf_counter()
    for row in map(one, work):
        print(f"{row[0]:26s} {row[1] / 1024:8.0f} KB -> {row[2] / 1024:6.0f} KB  {row[4]:6.2f}s  {row[3]}")
    serial = time.perf_counter() - t0
    t0 = time.perf_counter()
    with ProcessPoolExecutor(CORES) as pool:
        list(pool.map(one, work))
    parallel = time.perf_counter() - t0
    print(f"one at a time: {serial:.1f}s   {CORES} workers: {parallel:.1f}s   ({len(work)} jobs)")


if __name__ == "__main__":
    main()
