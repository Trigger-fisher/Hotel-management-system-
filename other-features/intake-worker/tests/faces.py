"""INVENTED portrait drawings for the photo-check tests. Every face is drawn here from numbers (ellipses, lines, shading): no photo of a
real person, no face dataset and no generative model is used, so there is nothing to license. A face is defined by an `Identity` (the
shape of the face, eyes, brows, nose, mouth, skin and hair); `portrait()` draws one "photo" of it, and the nuisance arguments (a small
shift, scale, tilt, light from one side, a changed mouth) make two photos of the same invented person differ the way two ID photos do.

Honest limit: drawn faces sit close together in a face model's space (one drawing style), so different invented people score
HIGHER against each other than different real people do. The tests use them to prove the rules, and the README reports the measured
separation as what it is."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

SKIN = [(196, 224, 241), (150, 190, 226), (120, 165, 214), (96, 140, 196), (70, 110, 160), (52, 82, 128), (170, 205, 236)]  # BGR
HAIR = [(20, 20, 25), (30, 45, 70), (40, 70, 110), (150, 150, 155), (60, 90, 140), (10, 15, 40)]
STYLES = ("short", "long", "bald", "side", "bun")


@dataclass(frozen=True)
class Identity:
    seed: int
    fw: float
    fh: float
    jaw: float
    chin: float
    eye_y: float
    eye_dx: float
    eye_w: float
    eye_h: float
    iris: tuple
    brow_dy: float
    brow_t: float
    brow_arch: float
    nose_len: float
    nose_w: float
    mouth_y: float
    mouth_w: float
    lip: float
    skin: tuple
    hair: tuple
    style: str
    beard: bool
    moustache: bool
    glasses: bool
    bg: tuple


def identity(seed: int) -> Identity:
    r = np.random.default_rng(10_000 + seed)
    return Identity(
        seed=seed, fw=float(r.uniform(0.30, 0.41)), fh=float(r.uniform(0.41, 0.52)), jaw=float(r.uniform(0.62, 0.98)),
        chin=float(r.uniform(0.0, 0.05)), eye_y=float(r.uniform(0.40, 0.50)), eye_dx=float(r.uniform(0.095, 0.16)),
        eye_w=float(r.uniform(0.05, 0.085)), eye_h=float(r.uniform(0.014, 0.03)),
        iris=tuple(int(v) for v in r.integers(15, 110, 3)), brow_dy=float(r.uniform(0.04, 0.075)),
        brow_t=float(r.uniform(0.007, 0.022)), brow_arch=float(r.uniform(-0.01, 0.025)),
        nose_len=float(r.uniform(0.085, 0.16)), nose_w=float(r.uniform(0.03, 0.07)), mouth_y=float(r.uniform(0.68, 0.79)),
        mouth_w=float(r.uniform(0.06, 0.13)), lip=float(r.uniform(0.008, 0.026)),
        skin=SKIN[int(r.integers(0, len(SKIN)))], hair=HAIR[int(r.integers(0, len(HAIR)))], style=STYLES[int(r.integers(0, len(STYLES)))],
        beard=bool(r.uniform() < 0.25), moustache=bool(r.uniform() < 0.3), glasses=bool(r.uniform() < 0.2),
        bg=tuple(int(v) for v in r.integers(200, 245, 3)))


def portrait(p: Identity, size: tuple[int, int] = (300, 380), shift=(0.0, 0.0), scale: float = 1.0, tilt: float = 0.0,
             light: float = 0.0, smile: float = 0.0, seed: int = 0) -> np.ndarray:
    """One BGR photo (width, height = size) of the invented person `p`. Drawn 4x larger, then shrunk (smooth edges)."""
    W, H = size
    S = 4
    w, h = W * S, H * S
    img = np.zeros((h, w, 3), np.float32)
    img[:] = p.bg
    u = lambda v: max(1, int(round(v * h * scale)))  # noqa: E731 - a share of the picture height, scaled
    cx, cy = w / 2 + shift[0] * w, h * 0.47 + shift[1] * h
    fw2, fh2 = u(p.fw / 2), u(p.fh / 2)
    skin = np.array(p.skin, np.float32)
    shade = tuple(float(c) * 0.78 for c in p.skin)
    # shoulders and neck
    cloth = tuple(int(v) for v in np.random.default_rng(p.seed).integers(30, 170, 3))
    cv2.ellipse(img, (int(cx), int(cy + u(0.56))), (u(0.44), u(0.26)), 0, 180, 360, cloth, -1)
    cv2.rectangle(img, (int(cx - u(0.065)), int(cy + fh2 * 0.6)), (int(cx + u(0.065)), int(cy + u(0.40))), shade, -1)
    # hair behind the face
    if p.style == "long":
        cv2.rectangle(img, (int(cx - fw2 - u(0.04)), int(cy - fh2 * 0.4)), (int(cx + fw2 + u(0.04)), int(cy + u(0.30))), p.hair, -1)
    if p.style in ("short", "long", "side", "bun"):
        cv2.ellipse(img, (int(cx), int(cy - fh2 * 0.15)), (fw2 + u(0.03), fh2 + u(0.035)), 0, 180, 360, p.hair, -1)
    if p.style == "bun":
        cv2.circle(img, (int(cx), int(cy - fh2 - u(0.05))), u(0.06), p.hair, -1)
    # the face: an upper half ellipse, a narrower jaw, a chin
    face = np.zeros((h, w), np.uint8)
    cv2.ellipse(face, (int(cx), int(cy)), (fw2, fh2), 0, 180, 360, 255, -1)
    cv2.ellipse(face, (int(cx), int(cy)), (int(fw2 * p.jaw), int(fh2 * (1 + p.chin))), 0, 0, 180, 255, -1)
    cv2.ellipse(face, (int(cx), int(cy)), (fw2, int(fh2 * 0.25)), 0, 0, 360, 255, -1)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    lit = 1.02 - 0.22 * ((xx - cx + light * fw2) / (fw2 + 1)) ** 2 - 0.08 * ((yy - cy) / (fh2 + 1)) ** 2
    m = (face > 0)[..., None].astype(np.float32)
    img = img * (1 - m) + skin[None, None] * np.clip(lit, 0.62, 1.06)[..., None] * m
    for sgn in (-1, 1):  # ears
        cv2.ellipse(img, (int(cx + sgn * fw2), int(cy + u(0.015))), (u(0.022), u(0.048)), 0, 0, 360, shade, -1)
    if p.style in ("short", "side"):  # fringe
        cv2.ellipse(img, (int(cx + (u(0.05) if p.style == "side" else 0)), int(cy - fh2 * 0.62)), (fw2, int(fh2 * 0.42)),
                    -8 if p.style == "side" else 0, 180, 360, p.hair, -1)
    elif p.style in ("long", "bun"):
        cv2.ellipse(img, (int(cx), int(cy - fh2 * 0.7)), (int(fw2 * 0.98), int(fh2 * 0.33)), 0, 180, 360, p.hair, -1)
    top = cy - fh2
    ey = top + 2 * fh2 * p.eye_y
    for sgn in (-1, 1):
        ex = cx + sgn * u(p.eye_dx)
        cv2.ellipse(img, (int(ex), int(ey)), (u(p.eye_w / 2), u(p.eye_h)), 0, 0, 360, (232, 236, 240), -1)
        cv2.circle(img, (int(ex), int(ey)), u(p.eye_h * 0.95), p.iris, -1)
        cv2.circle(img, (int(ex), int(ey)), u(p.eye_h * 0.45), (12, 12, 12), -1)
        cv2.ellipse(img, (int(ex), int(ey)), (u(p.eye_w / 2), u(p.eye_h)), 0, 180, 360, (28, 28, 36), u(0.005))
        by = ey - u(p.brow_dy)
        pts = np.array([[ex - sgn * u(p.eye_w * 0.75), by + u(0.006)], [ex, by - u(p.brow_arch)],
                         [ex + sgn * u(p.eye_w * 0.75), by + u(0.01)]], np.int32)
        cv2.polylines(img, [pts], False, tuple(c * 0.8 for c in p.hair), u(p.brow_t))
        if p.glasses:
            cv2.ellipse(img, (int(ex), int(ey)), (u(p.eye_w * 0.85), u(p.eye_w * 0.6)), 0, 0, 360, (25, 25, 25), u(0.005))
    if p.glasses:
        cv2.line(img, (int(cx - u(p.eye_dx) + u(p.eye_w * 0.85)), int(ey)), (int(cx + u(p.eye_dx) - u(p.eye_w * 0.85)), int(ey)), (25, 25, 25), u(0.005))
    ny = ey + u(p.nose_len)
    dark = tuple(c * 0.66 for c in p.skin)
    cv2.line(img, (int(cx + u(0.008)), int(ey + u(0.02))), (int(cx + u(0.014)), int(ny - u(0.01))), dark, u(0.006))
    cv2.ellipse(img, (int(cx), int(ny)), (u(p.nose_w / 2), u(0.016)), 0, 0, 180, dark, u(0.008))
    for sgn in (-1, 1):
        cv2.circle(img, (int(cx + sgn * u(p.nose_w * 0.25)), int(ny)), u(0.006), (40, 40, 60), -1)
    my = top + 2 * fh2 * p.mouth_y
    lipc = (p.skin[0] * 0.55, p.skin[1] * 0.5, min(255.0, p.skin[2] * 0.85))
    cv2.ellipse(img, (int(cx), int(my)), (u(p.mouth_w / 2), u(p.lip)), 0, 0, 360, lipc, -1)
    cv2.ellipse(img, (int(cx), int(my - u(0.004 + smile))), (u(p.mouth_w / 2), u(0.004 + abs(smile))), 0, 0, 180, (40, 30, 50), u(0.004))
    if p.moustache:
        cv2.ellipse(img, (int(cx), int(my - u(p.lip + 0.012))), (u(p.mouth_w * 0.55), u(0.012)), 0, 180, 360, p.hair, -1)
    if p.beard:
        bm = np.zeros((h, w), np.uint8)
        cv2.ellipse(bm, (int(cx), int(cy + fh2 * 0.45)), (int(fw2 * p.jaw), int(fh2 * 0.62)), 0, 0, 180, 255, -1)
        bm = ((bm > 0) & (face > 0))[..., None].astype(np.float32) * 0.65
        img = img * (1 - bm) + np.array(p.hair, np.float32) * bm
    if tilt:
        rot = cv2.getRotationMatrix2D((w / 2, h / 2), tilt, 1.0)
        img = cv2.warpAffine(img, rot, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    img = cv2.GaussianBlur(img, (0, 0), 0.5) + np.random.default_rng(seed).normal(0, 2.5, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def photo(p: Identity, take: int, size: tuple[int, int] = (300, 380)) -> np.ndarray:
    """Photo number `take` of person `p`: the same face with a little shift, scale, tilt, light and smile of its own."""
    r = np.random.default_rng(1000 * p.seed + take)
    return portrait(p, size, shift=(float(r.uniform(-0.03, 0.03)), float(r.uniform(-0.03, 0.03))), scale=float(r.uniform(0.93, 1.07)),
                    tilt=float(r.uniform(-4, 4)), light=float(r.uniform(-0.5, 0.5)), smile=float(r.uniform(-0.004, 0.01)), seed=take)


def put_photo(card_rgb: np.ndarray, face_bgr: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """Paste a portrait into a card's photo box (x0, y0, x1, y1), as printed: resized to the box."""
    x0, y0, x1, y1 = box
    out = card_rgb.copy()
    out[y0:y1, x0:x1] = cv2.cvtColor(cv2.resize(face_bgr, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    return out
