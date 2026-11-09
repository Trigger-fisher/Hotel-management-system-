"""All quality thresholds and mode settings live here and nowhere else."""
from __future__ import annotations

from dataclasses import dataclass, replace

from .errors import CompressorError


@dataclass(frozen=True)
class Mode:
    name: str
    ssim_min: float  # luminance SSIM the result must reach (1.0 = exact)
    pdf_dpi_cap: int | None  # images in PDFs above this DPI are downsampled
    max_side: int | None  # longest side allowed for plain images (None = keep)
    lossless: bool = False
    allow_palette_png: bool = False  # 256-colour PNG, gated by ssim_min
    allow_ghostscript: bool = False  # scanned-PDF path, never in strict
    gs_qfactor: float = 0.4  # Ghostscript JPEG QFactor, lower = better


MODES: dict[str, Mode] = {
    "balanced": Mode("balanced", 0.985, 200, None, allow_ghostscript=True),
    # strict: digits, IDs, bills, legal text. Higher bar, no lossy JBIG2, no Ghostscript.
    "strict": Mode("strict", 0.995, 300, None),
    "max": Mode("max", 0.97, 150, 3840, allow_palette_png=True,
                allow_ghostscript=True, gs_qfactor=0.6),
    "lossless": Mode("lossless", 1.0, None, None, lossless=True),
}

OUTPUTS = ("auto", "jpeg", "webp", "avif", "png")

# Page check settings for PDFs (render both versions and compare).
PDF_VERIFY_DPI = 100
PDF_VERIFY_MAX_SIDE = 1600
EXACT_SCORE = 0.9999  # "identical" for structural-only PDF changes

# Skip slow AVIF encoding above this many pixels (WebP is used instead).
AVIF_MAX_PIXELS = 24_000_000


# ---- MJ's size rule (the same one the intake worker uses) --------------------------------------
# A picture is first squeezed as small as the mode's score allows at full size. 150 KB or less: target met.
# Above that but at most 500 KB: kept, flagged targetMissed. Above 500 KB: the 500 KB cap is a HARD maximum:
# the picture is scaled down in steps (flag downscaled), then the score floor is lowered one step at a time
# (flag qualityFloorRelaxed), and as the last resort it is shrunk until it fits (flag lastResortShrink).
# Both numbers are request options (targetKb / capKb); these are the defaults. Numbers and order follow the intake
# worker's compress step (read on 2026-11-05, not imported or copied: this service keeps its own code).
KB = 1024
DEFAULT_TARGET = 150 * KB  # 153_600 bytes
DEFAULT_CAP = 500 * KB  # 512_000 bytes
MAX_CAP = 100 * 1024 * KB  # a cap above the upload limit means nothing
RELAXED_FLOORS = (0.98, 0.97, 0.96, 0.95, 0.93, 0.90)  # only the ones below the mode's own floor are used
DOWNSCALES = (0.9, 0.8, 0.7)
HOPELESS = 2.2  # smallest full-size file this many times the cap: 0.7x (half the pixels) cannot rescue it either
LAST_RESORT_SCALE, LAST_RESORT_STEP, LAST_RESORT_QUALITY = 0.6, 0.85, 60


@dataclass(frozen=True)
class SizeRule:
    target: int = DEFAULT_TARGET
    cap: int = DEFAULT_CAP


def size_rule(target_kb: object = None, cap_kb: object = None) -> SizeRule:
    """Request options -> SizeRule. Empty means the default. Whole KB numbers only; target <= cap."""
    def kb(value: object, default: int, name: str) -> int:
        if value is None or str(value).strip() == "":
            return default
        text = str(value).strip()
        if not text.isdigit() or int(text) <= 0:
            raise CompressorError("bad_size", f"{name} must be a whole number of KB above 0.", 400)
        return int(text) * KB

    cap = kb(cap_kb, DEFAULT_CAP, "capKb")
    target = kb(target_kb, min(DEFAULT_TARGET, cap), "targetKb")  # a small cap alone pulls the default target down
    if cap > MAX_CAP:
        raise CompressorError("bad_size", "capKb is too large.", 400)
    if target > cap:
        raise CompressorError("bad_size", "targetKb cannot be larger than capKb.", 400)
    return SizeRule(target, cap)


def floors_below(mode: Mode) -> tuple[float, ...]:
    """The mode's own floor first, then the relaxed steps below it."""
    return (mode.ssim_min,) + tuple(f for f in RELAXED_FLOORS if f < mode.ssim_min - 1e-9)


def get_mode(name: str) -> Mode:
    try:
        return MODES[name]
    except KeyError:
        raise CompressorError("bad_mode", "Mode must be balanced, strict, max or lossless.", 400)


def check_output(output: str) -> str:
    if output not in OUTPUTS:
        raise CompressorError("bad_output", "Output must be auto, jpeg, webp, avif or png.", 400)
    return output


def gentler(mode: Mode) -> Mode:
    """Half-way to perfect: the retry setting when a PDF page fails its check."""
    return replace(
        mode,
        ssim_min=mode.ssim_min + (1.0 - mode.ssim_min) / 2,
        pdf_dpi_cap=mode.pdf_dpi_cap * 2 if mode.pdf_dpi_cap else None,
    )
