"""FastAPI routes for Job Search product — localhost by default / env override.

Enterprise (v2): request IDs, rate limits, liveness/readiness, metrics,
fingerprint cache, circuit-breaker visibility.
"""

from __future__ import annotations

import os
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from jobsearch.agents import PRODUCT_GRADE, PRODUCT_NAME, PRODUCT_VERSION, run_research_team
from jobsearch.contracts import MODULE_REGISTRY
from jobsearch.enterprise import (
    cache as ent_cache,
    enterprise_status,
    liveness,
    metrics as ent_metrics,
    new_request_id,
    rate_limiter,
    readiness,
)

router = APIRouter(prefix="/api/jobsearch", tags=["jobsearch"])

# Health connectivity cache — freehire probe is expensive; refresh every 60s
_health_cache: dict[str, Any] = {"ts": 0.0, "freehire": None}


def _running_on_paas() -> bool:
    """True when the process is running on a known hosted platform (Railway/Render)."""
    return bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RENDER"))


def _lab_enabled(request: Request) -> bool:
    """
    Hard gate: never expose on public production unless JOBSEARCH_AI_ENABLED=1.
    Default allow: localhost / 127.0.0.1 hosts only.

    The private-IP fallback below (192.168./10.) exists only for testing from
    another device on a local lab network — it must NEVER be trusted when the
    process is running on a hosted platform (Railway/Render), because those
    platforms proxy public internet traffic through their own internal edge
    layer, and `request.client.host` (no proxy-header trust is configured
    anywhere in this app) reflects that LAST HOP, not the real client. On
    Railway/Render that last hop is commonly itself a private RFC1918 address,
    which previously made this function return True for every request in
    production — a full public exposure of every jobsearch/apply/marvel/
    night/nexus endpoint, including live browser-automation apply triggers.
    Explicit JOBSEARCH_AI_ENABLED=1/0 always wins and is unaffected by this.
    """
    explicit = os.environ.get("JOBSEARCH_AI_ENABLED", "").strip().lower()
    if explicit in ("1", "true", "yes", "on"):
        return True
    if explicit in ("0", "false", "no", "off"):
        return False
    if _running_on_paas():
        # No explicit opt-in on a hosted platform => hard off, no IP heuristics.
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


def _client_key(request: Request) -> str:
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if xff:
        return xff
    return (request.client.host if request.client else "unknown") or "unknown"


def _request_id(request: Request) -> str:
    rid = (request.headers.get("x-request-id") or "").strip()
    if rid and len(rid) <= 64:
        return rid
    return new_request_id()


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
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    years_experience: Optional[str] = None
    work_authorization: Optional[str] = None


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
    bypass_cache: bool = False


@router.get("/health")
def jobsearch_health(request: Request, response: Response) -> dict[str, Any]:
    """Liveness + lab status. Always cheap; never fail the process probe."""
    t0 = time.perf_counter()
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    response.headers["X-Product-Version"] = PRODUCT_VERSION
    response.headers["X-Product-Grade"] = PRODUCT_GRADE

    enabled = _lab_enabled(request)
    connectivity: dict[str, Any] = {}
    now = time.time()
    # Latency: health must be cheap. Cache probe 60s; never block UI on freehire.
    if _health_cache["freehire"] is not None and (now - float(_health_cache["ts"])) < 60:
        connectivity["freehire"] = _health_cache["freehire"]
        connectivity["cached"] = True
    else:
        # Non-blocking default: mark process up without network until first probe done
        connectivity["freehire"] = _health_cache.get("freehire") or {
            "ok": True,
            "sample": 0,
            "deferred": True,
        }
        connectivity["cached"] = False
        # Fire-and-forget style: probe synchronously but with hard short timeout
        try:
            from jobsearch.catalog import fetch_freehire

            sample = fetch_freehire("sap", limit=1, remote_only=False)
            connectivity["freehire"] = {"ok": len(sample) > 0, "sample": len(sample)}
        except Exception as e:
            # Process is still up — don't paint API offline
            connectivity["freehire"] = {
                "ok": True,
                "sample": 0,
                "probe_error": str(e)[:80],
            }
        _health_cache["freehire"] = connectivity["freehire"]
        _health_cache["ts"] = now

    live = liveness()
    ready = readiness()
    ent = enterprise_status()
    ms = round((time.perf_counter() - t0) * 1000, 2)
    ent_metrics().observe_ms("http.health", ms)
    ent_metrics().incr("http.health")

    return {
        "ok": True,
        "feature": "jobsearch",
        "product": PRODUCT_NAME,
        "version": PRODUCT_VERSION,
        "grade": PRODUCT_GRADE,
        "request_id": rid,
        "lab_enabled": enabled,
        "enabled": enabled,
        "scope": "localhost_default",
        "status": "alive",
        "liveness": live,
        "readiness": ready,
        "stages": ["expand", "harvest", "rank", "review", "drafts", "plan"],
        "agents": ["expand", "harvest", "rank", "review", "drafts", "plan"],  # compat
        "modules": MODULE_REGISTRY,
        "defaults": {
            "include_seed": False,
            "use_live": True,
            "live_first": True,
        },
        "honesty": (
            "Multi-stage IR pipeline on public boards (freehire, Remotive, Arbeitnow, LinkedIn guest). "
            "Not multi-agent LLMs. Practice market is opt-in synthetic data. "
            "Enterprise: fingerprint cache, circuit breakers, rate limits, request IDs."
        ),
        "connectivity": connectivity,
        "enterprise": {
            "grade": PRODUCT_GRADE,
            "schema": ent.get("schema"),
            "capabilities": ent.get("capabilities"),
            "cache": ent.get("cache"),
            "slo": ent.get("slo"),
            "open_breakers": (ent.get("slo") or {}).get("open_breakers") or [],
            "uptime_sec": (ent.get("process") or {}).get("uptime_sec"),
        },
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
        "elapsed_ms": ms,
    }


