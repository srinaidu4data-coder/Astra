#!/usr/bin/env python3
"""
System Audio Transcription for Astra MVP.

Uses platform-agnostic AudioCapture abstraction and transcribes
using faster-whisper (local) or Deepgram Nova-3 (streaming, preferred).
"""

import os
import threading
import time

import numpy as np
from faster_whisper import WhisperModel

from audio_capture import get_audio_capture, AudioCapture
from config import (
    AUDIO_SAMPLE_RATE,
    WHISPER_BEAM_SIZE,
    WHISPER_MODEL,
    WHISPER_DEVICE,
    WHISPER_COMPUTE_TYPE,
    get_stt_provider,
)


# Global Whisper model (lazy loaded)
_whisper_model = None
_whisper_lock = threading.Lock()


def get_whisper_model() -> WhisperModel:
    """
    Get or initialize the Whisper model.

    Double-checked locking (same pattern as rag._get_openai_client): the
    fast path (model already loaded — nearly every call) never touches the
    lock. Only the first-ever call(s) can race, which is real in practice —
    main.py preloads on the main thread at startup while live_session.py's
    session-start thread also calls this; without the lock both could pass
    the `is None` check and each construct a full WhisperModel (~1.2-1.5s
    wasted, one instance silently discarded).
    """
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            print(f"Loading Whisper model '{WHISPER_MODEL}'...")
            _whisper_model = WhisperModel(
                WHISPER_MODEL,
                device=WHISPER_DEVICE,
                compute_type=WHISPER_COMPUTE_TYPE
            )
            print("Model loaded.")
    return _whisper_model


def _trim_silence_edges(
    audio: np.ndarray,
    *,
    sample_rate: int = 16000,
    thr: float = 0.012,
    pad_ms: int = 120,
) -> np.ndarray:
    """
    Drop leading/trailing near-silence so Whisper processes less audio (faster).
    Keeps a small pad so the first/last word is not clipped.
    """
    if audio is None or len(audio) == 0:
        return audio
    abs_a = np.abs(audio)
    # Frame energy ~10ms
    frame = max(1, int(sample_rate * 0.01))
    n = len(abs_a) // frame
    if n < 3:
        return audio
    energy = abs_a[: n * frame].reshape(n, frame).mean(axis=1)
    speech = np.where(energy >= thr)[0]
    if speech.size == 0:
        return audio
    pad = max(1, int(pad_ms / 10))  # frames
    start_f = max(0, int(speech[0]) - pad)
    end_f = min(n, int(speech[-1]) + pad + 1)
    start = start_f * frame
    end = min(len(audio), end_f * frame)
    if end - start < sample_rate * 0.35:
        return audio
    return audio[start:end]


def transcribe_audio(
    audio_array: np.ndarray,
    *,
    initial_prompt: str | None = None,
) -> str:
    """
    Transcribe audio from numpy array (accuracy-first for live interviews).

    Args:
        audio_array: numpy array of 16-bit audio at 16kHz
        initial_prompt: optional domain vocabulary hint for Whisper

    Returns:
        Transcribed text string
    """
    if audio_array is None or len(audio_array) == 0:
        print("Warning: Empty audio buffer - check if audio is playing")
        return ""

    sr = int(AUDIO_SAMPLE_RATE or 16000)
    # Convert int16 to float32 normalized [-1.0, 1.0] for faster-whisper
    audio_float32 = audio_array.astype(np.float32) / 32768.0

    # Stereo Mix / loopback / browser mic are often quiet — boost before trim/STT
    peak = float(np.max(np.abs(audio_float32))) + 1e-9
    if peak < 0.22:
        # Target peak ~0.55 so Whisper "hears" loopback as clearly as file audio
        target = 0.55
        gain = min(40.0, target / peak)
        audio_float32 = np.clip(audio_float32 * gain, -1.0, 1.0)
        print(f"[stt] boosted quiet audio peak {peak:.4f} -> gain {gain:.1f}x")

    # Trim silence edges — biggest free speedup (less audio into Whisper)
    before = len(audio_float32)
    # Slightly lower thr so soft word onsets (especially after boost) are kept
    audio_float32 = _trim_silence_edges(audio_float32, sample_rate=sr, thr=0.008)
    if len(audio_float32) < before:
        print(f"[stt] trimmed {before / sr:.2f}s -> {len(audio_float32) / sr:.2f}s")

    # Cap only extreme clips — long multi-clause questions need 20–40s
    max_s = float(os.environ.get("ASTRA_STT_MAX_SECONDS", "45") or "45")
    max_samples = int(sr * max(12.0, max_s))
    if len(audio_float32) > max_samples:
        # Prefer keeping the START of the question (not only the tail)
        # Tail-only was dropping "In a complex multi-company…" openings
        audio_float32 = audio_float32[:max_samples]

    # Reject near-silent clips early (common when VAD fires on noise)
    peak2 = float(np.max(np.abs(audio_float32))) + 1e-9
    if peak2 < 0.01:
        print(f"[stt] skip near-silent clip peak={peak2:.4f}")
        return ""

    model = get_whisper_model()
    beam = max(1, int(WHISPER_BEAM_SIZE or 2))
    # Domain vocabulary reduces "SAPS slash for HANA" style errors
    prompt = (initial_prompt or os.environ.get("ASTRA_STT_PROMPT") or "").strip()
    if not prompt:
        prompt = (
            "Interview questions about software engineering, AI, machine learning, "
            "SAP S/4HANA Finance, FICO, Vertex O Series tax, GL, cost centers."
        )

    # Skip Whisper internal VAD — we already edge-trim; Silero often chops starts.
    segments, _ = model.transcribe(
        audio_float32,
        beam_size=beam,
        best_of=1,
        temperature=0.0,
        vad_filter=False,
        language="en",
        condition_on_previous_text=False,
        without_timestamps=True,
        initial_prompt=prompt[:224],
        # Slightly more tolerant of soft/technical speech than stock defaults
        compression_ratio_threshold=2.6,
        log_prob_threshold=-1.2,
        no_speech_threshold=0.5,
    )

    text_parts = [segment.text for segment in segments]
    text = " ".join(text_parts).strip()
    # Collapse repeated whitespace / Whisper artifacts
    text = " ".join(text.split())
    return text


