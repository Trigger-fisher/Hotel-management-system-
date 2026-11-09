"""Shared fixtures. Every test uses INVENTED cards drawn by scripts/make_invented.py; no real photo is ever read."""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import make_invented  # noqa: E402


@pytest.fixture(scope="session")
def invented(tmp_path_factory):
    root = tmp_path_factory.mktemp("inv")
    make_invented.generate(root, guests=24, seed=11)
    truth = [json.loads(x) for x in (root / "truth.jsonl").read_text(encoding="utf-8").splitlines()]
    return {"root": root, "photos": root / "photos", "labels": root / "labels.jsonl", "truth": truth}


class TruthOcr:
    """A fake OCR engine that returns the drawn lines with typical OCR slips (dropped spaces, one wrong character),
    so the alignment and split logic can be tested without the real engine."""

    def __init__(self, truth: list[dict], slips: bool = True, seed: int = 3) -> None:
        self.by_size: dict = {}
        self.queue = {t["photo"]: t for t in truth}
        self.slips, self.rng = slips, random.Random(seed)
        self.current: str | None = None

    def for_photo(self, name: str):
        self.current = name
        return self

    def __call__(self, img) -> list[dict]:
        t = self.queue[self.current]
        out = []
        for ln in t["lines"]:
            text = ln["text"]
            if self.slips and self.rng.random() < 0.5:
                text = text.replace(" ", "", 1)
            if self.slips and self.rng.random() < 0.3 and len(text) > 6:
                i = self.rng.randrange(len(text))
                text = text[:i] + ("0" if text[i] == "O" else "O" if text[i] == "0" else text[i]) + text[i + 1:]
            out.append({"quad": ln["quad"], "text": text, "conf": 0.95})
        return out


@pytest.fixture
def truth_ocr():
    return TruthOcr
