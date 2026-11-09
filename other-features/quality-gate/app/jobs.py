"""One check. Runs inside a worker process. Judges only: it never changes, scans, converts or reads the file."""
from __future__ import annotations

import io
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import cv2
import numpy as np
import pillow_heif
from PIL import Image, ImageOps, UnidentifiedImageError

from . import cards, portrait
from .compression import TRACE_REPORT_BELOW, earlier_quality, jpeg_quality, traced_quality
from .errors import GateError
from .judge import derive, evaluate, reason, verdict_of
from .metrics import NORMAL_SIDE, measure_card, measure_image, to_gray
from .pdfs import check_pdf
from .profiles import (HALF_DECODE_FROM, JPEG_RESAVED_BLOCKINESS, MULTI, MULTI_ADVICE, portrait_limits, profile_names,
                       snapshot)
from .sniff import sniff

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = None  # the declared size is checked below, before any pixel is decoded


@dataclass(frozen=True)
class WorkerConfig:
    max_bytes: int = 50 * 1024 * 1024
    max_pixels: int = 100_000_000
    default_profile: str = "generic"
    cpu_threads: int = 4  # threads one check may use (GATE_CPU_THREADS)


@dataclass(frozen=True)
class Loaded:
    img: np.ndarray  # BGR, possibly decoded at a reduced size (see `up`)
    frames: int
    full_size: tuple[int, int]  # (width, height) of the picture as stored, upright
    up: int  # stored pixels per decoded pixel: 1, or 2 when a large JPEG was decoded at half size


def _load(data: bytes, max_pixels: int, allow_half: bool = True) -> Loaded:
    """Decode the picture. A JPEG whose long side is HALF_DECODE_FROM px or more is decoded at half size by the JPEG decoder itself
    (DCT scaling, 5 Nov 2026): every measure is taken at 1000 px or less anyway, and decoding a 12 MP photo whole costs more than all
    the checks together. Sizes are still reported in the stored picture's pixels."""
    try:
        pil = Image.open(io.BytesIO(data))
        stored = pil.size
        if stored[0] * stored[1] > max_pixels:
            raise GateError("too_many_pixels", "The picture has too many pixels.")
        frames = getattr(pil, "n_frames", 1)
        # a JPEG that does not end on its end marker may be cut short: OpenCV would show the part it has, Pillow refuses it (and a
        # damaged picture must be reported as damaged), so only complete files take the fast path
        complete = data.rstrip(b"\x00")[-2:] == b"\xff\xd9"
        if pil.format == "JPEG" and pil.mode in ("RGB", "L", "CMYK") and complete:
            # OpenCV's decoder writes BGR directly and applies the EXIF turn itself: about twice as fast as Pillow plus conversions
            half = allow_half and max(stored) >= HALF_DECODE_FROM
            flag = cv2.IMREAD_REDUCED_COLOR_2 if half else cv2.IMREAD_COLOR
            arr = cv2.imdecode(np.frombuffer(data, np.uint8), flag)
            if arr is not None and arr.ndim == 3:
                h, w = arr.shape[:2]
                turned = (w > h) != (stored[0] > stored[1]) and w != h
                full = (stored[1], stored[0]) if turned else stored
                return Loaded(arr, frames, (int(full[0]), int(full[1])), max(1, round(max(full) / max(h, w))))
        pil.seek(0)
        if allow_half and pil.format == "JPEG" and max(stored) >= HALF_DECODE_FROM:
            pil.draft(pil.mode, ((stored[0] + 1) // 2, (stored[1] + 1) // 2))
        pil.load()
        decoded = pil.size
        up = max(1, round(stored[0] / max(decoded[0], 1)))
        pil = ImageOps.exif_transpose(pil)
        turned = pil.size != decoded  # EXIF said the picture is turned a quarter: width and height swap
        full = (stored[1], stored[0]) if turned else stored
        if pil.mode in ("RGBA", "LA", "PA") or "transparency" in pil.info:
            rgba = pil.convert("RGBA")
            pil = Image.alpha_composite(Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba)
        arr = np.asarray(pil.convert("RGB"))
        return Loaded(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), frames, (int(full[0]), int(full[1])), up)
    except GateError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError, MemoryError):
        raise _Unreadable()


