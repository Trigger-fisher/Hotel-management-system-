"""INVENTED scanned sheets of ID-like cards in clear plastic sleeves, with the true card corners. Nothing here is a
real document or a real person: names, numbers and faces are drawn in code."""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageDraw

from tests.imaging import font

ID1_MM = (85.6, 54.0)
WORDS = "kumar shah patel devi singh rao mehta joshi nair iyer khan das bose gupta verma".split()
STYLES = ("aadhaar", "pan", "licence", "voter", "plain")


@dataclass
class Placed:
    corners: np.ndarray  # 4x2 float32, the physical card edge, upright card order TL,TR,BR,BL, sheet pixels
    turn: int  # 0/90/180/270: how far the card was turned clockwise on the sheet
    cut_off: bool
    sleeve_mm: tuple[float, float, float, float]  # sleeve strip beyond the card edge: top, right, bottom, left
    style: str


@dataclass
class Sheet:
    image: np.ndarray  # BGR
    dpi: int
    cards: list[Placed] = field(default_factory=list)


def _face(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], rng: np.random.Generator) -> None:
    x0, y0, x1, y1 = box
    d.rectangle(box, fill=tuple(int(v) for v in rng.integers(150, 210, 3)))
    w, h = x1 - x0, y1 - y0
    skin = (int(rng.integers(150, 210)), int(rng.integers(110, 160)), int(rng.integers(80, 120)))
    d.chord((x0 + w * 0.08, y0 + h * 0.62, x0 + w * 0.92, y0 + h * 1.38), 180, 360, fill=(40, 50, 90))
    d.ellipse((x0 + w * 0.28, y0 + h * 0.12, x0 + w * 0.72, y0 + h * 0.66), fill=skin)


def _qr(side: int, seed: int) -> Image.Image:
    import zxingcpp
    arr = np.asarray(zxingcpp.write_barcode(zxingcpp.BarcodeFormat.QRCode, f"INVENTED-{seed:06d}", width=side, height=side))
    arr = arr if arr.ndim == 2 else arr[..., 0]
    return Image.fromarray(arr).convert("RGB").resize((side, side))


