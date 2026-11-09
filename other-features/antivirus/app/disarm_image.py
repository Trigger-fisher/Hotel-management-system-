"""Image disarm: decode the picture and encode it again from pixels only.
Whatever hid in metadata, extra chunks or trailing bytes does not survive."""
from __future__ import annotations

import io

import pillow_heif
from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

from .errors import Rejection

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = None  # we check the declared size ourselves, before decoding
MAX_FRAMES = 300
JPEG_QUALITY = 92  # visually clean; a later step could shrink it
# What each input type becomes when the caller does not ask for a format.
KEEP = {"jpeg": "jpeg", "png": "png", "gif": "gif", "webp": "webp", "bmp": "png", "tiff": "png",
        "heic": "jpeg", "avif": "avif"}
FORMAT_NAME = {"jpeg": "JPEG", "png": "PNG", "gif": "GIF", "webp": "WEBP", "avif": "AVIF"}


def _what_was_there(img: Image.Image, data: bytes, kind: str) -> list[str]:
    found = []
    exif = img.getexif()
    if exif:
        found.append("gps" if exif.get_ifd(0x8825) else "exif")
        if exif.get_ifd(0x8825) and len(exif) > 1:
            found.append("exif")
    if "icc_profile" in img.info:
        found.append("icc_profile")
    if kind == "png" and any(k in img.info for k in ("Comment", "Description", "Software", "XML:com.adobe.xmp")):
        found.append("text_chunks")
    if "xmp" in img.info or "XML:com.adobe.xmp" in img.info:
        found.append("xmp")
    if kind == "jpeg" and data.rfind(b"\xff\xd9") < len(data) - 2:
        found.append("trailing_data")
    if kind == "png" and data.find(b"IEND") != -1 and data.find(b"IEND") + 8 < len(data):
        found.append("trailing_data")
    return sorted(set(found))


def disarm_image(data: bytes, kind: str, output: str, max_pixels: int) -> tuple[bytes, str, list[str]]:
    """Returns (clean bytes, kind of the result, what was removed)."""
    try:
        img = Image.open(io.BytesIO(data))
        if img.size[0] * img.size[1] > max_pixels:
            raise Rejection("too_many_pixels", "The picture has too many pixels.")
        frames = getattr(img, "n_frames", 1)
        if frames > MAX_FRAMES:
            raise Rejection("too_many_frames", "The animation has too many frames.")
        removed = _what_was_there(img, data, kind)
        target = output if output in ("jpeg", "png", "webp", "avif") else KEEP[kind]
        if frames > 1 and kind in ("gif", "webp") and target == kind:
            return _animated(img, kind), kind, sorted(set(removed) | {"reencoded"})
        img.seek(0)
        img.load()
        img = ImageOps.exif_transpose(img)
        buf = io.BytesIO()
        if target == "jpeg":
            rgb = _flatten(img)
            rgb.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True, subsampling=0)
        elif target == "png":
            img.convert("RGBA" if _has_alpha(img) else "RGB").save(buf, "PNG", optimize=True)
        elif target == "gif":
            img.convert("RGBA" if _has_alpha(img) else "RGB").save(buf, "GIF")
        else:  # webp / avif
            img.convert("RGBA" if _has_alpha(img) else "RGB").save(buf, FORMAT_NAME[target], quality=95)
        return buf.getvalue(), target, sorted(set(removed) | {"reencoded"})
    except Rejection:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError, MemoryError):
        raise Rejection("image_corrupt", "The picture could not be read.")


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info


def _flatten(img: Image.Image) -> Image.Image:
    if not _has_alpha(img):
        return img.convert("RGB")
    rgba = img.convert("RGBA")
    base = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(base, rgba).convert("RGB")


def _animated(img: Image.Image, kind: str) -> bytes:
    frames, durations = [], []
    for frame in ImageSequence.Iterator(img):
        durations.append(frame.info.get("duration", 100))
        frames.append(frame.convert("RGBA"))
    buf = io.BytesIO()
    frames[0].save(buf, FORMAT_NAME[kind], save_all=True, append_images=frames[1:],
                   duration=durations, loop=img.info.get("loop", 0))
    return buf.getvalue()
