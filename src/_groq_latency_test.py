#!/usr/bin/env python3
"""Latency smoke test for Groq-backed /api/answer (no secrets written)."""

from __future__ import annotations

import json
import time
import urllib.request

BASE = "http://127.0.0.1:8787"


def get(path: str):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read().decode())


def post(path: str, body: dict, timeout: float = 60):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    client_ms = round((time.perf_counter() - t0) * 1000)
    return json.loads(raw.decode()), client_ms


def main() -> int:
    h = get("/api/health")
    print("=== HEALTH ===")
    print(
        f"provider={h.get('llm_provider')} base={h.get('llm_base_url')} "
        f"ready={h.get('openai_ready')} profile={h.get('answer_profile')}"
    )
    print(f"fast={h.get('fast_model')} fallback={h.get('fast_fallback')}")
    if not h.get("openai_ready") or h.get("llm_provider") != "groq":
        print("FAIL: API not on Groq")
        return 2

    cases = [
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

    print("\n=== HTTP /api/answer (2 runs each; report best full_ms) ===")
    rows = []
    for name, role, q, mode in cases:
        best = None
        last = None
        for _ in range(2):
            resp, client_ms = post(
                "/api/answer",
                {
                    "question": q,
                    "job_context": role,
                    "tone": "confident",
                    "mode": mode,
                },
            )
            last = resp
            row = {
                "client_ms": client_ms,
                "latency_ms": resp.get("latency_ms"),
                "first_paint_ms": resp.get("first_paint_ms"),
                "full_ms": resp.get("full_ms"),
                "source": resp.get("source"),
                "words": len((resp.get("answer") or "").split()),
            }
            if best is None or (row["full_ms"] or 9e9) < (best["full_ms"] or 9e9):
                best = row
        assert best and last
        rows.append((name, best, last))
        print(
            f"{name:16} full_ms={best['full_ms']!s:>6} "
            f"client_ms={best['client_ms']!s:>6} "
            f"first_paint={best['first_paint_ms']!s:>8} "
            f"source={best['source']} words={best['words']}"
        )
        print(" ", (last.get("answer") or "")[:130].replace("\n", " "))

    print("\n=== Direct generate_answer (same process as test client) ===")
    # Server-side models already set; local import uses same env if we set it
    from answer_engine import (
        ANSWER_PROFILE,
        FAST_ANSWER_MODEL,
        TECH_ACCURACY_MODEL,
        generate_answer,
    )

    print(
        f"profile={ANSWER_PROFILE} fast={FAST_ANSWER_MODEL} tech={TECH_ACCURACY_MODEL}"
    )
    direct = []
    for name, role, q, mode in cases[:3]:
        t0 = time.perf_counter()
        a = generate_answer(q, job_context=role, mode=mode)
        ms = round((time.perf_counter() - t0) * 1000)
        src = getattr(generate_answer, "last_source", None)
        direct.append(ms)
        print(f"{name:16} {ms:>5}ms source={src} words={len((a or '').split())}")

    fulls = [r[1]["full_ms"] for r in rows if r[1]["full_ms"] is not None]
    clients = [r[1]["client_ms"] for r in rows]
    sources = {r[1]["source"] for r in rows}

    print("\n=== SUMMARY ===")
    print(
        f"HTTP full_ms   min={min(fulls)} avg={round(sum(fulls)/len(fulls))} max={max(fulls)}"
    )
    print(
        f"HTTP client_ms min={min(clients)} avg={round(sum(clients)/len(clients))} max={max(clients)}"
    )
    if direct:
        print(
            f"Direct gen_ms  min={min(direct)} avg={round(sum(direct)/len(direct))} max={max(direct)}"
        )
    print(f"sources={sources}")
    ok = all(r[1]["source"] in ("llm", "llm_stream", "exact_cache") for r in rows)
    ok = ok and all((r[1]["words"] or 0) >= 40 for r in rows)
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def uncached_main() -> int:
    """Force unique questions so cache cannot hide real LLM latency."""
    import uuid

    uid = str(uuid.uuid4())[:8]
    qs = [
        ("fresh_se", "Software Engineer", f"What is your biggest weakness as an engineer? ref={uid}", "star"),
        (
            "fresh_ml",
            "AI/ML Engineer",
            f"Explain gradient descent and learning rate clearly. ref={uid}",
            "technical",
        ),
        (
            "fresh_sap",
            "SAP FICO Consultant",
            f"Explain document splitting in New GL briefly. ref={uid}",
            "technical",
        ),
    ]
    h = get("/api/health")
    print("provider", h.get("llm_provider"), "models", h.get("fast_model"), h.get("fast_fallback"))
    print("\n=== UNCACHED unique questions (true LLM latency) ===")
    fulls = []
    clients = []
    for name, role, q, mode in qs:
        resp, client_ms = post(
            "/api/answer",
            {"question": q, "job_context": role, "tone": "confident", "mode": mode},
        )
        full = resp.get("full_ms")
        fulls.append(full or client_ms)
        clients.append(client_ms)
        print(
            f"{name:10} full_ms={full!s:>6} client_ms={client_ms!s:>6} "
            f"first_paint={resp.get('first_paint_ms')} source={resp.get('source')} "
            f"words={len((resp.get('answer') or '').split())}"
        )
        print(" ", (resp.get("answer") or "")[:120].replace("\n", " "))
    print(
        f"\nUNCACHED full_ms min={min(fulls)} avg={round(sum(fulls)/len(fulls))} max={max(fulls)}"
    )
    print(
        f"UNCACHED client_ms min={min(clients)} avg={round(sum(clients)/len(clients))} max={max(clients)}"
    )
    return 0


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "uncached":
        raise SystemExit(uncached_main())
    raise SystemExit(main())
