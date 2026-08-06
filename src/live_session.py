#!/usr/bin/env python3
"""
Continuous live interview session.

Listens to system audio (Stereo Mix / loopback), detects end-of-utterance,
transcribes with Whisper, filters non-questions, generates answers, and
pushes events to the UI over a WebSocket callback.
"""

from __future__ import annotations

import os
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
from transcriber import get_whisper_model, transcribe_audio, transcribe_best

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

        self.job_context = ""
        self.tone = "confident"
        self.mode = "star"
        self.answer_model: Optional[str] = None
        self.fallback_model: Optional[str] = None
        self.user_answer_model: Optional[str] = None
        self.user_fallback_model: Optional[str] = None
        # Isolates session pack (role/JD) per live connection
        self.session_id: str = ""

        self._noise_floor = 0.01
        self._level_ema = 0.0
        self._speech_start: Optional[float] = None
        self._silence_start: Optional[float] = None
        self._last_speech_s = 0.0
        self._peak_speech_level = 0.0  # for adaptive fast hangover
        self._last_fp = ""
        self._recent_fps: list[str] = []  # last few fingerprints (long interview)
        self._generation = 0  # bumped on stop AND on each new question (cancel stale)
        self._job_id = 0
        self._active_turn_id = ""
        self._turn_sm = None  # lazy TurnStateMachine
        self._last_transcript_finals: list[str] = []
        # Browser path: create capture immediately so early PCM is not dropped
        self._early_browser_cap: Optional[BrowserAudioCapture] = None
        # Deepgram Nova-3 continuous stream (optional)
        self._dg_stream = None
        self._dg_api_key: Optional[str] = None
        self._stt_provider = "whisper"  # deepgram | whisper
        self._dg_feed_cursor = 0  # samples already fed from ring (system path)
        self._last_partial_emit = 0.0

    def _get_turn_sm(self):
        if self._turn_sm is None:
            from turn_state import TurnStateMachine

            self._turn_sm = TurnStateMachine(session_id=self.session_id or "")
        return self._turn_sm

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
        deepgram_api_key: str | None = None,
        stt_provider: str | None = None,
    ) -> None:
        src = (source or "system").strip().lower()
        if src in ("mic", "browser-mic", "client"):
            src = "browser"
        if src not in ("system", "browser"):
            src = "system"

        if self.running:
            # Always accept job_context (including "") so empty Role clears mid-session
            self.job_context = (job_context or "").strip()
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
            self._sync_pack_role(self.job_context)
            self._emit("status", {"message": "Already listening", "listening": True})
            return

        self.job_context = (job_context or "").strip()
        self._sync_pack_role(self.job_context)
        self.tone = tone or "confident"
        self.mode = mode or "star"
        self.answer_model = answer_model
        self.fallback_model = fallback_model
        self.user_answer_model = user_answer_model
        self.user_fallback_model = user_fallback_model
        self._dg_api_key = (deepgram_api_key or "").strip() or None
        if self._dg_api_key:
            os.environ.setdefault("DEEPGRAM_API_KEY", self._dg_api_key)
        # Resolve STT provider
        try:
            from config import get_deepgram_api_key, get_stt_provider

            if stt_provider in ("deepgram", "whisper"):
                self._stt_provider = stt_provider
            else:
                self._stt_provider = get_stt_provider()
            if self._stt_provider == "deepgram" and not (
                self._dg_api_key or get_deepgram_api_key()
            ):
                self._stt_provider = "whisper"
        except Exception:
            self._stt_provider = "whisper"
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
        self._dg_feed_cursor = 0

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
            # Still try to stream early PCM to Deepgram if live
            self._feed_deepgram_pcm(pcm16)
            return
        if not isinstance(cap, BrowserAudioCapture):
            return
        try:
            cap.push_pcm16(pcm16)
        except Exception:
            pass
        self._feed_deepgram_pcm(pcm16)

    def _feed_deepgram_pcm(self, pcm16: bytes) -> None:
        dg = self._dg_stream
        if dg is None or not pcm16:
            return
        try:
            dg.send_pcm(pcm16)
        except Exception:
            pass

    def _start_deepgram_stream(self) -> None:
        """Open continuous Nova-3 listen socket when key is available."""
        if self._stt_provider != "deepgram":
            return
        try:
            from config import AUDIO_SAMPLE_RATE, get_deepgram_api_key
            from deepgram_stt import DeepgramLiveStream, deepgram_available

            key = self._dg_api_key or get_deepgram_api_key()
            if not key or not deepgram_available():
                if not deepgram_available():
                    self._emit(
                        "status",
                        {
                            "message": (
                                "Deepgram requested but unavailable "
                                "(install websocket-client + set DEEPGRAM_API_KEY) "
                                "— using Whisper"
                            ),
                            "stt_provider": "whisper",
                        },
                    )
                self._stt_provider = "whisper"
                return
            stream = DeepgramLiveStream(
                sample_rate=int(AUDIO_SAMPLE_RATE or 16000),
                emit=self._emit,
                api_key=key,
            )
            if stream.start(timeout=6.0):
                self._dg_stream = stream
                self._emit(
                    "status",
                    {
                        "message": "STT: Deepgram Nova-3 streaming",
                        "stt_provider": "deepgram",
                        "listening": True,
                    },
                )
            else:
                self._stt_provider = "whisper"
                self._emit(
                    "status",
                    {
                        "message": (
                            f"Deepgram connect failed ({stream.error or 'timeout'}) "
                            "— Whisper fallback"
                        ),
                        "stt_provider": "whisper",
                    },
                )
        except Exception as e:
            self._stt_provider = "whisper"
            self._emit(
                "status",
                {
                    "message": f"Deepgram init error: {e} — Whisper fallback",
                    "stt_provider": "whisper",
                },
            )

    def _stop_deepgram_stream(self) -> None:
        dg = self._dg_stream
        self._dg_stream = None
        if dg is not None:
            try:
                dg.stop()
            except Exception:
                pass

    def stop(self) -> None:
        self._stop.set()
        self._generation += 1
        try:
            self._get_turn_sm().reset()
        except Exception:
            pass
        with self._process_lock:
            self._pending.clear()
            self._processing = False
        self._stop_deepgram_stream()
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
        # Always apply (including empty) so UI Role clear reaches the answer path
        if job_context is not None:
            prev = (self.job_context or "").strip()
            self.job_context = (job_context or "").strip()
            self._sync_pack_role(self.job_context)
            # Role change: drop answer cache so prior persona answers cannot stick
            if prev != self.job_context:
                try:
                    from fast_answer import cache_clear

                    cache_clear()
                except Exception:
                    pass
        if tone:
            self.tone = tone

    def _sync_pack_role(self, job_context: str) -> None:
        """Keep session pack.role aligned; scrub foreign ATTP JD under BRIM role."""
        try:
            from session_context import scrub_pack_for_role, update_pack

            role = (job_context or "").strip()
            update_pack(role=role)
            if role:
                scrub_pack_for_role(role)
        except Exception:
            pass

    def inject_question(self, question: str) -> None:
        """
        Manual question inject (STT lag fallback — market pattern).
        Cancels any in-flight answer generation for a prior question.
        """
        q = (question or "").strip()
        if not q:
            self._emit("error", {"message": "Empty question"})
            return
        try:
            from latency_metrics import get_registry

            get_registry().incr("manual_injects")
        except Exception:
            pass
        # Cancel stale streams — new question always wins
        turn = self._get_turn_sm().begin_answer(inject=True)
        self._generation = turn.generation
        self._active_turn_id = turn.turn_id
        with self._process_lock:
            self._pending.clear()  # drop queued STT clips behind this inject
        self._emit(
            "status",
            {
                "message": "Question received — preparing…",
                "listening": True,
                "answering": True,
                "turn_id": turn.turn_id,
                "request_id": turn.request_id,
                "generation": turn.generation,
            },
        )
        self._emit(
            "turn",
            {
                "state": "ANSWER_GENERATING",
                "turn_id": turn.turn_id,
                "request_id": turn.request_id,
                "generation": turn.generation,
            },
        )

        def _run_inject() -> None:
            self._job_id += 1
            job_id = self._job_id
            gen = turn.generation
            try:
                self._generate_and_emit(
                    q,
                    stt_ms=0.0,
                    classify_ms=0.0,
                    job_id=job_id,
                    gen=gen,
                    turn_id=turn.turn_id,
                    request_id=turn.request_id,
                )
            except Exception as e:
                traceback.print_exc()
                self._emit("error", {"message": str(e)})

        threading.Thread(target=_run_inject, daemon=True, name="inject-q").start()

    def _generate_and_emit(
        self,
        question: str,
        *,
        stt_ms: float = 0.0,
        classify_ms: float | None = None,
        job_id: int = 0,
        gen: int = 0,
        vad_ms: float | None = None,
        turn_id: str = "",
        request_id: str = "",
    ) -> None:
        """Core answer cascade + latency trace emit (used by STT path and inject)."""
        _sess_token = None
        reset_session_id = None
        try:
            from session_context import get_depth, reset_session_id, set_session_id

            if self.session_id:
                _sess_token = set_session_id(self.session_id)
            job_ctx = (self.job_context or "").strip()
            depth = get_depth()
        except Exception:
            job_ctx = (self.job_context or "").strip()
            depth = "balanced"

        try:
            self._generate_and_emit_body(
                question,
                stt_ms=stt_ms,
                classify_ms=classify_ms,
                job_id=job_id,
                gen=gen,
                vad_ms=vad_ms,
                job_ctx=job_ctx,
                depth=depth,
                turn_id=turn_id,
                request_id=request_id,
            )
        finally:
            if _sess_token is not None and reset_session_id is not None:
                try:
                    reset_session_id(_sess_token)
                except Exception:
                    pass

    def _generate_and_emit_body(
        self,
        question: str,
        *,
        stt_ms: float = 0.0,
        classify_ms: float | None = None,
        job_id: int = 0,
        gen: int = 0,
        vad_ms: float | None = None,
        job_ctx: str = "",
        depth: str = "balanced",
        turn_id: str = "",
        request_id: str = "",
    ) -> None:
        from answer_engine import (
            generate_answer,
            to_bullets,
            _normalize_answer_text,
        )
        from answer_engine import iter_answer_tokens
        from fast_answer import iter_cascade_answer

        self._emit(
            "status",
            {
                "message": f"Writing answer ({self.mode})…",
                "listening": True,
                "answering": True,
                "job_id": job_id,
            },
        )
        self._emit(
            "answer_pending",
            {"question": question, "mode": self.mode, "job_id": job_id},
        )

        t1 = time.perf_counter()
        first_token_ms: float | None = None
        outline_ms: float | None = None
        cache_ms: float | None = None
        llm_first_ms: float | None = None
        answer = ""
        source = "llm"
        stages: dict[str, Any] = {}
        try:
            last_emit_len = 0
            raw_answer = ""
            seq = 0
            for text, meta in iter_cascade_answer(
                question,
                job_context=job_ctx,
                tone=self.tone,
                mode=self.mode,
                answer_model=self.answer_model,
                fallback_model=self.fallback_model,
                user_answer_model=self.user_answer_model,
                user_fallback_model=self.user_fallback_model,
                llm_streamer=iter_answer_tokens,
            ):
                if gen != self._generation or self._stop.is_set():
                    break
                if turn_id and self._active_turn_id and turn_id != self._active_turn_id:
                    break  # superseded by a newer turn
                raw_answer = text or ""
                source = str(meta.get("source") or source)
                if meta.get("cache_ms") is not None:
                    cache_ms = float(meta["cache_ms"])
                if meta.get("outline_ms") is not None:
                    outline_ms = float(meta["outline_ms"])
                if meta.get("llm_first_token_ms") is not None:
                    llm_first_ms = float(meta["llm_first_token_ms"])
                if meta.get("stages"):
                    stages = dict(meta["stages"])
                rid = request_id or meta.get("request_id") or ""
                tid = turn_id or meta.get("turn_id") or ""
                if first_token_ms is None and raw_answer:
                    first_token_ms = round(
                        float(meta.get("first_paint_ms") or (time.perf_counter() - t1) * 1000)
                    )
                is_final = bool(meta.get("final"))
                # Emit more often for Hook first paint (every ~40 chars or first chunk)
                if raw_answer and (
                    is_final
                    or len(raw_answer) - last_emit_len >= 40
                    or last_emit_len == 0
                ):
                    last_emit_len = len(raw_answer)
                    answer = _normalize_answer_text(raw_answer, question, job_ctx)
                    seq += 1
                    if not is_final:
                        partial_bullets = to_bullets(answer, self.mode) or [answer]
                        self._emit(
                            "answer",
                            {
                                "question": question,
                                "answer": answer,
                                "bullets": partial_bullets,
                                "mode": self.mode,
                                "streaming": True,
                                "source": source,
                                "stt_ms": stt_ms,
                                "classify_ms": classify_ms,
                                "cache_ms": cache_ms,
                                "outline_ms": outline_ms,
                                "first_token_ms": first_token_ms,
                                "first_useful_ms": meta.get("first_useful_ms")
                                or first_token_ms,
                                "llm_first_token_ms": llm_first_ms,
                                "answer_ms": round((time.perf_counter() - t1) * 1000),
                                "pipeline_ms": round((time.perf_counter() - t1) * 1000),
                                "full_answer_ms": None,
                                "job_id": job_id,
                                "request_id": rid,
                                "turn_id": tid,
                                "generation": gen,
                                "sequence_number": seq,
                                "answer_mode": meta.get("answer_mode"),
                                "grounding": meta.get("grounding"),
                                "stages": stages,
                                "depth": depth,
                            },
                        )
                if is_final:
                    break

            if raw_answer and len(raw_answer) != last_emit_len:
                answer = _normalize_answer_text(raw_answer, question, job_ctx)

            # Final gate: never ship ambient ATTP when Role/Q did not ask for it
            try:
                from common_sense import has_invented_product_bleed

                if answer and has_invented_product_bleed(
                    answer, question=question, job_context=job_ctx
                ):
                    clean = generate_answer(
                        question,
                        answer_model=self.answer_model,
                        fallback_model=self.fallback_model,
                        user_answer_model=self.user_answer_model,
                        user_fallback_model=self.user_fallback_model,
                        job_context=job_ctx,
                        tone=self.tone,
                        mode=self.mode,
                    )
                    clean = _normalize_answer_text(clean, question, job_ctx)
                    if clean and not has_invented_product_bleed(
                        clean, question=question, job_context=job_ctx
                    ):
                        answer = clean
                        source = "bleed_regen"
            except Exception:
                pass

            if not answer:
                answer = generate_answer(
                    question,
                    answer_model=self.answer_model,
                    fallback_model=self.fallback_model,
                    user_answer_model=self.user_answer_model,
                    user_fallback_model=self.user_fallback_model,
                    job_context=job_ctx,
                    tone=self.tone,
                    mode=self.mode,
                )
                answer = _normalize_answer_text(answer, question, job_ctx)
                source = "blocking_fallback"
        except Exception as gen_err:
            traceback.print_exc()
            self._emit("error", {"message": f"Answer generation failed: {gen_err}"})
            from fast_answer import instant_answer

            answer, source, ms = instant_answer(
                question, job_context=job_ctx, mode=self.mode
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

        # Never emit blank final answers (support #23)
        if not (answer or "").strip():
            from fast_answer import instant_answer as _ia

            answer, source, _ms = _ia(question, job_context=job_ctx, mode=self.mode)
            answer = _normalize_answer_text(answer) or (
                f"Hook: Here's how I'd approach that.\n"
                f"Situation: {question[:120]}\n"
                f"Action: I'd clarify constraints, pick a concrete approach, and validate the result.\n"
                f"Close: Happy to go deeper on any part."
            )
            source = source or "empty_guard"

        if self._stop.is_set() or gen != self._generation:
            return  # cancelled — do not emit stale final
        if turn_id and self._active_turn_id and turn_id != self._active_turn_id:
            return

        ans_ms = round((time.perf_counter() - t1) * 1000)
        if first_token_ms is None:
            first_token_ms = ans_ms
        bullets = to_bullets(answer, self.mode)
        if not bullets and answer:
            bullets = [answer]

        from pipeline_utils import question_fingerprint

        fp = question_fingerprint(question)
        self._last_fp = fp
        self._recent_fps.append(fp)
        if len(self._recent_fps) > 8:
            self._recent_fps = self._recent_fps[-8:]

        total_ms = round(float(stt_ms or 0) + ans_ms, 2)
        first_useful_ms = None
        try:
            first_useful_ms = stages.get("first_useful_ms")
        except Exception:
            first_useful_ms = None
        if first_useful_ms is None:
            first_useful_ms = first_token_ms
        latency_trace = {
            "vad_ms": vad_ms,
            "stt_ms": stt_ms,
            "classify_ms": classify_ms,
            "cache_ms": cache_ms,
            "outline_ms": outline_ms,
            "first_token_ms": first_token_ms,
            "first_useful_ms": first_useful_ms,
            "llm_first_token_ms": llm_first_ms,
            "full_answer_ms": ans_ms,
            "total_ms": total_ms,
            "source": source,
            "depth": depth,
            "stages": stages,
            "request_id": stages.get("request_id"),
            "turn_id": stages.get("turn_id"),
            "answer_mode": stages.get("answer_mode"),
        }
        try:
            from latency_metrics import record_trace

            record_trace(
                question=question[:200],
                source=source,
                depth=depth,
                vad_ms=vad_ms,
                stt_ms=stt_ms if stt_ms else None,
                classify_ms=classify_ms,
                cache_ms=cache_ms,
                outline_ms=outline_ms,
                first_token_ms=first_token_ms,
                first_useful_ms=first_useful_ms,
                full_answer_ms=ans_ms,
                total_ms=total_ms,
                from_cache="cache" in (source or ""),
                outline_first=outline_ms is not None,
                words=len((answer or "").split()),
                request_id=str(stages.get("request_id") or ""),
                turn_id=str(stages.get("turn_id") or ""),
                meta={
                    "llm_first_token_ms": llm_first_ms,
                    "answer_mode": stages.get("answer_mode"),
                    "grounding_violations": stages.get("grounding_violations"),
                },
            )
        except Exception:
            pass

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
                "classify_ms": classify_ms,
                "cache_ms": cache_ms,
                "outline_ms": outline_ms,
                "first_token_ms": first_token_ms,
                "first_useful_ms": first_useful_ms,
                "llm_first_token_ms": llm_first_ms,
                "answer_ms": ans_ms,
                # Honest E2E: full answer path time (not first-token paint)
                "pipeline_ms": ans_ms,
                "full_answer_ms": ans_ms,
                "total_pipeline_ms": total_ms,
                "job_id": job_id,
                "request_id": request_id or stages.get("request_id"),
                "turn_id": turn_id or stages.get("turn_id"),
                "generation": gen,
                "answer_mode": stages.get("answer_mode"),
                "latency_trace": latency_trace,
                "stages": stages,
                "depth": depth,
            },
        )
        try:
            self._get_turn_sm().mark_answer_done(turn_id or self._active_turn_id)
        except Exception:
            pass
        self._emit(
            "latency",
            {
                **latency_trace,
                "job_id": job_id,
                "question": question[:160],
                "turn_id": turn_id or stages.get("turn_id"),
                "request_id": request_id or stages.get("request_id"),
                "generation": gen,
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

    def _run(self) -> None:
        try:
            # CRITICAL: open capture BEFORE Whisper load so the first question
            # is not dropped while the model warms (that caused 1-word STT tails).
            if self._source == "browser":
                # Client PCM is speaker/tab audio by default (not the candidate mic)
                self._emit(
                    "status",
                    {
                        "message": "Waiting for speaker/tab audio from browser…",
                    },
                )
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
                device = "speakers/tab"
                status_msg = (
                    "Live session ON · speakers/tab audio · your mic stays off — "
                    "only the interviewer should be shared"
                )
            else:
                self._emit(
                    "status",
                    {"message": "Opening system audio (Stereo Mix / loopback)…"},
                )
                self._capture = get_audio_capture()
                self._capture.start_capture()
                device = getattr(self._capture, "device", "unknown")
                using_mic = bool(
                    getattr(self._capture, "diagnostics", lambda: {})().get(
                        "using_microphone"
                    )
                )
                if using_mic:
                    status_msg = (
                        f"Live session ON · {device} · WARNING: microphone fallback — "
                        "your spoken answers may be transcribed"
                    )
                else:
                    status_msg = (
                        f"Live session ON · {device} · PC speakers only — "
                        "answer out loud; your voice is not captured"
                    )

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

            # Prefer Deepgram Nova-3 streaming; warm Whisper only as fallback
            self._start_deepgram_stream()
            if self._stt_provider != "deepgram":
                try:
                    get_whisper_model()
                except Exception as e:
                    self._emit("error", {"message": f"Whisper load failed: {e}"})
            else:
                # Lazy-warm Whisper in background for fallback without blocking
                threading.Thread(
                    target=lambda: get_whisper_model(),
                    daemon=True,
                    name="whisper-warm",
                ).start()

            # Warm the LLM provider's TCP/TLS connection in the background so
            # question #1 doesn't pay a ~2-3s cold-connection penalty (measured
            # first_token_ms ~2900ms on Q1 vs ~300ms steady-state otherwise).
            try:
                from answer_engine import warm_llm_connection
                from latency_metrics import get_registry

                get_registry().mark_session_start()
                threading.Thread(
                    target=warm_llm_connection, daemon=True, name="llm-warm"
                ).start()
            except Exception:
                pass

            while not self._stop.is_set():
                self._tick_vad()
                self._feed_deepgram_from_ring()
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

    def _feed_deepgram_from_ring(self) -> None:
        """
        System-audio path: pull new samples from the capture ring into Deepgram.
        Browser path already feeds via push_audio.
        """
        dg = self._dg_stream
        if dg is None or self._source == "browser":
            return
        cap = self._capture
        if cap is None:
            return
        try:
            # Prefer incremental API if capture exposes it
            if hasattr(cap, "read_new_int16"):
                chunk = cap.read_new_int16()  # type: ignore[attr-defined]
                if chunk is not None and len(chunk) > 0:
                    dg.send_pcm_int16(np.asarray(chunk, dtype=np.int16))
                return
            # Fallback: last 200ms window (small overlap is fine for STT)
            if hasattr(cap, "get_last_n_seconds"):
                clip = cap.get_last_n_seconds(0.2)
                if clip is not None and len(clip) > 0:
                    dg.send_pcm_int16(np.asarray(clip, dtype=np.int16))
        except Exception:
            pass

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

            stt_provider = self._stt_provider
            self._emit(
                "status",
                {
                    "message": (
                        "Transcribing (Deepgram Nova-3)…"
                        if stt_provider == "deepgram"
                        else "Transcribing (Whisper)…"
                    ),
                    "listening": True,
                    "job_id": job_id,
                    "stt_provider": stt_provider,
                },
            )
            t0 = time.perf_counter()
            text = ""
            stt_meta: dict[str, Any] = {"provider": stt_provider}

            # 1) Prefer continuous Deepgram stream finals (lowest latency)
            if stt_provider == "deepgram" and self._dg_stream is not None:
                try:
                    text = self._dg_stream.finalize_turn(wait_s=0.4)
                    stt_meta = {
                        "provider": "deepgram",
                        "model": "nova-3",
                        "mode": "live_stream",
                        "ms": round((time.perf_counter() - t0) * 1000, 2),
                    }
                except Exception as e:
                    stt_meta["stream_error"] = str(e)

            # 2) Deepgram clip stream / REST if live stream empty
            if not (text or "").strip():
                text, stt_meta = transcribe_best(
                    audio,
                    prefer=stt_provider,
                    api_key=self._dg_api_key,
                )

            stt_ms = round(
                float(stt_meta.get("ms") or (time.perf_counter() - t0) * 1000)
            )
            # Prefer wall clock for total if meta ms is partial
            stt_ms = max(stt_ms, round((time.perf_counter() - t0) * 1000))

            if gen != self._generation or self._stop.is_set():
                return

            if not text or not text.strip():
                # Quick retry only — no long sleeps on the hot path
                retry = self._snapshot(max(speech_s, 4.0))
                if retry is not None and len(retry) > len(audio):
                    text, stt_meta = transcribe_best(
                        retry,
                        prefer=stt_provider,
                        api_key=self._dg_api_key,
                    )
                    stt_ms = round((time.perf_counter() - t0) * 1000)
                if not text or not text.strip():
                    self._emit(
                        "status",
                        {
                            "message": "Couldn't make out words — still listening. "
                            "If this repeats: raise volume, re-share tab with audio, or check STT (Deepgram)."
                        },
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
                    text2, meta2 = transcribe_best(
                        retry,
                        prefer=stt_provider,
                        api_key=self._dg_api_key,
                    )
                    words2 = [w for w in (text2 or "").strip().split() if w]
                    if len(words2) > len(words):
                        text = text2
                        words = words2
                        stt_meta = meta2
                        stt_ms = round((time.perf_counter() - t0) * 1000)
                if len(words) < 4 and not (text or "").strip().endswith("?"):
                    self._emit(
                        "status",
                        {
                            "message": (
                                f"Heard a short fragment ({len(words)} words) — "
                                "still listening for the full question. "
                                "You can also paste it below and send."
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

            # Deduplicate overlapping partial/final STT segments
            try:
                from turn_state import dedupe_transcript_segments

                text = dedupe_transcript_segments(
                    "",
                    text,
                    previous_finals=self._last_transcript_finals,
                )
            except Exception:
                pass
            if not (text or "").strip():
                return
            self._last_transcript_finals.append(text.strip())
            self._last_transcript_finals = self._last_transcript_finals[-8:]

            # Begin question-finalize turn (cancels any in-flight answer)
            sm = self._get_turn_sm()
            turn_ctx = sm.begin_question_finalize()
            self._generation = turn_ctx.generation
            self._active_turn_id = turn_ctx.turn_id
            gen = turn_ctx.generation

            self._emit(
                "transcript",
                {
                    "text": text,
                    "stt_ms": stt_ms,
                    "final": True,
                    "role": "interviewer",  # never candidate — speakers/tab only
                    "stt_provider": stt_meta.get("provider") or stt_provider,
                    "stt_model": stt_meta.get("model"),
                    "stt_mode": stt_meta.get("mode"),
                    "turn_id": turn_ctx.turn_id,
                    "request_id": turn_ctx.request_id,
                    "generation": gen,
                },
            )

            from answer_engine import looks_like_question

            soft_q = looks_like_question(text)
            # Fast path: skip classify LLM when heuristics already say "question"
            # (saves ~0.5–2s before answer generation starts).
            t_cls = time.perf_counter()
            if soft_q:
                classification = {
                    "is_interview_question": True,
                    "confidence": 0.85,
                    "cleaned_question": text.strip(),
                    "reason": "heuristic_soft_q",
                }
            else:
                classification = classify_utterance(text, min_words=4)
            classify_ms = round((time.perf_counter() - t_cls) * 1000)
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
                sm.begin_listening()
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
                    sm.begin_listening()
                    return

            # Move to answer-generating
            try:
                from turn_state import LiveTurnState

                sm.transition(LiveTurnState.ANSWER_GENERATING)
            except Exception:
                pass

            # Shared cascade + stage metrics (also used by manual inject)
            self._generate_and_emit(
                question,
                stt_ms=float(stt_ms or 0),
                classify_ms=float(classify_ms),
                job_id=job_id,
                gen=gen,
                vad_ms=None,
                turn_id=turn_ctx.turn_id,
                request_id=turn_ctx.request_id,
            )
            return
        except Exception as e:
            traceback.print_exc()
            self._emit("error", {"message": str(e)})
        finally:
            self._finish_job_and_drain()
