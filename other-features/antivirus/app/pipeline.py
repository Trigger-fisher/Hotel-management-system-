"""The one pipeline: type -> caps -> virus scan -> disarm -> verdict.
A rejected file is never passed on. Runs inside a worker process."""
from __future__ import annotations

from dataclasses import dataclass

from .clam import ClamClient, parse_version
from .config import WorkerConfig
from .disarm_image import disarm_image
from .disarm_pdf import disarm_pdf
from .errors import Rejection, ServiceError
from .sniff import MIME, sniff
from . import yara_scan


@dataclass(frozen=True)
class Verdict:
    verdict: str  # "clean" or "rejected"
    code: str  # "ok" or a stable rejection code
    message: str
    engine: str
    data: bytes = b""
    mime: str = ""
    disarmed: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()
    detail: str = ""  # for example the virus signature name


def _reject(code: str, message: str, engine: str, detail: str = "") -> Verdict:
    return Verdict("rejected", code, message, engine, detail=detail)


def scan_job(data: bytes, cfg: WorkerConfig, output: str = "auto") -> Verdict:
    clam = ClamClient(cfg.clamd, cfg.clamd_timeout) if cfg.clamd else None
    if clam:
        engine = parse_version(clam.version())[0] or "ClamAV"
    else:
        engine = "none"
    if cfg.yara != "off":
        engine = f"{engine}+{yara_scan.engine_name()}" if clam else yara_scan.engine_name()

    if len(data) > cfg.max_bytes:
        return _reject("file_too_large", "The file is larger than the allowed size.", engine)
    # Virus scan first, on every file whatever its type: a whole-file EICAR or an .exe is reported as malware,
    # not just as an unsupported type.
    if clam:
        result = clam.scan(data)  # raises ServiceError when clamd cannot answer: never "clean" by accident
        if result.infected:
            return _reject("malware_found", "A virus signature matched this file.", engine, result.signature or "")

    kind = sniff(data[:2048])  # real type from the bytes, never the name
    if kind is None:
        return _reject("unsupported_type", "Only PDF and picture files are accepted.", engine)

    notes: list[str] = []
    if cfg.yara != "off":
        rules, tail = yara_scan.scan(data, kind)
        if rules and cfg.yara == "reject":
            return _reject("yara_match", "A security rule matched this file (script, embedded program, launch action or hidden data).",
                           engine, "yara:" + ",".join(rules))
        notes += [f"yara:{r}" for r in rules]
        if tail:
            notes.append("trailing_data")

    try:
        if kind == "pdf":
            clean, removed = disarm_pdf(data, cfg.max_pages, cfg.strip_uri)
            clean_kind = "pdf"
        else:
            clean, clean_kind, removed = disarm_image(data, kind, output, cfg.max_pixels)
    except Rejection as r:
        return _reject(r.code, r.message, engine)

    return Verdict("clean", "ok", "The file is clean.", engine, clean, MIME[clean_kind], tuple(removed), tuple(notes))


__all__ = ["Verdict", "scan_job", "ServiceError"]


