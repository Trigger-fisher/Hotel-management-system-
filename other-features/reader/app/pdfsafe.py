# copied from intake-worker on 2026-11-05
"""PDFium is not thread-safe: two threads inside it at once (even on two different documents) corrupt its heap, and a PDFium
object left to the garbage collector is closed in whatever thread happens to collect it. Every PDFium call in this process
holds LOCK, and every document, page, text page and bitmap is closed while it is held. At exit the lock is taken for good
before pypdfium2 unloads the library, so no thread is still inside it (the intake worker's full test run crashed with
Windows heap corruption 0xc0000374 before its copy of this lock)."""
from __future__ import annotations

import atexit
import threading

import numpy as np
import pypdfium2  # noqa: F401  imported first: its own exit handler then runs after ours

LOCK = threading.RLock()
EXIT_WAIT = 30.0  # seconds the exit waits for a thread still drawing a page


def render(page, scale: float) -> np.ndarray:
    """The page drawn at `scale` as an RGB array of its own (the bitmap is closed before this returns). Call with LOCK held."""
    bitmap = page.render(scale=scale)
    try:
        pixels = np.array(bitmap.to_numpy(), copy=True)
        mode = bitmap.mode
    finally:
        bitmap.close()
    if pixels.ndim == 2:
        return np.repeat(pixels[..., None], 3, axis=2)
    if mode in ("BGR", "BGRA", "BGRX"):
        pixels = pixels[..., [2, 1, 0]]
    return np.ascontiguousarray(pixels[..., :3])


def _hold_at_exit() -> None:
    LOCK.acquire(timeout=EXIT_WAIT)


atexit.register(_hold_at_exit)
