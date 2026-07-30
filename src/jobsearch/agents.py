"""
RT (Research Team) multi-agent orchestration for Job Search AI.

Agents (deterministic + optional LLM polish later):
  1. Scout     — expand query facets from profile
  2. Harvester — load seed + live catalogs
  3. Scorer    — multi-algorithm ensemble
  4. Critic    — devil's advocate risk flags
  5. Outreach  — draft personalized touchpoints
  6. Planner   — upskill set-cover plan
"""

from __future__ import annotations

from typing import Any

from jobsearch.algorithms import ensemble_rank, skill_set, upskill_plan
from jobsearch.catalog import load_jobs


def agent_scout(profile: dict[str, Any]) -> dict[str, Any]:
    """Expand search space: primary skills, adjacent skills, role titles."""
    skills = [str(s) for s in (profile.get("skills") or [])]
    title = str(profile.get("target_title") or profile.get("title") or "Software Engineer")
    summary = str(profile.get("summary") or profile.get("bio") or "")
    tokens = skill_set(summary + " " + title, skills)
    # adjacent expansions (simple taxonomy)
    adjacent_map = {
        "react": ["typescript", "frontend", "javascript"],
        "python": ["fastapi", "django", "data"],
        "ml": ["pytorch", "llm", "ranking"],
        "kubernetes": ["devops", "terraform", "aws"],
        "sap": ["fico", "s4hana", "erp"],
    }
    expanded = set(skills)
    for s in list(tokens):
        for k, v in adjacent_map.items():
            if k in s or s in k:
                expanded.update(v)
    queries = [
        title,
        " ".join(list(expanded)[:6]),
        f"{title} remote",
    ]
    return {
        "agent": "scout",
        "target_title": title,
        "skill_tokens": sorted(tokens)[:40],
        "expanded_skills": sorted(expanded)[:40],
        "queries": queries,
        "notes": "Facet expansion via skill adjacency taxonomy (network-neighborhood proxy).",
    }


def agent_harvester(scout: dict[str, Any], *, use_live: bool) -> dict[str, Any]:
    q = (scout.get("queries") or ["software"])[0]
    jobs = load_jobs(query=q, use_live=use_live)
    return {
        "agent": "harvester",
        "query": q,
        "count": len(jobs),
        "sources": sorted({j.get("source", "?") for j in jobs}),
        "jobs": jobs,
    }


def agent_scorer(profile: dict[str, Any], jobs: list[dict[str, Any]]) -> dict[str, Any]:
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
        "agent": "scorer",
        "algorithms": [
            "BM25 (Robertson)",
            "Cosine TF (Salton VSM)",
            "Jaccard coverage",
            "Bayesian skill posterior",
            "Skill-graph centrality",
            "Spectral 1-hop path",
            "Elo pairwise ranking",
            "Diversity (information gain)",
        ],
        "ranked": ranked,
    }


def agent_critic(ranked: list[dict[str, Any]], profile: dict[str, Any]) -> dict[str, Any]:
    """Devil's advocate: surface overfit, spam risk, seniority mismatch."""
    flags: list[dict[str, Any]] = []
    skills = {s.lower() for s in (profile.get("skills") or [])}
    for job in ranked[:12]:
        jflags: list[str] = []
        score = float(job.get("scores", {}).get("ensemble") or 0)
        gaps = job.get("gap_skills") or []
        if score >= 85 and len(gaps) >= 3:
            jflags.append("High ensemble with many gaps — possible keyword coincidence (check jaccard).")
        if job.get("seniority") == "staff" and "staff" not in " ".join(skills) and "principal" not in " ".join(skills):
            if score > 70:
                jflags.append("Seniority stretch — staff/principal bar may exceed evidence.")
        if job.get("source") == "seed":
            jflags.append("Seed/demo posting — validate against real openings before applying.")
        if not job.get("url"):
            jflags.append("Missing apply URL.")
        if jflags:
            flags.append(
                {
                    "job_id": job.get("id"),
                    "title": job.get("title"),
                    "flags": jflags,
                }
            )
    return {
        "agent": "critic",
        "flagged": flags,
        "summary": f"{len(flags)} roles need careful review before outreach.",
    }


def agent_outreach(ranked: list[dict[str, Any]], profile: dict[str, Any], limit: int = 5) -> dict[str, Any]:
    name = profile.get("name") or "there"
    title = profile.get("target_title") or "engineer"
    drafts = []
    for job in ranked[:limit]:
        company = job.get("company") or "the team"
        role = job.get("title") or "this role"
        hits = job.get("skill_hits") or 0
        drafts.append(
            {
                "job_id": job.get("id"),
                "channel": "linkedin_dm" if job.get("remote") else "email",
                "subject": f"Interest in {role} @ {company}",
                "body": (
                    f"Hi {company} team — I'm {name}, a {title}. "
                    f"Your {role} posting maps strongly to work I've done "
                    f"({hits} overlapping skill signals on our fit model). "
                    f"I'd love 15 minutes to learn what success looks like in the first 90 days "
                    f"and share a concise relevant project. Thanks!"
                ),
                "caveat": "Draft only — never auto-send. Review for truthfulness.",
            }
        )
    return {"agent": "outreach", "drafts": drafts}


def agent_planner(profile: dict[str, Any], ranked: list[dict[str, Any]]) -> dict[str, Any]:
    plan = upskill_plan(list(profile.get("skills") or []), ranked)
    return {"agent": "planner", "upskill": plan}


def run_research_team(
    profile: dict[str, Any],
    *,
    use_live: bool = True,
) -> dict[str, Any]:
    """Full RT pipeline for localhost Job Search AI."""
    scout = agent_scout(profile)
    harvest = agent_harvester(scout, use_live=use_live)
    scorer = agent_scorer(profile, harvest["jobs"])
    ranked = scorer["ranked"]
    critic = agent_critic(ranked, profile)
    outreach = agent_outreach(ranked, profile)
    planner = agent_planner(profile, ranked)

    return {
        "ok": True,
        "localhost_lab": True,
        "agents": {
            "scout": {k: v for k, v in scout.items() if k != "skill_tokens"} | {
                "skill_tokens": scout.get("skill_tokens", [])[:20]
            },
            "harvester": {
                "agent": "harvester",
                "query": harvest["query"],
                "count": harvest["count"],
                "sources": harvest["sources"],
            },
            "scorer": {
                "agent": "scorer",
                "algorithms": scorer["algorithms"],
                "top_n": min(10, len(ranked)),
            },
            "critic": critic,
            "outreach": outreach,
            "planner": planner,
        },
        "ranked_jobs": ranked[:25],
        "meta": {
            "note": "Localhost lab only — not production job board automation.",
            "inspired_by": "MadsLorentzen/ai-job-search workflow patterns (scout→rank→apply), reimplemented as API agents.",
        },
    }
