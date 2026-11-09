# training

Everything needed to fine-tune the ID reader's **text recognition** on MJ's own guest ID photos, ready for the day MJ says
"train". Until then it is built and tested **only on invented cards** (`scripts/make_invented.py` draws Aadhaar-, PAN-, driving
licence-, voter-ID- and passport-like cards with invented names and numbers in Latin, Devanagari and Gujarati, with blur, glare,
tilt and noise variants). No real photo has been read.

Independent folder: own `.venv`, own requirements, imports nothing from other folders. Small helpers are own copies marked
`copied from <folder> on 2026-11-04` (`scripts/common.py`: Verhoeff / PAN / MRZ checks and the Aadhaar QR parser from reader,
`norm` / edit distance from accuracy-check so scores match the review form).

## Privacy rules (do not change)

* Guest photos and everything made from them **stay on this PC**. Never in git, never uploaded, never copied to a cloud folder.
* Photo folders are opened **read-only**. Outputs go to short paths **outside the repository** (`D:\hmsd\...`, `D:\hmst\...`);
  the scripts **refuse** an output folder inside the repo or any git work tree, or inside the photo folder.
* Manifests hold only **salted hashes** (HMAC-SHA256) of personal keys (ID number, name, name + date of birth) and of photo paths.
  The salt is a random `.salt` file in the dataset folder (keep it with the dataset, never commit it).
* The console prints **counts only**: no names, numbers or file names. Reports (`report.md`, `report.json`, `summary.json`) hold numbers only.
* The label files inside a dataset (`rec_gt_*.txt`, `fields_*.jsonl`) necessarily contain card text: they are training data
  and live only in the dataset folder. `.gitignore` here blocks datasets, models, images, jsonl, onnx and checkpoints.
* Delete a dataset folder when it is no longer needed.

## Resource guard (MJ's rule: never more than about 65% of the PC)

`scripts/guard.py` is used by every script. Limits printed at start on this PC:

    limits: 7 of 12 logical cores (65%), below-normal priority, RAM stop at 70%, GPU memory 65%,
            pause at GPU 80 C / CPU 85 C, resume at 70 C, disk needs 15% free
    GPU memory cap for training: 2662 MiB of 4096

* **CPU**: floor(0.65 x logical cores), minimum 1, written into OMP / MKL / OpenBLAS / NumExpr / Paddle thread settings before
  those libraries load, onnxruntime sessions (RapidOCR and our own) get the same `intra_op_num_threads`, OpenCV `setNumThreads`,
  PaddleOCR data loader `num_workers: 0`; every process (and the training child) runs at **below-normal priority**.
* **RAM**: before each photo / batch the scripts wait while system RAM use is above 70%.
  (This PC already sits near 65% with other work open, so a run may pause now and then; that is the rule working.)
* **GPU**: Paddle `FLAGS_gpu_memory_limit_mb` = 65% of the card (2662 MiB of 4 GB; proved: a too-large batch stops with
  "maximum GPU memory usage is limited to 2662 MB" instead of taking the card). Small batches (8) fit.
* **Heat**: a watchdog reads `nvidia-smi` every 30 s and **suspends** the training process above 80 C (GPU) or 85 C (CPU package),
  resuming at 70 C. On this PC the GPU temperature is readable; the **CPU temperature is not readable without admin**, so only the GPU
  is watched (if no temperature at all can be read, a duty cycle runs instead: 25 min work, 5 min rest).
* **Power limit** (optional, needs an administrator PowerShell; not set by the scripts):
  `nvidia-smi -pl 45` (watts; the laptop card allows about 35-61 W; `nvidia-smi -q -d POWER` shows the range; laptop drivers often refuse it).
* **Disk**: refuses to start when the output drive has under 15% free or less than the estimated need.
* **Checkpoints**: `latest` every epoch plus a `timed` checkpoint every 20 minutes (`--checkpoint-minutes`); running the same
  command again resumes from the newer one. **Ctrl+C** stops cleanly (dataset scripts finish the current photo; training keeps the last checkpoint).
