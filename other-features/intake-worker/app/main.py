"""Entry point: python -m app.main"""
from __future__ import annotations

import signal
import time

from . import logs, signatures, yara_scan
from .clam import ClamClient, parse_version
from .config import ConfigError, load_settings
from .pipeline import Deps, Pipeline
from .readcore.config import WorkerConfig as ReadConfig
from .readcore.engines import load_engines
from .store import PgStore
from .worker import Worker


def main() -> None:
    logs.setup()
    settings = load_settings()
    engines = load_engines(ReadConfig(tesseract=settings.tesseract, tessdata=settings.tessdata))  # models load ONCE, here
    if not yara_scan.available() and not settings.allow_no_av:
        raise ConfigError("yara-python is required: the rule scan is never skipped.")
    if yara_scan.available():
        yara_scan.rules()  # compile once at start; a broken rule file stops the worker here
    clam = ClamClient(settings.clamd, 30.0) if settings.clamd else None
    pipeline = Pipeline(Deps(settings, engines, clam=clam))
    watch = signatures.Watch(settings.signatures_dir)

    def signature_date():
        return watch.official(parse_version(clam.version())[1] if clam else None)

    worker = Worker(settings, PgStore(settings.database_url), pipeline.process_fast, signature_date,
                    background=pipeline.process_background, report_steps=True, feeds_date=watch.feeds)
    signal.signal(signal.SIGTERM, lambda *_: worker.stop.set())
    signal.signal(signal.SIGINT, lambda *_: worker.stop.set())
    worker.start()
    while not worker.stop.is_set():
        time.sleep(1)
    worker.shutdown()


if __name__ == "__main__":
    main()
