"""Materials-only grounding: no skill-domain hardcoding."""

from common_sense import (
    contamination_report,
    domains_compatible,
    filter_context_chunks,
    has_invented_product_bleed,
    infer_domain,
    invented_product_hits,
    lock_for_turn,
    prompt_guardrails,
    sanitize_answer,
    stt_initial_prompt,
)


def test_infer_domain_always_general():
    lock = infer_domain(
        "Should shipping be blocked when aggregation is incomplete?",
        "SAP ATTP Techno-Functional Consultant",
        "EPCIS DSCSA",
    )
    assert lock.domain == "general"
    assert lock.confidence == 0.0


def test_lock_for_turn_always_general():
    lock = lock_for_turn(
        "Explain overfitting and gradient descent",
        "ML Engineer",
    )
    assert lock.domain == "general"


def test_domains_compatible_always_true():
    assert domains_compatible("sap_attp", "sap_brim")
    assert domains_compatible("ml_ai", "robotics")
    assert domains_compatible("a", "b")


def test_stt_prompt_uses_role_only_not_skill_pack():
    p = stt_initial_prompt(job_context="Widget Integration Lead")
    low = p.lower()
    assert "widget integration lead" in low
    assert "epcis" not in low
    assert "pytorch" not in low
    assert "serialization" not in low


def test_stt_prompt_blank_is_generic():
    p = stt_initial_prompt(job_context="")
    assert "professional job interview" in p.lower()
    assert "attp" not in p.lower()


def test_filter_passes_all_chunks():
    chunks = [
        {"text": "ROS2 tf2 SLAM"},
        {"text": "Configure ATTP EPCIS"},
        {"text": "PyTorch overfitting"},
    ]
    kept = filter_context_chunks(
        chunks,
        question="Anything?",
        job_context="Anything",
    )
    assert len(kept) == 3


def test_sanitize_strips_psych_theater():
    raw = (
        "Hook: Yes.\n"
        "Approach: Block incomplete aggregation at PGI.\n"
        "Psych-math note: use softmax attention and Zipf budget for primacy effect.\n"
        "Close: Done."
    )
    out = sanitize_answer(raw, question="Should shipping be blocked?", job_context="")
    low = out.lower()
    assert "softmax" not in low
    assert "zipf" not in low
    assert "block" in low or "yes" in low


def test_guardrails_materials_only_no_product_list():
    lock = lock_for_turn("anything", "My Role")
    g = prompt_guardrails(lock, role="My Role")
    low = g.lower()
    assert "materials-only" in low or "materials only" in low or "role" in low
    assert "sap attp" not in low
    assert "track-and-trace" not in low


def test_invented_acronym_flagged_when_not_in_materials():
    from session_context import clear_pack, session_scope

    with session_scope("cs_invent"):
        clear_pack()
        raw = "I would configure EPCIS and DSCSA in ATTP for compliance."
        assert has_invented_product_bleed(
            raw,
            question="How do you keep master data clean?",
            job_context="",
        )
        hits = invented_product_hits(
            raw, question="How do you keep master data clean?", job_context=""
        )
        toks = " ".join(t for _d, t in hits).upper()
        assert "EPCIS" in toks or "DSCSA" in toks or "ATTP" in toks


def test_no_bleed_when_term_in_question():
    raw = "I would configure EPCIS shipping events carefully."
    assert not has_invented_product_bleed(
        raw,
        question="How do EPCIS shipping events work?",
        job_context="",
    )


def test_no_bleed_when_term_in_role():
    raw = "As an ATTP consultant I focus on repository design."
    assert not has_invented_product_bleed(
        raw,
        question="What do you own day to day?",
        job_context="SAP ATTP Techno-Functional Consultant",
    )


def test_contamination_report_shape():
    rep = contamination_report(
        "I use softmax Zipf budget",
        question="hello",
        job_context="",
    )
    assert "ok" in rep
    assert "lock" in rep
    assert rep["lock"]["domain"] == "general"


def test_resolve_pack_blob_empty():
    from common_sense import resolve_pack_blob
    from session_context import clear_pack, update_pack

    clear_pack()
    update_pack(role="SAP ATTP", job_description="ATTP EPCIS")
    assert resolve_pack_blob() == ""