* Change the limits: `--cpu-limit 0.5 --ram-limit 0.6 --gpu-limit 0.5` on any script, or environment variables
  `TRAIN_CPU_LIMIT`, `TRAIN_RAM_LIMIT`, `TRAIN_GPU_LIMIT`, `TRAIN_GPU_MAX_C`, `TRAIN_CPU_MAX_C`, `TRAIN_RESUME_C`, `TRAIN_DISK_MIN_FREE`.
  `.venv\Scripts\python.exe scripts\guard.py` prints the limits, the GPU reading and RAM use.

## The scripts

| script | what it does |
|---|---|
| `pseudo_label.py` | Runs RapidOCR (+ QR reading) over unlabelled photos. Keeps a line as a **free label only when an independent check agrees**: Aadhaar Verhoeff digit (`verhoeff`), PAN pattern with holder letter and confidence >= 0.85 (`pan-pattern`), MRZ lines fully covered by check digits (`mrz-check-digits`; MRZ name lines have no check digit and are never free), Aadhaar QR name / date of birth equal to the printed line (`qr-name`, `qr-dob`). Everything else goes to `needs_review.jsonl` with reasons; `--link-review-to` makes hard links of those photos for the accuracy review form. Resumable. |
| `build_dataset.py` | From a photo folder + `labels.jsonl` (accuracy review form) + `pseudo_labels.jsonl`: card crops, text-line crops with their text (PaddleOCR format), field labels per card, manifest. A reviewed field is matched to a detected line only when the line holds the whole value; the **true text is the checked value in printed layout** (OCR spacing is not trusted: Aadhaar 4-4-4, `DOB: 01/02/1990`). Fields typed in Devanagari / Gujarati in the review form (add e.g. `nameHindi` with "+ Add a field") are matched by re-reading with Tesseract `hin` / `guj`. **Split train / val / test by guest** (photos joined by ID number, name, name + date of birth or the same picture; joining two people is harmless, missing a join would leak, so the name alone joins too), fixed seed, stratified per document type, leak check before anything is written. Photos with no key are dropped (or `--unkeyed train`). `--keep-splits` rebuilds into the same folder keeping every guest's split. |
| `finetune_rec.py` | Fine-tunes the PP-OCR recognition model RapidOCR runs (Latin = PP-OCRv4 mobile, Devanagari = PP-OCRv3 mobile) with **PaddleOCR's own training code**, on the GPU when the CUDA build sees it, else CPU. Steps: device report, dataset check (decodes every image, drops characters outside the model's dictionary and lines over 48 characters), PaddleOCR loader proof, pretrained weights, config, guarded training (BatchNorm statistics frozen, see below), export to ONNX with the character list in the model metadata (RapidOCR loads it without a keys file), ONNX read check. `--dry-run`, `--smoke-steps N`, `--export-only`, `--export-pretrained`. |
| `paddle_train.py` | Launcher for PaddleOCR `tools/train.py`: freezes BatchNorm statistics and adds the timed checkpoints. Nothing in PaddleOCR is edited. |
| `evaluate.py` | Character accuracy, word accuracy, line exact and field accuracy, overall, per document type, per script and per field, on the fixed test split; base vs fine-tuned read the same crops. Writes `report.md` / `report.json` with the verdict. |
| `make_invented.py` | Invented cards for tests and dry runs. |
| `guard.py`, `common.py` | Resource guard; shared helpers. |

**Keep rule** (in every report): the fine-tuned model is kept only when (1) its overall character accuracy on the fixed test split
is **higher** than the base model's and (2) **no document type gets worse**: for every type with at least 20 test lines, character
accuracy and field accuracy are not lower than the base's. Otherwise the reader keeps the base model. Exit code 0 = keep, 3 = reject.

Why BatchNorm is frozen: 65% of a 4 GB card fits batches of about 8 lines; with such small batches the batch statistics overwrite
the pretrained ones within a few steps. Measured on invented cards: 20 steps took the model from 0.971 to 0.665 character accuracy
with BatchNorm updating; with it frozen the training accuracy at step 10 was 0.87 instead of 0.06 (CTC loss 1.2 instead of 54).
`--keep-bn` turns it off for big-batch training on a larger GPU.

## Toolchain (installed on this PC, outside the repo on short paths) and licences

