# copied from reader on 2026-11-04
"""The reading pipeline: find the document, straighten it, detect scripts, read, merge, flag."""
from __future__ import annotations

import io
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import cv2
import numpy as np
import pillow_heif
import pypdfium2 as pdfium
from PIL import Image, ImageOps, UnidentifiedImageError

from . import codes, geometry, mrz, mrzpass, ids, pdfsafe, preprocess, quality
from .config import WorkerConfig
from .engines.base import Engine, OcrLine
from .errors import ReaderError
from .merge import full_text, label, merge_readings, reading_order
from .scripts import PROBE_ORDER, SCRIPTS, hint_scripts, histogram

pillow_heif.register_heif_opener()
# The declared size is checked by us before any pixel is decoded; Pillow's own bomb guard stays on behind it (warns above the
# limit, refuses at twice), and a stricter limit set elsewhere in this process is never loosened (intake-worker, 5 Nov 2026).
PILLOW_PIXELS = WorkerConfig().max_pixels
Image.MAX_IMAGE_PIXELS = min(Image.MAX_IMAGE_PIXELS or PILLOW_PIXELS, PILLOW_PIXELS)

MIN_PDF_TEXT_CHARS = 20  # fewer characters than this on a page: the page is a picture, so OCR it
PROBE_SIDE = 1400
SERIOUS_FLAGS = {"blurry", "tooDark", "lowContrast", "glare", "lowResolution", "partlyCutOff",
                 "pageCurved", "noTextFound", "lowConfidence"}
LOW_LINE_CONFIDENCE = 0.6
LOW_AVERAGE_CONFIDENCE = 0.8
LATIN_ONLY_CONFIDENCE = 0.85  # every line this confident and Latin: skip the other script models
UPRIGHT_CONFIDENT = 0.88  # an upright read this confident ends the orientation test early
ROTATION_MARGIN = 1.3  # a quarter turn must score this many times better than upright to be chosen
OSD_SURE_TURN = 0.6  # Tesseract OSD orientation confidence (raw / 15) above which its turn is taken without a check read


@dataclass
class ReadOptions:
    languages: list[str] = field(default_factory=list)
    mode: str = "fast"  # fast | thorough
    find_document: bool = True
    skip_orientation: bool = False  # the round-trip re-read of an already upright picture
    codes: bool = True  # QR and barcode decoding (the intake worker turns it off: MJ, 5 Nov 2026)
    # Speed (intake-worker, 5 Nov 2026): the other scripts and the MRZ strip are read AT THE SAME TIME as the Latin reading and
    # used only where the plain order would have read them, so the answer is the same and less time is spent waiting.
    side_by_side: bool = False


_SIDE = ThreadPoolExecutor(max_workers=4, thread_name_prefix="read-side")


@dataclass
class RegionResult:
    index: int
    lines: list[OcrLine]
    quality: quality.Quality
    rotation: int
    skew: float
    flags: list[str]
    quad: list[list[float]] | None
    width: int
    height: int
    engines: set[str]
    scripts: list[str]
    variant: str

    @property
    def confidence(self) -> float:
        return _confidence(self.lines)


def _confidence(lines: list[OcrLine]) -> float:
    chars = sum(len(l.text) for l in lines)
    return sum(l.confidence * len(l.text) for l in lines) / chars if chars else 0.0


def _score(lines: list[OcrLine]) -> float:
    """Total trustworthy characters: reading more text confidently beats reading less."""
    return sum(len(l.text) * l.confidence ** 2 for l in lines)


def _latin_only_ok(lines: list[OcrLine]) -> bool:
    """True when every line is confidently Latin: then the extra-script models (the slow ones) have nothing to add."""
    return bool(lines) and all(l.script in ("Latin", "Common") and l.confidence >= LATIN_ONLY_CONFIDENCE for l in lines)


# ---- decoding --------------------------------------------------------------------------

