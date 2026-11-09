"""The job table, behind one small interface. PgStore talks to PostgreSQL with FOR UPDATE SKIP LOCKED; FakeStore is the same
behaviour in memory for tests. The worker's database role can SELECT and UPDATE intake_jobs and INSERT worker_heartbeat only
(see sql/proposal.sql).

A job runs in two parts (MJ, 5 Nov 2026): queued -> processing (fast part) -> read (the fields are in the row, the form fills) ->
saving (background part) -> done. A crash in the background part puts the job back to `read`: the fields already written stay.
The background part may write only SAVE_COLUMNS, so it can never change a field the form shows."""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Protocol

from .config import MAX_ATTEMPTS, STUCK_AFTER_SECONDS

JOB_COLUMNS = ("id", "hotel_id", "status", "attempts", "download_url", "back_download_url", "upload_url", "wrapped_key",
               "profile", "gate_action", "size_cap_bytes", "lossless", "document_type", "type_config", "mask_id_numbers", "languages")
READ_COLUMNS = ("needs_human_check", "document_type_read", "fields", "doubtful_fields", "same_person", "flags", "scores",
                "scan_engine", "pages", "timings", "person", "clarity", "photo", "suggested_name")
SAVE_COLUMNS = ("needs_human_check", "flags", "scores", "result_bytes", "timings", "background")
RESULT_COLUMNS = tuple(dict.fromkeys(("status", "step", "reason_code", "message") + READ_COLUMNS + SAVE_COLUMNS))
RENAMED = {"document_type": "document_type_read"}  # the job row's document_type is HMS's hint; the type read has its own column


def columns(values: dict, allowed: tuple) -> dict:
    """The values that go into the row, under their column names, limited to `allowed`."""
    out = {RENAMED.get(k, k): v for k, v in values.items()}
    return {k: v for k, v in out.items() if k in allowed}


def read_values(row: dict) -> dict:
    """What the fast part wrote, back in the shape the pipeline produced (for the background part)."""
    out = {k: row.get(k) for k in READ_COLUMNS}
    out["document_type"] = out.pop("document_type_read")
    return out


class StoreError(Exception):
    """The database cannot be reached. The worker sleeps and retries."""


class Store(Protocol):
    def claim(self, background: bool = True) -> dict | None: ...
    def write_read(self, job_id: str, values: dict, attempt: int | None = None) -> bool: ...
    def save(self, job_id: str, values: dict, attempt: int | None = None) -> bool: ...
    def finish(self, job_id: str, values: dict, attempt: int | None = None) -> bool: ...
    def fail(self, job_id: str, attempts: int, retryable: bool, code: str, step: str, message: str, phase: str = "fast",
             attempt: int | None = None) -> bool: ...
    def step(self, job_id: str, step: str, attempt: int, phase: str = "fast") -> None: ...
    def owns(self, job_id: str, attempt: int) -> bool: ...
    def requeue_stuck(self) -> int: ...
    def heartbeat(self, version: str, queue_depth: int, signature_date: str | None, feeds_date: str | None = None) -> None: ...
    def queue_depth(self) -> int: ...


