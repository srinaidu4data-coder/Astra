"""Regression tests for evidence-safe generation and anti-fabrication guards."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


RESUME_30PCT = (
    "Senior SAP FICO Consultant with 8 years experience. "
    "S/4HANA Finance, enterprise structure, asset accounting, integration testing, "
    "cutover and hypercare. "
    "Improved month-end close time by 30% through reconciliation standardization and automation."
)

QUESTION_MONTH_END = (
    "Tell me about a time you improved a difficult month-end close process "
    "and how you measured the result."
)

FABRICATED = (
    "Hook: I reduced month-end close from 10 days to 7 days.\n"
    "Action: I fixed manual data-entry errors and conducted training sessions.\n"
    "Result: Discrepancies decreased by 40% and the close became predictable.\n"
    "Close: Happy to share the control matrix."
)

ALLOWED_SHAPE = (
    "Hook: I helped reduce month-end close time by 30% by standardizing "
    "reconciliation and automation.\n"
    "Close: Happy to walk the controls."
)


def test_extract_pct_without_baseline_final():
    from evidence_grounding import extract_metrics_from_text

    metrics = extract_metrics_from_text(RESUME_30PCT)
    assert metrics, "expected at least one metric from resume"
    pcts = [m for m in metrics if m.unit == "%"]
    assert any(abs(m.value - 30.0) < 0.01 for m in pcts)
    for m in pcts:
        if abs(m.value - 30.0) < 0.01:
            assert m.baseline is None, "must not invent baseline from percentage alone"
            assert m.final_value is None, "must not invent final from percentage alone"


def test_bundle_month_end_evidence():
    from evidence_grounding import (
        classify_answer_mode,
        extract_facts_from_materials,
        select_relevant_evidence,
    )

    bundle = extract_facts_from_materials(
        resume_text=RESUME_30PCT,
        role="Senior SAP FICO Consultant",
    )
    assert any(m.approved and abs(m.value - 30) < 0.01 for m in bundle.metrics)
    rel = select_relevant_evidence(bundle, QUESTION_MONTH_END)
    mode = classify_answer_mode(QUESTION_MONTH_END, rel)
    assert mode in ("verified_experience", "partially_supported")


def test_sanitize_rejects_10_to_7_and_40pct_and_training():
    from evidence_grounding import (
        extract_facts_from_materials,
        sanitize_answer_against_evidence,
    )

    bundle = extract_facts_from_materials(
        resume_text=RESUME_30PCT,
        role="Senior SAP FICO Consultant",
    )
    result = sanitize_answer_against_evidence(
        FABRICATED, bundle, question=QUESTION_MONTH_END
    )
    low = result.text.lower()
    assert "10 days" not in low and "7 days" not in low
    assert "from 10" not in low
    assert "40%" not in low and "40 %" not in low
    assert "training sessions" not in low
    assert "manual data-entry" not in low and "manual-entry" not in low
    assert result.violations, "expected grounding violations recorded"
    # 30% may remain if reintroduced as replacement for day counts
    # (replacement uses approved pct) — that is allowed
    kinds = {v.kind for v in result.violations}
    assert kinds & {
        "invented_baseline_final",
        "fabrication_pattern",
        "unsupported_side_claim",
        "unsupported_percentage",
    }


def test_allowed_30pct_passes():
    from evidence_grounding import (
        extract_facts_from_materials,
        sanitize_answer_against_evidence,
    )

    bundle = extract_facts_from_materials(
        resume_text=RESUME_30PCT,
        role="Senior SAP FICO Consultant",
    )
    result = sanitize_answer_against_evidence(
        ALLOWED_SHAPE, bundle, question=QUESTION_MONTH_END
    )
    low = result.text.lower()
    assert "30%" in low or "30 %" in low
    # Should not invent day counts
    assert "10 days" not in low
    assert "7 days" not in low


def test_stage_a_uses_only_supported_metric():
    from evidence_grounding import (
        extract_facts_from_materials,
        stage_a_hook_from_evidence,
    )

    bundle = extract_facts_from_materials(
        resume_text=RESUME_30PCT,
        role="Senior SAP FICO Consultant",
    )
    text = stage_a_hook_from_evidence(QUESTION_MONTH_END, bundle, mode="star")
    low = text.lower()
    assert "30%" in low or "30 %" in low
    assert "10 days" not in low
    assert "7 days" not in low
    assert "40%" not in low
    assert "hook:" in low


def test_hypothetical_when_no_resume():
    from evidence_grounding import (
        classify_answer_mode,
        extract_facts_from_materials,
        stage_a_hook_from_evidence,
    )

    bundle = extract_facts_from_materials(role="Software Engineer")
    mode = classify_answer_mode(QUESTION_MONTH_END, bundle)
    assert mode == "hypothetical_approach"
    text = stage_a_hook_from_evidence(QUESTION_MONTH_END, bundle)
    assert "would approach" in text.lower() or "strong approach" in text.lower()


def test_detect_stream_violations_baseline_final():
    from evidence_grounding import (
        detect_stream_violations,
        extract_facts_from_materials,
    )

    bundle = extract_facts_from_materials(resume_text=RESUME_30PCT)
    v = detect_stream_violations(
        "I cut close from 10 days to 7 days with automation",
        bundle,
    )
    assert v


def test_normalize_strips_fabrication_with_session():
    from answer_engine import _normalize_answer_text
    from session_context import clear_pack, session_scope, update_pack

    with session_scope("test_grounding_norm"):
        clear_pack()
        update_pack(
            role="Senior SAP FICO Consultant",
            resume_text=RESUME_30PCT,
        )
        out = _normalize_answer_text(
            FABRICATED,
            question=QUESTION_MONTH_END,
            job_context="Senior SAP FICO Consultant",
        )
        low = out.lower()
        assert "10 days" not in low
        assert "40%" not in low
        assert "training sessions" not in low
        clear_pack()


def test_cascade_stage_a_before_llm(monkeypatch):
    from fast_answer import iter_cascade_answer
    from session_context import clear_pack, session_scope, update_pack

    def fake_stream(*_a, **_k):
        yield "Hook: I helped reduce month-end close time by 30% through "
        yield "reconciliation standardization and automation. Close: Glad to expand."

    monkeypatch.setenv("ASTRA_OUTLINE_FIRST", "1")
    monkeypatch.setenv("ASTRA_TEMPLATE_PAINT", "0")

    with session_scope("test_cascade_stage_a"):
        clear_pack()
        update_pack(
            role="Senior SAP FICO Consultant",
            resume_text=RESUME_30PCT,
            outline_first=True,
            depth="balanced",
        )
        events = list(
            iter_cascade_answer(
                QUESTION_MONTH_END,
                job_context="Senior SAP FICO Consultant",
                mode="star",
                llm_streamer=fake_stream,
            )
        )
        assert events
        first_text, first_meta = events[0]
        assert first_meta.get("source") in ("stage_a", "outline", "exact_cache")
        assert first_meta.get("first_paint_ms") is not None
        # Final must not contain fabrication
        final_text, final_meta = events[-1]
        assert final_meta.get("final") is True
        low = final_text.lower()
        assert "10 days" not in low
        assert "40%" not in low
        clear_pack()


def test_shorter_fast_completes_on_stage_a(monkeypatch):
    """Shorter+fast must not wait for LLM — Stage A is the full answer."""
    from fast_answer import iter_cascade_answer
    from session_context import clear_pack, session_scope, update_pack

    def boom(*_a, **_k):
        raise RuntimeError("LLM must not be required for shorter+fast Stage A")
        yield ""  # pragma: no cover

    monkeypatch.setenv("ASTRA_OUTLINE_FIRST", "1")
    monkeypatch.setenv("ASTRA_TEMPLATE_PAINT", "0")

    with session_scope("test_shorter_fast_stage_a"):
        clear_pack()
        update_pack(
            role="Senior SAP FICO Consultant",
            resume_text=RESUME_30PCT,
            outline_first=True,
            depth="fast",
        )
        events = list(
            iter_cascade_answer(
                QUESTION_MONTH_END,
                job_context="Senior SAP FICO Consultant",
                mode="shorter",
                llm_streamer=boom,
            )
        )
        assert events
        final_text, final_meta = events[-1]
        assert final_meta.get("final") is True
        assert final_meta.get("source") in ("stage_a", "exact_cache")
        low = final_text.lower()
        assert "30%" in low or "30 %" in low
        assert "10 days" not in low
        assert "40%" not in low
        assert (final_meta.get("full_ms") or 0) < 100
        clear_pack()


def test_llm_fail_keeps_stage_a_not_template(monkeypatch):
    from fast_answer import iter_cascade_answer
    from session_context import clear_pack, session_scope, update_pack

    def boom(*_a, **_k):
        raise RuntimeError("provider down")
        yield ""  # pragma: no cover

    monkeypatch.setenv("ASTRA_OUTLINE_FIRST", "1")
    monkeypatch.setenv("ASTRA_TEMPLATE_PAINT", "0")
    monkeypatch.setenv("ASTRA_TEMPLATE_FIRST", "1")

    with session_scope("test_stage_a_fallback"):
        clear_pack()
        update_pack(
            role="Senior SAP FICO Consultant",
            resume_text=RESUME_30PCT,
            depth="balanced",
            outline_first=True,
        )
        events = list(
            iter_cascade_answer(
                QUESTION_MONTH_END,
                job_context="Senior SAP FICO Consultant",
                mode="star",
                llm_streamer=boom,
            )
        )
        final_text, final_meta = events[-1]
        assert final_meta.get("final") is True
        # Must keep Stage A, not generic template_fallback
        assert final_meta.get("source") in (
            "stage_a_fallback",
            "stage_a",
            "draft_fallback",
        )
        assert "reframe this around a measurable outcome" not in final_text.lower()
        assert "30%" in final_text or "30 %" in final_text
        clear_pack()


def test_latency_total_not_confused_with_first_token():
    """Document the telemetry contract: total_ms must be full path."""
    from latency_metrics import LatencyRegistry, StageTrace

    reg = LatencyRegistry(maxlen=10)
    reg.reset()
    reg.record(
        StageTrace(
            question=QUESTION_MONTH_END,
            source="llm",
            first_token_ms=12.0,  # stage-A paint
            first_useful_ms=12.0,
            full_answer_ms=5540.0,
            total_ms=5540.0,
        )
    )
    snap = reg.snapshot()
    assert snap["stages"]["first_token_ms"]["p50"] == 12.0
    assert snap["stages"]["full_answer_ms"]["p50"] == 5540.0
    assert snap["stages"]["total_ms"]["p50"] == 5540.0
    # total must not equal first_token when full is slower
    assert snap["stages"]["total_ms"]["p50"] != snap["stages"]["first_token_ms"]["p50"]

