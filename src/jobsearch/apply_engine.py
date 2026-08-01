"""
AI Apply Studio — human-in-the-loop apply preparation.

Honest product contract (Karpathy):
  - We AUTO-PREPARE materials, rank an apply queue, open the real apply URL.
  - We NEVER silently POST credentials or auto-submit third-party ATS forms.
  - User must click Apply / confirm "I applied".
  - Synthetic/practice jobs are blocked from real-apply path.

Math used: MMR, secretary threshold, EV, softmax, Thompson, Bayes readiness, ATS coverage.
"""

from __future__ import annotations

import hashlib
import re
import time
from typing import Any

from jobsearch.job_model import is_synthetic_job
from jobsearch.apply_math import (
    apply_priority_score,
    ats_keyword_coverage,
    bayesian_readiness,
    estimate_response_prob,
    expected_value,
    extract_jd_keywords,
    greedy_knapsack,
    mmr_select,
    secretary_threshold,
    softmax,
    star_bullet_from_skills,
    thompson_source_weights,
)
from jobsearch.catalog import sanitize_url
from jobsearch.enterprise import metrics as ent_metrics
from jobsearch.enterprise import new_request_id

PRODUCT_APPLY_VERSION = "2.1.0"

# Checklist for readiness (Bayesian)
CHECKLIST = [
    ("resume", "Resume attached / text available"),
    ("title_match", "Target title aligns with job title"),
    ("keywords", "ATS keyword coverage ≥ 35%"),
    ("direct_url", "Direct apply URL present"),
    ("not_synthetic", "Live (non-practice) listing"),
    ("materials", "Cover note + STAR bullets prepared"),
]


# Back-compat alias for any external callers
_is_synthetic = is_synthetic_job


def _direct_url(job: dict[str, Any]) -> str:
    u = sanitize_url(str(job.get("apply_url") or job.get("url") or ""))
    if not u or "example.com" in u.lower():
        u = sanitize_url(str(job.get("indeed_url") or job.get("linkedin_url") or ""))
    return u


def _title_overlap(profile_title: str, job_title: str) -> int:
    pt = {t for t in re.findall(r"[a-z0-9]+", (profile_title or "").lower()) if len(t) > 2}
    jt = {t for t in re.findall(r"[a-z0-9]+", (job_title or "").lower()) if len(t) > 2}
    return len(pt & jt)


def _star_bullets_for_injects(
    profile: dict[str, Any],
    job: dict[str, Any],
    packet: dict[str, Any],
    keyword_inject: list[str],
) -> list[str]:
    """Profile skills first, then injects (dedupe) for STAR templates."""
    skill_tokens: list[str] = []
    seen: set[str] = set()
    for token in list(profile.get("skills") or []) + keyword_inject:
        t = str(token or "").strip()
        if not t:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        skill_tokens.append(t)
    return star_bullet_from_skills(
        skill_tokens,
        str(job.get("title") or packet.get("title") or ""),
        str(job.get("company") or packet.get("company") or ""),
    )


def resolve_cover_and_injects(
    profile: dict[str, Any],
    job: dict[str, Any],
    packet: dict[str, Any],
    forge_blob: dict[str, Any] | None = None,
) -> tuple[str, list[str], list[str]]:
    """
    Shared by auto_apply + nexus: prefer Tailor RT forge injects over bare ATS
    missing keywords. Prefer prebuilt cover_note + star_bullets from
    tailor_materials (forge_blob) when present so we do not double-call
    build_cover_note. On rebuild, prefer forge ats_after over packet.ats so
    gap/hit lines match tailor_materials (form_pack parity).

    Returns (cover_note, keyword_inject, star_bullets).
    """
    blob = forge_blob or {}
    forge_injects = [
        str(i).strip() for i in (blob.get("injects") or []) if str(i).strip()
    ]
    packet_injects = [
        str(i).strip()
        for i in (packet.get("keyword_inject") or [])
        if str(i).strip()
    ]
    # Prefer Tailor RT / forge injects; else packet ATS injects
    keyword_inject = forge_injects or packet_injects
    cover = str(packet.get("cover_note") or "")
    bullets: list[str] = list(packet.get("star_bullets") or [])

    # tailor_materials already built inject-aligned cover + stars — reuse them.
    # When forge_blob.ok with a prebuilt cover, never rebuild (LOOP_STATUS P1).
    pre_cover = str(blob.get("cover_note") or "").strip()
    pre_stars = [
        str(b).strip() for b in (blob.get("star_bullets") or []) if str(b).strip()
    ]
    forge_ok = blob.get("ok") is True or bool(blob.get("passed"))
    use_prebuilt = bool(pre_cover) and (
        forge_ok or bool(forge_injects) or not keyword_inject
    )
    if use_prebuilt:
        if not pre_stars:
            if keyword_inject:
                pre_stars = _star_bullets_for_injects(
                    profile, job, packet, keyword_inject
                )
            else:
                pre_stars = [str(b).strip() for b in bullets if str(b).strip()]
        return pre_cover, keyword_inject, pre_stars

    # Rebuild cover + STAR whenever we have injects so autofill materials stay
    # keyword-aligned (packet-only injects left a generic cover without rebuild).
    if keyword_inject:
        # Post-forge ATS matches tailor_materials._cover_and_stars; packet.ats
        # is pre-forge and can invent wrong gap lines after Tailor RT.
        ats_src = blob.get("ats_after")
        if not isinstance(ats_src, dict) or not ats_src:
            ats_src = packet.get("ats") if isinstance(packet.get("ats"), dict) else {}
        cover = build_cover_note(
            profile,
            job,
            ats=ats_src or {},
            injects=keyword_inject,
        )
        bullets = _star_bullets_for_injects(profile, job, packet, keyword_inject)
    return cover, keyword_inject, bullets