class PgStore:
    CLAIM = f"""
        UPDATE intake_jobs SET status = 'processing', started_at = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM intake_jobs WHERE status = 'queued' ORDER BY created_at
                    FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING {", ".join(JOB_COLUMNS)}"""
    CLAIM_BACKGROUND = f"""
        UPDATE intake_jobs SET status = 'saving', saving_started_at = now(), background_attempts = background_attempts + 1
        WHERE id = (SELECT id FROM intake_jobs WHERE status = 'read' ORDER BY read_at
                    FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING {", ".join(JOB_COLUMNS + ("background_attempts",) + READ_COLUMNS)}"""
    STUCK = f"""
        UPDATE intake_jobs SET
          status = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN 'needs_attention' ELSE 'queued' END,
          step = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN COALESCE(step, 'unknown') ELSE step END,
          reason_code = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN 'stuck' ELSE reason_code END
        WHERE status = 'processing' AND started_at < now() - interval '{STUCK_AFTER_SECONDS} seconds'"""
    STUCK_BACKGROUND = f"""
        UPDATE intake_jobs SET
          status = CASE WHEN background_attempts >= {MAX_ATTEMPTS} THEN 'needs_attention' ELSE 'read' END,
          step = CASE WHEN background_attempts >= {MAX_ATTEMPTS} THEN COALESCE(step, 'unknown') ELSE step END,
          reason_code = CASE WHEN background_attempts >= {MAX_ATTEMPTS} THEN 'stuck' ELSE reason_code END
        WHERE status = 'saving' AND saving_started_at < now() - interval '{STUCK_AFTER_SECONDS * 3} seconds'"""

    def __init__(self, database_url: str) -> None:
        import psycopg
        self._psycopg = psycopg
        self._url = database_url
        self._local = threading.local()

    def _conn(self):
        conn = getattr(self._local, "conn", None)
        if conn is None or conn.closed:
            try:
                conn = self._psycopg.connect(self._url, autocommit=True, connect_timeout=5)
            except self._psycopg.OperationalError:
                raise StoreError("database unreachable")
            self._local.conn = conn
        return conn

    def _run(self, sql: str, params=(), fetch: bool = False):
        try:
            with self._conn().cursor() as cur:
                cur.execute(sql, params)
                return cur.fetchall() if fetch else cur.rowcount
        except self._psycopg.OperationalError:
            self._local.conn = None
            raise StoreError("database unreachable")

    def claim(self, background: bool = True):
        rows = self._run(self.CLAIM, fetch=True)
        if rows:
            return {**dict(zip(JOB_COLUMNS, rows[0])), "phase": "fast"}
        if not background:
            return None
        rows = self._run(self.CLAIM_BACKGROUND, fetch=True)
        if not rows:
            return None
        row = dict(zip(JOB_COLUMNS + ("background_attempts",) + READ_COLUMNS, rows[0]))
        return {**{k: row[k] for k in JOB_COLUMNS}, "attempts": row["background_attempts"], "phase": "background",
                "read": read_values(row)}

    @staticmethod
    def _owned(attempt, phase="fast"):
        """Only the latest claim may write: once a swept job was claimed again, the earlier attempt's late result changes nothing."""
        col = "background_attempts" if phase == "background" else "attempts"
        return ("", []) if attempt is None else (f" AND {col} = %s", [attempt])

    def _update(self, job_id, values: dict, allowed: tuple, status: str, stamp: str, attempt=None, phase="fast"):
        cols = columns(values, allowed)
        sets = ", ".join([f"{c} = %s" for c in cols] + ["status = %s", f"{stamp} = now()"])
        guard, extra = self._owned(attempt, phase)
        return self._run(f"UPDATE intake_jobs SET {sets} WHERE id = %s{guard}",
                         [self._json(v) for v in cols.values()] + [status, job_id] + extra) > 0

    def write_read(self, job_id, values, attempt=None):
        return self._update(job_id, values, READ_COLUMNS, "read", "read_at", attempt)

    def save(self, job_id, values, attempt=None):
        return self._update(job_id, values, SAVE_COLUMNS, "done", "finished_at", attempt, "background")

    def finish(self, job_id, values, attempt=None):
        cols = columns(values, RESULT_COLUMNS)
        sets = ", ".join(f"{c} = %s" for c in cols) + ", finished_at = now()"
        guard, extra = self._owned(attempt)
        return self._run(f"UPDATE intake_jobs SET {sets} WHERE id = %s{guard}",
                         [self._json(v) for v in cols.values()] + [job_id] + extra) > 0

    def _json(self, v):
        from psycopg.types.json import Jsonb
        return Jsonb(v) if isinstance(v, (dict, list)) else v

    def fail(self, job_id, attempts, retryable, code, step, message, phase="fast", attempt=None):
        guard, extra = self._owned(attempt, phase)
        if retryable and attempts < MAX_ATTEMPTS:
            again = "read" if phase == "background" else "queued"
            return self._run(f"UPDATE intake_jobs SET status = %s, step = %s, reason_code = %s WHERE id = %s{guard}",
                             [again, step, code, job_id] + extra) > 0
        # a background part that cannot finish keeps the form's fields: the job needs a person, the picture is not saved
        status = "needs_attention" if retryable or phase == "background" else "rejected"
        return self._run(f"UPDATE intake_jobs SET status = %s, step = %s, reason_code = %s, message = %s, finished_at = now() WHERE id = %s{guard}",
                         [status, step, code, message, job_id] + extra) > 0

    def step(self, job_id, step, attempt, phase="fast"):
        col, status = ("background_attempts", "saving") if phase == "background" else ("attempts", "processing")
        self._run(f"UPDATE intake_jobs SET step = %s WHERE id = %s AND {col} = %s AND status = %s", (step, job_id, attempt, status))

    def owns(self, job_id, attempt):
        """Just before the picture is uploaded: this background attempt still holds the job (status `saving`, the latest claim).
        The check renews the claim's start time, so the sweeper does not hand the job to another attempt during the upload."""
        return self._run("UPDATE intake_jobs SET saving_started_at = now() WHERE id = %s AND background_attempts = %s AND status = 'saving'",
                         (job_id, attempt)) > 0

    def requeue_stuck(self):
        return self._run(self.STUCK) + self._run(self.STUCK_BACKGROUND)

    def queue_depth(self):
        return self._run("SELECT count(*) FROM intake_jobs WHERE status IN ('queued', 'read')", fetch=True)[0][0]

    def heartbeat(self, version, queue_depth, signature_date, feeds_date=None):
        self._run("INSERT INTO worker_heartbeat (last_seen, version, queue_depth, signature_date, feeds_date) VALUES (now(), %s, %s, %s, %s)",
                  (version, queue_depth, signature_date, feeds_date))


