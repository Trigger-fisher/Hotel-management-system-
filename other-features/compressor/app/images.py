"""Image compression: normalise, then search the encoder quality until the mode's score is met."""
from __future__ import annotations

import io
from functools import lru_cache
from typing import Callable

import numpy as np
import pillow_heif
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from . import tools
from .errors import CompressorError, Result
from .limits import Deadline, Limits
from .modes import (AVIF_MAX_PIXELS, DOWNSCALES, HOPELESS, LAST_RESORT_QUALITY, LAST_RESORT_SCALE, LAST_RESORT_STEP,
                    Mode, SizeRule, floors_below)
from .quality import SSIM_MAX_SIDE, Reference, shrink_factor

pillow_heif.register_heif_opener()
# Pixel limits are enforced by us from the header, before any pixel is decoded.
Image.MAX_IMAGE_PIXELS = None

# Encoder quality search ranges (lowest, highest) per output format.
Q_RANGE = {"jpeg": (35, 100), "webp": (25, 100), "avif": (15, 100)}
# First guess for the quality search, by score floor (highest bar first). Only speed depends on it, not the answer.
START_GUESS = (
    (0.995, {"jpeg": 90, "webp": 90, "avif": 80}),
    (0.985, {"jpeg": 80, "webp": 80, "avif": 65}),
    (0.97, {"jpeg": 65, "webp": 65, "avif": 50}),
    (0.0, {"jpeg": 50, "webp": 50, "avif": 35}),
)
PREVIEW_MIN_PIXELS = 1_500_000  # from this size the first guess comes from a trial run on a sample
PREVIEW_GRID, PREVIEW_TILE = 4, 96  # 4 x 4 tiles of 96 px at the SSIM scale
WEB_SAFE_ORIGINALS = {"jpeg", "png", "webp", "avif"}
FLAT_MAX_COLOURS = 600  # a 256px thumbnail with fewer colours is a graphic, not a photo
_SRGB = ImageCms.createProfile("sRGB")


@lru_cache(maxsize=1)
def avif_supported() -> bool:
    try:
        Image.new("RGB", (16, 16), (10, 20, 30)).save(io.BytesIO(), "AVIF", quality=50)
        return True
    except (KeyError, OSError, ValueError):
        return False


# ---- opening and normalising -------------------------------------------------

def _open(data: bytes, limits: Limits) -> tuple[Image.Image, int]:
    """Open without decoding pixels, check the declared size, then decode. Returns (image, frames)."""
    try:
        img = Image.open(io.BytesIO(data))
        if img.size[0] * img.size[1] > limits.max_pixels:
            raise CompressorError("too_many_pixels", "The picture has too many pixels.")
        frames = getattr(img, "n_frames", 1)
        if frames == 1:
            img.load()
        return img, frames
    except CompressorError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError, MemoryError):
        raise CompressorError("image_corrupt", "The picture could not be read.")


def _to_srgb(img: Image.Image) -> Image.Image:
    icc = img.info.get("icc_profile")
    if not icc or img.mode not in ("RGB", "RGBA", "CMYK"):
        return img
    try:
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        if img.mode == "RGBA":
            rgb = ImageCms.profileToProfile(img.convert("RGB"), src, _SRGB, outputMode="RGB")
            rgb.putalpha(img.getchannel("A"))
            return rgb
        return ImageCms.profileToProfile(img, src, _SRGB, outputMode="RGB")
    except (ImageCms.PyCMSError, OSError, ValueError):
        return img  # a broken profile must not block the file


def _prepare(img: Image.Image, mode: Mode) -> Image.Image:
    """Apply EXIF orientation, convert to sRGB, reduce to L/LA/RGB/RGBA, drop all metadata."""
    img = ImageOps.exif_transpose(img)
    has_alpha = img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info
    img = _to_srgb(img)
    if img.mode in ("I;16", "I;16L", "I;16B", "I", "F"):
        arr = np.asarray(img, dtype=np.float64)
        scale = 257.0 if arr.max() > 255 else 1.0
        img = Image.fromarray(np.clip(arr / scale, 0, 255).round().astype(np.uint8), "L")
    elif img.mode in ("1", "L"):
        img = img.convert("L")
    elif img.mode == "LA":
        pass
    elif img.mode in ("RGB", "RGBA"):
        pass
    else:  # P, PA, CMYK, YCbCr, LAB, HSV...
        img = img.convert("RGBA" if has_alpha else "RGB")
    if mode.max_side and max(img.size) > mode.max_side:
        img.thumbnail((mode.max_side, mode.max_side), Image.LANCZOS)
    clean = img.copy()
    clean.info = {}  # nothing (EXIF, GPS, ICC, text chunks) can ride along into the output
    return clean


