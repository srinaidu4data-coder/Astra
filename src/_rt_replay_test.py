#!/usr/bin/env python3
"""
Real-time WS replay test — no TTS dependency (the OpenAI TTS key in .env is
dead, unrelated to the Groq swap). Streams real clips from test_audio over
the live /ws/interview WebSocket exactly like a real browser mic session,
to verify the LLM cold-start warm-up fix under genuine real-time transport.

    venv\\Scripts\\python.exe _rt_replay_test.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from copilot_api import _load_audio_int16_16k, _segment_by_silence  # noqa: E402


async def stream_clip(ws, clip: np.ndarray, *, chunk_ms: int = 80) -> float:
    """Send PCM in near-real-time chunks + trailing silence. Returns speech-end wall time."""
    chunk = int(16000 * chunk_ms / 1000)
    i = 0
    while i < len(clip):
        await ws.send(clip[i : i + chunk].astype(np.int16).tobytes())
        i += chunk
        await asyncio.sleep(chunk_ms / 1000)
    speech_end = time.time()
    tail = np.zeros(int(16000 * 1.6), dtype=np.int16)
    i = 0
    while i < len(tail):
        await ws.send(tail[i : i + chunk].astype(np.int16).tobytes())
        i += chunk
        await asyncio.sleep(chunk_ms / 1000)
    return speech_end


async def main() -> int:
    import websockets

    audio = _load_audio_int16_16k(ROOT / "test_audio" / "ai_ml_interview_20q.wav")
    segs = _segment_by_silence(audio)[:4]
    print(f"Replaying {len(segs)} real recorded clips over the live WS session\n")

    uri = "ws://127.0.0.1:8787/ws/interview"
    async with websockets.connect(uri, max_size=16 * 1024 * 1024, open_timeout=15) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
        print("hello:", hello.get("type"), hello.get("message", "")[:80])

        await ws.send(json.dumps({
            "type": "start", "job_context": "AI/ML Engineer", "tone": "confident",
            "mode": "star", "source": "browser",
        }))
        await asyncio.sleep(1.2)
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.3)
                e = json.loads(raw)
                if e.get("type") in ("status", "listening"):
                    print("  boot:", e.get("type"), str(e.get("message") or e.get("device") or "")[:80])
        except asyncio.TimeoutError:
            pass

        results = []
        for idx, (start, end) in enumerate(segs):
            clip = audio[start:end]
            print(f"\n=== clip {idx+1}/{len(segs)} ({len(clip)/16000:.1f}s) ===")
            events: list[dict] = []
            done = asyncio.Event()
            t0 = time.time()

            async def collector():
                try:
                    while not done.is_set():
                        raw = await asyncio.wait_for(ws.recv(), timeout=40)
                        e = json.loads(raw)
                        e["_t"] = round((time.time() - t0) * 1000)
                        events.append(e)
                        et = e.get("type")
                        if et in ("transcript", "answer", "chatter", "error", "status"):
                            msg = e.get("message") or e.get("text") or e.get("question") or ""
                            if et == "status" and "still listening" not in str(msg) and "Transcribing" not in str(msg) and "Writing" not in str(msg):
                                continue
                            if et == "answer" and e.get("streaming"):
                                continue
                            print(f"  [{e['_t']}ms] {et}: {str(msg)[:90]}")
                        if et == "answer" and not e.get("streaming"):
                            done.set()
                        if et in ("chatter", "error"):
                            done.set()
                except asyncio.TimeoutError:
                    pass

            task = asyncio.create_task(collector())
            speech_end_wall = await stream_clip(ws, clip)
            try:
                await asyncio.wait_for(done.wait(), timeout=40)
            except asyncio.TimeoutError:
                print("  TIMEOUT waiting for answer")
            done.set()
            task.cancel()
            try:
                await task
            except Exception:
                pass

            tx = next((e for e in events if e.get("type") == "transcript"), None)
            ans = next((e for e in events if e.get("type") == "answer" and not e.get("streaming")), None)
            row = {
                "clip": idx,
                "transcript": (tx or {}).get("text"),
                "stt_ms": (tx or {}).get("stt_ms"),
                "answer_words": len(((ans or {}).get("answer") or "").split()),
                "answer_ms": (ans or {}).get("answer_ms"),
                "first_token_ms": (ans or {}).get("first_token_ms"),
                "source": (ans or {}).get("source"),
            }
            results.append(row)
            print(f"  => {row}")
            await asyncio.sleep(0.5)

        await ws.send(json.dumps({"type": "stop"}))
        await asyncio.sleep(0.3)

    print("\n=== SUMMARY ===")
    for r in results:
        print(r)
    first_tokens = [r["first_token_ms"] for r in results if r.get("first_token_ms")]
    if first_tokens:
        print(f"\nfirst_token_ms per clip (Q1 should NOT spike): {first_tokens}")
        if len(first_tokens) > 1 and first_tokens[0] > 3 * max(first_tokens[1:]):
            print("FAIL: cold-start spike still present on clip 1")
            return 1
    ok = all(r.get("answer_words", 0) >= 40 for r in results)
    print("PASS" if ok else "FAIL: some clips got thin/no answers")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
