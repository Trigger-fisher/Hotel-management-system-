# copied from reader on 2026-11-04
"""RapidOCR adapter (PP-OCR models run by onnxruntime, CPU only). Primary engine when installed.

The pip package ships Chinese+English (so Latin) models. Devanagari needs its own recognition model and dictionary:
download them yourself and point INTAKE_READ_RAPID_DEVANAGARI_REC and INTAKE_READ_RAPID_DEVANAGARI_KEYS at the files; without
them this engine declines Devanagari and Tesseract reads it. Models are loaded ONCE per worker process."""
from __future__ import annotations

import importlib.util
import os

import numpy as np

from .base import OcrLine, Osd


def _threads() -> int:
    """onnxruntime threads per model: INTAKE_OCR_THREADS, else the CPUs this process may use (a container's CPU set), else its
    own default. Changed in intake-worker on 2026-11-05 (a process pinned to 4 of 6 cores ran 6 threads)."""
    raw = os.environ.get("INTAKE_OCR_THREADS", "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else 0


def available() -> bool:
    return importlib.util.find_spec("rapidocr_onnxruntime") is not None


class RapidEngine:
    name = "rapidocr"

    def __init__(self) -> None:
        from rapidocr_onnxruntime import RapidOCR  # imported late: loads onnxruntime
        threads = _threads()
        extra = {"intra_op_num_threads": threads} if threads else {}
        self._latin = RapidOCR(**extra)
        self._devanagari = None
        rec, keys = os.environ.get("INTAKE_READ_RAPID_DEVANAGARI_REC", ""), os.environ.get("INTAKE_READ_RAPID_DEVANAGARI_KEYS", "")
        if rec and keys and os.path.exists(rec) and os.path.exists(keys):
            self._devanagari = RapidOCR(rec_model_path=rec, rec_keys_path=keys, **extra)

    def supports(self, script: str) -> bool:
        return script in ("Latin", "CJK") or (script == "Devanagari" and self._devanagari is not None)

    def recognize(self, img: np.ndarray, scripts: list[str], hints, whitelist=None, psm=None, upright: bool = False) -> list[OcrLine]:
        """`upright`: the picture is known to be upright (a card the cutter turned), so the per-line turn check is skipped (speed,
        intake-worker 5 Nov 2026)."""
        if whitelist:  # MRZ-only reads need a character whitelist, which this engine does not offer
            return []
        engine = self._devanagari if "Devanagari" in scripts and self._devanagari else self._latin
        result, _ = engine(img, use_cls=False) if upright else engine(img)
        lines = []
        for box, text, conf in result or []:
            xs, ys = [p[0] for p in box], [p[1] for p in box]
            lines.append(OcrLine(text, (min(xs), min(ys), max(xs), max(ys)), float(conf), None, self.name))
        return lines

    def read_line(self, img: np.ndarray) -> str:
        """One text line already cut out (no detection, no turn): the MRZ pass (app/readcore/mrzpass.py, 2026-11-05)."""
        if img.ndim == 2:
            img = np.repeat(img[..., None], 3, axis=2)
        if img.shape[0] < 4 or img.shape[1] < img.shape[0]:  # not a line of text: the recogniser cannot scale it
            return ""
        try:
            result, _ = self._latin(img, use_det=False, use_cls=False, use_rec=True)
        except Exception:  # noqa: BLE001 - an extra reading never breaks the read
            return ""
        return str(result[0][0]) if result else ""

    def osd(self, img: np.ndarray) -> Osd | None:
        return None
