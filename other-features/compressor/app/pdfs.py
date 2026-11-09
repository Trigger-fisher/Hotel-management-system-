"""PDF compression. Text and vector content is never touched. Only embedded pictures are
re-encoded, and every candidate is rendered and compared page by page before it is accepted."""
from __future__ import annotations

import io
import math
from dataclasses import replace

import pikepdf
import pypdfium2 as pdfium
from PIL import Image
from pikepdf import Name, ObjectStreamMode, PdfImage
from pikepdf.models.image import UnsupportedImageTypeError

from . import tools
from .errors import CompressorError, Result
from .limits import Deadline, Limits
from .modes import EXACT_SCORE, PDF_VERIFY_DPI, PDF_VERIFY_MAX_SIDE, Mode, SizeRule, floors_below, gentler
from .quality import Reference, ssim

MIN_IMAGE_BYTES = 10_000  # smaller pictures are not worth the risk
MIN_GAIN = 0.9  # a re-encoded picture must be at least 10% smaller to replace the old one
SKIP_FILTERS = {"/JBIG2Decode", "/CCITTFaxDecode", "/JPXDecode"}  # bilevel scans stay as they are
JPEG_Q = (35, 100)
# Size rule for PDFs: the image cap is per page (pages x cap for the whole file). Over it, the pictures inside are
# brought down in DPI first, then the floor is relaxed, then a last-resort pass; text and vector content is never
# touched, so a PDF that is big for other reasons is flagged sizeCapExceeded instead.
SIZE_DPI_STEPS = (150, 120, 100)
REF_CACHE_PAGES = 10  # original pages kept measured between candidates (short PDFs only, for memory)
LAST_RESORT_DPI = 72
_DECODE_ERRORS = (pikepdf.PdfError, NotImplementedError, UnsupportedImageTypeError,
                  ValueError, OSError, KeyError, AttributeError, TypeError)


# ---- opening -----------------------------------------------------------------

def _open(data: bytes, limits: Limits) -> pikepdf.Pdf:
    try:
        pdf = pikepdf.open(io.BytesIO(data))
    except pikepdf.PasswordError:
        raise CompressorError("pdf_encrypted", "Password-protected PDFs are not accepted.")
    except (pikepdf.PdfError, ValueError, OSError):
        raise CompressorError("pdf_corrupt", "The PDF could not be read.")
    if pdf.is_encrypted:
        raise CompressorError("pdf_encrypted", "Encrypted PDFs are not accepted.")
    if len(pdf.pages) > limits.max_pages:
        raise CompressorError("too_many_pages", "The PDF has too many pages.")
    return pdf


def _save(pdf: pikepdf.Pdf) -> bytes:
    pdf.remove_unreferenced_resources()
    buf = io.BytesIO()
    pdf.save(buf, object_stream_mode=ObjectStreamMode.generate, compress_streams=True,
             recompress_flate=True)
    return buf.getvalue()


# ---- how big each picture is shown (for the DPI cap) ---------------------------

def _mul(m: tuple, n: tuple) -> tuple:
    a, b, c, d, e, f = m
    p, q, r, s, t, u = n
    return (a * p + b * r, a * q + b * s, c * p + d * r, c * q + d * s,
            e * p + f * r + t, e * q + f * s + u)


def _display_sizes(page: pikepdf.Page) -> dict[tuple, tuple[float, float]]:
    """Largest on-page size in points per page-level image, from the q/Q/cm/Do operators."""
    sizes: dict[tuple, tuple[float, float]] = {}
    try:
        xobjects = page.resources.get("/XObject", {})
        ctm, stack = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0), []
        for operands, operator in pikepdf.parse_content_stream(page):
            op = str(operator)
            if op == "q":
                stack.append(ctm)
            elif op == "Q" and stack:
                ctm = stack.pop()
            elif op == "cm":
                ctm = _mul(tuple(float(x) for x in operands), ctm)
            elif op == "Do" and operands and str(operands[0]) in xobjects:
                obj = xobjects[str(operands[0])]
                if obj.get("/Subtype") == "/Image":
                    w, h = math.hypot(ctm[0], ctm[1]), math.hypot(ctm[2], ctm[3])
                    old = sizes.get(obj.objgen, (0.0, 0.0))
                    sizes[obj.objgen] = (max(w, old[0]), max(h, old[1]))
    except (pikepdf.PdfError, ValueError, TypeError, KeyError, AttributeError):
        return {}
    return sizes


# ---- one picture -------------------------------------------------------------

