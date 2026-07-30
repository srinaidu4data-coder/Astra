"""FastAPI routes for Job Search AI — **localhost / explicit env only**."""

from __future__ import annotations

import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from jobsearch.agents import run_research_team

router = APIRouter(prefix="/api/jobsearch", tags=["jobsearch-lab"])


def _lab_enabled(request: Request) -> bool:
    """
    Hard gate: never expose on public production unless JOBSEARCH_AI_ENABLED=1.
    Default allow: localhost / 127.0.0.1 hosts only.
    """
    if os.environ.get("JOBSEARCH_AI_ENABLED", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    ):
        return True
    if os.environ.get("JOBSEARCH_AI_ENABLED", "").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    ):
        return False
    # Auto: only loopback clients
    client = request.client.host if request.client else ""
    host = (request.headers.get("host") or "").split(":")[0].lower()
    if client in ("127.0.0.1", "::1", "localhost") or host in (
        "127.0.0.1",
        "localhost",
    ):
        return True
    return False


def _require_lab(request: Request) -> None:
    if not _lab_enabled(request):
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "jobsearch_lab_disabled",
                    "message": (
                        "Job Search AI is a localhost lab feature. "
                        "Run API on localhost or set JOBSEARCH_AI_ENABLED=1."
                    ),
                }
            },
        )


class ProfileIn(BaseModel):
    name: Optional[str] = None
    target_title: Optional[str] = "Software Engineer"
    summary: Optional[str] = ""
    skills: list[str] = Field(default_factory=list)
    experience: list[str] = Field(default_factory=list)
    location: Optional[str] = None
    remote_ok: bool = True


class RunRequest(BaseModel):
    profile: ProfileIn
    use_live: bool = True


@router.get("/health")
def jobsearch_health(request: Request) -> dict[str, Any]:
    enabled = _lab_enabled(request)
    return {
        "ok": True,
        "feature": "jobsearch_ai",
        "lab_enabled": enabled,
        "scope": "localhost_lab",
        "agents": ["scout", "harvester", "scorer", "critic", "outreach", "planner"],
    }


@router.post("/run")
def jobsearch_run(body: RunRequest, request: Request) -> dict[str, Any]:
    _require_lab(request)
    profile = body.profile.model_dump()
    if not profile.get("skills") and not profile.get("summary"):
        # sensible default for empty form — still rankable
        profile["skills"] = ["typescript", "react", "python", "api"]
        profile["summary"] = profile.get("summary") or "Full-stack and AI product engineer"
    result = run_research_team(profile, use_live=body.use_live)
    return result
