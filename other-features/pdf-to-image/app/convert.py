"""One conversion job. Runs inside a worker process and writes one file per page into the job's
directory, so the web process can stream them out one at a time without holding them in memory."""
from __future__ import annotations

import time
from pathlib import Path

from .config import Limits
from .encode import apply_color_mode, encode
from .errors import ConvertError
from .options import EXT, Options, expand_pages
from .render import open_document


JOB_LEVEL = {"timeout", "output_too_large"}


def page_name(number: int, total: int, fmt: str) -> str:
    return f"page-{number:0{max(3, len(str(total)))}d}.{EXT[fmt]}"


def is_pdf(head: bytes) -> bool:
    return b"%PDF-" in head[:1024]


def convert_job(pdf_path: str, outdir: str, opts: Options, limits: Limits) -> dict:
    deadline = time.monotonic() + limits.job_seconds

    def check_time() -> None:
        if time.monotonic() > deadline:
            raise ConvertError("timeout", "The PDF took too long to convert.", 504)

    with open(pdf_path, "rb") as fh:
        if not is_pdf(fh.read(1024)):
            raise ConvertError("unsupported_type", "Only PDF files are accepted.", 415)
    try:
        doc = open_document(pdf_path, opts, outdir)
    except ConvertError:
        raise
    except Exception:  # an unreadable file is a refusal, never a crash
        raise ConvertError("pdf_corrupt", "The PDF could not be read.")
    pages_out: list[dict] = []
    errors: list[dict] = []
    try:
        if doc.count == 0:
            raise ConvertError("no_pages", "The PDF has no pages.")
        if doc.count > limits.max_pages:
            raise ConvertError("too_many_pages", "The PDF has too many pages.")
        wanted = expand_pages(opts.pages, doc.count)
        if not wanted:
            raise ConvertError("page_range_empty", "The page range selects no page of this PDF.")
        budget = limits.max_total_pixels
        for number in wanted:
            check_time()
            try:
                rendered = doc.render(number - 1, limits.max_pixels_per_page)
                img = apply_color_mode(rendered.image, opts)
                budget -= img.size[0] * img.size[1]
                if budget < 0:
                    raise ConvertError("output_too_large", "The converted pages would be too large.")
                data = encode(img, opts, rendered.dpi_used)
            except ConvertError as exc:
                if exc.code in JOB_LEVEL:
                    raise  # these end the whole job, not just one page
                if opts.strict_pages:
                    raise ConvertError("page_failed", f"Page {number} failed: {exc.message}")
                errors.append({"page": number, "code": exc.code, "message": exc.message})
                continue
            except Exception:  # a damaged page (fonts, streams) must not kill the others
                if opts.strict_pages:
                    raise ConvertError("page_failed", f"Page {number} could not be drawn.")
                errors.append({"page": number, "code": "render_failed", "message": "The page could not be drawn."})
                continue
            name = page_name(number, doc.count, opts.format)
            (Path(outdir) / name).write_bytes(data)
            pages_out.append({"page": number, "file": name, "width": img.size[0], "height": img.size[1],
                              "dpiUsed": rendered.dpi_used, "clamped": rendered.clamped, "bytes": len(data)})
        if not pages_out:
            raise ConvertError("all_pages_failed", "None of the pages could be drawn.")
        return {"pageCount": doc.count, "renderedPages": len(pages_out), "engine": doc.engine,
                "format": opts.format, "pages": pages_out, "errors": errors}
    finally:
        doc.close()

