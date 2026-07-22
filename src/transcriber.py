#!/usr/bin/env python3
"""
System Audio Transcription for Astra MVP.

Uses platform-agnostic AudioCapture abstraction and transcribes
using faster-whisper.
"""

import numpy as np
from faster_whisper import WhisperModel

from audio_capture import get_audio_capture, AudioCapture
from config import (
    AUDIO_SAMPLE_RATE,
    WHISPER_MODEL,
    WHISPER_DEVICE,
    WHISPER_COMPUTE_TYPE,
)


# Global Whisper model (lazy loaded)
_whisper_model = None


def get_whisper_model() -> WhisperModel:
    """Get or initialize the Whisper model."""
    global _whisper_model
    if _whisper_model is None:
        print(f"Loading Whisper model '{WHISPER_MODEL}'...")
        _whisper_model = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE
        )
        print("Model loaded.")
    return _whisper_model


def transcribe_audio(audio_array: np.ndarray) -> str:
    """
    Transcribe audio from numpy array.

    Args:
        audio_array: numpy array of 16-bit audio at 16kHz

    Returns:
        Transcribed text string
    """
    if audio_array is None or len(audio_array) == 0:
        print("Warning: Empty audio buffer - check if audio is playing")
        return ""

    # Convert int16 to float32 normalized [-1.0, 1.0] for faster-whisper
    audio_float32 = audio_array.astype(np.float32) / 32768.0

    # Stereo Mix / loopback is often very quiet — boost before VAD/STT
    peak = float(np.max(np.abs(audio_float32))) + 1e-9
    if peak < 0.15:
        gain = min(30.0, 0.4 / peak)
        audio_float32 = np.clip(audio_float32 * gain, -1.0, 1.0)
        print(f"[stt] boosted quiet audio peak {peak:.4f} -> gain {gain:.1f}x")

    # Transcribe with optimized settings
    model = get_whisper_model()
    # Disable VAD when still quiet after boost — VAD was dropping soft speech
    use_vad = float(np.max(np.abs(audio_float32))) >= 0.05
    segments, _ = model.transcribe(
        audio_float32,
        beam_size=1,
        vad_filter=use_vad,
        vad_parameters=dict(min_silence_duration_ms=500) if use_vad else None,
        language="en",
    )

    text_parts = [segment.text for segment in segments]
    return " ".join(text_parts).strip()


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
