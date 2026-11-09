# copied from intake-worker on 2026-11-04 (this copy takes BGR pictures; blur_scores is copied in from intake-worker's
# image metrics, noise_sigma comes from the reader's own app/quality.py)
"""Clarity check per card (MJ, 4 Nov 2026: "if the image is not clear, we must know").

After cutting (and reading), every card and its key regions are scored on the untouched pixels:
  whole card   edge steepness and the 95th-percentile tile Laplacian variance at a fixed size (1000 px long side), glare share,
               exposure (mean grey), contrast (1st-99th percentile spread), noise, effective dpi of the card in the SOURCE picture,
               a motion-blur hint (edges much stronger in one direction)
  regions      portrait (the face found by app/faces, else the type's photo box), name/DOB block, number line, QR, MRZ: edge
               steepness and glare inside each; the box comes from the OCR line that holds the value where it was read, else from
               the document type's usual layout (LAYOUTS), else the region is not judged
  reading      the reader's confidence of the key fields (name, date of birth, number); a QR seen but not decoded
Each card gets a grade, clear / usable / unclear, with plain reasons ("number line blurred", "glare over photo", "QR unreadable",
"card too small: 140 dpi") and, when unclear, one retake advice line. All thresholds: app/thresholds.py (env overridable)."""
from __future__ import annotations

import io
import re

import cv2
import numpy as np
from PIL import Image

from . import thresholds as T
from .faces import steepness
from .quality import noise_sigma

SIDE = 1000  # every measure is taken on the card scaled to this long side
GRADES = ("clear", "usable", "unclear")
# Long side of the physical document in millimetres, by type (ID-1 cards 85.6, passport / OCI pages ID-3 125, visa sticker 120, A4 297)
LONG_MM = {"passport": 125.0, "oci": 125.0, "visa": 120.0}
A4_FORMS = {"letter", "eta", "frro"}
# Where a region usually sits on the upright card, as shares of width and height (x0, y0, x1, y1), by (type, side). Only used when
# the reader did not place the value itself; types and sides not listed are judged from the reader's lines only.
LAYOUTS: dict[tuple[str, str], dict[str, tuple[float, float, float, float]]] = {
    ("aadhaar", "front"): {"portrait": (0.02, 0.22, 0.25, 0.66), "nameDob": (0.25, 0.24, 0.85, 0.56), "number": (0.20, 0.70, 0.82, 0.88)},
    ("aadhaar", "back"): {"number": (0.20, 0.70, 0.82, 0.88)},
    ("driving-licence", "front"): {"portrait": (0.76, 0.17, 0.99, 0.60)},
    ("voter-id", "front"): {"portrait": (0.02, 0.20, 0.25, 0.65)},
    ("passport", "front"): {"mrz": (0.0, 0.76, 1.0, 1.0)},
    ("visa", "single"): {"mrz": (0.0, 0.76, 1.0, 1.0)},
    ("national-id", "back"): {"mrz": (0.0, 0.55, 1.0, 1.0)},
    ("residence-permit", "back"): {"mrz": (0.0, 0.55, 1.0, 1.0)},
}
# Card sides that carry the holder's portrait: no portrait found there is reported ("no photo found").
EXPECT_PORTRAIT = {("aadhaar", "front"), ("aadhaar", "single"), ("pan", "single"), ("driving-licence", "front"), ("voter-id", "front"),
                   ("passport", "front"), ("oci", "single"), ("visa", "single"), ("pio", "single"), ("residence-permit", "front"),
                   ("national-id", "front")}
# MJ's rule (4 Nov 2026), copied from intake-worker on 2026-11-05: on these sides an ID photo that is missing, blurred, glared or too
# small REJECTS the card. Forms without a portrait are never checked: the e-Visa ETA printout and the FRRO permit printout.
PHOTO_REQUIRED = {("aadhaar", "front"), ("aadhaar", "single"), ("pan", "single"), ("driving-licence", "front"), ("voter-id", "front"),
                  ("passport", "front"), ("oci", "single"), ("visa", "single"), ("residence-permit", "front"), ("residence-permit", "single")}
NO_PORTRAIT_FORMS = {"eta", "frro"}
PHOTO_RETAKE = "Photo on the ID is not clear, please retake."
PHOTO_REASONS = {"none": "no photo found on the ID", "photo too small": "photo on the ID too small",
                 "photo blurred": "photo on the ID blurred", "glare over photo": "glare over the photo on the ID"}