def _lowest_jpeg(ref: Image.Image, mode: Mode, deadline: Deadline) -> bytes | None:
    """The lowest JPEG quality whose score meets the mode's floor: plain bisection over JPEG_Q, as before. The
    picture's grey copy for the score is measured once instead of on every try (same numbers, less work)."""
    lo, hi = JPEG_Q
    measure = Reference(ref)
    subsampling = 0 if mode.name == "strict" else 2
    best: bytes | None = None
    while lo <= hi:
        deadline.check()
        mid = (lo + hi) // 2
        buf = io.BytesIO()
        ref.save(buf, "JPEG", quality=mid, optimize=True, subsampling=subsampling)
        if measure.score(Image.open(io.BytesIO(buf.getvalue()))) >= mode.ssim_min:
            best, hi = buf.getvalue(), mid - 1
        else:
            lo = mid + 1
    return best

def _recompress(obj: pikepdf.Object, shown: tuple[float, float] | None, mode: Mode,
                limits: Limits, deadline: Deadline) -> bool:
    if obj.get("/ImageMask") or "/Mask" in obj or "/Decode" in obj:
        return False
    smask = obj.get("/SMask")
    if smask is not None and "/Matte" in smask:
        return False
    flt = obj.get("/Filter")
    names = [str(f) for f in flt] if isinstance(flt, pikepdf.Array) else ([str(flt)] if flt else [])
    if SKIP_FILTERS & set(names):
        return False
    raw_len = len(obj.read_raw_bytes())
    if raw_len < MIN_IMAGE_BYTES:
        return False
    width, height = int(obj.get("/Width", 0)), int(obj.get("/Height", 0))
    if width * height <= 0 or width * height > limits.max_pixels:
        return False
    try:
        pil = PdfImage(obj).as_pil_image()
        pil.load()
    except _DECODE_ERRORS:
        return False
    indexed = isinstance(obj.get("/ColorSpace"), pikepdf.Array) and str(obj.ColorSpace[0]) == "/Indexed"
    if pil.mode == "P":
        pil = pil.convert("RGB")
    if pil.mode not in ("RGB", "L"):
        return False

    ref = pil
    if shown and mode.pdf_dpi_cap and min(shown) > 0:
        dpi = max(width / (shown[0] / 72.0), height / (shown[1] / 72.0))
        if dpi > mode.pdf_dpi_cap * 1.1:
            scale = mode.pdf_dpi_cap / dpi
            ref = pil.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)

    best = _lowest_jpeg(ref, mode, deadline)
    if best is None or len(best) >= raw_len * MIN_GAIN:
        return False

    obj.write(best, filter=Name.DCTDecode)
    obj.Width, obj.Height, obj.BitsPerComponent = ref.size[0], ref.size[1], 8
    if indexed:
        obj.ColorSpace = Name.DeviceRGB
    return True


def _images_pass(data: bytes, mode: Mode, limits: Limits, deadline: Deadline) -> bytes:
    pdf = _open(data, limits)
    shown: dict[tuple, tuple[float, float]] = {}
    for page in pdf.pages:
        for key, size in _display_sizes(page).items():
            old = shown.get(key, (0.0, 0.0))
            shown[key] = (max(size[0], old[0]), max(size[1], old[1]))
    for obj in pdf.objects:
        if isinstance(obj, pikepdf.Stream) and obj.get("/Subtype") == "/Image":
            deadline.check()
            _recompress(obj, shown.get(obj.objgen), mode, limits, deadline)
    return _save(pdf)


# ---- page-by-page check -------------------------------------------------------

def _render(doc: pdfium.PdfDocument, index: int) -> Image.Image:
    page = doc[index]
    try:
        width, height = page.get_size()
        scale = min(PDF_VERIFY_DPI / 72.0, PDF_VERIFY_MAX_SIDE / max(width, height, 1.0))
        return page.render(scale=scale).to_pil().convert("RGB")
    finally:
        page.close()


def _verify(original: pdfium.PdfDocument, candidate: bytes, floor: float, deadline: Deadline,
            refs: dict[int, Reference] | None = None) -> float:
    """Worst page score. Returns 0.0 on any page-count or rendering problem. `refs` keeps each original page rendered
    and measured once across the several candidates of one job (same score, less work)."""
    refs = {} if refs is None else refs
    try:
        doc = pdfium.PdfDocument(candidate)
    except pdfium.PdfiumError:
        return 0.0
    try:
        if len(doc) != len(original):
            return 0.0
        worst = 1.0
        for i in range(len(doc)):
            deadline.check()
            ref = refs.get(i) or Reference(_render(original, i))
            if len(doc) <= REF_CACHE_PAGES:  # memory: about 8 MB per cached page
                refs[i] = ref
            page = _render(doc, i)
            score = ref.score(page) if page.size == ref.size else ssim(_render(original, i), page)
            worst = min(worst, score)
            if worst < floor:
                break  # one bad page is enough to refuse
        return worst
    except pdfium.PdfiumError:
        return 0.0
    finally:
        doc.close()


