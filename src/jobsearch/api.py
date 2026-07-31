"""FastAPI routes for Job Search product — localhost by default / env override."""

from __future__ import annotations

import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from jobsearch.agents import PRODUCT_NAME, PRODUCT_VERSION, run_research_team

router = APIRouter(prefix="/api/jobsearch", tags=["jobsearch"])


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
    client = (request.client.host if request.client else "") or ""
    host = (request.headers.get("host") or "").split(":")[0].lower()
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    loopback = {
        "127.0.0.1",
        "::1",
        "localhost",
        "0.0.0.0",
        "testclient",
    }
    if client in loopback or host in loopback or xff in loopback:
        return True
    if client.startswith("192.168.") or client.startswith("10."):
        return True
    return False


def _require_lab(request: Request) -> None:
    if not _lab_enabled(request):
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "jobsearch_disabled",
                    "message": (
                        f"{PRODUCT_NAME} is available on localhost by default. "
                        "Set JOBSEARCH_AI_ENABLED=1 to expose elsewhere."
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
    resume_text: Optional[str] = None
    has_resume: bool = False


class RunRequest(BaseModel):
    profile: ProfileIn
    use_live: bool = True
    remote: str = "all"
    location: str = "all"
    exclude_linkedin: bool = False
    # Product default: live only — synthetic practice market is opt-in
    include_seed: bool = False
    limit: int = Field(default=200, ge=20, le=500)
    min_score: float = Field(default=0.0, ge=0.0, le=100.0)


@router.get("/health")
def jobsearch_health(request: Request) -> dict[str, Any]:
    enabled = _lab_enabled(request)
    connectivity: dict[str, Any] = {}
    try:
        from jobsearch.catalog import fetch_freehire

        sample = fetch_freehire("sap fico", limit=3, remote_only=False)
        connectivity["freehire"] = {"ok": len(sample) > 0, "sample": len(sample)}
    except Exception as e:
        connectivity["freehire"] = {"ok": False, "error": str(e)[:120]}
    return {
        "ok": True,
        "feature": "jobsearch",
        "product": PRODUCT_NAME,
        "version": PRODUCT_VERSION,
        "lab_enabled": enabled,
        "enabled": enabled,
        "scope": "localhost_default",
        "stages": ["expand", "harvest", "rank", "review", "drafts", "plan"],
        "agents": ["expand", "harvest", "rank", "review", "drafts", "plan"],  # compat
        "defaults": {
            "include_seed": False,
            "use_live": True,
            "live_first": True,
        },
        "honesty": (
            "Multi-stage IR pipeline on public boards (freehire, Remotive, Arbeitnow). "
            "Not multi-agent LLMs. Practice market is opt-in synthetic data."
        ),
        "connectivity": connectivity,
        "filters": [
            "remote",
            "hybrid",
            "onsite",
            "all",
            "location",
            "us",
            "exclude_linkedin",
            "include_seed",
            "min_score",
            "limit",
        ],
    }


@router.post("/run")
def jobsearch_run(body: RunRequest, request: Request) -> dict[str, Any]:
    _require_lab(request)
    profile = body.profile.model_dump()
    if not profile.get("skills") and not profile.get("summary"):
        profile["skills"] = ["typescript", "react", "python", "api"]
        profile["summary"] = profile.get("summary") or "Full-stack and AI product engineer"
    title_l = (profile.get("target_title") or "").lower()
    skills_l = " ".join(profile.get("skills") or []).lower()
    if any(k in title_l for k in ("sap", "fico", "s/4", "s4hana")) and "sap" not in skills_l:
        profile["skills"] = list(profile.get("skills") or []) + [
            "sap",
            "fico",
            "s4hana",
            "tax",
            "controlling",
        ]
    if profile.get("resume_text"):
        rt = str(profile["resume_text"])[:6000]
        profile["summary"] = (profile.get("summary") or "") + "\n\nRESUME:\n" + rt
    result = run_research_team(
        profile,
        use_live=body.use_live,
        remote=(body.remote or "all").lower(),
        limit=body.limit,
        min_score=body.min_score,
        has_resume=bool(profile.get("has_resume") or profile.get("resume_text")),
        location=(body.location or "all").strip() or "all",
        exclude_linkedin=bool(body.exclude_linkedin),
        include_seed=bool(body.include_seed),
    )
    return result
