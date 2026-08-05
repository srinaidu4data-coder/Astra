"""Interviews ground only on Role / Job Context / JD / Resume — no RAG, no cross-identity cache."""

from __future__ import annotations


def test_rag_off_by_default():
    from answer_engine import _use_rag

    assert _use_rag() is False


def test_prompt_includes_jd_and_resume_not_rag():
    from answer_engine import _build_user_prompt, _fallback_strategy
    from session_context import clear_pack, session_scope, update_pack

    with session_scope("test_materials_only"):
        clear_pack()
        update_pack(
            role="SAP BRIM Consultant",
            job_description="Must know subscription billing and FI-CA open items.",
            resume_text="Led BRIM migration for telecom billing.",
        )
        q = "How do you handle open items in billing?"
        user = _build_user_prompt(
            q,
            job_context="SAP BRIM Consultant",
            tone="confident",
            mode="star",
            strategy=_fallback_strategy(q, "SAP BRIM Consultant"),
            context_chunks=[{"text": "Configure ATTP EPCIS DSCSA commissioning"}],
        )
        low = user.lower()
        assert "subscription billing" in low or "fi-ca" in low or "brim" in low
        assert "led brim migration" in low
        # RAG chunk must not appear
        assert "epcis" not in low
        assert "attp" not in low or "never invent" in low
        assert "materials rule" in low or "interview materials" in low
        clear_pack()


def test_cache_keys_differ_by_identity():
    from fast_answer import question_key
    from session_context import clear_pack, session_scope, update_pack

    with session_scope("cache_id_a"):
        clear_pack()
        update_pack(role="Role A", job_description="JD Alpha about widgets")
        k1 = question_key("Tell me about yourself", "star", "Role A")
    with session_scope("cache_id_b"):
        clear_pack()
        update_pack(role="Role B", job_description="JD Beta about billing")
        k2 = question_key("Tell me about yourself", "star", "Role B")
    assert k1 != k2


def test_warm_cache_seed_disabled():
    from fast_answer import warm_cache_seed

    assert warm_cache_seed("anything") == 0
