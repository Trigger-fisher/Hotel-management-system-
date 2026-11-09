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
    """What a worker process needs (small and picklable)."""
    max_bytes: int = 50 * 1024 * 1024
    max_pixels: int = 100_000_000
    max_pages: int = 100
    job_seconds: float = 300.0
    fast_seconds_per_page: float = 20.0  # time budget for preprocessing variants, per page
    thorough_seconds_per_page: float = 90.0
    tesseract: str = ""  # path to the tesseract program; "" = look on PATH
    tessdata: str = ""  # folder with *.traineddata; "" = the engine's default
    use_paddle: bool = True
    use_rapid: bool = True
    read_qr: bool = False  # READER_READ_QR: QR and barcode decoding, off (MJ, 5 Nov 2026: no QR for now)


@dataclass(frozen=True)
class Settings:
    key: str
    allowed_hosts: tuple[str, ...]
    max_concurrency: int
    queue_size: int
    max_download_bytes: int
    executor: str  # "process" in production, "thread" for tests
    worker: WorkerConfig
    background_concurrency: int = 1  # background parts (model cut, pictures) at once, in their own pool: the forms never wait
    picture_seconds: int = 600  # a finished picture waits this long to be fetched, then it is dropped


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        raise ConfigError(f"{name} must be a whole number.")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    key = env.get("READER_KEY", "")
    if len(key) < MIN_KEY_LENGTH:
        raise ConfigError(f"READER_KEY must be set and at least {MIN_KEY_LENGTH} characters.")
    max_bytes = _int(env, "READER_MAX_UPLOAD_MB", 50) * 1024 * 1024
    worker = WorkerConfig(
        max_bytes=max_bytes,
        max_pixels=_int(env, "READER_MAX_MEGAPIXELS", 100) * 1_000_000,
        max_pages=_int(env, "READER_MAX_PAGES", 100),
        job_seconds=float(_int(env, "READER_JOB_TIMEOUT_S", 300)),
        fast_seconds_per_page=float(_int(env, "READER_FAST_BUDGET_S", 20)),
        thorough_seconds_per_page=float(_int(env, "READER_THOROUGH_BUDGET_S", 90)),
        tesseract=env.get("READER_TESSERACT", "").strip(),
        tessdata=env.get("READER_TESSDATA", "").strip(),
        use_paddle=env.get("READER_USE_PADDLE", "true").strip().lower() != "false",
        use_rapid=env.get("READER_USE_RAPID", "true").strip().lower() != "false",
        read_qr=env.get("READER_READ_QR", "false").strip().lower() == "true",
    )
    return Settings(
        key=key,
        allowed_hosts=tuple(h.strip().lower() for h in env.get("READER_ALLOWED_HOSTS", "").split(",") if h.strip()),
        max_concurrency=max(1, _int(env, "READER_MAX_CONCURRENCY", 2)),
        queue_size=max(0, _int(env, "READER_QUEUE_SIZE", 4)),
        max_download_bytes=max_bytes,
        executor=env.get("READER_EXECUTOR", "process"),
        worker=worker,
        background_concurrency=max(1, _int(env, "READER_BACKGROUND_CONCURRENCY", 1)),
        picture_seconds=max(30, _int(env, "READER_PICTURE_SECONDS", 600)),
    )