REGION_NAMES = {"portrait": "photo", "nameDob": "name/DOB block", "number": "number line", "mrz": "MRZ", "qr": "QR"}
KEY_REGION = {"name": "nameDob", "dob": "nameDob", "documentNumber": "number"}
FIELD_NAMES = {"name": "name", "dob": "date of birth", "documentNumber": "number"}
ADVICE = {
    "blur": "hold the phone steady and let it focus on the card",
    "glare": "tilt the card or move away from the lamp so no light shines on it",
    "small": "move closer so the card fills more of the picture (or scan at 300 dpi)",
    "dark": "use more light",
    "contrast": "use even light and keep the card flat",
    "noise": "use more light (the picture is grainy)",
    "qr": "keep the QR code sharp and free of glare",
    "compressed": "send the original photo, not a compressed copy (for example one forwarded through a chat app)",
}
# libjpeg's standard luminance table (ITU-T T.81 Annex K): quality 50. A file's own table is compared with it by its sum.
_STD_LUMA_SUM = 3688.0


def expects_portrait(kind: str, side: str, form: str | None = None) -> bool:
    """Does this card side carry the holder's portrait at all (A4 printouts such as the ETA never do)?"""
    return form not in NO_PORTRAIT_FORMS and (kind, side) in EXPECT_PORTRAIT


def photo_required(kind: str, side: str, form: str | None = None) -> bool:
    """Does this card side carry the holder's portrait that MJ's rule checks (and a bad one rejects)?"""
    return form not in NO_PORTRAIT_FORMS and (kind, side) in PHOTO_REQUIRED


def photo_verdict(kind: str, side: str, form: str | None, portrait) -> dict | None:
    """MJ's rule: {code, reason, retake} when a side that must carry the holder's portrait has none that is clear, else None.
    A portrait that could not be looked for (face models missing) is not judged. Nothing about the face is kept."""
    if portrait is None or not photo_required(kind, side, form) or portrait.status not in ("none", "unclear"):
        return None
    why = [PHOTO_REASONS.get(r, r) for r in (portrait.reasons if portrait.status == "unclear" else ["none"])]
    return {"code": "photo_unclear", "reason": "; ".join(why) or PHOTO_REASONS["none"], "retake": PHOTO_RETAKE}


def jpeg_quality(data: bytes) -> float | None:
    """The lowest JPEG quality (libjpeg scale 1-100) an ORIGINAL upload went through: its own quantisation table (a JPEG), or an
    earlier compression traced in its pixels (traced_quality: a hard-compressed copy re-saved as PNG or as a high-quality JPEG,
    copied from intake-worker on 2026-11-05), whichever is lower; None when neither is found. Measured on the file as sent, before any re-save or resampling."""
    table = table_quality(data)
    traced = traced_quality(data) if table is None or table >= TRACE_REPORT_BELOW else None
    found = [q for q in (table, traced) if q is not None]
    return float(min(found)) if found else None


def table_quality(data: bytes) -> float | None:
    """The JPEG quality from the file's own luminance quantisation table; None for anything that is not a JPEG (MJ, 4 Nov 2026)."""
    if not data or data[:3] != b"\xff\xd8\xff":
        return None
    try:
        with Image.open(io.BytesIO(data)) as picture:
            tables = getattr(picture, "quantization", None) or {}
            if not tables:
                return None
            scale = float(sum(tables[min(tables)])) / _STD_LUMA_SUM * 100.0
    except (OSError, ValueError, SyntaxError):
        return None
    quality = (200.0 - scale) / 2.0 if scale <= 100 else 5000.0 / scale
    return round(max(1.0, min(100.0, quality)), 1)


# ---- an earlier JPEG compression traced in the pixels (the same logic as quality-gate app/compression.py, own copy) ------------
# The 8 x 8 blocks of the decoded upload are compressed again with each candidate quality's table (libjpeg scale, clipping
# re-applied); a block that comes back unchanged at one quality and clearly worse at both neighbours is a trace of that quality.
_STD_LUMA = np.array([16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
                      14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
                      49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99], np.float32)
