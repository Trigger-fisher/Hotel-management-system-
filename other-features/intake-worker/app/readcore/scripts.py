# copied from reader on 2026-11-04
"""Writing systems in one place: Unicode blocks, direction, and the engine language for each.

The block table is what turns "some text" into "this line is Devanagari": the reader counts
characters per block instead of trusting an engine's guess."""
from __future__ import annotations

import bisect
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class ScriptInfo:
    name: str
    tesseract: str  # default Tesseract language(s) for this script
    paddle: str | None  # PaddleOCR language code, None when it has no model
    rtl: bool = False


SCRIPTS: dict[str, ScriptInfo] = {s.name: s for s in [
    ScriptInfo("Latin", "eng", "latin"),
    ScriptInfo("Devanagari", "hin", "devanagari"),
    ScriptInfo("Gujarati", "guj", None),
    ScriptInfo("Gurmukhi", "pan", None),
    ScriptInfo("Bengali", "ben", None),
    ScriptInfo("Tamil", "tam", "ta"),
    ScriptInfo("Telugu", "tel", "te"),
    ScriptInfo("Kannada", "kan", "ka"),
    ScriptInfo("Malayalam", "mal", None),
    ScriptInfo("Arabic", "ara", "arabic", rtl=True),
    ScriptInfo("Hebrew", "heb", None, rtl=True),
    ScriptInfo("Thai", "tha", None),
    ScriptInfo("Cyrillic", "rus", "cyrillic"),
    ScriptInfo("Greek", "ell", None),
    ScriptInfo("CJK", "chi_sim", "ch"),
    ScriptInfo("Japanese", "jpn", "japan"),
    ScriptInfo("Hangul", "kor", "korean"),
]}
# Scripts that can be probed when nothing tells us which one is on the page.
PROBE_ORDER = ["Devanagari", "Gujarati", "Arabic", "Cyrillic", "CJK", "Hangul", "Japanese", "Thai",
               "Tamil", "Telugu", "Kannada", "Malayalam", "Bengali", "Gurmukhi", "Hebrew", "Greek"]

# (first, last, script). Sorted at import. Digits and punctuation inside a block are ignored when counting.
_RANGES = [
    (0x0041, 0x024F, "Latin"), (0x1E00, 0x1EFF, "Latin"), (0x2C60, 0x2C7F, "Latin"), (0xA720, 0xA7FF, "Latin"),
    (0xFF21, 0xFF5A, "Latin"),
    (0x0370, 0x03FF, "Greek"), (0x1F00, 0x1FFF, "Greek"),
    (0x0400, 0x052F, "Cyrillic"), (0x2DE0, 0x2DFF, "Cyrillic"), (0xA640, 0xA69F, "Cyrillic"),
    (0x0590, 0x05FF, "Hebrew"), (0xFB1D, 0xFB4F, "Hebrew"),
    (0x0600, 0x06FF, "Arabic"), (0x0750, 0x077F, "Arabic"), (0x08A0, 0x08FF, "Arabic"),
    (0xFB50, 0xFDFF, "Arabic"), (0xFE70, 0xFEFF, "Arabic"),
    (0x0900, 0x097F, "Devanagari"), (0xA8E0, 0xA8FF, "Devanagari"),
    (0x0980, 0x09FF, "Bengali"), (0x0A00, 0x0A7F, "Gurmukhi"), (0x0A80, 0x0AFF, "Gujarati"),
    (0x0B80, 0x0BFF, "Tamil"), (0x0C00, 0x0C7F, "Telugu"), (0x0C80, 0x0CFF, "Kannada"),
    (0x0D00, 0x0D7F, "Malayalam"), (0x0E00, 0x0E7F, "Thai"),
    (0x3040, 0x30FF, "Japanese"), (0x31F0, 0x31FF, "Japanese"),
    (0x3400, 0x4DBF, "CJK"), (0x4E00, 0x9FFF, "CJK"), (0xF900, 0xFAFF, "CJK"), (0x20000, 0x2A6DF, "CJK"),
    (0x1100, 0x11FF, "Hangul"), (0x3130, 0x318F, "Hangul"), (0xAC00, 0xD7AF, "Hangul"),
]
_RANGES.sort()
_STARTS = [r[0] for r in _RANGES]

