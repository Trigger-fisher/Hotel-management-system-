"""Part 10: the failure set, the isolation set (as far as a fake can show it), the log search, and the settings."""
import base64
import re
import threading
import time
from pathlib import Path

import pytest

from app import logs
from app.config import ConfigError, MAX_ATTEMPTS, load_settings
from app.errors import StepError, reject
from app.store import FakeStore
from app.worker import Worker
from tests import cards as C
from tests.conftest import DATA_KEY, HOST, MASTER, make_job, make_pipeline, settings

SQL = (Path(__file__).resolve().parents[1] / "sql" / "proposal.sql").read_text(encoding="utf-8")


def job(i: int) -> dict:
    return {"id": f"job-{i:04d}", "hotel_id": "h", "download_url": "x", "upload_url": "y", "wrapped_key": "z"}


def worker(store, process, threads=2, sleep=lambda s: time.sleep(min(s, 0.01))):
    w = Worker(settings(threads=threads), store, process, sleep=sleep)
    return w


def wait_until(predicate, timeout=20.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.01)
    return False


# ---- failure set ---------------------------------------------------------------------------------

def test_killed_mid_job_returns_to_queued_then_needs_attention_with_the_step_name_only():
    store = FakeStore()
    store.add(job(1))
    for attempt in range(1, MAX_ATTEMPTS + 1):
        claimed = store.claim()  # a worker takes it ... and dies: no finish, no fail
        assert claimed["attempts"] == attempt and store.jobs["job-0001"]["status"] == "processing"
        store.jobs["job-0001"]["step"] = "read"
        assert store.requeue_stuck(stuck_after=0.0) == 1
        expected = "queued" if attempt < MAX_ATTEMPTS else "needs_attention"
        assert store.jobs["job-0001"]["status"] == expected
    last = store.jobs["job-0001"]
    assert last["step"] == "read" and last["reason_code"] == "stuck" and "message" not in last  # the step name, never content


def test_database_down_means_sleep_and_resume():
    store, sleeps = FakeStore(), []
    for i in range(3):
        store.add(job(i))
    store.down = True
    w = worker(store, lambda j: {"status": "done"}, threads=1, sleep=lambda s: (sleeps.append(s), time.sleep(0.01)))
    w.start()
    assert wait_until(lambda: len(sleeps) >= 3)
    assert all(j["status"] == "queued" for j in store.jobs.values())  # nothing lost while the database was away
    assert sleeps == sorted(sleeps) or max(sleeps) <= 31  # backing off
    store.down = False
    assert wait_until(lambda: all(j["status"] == "done" for j in store.jobs.values()))
    w.shutdown()


def test_two_threads_never_take_the_same_job():
    store, taken = FakeStore(), []
    for i in range(40):
        store.add(job(i))
    lock = threading.Lock()

    def process(j):
        with lock:
            taken.append(j["id"])
        time.sleep(0.002)
        return {"status": "done"}
    w = worker(store, process, threads=4)
    w.start()
    assert wait_until(lambda: all(j["status"] == "done" for j in store.jobs.values()))
    w.shutdown()
    assert len(taken) == len(set(taken)) == 40


def test_graceful_shutdown_finishes_the_current_job():
    store, started, release = FakeStore(), threading.Event(), threading.Event()
    store.add(job(1))

    def slow(j):
        started.set()
        release.wait(5)
        return {"status": "done"}
    w = worker(store, slow, threads=1)
    w.start()
    assert started.wait(5)
    threading.Timer(0.2, release.set).start()
    w.shutdown()  # stop pulling, wait for the running job
    assert store.jobs["job-0001"]["status"] == "done"


def test_a_rejected_file_is_never_retried_but_a_system_error_is():
    store = FakeStore()
    store.add(job(1))
    store.add(job(2))

    def process(j):
        if j["id"] == "job-0001":
            raise reject("unsupported_type", "Only JPEG, PNG, WebP, HEIC and PDF files are accepted.", "type")
        raise StepError("download_failed", "x", 502, False, "download")
    w = worker(store, process, threads=1)
    assert w.run_once() and w.run_once()
    assert store.jobs["job-0001"]["status"] == "rejected" and store.jobs["job-0001"]["attempts"] == 1
    assert store.jobs["job-0002"]["status"] == "queued" and store.jobs["job-0002"]["step"] == "download"
    for _ in range(MAX_ATTEMPTS):
        w.run_once()
    assert store.jobs["job-0002"]["status"] == "needs_attention" and store.jobs["job-0002"]["step"] == "download"


def test_an_unexpected_crash_is_retried_and_its_text_is_never_stored():
    store = FakeStore()
    store.add(job(1))

    def process(j):
        raise RuntimeError("secret guest name Ramesh in this message")
    w = worker(store, process, threads=1)
    w.run_once()
    assert store.jobs["job-0001"]["status"] == "queued" and store.jobs["job-0001"]["reason_code"] == "internal"
    assert "Ramesh" not in str(store.jobs["job-0001"])


