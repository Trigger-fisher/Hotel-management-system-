"""The step runner: one job, every step in memory, in two parts (MJ, 5 Nov 2026).

 FAST part (reception waits for it, the form fills from it): download -> real type -> YARA + ClamAV -> pixel re-save -> quality gate ->
 find the card (classic finder, no model) -> read -> check -> photo and clarity -> group. Its fields are written to the job row
 (status `read`) before any picture is made.
 BACKGROUND part (no one waits): model cutter -> read the cards the fast part did not see -> photo and clarity -> group -> enhance ->
 merge -> compress -> encrypt -> upload (status `done`). It never changes a field the fast part wrote: a disagreement is a flag
 (`backgroundDisagrees`) and a check."""
from __future__ import annotations

import io
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image

from . import clarity
from . import compress as comp
from . import crypto, enhance, faces, links, mask, naming, people, yara_scan
from .clam import ClamClient, parse_version
from .config import JOB_SECONDS, STEP_SECONDS, Settings
from .errors import StepError, reject
from .gatecore.judge import evaluate
from .gatecore.metrics import measure_image
from .readcore import geometry
from .readcore import pair as pairing
from .readcore import preprocess
from .readcore.config import WorkerConfig as ReadConfig
from .readcore.doctypes import Context, detect, extract, registry
from .readcore.reader import ReadOptions, Reader
from .resave import Picture, real_type, resave
from .typeconfig import ConfiguredType

READ_SIDE = 2000  # the reader works on a copy no larger than this on the long side
KEY_FIELDS = ("documentNumber", "dob", "name")
# Scripts to read when the job row names none. Naming them skips the six-script probe, which was the biggest cost.
DEFAULT_LANGUAGES = ["en", "hi", "gu"]
TRUSTED_READ_CONFIDENCE = 0.85  # a card read without the orientation check is read again when it reads worse than this
PEOPLE_THREADS = int(os.environ.get("INTAKE_PEOPLE_THREADS", "4"))  # people of one sheet finished side by side (KVM 4: 4 cores)
READ_THREADS = int(os.environ.get("INTAKE_READ_THREADS", "3"))  # cards read side by side
MULTI_JOB_SECONDS = 600  # a sheet of up to 12 cards: cutting (about 30 s per sheet with the model) plus one read per card
FAST_STEPS = ["type", "scan", "rebuild", "gate", "find", "read", "inspect", "group"]
SAVE_STEPS = ["cut", "read", "inspect", "group", "enhance", "merge", "compress"]
MULTI_STEPS = FAST_STEPS + ["cut", "enhance", "merge", "compress"]  # the background part reads, inspects and groups only what is new
SINGLE_FAST = ["type", "scan", "rebuild", "gate", "read"]
SINGLE_SAVE = ["enhance", "merge", "compress"]
# jpegBlocking too (MJ, 5 Nov 2026): a heavily compressed photo is no longer refused before it is cut; the clarity check grades it
# ("picture too compressed", read from the original file) and the photo rule rejects a card whose ID photo is not clear.
MULTI_GATE_SKIP = frozenset({"cutOff", "extremeAspect", "documentSmallInFrame", "jpegBlocking"})
# Grouping and clarity flags that need a person to look (MJ, 4 Nov 2026)
# sameNameDobNoNumber needs a person only when it is NOT the rare case (MJ's RARE rule: full name + full date of birth, no warning).
CHECK_FLAGS = {"unpairedSide", "unknownSide", "ambiguousPair", "evidenceConflict", "sameNameDobNoNumber", "photoMismatch",
               "possibleSameGuest", "layoutSuggestsPair", "unclearCard", "keyFieldUnclear"}
INTERNAL_FLAGS = {"quickFinder", "pageCurved"}  # never shown: the fast part's finder, a reader hint
QUICK_DOUBT = {"lowContrastEdge", "ratioOff"}
QUAD_MATCH = 0.02  # a model cut IS a card of the fast part when every corner lies within this share of the card's long side
LOOSE_MATCH = 0.7  # else it is the same card, cut differently, when this share of the smaller outline is shared (read again)
COMPARED = ("name", "dob", "gender", "documentNumber", "address", "passportNumber", "visaNumber", "expiry", "nationality")
HANDOFF_JOBS = 8  # fast-part results kept in memory for the background part of the same job (else it downloads again)


def inspect_card(card: "people.Card") -> None:
    """Photo and clarity of one cut card, on the untouched (upright) pixels. The face embedding stays on card.face in memory."""
    if card.face is None:
        source_scale = card.size / max(card.image.shape[:2]) if card.size else 1.0
        card.face = faces.find_portrait(card.image, source_scale)
    card.clarity = clarity.assess(card.image, card.result, card.doc, card.kind, card.side, card.size or None, card.face,
                                  card.jpeg_quality)


_SIDE = ThreadPoolExecutor(max_workers=2, thread_name_prefix="portrait")


def _portrait(cut) -> "faces.Portrait":
    """The portrait of a cut card as inspect_card would find it on the same (unturned) pixels."""
    rgb = cv2.cvtColor(np.ascontiguousarray(cut.image), cv2.COLOR_BGR2RGB)
    q = np.asarray(cut.quad, np.float32).reshape(4, 2)
    size = float(max(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[3] - q[0])))
    return faces.find_portrait(rgb, size / max(rgb.shape[:2]) if size else 1.0)


def photo_rejects(job: dict) -> bool:
    """MJ's photo rule REJECTS (the default, gate_action reject); with gate_action warn the card is graded unclear, flagged
    photoUnclear and kept for a person to check, like every other quality finding."""
    return job.get("gate_action", "reject") == "reject"


def clarity_summary(cards: list[dict]) -> dict:
    """Person / job level: the worst card grade, every card's grade and reasons, the retake lines."""
    advice = [c["advice"] for c in cards if c.get("advice")]
    return {"grade": clarity.worst(c["grade"] for c in cards), "cards": cards, "advice": " ".join(dict.fromkeys(advice)) or None}


@dataclass
class Deps:
    settings: Settings
    engines: list
    http: object = None  # an httpx.Client, or None to create one per call
    clam: ClamClient | None = None
    timings: dict = field(default_factory=dict)


@dataclass
class Handoff:
    """What the fast part leaves in memory for the background part of the same job (pictures, the cards it read)."""
    pictures: list[Picture]
    info: dict
    multi: bool
    cards: list = field(default_factory=list)
    persons: list = field(default_factory=list)


@dataclass
class FastResult:
    people: list[dict]  # the form values, one per person (status `read`, or `rejected` by the photo rule)
    handoff: Handoff


# EVENTS.cb(done_step, ms, next_step): the folder runner's live view listens here (thread by thread);
# EVENTS.ready(people, ms): the fast part is done, the form can fill.
EVENTS = threading.local()


