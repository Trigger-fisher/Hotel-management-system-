"""Prints real seconds per page at 150 and 300 dpi on an invented, text-heavy page.
Run from the service folder:  .venv\\Scripts\\python.exe scripts\\measure.py"""
import io
import sys
import tempfile
import time
from pathlib import Path

import pikepdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Limits  # noqa: E402
from app.convert import convert_job  # noqa: E402
from app.options import parse_options  # noqa: E402


def sample_pdf(pages: int) -> bytes:
    pdf = pikepdf.new()
    font = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)
    for n in range(pages):
        page = pdf.add_blank_page(page_size=(595, 842))
        page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
        lines = "".join(f"BT /F1 11 Tf 40 {800 - i * 14} Td (Invented line {i} of page {n + 1} 0123456789) Tj ET\n" for i in range(55))
        page.Contents = pdf.make_stream(lines.encode())
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


if __name__ == "__main__":
    pages = 10
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.pdf"
        src.write_bytes(sample_pdf(pages))
        for dpi in (150, 300):
            for fmt in ("png", "jpeg"):
                out = Path(tmp) / f"o{dpi}{fmt}"
                out.mkdir()
                t = time.perf_counter()
                m = convert_job(str(src), str(out), parse_options({"dpi": str(dpi), "format": fmt}), Limits())
                per = (time.perf_counter() - t) / pages
                size = sum(p["bytes"] for p in m["pages"]) / pages / 1024
                print(f"{dpi} dpi {fmt:4s}: {per * 1000:6.0f} ms/page, {size:6.0f} KB/page, {m['pages'][0]['width']}x{m['pages'][0]['height']}")
