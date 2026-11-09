"""checkin-demo with a FAKE reader on 127.0.0.1 (standard library only, INVENTED guests). Run from the checkin-demo folder:

    python -m unittest discover -s tests -v"""
from __future__ import annotations

import base64
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app  # noqa: E402

PNG_1 = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")


def field(value: str) -> dict:
    return {"value": value, "confidence": 0.9, "source": "ocr"}


SEVERAL = {"cards": 4, "flags": [], "needsHumanCheck": True, "regions": [], "people": [
    {"personId": 1, "regions": [1, 2], "evidence": "aadhaarNumber", "confidence": 1.0, "documentType": {"type": "aadhaar", "confidence": 0.9},
     "fields": {"name": field("Anil Mehra"), "dob": field("1981-03-14"), "documentNumber": field("284736192056"),
                "address": field("12 Lake View Road, Surat")}, "doubtfulFields": [], "suggestedName": "Anil_Mehra_Aadhaar",
     "flags": [], "needsHumanCheck": False, "image": base64.b64encode(PNG_1).decode(), "imageFormat": "png",
     "clarity": {"grade": "clear", "cards": [{"region": 1, "side": "front", "grade": "clear", "reasons": [], "advice": None},
                                             {"region": 2, "side": "back", "grade": "clear", "reasons": [], "advice": None}],
                 "advice": None, "unclearFields": []},
     "photo": {"outcome": "notCompared", "portraits": [{"region": 1, "side": "front", "status": "found", "reasons": []}], "checks": []}},
    {"personId": 2, "regions": [3], "evidence": "none", "confidence": 0.0, "documentType": {"type": "aadhaar", "confidence": 0.8},
     "fields": {"name": field("Kavita Joshi"), "dob": field("1990-11-02")}, "doubtfulFields": ["dob"], "suggestedName": "Kavita_Joshi_Aadhaar",
     "flags": ["unpairedSide", "unclearCard", "keyFieldUnclear"], "needsHumanCheck": True,
     "image": base64.b64encode(b"\xff\xd8\xff invented jpeg").decode(), "imageFormat": "jpeg",
     "clarity": {"grade": "unclear", "cards": [{"region": 3, "side": "front", "grade": "unclear", "reasons": ["card blurred", "number line blurred"],
                                                "advice": "Retake this card: hold the phone still."}],
                 "advice": "Retake this card: hold the phone still.", "unclearFields": ["dob"]},
     "photo": {"outcome": "unclear", "portraits": [{"region": 3, "side": "front", "status": "unclear", "reasons": ["portrait blurred"]}], "checks": []}},
    {"personId": 3, "regions": [4], "evidence": "none", "confidence": 0.0, "documentType": {"type": "aadhaar", "confidence": 0.9},
     "fields": {"name": field("Rohit Shah"), "dob": field("1985-06-05")}, "doubtfulFields": [], "suggestedName": "Rohit_Shah_Aadhaar",
     "flags": ["unpairedSide", "photoMismatch"], "needsHumanCheck": True, "image": base64.b64encode(PNG_1).decode(), "imageFormat": "png",
     "clarity": {"grade": "clear", "cards": [{"region": 4, "side": "front", "grade": "clear", "reasons": [], "advice": None}],
                 "advice": None, "unclearFields": []},
     "photo": {"outcome": "mismatch", "portraits": [{"region": 4, "side": "front", "status": "found", "reasons": []}],
               "checks": [{"withRegion": 5, "use": "duplicate", "outcome": "mismatch", "score": 0.12}]}},
]}
SINGLE = {"documentType": {"type": "pan"}, "fields": {"name": field("Suresh Patel"), "documentNumber": field("ABCPS1234F")},
          "needsHumanCheck": True, "doubtfulFields": [], "flags": ["unclearCard"],
          "clarity": {"grade": "unclear", "reasons": ["glare on card (6%)"], "advice": "Retake this card: tilt it away from the lamp.",
                      "side": "single", "unclearFields": []},
          "photo": {"outcome": "notCompared", "portraits": [{"side": "single", "status": "found", "reasons": []}], "checks": []}}


