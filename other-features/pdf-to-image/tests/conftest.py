"""Invented PDFs built in code. Nothing here is a real document."""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import pikepdf
import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
KEY = "c" * 40
PASSWORD = "open-sesame"
os.environ.setdefault("CONVERTER_KEY", KEY)

HELV = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)


def _page(pdf: pikepdf.Pdf, text: str, size=(612, 792)) -> pikepdf.Page:
    page = pdf.add_blank_page(page_size=size)
    page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=HELV))
    page.Contents = pdf.make_stream(f"BT /F1 36 Tf 40 {size[1] - 80} Td ({text}) Tj ET".encode())
    return pdf.pages[-1]


def save(pdf: pikepdf.Pdf, **kw) -> bytes:
    buf = io.BytesIO()
    pdf.save(buf, **kw)
    return buf.getvalue()


@pytest.fixture(scope="session")
def text_pdf() -> bytes:
    pdf = pikepdf.new()
    _page(pdf, "Invented invoice 12345")
    return save(pdf)


@pytest.fixture(scope="session")
def multi_pdf() -> bytes:
    """Three pages: portrait, landscape-sized but marked Rotate 90, and a small square."""
    pdf = pikepdf.new()
    _page(pdf, "Page one")
    two = _page(pdf, "Page two rotated", size=(612, 792))
    two.Rotate = 90
    _page(pdf, "Page three", size=(300, 300))
    return save(pdf)


@pytest.fixture(scope="session")
def image_pdf() -> bytes:
    img = Image.new("RGB", (800, 600), (200, 40, 40))
    ImageDraw.Draw(img).ellipse((100, 100, 700, 500), fill=(40, 40, 200))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    pdf = pikepdf.new()
    image = pikepdf.Stream(pdf, buf.getvalue())
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height, image.BitsPerComponent = 800, 600, 8
    image.ColorSpace, image.Filter = pikepdf.Name.DeviceRGB, pikepdf.Name.DCTDecode
    page = pdf.add_blank_page(page_size=(400, 300))
    page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=image))
    page.Contents = pdf.make_stream(b"q 400 0 0 300 0 0 cm /Im0 Do Q")
    return save(pdf)


@pytest.fixture(scope="session")
def encrypted_pdf() -> bytes:
    pdf = pikepdf.new()
    _page(pdf, "Secret invented page")
    return save(pdf, encryption=pikepdf.Encryption(user=PASSWORD, owner="owner-pass"))


@pytest.fixture(scope="session")
def huge_page_pdf() -> bytes:
    pdf = pikepdf.new()
    _page(pdf, "Huge", size=(14400, 14400))  # 200 inches square
    return save(pdf)


@pytest.fixture(scope="session")
def javascript_pdf() -> bytes:
    pdf = pikepdf.new()
    _page(pdf, "Has script")
    pdf.Root.OpenAction = pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert(1)"))
    return save(pdf)


def many_pages(n: int) -> bytes:
    pdf = pikepdf.new()
    for i in range(n):
        _page(pdf, f"P{i + 1}", size=(200, 200))
    return save(pdf)


def decode(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img
