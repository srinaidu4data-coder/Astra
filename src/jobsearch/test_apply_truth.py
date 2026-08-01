"""Unit tests for apply product-truth (submit quality + URL dedupe)."""

from __future__ import annotations

from jobsearch.apply_truth import (
    canonical_apply_url,
    coerce_submitted_claim,
    fill_quality_ok,
    is_duplicate_submit,
    qualifies_as_submitted,
)


def test_fill_quality_ok():
    assert fill_quality_ok(["email", "phone"]) is True
    assert fill_quality_ok(["email"]) is False
    assert fill_quality_ok([], resume_uploaded=True) is True
    assert fill_quality_ok(["a", "b", "c"]) is True
    assert fill_quality_ok(["only"]) is False


def test_qualifies_as_submitted():
    assert qualifies_as_submitted(["email", "phone"], click_ok=True) is True
    assert qualifies_as_submitted(["email", "phone"], click_ok=False) is False
    assert qualifies_as_submitted(["email"], click_ok=True) is False
    assert qualifies_as_submitted([], click_ok=True, resume_uploaded=True) is True


def test_coerce_thin_submit():
    st, sub = coerce_submitted_claim(
        status="submitted", submitted=True, filled_fields=["email"]
    )
    assert sub is False
    assert st == "submit_quality_rejected"

    st, sub = coerce_submitted_claim(
        status="submitted",
        submitted=True,
        filled_fields=["email", "first_name"],
    )
    assert sub is True
    assert st == "submitted"

    st, sub = coerce_submitted_claim(
        status="submitted",
        submitted=True,
        filled_fields=["email", "first_name"],
        submit_click=False,
    )
    assert sub is False
    assert st == "submit_click_failed"


def test_canonical_url_strips_utm():
    a = canonical_apply_url(
        "https://Jobs.Example.com/role/99?utm_source=freehire.me&id=1"
    )
    b = canonical_apply_url("https://jobs.example.com/role/99/?id=1")
    assert a == b
    assert "utm_" not in a


def test_is_duplicate_submit():
    url = "https://jobs.example.com/x?utm_source=x"
    attempts = [
        {
            "status": "submitted",
            "url": "https://jobs.example.com/x",
            "ts": 1000.0,
        }
    ]
    assert is_duplicate_submit(url, attempts, now=1000.0 + 60) is True
    assert is_duplicate_submit(url, attempts, now=1000.0 + 10_000) is False
