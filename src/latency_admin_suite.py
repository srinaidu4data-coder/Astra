#!/usr/bin/env python3
"""
Admin holistic latency suite — single-shot view of pipeline stages.

Runs a fixed sample question bank through the same cascade as live Interview
(typed inject path), optional STT probe, warm, and health. Returns per-question
rows + aggregate p50/p95 for first useful, full answer, STT, classify, etc.
"""

from __future__ import annotations

import io
import statistics
import time
import wave
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Sample questions (typed path) — mirrors production kit cases
# ---------------------------------------------------------------------------

SAMPLE_QUESTIONS: list[dict[str, str]] = [
    {
        "id": "fico_month_end",
        "cat": "sap_fico",
        "q": (
            "Tell me about a time you improved a difficult month-end close process "
            "and how you measured the result."
        ),
    },
    {
        "id": "behavioral_fail",
        "cat": "behavioral",
        "q": "Tell me about a time you failed and what you learned.",
    },
    {
        "id": "recruiter_self",
        "cat": "recruiter",
        "q": "Tell me about yourself.",
    },
    {
        "id": "technical_s4",
        "cat": "sap_fico",
        "q": "How do you configure asset accounting in S/4HANA Finance?",
    },
    {
        "id": "leadership",
        "cat": "leadership",
        "q": "Describe a time you led without formal authority.",
    },
    {
        "id": "system_design",
        "cat": "system_design",
        "q": "How would you design a multi-entity month-end close control tower?",
    },
    {
        "id": "ambiguous",
        "cat": "ambiguous",
        "q": "How would you improve things here?",
    },
    {
        "id": "no_evidence",
        "cat": "no_evidence",
        "q": "Tell me about a time you managed a team of fifty engineers.",
    },
    {
        "id": "conflict",
        "cat": "conflict",
        "q": "A stakeholder disagrees with your close design. What do you do?",
    },
    {
        "id": "long_multipart",
        "cat": "long",
        "q": (
            "Walk me through cutover and hypercare for Finance go-live: "
            "what you freeze, who you talk to, and how you measure recovery."
        ),
    },
]


def _pct(vals: list[float], p: float) -> Optional[float]:
    if not vals:
        return None
    s = sorted(vals)
    if len(s) == 1:
        return round(s[0], 2)
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return round(s[f], 2)
    return round(s[f] + (s[c] - s[f]) * (k - f), 2)


def _hist(vals: list[float]) -> dict[str, Any]:
    if not vals:
        return {"n": 0, "p50": None, "p95": None, "avg": None, "min": None, "max": None}
    return {
        "n": len(vals),
        "p50": _pct(vals, 50),
        "p75": _pct(vals, 75),
        "p90": _pct(vals, 90),
        "p95": _pct(vals, 95),
        "p99": _pct(vals, 99),
        "avg": round(statistics.fmean(vals), 2),
        "min": round(min(vals), 2),
        "max": round(max(vals), 2),
    }


def _grade_ms(value: Optional[float], good: float, ok: float) -> str:
    if value is None:
        return "n/a"
    if value <= good:
        return "excellent"
    if value <= ok:
        return "good"
    if value <= ok * 2:
        return "acceptable"
    return "poor"


def _make_silence_wav(seconds: float = 0.6, sr: int = 16000) -> bytes:
    """Tiny silent WAV for STT transport/latency probe (not speech accuracy)."""
    n = max(1, int(sr * seconds))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * n)
    return buf.getvalue()


def _find_test_audio() -> Optional[Path]:
    root = Path(__file__).resolve().parent
    candidates = [
        root / "test_audio" / "ai_ml_interview_20q.wav",
        root / "test_audio" / "sap_fico_vertex_interview_20q.mp3",
        root / "jd and resume" / "sri_naidu_resume_interview_natural.wav",
    ]
    for p in candidates:
        if p.exists() and p.stat().st_size > 1000:
            return p
    return None