# Language hints (ISO 639-1 or 639-2 or a Tesseract code) -> (script, Tesseract code).
LANGUAGES: dict[str, tuple[str, str]] = {
    "en": ("Latin", "eng"), "eng": ("Latin", "eng"), "fr": ("Latin", "fra"), "fra": ("Latin", "fra"),
    "de": ("Latin", "deu"), "deu": ("Latin", "deu"), "es": ("Latin", "spa"), "spa": ("Latin", "spa"),
    "it": ("Latin", "ita"), "ita": ("Latin", "ita"), "pt": ("Latin", "por"), "por": ("Latin", "por"),
    "tr": ("Latin", "tur"), "tur": ("Latin", "tur"), "vi": ("Latin", "vie"), "vie": ("Latin", "vie"),
    "hi": ("Devanagari", "hin"), "hin": ("Devanagari", "hin"), "mr": ("Devanagari", "mar"),
    "mar": ("Devanagari", "mar"), "ne": ("Devanagari", "nep"), "nep": ("Devanagari", "nep"),
    "gu": ("Gujarati", "guj"), "guj": ("Gujarati", "guj"), "pa": ("Gurmukhi", "pan"), "pan": ("Gurmukhi", "pan"),
    "bn": ("Bengali", "ben"), "ben": ("Bengali", "ben"), "ta": ("Tamil", "tam"), "tam": ("Tamil", "tam"),
    "te": ("Telugu", "tel"), "tel": ("Telugu", "tel"), "kn": ("Kannada", "kan"), "kan": ("Kannada", "kan"),
    "ml": ("Malayalam", "mal"), "mal": ("Malayalam", "mal"),
    "ar": ("Arabic", "ara"), "ara": ("Arabic", "ara"), "ur": ("Arabic", "urd"), "urd": ("Arabic", "urd"),
    "fa": ("Arabic", "fas"), "fas": ("Arabic", "fas"), "he": ("Hebrew", "heb"), "heb": ("Hebrew", "heb"),
    "th": ("Thai", "tha"), "tha": ("Thai", "tha"), "ru": ("Cyrillic", "rus"), "rus": ("Cyrillic", "rus"),
    "el": ("Greek", "ell"), "ell": ("Greek", "ell"), "zh": ("CJK", "chi_sim"), "chi_sim": ("CJK", "chi_sim"),
    "ja": ("Japanese", "jpn"), "jpn": ("Japanese", "jpn"), "ko": ("Hangul", "kor"), "kor": ("Hangul", "kor"),
}
# What Tesseract's orientation/script detection calls things.
OSD_NAMES = {"Latin": "Latin", "Devanagari": "Devanagari", "Gujarati": "Gujarati", "Gurmukhi": "Gurmukhi",
             "Bengali": "Bengali", "Tamil": "Tamil", "Telugu": "Telugu", "Kannada": "Kannada",
             "Malayalam": "Malayalam", "Arabic": "Arabic", "Hebrew": "Hebrew", "Thai": "Thai",
             "Cyrillic": "Cyrillic", "Greek": "Greek", "Han": "CJK", "Japanese": "Japanese", "Hangul": "Hangul"}


def script_of(ch: str) -> str | None:
    """The script of one character, or None for digits, spaces and punctuation."""
    code = ord(ch)
    category = unicodedata.category(ch)
    if category[0] not in ("L", "M"):
        return None
    i = bisect.bisect_right(_STARTS, code) - 1
    if i >= 0 and _RANGES[i][0] <= code <= _RANGES[i][1]:
        return _RANGES[i][2]
    # ranges are sorted by start and may nest: look back a little
    for j in range(max(0, i - 3), i):
        if _RANGES[j][0] <= code <= _RANGES[j][1]:
            return _RANGES[j][2]
    return None


def histogram(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for ch in text:
        s = script_of(ch)
        if s:
            counts[s] = counts.get(s, 0) + 1
    return counts


def dominant_script(text: str) -> tuple[str | None, float]:
    """(script, share of letters). Japanese text mixes kana and Han: kana wins when present."""
    counts = histogram(text)
    if not counts:
        return None, 0.0
    if counts.get("Japanese") and counts.get("CJK"):
        counts["Japanese"] += counts.pop("CJK")
    total = sum(counts.values())
    script = max(counts, key=counts.get)
    return script, counts[script] / total


def is_rtl(script: str | None) -> bool:
    return bool(script and script in SCRIPTS and SCRIPTS[script].rtl)


def hint_scripts(languages: list[str]) -> tuple[list[str], dict[str, list[str]]]:
    """Scripts named by the caller's hints, and extra Tesseract codes per script."""
    scripts: list[str] = []
    extra: dict[str, list[str]] = {}
    for raw in languages:
        entry = LANGUAGES.get(raw.strip().lower())
        if not entry:
            continue
        script, code = entry
        if script not in scripts:
            scripts.append(script)
        extra.setdefault(script, []).append(code)
    return scripts, extra
