"""Unit + extreme-case tests for pipeline_utils (no network / no Qt)."""

import math
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline_utils import (
    speech_window_seconds,
    estimate_pipeline_latency_s,
    meets_sub3s_budget,
    normalize_hybrid_similarity,
    context_is_relevant,
    heuristic_classify,
    friendly_error,
    question_fingerprint,
    is_near_duplicate,
)


class TestSpeechWindow:
    def test_normal_speech(self):
        assert speech_window_seconds(4.0) == pytest.approx(4.75)

    def test_short_speech_clamped_to_min(self):
        assert speech_window_seconds(0.2) == 3.0

    def test_long_speech_clamped_to_max(self):
        assert speech_window_seconds(60.0) == 12.0

    def test_zero(self):
        assert speech_window_seconds(0) == 3.0

    def test_negative(self):
        assert speech_window_seconds(-5) == 3.0

    def test_nan(self):
        assert speech_window_seconds(float("nan")) == 3.0

    def test_none_string(self):
        assert speech_window_seconds("bad") == 3.0  # type: ignore

    def test_custom_bounds(self):
        assert speech_window_seconds(1.0, min_seconds=2.0, max_seconds=5.0, pad_seconds=0) == 2.0
        assert speech_window_seconds(10.0, min_seconds=2.0, max_seconds=5.0, pad_seconds=0) == 5.0


class TestLatencyBudget:
    def test_target_path_under_3s(self):
        # New defaults: silence 0.8 + heuristic classify 0 + reasonable STT/RAG/TTFT
        assert meets_sub3s_budget(
            silence_s=0.8, stt_s=0.5, classify_s=0.0, rag_s=0.3, ttft_s=0.6
        )

    def test_old_path_over_3s(self):
        # Old: silence 2.0 + STT + LLM classify + double RAG + gpt-4o TTFT
        assert not meets_sub3s_budget(
            silence_s=2.0, stt_s=1.0, classify_s=0.8, rag_s=0.8, ttft_s=1.0
        )

    def test_sum(self):
        assert estimate_pipeline_latency_s(1, 1, 1, 1, 1) == 5.0

    def test_negative_ignored(self):
        assert estimate_pipeline_latency_s(-1, 1, 0, 0, 0) == 1.0

    def test_nan_ignored(self):
        assert estimate_pipeline_latency_s(float("nan"), 2, 0, 0, 0) == 2.0


class TestHybridScores:
    def test_dense_wins(self):
        assert normalize_hybrid_similarity(rrf_score=0.01, dense_score=0.72) == pytest.approx(0.72)

    def test_rrf_scaled_passes_threshold(self):
        # Max-ish RRF ~0.5/61 ≈ 0.008 → scaled ~0.5
        sim = normalize_hybrid_similarity(rrf_score=0.0082, dense_score=0)
        assert sim > 0.25  # old broken threshold

    def test_zero(self):
        assert normalize_hybrid_similarity(None, None) == 0.0

    def test_context_empty(self):
        assert context_is_relevant([]) is False

    def test_context_dense(self):
        assert context_is_relevant([{"dense_score": 0.5, "similarity_score": 0.01}])

    def test_context_tiny_rrf_topk_still_used(self):
        # Regression: hybrid RRF was treated as cosine → always empty context
        assert context_is_relevant([{"similarity_score": 0.012, "dense_score": 0.0}])


class TestHeuristicClassify:
    def test_tell_me_about(self):
        r = heuristic_classify("Tell me about a time you failed")
        assert r is not None
        assert r["is_interview_question"] is True
        assert r["source"] == "heuristic"
        assert r["confidence"] >= 0.85

    def test_why_this_job(self):
        r = heuristic_classify("Why do you want this job?")
        assert r is not None
        assert r["is_interview_question"] is True

    def test_strengths(self):
        r = heuristic_classify("What are your strengths?")
        assert r is not None
        assert r["is_interview_question"] is True

    def test_question_mark(self):
        r = heuristic_classify("How do you handle stress at work?")
        assert r is not None
        assert r["is_interview_question"] is True

    def test_short_noise(self):
        r = heuristic_classify("uh")
        assert r is not None
        assert r["is_interview_question"] is False

    def test_empty(self):
        r = heuristic_classify("")
        assert r is not None
        assert r["is_interview_question"] is False

    def test_none(self):
        r = heuristic_classify(None)  # type: ignore
        assert r is not None
        assert r["is_interview_question"] is False

    def test_ignore_thanks(self):
        r = heuristic_classify("Thanks for that answer")
        assert r is not None
        assert r["is_interview_question"] is False

    def test_ignore_can_you_hear(self):
        r = heuristic_classify("Can you hear me okay")
        assert r is not None
        assert r["is_interview_question"] is False

    def test_ambiguous_returns_none(self):
        # Statement without clear question pattern
        r = heuristic_classify("Our team works mostly with Python and cloud systems")
        assert r is None  # needs LLM

    def test_technical_type(self):
        r = heuristic_classify("Explain how a hash map works")
        assert r is not None
        assert r["question_type"] == "technical"

    def test_whitespace_cleanup(self):
        r = heuristic_classify("   Tell me about   yourself   ")
        assert r is not None
        assert r["is_interview_question"] is True
        assert "  " not in r["cleaned_question"]


class TestFriendlyError:
    def test_license(self):
        assert "license" in friendly_error("License key not configured").lower() or \
               "Activate" in friendly_error("License key not configured")

    def test_wasapi(self):
        msg = friendly_error("No WASAPI loopback device found")
        assert "computer sound" in msg.lower() or "speakers" in msg.lower()

    def test_rate(self):
        assert "wait" in friendly_error("429 rate limited").lower()

    def test_passthrough(self):
        assert friendly_error("weird unique error xyz") == "weird unique error xyz"

    def test_none(self):
        assert "wrong" in friendly_error(None).lower()


class TestDedup:
    def test_exact(self):
        assert is_near_duplicate("Tell me about yourself", "Tell me about yourself")

    def test_punctuation(self):
        assert is_near_duplicate("Tell me about yourself?", "tell me about yourself")

    def test_different(self):
        assert not is_near_duplicate(
            "Tell me about a time you failed",
            "What are your salary expectations",
        )

    def test_empty(self):
        assert not is_near_duplicate("", "hello")
        assert not is_near_duplicate("hello", "")

    def test_fingerprint_stable(self):
        assert question_fingerprint("Hello, World!") == question_fingerprint("hello world")
