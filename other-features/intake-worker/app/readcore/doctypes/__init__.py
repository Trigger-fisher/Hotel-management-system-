# copied from reader on 2026-11-04
"""Document types for ID-like pictures. ADDING A TYPE = adding one small file here that defines a class named
`DOC_TYPE` (see aadhaar.py) plus its test: the registry finds it by itself.

detect() scores every type from evidence in the read result (MRZ, QR payload shape, keywords in several languages,
number patterns); the best type above THRESHOLD wins, otherwise the document is `unknown`. Unknown is not an error:
no fields are invented, needsHumanCheck is set by the caller, and the picture is still kept so reception can type the fields.
Validators only CHECK; they never change or hide a value."""
from __future__ import annotations

import importlib
import pkgutil

from .base import Context, DocType, make_field  # noqa: F401  (make_field re-exported for type files)

THRESHOLD = 0.5
_TYPES: list[DocType] | None = None


def registry() -> list[DocType]:
    global _TYPES
    if _TYPES is None:
        found = []
        for module in pkgutil.iter_modules(__path__):
            if module.name in ("base", "generic"):
                continue
            mod = importlib.import_module(f"{__name__}.{module.name}")
            for candidate in getattr(mod, "DOC_TYPES", [getattr(mod, "DOC_TYPE", None)]):
                if candidate is not None:
                    found.append(candidate)
        _TYPES = found
    return _TYPES


def detect(ctx: Context) -> dict:
    scored = sorted(((t.score(ctx), t) for t in registry()), key=lambda s: s[0], reverse=True)
    best_score, best = scored[0]
    others = {t.name: round(s, 2) for s, t in scored[:4] if s > 0}
    if best_score < THRESHOLD:
        return {"type": "unknown", "confidence": round(1 - best_score, 2), "candidates": others}
    return {"type": best.name, "confidence": round(best_score, 2), "candidates": others}


def extract(ctx: Context, doc_type: str) -> dict:
    """Fields for the detected type; {} for unknown. Every field: value, confidence, source, and valid when a check exists."""
    for t in registry():
        if t.name == doc_type:
            return t.extract(ctx)
    return {}


def read_document(result: dict, side: str = "front") -> dict:
    """{type, confidence, candidates, fields, needsHumanCheck} from a reader result."""
    ctx = Context.from_result(result, side)
    info = detect(ctx)
    fields = extract(ctx, info["type"])
    doubtful = [k for k, f in fields.items() if f.get("valid") is False or f.get("doubtful")]
    return {**info, "fields": fields, "doubtfulFields": doubtful,
            "needsHumanCheck": info["type"] == "unknown" or bool(doubtful)}
