"""Optional Linux tools. Every function returns None when its tool is missing or fails,
so the caller simply skips that path. Arguments are always lists, never shell strings."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

OPTIONAL_TOOLS = ("gs", "qpdf", "pdftoppm", "tesseract", "ocrmypdf", "jbig2", "pngquant", "oxipng")


def available() -> dict[str, bool]:
    return {name: shutil.which(name) is not None for name in OPTIONAL_TOOLS}


def _run(args: list[str], timeout: float) -> bool:
    try:
        done = subprocess.run(args, capture_output=True, timeout=timeout, check=False, shell=False)
    except (OSError, subprocess.SubprocessError):
        return False
    return done.returncode == 0


def oxipng(data: bytes, workdir: str, timeout: float = 60.0) -> bytes | None:
    """Lossless PNG squeeze. Same pixels, fewer bytes."""
    exe = shutil.which("oxipng")
    if not exe:
        return None
    path = Path(workdir) / "in.png"
    path.write_bytes(data)
    if not _run([exe, "-o", "4", "--strip", "all", "-q", str(path)], timeout):
        return None
    return path.read_bytes()


def ghostscript(data: bytes, workdir: str, dpi: int, qfactor: float, timeout: float) -> bytes | None:
    """Rewrite a scanned PDF with downsampled JPEG images. The caller must verify the result."""
    exe = shutil.which("gs")
    if not exe:
        return None
    src, dst = Path(workdir) / "gs_in.pdf", Path(workdir) / "gs_out.pdf"
    src.write_bytes(data)
    dict_ps = (
        "<< /ColorACSImageDict << /QFactor %s /Blend 1 /ColorTransform 1 "
        "/HSamples [1 1 1 1] /VSamples [1 1 1 1] >> "
        "/GrayACSImageDict << /QFactor %s /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> >> "
        "setdistillerparams" % (qfactor, qfactor)
    )
    args = [
        exe, "-sDEVICE=pdfwrite", "-dSAFER", "-dNOPAUSE", "-dBATCH", "-dQUIET",
        "-dDownsampleColorImages=true", "-dDownsampleGrayImages=true",
        f"-dColorImageResolution={dpi}", f"-dGrayImageResolution={dpi}",
        "-dColorImageDownsampleType=/Bicubic", "-dGrayImageDownsampleType=/Bicubic",
        "-dAutoFilterColorImages=false", "-dAutoFilterGrayImages=false",
        "-dColorImageFilter=/DCTEncode", "-dGrayImageFilter=/DCTEncode",
        # Monochrome images are left alone: no lossy JBIG2 symbol mode, ever.
        "-dMonoImageFilter=/FlateEncode", "-dDownsampleMonoImages=false",
        f"-sOutputFile={dst}", "-c", dict_ps, "-f", str(src),
    ]
    if not _run(args, timeout) or not dst.exists():
        return None
    return dst.read_bytes()
