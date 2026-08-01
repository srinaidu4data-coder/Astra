"""
Job Search product pipeline — multi-stage harvest + rank (not multi-agent LLM theater).

Stages: expand queries → harvest boards → ensemble rank → quality review →
drafts → next steps.
"""

from __future__ import annotations

import re
from typing import Any

from jobsearch.algorithms import ensemble_rank, skill_set, upskill_plan
from jobsearch.job_model import is_synthetic_job
from jobsearch.catalog import (
    indeed_search_url,
    is_strict_us_job,
    linkedin_job_view_url,
    linkedin_search_url,
    load_jobs,
    sanitize_url,
    title_matches_query,
)

PRODUCT_NAME = "Job Search"
PRODUCT_VERSION = "3.0.0"
PRODUCT_GRADE = "enterprise"


def _clean_profile(profile: dict[str, Any]) -> dict[str, Any]:
    """Normalize null/empty/oversized profile fields before any stage."""
    # Local import avoids circular deps; garbage strip is shared with autofill.
    from jobsearch.autofill import looks_like_binary_garbage, sanitize_resume_text

    p = dict(profile or {})
    title = p.get("target_title") if p.get("target_title") is not None else p.get("title")
    title = str(title or "Software Engineer").strip() or "Software Engineer"
    # Cap absurd titles (edge: title * 5000)
    if len(title) > 200:
        title = title[:200].rstrip()
    skills_raw = p.get("skills")
    if skills_raw is None:
        skills_raw = []
    if isinstance(skills_raw, str):
        skills_raw = [s.strip() for s in skills_raw.split(",") if s.strip()]
    skills = []
    for s in list(skills_raw)[:40]:
        t = str(s).strip()[:48]
        if t:
            skills.append(t)
    summary = str(p.get("summary") or p.get("bio") or "")
    if looks_like_binary_garbage(summary):
        summary = ""
    # Cap ranking text (API also truncates resume; defense in depth)
    if len(summary) > 8000:
        summary = summary[:8000]
    resume = p.get("resume_text")
    if resume is not None:
        resume = sanitize_resume_text(str(resume)[:6000])
        p["resume_text"] = resume
        # Only append readable resume into ranking summary — never ZIP/PK binary
        if resume and "RESUME:" not in summary and not looks_like_binary_garbage(resume):
            summary = (summary + "\n\nRESUME:\n" + resume)[:8000]
    p["target_title"] = title
    p["skills"] = skills
    p["summary"] = summary
    # Keep empty name empty so parse_person_name can use resume_filename / email
    raw_name = str(p.get("name") or "").strip()
    if raw_name and looks_like_binary_garbage(raw_name):
        raw_name = ""
    p["name"] = raw_name[:120]
    # Preserve resume filename for name derivation in autofill
    if p.get("resume_filename") is not None:
        p["resume_filename"] = str(p.get("resume_filename") or "")[:240]
    # Contact fields for browser auto-apply (ATS form fill)
    if p.get("email") is not None:
        p["email"] = str(p.get("email") or "")[:200]
    if p.get("phone") is not None:
        p["phone"] = str(p.get("phone") or "")[:40]
    if p.get("linkedin_url") is not None:
        p["linkedin_url"] = str(p.get("linkedin_url") or "")[:300]
    if p.get("portfolio_url") is not None:
        p["portfolio_url"] = str(p.get("portfolio_url") or "")[:300]
    if p.get("years_experience") is not None:
        p["years_experience"] = str(p.get("years_experience") or "")[:20]
    if p.get("work_authorization") is not None:
        p["work_authorization"] = str(p.get("work_authorization") or "")[:120]
    if p.get("location") is not None:
        p["location"] = str(p.get("location") or "")[:120]
    return p


def stage_expand_queries(profile: dict[str, Any]) -> dict[str, Any]:
    profile = _clean_profile(profile)
    skills = list(profile.get("skills") or [])
    title = str(profile.get("target_title") or "Software Engineer")
    summary = str(profile.get("summary") or "")
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
    title_first = title.split()[0] if title.split() else "jobs"
    queries = [
        title,
        " ".join(list(expanded)[:8]),
        f"{title} remote",
        f"{title} S/4HANA"
        if "sap" in title.lower() or "fico" in title.lower()
        else f"{title} engineer",
    ]
    for s in list(expanded)[:4]:
        if s and title_first:
            queries.append(f"{s} {title_first}")
    seen: set[str] = set()
    quniq: list[str] = []
    for q in queries:
        q = " ".join(str(q).split())
        if not q or q.lower() in seen:
            continue
        seen.add(q.lower())
        quniq.append(q)
    if not quniq:
        quniq = ["Software Engineer"]
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


