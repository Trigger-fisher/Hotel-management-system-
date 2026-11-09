"""Part 10, failure set, on the folder's local stand-ins (FakeStore for the job table, the mock storage links, a fake clamd):
a job killed mid-way goes back to queued; the database unreachable makes the worker sleep and retry; 50 queued jobs drain."""
import io
import threading
import time

import pytest

from app import logs
from app.config import MAX_ATTEMPTS
from app.store import FakeStore, StoreError
from app.worker import Worker
from tests import cards as C
from tests.conftest import make_job, make_pipeline, opened, settings


def row_of(job: dict) -> dict:
    return {k: v for k, v in job.items() if k not in ("status", "attempts")}


def wait_until(predicate, timeout=60.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.01)
    return False


class HangAt(FakeStore):
    """The first worker to reach `step` stops there for good (as if its process was killed): it never writes again until
    released, which only shows what a late writer can and cannot change."""

    def __init__(self, step: str) -> None:
        super().__init__()
        self.hang_step, self.hung, self.release = step, threading.Event(), threading.Event()

    def step(self, job_id, step, attempt, phase="fast"):
        super().step(job_id, step, attempt, phase)
        if step == self.hang_step and not self.hung.is_set():
            self.hung.set()
            self.release.wait(120)


@pytest.fixture()
def pipe(storage, engines, clamd):
    return make_pipeline(storage, engines, clamd.address)


def test_a_job_killed_mid_way_goes_back_to_queued_and_the_next_worker_finishes_it(pipe, storage, clamd, log_lines):
    store = HangAt("read")
    job = make_job(storage, C.png(C.pan_card()), job_id="job-kill")
    store.add(row_of(job))
    first = Worker(settings(clamd.address, threads=1), store, pipe.process, report_steps=True)
    dead = threading.Thread(target=first.run_once, daemon=True)
    dead.start()
    assert store.hung.wait(60)
    row = store.jobs["job-kill"]
    assert (row["status"], row["step"], row["attempts"]) == ("processing", "read", 1)  # the row knows where it stopped

    store.stuck_after = 0.0  # the sweeper's 3 minutes, shortened
    second = Worker(settings(clamd.address, threads=1), store, pipe.process, report_steps=True,
                    sleep=lambda s: time.sleep(min(s, 0.02)))
    second.start()  # its housekeeping sweeps at once: the job is queued again and its puller takes it
    assert wait_until(lambda: store.jobs["job-kill"]["status"] == "done")
    second.shutdown()
    done = dict(store.jobs["job-kill"])
    assert done["attempts"] == 2 and done["step"] == "upload"

    store.release.set()  # the "dead" attempt wakes up: its late result must change nothing
    dead.join(60)
    assert store.jobs["job-kill"]["attempts"] == 2 and store.jobs["job-kill"]["finished"] == done["finished"]
    assert '"event":"job_superseded","job":"job-kill","attempt":1' in log_lines.getvalue()
    assert opened(storage, job)[:2] in (b"\xff\xd8", b"\x89P")


def test_killed_three_times_ends_in_needs_attention_with_the_step_name_only(pipe, storage, clamd):
    store = FakeStore()
    job = make_job(storage, C.png(C.pan_card()), job_id="job-thrice")
    store.add(row_of(job))
    for attempt in range(1, MAX_ATTEMPTS + 1):
        claimed = store.claim()
        assert claimed["attempts"] == attempt

        def report(step, attempt=attempt):
            store.step("job-thrice", step, attempt)
            if step == "read":
                raise RuntimeError("killed")  # the process dies at the start of reading: nothing else is written
        with pytest.raises(RuntimeError):
            pipe.process(claimed, report=report)
        assert store.jobs["job-thrice"]["step"] == "read"
        assert store.requeue_stuck(stuck_after=0.0) == 1
    last = store.jobs["job-thrice"]
    assert (last["status"], last["step"], last["reason_code"]) == ("needs_attention", "read", "stuck")
    assert "message" not in last and not storage.uploads


def test_the_database_unreachable_while_idle_means_sleep_with_backoff_then_resume(log_lines):
    store, sleeps = FakeStore(), []
    for i in range(3):
        store.add({"id": f"job-{i}", "hotel_id": "h", "download_url": "x", "upload_url": "y", "wrapped_key": "z"})
    store.down = True
    w = Worker(settings(threads=1), store, lambda j: {"status": "done"}, sleep=lambda s: (sleeps.append(s), time.sleep(0.005)))
    w.start()
    assert wait_until(lambda: len(sleeps) >= 7)
    assert all(j["status"] == "queued" for j in store.jobs.values())
    assert [int(s) for s in sleeps[:7]] == [1, 2, 4, 8, 16, 30, 30]  # backoff plus up to 1 s of jitter
    store.down = False
    assert wait_until(lambda: all(j["status"] == "done" for j in store.jobs.values()))
    w.shutdown()
    assert '"event":"db_unreachable"' in log_lines.getvalue()


