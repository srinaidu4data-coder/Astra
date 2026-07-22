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

## Next wiring (production)

1. Deepgram Nova-2 WebSocket in place of demo STT  
2. Claude 3.5 / GPT-4o-mini streaming for answers  
3. Silero VAD ONNX for end-of-turn  
4. Native WASAPI loopback (system audio) in Electron  
5. Supabase + pgvector for durable STAR embeddings  