def draw_card(style: str, px_per_mm: float, seed: int) -> np.ndarray:
    """One upright invented card, exactly ID-1 sized, BGR, with rounded corners (outside them is pure black)."""
    rng = np.random.default_rng(seed)
    w, h = int(round(ID1_MM[0] * px_per_mm)), int(round(ID1_MM[1] * px_per_mm))
    base = {"aadhaar": (250, 250, 246), "pan": (226, 236, 250), "licence": (236, 246, 236), "voter": (250, 238, 228),
            "plain": (250, 250, 250)}[style]
    img = Image.new("RGB", (w, h), base)
    d = ImageDraw.Draw(img)
    s = h / 54.0  # pixels per mm
    big, mid, small = font("arialbd.ttf", int(5.2 * s)), font("arial.ttf", int(3.6 * s)), font("arial.ttf", int(3.0 * s))
    name = f"{rng.choice(WORDS).title()} {rng.choice(WORDS).title()}"
    if style == "aadhaar":
        d.rectangle((0, 0, w, int(4 * s)), fill=(255, 153, 51))
        d.rectangle((0, int(4 * s), w, int(8 * s)), fill=(255, 255, 255))
        d.rectangle((0, int(8 * s), w, int(11 * s)), fill=(19, 136, 8))
        d.text((int(22 * s), int(12.5 * s)), "GOVERNMENT OF INDIA", font=big, fill=(20, 20, 20))
        d.line((int(4 * s), int(19.5 * s), w - int(4 * s), int(19.5 * s)), fill=(210, 30, 30), width=max(2, int(0.5 * s)))
        _face(d, (int(5 * s), int(22 * s), int(23 * s), int(45 * s)), rng)
        d.text((int(27 * s), int(23 * s)), name, font=mid, fill=0)
        d.text((int(27 * s), int(28 * s)), f"DOB: {rng.integers(1, 28):02d}/0{rng.integers(1, 9)}/19{rng.integers(60, 99)}", font=mid, fill=0)
        d.text((int(27 * s), int(33 * s)), "MALE", font=mid, fill=0)
        d.text((int(22 * s), int(46 * s)), " ".join(f"{rng.integers(1000, 9999)}" for _ in range(3)), font=big, fill=0)
        img.paste(_qr(int(18 * s), seed), (w - int(22 * s), int(22 * s)))
    elif style == "pan":
        d.rectangle((0, 0, w, int(10 * s)), fill=(40, 70, 160))
        d.text((int(5 * s), int(2 * s)), "INCOME TAX DEPARTMENT", font=big, fill=(255, 255, 255))
        d.text((int(5 * s), int(13 * s)), "PERMANENT ACCOUNT NUMBER", font=small, fill=0)
        d.text((int(5 * s), int(17 * s)), f"ABCPE{rng.integers(1000, 9999)}F", font=big, fill=0)
        d.text((int(5 * s), int(26 * s)), name.upper(), font=mid, fill=0)
        d.text((int(5 * s), int(31 * s)), f"{rng.integers(1, 28):02d}/0{rng.integers(1, 9)}/19{rng.integers(60, 99)}", font=mid, fill=0)
        _face(d, (int(6 * s), int(36 * s), int(20 * s), int(51 * s)), rng)
        img.paste(_qr(int(15 * s), seed), (w - int(20 * s), int(34 * s)))
    elif style == "licence":
        d.rectangle((0, 0, w, int(9 * s)), fill=(180, 40, 40))
        d.text((int(20 * s), int(1.5 * s)), "DRIVING LICENCE", font=big, fill=(255, 255, 255))
        _face(d, (w - int(24 * s), int(13 * s), w - int(5 * s), int(37 * s)), rng)
        for i, t in enumerate((f"DL No MH{rng.integers(10, 99)} {rng.integers(10**10, 10**11)}", f"Name {name}",
                               "Valid till 2040", "Class LMV MCWG")):
            d.text((int(5 * s), int((13 + i * 6) * s)), t, font=mid, fill=0)
        d.rectangle((int(5 * s), int(42 * s), int(55 * s), int(49 * s)), fill=(200, 200, 230))
    elif style == "voter":
        d.rectangle((0, 0, w, int(8 * s)), fill=(120, 60, 140))
        d.text((int(5 * s), int(1.2 * s)), "ELECTION COMMISSION OF INDIA", font=mid, fill=(255, 255, 255))
        _face(d, (int(5 * s), int(14 * s), int(23 * s), int(38 * s)), rng)
        d.text((int(27 * s), int(14 * s)), f"ABC{rng.integers(10**6, 10**7)}", font=big, fill=0)
        d.text((int(27 * s), int(22 * s)), f"Elector {name}", font=mid, fill=0)
        d.text((int(27 * s), int(28 * s)), "Sex M  Age 40", font=mid, fill=0)
        d.text((int(5 * s), int(44 * s)), "Address: Invented Street, Surat", font=small, fill=0)
    else:  # text only, no bands and no photo: orientation must come from reading
        for i in range(6):
            d.text((int(5 * s), int((5 + i * 7.5) * s)), " ".join(rng.choice(WORDS, 3)).upper() + f" {rng.integers(10, 999)}",
                   font=mid, fill=0)
    arr = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)
    alpha = np.zeros((h, w), np.uint8)
    r = int(round(3.18 * s))
    cv2.rectangle(alpha, (r, 0), (w - 1 - r, h - 1), 255, -1)
    cv2.rectangle(alpha, (0, r), (w - 1, h - 1 - r), 255, -1)
    for cx, cy in ((r, r), (w - 1 - r, r), (r, h - 1 - r), (w - 1 - r, h - 1 - r)):
        cv2.circle(alpha, (cx, cy), r, 255, -1, cv2.LINE_AA)
    return np.dstack([arr, alpha])


