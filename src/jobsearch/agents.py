"""
Job Search product pipeline — multi-stage harvest + rank (not multi-agent LLM theater).

Stages: expand queries → harvest boards → ensemble rank → quality review →
drafts → next steps.
"""

from __future__ import annotations

from typing import Any

from jobsearch.algorithms import ensemble_rank, skill_set, upskill_plan
from jobsearch.catalog import load_jobs, title_matches_query

PRODUCT_NAME = "Job Search"
PRODUCT_VERSION = "1.0.0"


def stage_expand_queries(profile: dict[str, Any]) -> dict[str, Any]:
    skills = [str(s) for s in (profile.get("skills") or [])]
    title = str(profile.get("target_title") or profile.get("title") or "Software Engineer")
    summary = str(profile.get("summary") or profile.get("bio") or "")
    tokens = skill_set(summary + " " + title, skills)
    adjacent_map = {
        "react": ["typescript", "frontend", "javascript"],
        "python": ["fastapi", "django", "data"],
        "ml": ["pytorch", "llm", "ranking"],
        "kubernetes": ["devops", "terraform", "aws"],
        "sap": ["fico", "s4hana", "erp", "fi", "co", "tax", "vertex"],
        "fico": ["sap", "s4hana", "controlling", "gl", "ar", "ap"],
        "finance": ["sap", "fico", "s4hana", "accounting"],
    }
    expanded = set(skills)
    for s in set(tokens) | {str(x).lower() for x in skills}:
        sl = str(s).lower()
        for k, v in adjacent_map.items():
            if k in sl or sl in k:
                expanded.update(v)
    queries = [
        title,
        " ".join(list(expanded)[:8]),
        f"{title} remote",
        f"{title} S/4HANA" if "sap" in title.lower() or "fico" in title.lower() else f"{title} engineer",
    ]
    for s in list(expanded)[:4]:
        queries.append(f"{s} {title.split()[0] if title else 'jobs'}")
    seen: set[str] = set()
    quniq: list[str] = []
    for q in queries:
        q = " ".join(q.split())
        if q.lower() in seen:
            continue
        seen.add(q.lower())
        quniq.append(q)
    return {
        "stage": "expand",
        "target_title": title,
        "skill_tokens": sorted(tokens)[:40],
        "expanded_skills": sorted(expanded)[:40],
        "queries": quniq[:8],
        "notes": "Query expansion via skill adjacency (deterministic, not an LLM).",
    }


# Backward-compatible alias
agent_scout = stage_expand_queries


def stage_harvest(
    expand: dict[str, Any],
    *,
    use_live: bool,
    remote: str = "all",
    limit: int = 400,
    location: str = "all",
    exclude_linkedin: bool = False,
    include_seed: bool = False,
) -> dict[str, Any]:
    qlist = expand.get("queries") or ["software"]
    bundle = load_jobs(
        query=qlist[0],
        queries=qlist,
        use_live=use_live,
        remote=remote,
        limit=limit,
        location=location,
        exclude_linkedin=exclude_linkedin,
        include_seed=include_seed,
    )
    jobs = bundle["jobs"]
    diag = bundle["diagnostics"]
    return {
        "stage": "harvest",
        "query": qlist[0],
        "queries": qlist,
        "count": len(jobs),
        "sources": sorted({j.get("source", "?") for j in jobs}),
        "diagnostics": diag,
        "filters": {
            "remote": remote,
            "location": location,
            "exclude_linkedin": exclude_linkedin,
            "include_seed": include_seed,
        },
        "jobs": jobs,
    }


agent_harvester = stage_harvest  # type: ignore[assignment]


def stage_rank(profile: dict[str, Any], jobs: list[dict[str, Any]]) -> dict[str, Any]:
    text = " ".join(
        [
            str(profile.get("summary") or ""),
            str(profile.get("target_title") or ""),
            " ".join(str(s) for s in (profile.get("skills") or [])),
            " ".join(str(x) for x in (profile.get("experience") or [])),
        ]
    )
    ranked = ensemble_rank(text, list(profile.get("skills") or []), jobs)
    return {
        "stage": "rank",
        "algorithms": [
            "BM25",
            "Cosine TF",
            "Jaccard skill coverage",
            "Bayesian skill fit",
            "Skill centrality",
            "1-hop skill path",
            "Elo pairwise",
            "Diversity bonus",
        ],
        "method": "ensemble_ir",
        "disclaimer": "Fit scores are relative IR similarity, not interview probability.",
        "ranked": ranked,
    }


