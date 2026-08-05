# Astra / InterviewPulse AI

**Primary product:** live interview copilot for [jobinterviewcracker.com](https://jobinterviewcracker.com)  
**Source of truth:** React UI + FastAPI API (not the legacy Tk GUI).

| Path | What |
|------|------|
| `interview-pulse-ai/` | React UI (Vite + TypeScript + Tailwind) — SpeakCanvas, Copilot, auth |
| `src/` | FastAPI copilot API: STT, answers, WebSocket, JD grounding, auth/billing |
| `src/jd and resume/` | Optional local practice JD/resume only (`ASTRA_PRACTICE_JD=1`); prod uses per-login Role + attached JD/Resume |
| `career-ops/` | Separate toolkit (not required for live interviews; often gitignored) |

## Quick start

**1. Backend** (keep this window open)

```bat
cd src
start_copilot_api.bat
```

→ http://127.0.0.1:8787 · ws://127.0.0.1:8787/ws/interview

**2. UI**

```bat
cd interview-pulse-ai
npm install
npm run dev
```

→ http://localhost:5173 → **Start interview**

## Live path

1. UI connects over WebSocket  
2. Backend captures system audio (Stereo Mix)  
3. VAD → Whisper → filter chatter → speakable answer  
4. Answers show in **Your answer** (step with Next)

## Notes

- API key: `src/.env` → `OPENAI_API_KEY=...`  
- Practice WAV: `src/test_audio/ai_ml_interview_20q.wav`  
- Desktop overlay: `cd interview-pulse-ai && npm run dev:electron`  
- **Your answer** panel is the large right-hand reading surface on Copilot (wide column, tall scroll).  
- Practice **Dictate** uses mic → backend Whisper (`POST /api/transcribe`), not browser speech-only.

## Production deploy (jobinterviewcracker.com)

**Best combo:** Cloudflare Pages (UI) + Railway (API) + Cloudflare DNS.

Full guide: [`docs/DEPLOY_CLOUDFLARE_RAILWAY.md`](docs/DEPLOY_CLOUDFLARE_RAILWAY.md)

```
https://jobinterviewcracker.com     → Cloudflare Pages
https://api.jobinterviewcracker.com → Railway (Docker: deploy/Dockerfile.api)
```

## Google sign-in (this stack)

**React (Vite) + Python FastAPI** — server-side Google OAuth is already built.  
Do **not** add NextAuth, Passport, or GIS unless you rewrite auth.

| | Local | Production (`jobinterviewcracker.com`) |
|--|--------|----------------------------------------|
| UI | `http://localhost:5173` | `https://jobinterviewcracker.com` |
| API | `http://127.0.0.1:8787` | `https://api.jobinterviewcracker.com` |
| Redirect URI | `…8787/v1/auth/google/callback` | `https://api.jobinterviewcracker.com/v1/auth/google/callback` |

- Code: `src/backend/google_oauth.py`  
- Env templates: `src/.env.example` (local), `src/.env.production.example` (live)  
- **Full domain checklist:** [`docs/GOOGLE_SIGNIN_JOBINTERVIEWCRACKER.md`](docs/GOOGLE_SIGNIN_JOBINTERVIEWCRACKER.md)

Gate order: **Google (or email/password) → welcome email → Stripe (if configured) → app**.  
Local: set `AUTH_REQUIRED=false` or `AUTH_DEV_BYPASS=true` to skip the login screen while testing.

See `interview-pulse-ai/HANDOFF.md` and `src/HANDOFF.md` for detail.
