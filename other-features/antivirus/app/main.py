"""HTTP API. Start with: uvicorn app.main:create_app --factory"""
from __future__ import annotations

import asyncio
from concurrent.futures import Executor, ProcessPoolExecutor, ThreadPoolExecutor
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import safety
from .clam import ClamClient, parse_version
from .config import Settings, load_settings
from .errors import ServiceError
from .pipeline import Verdict, scan_job

VERSION = "0.1.0"
OUTPUTS = ("auto", "jpeg", "png", "webp", "avif")


class UrlJob(BaseModel):
    quarantineUrl: str
    cleanUrl: str
    quarantineDeleteUrl: str | None = None
    output: str = "auto"


def _output(output: str) -> str:
    if output not in OUTPUTS:
        raise ServiceError("bad_option", "output must be auto, jpeg, png, webp or avif.", 400)
    return output


def _rejected_body(v: Verdict) -> dict:
    return {"verdict": "rejected", "code": v.code, "message": v.message, "scanEngine": v.engine,
            **({"signature": v.detail} if v.detail else {})}


def create_app(settings: Settings | None = None, *, http_transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    cfg = settings or load_settings()  # raises when SCANNER_KEY is missing or short
    pool: Executor = (ThreadPoolExecutor(cfg.max_concurrency) if cfg.executor == "thread"
                      else ProcessPoolExecutor(cfg.max_concurrency))
    capacity = cfg.max_concurrency + cfg.queue_size
    inflight = 0

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="HMS antivirus", version=VERSION, docs_url=None, redoc_url=None,
                  openapi_url=None, lifespan=lifespan)

    @app.exception_handler(ServiceError)
    async def _service_error(_: Request, exc: ServiceError) -> JSONResponse:
        headers = {"Retry-After": "5"} if exc.status in (429, 503) else None
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}},
                            status_code=exc.status, headers=headers)

    def authorise(request: Request) -> None:
        if not safety.key_ok(request.headers.get("x-scanner-key"), cfg.key):
            raise ServiceError("unauthorized", "A valid X-Scanner-Key header is required.", 401)

    async def run(data: bytes, output: str) -> Verdict:
        nonlocal inflight
        if inflight >= capacity:
            raise ServiceError("busy", "The scanner is busy. Try again shortly.", 429)
        inflight += 1
        try:
            fut = asyncio.get_running_loop().run_in_executor(pool, scan_job, data, cfg.worker, output)
            return await asyncio.wait_for(fut, timeout=cfg.worker.job_seconds + 30)
        except asyncio.TimeoutError:
            raise ServiceError("timeout", "The file took too long to process.", 504)
        finally:
            inflight -= 1

    @app.get("/health")
    async def health() -> dict:
        clamd: dict = {"configured": bool(cfg.worker.clamd), "reachable": False}
        if cfg.worker.clamd:
            client = ClamClient(cfg.worker.clamd, 3.0)
            loop = asyncio.get_running_loop()
            clamd["reachable"] = await loop.run_in_executor(None, client.ping)
            if clamd["reachable"]:
                engine, date = parse_version(await loop.run_in_executor(None, client.version))
                clamd.update(engine=engine, signatureDate=date)
        return {"status": "ok" if clamd["reachable"] or not cfg.worker.clamd else "degraded",
                "version": VERSION, "clamd": clamd}

    @app.post("/v1/scan")
    async def scan(request: Request) -> Response:
        authorise(request)  # before the upload is parsed
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > cfg.worker.max_bytes + 1_000_000:
            raise ServiceError("file_too_large", "The file is larger than the allowed size.", 413)
        form = await request.form(max_files=1, max_fields=8)
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise ServiceError("no_file", "Send the file in a multipart field named file.", 400)
        data = bytearray()
        while chunk := await upload.read(1024 * 1024):
            data += chunk
            if len(data) > cfg.worker.max_bytes:
                raise ServiceError("file_too_large", "The file is larger than the allowed size.", 413)
        verdict = await run(bytes(data), _output(str(form.get("output") or "auto")))
        base = {"X-Verdict": verdict.verdict, "X-Scan-Engine": verdict.engine}
        if verdict.verdict == "rejected":
            return JSONResponse(_rejected_body(verdict), status_code=422, headers=base)
        return Response(verdict.data, media_type=verdict.mime,
                        headers={**base, "X-Disarmed": ",".join(verdict.disarmed), "X-Notes": ",".join(verdict.notes)})

    @app.post("/v1/scan-url")
    async def scan_url(request: Request, job: UrlJob) -> JSONResponse:
        authorise(request)
        output = _output(job.output)
        for url in (job.quarantineUrl, job.cleanUrl, job.quarantineDeleteUrl):
            if url:
                await safety.validate_url(url, cfg.allowed_hosts)
        async with httpx.AsyncClient(transport=http_transport, follow_redirects=False,
                                     timeout=safety.HTTP_TIMEOUT) as client:
            data = await safety.fetch(client, job.quarantineUrl, cfg.allowed_hosts, cfg.max_download_bytes)
            verdict = await run(data, output)
            body: dict = {"verdict": verdict.verdict, "scanEngine": verdict.engine}
            if verdict.verdict == "clean":
                if not await safety.send(client, "PUT", job.cleanUrl, cfg.allowed_hosts, verdict.data, verdict.mime):
                    raise ServiceError("upload_failed", "The clean file could not be uploaded.", 502)
                body.update(disarmed=list(verdict.disarmed), notes=list(verdict.notes),
                            outputType=verdict.mime, resultBytes=len(verdict.data))
            else:
                body.update(code=verdict.code, message=verdict.message)
                if verdict.detail:
                    body["signature"] = verdict.detail
            body["quarantine"] = "kept"
            if cfg.quarantine_action == "delete" and job.quarantineDeleteUrl:
                deleted = await safety.send(client, "DELETE", job.quarantineDeleteUrl, cfg.allowed_hosts)
                body["quarantine"] = "deleted" if deleted else "delete_failed"
        return JSONResponse(body, headers={"X-Verdict": verdict.verdict})

    return app
