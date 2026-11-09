"""The portrait hint of the `id-card` profile (MJ, 5 Nov 2026: "Photo on the ID is not clear, please retake.").

The gate does not know the card's type and runs no face model (classical computer vision only), so this is a HINT, never the rule
itself: the intake worker's face check decides. It looks for the printed portrait as a photo-like block on the card and judges
that block alone, because a portrait can be blurred or glared while the print around it is fine.

  1. the card: the main object of the picture (or the whole frame when it fills it), scaled to 1000 px on its long side;
  2. the card's base colour: the median colour of the card;
  3. photo-like tiles (16 px): most pixels differ from the base colour (Lab distance) or are blown out to white, and the tile is not
     flat (a plain colour band is not a photo);
  4. the portrait: the largest group of such tiles shaped like a portrait (taller than wide, 1.0-2.0) covering 2-30% of the card,
     with real photo content (not only glare) in it;
  5. inside it: edge steepness (copied from intake-worker app/faces.py on 2026-11-05), the share blown out to white (copied from
     intake-worker app/clarity.py on 2026-11-05) and its height in the stored picture's pixels.
The result is None when no portrait-like block is found (a card side without a photo, or one the finder misses)."""
from __future__ import annotations

import cv2
import numpy as np

from . import cards
from .metrics import percentiles_u8

SIDE = 1000
TILE = 16


def steepness(gray: np.ndarray) -> float:
    """How steep the strongest edges are, relative to the contrast, in the WORSE of the two directions (a motion blur smears one
    direction only): about 1.0 for crisp print, 0.6 at a Gaussian blur of 1.5 px, 0.3 at 2.5 px (on a card 1000 px long).
    Copied from intake-worker (app/faces.py) on 2026-11-05."""
    if gray.size == 0 or min(gray.shape[:2]) < 3:
        return 0.0
    g = gray.astype(np.float32)
    lo, hi = np.percentile(g, [1, 99])
    if hi - lo < 1:
        return 0.0
    gx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)) / 4.0
    gy = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)) / 4.0
    return float(min(np.percentile(gx, 99.5), np.percentile(gy, 99.5)) / (hi - lo))


def blown_share(gray: np.ndarray, min_blob: float, paper: float | None = None) -> float:
    """Share of the region blown out to (near) white in blobs at least `min_blob` of its area. Print on white paper is not glare:
    only pixels brighter than the card's own light parts count. Copied from intake-worker (app/clarity.py glare_share) on
    2026-11-05, with the paper level allowed to come from the whole card."""
    if gray.size == 0:
        return 0.0
    paper = float(np.percentile(gray, 90)) if paper is None else paper
    level = max(248.0, min(253.0, paper + 6.0))
    bright = (gray >= level).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
    big = sum(int(s[cv2.CC_STAT_AREA]) for s in stats[1:n] if s[cv2.CC_STAT_AREA] >= min_blob * gray.size)
    return float(big / gray.size)


def _card(img: np.ndarray) -> tuple[np.ndarray, float]:
    """The card flattened (the largest card-shaped quad the multi-id finder sees, else the whole frame) scaled to SIDE px on its long
    side, and decoded pixels per card pixel."""
    quads = cards.find_cards(img, 1, work_side=640)
    if quads:
        q = quads[0]
        area = cv2.contourArea(q.reshape(-1, 1, 2))
        if area >= 0.12 * img.shape[0] * img.shape[1]:
            return cards.flatten_to(img, q, SIDE)
    f = SIDE / max(img.shape[:2])
    small = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA if f < 1 else cv2.INTER_CUBIC)
    return small, 1.0 / f


