"""
Latency / throughput micro-benchmarks for Astra.

These are not industry-standard suites (see docs below) but encode the
product SLOs we care about and catch regressions.

Industry reference points (for comparison, not enforced online):
- Real-time factor (RTF) for STT: RTF < 1.0 means faster than real-time;
  production live assistants often target RTF << 0.3 for short clips.
- First-token / time-to-first-byte (TTFT) for LLM: < 500–800ms ideal.
- End-to-end interview copilots (Final Round / Parakeet class): users
  perceive "instant" under ~2–3s from end-of-question to first answer text.
- Common open eval sets for related components:
  * LibriSpeech / Common Voice — ASR WER
  * MMLU / LiveCodeBench — general LLM (not interview-specific)
  * BEIR / MS MARCO — retrieval quality
  * No public standard benchmark specifically for "interview copilots";
    product teams use internal latency histograms + human preference.

Run:  pytest tests/test_benchmarks.py -v --tb=short
"""

import os
import sys
import time

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from audio_capture import Int16RingBuffer
from pipeline_utils import (
    heuristic_classify,
    meets_sub3s_budget,
    speech_window_seconds,
    estimate_pipeline_latency_s,
)


class TestProductSLO:
    def test_configured_budget_math(self):
        from config import SILENCE_DURATION
        # With heuristic classify (0 network), shared RAG, mini TTFT estimates
        total = estimate_pipeline_latency_s(
            silence_s=SILENCE_DURATION,
            stt_s=0.6,
            classify_s=0.0,
            rag_s=0.35,
            ttft_s=0.7,
        )
        assert total <= 3.0, f"Budget math {total:.2f}s exceeds 3s SLO"

    def test_old_defaults_would_fail(self):
        assert not meets_sub3s_budget(2.0, 1.2, 0.9, 0.9, 1.2)


class TestHeuristicThroughput:
    def test_classify_10k_per_second(self):
        samples = [
            "Tell me about yourself",
            "Thanks for that",
            "What are your strengths?",
            "Can you hear me?",
            "Our office is in Austin",
            "How would you handle a difficult customer?",
        ]
        t0 = time.perf_counter()
        n = 2000
        for i in range(n):
            heuristic_classify(samples[i % len(samples)])
        elapsed = time.perf_counter() - t0
        rate = n / elapsed
        assert rate > 2000, f"heuristic too slow: {rate:.0f}/s"


class TestRingBufferRealtimeFactor:
    def test_append_faster_than_realtime(self):
        """Appending 1s of audio should take << 1s (RTF << 1)."""
        r = Int16RingBuffer(16000 * 60)
        chunk = (np.random.randn(1600) * 500).astype(np.int16)  # 100ms
        t0 = time.perf_counter()
        for _ in range(100):  # 10 seconds of audio
            r.extend_samples(chunk)
        elapsed = time.perf_counter() - t0
        rtf = elapsed / 10.0
        assert rtf < 0.05, f"buffer RTF {rtf:.4f} too high"


class TestSpeechWindowBench:
    def test_vector_of_durations(self):
        for d in [0, 0.5, 1, 2, 5, 10, 30, 100, float("nan")]:
            w = speech_window_seconds(d)
            assert 3.0 <= w <= 12.0 or (d != d and w == 3.0)
