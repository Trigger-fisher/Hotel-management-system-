"""Optional ID-number masking, OFF by default. A hotel setting (`maskIdNumbers` in the job row) can switch it on later;
until then nothing is masked and the picture keeps the ID exactly as photographed.

Given OCR lines (text + box in the picture's own pixels), the first eight digits of every VALID Aadhaar number are painted
over. The picture is changed only when the switch is on."""
from __future__ import annotations

import re

import numpy as np

from .readcore import ids


def mask_aadhaar(pixels: np.ndarray, lines: list[dict]) -> tuple[np.ndarray, int]:
    out, masked = pixels.copy(), 0
    for line in lines:
        m = re.search(r"(?<!\d)(\d{4}[ -]?\d{4}[ -]?\d{4})(?!\d)", line["text"])
        if not m or not ids.aadhaar_valid(m.group(1)):
            continue
        digits_seen, end = 0, m.start(1)
        for pos in range(m.start(1), m.end(1)):
            if line["text"][pos].isdigit():
                digits_seen += 1
                if digits_seen == 8:
                    end = pos + 1
                    break
        x0, y0, x1, y1 = line["bbox"]
        width, total = x1 - x0, max(len(line["text"]), 1)
        left, right = x0 + width * m.start(1) / total, x0 + width * end / total
        out[max(0, int(y0)):int(y1) + 1, max(0, int(left)):int(right) + 1] = 0
        masked += 1
    return out, masked
