"""An in-memory stand-in for clamd that speaks the INSTREAM protocol.

The standard EICAR test string is rebuilt at run time from pieces so that it never appears whole
in any file on disk (Windows Defender would quarantine such a file). It is never written to disk."""
from __future__ import annotations

import socket
import socketserver
import struct
import threading


def eicar() -> bytes:
    parts = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!", "$H+H*"]
    return "".join(parts).encode("ascii")


class _Handler(socketserver.BaseRequestHandler):
    def _recv_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            part = self.request.recv(n - len(buf))
            if not part:
                raise ConnectionError
            buf += part
        return buf

    def handle(self) -> None:
        sock: socket.socket = self.request
        command = b""
        while not command.endswith(b"\x00"):
            part = sock.recv(1)
            if not part:
                return
            command += part
        server: FakeClamd = self.server.owner  # type: ignore[attr-defined]
        if command == b"zPING\x00":
            sock.sendall(b"PONG\x00")
        elif command == b"zVERSION\x00":
            sock.sendall(b"ClamAV 1.4.2-fake/27999/Tue Nov  3 07:25:00 2026\x00")
        elif command == b"zINSTREAM\x00":
            data = b""
            while True:
                (size,) = struct.unpack(">I", self._recv_exact(4))
                if size == 0:
                    break
                data += self._recv_exact(size)
            server.scanned += 1
            if server.mode == "error":
                sock.sendall(b"INSTREAM size limit exceeded. ERROR\x00")
            elif eicar() in data:
                sock.sendall(b"stream: Eicar-Test-Signature FOUND\x00")
            else:
                sock.sendall(b"stream: OK\x00")


class FakeClamd:
    def __init__(self, mode: str = "normal") -> None:
        self.mode, self.scanned = mode, 0
        self._server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _Handler)
        self._server.owner = self  # type: ignore[attr-defined]
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def address(self) -> str:
        return f"tcp:127.0.0.1:{self._server.server_address[1]}"

    def __enter__(self) -> "FakeClamd":
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._server.shutdown()
        self._server.server_close()
