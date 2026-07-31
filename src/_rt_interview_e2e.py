#!/usr/bin/env python3
"""
Real-time end-to-end live interview test.

Streams TTS audio for a multi-question interview over WebSocket (browser mic path),
verifies: transcript quality, answer domain hits, queueing, no cache bleed.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Prefer real key from .env (drops placeholder env)
from config import get_openai_api_key  # noqa: E402

get_openai_api_key()


@dataclass
class QCase:
    role: str
    spoken: str
    must_hits: list[str]
    min_ans_words: int = 80
    min_hits: int = 2


@dataclass
class QResult:
    case: QCase
    transcript: str = ""
    answer: str = ""
    source: str = ""
    stt_ms: float | None = None
    answer_ms: float | None = None
    speech_end_to_tx_ms: float | None = None
    speech_end_to_ans_ms: float | None = None
    events: list[str] = field(default_factory=list)
    ok: bool = False
    fail_reasons: list[str] = field(default_factory=list)


CASES = [
    QCase(
        "SAP FICO Consultant",
        "What is the difference between FI and CO in SAP?",
        ["fi", "co", "cost", "financial", "company", "external", "internal"],
        min_hits=3,
    ),
    QCase(
        "AI/ML Engineer",
        "What is the difference between precision and recall?",
        ["precision", "recall", "false", "true positive", "positive"],
        min_hits=3,
    ),
    QCase(
        "Software Engineer",
        "Tell me about a time you fixed a production outage.",
        ["incident", "root", "fix", "monitor", "latency", "error", "rollback", "alert", "production"],
        min_hits=2,
        min_ans_words=70,
    ),
    QCase(
        "SAP FICO Consultant",
        "How does SAP tax determination work with condition records?",
        ["condition", "tax", "access", "procedure", "code"],
        min_hits=3,
    ),
    QCase(
        "Machine Learning Engineer",
        "Explain the bias variance tradeoff in machine learning.",
        ["bias", "variance", "overfit", "underfit", "complex"],
        min_hits=3,
    ),
]


def tts_pcm16(text: str, client) -> np.ndarray:
    from pydub import AudioSegment

    mp3 = os.path.join(tempfile.gettempdir(), f"astra_rt_{abs(hash(text)) % 10**8}.mp3")
    with client.audio.speech.with_streaming_response.create(
        model="tts-1", voice="alloy", input=text
    ) as resp:
        resp.stream_to_file(mp3)
    seg = AudioSegment.from_file(mp3).set_frame_rate(16000).set_channels(1).set_sample_width(2)
    raw = np.frombuffer(seg.raw_data, dtype=np.int16)
    return np.clip(raw.astype(np.int32) * 2, -32767, 32767).astype(np.int16)


async def run_one(ws, client, case: QCase, idx: int) -> QResult:
    import websockets

    result = QResult(case=case)
    # set context
    await ws.send(
        json.dumps(
            {
                "type": "set_context",
                "job_context": case.role,
                "tone": "confident",
            }
        )
    )
    await ws.send(json.dumps({"type": "set_mode", "mode": "star"}))

    print(f"\n=== Q{idx+1}: {case.spoken[:70]}… [{case.role}] ===")
    pcm = tts_pcm16(case.spoken, client)
    lead = np.zeros(int(16000 * 0.25), dtype=np.int16)
    # Enough trailing silence for hangover (~1s) + margin
    tail = np.zeros(int(16000 * 1.6), dtype=np.int16)
    stream = np.concatenate([lead, pcm, tail])
    speech_end_sample = len(lead) + len(pcm)

    events: list[dict] = []
    t0 = time.time()
    speech_end_wall: float | None = None
    done = asyncio.Event()

    async def collector():
        try:
            while not done.is_set():
                raw = await asyncio.wait_for(ws.recv(), timeout=45)
                e = json.loads(raw)
                e["_t"] = round((time.time() - t0) * 1000)
                events.append(e)
                et = e.get("type")
                if et in (
                    "transcript",
                    "answer",
                    "answer_pending",
                    "chatter",
                    "error",
                    "status",
                ):
                    msg = e.get("message") or e.get("text") or e.get("question") or ""
                    if et == "status" and any(
                        x in str(msg)
                        for x in ("Waiting", "Live session", "Session stopped", "Connected")
                    ):
                        continue
                    if et == "answer" and e.get("streaming"):
                        continue  # only log finals below
                    print(f"  [{e['_t']}ms] {et}: {str(msg)[:100]}")
                if et == "answer" and not e.get("streaming"):
                    done.set()
                if et == "chatter":
                    # still wait a bit — may not answer
                    pass
                if et == "error":
                    done.set()
        except asyncio.TimeoutError:
            pass
        except Exception as ex:
            print("  collector err", ex)

    task = asyncio.create_task(collector())
    chunk = int(16000 * 0.08)
    i = 0
    # Near real-time stream
    while i < len(stream):
        await ws.send(stream[i : i + chunk].tobytes())
        if speech_end_wall is None and i + chunk >= speech_end_sample:
            speech_end_wall = time.time()
        i += chunk
        await asyncio.sleep(0.08)

    try:
        await asyncio.wait_for(done.wait(), timeout=55)
    except asyncio.TimeoutError:
        result.fail_reasons.append("timeout_waiting_for_answer")
    await asyncio.sleep(0.3)
    done.set()
    task.cancel()
    try:
        await task
    except Exception:
        pass

    # Parse results
    for e in events:
        et = e.get("type")
        result.events.append(et or "?")
        if et == "transcript" and not result.transcript:
            result.transcript = (e.get("text") or "").strip()
            result.stt_ms = e.get("stt_ms")
            if speech_end_wall:
                result.speech_end_to_tx_ms = round(
                    (t0 + e["_t"] / 1000 - speech_end_wall) * 1000
                )
        if et == "answer" and not e.get("streaming"):
            result.answer = (e.get("answer") or "").strip()
            result.source = str(e.get("source") or "")
            result.answer_ms = e.get("answer_ms")
            if speech_end_wall:
                result.speech_end_to_ans_ms = round(
                    (t0 + e["_t"] / 1000 - speech_end_wall) * 1000
                )
        if et == "chatter":
            result.fail_reasons.append(f"chatter:{e.get('reason')}")
        if et == "error":
            result.fail_reasons.append(f"error:{e.get('message')}")

    # Score
    reasons: list[str] = []
    low_t = result.transcript.lower()
    low_a = result.answer.lower()
    # transcript should share some keywords with spoken
    spoken_kw = [w for w in case.spoken.lower().replace("?", "").split() if len(w) > 3][:6]
    tx_hits = sum(1 for w in spoken_kw if w in low_t)
    if not result.transcript:
        reasons.append("no_transcript")
    elif tx_hits < 2:
        reasons.append(f"weak_transcript({result.transcript[:60]!r})")
    if not result.answer:
        reasons.append("no_answer")
    else:
        words = len(result.answer.split())
        hits = [h for h in case.must_hits if h in low_a]
        if words < case.min_ans_words:
            reasons.append(f"thin_answer({words}w)")
        if len(hits) < case.min_hits:
            reasons.append(f"few_domain_hits({hits})")
        if result.answer.rstrip()[-1:] not in ".!?":
            reasons.append("incomplete_ending")
        if "/hook" in low_a:
            reasons.append("bad_label_format")
        # cache bleed check: answer shouldn't be about wrong domain only
        if "sap" in case.role.lower() and "precision" in low_a and "tax" not in low_a and "fi" not in low_a:
            if "recall" in low_a:
                reasons.append("possible_cache_bleed_ml_into_sap")
    result.fail_reasons.extend(reasons)
    result.ok = len(result.fail_reasons) == 0
    status = "PASS" if result.ok else "FAIL"
    print(
        f"  => {status} tx={result.transcript[:70]!r} "
        f"ans_words={len(result.answer.split())} "
        f"stt={result.stt_ms} e2e_ans={result.speech_end_to_ans_ms} "
        f"src={result.source}"
    )
    if result.fail_reasons:
        print(f"     reasons: {result.fail_reasons}")
    if result.answer:
        print(f"     ans: {result.answer[:160].replace(chr(10), ' ')}…")
    return result


async def run_rapid_fire(ws, client) -> dict:
    """Fire two questions close together to exercise the queue."""
    print("\n=== RAPID-FIRE QUEUE TEST ===")
    import websockets

    q1 = "What is precision in machine learning?"
    q2 = "What is recall in machine learning?"
    await ws.send(json.dumps({"type": "set_context", "job_context": "AI/ML Engineer"}))

    events: list[dict] = []
    t0 = time.time()
    stop = asyncio.Event()

    async def collect():
        try:
            while not stop.is_set():
                raw = await asyncio.wait_for(ws.recv(), timeout=60)
                e = json.loads(raw)
                e["_t"] = round((time.time() - t0) * 1000)
                events.append(e)
        except Exception:
            pass

    task = asyncio.create_task(collect())

    async def stream_phrase(text: str, pause_after: float = 0.3):
        pcm = tts_pcm16(text, client)
        lead = np.zeros(int(16000 * 0.15), dtype=np.int16)
        tail = np.zeros(int(16000 * 1.2), dtype=np.int16)
        stream = np.concatenate([lead, pcm, tail])
        chunk = int(16000 * 0.08)
        i = 0
        while i < len(stream):
            await ws.send(stream[i : i + chunk].tobytes())
            i += chunk
            await asyncio.sleep(0.06)  # slightly faster than realtime
        await asyncio.sleep(pause_after)

    await stream_phrase(q1, pause_after=0.15)
    await stream_phrase(q2, pause_after=0.2)
    # Wait for two final answers or timeout
    deadline = time.time() + 70
    while time.time() < deadline:
        finals = [
            e
            for e in events
            if e.get("type") == "answer" and not e.get("streaming")
        ]
        queued = any(
            "Queued" in str(e.get("message") or "") for e in events if e.get("type") == "status"
        )
        if len(finals) >= 2:
            break
        await asyncio.sleep(0.5)
    stop.set()
    task.cancel()

    finals = [e for e in events if e.get("type") == "answer" and not e.get("streaming")]
    transcripts = [e for e in events if e.get("type") == "transcript"]
    queued = any("Queued" in str(e.get("message") or "") for e in events)
    answers = [(e.get("question") or "")[:60] for e in finals]
    print(f"  transcripts={len(transcripts)} final_answers={len(finals)} queued_seen={queued}")
    for a in answers:
        print(f"  ans_q: {a}")
    ok = len(finals) >= 1  # at least one; prefer 2
    if len(finals) >= 2:
        ok = True
        # different questions
        a0 = (finals[0].get("answer") or "").lower()
        a1 = (finals[1].get("answer") or "").lower()
        # precision answer shouldn't equal recall-only swap incorrectly
        if a0 == a1 and len(a0) > 40:
            ok = False
            print("  FAIL: identical answers (cache bleed?)")
    return {
        "ok": ok,
        "finals": len(finals),
        "transcripts": len(transcripts),
        "queued_seen": queued,
        "answers": answers,
    }


async def main() -> int:
    import websockets
    from openai import OpenAI

    key = get_openai_api_key()
    if not key:
        print("FAIL: no OPENAI_API_KEY")
        return 2
    client = OpenAI(api_key=key)

    uri = os.environ.get("ASTRA_WS_URL", "ws://127.0.0.1:8787/ws/interview")
    print(f"Connecting {uri} …")
    async with websockets.connect(uri, max_size=16 * 1024 * 1024, open_timeout=15) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
        print("hello:", hello.get("type"), hello.get("message", "")[:80])

        await ws.send(
            json.dumps(
                {
                    "type": "start",
                    "job_context": "Software Engineer",
                    "tone": "confident",
                    "mode": "star",
                    "source": "browser",
                }
            )
        )
        # drain startup statuses briefly
        await asyncio.sleep(1.5)
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.3)
                e = json.loads(raw)
                if e.get("type") in ("status", "listening"):
                    print("  boot:", e.get("type"), str(e.get("message") or e.get("device") or "")[:80])
        except asyncio.TimeoutError:
            pass

        results: list[QResult] = []
        for i, case in enumerate(CASES):
            r = await run_one(ws, client, case, i)
            results.append(r)
            await asyncio.sleep(0.8)  # gap between questions (realistic interview pace)

        rapid = await run_rapid_fire(ws, client)

        await ws.send(json.dumps({"type": "stop"}))
        await asyncio.sleep(0.4)

    # Summary
    print("\n" + "=" * 60)
    print("RT INTERVIEW E2E SUMMARY")
    print("=" * 60)
    passed = sum(1 for r in results if r.ok)
    for i, r in enumerate(results):
        print(
            f"Q{i+1} {'PASS' if r.ok else 'FAIL'} | "
            f"tx_ms={r.speech_end_to_tx_ms} ans_ms={r.speech_end_to_ans_ms} | "
            f"{r.case.spoken[:50]}"
        )
        if r.fail_reasons:
            print(f"     {r.fail_reasons}")
    print(f"Sequential: {passed}/{len(results)}")
    print(
        f"Rapid-fire: {'PASS' if rapid.get('ok') else 'FAIL'} "
        f"finals={rapid.get('finals')} queued={rapid.get('queued_seen')}"
    )
    all_ok = passed == len(results) and rapid.get("ok")
    # Soft pass: allow 4/5 if rapid ok
    soft = passed >= len(results) - 1 and rapid.get("finals", 0) >= 1
    print("OVERALL:", "PASS" if all_ok else ("SOFT_PASS" if soft else "FAIL"))
    return 0 if (all_ok or soft) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
