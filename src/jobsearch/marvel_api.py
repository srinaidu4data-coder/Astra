"""Marvel Apply API — SOTA match + Resume Forge + HITL apply."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from jobsearch.agents import PRODUCT_GRADE, PRODUCT_NAME, PRODUCT_VERSION, _clean_profile
from jobsearch.api import _client_key, _lab_enabled, _require_lab, _request_id
from jobsearch.apply_api import JobIn, ProfileIn
from jobsearch.enterprise import metrics as ent_metrics
from jobsearch.enterprise import rate_limiter
from jobsearch.job_model import is_synthetic_job
from jobsearch.marvel_pipeline import MARVEL_CODENAME, MARVEL_VERSION, run_marvel_apply
from jobsearch.resume_forge import FORGE_VERSION, forge_resume_for_job, forge_variants
from jobsearch.sota_engines import multi_engine_score_jobs

router = APIRouter(prefix="/api/jobsearch/marvel", tags=["jobsearch-marvel"])


class MarvelRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)
    budget: int = Field(default=8, ge=1, le=25)
    forge_top: int = Field(default=5, ge=1, le=12)
    inject_budget: int = Field(default=8, ge=0, le=16)
    outcomes: Optional[list[dict[str, Any]]] = None


class ForgeOneRequest(BaseModel):
    profile: ProfileIn
    job: JobIn
    inject_budget: int = Field(default=8, ge=0, le=16)


class ScoreRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)


def _profile(p: ProfileIn) -> dict[str, Any]:
    return _clean_profile(p.model_dump())


def _job(j: JobIn) -> dict[str, Any]:
    d = j.model_dump()
    if not d.get("id"):
        d["id"] = f"job-{(d.get('title') or 'x')[:20]}"
    return d


@router.get("/health")
def marvel_health(request: Request, response: Response) -> dict[str, Any]:
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    return {
        "ok": True,
        "feature": "marvel_apply",
        "product": PRODUCT_NAME,
        "version": PRODUCT_VERSION,
        "marvel_version": MARVEL_VERSION,
        "codename": MARVEL_CODENAME,
        "forge_version": FORGE_VERSION,
        "grade": PRODUCT_GRADE,
        "mode": "human_in_the_loop",
        "auto_submit": False,
        "lab_enabled": _lab_enabled(request),
        "request_id": rid,
        "tagline": (
            "State-of-the-art multi-engine match + Resume Forge + human apply. "
            "Mankind should not fear the application process — only skip preparation."
        ),
        "engines_count": 19,
    }


@router.post("/run")
def marvel_run(body: MarvelRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    response.headers["X-Marvel-Version"] = MARVEL_VERSION
    if not rate_limiter().allow(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "rate_limited", "request_id": rid}},
        )
    if not body.jobs:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "jobs_required",
                    "message": "Pass ranked_jobs from search first.",
                    "request_id": rid,
                }
            },
        )
    profile = _profile(body.profile)
    jobs = [_job(j) for j in body.jobs]
    try:
        result = run_marvel_apply(
            profile,
            jobs,
            budget=body.budget,
            has_resume=bool(profile.get("has_resume") or profile.get("resume_text")),
            forge_top=body.forge_top,
            inject_budget=body.inject_budget,
            outcomes=body.outcomes,
        )
    except Exception as e:
        ent_metrics().incr("marvel.error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "marvel_failed",
                    "message": str(e)[:240],
                    "request_id": rid,
                }
            },
        ) from e
    result["request_id"] = rid
    return result


@router.post("/score")
def marvel_score(body: ScoreRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    profile = _profile(body.profile)
    jobs = [_job(j) for j in body.jobs]
    scored = multi_engine_score_jobs(profile, jobs)
    return {
        "ok": True,
        "request_id": rid,
        "version": MARVEL_VERSION,
        "count": len(scored),
        "ranked_jobs": scored,
    }


@router.post("/forge")
def marvel_forge(body: ForgeOneRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    profile = _profile(body.profile)
    job = _job(body.job)
    if is_synthetic_job(job):
        return {
            "ok": False,
            "request_id": rid,
            "error": "practice_blocked",
            "message": "Resume Forge does not tailor for synthetic practice listings.",
        }
    forged = forge_resume_for_job(profile, job, inject_budget=body.inject_budget)
    return {"ok": True, "request_id": rid, "forge": forged}


@router.post("/forge/batch")
def marvel_forge_batch(body: MarvelRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    profile = _profile(body.profile)
    jobs = [_job(j) for j in body.jobs]
    result = forge_variants(
        profile, jobs, limit=body.forge_top, inject_budget=body.inject_budget
    )
    result["request_id"] = rid
    return result
