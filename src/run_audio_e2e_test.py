#!/usr/bin/env python3
"""
CLI end-to-end proof: practice audio → Whisper STT → OpenAI auto-answers.

  venv\\Scripts\\python.exe run_audio_e2e_test.py
  venv\\Scripts\\python.exe run_audio_e2e_test.py --max 3
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from copilot_api import (  # noqa: E402
    DEFAULT_AUDIO,
    DEFAULT_AUDIO_MP3,
    _load_audio_int16_16k,
    _segment_by_silence,
    _stream_answer_text,
    _to_bullets,
)
from config import get_openai_api_key  # noqa: E402
from rag import classify_utterance  # noqa: E402
from transcriber import get_whisper_model, transcribe_audio  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=3, help="Max questions to answer")
    ap.add_argument("--path", type=str, default=None)
    args = ap.parse_args()

    if not get_openai_api_key():
        print("FAIL: OPENAI_API_KEY missing")
        sys.exit(1)

    path = Path(args.path) if args.path else (DEFAULT_AUDIO if DEFAULT_AUDIO.exists() else DEFAULT_AUDIO_MP3)
    if not path.exists():
        print(f"FAIL: audio not found {path}")
        sys.exit(1)

    print(f"=== E2E audio pipeline ===\nfile: {path}\n")
    t0 = time.perf_counter()
    audio = _load_audio_int16_16k(path)
    print(f"[load] {len(audio)/16000:.1f}s in {(time.perf_counter()-t0)*1000:.0f}ms")

    print("[whisper] loading…")
    t1 = time.perf_counter()
    get_whisper_model()
    print(f"[whisper] ready in {(time.perf_counter()-t1)*1000:.0f}ms")

    segs = _segment_by_silence(audio)
    print(f"[vad] {len(segs)} segments\n")

    answered = 0
    results = []
    for i, (start, end) in enumerate(segs):
        if answered >= args.max:
            break
        clip = audio[start:end]
        t_stt = time.perf_counter()
        text = transcribe_audio(clip)
        stt_ms = (time.perf_counter() - t_stt) * 1000
        print(f"--- segment {i} ({start/16000:.1f}s–{end/16000:.1f}s) STT {stt_ms:.0f}ms ---")
        print(f"TRANSCRIPT: {text!r}")

        if not text or len(text.split()) < 3:
            print("skip: empty\n")
            continue

        cls = classify_utterance(text)
        print(f"CLASSIFY: is_q={cls.get('is_interview_question')} conf={cls.get('confidence')} src={cls.get('source')}")
        is_q = bool(cls.get("is_interview_question"))
        soft = "?" in text or text.strip().lower().startswith(
            ("tell me", "what ", "how ", "why ", "explain", "describe", "walk me")
        )
        if not is_q and not soft:
            print("skip: not question\n")
            continue

        q = cls.get("cleaned_question") or text
        t_a = time.perf_counter()
        acc = "".join(
            _stream_answer_text(q, job_context="AI/ML Engineer", tone="confident", mode="star")
        )
        ans_ms = (time.perf_counter() - t_a) * 1000
        print(f"ANSWER ({ans_ms:.0f}ms):\n{acc}\n")
        answered += 1
        results.append(
            {
                "q": q,
                "transcript": text,
                "answer": acc,
                "stt_ms": round(stt_ms),
                "answer_ms": round(ans_ms),
                "bullets": _to_bullets(acc, "star"),
            }
        )

    print("=== SUMMARY ===")
    print(f"answered={answered}/{args.max}")
    for r in results:
        print(f"- Q: {r['q'][:80]}… | STT {r['stt_ms']}ms | ANS {r['answer_ms']}ms")
    if answered == 0:
        print("FAIL: no questions answered")
        sys.exit(2)
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
