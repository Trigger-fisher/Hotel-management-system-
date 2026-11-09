# copied from quality-gate on 2026-11-04
"""PDF checks: render each page at a fixed dpi and judge it; scanned pages get the picture checks,
pages with a text layer are vector and skip blur and resolution."""
from __future__ import annotations

import io
import math

import cv2
import numpy as np
import pikepdf
import pypdfium2 as pdfium

from ..readcore import pdfsafe
from .judge import evaluate, reason, verdict_of
from .metrics import measure_image
from .profiles import MESSAGES, PDF_ALL_BLANK_REJECTS, PDF_MAX_PAGES, PDF_MIN_IMAGE_DPI, PDF_RENDER_DPI

MIN_TEXT_CHARS = 20
# Rules that make no sense for a rendered vector page.
VECTOR_SKIP = frozenset({"blurry", "tooSmall", "lowResolution", "noisy", "jpegBlocking", "documentSmallInFrame",
                         "cutOff", "extremeAspect", "glare"})


def _image_dpis(data: bytes) -> dict[int, float]:
    """Lowest effective dpi of large embedded pictures per page (1-based). Content streams are read with q/Q/cm/Do."""
    result: dict[int, float] = {}
    try:
        pdf = pikepdf.open(io.BytesIO(data))
    except (pikepdf.PdfError, ValueError, OSError):
        return result
    with pdf:
        for number, page in enumerate(pdf.pages, 1):
            try:
                box = [float(v) for v in page.mediabox]
                page_area = abs(box[2] - box[0]) * abs(box[3] - box[1])
                xobjects = page.resources.get("/XObject", {})
                ctm, stack = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0), []
                for operands, operator in pikepdf.parse_content_stream(page):
                    op = str(operator)
                    if op == "q":
                        stack.append(ctm)
                    elif op == "Q" and stack:
                        ctm = stack.pop()
                    elif op == "cm":
                        a, b, c, d, e, f = (float(x) for x in operands)
                        p, q, r, s, t, u = ctm
                        ctm = (a * p + b * r, a * q + b * s, c * p + d * r, c * q + d * s, e * p + f * r + t, e * q + f * s + u)
                    elif op == "Do" and operands and str(operands[0]) in xobjects:
                        obj = xobjects[str(operands[0])]
                        if obj.get("/Subtype") == "/Image":
                            w_pt, h_pt = math.hypot(ctm[0], ctm[1]), math.hypot(ctm[2], ctm[3])
                            if w_pt * h_pt >= 0.25 * page_area and w_pt > 0:
                                dpi = int(obj.Width) / (w_pt / 72.0)
                                result[number] = min(result.get(number, dpi), dpi)
            except (pikepdf.PdfError, ValueError, TypeError, KeyError, AttributeError):
                continue
    return result


def check_pdf(data: bytes, profile: str, max_pixels: int) -> dict:
    """{reasons, pages, info} for a PDF. File problems are reject reasons, not API errors."""
    problem = None
    try:
        probe = pikepdf.open(io.BytesIO(data))
        if probe.is_encrypted:
            problem = ("pdfEncrypted", "The PDF is password protected. Send an unprotected copy.")
        probe.close()
    except pikepdf.PasswordError:
        problem = ("pdfEncrypted", "The PDF is password protected. Send an unprotected copy.")
    except (pikepdf.PdfError, ValueError, OSError):
        problem = ("pdfCorrupt", "The PDF is damaged and cannot be opened. Send the file again.")
    if problem:
        return {"reasons": [reason(problem[0], "reject", problem[1])], "pages": [], "info": {}}
    with pdfsafe.LOCK:  # PDFium one thread at a time (intake-worker, 5 Nov 2026)
        return _check_pages(data, profile, max_pixels)


def _check_pages(data: bytes, profile: str, max_pixels: int) -> dict:
    try:
        doc = pdfium.PdfDocument(data)
    except pdfium.PdfiumError:
        return {"reasons": [reason("pdfCorrupt", "reject", "The PDF is damaged and cannot be opened. Send the file again.")],
                "pages": [], "info": {}}
    try:
        count = len(doc)
        if count == 0:
            return {"reasons": [reason("noPages", "reject", "The PDF has no pages.")], "pages": [], "info": {}}
        if count > PDF_MAX_PAGES:
            return {"reasons": [reason("tooManyPages", "reject", f"The PDF has more than {PDF_MAX_PAGES} pages. Send fewer pages.")],
                    "pages": [], "info": {"pages": count}}
        dpis = _image_dpis(data)
        pages, sizes, text_pages = [], set(), 0
        for index in range(count):
            page = doc[index]
            try:
                width, height = page.get_size()
                sizes.add((round(width / 10), round(height / 10)))
                textpage = page.get_textpage()
                try:
                    has_text = textpage.count_chars() >= MIN_TEXT_CHARS
                finally:
                    textpage.close()
                scale = min(PDF_RENDER_DPI / 72.0, (max_pixels / max(width * height, 1)) ** 0.5)
                rgb = pdfsafe.render(page, scale)
            finally:
                page.close()
            img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            scores = measure_image(img)
            reasons = evaluate(scores, profile, VECTOR_SKIP if has_text else frozenset())
            if scores["contrast"] < 12:
                reasons = [reason("blankPage", "warn", MESSAGES["blankPage"])]
            if index + 1 in dpis:
                scores["lowestImageDpi"] = round(dpis[index + 1])
                if dpis[index + 1] < PDF_MIN_IMAGE_DPI["reject"]:
                    reasons.append(reason("lowImageDpi", "reject", MESSAGES["lowImageDpi"]))
                elif dpis[index + 1] < PDF_MIN_IMAGE_DPI["warn"]:
                    reasons.append(reason("lowImageDpi", "warn", MESSAGES["lowImageDpi"]))
            text_pages += has_text
            pages.append({"page": index + 1, "verdict": verdict_of(reasons), "reasons": reasons, "textLayer": has_text,
                          "scores": scores})
    finally:
        doc.close()
    overall: list[dict] = []
    blank = [p for p in pages if any(r["code"] == "blankPage" for r in p["reasons"])]
    if PDF_ALL_BLANK_REJECTS and len(blank) == len(pages):
        overall.append(reason("blankPage", "reject", "Every page of the PDF is empty. Check the file."))
    for p in pages:
        for r in p["reasons"]:
            if r["code"] != "blankPage" or not overall:
                overall.append({**r, "page": p["page"]})
    if len(sizes) > 1:
        overall.append(reason("mixedPageSizes", "info", "The pages have different sizes."))
    unique = {(r["code"], r["severity"]): r for r in overall}  # one line per kind, pages listed
    for key, r in unique.items():
        r["pages"] = sorted({o["page"] for o in overall if (o["code"], o["severity"]) == key and "page" in o})
        r.pop("page", None)
    return {"reasons": list(unique.values()), "pages": pages,
            "info": {"pages": len(pages), "textLayerPages": text_pages, "mixedPageSizes": len(sizes) > 1}}