def _is_flat(img: Image.Image) -> bool:
    thumb = img.convert("RGB")
    thumb.thumbnail((256, 256), Image.NEAREST)
    return thumb.getcolors(maxcolors=FLAT_MAX_COLOURS) is not None


def _flatten(img: Image.Image) -> Image.Image:
    """JPEG has no transparency: put the picture on white."""
    if img.mode not in ("RGBA", "LA"):
        return img
    rgba = img.convert("RGBA")
    base = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    out = Image.alpha_composite(base, rgba)
    return out.convert("L" if img.mode == "LA" else "RGB")


# ---- encoders ----------------------------------------------------------------

def _encode(img: Image.Image, fmt: str, quality: int = 90, lossless: bool = False, strict: bool = False,
            fast: bool = False) -> bytes:
    """`fast` (size step only): a quicker WebP/AVIF effort setting; the size step tries many sizes and floors."""
    buf = io.BytesIO()
    if fmt == "jpeg":
        _flatten(img).save(buf, "JPEG", quality=quality, optimize=True, progressive=True,
                           subsampling=0 if (strict or quality >= 95) else 2)
    elif fmt == "png":
        img.save(buf, "PNG", optimize=True, compress_level=9)
    elif fmt == "webp":
        webp_img = img.convert("RGBA" if img.mode == "LA" else "RGB") if img.mode in ("L", "LA") else img
        method = 6 if img.size[0] * img.size[1] <= 12_000_000 and not fast else 4
        if lossless:
            webp_img.save(buf, "WEBP", lossless=True, quality=100, method=method)
        else:
            webp_img.save(buf, "WEBP", quality=quality, method=method)
    elif fmt == "avif":
        avif_img = img.convert("RGBA" if img.mode == "LA" else "RGB") if img.mode in ("L", "LA") else img
        avif_img.save(buf, "AVIF", quality=quality, speed=8 if fast else 6)
    else:
        raise ValueError(fmt)
    return buf.getvalue()