def build_cover_note(
    profile: dict[str, Any],
    job: dict[str, Any],
    *,
    ats: dict[str, Any],
    injects: list[str] | None = None,
) -> str:
    """
    Editable cover draft. ATS hits form the core strength line; optional Tailor RT /
    forge injects are merged in so auto-apply steps match the forged resume keywords.
    """
    name = str(profile.get("name") or "Candidate").strip() or "Candidate"
    target = str(profile.get("target_title") or "professional")
    company = str(job.get("company") or "your team")
    role = str(job.get("title") or "this role")
    hits: list[str] = []
    seen: set[str] = set()
    # Injects + profile skills first (form_pack / Tailor RT parity), then ATS hits
    for token in (
        list(injects or [])
        + list(profile.get("skills") or [])
        + list(ats.get("hits") or [])
    ):
        t = str(token or "").strip()
        if not t:
            continue
        key = t.lower()
        # Skip ultra-generic tokens that dilute the strength line
        if key in ("experience", "skills", "work", "team", "role", "job"):
            continue
        if key in seen:
            continue
        seen.add(key)
        hits.append(t)
        if len(hits) >= 6:
            break
    hit_str = ", ".join(hits[:6]) if hits else "my core stack"
    # Don't also "deepen" keywords we just claimed via injects
    gaps = [
        str(g).strip()
        for g in (ats.get("missing") or [])
        if str(g).strip() and str(g).strip().lower() not in seen
    ]
    gap_line = ""
    if gaps[:2]:
        gap_line = (
            f" I'm actively deepening {', '.join(gaps[:2])} and can speak to adjacent delivery."
        )
    return (
        f"Dear {company} hiring team,\n\n"
        f"I'm {name}, focused on {target} roles. Your {role} posting stands out because "
        f"it maps to my strengths in {hit_str}.{gap_line}\n\n"
        f"In recent work I've shipped outcomes that transfer to this mandate — happy to "
        f"walk through a 90-day plan on a short call.\n\n"
        f"Thank you for your consideration,\n{name}\n"
        f"\n— Generated as an editable draft (never auto-sent)."
    )