class FakeReader(BaseHTTPRequestHandler):
    """An older reader by default (one call); with `split` set it answers picture=later like the reader's two parts: the fast
    answer with a token (no picture), then GET /v1/picture/{token} gives `picture_body` once."""
    seen: list[str] = []
    multi_body: dict = SEVERAL
    split = False
    picture_body: dict = {}
    pictures: dict[str, dict] = {}

    def log_message(self, *a):
        pass

    def answer(self, code: int, body: dict) -> None:
        out = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def do_POST(self):  # noqa: N802
        raw = self.rfile.read(int(self.headers["Content-Length"])).decode("latin-1")
        FakeReader.seen.append(raw)
        body = FakeReader.multi_body if 'name="multi"\r\n\r\ntrue' in raw else SINGLE
        if FakeReader.split and 'name="picture"\r\n\r\nlater' in raw:
            token = f"t{len(FakeReader.pictures)}"
            FakeReader.pictures[token] = FakeReader.picture_body
            body = {**body, "picture": {"token": token, "status": "saving"}}
            if "people" in body:  # the fast answer of a sheet carries no picture
                body["people"] = [{k: v for k, v in p.items() if k not in ("image", "imageFormat")} for p in body["people"]]
        self.answer(200, body)

    def do_GET(self):  # noqa: N802
        token = self.path.split("/v1/picture/", 1)[-1].split("?", 1)[0]
        if self.headers.get("X-Reader-Key") != os.environ.get("READER_KEY") or token not in FakeReader.pictures:
            self.answer(404, {"error": {"code": "unknown_token"}})
            return
        self.answer(200, FakeReader.pictures.pop(token))


class CheckinTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reader = ThreadingHTTPServer(("127.0.0.1", 0), FakeReader)
        threading.Thread(target=cls.reader.serve_forever, daemon=True).start()
        base, path, header, env = app.SERVICES["read"]
        app.SERVICES["read"] = (f"http://127.0.0.1:{cls.reader.server_address[1]}", path, header, env)
        os.environ["READER_KEY"] = "k" * 40
        cls.demo = ThreadingHTTPServer(("127.0.0.1", 0), app.H)
        threading.Thread(target=cls.demo.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.demo.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.reader.shutdown()
        cls.demo.shutdown()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        app.DATA, app.IMAGES = self.tmp / "data", self.tmp / "images"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def call(self, path: str, body: bytes | None = None, method: str = "POST") -> tuple[int, bytes, str]:
        req = urllib.request.Request(self.url + path, data=body, method=method)
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "")

    def upload(self, multi: bool) -> str:
        _, body, _ = self.call(f"/api/upload?multi={int(multi)}&name=sheet.jpg", b"invented photo bytes")
        return json.loads(body)["token"]

    def form(self, first: str, last: str, id_type: str = "aadhaar", room: str = "101") -> dict:
        return {"firstName": first, "lastName": last, "dob": "", "idType": id_type, "idNumber": "", "address": "", "phone": "",
                "email": "", "room": room, "nights": "1", "checkin": "2026-11-04"}

    def test_several_ids_one_form_per_person_each_saved_as_its_own_row(self):
        token = self.upload(True)
        _, body, _ = self.call(f"/api/step?token={token}&step=read")
        step = json.loads(body)
        self.assertEqual(step["status"], "warn")  # one guest needs a check
        self.assertIn("4 cards cut, 3 guests (1 with front and back merged); 2 need a check", step["detail"])
        people = step["people"]
        self.assertEqual([p["label"] for p in people], ["Anil Mehra", "Kavita Joshi", "Rohit Shah"])
        self.assertEqual((people[0]["firstName"], people[0]["lastName"], people[0]["idNumber"], people[0]["idType"]),
                         ("Anil", "Mehra", "284736192056", "aadhaar"))
        self.assertEqual(people[1]["doubtful"], ["dob"])
        self.assertTrue(people[1]["check"] and not people[0]["check"])
        sent = FakeReader.seen[-1]
        self.assertIn('name="merge"\r\n\r\nstack', sent)
        status, img, ctype = self.call(people[0]["image"], method="GET")
        self.assertEqual((status, img, ctype), (200, PNG_1, "image/png"))
        _, img2, ctype2 = self.call(people[1]["image"], method="GET")
        self.assertEqual(ctype2, "image/jpeg")

        first = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Anil", "Mehra"), "person": 0}).encode())[1])
        self.assertEqual((first["saved"], first["image"], first["remaining"]), (True, "Anil_Mehra_Aadhaar.png", 2))
        again = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Anil", "Mehra"), "person": 0}).encode())[1])
        self.assertFalse(again["saved"])  # one row per guest, never twice
        second = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Kavita", "Joshi", room="102"), "person": 1}).encode())[1])
        self.assertEqual((second["image"], second["remaining"]), ("Kavita_Joshi_Aadhaar.jpg", 1))
        third = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Rohit", "Shah", room="103"), "person": 2}).encode())[1])
        self.assertEqual((third["image"], third["remaining"]), ("Rohit_Shah_Aadhaar.png", 0))
        last = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Rohit", "Shah", room="103"), "person": 2}).encode())[1])
        self.assertFalse(last["saved"])  # the last guest saved twice (double click) is refused too, not a second row without the ID
        self.assertEqual((app.IMAGES / "Anil_Mehra_Aadhaar.png").read_bytes(), PNG_1)

        rows = [json.loads(l) for l in (app.DATA / "checkins.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 3)
        self.assertEqual([r["person"]["index"] for r in rows], [1, 2, 3])
        self.assertEqual(rows[0]["person"]["photo"], rows[1]["person"]["photo"])
        self.assertEqual(rows[0]["reader"]["fields"]["documentNumber"], "284736192056")
        self.assertEqual([(r["reader"]["review"]["grade"], r["reader"]["review"]["photo"]) for r in rows],
                         [("clear", "notCompared"), ("unclear", "unclear"), ("clear", "mismatch")])
        self.assertNotIn("score", json.dumps(rows))  # outcomes only in the saved rows
        report = self.call("/report", method="GET")[1].decode()
        self.assertIn("3 from photos with several IDs", report)
        self.assertIn("guest 1 of 3 in one photo (front + back, aadhaarNumber)", report)
        self.assertIn("guest 2 of 3 in one photo (one card, none)", report)
        self.assertIn("unpairedSide", report)
        self.assertIn("clarity unclear, photo unclear", report)
        self.assertIn("clarity clear, photo mismatch", report)
        csv_text = self.call("/report.csv", method="GET")[1].decode("utf-8-sig")
        self.assertIn("Kavita_Joshi_Aadhaar.jpg", csv_text)
        self.assertIn("aadhaarNumber", csv_text)
        self.assertIn("clarity,photo check", csv_text.splitlines()[0])
        self.assertTrue(csv_text.splitlines()[3].endswith(",clear,mismatch"))

    def test_each_guest_form_shows_clarity_reasons_photo_outcome_and_a_retake_hint(self):
        token = self.upload(True)
        people = json.loads(self.call(f"/api/step?token={token}&step=read")[1])["people"]
        ok, unclear, mismatch = (p["review"] for p in people)
        self.assertEqual((ok["level"], ok["grade"], ok["photo"]), ("ok", "clear", "notCompared"))
        self.assertEqual(ok["reasons"], [])
        # yellow: unclear card, its reasons, the unclear key field and the reader's retake line
        self.assertEqual((unclear["level"], unclear["grade"], unclear["photo"]), ("unclear", "unclear", "unclear"))
        self.assertEqual(unclear["reasons"], ["card blurred", "number line blurred"])
        self.assertEqual(unclear["unclearFields"], ["dob"])
        self.assertEqual(unclear["retake"], "Retake this card: hold the phone still.")
        self.assertIn("blurred", unclear["photoText"])
        # red: the ID photos do not match; the hint says to compare the face and retake or ask for the guest's own ID
        self.assertEqual((mismatch["level"], mismatch["photo"]), ("mismatch", "mismatch"))
        self.assertIn("do NOT look like the same person", mismatch["photoText"])
        self.assertIn("Compare the guest's face", mismatch["retake"])
        page = self.call("/", method="GET")[1].decode()
        self.assertIn("id=seen", page)
        self.assertIn(".seen.unclear{background:#fff3cd", page)
        self.assertIn(".seen.mismatch,.seen.rejected{background:#fde2e1", page)
        self.assertIn("Red = the ID photos do not match", page)

    def test_review_of_a_front_and_back_names_the_side_and_an_older_reader_gives_none(self):
        two = app.review({"grade": "unclear", "cards": [{"side": "front", "reasons": ["glare on card (6%)"]},
                                                         {"side": "back", "reasons": []}], "advice": None}, {"outcome": "match"}, [])
        self.assertEqual(two["reasons"], ["front: glare on card (6%)"])
        self.assertTrue(two["retake"].startswith("Retake this card"))  # no reader line: the demo's own hint
        self.assertEqual(app.review(None, None, [])["level"], "")
        flagged = app.review({"grade": "clear", "cards": []}, {"outcome": "unclear"}, ["photoMismatch"])
        self.assertEqual(flagged["level"], "mismatch")

    def test_single_id_photo_still_works_and_names_collide_safely(self):
        for _ in range(2):
            token = self.upload(False)
            step = json.loads(self.call(f"/api/step?token={token}&step=read")[1])
            self.assertEqual(step["prefill"]["firstName"], "Suresh")
            self.assertEqual((step["review"]["level"], step["review"]["reasons"]), ("unclear", ["glare on card (6%)"]))
            self.assertEqual(step["review"]["retake"], "Retake this card: tilt it away from the lamp.")
            saved = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Suresh", "Patel", "pan")}).encode())[1])
        self.assertEqual(saved["image"], "Suresh_Patel_PAN_2.jpg")
        self.assertIn("single ID photo", self.call("/report", method="GET")[1].decode())

    def picture(self, token: str) -> dict:
        for _ in range(100):
            state = json.loads(self.call(f"/api/picture?token={token}", method="GET")[1])
            if state["status"] != "saving":
                return state
            time.sleep(0.05)
        raise AssertionError("the picture never finished")

    def test_the_form_fills_from_the_quick_read_and_the_picture_is_saved_after_it(self):
        """MJ, 5 Nov 2026: the form fills from one quick read; the picture is cut, merged and compressed afterwards."""
        pan = {"people": [{"regions": [1], "evidence": "singleDocument", "documentType": {"type": "pan"}, "image": base64.b64encode(PNG_1).decode(),
                           "imageFormat": "png", "fields": {"name": field("Suresh Patel"), "documentNumber": field("ABCPS1234F")}}]}
        FakeReader.multi_body = pan
        try:
            token = self.upload(False)
            step = json.loads(self.call(f"/api/step?token={token}&step=read")[1])
            self.assertEqual((step["prefill"]["idNumber"], step["picture"]), ("ABCPS1234F", "saving"))
            self.assertTrue(any('name="mode"\r\n\r\nfast' in s and 'name="multi"' not in s for s in FakeReader.seen))
            state = self.picture(token)
            self.assertEqual((state["status"], state["differ"]), ("ok", []))
            self.assertEqual(self.call(state["image"], method="GET")[1], PNG_1)
            saved = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Suresh", "Patel", "pan")}).encode())[1])
            self.assertEqual(saved["image"], "Suresh_Patel_PAN.png")  # the merged picture, not the photo as taken
            page = self.call("/", method="GET")[1].decode()
            self.assertIn("After the form: cut, merge and save the ID picture", page)
        finally:
            FakeReader.multi_body = SEVERAL

    def test_a_background_reading_that_differs_asks_for_a_check(self):
        FakeReader.multi_body = {"people": [{"regions": [1], "documentType": {"type": "pan"}, "image": base64.b64encode(PNG_1).decode(),
                                             "imageFormat": "png", "fields": {"name": field("Suresh Patil"), "documentNumber": field("ABCPS1234F")}},
                                            {"regions": [2], "documentType": {"type": "pan"}, "fields": {"name": field("Someone Else")}}]}
        try:
            token = self.upload(False)
            self.call(f"/api/step?token={token}&step=read")
            state = self.picture(token)
            self.assertEqual((state["status"], state["differ"]), ("warn", ["name", "morePeople"]))
            saved = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Suresh", "Patel", "pan")}).encode())[1])
            row = [json.loads(l) for l in (app.DATA / "checkins.jsonl").read_text(encoding="utf-8").splitlines()][-1]
            self.assertEqual(row["reader"]["fields"]["name"], "Suresh Patel")  # the form's value stays
            self.assertTrue(row["reader"]["needsHumanCheck"] and row["reader"]["picture"]["differ"] == ["name", "morePeople"])
            self.assertTrue(saved["image"].endswith(".png"))
        finally:
            FakeReader.multi_body = SEVERAL

    def test_a_background_that_finds_another_card_keeps_the_photo_as_taken(self):
        token = self.upload(False)  # the fake background answer holds three other guests
        self.call(f"/api/step?token={token}&step=read")
        state = self.picture(token)
        self.assertEqual((state["status"], state["differ"]), ("warn", ["card"]))
        saved = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Suresh", "Patel", "pan")}).encode())[1])
        self.assertTrue(saved["image"].endswith(".jpg"))

    def test_single_id_uses_the_readers_two_parts_and_a_difference_asks_for_a_check(self):
        """The reader's own split (5 Nov 2026): ONE call with picture=later fills the form; the picture and what the background
        read differently come from GET /v1/picture/{token}; the form's values never change."""
        FakeReader.split = True
        FakeReader.picture_body = {"status": "done", "people": [{"personId": 1, "status": "done", "image": base64.b64encode(PNG_1).decode(),
                                                                 "imageFormat": "png", "disagreements": [{"code": "field", "field": "name"}]}]}
        try:
            before = len(FakeReader.seen)
            token = self.upload(False)
            step = json.loads(self.call(f"/api/step?token={token}&step=read")[1])
            self.assertEqual((step["prefill"]["idNumber"], step["picture"]), ("ABCPS1234F", "saving"))
            state = self.picture(token)
            self.assertEqual((state["status"], state["differ"]), ("warn", ["name"]))
            self.assertEqual(self.call(state["image"], method="GET")[1], PNG_1)
            self.assertEqual(len(FakeReader.seen) - before, 1)  # one call: the reader made the picture itself
            self.assertIn('name="picture"\r\n\r\nlater', FakeReader.seen[-1])
            saved = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Suresh", "Patel", "pan")}).encode())[1])
            row = [json.loads(l) for l in (app.DATA / "checkins.jsonl").read_text(encoding="utf-8").splitlines()][-1]
            self.assertEqual((saved["image"], row["reader"]["fields"]["name"]), ("Suresh_Patel_PAN.png", "Suresh Patel"))
            self.assertEqual(row["reader"]["picture"]["differ"], ["name"])
        finally:
            FakeReader.split = False

    def test_several_ids_fill_one_tab_per_guest_first_and_the_pictures_follow(self):
        """MJ, 5 Nov 2026: a sheet of many IDs fills the forms fast. The tabs come from the fast answer (no pictures yet); each
        guest's picture follows; a guest only the background found becomes one more tab to check."""
        FakeReader.split = True
        extra = {**SEVERAL["people"][0], "personId": None, "backgroundOnly": True, "fields": {"name": field("Meena Desai")},
                 "suggestedName": "Meena_Desai_Aadhaar", "disagreements": [{"code": "backgroundOnly"}]}
        FakeReader.picture_body = {"status": "done", "people": [
            {"personId": 1, "status": "done", "image": base64.b64encode(PNG_1).decode(), "imageFormat": "png", "disagreements": []},
            {"personId": 2, "status": "done", "image": base64.b64encode(b"\xff\xd8\xff invented jpeg").decode(), "imageFormat": "jpeg",
             "disagreements": [{"code": "field", "field": "dob"}]},
            {"personId": 3, "status": "done", "image": base64.b64encode(PNG_1).decode(), "imageFormat": "png", "disagreements": []},
            extra]}
        try:
            token = self.upload(True)
            step = json.loads(self.call(f"/api/step?token={token}&step=read")[1])
            self.assertEqual(step["picture"], "saving")
            self.assertEqual([p["label"] for p in step["people"]], ["Anil Mehra", "Kavita Joshi", "Rohit Shah"])
            self.assertTrue(all(p["image"] == "" for p in step["people"]))  # the forms come first, before any picture
            state = self.picture(token)
            self.assertEqual(state["status"], "warn")
            self.assertIn("3 pictures cut, merged and compressed; 1 read differently", state["detail"])
            people = state["people"]
            self.assertEqual([p["label"] for p in people], ["Anil Mehra", "Kavita Joshi", "Rohit Shah", "Meena Desai"])
            self.assertEqual((people[1]["differ"], people[1]["check"], people[3]["check"]), (["dob"], True, True))
            self.assertEqual(self.call(people[0]["image"], method="GET")[1], PNG_1)
            first = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Anil", "Mehra"), "person": 0}).encode())[1])
            self.assertEqual((first["image"], first["remaining"]), ("Anil_Mehra_Aadhaar.png", 3))
            second = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Kavita", "Joshi"), "person": 1}).encode())[1])
            self.assertEqual(second["image"], "Kavita_Joshi_Aadhaar.jpg")
            row = [json.loads(l) for l in (app.DATA / "checkins.jsonl").read_text(encoding="utf-8").splitlines()][-1]
            self.assertEqual(row["reader"]["picture"]["differ"], ["dob"])
            self.assertEqual(row["reader"]["fields"]["dob"], "1990-11-02")  # the form's value stays
        finally:
            FakeReader.split = False

    def test_a_picture_the_reader_cannot_make_keeps_the_photo_as_taken(self):
        FakeReader.split = True
        FakeReader.picture_body = {"status": "failed", "error": {"code": "internal"}}
        try:
            token = self.upload(False)
            self.call(f"/api/step?token={token}&step=read")
            state = self.picture(token)
            self.assertEqual(state["status"], "skipped")
            saved = json.loads(self.call("/api/save", json.dumps({"token": token, "form": self.form("Suresh", "Patel", "pan")}).encode())[1])
            self.assertTrue(saved["image"].endswith(".jpg"))  # the photo as taken
        finally:
            FakeReader.split = False

    def test_steps_without_scanner_and_gate_are_skipped_and_the_page_has_tabs(self):
        os.environ.pop("SCANNER_KEY", None)
        token = self.upload(True)
        self.assertEqual(json.loads(self.call(f"/api/step?token={token}&step=scan")[1])["status"], "skipped")
        page = self.call("/", method="GET")[1].decode()
        self.assertIn('id=tabs', page)
        self.assertIn("This photo holds several IDs", page)
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.call("/api/image?token=nope&person=0", method="GET")
        self.assertEqual(ctx.exception.code, 404)


if __name__ == "__main__":
    unittest.main()


class RulesTest(unittest.TestCase):
    """MJ's rules (5 Nov 2026): an unclear ID photo rejects the card (red, retake, never saved); RARE namesakes save as ..._Rare."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        app.DATA, app.IMAGES = self.tmp / "data", self.tmp / "images"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_rejected_card_shows_the_reason_and_is_never_saved(self):
        rejected = {"code": "photo_unclear", "message": app.PHOTO_RETAKE,
                    "cards": [{"region": 1, "side": "front", "reason": "photo on the ID blurred"}]}
        person = app.person_entry({**SEVERAL["people"][0], "rejected": rejected, "status": "rejected", "image": ""})
        self.assertEqual(person["review"]["level"], "rejected")
        self.assertEqual(person["review"]["retake"], app.PHOTO_RETAKE)
        self.assertIn("photo on the ID blurred", person["review"]["reasons"])
        app.UPLOADS["t-rej"] = {"name": "x.jpg", "data": b"x", "people": [person], "saved": set(), "photo": "x.jpg", "read": {}}
        out = app.save_checkin({"token": "t-rej", "person": 0, "form": {"firstName": "Anil", "lastName": "Mehra", "idType": "aadhaar"}})
        self.assertEqual(out, {"saved": False, "error": app.PHOTO_RETAKE})
        self.assertFalse((app.DATA / "checkins.jsonl").exists())
        app.UPLOADS.pop("t-rej", None)

    def test_rare_guest_is_saved_with_rare_in_the_file_name_and_no_warning(self):
        person = app.person_entry({**SEVERAL["people"][0], "rare": True, "flags": ["unpairedSide", "sameNameDobNoNumber", "rare"]})
        self.assertTrue(person["rare"])
        self.assertNotEqual(person["review"]["level"], "rejected")
        self.assertEqual(app.image_stem({"firstName": "Rohit", "lastName": "Shah", "idType": "aadhaar"}, True), "Rohit_Shah_Aadhaar_Rare")
        app.UPLOADS["t-rare"] = {"name": "x.jpg", "data": b"x", "people": [person], "saved": set(), "photo": "x.jpg", "read": {}}
        out = app.save_checkin({"token": "t-rare", "person": 0, "form": {"firstName": "Rohit", "lastName": "Shah", "idType": "aadhaar"}})
        self.assertTrue(out["saved"])
        self.assertTrue(out["image"].startswith("Rohit_Shah_Aadhaar_Rare."))
        app.UPLOADS.pop("t-rare", None)