def _load_sheet(data: bytes, max_pixels: int, pool: ThreadPoolExecutor) -> tuple[Loaded, np.ndarray, list[np.ndarray]]:
    """A multi-id photo: (the colour picture, at a quarter size for a large JPEG; the grey picture at full size for judging the
    cards; the cards' corners in the grey picture's pixels). For a large JPEG the cards are found on the small colour copy while the
    grey picture decodes, which is faster than one colour decode at full size; anything else takes the ordinary path."""
    try:
        with Image.open(io.BytesIO(data)) as pil:
            stored, fmt, frames = pil.size, pil.format, getattr(pil, "n_frames", 1)
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError):
        raise _Unreadable()
    if stored[0] * stored[1] > max_pixels:
        raise GateError("too_many_pixels", "The picture has too many pixels.")
    if fmt == "JPEG" and max(stored) >= HALF_DECODE_FROM and data.rstrip(b"\x00")[-2:] == b"\xff\xd9":
        buf = np.frombuffer(data, np.uint8)
        small = cv2.imdecode(buf, cv2.IMREAD_REDUCED_COLOR_4)
        if small is not None and small.ndim == 3:
            found = pool.submit(cards.find_cards, small, MULTI["max_cards"])
            gray = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
            quads = found.result()
            if gray is not None:
                h, w = gray.shape
                turned = (w > h) != (stored[0] > stored[1]) and w != h
                full = (stored[1], stored[0]) if turned else stored
                scale = max(h, w) / max(small.shape[:2])
                return Loaded(small, frames, (int(full[0]), int(full[1])), 1), gray, [q * scale for q in quads]
    loaded = _load(data, max_pixels, allow_half=False)
    return loaded, to_gray(loaded.img), cards.find_cards(loaded.img, MULTI["max_cards"])


def set_threads(count: int) -> None:
    """OpenCV's own thread pool size for this process (GATE_CPU_THREADS; 0 leaves OpenCV's default)."""
    if count > 0:
        cv2.setNumThreads(count)


class _Unreadable(Exception):
    pass


INSET = 0.04  # share of each side of a found card left out when judging it


_POOLS: dict[int, ThreadPoolExecutor] = {}


def _pool(threads: int) -> ThreadPoolExecutor:
    """A small thread pool per worker process: OpenCV and numpy release the GIL, so the whole-picture scores, the portrait hint
    and the cards of a multi-id photo run side by side on the cores the process is given (GATE_CPU_THREADS, default 4)."""
    threads = max(1, threads)
    if threads not in _POOLS:
        set_threads(threads)
        _POOLS[threads] = ThreadPoolExecutor(threads, thread_name_prefix="gate")
    return _POOLS[threads]


def _judge_card(gray: np.ndarray, q: np.ndarray, up: int) -> dict:
    # flattened straight to the size the measures use (the card's interior then is NORMAL_SIDE px long), in one warp of the grey
    # picture (every per-card measure is on grey)
    crop, per = cards.flatten_to(gray, q, int(round(NORMAL_SIDE / (1 - 2 * INSET))))
    h, w = crop.shape[:2]
    long_side = int(round(max(h, w) * per * up))
    # the card's interior only: a sliver of table along the found edge is a sharp step that hid a blurred card's softness
    dy, dx = int(INSET * h), int(INSET * w)
    inner = crop[dy:h - dy, dx:w - dx] if h - 2 * dy > 16 and w - 2 * dx > 16 else crop
    scores = measure_card(inner, full_size=(int(round(w * per * up)), int(round(h * per * up))))
    scores["longSidePx"] = long_side
    scores["contentLongSidePx"] = long_side
    reasons = [r for r in evaluate(scores, "multi-id", frozenset({"tooCompressed"})) if r["severity"] != "info"]
    too_small = long_side < MULTI["min_card_long_side_px"]
    bad = too_small or any(r["severity"] == "reject" for r in reasons)
    return {"readable": not bad, "tooSmall": too_small,
            "scores": {k: scores[k] for k in ("blurLaplacian", "blurGradient", "glare", "longSidePx")}}


def _multi(img: np.ndarray, up: int = 1, pool: ThreadPoolExecutor | None = None, gray: np.ndarray | None = None,
           quads: list[np.ndarray] | None = None) -> tuple[list[dict], dict]:
    """Each card of a multi-id photo judged on its own (blur, glare, exposure, noise, size). `up` = stored pixels per decoded pixel:
    card sizes are judged in the stored picture's pixels. `gray` = the picture in grey at full size and `quads` = the cards' corners
    in it, when already made."""
    quads = cards.find_cards(img, MULTI["max_cards"]) if quads is None else quads
    quads = quads[:MULTI["max_cards"] + 1]
    gray = to_gray(img) if gray is None else gray
    judged = list((pool or _pool(1)).map(lambda q: _judge_card(gray, q, up), quads[:MULTI["max_cards"]]))
    infos = [{"region": i + 1, **j} for i, j in enumerate(judged)]
    unreadable = sum(not j["readable"] for j in judged)
    small_count = sum(j["tooSmall"] for j in judged)
    reasons: list[dict] = []
    total = len(quads)
    if total > MULTI["max_cards"]:
        reasons.append(reason("tooManyCards", "reject", f"More than {MULTI['max_cards']} cards found in one photo. " + MULTI_ADVICE))
        total = MULTI["max_cards"]
    if unreadable:
        severity = "reject" if unreadable / max(total, 1) >= MULTI["reject_unreadable_share"] else "warn"
        why = f" ({small_count} too small)" if small_count else ""
        reasons.append(reason("cardsUnreadable", severity, f"{unreadable} of {total} cards cannot be read{why}. " + MULTI_ADVICE))
    if total == 0:
        reasons.append(reason("noCardsFound", "reject", "No ID card was found in the picture. Photograph the cards on a plain background. "
                              + MULTI_ADVICE))
    info = {"cards": total, "unreadable": unreadable, "tooSmall": small_count, "regions": infos}
    if reasons:
        info["advice"] = MULTI_ADVICE
    return reasons, info