| part | where | version | licence |
|---|---|---|---|
| PaddleOCR training code | `D:\hmst\PaddleOCR` (git tag v3.7.0) | 3.7.0 | Apache-2.0 |
| PaddlePaddle GPU (CUDA 12.6) | `D:\hmst\pg` | 3.3.1 | Apache-2.0 |
| NVIDIA CUDA / cuBLAS / cuDNN runtime wheels (pulled in by paddlepaddle-gpu) | `D:\hmst\pg` | 12.6 / 9.5 | NVIDIA proprietary EULA (free use; local only, nothing redistributed) |
| PaddlePaddle CPU (training fallback, export step) | `D:\hmst\pv` | 3.3.1 | Apache-2.0 |
| paddle2onnx + PaddlePaddle 3.1.0 + onnx (converter) | `D:\hmst\p2o` | 2.1.0 / 3.1.0 / 1.17.0 | Apache-2.0 |
| PP-OCRv4 mobile rec / PP-OCRv3 Devanagari pretrained weights | `D:\hmst\pretrained` | PaddleX official | Apache-2.0 (PaddleOCR model release) |
| RapidOCR (rapidocr-onnxruntime, ships the base ONNX models) | `.venv` | 1.4.4 | Apache-2.0 |
| onnxruntime | `.venv` | 1.31.1 | MIT |
| Tesseract (UB Mannheim build) + tessdata_fast eng/hin/guj/osd | system + `D:\hmst\tessdata` | 5.4.0 | Apache-2.0 |
| OpenCV, NumPy, Pillow, zxing-cpp, psutil, PyYAML, pytest, shapely, pyclipper | `.venv` | see requirements.txt | Apache-2.0, BSD-3, MIT-CMU, Apache-2.0, BSD-3, MIT, MIT, BSD-3, MIT |
| scikit-image, albumentations, albucore, rapidfuzz, lmdb, cython (PaddleOCR deps) | `D:\hmst\pg`, `D:\hmst\pv` | | BSD-3, MIT, MIT, MIT, OpenLDAP-2.8, Apache-2.0 |

Licences were read from each installed package's metadata and the PaddleOCR LICENSE file. Fonts from `C:\Windows\Fonts` are used
only to draw invented test cards on this PC and are not redistributed.

Why three Paddle environments: paddle2onnx 2.1.0 only loads next to the Paddle 3.1 binary on Windows (with 3.2 / 3.3 its DLL fails
with "The specified procedure could not be found"), and a graph exported by the GPU build carries fused GPU operators that paddle2onnx
rejects. So: train in `pg` (GPU), export the inference graph in `pv` (CPU), convert in `p2o`. Measured: the untouched pretrained weights
taken through this path score **exactly** like RapidOCR's bundled model (0.9713 = 0.9713 character accuracy), so the chain is faithful.

Rebuild the toolchain from scratch (only if `D:\hmst` is lost):

    cd D:\hmst
    git clone --depth 1 --branch v3.7.0 https://github.com/PaddlePaddle/PaddleOCR.git D:\hmst\PaddleOCR
    & "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv D:\hmst\pg
    D:\hmst\pg\Scripts\python.exe -m pip install paddlepaddle-gpu==3.3.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
    D:\hmst\pg\Scripts\python.exe -m pip install -r "<repo>\other-features\training\requirements-train.txt"
    & "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv D:\hmst\pv
    D:\hmst\pv\Scripts\python.exe -m pip install paddlepaddle==3.3.1 paddle2onnx==2.1.0
    D:\hmst\pv\Scripts\python.exe -m pip install -r "<repo>\other-features\training\requirements-train.txt"
    & "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv D:\hmst\p2o
    D:\hmst\p2o\Scripts\python.exe -m pip install -r "<repo>\other-features\training\requirements-convert.txt"
    (tessdata_fast eng, hin, guj, osd from github.com/tesseract-ocr/tessdata_fast into D:\hmst\tessdata)

The folder's own environment:

    cd other-features\training
    & "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    .\.venv\Scripts\python.exe -m pytest -q tests

## Training day: the exact commands

