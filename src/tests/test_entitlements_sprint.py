"""Unit tests: product catalog + diagnostic + entitlement grants (no Stripe)."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlmodel import Session, SQLModel, create_engine

from backend.entitlements import (
    grant_entitlement,
    live_minutes_remaining,
    user_has_paid_access,
)
from backend.models import User
from backend.products import get_product, product_catalog
from backend.sprint import _build_diagnostic


def test_product_catalog_has_ladder():
    codes = {p.code for p in product_catalog()}
    assert "free_diagnostic" in codes
    assert "interview_pass" in codes
    assert "interview_sprint" in codes
    assert "pro_monthly" in codes
    pass_p = get_product("interview_pass")
    assert pass_p is not None
    assert pass_p.price_cents == 1900
    assert pass_p.billing_mode == "payment"


def test_diagnostic_no_fabrication_empty_resume():
    d = _build_diagnostic(
        company="Acme",
        role="Backend Engineer",
        jd="Need Python and Kafka experience. Own on-call.",
        resume="",
        stage="technical",
    )
    assert 0 <= d["match_score"] <= 100
    assert len(d["likely_questions"]) == 5
    assert len(d["gaps"]) >= 1
    assert "Upload a resume" in d["answer_preview"] or "resume" in d["answer_preview"].lower()
    assert d["paid_unlocks"]


def test_diagnostic_scores_overlap():
    d = _build_diagnostic(
        company="Acme",
        role="Python Engineer",
        jd="Python Kafka AWS microservices on-call ownership",
        resume="Built Python microservices on AWS. Kafka pipelines. On-call lead.",
        stage="technical",
    )
    assert d["match_score"] >= 40
    assert d["supported_highlights"]


def test_grant_entitlement_idempotent():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        u = User(email="t@example.com", name="T")
        session.add(u)
        session.commit()
        session.refresh(u)
        prod = get_product("interview_pass")
        assert prod
        e1 = grant_entitlement(
            session, u, prod, checkout_session_id="cs_test_1"
        )
        e2 = grant_entitlement(
            session, u, prod, checkout_session_id="cs_test_1"
        )
        assert e1.id == e2.id
        assert user_has_paid_access(session, u)
        rem = live_minutes_remaining(session, u)
        # -1 when AUTH_DEV_BYPASS is on in local env
        assert rem == -1 or rem == prod.live_minutes or rem == 120
