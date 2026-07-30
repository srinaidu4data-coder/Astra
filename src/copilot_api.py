#!/usr/bin/env python3
"""
InterviewPulse / Astra real copilot API.

Wires the dormant React UI to:
  - faster-whisper STT
  - OpenAI classify + STAR/script answers
  - practice audio file runner (segment → STT → auto-answer)

Run:
  cd src
  venv\\Scripts\\python.exe copilot_api.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Generator, Optional

import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Ensure local imports work when launched from any cwd
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from answer_engine import (  # noqa: E402
    generate_answer,
    iter_answer_tokens,
    to_bullets,
)
from config import get_openai_api_key  # noqa: E402
from rag import (  # noqa: E402
    classify_utterance,
    search_context,
)
from transcriber import get_whisper_model, transcribe_audio  # noqa: E402

app = FastAPI(title="InterviewPulse Copilot API", version="1.0.0")

# Auth (Google) + Stripe billing share this process so the UI hits one origin.
# Mock interview is core product — mount even if auth/billing deps fail
try:
    from backend.mock_interview import router as mock_router  # noqa: E402

    app.include_router(mock_router)
except Exception as _mock_err:  # pragma: no cover
    print(f"[mock] router not loaded: {_mock_err}")

try:
    from backend.database import create_db_and_tables  # noqa: E402
    from backend.admin import router as admin_router  # noqa: E402
    from backend.billing import router as billing_router  # noqa: E402
    from backend.google_oauth import router as oauth_router  # noqa: E402
    from backend.password_auth import router as password_router  # noqa: E402

    create_db_and_tables()
    app.include_router(oauth_router)
    app.include_router(password_router)
    app.include_router(billing_router)
    app.include_router(admin_router)
except Exception as _auth_import_err:  # pragma: no cover - optional until deps installed
    print(f"[auth] Google/Stripe/password/admin routers not loaded: {_auth_import_err}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_AUDIO = ROOT / "test_audio" / "ai_ml_interview_20q.wav"
DEFAULT_AUDIO_MP3 = ROOT / "test_audio" / "ai_ml_interview_20q.mp3"
SAMPLE_RATE = 16000


class AnswerRequest(BaseModel):
    question: str
    job_context: str = "AI/ML Engineer"
    tone: str = "confident"
    mode: str = Field(default="star", description="star | shorter | technical | code")
    # Optional overrides (validated against ALLOWED_MODELS); else per-user / global defaults
    answer_model: Optional[str] = None
    fallback_model: Optional[str] = None


class FileRunRequest(BaseModel):
    path: Optional[str] = None
    max_questions: int = 3
    job_context: str = "AI/ML Engineer"
    tone: str = "confident"
    mode: str = "star"
    min_segment_sec: float = 1.5
    silence_ms: int = 900
    silence_threshold: float = 0.012


def _load_audio_int16_16k(path: Path) -> np.ndarray:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(str(path))

    # WAV via stdlib when possible
    if path.suffix.lower() == ".wav":
        import wave

        with wave.open(str(path), "rb") as wf:
            nch = wf.getnchannels()
            sw = wf.getsampwidth()
            rate = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
        if sw != 2:
            # fall through to pydub
            pass
        else:
            audio = np.frombuffer(raw, dtype=np.int16)
            if nch > 1:
                audio = audio.reshape(-1, nch).mean(axis=1).astype(np.int16)
            if rate != SAMPLE_RATE:
                # simple resample via pydub preferred
                try:
                    from pydub import AudioSegment

                    seg = AudioSegment(
                        data=audio.tobytes(),
                        sample_width=2,
                        frame_rate=rate,
                        channels=1,
                    )
                    seg = seg.set_frame_rate(SAMPLE_RATE)
                    return np.frombuffer(seg.raw_data, dtype=np.int16)
                except Exception:
                    # linear resample fallback
                    duration = len(audio) / rate
                    target = int(duration * SAMPLE_RATE)
                    x_old = np.linspace(0, 1, num=len(audio), endpoint=False)
                    x_new = np.linspace(0, 1, num=target, endpoint=False)
                    return np.interp(x_new, x_old, audio.astype(np.float32)).astype(np.int16)
            return audio

    from pydub import AudioSegment

    seg = AudioSegment.from_file(str(path))
    seg = seg.set_frame_rate(SAMPLE_RATE).set_channels(1).set_sample_width(2)
    return np.frombuffer(seg.raw_data, dtype=np.int16)


def _segment_by_silence(
    audio: np.ndarray,
    *,
    silence_ms: int = 900,
    silence_threshold: float = 0.012,
    min_segment_sec: float = 1.5,
    frame_ms: int = 30,
) -> list[tuple[int, int]]:
    """Return (start_sample, end_sample) speech segments separated by silence."""
    if audio is None or len(audio) == 0:
        return []

    frame = max(1, int(SAMPLE_RATE * frame_ms / 1000))
    silence_frames_needed = max(1, int(silence_ms / frame_ms))
    min_samples = int(min_segment_sec * SAMPLE_RATE)

    f32 = audio.astype(np.float32) / 32768.0
    # boost quiet interview mixes
    peak = float(np.max(np.abs(f32))) + 1e-9
    if peak < 0.15:
        f32 = np.clip(f32 * min(25.0, 0.35 / peak), -1.0, 1.0)

    energies: list[float] = []
    for i in range(0, len(f32), frame):
        chunk = f32[i : i + frame]
        if len(chunk) == 0:
            continue
        energies.append(float(np.sqrt(np.mean(chunk * chunk))))

    segments: list[tuple[int, int]] = []
    in_speech = False
    seg_start = 0
    silent_run = 0

    for idx, e in enumerate(energies):
        if e >= silence_threshold:
            silent_run = 0
            if not in_speech:
                in_speech = True
                seg_start = idx * frame
        else:
            if in_speech:
                silent_run += 1
                if silent_run >= silence_frames_needed:
                    end = (idx - silent_run + 1) * frame
                    if end - seg_start >= min_samples:
                        segments.append((seg_start, min(end, len(audio))))
                    in_speech = False
                    silent_run = 0

    if in_speech:
        end = len(audio)
        if end - seg_start >= min_samples:
            segments.append((seg_start, end))

    return segments


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stream_answer_text(
    question: str,
    *,
    job_context: str,
    tone: str,
    mode: str,
    answer_model: Optional[str] = None,
    fallback_model: Optional[str] = None,
    user_answer_model: Optional[str] = None,
    user_fallback_model: Optional[str] = None,
) -> Generator[str, None, None]:
    """Stream depth-first interview answers (strategy-aware prompts)."""
    yield from iter_answer_tokens(
        question,
        job_context=job_context,
        tone=tone,
        mode=mode,
        answer_model=answer_model,
        fallback_model=fallback_model,
        user_answer_model=user_answer_model,
        user_fallback_model=user_fallback_model,
    )


@app.get("/api/health")
def health():
    key = bool(get_openai_api_key())
    audio_wav = DEFAULT_AUDIO.exists()
    audio_mp3 = DEFAULT_AUDIO_MP3.exists()
    return {
        "ok": True,
        "openai_key": key,
        "whisper_model_ready": True,
        "default_audio_wav": str(DEFAULT_AUDIO) if audio_wav else None,
        "default_audio_mp3": str(DEFAULT_AUDIO_MP3) if audio_mp3 else None,
    }


@app.post("/api/warm")
def warm():
    """Preload Whisper, seed answer cache, warm OpenAI connection."""
    t0 = time.perf_counter()
    get_whisper_model()
    seeded = 0
    try:
        from fast_answer import warm_cache_seed

        seeded = warm_cache_seed()
    except Exception:
        seeded = 0
    openai_ms = None
    try:
        from rag import _get_openai_client
        from answer_engine import FAST_ANSWER_MODEL, FAST_FALLBACK_MODEL

        client = _get_openai_client()
        t1 = time.perf_counter()
        for mid in (FAST_ANSWER_MODEL, FAST_FALLBACK_MODEL, "gpt-4o-mini"):
            try:
                client.chat.completions.create(
                    model=mid,
                    messages=[{"role": "user", "content": "ok"}],
                    max_tokens=1,
                    temperature=0,
                    timeout=8.0,
                )
                break
            except Exception:
                continue
        openai_ms = round((time.perf_counter() - t1) * 1000)
    except Exception:
        openai_ms = None
    return {
        "ok": True,
        "load_ms": round((time.perf_counter() - t0) * 1000),
        "openai_warm_ms": openai_ms,
        "cache_seeded": seeded,
    }


def _wav_bytes_to_int16_16k(raw: bytes) -> np.ndarray:
    """Decode a PCM WAV (or bare int16 PCM) into mono int16 @ 16 kHz."""
    import io
    import wave

    if len(raw) < 12:
        raise HTTPException(400, "audio too short")

    # Prefer stdlib wave for RIFF/WAV
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        try:
            with wave.open(io.BytesIO(raw), "rb") as wf:
                nch = wf.getnchannels()
                sw = wf.getsampwidth()
                rate = wf.getframerate()
                frames = wf.readframes(wf.getnframes())
            if sw != 2:
                raise HTTPException(400, f"only 16-bit PCM supported (got {sw * 8}-bit)")
            audio = np.frombuffer(frames, dtype=np.int16)
            if nch > 1:
                audio = audio.reshape(-1, nch).mean(axis=1).astype(np.int16)
            if rate != SAMPLE_RATE and len(audio) > 0:
                duration = len(audio) / float(rate)
                target = max(1, int(duration * SAMPLE_RATE))
                x_old = np.linspace(0, 1, num=len(audio), endpoint=False)
                x_new = np.linspace(0, 1, num=target, endpoint=False)
                audio = np.interp(x_new, x_old, audio.astype(np.float32)).astype(np.int16)
            return audio
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"invalid wav: {e}") from e

    # Fallback: little-endian int16 PCM already at 16 kHz
    if len(raw) % 2 != 0:
        raw = raw[:-1]
    return np.frombuffer(raw, dtype=np.int16)


@app.post("/api/transcribe")
async def transcribe_route(
    request: Request,
    file: Optional[UploadFile] = File(None),
):
    """Mic → Whisper. Used by Practice Dictate (reliable path)."""
    t0 = time.perf_counter()
    if file is not None:
        raw = await file.read()
    else:
        raw = await request.body()
    if not raw or len(raw) < 44:
        raise HTTPException(400, "empty audio")

    try:
        audio = _wav_bytes_to_int16_16k(raw)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"could not decode audio: {e}") from e

    if len(audio) < SAMPLE_RATE // 4:  # < 250ms
        return {"ok": True, "text": "", "latency_ms": 0, "samples": int(len(audio))}

    try:
        text = transcribe_audio(audio)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"transcription failed: {e}") from e

    return {
        "ok": True,
        "text": (text or "").strip(),
        "latency_ms": round((time.perf_counter() - t0) * 1000),
        "samples": int(len(audio)),
        "duration_sec": round(len(audio) / SAMPLE_RATE, 2),
    }


def _user_model_prefs(request: Request) -> tuple[Optional[str], Optional[str]]:
    """If Authorization Bearer present, load user's assigned models."""
    try:
        auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
        if not auth.lower().startswith("bearer "):
            return None, None
        token = auth.split(" ", 1)[1].strip()
        if not token:
            return None, None
        from backend.database import engine
        from backend.jwt_auth import decode_access_token
        from backend.models import User
        from sqlmodel import Session

        payload = decode_access_token(token)
        uid = payload.get("sub")
        if not uid:
            return None, None
        with Session(engine) as session:
            user = session.get(User, int(uid))
            if not user:
                return None, None
            return getattr(user, "answer_model", None), getattr(user, "fallback_model", None)
    except Exception:
        return None, None


