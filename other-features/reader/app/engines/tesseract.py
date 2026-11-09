"""Tesseract through its command line (argument lists only, no shell). Used as the backup engine
and for orientation and script detection (OSD)."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

from ..scripts import OSD_NAMES, SCRIPTS
from .base import OcrLine, Osd

WINDOWS_DEFAULT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
RUN_TIMEOUT = 120


class TesseractEngine:
    name = "tesseract"

    def __init__(self, exe: str, tessdata: str = "") -> None:
        self.exe, self.tessdata = exe, tessdata
        self._langs: set[str] | None = None

    @classmethod
    def find(cls, exe: str = "", tessdata: str = "") -> "TesseractEngine | None":
        candidate = exe or shutil.which("tesseract") or (WINDOWS_DEFAULT if Path(WINDOWS_DEFAULT).exists() else "")
        return cls(candidate, tessdata) if candidate and Path(candidate).exists() else None

    # ---- what is installed ---------------------------------------------------
    def languages(self) -> set[str]:
        if self._langs is None:
            if self.tessdata:
                self._langs = {p.stem for p in Path(self.tessdata).glob("*.traineddata")}
            else:
                out = self._run(["--list-langs"]).stdout.decode("utf-8", "replace").splitlines()[1:]
                self._langs = {line.strip() for line in out if line.strip()}
        return self._langs

    def supports(self, script: str) -> bool:
        return script in SCRIPTS and SCRIPTS[script].tesseract.split("+")[0] in self.languages()

    # ---- running -----------------------------------------------------------------
    def _run(self, args: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        if self.tessdata:
            env["TESSDATA_PREFIX"] = self.tessdata
        return subprocess.run([self.exe, *args], capture_output=True, timeout=RUN_TIMEOUT, check=False,
                              shell=False, env=env, cwd=cwd)

    def _lang_string(self, scripts: list[str], hints: dict[str, list[str]]) -> str:
        have = self.languages()
        codes: list[str] = []
        for script in scripts:
            for code in hints.get(script, []) + [SCRIPTS[script].tesseract]:
                if code in have and code not in codes:
                    codes.append(code)
        if "eng" in have and "eng" not in codes:
            codes.append("eng")  # digits and Latin words appear next to every script
        return "+".join(codes) or "eng"

    def recognize(self, img: np.ndarray, scripts: list[str], hints: dict[str, list[str]],
                  whitelist: str | None = None, psm: int | None = None) -> list[OcrLine]:
        lang = self._lang_string(scripts, hints)
        with tempfile.TemporaryDirectory(prefix="rd-") as tmp:
            path = str(Path(tmp) / "in.png")
            cv2.imwrite(path, img)
            args = [path, "stdout", "-l", lang, "--psm", str(psm or 3)]
            if self.tessdata:
                args += ["--tessdata-dir", self.tessdata]
            if whitelist:
                args += ["-c", f"tessedit_char_whitelist={whitelist}"]
            args += ["-c", "tessedit_create_tsv=1"]  # same as the tsv config, without needing the configs folder
            done = self._run(args)
        if done.returncode != 0:
            return []
        return parse_tsv(done.stdout.decode("utf-8", "replace"), self.name)

    def osd(self, img: np.ndarray) -> Osd | None:
        if "osd" not in self.languages():
            return None
        with tempfile.TemporaryDirectory(prefix="rd-") as tmp:
            path = str(Path(tmp) / "in.png")
            cv2.imwrite(path, img)
            args = [path, "stdout", "--psm", "0", "-l", "osd"]
            if self.tessdata:
                args += ["--tessdata-dir", self.tessdata]
            done = self._run(args)
        text = done.stdout.decode("utf-8", "replace")
        rotate = re.search(r"Rotate:\s*(\d+)", text)
        if done.returncode != 0 or not rotate:
            return None
        script = re.search(r"Script:\s*(\w+)", text)
        conf = re.search(r"Orientation confidence:\s*([\d.]+)", text)
        return Osd(int(rotate.group(1)) % 360, OSD_NAMES.get(script.group(1)) if script else None,
                   min(1.0, float(conf.group(1)) / 15.0) if conf else 0.0)


def parse_tsv(tsv: str, engine: str) -> list[OcrLine]:
    """Words (level 5) grouped into lines by (block, paragraph, line)."""
    groups: dict[tuple[int, int, int], list[tuple[str, float, int, int, int, int]]] = {}
    for row in tsv.splitlines()[1:]:
        cols = row.split("\t")
        if len(cols) < 12 or cols[0] != "5":
            continue
        text, conf = cols[11].strip(), float(cols[10])
        if not text or conf < 0:
            continue
        left, top, width, height = (int(c) for c in cols[6:10])
        groups.setdefault((int(cols[2]), int(cols[3]), int(cols[4])), []).append((text, conf, left, top, width, height))
    lines = []
    for words in groups.values():
        words.sort(key=lambda w: w[2])
        total = sum(len(w[0]) for w in words)
        conf = sum(w[1] * len(w[0]) for w in words) / total / 100.0
        x0, y0 = min(w[2] for w in words), min(w[3] for w in words)
        x1, y1 = max(w[2] + w[4] for w in words), max(w[3] + w[5] for w in words)
        lines.append(OcrLine(" ".join(w[0] for w in words), (x0, y0, x1, y1), conf, None, engine))
    return lines
