"""One reading job. Runs inside a worker process; everything temporary lives in per-call temp directories."""
from __future__ import annotations

import time

from .config import WorkerConfig
from .engines import load_engines
from .doctypes import read_document
from .errors import ReaderError
from .reader import ReadOptions, Reader
from .sniff import sniff

MODES = ("fast", "thorough")


def run_job(data: bytes, cfg: WorkerConfig, languages: list[str], mode: str, find_document: bool,
            engines=None, id_mode: bool = False, multi: bool = False, max_regions: int = 12,
            return_crops: bool = False, merge: str = "none", quick: bool = False) -> dict:
    """`quick`: the fast part of a two-part read (picture=later): a sheet is cut without the model and no picture is made."""
    started = time.monotonic()
    if mode not in MODES:
        raise ReaderError("bad_option", "mode must be fast or thorough.", 400)
    if len(data) > cfg.max_bytes:
        raise ReaderError("file_too_large", "The file is larger than the allowed size.", 413)
    kind = sniff(data[:2048])  # real type from the bytes, never the file name
    if kind is None:
        raise ReaderError("unsupported_type", "Only PDF and picture files are accepted.", 415)
    reader = Reader(load_engines(cfg) if engines is None else engines, cfg)
    opts = ReadOptions(languages=languages, mode=mode, find_document=find_document)
    if multi and kind != "pdf":
        from .multi import read_sheet
        result = read_sheet(reader, data, opts, max(1, min(max_regions, 12)), return_crops, merge, quick)
        result["tookMs"] = int((time.monotonic() - started) * 1000)
        return result
    result = reader.read_pdf(data, opts) if kind == "pdf" else reader.read_image(data, opts)
    if id_mode and kind != "pdf" and "regions" not in result:  # ID pictures: detect the type and extract its fields
        doc = read_document(result)
        result["documentType"] = {k: doc[k] for k in ("type", "confidence", "candidates")}
        result["fields"], result["doubtfulFields"] = doc["fields"], doc["doubtfulFields"]
        if doc["type"] == "unknown":
            result["flags"] = list(dict.fromkeys(result["flags"] + ["unknownDocumentType"]))
        result["needsHumanCheck"] = result["needsHumanCheck"] or doc["needsHumanCheck"]
        # clarity and photo check of the ID picture (MJ, 4 Nov 2026): grade, reasons, retake line, portrait status
        from .clarity import jpeg_quality
        from .inspection import inspect_single
        from .reader import decode_image
        inspect_single(decode_image(data, cfg.max_pixels), result, doc, jpeg_quality(data))
    result["tookMs"] = int((time.monotonic() - started) * 1000)
    return result