def transcribe_best(
    audio_array: np.ndarray,
    *,
    initial_prompt: str | None = None,
    prefer: str | None = None,
    api_key: str | None = None,
) -> tuple[str, dict]:
    """
    Best available STT for a PCM clip.

    Prefer Deepgram Nova-3 (streaming WebSocket clip) when configured;
    fall back to local faster-whisper.

    Returns (text, meta) where meta has provider, ms, model, error?.
    """
    provider = (prefer or get_stt_provider() or "auto").strip().lower()
    if provider in ("auto", ""):
        from config import get_deepgram_api_key

        provider = "deepgram" if (api_key or get_deepgram_api_key()) else "whisper"

    meta: dict = {"provider": provider}
    t0 = time.perf_counter()

    if provider == "deepgram":
        try:
            from deepgram_stt import transcribe_pcm_nova3

            text, dg_meta = transcribe_pcm_nova3(
                audio_array,
                sample_rate=int(AUDIO_SAMPLE_RATE or 16000),
                api_key=api_key,
            )
            meta.update(dg_meta or {})
            meta["provider"] = "deepgram"
            if (text or "").strip():
                meta["ms"] = meta.get("ms") or round((time.perf_counter() - t0) * 1000, 2)
                return text.strip(), meta
            # Fall through to Whisper
            meta["fallback"] = "whisper"
            print(
                f"[stt] Deepgram empty ({meta.get('error') or 'no text'}) → Whisper fallback"
            )
        except Exception as e:
            meta["deepgram_error"] = f"{type(e).__name__}: {e}"
            meta["fallback"] = "whisper"
            print(f"[stt] Deepgram failed: {meta['deepgram_error']} → Whisper")

    try:
        text = transcribe_audio(audio_array, initial_prompt=initial_prompt)
        meta["provider"] = "whisper" if meta.get("fallback") else meta.get("provider", "whisper")
        if meta.get("fallback"):
            meta["provider"] = "whisper"
        else:
            meta["provider"] = "whisper"
        meta["model"] = WHISPER_MODEL
        meta["ms"] = round((time.perf_counter() - t0) * 1000, 2)
        meta["ok"] = bool((text or "").strip())
        return (text or "").strip(), meta
    except Exception as e:
        meta["error"] = f"{type(e).__name__}: {e}"
        meta["ms"] = round((time.perf_counter() - t0) * 1000, 2)
        return "", meta


class ContinuousTranscriber:
    """Convenience wrapper for continuous capture and transcription."""

    def __init__(self, device: str = None):
        """
        Initialize continuous transcriber.

        Args:
            device: Audio source name, or None for auto-detect
        """
        self._capture = get_audio_capture(device)

    @property
    def device(self) -> str:
        """Get current device name."""
        return self._capture.device

    def list_devices(self) -> list[dict]:
        """List available monitor devices."""
        return self._capture.list_devices()

    def start(self):
        """Begin continuous audio capture."""
        self._capture.start_capture()

    def transcribe_recent(self, seconds: int = 30) -> str:
        """
        Transcribe last N seconds of audio.

        Args:
            seconds: Number of seconds to transcribe

        Returns:
            Transcribed text
        """
        audio = self._capture.get_last_n_seconds(seconds)
        return transcribe_audio(audio)

    def get_audio_level(self) -> float:
        """Get current audio level for UI."""
        return self._capture.get_audio_level()

    def stop(self) -> str:
        """
        Stop capture and transcribe remaining audio.

        Returns:
            Transcribed text
        """
        audio = self._capture.stop_capture()
        return transcribe_audio(audio)


if __name__ == "__main__":
    import time

    print("=== System Audio Capture Test ===\n")

    # Create capture via factory
    capture = get_audio_capture()
    print("Available monitor devices:")
    for dev in capture.list_devices():
        print(f"  [{dev['status']:10}] {dev['name']}")

    print(f"\nUsing device: {capture.device}")
    print("\n1. Play some audio (YouTube, Spotify, etc.)")
    print("2. Press Enter to start capturing...")
    input()

    capture.start_capture()
    print("Capturing for 5 seconds...\n")

    for i in range(5):
        time.sleep(1)
        level = capture.get_audio_level()
        bar = "\u2588" * int(level * 50)
        print(f"  Level: {bar:50} {level:.2f}")

    print("\nStopping capture and transcribing...")
    audio = capture.stop_capture()
    print(f"Captured {len(audio)} samples ({len(audio)/AUDIO_SAMPLE_RATE:.1f} seconds)")

    text = transcribe_audio(audio)

    print(f"\n=== Transcription ===\n{text if text else '(no speech detected)'}\n")
