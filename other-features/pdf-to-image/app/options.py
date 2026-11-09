"""Every option is validated here, with bounds. Nothing reaches the renderer unchecked."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Mapping

from .errors import ConvertError

FORMATS = ("png", "jpeg", "webp", "avif", "tiff", "bmp")
ALPHA_FORMATS = ("png", "webp", "avif", "tiff")
EXT = {"png": "png", "jpeg": "jpg", "webp": "webp", "avif": "avif", "tiff": "tiff", "bmp": "bmp"}
MIME = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp", "avif": "image/avif",
        "tiff": "image/tiff", "bmp": "image/bmp"}
DPI_MIN, DPI_MAX, DPI_DEFAULT = 36, 600, 150
SIDE_MIN, SIDE_MAX = 64, 20000


def _bad(message: str) -> ConvertError:
    return ConvertError("bad_option", message, 400)


@dataclass(frozen=True)
class Options:
    dpi: int | None  # None when max_side is used
    max_side: int | None
    pages: tuple[tuple[int, int | None], ...] | None  # inclusive ranges, None end = to the last page; None = all
    format: str
    jpeg_quality: int
    webp_quality: int
    avif_quality: int
    webp_lossless: bool
    png_compress: int
    color_mode: str  # rgb | gray | bw
    bw_threshold: int | None  # None = automatic (Otsu)
    background: tuple[int, int, int, int]  # RGBA; alpha 0 = transparent
    rotation: int | None  # None = auto (the page's own /Rotate); else the final rotation
    box: str  # crop | media
    annotations: bool
    forms: bool
    lcd_text: bool
    anti_alias: bool
    password: str | None
    strict_pages: bool
    manifest: bool


def _bool(raw: str | None, default: bool, name: str) -> bool:
    if raw is None or raw == "":
        return default
    if raw.lower() in ("true", "1", "yes", "on"):
        return True
    if raw.lower() in ("false", "0", "no", "off"):
        return False
    raise _bad(f"{name} must be true or false.")


def _int(raw: str | None, default: int | None, lo: int, hi: int, name: str) -> int | None:
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise _bad(f"{name} must be a whole number.")
    if not lo <= value <= hi:
        raise _bad(f"{name} must be between {lo} and {hi}.")
    return value


def parse_pages(spec: str) -> tuple[tuple[int, int | None], ...]:
    """'1-3,5,8-' -> ((1,3),(5,5),(8,None)). Page numbers start at 1."""
    ranges = []
    for part in spec.replace(" ", "").split(","):
        m = re.fullmatch(r"(\d{1,6})(?:(-)(\d{1,6})?)?", part)
        if not m:
            raise _bad("pages must look like 1-3,5,8-")
        first = int(m.group(1))
        last = (int(m.group(3)) if m.group(3) else None) if m.group(2) else first
        if first < 1 or (last is not None and last < first):
            raise _bad("pages must start at 1 and ranges must go upwards.")
        ranges.append((first, last))
    if not ranges or len(ranges) > 200:
        raise _bad("pages has too many parts.")
    return tuple(ranges)


def expand_pages(ranges: tuple[tuple[int, int | None], ...] | None, count: int) -> list[int]:
    """The page numbers (1-based, ascending, no repeats) that exist in a document of `count` pages."""
    if ranges is None:
        return list(range(1, count + 1))
    wanted: set[int] = set()
    for first, last in ranges:
        wanted.update(range(first, min(last if last is not None else count, count) + 1))
    return sorted(wanted)


def parse_background(raw: str | None) -> tuple[int, int, int, int]:
    value = (raw or "white").strip().lower()
    if value == "white":
        return (255, 255, 255, 255)
    if value == "transparent":
        return (255, 255, 255, 0)
    m = re.fullmatch(r"#?([0-9a-f]{6})", value)
    if not m:
        raise _bad("background must be white, transparent or a #rrggbb colour.")
    n = int(m.group(1), 16)
    return (n >> 16 & 255, n >> 8 & 255, n & 255, 255)


def parse_options(form: Mapping[str, str], single_page: int | None = None) -> Options:
    fmt = (form.get("format") or "png").lower()
    if fmt == "jpg":
        fmt = "jpeg"
    if fmt not in FORMATS:
        raise _bad("format must be png, jpeg, webp, avif, tiff or bmp.")
    dpi = _int(form.get("dpi"), None, DPI_MIN, DPI_MAX, "dpi")
    max_side = _int(form.get("maxSide"), None, SIDE_MIN, SIDE_MAX, "maxSide")
    if dpi is not None and max_side is not None:
        raise _bad("Use either dpi or maxSide, not both.")
    if dpi is None and max_side is None:
        dpi = DPI_DEFAULT
    color = (form.get("colorMode") or "rgb").lower()
    if color not in ("rgb", "gray", "bw"):
        raise _bad("colorMode must be rgb, gray or bw.")
    threshold_raw = (form.get("bwThreshold") or "auto").lower()
    threshold = None if threshold_raw == "auto" else _int(threshold_raw, None, 1, 254, "bwThreshold")
    background = parse_background(form.get("background"))
    if background[3] == 0 and fmt not in ALPHA_FORMATS:
        raise _bad("A transparent background needs png, webp, avif or tiff.")
    rot_raw = (form.get("rotation") or "auto").lower()
    if rot_raw == "auto":
        rotation = None
    elif rot_raw in ("0", "90", "180", "270"):
        rotation = int(rot_raw)
    else:
        raise _bad("rotation must be auto, 0, 90, 180 or 270.")
    box = (form.get("box") or "crop").lower()
    if box not in ("crop", "media"):
        raise _bad("box must be crop or media.")
    pages = None
    if single_page is not None:
        pages = ((single_page, single_page),)
    elif form.get("pages"):
        pages = parse_pages(form["pages"])
    password = form.get("password") or None
    if password is not None and len(password) > 256:
        raise _bad("password is too long.")
    return Options(
        dpi=dpi, max_side=max_side, pages=pages, format=fmt,
        jpeg_quality=_int(form.get("jpegQuality"), 90, 1, 100, "jpegQuality"),
        webp_quality=_int(form.get("webpQuality"), 90, 1, 100, "webpQuality"),
        avif_quality=_int(form.get("avifQuality"), 80, 1, 100, "avifQuality"),
        webp_lossless=_bool(form.get("webpLossless"), False, "webpLossless"),
        png_compress=_int(form.get("pngCompress"), 6, 0, 9, "pngCompress"),
        color_mode=color, bw_threshold=threshold, background=background, rotation=rotation, box=box,
        annotations=_bool(form.get("renderAnnotations"), True, "renderAnnotations"),
        forms=_bool(form.get("renderForms"), True, "renderForms"),
        lcd_text=_bool(form.get("lcdText"), False, "lcdText"),
        anti_alias=_bool(form.get("antiAlias"), True, "antiAlias"),
        password=password,
        strict_pages=_bool(form.get("strictPages"), False, "strictPages"),
        manifest=_bool(form.get("manifest"), True, "manifest"),
    )


def scale_for(width_pt: float, height_pt: float, opts: Options, max_pixels: int) -> tuple[float, bool]:
    """Pixels per point for this page, and whether the pixel cap clamped it."""
    if opts.max_side is not None:
        scale = opts.max_side / max(width_pt, height_pt, 1e-6)
    else:
        scale = (opts.dpi or DPI_DEFAULT) / 72.0
    clamped = False
    pixels = (width_pt * scale) * (height_pt * scale)
    if pixels > max_pixels:
        scale *= (max_pixels / pixels) ** 0.5 * 0.999
        clamped = True
    # PDFium rounds sizes up: a tiny nudge down avoids a stray extra pixel row from float noise.
    return scale * (1 - 1e-6), clamped

