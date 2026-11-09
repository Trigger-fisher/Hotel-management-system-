"""Renderers. PDFium (via pypdfium2) is the primary engine. Poppler's pdftoppm and Ghostscript are
fallbacks, used only when PDFium cannot open the file, and only when they are installed.
Nothing in a PDF is ever executed: these are rendering engines only."""
from __future__ import annotations

import io
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pikepdf
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw
from PIL import Image

from .errors import ConvertError
from .options import Options, scale_for


@dataclass
class Rendered:
    image: Image.Image
    dpi_used: float
    clamped: bool


def engines_available() -> dict[str, object]:
    return {"pdfium": pdfium.PDFIUM_INFO.version if hasattr(pdfium, "PDFIUM_INFO") else True,
            "poppler": shutil.which("pdftoppm") is not None and shutil.which("pdfinfo") is not None,
            "ghostscript": shutil.which("gs") is not None}


def _password_problem(opts: Options) -> ConvertError:
    if opts.password:
        return ConvertError("pdf_bad_password", "The password does not open this PDF.")
    return ConvertError("pdf_password_required", "This PDF needs a password.")


# ---- PDFium ---------------------------------------------------------------------

class PdfiumDocument:
    engine = "pdfium"

    def __init__(self, path: str, opts: Options) -> None:
        self.opts = opts
        try:
            self._doc = pdfium.PdfDocument(path, password=opts.password)
        except pdfium.PdfiumError as exc:
            if getattr(exc, "err_code", None) == pdfium_raw.FPDF_ERR_PASSWORD:
                raise _password_problem(opts)
            raise
        if opts.forms:
            try:
                if self._doc.get_formtype() != pdfium_raw.FORMTYPE_NONE:
                    self._doc.init_forms()  # must happen before any page is loaded
            except pdfium.PdfiumError:
                pass  # a broken form must not stop the pages from rendering
        self.count = len(self._doc)

    def render(self, index: int, max_pixels: int) -> Rendered:
        o = self.opts
        page = self._doc[index]
        try:
            if o.box == "media":
                page.set_cropbox(*page.get_mediabox())
            if o.rotation is not None:
                page.set_rotation(o.rotation)
            width, height = page.get_size()
            scale, clamped = scale_for(width, height, o, max_pixels)
            smooth = not o.anti_alias
            bitmap = page.render(
                scale=scale, may_draw_forms=o.forms, fill_color=o.background, draw_annots=o.annotations,
                optimize_mode="lcd" if o.lcd_text else None,
                no_smoothtext=smooth, no_smoothimage=smooth, no_smoothpath=smooth)
            return Rendered(bitmap.to_pil(), round(scale * 72.0, 2), clamped)
        finally:
            page.close()

    def close(self) -> None:
        self._doc.close()


# ---- Poppler and Ghostscript (fallbacks) -----------------------------------------

def _page_sizes(path: str, password: str | None) -> list[tuple[float, float]] | None:
    """Page sizes in points from pikepdf's lenient parser; None when it cannot read the file."""
    try:
        with pikepdf.open(path, password=password or "") as pdf:
            sizes = []
            for page in pdf.pages:
                box = [float(v) for v in page.mediabox]
                sizes.append((abs(box[2] - box[0]), abs(box[3] - box[1])))
            return sizes
    except (pikepdf.PdfError, ValueError, OSError):
        return None


class ExternalDocument:
    """pdftoppm or gs behind the same interface. Skipped for password PDFs: a password on a
    command line would be visible to other processes."""

    def __init__(self, engine: str, path: str, opts: Options, workdir: str, sizes: list[tuple[float, float]]) -> None:
        self.engine, self.path, self.opts, self.workdir, self.sizes = engine, path, opts, workdir, sizes
        self.count = len(sizes)

    def render(self, index: int, max_pixels: int) -> Rendered:
        width, height = self.sizes[index]
        scale, clamped = scale_for(width, height, self.opts, max_pixels)
        dpi = max(1.0, round(scale * 72.0, 2))
        out = Path(self.workdir) / f"ext-{index}.png"
        if self.engine == "poppler":
            args = [shutil.which("pdftoppm"), "-png", "-singlefile", "-r", str(dpi),
                    "-f", str(index + 1), "-l", str(index + 1),
                    *(["-cropbox"] if self.opts.box == "crop" else []),  # poppler uses the media box by default
                    self.path, str(out.with_suffix(""))]
        else:
            args = [shutil.which("gs"), "-sDEVICE=png16m", f"-r{dpi}", "-dSAFER", "-dNOPAUSE", "-dBATCH", "-dQUIET",
                    f"-dFirstPage={index + 1}", f"-dLastPage={index + 1}",
                    "-dUseCropBox" if self.opts.box == "crop" else "-dUseMediaBox",
                    f"-sOutputFile={out}", self.path]
        try:
            done = subprocess.run(args, capture_output=True, timeout=120, check=False, shell=False)
        except (OSError, subprocess.SubprocessError):
            raise ConvertError("render_failed", "The page could not be drawn.")
        if done.returncode != 0 or not out.exists():
            raise ConvertError("render_failed", "The page could not be drawn.")
        img = Image.open(io.BytesIO(out.read_bytes()))
        img.load()
        out.unlink(missing_ok=True)
        return Rendered(img, dpi, clamped)

    def close(self) -> None:
        pass


def open_document(path: str, opts: Options, workdir: str):
    """PDFium first; the fallbacks only when PDFium cannot open the file at all."""
    try:
        return PdfiumDocument(path, opts)
    except ConvertError:
        raise
    except pdfium.PdfiumError:
        pass
    if opts.password is None:
        sizes = _page_sizes(path, None)
        if sizes:
            for engine, tool in (("poppler", "pdftoppm"), ("ghostscript", "gs")):
                if shutil.which(tool):
                    return ExternalDocument("poppler" if engine == "poppler" else "gs", path, opts, workdir, sizes)
    raise ConvertError("pdf_corrupt", "The PDF could not be read.")

