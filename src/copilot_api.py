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
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Generator, Optional

import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
# Ensure local imports work when launched from any cwd
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from answer_engine import (  # noqa: E402
    generate_answer,
    iter_answer_tokens,
    to_bullets,
)
from api_models import (  # noqa: E402
    AnswerRequest,
    FileRunRequest,
    InjectQuestionRequest,
    SessionContextRequest,
)
from config import get_openai_api_key  # noqa: E402
from rag import (  # noqa: E402
    classify_utterance,
    search_context,
)
from session_context import session_id_from_token  # noqa: E402
from transcriber import get_whisper_model, transcribe_audio, transcribe_best  # noqa: E402

app = FastAPI(title="InterviewPulse Copilot API", version="1.0.0")


@app.on_event("startup")
def _bootstrap_jd_grounding() -> None:
    """
    Start with an empty session role/job context.

    Practice disk JD is never pre-loaded. UI Role / Job Context / attached
    JD+Resume are set per login and per interview only.
    """
    try:
        from session_context import clear_pack

        clear_pack()
        print("[jd_grounding] startup: session pack cleared (no default role)", flush=True)
    except Exception as e:
        print(f"[jd_grounding] startup skip: {e}", flush=True)

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
    from backend.sprint import router as sprint_router  # noqa: E402

    create_db_and_tables()
    app.include_router(oauth_router)
    app.include_router(password_router)
    app.include_router(billing_router)
    app.include_router(admin_router)
    app.include_router(sprint_router)
except Exception as _auth_import_err:  # pragma: no cover - optional until deps installed
    print(f"[auth] Google/Stripe/password/admin/sprint routers not loaded: {_auth_import_err}")

# Job Search AI lab (localhost-gated) — does not touch interview/answer path
try:
    from jobsearch.api import router as jobsearch_router  # noqa: E402
    from jobsearch.apply_api import router as jobsearch_apply_router  # noqa: E402
    from jobsearch.marvel_api import router as jobsearch_marvel_router  # noqa: E402
    from jobsearch.night_api import router as jobsearch_night_router  # noqa: E402
    from jobsearch.nexus_api import router as jobsearch_nexus_router  # noqa: E402

    app.include_router(jobsearch_router)
    app.include_router(jobsearch_apply_router)
    app.include_router(jobsearch_marvel_router)
    app.include_router(jobsearch_night_router)
    app.include_router(jobsearch_nexus_router)
except Exception as _js_err:  # pragma: no cover
    print(f"[jobsearch] lab router not loaded: {_js_err}")

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


def _merge_close_segments(
    segments: list[tuple[int, int]],
    *,
    max_gap_sec: float = 2.2,
    sample_rate: int = SAMPLE_RATE,
) -> list[tuple[int, int]]:
    """
    Merge speech islands separated by short pauses.

    Multi-clause interview questions often have 0.5–2s mid-sentence pauses
    (TTS and real speakers). Without merging, STT sees fragments and accuracy
    collapses on long SAP/scenario prompts.
    """
    if not segments:
        return []
    max_gap = int(max(0.0, max_gap_sec) * sample_rate)
    merged: list[list[int]] = [[segments[0][0], segments[0][1]]]
    for start, end in segments[1:]:
        prev_end = merged[-1][1]
        if start - prev_end <= max_gap:
            merged[-1][1] = max(prev_end, end)
        else:
            merged.append([start, end])
    return [(a, b) for a, b in merged]