def _portrait(img: np.ndarray, profile: str, up: int) -> tuple[list[dict], dict | None]:
    """The id-card portrait hint: a warning with MJ's sentence when the photo-like block on the card is blurred, glared or tiny."""
    limits = portrait_limits(profile)
    if limits is None:
        return [], None
    found = portrait.assess(img, up)
    if found is None:
        return [], {"found": False}
    why = []
    if found["sharpness"] < limits["sharp_warn"]:
        why.append("photo blurred")
    if found["glare"] > limits["glare_warn"]:
        why.append("glare over the photo")
    if found["heightPx"] < limits["min_height_px"]:
        why.append("photo too small")
    info = {"found": True, **found, "why": why}
    if not why:
        return [], info
    return [{**reason("portraitUnclear", limits["severity"]), "why": why}], info


def run_check(data: bytes, cfg: WorkerConfig, profile: str | None = None) -> dict:
    profile = profile or cfg.default_profile
    if profile not in profile_names():
        raise GateError("bad_profile", f"profile must be one of {', '.join(profile_names())}.", 400)
    if len(data) > cfg.max_bytes:
        raise GateError("file_too_large", "The file is larger than the allowed size.", 413)
    kind = sniff(data[:2048])  # real type from the bytes only
    if kind is None:
        raise GateError("unsupported_type", "Only PDF and picture files are accepted.", 415)
    if kind == "pdf":
        out = check_pdf(data, profile, cfg.max_pixels)
        return {"verdict": verdict_of(out["reasons"]), "reasons": out["reasons"], "scores": {}, "pages": out["pages"],
                "profile": profile, "info": out["info"]}
    pool = _pool(cfg.cpu_threads)
    quads = None
    try:
        if profile == "multi-id":
            # several cards are judged on their own pixels, so their grey picture is decoded whole (a card shrunk by the decoder
            # and enlarged again for the blur measure would look softer than it is); the cards are found on a small colour copy
            loaded, gray, quads = _load_sheet(data, cfg.max_pixels, pool)
        else:
            loaded = _load(data, cfg.max_pixels)
            gray = to_gray(loaded.img)
    except _Unreadable:
        reasons = [reason("imageCorrupt", "reject", "The picture is damaged and cannot be opened. Send the file again.")]
        return {"verdict": "reject", "reasons": reasons, "scores": {}, "pages": [], "profile": profile, "info": {}}
    img, frames, up = loaded.img, loaded.frames, loaded.up
    whole = pool.submit(measure_image, gray, loaded.full_size, 8 // up)
    side = pool.submit(_portrait, img, profile, up)
    table_quality = jpeg_quality(data)  # measured on the file as sent, never on decoded or resampled pixels
    trace = None
    if table_quality is None or table_quality >= TRACE_REPORT_BELOW:
        # an earlier hard compression hidden by a re-save as PNG or as a high-quality JPEG, traced in the upload's own pixels
        if kind in ("png", "webp") and up == 1 and frames == 1:
            trace = pool.submit(lambda: earlier_quality(gray)[0])
        elif kind == "jpeg":
            trace = pool.submit(traced_quality, data)
    info: dict = {}
    extra: list[dict] = []
    if profile == "multi-id":
        extra, info = _multi(img, up, pool, gray, quads)
    raw = whole.result()
    traced = trace.result() if trace is not None else None
    quality = min((q for q in (table_quality, traced) if q is not None), default=None)
    if quality is not None:
        raw["jpegQuality"] = quality
    if traced is not None:
        raw["jpegQualityTraced"] = traced
    scores = derive(raw, profile)
    # For several cards the whole sheet is not judged for blur, glare or size: each card is, below.
    skip = {"blurry", "glare", "lowResolution", "tooSmall", "lowContrast", "tooDark"} if profile == "multi-id" else set()
    if quality is not None:
        skip.add("jpegBlocking")  # judged from the quantisation table or the trace instead
    reasons = evaluate(scores, profile, frozenset(skip)) + extra
    if table_quality is not None and traced is None:  # the grid: a re-saved copy the trace could not read (resized, for example)
        warn, reject = JPEG_RESAVED_BLOCKINESS.get(up, JPEG_RESAVED_BLOCKINESS[1])
        if scores["blockiness"] >= warn and not any(r["code"] == "blank" for r in reasons):
            reasons.append(reason("jpegBlocking", "reject" if scores["blockiness"] >= reject else "warn"))
    hint, portrait_info = side.result()
    reasons += hint
    if portrait_info is not None:
        info["portrait"] = portrait_info
    if frames > 1:
        reasons.append(reason("animatedImage", "info", "This is an animated picture; only the first frame was checked."))
    return {"verdict": verdict_of(reasons), "reasons": reasons, "scores": scores, "pages": [], "profile": profile,
            "info": info, "thresholds": snapshot(profile)}
