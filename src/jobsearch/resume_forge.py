"""
Resume Forge — multi-objective tailored resume generation.

Objectives (NSGA-style trade-offs, authenticity constrained):
  maximize ATS coverage · maximize keyword alignment · maximize readability
  subject to: no fabricated employers, no fake years, keyword inject budget

Algorithms:
  - Simulated annealing for bullet order
  - Sinkhorn OT skill alignment (via sota_engines)
  - Differential keyword injection under authenticity budget
  - Multiplicative objective scalarization
  - Section reordering via SA

Output is an *editable working resume text* + diff of injections — user owns truth.
"""

from __future__ import annotations

import re
import time
from typing import Any

from jobsearch.algorithms import skill_set, tokenize
from jobsearch.apply_math import ats_keyword_coverage, extract_jd_keywords, star_bullet_from_skills
from jobsearch.job_model import is_synthetic_job
from jobsearch.sota_engines import (
    jensen_shannon,
    simulated_annealing_order,
    sinkhorn_skill_cost,
    unigram_dist,
)

FORGE_VERSION = "1.0.0"

# tokens we never invent as "experience"
_FORBIDDEN_FABRICATION = re.compile(
    r"\b(phd|nobel|ex-google|ex-meta|10\+|15\s*years at)\b", re.I
)


def _readability_proxy(text: str) -> float:
    """Simple Flesch-like proxy: prefer medium sentences, not walls of text."""
    sents = [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]
    if not sents:
        return 0.3
    words = tokenize(text)
    avg = len(words) / max(len(sents), 1)
    # ideal ~12-22 words/sentence
    if 12 <= avg <= 22:
        return 1.0
    if avg < 12:
        return 0.7 + 0.3 * (avg / 12)
    return max(0.2, 1.0 - (avg - 22) / 40)


def _authenticity_score(base: str, forged: str, injects: list[str]) -> float:
    """
    High if forged is mostly base + allowed skill keywords.
    Penalize huge expansions and fabrication patterns.
    """
    if _FORBIDDEN_FABRICATION.search(forged or ""):
        return 0.0
    base_l = len(base or "")
    forged_l = len(forged or "")
    if forged_l > base_l + 1800:
        return 0.25
    # injects must appear as whole words already plausible
    penalty = 0.0
    for inj in injects:
        if len(inj) < 2:
            continue
        if inj.lower() not in (forged or "").lower():
            penalty += 0.05
    return max(0.0, 1.0 - penalty)


