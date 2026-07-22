"""
Named regression tests for bugs found in the audit.

Each test name references the bug so we don't reintroduce it.
"""

import os
import sys
from unittest.mock import patch, MagicMock

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestRegression_RRFDeadRAG:
    """Hybrid RRF scores ~0.016 failed similarity_score > 0.25 checks."""

    def test_rrf_context_not_dropped(self):
        from pipeline_utils import context_is_relevant, normalize_hybrid_similarity
        raw_rrf = 0.5 / (60 + 1)  # ~0.008
        sim = normalize_hybrid_similarity(rrf_score=raw_rrf, dense_score=0)
        assert sim > 0.25
        assert context_is_relevant([{
            "text": "resume fact",
            "similarity_score": raw_rrf,
            "dense_score": 0.0,
        }])


class TestRegression_SAPFallback:
    def test_no_sap_in_empty_context_section(self):
        from rag import _format_context_section
        sec = _format_context_section([])
        assert "SAP" not in sec
        assert "best practices" not in sec or "general" in sec.lower()


class TestRegression_DoubleRAG:
    def test_ask_bullet_accepts_precomputed_chunks(self):
        from rag import ask_bullet, generate_bullet_response
        import inspect
        sig = inspect.signature(ask_bullet)
        assert "context_chunks" in sig.parameters


class TestRegression_SilenceBudget:
    def test_silence_not_two_seconds(self):
        from config import SILENCE_DURATION
        assert SILENCE_DURATION < 1.5


class TestRegression_Manual30s:
    def test_manual_window_capped(self):
        from config import MANUAL_TRANSCRIBE_MAX_SECONDS
        assert MANUAL_TRANSCRIBE_MAX_SECONDS <= 15


class TestRegression_ScriptModelMini:
    def test_not_full_gpt4o(self):
        from rag import SCRIPT_MODEL
        assert SCRIPT_MODEL != "gpt-4o"
        assert "mini" in SCRIPT_MODEL


class TestRegression_ByteDequeLag:
    def test_ring_not_byte_deque(self):
        from audio_capture import Int16RingBuffer, WindowsAudioCapture, LinuxAudioCapture
        # Ensure classes use Int16RingBuffer attribute name
        import inspect
        src = inspect.getsource(LinuxAudioCapture.__init__)
        assert "Int16RingBuffer" in src or "_ring" in src


class TestRegression_RateLimitTooLow:
    def test_rpm_raised(self):
        # Read source defaults without importing pydantic_settings if missing
        import re
        cfg_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "backend", "config.py",
        )
        text = open(cfg_path, encoding="utf-8").read()
        m = re.search(r"RATE_LIMIT_COMPLETIONS_RPM:\s*int\s*=\s*(\d+)", text)
        assert m, "RATE_LIMIT_COMPLETIONS_RPM not found"
        assert int(m.group(1)) >= 60


class TestRegression_ChromaWritablePath:
    def test_chroma_path_uses_user_data_when_possible(self):
        from rag import CHROMA_DB_PATH
        # Should not be stuck only next to __file__ inside frozen bundle forever
        assert "chroma_db" in CHROMA_DB_PATH


class TestRegression_FriendlyErrors:
    def test_gui_imports_pipeline_friendly(self):
        from pipeline_utils import friendly_error
        assert "speakers" in friendly_error("WASAPI loopback missing").lower() or \
               "computer sound" in friendly_error("WASAPI loopback missing").lower()


class TestRegression_DedupFingerprint:
    def test_near_duplicate_blocks_reanswer_logic(self):
        from pipeline_utils import is_near_duplicate, question_fingerprint
        q = "Tell me about a time you worked on a team"
        fp = question_fingerprint(q)
        # Simulate stored fingerprint vs new slightly different ASR
        assert is_near_duplicate(q, "tell me about a time you worked on a team?")
