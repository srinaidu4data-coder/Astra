#!/usr/bin/env python3
"""
CI performance + grounding gates (deterministic mock provider).

Fails when:
  - first_useful p95 > 800 ms (mock cascade; Stage A must be near-instant)
  - full answer p95 > 2500 ms (mock)
  - unsupported fabrication fragments appear
  - error rate > 0.5%
  - evidence grounding unit tests fail

Usage:
  cd src
  python scripts/ci_latency_gates.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    # 1) Unit tests
    r = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "tests/test_evidence_grounding.py",
            "tests/test_turn_state.py",
            "tests/test_latency_stack.py",
            "-q",
            "--tb=line",
        ],
        cwd=str(ROOT),
    )
    if r.returncode != 0:
        print("GATE FAIL: unit tests")
        return r.returncode

    # 2) Mock benchmark
    out = ROOT / "_ci_latency_gate.json"
    r2 = subprocess.run(
        [
            sys.executable,
            "scripts/latency_grounding_benchmark.py",
            "--limit",
            "40",
            "--out",
            str(out),
        ],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if r2.returncode != 0:
        print(r2.stdout)
        print(r2.stderr)
        print("GATE FAIL: benchmark process")
        return r2.returncode

    report = json.loads(out.read_text(encoding="utf-8"))
    stages = report.get("stages") or {}
    fu = (stages.get("first_useful_ms") or {}).get("p95")
    full = (stages.get("full_answer_ms") or {}).get("p95")
    fails = int(report.get("failures") or 0)
    unsupported = int(report.get("unsupported_claim_events") or 0)
    n = int(report.get("n_rows") or 1)
    err_rate = fails / max(1, n)

    print(json.dumps({
        "first_useful_p95_ms": fu,
        "full_answer_p95_ms": full,
        "failures": fails,
        "error_rate": err_rate,
        "unsupported_claim_events": unsupported,
        "gates": report.get("gates"),
    }, indent=2))

    ok = True
    if fu is None or float(fu) > 800:
        print(f"GATE FAIL: first_useful p95={fu} > 800")
        ok = False
    if full is None or float(full) > 2500:
        print(f"GATE FAIL: full_answer p95={full} > 2500")
        ok = False
    if unsupported > 0:
        print(f"GATE FAIL: unsupported claims={unsupported}")
        ok = False
    if err_rate > 0.005:
        print(f"GATE FAIL: error_rate={err_rate}")
        ok = False

    if ok:
        print("ALL CI LATENCY/GROUNDING GATES PASSED")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
