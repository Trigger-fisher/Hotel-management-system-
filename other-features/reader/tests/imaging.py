"""Invented test pictures. Fonts come from C:\\Windows\\Fonts when present; nothing here is a real document."""
from __future__ import annotations

import io
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONTS = Path(r"C:\Windows\Fonts")
WORDS = ("invoice room guest arrival departure total amount balance paid reception breakfast tax service "
         "deposit receipt number date name address city country signature").split()


def font(name: str, size: int):
    path = FONTS / name
    return ImageFont.truetype(str(path), size) if path.exists() else None


def have_fonts(*names: str) -> bool:
    return all((FONTS / n).exists() for n in names)


def text_page(lines: list[str], size=(900, 1200), font_name="segoeui.ttf", font_size=38, step=None,
              bg=255, fg=0) -> Image.Image:
    f = font(font_name, font_size) or ImageFont.load_default(size=font_size)
    img = Image.new("L", size, bg)
    d = ImageDraw.Draw(img)
    step = step or int(font_size * 1.9)
    for i, line in enumerate(lines):
        d.text((50, 60 + i * step), line, font=f, fill=fg)
    return img


def random_lines(seed: int, count: int = 14, words_per_line: int = 4) -> list[str]:
    rng = np.random.default_rng(seed)
    return [" ".join(rng.choice(WORDS, words_per_line)) + f" {rng.integers(10, 9999)}" for _ in range(count)]


def to_bgr(img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2BGR)


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# ---- degradations ---------------------------------------------------------------------

def blur(arr: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(arr, (0, 0), sigma)


def noise(arr: np.ndarray, sigma: float, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return np.clip(arr.astype(np.float32) + rng.normal(0, sigma, arr.shape), 0, 255).astype(np.uint8)


def low_contrast(arr: np.ndarray, factor: float = 0.25) -> np.ndarray:
    return (128 + (arr.astype(np.float32) - 128) * factor).astype(np.uint8)


def darken(arr: np.ndarray, factor: float = 0.35) -> np.ndarray:
    return (arr.astype(np.float32) * factor).astype(np.uint8)


def shrink(arr: np.ndarray, factor: float) -> np.ndarray:
    return cv2.resize(arr, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)


def rotate_free(arr: np.ndarray, degrees: float) -> np.ndarray:
    h, w = arr.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(arr, m, (nw, nh), flags=cv2.INTER_CUBIC, borderValue=255)


def turn(arr: np.ndarray, quarter_turns_cw: int) -> np.ndarray:
    return np.rot90(arr, k=-quarter_turns_cw).copy()


# ---- a document photographed on a table --------------------------------------------------

def scene(page: np.ndarray, frame=(1000, 1400), scale=0.7, angle=0.0, tilt=0.0, seed=0, clutter=True,
          bg_colour=(70, 110, 160), centre=None, noise_sigma=3.0) -> tuple[np.ndarray, np.ndarray]:
    """Put `page` (grey, any size) on a coloured, cluttered background, rotated by `angle` degrees and
    tilted in perspective. Returns (BGR photo, true corners tl,tr,br,bl in the photo)."""
    rng = np.random.default_rng(seed)
    fh, fw = frame
    bg = np.full((fh, fw, 3), bg_colour, np.uint8)
    # a soft gradient and some table-like texture
    gradient = np.linspace(-25, 25, fw, dtype=np.float32)[None, :, None]
    bg = np.clip(bg.astype(np.float32) + gradient, 0, 255).astype(np.uint8)
    if clutter:
        for _ in range(12):
            colour = tuple(int(c) for c in rng.integers(40, 200, 3))
            p1 = (int(rng.integers(0, fw)), int(rng.integers(0, fh)))
            p2 = (int(rng.integers(0, fw)), int(rng.integers(0, fh)))
            cv2.line(bg, p1, p2, colour, int(rng.integers(2, 6)))
        for _ in range(5):
            cv2.circle(bg, (int(rng.integers(0, fw)), int(rng.integers(0, fh))), int(rng.integers(15, 60)),
                       tuple(int(c) for c in rng.integers(40, 200, 3)), -1)
    ph, pw = page.shape[:2]
    s = min(fw * scale / pw, fh * scale / ph)
    w, h = pw * s, ph * s
    cx, cy = centre if centre else (fw / 2, fh / 2)
    local = np.array([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], np.float32)
    local[:, 0] *= 1 + tilt * np.array([-1, -1, 1, 1]) * 0.5  # keystone: one side looks smaller
    theta = np.radians(angle)
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], np.float32)
    corners = (local @ rot.T + [cx, cy]).astype(np.float32)
    src = np.array([[0, 0], [pw - 1, 0], [pw - 1, ph - 1], [0, ph - 1]], np.float32)
    matrix = cv2.getPerspectiveTransform(src, corners)
    page_bgr = cv2.cvtColor(page, cv2.COLOR_GRAY2BGR) if page.ndim == 2 else page
    warped = cv2.warpPerspective(page_bgr, matrix, (fw, fh), flags=cv2.INTER_CUBIC, borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.full((ph, pw), 255, np.uint8), matrix, (fw, fh), flags=cv2.INTER_LINEAR)
    photo = np.where(mask[..., None] > 127, warped, bg)
    photo = noise(photo, noise_sigma, seed)
    return photo, corners


def corner_error(found: np.ndarray, truth: np.ndarray) -> float:
    """Mean distance between matching corners, as a share of the photo diagonal (corners compared as sets)."""
    from app.geometry import order_corners
    a, b = order_corners(found), order_corners(truth)
    best = min(float(np.linalg.norm(np.roll(a, k, axis=0) - b, axis=1).mean()) for k in range(4))
    return best


def ssim_gray(a: np.ndarray, b: np.ndarray) -> float:
    """A small SSIM on grey images of equal size (no scikit-image in this service)."""
    a, b = a.astype(np.float64), b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    blur_ = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)  # noqa: E731
    mu_a, mu_b = blur_(a), blur_(b)
    var_a, var_b = blur_(a * a) - mu_a ** 2, blur_(b * b) - mu_b ** 2
    cov = blur_(a * b) - mu_a * mu_b
    s = ((2 * mu_a * mu_b + c1) * (2 * cov + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (var_a + var_b + c2))
    return float(s.mean())