def decode_image(data: bytes, max_pixels: int) -> np.ndarray:
    try:
        pil = Image.open(io.BytesIO(data))
        if pil.size[0] * pil.size[1] > max_pixels:
            raise ReaderError("too_many_pixels", "The picture has too many pixels.")
        if getattr(pil, "n_frames", 1) > 1:
            pil.seek(0)
        pil.load()
        pil = ImageOps.exif_transpose(pil)
        if pil.mode in ("RGBA", "LA", "PA") or "transparency" in pil.info:
            rgba = pil.convert("RGBA")
            pil = Image.alpha_composite(Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba)
        return cv2.cvtColor(np.asarray(pil.convert("RGB")), cv2.COLOR_RGB2BGR)
    except ReaderError:
        raise
    except Image.DecompressionBombError:
        raise ReaderError("too_many_pixels", "The picture has too many pixels.")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError, MemoryError):
        raise ReaderError("image_corrupt", "The picture could not be read.")


# ---- the reader ------------------------------------------------------------------------

class Reader:
    def __init__(self, engines: list[Engine], cfg: WorkerConfig) -> None:
        self.engines, self.cfg = engines, cfg
        self.job_end = time.monotonic() + cfg.job_seconds
        self.upright = False  # set per region: the picture is known to be upright (skip_orientation)

    # -- helpers -------------------------------------------------------------------------
    def _check_time(self) -> None:
        if time.monotonic() > self.job_end:
            raise ReaderError("timeout", "The file took too long to read.", 504)

    def _engine_for(self, script: str) -> Engine | None:
        return next((e for e in self.engines if e.supports(script)), None)

    def _read(self, img: np.ndarray, scripts: list[str], hints: dict[str, list[str]], used: set[str],
              whitelist: str | None = None, psm: int | None = None) -> dict[str, list[OcrLine]]:
        readings: dict[str, list[OcrLine]] = {}
        groups: dict[int, tuple[Engine, list[str]]] = {}
        for script in scripts:
            engine = self._engine_for(script)
            if engine is not None:
                groups.setdefault(id(engine), (engine, []))[1].append(script)
        for engine, own in groups.values():
            # Tesseract runs as a new process per call: the scripts it serves are read in ONE call (-l hin+guj+eng) and each line
            # is filed under the script its letters belong to (speed, MJ 5 Nov 2026). Other engines read one script at a time.
            batches = [own] if engine.name == "tesseract" and len(own) > 1 else [[s] for s in own]
            for batch in batches:
                self._check_time()
                extra = {"upright": True} if self.upright and engine.name == "rapidocr" else {}
                lines = engine.recognize(img, batch, hints, whitelist=whitelist, psm=psm, **extra)
                for line in lines:
                    line.engine = engine.name
                if lines:
                    used.add(engine.name)
                for script in batch:
                    readings.setdefault(script, [])
                for line in lines:
                    mine = label(line).script if len(batch) > 1 else batch[0]
                    readings[mine if mine in batch else batch[0]].append(line)
        return readings

    def _small(self, img: np.ndarray, side: int = PROBE_SIDE) -> np.ndarray:
        longest = max(img.shape[:2])
        if longest <= side:
            return img
        return cv2.resize(img, None, fx=side / longest, fy=side / longest, interpolation=cv2.INTER_AREA)

    # -- orientation -----------------------------------------------------------------------
    def orientation(self, img: np.ndarray, hint_script_list: list[str]) -> tuple[int, str | None]:
        """Clockwise degrees that make the page upright, and the script Tesseract's OSD saw (if any)."""
        small = self._small(img)
        for engine in self.engines:
            osd = engine.osd(small)
            if osd and osd.confidence >= 0.3:
                # A TURN is believed only when OSD is sure; a weak "turn it" (an upright visa sticker with a big empty band was
                # called 180 degrees and Bengali) is checked by the quick reads below. Changed in intake-worker on 2026-11-04.
                if osd.rotate_cw == 0 or osd.confidence >= OSD_SURE_TURN:
                    return osd.rotate_cw, osd.script
                break
        if not self.engines:
            return 0, None
        # No OSD answer (too little text or no OSD data): compare a quick read at the four turns.
        scripts = [s for s in (hint_script_list or ["Latin"]) if self._engine_for(s)] or ["Latin"]
        tiny = self._small(img, 1000)
        scores = {}
        for turn in (0, 90, 180, 270):
            lines = merge_readings(self._read(preprocess.rotate_cw(tiny, turn), scripts, {}, set()))
            scores[turn] = _score(lines)
            if turn == 0 and sum(len(l.text) for l in lines) >= 12 and _confidence(lines) >= UPRIGHT_CONFIDENT:
                return 0, None  # already reads well upright: the other three turns would only cost time
        best_rotation = max(scores, key=scores.get)
        # Modern engines read turned text almost as well as upright text, so a turn must win CLEARLY to be believed.
        if best_rotation != 0 and scores[best_rotation] < ROTATION_MARGIN * scores[0]:
            best_rotation = 0
        return best_rotation, None

    # -- scripts ---------------------------------------------------------------------------
    def detect_scripts(self, img: np.ndarray, opts: ReadOptions, hinted: list[str],
                       osd_script: str | None) -> list[str]:
        scripts = ["Latin"]
        for s in hinted + ([osd_script] if osd_script else []):
            if s and s not in scripts and s in SCRIPTS:
                scripts.append(s)
        if hinted:
            return [s for s in scripts if self._engine_for(s)] or ["Latin"]
        # Pass 1: nothing told us the script, so probe and CONFIRM by counting letters per Unicode block.
        probes = [s for s in PROBE_ORDER if s not in scripts and self._engine_for(s)]
        probes = probes if opts.mode == "thorough" else probes[:6]
        small = self._small(img)
        used: set[str] = set()
        for script in probes:
            readings = self._read(small, [script], {}, used)
            letters = histogram(" ".join(l.text for l in readings.get(script, []) if l.confidence >= 0.4))
            own = letters.get(script, 0) + (letters.get("CJK", 0) if script == "Japanese" else 0)
            if own >= 4:
                scripts.append(script)
        return scripts

    # -- one document region ----------------------------------------------------------------
    def read_region(self, region: geometry.Region, opts: ReadOptions) -> RegionResult:
        self._check_time()
        img = region.image
        flags = list(region.flags)
        hinted, hints = hint_scripts(opts.languages)
        rotation, osd_script = (0, None) if opts.skip_orientation else self.orientation(img, hinted)
        self.upright = opts.skip_orientation
        upright = preprocess.rotate_cw(img, rotation)
        gray = quality.to_gray(upright)
        skew = quality.estimate_skew(gray)
        flat = preprocess.deskew(upright, skew) if abs(skew) >= 0.3 else upright
        applied_skew = skew if abs(skew) >= 0.3 else 0.0
        q = quality.measure(flat)
        flags += q.flags
        scripts = self.detect_scripts(flat, opts, hinted, osd_script)

        used: set[str] = set()
        thorough = opts.mode == "thorough"
        budget = self.cfg.thorough_seconds_per_page if thorough else self.cfg.fast_seconds_per_page
        started = time.monotonic()
        best_lines: list[OcrLine] = []
        best_variant, best_score = "orig", -1.0
        base_gray = quality.to_gray(flat)
        names = preprocess.plan(q, thorough)
        curves, scale = geometry.line_curves(base_gray)
        height = quality.median_text_height(base_gray) or 20.0
        if geometry.curl_amount(curves, height) >= geometry.CURL_FLAG:
            flags.append("pageCurved")
            names.append("dewarp")
        for name in names:
            if time.monotonic() - started > budget and best_score >= 0:
                break
            if name == "dewarp":
                variant = geometry.straighten(base_gray, curves, scale)
            else:
                variant = preprocess.apply(name, flat if name == "orig" else base_gray)
            factor = variant.shape[1] / flat.shape[1]
            lines = []
            raw = None
            ahead = None
            if len(scripts) > 1:
                if opts.side_by_side:
                    ahead_used: set[str] = set()
                    ahead = (_SIDE.submit(self._read, variant, [s for s in scripts if s != "Latin"], hints, ahead_used), ahead_used)
                raw = self._read(variant, ["Latin"], hints, used).get("Latin", [])
                for l in raw:
                    label(l)
                # Judge the RAW reading: a Latin model that met Hindi writes junk that the merge would hide.
                lines = merge_readings({"Latin": raw}) if _latin_only_ok(raw) else []
            if len(scripts) == 1 or not lines:
                # other scripts may be present: read them too (the Latin reading just made is reused, not read twice)
                others = [s for s in scripts if s != "Latin"] if raw is not None else scripts
                if ahead is not None:
                    readings = ahead[0].result()
                    used |= ahead[1]
                else:
                    readings = self._read(variant, others, hints, used)
                if raw is not None:
                    readings = {"Latin": raw, **readings}
                lines = merge_readings(readings)
            for line in lines:
                x0, y0, x1, y1 = line.bbox
                line.bbox = (x0 / factor, y0 / factor, x1 / factor, y1 / factor)
            score = _score(lines)
            if score > best_score * 1.02 or best_score < 0:
                best_lines, best_variant, best_score = lines, name, score
            if not thorough and _confidence(lines) >= 0.92 and name == "orig":
                break
        best_lines = reading_order(best_lines)
        h, w = flat.shape[:2]
        if region.quad is None and any(
                l.bbox[0] <= 0.003 * w or l.bbox[2] >= 0.997 * w or l.bbox[1] <= 0.003 * h or l.bbox[3] >= 0.997 * h
                for l in best_lines) and "partlyCutOff" not in flags:
            flags.append("partlyCutOff")
        for line in best_lines:
            line.region = region.index
        quad = None if region.quad is None else [[round(float(x), 1), round(float(y), 1)] for x, y in region.quad]
        return RegionResult(region.index, best_lines, q, rotation, applied_skew, list(dict.fromkeys(flags)), quad,
                            w, h, used, scripts, best_variant)

    # -- whole image file -------------------------------------------------------------------
    def read_image(self, data: bytes, opts: ReadOptions) -> dict:
        img = decode_image(data, self.cfg.max_pixels)
        if not self.engines:
            raise ReaderError("no_engine", "No OCR engine is installed on this server.", 503)
        regions = geometry.localise(img, opts.find_document)
        results = [self.read_region(r, opts) for r in regions]
        codes_found = codes.read_codes(img) if opts.codes else []
        return assemble(results, codes_found, pages=1, opts=opts, image_shape=img.shape[:2], extra_texts=[],
                        mrz_candidates=self._mrz_candidates(results, regions))

    def _line_reader(self):
        """Reads one cut-out MRZ row: RapidOCR's recogniser alone, else Tesseract on one line with the MRZ characters only."""
        rapid = next((e for e in self.engines if hasattr(e, "read_line")), None)
        if rapid is not None:
            return rapid.read_line
        tess = next((e for e in self.engines if e.name == "tesseract"), None)
        if tess is None:
            return None
        return lambda row: "".join(l.text for l in tess.recognize(row, ["Latin"], {}, whitelist=mrzpass.WHITELIST, psm=7))

    def _mrz_candidates(self, results: list[RegionResult], regions: list[geometry.Region]) -> list[list[str]]:
        """The dedicated MRZ pass (mrzpass, 2026-11-05) on every region whose first read has no MRZ that passes every check digit,
        or one whose names line was read short. Stops at the first reading that passes with the names line whole. A page with no
        MRZ-like line and no MRZ-shaped band costs nothing; one shaped like it but read without a single < costs one reading."""
        out: list[list[str]] = []
        read_line = self._line_reader()
        if read_line is None:
            return out
        for result, region in zip(results, regions):
            texts = [l.text for l in result.lines]
            first = mrz.parse_mrz(texts)
            if first and first["valid"] and not first.get("padded"):
                continue
            self._check_time()
            page = preprocess.rotate_cw(region.image, result.rotation)
            if result.skew:
                page = preprocess.deskew(page, result.skew)
            boxes = [l.bbox for l in result.lines if mrzpass.mrz_like(l.text)]
            band = mrzpass.band_from_lines(boxes, page.shape) if boxes else mrzpass.band_from_shape(page)
            if band is None and not boxes:  # the page may have been turned the wrong way up: the MRZ is then at the top
                page = preprocess.rotate_cw(page, 180)
                band = mrzpass.band_from_shape(page)
            band_img = mrzpass.prepare(page, band) if band is not None else None
            if band_img is None:
                continue
            mine: list[list[str]] = []
            for i, (_, lines) in enumerate(mrzpass.readings(band_img, read_line)):
                if i == 0 and first is None and not boxes and not any(mrzpass.mrz_like(t) for t in lines):
                    break  # shaped like an MRZ, but no MRZ was read: not one
                mine.append(lines)
                found = mrz.choose([texts] + mine)
                if found and found["valid"] and not found.get("padded") and found.get("namesAgree", True):
                    break
            out += mine
        return out

    # -- PDF --------------------------------------------------------------------------------------
    def read_pdf(self, data: bytes, opts: ReadOptions) -> dict:
        with pdfsafe.LOCK:
            try:
                doc = pdfium.PdfDocument(data)
            except pdfium.PdfiumError as exc:
                if getattr(exc, "err_code", None) == 4:
                    raise ReaderError("pdf_encrypted", "Password-protected PDFs are not accepted.")
                raise ReaderError("pdf_corrupt", "The PDF could not be read.")
        try:
            with pdfsafe.LOCK:
                count = len(doc)
            if count == 0:
                raise ReaderError("pdf_corrupt", "The PDF has no pages.")
            if count > self.cfg.max_pages:
                raise ReaderError("too_many_pages", "The PDF has too many pages.")
            all_lines: list[OcrLine] = []
            pages_info: list[dict] = []
            ocr_results: list[RegionResult] = []
            codes_found: list[dict] = []
            texts_for_mrz: list[str] = []
            for index in range(count):
                self._check_time()
                lines, info, result, found = self._read_pdf_page(doc, index, opts)
                for line in lines:
                    line.region = index + 1  # for PDFs the region number carries the page
                all_lines += lines
                pages_info.append(info)
                if result:
                    ocr_results.append(result)
                codes_found += found
            return assemble(ocr_results, codes_found, pages=count, opts=opts, image_shape=None,
                            extra_texts=texts_for_mrz, pdf_lines=all_lines, pages_info=pages_info)
        finally:
            with pdfsafe.LOCK:
                doc.close()

    def _read_pdf_page(self, doc: pdfium.PdfDocument, index: int, opts: ReadOptions):
        with pdfsafe.LOCK:  # PDFium one thread at a time; the OCR below runs outside the lock
            page = doc[index]
            try:
                width, height = page.get_size()
                textpage = page.get_textpage()
                try:
                    chars = textpage.count_chars()
                    if chars >= MIN_PDF_TEXT_CHARS:
                        return (_text_layer_lines(textpage, height, index + 1),
                                {"page": index + 1, "source": "text-layer", "width": round(width, 1),
                                 "height": round(height, 1), "unit": "pt"}, None, [])
                finally:
                    textpage.close()
                if not self.engines:
                    raise ReaderError("no_engine", "No OCR engine is installed on this server.", 503)
                dpi = 300 if opts.mode == "thorough" else 200
                scale = min(dpi / 72.0, (self.cfg.max_pixels / max(width * height, 1)) ** 0.5)
                img = cv2.cvtColor(pdfsafe.render(page, scale), cv2.COLOR_RGB2BGR)
            finally:
                page.close()
        result = self.read_region(geometry.Region(0, img, None), ReadOptions(opts.languages, opts.mode, False, codes=opts.codes))
        for line in result.lines:
            line.region = index + 1
        result.index = index + 1
        found = codes.read_codes(img) if opts.codes else []
        return (result.lines, {"page": index + 1, "source": "ocr", "width": result.width,
                               "height": result.height, "unit": "px", "dpi": round(scale * 72)}, result, found)