def test_the_database_gone_when_the_result_is_ready_keeps_the_result_and_writes_it_when_back(log_lines):
    store, sleeps = FakeStore(), []
    store.add({"id": "job-1", "hotel_id": "h"})

    def process(job):
        store.down = True  # the database goes away while the job runs
        threading.Timer(0.3, lambda: setattr(store, "down", False)).start()
        return {"status": "done", "flags": ["x"]}
    w = Worker(settings(threads=1), store, process, sleep=lambda s: (sleeps.append(s), time.sleep(0.1)))
    assert w.run_once()
    row = store.jobs["job-1"]
    assert row["status"] == "done" and row["attempts"] == 1 and row["flags"] == ["x"]  # same attempt, nothing redone
    assert sleeps and sleeps[0] == 1.0


def test_the_database_gone_for_too_long_gives_the_job_back_to_the_sweeper(log_lines):
    store, sleeps = FakeStore(), []
    store.add({"id": "job-1", "hotel_id": "h"})

    def process(job):
        store.down = True
        return {"status": "done"}
    w = Worker(settings(threads=1), store, process, sleep=lambda s: sleeps.append(s))
    with pytest.raises(StoreError):
        w.run_once()
    assert sum(sleeps) <= w.write_seconds and sleeps == [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0]
    store.down = False
    assert store.jobs["job-1"]["status"] == "processing"
    assert store.requeue_stuck(stuck_after=0.0) == 1 and store.jobs["job-1"]["status"] == "queued"  # nothing is lost
    w.process = lambda job: {"status": "done"}
    assert w.run_once() and store.jobs["job-1"]["status"] == "done" and store.jobs["job-1"]["attempts"] == 2


def test_a_step_name_that_cannot_be_written_does_not_stop_the_job(pipe, storage, clamd):
    class Flaky(FakeStore):
        def step(self, *a):
            raise StoreError("database unreachable")
    store = Flaky()
    job = make_job(storage, C.png(C.pan_card()), job_id="job-flaky")
    store.add(row_of(job))
    assert Worker(settings(clamd.address, threads=1), store, pipe.process, report_steps=True).run_once()
    assert store.jobs["job-flaky"]["status"] == "done"


def test_the_scanner_down_is_retried_and_never_skipped(storage, engines):
    pipe = make_pipeline(storage, engines, "tcp:127.0.0.1:1")
    store = FakeStore()
    store.add(row_of(make_job(storage, C.png(C.pan_card()), job_id="job-noscan")))
    w = Worker(settings("tcp:127.0.0.1:1", threads=1), store, pipe.process, report_steps=True)
    for _ in range(MAX_ATTEMPTS):
        assert w.run_once()
    row = store.jobs["job-noscan"]
    assert (row["status"], row["reason_code"], row["step"], row["attempts"]) == ("needs_attention", "scanner_unavailable", "scan", 3)
    assert not storage.uploads


def test_an_idle_worker_picks_a_new_job_up_within_2_seconds():
    store = FakeStore()
    w = Worker(settings(threads=1), store, lambda j: {"status": "done"})  # the real pull pace: 1 s with jitter
    w.start()
    time.sleep(1.5)
    store.add({"id": "job-1", "hotel_id": "h"})
    assert wait_until(lambda: store.jobs["job-1"]["status"] == "done", 5)
    w.shutdown()
    pickup = store.jobs["job-1"]["started"] - store.jobs["job-1"]["created"]
    print(f"\npicked up {pickup:.2f} s after it was queued")
    assert pickup < 2.0


def percentile(values, p):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(p / 100 * len(ordered) + 0.5) - 1))]


def test_fifty_real_jobs_drain_and_the_95th_percentile_is_reported(storage, engines, clamd):
    """50 invented one-picture jobs (four card kinds, PNG and JPEG) through the real pipeline, 3 threads (KVM 4: cores minus
    one), queued all at once. Reported: drain time, the 95th percentile from queued to done and of the work itself."""
    pipe = make_pipeline(storage, engines, clamd.address)
    store = FakeStore()
    makers = [C.aadhaar_front, C.pan_card, C.driving_licence, C.voter_id]
    for i in range(50):
        img = makers[i % 4]()
        data = C.png(img) if i % 2 else _jpeg(img)
        store.add(row_of(make_job(storage, data, job_id=f"job-{i:02d}")))
    w = Worker(settings(clamd.address, threads=3), store, pipe.process, report_steps=True, sleep=lambda s: time.sleep(min(s, 0.05)))
    t0 = time.monotonic()
    w.start()
    finished = wait_until(lambda: all(j["status"] in ("done", "rejected", "needs_attention") for j in store.jobs.values()), 900)
    drain = time.monotonic() - t0
    w.shutdown()
    assert finished
    jobs = list(store.jobs.values())
    statuses = {s: sum(1 for j in jobs if j["status"] == s) for s in {j["status"] for j in jobs}}
    waits = [j["finished"] - j["created"] for j in jobs]
    work = [j["finished"] - j["started"] for j in jobs]
    p95_wait, p95_work, p50_work = percentile(waits, 95), percentile(work, 95), percentile(work, 50)
    print(f"\n50 jobs, 3 threads: drained in {drain:.1f} s; queued to done p95 {p95_wait:.1f} s; "
          f"work per job p50 {p50_work:.1f} s, p95 {p95_work:.1f} s; {statuses}")
    assert all(j["attempts"] == 1 for j in jobs)  # nothing crashed, nothing was retried
    assert statuses.get("done", 0) + statuses.get("rejected", 0) == 50


def _jpeg(img):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()
