"""
Tailor RT — multi-agent resume tailoring with a validate→retry loop.

Synthesis of open-source patterns (deterministic, no paid LLM required):
  GARY ........ Analyze → Tailor → Validate
  ApplyPilot .. never fabricate; reorganize facts only
  Tailr ....... ground edits in resume evidence
  career-ops .. weighted requirements
  resume_forge  multi-objective ATS / authenticity scores

Agents: jd_analyst → evidence → tailor → validator → (retry)
"""

from __future__ import annotations

import re
import time
from typing import Any

from jobsearch.algorithms import skill_set, tokenize
from jobsearch.apply_engine import build_cover_note
from jobsearch.apply_math import (
    ats_keyword_coverage,
    extract_jd_keywords,
    star_bullet_from_skills,
)
from jobsearch.autofill import (
    looks_like_binary_garbage,
    parse_person_name,
    sanitize_resume_text,
)
from jobsearch.resume_forge import FORGE_VERSION, forge_resume_for_job

TAILOR_RT_VERSION = "1.1.0"
TAILOR_RT_SCHEMA = "astra.tailor_rt.v1"

_FABRICATION = re.compile(
    r"\b("
    r"phd|nobel|ex-google|ex-meta|ex-amazon|ex-apple|"
    r"10\+\s*years at|15\s*years at|founded\s+google|"
    r"i\s+invented|sole\s+inventor\s+of\s+python"
    r")\b",
    re.I,
)

_SENIORITY_RE = re.compile(
    r"\b(intern|junior|jr\.?|mid[- ]?level|senior|sr\.?|staff|principal|lead|manager|director|vp)\b",
    re.I,
)

# Tokens that are never useful as "skills" / must-haves (noise from JD tokenizers)
_NOISE = frozenset(
    {
        "role",
        "team",
        "work",
        "job",
        "position",
        "company",
        "experience",
        "years",
        "required",
        "preferred",
        "looking",
        "seeking",
        "strong",
        "ability",
        "skills",
        "knowledge",
        "plus",
        "etc",
        "including",
        "using",
        "with",
        "and",
        "the",
        "our",
        "your",
        "remote",
        "hybrid",
        "onsite",
        "full",
        "time",
        "contract",
        "consultant",  # title fluff often; keep real tech via listed skills
        "engineer",
        "developer",
        "manager",
        "senior",
        "junior",
        "staff",
        "principal",
        "lead",
    }
)


def _job_text(job: dict[str, Any], *, limit: int = 4000) -> str:
    return " ".join(
        [
            str(job.get("title") or ""),
            str(job.get("company") or ""),
            " ".join(str(s) for s in (job.get("skills") or [])),
            str(job.get("text") or "")[:limit],
        ]
    ).strip()


def _norm_token(token: str) -> str:
    return re.sub(r"[^a-z0-9+.#/\-]+", "", (token or "").strip().lower())


def _company_tokens(company: str) -> set[str]:
    """Tokenize employer name so 'Acme Corp' never becomes a must-have skill."""
    out: set[str] = set()
    for part in re.split(r"[\s,./&\-]+", (company or "").lower()):
        p = _norm_token(part)
        if len(p) >= 2:
            out.add(p)
    full = _norm_token(company)
    if len(full) >= 2:
        out.add(full)
    # common legal suffixes
    out |= {"inc", "llc", "ltd", "corp", "corporation", "company", "co", "gmbh", "plc"}
    return out


def _is_skillish(token: str, *, company: str = "") -> bool:
    t = _norm_token(token)
    if len(t) < 2 or t in _NOISE:
        return False
    if t in _company_tokens(company):
        return False
    if t.isdigit():
        return False
    return bool(re.match(r"^[a-z][a-z0-9+.#/\-]*$", t))


def _base_resume(profile: dict[str, Any]) -> str:
    raw = sanitize_resume_text(profile.get("resume_text"))
    if raw:
        return raw
    summary = str(profile.get("summary") or "").strip()
    if summary and not looks_like_binary_garbage(summary):
        return summary
    return ""


