# copied from quality-gate on 2026-11-04
"""Stable error codes: every refusal is a code plus one plain sentence."""
from __future__ import annotations


class GateError(Exception):
    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    def __reduce__(self):  # survives the trip back from a worker process
        return (GateError, (self.code, self.message, self.status))
