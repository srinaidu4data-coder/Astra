"""
Stage-by-stage interview latency metrics + competitor benchmark bars.

Tracks every hop so we can answer "are we best-in-class vs market?" with data,
not marketing. Thread-safe, process-local ring buffer.

Stages (ms):
  vad_ms          — silence hangover / end-of-speech detect (when known)
  stt_ms          — speech → text
  classify_ms     — question gate (heuristic or LLM)
  cache_ms        — exact/approx cache lookup
  outline_ms      — outline-first skeleton paint
  first_token_ms  — time to first usable answer text (cache/outline/LLM)
  full_answer_ms  — time to complete answer
  total_ms        — stt + answer path (question end → final)
"""

from __future__ import annotations

import os
import statistics
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Competitor / market bars (research 2026 — claimed vs user-reported)
# Used only for comparison snapshots; not SLAs we invent.
# ---------------------------------------------------------------------------

COMPETITOR_BENCHMARKS: dict[str, dict[str, Any]] = {
    "cluely": {
        "label": "Cluely",
        "claimed_ms": 300,
        "claimed_metric": "transcription_or_response_time",
        "user_reported_ms": 7500,
        "user_range_ms": [5000, 10000],
        "notes": "Homepage 300ms; independent tests 5–10s under real interviews",
    },
    "lockedin": {
        "label": "LockedIn AI",
        "claimed_ms": 116,
        "claimed_metric": "avg_speed",
        "user_reported_ms": 4500,
        "user_range_ms": [4000, 5000],
        "notes": "116ms homepage; Trustpilot users report 4–5s latency stare",
    },
    "final_round": {
        "label": "Final Round AI",
        "claimed_ms": 3000,
        "claimed_metric": "structured_response",
        "user_reported_ms": 4000,
        "user_range_ms": [3000, 5000],
        "notes": "Markets sub-3s; failure bar defined as >4s; users report 3–5s lag",
    },
    "sensei": {
        "label": "Sensei AI",
        "claimed_ms": 1000,
        "claimed_metric": "hands_free_response",
        "user_reported_ms": 1200,
        "user_range_ms": [800, 2000],
        "notes": "Sub-1s claimed; generally faster than Cluely in reviews",
    },
    "preptail": {
        "label": "Preptail",
        "claimed_ms": 700,
        "claimed_metric": "time_to_first_token",
        "user_reported_ms": 700,
        "user_range_ms": [600, 900],
        "notes": "Self-reported ~700ms TTFT via Gemini Flash",
    },
    "copilot_interview": {
        "label": "CoPilot Interview",
        "claimed_ms": 4000,
        "claimed_metric": "full_answer",
        "user_reported_ms": 4000,
        "user_range_ms": [3000, 5000],
        "notes": "Openly markets ~4s; free OSS models 3–5s",
    },
    "interview_coder": {
        "label": "Interview Coder",
        "claimed_ms": 900,
        "claimed_metric": "coding_assist",
        "user_reported_ms": 900,
        "user_range_ms": [700, 1200],
        "notes": "Coding path; comparison tables cite ~900ms",
    },
}

