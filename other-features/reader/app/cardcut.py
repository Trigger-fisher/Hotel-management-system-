# copied from intake-worker on 2026-11-04 (own copy: model setting READER_CARDCUT_MODEL, classic finder app/cards.py, RapidOCR from
# app/engines). Reader changes for pale-tinted cards are marked "reader change"; see the README section "Several IDs in one photo".
"""Cut every ID card out of a scanned sheet: one straight, upright, cut-to-cut picture per card, like a flat-bed
scan of that card alone.

Finding: Meta's Segment Anything (vit_b, Apache-2.0) on a 1024 px copy, prompted with a coarse 6x6 grid of points
and then with a finer grid only where print is not yet inside a card; masks are kept when they are card shaped
(ID-1 ratio 85.6:54), filled, printed (blank paper is never a card) and not a copy of a better mask. Without the model
file, card-shaped islands of print plus the classic finder (`app/cards.py`) are used and every card carries
the flag `fallbackFinder`.

Cutting: one straight line is fitted per side of the mask (rounded corners left out) and the four lines are
intersected, so tilt, keystone and mild perspective are removed, not only rotation. Each side is then snapped to
the card's own edge in the full-resolution picture: in a narrow band around the side (the side may lean a little)
the edge must run along most of the side; when a plastic sleeve leaves a second, outer edge, the strip between them
is trimmed (flag `sleeveTrimmed`) only when it is plain and paper coloured, so printed content is never cut; a thin
dark shadow or sleeve rim at the edge is left outside the card. Orientation: the coloured header bands decide first;
only when unsure does an OCR read of both turns decide."""
from __future__ import annotations

import importlib.util
import os
import threading
import types
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

ID1 = 85.6 / 54.0
MODEL_ENV = "READER_CARDCUT_MODEL"
ARCH_ENV = "READER_CARDCUT_ARCH"  # vit_t (MobileSAM, default since 5 Nov 2026) or vit_b (Segment Anything); copied from intake-worker
MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
DEFAULT_MODELS = {"vit_t": MODELS_DIR / "mobile_sam.pt", "vit_b": MODELS_DIR / "sam_vit_b.pth"}
DEFAULT_MODEL = DEFAULT_MODELS["vit_t"]  # MobileSAM since 5 Nov 2026: the same cuts on every test sheet, cutting 11.0 -> 7.9 s per sheet
SAM_SIDE = 1024  # SAM works on a copy with this long side
GRID = 6  # first prompt grid, points per side of the sheet (36 points)
FINE_GRID = 16  # second grid, used only where print lies outside every card found
MAX_FINE = 48
BATCH = 16  # prompts per decoder call (each prompt carries its own copy of the 256x64x64 image embedding)
MIN_IOU, MIN_STABILITY = 0.75, 0.85
MIN_SHARE, MAX_SHARE = 0.012, 0.45  # a card covers this share of the sheet
RATIO_TOL = 0.2  # mask ratio may differ this much from ID-1 before the edge fit
MIN_FILL = 0.85
OUT_MIN, OUT_MAX, MAX_UPSCALE = 1000, 1200, 1.5
OUT_BAND, IN_BAND = 0.03, 0.06  # edge search outside / inside the first fit, share of the card's long side
SEGMENTS = 10  # each side is checked in this many pieces; an edge must show in most of them
BLOCKS = 40  # finer pieces (4 per segment) for the straight-line fit of each side
TILT = 0.012  # the first fit may lean this much (share of the long side, each end) against the true edge
EDGE_FLOOR = 6.0  # weakest gradient (Sobel, 0..255 picture) that counts as an edge
MAX_TRIM = 0.05  # widest sleeve strip that is trimmed, share of the long side
# Pale-tinted cards (copied from reader on 2026-11-04: a pale card margin was trimmed as if it were sleeve, cutting 1-3% off one side):
PAPER_TINT = 5.0  # a sleeve strip's colour (Lab a,b) is at most this far from the paper's
MIX_FROM = 0.012  # trimmed card this far (share) from ID-1: try keeping some sides untrimmed (was 0.04)
WALK_TILT = 0.035  # the first fit can lean about 2 degrees off the edge (a glare streak bends the mask): the walk may follow
SAME_SURFACE = 6.0  # Lab distance (8-bit) within which a further trimmed strip still counts as the same sleeve
NEAR_OUT = 0.012  # a side drawn along a split line: its edge is looked for at most this far outside it (share of the long side)


@dataclass
class CardCut:
    image: np.ndarray  # BGR, upright landscape card, tight to the physical card edge (no sleeve, no paper)
    quad: np.ndarray  # 4x2 float32, TL,TR,BR,BL of the upright card in source-image pixels
    score: float  # 0..1 confidence that this is one whole card
    flags: list[str] = field(default_factory=list)


@dataclass
class _Found:
    quad: np.ndarray  # 4x2 float32 in source pixels, picture order TL,TR,BR,BL
    score: float
    cut: list[bool]  # per side (top, right, bottom, left in picture order): runs off the scan
    near: list[bool] = field(default_factory=lambda: [False] * 4)  # per side: a line _split drew between this card and the next


# ---- the model ------------------------------------------------------------------------

_load_lock = threading.Lock()
_run_lock = threading.Lock()  # one predictor: one sheet at a time
_predictor = None


def model_path() -> Path:
    raw = os.environ.get(MODEL_ENV, "").strip()
    return Path(raw) if raw else DEFAULT_MODELS.get(arch(), DEFAULT_MODEL)


def arch() -> str:
    return os.environ.get(ARCH_ENV, "vit_t").strip() or "vit_t"


def _library() -> str:
    return "mobile_sam" if arch() == "vit_t" else "segment_anything"


def model_available() -> bool:
    """True when the model file and its libraries (torch, and segment_anything or mobile_sam) are present."""
    return model_path().is_file() and all(importlib.util.find_spec(m) is not None for m in ("torch", _library()))


def _load():
    global _predictor
    with _load_lock:
        if _predictor is None:
            import torch
            if arch() == "vit_t":  # MobileSAM (Apache-2.0): TinyViT encoder, the same prompt encoder and mask decoder as SAM
                from mobile_sam import SamPredictor, sam_model_registry
            else:
                from segment_anything import SamPredictor, sam_model_registry
            torch.set_num_threads(max(1, os.cpu_count() or 1))
            sam = sam_model_registry[arch()]()
            # weights only: the checkpoint is never unpickled as code; mmap: no second copy in memory while loading
            sam.load_state_dict(torch.load(model_path(), map_location="cpu", weights_only=True, mmap=True))
            sam.eval()
            for block in getattr(sam.image_encoder, "blocks", []) if arch() == "vit_b" else []:
                block.attn.forward = types.MethodType(_lean_attention, block.attn)
            _predictor = SamPredictor(sam)
        return _predictor


