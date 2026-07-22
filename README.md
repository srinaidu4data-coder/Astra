# Astra / InterviewPulse AI

Desktop interview copilot suite:

| Path | What |
|------|------|
| `src/` | Python backend: Whisper STT, OpenAI answers, Stereo Mix live session, FastAPI + WebSocket |
| `interview-pulse-ai/` | React UI (Vite + TypeScript + Tailwind) |

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

See `interview-pulse-ai/HANDOFF.md` and `src/HANDOFF.md` for detail.
