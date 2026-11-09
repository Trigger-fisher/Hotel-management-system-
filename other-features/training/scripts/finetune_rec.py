"""Fine-tunes the PP-OCR TEXT RECOGNITION model that RapidOCR runs, then exports it back to ONNX for the reader.

  python scripts\\finetune_rec.py --dataset D:\\hmsd\\ds1 --script latin --work D:\\hmst\\runs\\latin1 [--dry-run]
        [--epochs 20] [--batch 32] [--lr 0.0002] [--device auto|cpu|gpu] [--smoke-steps N]
        [--paddleocr D:\\hmst\\PaddleOCR] [--python D:\\hmst\\pv\\Scripts\\python.exe]

Toolchain (all Apache-2.0): PaddleOCR's own training code (tools/train.py, tools/export_model.py from the PaddleOCR repository,
pinned tag v3.7.0), PaddlePaddle 3.3.1, paddle2onnx 2.1.0. Base weights:
  latin       PP-OCRv4 mobile recognition (the Chinese+English model RapidOCR ships as ch_PP-OCRv4_rec_infer.onnx), dictionary ppocr_keys_v1.txt
  devanagari  PP-OCRv3 mobile Devanagari recognition, dictionary devanagari_dict.txt
Steps: 1 report the device (CUDA build, GPU count, nvidia-smi)  2 check the dataset (every image decodes, every character is in the
model's dictionary, length limit) and write filtered label files  3 prove the format with PaddleOCR's own data loader (one batch)
4 download the pretrained training weights  5 write the config  6 train under the resource guard (thread caps, below-normal priority,
GPU memory 65%, pause when hot; a checkpoint every epoch, resumes from the last one)  7 export -> ONNX, with the character list
written into the model metadata so RapidOCR loads it without a keys file  8 read a few validation crops with the ONNX model.
--dry-run stops after step 3 (and prints the commands). --smoke-steps N trains on N batches only (tests).
Then run evaluate.py: the model is kept only when it beats the base on the test split and no document type gets worse.
Keep --work on a short path outside the repository (Windows long paths are off). Console output: counts and metrics only."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import guard  # noqa: E402
from common import nfc, read_image, refuse_inside_repo  # noqa: E402

DEFAULT_PADDLEOCR = os.environ.get("TRAIN_PADDLEOCR", r"D:\hmst\PaddleOCR")
DEFAULT_PYTHON = os.environ.get("TRAIN_PADDLE_PYTHON", r"D:\hmst\pg\Scripts\python.exe" if Path(r"D:\hmst\pg\Scripts\python.exe").exists()
                                else r"D:\hmst\pv\Scripts\python.exe")  # pg = paddlepaddle-gpu (CUDA 12.6), pv = CPU build
# paddle2onnx 2.1.0 is bound to the Paddle 3.1 binary interface (it does not load next to 3.2/3.3 on Windows), so the
# conversion runs in its own small venv: paddlepaddle 3.1.0 + paddle2onnx 2.1.0 + onnx.
EXPORT_PYTHON = os.environ.get("TRAIN_EXPORT_PYTHON", r"D:\hmst\pv\Scripts\python.exe")  # CPU build of Paddle 3.3.1
DEFAULT_CONVERTER = os.environ.get("TRAIN_CONVERTER_PYTHON", r"D:\hmst\p2o\Scripts\python.exe")
PRETRAINED_DIR = Path(os.environ.get("TRAIN_PRETRAINED", r"D:\hmst\pretrained"))
MODELS = {
    "latin": {"config": "configs/rec/PP-OCRv4/PP-OCRv4_mobile_rec.yml", "dict": "ppocr/utils/ppocr_keys_v1.txt",
              "url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv4_mobile_rec_pretrained.pdparams",
              "gtc": "label_gtc"},
    "devanagari": {"config": "configs/rec/PP-OCRv3/multi_language/devanagari_PP-OCRv3_mobile_rec.yml", "dict": "ppocr/utils/dict/devanagari_dict.txt",
                   "url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/devanagari_PP-OCRv3_mobile_rec_pretrained.pdparams",
                   "gtc": "label_sar"},
}
MAX_TEXT = 48  # longest line kept (an MRZ line is 44)


def step(n: int, text: str) -> None:
    print(f"[{n}] {text}", flush=True)


# ------------------------------------------------------------------ 1 device
def device_report(python: str) -> dict:
    rep = {"python": python, "paddle": None, "cuda_build": False, "gpus": 0, "nvidia_smi": guard.gpu_reading()}
    if not Path(python).exists():
        rep["error"] = "training Python not found"
        return rep
    code = ("import json,paddle;print(json.dumps({'paddle':paddle.__version__,'cuda_build':paddle.device.is_compiled_with_cuda(),"
            "'gpus':paddle.device.cuda.device_count() if paddle.device.is_compiled_with_cuda() else 0}))")
    done = subprocess.run([python, "-c", code], capture_output=True, timeout=300, check=False)
    try:
        rep.update(json.loads(done.stdout.decode().strip().splitlines()[-1]))
    except (ValueError, IndexError):
        rep["error"] = "paddle did not import: " + done.stderr.decode(errors="replace").strip().splitlines()[-1:][0][:200] if done.stderr else "paddle did not import"
    return rep


# ------------------------------------------------------------------ 2 dataset check
def check_dataset(dataset: Path, script: str, dict_path: Path, work: Path, max_text: int = MAX_TEXT, smoke: int = 0) -> dict:
    chars = set(dict_path.read_text(encoding="utf-8").splitlines()) | {" "}
    report = {}
    for split in ("train", "val"):
        src = dataset / f"rec_gt_{split}_{script}.txt"
        kept, why = [], {"missingImage": 0, "unreadable": 0, "unknownChars": 0, "tooLong": 0, "empty": 0}
        lines = src.read_text(encoding="utf-8").splitlines() if src.exists() else []
        for line in lines:
            if "\t" not in line:
                continue
            rel, text = line.split("\t", 1)
            text = nfc(text)
            img_path = dataset / rel
            if not text:
                why["empty"] += 1
            elif not img_path.exists():
                why["missingImage"] += 1
            elif len(text) > max_text:
                why["tooLong"] += 1
            elif set(text) - chars:
                why["unknownChars"] += 1
            elif read_image(img_path) is None:
                why["unreadable"] += 1
            else:
                kept.append(f"{rel}\t{text}")
        if smoke and split == "train":
            kept = (kept * (1 + smoke // max(1, len(kept))))[:smoke] if kept else kept
        out = work / f"{split}.txt"
        out.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8", newline="\n")
        report[split] = {"lines": len(lines), "kept": len(kept), **why}
    return report


# ------------------------------------------------------------------ 5 config
def write_config(paddleocr: Path, script: str, dataset: Path, work: Path, epochs: int, batch: int, lr: float, use_gpu: bool,
                 pretrained: Path | None, limits: guard.Limits, steps_per_epoch: int) -> Path:
    import yaml
    m = MODELS[script]
    cfg = yaml.safe_load((paddleocr / m["config"]).read_text(encoding="utf-8"))
    out_dir = work / "out"
    g = cfg["Global"]
    g.update({"use_gpu": use_gpu, "epoch_num": epochs, "save_model_dir": out_dir.as_posix(), "save_epoch_step": 1,
              "eval_batch_step": [0, max(1, steps_per_epoch)], "print_batch_step": 10, "distributed": False,
              "character_dict_path": (paddleocr / m["dict"]).as_posix(), "max_text_length": MAX_TEXT, "use_space_char": True,
              "pretrained_model": pretrained.with_suffix("").as_posix() if pretrained else None, "checkpoints": None,
              "save_inference_dir": (work / "inference").as_posix(), "use_visualdl": False,
              "save_res_path": (work / "predicts.txt").as_posix()})
    resume = [p for p in (out_dir / "latest.pdparams", out_dir / "timed.pdparams") if p.exists()]
    if resume:  # resume after a stop, pause or crash, from the newest checkpoint
        newest = max(resume, key=lambda p: p.stat().st_mtime)
        g["checkpoints"], g["pretrained_model"] = newest.with_suffix("").as_posix(), None
    g["save_epoch_step"] = max(1, min(5, epochs))  # numbered copies every 5 epochs; `latest` every epoch, `timed` every N minutes
    for head in cfg["Architecture"]["Head"].get("head_list", []):
        for v in head.values():
            if isinstance(v, dict) and "max_text_length" in v:
                v["max_text_length"] = MAX_TEXT
    cfg["Optimizer"]["lr"].update({"learning_rate": lr, "warmup_epoch": min(1, epochs)})
    gtc = m["gtc"]
    for part, label in (("Train", "train.txt"), ("Eval", "val.txt")):
        ds = cfg[part]["dataset"]
        ds["name"] = "SimpleDataSet"
        ds.pop("ds_width", None)
        ds["data_dir"] = dataset.as_posix()
        ds["label_file_list"] = [(work / label).as_posix()]
        tf = ds["transforms"]
        for t in tf:
            for k, v in t.items():
                if isinstance(v, dict) and "max_text_length" in v:
                    v["max_text_length"] = MAX_TEXT
        if not any("RecResizeImg" in t for t in tf):
            enc = next(i for i, t in enumerate(tf) if "MultiLabelEncode" in t)
            tf.insert(enc + 1, {"RecResizeImg": {"image_shape": [3, 48, 320]}})
        for t in tf:
            if "KeepKeys" in t:
                t["KeepKeys"]["keep_keys"] = ["image", "label_ctc", gtc, "length", "valid_ratio"]
        cfg[part].pop("sampler", None)
        cfg[part]["loader"].update({"batch_size_per_card": batch, "num_workers": 0, "shuffle": part == "Train",
                                    "drop_last": part == "Train", "use_shared_memory": False})
    path = work / "config.yml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return path


# ------------------------------------------------------------------ 3 loader proof
LOADER_PROOF = r"""
import sys, json, logging
sys.path.insert(0, sys.argv[1])
import paddle
paddle.set_device('cpu')
from tools.program import load_config
from ppocr.data import build_dataloader
from ppocr.utils.logging import get_logger
cfg = load_config(sys.argv[2])
logger = get_logger()
dl = build_dataloader(cfg, 'Train', 'cpu', logger)
batch = next(iter(dl))
print(json.dumps({'batches': len(dl), 'shapes': [list(b.shape) for b in batch]}))
"""


def prove_loader(python: str, paddleocr: Path, config: Path, limits: guard.Limits) -> dict:
    done = subprocess.run([python, "-c", LOADER_PROOF, str(paddleocr), str(config)], cwd=str(paddleocr), capture_output=True,
                          timeout=600, check=False, env={**os.environ, **guard.thread_env(limits)})
    try:
        return json.loads(done.stdout.decode(errors="replace").strip().splitlines()[-1])
    except (ValueError, IndexError):
        tail = done.stderr.decode(errors="replace").strip().splitlines()[-3:]
        return {"error": " | ".join(tail)[:400]}


# ------------------------------------------------------------------ 4 weights
def fetch_pretrained(script: str) -> Path:
    url = MODELS[script]["url"]
    PRETRAINED_DIR.mkdir(parents=True, exist_ok=True)
    path = PRETRAINED_DIR / url.rsplit("/", 1)[1]
    if not path.exists():
        tmp = path.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as fh:
            shutil.copyfileobj(r, fh)
        tmp.replace(path)
    return path


# ------------------------------------------------------------------ 7 export
EMBED = r"""
import sys, onnx
m = onnx.load(sys.argv[1])
chars = open(sys.argv[2], encoding='utf-8').read().splitlines()
for p in list(m.metadata_props):
    if p.key == 'character':
        m.metadata_props.remove(p)
