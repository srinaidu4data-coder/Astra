"""
Process supervisor for Job Search API — Fortune-100 style process reliability.

Watches copilot_api (or any command), restarts on crash with exponential backoff,
writes a heartbeat file, and logs restart events.

Usage:
  python -m jobsearch.supervisor
  python -m jobsearch.supervisor --cmd "venv\\Scripts\\python.exe copilot_api.py"
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_supervisor(
    cmd: list[str],
    *,
    cwd: str | None = None,
    max_restarts: int = 100,
    base_backoff: float = 1.0,
    max_backoff: float = 30.0,
    heartbeat_path: str | None = None,
) -> int:
    restarts = 0
    backoff = base_backoff
    hb = Path(heartbeat_path) if heartbeat_path else None
    print(f"[{_utc()}] supervisor start: {' '.join(cmd)}", flush=True)
    print(f"[{_utc()}] cwd={cwd or os.getcwd()} max_restarts={max_restarts}", flush=True)

    while restarts <= max_restarts:
        if hb:
            try:
                hb.write_text(
                    f"status=starting\nrestarts={restarts}\nts={_utc()}\npid=\n",
                    encoding="utf-8",
                )
            except OSError:
                pass
        t0 = time.time()
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=cwd,
                env=os.environ.copy(),
            )
        except Exception as e:
            print(f"[{_utc()}] spawn failed: {e}", flush=True)
            restarts += 1
            time.sleep(min(backoff, max_backoff))
            backoff = min(backoff * 2, max_backoff)
            continue

        print(f"[{_utc()}] child pid={proc.pid} restarts={restarts}", flush=True)
        if hb:
            try:
                hb.write_text(
                    f"status=running\nrestarts={restarts}\nts={_utc()}\npid={proc.pid}\n",
                    encoding="utf-8",
                )
            except OSError:
                pass

        # Heartbeat loop while child alive
        while proc.poll() is None:
            if hb:
                try:
                    hb.write_text(
                        f"status=running\nrestarts={restarts}\nts={_utc()}\npid={proc.pid}\n"
                        f"uptime_sec={int(time.time() - t0)}\n",
                        encoding="utf-8",
                    )
                except OSError:
                    pass
            time.sleep(5)

        code = proc.returncode
        lived = time.time() - t0
        print(
            f"[{_utc()}] child exit code={code} lived={lived:.1f}s — restarting",
            flush=True,
        )
        if hb:
            try:
                hb.write_text(
                    f"status=restarting\nrestarts={restarts}\nts={_utc()}\n"
                    f"last_exit={code}\nlived_sec={lived:.1f}\n",
                    encoding="utf-8",
                )
            except OSError:
                pass

        # If process lived a while, reset backoff (stable run)
        if lived > 60:
            backoff = base_backoff
        restarts += 1
        if restarts > max_restarts:
            print(f"[{_utc()}] max restarts reached — giving up", flush=True)
            return code or 1
        time.sleep(min(backoff, max_backoff))
        backoff = min(backoff * 2, max_backoff)

    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Job Search API process supervisor")
    parser.add_argument(
        "--cmd",
        default="",
        help="Command string (shell=False split on spaces). Default: python copilot_api.py",
    )
    parser.add_argument(
        "--cwd",
        default="",
        help="Working directory (default: src/ next to package)",
    )
    parser.add_argument("--max-restarts", type=int, default=100)
    args = parser.parse_args(argv)

    src_dir = Path(__file__).resolve().parent.parent  # .../src
    cwd = args.cwd or str(src_dir)
    if args.cmd:
        cmd = args.cmd.split()
    else:
        # Prefer venv python if present
        venv_py = Path(cwd) / "venv" / "Scripts" / "python.exe"
        py = str(venv_py) if venv_py.exists() else sys.executable
        cmd = [py, "copilot_api.py"]

    hb = str(Path(cwd) / "jobsearch_supervisor.heartbeat")
    return run_supervisor(
        cmd,
        cwd=cwd,
        max_restarts=args.max_restarts,
        heartbeat_path=hb,
    )


if __name__ == "__main__":
    raise SystemExit(main())
