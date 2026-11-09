from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
KEY = "r" * 40
os.environ.setdefault("READER_KEY", KEY)
TESSDATA = ROOT / ".tessdata"


def real_config():
    from app.config import WorkerConfig
    return WorkerConfig(tessdata=str(TESSDATA) if TESSDATA.exists() else "")


def real_engines():
    from app.engines import load_engines
    return load_engines(real_config())


HAVE_TESSERACT = any(e.name == "tesseract" for e in real_engines())


def have_langs(*langs: str) -> bool:
    for e in real_engines():
        if e.name == "tesseract":
            return all(code in e.languages() for code in langs)
    return False


needs_tesseract = pytest.mark.skipif(not HAVE_TESSERACT, reason="Tesseract is not installed")
needs_indic = pytest.mark.skipif(not have_langs("hin", "guj", "osd"), reason="hin/guj/osd language data missing")
