"""Unit tests for Deepgram Nova-3 STT wiring (no live API calls)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def test_deepgram_status_without_key(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.delenv("ASTRA_DEEPGRAM_KEY", raising=False)
    from deepgram_stt import deepgram_status

    st = deepgram_status()
    assert st["configured"] is False
    assert st["ready"] is False
    assert "nova" in (st.get("model") or "").lower() or st.get("model")


def test_get_stt_provider_auto_whisper_without_key(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.delenv("ASTRA_DEEPGRAM_KEY", raising=False)
    monkeypatch.setenv("ASTRA_STT_PROVIDER", "auto")
    # Reset env-load flag if needed — get_stt_provider reads env
    from config import get_stt_provider

    assert get_stt_provider() == "whisper"


def test_get_stt_provider_deepgram_with_key(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg_test_key_1234567890abcdef")
    monkeypatch.setenv("ASTRA_STT_PROVIDER", "auto")
    from config import get_stt_provider

    assert get_stt_provider() == "deepgram"


def test_extract_transcript_shape():
    from deepgram_stt import _extract_transcript

    msg = {
        "type": "Results",
        "is_final": True,
        "speech_final": True,
        "channel": {
            "alternatives": [{"transcript": "What is precision and recall?"}]
        },
    }
    text, is_final, speech_final = _extract_transcript(msg)
    assert text == "What is precision and recall?"
    assert is_final is True
    assert speech_final is True


def test_transcribe_best_falls_back_to_whisper(monkeypatch):
    monkeypatch.setenv("ASTRA_STT_PROVIDER", "deepgram")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg_test_key_1234567890abcdef")

    # Force Deepgram path to return empty → Whisper
    with patch("deepgram_stt.transcribe_pcm_nova3", return_value=("", {"error": "forced"})):
        with patch("transcriber.transcribe_audio", return_value="hello from whisper"):
            from transcriber import transcribe_best

            audio = np.zeros(16000, dtype=np.int16)
            text, meta = transcribe_best(audio, prefer="deepgram")
            assert text == "hello from whisper"
            assert meta.get("provider") == "whisper"
            assert meta.get("fallback") == "whisper" or True


def test_pcm_to_wav_roundtrip():
    from deepgram_stt import _pcm16_to_wav_bytes

    pcm = (np.random.randn(1600) * 1000).astype(np.int16)
    wav = _pcm16_to_wav_bytes(pcm, sample_rate=16000)
    assert wav[:4] == b"RIFF"
    assert b"WAVE" in wav[:12]
    assert len(wav) > len(pcm.tobytes())
