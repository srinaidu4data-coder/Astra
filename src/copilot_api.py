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

from config import get_openai_api_key  # noqa: E402
from rag import (  # noqa: E402
    SCRIPT_MODEL,
    _get_openai_client,
    classify_utterance,
    search_context,
)
from transcriber import get_whisper_model, transcribe_audio  # noqa: E402

# Calm, speakable STAR answers — not a wall of text
SPEAKABLE_STAR_SYSTEM = """You are an interview teleprompter. Write a short answer the candidate can read aloud slowly.

Format EXACTLY with these four labels (one short sentence each):
Situation: ...
Task: ...
Action: ...
Result: ...

Rules:
- Total under 85 words
- First person, natural speech
- No bullet symbols, no markdown, no preamble
- Prefer concrete detail over buzzwords
- Result must include a number or clear outcome when possible
"""

SPEAKABLE_SHORTER_SYSTEM = """You are an interview teleprompter. Give a brief speakable answer.

Rules:
- Exactly 3 short lines the candidate can say aloud
- Each line under 18 words
- No STAR labels, no markdown, no preamble
- First person, confident, plain language
"""

SPEAKABLE_TECHNICAL_SYSTEM = """You are an interview teleprompter for technical depth.

Rules:
- 4 short lines the candidate can speak
- Cover: approach, key mechanism, tradeoff, how you'd validate
- No STAR labels unless natural
- Prefer precise terms over fluff
- Under 100 words total
"""

SPEAKABLE_CODE_SYSTEM = """You are an interview teleprompter for coding questions.

Rules:
- Start with 2 short spoken sentences (approach)
- Then a small code sketch in a fenced block (```language ... ```)
- Keep code under 18 lines
- End with one spoken line on complexity/tradeoff
"""

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
    from backend.billing import router as billing_router  # noqa: E402
    from backend.google_oauth import router as oauth_router  # noqa: E402
    from backend.password_auth import router as password_router  # noqa: E402

    create_db_and_tables()
    app.include_router(oauth_router)
    app.include_router(password_router)
    app.include_router(billing_router)
except Exception as _auth_import_err:  # pragma: no cover - optional until deps installed
    print(f"[auth] Google/Stripe/password routers not loaded: {_auth_import_err}")

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
) -> Generator[str, None, None]:
    chunks: list[dict] = []
    try:
        chunks = search_context(question) or []
    except Exception as e:
        print(f"[rag] search failed: {e}")

    mode = (mode or "star").strip().lower()
    client = _get_openai_client()
    ctx = ""
    if chunks:
        bits = [c.get("text", "")[:280] for c in chunks[:3] if c.get("text")]
        if bits:
            ctx = "Use this candidate context when relevant:\n" + "\n".join(bits)

    job = f"Role focus: {job_context}" if job_context else ""
    tone_note = f"Tone: {tone}." if tone else ""

    if mode == "shorter":
        system = SPEAKABLE_SHORTER_SYSTEM
        instruct = "Write the 3 short speakable lines now."
        max_tokens = 140
    elif mode == "technical":
        system = SPEAKABLE_TECHNICAL_SYSTEM
        instruct = "Write the technical speakable answer now."
        max_tokens = 220
    elif mode == "code":
        system = SPEAKABLE_CODE_SYSTEM
        instruct = "Write the spoken approach + code sketch now."
        max_tokens = 320
    else:
        mode = "star"
        system = SPEAKABLE_STAR_SYSTEM
        instruct = "Write the four-line Situation/Task/Action/Result answer now."
        max_tokens = 220

    user = f"""{job}
{tone_note}
{ctx}

Interview question:
{question}

{instruct}"""

    stream = client.chat.completions.create(
        model=SCRIPT_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        stream=True,
        temperature=0.55,
        max_tokens=max_tokens,
    )
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


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
    t0 = time.perf_counter()
    get_whisper_model()
    return {"ok": True, "load_ms": round((time.perf_counter() - t0) * 1000)}


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


@app.post("/api/answer")
def answer(req: AnswerRequest):
    if not req.question.strip():
        raise HTTPException(400, "question required")
    if not get_openai_api_key():
        raise HTTPException(500, "OPENAI_API_KEY missing")

    t0 = time.perf_counter()
    cls = classify_utterance(req.question)
    parts: list[str] = []
    for tok in _stream_answer_text(
        cls.get("cleaned_question") or req.question,
        job_context=req.job_context,
        tone=req.tone,
        mode=req.mode,
    ):
        parts.append(tok)
    text = "".join(parts).strip()
    return {
        "question": req.question,
        "classification": cls,
        "answer": text,
        "bullets": _to_bullets(text, req.mode),
        "latency_ms": round((time.perf_counter() - t0) * 1000),
    }


@app.post("/api/answer/stream")
def answer_stream(req: AnswerRequest):
    if not req.question.strip():
        raise HTTPException(400, "question required")
    if not get_openai_api_key():
        raise HTTPException(500, "OPENAI_API_KEY missing")

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
    text = (text or "").strip()
    if not text:
        return []

    mode = (mode or "star").strip().lower()

    # Strip fenced code for bullet list; code shown separately on client
    prose = re.sub(r"```[\s\S]*?```", "", text).strip() if mode == "code" else text

    labeled: list[str] = []
    for raw in prose.splitlines():
        line = raw.strip(" -•\t")
        if not line:
            continue
        low = line.lower()
        if mode == "star":
            mapped = False
            for key, prefix in (
                ("situation:", "Situation — "),
                ("task:", "Task — "),
                ("action:", "Action — "),
                ("result:", "Result — "),
            ):
                if low.startswith(key):
                    rest = line.split(":", 1)[1].strip()
                    labeled.append(prefix + rest)
                    mapped = True
                    break
            if not mapped:
                labeled.append(line)
        else:
            labeled.append(line)

    if len(labeled) >= 2:
        return labeled[:8]

    parts = [p.strip() for p in prose.replace("\n", " ").split(". ") if p.strip()]
    if mode == "star" and len(parts) >= 4:
        labels = ["Situation — ", "Task — ", "Action — ", "Result — "]
        out = []
        for i, p in enumerate(parts[:4]):
            s = p if p.endswith(".") else p + "."
            out.append(labels[i] + s)
        return out
    if parts:
        return parts[:6]
    return [text]


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
      {"type":"status"|"listening"|"level"|"transcript"|"question"|"chatter"|"answer"|"error"|"pong", ...}
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
                # Default browser for cloud (no Stereo Mix); clients may override.
                source = (msg.get("source") or "").strip().lower()
                if not source:
                    source = "browser" if (
                        os.environ.get("RAILWAY_ENVIRONMENT")
                        or os.environ.get("RENDER")
                        or os.environ.get("COPILOT_FORCE_BROWSER_MIC", "").lower()
                        in ("1", "true", "yes")
                    ) else "system"
                sess.start(
                    job_context=msg.get("job_context") or "AI/ML Engineer",
                    tone=msg.get("tone") or "confident",
                    mode=msg.get("mode") or "star",
                    source=source,
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
