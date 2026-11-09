"""Compares the base recognition model with a fine-tuned one on the FIXED test split, and decides whether to keep it.

  .venv\\Scripts\\python.exe scripts\\evaluate.py --dataset D:\\hmsd\\ds1 --candidate D:\\hmst\\runs\\latin1\\rec_finetuned.onnx
        [--base <onnx>] [--script latin] [--split test] [--report D:\\hmst\\runs\\latin1\\eval]

Measures on every labelled text-line crop of the split (both models read the same crops with the same preprocessing):
  character accuracy = 1 - (sum of edit distances) / (sum of true characters)        (overall, per document type, per script)
  word accuracy      = 1 - (sum of word-level edit distances) / (sum of true words)
  line exact         = share of lines read exactly
  field accuracy     = share of field lines (name, dob, documentNumber, ...) read exactly after ignoring case, spaces and
                       punctuation (the same normalisation as the accuracy review form), per document type and per field.

KEEP RULE (written into the report): the fine-tuned model is kept only when
  1. its overall character accuracy on the test split is HIGHER than the base model's, and
  2. no document type gets worse: for every type with at least --min-lines lines, its character accuracy AND its field accuracy
     are not lower than the base model's.
Otherwise it is rejected and the reader keeps the base model. Exit code 0 = keep, 3 = reject.
Reports hold numbers only (no text read from cards): report.json and report.md."""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import guard  # noqa: E402
from common import lev, nfc, norm, read_image  # noqa: E402

import numpy as np  # noqa: E402

KEEP_RULE = ("The fine-tuned model is kept only when (1) its overall character accuracy on the fixed test split is higher than "
             "the base model's and (2) no document type gets worse: for every type with at least {min_lines} test lines, character "
             "accuracy and field accuracy are not lower than the base model's. Otherwise the base model stays.")


def bundled_rec_model() -> str:
    import rapidocr_onnxruntime
    return str(Path(rapidocr_onnxruntime.__file__).parent / "models" / "ch_PP-OCRv4_rec_infer.onnx")


class CtcRecognizer:
    """PP-OCR recognition model (ONNX) with plain CTC greedy decoding, the same preprocessing as RapidOCR / PaddleOCR."""

    def __init__(self, model: str, keys: str | None = None, threads: int = 1, height: int = 48, batch: int = 8) -> None:
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads, so.inter_op_num_threads = max(1, threads), 1
        self.sess = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
        if keys:
            chars = Path(keys).read_text(encoding="utf-8").splitlines()
        else:
            meta = self.sess.get_modelmeta().custom_metadata_map
            if "character" not in meta:
                raise SystemExit("the model has no character list; pass its keys file")
            chars = meta["character"].splitlines()
        n_out = self.sess.get_outputs()[0].shape[-1]
        self.chars = ["<blank>"] + chars
        if isinstance(n_out, int) and n_out == len(self.chars) + 1:
            self.chars.append(" ")  # use_space_char
        self.height, self.batch = height, batch

    def _prep(self, img, width: int) -> np.ndarray:
        import cv2
        h, w = img.shape[:2]
        rw = min(width, int(math.ceil(self.height * w / max(1, h))))
        x = cv2.resize(img, (max(1, rw), self.height)).astype(np.float32).transpose(2, 0, 1) / 255
        x = (x - 0.5) / 0.5
        out = np.zeros((3, self.height, width), dtype=np.float32)
        out[:, :, :rw] = x
        return out

    def __call__(self, imgs: list) -> list[str]:
        order = sorted(range(len(imgs)), key=lambda i: imgs[i].shape[1] / max(1, imgs[i].shape[0]))
        res = [""] * len(imgs)
        for s in range(0, len(order), self.batch):
            idx = order[s:s + self.batch]
            ratio = max(320 / self.height, *(imgs[i].shape[1] / max(1, imgs[i].shape[0]) for i in idx))
            width = int(self.height * ratio)
            x = np.stack([self._prep(imgs[i], width) for i in idx])
            prob = self.sess.run(None, {self.sess.get_inputs()[0].name: x})[0]
            for k, i in enumerate(idx):
                best = prob[k].argmax(-1)
                text, prev = [], -1
                for c in best:
                    if c != prev and c != 0 and c < len(self.chars):
                        text.append(self.chars[c])
                    prev = c
                res[i] = "".join(text).strip()
        return res