def _paste(sheet: np.ndarray, layer: np.ndarray, alpha: np.ndarray, matrix: np.ndarray) -> None:
    """Blend a warped layer onto the sheet in place. `alpha` is 0..1 in the layer's own pixels."""
    h, w = sheet.shape[:2]
    lh, lw = layer.shape[:2]
    box = cv2.perspectiveTransform(np.array([[[0, 0]], [[lw, 0]], [[lw, lh]], [[0, lh]]], np.float32), matrix).reshape(4, 2)
    x0, y0 = np.clip(np.floor(box.min(0)).astype(int) - 2, 0, [w, h])
    x1, y1 = np.clip(np.ceil(box.max(0)).astype(int) + 2, 0, [w, h])
    if x1 <= x0 or y1 <= y0:
        return
    shift = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]], np.float64) @ matrix
    warped = cv2.warpPerspective(layer.astype(np.float32), shift, (x1 - x0, y1 - y0), flags=cv2.INTER_CUBIC)
    a = cv2.warpPerspective(alpha.astype(np.float32), shift, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR)[..., None]
    roi = sheet[y0:y1, x0:x1]
    roi[:] = roi * (1 - a) + warped * a


def place_card(sheet: np.ndarray, card_rgba: np.ndarray, centre: tuple[float, float], turn: int, angle: float,
               sleeve_mm: tuple[float, float, float, float] | None, px_per_mm: float, keystone: float,
               rng: np.random.Generator) -> np.ndarray:
    """Put one card (in a sleeve when `sleeve_mm` is given) on the float sheet. Returns its true corners."""
    ch, cw = card_rgba.shape[:2]
    card = card_rgba[..., :3].astype(np.float32)
    alpha = card_rgba[..., 3].astype(np.float32) / 255.0
    top, right, bottom, left = (max(3, int(round(m * px_per_mm))) for m in (sleeve_mm or (0, 0, 0, 0)))
    pw, ph = cw + left + right, ch + top + bottom
    # the whole sleeve package in its own upright frame: sleeve film, then the card under the film
    layer = np.zeros((ph, pw, 3), np.float32)
    lalpha = np.zeros((ph, pw), np.float32)
    layer[top:top + ch, left:left + cw] = card
    lalpha[top:top + ch, left:left + cw] = alpha
    # the card's thickness throws a thin, uneven shadow just outside its edge (a scanner lamp lights from one side)
    inside = (lalpha > 0.5).astype(np.uint8)
    ring = (cv2.dilate(inside, np.ones((5, 5), np.uint8)) > 0) & (inside == 0)
    strength = float(rng.uniform(0.15, 0.5))
    shade = np.full((ph, pw, 3), 247.0 * (1 - strength), np.float32)
    layer[ring] = shade[ring]
    lalpha[ring] = 1.0
    if sleeve_mm:
        film = np.zeros((ph, pw), np.float32)
        cv2.rectangle(film, (0, 0), (pw - 1, ph - 1), 1.0, -1)
        tint = np.array([232, 236, 238], np.float32)  # a cool grey film over white paper
        on_card = lalpha[..., None]
        layer = layer * on_card * 0.94 + tint * (1 - on_card)  # film darkens the card a little, tints the paper
        rim = max(2, int(0.25 * px_per_mm))
        cv2.rectangle(layer, (0, 0), (pw - 1, ph - 1), (205, 210, 214), rim)  # the welded sleeve rim
        for _ in range(int(rng.integers(1, 3))):  # glare streaks across film and card
            x = float(rng.uniform(0.1, 0.9) * pw)
            streak = np.zeros((ph, pw), np.float32)
            pts = np.array([[x, 0], [x + 0.06 * pw, 0], [x + 0.06 * pw - 0.3 * ph, ph], [x - 0.3 * ph, ph]], np.int32)
            cv2.fillConvexPoly(streak, pts, 1.0)
            streak = cv2.GaussianBlur(streak, (0, 0), 0.02 * pw) * float(rng.uniform(0.25, 0.45))
            layer = layer * (1 - streak[..., None]) + 255 * streak[..., None]
        lalpha = np.maximum(lalpha, film)  # the film over plain paper is drawn as its tinted colour
    # rotate by the quarter turn plus a small angle and a mild keystone, around `centre`
    corners_local = np.array([[left, top], [left + cw, top], [left + cw, top + ch], [left, top + ch]], np.float32)
    frame = np.array([[0, 0], [pw, 0], [pw, ph], [0, ph]], np.float32)
    theta = np.radians(turn + angle)
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], np.float32)
    dst = (frame - [pw / 2, ph / 2]) @ rot.T + centre
    jitter = rng.uniform(-keystone, keystone, (4, 2)).astype(np.float32) * cw
    dst = (dst + jitter).astype(np.float32)
    matrix = cv2.getPerspectiveTransform(frame, dst)
    _paste(sheet, layer, lalpha, matrix)
    truth = cv2.perspectiveTransform(corners_local.reshape(-1, 1, 2), matrix).reshape(4, 2)
    return truth.astype(np.float32)