def _grade(overall_0_1: float) -> str:
    if overall_0_1 >= 0.85:
        return "A"
    if overall_0_1 >= 0.72:
        return "B"
    if overall_0_1 >= 0.62:
        return "C"
    if overall_0_1 >= 0.45:
        return "D"
    return "F"


# ── Agent 1: JD Analyst ──────────────────────────────────────────────────────


def agent_jd_analyst(job: dict[str, Any]) -> dict[str, Any]:
    title = str(job.get("title") or "Role").strip()
    company = str(job.get("company") or "Company").strip()
    jd = _job_text(job)
    raw_skills = sorted(skill_set(jd, job.get("skills") or []))
    # normalize + de-noise; keep first canonical form
    skills = []
    seen: set[str] = set()
    for s in raw_skills:
        if not _is_skillish(s, company=company):
            continue
        n = _norm_token(s)
        if n in seen:
            continue
        seen.add(n)
        skills.append(n)

    keywords = []
    for k in extract_jd_keywords(jd, 28):
        if not _is_skillish(k, company=company):
            continue
        n = _norm_token(k)
        if n not in keywords:
            keywords.append(n)

    listed = {
        _norm_token(str(s))
        for s in (job.get("skills") or [])
        if str(s).strip() and _is_skillish(str(s), company=company)
    }
    title_toks = {
        _norm_token(t)
        for t in tokenize(title)
        if _is_skillish(t, company=company)
    }

    must: list[str] = []
    nice: list[str] = []
    for s in skills:
        if s in listed or s in title_toks or s in keywords[:10]:
            must.append(s)
        else:
            nice.append(s)
    if not must and keywords:
        must = keywords[:8]
        nice = keywords[8:20]

    must_set = set(must)
    m = _SENIORITY_RE.search(f"{title} {jd[:500]}")
    seniority = m.group(1).lower() if m else "mid"

    weighted = []
    for i, k in enumerate(keywords[:20]):
        weight = 1.0 - (i * 0.03)
        if k.lower() in must_set:
            weight = min(1.0, weight + 0.15)
        weighted.append(
            {"skill": k, "weight": round(weight, 3), "must": k.lower() in must_set}
        )

    return {
        "agent": "jd_analyst",
        "job_title": title,
        "company": company,
        "seniority": seniority,
        "must_have": must[:16],
        "nice_to_have": nice[:20],
        "keywords": keywords,
        "weighted_requirements": weighted,
        "jd_excerpt": jd[:600],
        "jd_skill_n": len(skills),
    }


# ── Agent 2: Evidence ────────────────────────────────────────────────────────


def _resume_chunks(text: str, max_chunks: int = 40) -> list[str]:
    parts = re.split(r"\n{2,}|(?<=\.)\s+(?=[A-Z•\-\*])", text or "")
    out: list[str] = []
    for p in parts:
        p = p.strip()
        if len(p) < 20:
            continue
        out.append(p[:500])
        if len(out) >= max_chunks:
            break
    return out


