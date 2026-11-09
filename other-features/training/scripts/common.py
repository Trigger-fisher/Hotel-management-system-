"""Small helpers shared by the training scripts. Standard library + numpy + OpenCV only.

Independence: nothing is imported from another folder. Where logic also exists elsewhere it is an own copy:
  * Verhoeff / Aadhaar / PAN checks and the MRZ check digit: copied from reader on 2026-11-04 (app/ids.py, app/mrz.py).
  * Aadhaar QR parsing: copied from reader on 2026-11-04 (app/doctypes/aadhaar.py, parse_qr).
  * norm / lev / char_acc: copied from accuracy-check on 2026-11-04 (check.py), so scores match the review form.

Privacy: personal keys (ID numbers, name + date of birth) are only ever stored as salted HMAC-SHA256 hashes. The salt is a
random file inside the dataset folder (outside the repository), so a 12-digit number cannot be brute-forced from the hash alone.
Nothing in here prints text read from a card."""
from __future__ import annotations

import gzip
import hashlib
import hmac
import os
import re
import secrets
import unicodedata
import zlib
from pathlib import Path

import numpy as np

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
SPLITS = ("train", "val", "test")
TRAINING_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- validators (copied from reader on 2026-11-04)
_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
      [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
      [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]
PAN_HOLDER_TYPES = "PCHFATBLJG"
AADHAAR_RE = re.compile(r"(?<!\d)(\d{4}[ -]?\d{4}[ -]?\d{4})(?!\d)")
PAN_RE = re.compile(r"(?<![A-Z0-9])([A-Z]{5}\d{4}[A-Z])(?![A-Z0-9])")


def verhoeff_valid(number: str) -> bool:
    if not number.isdigit():
        return False
    c = 0
    for i, ch in enumerate(reversed(number)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def verhoeff_append(body: str) -> str:
    """body + its Verhoeff check digit (used only to INVENT test numbers)."""
    c = 0
    for i, ch in enumerate(reversed(body)):
        c = _D[c][_P[(i + 1) % 8][int(ch)]]
    return body + str(_INV[c])


def aadhaar_valid(text: str) -> bool:
    digits = re.sub(r"[\s-]", "", text)
    return bool(re.fullmatch(r"[2-9]\d{11}", digits)) and verhoeff_valid(digits)


def pan_valid(text: str) -> bool:
    return bool(re.fullmatch(r"[A-Z]{3}[%s][A-Z]\d{4}[A-Z]" % PAN_HOLDER_TYPES, text.strip().upper()))


def mrz_check_digit(data: str) -> str:
    def value(ch: str) -> int:
        return int(ch) if ch.isdigit() else 0 if ch == "<" else ord(ch) - 55
    return str(sum(value(c) * (7, 3, 1)[i % 3] for i, c in enumerate(data)) % 10)


def _ok(data: str, digit: str) -> bool:
    return digit in "0123456789" and mrz_check_digit(data) == digit


MRZ_LINE = re.compile(r"^[A-Z0-9<]+$")


def mrz_clean(text: str) -> str:
    return re.sub(r"\s+", "", text.upper().replace("«", "<"))


def mrz_verified_lines(texts: list[str]) -> dict[int, str]:
    """Indexes of OCR lines that are MRZ lines FULLY covered by passing check digits -> format.

    TD3 line 2 and TD2 line 2 (number, birth, expiry, composite) and TD1 lines 1-2 are covered by check digits.
    Name lines (TD3/TD2 line 1, TD1 line 3) have NO check digit, so they are never returned (they need a person).
    The check digits do NOT cover nationality, sex or the TD1 document code / issuing state. Measured on invented passports:
    OCR read "UTO" as "UT0" and every check digit still passed. So those characters must also pass: sex in M/F/X/<,
    document code letters, and the nationality must equal the issuing state from line 1 (else a person reviews it)."""
    cleaned = [mrz_clean(t) for t in texts]
    out: dict[int, str] = {}
    letters3 = re.compile(r"[A-Z<]{3}")
    for i, c in enumerate(cleaned):
        if not MRZ_LINE.match(c or "~"):
            continue
        if len(c) in (44, 36) and i > 0 and len(cleaned[i - 1]) == len(c) and MRZ_LINE.match(cleaned[i - 1]):
            l1, l2, end = cleaned[i - 1], c, len(c) - 1
            nat, issuer = l2[10:13], l1[2:5]
            if (_ok(l2[0:9], l2[9]) and _ok(l2[13:19], l2[19]) and _ok(l2[21:27], l2[27])
                    and _ok(l2[0:10] + l2[13:20] + l2[21:end], l2[end]) and l2[20] in "MFX<"
                    and letters3.fullmatch(nat) and nat == issuer):
                out[i] = "TD3" if len(c) == 44 else "TD2"
        elif len(c) == 30 and i + 1 < len(cleaned) and len(cleaned[i + 1]) == 30 and MRZ_LINE.match(cleaned[i + 1]):
            l1, l2 = c, cleaned[i + 1]
            if (_ok(l1[5:14], l1[14]) and _ok(l2[0:6], l2[6]) and _ok(l2[8:14], l2[14])
                    and _ok(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29], l2[29]) and l2[7] in "MFX<"
                    and re.fullmatch(r"[A-Z][A-Z<]", l1[0:2]) and letters3.fullmatch(l1[2:5]) and l2[15:18] == l1[2:5]):
                out[i] = out[i + 1] = "TD1"
    return out


def parse_aadhaar_qr(text: str) -> dict | None:
    """{name, dob, last4} from an Aadhaar QR payload (old XML or secure QR), else None. Signature NOT verified."""
    text = (text or "").strip()
    if text.startswith("<") and "uid=" in text:
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', text))
        return {"name": attrs.get("name"), "dob": attrs.get("dob") or attrs.get("yob"), "last4": (attrs.get("uid") or "")[-4:]}
    if text.isdigit() and len(text) > 60:
        try:
            raw = int(text).to_bytes((int(text).bit_length() + 7) // 8, "big")
            body = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
        except (ValueError, zlib.error, OverflowError):
            return None
        parts = body.split(b"\xff")
        if len(parts) < 5:
            return None
        get = lambda i: parts[i].decode("utf-8", "replace").strip()  # noqa: E731
        return {"name": get(2), "dob": get(3), "last4": get(1)[:4]}
    return None


def secure_qr_payload(name: str, dob: str, last4: str, gender: str = "M") -> str:
    """An INVENTED secure-QR-shaped payload (gzip of 0xFF separated fields as a big decimal). Used only for test cards."""
    fields = [b"3", (last4 + "20260101000000").encode(), name.encode(), dob.encode(), gender.encode(), b"C/O Invented", b"Nowhere"]
    return str(int.from_bytes(gzip.compress(b"\xff".join(fields)), "big"))


# ---------------------------------------------------------------- text comparison (copied from accuracy-check on 2026-11-04)
def norm(s: str) -> str:
    return re.sub(r"[^0-9a-z\u0900-\u097f\u0a80-\u0aff]", "", (s or "").casefold())


def lev(a, b) -> int:
    """Edit distance between two sequences (strings or lists of words)."""
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def char_acc(got: str, truth: str) -> float:
    n = max(len(got), len(truth))
    return 1.0 if n == 0 else 1 - lev(got, truth) / n


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "").strip()


def script_of(text: str) -> str:
    """latin / devanagari / gujarati / other, by counting letters per Unicode block (digits count as latin)."""
    counts = {"latin": 0, "devanagari": 0, "gujarati": 0, "other": 0}
    for ch in text:
        o = ord(ch)
        if ch.isspace() or not (ch.isalnum() or 0x0900 <= o <= 0x0AFF):
            continue
        if o < 0x0250:
            counts["latin"] += 1
        elif 0x0900 <= o <= 0x097F:
            counts["devanagari"] += 1
        elif 0x0A80 <= o <= 0x0AFF:
            counts["gujarati"] += 1
        else:
            counts["other"] += 1
    best = max(counts, key=counts.get)
    return best if counts[best] else "latin"


def dob_variants(value: str) -> list[str]:
    """A date as the review form stores it (ISO 1990-02-01) and as cards print it (01/02/1990, 01-02-1990)."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", (value or "").strip())
    if not m:
        return [value]
    y, mo, d = m.groups()
    return [value, f"{d}/{mo}/{y}", f"{d}-{mo}-{y}", f"{d}.{mo}.{y}"]


# ---------------------------------------------------------------- privacy
def load_or_create_salt(folder: Path) -> bytes:
    path = Path(folder) / ".salt"
    if path.exists():
        return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    salt = secrets.token_bytes(32)
    path.write_bytes(salt)
    return salt


def hkey(salt: bytes, kind: str, value: str) -> str:
    """Salted hash of a personal key. Only these hashes go into manifests; plain values never do."""
    return hmac.new(salt, f"{kind}:{value}".encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def find_git_root(path: Path) -> Path | None:
    p = Path(path).resolve()
    for candidate in [p, *p.parents]:
        if (candidate / ".git").exists():
            return candidate
    return None


def refuse_inside_repo(out: Path) -> str | None:
    """A reason to refuse an output folder (inside this repository or any git work tree), else None."""
    out = Path(out).resolve()
    repo = find_git_root(TRAINING_DIR)
    if repo and (out == repo or repo in out.parents):
        return "the output folder is inside the HMS repository; use a short path outside it, for example D:\\hmsd\\ds1"
    if find_git_root(out):
        return "the output folder is inside a git work tree; choose a folder outside any repository"
    return None


def long_path_warning(path: Path, budget: int = 70) -> str | None:
    if len(str(Path(path).resolve())) > budget:
        return f"warning: output path is longer than {budget} characters; Windows long paths are off, keep it short (for example D:\\hmsd\\ds1)"
    return None


# ---------------------------------------------------------------- images
def iter_photos(folder: Path):
    """Streams photo paths under `folder` (sorted per directory, read-only)."""
    for root, dirs, files in os.walk(folder):
        dirs.sort()
        for name in sorted(files):
            if Path(name).suffix.lower() in IMG_EXT:
                yield Path(root) / name


def read_image(path: Path):
    import cv2
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    return img


def write_image(path: Path, img, quality: int = 95) -> None:
    import cv2
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = path.suffix.lower()
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext in (".jpg", ".jpeg") else []
    ok, buf = cv2.imencode(ext, img, params)
    if not ok:
        raise OSError("could not encode image")
    buf.tofile(str(path))


def crop_quad(img, quad) -> np.ndarray:
    """Perspective crop of a text line given 4 corner points (any order). Tall crops (vertical text) are turned upright."""
    import cv2
    pts = np.array(quad, dtype=np.float32).reshape(4, 2)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    ordered = np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)
    w = int(max(np.linalg.norm(ordered[0] - ordered[1]), np.linalg.norm(ordered[2] - ordered[3])))
    h = int(max(np.linalg.norm(ordered[0] - ordered[3]), np.linalg.norm(ordered[1] - ordered[2])))
    w, h = max(w, 1), max(h, 1)
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    crop = cv2.warpPerspective(img, cv2.getPerspectiveTransform(ordered, dst), (w, h),
                               borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_CUBIC)
    if h > 1.5 * w:
        crop = np.rot90(crop)
    return np.ascontiguousarray(crop)


def dhash(img, size: int = 8) -> str:
    """Perceptual difference hash: the same photo saved twice (or re-compressed) gets the same value."""
    import cv2
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (size + 1, size), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return "%016x" % int("".join("1" if b else "0" for b in bits), 2)


# ---------------------------------------------------------------- OCR (RapidOCR primary, as in the reader)
class RapidLines:
    """Detection + recognition with the RapidOCR package (PP-OCR models on onnxruntime). Returns
    [{"quad": [[x,y]*4], "text", "conf", "engine"}]. An optional replacement recognition model (a fine-tuned ONNX)
    can be given; its character list is read from the model metadata or from a keys file."""

    def __init__(self, rec_model: str | None = None, rec_keys: str | None = None, threads: int | None = None) -> None:
        from rapidocr_onnxruntime import RapidOCR
        threads = threads or int(os.environ.get("OMP_NUM_THREADS", "1"))  # the guard sets this cap first
        kw = {"intra_op_num_threads": max(1, threads), "inter_op_num_threads": 1}
        if rec_model:
            kw["rec_model_path"] = rec_model
        if rec_keys:
            kw["rec_keys_path"] = rec_keys
        self._ocr = RapidOCR(**kw)

    def __call__(self, img) -> list[dict]:
        result, _ = self._ocr(img)
        return [{"quad": [[float(x), float(y)] for x, y in box], "text": text, "conf": float(conf), "engine": "rapidocr"}
                for box, text, conf in (result or [])]


class TesseractLine:
    """Tesseract for one line crop (Gujarati / Devanagari), when it is installed. Command line only, no shell."""

    def __init__(self, exe: str = "", tessdata: str = "") -> None:
        import shutil
        default = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        self.exe = exe or shutil.which("tesseract") or (default if Path(default).exists() else "")
        self.tessdata = tessdata

    def available(self) -> bool:
        return bool(self.exe) and Path(self.exe).exists()

    def languages(self) -> set[str]:
        import subprocess
        if getattr(self, "_langs", None) is None:
            if self.tessdata:
                self._langs = {p.stem for p in Path(self.tessdata).glob("*.traineddata")}
            else:
                out = subprocess.run([self.exe, "--list-langs"], capture_output=True, timeout=60, check=False).stdout
                self._langs = {x.strip() for x in out.decode("utf-8", "replace").splitlines()[1:] if x.strip()}
        return self._langs

    def read(self, crop, langs: str) -> tuple[str, float]:
        import subprocess
        import tempfile
        import cv2
        with tempfile.TemporaryDirectory(prefix="tr-") as tmp:
            p = str(Path(tmp) / "l.png")
            cv2.imwrite(p, crop)
            args = [self.exe, p, "stdout", "-l", langs, "--psm", "7", "-c", "tessedit_create_tsv=1"]
            if self.tessdata:
                args += ["--tessdata-dir", self.tessdata]
            done = subprocess.run(args, capture_output=True, timeout=60, check=False, shell=False)
        words, confs = [], []
        for row in done.stdout.decode("utf-8", "replace").splitlines()[1:]:
            cols = row.split("\t")
            if len(cols) >= 12 and cols[0] == "5" and cols[11].strip() and float(cols[10]) >= 0:
                words.append(cols[11].strip())
                confs.append(float(cols[10]) / 100)
        return " ".join(words), (sum(confs) / len(confs) if confs else 0.0)
