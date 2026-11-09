# copied from quality-gate on 2026-11-04
"""EVERY threshold lives here, in one table, per profile. Nothing is hard-coded anywhere else.

A rule compares one measured score with two limits: crossing `warn` makes a "warn" reason (usable, but a person
should look), crossing `reject` makes a "reject" reason. Limits can be overridden without changing code by the
environment variable INTAKE_GATE_THRESHOLDS (a JSON string or the path of a JSON file):
   {"id-card": {"blurry": {"reject_lap": 300}, "glare": {"warn": 0.01}}}
Run scripts/calibrate.py on real photos to see where good limits fall."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Rule:
    code: str
    metric: str  # key in the scores
    low_is_bad: bool  # True: a score BELOW the limit is bad; False: ABOVE
    warn: float | None
    reject: float | None
    message: str  # the plain "what to do" sentence


MESSAGES = {
    "blurry": "The photo is too blurry. Hold the phone steady and take it again.",
    "tooDark": "The photo is too dark. Move to better light and take it again.",
    "washedOut": "The photo is too bright or washed out. Avoid direct light and take it again.",
    "lowContrast": "The text does not stand out from the background. Use even light and a plain background.",
    "glare": "There is a bright reflection on the document. Tilt it slightly or move away from the light.",
    "noisy": "The photo is grainy. Use more light and take it again.",
    "blank": "The picture looks empty. Check that the document is in the frame and take it again.",
    "tooSmall": "The picture is too small. Take it again closer, or at a higher quality setting.",
    "lowResolution": "The document is too small in the picture to be read. Move closer so it fills the frame.",
    "extremeAspect": "The picture has an unusual shape. Photograph the whole document.",
    "cutOff": "Part of the document is cut off at the edge. Keep all four edges inside the frame.",
    "documentSmallInFrame": "The document fills too little of the picture. Move closer.",
    "jpegBlocking": "The picture is heavily compressed. Send the original photo, not a screenshot or a forwarded copy.",
    "lowImageDpi": "A scanned picture inside this PDF has too few pixels to be read. Scan again at 200 dpi or more.",
    "blankPage": "A page of this PDF is empty. Remove it or scan it again.",
    "cardsUnreadable": "Some cards in this photo cannot be read. Photograph the IDs in smaller groups (4 or fewer per photo).",
    "tooManyCards": "There are too many cards in one photo. Photograph the IDs in smaller groups (4 or fewer per photo).",
}


def _r(code, metric, low_is_bad, warn, reject):
    return Rule(code, metric, low_is_bad, warn, reject, MESSAGES[code])


# Blur uses two scores at once (see judge.py): reject when BOTH are low, warn when EITHER is low.
BLUR = {
    "document": {"warn_lap": 400, "warn_grad": 450, "reject_lap": 100, "reject_grad": 300},
    "id-card": {"warn_lap": 1500, "warn_grad": 700, "reject_lap": 400, "reject_grad": 500},
    "photo": {"warn_lap": 60, "warn_grad": 200, "reject_lap": 15, "reject_grad": 150},
    "generic": {"warn_lap": 250, "warn_grad": 350, "reject_lap": 60, "reject_grad": 250},
}
BLUR["multi-id"] = BLUR["id-card"]

COMMON = [
    _r("noisy", "noise", False, 8, 15),
    _r("jpegBlocking", "blockiness", False, 1.35, 1.8),
    _r("blank", "contrast", True, None, 12),
]

PROFILES: dict[str, list[Rule]] = {
    "document": COMMON + [
        _r("tooDark", "p99", True, 130, 90),
        _r("washedOut", "p1", False, 170, 200),
        _r("lowContrast", "contrast", True, 75, 40),
        _r("glare", "glare", False, 0.05, 0.15),
        _r("tooSmall", "shortSide", True, 800, 480),
        _r("lowResolution", "effectiveDpi", True, 150, 100),
        _r("extremeAspect", "aspect", False, 3.5, 5.0),
        _r("cutOff", "borderContent", False, 0.12, None),
        _r("documentSmallInFrame", "contentShare", True, 0.15, None),
    ],
    "id-card": COMMON + [
        _r("tooDark", "p99", True, 150, 110),
        _r("washedOut", "p1", False, 160, 190),
        _r("lowContrast", "contrast", True, 90, 50),
        _r("glare", "glare", False, 0.02, 0.06),
        _r("tooSmall", "shortSide", True, 600, 400),
        _r("lowResolution", "effectiveDpi", True, 250, 180),
        _r("extremeAspect", "aspect", False, 2.2, 3.5),
        _r("cutOff", "borderContent", False, 0.08, 0.2),
        _r("documentSmallInFrame", "contentShare", True, 0.25, 0.08),
    ],
    "photo": [
        _r("noisy", "noise", False, 12, 25),
        _r("jpegBlocking", "blockiness", False, 1.5, 2.2),
        _r("blank", "contrast", True, None, 12),
        _r("tooDark", "brightness", True, 75, 50),
        _r("washedOut", "brightness", False, 215, 240),
        _r("lowContrast", "contrast", True, 60, 30),
        _r("tooSmall", "shortSide", True, 600, 300),
    ],
    "generic": COMMON + [
        _r("tooDark", "p99", True, 110, 70),
        _r("washedOut", "p1", False, 180, 215),
        _r("lowContrast", "contrast", True, 60, 30),
        _r("glare", "glare", False, 0.08, None),
        _r("tooSmall", "shortSide", True, 600, 300),
    ],
}
PROFILES["multi-id"] = [r for r in PROFILES["id-card"] if r.code not in ("documentSmallInFrame", "cutOff", "extremeAspect")]

# Directional (motion) blur: sharpness across x divided by across y on the strongest edges.
MOTION_RATIO_WARN = 0.3
MOTION_RATIO_REJECT = 0.1

# Assumed long edge of the document in inches, to turn pixels into an effective dpi.
LONG_EDGE_INCHES = {"document": 11.69, "id-card": 3.37, "multi-id": 3.37}

# multi-id (several cards in one photo)
MULTI = {"max_cards": 12, "min_card_long_side_px": 600, "reject_unreadable_share": 0.5}

# PDF pages: rendered at this dpi for the checks; pages with a text layer are vector and skip blur and resolution rules.
PDF_RENDER_DPI = 150
PDF_MIN_IMAGE_DPI = {"warn": 150, "reject": 100}
PDF_MAX_PAGES = 100
PDF_ALL_BLANK_REJECTS = True


def load(profile: str) -> tuple[list[Rule], dict]:
    """Rules and blur limits for `profile`, with INTAKE_GATE_THRESHOLDS overrides applied."""
    rules = list(PROFILES[profile])
    blur = dict(BLUR.get(profile, BLUR["generic"]))
    raw = os.environ.get("INTAKE_GATE_THRESHOLDS", "").strip()
    if not raw:
        return rules, blur
    text = Path(raw).read_text(encoding="utf-8") if not raw.startswith("{") and Path(raw).exists() else raw
    over = json.loads(text).get(profile, {})
    out = []
    for rule in rules:
        patch = over.get(rule.code, {})
        out.append(Rule(rule.code, rule.metric, rule.low_is_bad, patch.get("warn", rule.warn),
                        patch.get("reject", rule.reject), rule.message))
    blur.update({k: v for k, v in over.get("blurry", {}).items() if k in blur})
    return out, blur


def profile_names() -> list[str]:
    return sorted(PROFILES)


def snapshot(profile: str) -> dict:
    """The effective limits, for the API and for calibration output."""
    rules, blur = load(profile)
    return {"blurry": blur, **{r.code: {"metric": r.metric, "warn": r.warn, "reject": r.reject} for r in rules}}
