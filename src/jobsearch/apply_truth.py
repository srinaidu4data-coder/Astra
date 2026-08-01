"""
Apply product-truth helpers — one place for "what counts as submitted".

Used by browser_apply (engine) and apply_metrics (KPI/audit) so rules cannot drift.
"""

from __future__ import annotations

from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Same URL re-submitted within this window → skipped (not weekly-completed)
DUPLICATE_URL_WINDOW_SEC = 900.0

# UTM / tracking noise stripped from dedupe keys
_DROP_QUERY_PREFIXES = ("utm_",)
_DROP_QUERY_KEYS = frozenset({"source", "ref", "fbclid", "gclid"})


def _norm_fields(filled_fields: Iterable[Any] | None) -> list[str]:
    return [str(f or "").lower().strip() for f in (filled_fields or []) if f]


def _has_email(fields: list[str]) -> bool:
    return any("email" in f or f in ("e-mail", "e_mail") for f in fields)


def fill_quality_ok(
    filled_fields: Iterable[Any] | None,
    *,
    resume_uploaded: bool = False,
) -> bool:
    """
    True when the fill is strong enough to count a successful submit click
    as product "submitted" (not a naked click on an empty/sparse page).
    """
    if resume_uploaded:
        return True
    fields = _norm_fields(filled_fields)
    n = len(fields)
    if _has_email(fields) and n >= 2:
        return True
    # Public forms where labels did not map to "email"
    return n >= 3


def qualifies_as_submitted(
    filled_fields: Iterable[Any] | None,
    *,
    click_ok: bool,
    resume_uploaded: bool = False,
) -> bool:
    """Engine + metrics: submit click AND fill quality."""
    return bool(click_ok) and fill_quality_ok(
        filled_fields, resume_uploaded=resume_uploaded
    )


def coerce_submitted_claim(
    *,
    status: str,
    submitted: bool,
    filled_fields: Iterable[Any] | None,
    resume_uploaded: bool = False,
    submit_click: bool | None = None,
) -> tuple[str, bool]:
    """
    Metrics defense-in-depth: demote thin or inconsistent submitted claims.

    Returns (raw_status, submitted_flag) before KPI bucketing.
    If submit_click is False, never count as submitted.
    """
    st = (status or "").lower().strip()
    claimed = bool(submitted) or st == "submitted"
    if not claimed:
        return (st or status or "skipped", False)

    # Known non-submit terminal statuses — pass through
    if st in (
        "submit_quality_rejected",
        "submit_click_failed",
        "filled_submit_failed",
        "duplicate",
    ):
        return (st, False)

    click_ok = True if submit_click is None else bool(submit_click)
    if not click_ok:
        return ("submit_click_failed", False)

    if qualifies_as_submitted(
        filled_fields, click_ok=True, resume_uploaded=resume_uploaded
    ):
        return ("submitted", True)
    return ("submit_quality_rejected", False)


def canonical_apply_url(url: str | None) -> str:
    """Stable key for dedupe (strip tracking query params, lowercase host/path)."""
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
        scheme = (parts.scheme or "https").lower()
        netloc = parts.netloc.lower()
        path = parts.path.rstrip("/") or ""
        kept = []
        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            kl = k.lower()
            if kl in _DROP_QUERY_KEYS:
                continue
            if any(kl.startswith(p) for p in _DROP_QUERY_PREFIXES):
                continue
            kept.append((k, v))
        query = urlencode(kept)
        return urlunsplit((scheme, netloc, path, query, ""))
    except Exception:
        return raw.lower().rstrip("/")


def is_duplicate_submit(
    url: str | None,
    attempts: list[dict[str, Any]],
    *,
    now: float,
    window_sec: float = DUPLICATE_URL_WINDOW_SEC,
    lookback: int = 80,
) -> bool:
    """True if a submitted attempt for the same canonical URL is inside the window."""
    key = canonical_apply_url(url)
    if not key:
        return False
    for prev in reversed(list(attempts or [])[-lookback:]):
        if prev.get("status") != "submitted":
            continue
        prev_key = str(prev.get("url_key") or "") or canonical_apply_url(prev.get("url"))
        if prev_key != key:
            continue
        age = now - float(prev.get("ts") or 0)
        if 0 <= age < window_sec:
            return True
    return False