_D8 = np.array([[(np.sqrt(0.125) if k == 0 else 0.5) * np.cos((2 * n + 1) * k * np.pi / 16) for n in range(8)] for k in range(8)])
_DCT = np.kron(_D8, _D8).astype(np.float32)  # row-major 8 x 8 block -> its 64 DCT coefficients: coef = block @ _DCT.T
_DCT_T = np.ascontiguousarray(_DCT.T)
TRACE_QUALITIES = np.arange(5, 48)  # candidates 5-45 are reported; 46 and 47 are only neighbours
TRACE_REPORT_BELOW = 46
TRACE_WINDOW = 1024  # px: the centre of the picture, on the 8 px grid
TRACE_BLOCKS = 512  # textured blocks used at most
TRACE_MIN_BLOCKS = 40
TRACE_SPREAD = 24  # grey levels between a block's darkest and lightest pixel: flat paper and plain colour carry no trace
TRACE_SAME = 1.0  # mean grey-level error of a block that comes back unchanged
TRACE_GAP = 0.5  # how much worse both neighbouring qualities must be
TRACE_SHARE = 0.07  # share of blocks with that dip at one quality (calibrated on invented cards, README)
TRACE_CANDIDATES = 3
TRACE_ROUGH_BLOCKS = 256  # blocks on which the candidates are picked
TRACE_CROP_EDGES = 1.3  # a second grid phase is tried when its block edges are this much stronger than the whole picture's


def _jpeg_table(quality: int) -> np.ndarray:
    scale = 5000 // quality if quality < 50 else 200 - 2 * quality
    return np.clip(np.floor((_STD_LUMA * scale + 50) / 100), 1, 255).astype(np.float32)


_TABLES = np.stack([_jpeg_table(int(q)) for q in TRACE_QUALITIES])


