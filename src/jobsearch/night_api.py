"""Night Scout API — schedules, workers, morning digests (multi-tenant ready)."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from jobsearch.agents import PRODUCT_GRADE, PRODUCT_NAME, PRODUCT_VERSION
from jobsearch.api import _lab_enabled, _require_lab, _request_id
from jobsearch import night_store as store
from jobsearch.night_worker import run_schedule_inline

router = APIRouter(prefix="/api/jobsearch/night", tags=["jobsearch-night"])

NIGHT_VERSION = "1.0.0"


def _tenant(x_tenant_id: str | None, request: Request) -> str:
    # Lab default; production would derive from auth session
    tid = (x_tenant_id or request.headers.get("x-tenant-id") or "local-default").strip()
    return store.ensure_tenant(tid or "local-default")


class ScheduleIn(BaseModel):
    id: Optional[str] = None
    name: str = "Night Scout"
    enabled: bool = True
    target_title: str = "Software Engineer"
    skills: list[str] = Field(default_factory=list)
    resume_text: Optional[str] = ""
    location: str = "us"
    remote: str = "all"
    exclude_linkedin: bool = False
    include_seed: bool = False
    limit_jobs: int = Field(default=100, ge=20, le=500)
    run_hour_local: int = Field(default=2, ge=0, le=23)
    wake_hour_local: int = Field(default=7, ge=0, le=23)
    timezone: str = "local"
    build_apply_plan: bool = True


@router.get("/health")
def night_health(request: Request, response: Response) -> dict[str, Any]:
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    st = store.stats()
    return {
        "ok": True,
        "feature": "night_scout",
        "product": PRODUCT_NAME,
        "version": PRODUCT_VERSION,
        "night_version": NIGHT_VERSION,
        "grade": PRODUCT_GRADE,
        "lab_enabled": _lab_enabled(request),
        "request_id": rid,
        "tagline": "Searches while you sleep. Results ready by morning.",
        "scale": {
            "store": "sqlite_wal",
            "multi_tenant": True,
            "multi_worker_leases": True,
            "next": ["postgres", "redis_queue", "k8s_hpa"],
        },
        "stats": st,
    }


@router.get("/schedules")
def night_list_schedules(
    request: Request,
    response: Response,
    x_tenant_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    tid = _tenant(x_tenant_id, request)
    return {
        "ok": True,
        "request_id": rid,
        "tenant_id": tid,
        "schedules": store.list_schedules(tid),
    }


@router.post("/schedules")
def night_upsert_schedule(
    body: ScheduleIn,
    request: Request,
    response: Response,
    x_tenant_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    tid = _tenant(x_tenant_id, request)
    sch = store.upsert_schedule(tid, body.model_dump())
    return {"ok": True, "request_id": rid, "tenant_id": tid, "schedule": sch}


@router.delete("/schedules/{schedule_id}")
def night_delete_schedule(
    schedule_id: str,
    request: Request,
    response: Response,
    x_tenant_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    tid = _tenant(x_tenant_id, request)
    ok = store.delete_schedule(tid, schedule_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    return {"ok": True, "request_id": rid, "deleted": schedule_id}


@router.post("/schedules/{schedule_id}/run-now")
def night_run_now(
    schedule_id: str,
    request: Request,
    response: Response,
    x_tenant_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """Execute overnight search immediately (test / don't wait until 2am)."""
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    tid = _tenant(x_tenant_id, request)
    result = run_schedule_inline(tid, schedule_id)
    if not result.get("ok") and result.get("error") == "schedule_not_found":
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    # attach digest if success
    run_id = result.get("run_id")
    digest = store.get_run(tid, run_id) if run_id else None
    return {
        "ok": bool(result.get("ok")),
        "request_id": rid,
        "tenant_id": tid,
        "result": result,
        "run": digest,
    }


@router.get("/runs")
def night_list_runs(
    request: Request,
    response: Response,
    limit: int = 20,
    x_tenant_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    tid = _tenant(x_tenant_id, request)
    return {
        "ok": True,
        "request_id": rid,
        "tenant_id": tid,
        "runs": store.list_runs(tid, limit=limit),
    }


@router.get("/runs/{run_id}")
def night_get_run(
    run_id: str,
    request: Request,
    response: Response,
    x_tenant_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    tid = _tenant(x_tenant_id, request)
    run = store.get_run(tid, run_id, include_digest=True)
    if not run:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    return {"ok": True, "request_id": rid, "run": run}


@router.get("/morning")
def night_morning(
    request: Request,
    response: Response,
    x_tenant_id: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """Wake-up digest — what finished while you slept."""
    _require_lab(request)
    rid = _request_id(request)
    response.headers["X-Request-Id"] = rid
    tid = _tenant(x_tenant_id, request)
    digest = store.morning_digest(tid)
    digest["request_id"] = rid
    digest["ok"] = True
    digest["night_version"] = NIGHT_VERSION
    return digest
