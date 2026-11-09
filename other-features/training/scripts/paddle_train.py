"""Runs PaddleOCR's own tools/train.py with BatchNorm statistics FROZEN (run with the training Python, not the .venv).

  <training python> scripts\\paddle_train.py <PaddleOCR folder> -c config.yml [--keep-bn]

Why: the 4 GB card (at 65%) fits only small batches (about 8 lines). With small batches BatchNorm's batch statistics are
noisy and they overwrite the pretrained running statistics within a few steps, which wrecks a good model (measured on
invented cards: 0.97 -> 0.66 character accuracy after 20 steps). With use_global_stats=True every BatchNorm layer keeps
the pretrained mean/variance and only the weights learn, the usual practice for small-batch fine-tuning.
Nothing in PaddleOCR is changed on disk; the patch lives only in this process."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path


def freeze_batchnorm() -> int:
    import paddle.nn as nn
    patched = 0
    for cls in {getattr(nn, n) for n in ("BatchNorm", "BatchNorm1D", "BatchNorm2D", "BatchNorm3D") if hasattr(nn, n)}:
        original = cls.__init__

        def init(self, *args, __orig=original, **kwargs):
            kwargs["use_global_stats"] = True
            __orig(self, *args, **kwargs)

        cls.__init__ = init
        patched += 1
    return patched


def timed_checkpoints(save_dir: Path, minutes: float) -> None:
    """PaddleOCR saves `latest` once per epoch; on 48k+ photos an epoch can take hours. This wraps the optimizer so that
    every `minutes` the weights, the optimizer state and a .states file go to <save_dir>/timed.*; finetune_rec.py resumes
    from whichever of latest / timed is newer. The epoch in progress is re-run from its start (weights are kept)."""
    import pickle
    import time

    import paddle
    import ppocr.optimizer as po

    original = po.build_optimizer

    def build(config, epochs, step_each_epoch, model):
        result = original(config, epochs=epochs, step_each_epoch=step_each_epoch, model=model)
        optimizer = result[0]
        step_fn, state = optimizer.step, {"t": time.monotonic(), "n": 0}

        def step(*a, **k):
            out = step_fn(*a, **k)
            state["n"] += 1
            if time.monotonic() - state["t"] >= minutes * 60:
                prefix = save_dir / "timed"
                save_dir.mkdir(parents=True, exist_ok=True)
                paddle.save(model.state_dict(), str(prefix) + ".pdparams")
                paddle.save(optimizer.state_dict(), str(prefix) + ".pdopt")
                done_epochs = state["n"] // max(1, step_each_epoch)
                with open(str(prefix) + ".states", "wb") as fh:
                    pickle.dump({"epoch": done_epochs, "best_model_dict": {}}, fh, protocol=2)
                print(f"timed checkpoint saved (step {state['n']})", flush=True)
                state["t"] = time.monotonic()
            return out

        optimizer.step = step
        return result

    po.build_optimizer = build


def option(args: list[str], name: str) -> tuple[str | None, list[str]]:
    if name in args:
        i = args.index(name)
        return args[i + 1], args[:i] + args[i + 2:]
    return None, args


def main() -> None:
    paddleocr = Path(sys.argv[1]).resolve()
    args = sys.argv[2:]
    keep_bn = "--keep-bn" in args
    args = [a for a in args if a != "--keep-bn"]
    minutes, args = option(args, "--checkpoint-minutes")
    save_dir, args = option(args, "--save-dir")
    sys.path.insert(0, str(paddleocr))
    if not keep_bn:
        print(f"BatchNorm statistics frozen ({freeze_batchnorm()} layer types patched)", flush=True)
    if minutes and save_dir and float(minutes) > 0:
        timed_checkpoints(Path(save_dir), float(minutes))
        print(f"checkpoint every {minutes} minutes", flush=True)
    sys.argv = [str(paddleocr / "tools" / "train.py"), *args]
    runpy.run_path(str(paddleocr / "tools" / "train.py"), run_name="__main__")


if __name__ == "__main__":
    main()
