#!/usr/bin/env python3
"""Hit copilot API SSE and print STT + answers."""
import json
import urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:8787/api/run-test-audio",
    data=json.dumps(
        {
            "max_questions": 2,
            "job_context": "AI/ML Engineer",
            "tone": "confident",
        }
    ).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(req, timeout=300) as resp:
    buf = ""
    while True:
        chunk = resp.read(256)
        if not chunk:
            break
        buf += chunk.decode("utf-8", errors="replace")
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            ev, data = "message", ""
            for line in block.splitlines():
                if line.startswith("event:"):
                    ev = line[6:].strip()
                if line.startswith("data:"):
                    data = line[5:].strip()
            if not data:
                continue
            try:
                payload = json.loads(data)
            except Exception:
                payload = {"raw": data}
            if ev == "transcript":
                print(
                    f"TRANSCRIPT[{payload.get('index')}]: "
                    f"{payload.get('text')!r} ({payload.get('stt_ms')}ms)"
                )
            elif ev == "answer_done":
                ans = (payload.get("answer") or "")[:180].replace("\n", " ")
                print(
                    f"ANSWER[{payload.get('index')}]: "
                    f"STT={payload.get('stt_ms')}ms ANS={payload.get('answer_ms')}ms"
                )
                print(f"  Q: {payload.get('question')}")
                print(f"  A: {ans}...")
            elif ev in ("status", "complete", "error"):
                print(f"{ev.upper()}: {payload}")

print("DONE")
