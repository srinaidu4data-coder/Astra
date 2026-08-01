"""
Durable store for Night Scout — overnight search campaigns.

Scale path (lab → multi-tenant):
  - SQLite today (single node, WAL, multi-reader)
  - Swap URI to Postgres later without changing API shape
  - Every row is tenant-scoped for isolation
  - Runs use lease/lock fields for multi-worker safety

Mega-scale roadmap: queue → Redis/SQS, workers → K8s HPA, store → Postgres,
digests → object storage. Interface stays the same.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

# Data dir next to package parent (src/data) or env override
_DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "night_scout.db"

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def _db_path() -> Path:
    import os

    env = os.environ.get("JOBSEARCH_NIGHT_DB", "").strip()
    return Path(env) if env else _DEFAULT_DB


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _connect() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is not None:
            return _conn
        path = _db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _init_schema(conn)
        _conn = conn
        return conn


@contextmanager
def _tx() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    with _lock:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT 'Night Scout',
            enabled INTEGER NOT NULL DEFAULT 1,
            target_title TEXT NOT NULL,
            skills_json TEXT NOT NULL DEFAULT '[]',
            resume_text TEXT DEFAULT '',
            location TEXT NOT NULL DEFAULT 'us',
            remote TEXT NOT NULL DEFAULT 'all',
            exclude_linkedin INTEGER NOT NULL DEFAULT 0,
            include_seed INTEGER NOT NULL DEFAULT 0,
            limit_jobs INTEGER NOT NULL DEFAULT 100,
            run_hour_local INTEGER NOT NULL DEFAULT 2,
            wake_hour_local INTEGER NOT NULL DEFAULT 7,
            timezone TEXT NOT NULL DEFAULT 'local',
            build_apply_plan INTEGER NOT NULL DEFAULT 1,
            last_run_at TEXT,
            next_run_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        CREATE INDEX IF NOT EXISTS idx_sched_tenant ON schedules(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_sched_next ON schedules(enabled, next_run_at);

        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            schedule_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            status TEXT NOT NULL,
            worker_id TEXT,
            lease_until TEXT,
            started_at TEXT,
            finished_at TEXT,
            error TEXT,
            job_count INTEGER DEFAULT 0,
            live_count INTEGER DEFAULT 0,
            elapsed_ms INTEGER DEFAULT 0,
            morning_ready INTEGER NOT NULL DEFAULT 0,
            digest_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (schedule_id) REFERENCES schedules(id)
        );

        CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs(tenant_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, morning_ready);
        CREATE INDEX IF NOT EXISTS idx_runs_schedule ON runs(schedule_id, created_at);

        CREATE TABLE IF NOT EXISTS worker_heartbeats (
            worker_id TEXT PRIMARY KEY,
            last_seen TEXT NOT NULL,
            meta_json TEXT DEFAULT '{}'
        );
        """
    )


