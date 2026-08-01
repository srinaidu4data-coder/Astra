"""
Astra Apply Nexus — next-generation auto-apply pipeline.

Inspired by (ideas only, original implementation):
  ApplyPilot 6-stage flow · career-ops quality gate · Liam-Frost HITL · Simplify autofill

Stages:
  1. discover  — live boards (existing load_jobs / ranked seed)
  2. enrich    — normalize JD text, keywords, apply URL health
  3. score     — ensemble + letter grade + skip reasons
  4. tailor    — Resume Forge
  5. cover     — cover note + STAR + application Q&A bank
  6. apply     — campaign steps (open URL / dry-run / track)

Never silent-submits third-party ATS without the user's browser.
"""

from __future__ import annotations

import time
from typing import Any

from jobsearch.apply_engine import build_apply_packet, resolve_cover_and_injects
from jobsearch.auto_apply import build_auto_apply_campaign
from jobsearch.autofill import build_autofill_profile  # re-export for API consumers
from jobsearch.catalog import sanitize_url
from jobsearch.enterprise import metrics as ent_metrics
from jobsearch.enterprise import new_request_id
from jobsearch.form_pack import merge_skill_phrase
from jobsearch.job_model import is_synthetic_job
from jobsearch.tailor_rt import tailor_materials

NEXUS_VERSION = "1.3.0"
NEXUS_CODENAME = "Nexus"


def letter_grade(score_0_100: float) -> str:
    """career-ops spirit: map fit to A–F (not identical to their 1–5 LLM rubric)."""
    s = float(score_0_100 or 0)
    if s >= 85:
        return "A"
    if s >= 75:
        return "B"
    if s >= 65:
        return "C"
    if s >= 55:
        return "D"
    if s >= 45:
        return "E"
    return "F"


def grade_to_5(score_0_100: float) -> float:
    """Map 0–100 ensemble → 1.0–5.0 scale (career-ops-like display)."""
    s = max(0.0, min(100.0, float(score_0_100 or 0)))
    return round(1.0 + (s / 100.0) * 4.0, 2)


def application_qa_bank(
    profile: dict[str, Any],
    job: dict[str, Any],
    injects: list[str] | None = None,
) -> list[dict[str, str]]:
    """Reusable screening Q&A (ApplyPilot / AutoApply idea).

    When Tailor RT injects are provided, skill phrases match forged resume keywords
    (same merge as form_pack cover / why_* answers).
    """
    title = str(job.get("title") or "this role")
    company = str(job.get("company") or "your team")
    skills = merge_skill_phrase(profile, injects, limit=6)
    return [
        {
            "q": "Why are you interested in this role?",
            "a": (
                f"I'm targeting {profile.get('target_title') or title} work. "
                f"{company}'s {title} aligns with my strengths in {skills}, "
                f"and I'm motivated by the impact described in the posting."
            ),
        },
        {
            "q": "Why this company?",
            "a": (
                f"I'm drawn to {company}'s problem space and the mandate of the {title} role. "
                f"My background in {skills} maps to what you're hiring for, and I want "
                f"to contribute immediately while growing with the team."
            ),
        },
        {
            "q": "Tell us about a relevant achievement.",
            "a": (
                f"I delivered outcomes using {skills}, partnering cross-functionally and measuring impact. "
                f"(Edit with your real metric before submit.)"
            ),
        },
        {
            "q": "Are you authorized to work?",
            "a": str(profile.get("work_authorization") or "Yes — authorized to work as applicable."),
        },
    ]