def find(img: np.ndarray) -> tuple[tuple[int, int, int, int], np.ndarray, float] | None:
    """((x0, y0, x1, y1) on the 1000 px card, the card's BGR pixels, decoded pixels per card pixel) or None."""
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    card, per = _card(img)
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(card, cv2.COLOR_BGR2LAB)
    p60, paper = percentiles_u8(gray, [60, 90])
    light = gray >= p60  # the card's paper is its largest light area
    base = np.median(lab[light], axis=0).astype(np.float32)
    diff = lab.astype(np.float32) - base
    dist2 = cv2.transform(diff * diff, np.ones((1, 3), np.float32))  # squared Lab distance, one channel
    blown = gray >= max(248.0, min(253.0, paper + 6.0))
    other = (dist2[..., 0] if dist2.ndim == 3 else dist2) > 22.0 ** 2
    other &= ~blown
    ny, nx = gray.shape[0] // TILE, gray.shape[1] // TILE
    if ny < 4 or nx < 4:
        return None
    size = (nx, ny)
    area = lambda a: cv2.resize(a[:ny * TILE, :nx * TILE], size, interpolation=cv2.INTER_AREA)  # noqa: E731 - tile means
    other_share = area(other.astype(np.float32))
    blown_share_t = area(blown.astype(np.float32))
    g = gray.astype(np.float32)
    spread = np.sqrt(np.maximum(area(g * g) - area(g) ** 2, 0))
    photo = (other_share + blown_share_t) > 0.6  # flat tiles count too (a plain shirt, smooth skin); the group must have texture
    # a coloured band across the card (a header, a stripe) is not a portrait, and touching it would hide one: drop such rows/columns
    photo[photo.mean(axis=1) > 0.6, :] = False
    photo[:, photo.mean(axis=0) > 0.6] = False
    raw = photo.astype(np.uint8)
    close = lambda m: cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))  # noqa: E731
    # as found, and with thin links cut first (a slanted band or a card edge can touch the portrait through a 1-tile line)
    best = None
    for mask in (close(raw), close(cv2.morphologyEx(raw, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)))):
        best = _pick(mask, other, spread, nx, ny, best)
    return (best, card, per) if best is not None else None


def _pick(mask: np.ndarray, other: np.ndarray, spread: np.ndarray, nx: int, ny: int, best):
    """The largest portrait-shaped group of photo tiles in `mask` (or `best` when that is larger), as a box on the card."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=4)
    for i in range(1, n):
        x, y, w, h, area = (int(stats[i, c]) for c in (cv2.CC_STAT_LEFT, cv2.CC_STAT_TOP, cv2.CC_STAT_WIDTH, cv2.CC_STAT_HEIGHT,
                                                        cv2.CC_STAT_AREA))
        share = w * h / float(nx * ny)
        if not (1.0 <= h / max(w, 1) <= 2.0 and 0.02 <= share <= 0.30 and area / float(w * h) >= 0.4 and w < 0.6 * nx):
            continue
        if float(spread[labels == i].mean()) < 5.0:  # one flat colour (a logo block, a stripe end) is not a photo
            continue
        box = (x * TILE, y * TILE, (x + w) * TILE, (y + h) * TILE)
        content = float(other[box[1]:box[3], box[0]:box[2]].mean())
        if content < 0.12:  # only glare, or only pale print: nothing to judge
            continue
        if best is None or (box[2] - box[0]) * (box[3] - box[1]) > (best[2] - best[0]) * (best[3] - best[1]):
            best = box
    return best


def assess(img: np.ndarray, up: int = 1) -> dict | None:
    """{sharpness, glare, heightPx, box} of the portrait-like block, or None when none is found. `up` = stored pixels per decoded
    pixel (heightPx is in the stored picture's pixels)."""
    found = find(img)
    if found is None:
        return None
    (x0, y0, x1, y1), card, per = found
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    crop = gray[y0:y1, x0:x1]
    paper = float(np.percentile(gray, 90))
    return {"sharpness": round(steepness(crop), 3), "glare": round(blown_share(crop, 0.01, paper), 3),
            "heightPx": int(round((y1 - y0) * per * up)), "box": [round(v / SIDE, 3) for v in (x0, y0, x1, y1)]}