def _lean_attention(self, x):
    """SAM's own attention, computed two heads at a time in the global layers. Same numbers; the 4096x4096 attention
    map is never held for all 12 heads at once (that alone was about 2 GB at peak)."""
    from segment_anything.modeling.image_encoder import add_decomposed_rel_pos
    B, H, W, _ = x.shape
    if H * W <= 1024:  # windowed layers are small already
        return type(self).forward(self, x)
    qkv = self.qkv(x).reshape(B, H * W, 3, self.num_heads, -1).permute(2, 0, 3, 1, 4)
    q, k, v = qkv.reshape(3, B * self.num_heads, H * W, -1).unbind(0)
    out = q.new_empty(q.shape)
    for i in range(0, q.shape[0], 2):
        attn = (q[i:i + 2] * self.scale) @ k[i:i + 2].transpose(-2, -1)
        if self.use_rel_pos:
            attn = add_decomposed_rel_pos(attn, q[i:i + 2], self.rel_pos_h, self.rel_pos_w, (H, W), (H, W))
        out[i:i + 2] = attn.softmax(dim=-1) @ v[i:i + 2]
    x = out.view(B, self.num_heads, H, W, -1).permute(0, 2, 3, 1, 4).reshape(B, H, W, -1)
    return self.proj(x)


# ---- small geometry helpers -----------------------------------------------------------------