agent_scorer = stage_rank


def stage_review(ranked: list[dict[str, Any]], profile: dict[str, Any]) -> dict[str, Any]:
    flags: list[dict[str, Any]] = []
    synthetic_n = 0
    for job in ranked[:30]:
        jflags: list[str] = []
        score = float(job.get("scores", {}).get("ensemble") or 0)
        gaps = job.get("gap_skills") or []
        if job.get("is_synthetic") or job.get("source") in ("seed_market", "seed"):
            synthetic_n += 1
            jflags.append("Practice listing (synthetic) — not a real opening.")
        if score >= 85 and len(gaps) >= 3:
            jflags.append("High score with many skill gaps — verify fit before applying.")
        if not job.get("url") and not job.get("apply_url"):
            jflags.append("Missing apply URL.")
        apply_u = str(job.get("apply_url") or job.get("url") or "")
        if "example.com" in apply_u:
            jflags.append("Placeholder URL — enable live boards or search Indeed manually.")
        if jflags:
            flags.append(
                {
                    "job_id": job.get("id"),
                    "title": job.get("title"),
                    "flags": jflags,
                    "is_synthetic": bool(job.get("is_synthetic")),
                }
            )
    return {
        "stage": "review",
        "flagged": flags,
        "synthetic_in_top30": synthetic_n,
        "summary": (
            f"{len(flags)} roles need careful review."
            + (f" {synthetic_n} practice listings in top results." if synthetic_n else "")
        ),
    }


agent_critic = stage_review


def stage_drafts(ranked: list[dict[str, Any]], profile: dict[str, Any], limit: int = 8) -> dict[str, Any]:
    name = profile.get("name") or "there"
    title = profile.get("target_title") or "professional"
    drafts = []
    live = [j for j in ranked if not j.get("is_synthetic")]
    pool = live[:limit] if live else ranked[:limit]
    for job in pool:
        company = job.get("company") or "the team"
        role = job.get("title") or "this role"
        hits = job.get("skill_hits") or 0
        drafts.append(
            {
                "job_id": job.get("id"),
                "channel": "email",
                "subject": f"Interest in {role} @ {company}",
                "body": (
                    f"Hi {company} hiring team — I'm {name}, targeting {title} roles. "
                    f"Your {role} posting aligns on {hits} skill signals "
                    f"({', '.join((job.get('skills') or [])[:4]) or 'core stack'}). "
                    f"Open to a short conversation on priorities for the first 90 days."
                ),
                "caveat": "Template draft only — edit before sending. Never auto-sent.",
                "is_synthetic": bool(job.get("is_synthetic")),
            }
        )
    return {
        "stage": "drafts",
        "drafts": drafts,
        "method": "template",
    }


agent_outreach = stage_drafts


def stage_plan(profile: dict[str, Any], ranked: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "stage": "plan",
        "upskill": upskill_plan(list(profile.get("skills") or []), ranked),
    }


agent_planner = stage_plan


