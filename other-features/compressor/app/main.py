"""HTTP API. Start with: uvicorn app.main:create_app --factory"""
from __future__ import annotations

import asyncio
from concurrent.futures import Executor, ProcessPoolExecutor, ThreadPoolExecutor
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import safety, tools
from .config import Settings, load_settings
from .errors import CompressorError
from .images import avif_supported
from .jobs import Outcome, run_job
from .modes import SizeRule, size_rule

VERSION = "0.1.0"


class UrlJob(BaseModel):
    sourceUrl: str
    targetUrl: str
    mode: str = "balanced"
    output: str = "auto"
    targetKb: int | None = None  # default 150 KB
    capKb: int | None = None  # default 500 KB, a hard maximum


def _summary(o: Outcome) -> dict:
    return {"originalBytes": o.original_bytes, "resultBytes": o.result_bytes,
            "savedPercent": o.saved_percent, "qualityScore": round(o.score, 4),
            "mode": o.mode, "outputType": o.mime, "notes": list(o.notes),
            "target": o.target, "targetBytes": o.target_bytes, "capBytes": o.cap_bytes}


def create_app(settings: Settings | None = None, *, http_transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    cfg = settings or load_settings()  # raises when COMPRESSOR_KEY is missing or short
    pool: Executor = (ThreadPoolExecutor(cfg.max_concurrency) if cfg.executor == "thread"
                      else ProcessPoolExecutor(cfg.max_concurrency))
    capacity = cfg.max_concurrency + cfg.queue_size
    inflight = 0

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        pool.shutdown(wait=False, cancel_futures=True)

    # Interactive docs are off: this is an internal service.
    app = FastAPI(title="HMS compressor", version=VERSION, docs_url=None, redoc_url=None,
                  openapi_url=None, lifespan=lifespan)

    @app.exception_handler(CompressorError)
    async def _refusal(_: Request, exc: CompressorError) -> JSONResponse:
        headers = {"Retry-After": "5"} if exc.status in (429, 503) else None
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}},
                            status_code=exc.status, headers=headers)

    def authorise(request: Request) -> None:
        if not safety.key_ok(request.headers.get("x-compressor-key"), cfg.key):
            raise CompressorError("unauthorized", "A valid X-Compressor-Key header is required.", 401)

    async def run(data: bytes, mode: str, output: str, rule: SizeRule) -> Outcome:
        nonlocal inflight
        if inflight >= capacity:
            raise CompressorError("busy", "The compressor is busy. Try again shortly.", 429)
        inflight += 1
        try:
            fut = asyncio.get_running_loop().run_in_executor(pool, run_job, data, mode, output, cfg.limits, rule)
            return await asyncio.wait_for(fut, timeout=cfg.limits.job_seconds + 30)
        except asyncio.TimeoutError:
            raise CompressorError("timeout", "The file took too long to process.", 504)
        finally:
            inflight -= 1

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "version": VERSION, "tools": tools.available(),
                "formats": {"avif": avif_supported()}}

    @app.post("/v1/compress")
    async def compress(request: Request) -> Response:
        authorise(request)  # before the body is parsed, so strangers cannot make us spool uploads
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > cfg.limits.max_bytes + 1_000_000:
            raise CompressorError("too_large", "The file is larger than the allowed size.", 413)
        form = await request.form(max_files=1, max_fields=8)
        rule = size_rule(form.get("targetKb"), form.get("capKb"))  # refused (400) before any work
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise CompressorError("no_file", "Send the file in a multipart field named file.", 400)
        data = bytearray()
        while chunk := await upload.read(1024 * 1024):
            data += chunk
            if len(data) > cfg.limits.max_bytes:
                raise CompressorError("too_large", "The file is larger than the allowed size.", 413)
        outcome = await run(bytes(data), str(form.get("mode") or "balanced"), str(form.get("output") or "auto"), rule)
        headers = {
            "X-Original-Bytes": str(outcome.original_bytes), "X-Result-Bytes": str(outcome.result_bytes),
            "X-Saved-Percent": str(outcome.saved_percent), "X-Quality-Score": f"{outcome.score:.4f}",
            "X-Mode": outcome.mode, "X-Output-Type": outcome.mime, "X-Notes": ",".join(outcome.notes),
            "X-Target": outcome.target, "X-Target-Bytes": str(outcome.target_bytes), "X-Cap-Bytes": str(outcome.cap_bytes),
        }
        return Response(outcome.data, media_type=outcome.mime, headers=headers)

    @app.post("/v1/compress-url")
    async def compress_url(request: Request, job: UrlJob) -> dict:
        authorise(request)
        rule = size_rule(job.targetKb, job.capKb)
        await safety.validate_url(job.sourceUrl, cfg.allowed_hosts)
        await safety.validate_url(job.targetUrl, cfg.allowed_hosts)
        async with httpx.AsyncClient(transport=http_transport, follow_redirects=False,
                                     timeout=safety.HTTP_TIMEOUT) as client:
            data = await safety.fetch(client, job.sourceUrl, cfg.allowed_hosts, cfg.max_download_bytes)
            outcome = await run(data, job.mode, job.output, rule)
            await safety.put(client, job.targetUrl, cfg.allowed_hosts, outcome.data, outcome.mime)
        return _summary(outcome)

    return app
