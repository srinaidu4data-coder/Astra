# InterviewPulse AI

Real-time AI interview copilot & prep suite — stealth overlay, STAR RAG, mock arena, analytics.

## Stack

- **Desktop:** Electron + React (TypeScript) + Tailwind CSS v4
- **UI:** Lucide, Framer Motion, Zustand, glassmorphism design system
- **Audio:** Web Audio API + energy VAD (Silero-ready); system loopback hooks via Electron
- **STT / LLM:** Demo streaming pipeline (&lt;850ms budget); pluggable Deepgram + Claude/OpenAI keys
- **RAG:** Client-side PDF/DOCX/MD parsing → atomic STAR memories + bag-of-words top-k (Supabase/pgvector-ready)

## Screens

1. **Copilot Control Center** — waveform, devices, stealth, live transcript, Whisper Stream
2. **Knowledge Vault** — resume/JD upload, STAR tree, job matcher
3. **Practice Arena** — persona mock interviews + live meters + session reports
4. **Analytics Hub** — confidence / depth / filler / STAR trends
5. **Whisper Overlay** — always-on-top teleprompter (`Ctrl+Shift+S`)

## Run

```bash
cd interview-pulse-ai
npm install
npm run dev          # browser dashboard at http://localhost:5173
npm run dev:electron # Electron shell + overlay IPC
```

## Design tokens

| Token | Value |
|-------|--------|
| Base | `#0B0F17` |
| Card glass | `rgba(18, 24, 38, 0.7)` |
| Border | `rgba(255, 255, 255, 0.08)` |
| Indigo | `#6366F1` |
| Emerald | `#10B981` |

## Latency budget (demo pipeline)

1. VAD end-of-turn ~100ms  
2. STT deltas ~250ms  
3. RAG top-3 memories  
4. First token &lt;400ms → **total &lt;850ms**

## Related

Previous Python/PyQt product lives in `../src` (Astra). This app is the modern InterviewPulse rebuild.
