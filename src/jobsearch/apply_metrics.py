"""
Lab ATS success metrics — local JSON KPI (no cloud).

Records apply outcomes for dashboard: submitted / filled / manual / skipped by ATS.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

from jobsearch.apply_truth import (
    DUPLICATE_URL_WINDOW_SEC,
    canonical_apply_url,
    coerce_submitted_claim,
    is_duplicate_submit,
)

METRICS_VERSION = "1.2.1"
_LOCK = threading.Lock()

# Default under src/data for lab
def _default_path() -> Path:
    root = Path(__file__).resolve().parents[1]  # src/
    d = root / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d / "apply_metrics.json"


def _audit_path() -> Path:
    root = Path(__file__).resolve().parents[1]
    d = root / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d / "apply_audit.jsonl"


def _load(path: Path | None = None) -> dict[str, Any]:
    p = path or _default_path()
    if not p.exists():
        return {
            "version": METRICS_VERSION,
            "attempts": [],
            "by_ats": {},
            "totals": {
                "submitted": 0,
                "filled": 0,
                "manual": 0,
                "skipped": 0,
                "error": 0,
                "attempts": 0,
            },
        }
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {
            "version": METRICS_VERSION,
            "attempts": [],
            "by_ats": {},
            "totals": {
                "submitted": 0,
                "filled": 0,
                "manual": 0,
                "skipped": 0,
                "error": 0,
                "attempts": 0,
            },
        }


def _save(data: dict[str, Any], path: Path | None = None) -> None:
    """Atomic write (temp + replace) so crash mid-write cannot leave empty/corrupt KPI."""
    import os
    import tempfile

    p = path or _default_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2)
    fd, tmp = tempfile.mkstemp(prefix="apply_metrics_", suffix=".json", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _kpi_bucket(status: str, submitted: bool, filled_fields: list | None) -> str:
    """Map raw attempt status → dashboard bucket (status allowlist before field heuristics)."""
    st = (status or "").lower()
    if st in ("duplicate", "skipped_duplicate"):
        return "skipped"
    if submitted or st == "submitted":
        return "submitted"
    # Errors before "any fields ⇒ filled" (prevents error+fields becoming filled)
    if st == "error" or st.startswith("error"):
        return "error"
    if st in ("opened_manual", "manual", "opened"):
        return "manual"
    if st in (
        "filled",
        "filled_submit_failed",
        "submit_quality_rejected",
        "submit_click_failed",
    ):
        return "filled" if filled_fields else "error"
    if "fail" in st:
        return "filled" if filled_fields else "error"
    if st == "filled" or (filled_fields and len(filled_fields) > 0 and "skip" not in st):
        # Only promote unknown statuses with fields if not an error-like name
        if "error" in st:
            return "error"
        return "filled"
    if "error" in st:
        return "error"
    return "skipped"


# Public alias used by tests / older callers
normalize_attempt_fields = coerce_submitted_claim


def append_audit(
    *,
    url: str | None = None,
    pack_id: str | None = None,
    submitted: bool = False,
    status: str = "",
    user_id: str | None = None,
    job_title: str | None = None,
    company: str | None = None,
    ats: str | None = None,
    latency_ms: float | None = None,
) -> None:
    """
    Compliance audit line (lab JSONL): who applied as whom, URL, pack, submit.
    Retention: last 2000 lines rewritten on rotate.
    """
    line = {
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ts": time.time(),
        "url": (url or "")[:400],
        "pack_id": (pack_id or "")[:80],
        "submitted": bool(submitted),
        "status": (status or "")[:80],
        "user_id": (user_id or "lab-local")[:120],
        "title": (job_title or "")[:120],
        "company": (company or "")[:80],
        "ats": (ats or "")[:40],
        "latency_ms": latency_ms,
    }
    p = _audit_path()
    with _LOCK:
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        # rotate if huge
        try:
            lines = p.read_text(encoding="utf-8").splitlines()
            if len(lines) > 2000:
                p.write_text("\n".join(lines[-1500:]) + "\n", encoding="utf-8")
        except Exception:
            pass


def record_attempt(
    *,
    status: str,
    submitted: bool = False,
    filled_fields: list | None = None,
    ats: str | None = None,
    job_title: str | None = None,
    company: str | None = None,
    url: str | None = None,
    reason: str | None = None,
    pack_id: str | None = None,
    user_id: str | None = None,
    latency_ms: float | None = None,
    resume_uploaded: bool = False,
    submit_click: bool | None = None,
    path: Path | None = None,
) -> dict[str, Any]:
    """Append one attempt and update totals / by_ats. Caps history at 500."""
    fields = list(filled_fields or [])
    resume_flag = bool(resume_uploaded) or any(
        "resume" in str(f).lower() for f in fields
    )

    with _LOCK:
        data = _load(path)
        raw_status, counted = coerce_submitted_claim(
            status=status,
            submitted=submitted,
            filled_fields=fields,
            resume_uploaded=resume_flag,
            submit_click=submit_click,
        )
        now = time.time()
        attempts = list(data.get("attempts") or [])
        note = reason or ""
        deduped = False

        if counted and is_duplicate_submit(url, attempts, now=now):
            raw_status = "duplicate"
            counted = False
            deduped = True
            note = (note + f" duplicate_url_within_{int(DUPLICATE_URL_WINDOW_SEC)}s").strip()

        bucket = _kpi_bucket(raw_status, counted, fields)
        ats_key = (ats or "unknown").lower()[:40]
        row = {
            "ts": now,
            "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": bucket,
            "raw_status": raw_status or status,
            "ats": ats_key,
            "title": (job_title or "")[:120],
            "company": (company or "")[:80],
            "url": (url or "")[:300],
            "url_key": canonical_apply_url(url)[:300],
            "reason": note[:200],
            "filled_n": len(fields),
            "pack_id": (pack_id or "")[:80],
            "latency_ms": latency_ms,
            "submit_click": submit_click,
        }
        attempts.append(row)
        data["attempts"] = attempts[-500:]

        if latency_ms is not None and latency_ms >= 0:
            lat = list(data.get("latencies_ms") or [])
            lat.append(float(latency_ms))
            data["latencies_ms"] = lat[-200:]

        totals = data.setdefault(
            "totals",
            {
                "submitted": 0,
                "filled": 0,
                "manual": 0,
                "skipped": 0,
                "error": 0,
                "attempts": 0,
            },
        )
        totals["attempts"] = int(totals.get("attempts") or 0) + 1
        totals[bucket] = int(totals.get(bucket) or 0) + 1

        by_ats = data.setdefault("by_ats", {})
        cell = by_ats.setdefault(
            ats_key,
            {"submitted": 0, "filled": 0, "manual": 0, "skipped": 0, "error": 0, "n": 0},
        )
        cell["n"] = int(cell.get("n") or 0) + 1
        cell[bucket] = int(cell.get(bucket) or 0) + 1

        week = time.strftime("%Y-W%W", time.gmtime())
        weekly = data.setdefault("weekly_submitted", {})
        if bucket == "submitted" and counted:
            weekly[week] = int(weekly.get(week) or 0) + 1
        data["weekly_submitted"] = {k: weekly[k] for k in sorted(weekly.keys())[-12:]}

        data["version"] = METRICS_VERSION
        data["updated_at"] = row["iso"]
        _save(data, path)

    try:
        append_audit(
            url=url,
            pack_id=pack_id,
            submitted=bool(counted and bucket == "submitted"),
            status=bucket,
            user_id=user_id,
            job_title=job_title,
            company=company,
            ats=ats_key,
            latency_ms=latency_ms,
        )
    except Exception:
        pass
    return {
        "ok": True,
        "bucket": bucket,
        "raw_status": raw_status,
        "deduped": deduped,
        "submitted": bool(counted and bucket == "submitted"),
        "totals": totals,
        "ats": ats_key,
    }


def record_batch(results: list[dict[str, Any]], path: Path | None = None) -> dict[str, Any]:
    """Record many browser_apply results."""
    out = []
    for r in results or []:
        fpm = r.get("form_pack_match") if isinstance(r.get("form_pack_match"), dict) else {}
        pack_id = (
            str(fpm.get("job_id") or fpm.get("pack_id") or r.get("job_id") or "")[:80]
        )
        fields = (
            r.get("filled_fields") if isinstance(r.get("filled_fields"), list) else None
        )
        sc = r.get("submit_click")
        out.append(
            record_attempt(
                status=str(r.get("status") or ""),
                submitted=bool(r.get("submitted")),
                filled_fields=fields,
                ats=r.get("ats"),
                job_title=r.get("title"),
                company=r.get("company"),
                url=r.get("url"),
                reason=r.get("error") or r.get("message"),
                pack_id=pack_id,
                latency_ms=r.get("elapsed_ms") or r.get("latency_ms"),
                resume_uploaded=bool(r.get("resume_uploaded")),
                submit_click=bool(sc) if sc is not None else None,
                path=path,
            )
        )
    snap = snapshot(path)
    snap["recorded"] = len(out)
    return snap


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return round(sorted_vals[0], 2)
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return round(sorted_vals[f], 2)
    return round(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f), 2)


def snapshot(path: Path | None = None) -> dict[str, Any]:
    data = _load(path)
    totals = data.get("totals") or {}
    n = max(int(totals.get("attempts") or 0), 1)
    rates = {
        "submit_rate": round(int(totals.get("submitted") or 0) / n, 4),
        "fill_rate": round(
            (int(totals.get("submitted") or 0) + int(totals.get("filled") or 0)) / n, 4
        ),
        "manual_rate": round(int(totals.get("manual") or 0) / n, 4),
    }
    lat = sorted(float(x) for x in (data.get("latencies_ms") or []) if x is not None)
    week = time.strftime("%Y-W%W", time.gmtime())
    weekly = data.get("weekly_submitted") or {}
    return {
        "ok": True,
        "version": METRICS_VERSION,
        "totals": totals,
        "rates": rates,
        "by_ats": data.get("by_ats") or {},
        "recent": list(data.get("attempts") or [])[-20:][::-1],
        "updated_at": data.get("updated_at"),
        "path": str(path or _default_path()),
        "audit_path": str(_audit_path()),
        "latency_ms": {
            "n": len(lat),
            "p50": _percentile(lat, 0.50),
            "p95": _percentile(lat, 0.95),
        },
        "weekly_submitted": weekly,
        "applications_completed_this_week": int(weekly.get(week) or 0),
        "kpi": {
            "north_star": "successful form fills per session",
            "definition": "submitted + filled (not opened_manual alone)",
            "value": int(totals.get("submitted") or 0) + int(totals.get("filled") or 0),
            "attempts": int(totals.get("attempts") or 0),
            "weekly_completed": int(weekly.get(week) or 0),
            "week": week,
        },
    }


def reset_metrics(path: Path | None = None) -> dict[str, Any]:
    with _LOCK:
        empty = {
            "version": METRICS_VERSION,
            "attempts": [],
            "by_ats": {},
            "totals": {
                "submitted": 0,
                "filled": 0,
                "manual": 0,
                "skipped": 0,
                "error": 0,
                "attempts": 0,
            },
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        _save(empty, path)
        return {"ok": True, **empty}