class Clock:
    """Per-step and per-job time limits, checked between steps and inside loops."""

    def __init__(self) -> None:
        self.job_end = time.monotonic() + JOB_SECONDS
        self.step_start = time.monotonic()
        self.started = self.step_start
        self.step = ""
        self.times: dict[str, int] = {}  # milliseconds per step (numbers only, safe to log)

    def start(self, step: str) -> None:
        now = time.monotonic()
        done, ms = self.step, round((now - self.step_start) * 1000)
        if self.step:
            self.times[self.step] = self.times.get(self.step, 0) + ms
        self.step_start = now
        self.step = step
        cb = getattr(EVENTS, "cb", None)
        if cb is not None:
            cb(done, ms, step)
        self.check()

    def finish(self) -> dict[str, int]:
        self.start("")
        return self.times

    def elapsed_ms(self) -> int:
        return round((time.monotonic() - self.started) * 1000)

    def check(self) -> None:
        now = time.monotonic()
        if now > self.job_end or now - self.step_start > STEP_SECONDS:
            raise reject("timeout", "The file took too long to process.", getattr(self, "step", "job"))


def _png(pixels: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, "PNG", compress_level=1)
    return buf.getvalue()


def _document_view(pixels: np.ndarray, result: dict) -> tuple[np.ndarray, float]:
    """(the document as the reader saw it: flattened from its quad and turned upright, its long side in source pixels).
    The reader's quad is on the copy shrunk to READ_SIDE; it is scaled back to the full picture first."""
    document = result.get("document") or {}
    quad = document.get("quad")
    view = pixels
    if quad is not None and len(np.asarray(quad).reshape(-1, 2)) == 4:
        scale = max(pixels.shape[:2]) / max(_shrunk(pixels).shape[:2])
        corners = np.asarray(quad, np.float32).reshape(4, 2) * scale
        view = geometry.warp(pixels, corners)
        long_px = clarity.source_long_px(corners, max(pixels.shape[:2]))
    else:
        long_px = float(max(pixels.shape[:2]))
    turn = int(document.get("rotationApplied") or 0)
    return (preprocess.rotate_cw(view, turn) if turn else view), long_px


def _shrunk(pixels: np.ndarray) -> np.ndarray:
    longest = max(pixels.shape[:2])
    if longest <= READ_SIDE:
        return pixels
    return cv2.resize(pixels, None, fx=READ_SIDE / longest, fy=READ_SIDE / longest, interpolation=cv2.INTER_AREA)


def _value(f) -> str:
    return "".join(str((f or {}).get("value") or "").split()).casefold()


def _same_place(a, b) -> bool:
    a, b = np.asarray(a, np.float32).reshape(4, 2), np.asarray(b, np.float32).reshape(4, 2)
    long_side = max(np.linalg.norm(a[1] - a[0]), np.linalg.norm(a[3] - a[0]), 1.0)
    return float(np.linalg.norm(a - b, axis=1).max()) <= QUAD_MATCH * long_side


def _overlap(a, b) -> float:
    """Shared area of two card outlines as a share of the smaller one."""
    a, b = np.asarray(a, np.float32).reshape(4, 2), np.asarray(b, np.float32).reshape(4, 2)
    inter, _ = cv2.intersectConvexConvex(a, b)
    smaller = min(abs(cv2.contourArea(a)), abs(cv2.contourArea(b)))
    return float(inter / smaller) if smaller > 0 else 0.0


def _covers(quad, shape) -> bool:
    q = np.asarray(quad, np.float32).reshape(4, 2)
    h, w = shape[:2]
    return q[:, 0].min() <= 1 and q[:, 1].min() <= 1 and q[:, 0].max() >= w - 1 and q[:, 1].max() >= h - 1


def _settled(card: "people.Card") -> bool:
    """A fast reading the background keeps as it is. A card of unknown type, with a doubtful field (an MRZ or number check that
    failed) or one the reader wants checked is read again on the model's cut: a second opinion that can only add a flag."""
    return not (card.doc.get("unknown") or card.doc.get("doubtful") or card.result.get("needsHumanCheck"))


def _warp_card(pixels: np.ndarray, quad, turn: int) -> np.ndarray:
    """A card picture from a quad written by the fast part (upright order TL, TR, BR, BL), turned as its reading was."""
    from .cardcut import _out_size, _warp
    q = np.asarray(quad, np.float32).reshape(4, 2)
    card = _warp(pixels, q, _out_size(q, False), False)
    return preprocess.rotate_cw(card, int(turn)) if turn else card


