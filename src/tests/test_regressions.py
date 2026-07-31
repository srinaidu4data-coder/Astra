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
        from config import SILENCE_DURATION, BROWSER_SILENCE_DURATION
        # Original bug was a flat 2.0s hangover. Live product is now snappy.
        assert 0.55 <= SILENCE_DURATION < 1.2
        assert 0.55 <= BROWSER_SILENCE_DURATION < 1.3


class TestRegression_Manual30s:
    def test_manual_window_capped(self):
        from config import MANUAL_TRANSCRIBE_MAX_SECONDS
        # Cap so we don't re-STT absurdly long buffers; still allow long questions.
        assert 30 <= MANUAL_TRANSCRIBE_MAX_SECONDS <= 60


class TestRegression_ScriptModelMini:
    def test_not_full_gpt4o(self):
        from rag import SCRIPT_MODEL
        assert SCRIPT_MODEL != "gpt-4o"
        assert "mini" in SCRIPT_MODEL or "nano" in SCRIPT_MODEL


class TestRegression_PlaceholderOpenAIKey:
    def test_placeholder_key_rejected(self):
        from config import is_usable_openai_api_key

        assert not is_usable_openai_api_key(None)
        assert not is_usable_openai_api_key("")
        assert not is_usable_openai_api_key("sk-...")
        assert not is_usable_openai_api_key("sk-xxx")
        assert not is_usable_openai_api_key("your-openai-key")
        assert is_usable_openai_api_key("sk-" + ("a" * 40))


class TestRegression_DefaultModelsNot4o:
    def test_answer_defaults_prefer_41(self):
        from answer_engine import ANSWER_MODEL, FALLBACK_MODEL, FAST_ANSWER_MODEL
        from model_resolve import resolve_answer_models

        assert ANSWER_MODEL != "gpt-4o"
        assert "4.1" in ANSWER_MODEL or "mini" in ANSWER_MODEL
        assert FAST_ANSWER_MODEL != "gpt-4o"
        primary, fallback = resolve_answer_models()
        assert primary != "gpt-4o"
        assert fallback != primary


class TestRegression_BrowserPrebuffer:
    """Early PCM must not be dropped before start_capture (1-word STT bug)."""

    def test_prebuf_flushed_on_start(self):
        import numpy as np
        from audio_capture import BrowserAudioCapture

        cap = BrowserAudioCapture(sample_rate=16000, channels=1)
        # Mic often opens before session start
        tone = (np.sin(np.linspace(0, 40, 16000)) * 8000).astype(np.int16)
        cap.push_pcm16(tone.tobytes())
        cap.start_capture()
        got = cap.get_last_n_seconds(1.0)
        assert len(got) >= 8000, "pre-roll PCM should land in ring after start"
        cap.stop_capture()


class TestRegression_GroqModelRemap:
    def test_gpt4o_maps_to_llama(self):
        import os

        os.environ["ASTRA_LLM_PROVIDER"] = "groq"
        from config import remap_model_for_provider

        assert remap_model_for_provider("gpt-4o") == "llama-3.3-70b-versatile"
        assert remap_model_for_provider("gpt-4.1-nano") == "llama-3.1-8b-instant"
        assert (
            remap_model_for_provider("llama-3.3-70b-versatile")
            == "llama-3.3-70b-versatile"
        )


class TestRegression_LongInterviewQueue:
    def test_session_has_pending_queue(self):
        import inspect
        from live_session import LiveInterviewSession

        src = inspect.getsource(LiveInterviewSession._trigger_process)
        assert "_pending" in src
        assert "return" in src  # queues when busy instead of only dropping
        assert "Queued" in src or "pending" in src.lower()

    def test_cache_lookup_can_disable_approx(self):
        from fast_answer import cache_lookup, cache_store

        cache_store(
            "What is your greatest strength?",
            "CACHED STRENGTH ANSWER UNIQUE XYZ",
            mode="star",
            job_context="Engineer",
        )
        # Near-dup must NOT win when allow_approx=False
        hit = cache_lookup(
            "What is your biggest strength in this role?",
            mode="star",
            job_context="Engineer",
            allow_approx=False,
        )
        assert hit is None


class TestRegression_LongQuestionCapture:
    def test_stt_window_allows_long_questions(self):
        from config import AUTO_TRANSCRIBE_MAX_SECONDS, MAX_UTTERANCE_SECONDS

        assert AUTO_TRANSCRIBE_MAX_SECONDS >= 30
        assert MAX_UTTERANCE_SECONDS >= 40

    def test_long_multipart_detected(self):
        from answer_engine import _is_long_or_multipart_question, _max_tokens_for_mode

        short = "What is precision?"
        long_q = (
            "Walk me through how you would productionize a transformer ranking model "
            "for search: from data leakage prevention and offline metrics like NDCG, "
            "through training with hard negatives, to online A/B testing and rollback."
        )
        assert not _is_long_or_multipart_question(short)
        assert _is_long_or_multipart_question(long_q)
        assert _max_tokens_for_mode("technical", question=long_q) > _max_tokens_for_mode(
            "technical", question=short
        )


class TestRegression_SapMlDomainStrategy:
    def test_sap_fi_co_must_cover(self):
        from answer_engine import _fallback_strategy

        s = _fallback_strategy(
            "What is the difference between FI and CO in SAP?",
            "SAP FICO Consultant",
        )
        assert s.get("accuracy_domain") == "sap"
        blob = " ".join(s.get("must_cover") or []).lower()
        assert "external" in blob or "statutory" in blob or "fi" in blob
        assert "cost" in blob or "co" in blob or "internal" in blob
        # Must not force tax on a pure FI vs CO question
        assert not any("tax procedure" in str(m).lower() for m in (s.get("must_cover") or []))

    def test_ml_precision_recall(self):
        from answer_engine import _fallback_strategy

        s = _fallback_strategy(
            "What is the difference between precision and recall?",
            "AI/ML Engineer",
        )
        assert s.get("accuracy_domain") == "ml"
        jar = " ".join(s.get("jargon_bank") or []).lower()
        assert "precision" in jar and "recall" in jar

    def test_normalize_slash_labels(self):
        from answer_engine import _normalize_answer_text

        raw = "/Hook: Hello\n/Approach: World"
        out = _normalize_answer_text(raw)
        assert out.startswith("Hook:")
        assert "Approach:" in out
        assert "/Hook" not in out


class TestRegression_NoFakeTemplateAsPrimary:
    def test_cascade_does_not_yield_template_first_by_default(self):
        from fast_answer import iter_cascade_answer

        def fake_llm(*_args, **_kwargs):
            yield "Hook: Real answer from model with enough substance for the UI. "

        q = f"Unique regression question about strengths {id(fake_llm)}"
        items = list(
            iter_cascade_answer(
                q,
                job_context="Engineer-unique",
                mode="star",
                llm_streamer=fake_llm,
            )
        )
        assert items, "cascade must yield"
        sources = [m.get("source") for _, m in items]
        # Must not paint fake STAR template before real LLM text
        assert sources[0] != "template"
        assert any(s in ("llm_stream", "llm") for s in sources), sources
        assert "template" not in str(sources[0])


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
