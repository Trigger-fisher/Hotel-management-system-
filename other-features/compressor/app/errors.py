"""Stable error codes: every refusal is a code plus one plain sentence."""
from __future__ import annotations

from dataclasses import dataclass


class CompressorError(Exception):
    """A refusal the caller can act on. `code` never changes once published."""

    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

    # Needed so the error survives the trip back from a worker process.
    def __reduce__(self):
        return (CompressorError, (self.code, self.message, self.status))


@dataclass(frozen=True)
class Result:
    """What a compressor returns before the job adds the original size."""

    data: bytes
    fmt: str  # sniffed type name of `data`, e.g. "jpeg", "pdf"
    score: float  # worst quality score found; 1.0 means identical
    notes: tuple[str, ...] = ()
