# copied from quality-gate on 2026-11-04
"""Turn scores into reasons and a verdict using one profile's thresholds."""
from __future__ import annotations

from .profiles import LONG_EDGE_INCHES, MESSAGES, MOTION_RATIO_REJECT, MOTION_RATIO_WARN, load


def derive(scores: dict, profile: str) -> dict:
    """Scores the rules need that are computed from the raw ones."""
    out = dict(scores)
    out["shortSide"] = min(scores["width"], scores["height"])
    inches = LONG_EDGE_INCHES.get(profile)
    if inches:
        # A document photographed whole fills the frame, so its long side is the image; a card is measured by its own box.
        basis = max(scores["width"], scores["height"]) if profile == "document" else scores["contentLongSidePx"]
        out["effectiveDpi"] = round(max(basis, 1) / inches)
    return out


def reason(code: str, severity: str, message: str | None = None) -> dict:
    return {"code": code, "severity": severity, "message": message or MESSAGES.get(code, "")}


def evaluate(scores: dict, profile: str, skip: frozenset[str] = frozenset()) -> list[dict]:
    """Reasons for one picture. `skip` names rules that do not apply (for example blur on vector PDF pages)."""
    rules, blur = load(profile)
    s = derive(scores, profile)
    reasons: list[dict] = []
    if "blurry" not in skip:
        lap, grad = s["blurLaplacian"], s["blurGradient"]
        if lap < blur["reject_lap"] and grad < blur["reject_grad"]:
            reasons.append(reason("blurry", "reject"))
        elif lap < blur["warn_lap"] or grad < blur["warn_grad"]:
            reasons.append(reason("blurry", "warn"))
        ratio = s["gradientRatio"]
        # Camera shake blurs one direction only: text lines stay sharp along it, so the two scores above can look fine.
        if not reasons and (ratio < MOTION_RATIO_WARN or ratio > 1 / MOTION_RATIO_WARN):
            reasons.append(reason("blurry", "reject" if (ratio < MOTION_RATIO_REJECT or ratio > 1 / MOTION_RATIO_REJECT) else "warn"))
        if reasons and s.get("motionDirection"):
            reasons.append(reason("motionBlurHint", "info",
                                  f"The blur looks like camera shake in the {s['motionDirection']} direction. Hold the phone steadier."))
    for rule in rules:
        if rule.code in skip or rule.metric not in s:
            continue
        value = s[rule.metric]
        bad = (lambda limit: value < limit) if rule.low_is_bad else (lambda limit: value > limit)
        if rule.reject is not None and bad(rule.reject):
            reasons.append(reason(rule.code, "reject", rule.message))
        elif rule.warn is not None and bad(rule.warn):
            reasons.append(reason(rule.code, "warn", rule.message))
    # A blank page makes the other findings meaningless: report only that.
    if any(r["code"] == "blank" for r in reasons):
        reasons = [r for r in reasons if r["code"] == "blank"]
    return reasons


def verdict_of(reasons: list[dict]) -> str:
    severities = {r["severity"] for r in reasons}
    return "reject" if "reject" in severities else "warn" if "warn" in severities else "accept"
