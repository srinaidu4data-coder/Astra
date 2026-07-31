"""
End-to-end feature test: audio -> STT -> classify -> answer.

Run:
  python -m pytest tests/test_e2e_pipeline.py -v -s
Requires OPENAI_API_KEY (or project .env) and network.
"""

from __future__ import annotations

import os
import sys
import tempfile
import time

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import LICENSE_ENABLED, SILENCE_THRESHOLD, get_openai_api_key


def _require_key():
    from config import is_usable_openai_api_key

    key = get_openai_api_key()
    if not key or not is_usable_openai_api_key(key):
        pytest.skip("OPENAI_API_KEY missing or placeholder (set a real key in src/.env)")
    return key


class TestE2EPipeline:
    def test_license_off_and_key_present(self):
        assert LICENSE_ENABLED is False
        assert _require_key()

    def test_audio_capture_hears_system_mix(self):
        from audio_capture import get_audio_capture

        cap = get_audio_capture()
        cap.start_capture()
        time.sleep(1.5)
        level = cap.get_audio_level()
        samples = cap.get_last_n_seconds(1)
        cap.stop_capture()
        assert len(samples) > 1000, "no samples buffered"
        # Level may be near silence if nothing is playing — still must receive PCM
        assert samples.dtype == np.int16
        print(f"\n[audio] device={cap.device} level={level:.4f} samples={len(samples)}")

    def test_whisper_stt_on_tts_audio(self):
        """Full STT path using OpenAI TTS as known speech source."""
        key = _require_key()
        from openai import OpenAI
        from transcriber import get_whisper_model, transcribe_audio

        client = OpenAI(api_key=key)
        phrase = "What is your biggest strength?"
        mp3 = os.path.join(tempfile.gettempdir(), "astra_e2e_stt.mp3")
        with client.audio.speech.with_streaming_response.create(
            model="tts-1", voice="alloy", input=phrase
        ) as resp:
            resp.stream_to_file(mp3)

        # Decode mp3 → int16 16kHz (prefer soundfile / audioread / whisper path)
        audio = _load_mp3_as_int16_16k(mp3)
        assert len(audio) > 8000

        get_whisper_model()
        text = transcribe_audio(audio)
        print(f"\n[stt] transcript={text!r}")
        assert text and len(text.strip()) > 3
        # loose match — tiny.en may paraphrase slightly
        low = text.lower()
        assert any(w in low for w in ("strength", "biggest", "what", "your"))

    def test_classify_and_generate_answer(self):
        _require_key()
        from rag import classify_utterance, ask_script, search_context

        q = "What is your biggest strength?"
        cls = classify_utterance(q)
        print(f"\n[classify] {cls}")
        assert cls.get("is_interview_question") is True

        chunks = []
        try:
            chunks = search_context(q)
        except Exception as e:
            print(f"[rag] {e}")

        parts = []
        for tok in ask_script(
            cls.get("cleaned_question") or q,
            job_context="babysitter",
            tone="casual",
            context_chunks=chunks,
        ):
            parts.append(tok)
        answer = "".join(parts)
        print(f"\n[answer] {answer}")
        assert len(answer) > 30
        assert " " in answer


def _load_mp3_as_int16_16k(path: str) -> np.ndarray:
    """Decode mp3 without requiring ffmpeg if possible."""
    # Try pydub
    try:
        from pydub import AudioSegment

        seg = AudioSegment.from_file(path)
        seg = seg.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        return np.frombuffer(seg.raw_data, dtype=np.int16)
    except Exception:
        pass
    # Try imageio-ffmpeg / av
    try:
        import subprocess
        import shutil

        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            raw = path + ".raw"
            subprocess.check_call(
                [ffmpeg, "-y", "-i", path, "-ac", "1", "-ar", "16000", "-f", "s16le", raw],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            data = np.fromfile(raw, dtype=np.int16)
            os.remove(raw)
            return data
    except Exception:
        pass
    # Last resort: openai whisper-compatible — use scipy wav if we convert via openai returns
    # Generate silence+skip: raise to skip STT file decode environments
    pytest.skip("Cannot decode mp3 (install pydub or ffmpeg for full STT file test)")
