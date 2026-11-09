"""HTTP API. Start with: uvicorn app.main:create_app --factory"""
from __future__ import annotations

import asyncio
import os
import io
import json
import re
import secrets
import time
import zipfile
from concurrent.futures import Executor, ProcessPoolExecutor, ThreadPoolExecutor
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import codes, safety
from .config import Settings, load_settings
from .engines import describe
from .errors import ReaderError
from .jobs import MODES, run_job
from .pair import run_pair
from .twoparts import picture_part

VERSION = "0.1.0"
MAX_PICTURES = 64  # background parts waiting to be fetched at once


class UrlJob(BaseModel):
    sourceUrl: str
    languages: list[str] | str | None = None
    mode: str = "fast"
    findDocument: bool = True
    kind: str = "any"


def _languages(raw) -> list[str]:
    items = raw if isinstance(raw, list) else re.split(r"[,\s]+", raw or "")
    items = [str(i).strip() for i in items if str(i).strip()]
    if len(items) > 12 or any(not re.fullmatch(r"[A-Za-z_]{2,12}", i) for i in items):
        raise ReaderError("bad_option", "languages must be a short list of language codes such as hi,gu,en.", 400)
    return items


def _flag(raw: str | None, default: bool = True) -> bool:
    if raw is None or raw == "":
        return default
    if raw.lower() in ("true", "1", "yes", "on"):
        return True
    if raw.lower() in ("false", "0", "no", "off"):
        return False
    raise ReaderError("bad_option", "findDocument must be true or false.", 400)


