"""Invented test material only: pictures drawn in code, never real people or documents."""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import numpy as np
import pikepdf
import pytest
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

KEY = "k" * 40
os.environ.setdefault("COMPRESSOR_KEY", KEY)


def photo_like(w: int = 1200, h: int = 900, seed: int = 1) -> Image.Image:
    """Smooth gradients, soft blobs and light noise: behaves like a camera picture."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    base = np.stack([128 + 100 * np.sin(x / 90), 128 + 100 * np.cos(y / 70),
                     128 + 80 * np.sin((x + y) / 120)], axis=-1)
    for _ in range(25):
        cx, cy, r = rng.integers(0, w), rng.integers(0, h), rng.integers(40, 160)
        mask = np.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r)))[..., None]
        base += mask * rng.integers(-90, 90, size=3)
    base += rng.normal(0, 0.8, base.shape)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


def noisy_photo(w: int, h: int, sigma: float, seed: int = 7) -> Image.Image:
    """photo_like with strong sensor-like noise: noise does not compress, so these files stay big."""
    base = np.asarray(photo_like(w, h, seed), dtype=np.float32)
    rng = np.random.default_rng(seed + 100)
    return Image.fromarray(np.clip(base + rng.normal(0, sigma, base.shape), 0, 255).astype(np.uint8), "RGB")


def text_like(w: int = 900, h: int = 600) -> Image.Image:
    """A flat page with text lines: black on white, few colours."""
    img = Image.new("RGB", (w, h), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=22)
    for i in range(12):
        draw.text((30, 20 + i * 44), f"Invoice line {i} amount 12{i}.50 total 9876{i}", fill="black", font=font)
    return img


def to_bytes(img: Image.Image, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


@pytest.fixture(scope="session")
def jpeg_photo() -> bytes:
    return to_bytes(photo_like(), "JPEG", quality=97)


@pytest.fixture(scope="session")
def png_text() -> bytes:
    return to_bytes(text_like(), "PNG", compress_level=1)


def pdf_with_image(img: Image.Image, text: bool = True) -> bytes:
    """A one-page PDF holding `img` as a big Flate-less JPEG, plus a live text line."""
    jpeg = to_bytes(img, "JPEG", quality=98)
    pdf = pikepdf.new()
    w, h = 600, 600 * img.size[1] / img.size[0]
    image = pikepdf.Stream(pdf, jpeg)
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height, image.BitsPerComponent = img.size[0], img.size[1], 8
    image.ColorSpace, image.Filter = pikepdf.Name.DeviceRGB, pikepdf.Name.DCTDecode
    content = f"q {w} 0 0 {h} 0 100 cm /Im0 Do Q\n"
    if text:
        content += "BT /F1 18 Tf 20 60 Td (Total due 4321.00) Tj ET\n"
    page = pdf.add_blank_page(page_size=(612, h + 120))
    page.Resources = pikepdf.Dictionary(
        XObject=pikepdf.Dictionary(Im0=image),
        Font=pikepdf.Dictionary(F1=pikepdf.Dictionary(
            Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)))
    page.Contents = pdf.make_stream(content.encode())
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()

