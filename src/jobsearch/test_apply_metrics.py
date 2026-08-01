"""Lab apply metrics KPI tests."""

from __future__ import annotations

from pathlib import Path

from jobsearch.apply_metrics import record_attempt, record_batch, reset_metrics, snapshot


def test_record_and_snapshot(tmp_path: Path):
    p = tmp_path / "m.json"
    reset_metrics(p)
    record_attempt(
        status="submitted",
        submitted=True,
        filled_fields=["email", "first_name"],
        ats="greenhouse",
        job_title="Engineer",
        url="https://boards.greenhouse.io/acme/jobs/1",
        path=p,
    )
    record_attempt(
        status="opened_manual",
        ats="linkedin",
        path=p,
    )
    snap = snapshot(p)
    assert snap["totals"]["submitted"] == 1
    assert snap["totals"]["manual"] == 1
    assert snap["totals"]["attempts"] == 2
    assert snap["kpi"]["value"] == 1  # submitted + filled
    assert "greenhouse" in snap["by_ats"]
    assert any(a.get("title") == "Engineer" for a in (snap.get("recent") or []))


def test_batch(tmp_path: Path):
    p = tmp_path / "b.json"
    reset_metrics(p)
    snap = record_batch(
        [
            {
                "status": "filled",
                "filled_fields": ["email"],
                "ats": "lever",
                "title": "SWE",
            },
            {"status": "skipped_no_url", "ats": "unknown"},
        ],
        path=p,
    )
    assert snap["recorded"] == 2
    assert snap["totals"]["filled"] == 1
    assert snap["totals"]["skipped"] == 1


def test_thin_submit_not_counted(tmp_path: Path):
    p = tmp_path / "thin.json"
    reset_metrics(p)
    out = record_attempt(
        status="submitted",
        submitted=True,
        filled_fields=["email"],
        ats="generic",
        job_title="Thin",
        url="https://example.com/thin",
        path=p,
    )
    assert out["submitted"] is False
    assert out["raw_status"] == "submit_quality_rejected"
    snap = snapshot(p)
    assert snap["totals"]["submitted"] == 0
    assert snap["totals"]["filled"] == 1


def test_error_with_fields_stays_error(tmp_path: Path):
    p = tmp_path / "err.json"
    reset_metrics(p)
    record_attempt(
        status="error",
        submitted=False,
        filled_fields=["email", "first_name"],
        ats="generic",
        url="https://example.com/err",
        path=p,
    )
    snap = snapshot(p)
    assert snap["totals"]["error"] == 1
    assert snap["totals"]["filled"] == 0


def test_duplicate_url_window(tmp_path: Path):
    p = tmp_path / "dup.json"
    reset_metrics(p)
    url = "https://jobs.example.com/role/99?utm_source=freehire.me"
    record_attempt(
        status="submitted",
        submitted=True,
        filled_fields=["email", "first_name"],
        ats="generic",
        job_title="Role",
        url=url,
        path=p,
    )
    record_attempt(
        status="submitted",
        submitted=True,
        filled_fields=["email", "first_name"],
        ats="generic",
        job_title="Role",
        url=url,
        path=p,
    )
    snap = snapshot(p)
    assert snap["totals"]["submitted"] == 1
    assert snap["totals"]["skipped"] == 1
    assert snap["totals"]["attempts"] == 2