def _looks_scanned(doc: pdfium.PdfDocument) -> bool:
    for i in range(len(doc)):
        page = doc[i]
        try:
            text = page.get_textpage()
            try:
                if text.count_chars() > 0:
                    return False
            finally:
                text.close()
        finally:
            page.close()
    return True


# ---- the job -----------------------------------------------------------------

def compress_pdf(data: bytes, mode: Mode, limits: Limits, deadline: Deadline, workdir: str,
                 rule: SizeRule | None = None) -> Result:
    rule = rule or SizeRule()
    pdf = _open(data, limits)  # also refuses encrypted, corrupt and too long
    pages = max(1, len(pdf.pages))
    try:
        baseline = _save(pdf)
    except pikepdf.PdfError:
        raise CompressorError("pdf_corrupt", "The PDF could not be rewritten safely.")
    finally:
        pdf.close()

    try:
        original = pdfium.PdfDocument(data)
    except pdfium.PdfiumError:
        return Result(data, "pdf", 1.0, ("kept_original", "unverifiable"))
    refs: dict[int, Reference] = {}
    try:
        best, best_score, notes = data, 1.0, ["kept_original"]

        if len(baseline) < len(best):
            score = _verify(original, baseline, EXACT_SCORE, deadline, refs)
            if score >= EXACT_SCORE:
                best, best_score, notes = baseline, score, ["structure_cleaned"]
        if mode.lossless:
            return Result(best, "pdf", best_score, tuple(notes))

        for attempt, params in (("images", mode), ("images_gentle", gentler(mode))):
            deadline.check()
            candidate = _images_pass(data, params, limits, deadline)
            if len(candidate) >= len(best):
                continue
            score = _verify(original, candidate, params.ssim_min, deadline, refs)
            if score >= params.ssim_min:
                best, best_score, notes = candidate, score, [attempt]
                break

        if mode.allow_ghostscript and mode.pdf_dpi_cap and _looks_scanned(original):
            deadline.check()
            candidate = tools.ghostscript(data, workdir, mode.pdf_dpi_cap, mode.gs_qfactor, deadline.remaining())
            if candidate and len(candidate) < len(best):
                score = _verify(original, candidate, mode.ssim_min, deadline, refs)
                if score >= mode.ssim_min:
                    best, best_score, notes = candidate, score, ["ghostscript_scan"]
        return _size_rule(data, original, refs, best, best_score, notes, pages, mode, rule, limits, deadline)
    finally:
        original.close()


def _size_rule(data: bytes, original: pdfium.PdfDocument, refs: dict[int, Reference], best: bytes, best_score: float,
               notes: list[str], pages: int, mode: Mode, rule: SizeRule, limits: Limits, deadline: Deadline) -> Result:
    """Per page: target pages x target, hard cap pages x cap, for what the pictures inside can give."""
    target, cap = rule.target * pages, rule.cap * pages
    if len(best) <= target:
        return Result(best, "pdf", best_score, tuple(notes))
    notes = notes + ["targetMissed"]
    if len(best) <= cap:
        return Result(best, "pdf", best_score, tuple(notes))
    if mode.lossless:
        return Result(best, "pdf", best_score, tuple(notes + ["sizeCapExceeded"]))
    floors = floors_below(mode)
    dpis = tuple(d for d in SIZE_DPI_STEPS if not mode.pdf_dpi_cap or d < mode.pdf_dpi_cap)
    steps = [(floors[0], d, ["downscaled"]) for d in dpis]
    steps += [(f, dpis[-1] if dpis else mode.pdf_dpi_cap, ["downscaled", "qualityFloorRelaxed"]) for f in floors[1:]]
    steps.append((0.0, LAST_RESORT_DPI, ["downscaled", "qualityFloorRelaxed", "lastResortShrink"]))
    smallest = (best, best_score)
    for floor, dpi, flags in steps:
        deadline.check()
        params = replace(mode, ssim_min=floor, pdf_dpi_cap=dpi)
        candidate = _images_pass(data, params, limits, deadline)
        if len(candidate) >= len(smallest[0]):
            continue
        score = _verify(original, candidate, floor, deadline, refs)
        if score < floor or score <= 0.0:  # 0.0 also means a page went missing or would not render
            continue
        smallest = (candidate, score)
        if len(candidate) <= cap:
            return Result(candidate, "pdf", score, tuple(notes + [f"images_dpi_{dpi}"] + flags))
    # The pictures cannot give enough: text, fonts or vector drawings make up the size. Never altered: flagged.
    return Result(smallest[0], "pdf", smallest[1], tuple(notes + ["sizeCapExceeded"]))