def _segment_by_silence(
    audio: np.ndarray,
    *,
    silence_ms: int = 1400,
    silence_threshold: float = 0.012,
    min_segment_sec: float = 1.2,
    frame_ms: int = 30,
    merge_gap_sec: float = 2.2,
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
    if peak < 0.22:
        f32 = np.clip(f32 * min(35.0, 0.5 / peak), -1.0, 1.0)

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

    return _merge_close_segments(segments, max_gap_sec=merge_gap_sec)


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
    from answer_engine import (
        ANSWER_PROFILE,
        FAST_ANSWER_MODEL,
        FAST_FALLBACK_MODEL,
    )
    from config import get_llm_provider, get_openai_base_url

    key_ok = bool(get_openai_api_key())
    audio_wav = DEFAULT_AUDIO.exists()
    audio_mp3 = DEFAULT_AUDIO_MP3.exists()
    provider = get_llm_provider()
    latency_brief = None
    try:
        from latency_metrics import snapshot

        snap = snapshot()
        latency_brief = {
            "sample_count": snap.get("sample_count"),
            "first_token_p50": (snap.get("stages") or {}).get("first_token_ms", {}).get("p50"),
            "full_answer_p50": (snap.get("stages") or {}).get("full_answer_ms", {}).get("p50"),
            "stt_p50": (snap.get("stages") or {}).get("stt_ms", {}).get("p50"),
            "verdict": (snap.get("verdict") or {}).get("rank_vs_market"),
        }
    except Exception:
        pass
    jd_info: dict[str, Any] = {"loaded": False}
    try:
        from session_context import get_pack

        # Do not surface ambient practice JD as global "loaded" identity
        pack = get_pack()
        jd_info = {
            "loaded": False,
            "practice_jd_env": False,
            "pack_role": pack.role or None,
            "pack_has_jd": bool(pack.job_description),
            "grounding": "per_login_role_job_context_only",
            "latency_ai_agent": True,
            "latency_ai_diagnose": "POST /api/latency/ai-diagnose?quick=true",
        }
    except Exception as e:
        jd_info = {"loaded": False, "error": str(e), "latency_ai_agent": False}
    return {
        "ok": True,
        "openai_key": key_ok,
        "openai_key_configured": key_ok,
        "openai_ready": key_ok,
        "llm_provider": provider,
        "llm_base_url": get_openai_base_url() or "https://api.openai.com/v1",
        "whisper_model_ready": True,
        "answer_profile": ANSWER_PROFILE,
        "fast_model": FAST_ANSWER_MODEL,
        "fast_fallback": FAST_FALLBACK_MODEL,
        "default_audio_wav": str(DEFAULT_AUDIO) if audio_wav else None,
        "default_audio_mp3": str(DEFAULT_AUDIO_MP3) if audio_mp3 else None,
        "latency": latency_brief,
        "jd_grounding": jd_info,
        "stt": _stt_health(),
        "hint": (
            None
            if key_ok
            else "Set GROQ_API_KEY or OPENAI_API_KEY in the process environment."
        ),
    }


def _stt_health() -> dict:
    try:
        from config import DEEPGRAM_MODEL, get_deepgram_api_key, get_stt_provider
        from deepgram_stt import deepgram_status

        provider = get_stt_provider()
        dg = deepgram_status()
        return {
            "provider": provider,
            "deepgram": dg,
            "deepgram_model": DEEPGRAM_MODEL,
            "deepgram_ready": bool(dg.get("ready")),
            "whisper_model": True,
            "active": provider,
            "hint": (
                None
                if provider == "deepgram"
                else (
                    "Set DEEPGRAM_API_KEY for Nova-3 streaming STT "
                    "(much lower latency than local Whisper)."
                    if not get_deepgram_api_key()
                    else "Install websocket-client for Deepgram streaming."
                )
            ),
        }
    except Exception as e:
        return {"provider": "whisper", "error": str(e)}


@app.get("/api/latency/metrics")
def latency_metrics():
    """Stage-by-stage histograms + competitor comparison (live process samples)."""
    from latency_metrics import snapshot

    return snapshot()


@app.get("/api/latency/benchmark")
def latency_benchmark():
    """Static competitor bars + live comparison if samples exist."""
    from latency_metrics import competitor_table

    return competitor_table()


@app.post("/api/latency/reset")
def latency_reset():
    from latency_metrics import get_registry

    get_registry().reset()
    return {"ok": True, "message": "Latency samples cleared"}


@app.post("/api/session/reset")
def session_full_reset(request: Request):
    """
    Full reset for THIS login: pack + this user's answer cache entries + latency.
    """
    cleared_cache = 0
    sid = _http_session_id(request)
    try:
        from session_context import clear_pack, drop_session, session_scope

        with session_scope(sid):
            clear_pack()
        # Also drop WS-style keys that might share this user id prefix
        drop_session(sid)
    except Exception:
        pass
    try:
        from fast_answer import cache_clear

        # Full process cache clear on login/reset — safest multi-tenant fix
        cleared_cache = cache_clear()
    except Exception:
        pass
    try:
        from latency_metrics import get_registry

        get_registry().reset()
    except Exception:
        pass
    return {
        "ok": True,
        "session_id": sid,
        "cache_cleared": cleared_cache,
        "message": "Identity pack and answer cache cleared for this login",
    }


@app.post("/api/latency/ai-diagnose")
def latency_ai_diagnose(
    quick: bool = True,
    include_stt: bool = True,
):
    """
    AI Latency Agent — ms-level pipeline breakdown + LLM recommendation.

    Tells you whether to invest in STT, model, network, prompt, or other.
    Can take 30–180s (STT load + multi LLM probes). Use quick=true for a faster run.
    """
    from latency_ai_agent import run_agent

    report = run_agent(quick=bool(quick), include_stt=bool(include_stt))
    return report


@app.get("/api/latency/ai-diagnose/last")
def latency_ai_diagnose_last():
    """Last AI latency report from this process (if any)."""
    from latency_ai_agent import get_last_report

    return get_last_report()


def _http_session_id(request: Request) -> str:
    """
    Scope HTTP pack by authenticated user (or explicit X-Session-Id).
    Prevents one login's materials bleeding into another user's pack.
    """
    try:
        sid = (request.headers.get("x-session-id") or "").strip()
        if sid:
            return f"http_{sid[:64]}"
        auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
            keyed = session_id_from_token(token)
            if keyed:
                return keyed
    except Exception:
        pass
    return "http_anon"


@app.get("/api/session/context")
def get_session_context(request: Request):
    from session_context import get_pack, session_scope

    with session_scope(_http_session_id(request)):
        return {"ok": True, "pack": get_pack().to_dict()}


@app.post("/api/session/context")
def set_session_context(req: SessionContextRequest, request: Request):
    """
    Pre-session context pack for THIS login only (scoped by JWT / session id).
    """
    from session_context import get_pack, session_scope, update_pack

    with session_scope(_http_session_id(request)):
        kwargs = req.model_dump(exclude_none=True)
        pack = update_pack(**kwargs)
        return {"ok": True, "pack": pack.to_dict(), "empty": pack.is_empty()}


@app.post("/api/answer/inject")
def answer_inject(req: InjectQuestionRequest, request: Request):
    """
    Manual question path when STT lags (same cascade as live, no audio).
    Returns full stage latency for competitor benchmarking.
    """
    if not req.question.strip():
        raise HTTPException(400, "question required")
    if not get_openai_api_key():
        raise HTTPException(500, "OPENAI_API_KEY missing or placeholder")

    from answer_engine import ANSWER_PROFILE, looks_like_question
    from fast_answer import iter_cascade_answer
    from latency_metrics import get_registry, record_trace
    from session_context import get_depth, update_pack

    if req.depth:
        update_pack(depth=req.depth)
    get_registry().incr("manual_injects")

    t0 = time.perf_counter()
    q = req.question.strip()
    # Request job_context is source of truth — blank stays blank
    job = (req.job_context or "").strip()
    depth = get_depth()
    u_primary, u_fallback = _user_model_prefs(request)

    first_paint_ms = None
    first_useful_ms = None
    outline_ms = None
    cache_ms = None
    llm_first_ms = None
    source = "llm"
    acc = ""
    stages: dict[str, Any] = {}
    request_id = ""
    turn_id = ""
    answer_mode = None
    grounding = None

    def streamer(**kwargs):
        return iter_answer_tokens(**kwargs)

    for text, meta in iter_cascade_answer(
        q,
        job_context=job,
        tone=req.tone,
        mode=req.mode or "star",
        answer_model=None,
        fallback_model=None,
        user_answer_model=u_primary,
        user_fallback_model=u_fallback,
        llm_streamer=streamer,
    ):
        acc = text or acc
        source = str(meta.get("source") or source)
        if meta.get("cache_ms") is not None:
            cache_ms = meta["cache_ms"]
        if meta.get("outline_ms") is not None:
            outline_ms = meta["outline_ms"]
        if meta.get("llm_first_token_ms") is not None:
            llm_first_ms = meta["llm_first_token_ms"]
        if meta.get("first_useful_ms") is not None and first_useful_ms is None:
            first_useful_ms = meta["first_useful_ms"]
        if first_paint_ms is None and acc:
            first_paint_ms = meta.get("first_paint_ms")
        if meta.get("stages"):
            stages = dict(meta["stages"])
        if meta.get("request_id"):
            request_id = str(meta["request_id"])
        if meta.get("turn_id"):
            turn_id = str(meta["turn_id"])
        if meta.get("answer_mode"):
            answer_mode = meta["answer_mode"]
        if meta.get("grounding"):
            grounding = meta["grounding"]

    full_ms = round((time.perf_counter() - t0) * 1000)
    if first_paint_ms is None:
        first_paint_ms = full_ms
    if first_useful_ms is None:
        first_useful_ms = stages.get("first_useful_ms") or first_paint_ms
    total_ms = full_ms  # inject has no STT — E2E is full answer completion
    try:
        record_trace(
            question=q[:200],
            source=source,
            depth=depth,
            stt_ms=0,
            classify_ms=0,
            cache_ms=cache_ms,
            outline_ms=outline_ms,
            first_token_ms=first_paint_ms,
            first_useful_ms=first_useful_ms,
            full_answer_ms=full_ms,
            total_ms=total_ms,
            from_cache="cache" in source,
            outline_first=outline_ms is not None,
            words=len((acc or "").split()),
            request_id=request_id,
            turn_id=turn_id,
            meta={
                "path": "inject",
                "llm_first_token_ms": llm_first_ms,
                "answer_mode": answer_mode,
                "grounding": grounding,
            },
        )
    except Exception:
        pass

    return {
        "question": q,
        "answer": acc,
        "bullets": to_bullets(acc, req.mode or "star"),
        "source": source,
        "depth": depth,
        "model_profile": ANSWER_PROFILE,
        # latency_ms stays first paint for the Latency tile
        "latency_ms": first_paint_ms,
        "first_paint_ms": first_paint_ms,
        "first_token_ms": first_paint_ms,
        "first_useful_ms": first_useful_ms,
        "llm_first_token_ms": llm_first_ms,
        "outline_ms": outline_ms,
        "cache_ms": cache_ms,
        "full_ms": full_ms,
        "full_answer_ms": full_ms,
        # Honest end-to-end for typed inject = full completion (not first paint)
        "total_ms": total_ms,
        "request_id": request_id,
        "turn_id": turn_id,
        "answer_mode": answer_mode,
        "grounding": grounding,
        "stages": stages,
        "is_question": looks_like_question(q),
        "openai_ready": True,
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
        for mid in (FAST_ANSWER_MODEL, FAST_FALLBACK_MODEL, "gpt-4.1-nano", "gpt-4o-mini"):
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
    """Mic → Deepgram Nova-3 (if configured) or Whisper. Practice Dictate path."""
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
        text, stt_meta = transcribe_best(audio)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"transcription failed: {e}") from e

    return {
        "ok": True,
        "text": (text or "").strip(),
        "latency_ms": round((time.perf_counter() - t0) * 1000),
        "samples": int(len(audio)),
        "duration_sec": round(len(audio) / SAMPLE_RATE, 2),
        "stt_provider": (stt_meta or {}).get("provider"),
        "stt_model": (stt_meta or {}).get("model"),
        "stt_mode": (stt_meta or {}).get("mode"),
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
        raise HTTPException(
            500,
            "OPENAI_API_KEY missing or placeholder. Set a real key in src/.env",
        )

    t0 = time.perf_counter()
    # Fast path: skip classify LLM for typed questions (saves 0.5–2s)
    from answer_engine import ANSWER_PROFILE, looks_like_question
    from fast_answer import cache_lookup, outline_skeleton
    from latency_metrics import record_trace
    from session_context import get_depth, update_pack

    if req.depth:
        update_pack(depth=req.depth)

    q = req.question.strip()
    job = (req.job_context or "").strip()
    depth = get_depth()
    t_cls = time.perf_counter()
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
    classify_ms = round((time.perf_counter() - t_cls) * 1000, 2)
    u_primary, u_fallback = _user_model_prefs(request)

    source = "llm"
    first_paint_ms = None
    outline_ms = None
    cache_ms = None
    # Instant cache/outline for sub-ms paint when profile is ultra/live
    if ANSWER_PROFILE not in ("quality", "full"):
        t_c = time.perf_counter()
        hit = cache_lookup(q, mode=req.mode or "star", job_context=job)
        cache_ms = round((time.perf_counter() - t_c) * 1000, 2)
        if hit:
            text, source = hit[0], hit[1]
            first_paint_ms = round((time.perf_counter() - t0) * 1000, 2)
        else:
            t_o = time.perf_counter()
            outline = outline_skeleton(q, job_context=job, mode=req.mode or "star")
            outline_ms = round((time.perf_counter() - t_o) * 1000, 2)
            first_paint_ms = round((time.perf_counter() - t0) * 1000, 2)
            try:
                text = generate_answer(
                    q,
                    job_context=job,
                    tone=req.tone,
                    mode=req.mode,
                    answer_model=req.answer_model,
                    fallback_model=req.fallback_model,
                    user_answer_model=u_primary,
                    user_fallback_model=u_fallback,
                )
                last_src = getattr(generate_answer, "last_source", None)
                if not (text or "").strip():
                    text = outline
                    source = "outline"
                elif last_src == "llm":
                    source = "llm"
                elif last_src in ("template_fallback", "template", "cache", "exact_cache"):
                    source = last_src
                else:
                    source = "llm" if text.strip() != outline.strip() else "outline"
            except Exception:
                text = outline
                source = "outline"
    else:
        text = generate_answer(
            q,
            job_context=job,
            tone=req.tone,
            mode=req.mode,
            answer_model=req.answer_model,
            fallback_model=req.fallback_model,
            user_answer_model=u_primary,
            user_fallback_model=u_fallback,
        )
        source = getattr(generate_answer, "last_source", None) or "llm"

    full_ms = round((time.perf_counter() - t0) * 1000)
    if first_paint_ms is None:
        first_paint_ms = full_ms
    try:
        record_trace(
            question=q[:200],
            source=source,
            depth=depth,
            classify_ms=classify_ms,
            cache_ms=cache_ms,
            outline_ms=outline_ms,
            first_token_ms=first_paint_ms,
            full_answer_ms=full_ms,
            total_ms=full_ms,
            from_cache="cache" in (source or ""),
            outline_first=outline_ms is not None,
            words=len((text or "").split()),
            meta={"path": "api_answer"},
        )
    except Exception:
        pass
    return {
        "question": req.question,
        "classification": cls,
        "answer": text,
        "bullets": to_bullets(text, req.mode),
        # Latency tile: first paint (cache/outline) when available
        "latency_ms": first_paint_ms if first_paint_ms is not None else full_ms,
        "first_paint_ms": first_paint_ms,
        "first_token_ms": first_paint_ms,
        "outline_ms": outline_ms,
        "cache_ms": cache_ms,
        "classify_ms": classify_ms,
        "full_ms": full_ms,
        "full_answer_ms": full_ms,
        "total_ms": full_ms,
        "depth": depth,
        "source": source,
        "model_profile": ANSWER_PROFILE,
        "openai_ready": True,
        "stages": {
            "classify_ms": classify_ms,
            "cache_ms": cache_ms,
            "outline_ms": outline_ms,
            "first_token_ms": first_paint_ms,
            "full_answer_ms": full_ms,
        },
    }


@app.post("/api/answer/stream")
def answer_stream(req: AnswerRequest, request: Request):
    """
    Semantic cascade stream for typed questions (non-WS path).

    Events: meta, hook_delta, hook_complete, proof_delta, close_delta,
    timing, done, error — each tagged with request_id / turn_id / sequence.
    """
    if not req.question.strip():
        raise HTTPException(400, "question required")
    if not get_openai_api_key():
        raise HTTPException(
            500,
            "OPENAI_API_KEY missing or placeholder. Set a real key in src/.env",
        )

    u_primary, u_fallback = _user_model_prefs(request)
    session_id = _http_session_id(request)

    def gen():
        import uuid as _uuid

        from answer_engine import looks_like_question
        from fast_answer import iter_cascade_answer
        from latency_metrics import record_trace
        from session_context import get_depth, session_scope, update_pack

        t0 = time.perf_counter()
        request_id = _uuid.uuid4().hex[:12]
        turn_id = _uuid.uuid4().hex[:12]
        seq = 0
        q = req.question.strip()
        job = (req.job_context or "").strip()
        mode = req.mode or "star"
        try:
            with session_scope(session_id):
                if req.depth:
                    update_pack(depth=req.depth)
                depth = get_depth()

                # Deterministic classify — do not block Stage A on LLM classify
                t_cls = time.perf_counter()
                is_q = looks_like_question(q)
                cls = {
                    "is_interview_question": is_q,
                    "confidence": 0.9 if is_q else 0.6,
                    "cleaned_question": q,
                    "reason": "stream_heuristic",
                }
                classify_ms = round((time.perf_counter() - t_cls) * 1000, 2)
                seq += 1
                yield _sse(
                    "meta",
                    {
                        "session_id": session_id,
                        "request_id": request_id,
                        "turn_id": turn_id,
                        "sequence_number": seq,
                        "question": q,
                        "mode": mode,
                        "depth": depth,
                        "classification": cls,
                        "classify_ms": classify_ms,
                    },
                )

                def streamer(**kwargs):
                    return iter_answer_tokens(**kwargs)

                acc = ""
                source = "llm"
                first_paint_ms = None
                first_useful_ms = None
                llm_first_ms = None
                stages: dict[str, Any] = {}
                hook_done = False
                last_hook = ""

                for text, meta in iter_cascade_answer(
                    q,
                    job_context=job,
                    tone=req.tone,
                    mode=mode,
                    user_answer_model=u_primary,
                    user_fallback_model=u_fallback,
                    llm_streamer=streamer,
                ):
                    acc = text or acc
                    source = str(meta.get("source") or source)
                    stages = dict(meta.get("stages") or stages)
                    if meta.get("llm_first_token_ms") is not None:
                        llm_first_ms = meta["llm_first_token_ms"]
                    if first_paint_ms is None and acc:
                        first_paint_ms = meta.get("first_paint_ms")
                    if first_useful_ms is None and meta.get("first_useful_ms") is not None:
                        first_useful_ms = meta["first_useful_ms"]

                    # Split Hook / rest for semantic events
                    hook_text, rest = _split_hook_rest(acc)
                    seq += 1
                    base = {
                        "session_id": session_id,
                        "request_id": request_id,
                        "turn_id": turn_id,
                        "sequence_number": seq,
                        "source": source,
                        "text": acc,
                        "first_paint_ms": first_paint_ms,
                        "first_useful_ms": first_useful_ms,
                        "llm_first_token_ms": llm_first_ms,
                        "answer_mode": meta.get("answer_mode"),
                        "streaming": not bool(meta.get("final")),
                    }
                    if hook_text and hook_text != last_hook:
                        last_hook = hook_text
                        yield _sse(
                            "hook_delta",
                            {**base, "hook": hook_text, "delta": hook_text},
                        )
                        if (
                            not hook_done
                            and len(hook_text) >= 12
                            and hook_text.rstrip().endswith((".", "!", "?"))
                        ):
                            hook_done = True
                            if first_useful_ms is None:
                                first_useful_ms = round(
                                    (time.perf_counter() - t0) * 1000, 2
                                )
                            seq += 1
                            yield _sse(
                                "hook_complete",
                                {
                                    **base,
                                    "sequence_number": seq,
                                    "hook": hook_text,
                                    "first_useful_ms": first_useful_ms,
                                },
                            )
                    if rest:
                        yield _sse("proof_delta", {**base, "proof": rest})

                    if meta.get("final"):
                        break

                full_ms = round((time.perf_counter() - t0) * 1000, 2)
                if first_paint_ms is None:
                    first_paint_ms = full_ms
                if first_useful_ms is None:
                    first_useful_ms = first_paint_ms
                hook_text, rest = _split_hook_rest(acc)
                seq += 1
                yield _sse(
                    "timing",
                    {
                        "session_id": session_id,
                        "request_id": request_id,
                        "turn_id": turn_id,
                        "sequence_number": seq,
                        "classify_ms": classify_ms,
                        "first_token_ms": first_paint_ms,
                        "first_useful_ms": first_useful_ms,
                        "llm_first_token_ms": llm_first_ms,
                        "full_answer_ms": full_ms,
                        "total_ms": full_ms,
                        "stages": stages,
                        "source": source,
                    },
                )
                seq += 1
                yield _sse(
                    "done",
                    {
                        "session_id": session_id,
                        "request_id": request_id,
                        "turn_id": turn_id,
                        "sequence_number": seq,
                        "text": acc,
                        "hook": hook_text,
                        "proof": rest,
                        "bullets": to_bullets(acc, mode),
                        "source": source,
                        "depth": depth,
                        "answer_mode": stages.get("answer_mode"),
                        "first_paint_ms": first_paint_ms,
                        "first_useful_ms": first_useful_ms,
                        "llm_first_token_ms": llm_first_ms,
                        "full_answer_ms": full_ms,
                        "full_ms": full_ms,
                        "total_ms": full_ms,
                        "latency_ms": first_paint_ms,
                        "stages": stages,
                    },
                )
                try:
                    record_trace(
                        question=q[:200],
                        source=source,
                        depth=depth,
                        classify_ms=classify_ms,
                        first_token_ms=first_paint_ms,
                        first_useful_ms=first_useful_ms,
                        full_answer_ms=full_ms,
                        total_ms=full_ms,
                        request_id=request_id,
                        turn_id=turn_id,
                        words=len((acc or "").split()),
                        meta={"path": "answer_stream", "llm_first_token_ms": llm_first_ms},
                    )
                except Exception:
                    pass
        except Exception as e:
            traceback.print_exc()
            yield _sse(
                "error",
                {
                    "message": str(e),
                    "request_id": request_id,
                    "turn_id": turn_id,
                },
            )

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return StreamingResponse(
        gen(), media_type="text/event-stream", headers=headers
    )


def _split_hook_rest(text: str) -> tuple[str, str]:
    """Extract Hook section vs remainder for semantic stream events."""
    t = (text or "").strip()
    if not t:
        return "", ""
    m = re.match(
        r"^(?:Hook\s*:\s*)?(.*?)(?:\n\s*(?:Proof|Situation|Task|Action|Result|"
        r"Approach|Mechanism|Tradeoff|Close|Explain)\s*:|$)",
        t,
        flags=re.I | re.S,
    )
    if m:
        hook = m.group(1).strip()
        # Prefer labeled Hook line
        hm = re.search(r"Hook\s*:\s*(.+?)(?:\n|$)", t, flags=re.I)
        if hm:
            hook = hm.group(1).strip()
            rest = t[hm.end() :].strip()
            return hook, rest
        rest = t[m.end() :].strip() if m.lastindex else ""
        if "\n" in t:
            lines = t.split("\n", 1)
            return lines[0].strip(), (lines[1] if len(lines) > 1 else "").strip()
        return hook, rest
    # First sentence as hook
    sm = re.match(r"^(.+?[.!?])\s*(.*)$", t, flags=re.S)
    if sm:
        return sm.group(1).strip(), sm.group(2).strip()
    return t, ""


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

            try:
                from config import get_stt_provider

                stt_p = get_stt_provider()
            except Exception:
                stt_p = "whisper"
            if stt_p == "deepgram":
                yield _sse(
                    "status",
                    {"message": "STT: Deepgram Nova-3 (Whisper kept as fallback)…"},
                )
                threading.Thread(
                    target=lambda: get_whisper_model(), daemon=True, name="whisper-warm"
                ).start()
            else:
                yield _sse("status", {"message": "Loading Whisper model…"})
                t_w = time.perf_counter()
                get_whisper_model()
                yield _sse(
                    "status",
                    {
                        "message": (
                            f"Whisper ready in "
                            f"{round((time.perf_counter() - t_w) * 1000)}ms"
                        )
                    },
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
                text, stt_meta = transcribe_best(clip)
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
                        "stt_provider": (stt_meta or {}).get("provider"),
                        "stt_model": (stt_meta or {}).get("model"),
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
                bullets = to_bullets(acc, req.mode or "star")
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


# ---------------------------------------------------------------------------
# Live interview WebSocket — continuous system-audio listen → STT → answer
# ---------------------------------------------------------------------------

from fastapi import WebSocket, WebSocketDisconnect  # noqa: E402
from live_session import LiveInterviewSession  # noqa: E402

try:
    import orjson

    def _dumps_fast(payload: dict[str, Any]) -> str:
        return orjson.dumps(payload).decode("utf-8")
except ImportError:  # pragma: no cover - orjson is a pinned dependency
    orjson = None  # type: ignore[assignment]

    def _dumps_fast(payload: dict[str, Any]) -> str:
        return json.dumps(payload)


async def _ws_send_json(websocket: WebSocket, payload: dict[str, Any]) -> None:
    """
    Send a JSON text frame via orjson (faster than stdlib json on the hot
    streaming path — every token upgrade during an answer goes through this).

    Falls back to stdlib json.dumps(default=str) on any encode error (e.g. a
    set or other type neither encoder has a handler for — verified NaN/
    Infinity do NOT need this fallback, orjson silently encodes those as
    `null` same as this app's prior behavior) so a rare bad-payload edge
    case degrades gracefully instead of dropping the WebSocket message.
    Wire format is unchanged either way — still a JSON string in a text
    frame, so the frontend's JSON.parse(event.data) needs no changes.
    """
    try:
        await websocket.send_text(_dumps_fast(payload))
    except Exception:
        await websocket.send_text(json.dumps(payload, default=str))


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

    from session_context import (
        drop_session,
        new_session_id,
        set_session_id,
        reset_session_id,
    )

    loop = asyncio.get_event_loop()
    out_q: asyncio.Queue = asyncio.Queue(maxsize=256)
    # Prefer JWT user id so WS shares Role/JD/Resume with HTTP /api/session/context
    ws_tok = (
        (websocket.query_params.get("token") if hasattr(websocket, "query_params") else "")
        or ""
    ).strip()
    conn_session_id = session_id_from_token(ws_tok) or new_session_id()
    _sid_token = set_session_id(conn_session_id)
    session_holder: dict[str, Any] = {"session": None, "session_id": conn_session_id}

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
            await _ws_send_json(websocket, msg)

    writer_task = asyncio.create_task(writer())

    def _feed_pcm(raw: bytes) -> None:
        sess = session_holder.get("session")
        if sess is not None and raw:
            sess.push_audio(raw)

    try:
        await _ws_send_json(
            websocket,
            {
                "type": "status",
                "message": "Connected to live interview backend",
                "listening": False,
                "session_id": conn_session_id,
            },
        )
        while True:
            # Re-bind pack scope each receive (async loop + thread safety)
            set_session_id(conn_session_id)
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
                await _ws_send_json(websocket, {"type": "error", "message": "Invalid JSON"})
                continue

            mtype = (msg.get("type") or "").strip().lower()
            if mtype == "ping":
                await _ws_send_json(websocket, {"type": "pong"})
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
                # Re-bind pack to JWT user if token arrives on start
                start_tok = (
                    msg.get("access_token") or msg.get("token") or ws_tok or ""
                ).strip()
                if start_tok:
                    keyed = session_id_from_token(start_tok)
                    if keyed:
                        conn_session_id = keyed
                        session_holder["session_id"] = keyed
                        set_session_id(keyed)
                sess.session_id = conn_session_id
                set_session_id(conn_session_id)
                # Default: browser = client PCM (UI sends speaker/tab audio, not mic).
                # System/Stereo Mix when UI requests source=system (local Windows).
                source = (msg.get("source") or "").strip().lower()
                if not source:
                    force_system = os.environ.get(
                        "COPILOT_FORCE_SYSTEM_AUDIO", ""
                    ).lower() in ("1", "true", "yes")
                    source = "system" if force_system else "browser"
                # Deepgram key may be sent from the UI Settings field
                dg_key = (
                    msg.get("deepgram_api_key")
                    or msg.get("deepgram_key")
                    or msg.get("deepgramKey")
                    or ""
                ).strip() or None
                if dg_key:
                    os.environ["DEEPGRAM_API_KEY"] = dg_key
                stt_pref = (msg.get("stt_provider") or msg.get("stt") or "").strip().lower() or None
                job_ctx = (msg.get("job_context") or "").strip()
                # Optional WS auth when AUTH_REQUIRED (token in start or query)
                try:
                    import os

                    if os.environ.get("AUTH_REQUIRED", "").strip().lower() in (
                        "1",
                        "true",
                        "yes",
                    ):
                        tok = start_tok
                        if tok:
                            try:
                                from backend.jwt_auth import decode_access_token

                                decode_access_token(tok)
                            except Exception:
                                await _ws_send_json(
                                    websocket,
                                    {
                                        "type": "error",
                                        "message": "Invalid or expired auth token",
                                    },
                                )
                                continue
                except Exception:
                    pass
                # New interview: drop cached answers from any prior identity
                try:
                    from fast_answer import cache_clear

                    cache_clear()
                except Exception:
                    pass
                # Align pack with THIS interview materials only
                try:
                    from session_context import update_pack

                    pack_update: dict[str, Any] = {"role": job_ctx}
                    if "job_description" in msg:
                        pack_update["job_description"] = msg.get("job_description") or ""
                    if "resume_text" in msg:
                        pack_update["resume_text"] = msg.get("resume_text") or ""
                    if "company" in msg:
                        pack_update["company"] = msg.get("company") or ""
                    update_pack(**pack_update)
                except Exception:
                    pass
                sess.session_id = conn_session_id
                sess.start(
                    job_context=job_ctx,
                    tone=msg.get("tone") or "confident",
                    mode=msg.get("mode") or "star",
                    source=source,
                    answer_model=msg.get("answer_model"),
                    fallback_model=msg.get("fallback_model"),
                    user_answer_model=msg.get("user_answer_model"),
                    user_fallback_model=msg.get("user_fallback_model"),
                    deepgram_api_key=dg_key,
                    stt_provider=stt_pref,
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
                # Always accept job_context key (including empty string to clear)
                job_in = msg.get("job_context")
                if sess is not None:
                    if "job_context" in msg:
                        sess.set_context(
                            job_context=job_in if job_in is not None else "",
                            tone=msg.get("tone") or "",
                        )
                    elif msg.get("tone"):
                        sess.set_context(tone=msg.get("tone") or "")
                # Keep pack.role in sync (empty clears)
                try:
                    from session_context import update_pack

                    pack_keys = {
                        k: msg[k]
                        for k in (
                            "role",
                            "company",
                            "seniority",
                            "interview_type",
                            "job_description",
                            "resume_text",
                            "stories",
                            "keywords",
                            "depth",
                            "outline_first",
                        )
                        if k in msg and msg[k] is not None
                    }
                    if "job_context" in msg and "role" not in pack_keys:
                        pack_keys["role"] = (job_in or "").strip()
                    if pack_keys:
                        update_pack(**pack_keys)
                except Exception:
                    pass
                continue

            if mtype == "inject" or mtype == "inject_question":
                # Manual question when STT lags (market pattern)
                q = (msg.get("question") or msg.get("text") or "").strip()
                sess = session_holder.get("session")
                if not q:
                    await _ws_send_json(
                        websocket, {"type": "error", "message": "inject requires question"}
                    )
                    continue
                if sess is None:
                    # One-shot without active listen session
                    sess = LiveInterviewSession(emit)
                    sess.session_id = conn_session_id
                    session_holder["session"] = sess
                    if msg.get("mode"):
                        sess.mode = msg["mode"]
                    if msg.get("tone"):
                        sess.tone = msg["tone"]
                else:
                    sess.session_id = conn_session_id
                # Always apply job_context when present (including "" to clear)
                if "job_context" in msg:
                    sess.set_context(job_context=msg.get("job_context") or "")
                if msg.get("depth"):
                    try:
                        from session_context import update_pack

                        update_pack(depth=msg["depth"])
                    except Exception:
                        pass
                sess.inject_question(q)
                continue

            if mtype == "set_depth":
                try:
                    from session_context import update_pack

                    update_pack(depth=msg.get("depth") or "balanced")
                    await _ws_send_json(
                        websocket,
                        {
                            "type": "status",
                            "message": f"Answer depth → {msg.get('depth') or 'balanced'}",
                        },
                    )
                except Exception as e:
                    await _ws_send_json(
                        websocket, {"type": "error", "message": str(e)}
                    )
                continue

            if mtype == "latency_snapshot":
                try:
                    from latency_metrics import snapshot

                    await _ws_send_json(
                        websocket, {"type": "latency_snapshot", **snapshot()}
                    )
                except Exception as e:
                    await _ws_send_json(
                        websocket, {"type": "error", "message": str(e)}
                    )
                continue

            await _ws_send_json(websocket, 
                {"type": "error", "message": f"Unknown message type: {mtype}"}
            )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        traceback.print_exc()
        try:
            await _ws_send_json(websocket, {"type": "error", "message": str(e)})
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
            drop_session(conn_session_id)
        except Exception:
            pass
        try:
            reset_session_id(_sid_token)
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