class Pipeline:
    def __init__(self, deps: Deps) -> None:
        self.d = deps
        self.reader_cfg = ReadConfig(tesseract=deps.settings.tesseract, tessdata=deps.settings.tessdata, job_seconds=JOB_SECONDS)
        self._handoffs: OrderedDict[str, Handoff] = OrderedDict()
        self._handoff_lock = threading.Lock()

    def options(self, **kw) -> ReadOptions:
        return ReadOptions(**{"codes": self.d.settings.read_qr, "side_by_side": True, **kw})

    # ---- steps -------------------------------------------------------------------------
    def scan(self, data: bytes, kind: str | None = None) -> str:
        """YARA rules on the bytes, then ClamAV. Returns the engines that ran ("none" only in a test or folder run without both)."""
        engines = []
        if yara_scan.available():
            hits = yara_scan.scan(data, kind or real_type(data))
            if hits:
                raise reject("yara_match", hits[0][1] + ".", "scan")
            engines.append(yara_scan.engine_name())
        elif not self.d.settings.allow_no_av:
            raise StepError("yara_unavailable", "The rule scanner is not installed.", 503, False, "scan")
        if not self.d.settings.clamd:
            if self.d.settings.allow_no_av:
                return " + ".join(engines) or "none"
            raise StepError("scanner_unconfigured", "The virus scanner is not configured.", 500, False, "scan")
        clam = self.d.clam or ClamClient(self.d.settings.clamd, 30.0)
        try:
            result = clam.scan(data)  # raises StepError("scanner_unavailable") when clamd cannot answer: never "clean" by accident
        except StepError as err:
            err.step = err.step or "scan"
            raise
        if result.infected:
            raise reject("malware_found", "A virus signature matched this file.", "scan")
        return " + ".join([parse_version(clam.version())[0] or "ClamAV"] + engines)

    def gate(self, pictures: list[Picture], profile: str, action: str, skip_more: frozenset = frozenset()) -> tuple[list[dict], list[str]]:
        scores_out, flags = [], []
        for pic in pictures:
            scores = measure_image(cv2.cvtColor(pic.pixels, cv2.COLOR_RGB2BGR))
            # The worker judges the whole re-saved picture, so its long side is the document's long side for the dpi estimate
            # (a small card in a big frame is still caught by documentSmallInFrame).
            scores["contentLongSidePx"] = max(scores["width"], scores["height"])
            # Step 6 judges blur, glare, dark, small, cut off and blank. "Small in the frame" is left to the finder in step 7.
            skip = frozenset({"documentSmallInFrame"}) | skip_more | (frozenset({"blurry"}) if pic.hint_text and len(pic.hint_text) > 20 else frozenset())
            reasons = evaluate(scores, profile if profile != "multi-id" else "id-card", skip)
            scores_out.append({k: scores[k] for k in ("blurLaplacian", "blurGradient", "brightness", "contrast", "glare", "width", "height")})
            for r in reasons:
                if r["severity"] == "reject" and action == "reject":
                    raise reject(r["code"], r["message"], "gate")
                if r["severity"] in ("reject", "warn"):
                    flags.append(r["code"])
        return scores_out, list(dict.fromkeys(flags))

    def read_one(self, pic: Picture, job: dict, find_document: bool) -> tuple[dict, dict]:
        reader = Reader(self.d.engines, self.reader_cfg)
        result = reader.read_image(_png(_shrunk(pic.pixels)), self.options(languages=job.get("languages") or DEFAULT_LANGUAGES, mode="fast",
                                                                          find_document=find_document))
        return result, self.document(result, job, pic)

    def document(self, result: dict, job: dict, pic: Picture | None = None) -> dict:
        """Guess the type (always returned for reception to confirm) and extract the fields; a type hint or typeConfig from
        the job row decides the extractor, so a type can be added without changing worker code."""
        ctx = Context.from_result(result)
        if pic is not None and pic.hint_text:  # the PDF text layer, as a read-only hint for the cross-check
            extra = pic.hint_text.splitlines()
            ctx.lines = ctx.lines + [{"text": t, "confidence": 0.9} for t in extra if t.strip()]
            ctx.text += "\n" + "\n".join(extra)
            ctx.lower = ctx.text.casefold()
        guess = detect(ctx)
        hint, config = job.get("document_type"), job.get("type_config")
        chosen = guess["type"]
        fields: dict
        if config and (not hint or hint == config.get("name")):
            fields = ConfiguredType(config).extract(ctx)
            chosen = ConfiguredType(config).name
        elif hint and any(t.name == hint for t in registry()):
            fields, chosen = extract(ctx, hint), hint
        else:
            fields = extract(ctx, guess["type"])
        doubtful = [k for k, f in fields.items() if f.get("valid") is False or f.get("doubtful")]
        return {"type": chosen, "guessedType": guess["type"], "confidence": guess["confidence"], "fields": fields,
                "doubtful": doubtful, "unknown": chosen == "unknown"}

    def key_values(self, doc: dict) -> dict:
        return {k: doc["fields"][k]["value"] for k in KEY_FIELDS if k in doc["fields"]}

    # ---- the worker's two parts ------------------------------------------------------------------------------------------
    def process(self, job: dict, report=None) -> dict:
        """Both parts one after the other (tests, a single-threaded caller): the fast values, then the background's."""
        form = self.process_fast(job, report)
        return self.process_background({**job, "read": form}, report)

    @staticmethod
    def _reporting(report, work, job: dict) -> dict:
        """report(step) is told each step as it starts (the worker writes it to the job row, so a killed job keeps its step)."""
        if report is None:
            return work(job)
        before = getattr(EVENTS, "cb", None)
        EVENTS.cb = lambda done, ms, step: (before and before(done, ms, step), step and report(step))
        try:
            return work(job)
        finally:
            EVENTS.cb = before

    def process_fast(self, job: dict, report=None) -> dict:
        """The fast part of a worker job: what the job row gets with status `read` (the form fills from it). Nothing is saved."""
        return self._reporting(report, self._process_fast, job)

    def _process_fast(self, job: dict) -> dict:
        clock = Clock()
        # The job row has ONE upload link, so a worker job stays on the one-result path (people per job need a link per person).
        if job.get("multi"):
            raise StepError("multi_not_supported", "Several people per job need one upload link per person.", 400, False, "download")
        clock.start("download")
        files = self._download(job)
        fast = self.fast(files, {**job, "multi": None}, clock)
        del files
        form = fast.people[0]
        if form.get("status") == "rejected":
            raise reject("photo_unclear", clarity.PHOTO_RETAKE, "read")  # MJ's rule: an unclear ID photo rejects the card
        if len(fast.people) > 1:  # one guest per job: the form fills from the first person, a person checks the rest
            form["flags"] = sorted(set(form["flags"]) | {"severalPeople"})
            form["needs_human_check"] = True
        self.keep(str(job["id"]), fast.handoff)
        return form

    def process_background(self, job: dict, report=None) -> dict:
        """The background part of a worker job: cut, compare, enhance, merge, compress, encrypt, upload. `job["read"]` holds what
        the fast part wrote. It returns only what the background may write (never the fields)."""
        return self._reporting(report, self._process_background, job)

    def _process_background(self, job: dict) -> dict:
        form = job["read"]
        clock = Clock()
        clock.job_end = clock.step_start + MULTI_JOB_SECONDS
        handoff = self.take(str(job["id"]))
        if handoff is None:  # another worker, or a retry after a crash: the pictures come again from the signed link
            clock.start("download")
            handoff = self.prepare(self._download(job), {**job, "multi": None}, clock)
        values, blob = self.background(handoff, job, [form], clock)[0]
        del handoff

        clock.start("encrypt")
        aad = str(job["id"]).encode()
        data_key = crypto.unwrap_key(job["wrapped_key"], self.d.settings.master_key, str(job["hotel_id"]).encode())
        sealed = crypto.encrypt(blob, data_key, aad)
        del data_key, blob
        clock.start("upload")
        still_mine = job.get("still_mine")
        if still_mine is not None and not still_mine():  # the attempt guard: a later attempt owns the job and its upload link
            raise StepError("superseded", "A later attempt owns this job.", 409, False, "upload")
        links.upload(job["upload_url"], sealed, self.d.settings.allowed_hosts, self.d.http)
        times = clock.finish()
        values["result_bytes"] = len(sealed)
        values["timings"]["background"] = {"steps": dict(times), "ms": clock.elapsed_ms()}
        return values

    def _download(self, job: dict) -> list[bytes]:
        files = [links.download(job["download_url"], self.d.settings.allowed_hosts, self.d.http)]
        if job.get("back_download_url"):
            files.append(links.download(job["back_download_url"], self.d.settings.allowed_hosts, self.d.http))
        return files

    def keep(self, job_id: str, handoff: Handoff) -> None:
        with self._handoff_lock:
            self._handoffs[job_id] = handoff
            while len(self._handoffs) > HANDOFF_JOBS:
                self._handoffs.popitem(last=False)

    def take(self, job_id: str) -> Handoff | None:
        with self._handoff_lock:
            return self._handoffs.pop(job_id, None)

    def intake(self, files: list[bytes], clock: Clock) -> tuple[list[Picture], str]:
        """Steps type, scan, re-save. Returns (pictures, scan engine)."""
        pictures: list[Picture] = []
        engine = "none"
        for blob in files:
            clock.start("type")
            kind = real_type(blob)
            clock.start("scan")
            engine = self.scan(blob, kind)
            clock.start("rebuild")
            pics = resave(blob, clock.check)  # first: its header checks refuse a bomb before anything else opens the file
            # The JPEG quality is read from the ORIGINAL bytes, long before the cutter resamples a card.
            quality = clarity.jpeg_quality(blob)
            for pic in pics:
                pic.jpeg_quality = quality
                pictures.append(pic)
        return pictures, engine

    def is_multi(self, pictures: list[Picture], job: dict) -> bool:
        """job["multi"] True/False decides; when it is not set, every ID photo takes the card path (cut tight, straight, upright),
        whether it holds one card or many; a PDF with a text layer keeps the reading path (its text is the hint)."""
        if job.get("multi") is not None:
            return bool(job["multi"])
        if job.get("profile", "id-card") not in ("id-card", "multi-id"):
            return False
        return not any(p.hint_text for p in pictures)

    def prepare(self, files: list[bytes], job: dict, clock: Clock) -> Handoff:
        """Type, scan, re-save and gate: the start of both parts."""
        pictures, engine = self.intake(files, clock)
        multi = self.is_multi(pictures, job)
        clock.start("gate")
        # A sheet of cards is judged for blur, glare and darkness; a card touching the sheet edge is the cutter's flag, not a reject.
        scores, flags = self.gate(pictures, job.get("profile", "id-card"), job.get("gate_action", "reject"),
                                  MULTI_GATE_SKIP if multi else frozenset())
        return Handoff(pictures, {"engine": engine, "gate": scores, "flags": flags, "pages": len(pictures)}, multi)

    def analyse(self, files: list[bytes], job: dict, clock: "Clock | None" = None) -> "tuple[dict, bytes] | list[tuple[dict, bytes]]":
        """Both parts on in-memory files (the folder runner, the bench): the fast part, EVENTS.ready, then the background part.
        Returns (row values, final picture bytes), or a LIST of them, one per person, on the card path (several cards, or every ID
        photo when job["multi"] is not set)."""
        fast = self.fast(files, job, clock)
        ready = getattr(EVENTS, "ready", None)
        if ready is not None:
            ready(fast.people, fast.people[0]["timings"]["formMs"] if fast.people else 0)
        out = self.background(fast.handoff, job, fast.people)
        return out if fast.handoff.multi else out[0]

    # ---- the fast part ------------------------------------------------------------------------------------------------
    def fast(self, files: list[bytes], job: dict, clock: "Clock | None" = None) -> FastResult:
        """Type, scan, re-save, gate, find the card WITHOUT the model, read, check, photo and clarity, group. Returns the form values
        of every person (no picture is made) and what the background part needs."""
        clock = clock or Clock()
        pictures, engine = self.intake(files, clock)
        if not self.is_multi(pictures, job):
            clock.start("gate")
            scores, flags = self.gate(pictures, job.get("profile", "id-card"), job.get("gate_action", "reject"))
            handoff = Handoff(pictures, {"engine": engine, "gate": scores, "flags": flags, "pages": len(pictures)}, False)
            form = self.single_form(pictures, job, clock, engine, scores, list(flags))
            times = clock.finish()
            form.update(status="read", steps=list(SINGLE_FAST), timings={"steps": dict(times), "formMs": clock.elapsed_ms()})
            return FastResult([form], handoff)
        # the quality gate is judged while the card is found (both only look at the pixels); a reject still comes before reading
        started = time.monotonic()
        judged = _SIDE.submit(lambda: (self.gate(pictures, job.get("profile", "id-card"), job.get("gate_action", "reject"),
                                                 MULTI_GATE_SKIP), round((time.monotonic() - started) * 1000)))
        cuts = [self._cuts(pic, job, clock, True) for pic in pictures]
        clock.start("gate")
        (scores, flags), gate_ms = judged.result()
        clock.times["gate"] = clock.times.get("gate", 0) + gate_ms
        handoff = Handoff(pictures, {"engine": engine, "gate": scores, "flags": flags, "pages": len(pictures)}, True)
        info = handoff.info
        cards = self.find_and_read(pictures, job, clock, quick=True, cuts=cuts)
        clock.start("group")
        persons = people.group(cards)
        faces.forget(c.face for c in cards)
        forms = [self.person_form(n, p, job, info) for n, p in enumerate(persons, 1)]
        times = clock.finish()
        ms = clock.elapsed_ms()
        for form in forms:
            form.update(status=form.get("status", "read"), steps=list(FAST_STEPS), timings={"steps": dict(times), "formMs": ms})
            form["person"].update(cardsFound=len(cards), peopleFound=len(persons))
        handoff.cards, handoff.persons = cards, persons
        return FastResult(forms, handoff)

    def sheet_cards(self, files: list[bytes], job: dict, clock: "Clock | None" = None) -> tuple[list[people.Card], dict]:
        """Type, scan, re-save, gate, cut and read for sheets whose cards are grouped LATER together with other sheets
        (the folder runner's --pool: fronts on one sheet, backs on another). Returns (cards, info for people_results)."""
        clock = clock or Clock()
        handoff = self.prepare(files, {**job, "multi": True}, clock)
        clock.job_end = max(clock.job_end, clock.step_start + MULTI_JOB_SECONDS)
        cards = self.find_and_read(handoff.pictures, job, clock)
        clock.finish()
        return cards, handoff.info

    def read_card(self, rgb: np.ndarray, job: dict, upright: bool = False) -> tuple[dict, dict]:
        """Read one cut card (already flat and tight, so the document finder is off) on the untouched pixels. `upright`: the cutter
        turned it upright with confidence, so the reader's own orientation check is skipped (speed)."""
        reader = Reader(self.d.engines, self.reader_cfg)
        png = _png(_shrunk(rgb))
        options = self.options(languages=job.get("languages") or DEFAULT_LANGUAGES, mode="fast", find_document=False)
        result = reader.read_image(png, ReadOptions(**{**options.__dict__, "skip_orientation": upright}))
        doc = self.document(result, job)
        back = people.side_of(people.keys_of(result, doc)) == "back"  # a back carries no name: its missing name says nothing
        if upright and not back and (result.get("confidence", 0) < TRUSTED_READ_CONFIDENCE or "name" not in (doc.get("fields") or {})):
            # the cutter's turn may be wrong (a card whose coloured bands sit at the bottom, seen on MJ's real scans; its number still
            # reads upside down, its name does not): read again with the reader's own orientation check, keep the better reading
            named = lambda d: "name" in (d.get("fields") or {})  # noqa: E731
            again = reader.read_image(png, options)
            tries = [(again, self.document(again, job), 0)]
            if not named(tries[0][1]):  # upside down still reads line by line (number found, name not): try the half turn too
                turned = reader.read_image(_png(_shrunk(preprocess.rotate_cw(rgb, 180))), ReadOptions(**{**options.__dict__, "skip_orientation": True}))
                tries.append((turned, self.document(turned, job), 180))
            for other, doc2, turn in tries:
                if (named(doc2), other.get("confidence", 0)) > (named(doc), result.get("confidence", 0)):
                    if turn:  # the stored copy is turned the same way (people.read_cards follows rotationApplied)
                        document = dict(other.get("document") or {})
                        document["rotationApplied"] = (int(document.get("rotationApplied") or 0) + turn) % 360
                        other = {**other, "document": document}
                    result, doc = other, doc2
        return result, doc

    def find_and_read(self, pictures: list[Picture], job: dict, clock: Clock, quick: bool = False, cuts: list | None = None) -> list[people.Card]:
        """Cut every card (quick: the classic finder, no model), read each, then photo and clarity per card."""
        cuts = cuts if cuts is not None else [self._cuts(pic, job, clock, quick) for pic in pictures]
        clock.start("read")
        # the portrait does not depend on the reading: it is looked for while the card is read (kept when the reader did not turn it)
        early = [_SIDE.submit(_portrait, c) for found in cuts for c in found]
        with ThreadPoolExecutor(max_workers=READ_THREADS) as pool:
            cards = people.read_cards(cuts, lambda rgb, upright: self.read_card(rgb, job, upright), pool.map)
            for card, face in zip(cards, early):
                card.jpeg_quality = getattr(pictures[card.picture], "jpeg_quality", None)
                if not (card.result.get("document") or {}).get("rotationApplied"):
                    card.face = face.result()
                else:
                    faces.forget([face.result()])
            clock.start("inspect")  # photo + clarity per card
            list(pool.map(inspect_card, cards))
        return cards

    def cut_and_read(self, pictures: list[Picture], job: dict, clock: Clock) -> list[people.Card]:
        return self.find_and_read(pictures, job, clock)

    def _cuts(self, pic: Picture, job: dict, clock: Clock, quick: bool) -> list:
        clock.start("find" if quick else "cut")  # one step per picture: the per-step limit applies to each sheet
        found = people.cut(pic.pixels, int(job.get("max_cards") or people.MAX_CARDS), quick=quick)
        if quick:  # an outline the classic finder could not fit well (a box on a passport page, a pale card) is not a card
            found = [c for c in found if not QUICK_DOUBT & set(c.flags)]
        if not found:  # no card outline found (a card filling the whole picture, a flat scan): the whole picture is the card
            from .cardcut import CardCut
            h, w = pic.pixels.shape[:2]
            found = [CardCut(cv2.cvtColor(pic.pixels, cv2.COLOR_RGB2BGR), np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32), 0.3,
                             ["wholePicture"])]
        return found

    def person_form(self, n: int, person: people.Person, job: dict, info: dict) -> dict:
        """The form values of one person: fields, checks, clarity, photo outcome. No picture is made here."""
        fields, doubtful, origin = people.person_fields(person)
        doc_type = people.document_type(person)
        results = [c.result for c in person.cards]
        same = pairing.judge(results[0], results[1]) if len(results) == 2 else None
        flags = list(info["flags"]) + list(person.flags)
        for c in person.cards:
            flags += [f for f in c.flags + c.result.get("flags", []) if f not in INTERNAL_FLAGS]
        unknown = doc_type["type"] == "unknown"
        if unknown:
            flags.append("unknownDocumentType")
        # clarity: every card's grade; a key field read from an unclear card or region is flagged
        card_clarity = [{"card": c.index + 1, "side": c.side, "grade": c.clarity.get("grade", "clear"),
                         "reasons": c.clarity.get("reasons", []), "advice": c.clarity.get("advice")} for c in person.cards if c.clarity]
        unclear_fields = sorted({k for k in KEY_FIELDS if k in fields and k in clarity.unclear_fields(person.cards[origin.get(k, 0)].clarity, [k])})
        if any(c["grade"] == "unclear" for c in card_clarity):
            flags.append("unclearCard")
        if unclear_fields:
            flags.append("keyFieldUnclear")
        check_flags = CHECK_FLAGS - ({"sameNameDobNoNumber"} if person.rare else set())  # RARE: no warning for this reason
        needs_check = unknown or bool(doubtful) \
            or bool(check_flags & (set(person.flags) | set(flags))) \
            or bool(people.CARD_FLAGS_FOR_CHECK & set(flags)) \
            or any(c.result.get("needsHumanCheck") or (c.score < 0.5 and "quickFinder" not in c.flags) for c in person.cards) \
            or (same is not None and same["verdict"] == "mismatch")
        person_info = {"index": n, "cards": [c.index + 1 for c in person.cards], "pictures": [c.picture + 1 for c in person.cards],
                       "sides": [c.side for c in person.cards], "evidence": person.evidence, "confidence": person.confidence,
                       "duplicates": [d.index + 1 for d in person.duplicates],
                       "guest": person.guest, "sameGuestAs": person.linked, "guestEvidence": person.link_evidence,
                       "possibleSameGuestAs": person.possible, "suggestedPartner": person.suggested,
                       "pairedByPosition": person.evidence == "position", **({"lookAlike": person.look} if person.look else {}),
                       "quads": [np.round(np.asarray(c.quad, np.float32).reshape(4, 2), 1).tolist() for c in person.cards],
                       "turns": [int((c.result.get("document") or {}).get("rotationApplied") or 0) for c in person.cards],
                       "origin": origin}
        # outcomes only (match / mismatch / unclear and a score rounded to 2 decimals): never a face embedding
        photo = {"portraits": [{"card": c.index + 1, "side": c.side, **c.face.public()} for c in person.cards if c.face is not None],
                 "checks": [x for c in person.cards for x in c.photo_checks] + list(person.photo_checks)}
        rejected = [{"card": c.index + 1, "side": c.side, "reason": c.clarity["photoReject"]["reason"]}
                    for c in person.cards if (c.clarity or {}).get("photoReject")]
        if rejected:
            flags.append("photoUnclear")
        values = {"status": "read", "needs_human_check": bool(needs_check), "rare": person.rare, "document_type": doc_type,
                  "fields": fields, "doubtful_fields": doubtful, "same_person": same, "flags": sorted(set(flags)),
                  "scores": {"gate": info["gate"], "cards": [{"card": c.index + 1, "side": c.side, "cutScore": round(c.score, 3),
                                                              "flags": [f for f in c.flags if f not in INTERNAL_FLAGS],
                                                              "clarity": c.clarity.get("scores", {}), "regions": c.clarity.get("regions", {})}
                                                             for c in person.cards]},
                  "scan_engine": info["engine"], "pages": info["pages"], "person": person_info,
                  "clarity": {**clarity_summary(card_clarity), "unclearFields": unclear_fields}, "photo": photo,
                  "suggested_name": naming.stem(fields, doc_type["type"], person.rare)}
        if rejected and photo_rejects(job):
            # MJ's rule: an ID photo that is missing, blurred, glared or too small rejects the card; nothing is stored or compressed
            for key in ("fields", "doubtful_fields", "same_person", "scores"):  # nothing of the card is kept
                values.pop(key)
            values.update(status="rejected", needs_human_check=False, result_bytes=0,
                          reject={"code": "photo_unclear", "message": clarity.PHOTO_RETAKE, "cards": rejected})
        return values

    # ---- the background part ------------------------------------------------------------------------------------------
    def background(self, handoff: Handoff, job: dict, forms: list[dict], clock: "Clock | None" = None) -> list[tuple[dict, bytes]]:
        """The stored picture of every person of `forms` (the fast part's values), in the same order, then any person only the
        model cutter found. The fields stay the fast part's; a disagreement is a flag and a check, never a changed value."""
        own = clock is None
        if own:
            clock = Clock()
            clock.job_end = clock.step_start + MULTI_JOB_SECONDS
        if not handoff.multi:
            values, blob = self.single_picture(handoff.pictures, forms[0], job, clock)
            out = [(values, blob)]
        else:
            out = self._background_cards(handoff, job, forms, clock)
        if own:
            times = clock.finish()
            for values, _ in out:
                values["timings"]["background"] = {"steps": dict(times), "ms": clock.elapsed_ms()}
        return out

    def _background_cards(self, handoff: Handoff, job: dict, forms: list[dict], clock: Clock) -> list[tuple[dict, bytes]]:
        known: dict[int, tuple[int, list, int]] = {}  # fast card number -> (picture, quad, turn)
        for form in forms:
            p = form.get("person") or {}
            for no, pic, quad, turn in zip(p.get("cards", []), p.get("pictures", []), p.get("quads", []), p.get("turns", [])):
                known[no] = (pic - 1, quad, turn)
        fast_cards = {c.index + 1: c for c in handoff.cards}
        cuts = [self._cuts(pic, job, clock, quick=False) for pic in handoff.pictures]
        clock.start("read")
        cards: list[people.Card] = []
        matched: dict[int, int] = {}  # background card number -> fast card number
        todo = []
        for picture, found in enumerate(cuts):
            for c in found:
                rgb = cv2.cvtColor(np.ascontiguousarray(c.image), cv2.COLOR_BGR2RGB)
                card = people.Card(len(cards), picture, rgb, np.asarray(c.quad, np.float32), float(c.score), list(c.flags))
                card.jpeg_quality = getattr(handoff.pictures[picture], "jpeg_quality", None)
                same = next((no for no, (pic, quad, _) in known.items() if pic == picture and no not in matched.values()
                             and _same_place(quad, card.quad)), None)
                if same is not None:
                    matched[card.index + 1] = same
                else:  # the fast part found no card and read the whole picture: every card the model finds on it belongs there
                    shape = handoff.pictures[picture].pixels.shape
                    whole = next((no for no, (pic, quad, _) in known.items() if pic == picture and _covers(quad, shape)), None)
                    # the same card cut a little differently (one touching the scan edge, a sleeve kept on one side): it links the
                    # fast person to the model's, and is read again
                    near = max(((_overlap(quad, card.quad), no) for no, (pic, quad, _) in known.items()
                                if pic == picture and no not in matched.values()), default=(0.0, None))
                    link = whole if whole is not None else near[1] if near[0] >= LOOSE_MATCH else None
                    if link is not None:
                        matched[card.index + 1] = link
                first = fast_cards.get(same)
                if first is not None and _settled(first):  # the fast part read this very card without a doubt: its reading is kept
                    turn = int((first.result.get("document") or {}).get("rotationApplied") or 0)
                    card.image = preprocess.rotate_cw(card.image, turn) if turn else card.image
                    card.result, card.doc, card.keys, card.side = first.result, first.doc, first.keys, first.side
                else:
                    todo.append(card)
                cards.append(card)
        if todo:
            with ThreadPoolExecutor(max_workers=READ_THREADS) as pool:
                read = people.read_cards([[_Cut(cv2.cvtColor(c.image, cv2.COLOR_RGB2BGR), c.quad, c.score, c.flags)] for c in todo],
                                         lambda rgb, upright: self.read_card(rgb, job, upright), pool.map)
            for card, done in zip(todo, read):
                card.image, card.result, card.doc, card.keys, card.side = done.image, done.result, done.doc, done.keys, done.side
        clock.start("inspect")
        with ThreadPoolExecutor(max_workers=READ_THREADS) as pool:
            list(pool.map(inspect_card, cards))
        saved = self.people_results(cards, job, clock, handoff.info)
        return self.reconcile(forms, saved, matched, len(cards), handoff, job, clock)

    def reconcile(self, forms: list[dict], saved: list[tuple[dict, bytes]], matched: dict[int, int], n_cards: int,
                  handoff: Handoff, job: dict, clock: Clock) -> list[tuple[dict, bytes]]:
        """Each fast person keeps its form values and gets the stored picture of the background person made from the same cards.
        What the background saw differently is listed in background.disagreements and sets needs_human_check."""
        common: list[dict] = []
        found_cards = max([(f.get("person") or {}).get("cardsFound", 0) for f in forms] or [0])
        found_people = max([(f.get("person") or {}).get("peopleFound", len(forms)) for f in forms] or [0])
        if n_cards != found_cards:
            common.append({"code": "cards", "fast": found_cards, "background": n_cards})
        if len(saved) != found_people:
            common.append({"code": "people", "fast": found_people, "background": len(saved)})
        used: set[int] = set()
        out: list[tuple[dict, bytes]] = []
        for i, form in enumerate(forms):
            mine = set((form.get("person") or {}).get("cards", []))
            best, overlap = None, 0
            for j, (values, _) in enumerate(saved):
                shared = len({matched.get(no) for no in values["person"]["cards"]} & mine)
                if j not in used and shared > overlap:
                    best, overlap = j, shared
            if best is not None:
                used.add(best)
            out.append(self._merge(form, saved[best] if best is not None else None, list(common), matched, handoff, i, job, clock))
        for j, (values, blob) in enumerate(saved):
            if j not in used:  # a person only the model cutter found: the form never showed it
                flags = sorted(set(values["flags"]) | {"backgroundOnly", "backgroundDisagrees"})
                values = {**values, "flags": flags, "needs_human_check": values["status"] != "rejected",
                          "background": {"disagreements": common + [{"code": "backgroundOnly"}], "cards": n_cards, "people": len(saved)}}
                values.setdefault("timings", {})
                out.append((values, blob))
        return out

    def _merge(self, form: dict, saved: "tuple[dict, bytes] | None", disagree: list[dict], matched: dict[int, int],
               handoff: Handoff, index: int, job: dict, clock: Clock) -> tuple[dict, bytes]:
        if form.get("status") == "rejected":  # the fast part refused this person (photo rule): nothing is stored
            values = {**form, "steps": list(MULTI_STEPS[:len(FAST_STEPS)]), "background": {"disagreements": disagree}}
            return values, b""
        mine = (form.get("person") or {}).get("cards", [])
        other = saved[0] if saved else None
        if other is None:
            disagree.append({"code": "unmatched"})
        else:
            if sorted(matched.get(no) or 0 for no in other["person"]["cards"]) != sorted(mine):
                disagree.append({"code": "pairing", "fast": mine, "background": [matched.get(no) for no in other["person"]["cards"]]})
            if other["document_type"]["type"] != form["document_type"]["type"]:
                disagree.append({"code": "documentType", "background": other["document_type"]["type"]})
            if other["status"] == "rejected":
                disagree.append({"code": "photo"})
            for k in COMPARED:
                a, b = form["fields"].get(k), other.get("fields", {}).get(k)
                if "qr" in ((a or {}).get("source"), (b or {}).get("source")) or other["status"] == "rejected":
                    continue
                if _value(a) != _value(b):
                    disagree.append({"code": "field", "field": k, "background": (b or {}).get("value")})
        if other is not None and other["status"] != "rejected":
            blob = saved[1]
            extra = other
        else:  # no stored picture from the background's own grouping: the fast part's own cards are stored
            images = self._fast_images(form, handoff, index)
            fields, origin = form["fields"], {k: int(v) for k, v in (form["person"].get("origin") or {}).items()}
            own = Clock()
            own.job_end = clock.job_end
            extra, blob = self.person_picture(images, {**form, "flags": list(form["flags"])}, fields, origin, job, own)
        flags = set(form["flags"]) | set(extra["flags"]) - {"backgroundOnly"}
        if disagree:
            flags.add("backgroundDisagrees")
        scores = {**form.get("scores", {}), **{k: v for k, v in extra["scores"].items() if k not in ("gate", "cards")}}
        values = {**form, "status": "done", "flags": sorted(flags), "scores": scores, "result_bytes": len(blob),
                  "needs_human_check": bool(form["needs_human_check"] or extra["needs_human_check"] or disagree),
                  "steps": list(MULTI_STEPS), "timings": dict(form.get("timings") or {}),
                  "background": {"disagreements": disagree, "cards": None if other is None else len(other["person"]["cards"]),
                                 "person": None if other is None else other["person"]["index"]}}
        return values, blob

    def _fast_images(self, form: dict, handoff: Handoff, index: int) -> list[np.ndarray]:
        if index < len(handoff.persons):
            return [c.image for c in handoff.persons[index].cards]
        p = form["person"]
        return [_warp_card(handoff.pictures[pic - 1].pixels, quad, turn) for pic, quad, turn in zip(p["pictures"], p["quads"], p["turns"])]

    def people_results(self, cards: list[people.Card], job: dict, clock: "Clock | None", info: dict) -> list[tuple[dict, bytes]]:
        """Group the cards into people, then per person: enhance the stored copies, stack front over back, compress to the cap."""
        if clock is None:
            clock = Clock()
            clock.job_end = clock.step_start + MULTI_JOB_SECONDS
        clock.start("group")
        persons = people.group(cards)
        faces.forget(c.face for c in cards)  # the embeddings were only needed for grouping: dropped now, never stored
        clock.start("people")

        def one(item: tuple[int, people.Person]) -> tuple[tuple[dict, bytes], dict[str, int]]:
            own = Clock()  # each person keeps its own step clock (the shared one is not thread-safe); same job deadline
            own.job_end = clock.job_end
            result = self.person_result(item[0], item[1], job, own, info)
            own.finish()
            return result, own.times

        # People are enhanced, stacked and compressed side by side (speed, MJ 5 Nov 2026): onnxruntime, OpenCV and Pillow release
        # the interpreter lock, so the cores are used together.
        with ThreadPoolExecutor(max_workers=max(1, min(PEOPLE_THREADS, len(persons) or 1))) as pool:
            done = list(pool.map(one, enumerate(persons, 1)))
        out = [result for result, _ in done]
        clock.finish()
        clock.times.pop("people", None)
        for _, times in done:  # step times summed over people (they ran side by side: the sum is work, not waiting)
            for step, ms in times.items():
                clock.times[step] = clock.times.get(step, 0) + ms
        for values, _ in out:
            values["timings"]["steps"] = dict(clock.times)
        return out

    def person_result(self, n: int, person: people.Person, job: dict, clock: Clock, info: dict) -> tuple[dict, bytes]:
        started = time.monotonic()
        values = self.person_form(n, person, job, info)
        if values["status"] == "rejected":
            values.update(steps=MULTI_STEPS[:MULTI_STEPS.index("group") + 1],
                          timings={"steps": dict(clock.times), "personMs": round((time.monotonic() - started) * 1000)})
            return values, b""
        fields, origin = values["fields"], values["person"]["origin"]
        values, blob = self.person_picture([c.image for c in person.cards], values, fields, origin, job, clock)
        values["timings"] = {"steps": dict(clock.times), "personMs": round((time.monotonic() - started) * 1000)}
        return values, blob

    def person_picture(self, images: list[np.ndarray], values: dict, fields: dict, origin: dict, job: dict,
                       clock: Clock) -> tuple[dict, bytes]:
        """Enhance the stored copies, stack front over back, OCR round trip, compress to the cap."""
        clock.start("enhance")
        stored = list(images)
        fixes: list[str] = []
        if job.get("auto_enhance", self.d.settings.auto_enhance) and not job.get("lossless"):
            for i, px in enumerate(stored):
                stored[i], names = enhance.enhance(px)
                fixes += [x for x in names if x not in fixes]
        clock.start("merge")
        final = comp.stack(stored)
        masked = 0
        if job.get("mask_id_numbers"):
            again = Reader(self.d.engines, self.reader_cfg).read_image(_png(final), self.options(find_document=False))
            final, masked = mask.mask_aadhaar(final, again["lines"])
        before = {k: fields[k]["value"] for k in KEY_FIELDS if k in fields}
        accept = None
        if job.get("profile", "id-card") in ("id-card", "multi-id") and not job.get("lossless") and before:
            accept = self._round_trip(stored, before, origin, job)
        clock.start("compress")
        blob, fmt, comp_flags, comp_scores = comp.compress(final, int(job.get("size_cap_bytes") or comp.DEFAULT_CAP),
                                                           bool(job.get("lossless")), accept=accept)
        values = {**values, "status": "done", "flags": sorted(set(values["flags"]) | set(comp_flags)), "result_bytes": len(blob),
                  "steps": list(MULTI_STEPS),
                  "scores": {**values.get("scores", {}), "compress": comp_scores, "format": fmt, "maskedNumbers": masked, "enhance": fixes}}
        return values, blob

    def _round_trip(self, stored: list[np.ndarray], before: dict, origin: dict, job: dict):
        """OCR round trip for one person's stacked picture: each card that gave a key field is re-read alone; the values must stay."""
        rows = comp.layout(stored)
        sides: dict[int, list[str]] = {}
        for k in before:
            sides.setdefault(int(origin.get(k, 0)), []).append(k)
        # Only the key values are compared. When every one of them is Latin letters, digits and punctuation, the other scripts'
        # models (Tesseract runs for Hindi and Gujarati, the slow part) cannot change the answer: read Latin only (speed, 5 Nov 2026).
        latin = all(str(v).isascii() for v in before.values())
        languages = ["en"] if latin else (job.get("languages") or DEFAULT_LANGUAGES)

        def reread(item: tuple[int, list[str]], candidate: np.ndarray) -> bool:
            index, keys = item
            top, bottom = rows[min(index, len(rows) - 1)]
            part = candidate[top:bottom] if len(stored) > 1 else candidate
            result = Reader(self.d.engines, self.reader_cfg).read_image(_png(_shrunk(part)), self.options(
                languages=languages, find_document=False, skip_orientation=True))
            after = self.key_values(self.document(result, job))
            # word breaks only: person_fields may have re-spaced a joined name (ANILMEHRA -> ANIL MEHRA) from the QR or other side,
            # which a re-read of the same card can never reproduce; every candidate would fail and the picture be downscaled
            return all("".join(str(after.get(k) or "").split()) == "".join(str(before[k]).split()) for k in keys)

        def accept(candidate: np.ndarray) -> bool:
            with ThreadPoolExecutor(max_workers=len(sides) or 1) as pool:
                return all(pool.map(lambda item: reread(item, candidate), sides.items()))
        return accept

    # ---- one card (front, or front and back as two files / two PDF pages), the reading path ----------------------------
    def single_form(self, pictures: list[Picture], job: dict, clock: Clock, engine: str, scores: list[dict], flags: list[str]) -> dict:
        profile = job.get("profile", "id-card")
        clock.start("read")
        # The sides are read at the same time: OCR waits on native code and child processes, so threads really overlap.
        with ThreadPoolExecutor(max_workers=min(len(pictures), 3)) as pool:
            reads = list(pool.map(lambda p: self.read_one(p, job, find_document=(profile == "id-card" and not p.hint_text)), pictures))
        results, docs = [r for r, _ in reads], [d for _, d in reads]
        flags += [f for r in results for f in r["flags"] if f not in INTERNAL_FLAGS]
        same = pairing.judge(results[0], results[1]) if len(results) == 2 else None
        doc = docs[0]
        unknown = doc["unknown"]
        winner = {k: 0 for k in doc["fields"]}  # which picture gave each field (for the compression round trip)
        for i, extra in enumerate(docs[1:], 1):  # fields from other sides fill gaps and keep the more confident value
            for k, f in extra["fields"].items():
                if k not in doc["fields"] or f["confidence"] > doc["fields"][k]["confidence"]:
                    doc["fields"][k] = {**f, "side": "back"}
                    winner[k] = i
            doc["doubtful"] = list(dict.fromkeys(doc["doubtful"] + extra["doubtful"]))
        # photo and clarity per picture (the document the reader found, flattened and turned upright as it was read)
        views = [_document_view(p.pixels, r) for p, r in zip(pictures, results)]
        portraits = [faces.find_portrait(v, src / max(v.shape[:2])) for v, src in views]
        side_names = ["front", "back"] + ["page"] * max(0, len(pictures) - 2)
        kinds = [d["type"] if d["type"] != "unknown" else doc["type"] for d in docs]
        # one picture alone is the front (or the single page), unless it clearly is a back (an address page): backs carry no portrait
        sides = [people.side_of(people.keys_of(r, d)) if len(pictures) > 1 else "single" if doc["type"] in people.SINGLE_TYPES
                 else "back" if people.side_of(people.keys_of(r, d)) == "back" else "front" for r, d in zip(results, docs)]
        per_picture = [clarity.assess(v, r, d, k, s, src, pt, getattr(p, "jpeg_quality", None))
                       for (v, src), r, d, k, s, pt, p in zip(views, results, docs, kinds, sides, portraits, pictures)]
        del views
        card_clarity = [{"card": i + 1, "side": side_names[i], "grade": c["grade"], "reasons": c["reasons"], "advice": c["advice"]}
                        for i, c in enumerate(per_picture)]
        unclear_fields = sorted({k for k in KEY_FIELDS if k in doc["fields"] and k in clarity.unclear_fields(per_picture[winner.get(k, 0)], [k])})
        if any(c["grade"] == "unclear" for c in card_clarity):
            flags.append("unclearCard")
        if unclear_fields:
            flags.append("keyFieldUnclear")
        forms = [(d["fields"].get("form") or {}).get("value") for d in docs]
        if any(pt.status in ("none", "unclear") and clarity.expects_portrait(k, s, f) for pt, k, s, f in zip(portraits, kinds, sides, forms)):
            flags.append("photoUnclear")
        photo = {"portraits": [{"card": i + 1, "side": side_names[i], **pt.public()} for i, pt in enumerate(portraits)], "checks": []}
        faces.forget(portraits)
        if any(c.get("photoReject") for c in per_picture):
            flags.append("photoUnclear")
            if photo_rejects(job):  # MJ's rule: an unclear ID photo rejects the card
                raise reject("photo_unclear", clarity.PHOTO_RETAKE, "read")  # step 7: straighten, read, check
        needs_check = unknown or bool(doc["doubtful"]) or any(r["needsHumanCheck"] for r in results) \
            or (same is not None and same["verdict"] != "match") or bool({"unclearCard", "keyFieldUnclear"} & set(flags))
        if unknown:
            flags.append("unknownDocumentType")
        return {
            "status": "read", "needs_human_check": bool(needs_check),
            "document_type": {"type": doc["type"], "guessed": doc["guessedType"], "confidence": doc["confidence"]},
            "fields": doc["fields"], "doubtful_fields": doc["doubtful"], "same_person": same,
            "flags": sorted(set(flags)), "scores": {"gate": scores, "cards": [{"card": i + 1, "clarity": c["scores"], "regions": c["regions"]}
                                                                             for i, c in enumerate(per_picture)]},
            "scan_engine": engine, "pages": len(pictures), "person": {"origin": winner, "cardsFound": len(pictures), "peopleFound": 1},
            "clarity": {**clarity_summary(card_clarity), "unclearFields": unclear_fields}, "photo": photo,
        }

    def single_picture(self, pictures: list[Picture], form: dict, job: dict, clock: Clock) -> tuple[dict, bytes]:
        """Enhance the STORED copy only (reading used the untouched pixels), merge, compress."""
        profile = job.get("profile", "id-card")
        clock.start("enhance")
        stored = [p.pixels for p in pictures]
        fixes: list[str] = []
        if job.get("auto_enhance", self.d.settings.auto_enhance) and not job.get("lossless"):
            for i, px in enumerate(stored):
                stored[i], names = enhance.enhance(px)
                fixes += [n for n in names if n not in fixes]
        clock.start("merge")
        final = comp.stack(stored)
        masked = 0
        if job.get("mask_id_numbers"):  # OFF by default; only a hotel setting turns it on
            again = Reader(self.d.engines, self.reader_cfg).read_image(_png(final), self.options(find_document=False))
            final, masked = mask.mask_aadhaar(final, again["lines"])
        clock.start("compress")
        accept = None
        if profile == "id-card" and not job.get("lossless"):
            # OCR round trip: only the sides that supplied a key field are re-read, each alone; the key values must stay
            origin = {k: int(v) for k, v in ((form.get("person") or {}).get("origin") or {}).items()}
            accept = self._round_trip(stored, self.key_values(form), origin, job)
        blob, fmt, comp_flags, comp_scores = comp.compress(final, int(job.get("size_cap_bytes") or comp.DEFAULT_CAP),
                                                           bool(job.get("lossless")), accept=accept)
        values = {**form, "status": "done", "flags": sorted(set(form["flags"]) | set(comp_flags)), "result_bytes": len(blob),
                  "steps": SINGLE_FAST + SINGLE_SAVE, "timings": dict(form.get("timings") or {}),
                  "scores": {**form.get("scores", {}), "compress": comp_scores, "format": fmt, "maskedNumbers": masked, "enhance": fixes}}
        return values, blob


@dataclass
class _Cut:
    image: np.ndarray
    quad: np.ndarray
    score: float
    flags: list