def build_apply_packet(
    profile: dict[str, Any],
    job: dict[str, Any],
    *,
    has_resume: bool = False,
) -> dict[str, Any]:
    """Full materials + scores for one job."""
    t0 = time.perf_counter()
    synth = _is_synthetic(job)
    url = _direct_url(job)
    resume = str(profile.get("resume_text") or profile.get("summary") or "")
    skills = list(profile.get("skills") or [])
    jd = " ".join(
        [
            str(job.get("title") or ""),
            str(job.get("company") or ""),
            " ".join(job.get("skills") or []),
            str(job.get("text") or "")[:2000],
        ]
    )
    ats = ats_keyword_coverage(resume + " " + " ".join(skills), jd, skills)
    title_hits = _title_overlap(str(profile.get("target_title") or ""), str(job.get("title") or ""))
    ensemble = float((job.get("scores") or {}).get("ensemble") or 0)

    checks = {
        "resume": bool(has_resume or resume.strip()),
        "title_match": title_hits >= 1 or ensemble >= 55,
        "keywords": float(ats["coverage"]) >= 0.35,
        "direct_url": bool(url),
        "not_synthetic": not synth,
        "materials": True,  # built below
    }
    done = sum(1 for v in checks.values() if v)
    readiness = bayesian_readiness(done, len(checks))
    p_resp = estimate_response_prob(
        ensemble=ensemble,
        ats_coverage=float(ats["coverage"]),
        readiness=readiness,
        is_synthetic=synth,
        has_direct_url=bool(url),
        title_hits=title_hits,
    )
    # Cost: synthetic infinite (blocked); missing URL higher cost
    cost = 99 if synth else (1 if url else 2)
    ev = expected_value(p_resp, value=1.0, cost=0.12 if url else 0.22)
    if synth:
        ev = -1.0
        p_resp = 0.0

    cover = build_cover_note(profile, job, ats=ats)
    bullets = star_bullet_from_skills(
        skills or (ats.get("hits") or []),
        str(job.get("title") or ""),
        str(job.get("company") or ""),
    )
    # Keyword inject suggestions (honest: user pastes into resume)
    inject = [m for m in (ats.get("missing") or []) if m][:8]
    keywords = extract_jd_keywords(jd, 16)

    priority = apply_priority_score(
        job,
        p_response=p_resp,
        ev=ev,
        ats_coverage=float(ats["coverage"]),
    )

    # Verdict for UX
    if synth:
        action = "blocked_practice"
        label = "Practice only — not a real apply"
    elif not url:
        action = "needs_url"
        label = "Find listing first"
    elif readiness >= 0.62 and ensemble >= 45:
        action = "apply_now"
        label = "Ready to apply"
    elif readiness >= 0.45:
        action = "prepare"
        label = "Prepare then apply"
    else:
        action = "strengthen"
        label = "Strengthen materials first"

    packet = {
        "job_id": job.get("id"),
        "title": job.get("title"),
        "company": job.get("company"),
        "source": job.get("source"),
        "is_synthetic": synth,
        "apply_url": url,
        "ensemble_fit": round(ensemble, 2),
        "apply_priority": priority,
        "p_response_proxy": p_resp,
        "expected_value": ev,
        "cost_slots": 1 if not synth else 99,
        "readiness": round(readiness, 4),
        "checklist": [
            {"id": cid, "label": lab, "done": bool(checks[cid])}
            for cid, lab in CHECKLIST
        ],
        "ats": ats,
        "jd_keywords": keywords,
        "keyword_inject": inject,
        "cover_note": cover,
        "star_bullets": bullets,
        "subject_line": f"Application: {job.get('title') or 'Role'} — {profile.get('name') or 'Candidate'}",
        "action": action,
        "action_label": label,
        "honesty": (
            "Materials are drafts. You open the apply URL and submit. "
            "p_response is a transparent logistic proxy — not interview probability."
        ),
        "math": {
            "ats_coverage": ats["coverage"],
            "bayesian_readiness": round(readiness, 4),
            "ev_formula": "EV = P̂·V − C",
            "mmr": "used at queue level",
            "secretary": "threshold at queue level",
        },
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }
    return packet


