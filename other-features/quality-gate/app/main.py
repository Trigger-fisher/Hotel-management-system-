"""HTTP API. Start with: uvicorn app.main:create_app --factory --port 8084
No URL/flow endpoint exists yet: the flow is decided later."""
from __future__ import annotations

import asyncio
import hmac
from concurrent.futures import Executor, ProcessPoolExecutor, ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import Settings, load_settings
from .errors import GateError
from .jobs import run_check
from .profiles import profile_names

VERSION = "0.1.0"


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or load_settings()  # raises when GATE_KEY is missing or short
    pool: Executor = (ThreadPoolExecutor(cfg.max_concurrency) if cfg.executor == "thread"
                      else ProcessPoolExecutor(cfg.max_concurrency))
    capacity = cfg.max_concurrency + cfg.queue_size
    inflight = 0

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="HMS quality gate", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None,
                  lifespan=lifespan)

    @app.exception_handler(GateError)
    async def _refusal(_: Request, exc: GateError) -> JSONResponse:
        headers = {"Retry-After": "5"} if exc.status in (429, 503) else None
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status, headers=headers)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "version": VERSION, "profiles": profile_names()}

    @app.post("/v1/check")
    async def check(request: Request) -> JSONResponse:
        nonlocal inflight
        presented = request.headers.get("x-gate-key")  # checked before the upload is parsed
        if presented is None or not hmac.compare_digest(presented.encode(), cfg.key.encode()):
            raise GateError("unauthorized", "A valid X-Gate-Key header is required.", 401)
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > cfg.worker.max_bytes + 1_000_000:
            raise GateError("file_too_large", "The file is larger than the allowed size.", 413)
        form = await request.form(max_files=1, max_fields=6)
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise GateError("no_file", "Send the file in a multipart field named file.", 400)
        data = bytearray()
        while chunk := await upload.read(1024 * 1024):
            data += chunk
            if len(data) > cfg.worker.max_bytes:
                raise GateError("file_too_large", "The file is larger than the allowed size.", 413)
        profile = str(form.get("profile") or "") or None
        if inflight >= capacity:
            raise GateError("busy", "The gate is busy. Try again shortly.", 429)
        inflight += 1
        try:
            fut = asyncio.get_running_loop().run_in_executor(pool, run_check, bytes(data), cfg.worker, profile)
            return JSONResponse(await asyncio.wait_for(fut, timeout=cfg.job_seconds))
        except asyncio.TimeoutError:
            raise GateError("timeout", "The file took too long to check.", 504)
        finally:
            inflight -= 1

    return app