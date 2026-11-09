# copied from intake-worker on 2026-11-04 (without the stub cutter)
"""INVENTED people and ID-like cards laid on invented sheets, for the people/merge tests. Names, numbers and addresses are made up;
Aadhaar-like numbers get a valid Verhoeff digit so the checks can run. No real person or document is involved.

photo_sheet lays them in sleeves, turned 1-6 degrees, with glare, one touching the edge: the real cutter cuts them back out."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageDraw

from tests.cards import qr_image, secure_qr_payload
from tests.test_helpers import verhoeff_append
from tests.imaging import font

CARD = (1000, 630)
PAPER = (255, 255, 255)
FRONT_TINT, BACK_TINT = (236, 242, 250), (246, 238, 228)


@dataclass
class Guest:
    name: str
    dob: str  # dd/mm/yyyy
    gender: str
    number: str  # 12 digits, valid Verhoeff
    address: tuple[str, str]

    @property
    def spaced(self) -> str:
        return f"{self.number[:4]} {self.number[4:8]} {self.number[8:]}"


def guest(name: str, dob: str, gender: str, digits11: str, street: str, city: str) -> Guest:
    return Guest(name, dob, gender, verhoeff_append(digits11), (street, city))


GUESTS = [
    guest("Anil Mehra", "14/03/1981", "Male", "28473619205", "C/O Ravi Mehra, 12 Lake View Road", "Surat, Gujarat - 395007"),
    guest("Kavita Joshi", "02/11/1990", "Female", "35720946183", "W/O Nikhil Joshi, 44 Garden Street", "Vadodara, Gujarat - 390001"),
    guest("Suresh Patel", "21/07/1975", "Male", "46281937502", "S/O Mohan Patel, 7 Station Lane", "Anand, Gujarat - 388001"),
    guest("Meena Desai", "09/05/1988", "Female", "59302746811", "D/O Harish Desai, 3 Temple Road", "Rajkot, Gujarat - 360001"),
    guest("Farhan Qureshi", "30/12/1993", "Male", "67143829056", "S/O Imran Qureshi, 19 Market Road", "Bharuch, Gujarat - 392001"),
]


def front(g: Guest, with_number: bool = True, with_qr: bool = False, face: int | None = -1) -> Image.Image:
    """face: an INVENTED drawn face in the photo box (default: one per guest), since MJ's photo rule (5 Nov 2026) rejects a front
    without a clear photo; face=None leaves the empty grey box."""
    img = _front(g, with_number, with_qr)
    if face is None:
        return img
    from tests import faces as F
    seed = GUESTS.index(g) * 7 + 2 if face == -1 and g in GUESTS else (face if face != -1 else 2)
    return Image.fromarray(F.put_photo(np.asarray(img.convert("RGB")), F.photo(F.identity(seed), 0), (30, 160, 230, 400)))


def _front(g: Guest, with_number: bool = True, with_qr: bool = False) -> Image.Image:
    img = Image.new("RGB", CARD, FRONT_TINT)
    d = ImageDraw.Draw(img)
    seg, nir = font("segoeui.ttf", 38), font("Nirmala.ttc", 36)
    d.rectangle((0, 0, CARD[0], 70), fill=(255, 153, 51))  # coloured band
    d.text((30, 12), "Government of India", font=seg, fill=0)
    d.text((30, 85), "भारत सरकार", font=nir, fill=0)
    d.rectangle((30, 160, 230, 400), fill=(190, 196, 205), outline=(120, 120, 120), width=3)  # photo box
    d.text((270, 190), g.name, font=seg, fill=0)
    d.text((270, 250), f"DOB: {g.dob}", font=seg, fill=0)
    d.text((270, 310), g.gender, font=seg, fill=0)
    if with_number:
        d.text((280, 470), g.spaced, font=font("segoeui.ttf", 54), fill=0)
    if with_qr:
        img.paste(qr_image(secure_qr_payload(g.name, g.dob, g.number[-4:]), 200), (770, 150))
    d.rectangle((0, CARD[1] - 40, CARD[0], CARD[1]), fill=(19, 136, 8))
    return img


def back(g: Guest, with_number: bool = True, with_qr: bool = True) -> Image.Image:
    img = Image.new("RGB", CARD, BACK_TINT)
    d = ImageDraw.Draw(img)
    seg = font("segoeui.ttf", 34)
    d.rectangle((0, 0, CARD[0], 60), fill=(200, 40, 40))
    d.text((30, 10), "Unique Identification Authority of India", font=seg, fill=(255, 255, 255))
    d.text((30, 110), f"Address: {g.address[0]}", font=seg, fill=0)
    d.text((30, 165), g.address[1], font=seg, fill=0)
    if with_number:
        d.text((280, 470), g.spaced, font=font("segoeui.ttf", 54), fill=0)
    if with_qr:
        img.paste(qr_image(secure_qr_payload(g.name, g.dob, g.number[-4:]), 230), (740, 220))
    return img


def sheet(cards: list[Image.Image], columns: int = 2, gap: int = 90, margin: int = 80) -> Image.Image:
    """White paper with the cards in a grid (reading order = the list order)."""
    rows = (len(cards) + columns - 1) // columns
    w, h = CARD
    paper = Image.new("RGB", (2 * margin + columns * w + (columns - 1) * gap, 2 * margin + rows * h + (rows - 1) * gap), PAPER)
    for i, card in enumerate(cards):
        r, c = divmod(i, columns)
        paper.paste(card, (margin + c * (w + gap), margin + r * (h + gap)))
    return paper


def photo_sheet(cards: list[Image.Image], columns: int = 2, seed: int = 0) -> np.ndarray:
    """A phone-photo-like RGB sheet: off-white paper with a light gradient, each card in a clear plastic sleeve (a slightly larger
    translucent border), rotated 1-6 degrees, glare streaks, mild noise; the last card may touch the sheet edge."""
    rng = np.random.default_rng(seed)
    w, h = CARD
    pad, gap = 30, 140
    rows = (len(cards) + columns - 1) // columns
    W, H = 120 + columns * (w + gap), 120 + rows * (h + gap)
    paper = np.full((H, W, 3), (246, 244, 238), np.float32) + np.linspace(-8, 8, W, dtype=np.float32)[None, :, None]
    for i, card in enumerate(cards):
        r, c = divmod(i, columns)
        sleeve = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (225, 232, 236, 110))
        sleeve.paste(card.convert("RGBA"), (pad, pad))
        tile = sleeve.rotate(float(rng.uniform(1, 6) * rng.choice([-1, 1])), expand=True, resample=Image.BICUBIC)
        x = 60 + c * (w + gap) + int(rng.integers(0, 30))
        y = 60 + r * (h + gap) + int(rng.integers(0, 30))
        if i == len(cards) - 1:
            x = W - tile.width + 15  # touches (and leaves) the right edge
        arr = np.asarray(tile).astype(np.float32)
        alpha = arr[..., 3:] / 255.0
        y0, x0 = max(0, y), max(0, x)
        y1, x1 = min(H, y + tile.height), min(W, x + tile.width)
        part = arr[y0 - y:y1 - y, x0 - x:x1 - x]
        a = alpha[y0 - y:y1 - y, x0 - x:x1 - x]
        paper[y0:y1, x0:x1] = paper[y0:y1, x0:x1] * (1 - a) + part[..., :3] * a
    for _ in range(3):  # glare streaks
        x = int(rng.integers(0, W))
        cv2.line(paper, (x, 0), (x + 400, H), (255, 255, 255), int(rng.integers(20, 50)))
    paper = cv2.GaussianBlur(paper, (0, 0), 0.8) + rng.normal(0, 2.0, paper.shape)
    return np.clip(paper, 0, 255).astype(np.uint8)


def sleeved_sheet(cards: list[Image.Image], seed: int = 0, cut_last: bool = True) -> tuple[np.ndarray, list[np.ndarray]]:
    """A scanned A4 sheet (300 dpi, BGR) with the cards in clear sleeves (film, welded rim, translucent glare, the card's thin
    shadow), turned 1-6 degrees with mild keystone, two columns; the last card runs 8-12 percent off the right edge when
    `cut_last`. Built with tests/cardsheet.place_card. Returns the sheet and every card's true corners (TL, TR, BR, BL)."""
    from tests.cardsheet import place_card
    rng = np.random.default_rng(seed)
    ppm = 300 / 25.4
    W, H = int(210 * ppm), int(297 * ppm)
    paper = np.full((H, W, 3), 247, np.float32) + rng.normal(0, 1.2, (H, W, 1)).astype(np.float32)
    rows = (len(cards) + 1) // 2
    truths = []
    for i, card in enumerate(cards):
        r, c = divmod(i, 2)
        rgba = np.dstack([np.asarray(card.convert("RGB"))[..., ::-1], np.full(card.size[::-1], 255, np.uint8)])
        rgba = cv2.resize(rgba, (int(85.6 * ppm), int(54 * ppm)), interpolation=cv2.INTER_AREA)
        cx, cy = (c + 0.5) * W / 2, (r + 0.5) * H / max(rows, 3)
        if cut_last and i == len(cards) - 1:
            cx = W - rgba.shape[1] / 2 + float(rng.uniform(0.08, 0.12)) * rgba.shape[1]
        angle = float(rng.uniform(1, 6) * rng.choice([-1, 1]))
        sleeve = tuple(float(v) for v in rng.uniform(1.0, 3.5, 4))
        truths.append(place_card(paper, rgba, (cx, cy), 0, angle, sleeve, ppm, 0.004, rng))
    img = cv2.GaussianBlur(np.clip(paper, 0, 255).astype(np.uint8), (0, 0), 0.7)
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR), truths