def order_corners(pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def _sides(q: np.ndarray) -> np.ndarray:
    return np.array([np.linalg.norm(q[(i + 1) % 4] - q[i]) for i in range(4)])


def _ratio(q: np.ndarray) -> float:
    s = _sides(q)
    a, b = (s[0] + s[2]) / 2, (s[1] + s[3]) / 2
    return float(max(a, b) / max(min(a, b), 1e-6))


def _intersect(l1: tuple[np.ndarray, np.ndarray], l2: tuple[np.ndarray, np.ndarray]) -> np.ndarray | None:
    """Lines as (point, direction)."""
    (p, r), (q, s) = l1, l2
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-9:
        return None
    t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
    return p + t * r


def _quad_from_lines(lines: list[tuple[np.ndarray, np.ndarray]]) -> np.ndarray | None:
    """Side lines top, right, bottom, left -> corners TL, TR, BR, BL."""
    pts = [_intersect(lines[(i - 1) % 4], lines[i]) for i in range(4)]
    if any(p is None for p in pts):
        return None
    q = np.array(pts, dtype=np.float32)
    return q if cv2.isContourConvex(q.reshape(-1, 1, 2)) else None


def _fit_line(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    vx, vy, x0, y0 = cv2.fitLine(pts.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    return np.array([x0, y0], np.float64), np.array([vx, vy], np.float64)


def _overlap(a: np.ndarray, b: np.ndarray) -> float:
    inter, _ = cv2.intersectConvexConvex(a.astype(np.float32), b.astype(np.float32))
    smaller = min(cv2.contourArea(a.astype(np.float32)), cv2.contourArea(b.astype(np.float32)))
    return float(inter / smaller) if smaller > 0 else 0.0


# ---- finding: Segment Anything -----------------------------------------------------------------

def _mask_quad(mask: np.ndarray, border: int = 1) -> tuple[np.ndarray, list[bool], float] | None:
    """Four side lines fitted to the mask outline (rounded corners left out). Returns (quad, cut sides, fill)."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(c)
    box = order_corners(cv2.boxPoints(cv2.minAreaRect(c)))
    pts = c.reshape(-1, 2).astype(np.float64)
    h, w = mask.shape[:2]
    on_border = (pts[:, 0] <= border) | (pts[:, 1] <= border) | (pts[:, 0] >= w - 1 - border) | (pts[:, 1] >= h - 1 - border)
    short = min(_sides(box))
    lines, cut = [], []
    for i in range(4):
        a, b = box[i].astype(np.float64), box[(i + 1) % 4].astype(np.float64)
        length = np.linalg.norm(b - a)
        u = (b - a) / max(length, 1e-6)
        n = np.array([-u[1], u[0]])
        t, dist = (pts - a) @ u, (pts - a) @ n
        sel = (t > 0.12 * length) & (t < 0.88 * length) & (np.abs(dist) < 0.1 * short)
        cut.append(bool(sel.sum() > 0 and on_border[sel].mean() > 0.5))
        lines.append(_fit_line(pts[sel]) if sel.sum() >= 8 else (a, u))
    quad = _quad_from_lines(lines)
    if quad is None or abs(cv2.contourArea(quad.reshape(-1, 1, 2)) / max(area, 1) - 1) > 0.15:
        quad = box
    return quad, cut, float(area / max(cv2.contourArea(box.reshape(-1, 1, 2)), 1))


def _shape_ok(ratio: float, cut: list[bool]) -> bool:
    if any(cut):
        return 1.0 <= ratio <= ID1 * 1.35  # a cut card may be shorter on either axis
    return abs(ratio - ID1) <= RATIO_TOL


def _busy(small: np.ndarray, paper: np.ndarray) -> np.ndarray:
    """Pixels that are not plain paper (print, card colour, edges), at the SAM copy's size."""
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    far = np.linalg.norm(lab - paper, axis=2) > 14
    grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    std = np.sqrt(np.maximum(cv2.blur(grey * grey, (7, 7)) - cv2.blur(grey, (7, 7)) ** 2, 0)) > 8
    return (far | std).astype(np.uint8)


def _grid(w: int, h: int, n: int) -> np.ndarray:
    g = (np.arange(n) + 0.5) / n
    return np.stack(np.meshgrid(g * w, g * h), -1).reshape(-1, 2)


def _sam_found(img: np.ndarray, max_cards: int) -> list[_Found]:
    """Prompt SAM with a coarse grid, then once more with a finer grid only where print is not yet inside a card."""
    import torch
    import torch.nn.functional as F
    h0, w0 = img.shape[:2]
    s = SAM_SIDE / max(h0, w0)
    small = cv2.resize(img, (round(w0 * s), round(h0 * s)), interpolation=cv2.INTER_AREA) if s < 1 else img.copy()
    s = small.shape[1] / w0
    h, w = small.shape[:2]
    busy = _busy(small, _paper_lab(small))
    pred = _load()
    chosen: list[tuple[float, torch.Tensor, np.ndarray]] = []  # (score, low-res logits, low-res mask)
    with _run_lock, torch.inference_mode():
        pred.set_image(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))
        model = pred.model
        hi, wi = pred.input_size
        hv, wv = (hi + 3) // 4, (wi + 3) // 4  # the picture's part of the 256x256 low-resolution masks

        def decode(pts: np.ndarray) -> None:
            if not len(pts):
                return
            coords = torch.as_tensor(pred.transform.apply_coords(pts, (h, w)), dtype=torch.float32)[:, None, :]
            labels = torch.ones((len(pts), 1), dtype=torch.int)
            lows, ious = [], []
            for i in range(0, len(pts), BATCH):
                sparse, dense = model.prompt_encoder(points=(coords[i:i + BATCH], labels[i:i + BATCH]), boxes=None, masks=None)
                low, iou = model.mask_decoder(image_embeddings=pred.features, image_pe=model.prompt_encoder.get_dense_pe(),
                                              sparse_prompt_embeddings=sparse, dense_prompt_embeddings=dense,
                                              multimask_output=True)
                lows.append(low[:, :, :hv, :wv])
                ious.append(iou)
            low, iou = torch.cat(lows).flatten(0, 1), torch.cat(ious).flatten()
            stability = (low > 1).sum((1, 2)).float() / (low > -1).sum((1, 2)).clamp(min=1).float()
            share = (low > 0).sum((1, 2)).float() / float(hv * wv)
            keep = ((iou > MIN_IOU) & (stability > MIN_STABILITY) & (share > MIN_SHARE * 0.8) & (share < MAX_SHARE)).nonzero()
            cands = []
            for k in keep.ravel().tolist():
                m = (low[k] > 0).numpy().astype(np.uint8)
                got = _mask_quad(m)
                if got is None:
                    continue
                quad, cut, fill = got
                ratio = _ratio(quad)
                if fill < MIN_FILL - 0.05 or not _shape_ok(ratio, cut):
                    continue
                shape = 0.85 if any(cut) else 1 - min(1.0, abs(ratio - ID1) / 0.6)
                cands.append((float(iou[k]) * float(stability[k]) * fill * shape, low[k].clone(), m))
            for cand in sorted(cands + chosen, key=lambda c: -c[0]):  # a mask repeating a better one is the same card
                if any(c is cand for c in chosen):
                    continue
                m = cand[2]
                if any(np.logical_and(m, o).sum() / min(m.sum(), o.sum()) > 0.3 for _, _, o in chosen):
                    continue
                chosen.append(cand)
            chosen.sort(key=lambda c: -c[0])
            del chosen[2 * max_cards + 4:]

        decode(_grid(w, h, GRID))
        covered = np.zeros((h, w), np.uint8)
        for _, _, m in chosen:
            covered |= cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
        left = cv2.erode(busy & (1 - cv2.dilate(covered, np.ones((15, 15), np.uint8))), np.ones((5, 5), np.uint8))
        if left.mean() > 0.002:  # print outside every card found so far: look there more closely
            pts = _grid(w, h, FINE_GRID)
            pts = pts[left[pts[:, 1].astype(int), pts[:, 0].astype(int)] > 0][:MAX_FINE]
            decode(pts)
        full = [(score, (F.interpolate(low[None, None], (4 * hv, 4 * wv), mode="bilinear", align_corners=False)[0, 0]
                         [:hi, :wi] > 0).numpy().astype(np.uint8)) for score, low, _ in chosen]
    found = []
    for score, m in full:
        m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST) if m.shape != (h, w) else m
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        got = _mask_quad(m)
        if got is None:
            continue
        quad, cut, fill = got
        if fill < MIN_FILL or not _shape_ok(_ratio(quad), cut):
            continue
        found.append(_Found(((quad + 0.5) / s - 0.5).astype(np.float32), score, cut))
    return found


# ---- finding: the classic finder (no model) ---------------------------------------------------------

SPLIT_ANGLES = np.radians(np.arange(-8.0, 8.5, 1.0))  # a line between two touching cards may lean this much against the island
SPLIT_SEARCH = 0.3  # each line is looked for this share of a card pitch around its even place
SPLIT_DRIFT = 0.5  # cost (in share of the island's print) of a line at the far end of its search window
SPLIT_DOUBT = frozenset({"lowContrastEdge", "ratioOff"})  # a piece of a split island with either is not kept


def _ring_paper(small: np.ndarray) -> np.ndarray | None:
    """The sheet's colour from the scan's outer ring, when the ring is plain and bright. A sheet crowded with cards leaves so
    little paper that the most common bright colour is a card's own tint (copied from intake-worker, 5 Nov 2026)."""
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    b = max(2, round(0.01 * min(lab.shape[:2])))
    ring = np.concatenate([lab[:b].reshape(-1, 3), lab[-b:].reshape(-1, 3), lab[:, :b].reshape(-1, 3), lab[:, -b:].reshape(-1, 3)])
    mid = np.median(ring, axis=0)
    if (np.linalg.norm(ring - mid, axis=1) < 10).mean() < 0.6 or mid[0] < np.percentile(lab[..., 0], 40):
        return None
    return mid


def _split(island: np.ndarray, ink: np.ndarray) -> list[tuple[np.ndarray, list]]:
    """Cards whose sleeves touch (a crowded sheet) form one island: cut it along the emptiest straight lines across it, one card
    pitch apart. Both ways a row of cards can lie (long side across or along the island) are tried; a way counts only when every
    piece comes out card shaped, and the way whose lines run through the least print wins. Returns (piece, the lines that bound
    it as (point, direction)), or [] when no way fits."""
    ys, xs = np.nonzero(island)
    if len(xs) < 100:
        return []
    (cx, cy), (rw, rh), ang = cv2.minAreaRect(np.column_stack([xs, ys]).astype(np.float32))
    a, b = max(rw, rh), min(rw, rh)
    th0 = np.radians(ang if rw >= rh else ang + 90)
    keep = slice(None, None, 4)  # every 4th pixel is plenty for the profiles
    px, py = xs[keep] - cx, ys[keep] - cy
    t = px * np.cos(th0) + py * np.sin(th0)
    s = -px * np.sin(th0) + py * np.cos(th0)
    sig = ink[ys[keep], xs[keep]].astype(np.float32)
    lo = int(np.floor(t.min())) - 2
    size = int(np.ceil(t.max() - lo + abs(s).max() * np.tan(SPLIT_ANGLES.max()))) + 4
    box = np.ones(5, np.float32) / 5
    profiles = []
    for th in SPLIT_ANGLES:
        at = np.clip(np.round(t - s * np.tan(th) - lo).astype(int), 0, size - 1)
        count = np.convolve(np.bincount(at, minlength=size).astype(np.float32), box, "same")
        hit = np.convolve(np.bincount(at, weights=sig, minlength=size).astype(np.float32), box, "same")
        profiles.append((hit, count))
    level = max(float(sig.mean()), 1e-6)
    wide = 0.5 * b / 4  # a line must cross at least half the island (counts are of every 4th pixel)
    best = None
    for pitch, across in ((b / ID1, True), (b * ID1, False)):
        k = int(round(a / pitch))
        if not 2 <= k <= 12 or abs(a / pitch - k) > 0.35 or a * b / k < MIN_SHARE * island.size:
            continue  # not a row of cards, or pieces too small to be cards (a coloured band, a line of print)
        step = a / k
        cuts, depth = [], []
        for i in range(1, k):
            want = t.min() + i * step - lo
            w0, w1 = max(0, int(want - SPLIT_SEARCH * step)), min(size, int(want + SPLIT_SEARCH * step) + 1)
            pick = None
            # a line far from its even place must run through much less print than one near it (cards lie about evenly)
            away = ((np.arange(w0, w1) - want) / (SPLIT_SEARCH * step)) ** 2 * SPLIT_DRIFT
            for th, (hit, count) in zip(SPLIT_ANGLES, profiles):
                dens = np.where(count[w0:w1] >= wide, hit[w0:w1] / np.maximum(count[w0:w1], 1e-6) / level, np.inf)
                j = int(np.argmin(dens + away))
                if np.isfinite(dens[j]) and (pick is None or dens[j] + away[j] < pick[3]):
                    pick = (float(dens[j]), float(w0 + j + lo), float(th), float(dens[j] + away[j]))
            if pick is None:
                break
            cuts.append(pick[:3])
            depth.append(1 - pick[0])
        if len(cuts) != k - 1:
            continue
        edges = [float(t.min())] + [c[1] for c in cuts] + [float(t.max())]
        lengths = np.diff(edges)
        ratios = b / np.maximum(lengths, 1e-6) if across else lengths / max(b, 1e-6)
        if np.any(np.abs(ratios - ID1) > RATIO_TOL):
            continue
        score = float(np.mean(depth))
        if best is None or score > best[0]:
            best = (score, cuts)
    if best is None:
        return []
    c, sn = np.cos(th0), np.sin(th0)
    pt, ps = (xs - cx) * c + (ys - cy) * sn, -(xs - cx) * sn + (ys - cy) * c
    label = np.zeros(len(xs), np.int32)
    lines = []
    for _, pos, th in best[1]:
        label += (pt - ps * np.tan(th)) > pos
        # the line t - s*tan(th) = pos in picture coordinates: through (pos along u) with direction n + tan(th) u
        u, n = np.array([c, sn]), np.array([-sn, c])
        d = n + np.tan(th) * u
        lines.append((np.array([cx, cy]) + pos * u, d / np.linalg.norm(d)))
    pieces = []
    for i in range(len(best[1]) + 1):
        m = np.zeros_like(island)
        m[ys[label == i], xs[label == i]] = 1
        pieces.append((m, [ln for j, ln in enumerate(lines) if j in (i - 1, i)]))
    return pieces


def _near_sides(quad: np.ndarray, lines: list) -> list[bool]:
    """Which sides of a piece's quad run along one of the lines it was cut from."""
    short = float(min(_sides(quad)))
    out = []
    for i in range(4):
        a, b = quad[i].astype(np.float64), quad[(i + 1) % 4].astype(np.float64)
        u = (b - a) / max(np.linalg.norm(b - a), 1e-6)
        mid = (a + b) / 2
        hit = False
        for p, d in lines:
            n = np.array([-d[1], d[0]])
            if abs(float(np.dot(u, d))) > np.cos(np.radians(12)) and abs(float(np.dot(mid - p, n))) < 0.15 * short:
                hit = True
        out.append(hit)
    return out


def _blob_found(img: np.ndarray) -> list[_Found]:
    """Card-shaped islands of 'not paper' on a 1024 px copy (cards lie apart on a plain sheet). An island that is not card shaped
    (cards whose sleeves touch, a full sheet of ten) is cut apart by _split."""
    h0, w0 = img.shape[:2]
    s = min(1.0, SAM_SIDE / max(h0, w0))
    small = cv2.resize(img, (round(w0 * s), round(h0 * s)), interpolation=cv2.INTER_AREA) if s < 1 else img
    s = small.shape[1] / w0
    paper = _ring_paper(small)
    ink = _busy(small, _paper_lab(small) if paper is None else paper)
    busy = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    busy = cv2.morphologyEx(busy, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(busy)
    found = []
    todo = []
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] / busy.size < MIN_SHARE:
            continue
        m = (labels == i).astype(np.uint8)
        m = cv2.drawContours(np.zeros_like(m), cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], -1, 1, -1)
        todo.append((m, 0, []))
    while todo:
        m, depth, lines = todo.pop()
        got = _mask_quad(m)
        if got is not None:
            quad, cut, fill = got
            if fill >= MIN_FILL and _shape_ok(_ratio(quad), cut) and m.sum() / m.size <= MAX_SHARE:
                # a piece of a split island ranks below the classic finder (0.4): a whole card it finds around a piece (a photo box
                # cut in two) is fitted first and the piece is then dropped as part of it
                found.append(_Found(((quad + 0.5) / s - 0.5).astype(np.float32), (0.35 if depth else 0.6) * fill, cut,
                                    _near_sides(quad, lines)))
                continue
        if depth < 2:
            todo += [(p, depth + 1, lines + more) for p, more in _split(m, ink)]
    return found


