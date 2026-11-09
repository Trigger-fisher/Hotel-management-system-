"""Document types from configuration. The built-in registry (readcore/doctypes) covers Aadhaar, PAN, passport, visa, driving
licence, voter ID and more. A hotel can add a type WITHOUT changing worker code: the job row carries `typeConfig`, e.g.

  {"name": "club-card", "keywords": ["golden club"], "fields": {"memberNo": "member\\s*no[:\\s]+([A-Z0-9-]+)"},
   "numberField": "memberNo"}

Each field is a regular expression whose first group is the value. Values read this way carry confidence 0.7 and source ocr."""
from __future__ import annotations

import re

from .readcore.doctypes.base import Context, DocType, make_field


class ConfiguredType(DocType):
    def __init__(self, config: dict) -> None:
        self.name = str(config.get("name") or "other")[:40]
        self.keywords = tuple(str(k) for k in config.get("keywords", []))[:20]
        self.patterns = {str(k): str(v)[:200] for k, v in dict(config.get("fields", {})).items()}
        self.number_field = config.get("numberField")

    def score(self, ctx: Context) -> float:
        return 0.8 if self.keywords and ctx.has(*self.keywords) else 0.0

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        for field_name, pattern in self.patterns.items():
            try:
                m = re.search(pattern, ctx.text, re.I)
            except re.error:
                continue
            if m and m.groups():
                out[field_name] = make_field(m.group(1).strip(), 0.7, "ocr")
        if self.number_field in out:
            out["documentNumber"] = out[self.number_field]
        return out
