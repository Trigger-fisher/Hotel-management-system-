"""INVENTED nasty and metadata-laden files for the part 10 tests, built in memory. Nothing here is a real document."""
from __future__ import annotations

import hashlib
import io
import struct
import zlib

import numpy as np
from PIL import Image

from tests import cards as C
from tests.fake_clamd import eicar

PAD = bytes.fromhex("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A")
PAYLOAD = b"INVENTED-ATTACHMENT-PAYLOAD"


def png_bytes(img: Image.Image, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", **kw)
    return buf.getvalue()


def jpeg_bytes(img: Image.Image, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", **{"quality": 92, **kw})
    return buf.getvalue()


def png_bomb(width: int = 40000, height: int = 40000) -> bytes:
    """A valid PNG signature and IHDR claiming width x height, followed by the tiny IDAT of an 8 x 8 picture."""
    small = png_bytes(Image.new("L", (8, 8)))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return small[:8] + struct.pack(">I", 13) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr)) + small[33:]


def jpeg_bomb(width: int = 40000, height: int = 40000) -> bytes:
    data = bytearray(jpeg_bytes(Image.new("RGB", (16, 16), (200, 200, 200))))
    at = data.index(b"\xff\xc0")
    data[at + 5:at + 9] = struct.pack(">HH", height, width)
    return bytes(data)


def _rc4(key: bytes, data: bytes) -> bytes:
    s, j = list(range(256)), 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    out, i, j = bytearray(), 0, 0
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


def build_pdf(objects: list[bytes], trailer_extra: bytes = b"") -> bytes:
    """objects[0] is object 1 (the catalog). A real cross-reference table is written."""
    out, offsets = bytearray(b"%PDF-1.6\n%\xe2\xe3\xcf\xd3\n"), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R " % (len(objects) + 1) + trailer_extra + b">>\nstartxref\n%d\n%%%%EOF\n" % xref
    return bytes(out)


def stream(data: bytes, extra: bytes = b"") -> bytes:
    return b"<< /Length %d " % len(data) + extra + b">>\nstream\n" + data + b"\nendstream"


DRAWING = b"0.1 0.2 0.6 rg 20 20 160 60 re f 0 0 0 RG 4 w 20 120 m 180 120 l S"


def pages_pdf(count: int, size=(200, 200)) -> bytes:
    kids = b" ".join(b"%d 0 R" % (3 + i) for i in range(count))
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Count %d /Kids [" % count + kids + b"] >>"]
    content = 3 + count
    objs += [b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Contents %d 0 R >>" % (size[0], size[1], content)] * count
    objs.append(stream(DRAWING))
    return build_pdf(objs)


def active_pdf() -> bytes:
    """One page, JavaScript run on open, an embedded file (name tree and a file-attachment annotation) holding an MZ payload."""
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R /Names << /JavaScript << /Names [(run) 5 0 R] >> "
        b"/EmbeddedFiles << /Names [(payload.exe) 6 0 R] >> >> >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots [8 0 R] >>",
        stream(DRAWING),
        b"<< /Type /Action /S /JavaScript /JS (app.alert\\(1\\); this.exportDataObject\\({cName: 'payload.exe', nLaunch: 2}\\)) >>",
        b"<< /Type /Filespec /F (payload.exe) /UF (payload.exe) /EF << /F 7 0 R >> >>",
        stream(b"MZ\x90\x00" + PAYLOAD * 4, b"/Type /EmbeddedFile "),
        b"<< /Type /Annot /Subtype /FileAttachment /Rect [150 150 190 190] /FS 6 0 R /Contents (open me) >>",
    ]
    return build_pdf(objs)


def encrypted_pdf(user: bytes = b"invented-pass", owner: bytes = b"invented-owner") -> bytes:
    """Standard security handler, revision 2 (RC4, 40-bit), with a user password: it cannot be opened without the password."""
    file_id = hashlib.md5(b"invented pdf").digest()
    pad = lambda pw: (pw + PAD)[:32]  # noqa: E731
    o_value = _rc4(hashlib.md5(pad(owner)).digest()[:5], pad(user))
    perms = struct.pack("<i", -44)
    key = hashlib.md5(pad(user) + o_value + perms + file_id).digest()[:5]
    u_value = _rc4(key, PAD)
    content = _rc4(hashlib.md5(key + (4).to_bytes(3, "little") + (0).to_bytes(2, "little")).digest()[:10], DRAWING)
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
        stream(content),
        b"<< /Filter /Standard /V 1 /R 2 /O <" + o_value.hex().encode() + b"> /U <" + u_value.hex().encode() + b"> /P -44 >>",
    ]
    return build_pdf(objs, b"/Encrypt 5 0 R /ID [<" + file_id.hex().encode() + b"> <" + file_id.hex().encode() + b">] ")