def _area(q: np.ndarray) -> float:
    return abs(float(cv2.contourArea(np.asarray(q, np.float32).reshape(-1, 1, 2))))


def _alike(a: np.ndarray, b: np.ndarray) -> bool:
    """Two outlines of about the same size (the smaller at least half the larger)."""
    x, y = _area(a), _area(b)
    return min(x, y) >= 0.5 * max(x, y, 1e-6)


def _classic_found(img: np.ndarray, max_cards: int) -> list[_Found]:
    """Without the model: card-shaped islands of print first, then the copied classic finder for what they miss."""
    from .cards import find_cards
    h, w = img.shape[:2]
    tol = 0.005 * max(h, w)
    found = _blob_found(img)
    for q in find_cards(img, max_cards):
        q = order_corners(q)
        if not _shape_ok(_ratio(q), [False] * 4):
            continue
        inside = [f for f in found if _overlap(q, f.quad) > 0.3]
        if any(_alike(q, f.quad) or _area(q) < _area(f.quad) for f in inside):
            continue  # the same card as an island, or a part of one (a photo box, a QR code)
        found = [f for f in found if not any(f is g for g in inside)]  # a whole card around pieces of it: the pieces go
        cut = []
        for i in range(4):
            a, b = q[i], q[(i + 1) % 4]
            near = [p[0] <= tol or p[1] <= tol or p[0] >= w - 1 - tol or p[1] >= h - 1 - tol for p in (a, b)]
            cut.append(all(near))
        found.append(_Found(q, 0.4, cut))
    return found