def score(pairs: list[dict]) -> dict:
    """pairs: [{pred, truth, docType, script, field}] -> metrics (overall, per type, per script, per field)."""
    def agg(rows):
        ce = sum(lev(r["pred"], r["truth"]) for r in rows)
        cn = sum(len(r["truth"]) for r in rows)
        we = sum(lev(r["pred"].split(), r["truth"].split()) for r in rows)
        wn = sum(len(r["truth"].split()) for r in rows)
        fr = [r for r in rows if r.get("field")]
        return {"lines": len(rows), "charAcc": round(max(0.0, 1 - ce / cn), 4) if cn else None,
                "wordAcc": round(max(0.0, 1 - we / wn), 4) if wn else None,
                "lineExact": round(sum(r["pred"] == r["truth"] for r in rows) / len(rows), 4) if rows else None,
                "fieldLines": len(fr),
                "fieldAcc": round(sum(norm(r["pred"]) == norm(r["truth"]) for r in fr) / len(fr), 4) if fr else None}
    by = defaultdict(lambda: defaultdict(list))
    for r in pairs:
        by["docType"][r["docType"]].append(r)
        by["script"][r["script"]].append(r)
        if r.get("field"):
            by["field"][f"{r['docType']}/{r['field']}"].append(r)
    return {"overall": agg(pairs), **{k: {g: agg(v) for g, v in sorted(groups.items())} for k, groups in by.items()}}


def decide(base: dict, cand: dict, min_lines: int = 20) -> dict:
    """The keep rule. Returns {keep, reasons}."""
    reasons = []
    b, c = base["overall"]["charAcc"] or 0, cand["overall"]["charAcc"] or 0
    if not c > b:
        reasons.append(f"overall character accuracy not higher ({c:.4f} vs base {b:.4f})")
    for dtype, bm in base.get("docType", {}).items():
        cm = cand.get("docType", {}).get(dtype)
        if not cm or bm["lines"] < min_lines:
            continue
        if (cm["charAcc"] or 0) < (bm["charAcc"] or 0):
            reasons.append(f"{dtype}: character accuracy worse ({cm['charAcc']} vs {bm['charAcc']})")
        if bm["fieldAcc"] is not None and (cm["fieldAcc"] or 0) < bm["fieldAcc"]:
            reasons.append(f"{dtype}: field accuracy worse ({cm['fieldAcc']} vs {bm['fieldAcc']})")
    return {"keep": not reasons, "reasons": reasons, "rule": KEEP_RULE.format(min_lines=min_lines)}


def load_split(dataset: Path, split: str, script: str | None, limit: int = 0) -> list[dict]:
    rows = []
    gt = {}
    for line in (dataset / f"rec_gt_{split}.txt").read_text(encoding="utf-8").splitlines():
        if "\t" in line:
            p, t = line.split("\t", 1)
            gt[p] = nfc(t)
    for line in (dataset / f"lines_{split}.jsonl").read_text(encoding="utf-8").splitlines():
        m = json.loads(line)
        if m["image"] in gt and (not script or m["script"] == script):
            rows.append({**m, "truth": gt[m["image"]]})
    return rows[:limit] if limit else rows


def run_model(rec: CtcRecognizer, dataset: Path, rows: list[dict], limits, stop=None, chunk: int = 64) -> list[dict]:
    out = []
    for s in range(0, len(rows), chunk):
        if stop and stop.stopped:
            break
        guard.wait_for_ram(limits, stop=stop)
        part = rows[s:s + chunk]
        preds = rec([read_image(dataset / r["image"]) for r in part])
        out += [{"pred": nfc(p), "truth": r["truth"], "docType": r["docType"], "script": r["script"], "field": r.get("field")}
                for p, r in zip(preds, part)]
    return out