@app.post("/api/answer")
def answer(req: AnswerRequest, request: Request):
    if not req.question.strip():
        raise HTTPException(400, "question required")
    if not get_openai_api_key():
        raise HTTPException(500, "OPENAI_API_KEY missing")

    t0 = time.perf_counter()
    # Fast path: skip classify LLM for typed questions (saves 0.5–2s)
    from answer_engine import ANSWER_PROFILE, looks_like_question
    from fast_answer import cache_lookup, instant_answer

    q = req.question.strip()
    if ANSWER_PROFILE in ("quality", "full"):
        cls = classify_utterance(req.question)
        q = cls.get("cleaned_question") or req.question
    else:
        cls = {
            "is_interview_question": True,
            "confidence": 0.9 if looks_like_question(q) else 0.6,
            "cleaned_question": q,
            "reason": "fast_path_skip_classify",
        }
    u_primary, u_fallback = _user_model_prefs(request)

    source = "llm"
    first_paint_ms = None
    # Instant cache/template for sub-ms paint when profile is ultra/live
    if ANSWER_PROFILE not in ("quality", "full"):
        hit = cache_lookup(q, mode=req.mode or "star", job_context=req.job_context)
        if hit:
            text, source = hit[0], hit[1]
            first_paint_ms = round((time.perf_counter() - t0) * 1000, 2)
        else:
            # Template immediately available; still try LLM upgrade
            draft, src, ms = instant_answer(
                q, job_context=req.job_context, mode=req.mode or "star"
            )
            first_paint_ms = round(ms, 2)
            try:
                text = generate_answer(
                    q,
                    job_context=req.job_context,
                    tone=req.tone,
                    mode=req.mode,
                    answer_model=req.answer_model,
                    fallback_model=req.fallback_model,
                    user_answer_model=u_primary,
                    user_fallback_model=u_fallback,
                )
                source = "llm" if text else src
                if not text:
                    text = draft
                    source = src
            except Exception:
                text = draft
                source = src
    else:
        text = generate_answer(
            q,
            job_context=req.job_context,
            tone=req.tone,
            mode=req.mode,
            answer_model=req.answer_model,
            fallback_model=req.fallback_model,
            user_answer_model=u_primary,
            user_fallback_model=u_fallback,
        )

    full_ms = round((time.perf_counter() - t0) * 1000)
    return {
        "question": req.question,
        "classification": cls,
        "answer": text,
        "bullets": _to_bullets(text, req.mode),
        # Latency tile: first paint (cache/template) when available
        "latency_ms": first_paint_ms if first_paint_ms is not None else full_ms,
        "first_paint_ms": first_paint_ms,
        "full_ms": full_ms,
        "source": source,
        "model_profile": ANSWER_PROFILE,
    }