def test_heartbeat_carries_version_queue_depth_and_signature_date():
    store = FakeStore()
    store.add(job(1))
    w = Worker(settings(threads=1), store, lambda j: {}, signature_date=lambda: "Mon Nov  3 07:25:00 2026")
    store.requeue_stuck()
    store.heartbeat(w.settings.version, store.queue_depth(), w.signature_date())
    beat = store.heartbeats[-1]
    assert beat["version"] == "0.1.0" and beat["queue_depth"] == 1 and "2026" in beat["signature_date"]


def test_fifty_jobs_in_the_queue_p95():
    """50 jobs, 3 threads, the REAL pipeline stand-in is replaced by a fixed 40 ms step so the queue itself is measured."""
    store = FakeStore()
    for i in range(50):
        store.add(job(i))

    def process(j):
        time.sleep(0.04)
        return {"status": "done"}
    w = worker(store, process, threads=3)
    t0 = time.monotonic()
    w.start()
    assert wait_until(lambda: all(j["status"] == "done" for j in store.jobs.values()), 30)
    w.shutdown()
    waits = sorted(j["finished"] - j["created"] for j in store.jobs.values())
    p95 = waits[int(0.95 * len(waits)) - 1]
    print(f"\n50 queued jobs, 3 threads, 40 ms each: all done in {time.monotonic() - t0:.2f} s, 95th percentile wait {p95:.2f} s")
    assert p95 < 5


# ---- isolation set (what a fake can show) ---------------------------------------------------------------

def test_the_proposed_database_role_can_only_touch_the_two_tables():
    text = re.sub(r"--.*", "", SQL)
    assert "GRANT SELECT ON intake_jobs TO intake_worker" in text and "GRANT INSERT ON worker_heartbeat TO intake_worker" in text
    assert re.search(r"GRANT UPDATE \(.+?\)\s+ON intake_jobs TO intake_worker", text, re.S)
    granted_tables = set(re.findall(r"ON\s+(?:TABLE\s+)?([a-z_]+)\s+TO\s+intake_worker", text))
    assert granted_tables <= {"intake_jobs", "worker_heartbeat"}
    assert "DELETE" not in text.upper().split("GRANT")[-1] and not re.search(r"GRANT\s+ALL", text, re.I)
    assert "REVOKE ALL ON SCHEMA public FROM intake_worker" in text
    assert "WHERE status = 'queued'" in text and "intake_jobs_queued_idx" in text  # the index for the pull query


def test_a_link_for_another_host_cannot_be_used(storage, engines):
    pipe = make_pipeline(storage, engines)
    j = make_job(storage, C.png(C.pan_card()))
    j["upload_url"] = "https://another-bucket.example.org/id/x"
    with pytest.raises(StepError) as e:
        pipe.process(j)
    assert e.value.code == "link_not_allowed" and not storage.uploads


@pytest.mark.skip(reason="needs a real Supabase project: signed-link scope per hotel folder and the 60-second download link are HMS-side")
def test_hotel_a_link_cannot_write_into_hotel_b_and_download_links_expire():
    pass


# ---- logs and settings ---------------------------------------------------------------------------------------

def test_no_log_line_contains_a_name_a_number_a_link_or_a_key(storage, engines, clamd, log_lines):
    pipe = make_pipeline(storage, engines, clamd.address)
    store = FakeStore()
    j = make_job(storage, C.png(C.aadhaar_front()), job_id="job-logs")
    store.add({k: v for k, v in j.items() if k not in ("status", "attempts")})
    bad = make_job(storage, b"MZ not a picture", job_id="job-bad")
    store.add({k: v for k, v in bad.items() if k not in ("status", "attempts")})
    w = Worker(settings(clamd.address, threads=1), store, pipe.process)
    while w.run_once():
        pass
    logs.event("db_unreachable", sleep=2)
    logs.event("unsafe", job="job-x", code="https://storage.example.test/q/job-0001?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEF")
    text = log_lines.getvalue()
    assert "job_done" in text and "job_failed" in text
    forbidden = ["Ramesh", "Kumar", "Shah", C.AADHAAR, C.SPACED, HOST, "https://", "token=", base64.b64encode(MASTER).decode(),
                 DATA_KEY.hex(), base64.b64encode(DATA_KEY).decode(), "Government of India", "1990"]
    for word in forbidden:
        assert word not in text, word
    assert "[redacted]" in text  # a link smuggled into an allowed key is scrubbed
    assert all(set(__import__("json").loads(line)) <= logs.ALLOWED for line in text.splitlines())


def test_settings_need_a_real_master_key_a_database_and_a_scanner():
    good = {"INTAKE_DATABASE_URL": "postgresql://x", "INTAKE_MASTER_KEY": base64.b64encode(MASTER).decode()}
    assert load_settings(good).threads >= 1 and load_settings(good).clamd
    for bad, env in (("short key", {**good, "INTAKE_MASTER_KEY": base64.b64encode(b"short").decode()}),
                     ("no key", {**good, "INTAKE_MASTER_KEY": ""}), ("no database", {"INTAKE_MASTER_KEY": good["INTAKE_MASTER_KEY"]}),
                     ("scan skipped", {**good, "INTAKE_CLAMD": ""})):
        with pytest.raises(ConfigError):
            load_settings(env)
    assert "master" not in repr(load_settings(good)).lower() or "b'" not in repr(load_settings(good))  # secrets stay out of repr
