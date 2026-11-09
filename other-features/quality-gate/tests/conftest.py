from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
KEY = "g" * 40
os.environ.setdefault("GATE_KEY", KEY)


def png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr if arr.ndim == 2 else arr[..., ::-1]).save(buf, "PNG")
    return buf.getvalue()


def jpeg(arr: np.ndarray, quality=90) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr if arr.ndim == 2 else arr[..., ::-1]).save(buf, "JPEG", quality=quality)
    return buf.getvalue()