Run in PowerShell from `other-features\training`. `D:\HMS-training-data` is the photo folder; change it if the photos are elsewhere.
Every step is resumable or repeatable; Ctrl+C is safe.

    cd "D:\Hotel Management System - Pilot\other-features\training"
    .\.venv\Scripts\python.exe scripts\guard.py

    # 1. Free labels from checksums / MRZ / QR, and the list of photos that need a person
    .\.venv\Scripts\python.exe scripts\pseudo_label.py --photos D:\HMS-training-data --out D:\hmsd\pl1 --link-review-to D:\hmsd\review1

    # 2. Review in the accuracy form (other-features\accuracy-check). Start with about 100 photos across the priority types
    #    (plan section 5.1), then as many as time allows. Add a "nameHindi" / "nameGujarati" field with "+ Add a field" when a
    #    card prints the name in that script, so Devanagari / Gujarati lines get labels too.
    cd ..\accuracy-check
    .venv\Scripts\python.exe review.py --photos D:\hmsd\review1 --labels D:\hmsd\labels.jsonl --xlsx D:\hmsd\results.xlsx --images-out D:\hmsd\reviewed-images
    cd ..\training

    # 3. Dataset (split by guest, fixed seed 1947)
    .\.venv\Scripts\python.exe scripts\build_dataset.py --photos D:\HMS-training-data --labels D:\hmsd\labels.jsonl --pseudo D:\hmsd\pl1\pseudo_labels.jsonl --out D:\hmsd\ds1

    # 4. Base numbers (what the reader does today)
    .\.venv\Scripts\python.exe scripts\evaluate.py --dataset D:\hmsd\ds1 --script latin --report D:\hmsd\ds1\eval-base

    # 5. Latin fine-tune: dry run first (checks data and the PaddleOCR loader), then the real run on the GPU
    .\.venv\Scripts\python.exe scripts\finetune_rec.py --dataset D:\hmsd\ds1 --script latin --work D:\hmst\runs\latin1 --dry-run
    .\.venv\Scripts\python.exe scripts\finetune_rec.py --dataset D:\hmsd\ds1 --script latin --work D:\hmst\runs\latin1 --epochs 10 --batch 8

    # 6. Keep or reject (fixed test split, keep rule)
    .\.venv\Scripts\python.exe scripts\evaluate.py --dataset D:\hmsd\ds1 --script latin --candidate D:\hmst\runs\latin1\rec_finetuned.onnx --report D:\hmst\runs\latin1\eval

    # 7. Devanagari (only when step 3 reports enough lines_*_devanagari, at least a few thousand): its base is the pretrained
    #    Devanagari model, exported the same way
    .\.venv\Scripts\python.exe scripts\finetune_rec.py --dataset D:\hmsd\ds1 --script devanagari --work D:\hmst\runs\deva_base --export-pretrained
    .\.venv\Scripts\python.exe scripts\finetune_rec.py --dataset D:\hmsd\ds1 --script devanagari --work D:\hmst\runs\deva1 --epochs 10 --batch 8
    .\.venv\Scripts\python.exe scripts\evaluate.py --dataset D:\hmsd\ds1 --script devanagari --base D:\hmst\runs\deva_base\rec_finetuned.onnx --candidate D:\hmst\runs\deva1\rec_finetuned.onnx --report D:\hmst\runs\deva1\eval

