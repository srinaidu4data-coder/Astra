"""Job Search AI — localhost lab (isolated from production interview path).

Public surface (lazy):
  - router / apply_router — FastAPI HTTP
  - is_synthetic_job / live_jobs — job_model leaf
  - MODULE_REGISTRY — contracts

Prefer direct imports in production (see copilot_api.py).
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "router",
    "apply_router",
    "is_synthetic_job",
    "live_jobs",
    "MODULE_REGISTRY",
    "PRODUCT_VERSION",
]


def __getattr__(name: str) -> Any:
    if name == "router":
        from jobsearch.api import router

        return router
    if name == "apply_router":
        from jobsearch.apply_api import router as apply_router

        return apply_router
    if name in ("is_synthetic_job", "live_jobs"):
        from jobsearch import job_model

        return getattr(job_model, name)
    if name == "MODULE_REGISTRY":
        from jobsearch.contracts import MODULE_REGISTRY

        return MODULE_REGISTRY
    if name == "PRODUCT_VERSION":
        from jobsearch.agents import PRODUCT_VERSION

        return PRODUCT_VERSION
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
