"""Settings from environment variables only. Secrets are read here and nowhere logged."""
from __future__ import annotations

import base64
import os
from dataclasses import dataclass, field
from typing import Mapping

# Limits from the plan (checked BEFORE decoding).
MAX_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_PAGES = 20
MAX_PDF_PIXELS = 175_000_000
STEP_SECONDS = 30
JOB_SECONDS = 120
PDF_DPI = 300
STUCK_AFTER_SECONDS = 180
MAX_ATTEMPTS = 3
HEARTBEAT_SECONDS = 30
PULL_SECONDS = 1.0
ALLOWED_TYPES = ("jpeg", "png", "webp", "heic", "pdf")
YARA_SECONDS = 10
YARA_MAX_BYTES = MAX_BYTES
SIGNATURES_STALE_HOURS = 48


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False, default="")
    master_key: bytes = field(repr=False, default=b"")
    clamd: str = ""  # "unix:/path" or "tcp:host:port"
    allow_no_av: bool = False  # tests only: run without clamd
    allowed_hosts: tuple[str, ...] = ()  # the storage host(s) the signed links point at
    auto_enhance: bool = True  # AUTO_ENHANCE: conservative fixes on the stored copy only
    threads: int = 1
    version: str = "0.1.0"
    tesseract: str = ""
    tessdata: str = ""
    read_qr: bool = False  # INTAKE_READ_QR: QR and barcode decoding, off (MJ, 5 Nov 2026: no QR for now)
    background_threads: int = 0  # INTAKE_BACKGROUND_THREADS: threads that may run a background part at once (0 = threads - 1, at least 1)
    signatures_dir: str = ""  # the worker's clamd signature folder, mounted read-only: age of the Sanesecurity feeds


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    try:
        master = base64.b64decode(env.get("INTAKE_MASTER_KEY", ""), validate=True)
    except ValueError:
        raise ConfigError("INTAKE_MASTER_KEY must be base64.")
    if len(master) != 32:
        raise ConfigError("INTAKE_MASTER_KEY must be 32 bytes, base64 encoded.")
    if not env.get("INTAKE_DATABASE_URL"):
        raise ConfigError("INTAKE_DATABASE_URL is required.")
    clamd = env.get("INTAKE_CLAMD", "tcp:clamd:3310").strip()
    allow_no_av = env.get("INTAKE_ALLOW_NO_AV", "false").strip().lower() == "true"
    if not clamd and not allow_no_av:
        raise ConfigError("INTAKE_CLAMD is required: the scan is never skipped.")
    cores = os.cpu_count() or 2
    return Settings(
        database_url=env["INTAKE_DATABASE_URL"], master_key=master, clamd=clamd, allow_no_av=allow_no_av,
        allowed_hosts=tuple(h.strip().lower() for h in env.get("INTAKE_ALLOWED_HOSTS", "").split(",") if h.strip()),
        auto_enhance=env.get("AUTO_ENHANCE", "true").strip().lower() != "false",
        threads=max(1, int(env.get("INTAKE_THREADS") or max(1, cores - 1))),
        tesseract=env.get("INTAKE_TESSERACT", ""), tessdata=env.get("INTAKE_TESSDATA", ""),
        read_qr=env.get("INTAKE_READ_QR", "false").strip().lower() == "true",
        background_threads=max(0, int(env.get("INTAKE_BACKGROUND_THREADS") or 0)),
        signatures_dir=env.get("INTAKE_SIGNATURES_DIR", "").strip(),
    )
