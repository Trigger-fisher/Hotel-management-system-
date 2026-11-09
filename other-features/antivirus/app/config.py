"""Settings from environment variables only. Refuses to start without a 32+ character key."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

MIN_KEY_LENGTH = 32


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class WorkerConfig:
    """The part of the settings a worker process needs (small and picklable)."""
    clamd: str  # "unix:/path" or "tcp:host:port"; "" = no virus engine (development only)
    clamd_timeout: float
    max_bytes: int
    max_pixels: int
    max_pages: int
    job_seconds: float
    strip_uri: bool
    yara: str = "off"  # "reject" (match = rejected, code yara_match), "report" (match noted, file still disarmed) or "off"


@dataclass(frozen=True)
class Settings:
    key: str
    allowed_hosts: tuple[str, ...]
    max_concurrency: int
    queue_size: int
    max_download_bytes: int
    quarantine_action: str  # "report" or "delete"
    executor: str  # "process" in production, "thread" for tests
    worker: WorkerConfig


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        raise ConfigError(f"{name} must be a whole number.")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    key = env.get("SCANNER_KEY", "")
    if len(key) < MIN_KEY_LENGTH:
        raise ConfigError(f"SCANNER_KEY must be set and at least {MIN_KEY_LENGTH} characters.")
    clamd = env.get("SCANNER_CLAMD", "unix:/var/run/clamav/clamd.ctl").strip()
    if clamd and not clamd.startswith(("unix:", "tcp:")):
        raise ConfigError("SCANNER_CLAMD must look like unix:/path or tcp:host:port (or be empty).")
    action = env.get("SCANNER_QUARANTINE_ACTION", "report").strip().lower()
    if action not in ("report", "delete"):
        raise ConfigError("SCANNER_QUARANTINE_ACTION must be report or delete.")
    yara_mode = env.get("SCANNER_YARA", "reject").strip().lower()
    if yara_mode not in ("reject", "report", "off"):
        raise ConfigError("SCANNER_YARA must be reject, report or off.")
    max_bytes = _int(env, "SCANNER_MAX_UPLOAD_MB", 100) * 1024 * 1024
    worker = WorkerConfig(
        clamd=clamd,
        clamd_timeout=float(_int(env, "SCANNER_CLAMD_TIMEOUT_S", 60)),
        max_bytes=max_bytes,
        max_pixels=_int(env, "SCANNER_MAX_MEGAPIXELS", 100) * 1_000_000,
        max_pages=_int(env, "SCANNER_MAX_PDF_PAGES", 300),
        job_seconds=float(_int(env, "SCANNER_JOB_TIMEOUT_S", 300)),
        strip_uri=env.get("SCANNER_STRIP_URI", "false").strip().lower() == "true",
        yara=yara_mode,
    )
    return Settings(
        key=key,
        allowed_hosts=tuple(h.strip().lower() for h in env.get("SCANNER_ALLOWED_HOSTS", "").split(",") if h.strip()),
        max_concurrency=max(1, _int(env, "SCANNER_MAX_CONCURRENCY", 2)),
        queue_size=max(0, _int(env, "SCANNER_QUEUE_SIZE", 4)),
        max_download_bytes=max_bytes,
        quarantine_action=action,
        executor=env.get("SCANNER_EXECUTOR", "process"),
        worker=worker,
    )

