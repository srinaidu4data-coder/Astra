"""
Shared response contracts for Job Search modules.

Every HTTP-facing pipeline should attach request_id, product version/grade,
and a stable ok/error shape so clients can handle all engines the same way.
"""

from __future__ import annotations

from typing import Any, Optional

from jobsearch.agents import PRODUCT_GRADE, PRODUCT_NAME, PRODUCT_VERSION
from jobsearch.enterprise import new_request_id


def envelope(
    *,
    ok: bool,
    request_id: Optional[str] = None,
    error: Optional[str] = None,
    message: Optional[str] = None,
    **extra: Any,
) -> dict[str, Any]:
    """Minimal success/error envelope shared across modules."""
    rid = request_id or new_request_id()
    body: dict[str, Any] = {
        "ok": bool(ok),
        "request_id": rid,
        "product": {
            "name": PRODUCT_NAME,
            "version": PRODUCT_VERSION,
            "grade": PRODUCT_GRADE,
        },
    }
    if error:
        body["error"] = error
    if message:
        body["message"] = message
    body.update(extra)
    return body


def ok_result(request_id: Optional[str] = None, **extra: Any) -> dict[str, Any]:
    return envelope(ok=True, request_id=request_id, **extra)


def err_result(
    error: str,
    message: str = "",
    *,
    request_id: Optional[str] = None,
    **extra: Any,
) -> dict[str, Any]:
    return envelope(
        ok=False,
        request_id=request_id,
        error=error,
        message=message or error,
        **extra,
    )


# Module registry (documentation + health snapshots)
MODULE_REGISTRY: dict[str, dict[str, str]] = {
    "catalog": {"role": "harvest boards", "layer": "data"},
    "algorithms": {"role": "IR rank ensemble", "layer": "score"},
    "agents": {"role": "search pipeline orchestrator", "layer": "pipeline"},
    "enterprise": {"role": "cache / breakers / metrics", "layer": "control"},
    "apply_math": {"role": "HITL apply math", "layer": "score"},
    "apply_engine": {"role": "packets + queue", "layer": "apply"},
    "auto_apply": {"role": "campaign planner", "layer": "apply"},
    "browser_apply": {"role": "Playwright fill/submit", "layer": "apply"},
    "one_click_apply": {"role": "end-to-end auto apply", "layer": "apply"},
    "autofill": {"role": "ATS field map", "layer": "apply"},
    "resume_forge": {"role": "tailored resume", "layer": "apply"},
    "nexus_pipeline": {"role": "6-stage gate+materials", "layer": "pipeline"},
    "marvel_pipeline": {"role": "SOTA multi-engine apply", "layer": "pipeline"},
    "sota_engines": {"role": "advanced scorers", "layer": "score"},
    "night_store": {"role": "schedules + digests DB", "layer": "data"},
    "night_worker": {"role": "overnight runner", "layer": "worker"},
    "job_model": {"role": "synthetic flags", "layer": "core"},
    "contracts": {"role": "shared envelopes", "layer": "core"},
}
