# copied from intake-worker on 2026-11-05
"""Fetch the card cutter's segmentation model and check its SHA-256.

    python scripts/get_model.py [--arch vit_t|vit_b] [--from PATH] [--to PATH]

vit_t (the default since 5 Nov 2026): MobileSAM (Kyung Hee University, Apache-2.0), 38.8 MB.
vit_b: Segment Anything vit_b (Meta, Apache-2.0), 375 MB; set READER_CARDCUT_ARCH=vit_b to use it.
A local copy is used instead of downloading when one is given (--from) or found at a known place; either way the
file must match the recorded SHA-256 or it is deleted. The target defaults to READER_CARDCUT_MODEL, else models/<file> in this
folder (git-ignored)."""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "vit_t": {"url": "https://github.com/ChaoningZhang/MobileSAM/raw/f706ad9c4eb7f219c00d9050e46328518ffb65d2/weights/mobile_sam.pt",
              "sha256": "6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f",  # computed 2026-11-05 from the file at URL
              "size": 40_728_226, "file": "mobile_sam.pt", "local": ()},
    "vit_b": {"url": "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
              "sha256": "ec2df62732614e57411cdcf32a23ffdf28910380d03139ee0f4fcbe91eb8c912",  # computed 2026-11-04 from the file at URL
              "size": 375_042_383, "file": "sam_vit_b.pth", "local": (Path(r"D:\sam-test\sam_vit_b.pth"),)},
}
MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
# kept for callers of the older single-model script
URL, SHA256, SIZE = MODELS["vit_b"]["url"], MODELS["vit_b"]["sha256"], MODELS["vit_b"]["size"]
DEFAULT = MODELS_DIR / MODELS["vit_t"]["file"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(target: Path, source: Path | None = None, arch: str = "vit_t") -> str:
    """Put a verified model file at `target`. Returns how it got there: 'present', 'copied' or 'downloaded'."""
    spec = MODELS[arch]
    if target.is_file() and target.stat().st_size == spec["size"] and sha256(target) == spec["sha256"]:
        return "present"
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    candidates = [source] if source else [p for p in spec["local"] if p.is_file()]
    how = "downloaded"
    if candidates and candidates[0] and candidates[0].is_file():
        shutil.copyfile(candidates[0], part)
        how = "copied"
    else:
        with urllib.request.urlopen(spec["url"], timeout=60) as resp, part.open("wb") as out:  # https, fixed host
            shutil.copyfileobj(resp, out, 1 << 20)
    got = sha256(part)
    if got != spec["sha256"]:
        part.unlink(missing_ok=True)
        raise SystemExit(f"model checksum mismatch ({how}): expected {spec['sha256']}, got {got}; file removed")
    os.replace(part, target)
    return how


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--arch", choices=sorted(MODELS), default=os.environ.get("READER_CARDCUT_ARCH", "").strip() or "vit_t")
    ap.add_argument("--from", dest="source", type=Path, default=None, help="a local copy to use instead of downloading")
    ap.add_argument("--to", dest="target", type=Path, default=None)
    args = ap.parse_args(argv)
    target = args.target or Path(os.environ.get("READER_CARDCUT_MODEL", "").strip() or MODELS_DIR / MODELS[args.arch]["file"])
    print(f"{fetch(target, args.source, args.arch)}: {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