def run_admin_latency_suite(
    *,
    modes: Optional[list[str]] = None,
    depths: Optional[list[str]] = None,
    max_questions: int = 8,
    include_stt: bool = True,
    include_llm: bool = True,
    warm_first: bool = True,
    role: str = "Senior SAP FICO Consultant",
    resume_text: str = "",
    job_description: str = "",
    session_id: str = "admin_latency_suite",
) -> dict[str, Any]:
    """
    Execute holistic suite. Safe to call from admin HTTP handler.

    When include_llm is False, cascade still runs Stage A (evidence/template)
    via a no-op streamer that raises so Stage A / draft path is measured only.
    """
    from answer_engine import iter_answer_tokens
    from fast_answer import iter_cascade_answer
    from session_context import clear_pack, session_scope, update_pack

    modes = [m.strip().lower() for m in (modes or ["shorter", "star"]) if m.strip()]
    depths = [d.strip().lower() for d in (depths or ["fast", "balanced"]) if d.strip()]
    if not modes:
        modes = ["shorter"]
    if not depths:
        depths = ["fast"]

    questions = SAMPLE_QUESTIONS[: max(1, min(24, max_questions))]
    t_suite = time.perf_counter()

    report: dict[str, Any] = {
        "ok": True,
        "suite": "admin_holistic_latency",
        "started_at": time.time(),
        "config": {
            "modes": modes,
            "depths": depths,
            "max_questions": len(questions),
            "include_stt": include_stt,
            "include_llm": include_llm,
            "warm_first": warm_first,
            "role": role[:80],
        },
        "health": None,
        "warm": None,
        "stt": None,
        "rows": [],
        "aggregates": {},
        "verdict": {},
        "targets": {
            "typed_first_useful_p95_ms": 800,
            "typed_shorter_full_p95_ms": 2500,
            "typed_star_full_p95_ms": 3500,
            "stt_ms_good": 500,
            "health_rtt_ms_good": 200,
        },
    }

    # --- Health ---
    t_h = time.perf_counter()
    try:
        from config import get_openai_api_key

        dg = None
        try:
            from deepgram_stt import deepgram_status

            dg = deepgram_status()
        except Exception:
            dg = None
        report["health"] = {
            "ok": True,
            "openai_key": bool(get_openai_api_key()),
            "deepgram": dg,
            "rtt_ms": round((time.perf_counter() - t_h) * 1000, 2),
        }
    except Exception as e:
        try:
            from config import get_openai_api_key

            openai_ok = bool(get_openai_api_key())
        except Exception:
            openai_ok = False
        report["health"] = {
            "ok": openai_ok,
            "openai_key": openai_ok,
            "error": f"{type(e).__name__}: {e}",
            "rtt_ms": round((time.perf_counter() - t_h) * 1000, 2),
        }

    # --- Warm ---
    if warm_first:
        t_w = time.perf_counter()
        warm_info: dict[str, Any] = {"ok": False}
        try:
            from answer_engine import warm_llm_connection

            warm_llm_connection()
            warm_info["llm"] = True
        except Exception as e:
            warm_info["llm_error"] = f"{type(e).__name__}: {e}"
        try:
            from transcriber import get_whisper_model

            get_whisper_model()
            warm_info["whisper"] = True
        except Exception as e:
            warm_info["whisper_error"] = f"{type(e).__name__}: {e}"
        warm_info["ok"] = bool(warm_info.get("llm") or warm_info.get("whisper"))
        warm_info["ms"] = round((time.perf_counter() - t_w) * 1000, 2)
        report["warm"] = warm_info

    # --- STT probe ---
    if include_stt:
        stt_row: dict[str, Any] = {"ok": False}
        t_stt = time.perf_counter()
        try:
            import numpy as np
            from transcriber import transcribe_best

            audio_path = _find_test_audio()
            clip: Optional[Any] = None
            path_label = "synthetic_silence"
            if audio_path is not None and audio_path.suffix.lower() == ".wav":
                try:
                    with wave.open(str(audio_path), "rb") as w:
                        sr = w.getframerate()
                        n = min(w.getnframes(), int(sr * 2))
                        raw = w.readframes(n)
                        arr = np.frombuffer(raw, dtype=np.int16)
                        if w.getnchannels() > 1:
                            arr = arr.reshape(-1, w.getnchannels())[:, 0]
                        if sr != 16000 and sr > 0:
                            step = max(1, int(round(sr / 16000)))
                            arr = arr[::step]
                        clip = arr
                        path_label = audio_path.name
                except Exception:
                    clip = None
            if clip is None:
                # Silence probe — STT stack overhead (not speech accuracy)
                clip = np.zeros(8000, dtype=np.int16)
                path_label = "synthetic_silence"

            prefer = "auto" if path_label != "synthetic_silence" else "whisper"
            text, meta = transcribe_best(clip, prefer=prefer)
            stt_row = {
                "ok": True,
                "path": path_label,
                "note": (
                    None
                    if path_label != "synthetic_silence"
                    else "Silence probe — measures STT stack overhead only"
                ),
                "text_preview": (text or "")[:120],
                "provider": (meta or {}).get("provider") or prefer,
                "model": (meta or {}).get("model"),
                "stt_ms": (meta or {}).get("ms")
                or round((time.perf_counter() - t_stt) * 1000, 2),
                "wall_ms": round((time.perf_counter() - t_stt) * 1000, 2),
            }
        except Exception as e:
            stt_row = {
                "ok": False,
                "error": f"{type(e).__name__}: {e}",
                "wall_ms": round((time.perf_counter() - t_stt) * 1000, 2),
            }
        report["stt"] = stt_row

    # --- Typed cascade rows ---
    first_useful_all: list[float] = []
    full_all: list[float] = []
    full_shorter: list[float] = []
    full_star: list[float] = []
    llm_first_all: list[float] = []
    evidence_all: list[float] = []
    failures = 0
    grounding_hits = 0
    grounding_checks = 0

    def boom_streamer(*_args, **_kwargs):
        """No LLM tokens — Stage A / draft path only when include_llm=False."""
        yield from ()

    with session_scope(session_id):
        clear_pack()
        update_pack(
            role=role,
            resume_text=resume_text
            or (
                "Senior SAP FICO Consultant with 8 years experience. "
                "Improved month-end close time by 30% through reconciliation "
                "standardization and automation."
            ),
            job_description=job_description
            or "SAP FICO consultant for S/4HANA Finance close processes.",
            outline_first=True,
        )

        for item in questions:
            for mode in modes:
                for depth in depths:
                    update_pack(depth=depth)
                    row: dict[str, Any] = {
                        "id": item["id"],
                        "cat": item["cat"],
                        "question": item["q"][:160],
                        "mode": mode,
                        "depth": depth,
                    }
                    t0 = time.perf_counter()
                    try:
                        streamer = iter_answer_tokens if include_llm else boom_streamer
                        first_useful = None
                        first_paint = None
                        llm_first = None
                        source = ""
                        answer_mode = ""
                        final_text = ""
                        stages: dict[str, Any] = {}
                        for text, meta in iter_cascade_answer(
                            item["q"],
                            job_context=role,
                            mode=mode,
                            tone="confident",
                            llm_streamer=streamer,
                        ):
                            final_text = text or final_text
                            source = str(meta.get("source") or source)
                            if meta.get("first_useful_ms") is not None and first_useful is None:
                                first_useful = float(meta["first_useful_ms"])
                            if meta.get("first_paint_ms") is not None and first_paint is None:
                                first_paint = float(meta["first_paint_ms"])
                            if meta.get("llm_first_token_ms") is not None:
                                llm_first = float(meta["llm_first_token_ms"])
                            if meta.get("answer_mode"):
                                answer_mode = str(meta["answer_mode"])
                            if meta.get("stages"):
                                stages = dict(meta["stages"])
                            if meta.get("final"):
                                break

                        wall = round((time.perf_counter() - t0) * 1000, 2)
                        fu = first_useful if first_useful is not None else first_paint or wall
                        full = float(stages.get("full_answer_ms") or wall)

                        row.update(
                            {
                                "ok": True,
                                "source": source,
                                "answer_mode": answer_mode,
                                "first_paint_ms": first_paint,
                                "first_useful_ms": fu,
                                "llm_first_token_ms": llm_first,
                                "full_ms": full,
                                "wall_ms": wall,
                                "evidence_ms": stages.get("evidence_ms"),
                                "cache_ms": stages.get("cache_ms"),
                                "words": len((final_text or "").split()),
                                "answer_preview": (final_text or "")[:180],
                                "stages": {
                                    k: stages.get(k)
                                    for k in (
                                        "evidence_ms",
                                        "cache_ms",
                                        "stage_a_ms",
                                        "first_useful_ms",
                                        "llm_first_token_ms",
                                        "full_answer_ms",
                                        "grounding_violations",
                                    )
                                    if k in stages
                                },
                            }
                        )

                        # Grounding check for the month-end case
                        if item["id"] == "fico_month_end":
                            grounding_checks += 1
                            low = (final_text or "").lower()
                            bad = (
                                "10 days" in low
                                or "7 days" in low
                                or "40%" in low
                                or "training session" in low
                            )
                            good = "30%" in (final_text or "") or "30 %" in (final_text or "")
                            row["grounding"] = {
                                "has_30pct": good,
                                "has_forbidden": bad,
                                "pass": good and not bad,
                            }
                            if row["grounding"]["pass"]:
                                grounding_hits += 1

                        first_useful_all.append(float(fu))
                        full_all.append(float(full))
                        if mode == "shorter":
                            full_shorter.append(float(full))
                        if mode == "star":
                            full_star.append(float(full))
                        if llm_first is not None:
                            llm_first_all.append(float(llm_first))
                        if stages.get("evidence_ms") is not None:
                            evidence_all.append(float(stages["evidence_ms"]))
                    except Exception as e:
                        failures += 1
                        row.update(
                            {
                                "ok": False,
                                "error": f"{type(e).__name__}: {e}",
                                "wall_ms": round((time.perf_counter() - t0) * 1000, 2),
                            }
                        )
                    report["rows"].append(row)

        clear_pack()

    aggregates = {
        "first_useful_ms": _hist(first_useful_all),
        "full_answer_ms": _hist(full_all),
        "full_shorter_ms": _hist(full_shorter),
        "full_star_ms": _hist(full_star),
        "llm_first_token_ms": _hist(llm_first_all),
        "evidence_ms": _hist(evidence_all),
        "stt_ms": _hist(
            [float(report["stt"]["stt_ms"])]
            if report.get("stt") and report["stt"].get("stt_ms") is not None
            else []
        ),
        "failures": failures,
        "n_rows": len(report["rows"]),
        "grounding_pass_rate": (
            round(grounding_hits / grounding_checks, 3) if grounding_checks else None
        ),
    }
    report["aggregates"] = aggregates

    fu_p95 = (aggregates["first_useful_ms"] or {}).get("p95")
    sh_p95 = (aggregates["full_shorter_ms"] or {}).get("p95")
    star_p95 = (aggregates["full_star_ms"] or {}).get("p95")
    stt_ms = (report.get("stt") or {}).get("stt_ms")

    gates = {
        "first_useful_p95_lt_800": fu_p95 is not None and float(fu_p95) < 800,
        "shorter_full_p95_lt_2500": sh_p95 is None or float(sh_p95) < 2500,
        "star_full_p95_lt_3500": star_p95 is None or float(star_p95) < 3500,
        "failures_zero": failures == 0,
        "grounding_ok": aggregates["grounding_pass_rate"] is None
        or aggregates["grounding_pass_rate"] >= 1.0,
    }
    report["gates"] = gates
    report["verdict"] = {
        "pass": all(gates.values()),
        "grades": {
            "first_useful": _grade_ms(fu_p95, 400, 800),
            "shorter_full": _grade_ms(sh_p95, 1500, 2500),
            "star_full": _grade_ms(star_p95, 2500, 3500),
            "stt": _grade_ms(
                float(stt_ms) if stt_ms is not None else None, 300, 800
            ),
        },
        "summary": (
            "PASS — stages within targets"
            if all(gates.values())
            else "REVIEW — one or more gates failed (see gates object)"
        ),
    }
    report["suite_ms"] = round((time.perf_counter() - t_suite) * 1000, 2)
    report["ok"] = True
    return report