def _evidence_for(
    reqs: list[str],
    known: set[str],
    chunks: list[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    supported: list[dict[str, Any]] = []
    unsupported: list[str] = []
    for req in reqs:
        rl = str(req).lower()
        hit = next((c for c in chunks if rl in c.lower()), "")
        if rl in known or hit:
            supported.append(
                {
                    "requirement": req,
                    "source": "resume" if hit else "skills",
                    "evidence": (hit or req)[:200],
                }
            )
        else:
            unsupported.append(req)
    return supported, unsupported


def agent_evidence(profile: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    base = _base_resume(profile)
    skills = [str(s).strip() for s in (profile.get("skills") or []) if str(s).strip()]
    known = set(skill_set(base, skills) or [])
    chunks = _resume_chunks(base)

    must = analysis.get("must_have") or []
    nice = analysis.get("nice_to_have") or []
    supported_must, unsupported = _evidence_for(must, known, chunks)
    supported_nice, _ = _evidence_for(nice, known, chunks)
    supported = (supported_must + supported_nice)[:30]

    allowed_inject = sorted(
        {
            s
            for s in known | {x.lower() for x in skills}
            if _is_skillish(s)
        }
    )[:40]

    return {
        "agent": "evidence",
        "resume_chars": len(base),
        "chunk_n": len(chunks),
        "supported": supported,
        "unsupported_must": unsupported[:16],
        "allowed_inject": allowed_inject,
        "coverage_of_must": round(
            len(supported_must) / max(len(must) or 1, 1),
            4,
        ),
        "honesty": "Only requirements with resume/skill evidence are eligible for emphasis.",
    }


# ── Agent 3: Tailor ──────────────────────────────────────────────────────────


def agent_tailor(
    profile: dict[str, Any],
    job: dict[str, Any],
    analysis: dict[str, Any],
    evidence: dict[str, Any],
    *,
    inject_budget: int = 8,
    round_n: int = 1,
) -> dict[str, Any]:
    """Produce ATS-clean tailored resume grounded in evidence (meta stays out of body)."""
    allowed = set(evidence.get("allowed_inject") or [])
    must = [m for m in (analysis.get("must_have") or []) if m.lower() in allowed]
    boost_skills = list(
        dict.fromkeys(
            [str(s) for s in (profile.get("skills") or [])]
            + must
            + [s["requirement"] for s in (evidence.get("supported") or [])[:12]]
        )
    )
    p2 = {
        **profile,
        "skills": boost_skills[:40],
        "resume_text": _base_resume(profile),
    }
    # Prefer real person name on forged header
    _, _, full = parse_person_name(profile)
    if full and full != "Candidate":
        p2["name"] = full

    budget = max(2, inject_budget - (round_n - 1) * 2)
    forge = forge_resume_for_job(p2, job, inject_budget=budget)

    base_l = (p2.get("resume_text") or "").lower()
    clean_injects = [
        inj
        for inj in (forge.get("injects") or [])
        if str(inj).lower() in allowed or str(inj).lower() in base_l
    ][:budget]
    forge["injects"] = clean_injects

    # ATS body only — reports live in separate fields
    forged = str(forge.get("forged_resume") or "").strip()
    supported_skills = [s["requirement"] for s in (evidence.get("supported") or [])[:8]]
    gaps = list(evidence.get("unsupported_must") or [])[:12]

    return {
        "agent": "tailor",
        "round": round_n,
        "inject_budget": budget,
        "injects": clean_injects,
        "supported_skills": supported_skills,
        "gaps_flagged": gaps,
        "forged_resume": forged,
        "forge": forge,
        "scalar_score": forge.get("scalar_score"),
        "forge_version": forge.get("version") or FORGE_VERSION,
    }


# ── Agent 4: Validator ───────────────────────────────────────────────────────


def agent_validator(
    profile: dict[str, Any],
    job: dict[str, Any],
    analysis: dict[str, Any],
    evidence: dict[str, Any],
    tailored: dict[str, Any],
    *,
    min_ats: float = 0.35,
    min_auth: float = 0.55,
    min_overall: float = 0.62,
) -> dict[str, Any]:
    text = str(tailored.get("forged_resume") or "")
    base = _base_resume(profile)
    jd = analysis.get("jd_excerpt") or _job_text(job, limit=2000)
    skills = [str(s) for s in (profile.get("skills") or [])]

    ats = ats_keyword_coverage(text, jd, skills)
    kws = analysis.get("keywords") or []
    text_l = text.lower()
    integrated = [k for k in kws if str(k).lower() in text_l]
    kw_rate = len(integrated) / max(len(kws), 1)

    allowed = set(evidence.get("allowed_inject") or [])
    injects = [str(i) for i in (tailored.get("injects") or [])]
    rogue = [
        i
        for i in injects
        if i.lower() not in allowed and i.lower() not in base.lower()
    ]
    auth = 1.0
    if rogue:
        auth -= 0.15 * len(rogue)
    if base and len(text) > len(base) + 2500:
        auth -= 0.2
    if _FABRICATION.search(text):
        auth = 0.0
    auth = max(0.0, min(1.0, auth))

    email = str(profile.get("email") or "").strip()
    phone = str(profile.get("phone") or "").strip()
    _, _, full = parse_person_name(profile)
    contact_ok = bool(email) and bool(full) and "@" not in full and full != "Candidate"

    words = tokenize(text)
    sents = max(1, text.count(".") + text.count("!") + text.count("?"))
    avg = len(words) / sents
    readability = 1.0 if 10 <= avg <= 28 else (0.65 if avg < 40 else 0.4)
    must_cov = float(evidence.get("coverage_of_must") or 0.0)

    overall = (
        0.30 * float(ats.get("coverage") or 0)
        + 0.20 * kw_rate
        + 0.20 * auth
        + 0.15 * readability
        + 0.15 * must_cov
    )

    strengths: list[str] = []
    weaknesses: list[str] = []
    suggestions: list[str] = []

    cov = float(ats.get("coverage") or 0)
    if cov >= min_ats:
        strengths.append(f"ATS coverage {cov:.0%} ≥ target {min_ats:.0%}")
    else:
        weaknesses.append(f"ATS coverage {cov:.0%} below {min_ats:.0%}")
        miss = ats.get("missing") or []
        if miss:
            suggestions.append(
                f"Add honest evidence for: {', '.join(miss[:6])} (only if true)"
            )

    if kw_rate >= 0.45:
        strengths.append(f"Keyword integration {kw_rate:.0%}")
    else:
        weaknesses.append(f"Keyword integration only {kw_rate:.0%}")
        suggestions.append("Move supported skills toward the top of the resume")

    if auth >= min_auth:
        strengths.append("Authenticity constraints held")
    else:
        weaknesses.append("Authenticity risk")
        if rogue:
            suggestions.append(f"Remove ungrounded terms: {', '.join(rogue[:5])}")

    if _FABRICATION.search(text):
        weaknesses.append("Fabrication pattern detected — hard fail")
        suggestions.append("Remove exaggerated claims you cannot support")

    if not contact_ok:
        weaknesses.append("Contact incomplete (email or real name missing)")
        suggestions.append("Set email and full name before apply")
    else:
        strengths.append("Contact ready for ATS fill")

    if not phone:
        suggestions.append("Add phone for higher form-complete rate")

    gaps = evidence.get("unsupported_must") or []
    if gaps:
        suggestions.append("Honest gaps (do not invent): " + ", ".join(gaps[:6]))

    passed = (
        overall >= min_overall
        and cov >= min_ats * 0.85
        and auth >= min_auth
        and not _FABRICATION.search(text)
        and contact_ok
    )

    return {
        "agent": "validator",
        "passed": passed,
        "ready_for_apply": passed,
        "grade": _grade(overall),
        "overall_score": round(100 * overall, 1),
        "scores": {
            "ats_coverage": round(cov * 100, 1),
            "keyword_integration": round(kw_rate * 100, 1),
            "authenticity": round(auth * 100, 1),
            "readability": round(readability * 100, 1),
            "must_have_evidence": round(must_cov * 100, 1),
        },
        "ats": ats,
        "keywords_integrated": integrated[:20],
        "keywords_missing": [k for k in kws if k not in integrated][:12],
        "rogue_injects": rogue,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "suggestions": suggestions,
        "contact": {
            "email": bool(email),
            "phone": bool(phone),
            "name_ok": contact_ok,
            "full_name": full,
        },
    }


# ── Orchestrator ─────────────────────────────────────────────────────────────


def run_tailor_rt(
    profile: dict[str, Any],
    job: dict[str, Any],
    *,
    max_rounds: int = 3,
    inject_budget: int = 8,
    min_ats: float = 0.35,
    min_auth: float = 0.55,
    min_overall: float = 0.62,
) -> dict[str, Any]:
    """Analyze → evidence → tailor → validate, retry with tighter budget until pass."""
    t0 = time.perf_counter()
    profile = dict(profile or {})
    job = dict(job or {})
    profile["resume_text"] = _base_resume(profile)

    analysis = agent_jd_analyst(job)
    evidence = agent_evidence(profile, analysis)

    rounds: list[dict[str, Any]] = []
    best: dict[str, Any] | None = None
    best_score = -1.0
    budget = inject_budget

    for r in range(1, max(1, min(max_rounds, 5)) + 1):
        tailored = agent_tailor(
            profile, job, analysis, evidence, inject_budget=budget, round_n=r
        )
        validation = agent_validator(
            profile,
            job,
            analysis,
            evidence,
            tailored,
            min_ats=min_ats,
            min_auth=min_auth,
            min_overall=min_overall,
        )
        rounds.append(
            {
                "round": r,
                "overall_score": validation.get("overall_score"),
                "passed": validation.get("passed"),
                "grade": validation.get("grade"),
            }
        )
        score = float(validation.get("overall_score") or 0)
        if score > best_score:
            best_score = score
            best = {"tailored": tailored, "validation": validation}
        if validation.get("passed"):
            break
        budget = max(2, budget - 2)

    assert best is not None
    tailored = best["tailored"]
    validation = best["validation"]

    return {
        "ok": True,
        "schema": TAILOR_RT_SCHEMA,
        "version": TAILOR_RT_VERSION,
        "job": {
            "id": job.get("id"),
            "title": analysis.get("job_title"),
            "company": analysis.get("company"),
        },
        "agents": {
            "jd_analyst": {
                "must_have": analysis.get("must_have"),
                "nice_to_have": analysis.get("nice_to_have"),
                "keywords": analysis.get("keywords"),
                "seniority": analysis.get("seniority"),
            },
            "evidence": {
                "supported": evidence.get("supported"),
                "unsupported_must": evidence.get("unsupported_must"),
                "coverage_of_must": evidence.get("coverage_of_must"),
            },
            "tailor": {
                "round": tailored.get("round"),
                "injects": tailored.get("injects"),
                "supported_skills": tailored.get("supported_skills"),
                "gaps_flagged": tailored.get("gaps_flagged"),
                "scalar_score": tailored.get("scalar_score"),
            },
            "validator": validation,
        },
        "rounds": rounds,
        "passed": bool(validation.get("passed")),
        "ready_for_apply": bool(validation.get("ready_for_apply")),
        "grade": validation.get("grade"),
        "overall_score": validation.get("overall_score"),
        "forged_resume": tailored.get("forged_resume"),
        "injects": tailored.get("injects") or [],
        "suggestions": validation.get("suggestions") or [],
        "strengths": validation.get("strengths") or [],
        "weaknesses": validation.get("weaknesses") or [],
        "ats_after": validation.get("ats"),
        "forge": {
            "ats_before": (tailored.get("forge") or {}).get("ats_before"),
            "ats_after": (tailored.get("forge") or {}).get("ats_after"),
            "objectives": (tailored.get("forge") or {}).get("objectives"),
            "scalar_score": tailored.get("scalar_score"),
            "version": tailored.get("forge_version"),
        },
        "honesty": (
            "Never invents employers, degrees, or years. "
            "Unsupported must-haves are honest gaps. You own every claim."
        ),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def _cover_and_stars(
    profile: dict[str, Any],
    job: dict[str, Any],
    injects: list[str] | None,
    ats: dict[str, Any] | None = None,
) -> tuple[str, list[str]]:
    """
    Shared cover note + STAR bullets aligned with inject keywords.
    Used by tailor_materials so form_pack / nexus / one-click share one path
    (same build_cover_note as resolve_cover_and_injects).
    """
    inj = [str(i).strip() for i in (injects or []) if str(i).strip()]
    ats_d = ats if isinstance(ats, dict) else {}
    cover = build_cover_note(profile, job, ats=ats_d, injects=inj)
    skill_tokens: list[str] = []
    seen: set[str] = set()
    for token in list(profile.get("skills") or []) + inj:
        t = str(token or "").strip()
        if not t:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        skill_tokens.append(t)
    stars = star_bullet_from_skills(
        skill_tokens,
        str(job.get("title") or ""),
        str(job.get("company") or ""),
    )
    return cover, stars


def tailor_materials(
    profile: dict[str, Any],
    job: dict[str, Any],
    *,
    max_rounds: int = 2,
    inject_budget: int = 8,
    use_rt: bool = True,
) -> dict[str, Any]:
    """
    Single entry for form_pack / auto_apply / one-click.
    Prefer Tailor RT; fall back to bare resume_forge.
    Always includes cover_note + star_bullets aligned with injects (one cover path).
    """
    if use_rt:
        try:
            rt = run_tailor_rt(
                profile,
                job,
                max_rounds=max_rounds,
                inject_budget=inject_budget,
            )
            injects = list(rt.get("injects") or [])
            ats_after = rt.get("ats_after") if isinstance(rt.get("ats_after"), dict) else {}
            cover, stars = _cover_and_stars(profile, job, injects, ats_after)
            return {
                "ok": True,
                "source": "tailor_rt",
                "forged_resume": rt.get("forged_resume") or "",
                "injects": injects,
                "cover_note": cover,
                "star_bullets": stars,
                "scalar_score": rt.get("overall_score"),
                "ats_after": rt.get("ats_after"),
                "ats_before": (rt.get("forge") or {}).get("ats_before"),
                "objectives": (rt.get("forge") or {}).get("objectives"),
                "passed": rt.get("passed"),
                "grade": rt.get("grade"),
                "suggestions": rt.get("suggestions") or [],
                "version": rt.get("version") or TAILOR_RT_VERSION,
                "tailor_rt": rt,
            }
        except Exception as e:
            err = str(e)[:120]
    else:
        err = None

    try:
        forge = forge_resume_for_job(profile, job, inject_budget=inject_budget)
        injects = list(forge.get("injects") or [])
        ats_after = forge.get("ats_after") if isinstance(forge.get("ats_after"), dict) else {}
        cover, stars = _cover_and_stars(profile, job, injects, ats_after)
        return {
            "ok": True,
            "source": "resume_forge",
            "forged_resume": forge.get("forged_resume") or "",
            "injects": injects,
            "cover_note": cover,
            "star_bullets": stars,
            "scalar_score": forge.get("scalar_score"),
            "ats_after": forge.get("ats_after"),
            "ats_before": forge.get("ats_before"),
            "objectives": forge.get("objectives"),
            "passed": None,
            "grade": None,
            "suggestions": [],
            "version": forge.get("version") or FORGE_VERSION,
            "fallback_error": err,
            "tailor_rt": None,
        }
    except Exception as e2:
        return {
            "ok": False,
            "source": "error",
            "forged_resume": "",
            "injects": [],
            "cover_note": "",
            "star_bullets": [],
            "error": str(e2)[:160],
            "fallback_error": err,
            "tailor_rt": None,
        }


def tailor_rt_batch(
    profile: dict[str, Any],
    jobs: list[dict[str, Any]],
    *,
    limit: int = 5,
    max_rounds: int = 2,
    inject_budget: int = 8,
) -> dict[str, Any]:
    from jobsearch.job_model import is_synthetic_job

    t0 = time.perf_counter()
    results = []
    for j in jobs:
        if is_synthetic_job(j):
            continue
        results.append(
            run_tailor_rt(
                profile, j, max_rounds=max_rounds, inject_budget=inject_budget
            )
        )
        if len(results) >= max(1, min(limit, 12)):
            break
    results.sort(key=lambda r: float(r.get("overall_score") or 0), reverse=True)
    return {
        "ok": True,
        "version": TAILOR_RT_VERSION,
        "count": len(results),
        "passed_n": sum(1 for r in results if r.get("passed")),
        "results": results,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }
