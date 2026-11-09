"""Invented test files only, generated in code."""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import pikepdf
import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
KEY = "s" * 40
os.environ.setdefault("SCANNER_KEY", KEY)

from tests.fake_clamd import FakeClamd  # noqa: E402


@pytest.fixture()
def clamd():
    with FakeClamd() as fake:
        yield fake


def picture(w: int = 300, h: int = 200) -> Image.Image:
    img = Image.new("RGB", (w, h), (30, 90, 160))
    ImageDraw.Draw(img).rectangle((20, 20, w - 20, h - 20), outline="white", width=4)
    return img


def to_bytes(img: Image.Image, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def jpeg_with_gps() -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "InventedCamera"
    exif.get_ifd(0x8825).update({1: "N", 2: (12.0, 30.0, 0.0), 3: "E", 4: (77.0, 10.0, 0.0)})
    return to_bytes(picture(), "JPEG", exif=exif.tobytes()) + b"TRAILING-PAYLOAD"


def armed_pdf() -> bytes:
    """A one-page PDF carrying JavaScript, an OpenAction, a Launch link and an attachment."""
    pdf = pikepdf.new()
    page = pdf.add_blank_page(page_size=(300, 200))
    page.Contents = pdf.make_stream(b"BT /F1 14 Tf 20 100 Td (Hello invented page) Tj ET")
    page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=pikepdf.Dictionary(
        Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)))
    js = pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert('x')"))
    page.AA = pikepdf.Dictionary(O=js)
    page.Annots = pikepdf.Array([
        pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[0, 0, 50, 50],
            A=pikepdf.Dictionary(S=pikepdf.Name.Launch, F=pikepdf.String("cmd.exe")))),
        pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[60, 0, 110, 50],
            A=pikepdf.Dictionary(S=pikepdf.Name.URI, URI=pikepdf.String("https://example.com/")))),
    ])
    pdf.Root.OpenAction = pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert('open')"))
    stream = pikepdf.Stream(pdf, b"attachment bytes")
    spec = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Filespec, F=pikepdf.String("a.exe"),
                                                EF=pikepdf.Dictionary(F=stream)))
    pdf.Root.Names = pikepdf.Dictionary(
        JavaScript=pikepdf.Dictionary(Names=pikepdf.Array([pikepdf.String("s"), js])),
        EmbeddedFiles=pikepdf.Dictionary(Names=pikepdf.Array([pikepdf.String("a.exe"), spec])))
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()
