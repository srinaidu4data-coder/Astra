"""
AI Auto Apply — campaign planner + step logger.

What "auto apply" means in this product (honest contract):
  1. Build optimal queue (live jobs only)
  2. Auto-prepare cover + STAR + forged resume for each
  3. Client opens each employer apply URL in order
  4. Auto-mark tracker status = applied
  5. NEVER POST credentials / never silent-submit third-party ATS forms

Employer sites require the candidate's browser session. We automate everything
up to and including opening the apply link and logging the outcome.
"""

from __future__ import annotations

import time
from typing import Any

from jobsearch.apply_engine import (
    build_apply_packet,
    build_apply_queue,
    resolve_cover_and_injects,
)
from jobsearch.enterprise import metrics as ent_metrics
from jobsearch.enterprise import new_request_id
from jobsearch.job_model import is_synthetic_job
from jobsearch.tailor_rt import tailor_materials

AUTO_APPLY_VERSION = "1.3.0"


def _is_blocked(job_or_packet: dict[str, Any]) -> tuple[bool, str]:
    if is_synthetic_job(job_or_packet):
        return True, "practice_listing"
    url = str(job_or_packet.get("apply_url") or job_or_packet.get("url") or "").strip()
    if not url or "example.com" in url.lower():
        return True, "missing_apply_url"
    if not url.startswith("http"):
        return True, "invalid_url"
    return False, ""


def build_auto_apply_campaign(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    budget: int = 10,
    has_resume: bool = False,
    delay_ms: int = 2500,
    include_prepare: bool = True,
    forge: bool = True,
) -> dict[str, Any]:
    """
    Build a full auto-apply campaign: ordered steps ready for client runner.
    """
    t0 = time.perf_counter()
    rid = new_request_id()
    budget = max(1, min(int(budget or 10), 25))
    delay_ms = max(800, min(int(delay_ms or 2500), 15000))

    live = [j for j in jobs if not is_synthetic_job(j)]

    queue_bundle = build_apply_queue(
        profile,
        live,
        budget=budget,
        has_resume=has_resume or bool(profile.get("resume_text")),
    )
    queue = list(queue_bundle.get("queue") or [])
    id_to_job = {str(j.get("id")): j for j in live}

    steps: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for i, q in enumerate(queue):
        jid = str(q.get("job_id") or "")
        job = id_to_job.get(jid) or {
            "id": jid,
            "title": q.get("title"),
            "company": q.get("company"),
            "source": q.get("source"),
            "apply_url": q.get("apply_url"),
            "scores": {"ensemble": q.get("ensemble_fit")},
            "skills": [],
            "text": "",
            "is_synthetic": q.get("is_synthetic"),
        }
        blocked, reason = _is_blocked({**job, **q})
        if blocked:
            skipped.append({"job_id": jid, "title": q.get("title"), "reason": reason})
            continue

        action = str(q.get("action") or "")
        if action == "strengthen" and not include_prepare:
            skipped.append({"job_id": jid, "title": q.get("title"), "reason": "needs_strengthen"})
            continue

        packet = build_apply_packet(
            profile,
            job,
            has_resume=has_resume or bool(profile.get("resume_text")),
        )
        # Re-check URL from packet
        blocked2, reason2 = _is_blocked(packet)
        if blocked2:
            skipped.append({"job_id": jid, "title": q.get("title"), "reason": reason2})
            continue

        forge_blob: dict | None = None
        if forge:
            forge_blob = tailor_materials(
                profile, job, max_rounds=2, inject_budget=8, use_rt=True
            )

        cover, keyword_inject, star_bullets = resolve_cover_and_injects(
            profile, job, packet, forge_blob
        )

        steps.append(
            {
                "step": len(steps) + 1,
                "job_id": jid,
                "title": packet.get("title") or q.get("title"),
                "company": packet.get("company") or q.get("company"),
                "source": packet.get("source") or q.get("source"),
                "apply_url": packet.get("apply_url"),
                "ensemble_fit": packet.get("ensemble_fit"),
                "apply_priority": q.get("apply_priority") or packet.get("apply_priority"),
                "action": "auto_apply",
                "action_label": "Auto-apply ready",
                "cover_note": cover,
                "star_bullets": star_bullets,
                "subject_line": packet.get("subject_line"),
                "keyword_inject": keyword_inject,
                "forged_resume": (forge_blob or {}).get("forged_resume") or "",
                "forge_score": (forge_blob or {}).get("scalar_score"),
                "ats_coverage": ((forge_blob or {}).get("ats_after") or {}).get("coverage")
                or (packet.get("ats") or {}).get("coverage"),
                "tailor_rt_passed": (forge_blob or {}).get("passed"),
                "tailor_rt_grade": (forge_blob or {}).get("grade"),
                "tailor_rt_suggestions": (forge_blob or {}).get("suggestions") or [],
                "checklist": packet.get("checklist"),
                "delay_ms_after": delay_ms,
                "status": "pending",  # pending | opened | applied | skipped | failed
            }
        )
        if len(steps) >= budget:
            break

    ent_metrics().incr("auto_apply.campaigns")
    ent_metrics().observe_ms("auto_apply.plan", (time.perf_counter() - t0) * 1000)

    return {
        "ok": True,
        "request_id": rid,
        "version": AUTO_APPLY_VERSION,
        "mode": "auto_apply_campaign",
        "auto_submit_ats": False,
        "honesty": (
            "Auto Apply opens each employer apply URL in order, prepares tailored "
            "materials, and marks Applied in your tracker. It does not log into "
            "employer ATS or submit forms without your browser. You complete any "
            "final form fields the employer requires."
        ),
        "budget": budget,
        "delay_ms": delay_ms,
        "stats": {
            "input_live": len(live),
            "steps": len(steps),
            "skipped": len(skipped),
            "forged": sum(1 for s in steps if s.get("forged_resume")),
        },
        "steps": steps,
        "skipped": skipped,
        "queue_meta": {
            "secretary_threshold": queue_bundle.get("secretary_threshold"),
            "math_stack": queue_bundle.get("math_stack"),
        },
        "instructions": [
            "Click Start Auto Apply once (browser allows pop-ups after that gesture).",
            "For each job: materials copy → apply URL opens → marked Applied.",
            "Finish any employer form fields if the site requires them.",
            "Use Stop to halt the campaign mid-run.",
        ],
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def log_auto_apply_step(
    *,
    campaign_id: str,
    job_id: str,
    status: str,
    note: str = "",
) -> dict[str, Any]:
    status = (status or "applied").lower().strip()
    if status not in ("opened", "applied", "skipped", "failed", "pending"):
        status = "applied"
    ent_metrics().incr(f"auto_apply.step.{status}")
    return {
        "ok": True,
        "campaign_id": campaign_id,
        "job_id": job_id,
        "status": status,
        "note": (note or "")[:300],
        "request_id": new_request_id(),
    }
