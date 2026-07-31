#!/usr/bin/env python3
"""
Karpathy-style tight benchmark/fix loop for LONG interviews.

Runs the full-length test_audio files end-to-end through the same
STT -> classify -> answer cascade the live session uses (transcriber,
rag.classify_utterance, fast_answer.iter_cascade_answer + answer_engine
.iter_answer_tokens) and records per-question latency + answer quality
across the WHOLE interview (not just the first few Qs like the older
smoke tests). This is meant to be re-run after each fix to check for
latency drift / dropped answers / truncated output as a session gets long.

Usage (GROQ_API_KEY must be exported in the shell — never read from .env):
    venv\\Scripts\\python.exe _long_interview_loop.py --which sap
    venv\\Scripts\\python.exe _long_interview_loop.py --which aiml
    venv\\Scripts\\python.exe _long_interview_loop.py --which both
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import tracemalloc
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)

from copilot_api import _load_audio_int16_16k, _segment_by_silence  # noqa: E402
from config import get_llm_provider, get_openai_api_key  # noqa: E402
from rag import classify_utterance  # noqa: E402
from transcriber import get_whisper_model, transcribe_audio  # noqa: E402


def looks_like_question(text: str) -> bool:
    """Mirror live_session.py heuristic so the benchmark matches prod behavior."""
    t = (text or "").strip().lower()
    if not t or len(t.split()) < 3:
        return False
    if "?" in t:
        return True
    t2 = re.sub(r"^(question|q)\s*\d+\s*[,.:\-–]?\s*", "", t)
    cues = (
        "tell me", "what is", "what are", "what was", "what would", "what do",
        "how would", "how do", "how does", "how did", "how can", "why ",
        "explain", "describe", "walk me", "walk us", "can you", "could you",
        "would you", "give me", "talk about", "have you", "did you", "do you",
        "difference between", "compare ", "define ", "when would", "when do",
        "which ", "where ", "who ", "design a", "architect", "debug", "troubleshoot",
    )
    return any(c in t2 for c in cues)


CASES = {
    "sap": dict(
        label="SAP_FICO_VERTEX",
        audio=ROOT / "test_audio" / "sap_fico_vertex_interview_20q.mp3",
        job_context="SAP FICO Consultant",
        mode="technical",
    ),
    "aiml": dict(
        label="AI_ML_20Q",
        audio=ROOT / "test_audio" / "ai_ml_interview_20q.wav",
        job_context="AI/ML Engineer",
        mode="technical",
    ),
}


def run_case(key: str, *, max_questions: int | None = None) -> dict:
    from answer_engine import iter_answer_tokens, _normalize_answer_text
    from fast_answer import iter_cascade_answer

    case = CASES[key]
    audio_path: Path = case["audio"]
    print(f"\n{'='*70}\n{case['label']}  file={audio_path.name}\n{'='*70}")

    t0 = time.perf_counter()
    audio = _load_audio_int16_16k(audio_path)
    dur = len(audio) / 16000.0
    print(f"[load] {dur:.1f}s audio in {round((time.perf_counter()-t0)*1000)}ms")

    segs = _segment_by_silence(audio)
    if max_questions:
        segs = segs[:max_questions]
    print(f"[vad] {len(segs)} segments to process")

    rows: list[dict] = []
    tracemalloc.start()
    session_t0 = time.perf_counter()

    for i, (start, end) in enumerate(segs):
        clip = audio[start:end]
        row: dict = {"seg": i, "start_s": round(start / 16000, 1)}

        t_stt = time.perf_counter()
        try:
            text = transcribe_audio(clip)
        except Exception as e:
            row.update(error=f"stt_exception:{e}", elapsed_since_start_s=round(time.perf_counter() - session_t0, 1))
            rows.append(row)
            continue
        stt_ms = round((time.perf_counter() - t_stt) * 1000)
        row["stt_ms"] = stt_ms
        row["transcript"] = text

        words = [w for w in (text or "").split() if w]
        if len(words) < 3:
            row["skip"] = "too_short"
            rows.append(row)
            continue

        soft_q = looks_like_question(text)
        if soft_q:
            classification = {"is_interview_question": True, "confidence": 0.85, "cleaned_question": text.strip()}
        else:
            t_cls = time.perf_counter()
            classification = classify_utterance(text, min_words=4)
            row["classify_ms"] = round((time.perf_counter() - t_cls) * 1000)
        question = classification.get("cleaned_question") or text
        is_q = bool(classification.get("is_interview_question", False))
        conf = float(classification.get("confidence", 0.0) or 0.0)
        soft_q = soft_q or looks_like_question(question)
        should_answer = is_q or soft_q or conf < 0.85
        if not should_answer:
            row["skip"] = "not_a_question"
            rows.append(row)
            continue

        row["question"] = question

        t_ans = time.perf_counter()
        first_token_ms = None
        answer = ""
        source = ""
        try:
            for text_so_far, meta in iter_cascade_answer(
                question,
                job_context=case["job_context"],
                tone="confident",
                mode=case["mode"],
                llm_streamer=iter_answer_tokens,
            ):
                answer = _normalize_answer_text(text_so_far or "")
                source = str(meta.get("source") or source)
                if first_token_ms is None and answer:
                    first_token_ms = round(
                        float(meta.get("first_paint_ms") or (time.perf_counter() - t_ans) * 1000)
                    )
                if meta.get("final"):
                    break
        except Exception as e:
            row["error"] = f"answer_exception:{e}"
        ans_ms = round((time.perf_counter() - t_ans) * 1000)

        answer_words = len((answer or "").split())
        ends_clean = bool(answer) and answer.rstrip()[-1:] in ".!?"
        row.update(
            {
                "source": source,
                "first_token_ms": first_token_ms,
                "answer_ms": ans_ms,
                "answer_words": answer_words,
                "ends_clean": ends_clean,
                "answer_preview": (answer or "")[:220],
                "elapsed_since_start_s": round(time.perf_counter() - session_t0, 1),
            }
        )
        issues = []
        if not answer:
            issues.append("empty_answer")
        elif answer_words < 60:
            issues.append(f"thin_answer({answer_words}w)")
        if not ends_clean and answer:
            issues.append("truncated_ending")
        if source not in ("llm", "llm_stream", "exact_cache", ""):
            issues.append(f"non_llm_source:{source}")
        if first_token_ms and first_token_ms > 6000:
            issues.append(f"slow_first_token({first_token_ms}ms)")
        row["issues"] = issues
        rows.append(row)

        cur, peak = tracemalloc.get_traced_memory()
        row["py_mem_mb"] = round(cur / 1e6, 1)

        print(
            f"  Q{i:02d} t+{row['elapsed_since_start_s']:>6.1f}s stt={stt_ms:>5}ms "
            f"first_tok={str(first_token_ms):>6} ans_ms={ans_ms:>6} words={answer_words:>3} "
            f"src={source:<12} issues={issues}"
        )

    tracemalloc.stop()

    answered = [r for r in rows if "answer_ms" in r]
    def _stats(vals):
        if not vals:
            return {}
        s = sorted(vals)
        n = len(s)
        return {
            "min": s[0],
            "avg": round(sum(s) / n),
            "p50": s[n // 2],
            "p95": s[int(n * 0.95) if n > 1 else 0],
            "max": s[-1],
        }

    stt_ms_list = [r["stt_ms"] for r in rows if "stt_ms" in r]
    ans_ms_list = [r["answer_ms"] for r in answered]
    first_tok_list = [r["first_token_ms"] for r in answered if r.get("first_token_ms")]

    # First-half vs second-half comparison (drift detector for long interviews)
    half = max(1, len(answered) // 2)
    first_half = answered[:half]
    second_half = answered[half:]
    def _avg(rows_, key_):
        v = [r[key_] for r in rows_ if r.get(key_) is not None]
        return round(sum(v) / len(v)) if v else None

    drift = {
        "first_half_avg_ans_ms": _avg(first_half, "answer_ms"),
        "second_half_avg_ans_ms": _avg(second_half, "answer_ms"),
        "first_half_avg_first_token_ms": _avg(first_half, "first_token_ms"),
        "second_half_avg_first_token_ms": _avg(second_half, "first_token_ms"),
    }

    all_issues = [iss for r in rows for iss in r.get("issues", [])]
    summary = {
        "label": case["label"],
        "duration_sec": round(dur, 1),
        "segments": len(segs),
        "answered": len(answered),
        "skipped": len(rows) - len(answered),
        "stt_ms": _stats(stt_ms_list),
        "answer_ms": _stats(ans_ms_list),
        "first_token_ms": _stats(first_tok_list),
        "drift": drift,
        "issue_count": len(all_issues),
        "issues_sample": all_issues[:20],
        "total_wall_s": round(time.perf_counter() - session_t0, 1),
    }
    print(f"\n[SUMMARY {case['label']}] {json.dumps(summary, indent=2)}")
    return {"summary": summary, "rows": rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--which", choices=["sap", "aiml", "both"], default="both")
    ap.add_argument("--max", type=int, default=None, help="cap number of segments per file")
    args = ap.parse_args()

    if get_llm_provider() != "groq":
        print("WARN: provider is not groq — set GROQ_API_KEY / ASTRA_LLM_PROVIDER=groq in the shell")
    if not get_openai_api_key():
        print("FAIL: no usable LLM API key in process env")
        return 2

    t0 = time.perf_counter()
    get_whisper_model()
    print(f"[whisper] loaded in {round((time.perf_counter()-t0)*1000)}ms")

    from answer_engine import warm_llm_connection

    t0 = time.perf_counter()
    warm_llm_connection()
    print(f"[llm] connection warmed in {round((time.perf_counter()-t0)*1000)}ms")

    keys = ["sap", "aiml"] if args.which == "both" else [args.which]
    out = {}
    for k in keys:
        out[k] = run_case(k, max_questions=args.max)

    out_path = ROOT / "_long_interview_loop_result.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
