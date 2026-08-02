"""Smoke tests for AI latency agent helpers (no live network required)."""

from latency_ai_agent import SpanTracker, rule_based_verdict


def test_span_tracker_ms_precision():
    t = SpanTracker()
    t.start("x")
    # tiny work
    _ = sum(range(1000))
    ms = t.end()
    assert ms >= 0
    assert isinstance(ms, float)
    s = t.summary()
    assert s["span_count"] == 1
    assert s["stages_ranked"][0]["stage"] == "x"


def test_rule_based_flags_openai_llama_mismatch():
    summary = {
        "stages_ranked": [
            {"stage": "llm_ttft", "avg_ms": 2100, "ok": True},
            {"stage": "stt_deepgram", "avg_ms": 900, "ok": True},
            {"stage": "cache_lookup", "avg_ms": 0.1, "ok": True},
            {"stage": "outline_skeleton", "avg_ms": 0.2, "ok": True},
        ]
    }
    cfg = {
        "llm_provider": "openai",
        "answer_model": "llama-3.3-70b-versatile",
        "fast_model": "llama-3.1-8b-instant",
        "stt_provider_resolved": "deepgram",
    }
    v = rule_based_verdict(summary, cfg, {})
    assert v["invest_in"] == "model"
    assert any("CONFIG BUG" in a or "GROQ" in a.upper() or "groq" in a for a in v["next_actions"])


def test_rule_based_stt_primary_when_stt_dominates():
    summary = {
        "stages_ranked": [
            {"stage": "stt_whisper", "avg_ms": 2800, "ok": True},
            {"stage": "llm_ttft", "avg_ms": 350, "ok": True},
            {"stage": "llm_full_generate", "avg_ms": 900, "ok": True},
            {"stage": "cache_lookup", "avg_ms": 0.1, "ok": True},
            {"stage": "outline_skeleton", "avg_ms": 0.2, "ok": True},
        ]
    }
    cfg = {
        "llm_provider": "groq",
        "answer_model": "llama-3.3-70b-versatile",
        "fast_model": "llama-3.1-8b-instant",
        "stt_provider_resolved": "whisper",
    }
    v = rule_based_verdict(summary, cfg, {})
    assert v["invest_in"] == "stt"
    assert v["primary_bottleneck"] == "stt"