# ---- blank paper is not a card -------------------------------------------------------------------

def _printed(img: np.ndarray, quad: np.ndarray) -> bool:
    """At least three of the nine inner cells carry print (text, photo, bands); blank paper or a blank sleeve has none."""
    w, h = 270, 170
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    flat = cv2.warpPerspective(img, cv2.getPerspectiveTransform(quad.astype(np.float32), dst), (w, h), flags=cv2.INTER_AREA)
    grey = cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY)[int(0.08 * h):int(0.92 * h), int(0.08 * w):int(0.92 * w)]
    cells = [c for row in np.array_split(grey, 3, 0) for c in np.array_split(row, 3, 1)]
    return sum(float(c.std()) > 12 for c in cells) >= 3


# ---- snapping each side to the card's own edge -------------------------------------------------------

def _paper_lab(img: np.ndarray) -> np.ndarray:
    """The sheet's own colour (Lab), from a small copy: the most common bright colour."""
    small = cv2.resize(img, (256, max(1, round(256 * img.shape[0] / img.shape[1]))), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    bright = lab[lab[:, 0] >= np.percentile(lab[:, 0], 40)]
    return np.median(bright, axis=0)


def _peaks(profile: np.ndarray, floor: float) -> list[int]:
    top = float(profile.max()) if profile.size else 0.0
    limit = max(floor, 0.3 * top)
    return [i for i in range(1, len(profile) - 1)
            if profile[i] >= limit and profile[i] >= profile[i - 1] and profile[i] > profile[i + 1]]


def _inner_of_line(light: np.ndarray, pos: float, gap: int) -> float:
    """When the edge found at `pos` is a thin dark line (the card's shadow, a sleeve rim), the card starts on the
    inner side of that line: return the half-way point between the line's darkest row and the card's own level."""
    n = len(light)
    lo, hi = max(0, int(pos) - gap), min(n - 1, int(pos) + gap)
    v = lo + int(np.argmin(light[lo:hi + 1]))
    inner = light[min(n - 1, v + 3):min(n, v + 3 + gap)]
    outer = light[max(0, v - 2 - gap):max(0, v - 2)]
    if inner.size < 2 or outer.size < 2:
        return pos
    lin, lout, lv = float(np.median(inner)), float(np.median(outer)), float(light[v])
    if lv > lin - 8 or lv > lout - 8:
        return pos  # no dark line: the gradient peak is the edge
    half = (lv + lin) / 2
    for j in range(v, min(n - 1, v + gap)):
        if light[j] <= half < light[j + 1]:
            return j + (half - light[j]) / max(light[j + 1] - light[j], 1e-6)
    return pos


def _side_strip(grad: np.ndarray, colour: np.ndarray, ok: np.ndarray, reach: int):
    """Average the strip (offsets x along) into BLOCKS pieces along the side, then find the slight tilt that lines the
    strongest edge up across the pieces. Returns (grad, colour, ok) deskewed to (offsets x blocks), shift per block."""
    n = grad.shape[1]
    bounds = np.linspace(0, n, BLOCKS + 1).astype(int)
    g = np.add.reduceat(grad, bounds[:-1], axis=1) / np.diff(bounds)
    c = np.add.reduceat(colour, bounds[:-1], axis=1) / np.diff(bounds)[None, :, None]
    o = np.add.reduceat(ok.astype(np.float32), bounds[:-1], axis=1) / np.diff(bounds)
    rel = (bounds[:-1] + np.diff(bounds) / 2) / max(n, 1) - 0.5
    depth = g.shape[0] - 2 * reach
    base_rows = reach + np.arange(depth)[:, None]
    tilts = list(range(-2 * reach, 2 * reach + 1))
    # every tilt at once (the same numbers as one tilt at a time, faster: intake-worker speed, 5 Nov 2026)
    shifts = np.round(np.asarray(tilts, np.float64)[:, None] * rel[None, :]).astype(int)
    all_rows = base_rows[None] + shifts[:, None, :]
    picked = g[all_rows, np.arange(g.shape[1])[None, None, :]].reshape(len(tilts), depth, SEGMENTS, -1).mean(axis=3)
    peaks = np.percentile(picked, 30, axis=2).max(axis=1)
    best = None
    for i, t in enumerate(tilts):
        top = float(peaks[i])
        if best is None or top > best[0] + 1e-6 or (abs(top - best[0]) <= 1e-6 and abs(t) < abs(best[1])):
            best = (top, t, all_rows[i], shifts[i])
    _, _, rows, shift = best
    return (np.take_along_axis(g, rows, 0), np.take_along_axis(c, rows[..., None], 0), np.take_along_axis(o, rows, 0),
            shift, rel)


def _edge_strength(smooth: np.ndarray, ok: np.ndarray, dx: int, dy: int) -> np.ndarray:
    """The strongest absolute Sobel response over the colour channels, 0 outside the scan (the same numbers as
    np.abs(Sobel).max(axis=2) * ok, in half the time)."""
    a, b, c = cv2.split(cv2.Sobel(smooth, cv2.CV_32F, dx, dy, ksize=3))
    out = np.maximum(np.maximum(np.abs(a), np.abs(b)), np.abs(c))
    out[~ok] = 0
    return out


def _snap(img: np.ndarray, valid_src: np.ndarray, quad: np.ndarray, cut: list[bool], paper: np.ndarray,
          out_band: float, in_band: float, walk: bool, near: list[bool] | None = None) -> tuple[np.ndarray, list[bool], list[bool], list[bool]]:
    """One snapping pass. Returns (new quad, sides trimmed, sides without an edge, sides off the scan). `near`: sides drawn along
    a split line, where the next card lies just outside, so the edge is looked for at most NEAR_OUT outside the line."""
    sides = _sides(quad)
    rw, rh = (sides[0] + sides[2]) / 2, (sides[1] + sides[3]) / 2
    shrink = min(1.0, 1400 / max(rw, rh))
    rw, rh = max(40, int(round(rw * shrink))), max(30, int(round(rh * shrink)))
    long_px = max(rw, rh)
    bo, bi = max(3, int(round(out_band * long_px))), max(3, int(round(in_band * long_px)))
    reach = max(2, int(round((WALK_TILT if walk else 0.35 * TILT) * long_px)))  # how far a side may lean, each end
    m = bo + reach + 6
    dst = np.array([[m, m], [m + rw, m], [m + rw, m + rh], [m, m + rh]], np.float32)
    H = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    size = (rw + 2 * m, rh + 2 * m)
    canvas = cv2.warpPerspective(img, H, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    valid = cv2.warpPerspective(valid_src, H, size, flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)
    valid = cv2.erode(valid, np.ones((5, 5), np.uint8))
    smooth = cv2.GaussianBlur(canvas, (0, 0), 1.0 if walk else 0.6).astype(np.float32)
    gx, gy = _edge_strength(smooth, valid > 0, 1, 0), _edge_strength(smooth, valid > 0, 0, 1)
    lab = cv2.cvtColor(canvas, cv2.COLOR_BGR2LAB).astype(np.float32)
    Hinv = np.linalg.inv(H)
    offsets = np.arange(-bo, bi + 1)
    ext = np.arange(-bo - reach, bi + reach + 1)
    min_gap = max(4, int(round(0.006 * long_px)))  # both sides of a thin dark line (sleeve rim, card shadow)
    trimmed, weak, off = [False] * 4, [False] * 4, [False] * 4
    lines = []
    for side in range(4):
        horizontal = side in (0, 2)
        length = rw if horizontal else rh
        along = np.arange(m + int(0.1 * length), m + int(0.9 * length))
        base = m if side in (0, 3) else (m + (rh if side == 2 else rw))
        sign = 1 if side in (0, 3) else -1  # + offset = inwards
        idx = np.clip(base + sign * ext, 0, (size[1] if horizontal else size[0]) - 1)
        if horizontal:
            grad, colour, ok = gy[np.ix_(idx, along)], lab[np.ix_(idx, along)], valid[np.ix_(idx, along)] > 0
        else:
            grad, colour, ok = gx[np.ix_(along, idx)].T, lab[np.ix_(along, idx)].transpose(1, 0, 2), valid[np.ix_(along, idx)].T > 0
        if cut[side] or ok[bo + reach].mean() < 0.6:  # the side runs off the scan: keep the scan border line
            off[side] = True
            lines.append(None)
            continue
        if near is not None and near[side]:
            grad[ext < -NEAR_OUT * long_px] = 0
        g, colour, okb, shift, rel = _side_strip(grad, colour, ok, reach)
        per_seg = g.reshape(len(offsets), SEGMENTS, -1).mean(axis=2)
        profile = np.percentile(per_seg, 30, axis=1)
        peaks = _peaks(profile, EDGE_FLOOR)
        if not peaks:
            weak[side] = True
            lines.append(None)
            continue
        groups: list[list[int]] = []  # close peaks (a dark rim or shadow line) are one edge: its inner peak counts
        for p in peaks:
            if groups and p - groups[-1][-1] <= min_gap and p - groups[-1][0] <= 2 * min_gap:
                groups[-1].append(p)
            else:
                groups.append([p])
        edges = [gr[-1] for gr in groups]
        pick = 0
        first_strip = None  # colour of the first strip trimmed as sleeve on this side
        if walk:
            while pick + 1 < len(edges):
                a, b = edges[pick], edges[pick + 1]
                if offsets[b] - offsets[a] > MAX_TRIM * long_px:
                    break
                lo, hi = a, groups[pick + 1][0]  # the strip between the two edges: its middle, edges and shadows left out
                cut_ = max(3, (hi - lo) // 3)
                if hi - lo > 2 * cut_ + 1:
                    lo, hi = lo + cut_, hi - cut_
                strip = colour[lo:hi + 1]
                std = float(np.median(strip[..., 0].std(axis=0)))
                inner_grad = float(np.median(g[lo:hi + 1], axis=1).mean())
                light = abs(float(strip[..., 0].mean()) - paper[0])
                chroma = float(np.hypot(strip[..., 1].mean() - 128, strip[..., 2].mean() - 128))
                # a sleeve shows the paper's own tint; a pale-tinted card margin does not (copied from reader on 2026-11-04)
                tint = float(np.hypot(strip[..., 1].mean() - paper[1], strip[..., 2].mean() - paper[2]))
                if std < 7 and inner_grad < 0.4 * profile[b] and light < 22 and chroma < 10 and tint < PAPER_TINT:
                    mean_lab = strip.reshape(-1, 3).mean(0)
                    if first_strip is None:
                        first_strip = mean_lab
                    elif float(np.linalg.norm(mean_lab - first_strip)) > SAME_SURFACE:
                        break  # a further strip must be more of the same sleeve; another colour past the card edge is the
                        # card's own pale margin (its print starts at the next edge)
                    pick += 1  # plain, paper-coloured strip: a sleeve (or paper) between two edges
                    continue
                if groups[pick + 1][0] - a <= 2 * min_gap and chroma < 12:
                    pick += 1  # too narrow to judge: a sleeve rim next to the card's shadow, no coloured print
                    continue
                break
        else:  # a refining pass: the edge closest to the current line
            pick = int(np.argmin([abs(offsets[e]) for e in edges]))
        trimmed[side] = pick > 0 and offsets[edges[pick]] - offsets[edges[0]] >= min_gap
        d0 = edges[pick]
        win = max(2, int(round(0.004 * long_px)))
        lo, hi = max(0, d0 - win), min(len(offsets) - 1, d0 + win)
        xs, ds = [], []
        for k in range(g.shape[1]):
            col = g[lo:hi + 1, k]
            j = int(np.argmax(col))
            if col[j] < 0.4 * profile[d0] or okb[lo + j, k] < 0.9:
                continue
            sub = 0.0
            if 0 < j < len(col) - 1:
                den = col[j - 1] - 2 * col[j] + col[j + 1]
                sub = 0.5 * (col[j - 1] - col[j + 1]) / den if abs(den) > 1e-6 else 0.0
            pos = float(lo + j) + float(np.clip(sub, -0.5, 0.5))
            if not walk:
                pos = _inner_of_line(colour[:, k, 0], pos, min_gap)
            xs.append(float(along[0] + (rel[k] + 0.5) * len(along)))
            ds.append(float(offsets[0] + pos + shift[k]))
        if len(xs) < 4:
            xs = [float(along[0] + (r + 0.5) * len(along)) for r in rel]
            ds = [float(offsets[d0] + s_) for s_ in shift]
        pts_r = [((x, base + sign * d) if horizontal else (base + sign * d, x)) for x, d in zip(xs, ds)]
        pts_src = cv2.perspectiveTransform(np.array(pts_r, np.float32).reshape(-1, 1, 2), Hinv).reshape(-1, 2)
        lines.append(_fit_line(pts_src))
    old = [(quad[i].astype(np.float64), (quad[(i + 1) % 4] - quad[i]).astype(np.float64)) for i in range(4)]
    new = _quad_from_lines([ln if ln is not None else old[i] for i, ln in enumerate(lines)])
    return (new if new is not None else quad), trimmed, weak, off


def _choose_trims(img: np.ndarray, valid: np.ndarray, quad: np.ndarray, cut: list[bool], paper: np.ndarray, near=None):
    """First snap with sleeve trimming. Only when the trimmed card is clearly not ID-1 shaped is a mix of trimmed and
    untrimmed sides tried, and taken when it is ID-1 shaped (a white card margin is never trimmed as a sleeve)."""
    trim_q, trimmed, weak, off = _snap(img, valid, quad, cut, paper, OUT_BAND, IN_BAND, walk=True, near=near)
    if not any(trimmed) or any(off) or any(cut) or abs(_ratio(trim_q) - ID1) / ID1 <= MIX_FROM:
        return trim_q, trimmed, weak, off
    keep_q, _, _, _ = _snap(img, valid, quad, cut, paper, OUT_BAND, IN_BAND, walk=False, near=near)
    # mix per side: the trimmed side line or the untrimmed one, whichever combination is closest to ID-1
    lines_t = [(trim_q[i].astype(np.float64), (trim_q[(i + 1) % 4] - trim_q[i]).astype(np.float64)) for i in range(4)]
    lines_k = [(keep_q[i].astype(np.float64), (keep_q[(i + 1) % 4] - keep_q[i]).astype(np.float64)) for i in range(4)]
    best = (abs(_ratio(trim_q) - ID1) / ID1, trim_q, list(trimmed))
    for mask in range(16):
        use = [bool(trimmed[i] and (mask >> i) & 1) for i in range(4)]
        q = _quad_from_lines([lines_t[i] if use[i] else lines_k[i] for i in range(4)])
        if q is None:
            continue
        err = abs(_ratio(q) - ID1) / ID1
        if err < best[0]:
            best = (err, q, use)
    if best[0] > 0.015:  # no mix is ID-1 shaped either: trust the picture
        return trim_q, trimmed, weak, off
    return best[1], best[2], weak, off


def _extend_short(img: np.ndarray, valid: np.ndarray, quad: np.ndarray, cut: list[bool], paper: np.ndarray, near=None) -> np.ndarray | None:
    """Copied from reader on 2026-11-04. When the mask stopped inside a pale card margin, the edge search never reached the true
    edge and the card comes out short on one axis. Move each of the two sides that bound the short axis outward by the missing
    length and snap there; keep the move only when a real edge is found and the card becomes ID-1 shaped. None: no change."""
    s = _sides(quad)
    long_h = s[0] + s[2] > s[1] + s[3]
    long_len, short_len = ((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) if long_h else ((s[1] + s[3]) / 2, (s[0] + s[2]) / 2)
    ratio = long_len / max(short_len, 1)
    if abs(ratio - ID1) / ID1 <= MIX_FROM:
        return None
    if ratio < ID1:  # the long axis is short: one of the sides across it is too far in
        missing, candidates = ID1 * short_len - long_len, ((1, 3) if long_h else (0, 2))
    else:
        missing, candidates = long_len / ID1 - short_len, ((0, 2) if long_h else (1, 3))
    if missing > 0.06 * long_len:
        return None
    centre = quad.mean(axis=0)
    best = None
    for side in candidates:
        a, b = quad[side].astype(np.float64), quad[(side + 1) % 4].astype(np.float64)
        u = (b - a) / max(np.linalg.norm(b - a), 1e-6)
        n = np.array([-u[1], u[0]])
        if np.dot(centre - a, n) > 0:
            n = -n
        lines = [(quad[i].astype(np.float64), (quad[(i + 1) % 4] - quad[i]).astype(np.float64)) for i in range(4)]
        lines[side] = (a + n * missing, b - a)
        moved = _quad_from_lines(lines)
        if moved is None:
            continue
        snapped, _, weak, off = _snap(img, valid, moved, cut, paper, 0.012, 0.012, walk=False, near=near)
        err = abs(_ratio(snapped) - ID1) / ID1
        if weak[side] or off[side] or err > MIX_FROM:
            continue
        if best is None or err < best[0]:
            best = (err, snapped)
    return None if best is None else best[1]


# ---- output picture and orientation ---------------------------------------------------------------

def _out_size(quad: np.ndarray, cut: bool) -> tuple[int, int]:
    s = _sides(quad)  # quad is upright landscape here: s[0], s[2] are the long sides
    long_native = max((s[0] + s[2]) / 2, ID1 * (s[1] + s[3]) / 2)  # px per card length; a cut side only shrinks
    target = min(OUT_MAX, max(long_native, min(OUT_MIN, MAX_UPSCALE * long_native)))
    if not cut:
        return int(round(target)), int(round(target / ID1))
    f = target / long_native
    return max(8, int(round(f * (s[0] + s[2]) / 2))), max(8, int(round(f * (s[1] + s[3]) / 2)))


def _warp(img: np.ndarray, quad: np.ndarray, size: tuple[int, int], cut: bool) -> np.ndarray:
    """Cubic warp. A part of a cut-off card beyond the scan stays plain white (never smeared edge pixels)."""
    w, h = size
    dst = np.array([[-0.5, -0.5], [w - 0.5, -0.5], [w - 0.5, h - 0.5], [-0.5, h - 0.5]], np.float32)
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(quad.astype(np.float32), dst), (w, h),
                               flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT if cut else cv2.BORDER_REPLICATE,
                               borderValue=(255, 255, 255))


def colour_cue(card: np.ndarray) -> float:
    """> 0: the coloured header bands sit at the top (upright); < 0: at the bottom (upside down); 0..: unsure."""
    small = cv2.resize(card, (320, max(1, round(320 * card.shape[0] / card.shape[1]))), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV).astype(np.float32)
    sat = hsv[..., 1] * (hsv[..., 2] > 60)
    q = max(1, small.shape[0] // 4)
    return float(sat[:q].mean() - sat[-q:].mean()) / 255.0


_rapid = None
_rapid_lock = threading.Lock()


def _text_score(engine, img: np.ndarray) -> float:
    """How much confident text one engine reads with the picture exactly as given (no per-line turning)."""
    if getattr(engine, "name", "") == "rapidocr" and hasattr(engine, "_latin"):
        result, _ = engine._latin(img, use_cls=False)
        return float(sum(conf * len(text) for _, text, conf in result or [] if conf > 0.5))
    lines = engine.recognize(img, ["Latin"], {})
    return float(sum(ln.confidence * len(ln.text) for ln in lines if ln.confidence > 0.5))


def _default_engines() -> list:
    global _rapid
    with _rapid_lock:
        if _rapid is None:
            from .engines import rapid
            _rapid = [rapid.RapidEngine()] if rapid.available() else []
        return _rapid


def ocr_upside_down(card: np.ndarray, engines: list | None = None) -> bool | None:
    """True/False when reading both turns gives a clear winner, None when it does not (or nothing can read)."""
    small = cv2.resize(card, (800, max(1, round(800 * card.shape[0] / card.shape[1]))), interpolation=cv2.INTER_AREA)
    for engine in engines if engines is not None else _default_engines():
        osd = getattr(engine, "osd", None)
        if getattr(engine, "name", "") == "tesseract" and osd:
            got = osd(small)
            if got and got.confidence >= 0.2 and got.rotate_cw in (0, 180):
                return got.rotate_cw == 180
            continue
        try:
            up, down = _text_score(engine, small), _text_score(engine, cv2.rotate(small, cv2.ROTATE_180))
        except Exception:  # an engine failure must not stop the cutting
            continue
        if max(up, down) >= 8 and max(up, down) >= 1.3 * min(up, down):
            return down > up
    return None


# ---- the whole sheet --------------------------------------------------------------------------------

def _reading_order(cards: list[CardCut]) -> list[CardCut]:
    items = sorted(cards, key=lambda c: c.quad[:, 1].mean())
    rows: list[list[CardCut]] = []
    for c in items:
        cy, ch = c.quad[:, 1].mean(), np.ptp(c.quad[:, 1])
        if rows:
            r = rows[-1]
            ry = np.mean([x.quad[:, 1].mean() for x in r])
            rh = min(np.ptp(x.quad[:, 1]) for x in r)
            if abs(cy - ry) < 0.5 * min(ch, rh):
                r.append(c)
                continue
        rows.append([c])
    return [c for r in rows for c in sorted(r, key=lambda x: x.quad[:, 0].mean())]


def cut_cards(img: np.ndarray, max_cards: int = 12, engines: list | None = None, use_model: bool = True) -> list[CardCut]:
    """Every card on the sheet, cut to its own edge, upright, in reading order (rows top to bottom, then left to right).
    `engines` (optional, the reader's own engines) are used only when the colour test cannot tell up from down;
    without them a RapidOCR instance of this folder is used when installed. `use_model=False`: the classic finder only (the
    fast part of the job, flag `quickFinder`); the same edge fit, trims and orientation follow."""
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    base_flags: list[str] = []
    if not use_model:
        found, base_flags = _classic_found(img, max_cards), ["quickFinder"]
    elif model_available():
        try:
            found = _sam_found(img, max_cards)
        except (RuntimeError, OSError, ValueError, ImportError):  # a broken model file or library must not stop the reader
            found, base_flags = _classic_found(img, max_cards), ["fallbackFinder"]
    else:
        found, base_flags = _classic_found(img, max_cards), ["fallbackFinder"]
    h, w = img.shape[:2]
    valid = np.full((h, w), 255, np.uint8)
    paper = _paper_lab(img)
    ranked = sorted(found, key=lambda f: -f.score)
    # Each outline is fitted on its own (OpenCV and NumPy release the interpreter lock, so the cards of a sheet are fitted side by
    # side: speed, 5 Nov 2026); the outlines are then taken in the same order with the same rules as one at a time.
    if len(ranked) > 1:
        with ThreadPoolExecutor(max_workers=min(CUT_THREADS, len(ranked))) as pool:
            fitted = list(pool.map(lambda f: _fit(img, valid, paper, f), ranked))
    else:
        fitted = [_fit(img, valid, paper, f) for f in ranked]
    cards: list[CardCut] = []
    for f, fit in zip(ranked, fitted):
        if fit is None:
            continue
        quad, trimmed, weak, off, extended = fit
        if any(_overlap(quad, c.quad) > 0.5 for c in cards):
            continue
        card = _finish(img, f, quad, trimmed, weak, off, extended, base_flags, engines, (w, h))
        if card is None or (any(f.near) and SPLIT_DOUBT & set(card.flags)):
            continue  # a piece of a split island must show a card edge on every side and be card shaped (a photo box cut in two is not)
        cards.append(card)
        if len(cards) >= max_cards:
            break
    return _reading_order(cards)


CUT_THREADS = int(os.environ.get("READER_CUT_THREADS", "4"))


def _fit(img: np.ndarray, valid: np.ndarray, paper: np.ndarray, f: _Found):
    """The edge fit of one outline: (quad, trimmed, weak, off, extended), or None for blank paper."""
    if not _printed(img, f.quad):
        return None
    quad, trimmed, weak, off = _choose_trims(img, valid, f.quad, f.cut, paper, f.near)
    quad, _, weak2, _ = _snap(img, valid, quad, f.cut, paper, 0.012, 0.012, walk=False, near=f.near)
    weak = [a and b for a, b in zip(weak, weak2)]
    extended = None if any(off) or any(f.cut) else _extend_short(img, valid, quad, f.cut, paper, f.near)
    if extended is not None:
        quad = extended
    return quad, trimmed, weak, off, extended


def _finish(img: np.ndarray, f: _Found, quad: np.ndarray, trimmed, weak, off, extended, base_flags: list[str], engines,
            wh: tuple[int, int]) -> CardCut | None:
    """Shape check, flags, upright turn and the card picture of one fitted outline (None: not card shaped)."""
    w, h = wh
    outside = bool(((quad < -1.5) | (quad > np.array([w, h]) + 0.5)).any())  # a corner lies beyond the scan
    is_cut = any(off) or any(f.cut) or outside
    ratio_err = 0.0 if is_cut else abs(_ratio(quad) - ID1) / ID1
    if ratio_err > 0.15:
        return None  # after the edge fit it is not card shaped: a part of a card, or two cards together
    flags = list(base_flags)
    if is_cut:
        flags.append("cutOff")
    if any(trimmed):
        flags.append("sleeveTrimmed")
    if extended is not None:
        flags.append("sideExtended")
    if any(weak):
        flags.append("lowContrastEdge")
    # upright landscape: the long sides become top and bottom
    turn = 0
    s = _sides(quad)
    if s[1] + s[3] > s[0] + s[2]:
        quad = np.roll(quad, 1, axis=0)  # new top = old left side: the card lies turned 270 clockwise
        turn = 270
    size = _out_size(quad, is_cut)
    card = _warp(img, quad, size, is_cut)
    cue = colour_cue(card)
    flip: bool | None = cue < 0 if abs(cue) >= 0.06 else None
    if flip is None:
        flip = ocr_upside_down(card, engines)
        if flip is None:
            flags.append("orientationUnsure")
            flip = False
    if flip:
        quad = np.roll(quad, 2, axis=0)
        card = cv2.rotate(card, cv2.ROTATE_180)
        turn = (turn + 180) % 360
    if turn:
        flags.append(f"rotated{turn}")
    score = float(np.clip(f.score * (1 - 0.15 * sum(weak)) * max(0.0, 1 - 4 * ratio_err), 0, 1))
    if not is_cut and ratio_err > 0.06:
        flags.append("ratioOff")
    return CardCut(card, quad.astype(np.float32), score, flags)
