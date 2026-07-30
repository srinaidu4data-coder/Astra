#!/usr/bin/env python3
"""
Continuous live interview session.

Listens to system audio (Stereo Mix / loopback), detects end-of-utterance,
transcribes with Whisper, filters non-questions, generates answers, and
pushes events to the UI over a WebSocket callback.
"""

from __future__ import annotations

import threading
import time
import traceback
from collections.abc import Callable
from typing import Any, Optional

import numpy as np

from audio_capture import BrowserAudioCapture, get_audio_capture
from config import (
    AUTO_TRANSCRIBE_MAX_SECONDS,
    BROWSER_MIN_SPEECH_DURATION,
    BROWSER_SILENCE_DURATION,
    MAX_UTTERANCE_SECONDS,
    MIN_SPEECH_DURATION,
    SILENCE_DURATION,
    SILENCE_THRESHOLD,
    VAD_NOISE_FACTOR,
    VAD_NOISE_OFFSET,
    VAD_SILENCE_FACTOR,
)
from pipeline_utils import is_near_duplicate, question_fingerprint, speech_window_seconds
from rag import classify_utterance
from transcriber import get_whisper_model, transcribe_audio

EventFn = Callable[[str, dict[str, Any]], None]


class LiveInterviewSession:
    """One continuous interview listen loop (thread + audio capture)."""

    def __init__(self, emit: EventFn):
        self._emit = emit
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._process_lock = threading.Lock()
        self._processing = False
        self._capture = None
        self._source = "system"  # system | browser

        self.job_context = "AI/ML Engineer"
        self.tone = "confident"
        self.mode = "star"
        self.answer_model: Optional[str] = None
        self.fallback_model: Optional[str] = None
        self.user_answer_model: Optional[str] = None
        self.user_fallback_model: Optional[str] = None

        self._noise_floor = 0.01
        self._level_ema = 0.0
        self._speech_start: Optional[float] = None
        self._silence_start: Optional[float] = None
        self._last_speech_s = 0.0
        self._last_fp = ""
        self._generation = 0

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def source(self) -> str:
        return self._source

    def start(
        self,
        *,
        job_context: str = "",
        tone: str = "confident",
        mode: str = "star",
        source: str = "system",
        answer_model: str | None = None,
        fallback_model: str | None = None,
        user_answer_model: str | None = None,
        user_fallback_model: str | None = None,
    ) -> None:
        src = (source or "system").strip().lower()
        if src in ("mic", "browser-mic", "client"):
            src = "browser"
        if src not in ("system", "browser"):
            src = "system"

        if self.running:
            self.job_context = job_context or self.job_context
            self.tone = tone or self.tone
            self.mode = mode or self.mode
            if answer_model is not None:
                self.answer_model = answer_model
            if fallback_model is not None:
                self.fallback_model = fallback_model
            if user_answer_model is not None:
                self.user_answer_model = user_answer_model
            if user_fallback_model is not None:
                self.user_fallback_model = user_fallback_model
            self._emit("status", {"message": "Already listening", "listening": True})
            return

        self.job_context = job_context or "AI/ML Engineer"
        self.tone = tone or "confident"
        self.mode = mode or "star"
        self.answer_model = answer_model
        self.fallback_model = fallback_model
        self.user_answer_model = user_answer_model
        self.user_fallback_model = user_fallback_model
        self._source = src
        self._stop.clear()
        self._noise_floor = 0.01
        self._level_ema = 0.0
        self._speech_start = None
        self._silence_start = None
        self._last_fp = ""

        self._thread = threading.Thread(target=self._run, name="live-interview", daemon=True)
        self._thread.start()

    def push_audio(self, pcm16: bytes) -> None:
        """Feed browser mic PCM (int16 LE mono) into the active session."""
        cap = self._capture
        if cap is None or not isinstance(cap, BrowserAudioCapture):
            return
        try:
            cap.push_pcm16(pcm16)
        except Exception:
            pass

    def stop(self) -> None:
        self._stop.set()
        self._generation += 1
        cap = self._capture
        self._capture = None
        if cap is not None:
            try:
                cap.stop_capture()
            except Exception:
                pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.5)
        self._thread = None
        self._emit("listening", {"active": False})
        self._emit("status", {"message": "Session stopped", "listening": False})

    def set_mode(self, mode: str) -> None:
        self.mode = (mode or "star").strip().lower()
        self._emit("status", {"message": f"Answer format → {self.mode}"})

    def set_context(self, job_context: str = "", tone: str = "") -> None:
        if job_context:
            self.job_context = job_context
        if tone:
            self.tone = tone

    def _run(self) -> None:
        try:
            # Warm Whisper early so first question is faster
            try:
                get_whisper_model()
            except Exception as e:
                self._emit("error", {"message": f"Whisper load failed: {e}"})

            if self._source == "browser":
                self._emit("status", {"message": "Waiting for browser microphone audio…"})
                try:
                    from config import AUDIO_SAMPLE_RATE, AUDIO_CHANNELS

                    self._capture = BrowserAudioCapture(
                        sample_rate=AUDIO_SAMPLE_RATE,
                        channels=AUDIO_CHANNELS,
                    )
                except Exception:
                    self._capture = BrowserAudioCapture()
                self._capture.start_capture()
                device = "browser-mic"
                status_msg = (
                    "Live session ON · browser mic · allow microphone access, "
                    "then speak or play interview audio near the mic"
                )
            else:
                self._emit(
                    "status",
                    {"message": "Opening system audio (Stereo Mix / loopback)…"},
                )
                self._capture = get_audio_capture()
                self._capture.start_capture()
                device = getattr(self._capture, "device", "unknown")
                status_msg = f"Live session ON · {device} · speak (or play interview audio)"

            self._emit(
                "listening",
                {
                    "active": True,
                    "device": device,
                    "message": f"Listening on {device}",
                    "source": self._source,
                },
            )
            self._emit(
                "status",
                {
                    "message": status_msg,
                    "listening": True,
                    "device": device,
                    "source": self._source,
                },
            )

            while not self._stop.is_set():
                self._tick_vad()
                time.sleep(0.1)

        except Exception as e:
            traceback.print_exc()
            self._emit("error", {"message": f"Listen failed: {e}"})
        finally:
            try:
                if self._capture is not None:
                    self._capture.stop_capture()
            except Exception:
                pass
            self._capture = None
            self._emit("listening", {"active": False})

    def _silence_needed(self) -> float:
        """How long quiet before we treat the question as finished."""
        if self._source == "browser":
            return float(BROWSER_SILENCE_DURATION)
        return float(SILENCE_DURATION)

    def _min_speech_needed(self) -> float:
        if self._source == "browser":
            return float(BROWSER_MIN_SPEECH_DURATION)
        return float(MIN_SPEECH_DURATION)

    def _vad_level(self) -> float:
        cap = self._capture
        if cap is None:
            return 0.0
        # Prefer pre-gain raw level when available (windows_capture / browser)
        try:
            if hasattr(cap, "get_vad_level"):
                return float(cap.get_vad_level())
            if hasattr(cap, "_raw_level"):
                return float(getattr(cap, "_raw_level") or 0.0)
        except Exception:
            pass
        try:
            return float(cap.get_audio_level() or 0.0)
        except Exception:
            return 0.0

    def _tick_vad(self) -> None:
        if self._processing:
            # Still emit levels so UI waveform stays alive
            lvl = self._vad_level()
            self._emit("level", {"level": lvl, "state": "processing"})
            return

        vad_level = self._vad_level()
        now = time.time()

        # Heavier smoothing for browser mic (AGC/noise-suppression dips between words)
        alpha = 0.45 if self._source == "browser" else 0.35
        self._level_ema = ((1.0 - alpha) * self._level_ema) + (alpha * vad_level)
        level_for_vad = max(vad_level, self._level_ema * 0.85)

        if self._speech_start is None:
            self._noise_floor = min(
                0.08,
                max(0.001, (0.95 * self._noise_floor) + (0.05 * self._level_ema)),
            )

        speech_on = self._noise_floor * VAD_NOISE_FACTOR + VAD_NOISE_OFFSET
        # Once speaking, drop out only on real quiet (not mid-phrase dips)
        speech_off = max(
            SILENCE_THRESHOLD,
            self._noise_floor * VAD_SILENCE_FACTOR + (VAD_NOISE_OFFSET * 0.2),
        )
        if self._source == "browser":
            speech_off = max(SILENCE_THRESHOLD * 0.5, speech_off * 0.75)

        if self._speech_start is None:
            is_speech = level_for_vad >= speech_on
        else:
            is_speech = level_for_vad >= speech_off

        silence_needed = self._silence_needed()
        min_speech = self._min_speech_needed()
        # Longer hangover after we've already heard a substantial chunk
        if self._speech_start is not None:
            so_far = now - self._speech_start
            if so_far >= 2.5:
                silence_needed = max(silence_needed, silence_needed + 0.35)
            if so_far >= 5.0:
                silence_needed = max(silence_needed, silence_needed + 0.25)

        state = "listening"
        if is_speech:
            state = "hearing"
            self._silence_start = None
            if self._speech_start is None:
                self._speech_start = now
            else:
                speech_so_far = now - self._speech_start
                if speech_so_far >= MAX_UTTERANCE_SECONDS:
                    self._last_speech_s = speech_so_far
                    self._speech_start = None
                    self._silence_start = None
                    self._trigger_process()
        else:
            if self._speech_start is not None:
                if self._silence_start is None:
                    self._silence_start = now
                else:
                    silence_s = now - self._silence_start
                    speech_s = self._silence_start - self._speech_start
                    if silence_s >= silence_needed:
                        if speech_s >= min_speech:
                            self._last_speech_s = speech_s
                            self._trigger_process()
                        # Too short → discard blip, keep listening
                        self._speech_start = None
                        self._silence_start = None

        self._emit(
            "level",
            {
                "level": level_for_vad,
                "state": state,
                "noise_floor": self._noise_floor,
            },
        )

    def _snapshot(self, speech_s: float) -> Optional[np.ndarray]:
        cap = self._capture
        if cap is None:
            return None
        window_s = speech_window_seconds(
            speech_s,
            min_seconds=3.0,
            max_seconds=float(AUTO_TRANSCRIBE_MAX_SECONDS),
            pad_seconds=0.75,
        )
        try:
            return cap.get_last_n_seconds(int(window_s + 0.5))
        except Exception:
            return None

    def _trigger_process(self) -> None:
        speech_s = self._last_speech_s
        audio = self._snapshot(speech_s)
        with self._process_lock:
            if self._processing:
                return
            self._processing = True
            self._generation += 1
            gen = self._generation

        threading.Thread(
            target=self._process_clip,
            args=(audio, speech_s, gen),
            daemon=True,
            name="live-stt-answer",
        ).start()

    def _process_clip(self, audio, speech_s: float, gen: int) -> None:
        try:
            if gen != self._generation or self._stop.is_set():
                return

            if audio is None or len(audio) == 0:
                self._emit("status", {"message": "No clip captured — still listening"})
                return

            self._emit("status", {"message": "Transcribing…", "listening": True})
            t0 = time.perf_counter()
            text = transcribe_audio(audio)
            stt_ms = round((time.perf_counter() - t0) * 1000)

            if gen != self._generation or self._stop.is_set():
                return

            if not text or not text.strip():
                self._emit("status", {"message": "Couldn't make out words — still listening"})
                return

            words = [w for w in text.strip().split() if w]
            # Incomplete mid-sentence cutoffs (1–3 words) → keep listening
            if len(words) < 4 and not text.strip().endswith("?"):
                self._emit(
                    "status",
                    {
                        "message": f"Fragment only ({len(words)} words) — still listening for full question",
                        "listening": True,
                    },
                )
                return

            self._emit(
                "transcript",
                {
                    "text": text,
                    "stt_ms": stt_ms,
                    "final": True,
                    "role": "interviewer",
                },
            )

            from answer_engine import generate_answer, looks_like_question, to_bullets

            classification = classify_utterance(text, min_words=4)
            question = classification.get("cleaned_question") or text
            is_q = bool(classification.get("is_interview_question", False))
            conf = float(classification.get("confidence", 0.0) or 0.0)
            soft_q = looks_like_question(text) or looks_like_question(question)

            # LIVE MODE: answer almost everything that could be a question.
            # Only skip high-confidence non-questions that also fail soft cues.
            # (Fixes "Question one, tell me about…" which never startswith "tell me")
            should_answer = is_q or soft_q or conf < 0.9
            if not should_answer and conf >= 0.9 and not soft_q:
                self._emit(
                    "chatter",
                    {
                        "text": text,
                        "reason": "not_a_question",
                        "confidence": conf,
                        "is_q": is_q,
                        "soft_q": soft_q,
                    },
                )
                self._emit("status", {"message": "Chatter filtered — still listening"})
                return

            if is_near_duplicate(question, self._last_fp):
                self._emit("chatter", {"text": text, "reason": "duplicate"})
                self._emit("status", {"message": "Same question skipped — still listening"})
                return

            self._emit(
                "status",
                {
                    "message": f"Writing answer ({self.mode})…",
                    "listening": True,
                    "answering": True,
                },
            )
            # Let UI show a pending card immediately
            self._emit(
                "answer_pending",
                {"question": question, "mode": self.mode},
            )

            t1 = time.perf_counter()
            try:
                answer = generate_answer(
                    question,
                    answer_model=self.answer_model,
                    fallback_model=self.fallback_model,
                    user_answer_model=self.user_answer_model,
                    user_fallback_model=self.user_fallback_model,
                    job_context=self.job_context,
                    tone=self.tone,
                    mode=self.mode,
                )
            except Exception as gen_err:
                traceback.print_exc()
                self._emit("error", {"message": f"Answer generation failed: {gen_err}"})
                # Fallback so the panel is never blank
                answer = (
                    f"I heard: {question}\n"
                    "I'd structure this with a clear situation, what I owned, "
                    "the concrete actions I took, and a measurable result."
                )

            if gen != self._generation or self._stop.is_set():
                # Still try to deliver if we already have text
                if not answer:
                    return

            ans_ms = round((time.perf_counter() - t1) * 1000)
            bullets = to_bullets(answer, self.mode)
            if not bullets and answer:
                bullets = [answer]

            self._last_fp = question_fingerprint(question)
            self._emit(
                "answer",
                {
                    "question": question,
                    "answer": answer,
                    "bullets": bullets,
                    "mode": self.mode,
                    "stt_ms": stt_ms,
                    "answer_ms": ans_ms,
                    "pipeline_ms": stt_ms + ans_ms,
                },
            )
            self._emit(
                "status",
                {
                    "message": "Answer ready — still listening for next question",
                    "listening": True,
                    "answering": False,
                },
            )
        except Exception as e:
            traceback.print_exc()
            self._emit("error", {"message": str(e)})
        finally:
            with self._process_lock:
                self._processing = False
