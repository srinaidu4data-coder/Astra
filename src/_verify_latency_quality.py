#!/usr/bin/env python3
"""Verify LLM provider, latency, and answer quality (no secrets printed)."""

from __future__ import annotations

import json
import sys
import time
import uuid
from pathlib import Path

# Ensure src is on path when run from anywhere
SRC = Path(__file__).resolve().parent
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def diagnose() -> dict:
    from config import (
        get_llm_provider,
        get_openai_api_key,
        get_openai_base_url,
        remap_model_for_provider,
    )
    from answer_engine import (
        ANSWER_MODEL,
        ANSWER_PROFILE,
        FALLBACK_MODEL,
        FAST_ANSWER_MODEL,
        FAST_FALLBACK_MODEL,
        generate_answer,
    )

    k = get_openai_api_key()
    info = {
        "provider": get_llm_provider(),
        "base_url": get_openai_base_url() or "https://api.openai.com/v1",
        "key_ok": bool(k),
        "key_len": len(k or ""),
        "key_prefix": (k or "")[:4],
        "is_groq_key": bool(k and k.startswith("gsk_")),
        "is_openai_key": bool(k and k.startswith("sk-")),
        "remap_gpt4o": remap_model_for_provider("gpt-4o"),
        "profile": ANSWER_PROFILE,
        "answer_model": ANSWER_MODEL,
        "fast_model": FAST_ANSWER_MODEL,
        "fallback": FALLBACK_MODEL,
        "fast_fallback": FAST_FALLBACK_MODEL,
    }
    return info


CASES = [
    ("short_behavioral", "Software Engineer", "What is your biggest strength?", "star"),
    (
        "ml_tech",
        "AI/ML Engineer",
        "What is the difference between precision and recall?",
        "technical",
    ),
    (
        "sap_tech",
        "SAP FICO Consultant",
        "What is the difference between FI and CO in SAP?",
        "technical",
    ),
    (
        "long_ml",
        "AI/ML Engineer",
        "Walk me through productionizing a ranking model including NDCG, hard negatives, A/B tests, p99 latency, and rollback.",
        "star",
    ),
]


def run_direct(uncached: bool = True) -> list[dict]:
    from answer_engine import generate_answer

    uid = str(uuid.uuid4())[:8] if uncached else ""
    rows = []
    for name, role, q, mode in CASES:
        question = f"{q} ref={uid}" if uncached else q
        t0 = time.perf_counter()
        answer = generate_answer(question, job_context=role, mode=mode, tone="confident")
        ms = round((time.perf_counter() - t0) * 1000)
        src = getattr(generate_answer, "last_source", None)
        words = len((answer or "").split())
        rows.append(
            {
                "name": name,
                "ms": ms,
                "source": src,
                "words": words,
                "answer": answer or "",
                "question": question,
                "role": role,
                "mode": mode,
            }
        )
        print(
            f"{name:16} {ms:>6}ms source={src} words={words}",
            flush=True,
        )
        preview = (answer or "").replace("\n", " ")[:160]
        print(f"  {preview}", flush=True)
    return rows


def quality_checks(rows: list[dict]) -> list[dict]:
    checks = []
    for r in rows:
        a = (r["answer"] or "").lower()
        words = r["words"]
        issues = []
        if words < 40:
            issues.append("too_short")
        if r["source"] not in ("llm", "llm_stream", "exact_cache"):
            issues.append(f"bad_source:{r['source']}")
        if r["name"] == "ml_tech":
            if "precision" not in a or "recall" not in a:
                issues.append("missing_precision_recall")
            if "false positive" not in a and "fp" not in a and "true positive" not in a:
                issues.append("weak_ml_definition")
        if r["name"] == "sap_tech":
            if "fi" not in a or "co" not in a:
                issues.append("missing_fi_co")
            # Generic SWE templates often say "ship" / "PR" — flag if no finance terms
            finance_hits = sum(
                1
                for t in (
                    "financial",
                    "controlling",
                    "ledger",
                    "cost center",
                    "gl",
                    "accounting",
                    "profit",
                )
                if t in a
            )
            if finance_hits < 1:
                issues.append("not_sap_specific")
        if r["name"] == "long_ml":
            for term in ("ndcg", "ab", "a/b", "latency", "rollback", "negative"):
                pass
            hits = sum(
                1
                for t in ("ndcg", "negative", "a/b", "ab test", "latency", "rollback")
                if t in a
            )
            if hits < 3:
                issues.append(f"missing_long_ml_terms hits={hits}")
        checks.append(
            {
                "name": r["name"],
                "ok": not issues,
                "issues": issues,
                "words": words,
                "ms": r["ms"],
                "source": r["source"],
            }
        )
    return checks


def main() -> int:
    print("=== DIAGNOSE ===", flush=True)
    info = diagnose()
    print(json.dumps(info, indent=2), flush=True)

    if not info["key_ok"]:
        print("FAIL: no usable API key", flush=True)
        return 2

    if info["provider"] != "groq":
        print(
            "\nNOTE: provider is NOT groq — still on OpenAI-compatible default path.",
            flush=True,
        )
        print(
            "To use Groq set GROQ_API_KEY=gsk_... and ASTRA_LLM_PROVIDER=groq",
            flush=True,
        )

    print("\n=== DIRECT generate_answer (uncached) ===", flush=True)
    rows = run_direct(uncached=True)
    checks = quality_checks(rows)

    ms_list = [r["ms"] for r in rows]
    print("\n=== LATENCY SUMMARY ===", flush=True)
    print(
        f"min={min(ms_list)} avg={round(sum(ms_list)/len(ms_list))} max={max(ms_list)} ms",
        flush=True,
    )
    print(f"sources={[r['source'] for r in rows]}", flush=True)

    print("\n=== QUALITY CHECKS ===", flush=True)
    for c in checks:
        status = "PASS" if c["ok"] else "FAIL"
        print(f"{c['name']:16} {status} issues={c['issues']}", flush=True)

    print("\n=== FULL ANSWERS ===", flush=True)
    for r in rows:
        print(f"\n--- {r['name']} ({r['ms']}ms, {r['source']}, {r['words']}w) ---")
        print(r["answer"])

    out = {
        "diagnose": info,
        "latency_ms": {
            "min": min(ms_list),
            "avg": round(sum(ms_list) / len(ms_list)),
            "max": max(ms_list),
            "per_case": {r["name"]: r["ms"] for r in rows},
        },
        "quality": checks,
        "answers": {
            r["name"]: {
                "source": r["source"],
                "words": r["words"],
                "ms": r["ms"],
                "answer": r["answer"],
            }
            for r in rows
        },
    }
    out_path = SRC / "_verify_latency_quality_result.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nWrote {out_path}", flush=True)

    # Fail if no real LLM or quality issues
    ok = all(c["ok"] for c in checks)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