# Market quality bars (what "good" means for each stage)
MARKET_BARS: dict[str, dict[str, Any]] = {
    "first_token_ms": {
        "excellent": 400,
        "good": 800,
        "acceptable": 1500,
        "poor": 3000,
        "label": "First usable text",
        "competitor_best_claimed": 300,
        "competitor_best_honest": 700,
    },
    "full_answer_ms": {
        "excellent": 1500,
        "good": 3000,
        "acceptable": 5000,
        "poor": 8000,
        "label": "Full structured answer",
        "competitor_best_claimed": 1000,
        "competitor_best_honest": 3000,
    },
    "stt_ms": {
        "excellent": 200,
        "good": 500,
        "acceptable": 1500,
        "poor": 2500,
        "label": "Speech-to-text",
        "competitor_best_claimed": 100,
        "competitor_best_honest": 400,
        "notes": "Streaming STT ~60–200ms; batch Whisper often 1–2s",
    },
    "total_ms": {
        "excellent": 1000,
        "good": 2500,
        "acceptable": 5000,
        "poor": 8000,
        "label": "STT + answer end-to-end",
        "competitor_best_claimed": 850,
        "competitor_best_honest": 3500,
    },
    "outline_ms": {
        "excellent": 5,
        "good": 50,
        "acceptable": 200,
        "poor": 500,
        "label": "Outline skeleton paint",
        "competitor_best_claimed": 1,
        "competitor_best_honest": 50,
    },
    "cache_ms": {
        "excellent": 1,
        "good": 5,
        "acceptable": 20,
        "poor": 100,
        "label": "Cache lookup",
        "competitor_best_claimed": 1,
        "competitor_best_honest": 5,
    },
}

_MAX_SAMPLES = int(os.environ.get("ASTRA_LATENCY_SAMPLES", "500") or "500")
_lock = threading.RLock()


def _grade(value: Optional[float], bars: dict[str, Any]) -> str:
    if value is None:
        return "n/a"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "n/a"
    if v <= float(bars["excellent"]):
        return "excellent"
    if v <= float(bars["good"]):
        return "good"
    if v <= float(bars["acceptable"]):
        return "acceptable"
    return "poor"


def _pct(sorted_vals: list[float], p: float) -> Optional[float]:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return round(sorted_vals[0], 2)
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return round(sorted_vals[f], 2)
    return round(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f), 2)


def _hist(values: list[float]) -> dict[str, Any]:
    if not values:
        return {
            "n": 0,
            "min": None,
            "avg": None,
            "p50": None,
            "p95": None,
            "p99": None,
            "max": None,
        }
    s = sorted(values)
    return {
        "n": len(s),
        "min": round(s[0], 2),
        "avg": round(statistics.fmean(s), 2),
        "p50": _pct(s, 50),
        "p95": _pct(s, 95),
        "p99": _pct(s, 99),
        "max": round(s[-1], 2),
    }


@dataclass
class StageTrace:
    """One answered question — full stage breakdown."""

    ts: float = field(default_factory=time.time)
    question: str = ""
    source: str = ""
    depth: str = "balanced"
    vad_ms: Optional[float] = None
    stt_ms: Optional[float] = None
    classify_ms: Optional[float] = None
    cache_ms: Optional[float] = None
    outline_ms: Optional[float] = None
    first_token_ms: Optional[float] = None
    full_answer_ms: Optional[float] = None
    total_ms: Optional[float] = None
    from_cache: bool = False
    outline_first: bool = False
    warm: bool = True
    words: int = 0
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["grades"] = {
            "first_token_ms": _grade(self.first_token_ms, MARKET_BARS["first_token_ms"]),
            "full_answer_ms": _grade(self.full_answer_ms, MARKET_BARS["full_answer_ms"]),
            "stt_ms": _grade(self.stt_ms, MARKET_BARS["stt_ms"]),
            "total_ms": _grade(self.total_ms, MARKET_BARS["total_ms"]),
        }
        return d


