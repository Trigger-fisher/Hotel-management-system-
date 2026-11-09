"""The job in two parts (MJ, 5 Nov 2026): the FAST part writes the form's fields (status `read`) before any picture is made or
saved; the BACKGROUND part cuts with the model, stores the picture and never changes a field; a crash in it keeps the fields; a
disagreement is a flag and a check. Invented cards only."""
import pytest

from app import people
from app.config import MAX_ATTEMPTS
from app.store import FakeStore, SAVE_COLUMNS
from app.worker import Worker
from tests import cards as C
from tests import sheets as S
from tests.conftest import make_job, make_pipeline, opened, settings
from tests.imaging import png_bytes


def _queue(storage, image, job_id="job-split", **kw):
    store = FakeStore()
    job = make_job(storage, C.png(image), job_id=job_id, **kw)
    store.add({k: v for k, v in job.items() if k not in ("status", "attempts")})
    return store, job


def test_the_fast_part_writes_the_fields_before_any_picture_is_saved(storage, engines):
    pipe = make_pipeline(storage, engines)
    store, job = _queue(storage, C.pan_card())
    w = Worker(settings(threads=2), store, pipe.process_fast, background=pipe.process_background)
    assert w.run_once()
    row = store.jobs[job["id"]]
    assert row["status"] == "read" and row["fields"]["documentNumber"]["value"] == "ABCPE1234F"
    assert not storage.uploads and "result_bytes" not in row  # the form is filled, nothing is stored yet
    assert row["timings"]["formMs"] > 0 and row["document_type_read"]["type"] == "pan"
    fields_then = dict(row["fields"])
    assert w.run_once()  # the background part of the same job
    row = store.jobs[job["id"]]
    assert row["status"] == "done" and storage.uploads and row["result_bytes"] > 0
    assert row["fields"] == fields_then and opened(storage, job)[:2] in (b"\xff\xd8", b"\x89P")
    assert [kind for _, kind, _ in store.writes] == ["read", "save"]
    assert all(set(cols) <= set(SAVE_COLUMNS) for _, kind, cols in store.writes if kind == "save")
    assert row["background"]["disagreements"] == [] and "backgroundDisagrees" not in row["flags"]


def test_a_queued_form_goes_before_any_background_part(storage, engines):
    store = FakeStore()
    for i in range(2):
        store.add({"id": f"j{i}", "hotel_id": "h", "download_url": "x", "upload_url": "y", "wrapped_key": "z"})
    order = []
    w = Worker(settings(threads=2), store, lambda j: (order.append(("fast", j["id"])), {"status": "read", "fields": {}})[1],
               background=lambda j: (order.append(("background", j["id"])), {"status": "done"})[1])
    while w.run_once():
        pass
    assert order == [("fast", "j0"), ("fast", "j1"), ("background", "j0"), ("background", "j1")]
    assert all(j["status"] == "done" for j in store.jobs.values())


def test_a_background_crash_keeps_the_fields_and_goes_back_to_the_background_queue(storage, engines, monkeypatch):
    pipe = make_pipeline(storage, engines)
    store, job = _queue(storage, C.pan_card(), job_id="job-crash")
    w = Worker(settings(threads=2), store, pipe.process_fast, background=pipe.process_background)
    assert w.run_once()
    fields = dict(store.jobs[job["id"]]["fields"])

    def boom(*a, **k):
        raise RuntimeError("cutter fell over with guest Ramesh in the message")
    monkeypatch.setattr(pipe, "background", boom)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        assert w.run_once()
        row = store.jobs[job["id"]]
        assert row["fields"] == fields and row["status"] == ("read" if attempt < MAX_ATTEMPTS else "needs_attention")
        assert row["reason_code"] == "internal" and "fell over" not in str(row)  # the crash text is never stored
    assert not storage.uploads
    assert store.jobs[job["id"]]["background_attempts"] == MAX_ATTEMPTS


def test_a_swept_background_attempt_that_wakes_up_late_never_uploads_over_the_live_one(storage, engines):
    """The attempt guard: just before the upload the background part asks the job row whether it still holds the job."""
    pipe = make_pipeline(storage, engines)
    store, job = _queue(storage, C.pan_card(), job_id="job-guard")
    w = Worker(settings(threads=2), store, pipe.process_fast, background=pipe.process_background)
    assert w.run_once()  # the fast part: status read
    dead = store.claim()  # background attempt 1 starts ... and stalls
    assert dead["phase"] == "background" and dead["attempts"] == 1
    store.requeue_stuck(stuck_after=0)  # the sweeper gives the job back
    assert store.jobs[job["id"]]["status"] == "read"
    w._run(dead, pipe.process_background, "background")  # attempt 1 wakes up before anyone claimed the job again
    assert "PUT" not in storage.requests and store.jobs[job["id"]]["status"] == "read"
    assert [kind for _, kind, _ in store.writes] == ["read"]  # it wrote nothing
    assert w.run_once()  # attempt 2 claims the job and saves the picture
    live = storage.uploads[job["upload_url"]]
    row = dict(store.jobs[job["id"]])
    assert row["status"] == "done" and row["background_attempts"] == 2 and storage.requests.count("PUT") == 1
    w._run(dead, pipe.process_background, "background")  # attempt 1 wakes up again, after attempt 2 finished
    assert storage.requests.count("PUT") == 1 and storage.uploads[job["upload_url"]] == live
    assert store.jobs[job["id"]] == row


