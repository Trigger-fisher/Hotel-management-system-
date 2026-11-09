"""HTTP API. Start with: uvicorn app.main:create_app --factory"""
from __future__ import annotations

import asyncio
import hmac
import io
import json
import shutil
import tempfile
import time
import zipfile
from concurrent.futures import Executor, ProcessPoolExecutor, ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from .config import Settings, load_settings
from .convert import convert_job
from .errors import ConvertError
from .options import MIME, parse_options
from .render import engines_available

VERSION = "0.1.0"


class _ZipSink(io.RawIOBase):
    """A write-only target that lets zipfile stream: we drain what it wrote after every entry."""

    def __init__(self) -> None:
        self._chunks: list[bytes] = []
        self._pos = 0

    def writable(self) -> bool:
        return True

    def write(self, b) -> int:
        self._chunks.append(bytes(b))
        self._pos += len(b)
        return len(b)

    def tell(self) -> int:
        return self._pos

    def drain(self) -> bytes:
        data, self._chunks = b"".join(self._chunks), []
        return data


def stream_zip(workdir: str, manifest: dict, with_manifest: bool) -> Iterator[bytes]:
    """Yield a ZIP one page at a time. Only one page image is in memory at any moment."""
    sink = _ZipSink()
    try:
        with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED) as zf:  # images are already compressed
            for page in manifest["pages"]:
                path = Path(workdir) / page["file"]
                info = zipfile.ZipInfo(page["file"], time.localtime()[:6])
                with zf.open(info, "w", force_zip64=True) as entry, open(path, "rb") as src:
                    while chunk := src.read(1024 * 1024):
                        entry.write(chunk)
                        if (data := sink.drain()):
                            yield data
                path.unlink(missing_ok=True)  # free the disk as we go
                if (data := sink.drain()):
                    yield data
            if with_manifest:
                zf.writestr("manifest.json", json.dumps(_public_manifest(manifest), indent=2))
        if (data := sink.drain()):
            yield data
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _public_manifest(manifest: dict) -> dict:
    return {k: manifest[k] for k in ("pageCount", "renderedPages", "engine", "format", "pages", "errors")}


def _dpi_header(manifest: dict) -> str:
    values = {p["dpiUsed"] for p in manifest["pages"]}
    return str(values.pop()) if len(values) == 1 else "mixed"


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or load_settings()  # raises when CONVERTER_KEY is missing or short
    pool: Executor = (ThreadPoolExecutor(cfg.max_concurrency) if cfg.executor == "thread"
                      else ProcessPoolExecutor(cfg.max_concurrency))
    capacity = cfg.max_concurrency + cfg.queue_size
    inflight = 0

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="HMS PDF to image", version=VERSION, docs_url=None, redoc_url=None,
                  openapi_url=None, lifespan=lifespan)

    @app.exception_handler(ConvertError)
    async def _refusal(_: Request, exc: ConvertError) -> JSONResponse:
        headers = {"Retry-After": "5"} if exc.status in (429, 503) else None
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}},
                            status_code=exc.status, headers=headers)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "version": VERSION, "engines": engines_available()}

    @app.post("/v1/convert")
    async def convert(request: Request) -> Response:
        nonlocal inflight
        presented = request.headers.get("x-converter-key")  # checked before the upload is parsed
        if presented is None or not hmac.compare_digest(presented.encode(), cfg.key.encode()):
            raise ConvertError("unauthorized", "A valid X-Converter-Key header is required.", 401)
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > cfg.limits.max_bytes + 1_000_000:
            raise ConvertError("file_too_large", "The file is larger than the allowed size.", 413)
        single = request.query_params.get("page")
        if single is not None and (not single.isdigit() or int(single) < 1):
            raise ConvertError("bad_option", "page must be a whole number from 1.", 400)

        form = await request.form(max_files=1, max_fields=40)
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise ConvertError("no_file", "Send the PDF in a multipart field named file.", 400)
        opts = parse_options({k: v for k, v in form.items() if isinstance(v, str)},
                             int(single) if single else None)

        if inflight >= capacity:
            raise ConvertError("busy", "The converter is busy. Try again shortly.", 429)
        inflight += 1
        workdir = tempfile.mkdtemp(prefix="p2i-")  # always removed: by the stream, or in `finally` on errors
        handed_over = False
        try:
            pdf_path = str(Path(workdir) / "in.pdf")
            size = 0
            with open(pdf_path, "wb") as out:  # to disk in chunks, never the whole file in memory
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > cfg.limits.max_bytes:
                        raise ConvertError("file_too_large", "The file is larger than the allowed size.", 413)
                    out.write(chunk)
            if size == 0:
                raise ConvertError("unsupported_type", "Only PDF files are accepted.", 415)
            try:
                fut = asyncio.get_running_loop().run_in_executor(
                    pool, convert_job, pdf_path, workdir, opts, cfg.limits)
                manifest = await asyncio.wait_for(fut, timeout=cfg.limits.job_seconds + 30)
            except asyncio.TimeoutError:
                raise ConvertError("timeout", "The PDF took too long to convert.", 504)
            Path(pdf_path).unlink(missing_ok=True)  # the source is not needed any more
            headers = {"X-Pages": str(manifest["pageCount"]), "X-Rendered-Pages": str(manifest["renderedPages"]),
                       "X-Dpi-Used": _dpi_header(manifest), "X-Engine": manifest["engine"]}
            if single is not None:
                page = manifest["pages"][0]
                data = (Path(workdir) / page["file"]).read_bytes()
                return Response(data, media_type=MIME[opts.format], headers={
                    **headers, "X-Page": str(page["page"]), "X-Width": str(page["width"]),
                    "X-Height": str(page["height"])})
            handed_over = True
            return StreamingResponse(stream_zip(workdir, manifest, opts.manifest), media_type="application/zip",
                                     headers=headers, background=BackgroundTask(shutil.rmtree, workdir, True))
        finally:
            inflight -= 1
            if not handed_over:
                shutil.rmtree(workdir, ignore_errors=True)

    return app