def _grid_phases(gray: np.ndarray) -> list[tuple[int, int]]:
    """Where the 8 px grid starts: (0, 0) for a picture saved whole, plus the phase of the strongest block edges when a cropped
    copy shows them clearly stronger (measured on the centre window only)."""
    h, w = gray.shape
    y0, x0 = max(0, (h - TRACE_WINDOW) // 16 * 8), max(0, (w - TRACE_WINDOW) // 16 * 8)
    g = gray[y0:y0 + TRACE_WINDOW, x0:x0 + TRACE_WINDOW]
    dx = cv2.reduce(cv2.absdiff(g[:, 1:], g[:, :-1]), 0, cv2.REDUCE_AVG, dtype=cv2.CV_32F).ravel()
    dy = cv2.reduce(cv2.absdiff(g[1:], g[:-1]), 1, cv2.REDUCE_AVG, dtype=cv2.CV_32F).ravel()
    px = np.array([dx[k::8].mean() for k in range(8)])  # px[k]: jumps between column k and k + 1 (k mod 8)
    py = np.array([dy[k::8].mean() for k in range(8)])
    kx, ky = int(np.argmax(px)), int(np.argmax(py))
    strong = px[kx] >= TRACE_CROP_EDGES * px[7] or py[ky] >= TRACE_CROP_EDGES * py[7]
    phase = ((kx + 1) % 8, (ky + 1) % 8)
    return [(0, 0)] + ([phase] if strong and phase != (0, 0) else [])


def _trace_blocks(gray: np.ndarray, ox: int, oy: int) -> np.ndarray:
    h, w = gray.shape
    y0 = oy + max(0, (h - oy - TRACE_WINDOW) // 16 * 8)
    x0 = ox + max(0, (w - ox - TRACE_WINDOW) // 16 * 8)
    ny, nx = min(TRACE_WINDOW, h - y0) // 8, min(TRACE_WINDOW, w - x0) // 8
    if ny < 2 or nx < 2:
        return np.zeros((0, 64), np.float32)
    b = gray[y0:y0 + ny * 8, x0:x0 + nx * 8].reshape(ny, 8, nx, 8).swapaxes(1, 2).reshape(-1, 64)
    idx = np.nonzero(b.max(axis=1).astype(np.int16) - b.min(axis=1) >= TRACE_SPREAD)[0]
    if idx.size > TRACE_BLOCKS:
        idx = idx[np.linspace(0, idx.size - 1, TRACE_BLOCKS).astype(int)]
    return b[idx].astype(np.float32)


def _unclipped_error(bc: np.ndarray, table: np.ndarray) -> np.ndarray:
    """Recompression error of blocks with pixels at 0 or 255: the values the first decoder clipped are let past the clip for two
    rounds, so the clip does not hide the trace."""
    hi, lo = bc >= 253, bc <= 2
    yc = (np.rint(((bc - 128.0) @ _DCT_T) / table) * table) @ _DCT + 128.0
    for _ in range(2):
        x = np.where(hi & (yc > bc), yc, np.where(lo & (yc < bc), yc, bc))
        yc = (np.rint(((x - 128.0) @ _DCT_T) / table) * table) @ _DCT + 128.0
    return np.abs(np.clip(np.rint(yc), 0, 255) - bc).mean(axis=1)


def _dip_share(e: np.ndarray, left: np.ndarray, right: np.ndarray) -> np.ndarray:
    return ((e <= TRACE_SAME) & (np.minimum(left, right) >= e + TRACE_GAP)).mean(axis=0)


def _trace(b: np.ndarray) -> tuple[int | None, float]:
    """Each block compressed again with every candidate table (mean grey-level change per block and quality), then the best
    candidates checked again on all blocks with the clipped ones handled."""
    coef = (b - 128.0) @ _DCT_T
    rough_rows = slice(None, None, max(1, len(b) // TRACE_ROUGH_BLOCKS))  # candidates are picked on a sample
    rb, rc = b[rough_rows], coef[rough_rows]
    rec = ((np.rint(rc[None] / _TABLES[:, None]) * _TABLES[:, None]).reshape(-1, 64) @ _DCT).reshape(len(_TABLES), len(rb), 64)
    errors = np.abs(np.clip(np.rint(rec + 128.0), 0, 255) - rb[None]).mean(axis=2).T
    far = np.full((len(rb), 1), 1e9, np.float32)
    left, right = np.concatenate([far, errors[:, :-1]], axis=1), np.concatenate([errors[:, 1:], far], axis=1)
    rough = _dip_share(errors, left, right)
    clipped = ((b >= 253) | (b <= 2)).any(axis=1)
    refined: dict[int, np.ndarray] = {}

    def column(j: int) -> np.ndarray:
        if j < 0 or j >= len(_TABLES):
            return np.full(len(b), 1e9, np.float32)
        if j not in refined:
            t = _TABLES[j]
            e = np.abs(np.clip(np.rint((np.rint(coef / t) * t) @ _DCT + 128.0), 0, 255) - b).mean(axis=1)
            if clipped.any():
                e[clipped] = _unclipped_error(b[clipped], t)
            refined[j] = e
        return refined[j]

    found, best = None, 0.0
    for i in [int(i) for i in np.argsort(-rough) if TRACE_QUALITIES[i] < TRACE_REPORT_BELOW][:TRACE_CANDIDATES]:
        share = float(_dip_share(column(i), column(i - 1), column(i + 1)))
        best = max(best, share)
        if share >= TRACE_SHARE and (found is None or TRACE_QUALITIES[i] < found):
            found = int(TRACE_QUALITIES[i])
    return found, best


def earlier_quality(gray: np.ndarray) -> tuple[int | None, float]:
    """(quality 5-45 of an earlier JPEG compression traced in this grey picture or None, the strongest trace share). The picture
    must be the upload's own pixels: resizing or turning it by other than whole 8 px blocks wipes the trace."""
    if gray.ndim != 2 or min(gray.shape) < 64:
        return None, 0.0
    found, best = None, 0.0
    for ox, oy in _grid_phases(gray):
        b = _trace_blocks(gray, ox, oy)
        if len(b) < TRACE_MIN_BLOCKS:
            continue
        q, share = _trace(b)
        best = max(best, share)
        if q is not None and (found is None or q < found):
            found = q
    return found, round(best, 3)


def traced_quality(data: bytes) -> int | None:
    """Quality of an earlier JPEG compression traced in an upload's pixels (JPEG, PNG or WebP), or None. A JPEG is decoded to its
    own luminance (no colour step, no EXIF turn: the 8 px grid stays where the encoder put it)."""
    if not data:
        return None
    try:
        gray = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE | cv2.IMREAD_IGNORE_ORIENTATION)
    except cv2.error:
        return None
    if gray is None:
        return None
    return earlier_quality(gray)[0]


def _gray(img: np.ndarray) -> np.ndarray:
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    longest = max(gray.shape[:2])
    if longest != SIDE:
        f = SIDE / longest
        gray = cv2.resize(gray, None, fx=f, fy=f, interpolation=cv2.INTER_AREA if f < 1 else cv2.INTER_CUBIC)
    return gray


def blur_scores(small: np.ndarray) -> dict:
    """Sharpness on a grey picture already at SIDE: the sharpest tiles' Laplacian variance, and a motion hint (strong edges much
    stronger in one direction). Copied from intake-worker's image metrics."""
    lap = cv2.Laplacian(small, cv2.CV_64F)
    gx = cv2.Sobel(small, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(small, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    tile, lap_vars = 40, []
    for y in range(0, small.shape[0] - tile + 1, tile):
        for x in range(0, small.shape[1] - tile + 1, tile):
            lap_vars.append(lap[y:y + tile, x:x + tile].var())
    if not lap_vars:
        lap_vars = [lap.var()]
    strong = mag > np.percentile(mag, 97)
    ax, ay = float(np.abs(gx[strong]).mean()) if strong.any() else 0.0, float(np.abs(gy[strong]).mean()) if strong.any() else 0.0
    ratio = (ax + 1e-6) / (ay + 1e-6)
    return {"blurLaplacian": float(np.percentile(lap_vars, 95)),
            "motionDirection": "horizontal" if ratio < 0.45 else "vertical" if ratio > 2.2 else None}


def glare_share(gray: np.ndarray, min_blob: float) -> float:
    """Share of the picture blown out to (near) white in blobs at least `min_blob` of its area. Print on white paper is not glare:
    only pixels brighter than the card's own light parts count."""
    paper = float(np.percentile(gray, 90))
    level = max(248.0, min(253.0, paper + 6.0))
    bright = (gray >= level).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
    big = sum(int(s[cv2.CC_STAT_AREA]) for s in stats[1:n] if s[cv2.CC_STAT_AREA] >= min_blob * gray.size)
    return float(big / gray.size)


def _ink(gray: np.ndarray) -> float:
    """Share of clearly dark print in a region (relative to its own paper)."""
    return float((gray < np.percentile(gray, 90) - 40).mean()) if gray.size else 0.0


def source_long_px(quad, fallback: int) -> float:
    if quad is None:
        return float(fallback)
    q = np.asarray(quad, np.float32).reshape(-1, 2)
    if len(q) != 4:
        return float(fallback)
    return float(max(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[2] - q[1]), np.linalg.norm(q[3] - q[2]), np.linalg.norm(q[0] - q[3])))


def physical_long_mm(kind: str, form: str | None, shape: tuple[int, int]) -> float:
    if form in A4_FORMS:
        return 297.0
    if kind in LONG_MM:
        return LONG_MM[kind]
    h, w = shape[:2]
    aspect = max(h, w) / max(1, min(h, w))
    return 297.0 if aspect < 1.47 and max(h, w) > 1.2 * 1000 else 85.6  # an A4 page (1.41) vs an ID-1 card (1.586)


# ---- regions ---------------------------------------------------------------------------------------------------------------------

def _digits(text: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", (text or "").upper())


def _line_boxes(result: dict, shape: tuple[int, int]) -> list[tuple[str, float, tuple[float, float, float, float]]]:
    """(text, confidence, box as shares of the card) for every OCR line; the reader's frame may be the card at another scale."""
    page = ((result.get("document") or {}).get("pageImage") or {})
    pw, ph = float(page.get("width") or shape[1]), float(page.get("height") or shape[0])
    out = []
    for line in result.get("lines", []):
        b = line.get("bbox") or [0, 0, 0, 0]
        if len(b) != 4 or b[2] <= b[0] or b[3] <= b[1]:
            continue
        out.append((line.get("text", ""), float(line.get("confidence", 0)), (b[0] / pw, b[1] / ph, b[2] / pw, b[3] / ph)))
    return out


def _union(boxes: list[tuple[float, float, float, float]], pad: float = 0.01) -> tuple[float, float, float, float] | None:
    if not boxes:
        return None
    return (max(0.0, min(b[0] for b in boxes) - pad), max(0.0, min(b[1] for b in boxes) - pad),
            min(1.0, max(b[2] for b in boxes) + pad), min(1.0, max(b[3] for b in boxes) + pad))


def locate(result: dict, doc: dict, kind: str, side: str, shape: tuple[int, int], portrait_box=None) -> dict[str, tuple[tuple, str]]:
    """{region: (box as shares, source 'ocr' | 'face' | 'layout' | 'detector')}."""
    lines = _line_boxes(result or {}, shape)
    fields = (doc or {}).get("fields", {})
    layout = LAYOUTS.get((kind, side), {})
    found: dict[str, tuple[tuple, str]] = {}
    name = str((fields.get("name") or {}).get("value") or "")
    dob = str((fields.get("dob") or {}).get("value") or "")
    words = [w.casefold() for w in name.split() if len(w) >= 3]
    dob_digits = re.sub(r"\D", "", dob)
    dob_forms = {dob_digits, dob_digits[6:8] + dob_digits[4:6] + dob_digits[:4]} if len(dob_digits) == 8 else {dob_digits} if dob_digits else set()
    nd = [b for t, _, b in lines if (words and any(w in t.casefold() for w in words)) or
          (dob_forms and any(f and f in re.sub(r"\D", "", t) for f in dob_forms))]
    if box := _union(nd):
        found["nameDob"] = (box, "ocr")
    elif "nameDob" in layout:
        found["nameDob"] = (layout["nameDob"], "layout")
    number = _digits(str((fields.get("documentNumber") or {}).get("value") or ""))
    nb = [b for t, _, b in lines if number and len(number) >= 6 and number[-6:] in _digits(t)]
    if box := _union(nb):
        found["number"] = (box, "ocr")
    elif "number" in layout:
        found["number"] = (layout["number"], "layout")
    mrz = [b for t, _, b in lines if t.count("<") >= 5]
    if box := _union(mrz):
        found["mrz"] = (box, "ocr")
    elif "mrz" in layout:
        found["mrz"] = (layout["mrz"], "layout")
    if portrait_box is not None:
        x, y, w, h = portrait_box
        H, W = shape[:2]
        found["portrait"] = ((max(0.0, (x - 0.3 * w) / W), max(0.0, (y - 0.35 * h) / H), min(1.0, (x + 1.3 * w) / W),
                              min(1.0, (y + 1.35 * h) / H)), "face")
    elif "portrait" in layout:
        found["portrait"] = (layout["portrait"], "layout")
    return found


def _qr_box(gray: np.ndarray) -> tuple[tuple, bool] | None:
    """(box as shares, decoded?) of a QR code seen on the card, or None. zxing decodes; OpenCV's finder sees a QR it cannot read."""
    try:
        import zxingcpp
        hits = zxingcpp.read_barcodes(gray)
        for r in hits:
            if "QR" in str(r.format).upper():
                p = r.position
                xs = [p.top_left.x, p.top_right.x, p.bottom_right.x, p.bottom_left.x]
                ys = [p.top_left.y, p.top_right.y, p.bottom_right.y, p.bottom_left.y]
                H, W = gray.shape
                return (min(xs) / W, min(ys) / H, max(xs) / W, max(ys) / H), True
    except (ImportError, RuntimeError, ValueError, TypeError):
        pass
    try:
        ok, points = cv2.QRCodeDetector().detect(gray)
    except cv2.error:
        return None
    if not ok or points is None:
        return None
    q = np.asarray(points, np.float32).reshape(-1, 2)
    H, W = gray.shape
    x0, y0, x1, y1 = q[:, 0].min() / W, q[:, 1].min() / H, q[:, 0].max() / W, q[:, 1].max() / H
    if (x1 - x0) < 0.06 or (y1 - y0) < 0.06 or (x1 - x0) * (y1 - y0) > 0.5:
        return None  # a tiny or a card-sized "QR" is a false find
    return (float(x0), float(y0), float(x1), float(y1)), False


# ---- grading -----------------------------------------------------------------------------------------------------------------------

def _level(value: float, unclear: float, usable: float, higher_is_better: bool = True) -> str:
    if higher_is_better:
        return "unclear" if value < unclear else "usable" if value < usable else "clear"
    return "unclear" if value > unclear else "usable" if value > usable else "clear"


def assess(img: np.ndarray, result: dict | None = None, doc: dict | None = None, kind: str = "unknown", side: str = "unknown",
           source_long: float | None = None, portrait=None, jpeg_q: float | None = None) -> dict:
    """The clarity of one upright card (BGR or grey). `source_long` = the card's long side in the SOURCE picture's pixels (from the
    cutter's quad); `portrait` = app.faces.Portrait for this card, or None; `jpeg_q` = the JPEG quality of the ORIGINAL upload
    (jpeg_quality), or None. Returns a dict that is safe to return (numbers and phrases only). `photoReject` is set when MJ's photo
    rule rejects the card (see photo_verdict)."""
    gray = _gray(img)
    H, W = gray.shape
    issues: list[tuple[str, str, str]] = []  # (level, reason, advice key)
    form = ((doc or {}).get("fields", {}).get("form") or {}).get("value")
    long_mm = physical_long_mm(kind, form, img.shape)
    dpi = (source_long or max(img.shape[:2])) / (long_mm / 25.4)
    blur = blur_scores(gray)
    sharp = steepness(gray)
    qr = _qr_box(gray)
    lit = gray
    if qr is not None:  # a QR's white modules and quiet zone are not glare
        lit = gray.copy()
        x0, y0, x1, y1 = qr[0]
        mx, my = 0.15 * (x1 - x0), 0.15 * (y1 - y0)
        lit[max(0, int((y0 - my) * H)):int((y1 + my) * H) + 1, max(0, int((x0 - mx) * W)):int((x1 + mx) * W) + 1] = int(np.median(gray))
    glare = glare_share(lit, 0.003)
    brightness = float(gray.mean())
    p1, p99 = (float(v) for v in np.percentile(gray, [1, 99]))
    contrast = p99 - p1
    noise = noise_sigma(gray)
    scores = {"dpi": int(round(dpi)), "sharpness": round(sharp, 3), "laplacian": round(blur["blurLaplacian"], 1), "glare": round(glare, 3),
              "brightness": round(brightness, 1), "contrast": round(contrast, 1), "noise": round(noise, 2), "motion": blur["motionDirection"]}
    if jpeg_q is not None:
        scores["jpegQuality"] = jpeg_q
        lvl = _level(jpeg_q, T.get("CLARITY_JPEG_Q_UNCLEAR"), T.get("CLARITY_JPEG_Q_USABLE"))
        if lvl != "clear":
            issues.append((lvl, "picture too compressed", "compressed"))

    lvl = _level(dpi, T.get("CLARITY_DPI_UNCLEAR"), T.get("CLARITY_DPI_USABLE"))
    if lvl != "clear":
        issues.append((lvl, f"card too small: {int(round(dpi))} dpi", "small"))
    lvl = _level(sharp, T.get("CLARITY_SHARP_UNCLEAR"), T.get("CLARITY_SHARP_USABLE"))
    if lvl == "clear" and blur["blurLaplacian"] < T.get("CLARITY_LAPLACIAN_USABLE") and contrast >= T.get("CLARITY_CONTRAST_USABLE"):
        lvl = "usable"  # steep edges but very little fine detail: soft print
    if lvl != "clear":
        motion = f" (motion blur, {blur['motionDirection']})" if blur["motionDirection"] else ""
        issues.append((lvl, "card blurred" + motion, "blur"))
    lvl = _level(glare, T.get("CLARITY_GLARE_CARD_UNCLEAR"), T.get("CLARITY_GLARE_CARD_USABLE"), higher_is_better=False)
    if lvl != "clear":
        issues.append((lvl, f"glare on card ({round(100 * glare)}%)", "glare"))
    if brightness < T.get("CLARITY_DARK_BELOW"):
        issues.append(("unclear", "picture too dark", "dark"))
    elif brightness > T.get("CLARITY_BRIGHT_ABOVE") and contrast < T.get("CLARITY_CONTRAST_USABLE"):
        issues.append(("unclear", "picture washed out", "contrast"))
    lvl = _level(contrast, T.get("CLARITY_CONTRAST_UNCLEAR"), T.get("CLARITY_CONTRAST_USABLE"))
    if lvl != "clear":
        issues.append((lvl, "low contrast", "contrast"))
    lvl = _level(noise, T.get("CLARITY_NOISE_UNCLEAR"), T.get("CLARITY_NOISE_USABLE"), higher_is_better=False)
    if lvl != "clear":
        issues.append((lvl, "grainy picture", "noise"))

    # ---- regions ----
    regions: dict[str, dict] = {}
    pbox = portrait.box if portrait is not None and portrait.box is not None else None
    if pbox is not None:  # the portrait box is on the card picture given; the measures are at SIDE
        f = W / img.shape[1]
        pbox = tuple(v * f for v in pbox)
    for name, (box, source) in locate(result or {}, doc or {}, kind, side, (H, W), pbox).items():
        x0, y0, x1, y1 = int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)
        crop = gray[y0:y1, x0:x1]
        if crop.size < 400:
            continue
        ink = _ink(crop)
        r_glare = glare_share(crop, 0.01)
        entry = {"source": source, "sharpness": round(steepness(crop), 3), "glare": round(r_glare, 3)}
        label = REGION_NAMES[name]
        if ink < T.get("CLARITY_INK_MIN") and r_glare < T.get("CLARITY_GLARE_REGION_USABLE") and source == "layout":
            entry["grade"] = "notJudged"  # nothing printed where the layout expected it: another form of the card
            regions[name] = entry
            continue
        grade = "clear"
        kind_of = "PHOTO" if name == "portrait" else "REGION"
        lvl = _level(entry["sharpness"], T.get(f"CLARITY_{kind_of}_SHARP_UNCLEAR"), T.get(f"CLARITY_{kind_of}_SHARP_USABLE"))
        if lvl != "clear":
            issues.append((lvl, f"{label} blurred", "blur"))
            grade = lvl
        lvl = _level(r_glare, T.get("CLARITY_GLARE_REGION_UNCLEAR"), T.get("CLARITY_GLARE_REGION_USABLE"), higher_is_better=False)
        if lvl != "clear":
            issues.append((lvl, f"glare over {label}", "glare"))
            grade = max(grade, lvl, key=GRADES.index)
        entry["grade"] = grade
        regions[name] = entry
    photo_reject = photo_verdict(kind, side, form, portrait)
    if photo_reject is not None:  # MJ's rule: the ID photo must be clear on this side, or the card is rejected
        issues.append(("unclear", photo_reject["reason"], "photo"))
        regions.setdefault("portrait", {"source": "face"})["grade"] = "unclear"
    elif portrait is not None and portrait.status == "unclear":  # the photo check cannot use this portrait: no evidence either way
        for reason in portrait.reasons:
            issues.append(("usable", reason, "glare" if "glare" in reason else "blur" if "blur" in reason else "small"))
        regions.setdefault("portrait", {"source": "face"})["grade"] = "unclear"
    elif portrait is not None and portrait.status == "none" and expects_portrait(kind, side, form):
        # no portrait where this side carries one: with glare on the card it is most likely washed out (unclear), else the detector
        # may simply have missed a small or stylised print (usable)
        glared = glare >= T.get("CLARITY_GLARE_CARD_USABLE")
        issues.append(("unclear" if glared else "usable", "no photo found" + (" (glare on card)" if glared else ""), "glare"))
    if qr is not None:
        box, decoded = qr
        decoded = decoded or bool((result or {}).get("codes"))
        x0, y0, x1, y1 = int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)
        crop = gray[y0:y1, x0:x1]
        regions["qr"] = {"source": "detector", "decoded": decoded, "sharpness": round(steepness(crop), 3) if crop.size else 0.0,
                         "glare": round(glare_share(crop, 0.01), 3) if crop.size else 0.0, "grade": "clear" if decoded else "unclear"}
        if not decoded:
            issues.append(("usable", "QR unreadable", "qr"))

    # ---- reading ----
    ocr: dict[str, float] = {}
    for key, f in ((doc or {}).get("fields") or {}).items():
        if key in FIELD_NAMES and f.get("source") in ("ocr", None) and "confidence" in f:
            ocr[key] = round(float(f["confidence"]), 2)
            lvl = _level(ocr[key], T.get("CLARITY_OCR_UNCLEAR"), T.get("CLARITY_OCR_USABLE"))
            if lvl != "clear":
                issues.append((lvl, f"{FIELD_NAMES[key]} read with low confidence ({ocr[key]:.2f})", "blur"))

    grade = max((i[0] for i in issues), key=GRADES.index, default="clear")
    reasons = list(dict.fromkeys(i[1] for i in issues))
    advice = None
    if grade == "unclear":
        keys = [k for k in dict.fromkeys(i[2] for i in issues if i[0] == "unclear") if k != "photo"]
        lines = ([PHOTO_RETAKE] if photo_reject else []) + (["Retake this card: " + "; ".join(ADVICE[k] for k in keys) + "."] if keys else [])
        advice = " ".join(lines)
    out = {"grade": grade, "reasons": reasons, "advice": advice, "scores": scores, "regions": regions, "ocr": ocr}
    if photo_reject is not None:
        out["photoReject"] = photo_reject
    return out


def unclear_fields(card_clarity: dict, keys) -> list[str]:
    """Key fields of this card whose region is unclear (or the whole card is unclear)."""
    if not card_clarity:
        return []
    if card_clarity.get("grade") == "unclear":
        return list(keys)
    regions = card_clarity.get("regions", {})
    out = []
    for k in keys:
        r = regions.get(KEY_REGION.get(k, ""), {})
        if r.get("grade") == "unclear" or (card_clarity.get("ocr", {}).get(k, 1.0) < T.get("CLARITY_OCR_UNCLEAR")):
            out.append(k)
    return out


def worst(grades) -> str:
    return max((g for g in grades if g in GRADES), key=GRADES.index, default="clear")
