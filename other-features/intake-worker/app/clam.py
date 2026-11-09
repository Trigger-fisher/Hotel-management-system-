# copied from antivirus on 2026-11-04
"""Minimal clamd client using the documented INSTREAM protocol over plain sockets.

Address forms: "unix:/path/to/clamd.ctl" or "tcp:host:3310". Commands use the "z" prefix
(null-terminated) so replies are unambiguous."""
from __future__ import annotations

import re
import socket
import struct
from dataclasses import dataclass

from .errors import StepError

CHUNK = 64 * 1024


@dataclass(frozen=True)
class ScanResult:
    infected: bool
    signature: str | None


class ClamClient:
    def __init__(self, address: str, timeout: float = 30.0) -> None:
        self.address, self.timeout = address, timeout

    def _connect(self) -> socket.socket:
        try:
            if self.address.startswith("unix:"):
                sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                sock.settimeout(self.timeout)
                sock.connect(self.address[5:])
            elif self.address.startswith("tcp:"):
                host, _, port = self.address[4:].rpartition(":")
                sock = socket.create_connection((host, int(port)), timeout=self.timeout)
            else:
                raise ValueError(self.address)
            return sock
        except (OSError, ValueError, AttributeError):
            raise StepError("scanner_unavailable", "The virus scanner is not reachable.")

    @staticmethod
    def _read_reply(sock: socket.socket) -> str:
        buf = b""
        while not buf.endswith(b"\x00") and len(buf) < 65536:
            part = sock.recv(4096)
            if not part:
                break
            buf += part
        return buf.rstrip(b"\x00\n").decode("utf-8", "replace")

    def _command(self, name: bytes) -> str:
        sock = self._connect()
        try:
            sock.sendall(b"z" + name + b"\x00")
            return self._read_reply(sock)
        except OSError:
            raise StepError("scanner_unavailable", "The virus scanner is not reachable.")
        finally:
            sock.close()

    def ping(self) -> bool:
        try:
            return self._command(b"PING") == "PONG"
        except StepError:
            return False

    def version(self) -> str | None:
        try:
            return self._command(b"VERSION") or None
        except StepError:
            return None

    def scan(self, data: bytes) -> ScanResult:
        sock = self._connect()
        try:
            sock.sendall(b"zINSTREAM\x00")
            for i in range(0, len(data), CHUNK):
                part = data[i:i + CHUNK]
                sock.sendall(struct.pack(">I", len(part)) + part)
            sock.sendall(struct.pack(">I", 0))
            reply = self._read_reply(sock)
        except OSError:
            raise StepError("scanner_unavailable", "The virus scanner stopped answering.")
        finally:
            sock.close()
        if reply.endswith("FOUND"):
            return ScanResult(True, reply.removeprefix("stream:").removesuffix("FOUND").strip() or "unknown")
        if reply.endswith("OK"):
            return ScanResult(False, None)
        # "ERROR" (for example the size limit) must never be read as "clean".
        raise StepError("scanner_error", "The virus scanner could not check this file.", 502)


def parse_version(text: str | None) -> tuple[str | None, str | None]:
    """'ClamAV 1.4.2/27800/Mon Nov  3 07:25:00 2026' -> ('ClamAV 1.4.2', 'Mon Nov  3 ...')."""
    if not text:
        return None, None
    m = re.match(r"^(ClamAV [^/]+)(?:/\d+/(.*))?$", text.strip())
    return (m.group(1), m.group(2)) if m else (text.strip(), None)