def stage_rank(
    profile: dict[str, Any], jobs: list[dict[str, Any]], *, fast: bool = True
) -> dict[str, Any]:
    # Latency: rank on title + skills + short summary head (not full resume dump)
    text = " ".join(
        [
            str(profile.get("target_title") or ""),
            " ".join(str(s) for s in (profile.get("skills") or [])),
            str(profile.get("summary") or "")[:1500],
        ]
    )
    ranked = ensemble_rank(
        text, list(profile.get("skills") or []), jobs, fast=fast
    )
    return {
        "stage": "rank",
        "algorithms": (
            ["BM25", "Cosine TF", "Jaccard", "Bayesian fit", "Title boost"]
            if fast
            else [
                "BM25",
                "Cosine TF",
                "Jaccard skill coverage",
                "Bayesian skill fit",
                "Skill centrality",
                "1-hop skill path",
                "Elo pairwise",
                "Diversity bonus",
            ]
        ),
        "method": "fast_ir" if fast else "ensemble_ir",
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
    request_id: str | None = None,
    bypass_cache: bool = False,
) -> dict[str, Any]:
    """
    Product pipeline. include_seed=False by default (live boards only).

    Enterprise:
      - fingerprint cache (TTL) for identical runs
      - request correlation id on every response
      - structured latency metrics
    """
    import time

    from jobsearch.enterprise import (
        cache as ent_cache,
        materialize_cached_run,
        metrics as ent_metrics,
        new_request_id,
        run_fingerprint,
    )

    t0 = time.perf_counter()
    rid = request_id or new_request_id()
    pipeline_log: list[dict[str, Any]] = []
    profile = _clean_profile(profile)
    remote = (remote or "all").lower().strip()
    if remote not in ("all", "remote", "hybrid", "onsite"):
        remote = "all"
    location = (location or "all").strip() or "all"
    limit = max(20, min(int(limit or 200), 500))
    min_score = max(0.0, min(float(min_score or 0.0), 100.0))

    fp = run_fingerprint(
        profile,
        use_live=use_live,
        remote=remote,
        location=location,
        exclude_linkedin=exclude_linkedin,
        include_seed=include_seed,
        limit=limit,
        min_score=min_score,
    )
    cache_status = "bypass" if bypass_cache else "miss"
    if not bypass_cache:
        cached, cache_status = ent_cache().get(fp, allow_stale=True)
        if cached is not None and isinstance(cached, dict):
            ent_metrics().incr("run.cache_hit")
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 3)
            out = materialize_cached_run(
                cached,
                request_id=rid,
                cache_status=cache_status,
                elapsed_ms=elapsed_ms,
            )
            # Ensure fingerprint prefix is present even on older cache entries
            out["cache"]["fingerprint"] = out["cache"].get("fingerprint") or fp[:16]
            ent_metrics().observe_ms("run.total", elapsed_ms)
            ent_metrics().incr("run.ok")
            return out

    ent_metrics().incr("run.cache_miss" if cache_status == "miss" else "run.start")

    def _tick(stage: str, **extra: Any) -> None:
        pipeline_log.append(
            {"stage": stage, "ms": round((time.perf_counter() - t0) * 1000), **extra}
        )

    _tick("start", request_id=rid, fingerprint=fp[:12])
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
    # Latency: filter before rank so N is smaller for BM25/Elo
    target = str(profile.get("target_title") or expand.get("target_title") or "")
    primary_q = str((expand.get("queries") or [target] or [""])[0] or target)
    pre = list(harvest.get("jobs") or [])
    before_pre = len(pre)
    pre = [
        j
        for j in pre
        if title_matches_query(str(j.get("title") or ""), target)
        or title_matches_query(str(j.get("title") or ""), primary_q)
    ]
    if str(location or "").lower() in ("us", "usa", "united states", "u.s."):
        pre = [j for j in pre if is_strict_us_job(j)]
        for j in pre:
            j["country"] = "us"
    dropped_pre = before_pre - len(pre)
    _tick("prefilter", jobs=len(pre), dropped=dropped_pre)

    rank = stage_rank(profile, pre, fast=True)
    ranked = rank["ranked"]
    if min_score and min_score > 0:
        ranked = [
            j
            for j in ranked
            if float((j.get("scores") or {}).get("ensemble") or 0) >= min_score
        ]
    ranked = [
        j
        for j in ranked
        if int(j.get("title_hits") or 0) > 0
        or title_matches_query(str(j.get("title") or ""), target)
    ]
    _tick("rank", ranked=len(ranked), dropped_pre=dropped_pre)
    # Skip heavy side-agents when empty
    if ranked:
        review = stage_review(ranked, profile)
        drafts = stage_drafts(ranked, profile)
        plan = stage_plan(profile, ranked)
    else:
        review = {"stage": "review", "flagged": [], "summary": "No roles to review."}
        drafts = {"stage": "drafts", "drafts": [], "method": "template"}
        plan = {"stage": "plan", "upskill": []}
    next_steps = stage_next_steps(
        profile,
        ranked,
        has_resume=has_resume,
        diagnostics=harvest.get("diagnostics"),
    )
    _tick("review")

    for j in ranked:
        j["is_synthetic"] = is_synthetic_job(j)
        if j["is_synthetic"]:
            j["product_label"] = "practice"
        title = str(j.get("title") or "")
        company = str(j.get("company") or "")
        # Sanitize every outbound link field
        for key in ("url", "apply_url", "linkedin_url", "indeed_url", "google_url"):
            if j.get(key):
                j[key] = sanitize_url(str(j.get(key) or ""))

        src = str(j.get("source") or "").lower()
        url_l = str(j.get("url") or "").lower()
        apply_l = str(j.get("apply_url") or "").lower()
        is_li = (
            src == "linkedin"
            or "linkedin.com/jobs/view/" in url_l
            or "linkedin.com/jobs/view/" in apply_l
        )
        j["is_linkedin"] = bool(j.get("is_linkedin") or is_li)

        # Extract LinkedIn job id from any field and normalize to /jobs/view/{id}/
        view = None
        for cand in (j.get("apply_url"), j.get("url"), j.get("linkedin_url")):
            m = re.search(r"linkedin\.com/jobs/view/(\d+)", str(cand or ""), re.I)
            if m:
                view = linkedin_job_view_url(m.group(1))
                break
        if is_li and view:
            j["apply_url"] = view
            j["url"] = view
            j["linkedin_url"] = view
            j["apply_kind"] = "direct"
        elif is_li and not view:
            # Broken LI row without id — fall back to search (still clickable)
            j["linkedin_url"] = linkedin_search_url(title, company)
            j["apply_url"] = j.get("apply_url") or j["linkedin_url"]
            j["apply_kind"] = "search"

        if not j.get("indeed_url"):
            j["indeed_url"] = indeed_search_url(title, company)
        else:
            j["indeed_url"] = sanitize_url(str(j["indeed_url"]), fallback=indeed_search_url(title, company))

        if not j.get("linkedin_url"):
            j["linkedin_url"] = linkedin_search_url(title, company)

        if not j.get("apply_url"):
            j["apply_url"] = (
                j.get("url")
                or j.get("indeed_url")
                or j.get("google_url")
                or j.get("linkedin_url")
            )

        # Final pass — never ship empty / example / non-http apply links
        j["apply_url"] = sanitize_url(
            str(j.get("apply_url") or ""),
            fallback=indeed_search_url(title, company),
        )
        j["url"] = sanitize_url(str(j.get("url") or ""), fallback=j["apply_url"])

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
    elapsed_ms = round((time.perf_counter() - t0) * 1000)
    result = {
        "ok": True,
        "request_id": rid,
        "product": {
            "name": PRODUCT_NAME,
            "version": PRODUCT_VERSION,
            "grade": PRODUCT_GRADE,
            "mode": "live_first",
            "honesty": (
                "Deterministic multi-stage pipeline (query expand → harvest → IR rank). "
                "Not multi-agent LLMs. Fit scores are relative similarity, not hire odds. "
                "Practice market is opt-in synthetic data."
            ),
        },
        "localhost_lab": True,
        "cache": {
            "status": "miss",
            "fingerprint": fp[:16],
            "served_from_cache": False,
        },
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
                f"{PRODUCT_NAME} v{PRODUCT_VERSION} enterprise — live boards first; "
                "practice market opt-in; IR fit scores; fingerprint cache + circuit breakers."
            ),
            "total_returned": min(len(ranked), max(limit, 100)),
            "total_ranked": len(ranked),
            "live_count": live_n,
            "seed_count": seed_n,
            "has_resume": has_resume,
            "include_seed": include_seed,
            "soft_recovery": diag.get("soft_recovery"),
            "elapsed_ms": elapsed_ms,
            "market_thin": bool(next_steps.get("market_thin")),
            "cache_status": "miss",
            "request_id": rid,
            "fingerprint": fp[:16],
            "grade": PRODUCT_GRADE,
        },
        "enterprise": {
            "grade": PRODUCT_GRADE,
            "request_id": rid,
            "fingerprint": fp[:16],
            "circuit_breakers": (diag.get("circuit_breakers") or {}),
        },
    }
    # Cache successful runs (including empty — same query shouldn't re-hammer boards)
    try:
        ent_cache().put(fp, result, fingerprint=fp)
    except Exception:
        pass
    ent_metrics().observe_ms("run.total", elapsed_ms)
    ent_metrics().incr("run.ok")
    return result
