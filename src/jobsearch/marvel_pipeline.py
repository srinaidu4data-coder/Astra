"""
Marvel Apply — enterprise orchestration of SOTA match + resume forge + HITL apply.

End-to-end:
  ranked jobs → multi-engine marvel re-score → Ising/Pareto/UCB queue
  → Resume Forge per pick → Apply packets → human opens URL

Never auto-submits to employer ATS.
"""

from __future__ import annotations

import time
from typing import Any

from jobsearch.apply_engine import build_apply_packet, build_apply_queue
from jobsearch.enterprise import metrics as ent_metrics
from jobsearch.enterprise import new_request_id
from jobsearch.job_model import is_synthetic_job
from jobsearch.resume_forge import forge_resume_for_job, forge_variants
from jobsearch.sota_engines import (
    KalmanResponseTracker,
    PIDApplyThrottle,
    multi_engine_score_jobs,
)

MARVEL_VERSION = "3.0.0"
MARVEL_CODENAME = "Prometheus"


def run_marvel_apply(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    budget: int = 8,
    has_resume: bool = False,
    forge_top: int = 5,
    inject_budget: int = 8,
    outcomes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Full Marvel pipeline.

    outcomes: optional [{success: 0|1}] for Kalman response tracking.
    """
    t0 = time.perf_counter()
    rid = new_request_id()
    budget = max(1, min(int(budget or 8), 25))
    forge_top = max(1, min(int(forge_top or 5), 12))

    live = [j for j in jobs if not is_synthetic_job(j)]

    # 1) Multi-engine SOTA scoring
    scored = multi_engine_score_jobs(profile, live, seed=hash(str(profile.get("target_title"))) % 997)
    ent_metrics().incr("marvel.scored")

    # 2) Kalman market response prior
    kalman = KalmanResponseTracker()
    for o in outcomes or []:
        kalman.update(float(o.get("success") or 0))
    market_p = kalman.x

    # 3) PID throttle suggestion
    pid = PIDApplyThrottle(target=float(budget))
    applied_today = sum(1 for j in jobs if j.get("tracker_status") == "applied")
    suggested_budget = int(round(pid.step(float(applied_today))))

    # 4) Build apply queue on marvel-ranked jobs (reuse apply engine math)
    # inject marvel_score into ensemble for queue priority bias
    for j in scored:
        sc = dict(j.get("scores") or {})
        # blend 60% marvel + 40% prior ensemble
        prior = float(sc.get("ensemble") or 0)
        marvel = float(j.get("marvel_score") or prior)
        sc["ensemble"] = round(0.4 * prior + 0.6 * marvel, 2)
        sc["marvel"] = marvel
        j["scores"] = sc

    queue_bundle = build_apply_queue(
        profile,
        scored,
        budget=min(budget, suggested_budget + 2),
        has_resume=has_resume or bool(profile.get("resume_text")),
    )

    # 5) Resume forge for top queue items
    queue = list(queue_bundle.get("queue") or [])
    forge_jobs = []
    id_to_job = {str(j.get("id")): j for j in scored}
    for q in queue[:forge_top]:
        jid = str(q.get("job_id"))
        if jid in id_to_job:
            forge_jobs.append(id_to_job[jid])
    forged = forge_variants(
        profile,
        forge_jobs or scored[:forge_top],
        limit=forge_top,
        inject_budget=inject_budget,
    )

    # attach forge summary onto queue rows
    forge_by_job = {str(v.get("job_id")): v for v in forged.get("variants") or []}
    enriched_queue = []
    for q in queue:
        row = dict(q)
        fv = forge_by_job.get(str(q.get("job_id")))
        if fv:
            row["resume_forge"] = {
                "scalar_score": fv.get("scalar_score"),
                "ats_after": (fv.get("ats_after") or {}).get("coverage"),
                "ats_lift": (fv.get("objectives") or {}).get("ats_lift"),
                "injects": fv.get("injects"),
                "forged_resume": fv.get("forged_resume"),
                "bullets": fv.get("bullets"),
                "objectives": fv.get("objectives"),
            }
            # boost readiness label if ATS improved
            if float((fv.get("ats_after") or {}).get("coverage") or 0) >= 0.4:
                if row.get("action") == "strengthen":
                    row["action"] = "prepare"
                    row["action_label"] = "Resume forged — review & apply"
        enriched_queue.append(row)

    # 6) Top-1 full packet for UX
    hero_packet = None
    hero_forge = None
    if scored:
        hero_packet = build_apply_packet(
            profile,
            scored[0],
            has_resume=has_resume or bool(profile.get("resume_text")),
        )
        hero_forge = forge_by_job.get(str(scored[0].get("id"))) or (
            forge_resume_for_job(profile, scored[0], inject_budget=inject_budget)
            if scored
            else None
        )

    elapsed = round((time.perf_counter() - t0) * 1000, 2)
    ent_metrics().observe_ms("marvel.pipeline", elapsed)
    ent_metrics().incr("marvel.ok")

    return {
        "ok": True,
        "request_id": rid,
        "version": MARVEL_VERSION,
        "codename": MARVEL_CODENAME,
        "mode": "human_in_the_loop",
        "auto_submit": False,
        "honesty": (
            f"Marvel Apply ({MARVEL_CODENAME}) fuses gravitational ranking, Ising selection, "
            "optimal transport, Jensen–Shannon, Hedge expert fusion, UCB1, Pareto fronts, "
            "PageRank skills, Sinkhorn skill alignment, simulated-annealing resume order, "
            "Kalman response tracking, and PID apply throttling — then prepares materials. "
            "You always open the employer URL and submit. Never silent auto-apply."
        ),
        "engines": [
            "Gravitational potential ranking",
            "Ising energy apply selection",
            "Jensen–Shannon + KL language distance",
            "Sinkhorn-lite optimal transport",
            "Multiplicative Weights (Hedge) fusion",
            "UCB1 explore/exploit",
            "NSGA-style Pareto front",
            "Hungarian resume↔job assignment",
            "Simulated annealing resume order",
            "PageRank skill graph",
            "Soft attention pooling",
            "Zipf title scarcity",
            "Kalman response tracker",
            "PID apply throttle",
            "Spectral job clustering",
            "Information gain proxy",
            "Langevin exploration noise",
            "MMR + secretary + EV (Apply Studio)",
            "Resume Forge multi-objective ATS",
        ],
        "control": {
            "kalman_response_prior": round(market_p, 4),
            "pid_suggested_budget": suggested_budget,
            "requested_budget": budget,
            "applied_today_signal": applied_today,
        },
        "stats": {
            "input_jobs": len(jobs),
            "live_jobs": len(live),
            "marvel_ranked": len(scored),
            "queued": len(enriched_queue),
            "forged": len(forged.get("variants") or []),
            "pareto_count": sum(
                1 for j in scored if (j.get("marvel") or {}).get("on_pareto_front")
            ),
            "ising_selected": sum(
                1 for j in scored if (j.get("marvel") or {}).get("ising_selected")
            ),
        },
        "ranked_jobs": scored[: max(budget * 3, 30)],
        "queue": enriched_queue,
        "queue_meta": {
            "secretary_threshold": queue_bundle.get("secretary_threshold"),
            "math_stack": queue_bundle.get("math_stack"),
        },
        "resume_forge": forged,
        "hero": {
            "packet": hero_packet,
            "forge": hero_forge,
        },
        "elapsed_ms": elapsed,
    }
