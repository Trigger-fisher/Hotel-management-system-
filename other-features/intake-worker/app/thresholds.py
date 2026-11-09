"""Every threshold of the clarity check (app/clarity.py), the photo check (app/faces.py) and the position pairing (app/people.py),
in ONE place (MJ, 4 Nov 2026).

Each one can be overridden by an environment variable of the same name (for example CLARITY_DPI_UNCLEAR=140 or
FACE_MISMATCH_BELOW=0.12). The clarity numbers were calibrated on INVENTED cards with controlled blur, glare, noise, darkness and low
resolution (scripts/calibrate_clarity.py prints the confusion table); the ranges quoted are what those invented cards measured. The
photo numbers are explained beside each one."""
from __future__ import annotations

import os

DEFAULTS: dict[str, float] = {
    # ---- clarity of one card (measured on the card scaled to 1000 px on its long side) --------------------------------------
    "CLARITY_DPI_UNCLEAR": 150,  # card printed size vs pixels in the SOURCE picture: below this the print is too coarse to read
    "CLARITY_DPI_USABLE": 200,
    # Edge steepness of the whole card (strongest gradients / contrast, in the worse direction): crisp 0.78-1.0, blur 0.7 px
    # 0.66-0.80, blur 1.5 px 0.37-0.52, blur 2.5 px 0.21-0.32, motion blur 15 px 0.14-0.25.
    "CLARITY_SHARP_UNCLEAR": 0.35,
    "CLARITY_SHARP_USABLE": 0.60,
    "CLARITY_LAPLACIAN_USABLE": 300,  # 95th-percentile tile Laplacian variance (the quality gate's measure): below = little fine detail
    # The same inside a text region (number line, name/DOB block, MRZ, QR): crisp 0.9-1.0, blur 0.7 px 0.76-0.80, 1.5 px 0.52-0.55,
    # 2.5 px 0.34-0.37.
    "CLARITY_REGION_SHARP_UNCLEAR": 0.42,
    "CLARITY_REGION_SHARP_USABLE": 0.65,
    # The portrait region (a photo has softer edges than print): crisp 0.45-0.84, blur 1.5 px 0.21-0.42, blur 2.5 px 0.15-0.27.
    "CLARITY_PHOTO_SHARP_UNCLEAR": 0.20,
    "CLARITY_PHOTO_SHARP_USABLE": 0.30,
    # Share of the card blown out to white in blobs (a QR's white is left out). A number line is about 5% of a card, so a blown-out
    # area that large can hide a whole key field even where the type (and so the layout) is unknown. Clean invented cards 0-0.03.
    "CLARITY_GLARE_CARD_UNCLEAR": 0.05,
    "CLARITY_GLARE_CARD_USABLE": 0.02,
    "CLARITY_GLARE_REGION_UNCLEAR": 0.20,  # share of one key region blown out
    "CLARITY_GLARE_REGION_USABLE": 0.06,
    "CLARITY_DARK_BELOW": 75,  # mean grey level
    "CLARITY_BRIGHT_ABOVE": 242,  # mean grey level with low contrast: washed out
    "CLARITY_CONTRAST_UNCLEAR": 70,  # 1st-99th percentile spread of grey levels
    "CLARITY_CONTRAST_USABLE": 110,
    "CLARITY_NOISE_UNCLEAR": 10,  # Immerkaer noise sigma (added noise 3 reads about 3, noise 9 about 6, noise 22 about 11-14)
    "CLARITY_NOISE_USABLE": 7,
    "CLARITY_OCR_UNCLEAR": 0.60,  # reader confidence of a key field (name, date of birth, number)
    "CLARITY_OCR_USABLE": 0.80,
    "CLARITY_INK_MIN": 0.004,  # a region with less dark print than this is empty (nothing printed there): not judged
    # JPEG quality of the ORIGINAL upload, estimated from its quantisation tables (libjpeg scale 1-100) before anything resamples
    # it (MJ, 4 Nov 2026). Invented cards saved by libjpeg read back exactly (q20 -> 20); at q12 and below the tables saturate and
    # read 13-16. Phone cameras save at 85-97, chat apps at about 70-80.
    "CLARITY_JPEG_Q_UNCLEAR": 25,  # below: "picture too compressed" (very heavily compressed)
    "CLARITY_JPEG_Q_USABLE": 45,
    # ---- pairing a front and a back by position (people.py, MJ 4 Nov 2026) -------------------------------------------------
    # Look-alike on invented cards: the base colour (Lab median of the lighter half) of one document's two sides differs by 0-5.4,
    # of two different documents by 3-23; the print style (Bhattacharyya distance of the gradient-strength histograms) 0.07-0.26
    # for one document. Both must hold, and the sizes must agree.
    "PAIR_COLOUR_DELTA_MAX": 6.0,
    "PAIR_STYLE_DISTANCE_MAX": 0.30,
    "PAIR_EDGE_RATIO_MAX": 3.0,  # share of edge pixels, the busier side over the quieter side
    "PAIR_SIZE_RATIO_MAX": 1.08,  # long side and short side, the bigger card over the smaller
    # ---- photo check (YuNet + SFace) ---------------------------------------------------------------------------------------
    "FACE_DETECT_SCORE": 0.6,  # YuNet confidence for a portrait
    # SFace paper / OpenCV default for cosine similarity: at or above this, the same person (EVIDENCE only, never proof).
    "FACE_MATCH_AT_LEAST": 0.363,
    # A CLEAR mismatch, chosen (not from the paper): far under the match line, so a genuine pair must lose more than 0.2 to be
    # called a mismatch. Printed ID portraits are small and soft; on invented faces printed 120 px tall the lowest same-person score
    # was 0.27 (0.67 at 160 px), so a same person printed badly still lands in "unclear", not "mismatch". Between the two lines: unclear.
    "FACE_MISMATCH_BELOW": 0.15,
    "FACE_MIN_PX": 40,  # face box height in SOURCE pixels (the printed portrait is about twice that): below = too small
    "FACE_SHARP_MIN": 0.15,  # edge steepness of the face crop at 112 px (clean 0.36-0.68, blur 2.5 px 0.10-0.27): below = blurred
    "FACE_GLARE_MAX": 0.15,  # share of the face blown out to white: above = glare
}


def get(name: str) -> float:
    """The threshold `name`, from the environment when set there (a bad value falls back to the default)."""
    raw = os.environ.get(name, "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return float(DEFAULTS[name])
