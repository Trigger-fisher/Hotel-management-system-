"""One compression job. Runs inside a worker process; the temp directory is always removed."""
from __future__ import annotations

import tempfile
from dataclasses import dataclass

from .errors import CompressorError
from .images import compress_image
from .limits import Deadline, Limits
from .modes import SizeRule, check_output, get_mode
from .pdfs import compress_pdf
from .sniff import MIME, sniff


@dataclass(frozen=True)
class Outcome:
    data: bytes
    mime: str
    fmt: str
    original_bytes: int
    result_bytes: int
    score: float
    mode: str
    notes: tuple[str, ...]
    target_bytes: int = SizeRule().target
    cap_bytes: int = SizeRule().cap

    @property
    def saved_percent(self) -> float:
        if not self.original_bytes:
            return 0.0
        return round(100.0 * (self.original_bytes - self.result_bytes) / self.original_bytes, 1)

    @property
    def target(self) -> str:
        """'met' when the 150 KB (or asked) target was reached, else 'missed'."""
        return "missed" if "targetMissed" in self.notes else "met"


def run_job(data: bytes, mode_name: str, output: str, limits: Limits, rule: SizeRule | None = None) -> Outcome:
    mode = get_mode(mode_name)
    check_output(output)
    rule = rule or SizeRule()
    if len(data) > limits.max_bytes:
        raise CompressorError("too_large", "The file is larger than the allowed size.", 413)
    kind = sniff(data[:2048])  # the real type from the bytes, never the file name
    if kind is None:
        raise CompressorError("unsupported_type", "Only PDF and common picture files are accepted.", 415)
    deadline = Deadline(limits.job_seconds)
    with tempfile.TemporaryDirectory(prefix="cmp-") as workdir:
        if kind == "pdf":
            result = compress_pdf(data, mode, limits, deadline, workdir, rule)
        else:
            result = compress_image(data, kind, mode, output, limits, deadline, workdir, rule)
    return Outcome(result.data, MIME[result.fmt], result.fmt, len(data), len(result.data),
                   result.score, mode.name, result.notes, rule.target, rule.cap)
