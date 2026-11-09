# copied from intake-worker on 2026-11-04 (target folder from READER_FACE_MODELS_DIR)
"""Fetch the photo check's two face models from the opencv_zoo repository (pinned commit) and check their SHA-256.

    python scripts/get_face_models.py [--from FOLDER] [--to FOLDER]

  * YuNet face detector, face_detection_yunet_2026may.onnx: MIT licence ("All files in this directory are licensed under MIT
    License", models/face_detection_yunet/README.md and LICENSE, Copyright (c) 2020 Shiqi Yu), checked 2026-11-04 at the commit below.
  * SFace face recogniser, face_recognition_sface_2021dec.onnx: Apache-2.0 ("All files in this directory are licensed under Apache
    2.0 License", models/face_recognition_sface/README.md and LICENSE), checked 2026-11-04 at the commit below.
No InsightFace or other model with a non-commercial licence is used.

A local copy is used instead of downloading when a folder is given (--from); either way each file must match its recorded SHA-256
or it is deleted. The target folder defaults to READER_FACE_MODELS_DIR, else models/faces in this folder (git-ignored)."""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import urllib.request
from pathlib import Path

COMMIT = "48b10fa505aeb51fbd127fc60a5c660040e823b7"  # opencv/opencv_zoo main on 2026-11-04
BASE = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{COMMIT}/models"
FILES = {  # file name -> (path in the repository, SHA-256, size, licence)
    "face_detection_yunet_2026may.onnx": ("face_detection_yunet", "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0", 229_738, "MIT"),
    "face_recognition_sface_2021dec.onnx": ("face_recognition_sface", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79", 38_696_353, "Apache-2.0"),
}
DEFAULT = Path(__file__).resolve().parents[1] / "models" / "faces"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_one(name: str, folder: Path, source: Path | None = None) -> str:
    """Put one verified model file into `folder`. Returns 'present', 'copied' or 'downloaded'."""
    sub, digest, size, _ = FILES[name]
    target = folder / name
    if target.is_file() and target.stat().st_size == size and sha256(target) == digest:
        return "present"
    folder.mkdir(parents=True, exist_ok=True)
    part = target.with_name(name + ".part")
    if source is not None and (source / name).is_file():
        shutil.copyfile(source / name, part)
        how = "copied"
    else:
        with urllib.request.urlopen(f"{BASE}/{sub}/{name}", timeout=60) as resp, part.open("wb") as out:  # https, fixed host
            shutil.copyfileobj(resp, out, 1 << 20)
        how = "downloaded"
    got = sha256(part)
    if got != digest:
        part.unlink(missing_ok=True)
        raise SystemExit(f"{name}: checksum mismatch ({how}): expected {digest}, got {got}; file removed")
    os.replace(part, target)
    return how


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="source", type=Path, default=None, help="a local folder holding the two files")
    ap.add_argument("--to", dest="target", type=Path, default=None)
    args = ap.parse_args(argv)
    folder = args.target or Path(os.environ.get("READER_FACE_MODELS_DIR", "").strip() or DEFAULT)
    for name in FILES:
        print(f"{fetch_one(name, folder, args.source)}: {folder / name} ({FILES[name][3]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
