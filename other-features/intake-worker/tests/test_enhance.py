"""Automatic enhance of the stored copy: each fix only when its problem is measured, clean pictures left alone, everything under 500 KB.
Invented cards only."""
import cv2
import numpy as np
import pytest

from app import compress as comp
from app import enhance as E
from tests import cards as C
from tests import imaging as I

CAP = 512_000


def cases():
    out = {}
    for name, build in (("aadhaar", C.aadhaar_front), ("pan", C.pan_card), ("licence", C.driving_licence)):
        base = np.asarray(build().convert("RGB"))
        out[name + "-clean"] = base
        out[name + "-dark"] = I.darken(base, 0.35)
        out[name + "-bright"] = np.clip(base.astype(np.float32) * 0.3 + 190, 0, 255).astype(np.uint8)
        out[name + "-lowcontrast"] = I.low_contrast(base, 0.25)
        out[name + "-noisy"] = np.clip(base.astype(np.float32) + np.random.default_rng(1).normal(0, 14, base.shape), 0, 255).astype(np.uint8)
        out[name + "-blurry"] = I.blur(base, 3.0)
        out[name + "-tiny"] = cv2.resize(base, (480, 300), interpolation=cv2.INTER_AREA)
    return out


CARDS = cases()


@pytest.mark.parametrize("name", [n for n in CARDS if n.endswith("clean")])
def test_a_clean_picture_is_left_unchanged(name):
    out, fixes = E.enhance(CARDS[name])
    assert fixes == [] and np.array_equal(out, CARDS[name])


@pytest.mark.parametrize("kind,fix", [("dark", "contrast"), ("bright", "contrast"), ("lowcontrast", "contrast"), ("noisy", "denoise"),
                                      ("blurry", "sharpen"), ("tiny", "upscale")])
def test_each_problem_gets_its_fix(kind, fix):
    for card in ("aadhaar", "pan", "licence"):
        px = CARDS[f"{card}-{kind}"]
        out, fixes = E.enhance(px)
        assert fix in fixes, (card, kind, fixes)
        if fix == "contrast":
            assert E.contrast(out) > E.contrast(px) + 40
        if fix == "denoise":
            assert E.noise_sigma(out) < E.noise_sigma(px) * 0.5
        if fix == "sharpen":
            assert E.sharpness(out) > E.sharpness(px)
        if fix == "upscale":
            assert max(out.shape[:2]) <= 2 * max(px.shape[:2])


def test_every_enhanced_picture_fits_500kb_and_keeps_the_floor():
    for name, px in CARDS.items():
        out, _ = E.enhance(px)
        data, fmt, flags, scores = comp.compress(out, CAP)
        assert len(data) <= CAP and "sizeCapExceeded" not in flags, (name, len(data), flags)
        assert scores["ssim"] >= comp.SSIM_FLOOR, name


def test_the_switch_turns_the_step_off(monkeypatch):
    from app.config import load_settings
    import base64
    env = {"INTAKE_MASTER_KEY": base64.b64encode(bytes(32)).decode(), "INTAKE_DATABASE_URL": "x", "INTAKE_CLAMD": "tcp:c:1"}
    assert load_settings(env).auto_enhance is True
    assert load_settings({**env, "AUTO_ENHANCE": "false"}).auto_enhance is False


def test_the_report_numbers(capsys):
    """Before/after numbers for the write-up (printed with -s)."""
    for name, px in CARDS.items():
        if not name.startswith("aadhaar"):
            continue
        out, fixes = E.enhance(px)
        data, fmt, _, _ = comp.compress(out, CAP)
        print(f"{name}: sharpness {E.sharpness(px):.2f}->{E.sharpness(out):.2f} contrast {E.contrast(px):.0f}->{E.contrast(out):.0f} fixes={fixes} {len(data)} B {fmt}")