def ensure_tenant(tenant_id: str | None = None, name: str = "default") -> str:
    tid = (tenant_id or "local-default").strip() or "local-default"
    with _tx() as conn:
        row = conn.execute("SELECT id FROM tenants WHERE id=?", (tid,)).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO tenants(id, name, created_at) VALUES (?,?,?)",
                (tid, name, _utc_now()),
            )
    return tid


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def compute_next_run(
    run_hour_local: int,
    *,
    from_dt: datetime | None = None,
    force_tomorrow: bool = False,
) -> str:
    """Next local wall-clock at run_hour (0-23). Stored as UTC ISO."""
    now = from_dt or datetime.now().astimezone()
    target = now.replace(hour=int(run_hour_local) % 24, minute=0, second=0, microsecond=0)
    if force_tomorrow or target <= now:
        target = target + timedelta(days=1)
    return target.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def upsert_schedule(tenant_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    tid = ensure_tenant(tenant_id)
    sid = str(payload.get("id") or _new_id("sch"))
    now = _utc_now()
    skills = payload.get("skills") or []
    if isinstance(skills, str):
        skills = [s.strip() for s in skills.split(",") if s.strip()]
    run_hour = int(payload.get("run_hour_local", 2))
    wake_hour = int(payload.get("wake_hour_local", 7))
    enabled = 1 if payload.get("enabled", True) else 0
    next_run = payload.get("next_run_at") or compute_next_run(run_hour)

    with _tx() as conn:
        existing = conn.execute("SELECT id FROM schedules WHERE id=?", (sid,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE schedules SET
                  name=?, enabled=?, target_title=?, skills_json=?, resume_text=?,
                  location=?, remote=?, exclude_linkedin=?, include_seed=?, limit_jobs=?,
                  run_hour_local=?, wake_hour_local=?, timezone=?, build_apply_plan=?,
                  next_run_at=?, updated_at=?
                WHERE id=? AND tenant_id=?
                """,
                (
                    str(payload.get("name") or "Night Scout"),
                    enabled,
                    str(payload.get("target_title") or "Software Engineer"),
                    json.dumps(list(skills)[:40]),
                    str(payload.get("resume_text") or "")[:8000],
                    str(payload.get("location") or "us"),
                    str(payload.get("remote") or "all"),
                    1 if payload.get("exclude_linkedin") else 0,
                    1 if payload.get("include_seed") else 0,
                    max(20, min(int(payload.get("limit_jobs") or 100), 500)),
                    run_hour,
                    wake_hour,
                    str(payload.get("timezone") or "local"),
                    1 if payload.get("build_apply_plan", True) else 0,
                    next_run,
                    now,
                    sid,
                    tid,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO schedules(
                  id, tenant_id, name, enabled, target_title, skills_json, resume_text,
                  location, remote, exclude_linkedin, include_seed, limit_jobs,
                  run_hour_local, wake_hour_local, timezone, build_apply_plan,
                  next_run_at, created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    sid,
                    tid,
                    str(payload.get("name") or "Night Scout"),
                    enabled,
                    str(payload.get("target_title") or "Software Engineer"),
                    json.dumps(list(skills)[:40]),
                    str(payload.get("resume_text") or "")[:8000],
                    str(payload.get("location") or "us"),
                    str(payload.get("remote") or "all"),
                    1 if payload.get("exclude_linkedin") else 0,
                    1 if payload.get("include_seed") else 0,
                    max(20, min(int(payload.get("limit_jobs") or 100), 500)),
                    run_hour,
                    wake_hour,
                    str(payload.get("timezone") or "local"),
                    1 if payload.get("build_apply_plan", True) else 0,
                    next_run,
                    now,
                    now,
                ),
            )
    return get_schedule(tid, sid) or {}


def get_schedule(tenant_id: str, schedule_id: str) -> dict[str, Any] | None:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM schedules WHERE id=? AND tenant_id=?",
        (schedule_id, tenant_id),
    ).fetchone()
    return _schedule_row(row) if row else None


def list_schedules(tenant_id: str) -> list[dict[str, Any]]:
    tid = ensure_tenant(tenant_id)
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM schedules WHERE tenant_id=? ORDER BY updated_at DESC",
        (tid,),
    ).fetchall()
    return [_schedule_row(r) for r in rows]


def delete_schedule(tenant_id: str, schedule_id: str) -> bool:
    with _tx() as conn:
        cur = conn.execute(
            "DELETE FROM schedules WHERE id=? AND tenant_id=?",
            (schedule_id, tenant_id),
        )
        return cur.rowcount > 0


def _schedule_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    try:
        d["skills"] = json.loads(d.pop("skills_json") or "[]")
    except Exception:
        d["skills"] = []
    d["enabled"] = bool(d.get("enabled"))
    d["exclude_linkedin"] = bool(d.get("exclude_linkedin"))
    d["include_seed"] = bool(d.get("include_seed"))
    d["build_apply_plan"] = bool(d.get("build_apply_plan"))
    return d


def claim_due_schedules(
    worker_id: str,
    *,
    limit: int = 10,
    lease_sec: int = 600,
) -> list[dict[str, Any]]:
    """
    Multi-worker safe: select due enabled schedules, create run rows with lease.
    """
    now = datetime.now(timezone.utc)
    now_s = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    lease_until = (now + timedelta(seconds=lease_sec)).strftime("%Y-%m-%dT%H:%M:%SZ")
    claimed: list[dict[str, Any]] = []

    with _tx() as conn:
        rows = conn.execute(
            """
            SELECT * FROM schedules
            WHERE enabled=1
              AND (next_run_at IS NULL OR next_run_at <= ?)
            ORDER BY CASE WHEN next_run_at IS NULL THEN 0 ELSE 1 END, next_run_at ASC
            LIMIT ?
            """,
            (now_s, limit),
        ).fetchall()

        for row in rows:
            sch = _schedule_row(row)
            # skip if a run already running for this schedule with valid lease
            busy = conn.execute(
                """
                SELECT id FROM runs
                WHERE schedule_id=? AND status='running'
                  AND (lease_until IS NULL OR lease_until > ?)
                LIMIT 1
                """,
                (sch["id"], now_s),
            ).fetchone()
            if busy:
                continue
            rid = _new_id("run")
            conn.execute(
                """
                INSERT INTO runs(
                  id, schedule_id, tenant_id, status, worker_id, lease_until,
                  started_at, created_at, morning_ready
                ) VALUES (?,?,?,?,?,?,?,?,0)
                """,
                (
                    rid,
                    sch["id"],
                    sch["tenant_id"],
                    "running",
                    worker_id,
                    lease_until,
                    now_s,
                    now_s,
                ),
            )
            # advance next_run immediately to avoid double claim
            next_run = compute_next_run(int(sch["run_hour_local"]), force_tomorrow=True)
            conn.execute(
                "UPDATE schedules SET next_run_at=?, last_run_at=?, updated_at=? WHERE id=?",
                (next_run, now_s, now_s, sch["id"]),
            )
            sch["_run_id"] = rid
            claimed.append(sch)

        conn.execute(
            """
            INSERT INTO worker_heartbeats(worker_id, last_seen, meta_json)
            VALUES (?,?,?)
            ON CONFLICT(worker_id) DO UPDATE SET last_seen=excluded.last_seen
            """,
            (worker_id, now_s, json.dumps({"claimed": len(claimed)})),
        )
    return claimed


def complete_run(
    run_id: str,
    *,
    status: str,
    digest: dict[str, Any] | None = None,
    error: str | None = None,
    job_count: int = 0,
    live_count: int = 0,
    elapsed_ms: int = 0,
) -> None:
    now = _utc_now()
    with _tx() as conn:
        conn.execute(
            """
            UPDATE runs SET
              status=?, finished_at=?, error=?, job_count=?, live_count=?,
              elapsed_ms=?, morning_ready=?, digest_json=?, lease_until=NULL
            WHERE id=?
            """,
            (
                status,
                now,
                (error or "")[:500] if error else None,
                job_count,
                live_count,
                elapsed_ms,
                1 if status == "succeeded" else 0,
                json.dumps(digest or {}, default=str) if digest else None,
                run_id,
            ),
        )


def force_enqueue_run(tenant_id: str, schedule_id: str) -> dict[str, Any] | None:
    """Set next_run_at to now so worker picks it up ASAP (or run inline)."""
    sch = get_schedule(tenant_id, schedule_id)
    if not sch:
        return None
    now = _utc_now()
    with _tx() as conn:
        conn.execute(
            "UPDATE schedules SET next_run_at=?, updated_at=? WHERE id=? AND tenant_id=?",
            (now, now, schedule_id, tenant_id),
        )
    return get_schedule(tenant_id, schedule_id)


def create_running_run(
    tenant_id: str,
    schedule_id: str,
    *,
    worker_id: str = "inline",
) -> str | None:
    """Create a running run row; returns run_id."""
    sch = get_schedule(tenant_id, schedule_id)
    if not sch:
        return None
    rid = _new_id("run")
    now = _utc_now()
    with _tx() as conn:
        conn.execute(
            """
            INSERT INTO runs(
              id, schedule_id, tenant_id, status, worker_id, started_at, created_at, morning_ready
            ) VALUES (?,?,?,?,?,?,?,0)
            """,
            (rid, schedule_id, tenant_id, "running", worker_id, now, now),
        )
        conn.execute(
            "UPDATE schedules SET last_run_at=?, updated_at=? WHERE id=? AND tenant_id=?",
            (now, now, schedule_id, tenant_id),
        )
    return rid


def list_runs(tenant_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    tid = ensure_tenant(tenant_id)
    conn = _connect()
    rows = conn.execute(
        """
        SELECT id, schedule_id, tenant_id, status, worker_id, started_at, finished_at,
               error, job_count, live_count, elapsed_ms, morning_ready, created_at
        FROM runs WHERE tenant_id=?
        ORDER BY created_at DESC LIMIT ?
        """,
        (tid, max(1, min(limit, 100))),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["morning_ready"] = bool(d.get("morning_ready"))
        out.append(d)
    return out


def get_run(tenant_id: str, run_id: str, *, include_digest: bool = True) -> dict[str, Any] | None:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM runs WHERE id=? AND tenant_id=?",
        (run_id, tenant_id),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["morning_ready"] = bool(d.get("morning_ready"))
    if include_digest and d.get("digest_json"):
        try:
            d["digest"] = json.loads(d["digest_json"])
        except Exception:
            d["digest"] = None
    d.pop("digest_json", None)
    return d


def morning_digest(tenant_id: str) -> dict[str, Any]:
    """
    Latest succeeded morning-ready run(s) for tenant — what you see when you wake.
    """
    tid = ensure_tenant(tenant_id)
    conn = _connect()
    rows = conn.execute(
        """
        SELECT * FROM runs
        WHERE tenant_id=? AND status='succeeded' AND morning_ready=1
        ORDER BY finished_at DESC LIMIT 5
        """,
        (tid,),
    ).fetchall()
    digests = []
    for r in rows:
        d = dict(r)
        try:
            body = json.loads(d.get("digest_json") or "{}")
        except Exception:
            body = {}
        digests.append(
            {
                "run_id": d["id"],
                "schedule_id": d["schedule_id"],
                "finished_at": d["finished_at"],
                "job_count": d["job_count"],
                "live_count": d["live_count"],
                "elapsed_ms": d["elapsed_ms"],
                "digest": body,
            }
        )
    return {
        "tenant_id": tid,
        "ready": len(digests) > 0,
        "count": len(digests),
        "runs": digests,
        "as_of": _utc_now(),
    }


def stats(tenant_id: str | None = None) -> dict[str, Any]:
    conn = _connect()
    if tenant_id:
        schedules = conn.execute(
            "SELECT COUNT(*) c FROM schedules WHERE tenant_id=?", (tenant_id,)
        ).fetchone()["c"]
        runs = conn.execute(
            "SELECT COUNT(*) c FROM runs WHERE tenant_id=?", (tenant_id,)
        ).fetchone()["c"]
        ready = conn.execute(
            "SELECT COUNT(*) c FROM runs WHERE tenant_id=? AND morning_ready=1",
            (tenant_id,),
        ).fetchone()["c"]
    else:
        schedules = conn.execute("SELECT COUNT(*) c FROM schedules").fetchone()["c"]
        runs = conn.execute("SELECT COUNT(*) c FROM runs").fetchone()["c"]
        ready = conn.execute(
            "SELECT COUNT(*) c FROM runs WHERE morning_ready=1"
        ).fetchone()["c"]
    workers = conn.execute("SELECT COUNT(*) c FROM worker_heartbeats").fetchone()["c"]
    return {
        "schedules": schedules,
        "runs": runs,
        "morning_ready_runs": ready,
        "workers_seen": workers,
        "db_path": str(_db_path()),
    }