def test_the_attempt_guard_renews_the_claim_of_the_live_attempt():
    store = FakeStore()
    store.add({"id": "j", "hotel_id": "h", "download_url": "x", "upload_url": "y", "wrapped_key": "z"})
    store.claim()
    store.write_read("j", {"fields": {}}, attempt=1)
    claimed = store.claim()
    before = store.jobs["j"]["saving_started"]
    assert store.owns("j", claimed["attempts"]) and store.jobs["j"]["saving_started"] >= before
    assert not store.owns("j", claimed["attempts"] + 1)


def test_a_background_part_after_a_restart_downloads_again_and_keeps_the_fields(storage, engines):
    first = make_pipeline(storage, engines)
    store, job = _queue(storage, C.aadhaar_front(with_qr=False), job_id="job-restart")
    Worker(settings(threads=2), store, first.process_fast).run_once()
    assert store.jobs[job["id"]]["status"] == "read"
    second = make_pipeline(storage, engines)  # another worker process: nothing of the fast part is in its memory
    w = Worker(settings(threads=2), store, second.process_fast, background=second.process_background)
    before = dict(store.jobs[job["id"]]["fields"])
    assert w.run_once()
    row = store.jobs[job["id"]]
    assert row["status"] == "done" and row["fields"] == before and storage.uploads
    assert row["background"]["disagreements"] == []


def test_a_value_the_background_reads_differently_is_a_flag_never_a_change(storage, engines):
    pipe = make_pipeline(storage, engines)
    job = {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": 512_000, "languages": None}
    fast = pipe.fast([png_bytes(C.pan_card())], dict(job))
    form = fast.people[0]
    form["fields"]["dob"] = {**form["fields"]["dob"], "value": "1999-01-01"}  # as if the fast part had read another date
    fast.handoff.cards = []  # the background reads every card again
    (values, blob), = pipe.background(fast.handoff, dict(job), [form])
    assert values["fields"]["dob"]["value"] == "1999-01-01"  # the form's value stays
    assert "backgroundDisagrees" in values["flags"] and values["needs_human_check"] is True and blob
    assert {"code": "field", "field": "dob", "background": "1990-02-01"} in values["background"]["disagreements"]


def test_more_cards_or_people_in_the_background_are_flagged(storage, engines, monkeypatch):
    def cut(rgb, max_cards=12, quick=False):
        found = S.stub_cut(rgb, max_cards)
        return found[:1] if quick else found  # the quick finder sees one card, the model all of them
    monkeypatch.setattr(people, "cut", cut)
    g = S.GUESTS
    pipe = make_pipeline(storage, engines)
    job = {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": 512_000, "languages": None}
    out = pipe.analyse([png_bytes(S.sheet([S.front(g[0]), S.front(g[1])]))], dict(job))
    assert len(out) == 2
    (first, _), (extra, extra_blob) = out
    codes = {d["code"] for d in first["background"]["disagreements"]}
    assert {"cards", "people"} <= codes and "backgroundDisagrees" in first["flags"] and first["needs_human_check"]
    assert "backgroundOnly" in extra["flags"] and extra["needs_human_check"] and extra_blob


def test_the_folder_runner_hook_sees_the_form_before_the_picture(storage, engines):
    from app.pipeline import EVENTS
    pipe = make_pipeline(storage, engines)
    seen = []
    EVENTS.ready = lambda persons, ms: seen.append((persons[0]["status"], "result_bytes" in persons[0], ms))
    try:
        values, blob = pipe.analyse([png_bytes(C.pan_card())], {"id": "local", "profile": "id-card", "gate_action": "warn",
                                                                 "multi": False})
    finally:
        EVENTS.ready = None
    assert seen and seen[0][0] == "read" and not seen[0][1] and seen[0][2] > 0
    assert values["status"] == "done" and blob


def test_a_sheet_of_ten_cards_fills_one_form_per_guest_in_the_fast_part(storage, engines):
    """MJ, 5 Nov 2026: a sheet of many IDs fills the form fast. The fast part finds all ten invented cards without the model, reads
    them side by side and groups front and back per guest; the background part links every guest to its own picture (no guest
    twice), and a worker job keeps one person (severalPeople)."""
    import sys
    from tests.conftest import ROOT
    sys.path.insert(0, str(ROOT / "scripts"))
    import bench
    pipe = make_pipeline(storage, engines)
    job = {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": 512_000, "languages": None}
    fast = pipe.fast(bench.cases()["sheet10"], dict(job))
    names = sorted(p["fields"]["name"]["value"] for p in fast.people)
    assert names == sorted(g.name for g in S.GUESTS)
    assert all(p["status"] == "read" and "result_bytes" not in p and p["person"]["cardsFound"] >= 9 for p in fast.people)
    saved = pipe.background(fast.handoff, dict(job), fast.people)
    assert len(saved) == len(fast.people) and all(blob for _, blob in saved)
    assert [v["fields"] for v, _ in saved] == [p["fields"] for p in fast.people]
    assert not any("backgroundOnly" in v["flags"] for v, _ in saved)


@pytest.mark.parametrize("name", ["single", "pair-photo"])
def test_the_bench_cases_give_the_same_fields_in_both_parts(storage, engines, name):
    import sys
    from tests.conftest import ROOT
    sys.path.insert(0, str(ROOT / "scripts"))
    import bench
    pipe = make_pipeline(storage, engines)
    job = {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": 512_000, "languages": None}
    fast = pipe.fast(bench.cases()[name], dict(job))
    saved = pipe.background(fast.handoff, dict(job), fast.people)
    assert [v["fields"] for v, _ in saved][:len(fast.people)] == [p["fields"] for p in fast.people]
    assert all(not v["background"]["disagreements"] for v, _ in saved)
