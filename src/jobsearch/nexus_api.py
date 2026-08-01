"""Astra Apply Nexus API — best-of-breed auto-apply pipeline."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from jobsearch.agents import PRODUCT_GRADE, PRODUCT_NAME, PRODUCT_VERSION, _clean_profile
from jobsearch.api import _client_key, _lab_enabled, _require_lab, _request_id
from jobsearch.apply_api import JobIn, ProfileIn
from jobsearch.enterprise import metrics as ent_metrics
from jobsearch.enterprise import rate_limiter
from jobsearch.nexus_pipeline import (
    NEXUS_CODENAME,
    NEXUS_VERSION,
    build_autofill_profile,
    run_nexus_pipeline,
)

router = APIRouter(prefix="/api/jobsearch/nexus", tags=["jobsearch-nexus"])


class NexusRequest(BaseModel):
    profile: ProfileIn
    jobs: list[JobIn] = Field(default_factory=list)
    min_score: float = Field(default=0.0, ge=0, le=100)
    min_grade: str = "F"
    budget: int = Field(default=12, ge=1, le=25)
    forge: bool = True
    mode: str = "campaign"  # dry_run | campaign
    delay_ms: int = Field(default=2500, ge=800, le=15000)


def _profile(p: ProfileIn) -> dict[str, Any]:
    return _clean_profile(p.model_dump())


def _job(j: JobIn) -> dict[str, Any]:
    d = j.model_dump()
    if not d.get("id"):
        d["id"] = f"job-{(d.get('title') or 'x')[:20]}"
    return d


@router.get("/health")
def nexus_health(request: Request, response: Response) -> dict[str, Any]:
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    return {
        "ok": True,
        "feature": "astra_apply_nexus",
        "product": PRODUCT_NAME,
        "version": PRODUCT_VERSION,
        "nexus_version": NEXUS_VERSION,
        "codename": NEXUS_CODENAME,
        "grade": PRODUCT_GRADE,
        "lab_enabled": _lab_enabled(request),
        "request_id": rid,
        "tagline": "Next-gen auto-apply: 6 stages · quality gate · dry-run · HITL",
        "stages": ["discover", "enrich", "score", "tailor", "cover", "apply"],
        "auto_submit_ats": False,
        "inspired_by": [
            "career-ops",
            "AIHawk",
            "ApplyPilot",
            "Liam-Frost/AutoApply",
            "Simplify",
        ],
    }


@router.post("/run")
def nexus_run(body: NexusRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    response.headers["X-Nexus-Version"] = NEXUS_VERSION
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
                    "message": "Pass ranked_jobs from Search first.",
                    "request_id": rid,
                }
            },
        )
    profile = _profile(body.profile)
    jobs = [_job(j) for j in body.jobs]
    try:
        result = run_nexus_pipeline(
            profile,
            jobs,
            min_score=body.min_score,
            min_grade=body.min_grade,
            budget=body.budget,
            has_resume=bool(profile.get("has_resume") or profile.get("resume_text")),
            forge=body.forge,
            mode=body.mode,
            delay_ms=body.delay_ms,
        )
    except Exception as e:
        ent_metrics().incr("nexus.error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "nexus_failed",
                    "message": str(e)[:240],
                    "request_id": rid,
                }
            },
        ) from e
    result["request_id"] = rid
    return result


@router.post("/autofill")
def nexus_autofill(
    body: ProfileIn, request: Request, response: Response
) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    profile = _profile(body)
    return {
        "ok": True,
        "request_id": rid,
        "autofill_profile": build_autofill_profile(profile),
    }
