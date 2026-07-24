# InterviewPulse AI — Handoff

**Path:** `C:\Users\montg\OneDrive\Desktop\Astra\interview-pulse-ai`  
**Related legacy:** `../src` (Astra Python/PyQt copilot)

## Run (LIVE interview copilot)

**Terminal 1 — Python API (system audio + Whisper + OpenAI):**
```bat
cd C:\Users\montg\OneDrive\Desktop\Astra\src
venv\Scripts\python.exe copilot_api.py
```
- HTTP: http://127.0.0.1:8787  
- Live WS: `ws://127.0.0.1:8787/ws/interview`

**Terminal 2 — UI:**
```bat
cd C:\Users\montg\OneDrive\Desktop\Astra\interview-pulse-ai
npm run dev
```
Browser: http://localhost:5173 → **Start interview** (stays ON)

### Live path
1. UI opens WebSocket  
2. Backend captures **Stereo Mix** (what you hear)  
3. Adaptive VAD → Whisper STT on each utterance  
4. Classifies chatter vs question  
5. Only questions get a speakable answer pushed to the UI  

Core modules: `live_session.py`, `copilot_api.py` (`/ws/interview`), UI `services/live-interview.ts`

Electron (overlay IPC + content protection):

```bat
npm run dev:electron
```

Overlay hotkey: **Ctrl+Shift+S**

## What shipped (phases 1–4)

| Phase | Status | Notes |
|-------|--------|--------|
| 1 Setup & layout | Done | Vite/React/TS/Tailwind, sidebar, top bar, glass dark UI |
| 2 Knowledge Vault | Done | PDF/DOCX/MD parse, STAR memories, JD matcher |
| 3 Stealth overlay | Done | Electron overlay, opacity, click-through, content protection |
| 4 Practice + Analytics | Done | Personas, live meters, Recharts hub, session reports |

## Architecture map

- `electron/main.cjs` — main window + transparent overlay + IPC
- `electron/preload.cjs` — `window.interviewPulse` bridge
- `src/pages/*` — Copilot, Knowledge, Practice, Analytics, Settings, Overlay
- `src/services/pipeline.ts` — demo &lt;850ms VAD→STT→RAG→stream LLM
- `src/services/parser.ts` — resume parse + memory ranking
- `src/services/audio.ts` — devices, waveform, energy VAD
- `src/stores/app-store.ts` — Zustand + localStorage persist

## Demo mode

Default **ON** in Settings. No API keys required. Simulated pipeline streams STAR answers from ranked resume memories.

## Mock interview (Final Round–style)

Sidebar **Mock** → `PracticePage`.

Flow: setup (role/JD/persona/difficulty/focus/timer) → timed Qs → score → optional follow-up → debrief report.

API on `:8787`:
- `POST /v1/mock/start` — generate question set (OpenAI or offline bank)
- `POST /v1/mock/score` — STAR/depth/comm scores + model bullets + follow-up
- `POST /v1/mock/report` — session grade + practice plan
- `GET /v1/mock/personas`

Bells: mic dictation (Chrome), live filler estimate, copy report, Analytics session table (grade/overall).

## Auth + billing (before public signup)

**Order:** Google sign-in → welcome email (Gmail SMTP) → Stripe monthly → app unlock.

### Which Google integration?

| Approach | Use here? |
|----------|-----------|
| Next.js Auth.js / NextAuth | **No** — not a Next app |
| Passport / Express | **No** — backend is FastAPI |
| django-allauth / Authlib | **No** — not Django/Flask; OAuth is hand-rolled |
| Google Identity Services (GIS / gsi/client ID token) | **No** — not the current flow |
| **FastAPI server-side OAuth code exchange** | **Yes — already implemented** |

Implementation: `../src/backend/google_oauth.py`  
UI: `src/services/auth.ts` → `googleLoginUrl()` → `GET /v1/auth/google`

### Wired flow (fixed)
1. **Continue with Google** → browser hits API `/v1/auth/google` → Google consent  
2. Google redirects to **`/v1/auth/google/callback`** (backend exchanges `code`, creates user, issues **JWT**)  
3. Backend redirects to `FRONTEND_URL/#/auth?token=…` (or error query)  
4. Email/password register/login is also available when `EMAIL_PASSWORD_AUTH_ENABLED=true`  
5. **Forgot password:** `POST /v1/auth/forgot-password` → Gmail SMTP reset link → `#/auth/reset?token=…` → `POST /v1/auth/reset-password`  
6. Welcome email retries if SMTP failed last time  
7. Checkout success URL includes `{CHECKOUT_SESSION_ID}` → `POST /v1/billing/confirm-session`  
8. **Refunds:** revoke access + email; UI polls subscription every 60s  

### Google Cloud Console checklist
**Production domain: jobinterviewcracker.com** — full guide: `docs/GOOGLE_SIGNIN_JOBINTERVIEWCRACKER.md`

1. Create **OAuth 2.0 Client ID** type **Web application**  
2. **Local** JS origins: `http://localhost:5173` · Redirect: `http://127.0.0.1:8787/v1/auth/google/callback`  
3. **Production** JS origins: `https://jobinterviewcracker.com` · Redirect: `https://api.jobinterviewcracker.com/v1/auth/google/callback`  
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `JWT_SECRET`, `FRONTEND_URL` in server `src/.env`  
5. Production template: `src/.env.production.example` · UI build: `interview-pulse-ai/.env.production.example`  
6. Restart API · UI gate follows backend `AUTH_REQUIRED` (no hardcode) — use `AUTH_REQUIRED=true` + `AUTH_DEV_BYPASS=false` live

### Routes
- Auth: `/v1/auth/config|google|google/callback|me|resend-welcome|dev-bypass`  
- Password: `/v1/auth/register|login|forgot-password|reset-password`  
- Billing: `/v1/billing/checkout|portal|status|sync|confirm-session|webhook`  

### Gmail SMTP notes
- Use a Google **App Password** (2FA required), not the normal Gmail password  
- Spaces in the 16-char password are stripped automatically  
- Failed welcome emails store `last_email_error` on the user; Settings → **Resend welcome email**  
- `.env` is loaded encoding-safe from `src/.env` (cp1252/utf-8)

Config template: `src/.env.example`  
Without `GOOGLE_CLIENT_ID`, the app stays open for local interview work.

## Next wiring (production)

1. Paste Google OAuth + Gmail SMTP app password + Stripe keys into `src/.env` (see checklist above)  
2. Stripe CLI: `stripe listen --forward-to localhost:8787/v1/billing/webhook`  
3. Deepgram Nova-2 WebSocket in place of demo STT  
4. Native WASAPI loopback (system audio) in Electron  
5. Supabase + pgvector for durable STAR embeddings  