def create_app(settings: Settings | None = None, *, http_transport: httpx.AsyncBaseTransport | None = None,
               engines=None) -> FastAPI:
    """`engines` lets tests inject a fake engine (only with the thread executor)."""
    cfg = settings or load_settings()  # raises when READER_KEY is missing or short
    pool: Executor = (ThreadPoolExecutor(cfg.max_concurrency) if cfg.executor == "thread"
                      else ProcessPoolExecutor(cfg.max_concurrency))
    # The background parts (model cut, pictures) run in their own pool, so a form never waits behind a picture.
    background: Executor = (ThreadPoolExecutor(cfg.background_concurrency) if cfg.executor == "thread"
                            else ProcessPoolExecutor(cfg.background_concurrency))
    capacity = cfg.max_concurrency + cfg.queue_size
    inflight = 0
    pictures: dict[str, dict] = {}  # token -> {"future", "done_at"}: held in memory only, dropped once fetched or expired

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        pool.shutdown(wait=False, cancel_futures=True)
        background.shutdown(wait=False, cancel_futures=True)

    def forget_old() -> None:
        now = time.monotonic()
        for token, item in list(pictures.items()):
            if item["future"].done() and now - item.setdefault("done_at", now) > cfg.picture_seconds:
                pictures.pop(token, None)

    def later(data: bytes, languages: list[str], mode: str, fast: dict, single: bool, max_regions: int) -> dict:
        """Starts the background part of a two-part read; the fast answer carries its token."""
        forget_old()
        if len(pictures) >= MAX_PICTURES:
            raise ReaderError("busy", "The reader is busy. Try again shortly.", 429)
        token = secrets.token_urlsafe(24)
        fut = asyncio.get_running_loop().run_in_executor(
            background, picture_part, data, cfg.worker, languages, mode, fast, single, max_regions, *([engines] if engines else []))
        pictures[token] = {"future": fut}
        return {"token": token, "status": "saving"}

    app = FastAPI(title="HMS reader", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None,
                  lifespan=lifespan)

    @app.exception_handler(ReaderError)
    async def _refusal(_: Request, exc: ReaderError) -> JSONResponse:
        headers = {"Retry-After": "5"} if exc.status in (429, 503) else None
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}},
                            status_code=exc.status, headers=headers)

    def authorise(request: Request) -> None:
        if not safety.key_ok(request.headers.get("x-reader-key"), cfg.key):
            raise ReaderError("unauthorized", "A valid X-Reader-Key header is required.", 401)

    async def run(data: bytes, languages: list[str], mode: str, find_document: bool, id_mode: bool = False, extra: tuple = ()) -> dict:
        nonlocal inflight
        if mode not in MODES:
            raise ReaderError("bad_option", "mode must be fast or thorough.", 400)
        if inflight >= capacity:
            raise ReaderError("busy", "The reader is busy. Try again shortly.", 429)
        inflight += 1
        try:
            fut = asyncio.get_running_loop().run_in_executor(
                pool, run_job, data, cfg.worker, languages, mode, find_document, engines, id_mode, *extra)
            return await asyncio.wait_for(fut, timeout=cfg.worker.job_seconds + 30)
        except asyncio.TimeoutError:
            raise ReaderError("timeout", "The file took too long to read.", 504)
        finally:
            inflight -= 1

    @app.get("/health")
    async def health() -> dict:
        found = describe(cfg.worker)
        ready = bool(found["tesseract"]["present"] or found["paddleocr"])
        return {"status": "ok" if ready else "degraded", "version": VERSION, "engines": found,
                "codes": {"zxingcpp": codes.available()}}

    @app.post("/v1/read")
    async def read(request: Request) -> JSONResponse:
        authorise(request)  # before the upload is parsed
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > cfg.worker.max_bytes + 1_000_000:
            raise ReaderError("file_too_large", "The file is larger than the allowed size.", 413)
        form = await request.form(max_files=1, max_fields=10)
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise ReaderError("no_file", "Send the file in a multipart field named file.", 400)
        data = bytearray()
        while chunk := await upload.read(1024 * 1024):
            data += chunk
            if len(data) > cfg.worker.max_bytes:
                raise ReaderError("file_too_large", "The file is larger than the allowed size.", 413)
        languages, mode = _languages(str(form.get("languages") or "")), str(form.get("mode") or "fast")
        id_mode, multi = str(form.get("kind") or "any") == "id", str(form.get("multi") or "").lower() == "true"
        max_regions = int(str(form.get("maxRegions") or os.environ.get("MAX_REGIONS", 12)))
        two_parts = str(form.get("picture") or "").lower() == "later"
        if two_parts and not id_mode:
            raise ReaderError("bad_option", "picture=later needs kind=id.", 400)
        # picture=later (5 Nov 2026): the FAST answer now (no model, no picture), the picture from GET /v1/picture/{token}
        result = await run(bytes(data), languages, mode, _flag(form.get("findDocument")), id_mode,
                           (multi, max_regions, str(form.get("returnCrops") or "").lower() == "true",
                            "none" if two_parts else str(form.get("merge") or "none"), two_parts and multi))
        sheet, single = multi and "regions" in result, not multi and "documentType" in result and not result.get("rejected")
        if two_parts and (sheet or single):
            result["picture"] = later(bytes(data), languages, mode, result, single, max_regions)
        return JSONResponse(result)

    @app.get("/v1/picture/{token}")
    async def picture(request: Request, token: str, wait: float = 60.0) -> JSONResponse:
        """The BACKGROUND part's answer: one picture per person and what it read differently. `wait` seconds (0-120) for a part
        still saving; a finished answer is given once and then dropped."""
        authorise(request)
        forget_old()
        item = pictures.get(token)
        if item is None:
            raise ReaderError("unknown_token", "No picture is waiting under this token.", 404)
        fut = item["future"]
        if not fut.done() and wait > 0:
            try:
                await asyncio.wait_for(asyncio.shield(fut), timeout=min(max(wait, 0.0), 120.0))
            except asyncio.TimeoutError:
                pass
            except Exception:  # noqa: BLE001 - the failure is reported below
                pass
        if not fut.done():
            return JSONResponse({"status": "saving"})
        pictures.pop(token, None)
        error = fut.exception()
        if error is not None:  # the form stays: only the picture could not be made (no message text: it could hold content)
            code = error.code if isinstance(error, ReaderError) else "internal"
            return JSONResponse({"status": "failed", "error": {"code": code}})
        return JSONResponse(fut.result())

    async def read_upload(upload, limit: int) -> bytes:
        data = bytearray()
        while chunk := await upload.read(1024 * 1024):
            data += chunk
            if len(data) > limit:
                raise ReaderError("file_too_large", "The file is larger than the allowed size.", 413)
        return bytes(data)

    @app.post("/v1/read-pair")
    async def read_pair(request: Request) -> Response:
        """Front and back of one ID. `merge`: none (default, JSON only), stack (one image) or pdf (two pages),
        the last two returned as a ZIP with record.json."""
        nonlocal inflight
        authorise(request)
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > 2 * cfg.worker.max_bytes + 1_000_000:
            raise ReaderError("file_too_large", "The files are larger than the allowed size.", 413)
        form = await request.form(max_files=2, max_fields=10)
        sides = {}
        for name in ("front", "back"):
            upload = form.get(name)
            sides[name] = await read_upload(upload, cfg.worker.max_bytes) if upload is not None and hasattr(upload, "read") else None
        merge = str(form.get("merge") or "none")
        mode = str(form.get("mode") or "fast")
        if mode not in MODES:
            raise ReaderError("bad_option", "mode must be fast or thorough.", 400)
        if inflight >= capacity:
            raise ReaderError("busy", "The reader is busy. Try again shortly.", 429)
        inflight += 1
        try:
            fut = asyncio.get_running_loop().run_in_executor(
                pool, run_pair, sides["front"], sides["back"], cfg.worker, _languages(str(form.get("languages") or "")),
                mode, _flag(form.get("findDocument")), merge, *([engines] if engines else []))
            record, merged, ext = await asyncio.wait_for(fut, timeout=cfg.worker.job_seconds * 2 + 30)
        except asyncio.TimeoutError:
            raise ReaderError("timeout", "The files took too long to read.", 504)
        finally:
            inflight -= 1
        if merged is None:
            return JSONResponse(record)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
            zf.writestr("record.json", json.dumps(record, ensure_ascii=False, indent=2))
            zf.writestr(f"merged.{ext}", merged)
        return Response(buf.getvalue(), media_type="application/zip")
    @app.post("/v1/read-url")
    async def read_url(request: Request, job: UrlJob) -> JSONResponse:
        authorise(request)
        languages = _languages(job.languages)
        await safety.validate_url(job.sourceUrl, cfg.allowed_hosts)
        async with httpx.AsyncClient(transport=http_transport, follow_redirects=False,
                                     timeout=safety.HTTP_TIMEOUT) as client:
            data = await safety.fetch(client, job.sourceUrl, cfg.allowed_hosts, cfg.max_download_bytes)
        return JSONResponse(await run(data, languages, job.mode, job.findDocument, job.kind == "id"))

    return app
