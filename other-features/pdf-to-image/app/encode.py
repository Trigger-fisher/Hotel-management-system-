"""Colour handling and encoding. Plain encoder settings only: no quality search, no compression pipeline."""
from __future__ import annotations

import io

import numpy as np
import pillow_heif
from PIL import Image

from .errors import ConvertError
from .options import Options

pillow_heif.register_heif_opener()


def _otsu(grey: np.ndarray) -> int:
    hist = np.bincount(grey.ravel(), minlength=256).astype(np.float64)
    total, sum_all = hist.sum(), (hist * np.arange(256)).sum()
    weight_b = sum_b = best = 0.0
    threshold = 127
    for t in range(256):
        weight_b += hist[t]
        if weight_b == 0:
            continue
        weight_f = total - weight_b
        if weight_f == 0:
            break
        sum_b += t * hist[t]
        between = weight_b * weight_f * (sum_b / weight_b - (sum_all - sum_b) / weight_f) ** 2
        if between > best:
            best, threshold = between, t
    return threshold


def apply_color_mode(img: Image.Image, opts: Options) -> Image.Image:
    has_alpha = img.mode == "RGBA"
    if opts.color_mode == "rgb":
        return img if has_alpha else img.convert("RGB")
    alpha = img.getchannel("A") if has_alpha else None
    grey = img.convert("L")
    if opts.color_mode == "bw":
        limit = opts.bw_threshold if opts.bw_threshold is not None else _otsu(np.asarray(grey))
        grey = grey.point(lambda v: 255 if v > limit else 0)
    if alpha is not None:
        grey.putalpha(alpha)  # mode LA
    return grey


def encode(img: Image.Image, opts: Options, dpi: float) -> bytes:
    buf = io.BytesIO()
    fmt = opts.format
    dpi_pair = (dpi, dpi)
    bilevel = opts.color_mode == "bw" and img.mode == "L"
    try:
        if fmt == "png":
            out = img.convert("1") if bilevel else img  # real 1-bit PNG: smallest honest black and white
            out.save(buf, "PNG", compress_level=opts.png_compress, dpi=dpi_pair)
        elif fmt == "jpeg":
            img.save(buf, "JPEG", quality=opts.jpeg_quality, subsampling=0, dpi=dpi_pair)
        elif fmt == "webp":
            if opts.webp_lossless:
                img.save(buf, "WEBP", lossless=True, quality=100, method=4)
            else:
                img.save(buf, "WEBP", quality=opts.webp_quality, method=4)
        elif fmt == "avif":
            img.save(buf, "AVIF", quality=opts.avif_quality, speed=6)
        elif fmt == "tiff":
            img.convert("1" if bilevel else img.mode).save(buf, "TIFF", compression="tiff_deflate", dpi=dpi_pair)
        else:
            img.convert("RGB" if img.mode in ("RGBA", "LA") else img.mode).save(buf, "BMP")
    except (KeyError, OSError, ValueError):
        raise ConvertError("encode_failed", "The picture could not be saved in that format.")
    return buf.getvalue()

