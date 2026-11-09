"""Real file type from magic bytes. Names and caller content types are never trusted."""
from __future__ import annotations

MIME = {
    "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "avif": "image/avif",
    "gif": "image/gif", "bmp": "image/bmp", "tiff": "image/tiff", "heic": "image/heic",
    "pdf": "application/pdf",
}
IMAGE_KINDS = frozenset(MIME) - {"pdf"}
_HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}


def sniff(head: bytes) -> str | None:
    """Return a kind from MIME, or None when the bytes are not a supported type."""
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
    if b"%PDF-" in head[:1024]:
        return "pdf"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"avif", b"avis") or b"avif" in head[8:64]:
            return "avif"
        if brand in _HEIC_BRANDS:
            return "heic"
    return None
