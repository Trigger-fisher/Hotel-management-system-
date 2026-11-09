"""Step 5: real type, then the PIXEL RE-SAVE. Pictures are decoded and kept as a fresh in-memory pixel array (same pixels,
all metadata dropped); every PDF page is rendered at 300 dpi to such an array and the PDF is discarded. Nothing is written to disk.

EXIF orientation is applied (a lossless turn of the same pixels), because the tag that carried it is dropped. Transparency is
laid on white. The text layer of a PDF may be read as a hint and is returned separately."""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import pillow_heif
import pypdfium2 as pdfium
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import ALLOWED_TYPES, MAX_BYTES, MAX_PAGES, MAX_PDF_PIXELS, MAX_PIXELS, PDF_DPI
from .errors import reject
from .readcore import pdfsafe
from .readcore.sniff import sniff

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = MAX_PIXELS * 2  # Pillow's own bomb guard stays ON (warns above the limit, errors at twice)
STEP = "rebuild"


@dataclass
class Picture:
    pixels: np.ndarray  # H x W x 3, uint8
    hint_text: str = ""  # PDF text layer (read-only hint), empty for pictures


def real_type(data: bytes) -> str:
    """Only JPEG, PNG, WebP, HEIC and PDF; decided from the bytes before any decoding."""
    if len(data) > MAX_BYTES:
        raise reject("file_too_large", "The file is larger than 25 MB.", "type")
    kind = sniff(data[:2048])
    if kind not in ALLOWED_TYPES:
        raise reject("unsupported_type", "Only JPEG, PNG, WebP, HEIC and PDF files are accepted.", "type")
    return kind


def _flatten(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
        rgba = img.convert("RGBA")
        return Image.alpha_composite(Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba).convert("RGB")
    return img.convert("RGB")


def resave_picture(data: bytes) -> Picture:
    try:
        img = Image.open(io.BytesIO(data))
        if img.size[0] * img.size[1] > MAX_PIXELS:  # checked from the header, before any pixel is decoded
            raise reject("too_many_pixels", "The picture has more than 40 megapixels.", STEP)
        if getattr(img, "n_frames", 1) > 1:
            img.seek(0)
        img.load()
        img = ImageOps.exif_transpose(img)
        return Picture(np.asarray(_flatten(img)).copy())
    except Image.DecompressionBombError:
        raise reject("too_many_pixels", "The picture has too many pixels.", STEP)
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError, MemoryError):
        raise reject("image_corrupt", "The picture could not be read.", STEP)


def resave_pdf(data: bytes, check=None) -> list[Picture]:
    with pdfsafe.LOCK:  # PDFium is used by one thread at a time; every object of it is closed inside (readcore/pdfsafe.py)
        return _resave_pdf(data, check)


def _resave_pdf(data: bytes, check=None) -> list[Picture]:
    try:
        doc = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        if getattr(exc, "err_code", None) == 4:
            raise reject("pdf_encrypted", "Password-protected PDFs are not accepted.", STEP)
        raise reject("pdf_corrupt", "The PDF could not be read.", STEP)
    try:
        count = len(doc)  # the page limit is checked BEFORE rendering anything
        if count == 0:
            raise reject("pdf_corrupt", "The PDF has no pages.", STEP)
        if count > MAX_PAGES:
            raise reject("too_many_pages", "The PDF has more than 20 pages.", STEP)
        try:
            sizes = [doc.get_page_size(i) for i in range(count)]
        except pdfium.PdfiumError:
            raise reject("pdf_corrupt", "A page of the PDF could not be read.", STEP)
        # 40 MP per page and MAX_PDF_PIXELS for the whole document (20 A4 pages at 300 dpi); oversized pages are drawn smaller
        at_dpi = sum(w * h for w, h in sizes) * (PDF_DPI / 72.0) ** 2
        doc_scale = min(1.0, (MAX_PDF_PIXELS / max(at_dpi, 1)) ** 0.5)
        pictures = []
        for index in range(count):
            if check is not None:
                check()
            page = doc[index]
            try:
                width, height = sizes[index]
                scale = min(PDF_DPI / 72.0 * doc_scale, (MAX_PIXELS / max(width * height, 1)) ** 0.5)
                text = page.get_textpage()
                try:
                    hint = text.get_text_range()
                finally:
                    text.close()
                pictures.append(Picture(pdfsafe.render(page, scale), hint))
            except pdfium.PdfiumError:
                raise reject("pdf_corrupt", "A page of the PDF could not be drawn.", STEP)
            finally:
                page.close()
        return pictures
    finally:
        doc.close()


def resave(data: bytes, check=None) -> list[Picture]:
    kind = real_type(data)
    return resave_pdf(data, check) if kind == "pdf" else [resave_picture(data)]
