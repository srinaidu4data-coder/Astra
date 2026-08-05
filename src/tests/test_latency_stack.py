"""Unit tests for latency metrics, session context, outline-first cascade."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def test_latency_registry_record_and_snapshot():
    from latency_metrics import LatencyRegistry, StageTrace

    reg = LatencyRegistry(maxlen=50)
    reg.reset()
    reg.record(
        StageTrace(
            question="What is precision vs recall?",
            source="llm",
            depth="balanced",
            stt_ms=1500,
            first_token_ms=350,
            full_answer_ms=1600,
            total_ms=3100,
            outline_ms=0.4,
            cache_ms=0.1,
        )
    )
    reg.record(
        StageTrace(
            question="Tell me about yourself",
            source="exact_cache",
            depth="fast",
            first_token_ms=1.2,
            full_answer_ms=1.2,
            total_ms=1.2,
            from_cache=True,
        )
    )
    snap = reg.snapshot()
    assert snap["sample_count"] == 2
    assert snap["stages"]["first_token_ms"]["n"] == 2
    assert snap["stages"]["first_token_ms"]["p50"] is not None
    assert "comparison" in snap
    assert len(snap["comparison"]) >= 5
    assert snap["verdict"]["rank_vs_market"] in ("leading", "competitive", "behind")
    assert "first_token_ms" in snap["grades"]


def test_competitor_benchmarks_present():
    from latency_metrics import COMPETITOR_BENCHMARKS, MARKET_BARS

    assert "cluely" in COMPETITOR_BENCHMARKS
    assert "final_round" in COMPETITOR_BENCHMARKS
    assert MARKET_BARS["first_token_ms"]["excellent"] == 400
    assert MARKET_BARS["full_answer_ms"]["good"] == 3000


def test_session_context_pack():
    from session_context import clear_pack, format_for_prompt, get_depth, update_pack

    clear_pack()
    pack = update_pack(
        role="AI/ML Engineer",
        company="Acme",
        resume_text="Built ranking models with NDCG optimization.",
        stories=["Led migration of feature store under p99 budget."],
        depth="fast",
        outline_first=True,
    )
    assert pack.role == "AI/ML Engineer"
    assert get_depth() == "fast"
    blob = format_for_prompt()
    assert "INTERVIEW MATERIALS" in blob
    assert "Acme" in blob
    assert "NDCG" in blob or "ranking" in blob
    clear_pack()


def test_outline_skeleton_no_fake_metrics():
    from fast_answer import outline_skeleton

    text = outline_skeleton(
        "Tell me about a time you failed",
        job_context="Software Engineer",
        mode="star",
    )
    assert "Outline" in text or "STAR" in text
    assert "Situation" in text
    # Must not invent percentage success claims like old templates
    assert "30–40%" not in text
    assert "30-40%" not in text


def test_outline_cascade_paints_before_llm(monkeypatch):
    from fast_answer import iter_cascade_answer

    def fake_stream(*_args, **_kwargs):
        yield "Hook: Precision is TP/(TP+FP). "
        yield "Recall is TP/(TP+FN). Tradeoff is threshold."

    monkeypatch.setenv("ASTRA_OUTLINE_FIRST", "1")
    monkeypatch.setenv("ASTRA_TEMPLATE_PAINT", "0")

    events = list(
        iter_cascade_answer(
            "What is the difference between precision and recall?",
            job_context="AI/ML Engineer",
            mode="technical",
            llm_streamer=fake_stream,
        )
    )
    assert len(events) >= 2
    first_text, first_meta = events[0]
    assert first_meta.get("source") in ("outline", "exact_cache")
    if first_meta.get("source") == "outline":
        assert first_meta.get("outline_first") is True
        assert first_meta.get("first_paint_ms") is not None
        assert "Outline" in first_text or "Hook" in first_text
    final_text, final_meta = events[-1]
    assert final_meta.get("final") is True
    assert "Precision" in final_text or final_meta.get("source") == "llm"


def test_cache_hit_is_sub_ms_path():
    from fast_answer import cache_store, iter_cascade_answer

    q = "What is your greatest strength? cache-test-xyz"
    ans = "Hook: I ship reliable systems with clear metrics.\nClose: happy to go deeper."
    cache_store(q, ans, mode="star", job_context="SWE")
    events = list(
        iter_cascade_answer(
            q,
            job_context="SWE",
            mode="star",
            llm_streamer=None,
        )
    )
    assert len(events) == 1
    text, meta = events[0]
    assert meta.get("from_cache") is True
    assert "cache" in (meta.get("source") or "")
    assert meta.get("first_paint_ms", 99) < 50
    assert ans.split()[0] in text


def test_answer_depth_tokens():
    from answer_engine import _answer_depth, _max_tokens_for_mode
    from session_context import clear_pack, update_pack

    clear_pack()
    update_pack(depth="fast")
    assert _answer_depth() == "fast"
    fast_tok = _max_tokens_for_mode("star", question="Tell me about yourself")
    update_pack(depth="deep")
    deep_tok = _max_tokens_for_mode("star", question="Tell me about yourself")
    assert deep_tok > fast_tok
    clear_pack()
