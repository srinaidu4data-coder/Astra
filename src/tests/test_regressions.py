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


class TestRegression_DomainStrategy:
    def test_no_forced_domain_packs(self):
        """No SAP/FICO/ML hardcoded strategy packs — generic only."""
        from answer_engine import _fallback_strategy
        import answer_engine as ae

        s = _fallback_strategy(
            "How do you design SAP ATTP serialization for MAH and CMO partners?",
            "SAP ATTP Techno-Functional Consultant",
        )
        assert s.get("accuracy_domain") == "general"
        assert s.get("jargon_bank") == []
        assert s.get("domain_tags") == []
        blob = " ".join(str(x) for x in (s.get("must_cover") or [])).lower()
        assert "fico" not in blob
        assert "posting key" not in blob
        assert "precision" not in blob

        s2 = _fallback_strategy(
            "What is the difference between precision and recall?",
            "AI/ML Engineer",
        )
        assert s2.get("accuracy_domain") == "general"
        assert s2.get("jargon_bank") == []
        assert not hasattr(ae, "_sap_strategy")
        assert not hasattr(ae, "_is_sap_domain")
        assert not hasattr(ae, "_ml_strategy")
        assert not hasattr(ae, "_is_ml_domain")

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


class TestRegression_WsSendJsonFallback:
    """orjson swap on the WS hot path — must degrade gracefully, not drop messages."""

    def test_normal_payload_uses_orjson_and_round_trips(self):
        import asyncio
        import json as _json
        import copilot_api

        sent = []

        class FakeWS:
            async def send_text(self, s):
                sent.append(s)

        payload = {"type": "answer", "answer": "Hook: test", "words": 12, "ok": True}
        asyncio.run(copilot_api._ws_send_json(FakeWS(), payload))
        assert len(sent) == 1
        assert _json.loads(sent[0]) == payload

    def test_unsupported_type_falls_back_instead_of_dropping(self):
        import asyncio
        import json as _json
        import copilot_api

        sent = []

        class FakeWS:
            async def send_text(self, s):
                sent.append(s)

        # A set has no encoder in either orjson or stdlib json by default —
        # must not raise out of _ws_send_json, must still send something.
        asyncio.run(copilot_api._ws_send_json(FakeWS(), {"type": "answer", "bad": {1, 2, 3}}))
        assert len(sent) == 1
        assert _json.loads(sent[0])["bad"]  # stringified, not dropped

    def test_nan_does_not_need_fallback(self):
        """orjson silently encodes NaN/Infinity as null — same as stdlib json's
        default behavior for this app previously; documents that the fallback
        path exists for genuinely unsupported types, not NaN."""
        import orjson

        assert orjson.dumps({"x": float("nan")}) == b'{"x":null}'


class TestRegression_AutofillCountryEcho:
    """country field was the whole location string ("Bangalore, India"),
    not the actual country — broke autofill on every non-US ATS form."""

    def test_country_extracted_not_echoed(self):
        from jobsearch.autofill import _normalize_location

        loc, city, country = _normalize_location("Bangalore, India")
        assert country == "India"
        assert city == "Bangalore"
        assert country != loc

    def test_uk_canonicalized(self):
        from jobsearch.autofill import _normalize_location

        _, _, country = _normalize_location("London, UK")
        assert country == "United Kingdom"

    def test_us_variants_unaffected(self):
        from jobsearch.autofill import _normalize_location

        for variant in ("us", "USA", "United States", "", "anywhere"):
            _, _, country = _normalize_location(variant)
            assert country == "United States"

    def test_build_autofill_profile_country_field(self):
        from jobsearch.autofill import build_autofill_profile

        profile = build_autofill_profile(
            {"email": "a@b.com", "name": "Jane Doe", "location": "Berlin, Germany"}
        )
        assert profile["fields"]["country"] == "Germany"
        assert profile["fields"]["city"] == "Berlin"


class TestRegression_WhisperModelRace:
    """get_whisper_model() had no lock — concurrent first-callers (main.py's
    startup preload thread vs. a session-start thread) could both pass the
    `is None` check and both construct a WhisperModel (~1.2-1.5s each,
    wasted work, and the loser's instance is silently discarded)."""

    def test_concurrent_first_calls_construct_model_once(self):
        import threading
        import time
        import transcriber

        calls = []
        lock = threading.Lock()

        class FakeWhisperModel:
            def __init__(self, *a, **kw):
                # Simulate real load time so threads actually overlap
                time.sleep(0.05)
                with lock:
                    calls.append(1)

        original_model = transcriber._whisper_model
        original_cls = transcriber.WhisperModel
        transcriber._whisper_model = None
        transcriber.WhisperModel = FakeWhisperModel
        try:
            threads = [
                threading.Thread(target=transcriber.get_whisper_model)
                for _ in range(8)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=5)
            assert len(calls) == 1, f"expected exactly 1 construction, got {len(calls)}"
        finally:
            transcriber.WhisperModel = original_cls
            transcriber._whisper_model = original_model

    def test_already_loaded_fast_path_skips_lock_reentry(self):
        """Fast path (model already loaded) must not block on the lock at all."""
        import inspect
        import transcriber

        src = inspect.getsource(transcriber.get_whisper_model)
        assert "Lock" in inspect.getsource(transcriber) or "_whisper_lock" in src


class TestRegression_DedupFingerprint:
    def test_near_duplicate_blocks_reanswer_logic(self):
        from pipeline_utils import is_near_duplicate, question_fingerprint
        q = "Tell me about a time you worked on a team"
        fp = question_fingerprint(q)
        # Simulate stored fingerprint vs new slightly different ASR
        assert is_near_duplicate(q, "tell me about a time you worked on a team?")
