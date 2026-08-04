"""Common-sense domain lock: no ML/robotics bleed into SAP answers."""

from common_sense import (
    contamination_report,
    filter_context_chunks,
    infer_domain,
    prompt_guardrails,
    sanitize_answer,
    stt_initial_prompt,
)


def test_attp_question_locks_sap_attp():
    lock = infer_domain(
        "Should shipping be blocked when parent-child aggregation is incomplete?",
        "SAP ATTP Techno-Functional Consultant",
        "EPCIS DSCSA CMO 3PL serialization",
    )
    assert lock.domain == "sap_attp"
    assert lock.confidence >= 0.35


def test_ml_question_locks_ml():
    lock = infer_domain(
        "Explain overfitting and how gradient descent can make it worse.",
        "ML Engineer",
        "",
    )
    assert lock.domain == "ml_ai"


def test_ml_question_beats_attp_pack():
    """Stored ATTP pack must not re-label a clear ML question."""
    from common_sense import lock_for_turn

    lock = lock_for_turn(
        "Explain overfitting and how gradient descent can make it worse.",
        "SAP ATTP Techno-Functional Consultant",
        "SAP ATTP EPCIS GTIN GLN SSCC DSCSA serialization commissioning aggregation",
    )
    assert lock.domain == "ml_ai"
    assert lock.confidence >= 0.28


def test_empty_job_soft_question_not_attp():
    """Blank Role: soft/behavioral Q must not lock to pack/JD ATTP."""
    from common_sense import lock_for_turn
    from session_context import clear_pack, update_pack

    clear_pack()
    update_pack(
        role="SAP ATTP Techno-Functional Consultant",
        job_description="ATTP EPCIS GTIN GLN SSCC DSCSA commissioning aggregation",
        keywords=["ATTP", "EPCIS", "GTIN"],
    )
    lock = lock_for_turn(
        "Tell me about a time you handled conflict on a team.",
        "",
    )
    assert lock.domain == "general" or lock.confidence < 0.28
    # Explicit extra_context="" also stays general
    lock2 = lock_for_turn(
        "Tell me about a time you handled conflict on a team.",
        "",
        extra_context="",
    )
    assert lock2.domain == "general" or lock2.confidence < 0.28


def test_domains_compatible_no_sap_skill_pooling():
    """Sharing the word SAP must never pool product-line skills."""
    from common_sense import domains_compatible

    # Specialized lines never combine with each other or with generic SAP
    assert not domains_compatible("sap_attp", "sap_general")
    assert not domains_compatible("sap_brim", "sap_general")
    assert not domains_compatible("sap_fico", "sap_general")
    assert not domains_compatible("sap_attp", "sap_fico")
    assert not domains_compatible("sap_attp", "sap_brim")
    assert not domains_compatible("sap_brim", "sap_fico")
    assert not domains_compatible("sap_attp", "ml_ai")
    # Exact match / general only
    assert domains_compatible("sap_brim", "sap_brim")
    assert domains_compatible("ml_ai", "general")


def test_brim_role_locks_brim_not_attp():
    from common_sense import infer_domain, lock_for_turn

    lock = infer_domain(
        "How do you model subscription billing in BRIM?",
        "SAP BRIM Data Analysis & Migration Support",
        "",
    )
    assert lock.domain == "sap_brim"
    # Leftover ATTP pack must not win over BRIM role + BRIM question
    lock2 = lock_for_turn(
        "Explain convergent invoicing and provider contracts in BRIM.",
        "SAP BRIM Data Analysis & Migration Support",
        "SAP ATTP EPCIS GTIN SSCC DSCSA serialization commissioning",
    )
    assert lock2.domain == "sap_brim"


def test_stt_prompt_not_kitchen_sink():
    p = stt_initial_prompt(
        job_context="SAP ATTP Serialization Consultant",
        resume_or_pack="EPCIS GS1 DSCSA MAH CMO",
    )
    low = p.lower()
    assert "attp" in low or "epcis" in low or "serialization" in low
    assert "machine learning" not in low
    assert "pytorch" not in low
    assert "vertex o series" not in low


def test_filter_drops_robotics_for_attp_question():
    chunks = [
        {"text": "ROS2 tf2 base_link SLAM odometry for robot navigation"},
        {"text": "Configure ATTP repository GTINs SSCCs EPCIS commissioning events"},
        {"text": "PyTorch overfitting gradient descent backpropagation training loop"},
    ]
    kept = filter_context_chunks(
        chunks,
        question="How do EPCIS shipping events flow from CMO to MAH in ATTP?",
        job_context="SAP ATTP Consultant",
    )
    texts = " ".join(c["text"] for c in kept).lower()
    assert "epcis" in texts or "attp" in texts
    assert "ros2" not in texts
    assert "pytorch" not in texts


def test_sanitize_strips_psych_theater():
    raw = (
        "Hook: Yes.\n"
        "Approach: Block incomplete aggregation at PGI.\n"
        "Psych-math note: use softmax attention and Zipf budget for primacy effect.\n"
        "Close: I keep DSCSA auditability."
    )
    out = sanitize_answer(
        raw,
        question="Should shipping be blocked when aggregation is incomplete?",
        job_context="SAP ATTP",
    )
    low = out.lower()
    assert "softmax" not in low
    assert "zipf" not in low
    assert "psych-math" not in low
    assert "block" in low or "yes" in low


def test_contamination_flags_ml_in_attp_answer():
    ans = (
        "I would train a neural network with PyTorch and tune hyperparameters "
        "using gradient descent until overfitting drops."
    )
    rep = contamination_report(
        ans,
        question="How do you model EPCIS commissioning in ATTP?",
        job_context="SAP ATTP Techno-Functional",
    )
    assert rep["foreign_hits"] >= 1
    assert not rep["ok"]


def test_guardrails_mention_lock():
    lock = infer_domain(
        "EPCIS mapping for DSCSA saleable returns",
        "SAP ATTP",
        "",
    )
    g = prompt_guardrails(lock)
    assert "COMMON SENSE" in g
    assert "machine learning" in g.lower() or "ml" in g.lower() or "FORBIDDEN" in g


def test_general_question_no_false_lock():
    lock = infer_domain("Tell me about a time you led a difficult stakeholder.", "", "")
    assert lock.domain == "general" or lock.confidence < 0.5
