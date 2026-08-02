#!/usr/bin/env python3
"""
Post-deploy latency smoke: run AI latency agent (quick, no STT by default).

Usage (from src/):
  venv\\Scripts\\python.exe scripts/post_deploy_latency.py
  venv\\Scripts\\python.exe scripts/post_deploy_latency.py --with-stt
  venv\\Scripts\\python.exe scripts/post_deploy_latency.py --api https://api.jobinterviewcracker.com

Writes: jd and resume/latency_ai_report.json (local) or prints remote JSON.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1]
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="", help="If set, POST remote /api/latency/ai-diagnose")
    p.add_argument("--with-stt", action="store_true")
    p.add_argument("--quick", action="store_true", default=True)
    args = p.parse_args()

    if args.api:
        import urllib.parse
        import urllib.request

        base = args.api.rstrip("/")
        q = urllib.parse.urlencode(
            {"quick": "true", "include_stt": "true" if args.with_stt else "false"}
        )
        url = f"{base}/api/latency/ai-diagnose?{q}"
        print(f"POST {url}", flush=True)
        req = urllib.request.Request(url, method="POST", data=b"")
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        print(body[:4000])
        return 0

    from latency_ai_agent import run_agent

    report = run_agent(quick=True, include_stt=bool(args.with_stt))
    out = SRC / "jd and resume" / "latency_ai_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    rec = report.get("recommendation") or {}
    print("invest_in:", rec.get("invest_in"))
    print("headline:", rec.get("headline"))
    print("wrote:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
