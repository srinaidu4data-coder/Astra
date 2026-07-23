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

### Wired flow (fixed)
1. Google OAuth **or** email/password register/login  
2. **Forgot password:** `POST /v1/auth/forgot-password` → Gmail SMTP reset link → `#/auth/reset?token=…` → `POST /v1/auth/reset-password`  
3. Callback creates user, **retries welcome email** if SMTP failed last time  
4. Checkout success URL includes `{CHECKOUT_SESSION_ID}` → `POST /v1/billing/confirm-session`  
5. **Refunds:** revoke access + email  
6. UI polls subscription every 60s so refunds lock the app  

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

1. Paste Google OAuth + Gmail SMTP app password + Stripe keys into `src/.env`  
2. Stripe CLI: `stripe listen --forward-to localhost:8787/v1/billing/webhook`  
3. Deepgram Nova-2 WebSocket in place of demo STT  
4. Native WASAPI loopback (system audio) in Electron  
5. Supabase + pgvector for durable STAR embeddings  
