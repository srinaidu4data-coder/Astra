"""
Shared job model helpers — leaf module (no jobsearch imports).

Keeps synthetic/practice detection and live filtering consistent across
apply, nexus, marvel, night, and UI serializers.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

SEED_SOURCES = frozenset({"seed_market", "seed"})


def is_synthetic_job(job: Mapping[str, Any] | None) -> bool:
    """True for practice / seed listings that must never auto-apply or count as live."""
    if not job:
        return False
    if job.get("is_synthetic"):
        return True
    if job.get("product_label") == "practice":
        return True
    src = str(job.get("source") or "").strip().lower()
    return src in SEED_SOURCES


def live_jobs(jobs: Iterable[Mapping[str, Any]] | None) -> list[dict[str, Any]]:
    """Filter to non-practice jobs as plain dicts."""
    out: list[dict[str, Any]] = []
    for j in jobs or []:
        if is_synthetic_job(j):
            continue
        out.append(dict(j))
    return out


def apply_url_of(job: Mapping[str, Any] | None) -> str:
    """Best apply URL field on a job dict."""
    if not job:
        return ""
    for key in ("apply_url", "url", "indeed_url", "linkedin_url"):
        u = str(job.get(key) or "").strip()
        if u.lower().startswith("http"):
            return u
    return ""


def stamp_product_labels(job: dict[str, Any]) -> dict[str, Any]:
    """Normalize is_synthetic + product_label in place and return job."""
    synth = is_synthetic_job(job)
    job["is_synthetic"] = synth
    job["product_label"] = "practice" if synth else "live"
    return job