def device_exif(orientation: int = 1) -> Image.Exif:
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "InventedCamera"
    exif[0x0110] = "InventedPhone X1"
    exif[0x0131] = "InventedFirmware 9.9"
    exif[0x0132] = "2026:11:05 10:11:12"
    exif[0x013B] = "InventedOwner"
    exif.get_ifd(0x8825).update({1: "N", 2: (21.0, 10.0, 12.5), 3: "E", 4: (72.0, 49.0, 3.25), 6: 14.0})
    exif.get_ifd(0x8769).update({0x9003: "2026:11:05 10:11:12", 0xA431: "INVENTED-SERIAL-77"})
    return exif


XMP = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
       b'<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="21,10.2N" exif:Make="InventedCamera"/>'
       b"</rdf:RDF></x:xmpmeta>")
METADATA_WORDS = [b"InventedCamera", b"InventedPhone", b"InventedFirmware", b"InventedOwner", b"INVENTED-SERIAL", b"2026:11:05",
                  b"Exif\x00\x00", b"http://ns.adobe.com", b"xmpmeta", b"invented comment", b"InventedAuthor", b"ICC_PROFILE",
                  b"GPS"]


def icc_profile() -> bytes:
    from PIL import ImageCms
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def jpeg_full_of_metadata(img: Image.Image | None = None, orientation: int = 1) -> bytes:
    img = img or C.aadhaar_front()
    return jpeg_bytes(img, quality=95, exif=device_exif(orientation).tobytes(), icc_profile=icc_profile(), xmp=XMP,
                      comment=b"invented comment")


def png_full_of_metadata(img: Image.Image | None = None) -> bytes:
    from PIL import PngImagePlugin
    info = PngImagePlugin.PngInfo()
    info.add_text("Author", "InventedAuthor")
    info.add_itxt("XML:com.adobe.xmp", XMP.decode())
    img = img or C.aadhaar_front()
    return png_bytes(img, pnginfo=info, exif=device_exif().tobytes(), icc_profile=icc_profile())


def heic_with_gps(img: Image.Image | None = None, orientation: int = 1) -> bytes:
    import pillow_heif  # noqa: F401  (registered by app.resave)
    buf = io.BytesIO()
    (img or C.aadhaar_front()).save(buf, "HEIF", quality=90, exif=device_exif(orientation).tobytes(), xmp=XMP)
    return buf.getvalue()


def truncated(data: bytes, keep: float = 0.6) -> bytes:
    return data[:int(len(data) * keep)]


def noise_png(megabytes: int = 26) -> bytes:
    """A real, decodable PNG of random pixels larger than `megabytes` (stored without compression)."""
    side = int((megabytes * 1024 * 1024 / 3) ** 0.5) + 16
    pixels = np.random.default_rng(7).integers(0, 256, (side, side, 3), dtype=np.uint8)
    return png_bytes(Image.fromarray(pixels), compress_level=0)


def svg_files() -> dict[str, bytes]:
    body = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>'
    return {"svg": body, "svg with xml prolog": b'<?xml version="1.0"?>\n' + body, "svg with bom": b"\xef\xbb\xbf" + body,
            "svgz": __import__("gzip").compress(body)}


def executables() -> dict[str, bytes]:
    jpeg = jpeg_bytes(C.unknown_card())
    return {
        "windows exe named .jpg": b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff" + b"\x00" * 50 + b"PE\x00\x00" + b"\x00" * 200,
        "exe with a jpeg inside": b"MZ\x90\x00" + b"\x00" * 60 + jpeg,
        "exe with %PDF- inside the first kilobyte": b"MZ\x90\x00" + b"\x00" * 100 + pages_pdf(1),
        "linux elf named .jpg": b"\x7fELF\x02\x01\x01" + b"\x00" * 200,
        "shell script named .jpg": b"#!/bin/sh\nrm -rf /tmp/x\n",
        "html named .jpg": b"<html><script>alert(1)</script></html>",
    }


def eicar_files() -> dict[str, bytes]:
    return {"eicar alone": eicar(), "eicar after spaces": b"   " + eicar()}