class FakeStore:
    """Same rules in memory: oldest queued job first, then the oldest `read` job for a background part, one claimer per job,
    stuck jobs return to their queue."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict] = {}
        self.heartbeats: list[dict] = []
        self.lock = threading.Lock()
        self.down = False  # set True to simulate an unreachable database
        self.stuck_after = float(STUCK_AFTER_SECONDS)
        self.order: list[str] = []
        self.writes: list[tuple[str, str, tuple]] = []  # (job, kind, columns written): the tests check who wrote what

    def add(self, job: dict) -> None:
        with self.lock:
            self.jobs[job["id"]] = {"status": "queued", "attempts": 0, "background_attempts": 0, "created": time.monotonic(), **job}
            self.order.append(job["id"])

    def _check(self):
        if self.down:
            raise StoreError("database unreachable")

    def claim(self, background: bool = True):
        self._check()
        with self.lock:
            for jid in self.order:
                job = self.jobs[jid]
                if job["status"] == "queued":
                    job.update(status="processing", started=time.monotonic(), attempts=job["attempts"] + 1)
                    return {**{k: job.get(k) for k in JOB_COLUMNS}, "phase": "fast"}
            if not background:
                return None
            ready = [self.jobs[j] for j in self.order if self.jobs[j]["status"] == "read"]
            if not ready:
                return None
            job = min(ready, key=lambda j: j["read_at"])
            job.update(status="saving", saving_started=time.monotonic(), background_attempts=job["background_attempts"] + 1)
            return {**{k: job.get(k) for k in JOB_COLUMNS}, "attempts": job["background_attempts"], "phase": "background",
                    "read": read_values(job)}

    @staticmethod
    def _mine(job, attempt, phase="fast"):
        return attempt is None or job["background_attempts" if phase == "background" else "attempts"] == attempt

    def _write(self, job_id, values, allowed, kind, attempt=None, phase="fast", **extra):
        self._check()
        with self.lock:
            if not self._mine(self.jobs[job_id], attempt, phase):
                return False
            cols = columns(values, allowed)
            self.jobs[job_id].update(cols, **extra)
            self.writes.append((job_id, kind, tuple(cols)))
            return True

    def write_read(self, job_id, values, attempt=None):
        return self._write(job_id, values, READ_COLUMNS, "read", attempt, status="read", read_at=time.monotonic())

    def save(self, job_id, values, attempt=None):
        return self._write(job_id, values, SAVE_COLUMNS, "save", attempt, "background", status="done", finished=time.monotonic())

    def finish(self, job_id, values, attempt=None):
        return self._write(job_id, values, RESULT_COLUMNS, "finish", attempt, finished=time.monotonic())

    def fail(self, job_id, attempts, retryable, code, step, message, phase="fast", attempt=None):
        self._check()
        with self.lock:
            job = self.jobs[job_id]
            if not self._mine(job, attempt, phase):
                return False
            if retryable and attempts < MAX_ATTEMPTS:
                job.update(status="read" if phase == "background" else "queued", step=step, reason_code=code)
            else:
                job.update(status="needs_attention" if retryable or phase == "background" else "rejected", step=step, reason_code=code,
                           message=message, finished=time.monotonic())
            return True

    def step(self, job_id, step, attempt, phase="fast"):
        self._check()
        with self.lock:
            job = self.jobs[job_id]
            if self._mine(job, attempt, phase) and job["status"] == ("saving" if phase == "background" else "processing"):
                job["step"] = step

    def owns(self, job_id, attempt):
        self._check()
        with self.lock:
            job = self.jobs[job_id]
            if job["status"] != "saving" or not self._mine(job, attempt, "background"):
                return False
            job["saving_started"] = time.monotonic()
            return True

    def requeue_stuck(self, stuck_after: float | None = None):
        self._check()
        stuck_after = self.stuck_after if stuck_after is None else stuck_after
        n = 0
        with self.lock:
            for job in self.jobs.values():
                if job["status"] == "processing" and time.monotonic() - job["started"] >= stuck_after:
                    if job["attempts"] >= MAX_ATTEMPTS:
                        job.update(status="needs_attention", step=job.get("step") or "unknown", reason_code="stuck")
                    else:
                        job["status"] = "queued"
                    n += 1
                elif job["status"] == "saving" and time.monotonic() - job["saving_started"] >= 3 * stuck_after:
                    if job["background_attempts"] >= MAX_ATTEMPTS:
                        job.update(status="needs_attention", step=job.get("step") or "unknown", reason_code="stuck")
                    else:
                        job["status"] = "read"
                    n += 1
        return n

    def queue_depth(self):
        self._check()
        return sum(1 for j in self.jobs.values() if j["status"] in ("queued", "read"))

    def heartbeat(self, version, queue_depth, signature_date, feeds_date=None):
        self._check()
        self.heartbeats.append({"last_seen": datetime.now(timezone.utc), "version": version, "queue_depth": queue_depth,
                                "signature_date": signature_date, "feeds_date": feeds_date})