A kept model is a single `rec_finetuned.onnx`. Handing it to the reader is a separate change in the reader folder (it is another
folder's code): Devanagari through its existing `READER_RAPID_DEVANAGARI_REC` setting; Latin needs the reader to pass
`rec_model_path` to RapidOCR. Re-run the fixed test split (step 6) before every release, as the plan's regression rule says.

## Time and disk for 48k-58k photos (estimates from measurements on invented cards; real photos may differ)

| step | measured here | estimate for 48k-58k photos |
|---|---|---|
| pseudo_label.py (RapidOCR + QR, 7 threads) | 2.1 s per photo (124 invented photos in 256 s) | about 28-34 hours for 48k-58k, up to about 2x on large phone photos; resumable, so it can run over several nights |
| review form | person-paced | 100 photos for the baseline; every reviewed photo adds labels |
| build_dataset.py, pseudo-labelled photos (no OCR, crops only) | well under 1 s per photo | about 2-4 hours |
| build_dataset.py, reviewed photos (detection again) | about 2.5 s per photo | about 1.5 hours per 2,000 reviewed photos |
| finetune_rec.py on the RTX 3050 (batch 8, 65% memory) | about 0.45-0.5 s per step after warm-up (150 steps in 89 s including start-up) | with roughly 60k-150k labelled lines: 1-2.6 hours per epoch, about 10-26 hours for 10 epochs (plus heat pauses) |
| finetune_rec.py on the CPU only | the 3-step CPU smoke run took about 2.5 minutes | not recommended for the full set |
| evaluate.py | about 0.05 s per line crop per model | minutes |

Disk: dataset about 0.1-0.4 MB per photo (card crop + line crops) = **6-23 GB**; each training checkpoint about 260 MB
(`latest`, `timed`, one numbered copy every 5 epochs) = **1.5-3 GB per run**; the toolchain in `D:\hmst` uses about 5.7 GB.
The scripts refuse to start if the drive would drop under 15% free (D: has about 370 GB free today).

## Test results (invented cards only)

`.\.venv\Scripts\python.exe -m pytest -q tests`: **43 passed** (about 4.5 minutes, including a real GPU fine-tune of 6 steps with
export to ONNX). What they prove:

* **Split**: no invented guest in two splits (checked against the generator's ground truth, which the builder never sees); same seed
  gives the same split, another seed another; exact per-type stratification; shared number, name or identical picture joins photos;
  unkeyed photos dropped or train-only; output inside the repo or a non-empty folder refused; manifest and summary contain no name,
  number, date or file name.
* **Label alignment**: OCR spacing slips do not leak into the truth ("VikramDesai" -> "Vikram Desai", Aadhaar 4-4-4, "DOB: ..."),
  a partial name line is not taken for the name; real RapidOCR + Tesseract (hin / guj) label lines on invented cards.
* **Pseudo-label rules**: Verhoeff, PAN pattern + holder letter + confidence, MRZ check digits, QR name / date; misread digits,
  low confidence, a bad holder letter, MRZ name lines, QR mismatches all go to review; with replayed OCR slips no wrong free label.
  Two real flaws were found this way and fixed: MRZ check digits do not cover nationality / sex ("UTO" read as "UT0" passed every
  check digit), and a misread label ("D0B:") rode along with a QR-verified date.
* **Evaluation maths and keep rule** on hand-made numbers; CTC decoding; the base model reads an invented line.
* **Guard**: thread caps (7 of 12 here), below-normal priority, onnxruntime cap, GPU MiB cap, RAM wait, batch sizing, disk refusal,
  pause at 81 C and resume at 70 C with invented temperatures, CPU-temperature pause, duty cycle, a real child process suspended and resumed.
* **Fine-tune**: dataset check filters, config, PaddleOCR loader proof, a real GPU run that writes a timed checkpoint and an ONNX
  model with the 6623-character list embedded.

Real runs on 124 invented photos: `pseudo_label.py` 2.1 s per photo, 85 free lines, **0 wrong** against the drawn text;
`build_dataset.py` 334 labelled lines (262 Latin, 4 Devanagari, 28 Gujarati in train), 0 leaks; exported pretrained model = bundled
model (0.9713 = 0.9713 character accuracy); smoke fine-tunes rejected by the keep rule.

## Honest limits

* Everything is measured on invented cards. They are cleaner and more regular than real phone photos; the numbers here prove the
  pipeline, not the accuracy that real photos will reach.
* A smoke fine-tune (20 steps on 160 invented lines) does **not** beat the base model, and the keep rule rejects it, as it should.
  Real gains need the real labelled lines.
* Pseudo-labels cover only what a check can confirm: ID numbers, MRZ data lines and (for Aadhaar with a readable QR) the name and
  date of birth. Names on PAN / licence / voter cards, addresses and all Devanagari / Gujarati text need a person in the review form.
* Gujarati has no PP-OCR recognition model; its line crops are written (`rec_gt_*_gujarati.txt`) for a later Tesseract fine-tune
  (tesstrain), which is not built here.
* Splitting by guest relies on the keys printed on the cards. A photo with no readable number and no name cannot be tied to a guest
  and is dropped by default.
* `labels.jsonl` from the review form names photos by file name only; two photos with the same name in different subfolders would
  share one label (rename or review per folder).
* CPU temperature is not readable without admin on this PC; only the GPU temperature is watched.
