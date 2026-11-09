"""Settings from environment variables only. Refuses to start without a 32+ character key."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

MIN_KEY_LENGTH = 32


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Limits:
    max_bytes: int = 100 * 1024 * 1024
    max_pages: int = 500  # pages in the PDF
    max_pixels_per_page: int = 100_000_000
    max_total_pixels: int = 2_000_000_000  # all rendered pages together: stops page-count x size bombs
    job_seconds: float = 300.0


@dataclass(frozen=True)
class Settings:
    key: str
    max_concurrency: int
    queue_size: int
    limits: Limits
    executor: str  # "process" in production, "thread" for tests


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        raise ConfigError(f"{name} must be a whole number.")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    key = env.get("CONVERTER_KEY", "")
    if len(key) < MIN_KEY_LENGTH:
        raise ConfigError(f"CONVERTER_KEY must be set and at least {MIN_KEY_LENGTH} characters.")
    limits = Limits(
        max_bytes=_int(env, "CONVERTER_MAX_UPLOAD_MB", 100) * 1024 * 1024,
        max_pages=_int(env, "CONVERTER_MAX_PAGES", 500),
        max_pixels_per_page=_int(env, "CONVERTER_MAX_MEGAPIXELS_PER_PAGE", 100) * 1_000_000,
        max_total_pixels=_int(env, "CONVERTER_MAX_TOTAL_MEGAPIXELS", 2000) * 1_000_000,
        job_seconds=float(_int(env, "CONVERTER_JOB_TIMEOUT_S", 300)),
    )
    return Settings(
        key=key,
        max_concurrency=max(1, _int(env, "CONVERTER_MAX_CONCURRENCY", 2)),
        queue_size=max(0, _int(env, "CONVERTER_QUEUE_SIZE", 4)),
        limits=limits,
        executor=env.get("CONVERTER_EXECUTOR", "process"),
    )
