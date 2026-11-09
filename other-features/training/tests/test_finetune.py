"""Fine-tune driver: dataset check, config, PaddleOCR loader proof and a tiny real fine-tune (skipped without the toolchain)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import finetune_rec as ft
from common import write_image

PADDLEOCR = Path(ft.DEFAULT_PADDLEOCR)
HAVE_TOOLCHAIN = (PADDLEOCR / "tools" / "train.py").exists() and Path(ft.DEFAULT_PYTHON).exists()


def make_dataset(root: Path) -> Path:
    import numpy as np
    img = np.full((48, 200, 3), 255, np.uint8)
    for name in ("a", "b", "c"):
        write_image(root / "lines" / "train" / f"{name}.png", img)
    write_image(root / "lines" / "val" / "v.png", img)
    (root / "rec_gt_train_latin.txt").write_text("lines/train/a.png\tKiran Shah\nlines/train/b.png\tबहुत\n"
                                                 "lines/train/missing.png\tX Y\nlines/train/c.png\t" + "A" * 60 + "\n", encoding="utf-8")
    (root / "rec_gt_val_latin.txt").write_text("lines/val/v.png\tDOB: 01/02/1990\n", encoding="utf-8")
    return root


def test_dataset_check_filters_unknown_characters_missing_images_and_long_lines(tmp_path):
    ds = make_dataset(tmp_path / "ds")
    work = tmp_path / "w"
    work.mkdir()
    d = tmp_path / "dict.txt"
    d.write_text("\n".join("KiranShDOB:/0123456789A"), encoding="utf-8")
    r = ft.check_dataset(ds, "latin", d, work)
    assert r["train"] == {"lines": 4, "kept": 1, "missingImage": 1, "unreadable": 0, "unknownChars": 1, "tooLong": 1, "empty": 0}
    assert (work / "train.txt").read_text(encoding="utf-8") == "lines/train/a.png\tKiran Shah\n"
    assert r["val"]["kept"] == 1


@pytest.mark.skipif(not HAVE_TOOLCHAIN, reason="PaddleOCR training code / Paddle not installed")
def test_config_uses_simple_dataset_and_our_files(tmp_path):
    import yaml
    ds = make_dataset(tmp_path / "ds")
    work = tmp_path / "w"
    work.mkdir()
    ft.check_dataset(ds, "latin", PADDLEOCR / ft.MODELS["latin"]["dict"], work)
    cfg = yaml.safe_load(ft.write_config(PADDLEOCR, "latin", ds, work, 2, 4, 1e-4, False, None, ft.guard.Limits(), 1).read_text(encoding="utf-8"))
    assert cfg["Train"]["dataset"]["name"] == "SimpleDataSet" and "sampler" not in cfg["Train"]
    assert cfg["Train"]["loader"]["num_workers"] == 0 and cfg["Train"]["loader"]["batch_size_per_card"] == 4
    assert cfg["Global"]["max_text_length"] == ft.MAX_TEXT and cfg["Global"]["save_epoch_step"] == 2
    assert any("RecResizeImg" in t for t in cfg["Train"]["dataset"]["transforms"])


@pytest.mark.skipif(not HAVE_TOOLCHAIN, reason="PaddleOCR training code / Paddle not installed")
def test_tiny_finetune_smoke_run_exports_a_working_onnx(invented, truth_ocr, tmp_path):
    """A few real training steps on invented line crops, export to ONNX, and the ONNX reads the crops."""
    import build_dataset as bd
    ds = tmp_path / "ds"
    bd.build(invented["photos"], ds, labels=invented["labels"], ocr=truth_ocr(invented["truth"], slips=False), quiet=True)
    import time
    work = Path(r"D:\hmst\runs") / f"pytest-smoke-{time.strftime('%m%d-%H%M%S')}"  # a fresh run (an old one would resume)
    cmd = [sys.executable, str(Path(ft.__file__)), "--dataset", str(ds), "--script", "latin", "--work", str(work),
           "--smoke-steps", "6", "--batch", "4", "--checkpoint-minutes", "0.002"]
    done = subprocess.run(cmd, capture_output=True, timeout=1800, check=False)
    log = done.stdout.decode(errors="replace")
    assert done.returncode == 0, log[-2000:] + done.stderr.decode(errors="replace")[-2000:]
    run = json.loads((work / "run.json").read_text(encoding="utf-8"))
    assert run["trainExit"] == 0 and Path(run["onnx"]).exists()
    assert "BatchNorm statistics frozen" in log or (work / "out" / "timed.pdparams").exists()
    assert (work / "out" / "timed.pdparams").exists() and (work / "out" / "timed.states").exists()  # time-based checkpoint
    assert run["onnxCheck"]["lines"] > 0 and run["onnxCheck"]["meanCharAcc"] > 0.5
    import onnxruntime as ort
    meta = ort.InferenceSession(run["onnx"]).get_modelmeta().custom_metadata_map
    assert len(meta["character"].splitlines()) == 6623  # RapidOCR can load it without a keys file
