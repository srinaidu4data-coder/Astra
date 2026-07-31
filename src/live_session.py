#!/usr/bin/env python3
"""
Continuous live interview session.

Listens to system audio (Stereo Mix / loopback), detects end-of-utterance,
transcribes with Whisper, filters non-questions, generates answers, and
pushes events to the UI over a WebSocket callback.
"""

from __future__ import annotations

import re
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

try:
    from config import BROWSER_FAST_SILENCE_DURATION
except ImportError:  # pragma: no cover
    BROWSER_FAST_SILENCE_DURATION = 0.55
try:
    from config import BROWSER_LONG_SILENCE_DURATION
except ImportError:  # pragma: no cover
    BROWSER_LONG_SILENCE_DURATION = 1.35
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
        self._pending: list[tuple[Any, float]] = []  # (audio, speech_s) queue
        self._capture = None
        self._source = "browser"  # browser | system — browser is the reliable default

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
        self._peak_speech_level = 0.0  # for adaptive fast hangover
        self._last_fp = ""
        self._recent_fps: list[str] = []  # last few fingerprints (long interview)
        self._generation = 0  # only bumped on stop — never cancel mid-answer for next Q
        self._job_id = 0
        # Browser path: create capture immediately so early PCM is not dropped
        self._early_browser_cap: Optional[BrowserAudioCapture] = None

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
        self._recent_fps = []
        self._pending = []
        self._processing = False
        self._peak_speech_level = 0.0

        self._thread = threading.Thread(target=self._run, name="live-interview", daemon=True)
        self._thread.start()

    def push_audio(self, pcm16: bytes) -> None:
        """Feed browser mic PCM (int16 LE mono) into the active session."""
        cap = self._capture
        if cap is None and self._early_browser_cap is not None:
            cap = self._early_browser_cap
        if cap is None:
            # Ultra-early audio before start(): keep a temporary capture buffer
            try:
                self._early_browser_cap = BrowserAudioCapture()
                # Accept PCM into prebuf without "starting" the ring yet
                self._early_browser_cap.push_pcm16(pcm16)
            except Exception:
                pass
            return
        if not isinstance(cap, BrowserAudioCapture):
            return
        try:
            cap.push_pcm16(pcm16)
        except Exception:
            pass

    def stop(self) -> None:
        self._stop.set()
        self._generation += 1
        with self._process_lock:
            self._pending.clear()
            self._processing = False
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
            # CRITICAL: open capture BEFORE Whisper load so the first question
            # is not dropped while the model warms (that caused 1-word STT tails).
            if self._source == "browser":
                self._emit("status", {"message": "Waiting for browser microphone audio…"})
                try:
                    from config import AUDIO_SAMPLE_RATE, AUDIO_CHANNELS

                    cap = self._early_browser_cap or BrowserAudioCapture(
                        sample_rate=AUDIO_SAMPLE_RATE,
                        channels=AUDIO_CHANNELS,
                    )
                except Exception:
                    cap = self._early_browser_cap or BrowserAudioCapture()
                self._early_browser_cap = None
                self._capture = cap
                # start_capture flushes any pre-roll PCM buffered before this point
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

            # Warm Whisper after audio is already flowing into the ring buffer
            try:
                get_whisper_model()
            except Exception as e:
                self._emit("error", {"message": f"Whisper load failed: {e}"})

            while not self._stop.is_set():
                self._tick_vad()
                time.sleep(0.05)  # snappier end-of-speech detection

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
        # Always run VAD even while answering — long interviews queue the next Q.
        # (Old code returned early when _processing and DROPPED every subsequent question.)
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
        so_far = (now - self._speech_start) if self._speech_start is not None else 0.0
        # Long multi-clause questions: LONGER hangover (mid-sentence pauses).
        # Applies to browser mic AND system loopback (Stereo Mix often dips mid-clause).
        if self._speech_start is not None:
            if so_far >= 6.0:
                silence_needed = max(
                    silence_needed, float(BROWSER_LONG_SILENCE_DURATION)
                )
            elif so_far >= 3.5:
                silence_needed = max(silence_needed, silence_needed + 0.25)
            elif (
                self._source == "browser"
                and self._peak_speech_level >= 0.12
                and level_for_vad < max(0.02, self._noise_floor * 1.4)
                and so_far < 3.5
            ):
                # Short Q only — never accelerate hangover on long utterances
                silence_needed = min(
                    silence_needed, float(BROWSER_FAST_SILENCE_DURATION)
                )

        state = "processing" if self._processing else "listening"
        if is_speech:
            state = "hearing" if not self._processing else "hearing_queued"
            self._silence_start = None
            self._peak_speech_level = max(self._peak_speech_level, level_for_vad)
            if self._speech_start is None:
                self._speech_start = now
                self._peak_speech_level = level_for_vad
            else:
                speech_so_far = now - self._speech_start
                if speech_so_far >= MAX_UTTERANCE_SECONDS:
                    self._last_speech_s = speech_so_far
                    self._speech_start = None
                    self._silence_start = None
                    self._peak_speech_level = 0.0
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
                        self._peak_speech_level = 0.0

        self._emit(
            "level",
            {
                "level": level_for_vad,
                "state": state,
                "noise_floor": self._noise_floor,
                "queue_depth": len(self._pending),
            },
        )

    def _snapshot(self, speech_s: float) -> Optional[np.ndarray]:
        cap = self._capture
        if cap is None:
            return None
        # Window must cover full multi-clause questions (was capped at 12s → wrong answers)
        min_s = 3.5 if self._source == "browser" else 3.0
        pad_s = 1.0 if self._source == "browser" else 0.85
        max_s = max(20.0, float(AUTO_TRANSCRIBE_MAX_SECONDS))
        window_s = speech_window_seconds(
            speech_s,
            min_seconds=min_s,
            max_seconds=max_s,
            pad_seconds=pad_s,
        )
        try:
            return cap.get_last_n_seconds(window_s)
        except Exception:
            return None

    def _drop_processed_audio(self, keep_s: float = 0.75) -> None:
        """After capturing a clip, drop older ring audio so Q2 ≠ rehash of Q1."""
        cap = self._capture
        if cap is None:
            return
        try:
            if hasattr(cap, "keep_only_last_seconds"):
                cap.keep_only_last_seconds(keep_s)
            elif hasattr(cap, "get_last_n_seconds") and hasattr(cap, "_ring"):
                # Best-effort for other capture backends with a ring
                recent = cap.get_last_n_seconds(keep_s)
                try:
                    cap._ring.clear()  # type: ignore[attr-defined]
                    if recent is not None and len(recent) > 0:
                        cap._ring.extend_samples(recent)  # type: ignore[attr-defined]
                except Exception:
                    pass
        except Exception:
            pass

    def _trigger_process(self) -> None:
        """
        Snapshot current utterance and queue it.

        Long interviews previously DROPPED the next question while the previous
        answer was still generating (_processing=True → return). Queue instead.
        """
        speech_s = self._last_speech_s
        audio = self._snapshot(speech_s)
        # Isolate next utterance from this clip's audio
        self._drop_processed_audio(keep_s=0.6)

        with self._process_lock:
            # Cap backlog: keep newest 3 clips in a rapid-fire panel
            self._pending.append((audio, speech_s))
            if len(self._pending) > 3:
                self._pending = self._pending[-3:]
            if self._processing:
                self._emit(
                    "status",
                    {
                        "message": f"Queued question ({len(self._pending)} waiting)…",
                        "listening": True,
                    },
                )
                return
            self._processing = True
            job = self._pending.pop(0)

        self._spawn_job(job)

    def _spawn_job(self, job: tuple[Any, float]) -> None:
        audio, speech_s = job
        self._job_id += 1
        job_id = self._job_id
        gen = self._generation  # stop() bumps this to cancel
        threading.Thread(
            target=self._process_clip,
            args=(audio, speech_s, gen, job_id),
            daemon=True,
            name=f"live-stt-answer-{job_id}",
        ).start()

    def _finish_job_and_drain(self) -> None:
        """Start next queued clip, if any (serial processing, no drops)."""
        with self._process_lock:
            if self._stop.is_set():
                self._pending.clear()
                self._processing = False
                return
            if self._pending:
                job = self._pending.pop(0)
                # stay _processing True
            else:
                self._processing = False
                job = None
        if job is not None:
            self._spawn_job(job)

    def _process_clip(
        self, audio, speech_s: float, gen: int, job_id: int = 0
    ) -> None:
        try:
            # Only cancel on session stop — never cancel because another Q was queued
            if gen != self._generation or self._stop.is_set():
                return

            if audio is None or len(audio) == 0:
                self._emit("status", {"message": "No clip captured — still listening"})
                return

            self._emit(
                "status",
                {
                    "message": "Transcribing…",
                    "listening": True,
                    "job_id": job_id,
                },
            )
            t0 = time.perf_counter()
            text = transcribe_audio(audio)
            stt_ms = round((time.perf_counter() - t0) * 1000)

            if gen != self._generation or self._stop.is_set():
                return

            if not text or not text.strip():
                # Quick retry only — no long sleeps on the hot path
                retry = self._snapshot(max(speech_s, 4.0))
                if retry is not None and len(retry) > len(audio):
                    text = transcribe_audio(retry)
                    stt_ms = round((time.perf_counter() - t0) * 1000)
                if not text or not text.strip():
                    self._emit(
                        "status",
                        {"message": "Couldn't make out words — still listening"},
                    )
                    return

            words = [w for w in text.strip().split() if w]

            def _looks_incomplete(s: str) -> bool:
                """True if STT likely cut a multi-clause question mid-way."""
                s = (s or "").strip()
                if not s:
                    return True
                low = s.lower()
                if low.endswith("?"):
                    return False
                # Trailing conjunctions / openers = almost certainly cut off
                if re.search(
                    r"\b(and|or|with|to|for|that|which|how|what|when|where|"
                    r"including|across|from|into|via|so that|such that)\s*$",
                    low,
                ):
                    return True
                # Starts like a long prompt but too few words for full multi-part
                long_openers = (
                    "walk me through",
                    "in a complex",
                    "tell me about a time",
                    "how would you design",
                    "how would you",
                    "describe how",
                )
                if any(low.startswith(o) for o in long_openers) and len(words) < 18:
                    return True
                return False

            # Incomplete mid-sentence / long-Q cutoffs → re-snap larger window
            if len(words) < 4 or _looks_incomplete(text):
                retry = self._snapshot(max(speech_s + 2.0, 12.0))
                if retry is not None and len(retry) >= len(audio or []):
                    text2 = transcribe_audio(retry)
                    words2 = [w for w in (text2 or "").strip().split() if w]
                    if len(words2) > len(words):
                        text = text2
                        words = words2
                        stt_ms = round((time.perf_counter() - t0) * 1000)
                if len(words) < 4 and not (text or "").strip().endswith("?"):
                    self._emit(
                        "status",
                        {
                            "message": (
                                f"Fragment only ({len(words)} words) — "
                                "still listening for full question"
                            ),
                            "listening": True,
                        },
                    )
                    return
                if _looks_incomplete(text) and len(words) < 12:
                    self._emit(
                        "status",
                        {
                            "message": "Question may be incomplete — still listening…",
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

            from answer_engine import (
                generate_answer,
                looks_like_question,
                to_bullets,
                _normalize_answer_text,
            )

            soft_q = looks_like_question(text)
            # Fast path: skip classify LLM when heuristics already say "question"
            # (saves ~0.5–2s before answer generation starts).
            if soft_q:
                classification = {
                    "is_interview_question": True,
                    "confidence": 0.85,
                    "cleaned_question": text.strip(),
                    "reason": "heuristic_soft_q",
                }
            else:
                classification = classify_utterance(text, min_words=4)
            question = classification.get("cleaned_question") or text
            is_q = bool(classification.get("is_interview_question", False))
            conf = float(classification.get("confidence", 0.0) or 0.0)
            soft_q = soft_q or looks_like_question(question)

            # LIVE MODE: answer almost everything that could be a question.
            # Only skip clear non-questions (intros, thanks, filler) with high conf.
            should_answer = is_q or soft_q or conf < 0.85
            # Never skip short interview-shaped lines even if classifier is skeptical
            if not should_answer and len(words) >= 6 and looks_like_question(text):
                should_answer = True
            if not should_answer and conf >= 0.85 and not soft_q:
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

            fp = question_fingerprint(question)
            # Only skip exact-ish dups of the last few Qs (not whole interview history)
            if is_near_duplicate(question, self._last_fp) or any(
                is_near_duplicate(question, prev) for prev in self._recent_fps[-3:]
            ):
                # Allow re-ask after a few turns (same Q later in interview is valid)
                if self._last_fp and is_near_duplicate(question, self._last_fp):
                    self._emit("chatter", {"text": text, "reason": "duplicate"})
                    self._emit(
                        "status",
                        {"message": "Same question skipped — still listening"},
                    )
                    return

            self._emit(
                "status",
                {
                    "message": f"Writing answer ({self.mode})…",
                    "listening": True,
                    "answering": True,
                    "job_id": job_id,
                },
            )
            # Let UI show a pending card immediately (include job_id for multi-Q)
            self._emit(
                "answer_pending",
                {"question": question, "mode": self.mode, "job_id": job_id},
            )

            t1 = time.perf_counter()
            first_token_ms: float | None = None
            answer = ""
            source = "llm"
            try:
                # Cascade: exact cache / LLM stream (no approx cache mid-interview)
                from answer_engine import iter_answer_tokens
                from fast_answer import iter_cascade_answer

                last_emit_len = 0
                for text, meta in iter_cascade_answer(
                    question,
                    job_context=self.job_context,
                    tone=self.tone,
                    mode=self.mode,
                    answer_model=self.answer_model,
                    fallback_model=self.fallback_model,
                    user_answer_model=self.user_answer_model,
                    user_fallback_model=self.user_fallback_model,
                    llm_streamer=iter_answer_tokens,
                ):
                    # Finish this answer even if another Q is queued — only stop cancels
                    if gen != self._generation or self._stop.is_set():
                        break
                    answer = _normalize_answer_text(text or "")
                    source = str(meta.get("source") or source)
                    if first_token_ms is None and answer:
                        first_token_ms = round(
                            float(meta.get("first_paint_ms") or (time.perf_counter() - t1) * 1000)
                        )
                    # Emit upgrades (first paint, then ~every ~80 chars, then final)
                    if answer and (
                        meta.get("final")
                        or len(answer) - last_emit_len >= 80
                        or last_emit_len == 0
                    ):
                        last_emit_len = len(answer)
                        partial_bullets = to_bullets(answer, self.mode) or [answer]
                        self._emit(
                            "answer",
                            {
                                "question": question,
                                "answer": answer,
                                "bullets": partial_bullets,
                                "mode": self.mode,
                                "streaming": not bool(meta.get("final")),
                                "source": source,
                                "stt_ms": stt_ms,
                                "first_token_ms": first_token_ms,
                                "answer_ms": round((time.perf_counter() - t1) * 1000),
                                "pipeline_ms": first_token_ms
                                or round((time.perf_counter() - t1) * 1000),
                                "job_id": job_id,
                            },
                        )
                    if meta.get("final"):
                        break

                if not answer:
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
                    answer = _normalize_answer_text(answer)
                    source = "blocking_fallback"
            except Exception as gen_err:
                traceback.print_exc()
                self._emit("error", {"message": f"Answer generation failed: {gen_err}"})
                from fast_answer import instant_answer

                answer, source, ms = instant_answer(
                    question, job_context=self.job_context, mode=self.mode
                )
                answer = _normalize_answer_text(answer)
                if first_token_ms is None:
                    first_token_ms = round(ms)
                if not answer:
                    answer = (
                        f"I heard: {question}\n"
                        "I'd structure this with a clear situation, what I owned, "
                        "the concrete actions I took, and a measurable result."
                    )

            if self._stop.is_set() or gen != self._generation:
                # Session stopped mid-answer — still try to show what we have
                if not answer:
                    return

            ans_ms = round((time.perf_counter() - t1) * 1000)
            if first_token_ms is None:
                first_token_ms = ans_ms
            bullets = to_bullets(answer, self.mode)
            if not bullets and answer:
                bullets = [answer]

            self._last_fp = fp
            self._recent_fps.append(fp)
            if len(self._recent_fps) > 8:
                self._recent_fps = self._recent_fps[-8:]
            # Always emit final answer tagged with question + job_id for UI matching
            self._emit(
                "answer",
                {
                    "question": question,
                    "answer": answer,
                    "bullets": bullets,
                    "mode": self.mode,
                    "streaming": False,
                    "source": source,
                    "stt_ms": stt_ms,
                    "first_token_ms": first_token_ms,
                    "answer_ms": ans_ms,
                    "pipeline_ms": first_token_ms,
                    "full_answer_ms": ans_ms,
                    "total_pipeline_ms": stt_ms + ans_ms,
                    "job_id": job_id,
                },
            )
            self._emit(
                "status",
                {
                    "message": "Answer ready — still listening for next question",
                    "listening": True,
                    "answering": False,
                    "job_id": job_id,
                },
            )
        except Exception as e:
            traceback.print_exc()
            self._emit("error", {"message": str(e)})
        finally:
            self._finish_job_and_drain()
