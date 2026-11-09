"""Cost of the YARA rule scan per file, on invented pictures:  python scripts/bench_scan.py  (from the intake-worker folder)."""
import io
import statistics
import sys
import time

sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1]))
import numpy as np
from PIL import Image

from app import yara_scan

rng = np.random.default_rng(3)


def photo(w, h, fmt="JPEG", **kw):
    x = np.linspace(0, 255, w, dtype=np.float32)[None, :, None]
    y = np.linspace(0, 255, h, dtype=np.float32)[:, None, None]
    px = (x * 0.6 + y * 0.4 + rng.normal(0, 28, (h, w, 3))).clip(0, 255).astype(np.uint8)
    b = io.BytesIO()
    Image.fromarray(px).save(b, fmt, **kw)
    return b.getvalue()


def pdf_with_image(jpeg):
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 450] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
            b"<< /Type /XObject /Subtype /Image /Width 2600 /Height 1950 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "
            + str(len(jpeg)).encode() + b" >>\nstream\n" + jpeg + b"\nendstream",
            b"<< /Length 31 >>\nstream\nq 600 0 0 450 0 0 cm /Im0 Do Q\nendstream"]
    out = b"%PDF-1.4\n"
    for i, o in enumerate(objs, 1):
        out += str(i).encode() + b" 0 obj\n" + o + b"\nendobj\n"
    return out + b"trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n"


big = photo(2600, 1950, quality=95)
samples = {
    "jpeg": ("jpeg", big),
    "jpeg+2MB tail": ("jpeg", big + b"\x00\x00\x00\x18ftypmp42" + rng.integers(0, 256, 2_000_000, dtype=np.uint8).tobytes()),
    "png": ("png", photo(1400, 1000, "PNG")),
    "pdf": ("pdf", pdf_with_image(big)),
    "webp": ("webp", photo(2600, 1950, "WEBP", quality=90)),
}
start = time.perf_counter()
yara_scan.rules()
print(f"compile once: {(time.perf_counter() - start) * 1000:.1f} ms")
for name, (kind, data) in samples.items():
    assert yara_scan.scan(data, kind) == [], name
    runs = []
    for _ in range(30):
        t = time.perf_counter()
        yara_scan.scan(data, kind)
        runs.append((time.perf_counter() - t) * 1000)
    print(f"{name:14s} {len(data) / 1e6:5.2f} MB  median {statistics.median(runs):6.1f} ms  max {max(runs):6.1f} ms")
