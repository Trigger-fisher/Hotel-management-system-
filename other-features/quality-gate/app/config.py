"""Settings from environment variables only. Refuses to start without a 32+ character key."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from .jobs import WorkerConfig
from .profiles import profile_names

MIN_KEY_LENGTH = 32


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    key: str
    max_concurrency: int
    queue_size: int
    job_seconds: float
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
    key = env.get("GATE_KEY", "")
    if len(key) < MIN_KEY_LENGTH:
        raise ConfigError(f"GATE_KEY must be set and at least {MIN_KEY_LENGTH} characters.")
    default_profile = env.get("GATE_DEFAULT_PROFILE", "generic").strip()
    if default_profile not in profile_names():
        raise ConfigError("GATE_DEFAULT_PROFILE is not a known profile.")
    return Settings(
        key=key,
        max_concurrency=max(1, _int(env, "GATE_MAX_CONCURRENCY", 2)),
        queue_size=max(0, _int(env, "GATE_QUEUE_SIZE", 4)),
        job_seconds=float(_int(env, "GATE_JOB_TIMEOUT_S", 120)),
        executor=env.get("GATE_EXECUTOR", "process"),
        worker=WorkerConfig(max_bytes=_int(env, "GATE_MAX_UPLOAD_MB", 50) * 1024 * 1024,
                            max_pixels=_int(env, "GATE_MAX_MEGAPIXELS", 100) * 1_000_000,
                            default_profile=default_profile,
                            cpu_threads=max(1, _int(env, "GATE_CPU_THREADS", 4))),
    )