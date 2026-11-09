"""Settings come only from environment variables. The service refuses to start without a key."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from .limits import Limits

MIN_KEY_LENGTH = 32


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    key: str
    allowed_hosts: tuple[str, ...]
    max_concurrency: int
    queue_size: int
    limits: Limits
    max_download_bytes: int
    executor: str  # "process" in production; "thread" only for tests


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        raise ConfigError(f"{name} must be a whole number.")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    key = env.get("COMPRESSOR_KEY", "")
    if len(key) < MIN_KEY_LENGTH:
        raise ConfigError(f"COMPRESSOR_KEY must be set and at least {MIN_KEY_LENGTH} characters.")
    hosts = tuple(h.strip().lower() for h in env.get("COMPRESSOR_ALLOWED_HOSTS", "").split(",") if h.strip())
    mb = 1024 * 1024
    limits = Limits(
        max_bytes=_int(env, "COMPRESSOR_MAX_UPLOAD_MB", 100) * mb,
        max_pixels=_int(env, "COMPRESSOR_MAX_MEGAPIXELS", 100) * 1_000_000,
        max_pages=_int(env, "COMPRESSOR_MAX_PDF_PAGES", 300),
        job_seconds=float(_int(env, "COMPRESSOR_JOB_TIMEOUT_S", 300)),
    )
    return Settings(
        key=key,
        allowed_hosts=hosts,
        max_concurrency=max(1, _int(env, "COMPRESSOR_MAX_CONCURRENCY", 2)),
        queue_size=max(0, _int(env, "COMPRESSOR_QUEUE_SIZE", 4)),
        limits=limits,
        max_download_bytes=limits.max_bytes,
        executor=env.get("COMPRESSOR_EXECUTOR", "process"),
    )
