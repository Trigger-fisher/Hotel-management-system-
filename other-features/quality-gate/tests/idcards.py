"""INVENTED ID-card pictures for the gate's portrait, compression and calibration tests. Nothing here is a real document: the card
layout, the words and the numbers are made up, and the portrait is a drawing from tests/faces.py (numbers only, no photo of a person).
A card is ID-1 shaped (85.6 x 54 mm) drawn at 300 dpi: 1012 x 638 pixels, BGR."""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageDraw

from tests import faces as F
from tests.imaging import font, noise

CARD = (1012, 638)  # width, height
PHOTO_BOX = (40, 150, 260, 430)  # x0, y0, x1, y1 on the card
TINTS = [(236, 242, 250), (244, 236, 230), (230, 244, 236), (240, 240, 226), (248, 238, 246)]  # BGR, pale


def card(seed: int, with_photo: bool = True) -> np.ndarray:
    """One invented card (BGR): a pale tinted base with a fine pattern, a coloured header band, the portrait box on the left and
    invented name / date / number lines on the right."""
    rng = np.random.default_rng(500 + seed)
    w, h = CARD
    tint = TINTS[seed % len(TINTS)]
    img = np.zeros((h, w, 3), np.float32)
    img[:] = tint
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img -= (4 * np.sin(xx / 9.0 + yy / 23.0) + 3 * np.sin(yy / 7.0))[..., None]  # guilloche-like pattern
    band = tuple(int(v) for v in rng.integers(60, 160, 3))
    img[:110] = band
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)[..., ::-1])
    d = ImageDraw.Draw(pil)
    big, mid = font("arialbd.ttf", 44), font("arial.ttf", 34)
    d.text((40, 30), "GUEST IDENTITY CARD", font=big, fill=(255, 255, 255))
    names = ["ANNA RIVERS", "RAVI MEHRA", "LINA DSOUZA", "OMAR KHAN", "PRIYA NAIR", "TOMAS LEE"]
    d.text((300, 160), "Name", font=mid, fill=(90, 90, 90))
    d.text((300, 200), names[seed % len(names)], font=big, fill=(10, 10, 10))
    d.text((300, 270), "Date of birth", font=mid, fill=(90, 90, 90))
    d.text((300, 310), f"{1 + seed % 28:02d}/{1 + seed % 12:02d}/19{60 + seed % 40}", font=big, fill=(10, 10, 10))
    d.text((300, 380), "Sex  F" if seed % 2 else "Sex  M", font=mid, fill=(20, 20, 20))
    d.text((150, 520), " ".join(f"{int(v):04d}" for v in rng.integers(1000, 9999, 3)), font=font("arialbd.ttf", 56), fill=(0, 0, 0))
    out = np.asarray(pil)[..., ::-1].copy()
    if with_photo:
        x0, y0, x1, y1 = PHOTO_BOX
        face = F.photo(F.identity(seed), 0, size=(x1 - x0, y1 - y0))
        out[y0:y1, x0:x1] = face
    return out


def on_table(card_bgr: np.ndarray, frame=(1500, 2000), scale=0.62, seed=0, angle=None) -> np.ndarray:
    """The card photographed on a wooden-looking table: a little rotated, mild camera noise. Returns the BGR photo."""
    rng = np.random.default_rng(seed)
    fh, fw = frame
    table = np.zeros((fh, fw, 3), np.float32)
    table[:] = (60, 95, 140)
    xx = np.arange(fw, dtype=np.float32)
    table += (10 * np.sin(xx / 37.0) + 6 * np.sin(xx / 11.0))[None, :, None]
    table += np.linspace(-20, 20, fh, dtype=np.float32)[:, None, None]
    ch, cw = card_bgr.shape[:2]
    s = min(fw * scale / cw, fh * scale / ch)
    a = float(rng.uniform(-6, 6)) if angle is None else angle
    m = cv2.getRotationMatrix2D((cw / 2, ch / 2), a, s)
    m[0, 2] += fw / 2 - cw / 2
    m[1, 2] += fh / 2 - ch / 2
    warped = cv2.warpAffine(card_bgr, m, (fw, fh), flags=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    mask = cv2.warpAffine(np.full((ch, cw), 255, np.uint8), m, (fw, fh))
    photo = np.where(mask[..., None] > 127, warped.astype(np.float32), table)
    return noise(np.clip(photo, 0, 255).astype(np.uint8), 2.0, seed)


# ---- damage confined to the portrait ------------------------------------------------------------------------------------------

def blur_photo(card_bgr: np.ndarray, sigma: float) -> np.ndarray:
    x0, y0, x1, y1 = PHOTO_BOX
    out = card_bgr.copy()
    out[y0:y1, x0:x1] = cv2.GaussianBlur(out[y0:y1, x0:x1], (0, 0), sigma)
    return out


def glare_photo(card_bgr: np.ndarray, strength: float = 1.4) -> np.ndarray:
    """A lamp's reflection over the portrait: blown out to white in the middle, fading at the rim."""
    x0, y0, x1, y1 = PHOTO_BOX
    h, w = card_bgr.shape[:2]
    mask = np.zeros((h, w), np.float32)
    cv2.ellipse(mask, ((x0 + x1) // 2, (y0 + y1) // 2 - 20), ((x1 - x0) // 2, (y1 - y0) // 3), 0, 0, 360, 1.0, -1)
    mask = np.clip(cv2.GaussianBlur(mask, (0, 0), 10) * strength, 0, 1)[..., None]
    return np.clip(card_bgr * (1 - mask) + 255 * mask, 0, 255).astype(np.uint8)


def glare_ellipse(img: np.ndarray, box: tuple[float, float, float, float], strength: float = 1.3) -> np.ndarray:
    """A reflection over the box given as shares of the picture (x0, y0, x1, y1)."""
    h, w = img.shape[:2]
    mask = np.zeros((h, w), np.float32)
    cx, cy = int((box[0] + box[2]) / 2 * w), int((box[1] + box[3]) / 2 * h)
    cv2.ellipse(mask, (cx, cy), (max(4, int((box[2] - box[0]) / 2 * w)), max(4, int((box[3] - box[1]) / 2 * h))), 0, 0, 360, 1.0, -1)
    mask = np.clip(cv2.GaussianBlur(mask, (0, 0), 8) * strength, 0, 1)[..., None]
    return np.clip(img * (1 - mask) + 255 * mask, 0, 255).astype(np.uint8)