class LatencyRegistry:
    """Process-wide ring of stage traces + counters."""

    def __init__(self, maxlen: int = _MAX_SAMPLES) -> None:
        self._samples: deque[StageTrace] = deque(maxlen=max(50, maxlen))
        self._counters: dict[str, int] = {
            "answers": 0,
            "cache_hits": 0,
            "outline_paints": 0,
            "llm_streams": 0,
            "template_fallbacks": 0,
            "warmups": 0,
            "manual_injects": 0,
            "provider_failovers": 0,
        }
        self._session_id = ""
        self._session_started: Optional[float] = None
        self._last_warm_ms: Optional[float] = None

    def record(self, trace: StageTrace) -> StageTrace:
        with _lock:
            self._samples.append(trace)
            self._counters["answers"] = self._counters.get("answers", 0) + 1
            src = (trace.source or "").lower()
            if "cache" in src or trace.from_cache:
                self._counters["cache_hits"] = self._counters.get("cache_hits", 0) + 1
            if trace.outline_first or (trace.outline_ms is not None and trace.outline_ms > 0):
                self._counters["outline_paints"] = self._counters.get("outline_paints", 0) + 1
            if "llm" in src:
                self._counters["llm_streams"] = self._counters.get("llm_streams", 0) + 1
            if "template" in src:
                self._counters["template_fallbacks"] = (
                    self._counters.get("template_fallbacks", 0) + 1
                )
        return trace

    def incr(self, key: str, n: int = 1) -> None:
        with _lock:
            self._counters[key] = self._counters.get(key, 0) + n

    def mark_session_start(self, session_id: str = "") -> None:
        with _lock:
            self._session_id = session_id or f"sess_{int(time.time())}"
            self._session_started = time.time()

    def mark_warm(self, ms: float) -> None:
        with _lock:
            self._last_warm_ms = round(ms, 2)
            self._counters["warmups"] = self._counters.get("warmups", 0) + 1

    def recent(self, n: int = 20) -> list[dict[str, Any]]:
        with _lock:
            items = list(self._samples)[-max(1, n) :]
        return [t.to_dict() for t in reversed(items)]

    def snapshot(self) -> dict[str, Any]:
        with _lock:
            samples = list(self._samples)
            counters = dict(self._counters)
            session_id = self._session_id
            session_started = self._session_started
            last_warm = self._last_warm_ms

        def col(attr: str) -> list[float]:
            out: list[float] = []
            for s in samples:
                v = getattr(s, attr, None)
                if v is not None:
                    try:
                        out.append(float(v))
                    except (TypeError, ValueError):
                        pass
            return out

        stages = {
            "vad_ms": _hist(col("vad_ms")),
            "stt_ms": _hist(col("stt_ms")),
            "classify_ms": _hist(col("classify_ms")),
            "cache_ms": _hist(col("cache_ms")),
            "outline_ms": _hist(col("outline_ms")),
            "first_token_ms": _hist(col("first_token_ms")),
            "full_answer_ms": _hist(col("full_answer_ms")),
            "total_ms": _hist(col("total_ms")),
        }

        grades = {}
        for key, bars in MARKET_BARS.items():
            h = stages.get(key) or {}
            p50 = h.get("p50")
            grades[key] = {
                "p50": p50,
                "p95": h.get("p95"),
                "grade": _grade(p50, bars),
                "bars": {
                    "excellent": bars["excellent"],
                    "good": bars["good"],
                    "acceptable": bars["acceptable"],
                },
                "label": bars["label"],
            }

        comparison = self._compare_to_competitors(stages)
        verdict = self._verdict(grades, comparison)

        return {
            "ok": True,
            "session_id": session_id,
            "session_age_s": (
                round(time.time() - session_started, 1) if session_started else None
            ),
            "last_warm_ms": last_warm,
            "counters": counters,
            "stages": stages,
            "grades": grades,
            "market_bars": MARKET_BARS,
            "competitors": COMPETITOR_BENCHMARKS,
            "comparison": comparison,
            "verdict": verdict,
            "sample_count": len(samples),
            "recent": [t.to_dict() for t in samples[-10:]],
        }

    def _compare_to_competitors(self, stages: dict[str, Any]) -> list[dict[str, Any]]:
        """Compare our first_token / full answer p50 to each competitor bar."""
        our_ft = (stages.get("first_token_ms") or {}).get("p50")
        our_full = (stages.get("full_answer_ms") or {}).get("p50")
        rows: list[dict[str, Any]] = []
        for key, c in COMPETITOR_BENCHMARKS.items():
            claimed = c.get("claimed_ms")
            reported = c.get("user_reported_ms")
            # Prefer matching metric type
            metric = str(c.get("claimed_metric") or "")
            our = our_ft
            if metric in ("full_answer", "structured_response"):
                our = our_full if our_full is not None else our_ft
            elif metric in ("coding_assist",):
                our = our_ft
            beat_claimed = (
                our is not None and claimed is not None and float(our) <= float(claimed)
            )
            beat_reported = (
                our is not None
                and reported is not None
                and float(our) <= float(reported)
            )
            rows.append(
                {
                    "id": key,
                    "label": c["label"],
                    "their_claimed_ms": claimed,
                    "their_user_reported_ms": reported,
                    "our_p50_ms": our,
                    "beat_their_claim": beat_claimed,
                    "beat_their_real_world": beat_reported,
                    "delta_vs_reported_ms": (
                        round(float(our) - float(reported), 1)
                        if our is not None and reported is not None
                        else None
                    ),
                    "notes": c.get("notes"),
                }
            )
        # Sort: best relative (most negative delta = we are faster)
        rows.sort(
            key=lambda r: (
                r["delta_vs_reported_ms"]
                if r["delta_vs_reported_ms"] is not None
                else 99999
            )
        )
        return rows

    def _verdict(
        self, grades: dict[str, Any], comparison: list[dict[str, Any]]
    ) -> dict[str, Any]:
        ft = grades.get("first_token_ms") or {}
        full = grades.get("full_answer_ms") or {}
        stt = grades.get("stt_ms") or {}
        beat_real = sum(1 for c in comparison if c.get("beat_their_real_world"))
        total_c = len(comparison) or 1
        rank = "leading" if beat_real >= total_c * 0.7 else (
            "competitive" if beat_real >= total_c * 0.4 else "behind"
        )
        tips: list[str] = []
        if ft.get("grade") in ("poor", "acceptable"):
            tips.append(
                "First-token is slow — enable outline-first paint, warm LLM, prefer Groq/Flash"
            )
        if full.get("grade") in ("poor",):
            tips.append(
                "Full answers too slow — shorten max_tokens in fast depth, use outline scaffold"
            )
        if stt.get("grade") in ("poor", "acceptable"):
            tips.append(
                "STT is the bottleneck vs streaming competitors — consider Deepgram/streaming STT"
            )
        if not tips:
            tips.append("Latency stack is competitive on measured stages — keep streaming + cache warm")
        return {
            "rank_vs_market": rank,
            "beat_real_world_count": beat_real,
            "competitor_count": total_c,
            "first_token_grade": ft.get("grade"),
            "full_answer_grade": full.get("grade"),
            "stt_grade": stt.get("grade"),
            "tips": tips,
        }

    def reset(self) -> None:
        with _lock:
            self._samples.clear()
            for k in list(self._counters.keys()):
                self._counters[k] = 0
            self._session_id = ""
            self._session_started = None


_REGISTRY = LatencyRegistry()


def get_registry() -> LatencyRegistry:
    return _REGISTRY


def record_trace(**kwargs: Any) -> StageTrace:
    trace = StageTrace(**{k: v for k, v in kwargs.items() if k in StageTrace.__dataclass_fields__})
    return _REGISTRY.record(trace)


def snapshot() -> dict[str, Any]:
    return _REGISTRY.snapshot()


def competitor_table() -> dict[str, Any]:
    return {
        "competitors": COMPETITOR_BENCHMARKS,
        "market_bars": MARKET_BARS,
        "live": _REGISTRY.snapshot().get("comparison"),
        "verdict": _REGISTRY.snapshot().get("verdict"),
    }


class StageTimer:
    """Context helper: t0 = StageTimer(); …; ms = t0.ms()"""

    __slots__ = ("_t0",)

    def __init__(self) -> None:
        self._t0 = time.perf_counter()

    def ms(self) -> float:
        return round((time.perf_counter() - self._t0) * 1000, 2)

    def reset(self) -> None:
        self._t0 = time.perf_counter()
