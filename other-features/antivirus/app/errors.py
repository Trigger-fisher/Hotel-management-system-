"""Two kinds of refusal.

Rejection: the FILE is refused (a verdict). ServiceError: the SERVICE could not do its job
(scanner down, busy, timeout), so no verdict about the file exists."""
from __future__ import annotations


class Rejection(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


class ServiceError(Exception):
    def __init__(self, code: str, message: str, status: int = 503) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    def __reduce__(self):  # survives the trip back from a worker process
        return (ServiceError, (self.code, self.message, self.status))
