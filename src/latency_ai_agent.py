#!/usr/bin/env python3
"""
AI Latency Agent — millisecond (actually µs) breakdown of the interview pipeline.

Answers: do we need better STT, a better model, or something else?

What it measures (every named span, 0.01ms resolution via perf_counter):
  python_overhead, common_sense_lock, classify, cache_lookup, outline_skeleton,
  domain_template, rag_search (if enabled), stt_whisper_or_deepgram,
  llm_ttft (time-to-first-token), llm_full (complete answer),
  e2e_answer_path, warm_connection

Then an LLM *analyst agent* reads the numbers + config and returns:
  primary_bottleneck, secondary, recommendation, invest_in (stt|model|other|network|prompt),
  confidence, next_actions[]

CLI:
  venv\\Scripts\\python.exe latency_ai_agent.py
  venv\\Scripts\\python.exe latency_ai_agent.py --quick
  venv\\Scripts\\python.exe latency_ai_agent.py --out jd and resume/latency_report.json

API (via copilot_api):
  POST /api/latency/ai-diagnose
  GET  /api/latency/ai-diagnose/last
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import uuid
import wave
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

SRC = Path(__file__).resolve().parent
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

# Last AI report for API polling
_LAST_REPORT: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# High-resolution span tracker (reports ms with 0.01 precision ≈ 10µs clock)
# ---------------------------------------------------------------------------


@dataclass
class Span:
    name: str
    ms: float
    ok: bool = True
    detail: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SpanTracker:
    """Named spans with nested support; all times from perf_counter."""

    def __init__(self) -> None:
        self.spans: list[Span] = []
        self._stack: list[tuple[str, float, dict[str, Any]]] = []

    def start(self, name: str, **meta: Any) -> None:
        self._stack.append((name, time.perf_counter(), meta))

    def end(self, ok: bool = True, detail: str = "", **extra: Any) -> float:
        if not self._stack:
            return 0.0
        name, t0, meta = self._stack.pop()
        ms = round((time.perf_counter() - t0) * 1000, 2)
        meta = {**meta, **extra}
        self.spans.append(Span(name=name, ms=ms, ok=ok, detail=detail, meta=meta))
        return ms

    def measure(self, name: str, fn: Callable[[], Any], **meta: Any) -> tuple[Any, float]:
        self.start(name, **meta)
        err: Optional[BaseException] = None
        result = None
        try:
            result = fn()
        except BaseException as e:
            err = e
        if err is not None:
            self.end(ok=False, detail=f"{type(err).__name__}: {err}")
            raise err
        ms = self.end(ok=True)
        return result, ms

    def by_name(self) -> dict[str, list[Span]]:
        out: dict[str, list[Span]] = {}
        for s in self.spans:
            out.setdefault(s.name, []).append(s)
        return out

    def summary(self) -> dict[str, Any]:
        by = self.by_name()
        rows = []
        total = 0.0
        for name, items in by.items():
            vals = [s.ms for s in items if s.ok]
            if not vals:
                rows.append(
                    {
                        "stage": name,
                        "n": len(items),
                        "ok": False,
                        "detail": items[-1].detail if items else "",
                    }
                )
                continue
            avg = sum(vals) / len(vals)
            total += avg  # sum of stage avgs (not wall clock)
            rows.append(
                {
                    "stage": name,
                    "n": len(vals),
                    "min_ms": round(min(vals), 2),
                    "avg_ms": round(avg, 2),
                    "max_ms": round(max(vals), 2),
                    "p50_ms": round(sorted(vals)[len(vals) // 2], 2),
                    "share_of_sum_pct": None,  # filled below
                    "ok": all(s.ok for s in items),
                    "last_detail": items[-1].detail,
                    "last_meta": items[-1].meta,
                }
            )
        # Shares of sum of successful stage avgs (diagnostic, not strict E2E)
        sum_avg = sum(r["avg_ms"] for r in rows if r.get("avg_ms") is not None) or 1.0
        for r in rows:
            if r.get("avg_ms") is not None:
                r["share_of_sum_pct"] = round(100.0 * r["avg_ms"] / sum_avg, 1)
        rows.sort(key=lambda r: -(r.get("avg_ms") or 0))
        return {
            "stages_ranked": rows,
            "sum_of_stage_avgs_ms": round(sum_avg, 2),
            "span_count": len(self.spans),
        }


# ---------------------------------------------------------------------------
# Env / config snapshot (no secrets)
# ---------------------------------------------------------------------------


def _load_env() -> None:
    env = SRC / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if not (os.environ.get("OPENAI_BASE_URL") or "").strip():
        os.environ.pop("OPENAI_BASE_URL", None)


def config_fingerprint() -> dict[str, Any]:
    from config import (
        get_deepgram_api_key,
        get_llm_provider,
        get_openai_api_key,
        get_openai_base_url,
        get_stt_provider,
        remap_model_for_provider,
    )
    from answer_engine import (
        ANSWER_MODEL,
        ANSWER_PROFILE,
        FALLBACK_MODEL,
        FAST_ANSWER_MODEL,
        FAST_FALLBACK_MODEL,
    )

    k = get_openai_api_key() or ""
    dg = get_deepgram_api_key() or ""
    return {
        "llm_provider": get_llm_provider(),
        "base_url": get_openai_base_url() or "default",
        "key_present": bool(k),
        "key_prefix": k[:4] if k else "",
        "answer_profile": ANSWER_PROFILE,
        "answer_model": ANSWER_MODEL,
        "fast_model": FAST_ANSWER_MODEL,
        "fallback_model": FALLBACK_MODEL,
        "fast_fallback": FAST_FALLBACK_MODEL,
        "remap_gpt4o": remap_model_for_provider("gpt-4o"),
        "stt_provider_resolved": get_stt_provider(),
        "deepgram_key_present": bool(dg),
        "whisper_model_env": os.environ.get("WHISPER_MODEL")
        or os.environ.get("ASTRA_WHISPER_MODEL")
        or "default",
    }


# ---------------------------------------------------------------------------
# Stage micro-benchmarks
# ---------------------------------------------------------------------------

PROBE_CASES = [
    {
        "id": "attp_short",
        "role": "SAP ATTP Techno-Functional Consultant",
        "q": "Yes or no: should shipping be blocked when parent-child aggregation is incomplete?",
        "mode": "technical",
    },
    {
        "id": "attp_arch",
        "role": "SAP ATTP Techno-Functional Consultant",
        "q": (
            "Walk me through how serial number requests, commissioning, packing, "
            "and shipping events should flow between MAH, CMO, and 3PL on SAP ATTP, "
            "including who owns GTIN GLN and SSCC master data."
        ),
        "mode": "technical",
    },
    {
        "id": "behavioral",
        "role": "SAP ATTP Consultant",
        "q": "Tell me about a time you had to push back on a partner who wanted a spreadsheet interim.",
        "mode": "star",
    },
]


def _find_test_audio() -> Optional[Path]:
    candidates = [
        SRC / "jd and resume" / "sri_naidu_attp_jd_interview_25q.wav",
        SRC / "test_audio" / "sap_attp_interview_50.wav",
        SRC / "test_audio" / "ai_ml_interview_20q.wav",
        SRC / "test_audio" / "sap_attp_interview_50.mp3",
    ]
    for p in candidates:
        if p.exists() and p.stat().st_size > 1000:
            return p
    return None


def _make_silent_wav(seconds: float = 1.5, sr: int = 16000) -> Path:
    """Fallback audio if no interview clip exists (STT will return empty-ish)."""
    path = Path(tempfile.gettempdir()) / "astra_latency_probe.wav"
    n = int(sr * seconds)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * n)
    return path


def _load_audio_seconds(path: Path, max_seconds: float = 4.0) -> Any:
    """Load mono float32 clip for Whisper; for Deepgram return raw bytes path."""
    import numpy as np

    if path.suffix.lower() == ".wav":
        with wave.open(str(path), "rb") as w:
            sr = w.getframerate()
            n = min(int(sr * max_seconds), w.getnframes())
            raw = w.readframes(n)
            ch = w.getnchannels()
            sw = w.getsampwidth()
        if sw == 2:
            audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        else:
            audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if ch > 1:
            audio = audio.reshape(-1, ch).mean(axis=1)
        # Resample naive if needed
        if sr != 16000 and len(audio) > 0:
            # linear resample
            duration = len(audio) / float(sr)
            target_n = int(duration * 16000)
            x_old = np.linspace(0, 1, num=len(audio), endpoint=False)
            x_new = np.linspace(0, 1, num=max(1, target_n), endpoint=False)
            audio = np.interp(x_new, x_old, audio).astype(np.float32)
        return audio
    # mp3 / other via pydub if available
    try:
        from pydub import AudioSegment

        seg = AudioSegment.from_file(str(path))
        seg = seg.set_channels(1).set_frame_rate(16000)
        # first max_seconds
        seg = seg[: int(max_seconds * 1000)]
        samples = seg.get_array_of_samples()
        audio = np.array(samples, dtype=np.float32)
        if seg.sample_width == 2:
            audio = audio / 32768.0
        return audio
    except Exception as e:
        raise RuntimeError(f"Cannot load audio {path}: {e}") from e


def bench_python(tracker: SpanTracker, rounds: int = 5) -> None:
    for _ in range(rounds):
        tracker.measure("python_overhead_1k_ops", lambda: sum(i * i for i in range(1000)))


def bench_common_sense(tracker: SpanTracker, rounds: int = 5) -> None:
    from common_sense import lock_for_turn, prompt_guardrails, sanitize_answer

    q = PROBE_CASES[0]["q"]
    role = PROBE_CASES[0]["role"]

    def one() -> None:
        lock = lock_for_turn(q, role)
        _ = prompt_guardrails(lock)
        _ = sanitize_answer(
            "Hook: Yes.\nApproach: Block incomplete aggregation.\n",
            question=q,
            job_context=role,
            lock=lock,
        )

    for _ in range(rounds):
        tracker.measure("common_sense_lock", one)


def bench_cache_outline(tracker: SpanTracker, rounds: int = 3) -> None:
    from fast_answer import cache_lookup, outline_skeleton, template_answer

    case = PROBE_CASES[1]
    q = case["q"] + f" ref={uuid.uuid4().hex[:6]}"
    role = case["role"]
    mode = case["mode"]
    for _ in range(rounds):
        tracker.measure(
            "cache_lookup",
            lambda: cache_lookup(q, mode=mode, job_context=role, allow_approx=False),
        )
        tracker.measure(
            "outline_skeleton",
            lambda: outline_skeleton(q, job_context=role, mode=mode),
        )
        tracker.measure(
            "template_answer",
            lambda: template_answer(q, job_context=role, mode=mode),
        )


def bench_classify(tracker: SpanTracker) -> None:
    from answer_engine import ANSWER_PROFILE, looks_like_question

    q = PROBE_CASES[0]["q"]
    tracker.measure(
        "classify_heuristic",
        lambda: looks_like_question(q),
        profile=ANSWER_PROFILE,
    )
    if ANSWER_PROFILE in ("quality", "full"):
        try:
            from rag import classify_utterance

            tracker.measure("classify_llm", lambda: classify_utterance(q))
        except Exception as e:
            tracker.spans.append(
                Span("classify_llm", 0.0, ok=False, detail=str(e))
            )


def bench_rag(tracker: SpanTracker) -> None:
    try:
        from answer_engine import _use_rag
        from rag import search_context

        if not _use_rag():
            tracker.spans.append(
                Span(
                    "rag_search",
                    0.0,
                    ok=True,
                    detail="skipped (profile disables RAG)",
                    meta={"skipped": True},
                )
            )
            return
        tracker.measure(
            "rag_search",
            lambda: search_context(PROBE_CASES[1]["q"], top_k=3),
        )
    except Exception as e:
        tracker.spans.append(Span("rag_search", 0.0, ok=False, detail=str(e)))


def bench_stt(tracker: SpanTracker, quick: bool = False) -> dict[str, Any]:
    """Time local Whisper and/or Deepgram on a short clip."""
    from config import get_stt_provider

    info: dict[str, Any] = {
        "provider": get_stt_provider(),
        "audio": None,
        "text_preview": "",
    }
    audio_path = _find_test_audio()
    if audio_path is None:
        audio_path = _make_silent_wav(1.2)
        info["audio_note"] = "synthetic silence (no interview wav found)"
    info["audio"] = str(audio_path)

    # Local Whisper path
    if not quick or get_stt_provider() == "whisper":
        try:
            from transcriber import transcribe_audio

            audio = _load_audio_seconds(audio_path, max_seconds=3.5 if not quick else 2.0)

            def run_whisper() -> str:
                return transcribe_audio(audio) or ""

            # Cold-ish first call
            text, ms = tracker.measure(
                "stt_whisper",
                run_whisper,
                path=str(audio_path.name),
                samples=int(getattr(audio, "shape", [0])[0]) if hasattr(audio, "shape") else 0,
            )
            info["whisper_ms"] = ms
            info["whisper_text"] = (text or "")[:180]
            info["text_preview"] = info["whisper_text"]
            # Warm second call
            if not quick:
                tracker.measure("stt_whisper_warm", run_whisper)
        except Exception as e:
            tracker.spans.append(
                Span("stt_whisper", 0.0, ok=False, detail=f"{type(e).__name__}: {e}")
            )
            info["whisper_error"] = f"{type(e).__name__}: {e}"

    # Deepgram Nova-3 (preferred production path)
    try:
        from config import get_deepgram_api_key

        if not get_deepgram_api_key():
            tracker.spans.append(
                Span(
                    "stt_deepgram",
                    0.0,
                    ok=True,
                    detail="skipped (no DEEPGRAM_API_KEY)",
                    meta={"skipped": True},
                )
            )
            return info

        import numpy as np
        from deepgram_stt import transcribe_pcm_nova3

        audio = _load_audio_seconds(audio_path, max_seconds=3.5 if not quick else 2.0)
        if not isinstance(audio, np.ndarray):
            raise RuntimeError("audio not ndarray")

        def run_dg() -> str:
            # Returns (transcript, meta) for float32/int16 PCM @ 16k
            out = transcribe_pcm_nova3(audio)
            if isinstance(out, tuple):
                return str(out[0] or "")[:500]
            if isinstance(out, dict):
                return str(out.get("text") or out.get("transcript") or "")[:500]
            return str(out or "")[:500]

        text, ms = tracker.measure("stt_deepgram", run_dg)
        info["deepgram_ms"] = ms
        info["deepgram_text"] = (text or "")[:180]
        if text:
            info["text_preview"] = info["deepgram_text"]
        if not quick:
            tracker.measure("stt_deepgram_warm", run_dg)
    except Exception as e:
        tracker.spans.append(
            Span("stt_deepgram", 0.0, ok=False, detail=f"{type(e).__name__}: {e}")
        )
        info["deepgram_error"] = f"{type(e).__name__}: {e}"

    return info


def bench_llm(
    tracker: SpanTracker,
    *,
    quick: bool = False,
    cases: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """TTFT + full completion for current models; optional model compare."""
    from answer_engine import (
        FAST_ANSWER_MODEL,
        generate_answer,
        iter_answer_tokens,
        _get_openai_client,
        _chat_create_kwargs,
    )
    from config import remap_model_for_provider

    client = _get_openai_client()
    cases = cases or (PROBE_CASES[:1] if quick else PROBE_CASES)
    out: dict[str, Any] = {"cases": [], "ttft": [], "full": []}

    # Warm connection (same helper used on live session start)
    try:
        def warm() -> None:
            from answer_engine import warm_llm_connection

            warm_llm_connection()

        tracker.measure("llm_warm_connection", warm)
    except Exception as e:
        tracker.spans.append(
            Span("llm_warm_connection", 0.0, ok=False, detail=str(e))
        )

    for case in cases:
        uid = uuid.uuid4().hex[:8]
        q = f"{case['q']} [probe {uid}]"
        role = case["role"]
        mode = case["mode"]

        # Stream TTFT
        def measure_ttft() -> dict[str, Any]:
            t0 = time.perf_counter()
            first_ms = None
            full_ms = None
            n_chars = 0
            text_parts: list[str] = []
            try:
                for tok in iter_answer_tokens(
                    q, job_context=role, mode=mode, tone="confident"
                ):
                    if first_ms is None and (tok or "").strip():
                        first_ms = round((time.perf_counter() - t0) * 1000, 2)
                    text_parts.append(tok or "")
                    n_chars += len(tok or "")
                full_ms = round((time.perf_counter() - t0) * 1000, 2)
            except Exception as e:
                return {"error": f"{type(e).__name__}: {e}", "ttft_ms": first_ms}
            return {
                "ttft_ms": first_ms,
                "full_ms": full_ms,
                "chars": n_chars,
                "words": len("".join(text_parts).split()),
                "preview": "".join(text_parts)[:200],
                "source": "stream",
            }

        try:
            result, wall = tracker.measure(
                "llm_stream_ttft_full",
                measure_ttft,
                case=case["id"],
            )
            if isinstance(result, dict) and result.get("ttft_ms") is not None:
                tracker.spans.append(
                    Span(
                        "llm_ttft",
                        float(result["ttft_ms"]),
                        ok=True,
                        detail=case["id"],
                        meta=result,
                    )
                )
            if isinstance(result, dict) and result.get("full_ms") is not None:
                tracker.spans.append(
                    Span(
                        "llm_full_stream",
                        float(result["full_ms"]),
                        ok=True,
                        detail=case["id"],
                        meta={"words": result.get("words")},
                    )
                )
            out["cases"].append({"id": case["id"], "stream": result, "wall_ms": wall})
        except Exception as e:
            tracker.spans.append(
                Span("llm_stream_ttft_full", 0.0, ok=False, detail=str(e))
            )

        # Non-stream generate_answer
        def measure_full() -> dict[str, Any]:
            t0 = time.perf_counter()
            ans = generate_answer(q + " x", job_context=role, mode=mode, tone="confident")
            ms = round((time.perf_counter() - t0) * 1000, 2)
            src = getattr(generate_answer, "last_source", None)
            return {
                "full_ms": ms,
                "source": src,
                "words": len((ans or "").split()),
                "preview": (ans or "")[:200],
            }

        try:
            result2, _ = tracker.measure(
                "llm_generate_answer",
                measure_full,
                case=case["id"],
            )
            if isinstance(result2, dict) and result2.get("full_ms") is not None:
                tracker.spans.append(
                    Span(
                        "llm_full_generate",
                        float(result2["full_ms"]),
                        ok=True,
                        detail=case["id"],
                        meta=result2,
                    )
                )
            out["cases"][-1]["generate"] = result2
        except Exception as e:
            tracker.spans.append(
                Span("llm_generate_answer", 0.0, ok=False, detail=str(e))
            )

    # Optional: compare fast vs accuracy model TTFT (one short Q)
    if not quick:
        try:
            from answer_engine import TECH_ACCURACY_MODEL

            models = []
            for m in (FAST_ANSWER_MODEL, TECH_ACCURACY_MODEL, "llama-3.1-8b-instant"):
                mm = remap_model_for_provider(m) or m
                if mm and mm not in models:
                    models.append(mm)
            short_q = "In one word: should incomplete aggregation block shipping? Yes or no."
            for model in models[:3]:
                def ttft_model(m=model) -> float:
                    t0 = time.perf_counter()
                    stream = client.chat.completions.create(
                        **_chat_create_kwargs(
                            model=m,
                            messages=[
                                {
                                    "role": "system",
                                    "content": "Answer in one short sentence.",
                                },
                                {"role": "user", "content": short_q + f" [{uuid.uuid4().hex[:4]}]"},
                            ],
                            max_tokens=40,
                            temperature=0.2,
                            stream=True,
                            timeout=30.0,
                        )
                    )
                    for chunk in stream:
                        try:
                            delta = chunk.choices[0].delta.content
                        except Exception:
                            delta = None
                        if delta:
                            return round((time.perf_counter() - t0) * 1000, 2)
                    return round((time.perf_counter() - t0) * 1000, 2)

                ms = tracker.measure(f"model_ttft::{model}", ttft_model)[1]
                out.setdefault("model_ttft", []).append({"model": model, "ttft_ms": ms})
        except Exception as e:
            out["model_compare_error"] = str(e)

    return out


def rule_based_verdict(summary: dict[str, Any], cfg: dict[str, Any], stt_info: dict) -> dict[str, Any]:
    """Deterministic triage if LLM analyst fails."""
    stages = {r["stage"]: r for r in summary.get("stages_ranked", []) if r.get("avg_ms") is not None}

    def avg(name: str) -> float:
        return float((stages.get(name) or {}).get("avg_ms") or 0.0)

    stt_ms = max(avg("stt_whisper"), avg("stt_deepgram"), avg("stt_whisper_warm"))
    ttft = avg("llm_ttft") or avg("llm_stream_ttft_full")
    full = avg("llm_full_generate") or avg("llm_full_stream") or avg("llm_generate_answer")
    cache = avg("cache_lookup")
    outline = avg("outline_skeleton")

    candidates = [
        ("stt", stt_ms, "Speech-to-text dominates time-to-question-text"),
        ("model", max(ttft, full * 0.6), "LLM time-to-first-token / full generation dominates"),
        ("other_python", max(cache, outline, avg("common_sense_lock")), "Local Python path"),
    ]
    candidates.sort(key=lambda x: -x[1])
    primary, primary_ms, why = candidates[0]
    secondary = candidates[1][0] if len(candidates) > 1 else "none"

    invest = primary
    actions: list[str] = []

    # Config smell: Llama model names with OpenAI provider (common silent lag source)
    am = str(cfg.get("answer_model") or "").lower()
    fm = str(cfg.get("fast_model") or "").lower()
    prov = str(cfg.get("llm_provider") or "").lower()
    llama_names = "llama" in am or "llama" in fm or "mixtral" in am or "gpt-oss" in am
    if prov == "openai" and llama_names:
        actions.append(
            "CONFIG BUG: ASTRA_LLM_PROVIDER=openai but models are Llama "
            f"({cfg.get('answer_model')} / {cfg.get('fast_model')}). "
            "Set ASTRA_LLM_PROVIDER=groq + GROQ_API_KEY for sub-second TTFT, "
            "or switch models to gpt-4o-mini on OpenAI."
        )
        invest = "model"
        primary = "model"
        why = (
            "Provider/model mismatch: OpenAI endpoint cannot serve Llama model IDs "
            "efficiently (failover/retries inflate TTFT)."
        )

    if primary == "stt":
        if cfg.get("stt_provider_resolved") == "whisper":
            actions.append("Switch ASTRA_STT_PROVIDER=deepgram (Nova-3 streaming) if key is set")
            actions.append("Or use smaller faster-whisper model (base/small.en) for local")
        else:
            actions.append("Ensure Deepgram streaming (not batch) is on the live path")
            actions.append("Lower endpointing silence hangover if VAD waits too long")
        actions.append("STT is not fixed by a bigger LLM — do not upgrade model first")
    elif primary == "model":
        actions.append(
            f"Prefer faster draft model for live TTFT (current fast={cfg.get('fast_model')})"
        )
        actions.append("Keep outline-first + cache warm; reduce max_tokens in fast depth")
        actions.append("Confirm provider is Groq/Flash-class for live, not a slow OpenAI o-series")
        if ttft > 1500:
            actions.append("TTFT >1.5s: check network/region and model remap")
    else:
        actions.append("Local stages are not the bottleneck — focus STT/LLM")

    if full > 4000 and ttft < 800:
        actions.append("Full answer is slow but TTFT ok — shorten target words / stream earlier")

    if stt_ms > 800 and primary == "model":
        actions.append(
            f"STT is secondary but still {stt_ms:.0f}ms — keep Deepgram streaming; "
            "do not switch back to local Whisper for live."
        )

    return {
        "primary_bottleneck": primary,
        "primary_ms": round(primary_ms, 2),
        "secondary_bottleneck": secondary,
        "why": why,
        "invest_in": invest,
        "confidence": 0.72,
        "next_actions": actions,
        "numbers": {
            "stt_ms": stt_ms,
            "llm_ttft_ms": ttft,
            "llm_full_ms": full,
            "cache_ms": cache,
            "outline_ms": outline,
        },
        "analyst": "rule_based",
    }


def ai_analyze(
    *,
    summary: dict[str, Any],
    cfg: dict[str, Any],
    stt_info: dict[str, Any],
    llm_info: dict[str, Any],
) -> dict[str, Any]:
    """LLM analyst agent — structured recommendation."""
    fallback = rule_based_verdict(summary, cfg, stt_info)
    try:
        from answer_engine import FAST_ANSWER_MODEL, _chat_create_kwargs, _get_openai_client
        from config import remap_model_for_provider

        client = _get_openai_client()
        model = remap_model_for_provider(FAST_ANSWER_MODEL) or FAST_ANSWER_MODEL
        payload = {
            "config": cfg,
            "stage_summary": summary,
            "stt_probe": {
                k: stt_info.get(k)
                for k in (
                    "provider",
                    "whisper_ms",
                    "deepgram_ms",
                    "audio_note",
                    "text_preview",
                )
            },
            "llm_probe_cases": [
                {
                    "id": c.get("id"),
                    "ttft_ms": (c.get("stream") or {}).get("ttft_ms"),
                    "full_stream_ms": (c.get("stream") or {}).get("full_ms"),
                    "full_generate_ms": (c.get("generate") or {}).get("full_ms"),
                    "source": (c.get("generate") or {}).get("source"),
                    "words": (c.get("generate") or {}).get("words"),
                }
                for c in (llm_info.get("cases") or [])
            ],
            "model_ttft_compare": llm_info.get("model_ttft"),
            "market_bars_ms": {
                "first_token_excellent": 400,
                "first_token_good": 800,
                "stt_good": 500,
                "full_answer_good": 3000,
                "total_acceptable": 5000,
            },
        }
        system = (
            "You are Astra's Latency Analyst Agent. You ONLY reason from the provided "
            "millisecond measurements. Decide whether the user should invest in:\n"
            "  - stt (speech-to-text / VAD / streaming ASR)\n"
            "  - model (LLM choice, TTFT, tokens, provider)\n"
            "  - network (API region, cold start, TLS)\n"
            "  - prompt (too long system/user prompts)\n"
            "  - other (cache, outline, RAG, Python overhead)\n"
            "Return STRICT JSON with keys:\n"
            "primary_bottleneck, secondary_bottleneck, invest_in, confidence (0-1),\n"
            "headline (1 sentence), why (2-4 sentences), next_actions (array of 3-6 strings),\n"
            "ms_budget (object: stt_ms, llm_ttft_ms, llm_full_ms, local_ms, waste_ms),\n"
            "should_upgrade_stt (bool), should_upgrade_model (bool), should_change_provider (bool).\n"
            "Be blunt. Prefer evidence over marketing. If STT is 2s+ and TTFT is 400ms, "
            "do NOT recommend a bigger model."
        )
        user = (
            "Analyze this pipeline profile and recommend where to spend engineering effort:\n"
            + json.dumps(payload, ensure_ascii=False)[:14000]
        )
        t0 = time.perf_counter()
        resp = client.chat.completions.create(
            **_chat_create_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                max_tokens=700,
                temperature=0.15,
                stream=False,
                timeout=45.0,
            )
        )
        analyst_ms = round((time.perf_counter() - t0) * 1000, 2)
        raw = (resp.choices[0].message.content or "").strip()
        # Extract JSON
        start = raw.find("{")
        end = raw.rfind("}")
        data = {}
        if start >= 0 and end > start:
            data = json.loads(raw[start : end + 1])
        else:
            data = {"headline": raw[:300], "parse_error": True}
        data["analyst"] = "llm"
        data["analyst_ms"] = analyst_ms
        data["analyst_model"] = model
        # Merge rule numbers if missing
        data.setdefault("numbers", fallback.get("numbers"))
        data.setdefault("next_actions", fallback.get("next_actions"))
        data.setdefault("invest_in", data.get("primary_bottleneck") or fallback["invest_in"])
        data.setdefault("confidence", 0.8)
        data["rule_based_backup"] = fallback
        return data
    except Exception as e:
        fallback["analyst_error"] = f"{type(e).__name__}: {e}"
        return fallback


def run_agent(*, quick: bool = False, include_stt: bool = True) -> dict[str, Any]:
    """Full AI latency diagnosis."""
    global _LAST_REPORT
    _load_env()
    t_wall0 = time.perf_counter()
    tracker = SpanTracker()
    cfg = config_fingerprint()

    print("[latency-ai] config:", json.dumps(cfg, indent=2), flush=True)
    print("[latency-ai] micro-benchmarks…", flush=True)

    bench_python(tracker, rounds=3 if quick else 5)
    bench_common_sense(tracker, rounds=3 if quick else 5)
    bench_cache_outline(tracker, rounds=2 if quick else 3)
    bench_classify(tracker)
    bench_rag(tracker)

    stt_info: dict[str, Any] = {"skipped": not include_stt}
    if include_stt:
        print("[latency-ai] STT probe…", flush=True)
        stt_info = bench_stt(tracker, quick=quick)

    print("[latency-ai] LLM probe…", flush=True)
    llm_info = bench_llm(tracker, quick=quick)

    summary = tracker.summary()
    print("[latency-ai] AI analyst…", flush=True)
    analysis = ai_analyze(
        summary=summary, cfg=cfg, stt_info=stt_info, llm_info=llm_info
    )

    # Waterfall-friendly ordered stages for UI
    waterfall = []
    for r in sorted(
        summary.get("stages_ranked") or [],
        key=lambda x: -(x.get("avg_ms") or 0),
    ):
        waterfall.append(
            {
                "stage": r["stage"],
                "avg_ms": r.get("avg_ms"),
                "min_ms": r.get("min_ms"),
                "max_ms": r.get("max_ms"),
                "share_pct": r.get("share_of_sum_pct"),
                "ok": r.get("ok"),
                "detail": r.get("last_detail"),
            }
        )

    report = {
        "ok": True,
        "tool": "latency_ai_agent",
        "version": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "wall_ms": round((time.perf_counter() - t_wall0) * 1000, 1),
        "quick": quick,
        "config": cfg,
        "waterfall_ms": waterfall,
        "stage_summary": summary,
        "stt": stt_info,
        "llm": {
            "cases": llm_info.get("cases"),
            "model_ttft": llm_info.get("model_ttft"),
        },
        "ai_analysis": analysis,
        "recommendation": {
            "invest_in": analysis.get("invest_in") or analysis.get("primary_bottleneck"),
            "headline": analysis.get("headline")
            or analysis.get("why")
            or "See next_actions",
            "should_upgrade_stt": analysis.get("should_upgrade_stt"),
            "should_upgrade_model": analysis.get("should_upgrade_model"),
            "should_change_provider": analysis.get("should_change_provider"),
            "next_actions": analysis.get("next_actions") or [],
            "confidence": analysis.get("confidence"),
        },
        "how_to_read": {
            "unit": "milliseconds (ms), 0.01 precision",
            "rule": (
                "If stt_* avg >> llm_ttft → upgrade STT/streaming ASR, not the LLM. "
                "If llm_ttft is the top bar → faster model/provider or shorter prompts. "
                "If cache/outline/common_sense are <5ms they are not the problem."
            ),
        },
    }
    _LAST_REPORT = report
    return report


def get_last_report() -> dict[str, Any]:
    return _LAST_REPORT or {"ok": False, "error": "no report yet — POST /api/latency/ai-diagnose"}


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Astra AI Latency Agent")
    parser.add_argument("--quick", action="store_true", help="Fewer rounds / shorter STT clip")
    parser.add_argument("--no-stt", action="store_true", help="Skip STT probes")
    parser.add_argument(
        "--out",
        type=str,
        default=str(SRC / "jd and resume" / "latency_ai_report.json"),
        help="Write JSON report path",
    )
    args = parser.parse_args(argv)

    report = run_agent(quick=args.quick, include_stt=not args.no_stt)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    rec = report.get("recommendation") or {}
    analysis = report.get("ai_analysis") or {}
    print("\n======== AI LATENCY VERDICT ========", flush=True)
    print(f"Invest in: {rec.get('invest_in')}", flush=True)
    print(f"Headline:  {rec.get('headline')}", flush=True)
    print(f"Confidence:{rec.get('confidence')}", flush=True)
    print("Top stages (ms):", flush=True)
    for row in (report.get("waterfall_ms") or [])[:12]:
        print(
            f"  {row.get('avg_ms', 0):8.2f} ms  {row.get('stage')}  "
            f"({row.get('share_pct')}%)",
            flush=True,
        )
    print("Next actions:", flush=True)
    for a in rec.get("next_actions") or []:
        print(f"  - {a}", flush=True)
    print(f"\nReport: {out}", flush=True)
    print(f"Analyst: {analysis.get('analyst')} model={analysis.get('analyst_model')}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
