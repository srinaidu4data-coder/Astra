# Astra — Session Handoff (source of truth)

**Path:** `C:\Users\King2\Desktop\Astra`  
**Updated:** 2026-08-05

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
- API: Railway Docker (`Dockerfile` at repo root / `deploy/Dockerfile.api`)
- Guide: `docs/DEPLOY_CLOUDFLARE_RAILWAY.md`

## Core interview path

1. UI **Start interview** → WebSocket + speaker/tab audio (not mic by default)
2. STT: Deepgram Nova-3 if `DEEPGRAM_API_KEY`, else Whisper
3. `answer_engine.py` → stream / cascade answer
4. SpeakCanvas (`WhisperStream`) — punch lock, keys 1/2/3, copy sheet

## Important modules

| Module | Role |
|--------|------|
| `answer_engine.py` | Materials-grounded answers, one-word rule, normalize |
| `api_models.py` | HTTP request models (Answer, SessionContext, …) |
| `jd_grounding.py` | Lexicon from Role/Q/JD text; strip corporate filler |
| `common_sense.py` | Materials-only guardrails (no skill-domain packs) |
| `session_context.py` | Per-login Role / JD / Resume pack + JWT session id |
| `fast_answer.py` | Cache / outline / templates |
| `deepgram_stt.py` / `transcriber.py` | STT |
| `latency_metrics.py` / `latency_ai_agent.py` | Latency ops |
| `backend/*` | Auth, billing, mock interview |

## Per-interview identity (materials only)

- Answers use **only**: question + Role + Job Context + attached JD + attached Resume
- **No** skill-domain packs (ATTP/FICO/BRIM/ML tables removed)
- **No** ambient disk practice JD in multi-tenant prod (`ASTRA_PRACTICE_JD=0`)
- **No** RAG by default (`ASTRA_USE_RAG=1` to opt in)
- HTTP pack scoped by JWT user; WS uses same JWT so materials match
- Login/logout + Start interview clear answer cache; `POST /api/session/reset` full wipe

## LLM provider rule

**Provider must match model family:**

- `ASTRA_LLM_PROVIDER=openai` → `gpt-4o-mini` / `gpt-4o` (not Llama IDs)
- `ASTRA_LLM_PROVIDER=groq` → `llama-3.3-70b-versatile` + `GROQ_API_KEY`

Mismatch causes remaps, failovers, and multi-second TTFT.

## Tests

```bat
cd src
venv\Scripts\python.exe -m pytest tests -q
```

Golden / materials: `tests/test_jd_golden.py`, `tests/test_materials_only.py`, `tests/test_common_sense.py`

## Legacy (not primary)

- `gui.py` — older Windows desktop copilot (Stereo Mix)
- `career-ops/` — separate toolkit
- Job search lab pages — localhost apply experiments
- `generate_*_audio.py` — offline practice interview audio only

## License

`config.LICENSE_ENABLED` may be off for direct API keys; see `config.py`.
