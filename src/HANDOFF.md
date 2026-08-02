# Astra — Session Handoff (source of truth)

**Path:** `C:\Users\King2\Desktop\Astra`  
**Updated:** 2026-08-02

## Product (what to run)

**Primary product = React UI + FastAPI copilot API** (not the old Tk GUI).

| Surface | Path | URL |
|---------|------|-----|
| UI | `interview-pulse-ai/` | Local `http://127.0.0.1:5173` · Prod `https://jobinterviewcracker.com` |
| API | `src/copilot_api.py` | Local `http://127.0.0.1:8787` · Prod `https://api.jobinterviewcracker.com` |
| Live WS | same API | `ws(s)://…/ws/interview` |

### Local start

```bat
cd src
start_copilot_api.bat
```

```bat
cd interview-pulse-ai
npm run dev -- --host 127.0.0.1 --port 5173
```

### Production

- UI: Cloudflare Pages (root `interview-pulse-ai`, build `npm ci && npm run build` → `dist`)
- API: Railway Docker (`deploy/Dockerfile.api`)
- Guide: `docs/DEPLOY_CLOUDFLARE_RAILWAY.md`

## Core interview path

1. UI **Start interview** → WebSocket + speaker/tab audio (not mic by default)
2. STT: Deepgram Nova-3 if `DEEPGRAM_API_KEY`, else Whisper
3. `answer_engine.py` → stream answer
4. SpeakCanvas (`WhisperStream`) — punch lock, keys 1/2/3, copy sheet

## Important modules

| Module | Role |
|--------|------|
| `answer_engine.py` | JD-aware answers, one-word rule, normalize |
| `jd_grounding.py` | Load `jd and resume/`, lexicon, strip off-domain buzz |
| `common_sense.py` | Cross-domain lock |
| `session_context.py` | Pre-session role/JD/resume pack |
| `fast_answer.py` | Cache / outline / templates |
| `deepgram_stt.py` / `transcriber.py` | STT |
| `latency_metrics.py` / `latency_ai_agent.py` | Latency ops |
| `backend/*` | Auth, billing, mock interview |

## JD grounding

- Files: `src/jd and resume/jd.txt` + resume PDF
- API startup bootstraps pack → role **SAP ATTP Techno-Functional Consultant**
- UI Copilot page pulls pack role into Job context when empty
- Health: `GET /api/health` → `jd_grounding` object

## LLM provider rule

**Provider must match model family:**

- `ASTRA_LLM_PROVIDER=openai` → `gpt-4o-mini` / `gpt-4o` (not Llama IDs)
- `ASTRA_LLM_PROVIDER=groq` → `llama-3.3-70b-versatile` + `GROQ_API_KEY`

Mismatch causes remaps, failovers, and multi-second TTFT.

## Post-deploy latency

```bat
cd src
venv\Scripts\python.exe scripts\post_deploy_latency.py
venv\Scripts\python.exe scripts\post_deploy_latency.py --api https://api.jobinterviewcracker.com
```

## Tests

```bat
cd src
venv\Scripts\python.exe -m pytest tests -q
```

Golden JD: `tests/test_jd_golden.py`

## Legacy (not primary)

- `gui.py` — older Windows desktop copilot (Stereo Mix)
- `career-ops/` — separate toolkit (gitignored nested clone)
- Job search lab pages — localhost apply experiments

## License

`config.LICENSE_ENABLED` may be off for direct API keys; see `config.py`.