@app.post("/api/answer/stream")
def answer_stream(req: AnswerRequest, request: Request):
    if not req.question.strip():
        raise HTTPException(400, "question required")
    if not get_openai_api_key():
        raise HTTPException(500, "OPENAI_API_KEY missing")

    u_primary, u_fallback = _user_model_prefs(request)

    def gen():
        t0 = time.perf_counter()
        try:
            cls = classify_utterance(req.question)
            yield _sse("classification", cls)
            q = cls.get("cleaned_question") or req.question
            acc = ""
            first = True
            for tok in _stream_answer_text(
                q,
                job_context=req.job_context,
                tone=req.tone,
                mode=req.mode,
                answer_model=req.answer_model,
                fallback_model=req.fallback_model,
                user_answer_model=u_primary,
                user_fallback_model=u_fallback,
            ):
                acc += tok
                payload = {
                    "delta": tok,
                    "text": acc,
                    "first_token_ms": round((time.perf_counter() - t0) * 1000) if first else None,
                }
                first = False
                yield _sse("token", payload)
            yield _sse(
                "done",
                {
                    "text": acc,
                    "bullets": _to_bullets(acc, req.mode),
                    "latency_ms": round((time.perf_counter() - t0) * 1000),
                },
            )
        except Exception as e:
            traceback.print_exc()
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/run-test-audio")
def run_test_audio(req: FileRunRequest):
    """Process practice interview audio: segment → STT → classify → answer."""
    if not get_openai_api_key():
        raise HTTPException(500, "OPENAI_API_KEY missing")

    path = Path(req.path) if req.path else (DEFAULT_AUDIO if DEFAULT_AUDIO.exists() else DEFAULT_AUDIO_MP3)
    if not path.exists():
        raise HTTPException(404, f"Audio not found: {path}")

    def gen():
        try:
            yield _sse("status", {"message": f"Loading {path.name}…", "path": str(path)})
            t_load = time.perf_counter()
            audio = _load_audio_int16_16k(path)
            load_ms = round((time.perf_counter() - t_load) * 1000)
            duration = len(audio) / SAMPLE_RATE
            yield _sse(
                "status",
                {
                    "message": f"Loaded {duration:.1f}s audio in {load_ms}ms",
                    "duration_sec": duration,
                    "samples": int(len(audio)),
                },
            )

            yield _sse("status", {"message": "Loading Whisper model…"})
            t_w = time.perf_counter()
            get_whisper_model()
            yield _sse(
                "status",
                {"message": f"Whisper ready in {round((time.perf_counter() - t_w) * 1000)}ms"},
            )

            segs = _segment_by_silence(
                audio,
                silence_ms=req.silence_ms,
                silence_threshold=req.silence_threshold,
                min_segment_sec=req.min_segment_sec,
            )
            yield _sse(
                "status",
                {
                    "message": f"Found {len(segs)} speech segments (processing up to {req.max_questions})",
                    "segments": len(segs),
                },
            )

            answered = 0
            for i, (start, end) in enumerate(segs):
                if answered >= req.max_questions:
                    break

                clip = audio[start:end]
                t_stt = time.perf_counter()
                text = transcribe_audio(clip)
                stt_ms = round((time.perf_counter() - t_stt) * 1000)

                yield _sse(
                    "transcript",
                    {
                        "index": i,
                        "start_sec": round(start / SAMPLE_RATE, 2),
                        "end_sec": round(end / SAMPLE_RATE, 2),
                        "text": text,
                        "stt_ms": stt_ms,
                        "final": True,
                    },
                )

                if not text or len(text.split()) < 3:
                    yield _sse("status", {"message": f"Segment {i}: empty/short — skip"})
                    continue

                cls = classify_utterance(text)
                yield _sse("classification", {"index": i, **cls})

                # Soft gate: answer if classified as question OR text has ? OR imperative interview shape
                is_q = bool(cls.get("is_interview_question"))
                soft = "?" in text or text.strip().lower().startswith(
                    ("tell me", "what ", "how ", "why ", "explain", "describe", "walk me")
                )
                if not is_q and not soft:
                    yield _sse("status", {"message": f"Segment {i}: not a question — skip"})
                    continue

                q = cls.get("cleaned_question") or text
                yield _sse(
                    "status",
                    {"message": f"Writing speakable answer for Q{answered + 1}…"},
                )
                t_ans = time.perf_counter()
                acc = ""
                first_ms = None
                # Collect full answer first — no token spam to the UI
                for tok in _stream_answer_text(
                    q,
                    job_context=req.job_context,
                    tone=req.tone,
                    mode=req.mode or "star",
                ):
                    if first_ms is None:
                        first_ms = round((time.perf_counter() - t_ans) * 1000)
                    acc += tok

                total_ms = round((time.perf_counter() - t_ans) * 1000)
                answered += 1
                bullets = _to_bullets(acc, req.mode or "star")
                yield _sse(
                    "answer_done",
                    {
                        "index": i,
                        "question": q,
                        "answer": acc,
                        "bullets": bullets,
                        "stt_ms": stt_ms,
                        "first_token_ms": first_ms,
                        "answer_ms": total_ms,
                        "pipeline_ms": stt_ms + total_ms,
                    },
                )

            yield _sse(
                "complete",
                {
                    "answered": answered,
                    "segments": len(segs),
                    "path": str(path),
                },
            )
        except Exception as e:
            traceback.print_exc()
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream")


