"""Errors. A StepError ends the job: `reject=True` means the FILE is refused (never retried); otherwise the worker
could not do its job (the job goes to needs_attention or is retried)."""
from __future__ import annotations


class StepError(Exception):
    def __init__(self, code: str, message: str, status: int = 503, reject: bool = False, step: str = "") -> None:
        super().__init__(message)
        self.code, self.message, self.status, self.reject, self.step = code, message, status, reject, step


def reject(code: str, message: str, step: str) -> StepError:
    """The file is refused with one plain sentence; the job is never retried."""
    return StepError(code, message, 422, True, step)