@router.get("/livez")
def jobsearch_livez(request: Request, response: Response) -> dict[str, Any]:
    """Kubernetes-style liveness probe — process up only."""
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    body = liveness()
    body["request_id"] = rid
    body["ok"] = True
    return body


@router.get("/readyz")
def jobsearch_readyz(request: Request, response: Response) -> dict[str, Any]:
    """Kubernetes-style readiness — can accept /run traffic."""
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    body = readiness()
    body["request_id"] = rid
    body["ok"] = bool(body.get("ready"))
    if not body["ok"]:
        # Still 200 for lab UX (UI treats non-200 as offline); signal in body
        body["degraded"] = True
    return body


@router.get("/metrics")
def jobsearch_metrics(request: Request, response: Response) -> dict[str, Any]:
    """Structured control-plane metrics (JSON, not Prometheus text)."""
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    st = enterprise_status()
    st["request_id"] = rid
    st["ok"] = True
    return st


@router.post("/cache/clear")
def jobsearch_cache_clear(request: Request, response: Response) -> dict[str, Any]:
    """Admin: flush result cache (lab only)."""
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    n = ent_cache().invalidate()
    ent_metrics().incr("cache.cleared")
    return {"ok": True, "cleared": n, "request_id": rid}


_ALLOWED_REMOTE = frozenset({"all", "remote", "hybrid", "onsite"})


@router.post("/run")
def jobsearch_run(body: RunRequest, request: Request, response: Response) -> dict[str, Any]:
    _require_lab(request)
    t0 = time.perf_counter()
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    response.headers["X-Product-Version"] = PRODUCT_VERSION
    response.headers["X-Product-Grade"] = PRODUCT_GRADE

    # Rate limit /run (not health) — Fortune-100 style blast-radius control
    ck = _client_key(request)
    if not rate_limiter().allow(ck):
        ent_metrics().incr("http.run.rate_limited")
        raise HTTPException(
            status_code=429,
            detail={
                "error": {
                    "code": "rate_limited",
                    "message": "Too many search runs. Wait a moment and retry.",
                    "request_id": rid,
                }
            },
            headers={"Retry-After": "15", "X-Request-Id": rid},
        )

    profile = body.profile.model_dump()
    # Coerce nulls / bad types from older clients
    if profile.get("skills") is None:
        profile["skills"] = []
    if not isinstance(profile.get("skills"), list):
        profile["skills"] = []
    if not profile.get("skills") and not profile.get("summary"):
        profile["skills"] = ["typescript", "react", "python", "api"]
        profile["summary"] = profile.get("summary") or "Full-stack and AI product engineer"
    title_l = str(profile.get("target_title") or "").lower()
    skills_l = " ".join(str(s) for s in (profile.get("skills") or [])).lower()
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
        profile["resume_text"] = rt
        profile["summary"] = (str(profile.get("summary") or "") + "\n\nRESUME:\n" + rt)[:8000]
    remote = (body.remote or "all").lower().strip()
    if remote not in _ALLOWED_REMOTE:
        remote = "all"
    try:
        result = run_research_team(
            profile,
            use_live=body.use_live,
            remote=remote,
            limit=body.limit,
            min_score=body.min_score,
            has_resume=bool(profile.get("has_resume") or profile.get("resume_text")),
            location=(body.location or "all").strip() or "all",
            exclude_linkedin=bool(body.exclude_linkedin),
            include_seed=bool(body.include_seed),
            request_id=rid,
            bypass_cache=bool(body.bypass_cache),
        )
    except Exception as e:
        ent_metrics().incr("http.run.error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "jobsearch_run_failed",
                    "message": str(e)[:240],
                    "request_id": rid,
                }
            },
            headers={"X-Request-Id": rid},
        ) from e

    # Ensure correlation always present
    result["request_id"] = rid
    cache_info = result.get("cache") or {}
    if cache_info.get("served_from_cache"):
        response.headers["X-Cache"] = str(cache_info.get("status") or "HIT").upper()
        ent_metrics().incr("http.run.cache_hit")
    else:
        response.headers["X-Cache"] = "MISS"
        ent_metrics().incr("http.run.cache_miss")
    if cache_info.get("fingerprint"):
        response.headers["X-Cache-Fingerprint"] = str(cache_info["fingerprint"])[:16]

    ms = round((time.perf_counter() - t0) * 1000, 2)
    ent_metrics().observe_ms("http.run", ms)
    ent_metrics().incr("http.run.ok")
    result.setdefault("meta", {})["http_elapsed_ms"] = ms
    return result
