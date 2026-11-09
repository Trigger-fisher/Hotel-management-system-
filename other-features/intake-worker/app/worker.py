"""The job puller. Threads (cores minus one) each pull one job a second (with jitter); a heartbeat row every 30 seconds;
stuck jobs go back to the queue; an unreachable database means sleep with backoff and retry; shutdown finishes the current job.

Two parts per job (MJ, 5 Nov 2026): a queued job's FAST part always goes first; its fields are written with status `read`. A
`read` job's BACKGROUND part is taken only when no job is queued and fewer than `background_threads` background parts run, so a
thread is always free for the next guest's form."""
from __future__ import annotations

import random
import threading
import time

from . import logs
from .config import HEARTBEAT_SECONDS, MAX_ATTEMPTS, PULL_SECONDS, Settings
from .errors import StepError
from .store import Store, StoreError


class Worker:
    def __init__(self, settings: Settings, store: Store, process, signature_date=lambda: None, sleep=time.sleep,
                 background=None, report_steps: bool = False, feeds_date=lambda: None) -> None:
        self.settings, self.store, self.process, self.signature_date = settings, store, process, signature_date
        self.background = background
        self.report_steps = report_steps
        self.write_seconds = WRITE_SECONDS
        self.feeds_date = feeds_date
        self.stop = threading.Event()
        self._sleep = sleep
        self.threads: list[threading.Thread] = []
        self._busy = 0
        self._busy_lock = threading.Lock()
        self.background_limit = settings.background_threads or max(1, settings.threads - 1)

    # ---- one job -----------------------------------------------------------------------
    def run_once(self) -> bool:
        """Claim and process one job (or one job's background part). Returns False when nothing was waiting."""
        with self._busy_lock:
            allow = self.background is not None and self._busy < self.background_limit
            job = self.store.claim(background=allow)
            background = job is not None and job.get("phase") == "background"
            if background:
                self._busy += 1
        if job is None:
            return False
        if background:
            try:
                self._run(job, self.background, "background")
            finally:
                with self._busy_lock:
                    self._busy -= 1
        else:
            self._run(job, self.process, "fast")
        return True

    def _run(self, job: dict, work, phase: str) -> None:
        started = time.monotonic()
        mine = job["attempts"]
        if phase == "background":  # asked just before the upload: a swept attempt that wakes up late never overwrites the picture
            job = {**job, "still_mine": lambda: self.store.owns(job["id"], mine)}
        logs.event("job_start", job=job["id"], attempt=mine, step=phase)
        try:
            if self.report_steps:
                values = work(job, report=lambda step: self._step(job["id"], step, mine, phase))
            else:
                values = work(job)
            values["timings"] = {**values.get("timings", {}), ("backgroundMs" if phase == "background" else "totalMs"):
                                 int((time.monotonic() - started) * 1000)}
        except StepError as err:
            if err.code == "superseded":  # the job belongs to a later attempt now: this one writes nothing at all
                logs.event("job_superseded", job=job["id"], attempt=mine, step=phase)
                return
            retryable = not err.reject
            # A key that cannot be opened will not open on a retry: stop at once (needs_attention), nothing is uploaded.
            attempts = MAX_ATTEMPTS if err.code == "key_unwrap_failed" else mine
            if self._write(job["id"], self.store.fail, job["id"], attempts, retryable, err.code, err.step,
                           "" if retryable else err.message, phase, attempt=mine) is False:
                logs.event("job_superseded", job=job["id"], attempt=mine, step=phase)
            else:
                status = "rejected" if not retryable else "retry" if attempts < MAX_ATTEMPTS else "needs_attention"
                logs.event("job_failed", job=job["id"], code=err.code, step=err.step, status=status)
            return
        except StoreError:
            raise
        except Exception as err:  # never log the message: it could hold content
            self._write(job["id"], self.store.fail, job["id"], mine, True, "internal", getattr(err, "step", "unknown"), "", phase,
                        attempt=mine)
            logs.event("job_failed", job=job["id"], code="internal", status="retry", step=phase)
            return
        if phase == "background":
            written = self._write(job["id"], self.store.save, job["id"], values, attempt=mine)
            event = dict(status="done", ms=values["timings"]["backgroundMs"],
                         flags=len((values.get("background") or {}).get("disagreements") or []))
        elif values.get("status") == "read":
            written = self._write(job["id"], self.store.write_read, job["id"], values, attempt=mine)
            event = dict(status="read", ms=values["timings"]["totalMs"])
        else:
            written = self._write(job["id"], self.store.finish, job["id"], values, attempt=mine)
            event = dict(status="done", ms=values["timings"]["totalMs"])
        if written is False:
            logs.event("job_superseded", job=job["id"], attempt=mine, step=phase)
        else:
            logs.event("job_read" if event["status"] == "read" else "job_done", job=job["id"], **event)

    def _write(self, job_id: str, write, *args, **kw):
        """The outcome of a finished job is kept in memory while the database is away: retried with backoff for up to
        write_seconds of sleep, then given up (the sweeper re-queues the job, the attempt guard drops a late write)."""
        backoff, slept = 1.0, 0.0
        while True:
            try:
                return write(*args, **kw)
            except StoreError:
                if slept + backoff > self.write_seconds:
                    raise
                logs.event("db_unreachable", job=job_id, sleep=backoff)
                self._sleep(backoff)
                slept += backoff
                backoff = min(backoff * 2, 30.0)

    def _step(self, job_id: str, step: str, attempt: int, phase: str = "fast") -> None:
        try:
            self.store.step(job_id, step, attempt, phase)
        except StoreError:  # the step name is a help for the sweeper; a lost write must not stop the job
            pass

    # ---- loops ----------------------------------------------------------------------------
    def _loop(self) -> None:
        backoff = 1.0
        while not self.stop.is_set():
            try:
                worked = self.run_once()
                backoff = 1.0
            except StoreError:
                logs.event("db_unreachable", sleep=backoff)
                self._sleep(backoff + random.random())
                backoff = min(backoff * 2, 30.0)
                continue
            if not worked:
                self._sleep(PULL_SECONDS * (0.7 + 0.6 * random.random()))  # jitter

    def _housekeeping(self) -> None:
        last_beat = 0.0
        while not self.stop.is_set():
            if time.monotonic() - last_beat >= HEARTBEAT_SECONDS:
                try:
                    self.store.requeue_stuck()
                    self.store.heartbeat(self.settings.version, self.store.queue_depth(), self.signature_date(), self.feeds_date())
                    last_beat = time.monotonic()
                except StoreError:
                    logs.event("db_unreachable", sleep=5)
            self.stop.wait(1.0)

    def start(self) -> None:
        logs.event("worker_start", version=self.settings.version, threads=self.settings.threads)
        for i in range(self.settings.threads):
            self.threads.append(threading.Thread(target=self._loop, name=f"pull-{i}", daemon=True))
        self.threads.append(threading.Thread(target=self._housekeeping, name="housekeeping", daemon=True))
        for t in self.threads:
            t.start()

    def shutdown(self) -> None:
        """Graceful: stop pulling, let the current job finish."""
        self.stop.set()
        for t in self.threads:
            t.join(timeout=JOB_JOIN)


JOB_JOIN = 150
WRITE_SECONDS = 120  # under STUCK_AFTER_SECONDS: a result held through a short outage is written before the sweeper re-queues