def make_sheet(n_cards: int, seed: int = 0, dpi: int = 300, size_mm: tuple[float, float] = (210, 297),
               sleeves: bool = True, turns: tuple[int, ...] = (0,), cut_off: int = 0, styles: tuple[str, ...] = STYLES,
               max_angle: float = 6.0, keystone: float = 0.004, gap_mm: float = 8.0) -> Sheet:
    """A white sheet with `n_cards` invented cards on a grid (two columns, or three when needed), each slightly turned.
    `cut_off` cards (the last ones in the outer columns) are pushed past the sheet edge by 8-15 percent."""
    rng = np.random.default_rng(seed)
    ppm = dpi / 25.4
    W, H = int(size_mm[0] * ppm), int(size_mm[1] * ppm)
    paper = np.full((H, W, 3), 247, np.float32) + rng.normal(0, 1.2, (H, W, 1)).astype(np.float32)
    cols = 1 if n_cards == 1 else 2 if n_cards <= 10 else 3
    rows = max(1, int(np.ceil(n_cards / cols)))
    cell_w, cell_h = W / cols, H / rows
    cards: list[Placed] = []
    edge_cells = [i for i in range(n_cards) if i % cols in (0, cols - 1)]  # only the outer columns can run off
    cut_set = set(edge_cells[len(edge_cells) - cut_off:]) if cut_off else set()
    for i in range(n_cards):
        r, c = divmod(i, cols)
        style = styles[(i + seed) % len(styles)]
        turn = int(turns[(i + seed) % len(turns)])
        angle = float(rng.uniform(1, max_angle) * rng.choice([-1, 1]))
        sleeve = tuple(float(v) for v in rng.uniform(0.5, 3.5, 4)) if sleeves else None
        cx = (c + 0.5) * cell_w + rng.uniform(-0.04, 0.04) * cell_w
        cy = (r + 0.5) * cell_h + rng.uniform(-0.04, 0.04) * cell_h
        is_cut = i in cut_set
        if is_cut:  # move it so a slice of the card runs off the left or right sheet edge
            card_w = ID1_MM[0] * ppm if turn in (0, 180) else ID1_MM[1] * ppm
            off = float(rng.uniform(0.08, 0.15)) * card_w
            cx = (card_w / 2 - off) if c == 0 else (W - card_w / 2 + off)
        truth = place_card(paper, draw_card(style, ppm, seed * 100 + i), (cx, cy), turn, angle, sleeve, ppm, keystone, rng)
        for other in cards:  # a layout where cards lie on each other is a broken test, not a hard sheet
            inter, _ = cv2.intersectConvexConvex(truth, other.corners)
            if inter > 0:
                raise ValueError("cards overlap: use fewer cards, fewer quarter turns or a larger sheet")
        off_sheet = bool(((truth < 0) | (truth > np.array([W - 1, H - 1]))).any())  # tight layouts can touch the edge too
        cards.append(Placed(truth, turn, is_cut or off_sheet, sleeve or (0, 0, 0, 0), style))
    img = cv2.GaussianBlur(np.clip(paper, 0, 255).astype(np.uint8), (0, 0), 0.7)
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])  # a scanner's JPEG
    return Sheet(cv2.imdecode(enc, cv2.IMREAD_COLOR), dpi, cards)