def _to_bullets(text: str, mode: str) -> list[str]:
    """UI bullets from rich multi-section answers (see answer_engine.to_bullets)."""
    return to_bullets(text, mode)


# ---------------------------------------------------------------------------
# Live interview WebSocket — continuous system-audio listen → STT → answer
# ---------------------------------------------------------------------------

from fastapi import WebSocket, WebSocketDisconnect  # noqa: E402
from live_session import LiveInterviewSession  # noqa: E402


@app.websocket("/ws/interview")
async def ws_interview(websocket: WebSocket):
    """
    Protocol:

    Client → server (JSON text):
      {"type":"start","job_context":"...","tone":"confident","mode":"star","source":"browser"|"system"}
      {"type":"stop"}
      {"type":"set_mode","mode":"shorter"}
      {"type":"set_context","job_context":"...","tone":"..."}
      {"type":"ping"}
      {"type":"audio","pcm_b64":"..."}  # optional base64 int16 LE mono PCM

    Client → server (binary):
      raw int16 little-endian mono PCM chunks (browser mic)

    Server → client:
      {"type":"status"|"listening"|"level"|"transcript"|"answer_pending"|"chatter"|"answer"|"error"|"pong", ...}
    """
    await websocket.accept()
    import asyncio
    import base64

    loop = asyncio.get_event_loop()
    out_q: asyncio.Queue = asyncio.Queue(maxsize=256)
    session_holder: dict[str, Any] = {"session": None}

    def emit(event: str, data: dict[str, Any]) -> None:
        payload = {"type": event, **(data or {})}
        try:
            loop.call_soon_threadsafe(out_q.put_nowait, payload)
        except Exception:
            try:
                # drop oldest if full
                out_q.get_nowait()
            except Exception:
                pass
            try:
                loop.call_soon_threadsafe(out_q.put_nowait, payload)
            except Exception:
                pass

    async def writer():
        while True:
            msg = await out_q.get()
            if msg is None:
                break
            await websocket.send_json(msg)

    writer_task = asyncio.create_task(writer())

    def _feed_pcm(raw: bytes) -> None:
        sess = session_holder.get("session")
        if sess is not None and raw:
            sess.push_audio(raw)

    try:
        await websocket.send_json(
            {
                "type": "status",
                "message": "Connected to live interview backend",
                "listening": False,
            }
        )
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            # Browser mic: binary PCM frames
            data_bytes = message.get("bytes")
            if data_bytes is not None:
                _feed_pcm(data_bytes)
                continue

            raw = message.get("text")
            if raw is None:
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            mtype = (msg.get("type") or "").strip().lower()
            if mtype == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if mtype == "audio":
                # JSON-wrapped base64 PCM (fallback path)
                b64 = msg.get("pcm_b64") or msg.get("data") or ""
                try:
                    _feed_pcm(base64.b64decode(b64))
                except Exception:
                    pass
                continue

            if mtype == "start":
                sess: LiveInterviewSession | None = session_holder.get("session")
                if sess is None or not sess.running:
                    sess = LiveInterviewSession(emit)
                    session_holder["session"] = sess
                # Default browser mic on Linux/cloud (no Stereo Mix / parec).
                # Windows local can still pass source=system for loopback capture.
                source = (msg.get("source") or "").strip().lower()
                if not source:
                    force_browser = os.environ.get(
                        "COPILOT_FORCE_BROWSER_MIC", ""
                    ).lower() in ("1", "true", "yes")
                    force_system = os.environ.get(
                        "COPILOT_FORCE_SYSTEM_AUDIO", ""
                    ).lower() in ("1", "true", "yes")
                    on_cloud = bool(
                        os.environ.get("RAILWAY_ENVIRONMENT")
                        or os.environ.get("RAILWAY_PROJECT_ID")
                        or os.environ.get("RENDER")
                        or os.environ.get("PORT")  # container platforms set PORT
                    )
                    if force_system:
                        source = "system"
                    elif force_browser or on_cloud or sys.platform != "win32":
                        source = "browser"
                    else:
                        source = "system"
                sess.start(
                    job_context=msg.get("job_context") or "AI/ML Engineer",
                    tone=msg.get("tone") or "confident",
                    mode=msg.get("mode") or "star",
                    source=source,
                    answer_model=msg.get("answer_model"),
                    fallback_model=msg.get("fallback_model"),
                    user_answer_model=msg.get("user_answer_model"),
                    user_fallback_model=msg.get("user_fallback_model"),
                )
                continue

            if mtype == "stop":
                sess = session_holder.get("session")
                if sess is not None:
                    sess.stop()
                    session_holder["session"] = None
                continue

            if mtype == "set_mode":
                sess = session_holder.get("session")
                if sess is not None:
                    sess.set_mode(msg.get("mode") or "star")
                continue

            if mtype == "set_context":
                sess = session_holder.get("session")
                if sess is not None:
                    sess.set_context(
                        job_context=msg.get("job_context") or "",
                        tone=msg.get("tone") or "",
                    )
                continue

            await websocket.send_json(
                {"type": "error", "message": f"Unknown message type: {mtype}"}
            )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        traceback.print_exc()
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        sess = session_holder.get("session")
        if sess is not None:
            try:
                sess.stop()
            except Exception:
                pass
        try:
            out_q.put_nowait(None)
        except Exception:
            pass
        writer_task.cancel()


if __name__ == "__main__":
    import uvicorn

    # Load .env from project if present
    env_path = ROOT / ".env"
    if env_path.exists():
        from dotenv import load_dotenv

        load_dotenv(env_path)

    # Railway/Render set PORT; local uses 8787
    port = int(os.environ.get("PORT") or os.environ.get("COPILOT_API_PORT") or "8787")
    # 127.0.0.1 = local only; 0.0.0.0 = production (Docker / Railway / Render)
    host = os.environ.get("COPILOT_API_HOST", "127.0.0.1")
    if os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RENDER"):
        host = os.environ.get("COPILOT_API_HOST", "0.0.0.0")
    print(f"InterviewPulse Copilot API → http://{host}:{port}")
    print(f"  Live WS: ws://{host}:{port}/ws/interview")
    print(f"Default audio: {DEFAULT_AUDIO if DEFAULT_AUDIO.exists() else DEFAULT_AUDIO_MP3}")
    uvicorn.run(app, host=host, port=port, log_level="info")