def build_apply_queue(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    budget: int = 8,
    has_resume: bool = False,
    lambda_mmr: float = 0.72,
    source_stats: dict[str, dict[str, int]] | None = None,
    kappa_secretary: float = 0.15,
) -> dict[str, Any]:
    """
    Build optimal daily apply queue:
      1. Score each live job → packet features
      2. Secretary threshold filter (soft)
      3. MMR diversity selection
      4. Greedy knapsack to budget
      5. Softmax order for presentation
    """
    t0 = time.perf_counter()
    rid = new_request_id()
    budget = max(1, min(int(budget or 8), 25))
    live = [j for j in jobs if not _is_synthetic(j)]
    practice_n = len(jobs) - len(live)

    src_w = thompson_source_weights(source_stats or {})
    packets: list[dict[str, Any]] = []
    for j in live[:80]:
        pkt = build_apply_packet(profile, j, has_resume=has_resume)
        src = str(j.get("source") or "unknown")
        boost = float(src_w.get(src, 0.5)) - 0.5  # center at 0
        pkt["apply_priority"] = apply_priority_score(
            j,
            p_response=float(pkt["p_response_proxy"]),
            ev=float(pkt["expected_value"]),
            ats_coverage=float((pkt.get("ats") or {}).get("coverage") or 0),
            source_boost=boost,
        )
        pkt["source_thompson"] = round(src_w.get(src, 0.5), 4)
        pkt["cost"] = int(pkt.get("cost_slots") or 1)
        pkt["ev"] = float(pkt["expected_value"])
        # stash job ref fields
        pkt["_job"] = {
            "id": j.get("id"),
            "title": j.get("title"),
            "company": j.get("company"),
            "source": j.get("source"),
            "scores": j.get("scores"),
            "skills": j.get("skills"),
            "apply_url": pkt.get("apply_url"),
            "is_synthetic": False,
        }
        packets.append(pkt)

    scores = [float(p["ensemble_fit"]) for p in packets]
    thr = secretary_threshold(scores, kappa=kappa_secretary) if scores else 50.0

    # Soft filter: prefer above threshold but keep top if market thin
    above = [p for p in packets if float(p["ensemble_fit"]) >= thr]
    pool = above if len(above) >= max(3, budget // 2) else packets
    pool.sort(key=lambda p: float(p["apply_priority"]), reverse=True)

    # MMR on job shells
    shells = []
    for p in pool:
        shell = dict(p["_job"])
        shell["apply_score"] = p["apply_priority"]
        shell["scores"] = {"ensemble": p["ensemble_fit"]}
        shells.append(shell)
    mmr_jobs = mmr_select(shells, relevance_key="apply_score", lambda_rel=lambda_mmr, k=min(budget * 2, 20))
    mmr_ids = {str(j.get("id")) for j in mmr_jobs}
    mmr_packets = [p for p in pool if str(p.get("job_id")) in mmr_ids]
    # preserve mmr order
    order = {str(j.get("id")): i for i, j in enumerate(mmr_jobs)}
    mmr_packets.sort(key=lambda p: order.get(str(p.get("job_id")), 999))

    knap = greedy_knapsack(mmr_packets, budget=budget, value_key="ev", cost_key="cost")
    if len(knap) < min(budget, len(pool)):
        # fill remaining by priority
        have = {str(p.get("job_id")) for p in knap}
        for p in pool:
            if str(p.get("job_id")) in have:
                continue
            knap.append(p)
            if len(knap) >= budget:
                break

    # Softmax presentation weights
    prios = [float(p["apply_priority"]) for p in knap]
    props = softmax(prios, temperature=12.0)
    queue: list[dict[str, Any]] = []
    for i, (p, pr) in enumerate(zip(knap[:budget], props)):
        row = {k: v for k, v in p.items() if k != "_job"}
        row["queue_rank"] = i + 1
        row["plackett_luce_mass"] = round(pr, 4)
        row["above_secretary_threshold"] = float(p["ensemble_fit"]) >= thr
        queue.append(row)

    ready_n = sum(1 for q in queue if q.get("action") == "apply_now")
    ent_metrics().incr("apply.queue_built")
    ent_metrics().observe_ms("apply.queue", (time.perf_counter() - t0) * 1000)

    return {
        "ok": True,
        "request_id": rid,
        "version": PRODUCT_APPLY_VERSION,
        "mode": "human_in_the_loop",
        "honesty": (
            "AI Apply Studio prepares a ranked queue and editable materials. "
            "It does not auto-submit applications to employer ATS. "
            "You review, open Apply, and confirm."
        ),
        "budget": budget,
        "secretary_threshold": round(thr, 2),
        "mmr_lambda": lambda_mmr,
        "stats": {
            "input_jobs": len(jobs),
            "live_jobs": len(live),
            "practice_excluded": practice_n,
            "queued": len(queue),
            "ready_to_apply": ready_n,
            "mean_priority": round(sum(prios) / len(prios), 2) if prios else 0,
        },
        "math_stack": [
            "MMR (Carbonell & Goldstein 1998)",
            "Secretary threshold τ=μ+κσ",
            "EV = P̂·V − C",
            "Softmax / Plackett–Luce ordering",
            "Thompson sampling (sources)",
            "Bayesian checklist readiness",
            "ATS keyword coverage (set recall)",
            "Greedy knapsack budget",
        ],
        "queue": queue,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def batch_prepare(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    job_ids: list[str] | None = None,
    has_resume: bool = False,
    budget: int = 8,
) -> dict[str, Any]:
    """Prepare packets for explicit ids or full optimized queue."""
    t0 = time.perf_counter()
    if job_ids:
        idset = {str(x) for x in job_ids}
        selected = [j for j in jobs if str(j.get("id")) in idset]
        packets = [
            build_apply_packet(profile, j, has_resume=has_resume)
            for j in selected
            if not _is_synthetic(j)
        ]
        blocked = [
            {"job_id": j.get("id"), "reason": "practice_synthetic"}
            for j in selected
            if _is_synthetic(j)
        ]
        return {
            "ok": True,
            "request_id": new_request_id(),
            "version": PRODUCT_APPLY_VERSION,
            "mode": "batch_prepare",
            "packets": packets,
            "blocked": blocked,
            "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
        }
    q = build_apply_queue(
        profile, jobs, budget=budget, has_resume=has_resume
    )
    return q


def fingerprint_packet(packet: dict[str, Any]) -> str:
    raw = f"{packet.get('job_id')}|{packet.get('apply_priority')}|{packet.get('cover_note','')[:80]}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]