p = m.metadata_props.add(); p.key = 'character'; p.value = '\n'.join(chars)
onnx.save(m, sys.argv[1])
print(len(chars))
"""


def export(python: str, paddleocr: Path, config: Path, work: Path, weights: Path, dict_path: Path, limits: guard.Limits,
           converter: str = DEFAULT_CONVERTER) -> Path:
    import yaml
    inf = work / "inference"
    env = {**os.environ, **guard.thread_env(limits)}
    cfg = yaml.safe_load(config.read_text(encoding="utf-8"))
    cfg["Global"].update({"checkpoints": None, "pretrained_model": weights.with_suffix("").as_posix(), "save_inference_dir": inf.as_posix(),
                          "use_gpu": False})
    export_cfg = work / "export.yml"
    export_cfg.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")
    # Export on the CPU build: a graph exported by the GPU build carries fused GPU operators that paddle2onnx rejects.
    exporter = EXPORT_PYTHON if Path(EXPORT_PYTHON).exists() else python
    subprocess.run([exporter, "tools/export_model.py", "-c", str(export_cfg)], cwd=str(paddleocr), check=True,
                   env={**env, "CUDA_VISIBLE_DEVICES": ""})
    model_file = "inference.json" if (inf / "inference.json").exists() else "inference.pdmodel"
    onnx_path = work / "rec_finetuned.onnx"
    p2o = Path(converter).with_name("paddle2onnx.exe" if os.name == "nt" else "paddle2onnx")
    subprocess.run([str(p2o), "--model_dir", str(inf), "--model_filename", model_file, "--params_filename", "inference.pdiparams",
                    "--save_file", str(onnx_path), "--opset_version", "14"], check=True, env=env)
    subprocess.run([converter, "-c", EMBED, str(onnx_path), str(dict_path)], check=True, env=env)
    return onnx_path


def verify_onnx(onnx_path: Path, dataset: Path, work: Path, limits: guard.Limits, n: int = 20) -> dict:
    from evaluate import CtcRecognizer
    from common import char_acc
    rows = [ln.split("\t", 1) for ln in (work / "val.txt").read_text(encoding="utf-8").splitlines() if "\t" in ln][:n]
    if not rows:
        return {"lines": 0}
    rec = CtcRecognizer(str(onnx_path), threads=limits.threads)
    preds = rec([read_image(dataset / r[0]) for r in rows])
    return {"lines": len(rows), "meanCharAcc": round(sum(char_acc(p, t) for p, (_, t) in zip(preds, rows)) / len(rows), 4)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--script", choices=tuple(MODELS), default="latin")
    ap.add_argument("--work", required=True)
    ap.add_argument("--paddleocr", default=DEFAULT_PADDLEOCR)
    ap.add_argument("--python", default=DEFAULT_PYTHON)
    ap.add_argument("--converter", default=DEFAULT_CONVERTER, help="Python of the paddle2onnx venv")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=32, help="per step; small for the 4 GB card (PaddleOCR has no gradient accumulation for rec, so keep the LR low)")
    ap.add_argument("--lr", type=float, default=0.0002)
    ap.add_argument("--device", choices=("auto", "cpu", "gpu"), default="auto")
    ap.add_argument("--checkpoint-minutes", type=float, default=20, help="also save weights every N minutes (resume point)")
    ap.add_argument("--keep-bn", action="store_true", help="let BatchNorm statistics update (only with large batches, e.g. on a bigger GPU)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--smoke-steps", type=int, default=0, help="train on this many batches only (a quick end-to-end test)")
    ap.add_argument("--export-only", action="store_true", help="skip training; export the run's best (or latest) checkpoint")
    ap.add_argument("--export-pretrained", action="store_true", help="skip training; export the untouched pretrained weights")
    guard.add_args(ap)
    a = ap.parse_args()
    limits = guard.apply(guard.from_args(a))
    dataset, work, paddleocr = Path(a.dataset).resolve(), Path(a.work).resolve(), Path(a.paddleocr)
    for p in (work,):
        reason = refuse_inside_repo(p)
        if reason:
            print(f"refused: {reason}")
            return 2
    work.mkdir(parents=True, exist_ok=True)
    disk = guard.check_disk(work, 2_000_000_000, limits)  # checkpoints (~30 MB each) + export + logs
    if disk:
        print(f"refused: {disk}")
        return 2
    run = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "script": a.script, "limits": limits.describe()}

    step(1, "device")
    dev = device_report(a.python)
    run["device"] = dev
    gpu_ok = bool(dev.get("cuda_build") and dev.get("gpus"))
    use_gpu = gpu_ok if a.device == "auto" else a.device == "gpu"
    if a.device == "gpu" and not gpu_ok:
        print("   GPU asked for, but this Paddle build has no CUDA or sees no GPU; see README (paddlepaddle-gpu)")
        return 2
    smi = dev.get("nvidia_smi")
    print(f"   paddle {dev.get('paddle')}  CUDA build {dev.get('cuda_build')}  GPUs seen by paddle {dev.get('gpus')}  "
          f"nvidia-smi {'%.0f C, %d MiB' % (smi['temp'], smi['mem_total']) if smi else 'not found'}  -> training on {'GPU' if use_gpu else 'CPU'}")
    if dev.get("error"):
        print("   " + dev["error"])

    step(2, "dataset check")
    if not (paddleocr / MODELS[a.script]["dict"]).exists():
        print(f"   PaddleOCR training code not found at {paddleocr} (see README: git clone --depth 1 --branch v3.7.0)")
        return 2
    dict_path = paddleocr / MODELS[a.script]["dict"]
    batch = a.batch
    smoke_lines = a.smoke_steps * batch if a.smoke_steps else 0
    chk = check_dataset(dataset, a.script, dict_path, work, smoke=smoke_lines)
    run["dataset"] = chk
    for split, r in chk.items():
        print(f"   {split}: " + "  ".join(f"{k} {v}" for k, v in r.items()))
    if not chk["train"]["kept"]:
        print("   no usable training lines")
        return 1
    batch = min(batch, chk["train"]["kept"])
    steps_per_epoch = max(1, chk["train"]["kept"] // batch)
    epochs = 1 if a.smoke_steps else a.epochs

    pretrained = None
    step(4 if not a.dry_run else 3, "pretrained weights" if not a.dry_run else "config + loader proof")
    if not a.dry_run:
        pretrained = fetch_pretrained(a.script)
        print(f"   {pretrained.name} ({pretrained.stat().st_size / 1e6:.1f} MB)")
    cfg = write_config(paddleocr, a.script, dataset, work, epochs, batch, a.lr, use_gpu, pretrained, limits, steps_per_epoch)
    proof = prove_loader(a.python, paddleocr, cfg, limits)
    run["loaderProof"] = proof
    print(f"   PaddleOCR loader: {proof}")
    launcher = Path(__file__).resolve().parent / "paddle_train.py"  # tools/train.py with BatchNorm statistics frozen
    train_cmd = ([a.python, str(launcher), str(paddleocr), "-c", str(cfg), "--checkpoint-minutes", str(a.checkpoint_minutes),
                  "--save-dir", str(work / "out")] + (["--keep-bn"] if a.keep_bn else []))
    print(f"   train: {' '.join(train_cmd)}   (cwd {paddleocr})")
    print(f"   {chk['train']['kept']} lines, batch {batch}, {steps_per_epoch} steps per epoch, {epochs} epochs")
    if a.dry_run:
        (work / "run.json").write_text(json.dumps(run, indent=1), encoding="utf-8")
        return 0 if "error" not in proof else 1

    rc = 0
    if a.export_pretrained:
        weights = pretrained  # the untouched base weights, exported the same way (a fair base for evaluate.py)
    else:
        if not a.export_only:
            step(6, "training (guarded)")
            t0 = time.time()
            rc = guard.run_guarded(train_cmd, limits, cwd=str(paddleocr))
            run["trainSeconds"] = round(time.time() - t0, 1)
            run["trainExit"] = rc
        best = work / "out" / "best_accuracy.pdparams"
        weights = best if best.exists() else work / "out" / "latest.pdparams"
    if rc != 0 or not weights.exists():
        print(f"   training stopped (exit {rc}); the last checkpoint stays in {work / 'out'}; run the same command again to resume")
        (work / "run.json").write_text(json.dumps(run, indent=1), encoding="utf-8")
        return 1

    step(7, "export to ONNX")
    onnx_path = export(a.python, paddleocr, cfg, work, weights, dict_path, limits, a.converter)
    run["onnx"] = str(onnx_path)
    step(8, "ONNX check on validation crops")
    run["onnxCheck"] = verify_onnx(onnx_path, dataset, work, limits)
    print(f"   {run['onnxCheck']}")
    (work / "run.json").write_text(json.dumps(run, indent=1), encoding="utf-8")
    print(f"done: {onnx_path}\nnext: evaluate.py --dataset {dataset} --candidate {onnx_path} --script {a.script}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