def write_report(folder: Path, base: dict, cand: dict | None, verdict: dict | None, info: dict) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "report.json").write_text(json.dumps({"info": info, "base": base, "candidate": cand, "verdict": verdict}, indent=1), encoding="utf-8")
    md = ["# Recognition model evaluation", "", f"Split: {info['split']}  ·  lines: {base['overall']['lines']}  ·  script filter: {info['script'] or 'all'}", ""]
    if verdict:
        md += [f"**Verdict: {'KEEP the fine-tuned model' if verdict['keep'] else 'REJECT (keep the base model)'}**", "",
               "Rule: " + verdict["rule"], ""] + [f"- {r}" for r in verdict["reasons"]] + [""]
    md += ["| group | lines | base char | cand char | base word | cand word | base field | cand field |", "|---|---|---|---|---|---|---|---|"]
    for key in ("overall",):
        b, c = base[key], (cand or {}).get(key, {})
        md.append(f"| overall | {b['lines']} | {b['charAcc']} | {c.get('charAcc', '')} | {b['wordAcc']} | {c.get('wordAcc', '')} | {b['fieldAcc']} | {c.get('fieldAcc', '')} |")
    for kind in ("docType", "script", "field"):
        for g, b in base.get(kind, {}).items():
            c = (cand or {}).get(kind, {}).get(g, {})
            md.append(f"| {kind}: {g} | {b['lines']} | {b['charAcc']} | {c.get('charAcc', '')} | {b['wordAcc']} | {c.get('wordAcc', '')} | {b['fieldAcc']} | {c.get('fieldAcc', '')} |")
    (folder / "report.md").write_text("\n".join(md) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--base", help="base ONNX recognition model (default: the one RapidOCR ships)")
    ap.add_argument("--base-keys")
    ap.add_argument("--candidate", help="fine-tuned ONNX model (omit to measure the base only)")
    ap.add_argument("--candidate-keys")
    ap.add_argument("--split", default="test", choices=("train", "val", "test"))
    ap.add_argument("--script", choices=("latin", "devanagari", "gujarati", "other"))
    ap.add_argument("--min-lines", type=int, default=20)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--report", help="report folder (default <dataset>/eval)")
    guard.add_args(ap)
    a = ap.parse_args()
    limits = guard.apply(guard.from_args(a))
    stop = guard.StopFlag()
    ds = Path(a.dataset)
    rows = load_split(ds, a.split, a.script, a.limit)
    if not rows:
        print("no lines in that split")
        return 1
    base_rec = CtcRecognizer(a.base or bundled_rec_model(), a.base_keys, limits.threads)
    base = score(run_model(base_rec, ds, rows, limits, stop))
    cand = verdict = None
    if a.candidate:
        cand = score(run_model(CtcRecognizer(a.candidate, a.candidate_keys, limits.threads), ds, rows, limits, stop))
        verdict = decide(base, cand, a.min_lines)
    folder = Path(a.report) if a.report else ds / "eval"
    write_report(folder, base, cand, verdict, {"split": a.split, "script": a.script, "base": Path(a.base or bundled_rec_model()).name,
                                               "candidate": Path(a.candidate).name if a.candidate else None})
    print(f"lines: {len(rows)}  base char acc {base['overall']['charAcc']}  word {base['overall']['wordAcc']}  field {base['overall']['fieldAcc']}")
    if cand:
        print(f"           candidate char acc {cand['overall']['charAcc']}  word {cand['overall']['wordAcc']}  field {cand['overall']['fieldAcc']}")
        print("KEEP" if verdict["keep"] else "REJECT: " + "; ".join(verdict["reasons"]))
    print(f"report: {folder}")
    return 0 if (verdict is None or verdict["keep"]) else 3


if __name__ == "__main__":
    sys.exit(main())