def stage_next_steps(
    profile: dict[str, Any],
    ranked: list[dict[str, Any]],
    *,
    has_resume: bool,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    live = [j for j in ranked if not j.get("is_synthetic")]
    top = (live or ranked)[:5]
    market_thin = len(live) < 5
    steps: list[dict[str, Any]] = [
        {
            "id": "resume",
            "order": 1,
            "title": "Attach resume",
            "status": "done" if has_resume else "todo",
            "detail": (
                "Resume loaded — skills steer ranking."
                if has_resume
                else "Upload a PDF/DOCX resume so fit uses your real experience."
            ),
            "cta": "upload_resume",
        },
        {
            "id": "search",
            "order": 2,
            "title": "Review live shortlist",
            "status": "done" if live else ("todo" if not ranked else "warn"),
            "detail": (
                f"{len(live)} live roles ranked. Prefer score 55+ with direct apply links."
                if live
                else (
                    "No live openings matched. Broaden location or work mode, "
                    "or turn on Practice market for drills only."
                )
            ),
            "cta": "run_search",
        },
        {
            "id": "apply",
            "order": 3,
            "title": "Apply to top live roles",
            "status": "todo",
            "detail": "Open Apply on live cards only. Mark Applied to track follow-ups.",
            "cta": "apply_links",
            "suggested_jobs": [
                {
                    "id": j.get("id"),
                    "title": j.get("title"),
                    "company": j.get("company"),
                    "apply_url": j.get("apply_url") or j.get("url"),
                    "score": (j.get("scores") or {}).get("ensemble"),
                    "is_synthetic": bool(j.get("is_synthetic")),
                }
                for j in top
            ],
        },
        {
            "id": "tailor",
            "order": 4,
            "title": "Tailor materials",
            "status": "todo",
            "detail": "Save JD to Knowledge, then Mock interview with that context.",
            "cta": "knowledge_and_mock",
            "gaps": (top[0].get("gap_skills") if top else []) or [],
        },
        {
            "id": "prep",
            "order": 5,
            "title": "Interview prep",
            "status": "todo",
            "detail": "When invited, open Mock interview with the target role as job context.",
            "cta": "mock_interview",
        },
        {
            "id": "track",
            "order": 6,
            "title": "Track outcomes",
            "status": "todo",
            "detail": "Log applied / interview / offer / rejected so the pipeline stays honest.",
            "cta": "tracker",
        },
    ]
    warnings = list((diagnostics or {}).get("warnings") or [])
    if market_thin:
        warnings.append(
            "Thin live market for these filters — public boards (freehire/Remotive) "
            "often miss SAP/LinkedIn-heavy niches."
        )
    headline = (
        f"{len(live)} live roles ready — apply and track."
        if live
        else "No live matches — broaden filters or use Practice market for drills."
    )
    return {
        "stage": "next_steps",
        "has_resume": has_resume,
        "live_count": len(live),
        "steps": steps,
        "headline": headline,
        "warnings": warnings,
        "market_thin": market_thin,
    }


agent_next_steps = stage_next_steps


def run_research_team(
    profile: dict[str, Any],
    *,
    use_live: bool = True,
    remote: str = "all",
    limit: int = 400,
    min_score: float = 0.0,
    has_resume: bool = False,
    location: str = "all",
    exclude_linkedin: bool = False,
    include_seed: bool = False,
) -> dict[str, Any]:
    """
    Product pipeline. include_seed=False by default (live boards only).
    """
    import time

    t0 = time.perf_counter()
    pipeline_log: list[dict[str, Any]] = []

    def _tick(stage: str, **extra: Any) -> None:
        pipeline_log.append(
            {"stage": stage, "ms": round((time.perf_counter() - t0) * 1000), **extra}
        )

    _tick("start")
    expand = stage_expand_queries(profile)
    _tick("expand", queries=len(expand.get("queries") or []))
    harvest = stage_harvest(
        expand,
        use_live=use_live,
        remote=remote,
        limit=limit,
        location=location,
        exclude_linkedin=exclude_linkedin,
        include_seed=include_seed,
    )
    _tick(
        "harvest",
        jobs=harvest.get("count") or 0,
        sources=harvest.get("sources"),
        live=(harvest.get("diagnostics") or {}).get("live_after_filters"),
    )
    rank = stage_rank(profile, harvest["jobs"])
    ranked = rank["ranked"]
    # Hard drop off-title noise that slipped past harvest
    target = str(profile.get("target_title") or expand.get("target_title") or "")
    primary_q = str((expand.get("queries") or [target] or [""])[0] or target)
    before_title = len(ranked)
    ranked = [
        j
        for j in ranked
        if title_matches_query(str(j.get("title") or ""), target)
        or title_matches_query(str(j.get("title") or ""), primary_q)
    ]
    dropped_title = before_title - len(ranked)
    if dropped_title:
        harvest.setdefault("diagnostics", {}).setdefault("warnings", []).append(
            f"Dropped {dropped_title} off-title roles after ranking."
        )
    if min_score and min_score > 0:
        ranked = [
            j
            for j in ranked
            if float((j.get("scores") or {}).get("ensemble") or 0) >= min_score
        ]
    _tick("rank", ranked=len(ranked), dropped_title=dropped_title)
    review = stage_review(ranked, profile)
    drafts = stage_drafts(ranked, profile)
    plan = stage_plan(profile, ranked)
    next_steps = stage_next_steps(
        profile,
        ranked,
        has_resume=has_resume,
        diagnostics=harvest.get("diagnostics"),
    )
    _tick("review")

    for j in ranked:
        j["is_synthetic"] = bool(
            j.get("is_synthetic") or j.get("source") in ("seed_market", "seed")
        )
        if not j.get("apply_url"):
            j["apply_url"] = (
                j.get("indeed_url")
                or j.get("url")
                or j.get("google_url")
                or j.get("linkedin_url")
            )
        if not j.get("linkedin_url") and j.get("title"):
            import re as _re
            import urllib.parse

            clean = _re.sub(r"\s*\([^)]*\)\s*", " ", str(j.get("title") or "")).strip()
            q = urllib.parse.quote_plus(f"{clean} {j.get('company', '')}")
            j["linkedin_url"] = f"https://www.linkedin.com/jobs/search/?keywords={q}"
            if not j.get("indeed_url"):
                j["indeed_url"] = f"https://www.indeed.com/jobs?q={q}&l=United+States"

    live_n = sum(1 for j in ranked if not j.get("is_synthetic"))
    seed_n = len(ranked) - live_n
    _tick("done", live=live_n, seed=seed_n)

    diag = harvest.get("diagnostics") or {}
    warnings = list(diag.get("warnings") or []) + list(next_steps.get("warnings") or [])
    # de-dupe warnings preserve order
    seen_w: set[str] = set()
    warn_u: list[str] = []
    for w in warnings:
        if w not in seen_w:
            seen_w.add(w)
            warn_u.append(w)

    # Prefer live in returned slice order already from ensemble
    return {
        "ok": True,
        "product": {
            "name": PRODUCT_NAME,
            "version": PRODUCT_VERSION,
            "mode": "live_first",
            "honesty": (
                "Deterministic multi-stage pipeline (query expand → harvest → IR rank). "
                "Not multi-agent LLMs. Fit scores are relative similarity, not hire odds. "
                "Practice market is opt-in synthetic data."
            ),
        },
        "localhost_lab": True,
        "filters": {
            "remote": remote,
            "limit": limit,
            "min_score": min_score,
            "use_live": use_live,
            "location": location,
            "exclude_linkedin": exclude_linkedin,
            "include_seed": include_seed,
        },
        "pipeline": pipeline_log,
        "warnings": warn_u,
        "stages": {
            "expand": {
                "stage": "expand",
                "target_title": expand.get("target_title"),
                "queries": expand.get("queries"),
                "expanded_skills": expand.get("expanded_skills", [])[:20],
                "notes": expand.get("notes"),
            },
            "harvest": {
                "stage": "harvest",
                "query": harvest.get("query"),
                "queries": harvest.get("queries"),
                "count": harvest.get("count"),
                "sources": harvest.get("sources"),
                "diagnostics": harvest.get("diagnostics"),
                "filters": harvest.get("filters"),
            },
            "rank": {
                "stage": "rank",
                "algorithms": rank["algorithms"],
                "method": rank.get("method"),
                "disclaimer": rank.get("disclaimer"),
                "top_n": min(25, len(ranked)),
                "total_ranked": len(ranked),
            },
            "review": review,
            "drafts": drafts,
            "plan": plan,
            "next_steps": next_steps,
        },
        # Backward-compatible keys for older UI
        "agents": {
            "scout": {
                "agent": "expand",
                "target_title": expand.get("target_title"),
                "queries": expand.get("queries"),
                "expanded_skills": expand.get("expanded_skills", [])[:20],
                "notes": expand.get("notes"),
            },
            "harvester": {
                "agent": "harvest",
                "query": harvest.get("query"),
                "queries": harvest.get("queries"),
                "count": harvest.get("count"),
                "sources": harvest.get("sources"),
                "diagnostics": harvest.get("diagnostics"),
                "filters": harvest.get("filters"),
            },
            "scorer": {
                "agent": "rank",
                "algorithms": rank["algorithms"],
                "top_n": min(25, len(ranked)),
                "total_ranked": len(ranked),
            },
            "critic": review,
            "outreach": drafts,
            "planner": plan,
            "next_steps": next_steps,
        },
        "next_steps": next_steps,
        "ranked_jobs": ranked[: max(limit, 100)],
        "meta": {
            "note": (
                f"{PRODUCT_NAME} v{PRODUCT_VERSION} — live boards first; "
                "practice market opt-in; IR fit scores."
            ),
            "total_returned": min(len(ranked), max(limit, 100)),
            "total_ranked": len(ranked),
            "live_count": live_n,
            "seed_count": seed_n,
            "has_resume": has_resume,
            "include_seed": include_seed,
            "soft_recovery": diag.get("soft_recovery"),
            "elapsed_ms": round((time.perf_counter() - t0) * 1000),
            "market_thin": bool(next_steps.get("market_thin")),
        },
    }