def _text_layer_lines(textpage, page_height: float, page_number: int) -> list[OcrLine]:
    """Exact text from the PDF itself (no OCR): one line per rectangle PDFium reports."""
    lines = []
    for r in range(textpage.count_rects()):
        left, bottom, right, top = textpage.get_rect(r)
        text = textpage.get_text_bounded(left, bottom, right, top).strip()
        if text:
            line = OcrLine(text, (left, page_height - top, right, page_height - bottom), 1.0, None, "pdf-text")
            lines.append(label(line))
    if not lines:
        for chunk in textpage.get_text_range().splitlines():
            if chunk.strip():
                lines.append(label(OcrLine(chunk.strip(), (0, 0, 0, 0), 1.0, None, "pdf-text")))
    return lines


# ---- result ------------------------------------------------------------------------------------

def assemble(results: list[RegionResult], codes_found: list[dict], pages: int, opts: ReadOptions,
             image_shape, extra_texts: list[str], pdf_lines: list[OcrLine] | None = None,
             pages_info: list[dict] | None = None, mrz_candidates: list[list[str]] | None = None) -> dict:
    if pdf_lines is not None:
        lines = pdf_lines
        page_of = lambda l: l.region  # noqa: E731
    else:
        lines = [l for r in results for l in r.lines]
        page_of = lambda l: 1  # noqa: E731
    texts = [l.text for l in lines] + extra_texts
    mrz_found = mrz.choose([texts] + (mrz_candidates or []))
    identifiers = ids.find_identifiers("\n".join(l.text for l in lines))
    flags: list[str] = []
    for r in results:
        flags += r.flags
    avg = _confidence([l for l in lines if l.engine != "pdf-text"])
    ocr_lines = [l for l in lines if l.engine != "pdf-text"]
    if ocr_lines and (avg < LOW_AVERAGE_CONFIDENCE or
                      sum(1 for l in ocr_lines if l.confidence < LOW_LINE_CONFIDENCE) >= 0.2 * len(ocr_lines)):
        flags.append("lowConfidence")
    if not lines:
        flags.append("noTextFound")
    flags = list(dict.fromkeys(flags))
    human = bool(SERIOUS_FLAGS & set(flags)) or (mrz_found is not None and not mrz_found["valid"]) \
        or any(not i["valid"] for i in identifiers)

    def line_json(l: OcrLine) -> dict:
        d = {"text": l.text, "page": page_of(l), "bbox": [round(v, 1) for v in l.bbox],
             "confidence": round(l.confidence, 3), "script": l.script}
        if pdf_lines is None and len(results) > 1:
            d["region"] = l.region
        return d

    out: dict = {
        "pages": pages,
        "text": "\n\n".join(full_text(reading_order([l for l in lines if page_of(l) == p])) for p in sorted({page_of(l) for l in lines}))
        if pdf_lines is not None else "\n\n".join(full_text(r.lines) for r in results),
        "lines": [line_json(l) for l in lines],
        "quality": results[0].quality.as_dict() if results and len(results) == 1 else
        ({"overall": round(float(np.mean([r.quality.overall for r in results])), 3)} if results else None),
        "codes": codes_found, "mrz": mrz_found, "identifiers": identifiers,
        "flags": flags, "needsHumanCheck": human,
        "engines": sorted({l.engine for l in lines} | {e for r in results for e in r.engines}),
        "confidence": round(avg, 3) if ocr_lines else (1.0 if lines else 0.0),
    }
    if pages_info is not None:
        out["pageInfo"] = pages_info
    elif results:
        first = results[0]
        out["document"] = {"found": first.quad is not None, "quad": first.quad,
                           "rotationApplied": first.rotation, "skewApplied": round(first.skew, 2),
                           "pageImage": {"width": first.width, "height": first.height},
                           "scripts": first.scripts}
        if len(results) > 1:
            out["regions"] = [{"index": r.index, "quad": r.quad, "rotationApplied": r.rotation,
                               "skewApplied": round(r.skew, 2), "confidence": round(r.confidence, 3),
                               "flags": r.flags, "text": full_text(r.lines)} for r in results]
    return out
