"""A fake reader on 127.0.0.1 (invented answers only) and an invented photo folder."""
from __future__ import annotations

import base64
import json
import struct
import sys
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

KEY = "test-key-invented"


def tiny_png(rgb=(200, 180, 120)) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * 4 for _ in range(4))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


CROP = base64.b64encode(tiny_png()).decode()


def multi_new() -> dict:
    """Invented two-person sheet: a front+back pair by number, a lone front paired by position, a refused card."""
    def region(i, side, kind, fields, grade, reasons=(), reject=None, photo="found"):
        r = {"regionId": i, "quad": [[0, 0], [1, 0], [1, 1], [0, 1]], "side": side, "documentType": {"type": kind, "confidence": 0.9},
             "fields": {k: {"value": v, "confidence": 0.91} for k, v in fields.items()}, "confidence": 0.9, "flags": [],
             "needsHumanCheck": False, "crop": CROP,
             "clarity": {"grade": grade, "reasons": list(reasons), "advice": None, "scores": {}, "regions": {}},
             "photo": {"status": photo, "reasons": [], "checks": []}}
        if reject:
            r["clarity"]["photoReject"] = {"reason": reject}
            r["retake"] = "Photo on the ID is not clear, please retake."
        return r
    regions = [
        region(1, "front", "aadhaar", {"name": "Asha Verma", "dob": "01/02/1990", "documentNumber": "2345 6789 0123"}, "clear"),
        region(2, "back", "aadhaar", {"address": "12 Lake Road Testpur", "documentNumber": "2345 6789 0123"}, "usable", ["glare"]),
        region(3, "front", "driving-licence", {"name": "Ravi Kumar", "dob": "05/06/1985"}, "unclear", ["photoBlurred"],
               reject="photoBlurred", photo="unclear"),
        region(4, "back", "driving-licence", {"address": "4 Hill Street Demotown"}, "clear"),
    ]
    people = [
        {"personId": 1, "regions": [1, 2], "evidence": "aadhaarNumber", "confidence": 1.0, "documentType": {"type": "aadhaar"},
         "fields": {}, "doubtfulFields": ["dob"], "flags": [], "rare": False, "clarity": {"grade": "usable"},
         "photo": {"outcome": "notCompared"}, "needsHumanCheck": False},
        {"personId": 2, "regions": [3, 4], "evidence": "position", "pairedByPosition": True, "confidence": 0.5,
         "documentType": {"type": "driving-licence"}, "fields": {}, "doubtfulFields": [], "flags": ["pairedByPosition", "rare"],
         "suggestedName": "Ravi_Kumar_DrivingLicence_Rare", "clarity": {"grade": "unclear"}, "photo": {"outcome": "unclear"},
         "reject": {"code": "photo_unclear", "message": "Photo on the ID is not clear, please retake.", "cards": [{"card": 3, "reason": "photoBlurred"}]},
         "needsHumanCheck": True},
    ]
    return {"cards": 4, "regions": regions, "people": people, "flags": [], "needsHumanCheck": True}


def multi_old() -> dict:
    """A multi answer from a reader without clarity / photo / rare / reject fields (before 4 Nov)."""
    res = multi_new()
    for r in res["regions"]:
        for k in ("clarity", "photo", "retake", "crop"):
            r.pop(k, None)
    for p in res["people"]:
        for k in ("clarity", "photo", "reject", "rare", "pairedByPosition", "suggestedName"):
            p.pop(k, None)
        p["flags"] = [f for f in p["flags"] if f not in ("rare", "pairedByPosition")]
        if p["evidence"] == "position":
            p["evidence"], p["flags"] = "layout", ["pairedByLayoutOnly"]
    return res


def single_old() -> dict:
    """The one-document answer of an older reader (multi ignored)."""
    return {"documentType": {"type": "pan", "confidence": 0.95}, "doubtfulFields": ["dob"], "flags": [], "needsHumanCheck": False,
            "fields": {"name": {"value": "Meena Shah", "confidence": 0.9}, "dob": {"value": "09/09/1999", "confidence": 0.6},
                       "documentNumber": {"value": "ABCDE1234F", "confidence": 0.97, "valid": True}}}


class FakeReader:
    def __init__(self):
        self.answer = multi_new
        self.requests: list[dict] = []
        reader = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):  # noqa: N802
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                form = {}
                for part in body.split(b"--" + self.headers["Content-Type"].split("boundary=")[1].encode()):
                    if b'name="' in part and b"filename=" not in part:
                        name = part.split(b'name="')[1].split(b'"')[0].decode()
                        form[name] = part.split(b"\r\n\r\n", 1)[1].rstrip(b"\r\n").decode()
                reader.requests.append({"path": self.path, "key": self.headers.get("X-Reader-Key"), "form": form})
                if self.headers.get("X-Reader-Key") != KEY:
                    self.send_response(401)
                    self.end_headers()
                    return
                data = json.dumps(reader.answer()).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


@pytest.fixture()
def reader(monkeypatch):
    r = FakeReader()
    monkeypatch.setenv("READER_URL", r.url)
    monkeypatch.setenv("READER_KEY", KEY)
    yield r
    r.server.shutdown()


@pytest.fixture()
def photos(tmp_path):
    d = tmp_path / "photos"
    d.mkdir()
    for n in ("a.png", "b.png"):
        (d / n).write_bytes(tiny_png())
    return d
