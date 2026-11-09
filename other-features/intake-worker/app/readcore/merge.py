# copied from reader on 2026-11-04
"""Combine readings made with different script models into one list in reading order (RTL aware)."""
from __future__ import annotations

import statistics

from .engines.base import OcrLine
from .scripts import dominant_script, is_rtl

MIN_SCRIPT_SHARE = 0.6  # a line counts as a script's own when this share of its letters belong to it


def label(line: OcrLine) -> OcrLine:
    """Name the line's script from its letters (not from the model that read it)."""
    script, share = dominant_script(line.text)
    line.script = script if script and share >= MIN_SCRIPT_SHARE else (script or "Common")
    return line


def _overlap(a: OcrLine, b: OcrLine) -> float:
    """Intersection over the smaller box: 1.0 when one line sits inside the other."""
    ax0, ay0, ax1, ay1 = a.bbox
    bx0, by0, bx1, by1 = b.bbox
    w, h = min(ax1, bx1) - max(ax0, bx0), min(ay1, by1) - max(ay0, by0)
    if w <= 0 or h <= 0:
        return 0.0
    smaller = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
    return w * h / smaller if smaller > 0 else 0.0


def merge_readings(readings: dict[str, list[OcrLine]]) -> list[OcrLine]:
    """`readings` maps the script model used -> its lines. Keep, for every place on the page,
    the most confident line whose own letters really belong to a script the model supports."""
    candidates: list[OcrLine] = []
    for model_script, lines in readings.items():
        for line in lines:
            own = label(line).script
            if own in (model_script, "Common"):
                candidates.append(line)
            elif own == "Latin" and line.confidence >= 0.7:
                candidates.append(line)  # English words next to another script (the model includes English)
            # anything else is a model inventing letters of its own script from marks it cannot read: dropped
    kept: list[OcrLine] = []
    for line in sorted(candidates, key=lambda l: l.confidence, reverse=True):
        if all(_overlap(line, k) < 0.5 for k in kept):
            kept.append(line)
    return kept


def reading_order(lines: list[OcrLine]) -> list[OcrLine]:
    """Rows from top to bottom; inside a row left to right, or right to left when the row is mostly RTL."""
    if not lines:
        return []
    height = statistics.median(max(1.0, l.bbox[3] - l.bbox[1]) for l in lines)
    rows: list[list[OcrLine]] = []
    for line in sorted(lines, key=lambda l: (l.bbox[1] + l.bbox[3]) / 2):
        centre = (line.bbox[1] + line.bbox[3]) / 2
        if rows and abs(centre - statistics.mean((l.bbox[1] + l.bbox[3]) / 2 for l in rows[-1])) < 0.6 * height:
            rows[-1].append(line)
        else:
            rows.append([line])
    ordered: list[OcrLine] = []
    for row in rows:
        rtl = sum(1 for l in row if is_rtl(l.script)) * 2 > len(row)
        ordered += sorted(row, key=lambda l: -l.bbox[2] if rtl else l.bbox[0])
    return ordered


def full_text(lines: list[OcrLine]) -> str:
    """One text line per row of the page."""
    if not lines:
        return ""
    height = statistics.median(max(1.0, l.bbox[3] - l.bbox[1]) for l in lines)
    out, last = [], None
    for line in lines:
        centre = (line.bbox[1] + line.bbox[3]) / 2
        if last is not None and abs(centre - last) < 0.6 * height:
            out[-1] += "  " + line.text
        else:
            out.append(line.text)
        last = centre
    return "\n".join(out)