def forge_resume_for_job(
    profile: dict[str, Any],
    job: dict[str, Any],
    *,
    inject_budget: int = 8,
) -> dict[str, Any]:
    """
    Build a tailored working resume + materials for one job.
    Never claims auto-submit; output is candidate-owned text.
    """
    t0 = time.perf_counter()
    # Local import keeps forge usable if autofill is mid-refactor
    from jobsearch.autofill import sanitize_resume_text

    name = str(profile.get("name") or "Candidate")
    title = str(profile.get("target_title") or "Professional")
    base = sanitize_resume_text(
        profile.get("resume_text")
    ) or str(profile.get("summary") or "").strip()
    skills = [str(s).strip() for s in (profile.get("skills") or []) if str(s).strip()]
    if not base:
        base = f"{name}\n{title}\nSkills: {', '.join(skills) or 'transferable skills'}\n"

    job_title = str(job.get("title") or "Role")
    company = str(job.get("company") or "Company")
    jd = " ".join(
        [
            job_title,
            company,
            " ".join(job.get("skills") or []),
            str(job.get("text") or "")[:2500],
        ]
    )
    jd_skills = skill_set(jd, job.get("skills") or [])
    res_skills = skill_set(base, skills)
    missing = sorted(jd_skills - res_skills)
    # only inject tokens that look like skills (alnum, short)
    candidates = [
        m
        for m in missing
        if 2 <= len(m) <= 24 and re.match(r"^[a-z][a-z0-9+.#/-]*$", m)
    ][: max(inject_budget * 2, 8)]

    # prioritize by JD keyword frequency
    jd_kw = extract_jd_keywords(jd, 30)
    rank = {k: i for i, k in enumerate(jd_kw)}
    candidates.sort(key=lambda x: rank.get(x, 999))
    injects = candidates[:inject_budget]

    # SA-optimize bullet order for keyword density
    bullets = star_bullet_from_skills(skills or list(res_skills)[:5], job_title, company)
    # add one tailored bullet referencing injects honestly as "familiar / developing"
    if injects:
        bullets.append(
            f"Continuously expanding toolkit toward {', '.join(injects[:4])} "
            f"in service of outcomes required for {job_title}-class mandates "
            f"(honest development edge — not fabricated tenure)."
        )

    def bullet_score(order: list[str]) -> float:
        text = " ".join(order).lower()
        hits = sum(1 for k in jd_kw[:12] if k in text)
        return hits + 0.1 * _readability_proxy(" ".join(order))

    ordered = simulated_annealing_order(bullets, bullet_score, seed=hash(job_title) % 10000)

    # Build forged resume sections
    header = f"{name}\nTarget: {title}  →  tailored for {job_title} @ {company}\n"
    skills_line = sorted(set(skills) | set(injects) | set(list(res_skills)[:12]))
    skills_block = "SKILLS\n" + ", ".join(skills_line[:28]) + "\n"
    summary_block = (
        "PROFESSIONAL SUMMARY\n"
        f"{title} candidate aligned to {job_title}. "
        f"Core strengths: {', '.join((skills or list(res_skills))[:6]) or 'delivery'}. "
        f"Prepared for {company} with keyword-aligned, authenticity-constrained materials.\n"
    )
    exp_block = "SELECTED IMPACT (edit with your real metrics)\n" + "\n".join(
        f"• {b}" for b in ordered
    ) + "\n"
    # preserve base body (trimmed)
    base_body = base
    if len(base_body) > 3500:
        base_body = base_body[:3500] + "\n…"
    original_block = "ORIGINAL RESUME CORE\n" + base_body + "\n"

    forged = "\n".join([header, skills_block, summary_block, exp_block, original_block])

    ats_before = ats_keyword_coverage(base, jd, skills)
    ats_after = ats_keyword_coverage(forged, jd, skills_line)
    ot_before = sinkhorn_skill_cost(res_skills, jd_skills)
    ot_after = sinkhorn_skill_cost(skill_set(forged, skills_line), jd_skills)
    js_before = jensen_shannon(unigram_dist(base), unigram_dist(jd))
    js_after = jensen_shannon(unigram_dist(forged), unigram_dist(jd))
    read = _readability_proxy(forged)
    auth = _authenticity_score(base, forged, injects)

    # multi-objective scalarization (transparent weights)
    obj = {
        "ats_coverage": float(ats_after["coverage"]),
        "ot_alignment": 1.0 - ot_after,
        "js_alignment": max(0.0, 1.0 - js_after / 0.7),
        "readability": read,
        "authenticity": auth,
        "ats_lift": float(ats_after["coverage"]) - float(ats_before["coverage"]),
    }
    scalar = (
        0.35 * obj["ats_coverage"]
        + 0.20 * obj["ot_alignment"]
        + 0.15 * obj["js_alignment"]
        + 0.15 * obj["readability"]
        + 0.15 * obj["authenticity"]
    )

    return {
        "version": FORGE_VERSION,
        "job_id": job.get("id"),
        "job_title": job_title,
        "company": company,
        "forged_resume": forged,
        "injects": injects,
        "bullets": ordered,
        "skills_block": skills_line[:28],
        "objectives": {k: round(v, 4) for k, v in obj.items()},
        "scalar_score": round(100 * scalar, 2),
        "ats_before": ats_before,
        "ats_after": ats_after,
        "ot_before": round(ot_before, 4),
        "ot_after": round(ot_after, 4),
        "js_before": round(js_before, 4),
        "js_after": round(js_after, 4),
        "honesty": (
            "Resume Forge optimizes presentation under authenticity constraints. "
            "It never invents employers or degrees. Edit metrics before submitting. "
            "You own every claim."
        ),
        "math": [
            "Simulated annealing bullet order",
            "Sinkhorn-lite skill OT",
            "Jensen–Shannon language alignment",
            "ATS set-recall coverage",
            "Multi-objective scalarization",
            "Authenticity constraint penalty",
        ],
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def forge_variants(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    limit: int = 5,
    inject_budget: int = 8,
) -> dict[str, Any]:
    """Forge tailored resume variants for top jobs; Hungarian-ready cost matrix."""
    t0 = time.perf_counter()
    variants = []
    for j in jobs[: max(1, min(limit, 15))]:
        if is_synthetic_job(j):
            continue
        variants.append(forge_resume_for_job(profile, j, inject_budget=inject_budget))

    # Cost matrix for Hungarian: cost = 1 - scalar/100 (assign best variants)
    # Identity assignment already 1:1 by job; include matrix for transparency
    n = len(variants)
    cost = [[0.0] * n for _ in range(n)]
    for i, v in enumerate(variants):
        for j in range(n):
            # prefer diagonal strong matches
            cost[i][j] = (1.0 - float(v["scalar_score"]) / 100.0) + (
                0.15 if i != j else 0.0
            )

    from jobsearch.sota_engines import hungarian_minimize

    assign = hungarian_minimize(cost) if n else []
    return {
        "ok": True,
        "version": FORGE_VERSION,
        "count": len(variants),
        "variants": variants,
        "hungarian_assignment": assign,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
        "honesty": (
            "One tailored working resume per live job. Hungarian assignment shows "
            "optimal variant↔job coupling under cost = 1 − quality."
        ),
    }
