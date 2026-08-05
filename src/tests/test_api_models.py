"""Characterization: HTTP request models stay stable for public API contracts."""

from __future__ import annotations


def test_answer_request_defaults():
    from api_models import AnswerRequest

    r = AnswerRequest(question="Hello?")
    assert r.job_context == ""
    assert r.tone == "confident"
    assert r.mode == "star"
    assert r.answer_model is None


def test_session_context_request_optional_fields():
    from api_models import SessionContextRequest

    r = SessionContextRequest(role="Widget Lead", job_description="Build widgets")
    assert r.role == "Widget Lead"
    assert r.clear is False
    assert r.resume_text is None


def test_session_id_from_token_empty():
    from session_context import session_id_from_token

    assert session_id_from_token("") == ""
    assert session_id_from_token("not-a-jwt") == ""


def test_build_user_prompt_public_contract():
    """Stable markers the UI/API path relies on in user prompts."""
    from answer_engine import _build_user_prompt, _fallback_strategy

    q = "How do you design a system?"
    role = "Platform Engineer"
    user = _build_user_prompt(
        q,
        job_context=role,
        tone="confident",
        mode="star",
        strategy=_fallback_strategy(q, role),
        context_chunks=[],
    )
    low = user.lower()
    assert "platform engineer" in low
    assert "how do you design a system" in low
    assert "materials" in low