def _decode(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def _start(fmt: str, floor: float) -> int:
    """A fixed first guess for the encoder quality: the search starts here."""
    lo, hi = Q_RANGE[fmt]
    for bar, guesses in START_GUESS:
        if floor >= bar:
            return min(hi, max(lo, guesses[fmt]))
    return lo


def _preview_start(img: Image.Image, fmt: str, floor: float, strict: bool, deadline: Deadline) -> int | None:
    """A good first guess for a big picture: the same search on a small sample of it (a 4 x 4 grid of tiles cut
    at full resolution and measured at the picture's own SSIM scale, so about 1/5 to 1/10 of the pixels). On the
    invented set its answer is usually the full-size answer or within a few steps. Only where the full search starts
    depends on it; the answer does not. Small pictures (and odd shapes) get a plain bisection (None)."""
    w, h = img.size
    if w * h < PREVIEW_MIN_PIXELS:
        return None
    factor = shrink_factor(img.size, SSIM_MAX_SIDE)
    tile = PREVIEW_TILE * factor
    if tile * 2 > min(w, h):
        return None
    grid, align = PREVIEW_GRID, 16 * factor  # tiles start on whole JPEG/AVIF blocks
    sample = Image.new(img.mode, (grid * tile, grid * tile))
    for i in range(grid):
        for j in range(grid):
            x = (w - tile) * j // (grid - 1) // align * align
            y = (h - tile) * i // (grid - 1) // align * align
            sample.paste(img.crop((x, y, x + tile, y + tile)), (j * tile, i * tile))
    found = _search(sample, fmt, floor, strict, deadline, Reference(sample, factor=factor), _start(fmt, floor))
    return int(found.notes[0].rsplit("_q", 1)[1]) if found else Q_RANGE[fmt][1]


def _search(img: Image.Image, fmt: str, floor: float, strict: bool, deadline: Deadline,
            ref: Reference | None = None, start: int | None = None, fast: bool = False,
            step: int = 3, ceiling_first: bool = False) -> Result | None:
    """The lowest encoder quality whose measured score meets `floor`.

    Same answer as a plain bisection over the whole range (the score only rises with quality), found with fewer
    encodes: the first try is a good guess (`start`), then steps of `step`, 2x, 4x... walk to the edge, and bisection
    finishes inside that small bracket. `ref` is the full-size source the score is measured against (needed when
    `img` is a downscaled copy); it is measured once, not on every try. `ceiling_first` (size step) tries the highest
    quality first and gives up at once when even that misses the floor (common for noisy pictures made smaller)."""
    lo, hi = Q_RANGE[fmt]
    ref = ref or Reference(img)
    best: Result | None = None
    best_q = hi + 1

    def passes(q: int) -> bool:
        nonlocal best, best_q
        deadline.check()
        data = _encode(img, fmt, quality=q, strict=strict, fast=fast)
        score = ref.score(_decode(data))
        if score < floor:
            return False
        if q < best_q:
            best, best_q = Result(data, fmt, score, (f"{fmt}_q{q}",)), q
        return True

    if ceiling_first:
        if not passes(hi):
            return None
        hi -= 1
    if start is not None:
        q = min(hi, max(lo, start))
        if passes(q):  # the answer is q or lower: walk down until a try fails
            hi = q - 1
            while hi >= lo:
                nxt = max(lo, q - step)
                if passes(nxt):
                    q, hi, step = nxt, nxt - 1, step * 2
                else:
                    lo = nxt + 1
                    break
        else:  # the answer is above q: walk up until a try passes
            lo = q + 1
            while lo <= hi:
                nxt = min(hi, q + step)
                if passes(nxt):
                    hi = nxt - 1
                    break
                q, lo, step = nxt, nxt + 1, step * 2
    while lo <= hi:
        mid = (lo + hi) // 2
        if passes(mid):
            hi = mid - 1
        else:
            lo = mid + 1
    return best


def _lossless(img: Image.Image, fmt: str, workdir: str, verify: bool) -> Result | None:
    data = _encode(img, fmt, lossless=True)
    if fmt == "png":
        squeezed = tools.oxipng(data, workdir)
        if squeezed and len(squeezed) < len(data):
            data = squeezed
    if verify and not np.array_equal(np.asarray(img), np.asarray(_decode(data).convert(img.mode))):
        return None  # never claim exact when it is not
    return Result(data, fmt, 1.0, (f"{fmt}_lossless",))


def _palette_png(img: Image.Image, mode: Mode, ref: Reference) -> Result | None:
    if img.mode not in ("RGB", "RGBA"):
        return None
    method = Image.Quantize.FASTOCTREE if img.mode == "RGBA" else Image.Quantize.MEDIANCUT
    quant = img.quantize(colors=256, method=method, dither=Image.Dither.FLOYDSTEINBERG)
    buf = io.BytesIO()
    quant.save(buf, "PNG", optimize=True)
    score = ref.score(_decode(buf.getvalue()))
    return Result(buf.getvalue(), "png", score, ("png_palette",)) if score >= mode.ssim_min else None


# ---- JPEG repack without re-encoding -----------------------------------------

def strip_jpeg(data: bytes, orientation: int) -> bytes | None:
    """Drop EXIF/XMP/IPTC/comment segments (so GPS is gone) without touching pixel data.
    A one-tag EXIF block keeps the rotation, so the picture still shows upright."""
    if data[:2] != b"\xff\xd8":
        return None
    segments: list[bytes] = []
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        if marker == 0xDA:  # start of scan: everything after is entropy-coded data
            tail = data[i:]
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD8:
            i += 2
            continue
        size = int.from_bytes(data[i + 2:i + 4], "big")
        seg = data[i:i + 2 + size]
        if len(seg) != 2 + size:
            return None
        body = seg[4:]
        drop = marker in (0xE1, 0xED, 0xFE) or (marker == 0xE2 and body.startswith(b"MPF\x00"))
        if not drop:
            segments.append(seg)
        i += 2 + size
    else:
        return None
    if orientation != 1:
        exif = Image.Exif()
        exif[0x0112] = orientation
        payload = exif.tobytes()
        block = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
        at = 1 if segments and segments[0][1] == 0xE0 else 0  # after JFIF header
        segments.insert(at, block)
    return b"\xff\xd8" + b"".join(segments) + tail


# ---- the job -----------------------------------------------------------------

def _plan(output: str, flat: bool, has_alpha: bool, mode: Mode, big: bool) -> list[str]:
    """Which encoders to try, by output choice and content kind."""
    avif_ok = avif_supported() and not big
    if mode.lossless:
        return {"auto": ["png", "webp_ll"], "png": ["png"], "webp": ["webp_ll"]}.get(output, [])
    if output == "jpeg":
        return ["jpeg"]
    if output == "png":
        return ["png"] + (["palette"] if mode.allow_palette_png else [])
    if output == "webp":
        return ["webp", "webp_ll"]
    if output == "avif":
        return ["avif"] if avif_supported() else ["webp"]
    # auto
    if flat:
        steps = ["png", "webp_ll"]
        if mode.allow_palette_png:
            steps += ["palette", "webp"]
        return steps
    steps = (["avif"] if avif_ok else []) + ["webp"]
    return steps + (["png"] if has_alpha else ["jpeg"])


def compress_image(data: bytes, kind: str, mode: Mode, output: str, limits: Limits,
                   deadline: Deadline, workdir: str, rule: SizeRule | None = None) -> Result:
    rule = rule or SizeRule()
    img0, frames = _open(data, limits)
    if frames > 1:  # animated pictures are passed through untouched (flagged when they break the size rule)
        over = (("targetMissed",) if len(data) > rule.target else ()) + (
            ("sizeCapExceeded",) if len(data) > rule.cap else ())
        return Result(data, kind, 1.0, ("animated_kept",) + over)
    orientation = int(img0.getexif().get(0x0112, 1) or 1)
    img = _prepare(img0, mode)
    has_alpha = img.mode in ("LA", "RGBA")
    big = img.size[0] * img.size[1] > AVIF_MAX_PIXELS

    repack_only = mode.lossless and kind == "jpeg" and output in ("auto", "jpeg")
    plan = _plan(output, _is_flat(img), has_alpha, mode, big)
    if not plan and not repack_only:
        raise CompressorError("lossless_unsupported_output",
                              "Lossless mode can only output png or webp (or keep the original type).", 400)

    cands: list[Result] = []
    same = output == "auto" or output == kind
    if same and kind in WEB_SAFE_ORIGINALS:
        cands.append(Result(data, kind, 1.0, ("kept_original",)))
    if same and kind == "jpeg":
        stripped = strip_jpeg(data, orientation)
        if stripped is not None:
            cands.append(Result(stripped, "jpeg", 1.0, ("metadata_stripped",)))

    ref: Reference | None = None
    if not repack_only:
        ref = Reference(img)
        strict = mode.name == "strict"
        makers: dict[str, Callable[[], Result | None]] = {
            "png": lambda: _lossless(img, "png", workdir, mode.lossless),
            "webp_ll": lambda: _lossless(img, "webp", workdir, mode.lossless),
            "palette": lambda: _palette_png(img, mode, ref),
            **{fmt: (lambda f=fmt: _search(img, f, mode.ssim_min, strict, deadline, ref,
                                           _preview_start(img, f, mode.ssim_min, strict, deadline), step=1))
               for fmt in ("jpeg", "webp", "avif")},
        }
        for step in plan:
            deadline.check()
            made = makers[step]()
            if made:
                cands.append(made)

    if not cands:
        if output in ("auto", kind):
            cands.append(Result(data, kind, 1.0, ("kept_original",)))
        else:
            raise CompressorError("quality_not_reachable", "The quality target could not be met in that format.")
    best = min(cands, key=len_of)
    if not same and best.fmt != kind and len(best.data) >= len(data):
        best = Result(best.data, best.fmt, best.score, best.notes + ("converted_larger",))
    return _size_rule(best, img, ref, output, has_alpha, big, mode, rule, deadline, workdir)


# ---- MJ's size rule: 150 KB first, 500 KB hard maximum ---------------------------------------------

def _fit_formats(best: Result, output: str, has_alpha: bool, big: bool) -> list[str]:
    """The one format the size step works in: the asked one, or (auto) the lossy format that already won."""
    if output == "avif":
        return ["avif"] if avif_supported() else ["webp"]
    if output in ("jpeg", "webp", "png"):
        return [output]
    if best.notes and best.notes[0].split("_q")[0] in ("jpeg", "webp", "avif") and not (big and best.fmt == "avif"):
        return [best.fmt]
    return ["webp"] if has_alpha else ["jpeg"]


def _encode_to(img: Image.Image, fmt: str, floor: float, strict: bool, deadline: Deadline, ref: Reference,
               start: int | None) -> Result | None:
    if fmt == "png":  # PNG has no quality knob: lossless at this size, then the score against the full picture
        data = _encode(img, "png", lossless=True)  # PNG output: lossless at this size
        score = ref.score(_decode(data))
        return Result(data, "png", score, ("png_lossless",)) if score >= floor else None
    return _search(img, fmt, floor, strict, deadline, ref, start, fast=True, ceiling_first=True)


def _size_rule(best: Result, img: Image.Image, ref: Reference | None, output: str, has_alpha: bool, big: bool,
               mode: Mode, rule: SizeRule, deadline: Deadline, workdir: str) -> Result:
    """`best` is the smallest file that keeps the mode's score at full size. Under the target: done. Under the cap:
    kept (targetMissed). Over the cap: smaller pictures, then lower score floors, then a last-resort shrink, until it
    fits. Lossless mode never changes a pixel, so it can only be flagged (sizeCapExceeded)."""
    size = len(best.data)
    if size <= rule.target:
        return best
    flags: tuple[str, ...] = ("targetMissed",)
    if size <= rule.cap:
        return Result(best.data, best.fmt, best.score, best.notes + flags)
    if mode.lossless or ref is None:
        return Result(best.data, best.fmt, best.score, best.notes + flags + ("sizeCapExceeded",))

    strict = mode.name == "strict"
    fmts = _fit_formats(best, output, has_alpha, big)
    w, h = img.size
    smaller = {s: img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS) for s in DOWNSCALES}
    full_best = size  # smallest full-size file at the current floor
    hint: dict[str, int] = {}  # the last quality found per format: the next search starts there

    def attempt(picture: Image.Image, fmt: str, floor: float) -> Result | None:
        made = _encode_to(picture, fmt, floor, strict, deadline, ref, hint.get(fmt, _start(fmt, floor)))
        if made and fmt != "png":
            hint[fmt] = int(made.notes[0].rsplit("_q", 1)[1])
        return made

    for step, floor in enumerate(floors_below(mode)):
        relaxed = ("qualityFloorRelaxed",) if step else ()
        if step:  # the mode's own floor at full size was already searched above
            for fmt in fmts:
                if fmt == "png":
                    continue
                made = attempt(img, fmt, floor)
                if made is None:
                    continue
                full_best = len(made.data)
                if full_best <= rule.cap:
                    return Result(made.data, made.fmt, made.score, made.notes + flags + relaxed)
        if full_best > HOPELESS * rule.cap:
            continue  # not even half the pixels would fit: go straight to the next floor
        reachable = set(fmts)  # missing the floor even at top quality: smaller sizes lose more detail, so they are skipped
        for scale in DOWNSCALES:
            for fmt in [f for f in fmts if f in reachable]:
                deadline.check()
                made = attempt(smaller[scale], fmt, floor)
                if made is None:
                    reachable.discard(fmt)
                elif len(made.data) <= rule.cap:
                    notes = made.notes + (f"scale_{scale}", "downscaled") + flags + relaxed
                    return Result(made.data, made.fmt, made.score, notes)
    return _last_resort(img, fmts[0], ref, rule, deadline, flags)


def _last_resort(img: Image.Image, fmt: str, ref: Reference, rule: SizeRule, deadline: Deadline,
                 flags: tuple[str, ...]) -> Result:
    """Shrink until it fits: the cap is never exceeded (a 1-pixel picture always fits)."""
    w, h = img.size
    scale = LAST_RESORT_SCALE
    while True:
        deadline.check()
        small = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        data = _encode(small, fmt, quality=LAST_RESORT_QUALITY, fast=True)
        if len(data) <= rule.cap or small.size == (1, 1):
            break
        scale *= LAST_RESORT_STEP
    notes = (f"{fmt}_q{LAST_RESORT_QUALITY}", f"scale_{scale:.3f}", "downscaled") + flags + (
        "qualityFloorRelaxed", "lastResortShrink")
    return Result(data, fmt, ref.score(_decode(data)), notes)


def len_of(result: Result) -> int:
    return len(result.data)