def stage_enrich(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for j in jobs:
        row = dict(j)
        raw = str(j.get("apply_url") or j.get("url") or "").strip()
        url = sanitize_url(raw)
        # Prefer sanitized; if empty but raw is http(s) and not junk, keep raw
        if not url and raw.lower().startswith("http") and "javascript:" not in raw.lower():
            if "example.com" not in raw.lower():
                url = raw
        row["apply_url"] = url
        row["url_ok"] = bool(url) and url.lower().startswith("http") and "example.com" not in url.lower()
        text = " ".join(
            [
                str(j.get("title") or ""),
                str(j.get("company") or ""),
                " ".join(j.get("skills") or []),
                str(j.get("text") or "")[:2000],
            ]
        )
        row["enriched_text"] = text
        row["jd_len"] = len(text)
        out.append(row)
    return out


def stage_score(
    jobs: list[dict[str, Any]],
    *,
    min_score: float = 55.0,
    min_grade: str = "D",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (passed, skipped) with letter grades and skip reasons."""
    order = {"A": 5, "B": 4, "C": 3, "D": 2, "E": 1, "F": 0}
    min_g = order.get(min_grade.upper(), 2)
    passed: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for j in jobs:
        if is_synthetic_job(j):
            skipped.append({**j, "skip_reasons": ["practice_synthetic"]})
            continue
        ens = float((j.get("scores") or {}).get("ensemble") or j.get("marvel_score") or 0)
        grade = letter_grade(ens)
        reasons = []
        if not j.get("url_ok"):
            reasons.append("missing_or_bad_apply_url")
        if ens < min_score:
            reasons.append(f"score_below_min:{ens:.0f}<{min_score:.0f}")
        if order.get(grade, 0) < min_g:
            reasons.append(f"grade_below_min:{grade}<{min_grade}")
        row = {
            **j,
            "nexus_score": ens,
            "nexus_grade": grade,
            "nexus_score_5": grade_to_5(ens),
            "skip_reasons": reasons,
        }
        if reasons:
            skipped.append(row)
        else:
            passed.append(row)
    passed.sort(key=lambda x: float(x.get("nexus_score") or 0), reverse=True)
    return passed, skipped


def stage_tailor_and_cover(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    has_resume: bool,
    forge: bool = True,
) -> list[dict[str, Any]]:
    packets = []
    for j in jobs:
        packet = build_apply_packet(profile, j, has_resume=has_resume)
        forge_blob = None
        if forge:
            forge_blob = tailor_materials(
                profile, j, max_rounds=2, inject_budget=8, use_rt=True
            )
        cover, keyword_inject, star_bullets = resolve_cover_and_injects(
            profile, j, packet, forge_blob
        )
        qa = application_qa_bank(profile, j, injects=keyword_inject)
        packets.append(
            {
                "job_id": j.get("id"),
                "title": j.get("title"),
                "company": j.get("company"),
                "source": j.get("source"),
                "apply_url": packet.get("apply_url") or j.get("apply_url"),
                "nexus_score": j.get("nexus_score"),
                "nexus_grade": j.get("nexus_grade"),
                "nexus_score_5": j.get("nexus_score_5"),
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
                "qa_bank": qa,
                "readiness": packet.get("readiness"),
                "action": "nexus_ready",
            }
        )
    return packets


def run_nexus_pipeline(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    min_score: float = 0.0,
    min_grade: str = "F",
    budget: int = 12,
    has_resume: bool = False,
    forge: bool = True,
    mode: str = "campaign",  # dry_run | campaign
    delay_ms: int = 2500,
    soft_fallback: bool = True,
) -> dict[str, Any]:
    """
    Full Nexus 6-stage pipeline on an existing job list (discover already done).

    Defaults are soft (min_score=0, grade F) so relative IR scores (~30–60 on live
    boards) still produce materials. Strict career-ops callers pass min_score=75
    with soft_fallback=True to get a best-available shortlist when nobody clears B+.
    """
    t0 = time.perf_counter()
    rid = new_request_id()
    mode = (mode or "campaign").lower().strip()
    if mode not in ("dry_run", "campaign"):
        mode = "campaign"
    budget = max(1, min(int(budget or 12), 25))
    soft_note = ""

    # 1–2 discover/enrich (jobs assumed discovered by search)
    enriched = stage_enrich(list(jobs or []))
    # 3 score
    passed, skipped = stage_score(enriched, min_score=min_score, min_grade=min_grade)

    # Soft fallback: live freehire scores often sit 30–55 — hard B+/75 empties the list
    # and the UI looks "broken". Take best URL-ok roles instead and label them.
    if not passed and soft_fallback:
        pool = [
            j
            for j in enriched
            if j.get("url_ok") and not is_synthetic_job(j)
        ]
        pool.sort(
            key=lambda x: float((x.get("scores") or {}).get("ensemble") or 0),
            reverse=True,
        )
        for j in pool[: max(budget, 5)]:
            ens = float((j.get("scores") or {}).get("ensemble") or 0)
            passed.append(
                {
                    **j,
                    "nexus_score": ens,
                    "nexus_grade": letter_grade(ens),
                    "nexus_score_5": grade_to_5(ens),
                    "skip_reasons": [],
                    "soft_fallback": True,
                }
            )
        if passed:
            soft_note = (
                f"No roles met min score {min_score:g}/{min_grade}; "
                f"showing top {len(passed)} by relative fit so you can still apply."
            )

    shortlist = passed[: max(budget * 2, budget)]
    # 4–5 tailor + cover
    materials = stage_tailor_and_cover(
        profile,
        shortlist[:budget],
        has_resume=has_resume or bool(profile.get("has_resume") or profile.get("resume_text")),
        forge=forge,
    )
    # 6 apply plan
    apply_plan = None
    if mode == "campaign" and shortlist:
        try:
            apply_plan = build_auto_apply_campaign(
                profile,
                shortlist,
                budget=budget,
                has_resume=has_resume,
                delay_ms=delay_ms,
                include_prepare=True,
                forge=forge,
            )
        except Exception as e:
            apply_plan = {"ok": False, "error": str(e)[:160]}

    autofill = build_autofill_profile(profile)
    elapsed = round((time.perf_counter() - t0) * 1000, 2)
    ent_metrics().incr("nexus.run")
    ent_metrics().observe_ms("nexus.pipeline", elapsed)

    return {
        "ok": True,
        "request_id": rid,
        "version": NEXUS_VERSION,
        "codename": NEXUS_CODENAME,
        "mode": mode,
        "auto_submit_ats": False,
        "honesty": (
            "Nexus prepares a quality-gated apply plan and materials. "
            "Dry-run never opens URLs. Campaign opens employer pages in your browser. "
            "Never silent-submits ATS forms. Inspired by best OSS ideas; original code."
        ),
        "inspired_by": [
            "ApplyPilot (6-stage pipeline, dry-run)",
            "career-ops (quality gate / letter grades)",
            "Liam-Frost AutoApply (HITL + skip reasons)",
            "Simplify (autofill field map)",
            "InterviewPulse (boards, night scout, cache)",
        ],
        "stages": {
            "discover": {"input": len(jobs), "note": "upstream search / night digest"},
            "enrich": {"count": len(enriched)},
            "score": {
                "passed": len(passed),
                "skipped": len(skipped),
                "min_score": min_score,
                "min_grade": min_grade,
                "soft_fallback": bool(soft_note),
            },
            "tailor_cover": {"packets": len(materials)},
            "apply": {
                "mode": mode,
                "steps": len((apply_plan or {}).get("steps") or materials),
            },
        },
        "warnings": [soft_note] if soft_note else [],
        "stats": {
            "input_jobs": len(jobs),
            "enriched": len(enriched),
            "passed_gate": len(passed),
            "skipped": len(skipped),
            "materials": len(materials),
            "soft_fallback": bool(soft_note),
            "grade_A": sum(1 for j in passed if j.get("nexus_grade") == "A"),
            "grade_B": sum(1 for j in passed if j.get("nexus_grade") == "B"),
            "grade_C": sum(1 for j in passed if j.get("nexus_grade") == "C"),
        },
        "skipped": [
            {
                "job_id": s.get("id"),
                "title": s.get("title"),
                "company": s.get("company"),
                "nexus_score": s.get("nexus_score"),
                "nexus_grade": s.get("nexus_grade"),
                "skip_reasons": s.get("skip_reasons"),
            }
            for s in skipped[:40]
        ],
        "materials": materials,
        "apply_campaign": apply_plan,
        "autofill_profile": autofill,
        "elapsed_ms": elapsed,
    }
