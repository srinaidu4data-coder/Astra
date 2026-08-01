"""Night Scout store + worker unit tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

# Use temp DB before importing store behavior that connects
_tmp = tempfile.mkdtemp(prefix="night_scout_test_")
os.environ["JOBSEARCH_NIGHT_DB"] = str(Path(_tmp) / "test.db")

# Force re-init if already imported
import jobsearch.night_store as store

# reset module conn
store._conn = None  # type: ignore

from jobsearch.night_store import (
    claim_due_schedules,
    complete_run,
    ensure_tenant,
    list_schedules,
    morning_digest,
    upsert_schedule,
    get_run,
    create_running_run,
)
from jobsearch.night_worker import execute_schedule


def test_tenant_and_schedule():
    tid = ensure_tenant("test-user-1", "Test")
    sch = upsert_schedule(
        tid,
        {
            "name": "Night",
            "target_title": "Software Engineer",
            "skills": ["python", "react"],
            "location": "us",
            "run_hour_local": 2,
            "enabled": True,
            "next_run_at": "2000-01-01T00:00:00Z",  # due
        },
    )
    assert sch["id"]
    assert sch["target_title"] == "Software Engineer"
    assert len(list_schedules(tid)) >= 1


def test_claim_and_complete():
    tid = ensure_tenant("test-user-2")
    sch = upsert_schedule(
        tid,
        {
            "target_title": "Data Engineer",
            "skills": ["sql"],
            "enabled": True,
            "next_run_at": "2000-01-01T00:00:00Z",
            "include_seed": True,  # offline-friendly
        },
    )
    claimed = claim_due_schedules("worker-test", limit=5)
    mine = [c for c in claimed if c["id"] == sch["id"]]
    assert mine, "schedule should be claimed"
    rid = mine[0]["_run_id"]
    complete_run(
        rid,
        status="succeeded",
        digest={"headline": "test", "jobs": [{"title": "X"}]},
        job_count=1,
        live_count=1,
        elapsed_ms=10,
    )
    run = get_run(tid, rid)
    assert run and run["status"] == "succeeded"
    assert run["morning_ready"]
    md = morning_digest(tid)
    assert md["ready"]
    assert md["count"] >= 1


def test_inline_seed_run():
    """Offline: include_seed so night run works without network."""
    tid = ensure_tenant("test-user-3")
    sch = upsert_schedule(
        tid,
        {
            "target_title": "Software Engineer",
            "skills": ["python"],
            "enabled": True,
            "include_seed": True,
            "exclude_linkedin": True,
            "location": "us",
            "limit_jobs": 40,
            "build_apply_plan": False,
        },
    )
    rid = create_running_run(tid, sch["id"], worker_id="test")
    assert rid
    full = store.get_schedule(tid, sch["id"])
    assert full
    # monkey: execute with seed
    from jobsearch.agents import run_research_team

    # Use execute path with seed via schedule flag — agents use include_seed
    # execute_schedule calls use_live=True always; seed alone needs include_seed
    # For unit test without network, call run_research_team offline
    result = run_research_team(
        {
            "target_title": "Software Engineer",
            "skills": ["python"],
            "summary": "test",
        },
        use_live=False,
        include_seed=True,
        exclude_linkedin=True,
        limit=40,
    )
    assert result.get("ok")
    complete_run(
        rid,
        status="succeeded",
        digest={"headline": "offline", "jobs": (result.get("ranked_jobs") or [])[:5]},
        job_count=len(result.get("ranked_jobs") or []),
        live_count=0,
        elapsed_ms=1,
    )
    assert morning_digest(tid)["ready"]


def main() -> int:
    tests = [test_tenant_and_schedule, test_claim_and_complete, test_inline_seed_run]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  OK  {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
