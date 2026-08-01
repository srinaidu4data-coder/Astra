"""
Night Scout worker — runs while you sleep, digests ready by morning.

Usage:
  python -m jobsearch.night_worker
  python -m jobsearch.night_worker --once
  python -m jobsearch.night_worker --poll 20

Scale:
  - Multiple workers: claim leases in night_store (no double-run)
  - Horizontal: run N workers against shared DB (Postgres swap later)
  - Vertical: --max-claims per tick, circuit-breakers inside search already
"""

from __future__ import annotations

import argparse
import os
import socket
import time
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any

from jobsearch import night_store as store
from jobsearch.agents import run_research_team
from jobsearch.enterprise import metrics as ent_metrics


def _worker_id() -> str:
    env = os.environ.get("JOBSEARCH_WORKER_ID", "").strip()
    if env:
        return env
    return f"w-{socket.gethostname()[:24]}-{uuid.uuid4().hex[:8]}"


def execute_schedule(sch: dict[str, Any], run_id: str) -> dict[str, Any]:
    """Run one overnight search for a schedule; persist digest."""
    t0 = time.perf_counter()
    profile = {
        "name": "Night Scout",
        "target_title": sch.get("target_title") or "Software Engineer",
        "skills": list(sch.get("skills") or []),
        "summary": "",
        "resume_text": (sch.get("resume_text") or "")[:8000] or None,
        "has_resume": bool(sch.get("resume_text")),
    }
    try:
        result = run_research_team(
            profile,
            use_live=True,
            remote=str(sch.get("remote") or "all"),
            location=str(sch.get("location") or "us"),
            exclude_linkedin=bool(sch.get("exclude_linkedin")),
            include_seed=bool(sch.get("include_seed")),
            limit=int(sch.get("limit_jobs") or 100),
            has_resume=bool(sch.get("resume_text")),
            bypass_cache=False,
        )
        ranked = list(result.get("ranked_jobs") or [])
        live = [j for j in ranked if not j.get("is_synthetic")]
        # Trim digest payload for storage
        slim = []
        for j in live[:80]:
            slim.append(
                {
                    "id": j.get("id"),
                    "title": j.get("title"),
                    "company": j.get("company"),
                    "location": j.get("location"),
                    "source": j.get("source"),
                    "apply_url": j.get("apply_url") or j.get("url"),
                    "linkedin_url": j.get("linkedin_url"),
                    "scores": j.get("scores"),
                    "skills": (j.get("skills") or [])[:12],
                    "is_linkedin": j.get("is_linkedin"),
                    "text": str(j.get("text") or "")[:400],
                }
            )

        apply_plan = None
        if sch.get("build_apply_plan") and slim:
            try:
                from jobsearch.auto_apply import build_auto_apply_campaign

                apply_plan = build_auto_apply_campaign(
                    profile,
                    live[:40],
                    budget=min(15, len(live)),
                    has_resume=bool(profile.get("resume_text")),
                    forge=True,
                    include_prepare=True,
                )
                # shrink plan for storage
                apply_plan = {
                    "stats": apply_plan.get("stats"),
                    "steps": [
                        {
                            "step": s.get("step"),
                            "job_id": s.get("job_id"),
                            "title": s.get("title"),
                            "company": s.get("company"),
                            "apply_url": s.get("apply_url"),
                            "ensemble_fit": s.get("ensemble_fit"),
                            "subject_line": s.get("subject_line"),
                            "cover_note": (s.get("cover_note") or "")[:800],
                            "keyword_inject": (s.get("keyword_inject") or [])[:10],
                            "forge_score": s.get("forge_score"),
                        }
                        for s in (apply_plan.get("steps") or [])[:15]
                    ],
                    "honesty": apply_plan.get("honesty"),
                }
            except Exception as e:
                apply_plan = {"error": str(e)[:160]}

        elapsed = int((time.perf_counter() - t0) * 1000)
        digest = {
            "version": "1.0.0",
            "schedule_id": sch.get("id"),
            "schedule_name": sch.get("name"),
            "target_title": profile["target_title"],
            "filters": {
                "location": sch.get("location"),
                "remote": sch.get("remote"),
                "exclude_linkedin": sch.get("exclude_linkedin"),
            },
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "headline": (
                f"Good morning — {len(live)} live roles ready for {profile['target_title']}"
            ),
            "jobs": slim,
            "top5": slim[:5],
            "apply_campaign": apply_plan,
            "warnings": result.get("warnings") or [],
            "meta": result.get("meta") or {},
            "product": result.get("product") or {},
        }
        store.complete_run(
            run_id,
            status="succeeded",
            digest=digest,
            job_count=len(slim),
            live_count=len(live),
            elapsed_ms=elapsed,
        )
        ent_metrics().incr("night.run.ok")
        ent_metrics().observe_ms("night.run", elapsed)
        return {"ok": True, "run_id": run_id, "live_count": len(live), "elapsed_ms": elapsed}
    except Exception as e:
        elapsed = int((time.perf_counter() - t0) * 1000)
        store.complete_run(
            run_id,
            status="failed",
            error=f"{e}\n{traceback.format_exc()[-400:]}",
            elapsed_ms=elapsed,
        )
        ent_metrics().incr("night.run.fail")
        return {"ok": False, "run_id": run_id, "error": str(e)[:200]}


def tick(worker_id: str, *, max_claims: int = 5) -> list[dict[str, Any]]:
    claimed = store.claim_due_schedules(worker_id, limit=max_claims)
    results = []
    for sch in claimed:
        rid = sch.get("_run_id")
        print(
            f"[{datetime.now().isoformat(timespec='seconds')}] "
            f"night run schedule={sch.get('id')} title={sch.get('target_title')}",
            flush=True,
        )
        results.append(execute_schedule(sch, rid))
    return results


def run_loop(
    *,
    poll_sec: float = 30.0,
    max_claims: int = 5,
    once: bool = False,
) -> None:
    wid = _worker_id()
    print(f"Night Scout worker {wid} starting poll={poll_sec}s", flush=True)
    print(f"DB: {store.stats().get('db_path')}", flush=True)
    while True:
        try:
            out = tick(wid, max_claims=max_claims)
            if out:
                print(f"  completed {len(out)} run(s)", flush=True)
        except Exception as e:
            print(f"  tick error: {e}", flush=True)
            ent_metrics().incr("night.tick.error")
        if once:
            break
        time.sleep(max(5.0, float(poll_sec)))


def run_schedule_inline(tenant_id: str, schedule_id: str) -> dict[str, Any]:
    """Immediate run (for 'Run tonight now' button) without waiting for poll."""
    sch = store.get_schedule(tenant_id, schedule_id)
    if not sch:
        return {"ok": False, "error": "schedule_not_found"}
    rid = store.create_running_run(tenant_id, schedule_id, worker_id="inline")
    if not rid:
        return {"ok": False, "error": "could_not_create_run"}
    return execute_schedule(sch, rid)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Night Scout overnight job search worker")
    p.add_argument("--poll", type=float, default=30.0, help="Seconds between polls")
    p.add_argument("--once", action="store_true", help="Single tick then exit")
    p.add_argument("--max-claims", type=int, default=5)
    args = p.parse_args(argv)
    run_loop(poll_sec=args.poll, max_claims=args.max_claims, once=args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
