# copied from reader on 2026-11-04
"""Real file type from magic bytes. Names and caller content types are never trusted."""
from __future__ import annotations

MIME = {
    "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "avif": "image/avif",
    "gif": "image/gif", "bmp": "image/bmp", "tiff": "image/tiff", "heic": "image/heic",
    "pdf": "application/pdf",
}
_HEIC = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}


def sniff(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:2] == b"BM" and head[6:10] == b"\x00\x00\x00\x00":
        return "bmp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    if head.startswith(b"%PDF-"):  # at byte 0 only: an executable carrying a PDF after its own header is not a PDF here
        return "pdf"
    if head[4:8] == b"ftyp":
        if head[8:12] in (b"avif", b"avis") or b"avif" in head[8:64]:
            return "avif"
        if head[8:12] in _HEIC:
            return "heic"
    return None
