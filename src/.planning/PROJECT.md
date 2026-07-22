# Astra Interview Copilot

## What This Is

A desktop application that captures system audio during interviews, transcribes speech using Whisper, classifies interview questions, and generates STAR-format answers using RAG against ingested resume/documents. Works on both Linux and Windows.

## Core Value

Sub-3-second total response time from silence detection to answer display. Speed is the difference between useful real-time assistance and a distraction.

## Current Milestone: v3.0 Online Distribution & License Gating

**Goal:** Make Astra available online as a Windows app with a backend proxy for LLM calls and license key gating, so users can't access the technology for free while keeping sub-3-second latency.

**Target features:**
- Backend proxy server that validates license keys and forwards LLM calls to OpenAI
- License key generation and validation system (basic deterrent)
- Local app routes LLM calls through backend instead of direct OpenAI
- RAG/ChromaDB stays local — documents never leave user's machine
- Windows installer for distribution
- Remove requirement for users to provide their own API key

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ System audio capture via PulseAudio/parec — v1.0
- ✓ Windows audio capture via WASAPI — v1.0
- ✓ Speech-to-text transcription via faster-whisper — v1.0
- ✓ LLM-based question classification (gpt-4o-mini) — existing
- ✓ RAG-based answer generation with STAR format (gpt-4o) — existing
- ✓ Document ingestion pipeline (PDF, TXT, MD → ChromaDB) — existing
- ✓ PyQt6 desktop GUI with real-time audio visualization — existing
- ✓ Auto-answer mode with silence detection and state machine — existing
- ✓ Audio device selection and configuration — existing
- ✓ Memory audio pipeline (numpy arrays, no temp files) — v1.0
- ✓ Transcription optimization (tiny.en, VAD, beam_size=1) — v1.0
- ✓ Cross-platform support (Linux + Windows) — v1.0
- ✓ Easy setup scripts (setup_windows.bat, run.bat, run.sh) — v1.0
- ✓ Dual-pane vertical split layout (bullet points + conversational script) — v2.1
- ✓ Question display at top of answer area — v2.1
- ✓ Parallel LLM generation (two agents, no latency hit) — v2.1
- ✓ Quick bullet point format (2-3 key points) — v2.1
- ✓ Conversational script format (humanized, tone-configurable) — v2.1
- ✓ Customizable prompts and settings via YAML — v2.2
- ✓ Focus mode toolbar — v2.2

### Active

<!-- Current scope. Building toward these. -->

- [ ] Backend proxy server (FastAPI) for LLM call forwarding
- [ ] License key validation endpoint
- [ ] License key generation/management tool
- [ ] Local app → backend proxy routing (replace direct OpenAI calls)
- [ ] Startup license key entry and validation UI
- [ ] Windows installer/distribution package
- [ ] Remove user-facing API key requirement

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- GPU acceleration for Whisper — CPU-only keeps setup simple
- Multiple language support — English interviews only for now
- Real-time streaming transcription — Silence-triggered batches work well
- Linux support for v3.0 — Windows-only for initial online release
- Server-side RAG — Documents stay local for privacy, only prompts go to backend
- Advanced DRM/anti-piracy — Basic deterrent is sufficient for now

## Context

**v1.0 Shipped:**
- Memory audio pipeline eliminates temp file I/O
- Transcription uses tiny.en with VAD for speed
- Cross-platform audio capture abstraction
- Windows WASAPI backend via PyAudioWPatch
- Setup scripts for easy installation

**Technical Environment:**
- Python 3.12, PyQt6, faster-whisper, ChromaDB, OpenAI API
- Linux: PulseAudio/PipeWire via parec
- Windows: WASAPI loopback via PyAudioWPatch

**v2.0 Shipped:**
- Startup screen with Ingest/Start options
- GUI-based document ingestion with progress
- Resizable window with horizontal layout
- Secure API key handling (platformdirs)

**v2.1/v2.2 Shipped:**
- Dual-pane answers with parallel LLM generation
- Customizable prompts via YAML config
- Focus mode toolbar
- Hybrid search with Reciprocal Rank Fusion

**Current Architecture (v3.0 context):**
- LLM calls go direct from local app to OpenAI — needs to route through backend proxy
- Users provide their own API key — backend will hold the key instead
- No licensing or access control — app is fully open once you have the code

## Constraints

- **Platform**: Windows only for v3.0 distribution
- **Latency**: Total pipeline under 3 seconds (extra network hop ~50-200ms acceptable)
- **Security**: OpenAI API key lives on backend only, never in client app
- **Hosting**: Cheap backend hosting (Railway/Fly.io/Hetzner ~$5/mo)

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| tiny.en as default model | ~1s vs ~2-3s transcription, speed is core value | ✓ Good |
| No temp file I/O | Eliminate disk latency | ✓ Good |
| Abstract AudioCapture interface | Clean cross-platform support | ✓ Good |
| PyAudioWPatch for Windows | WASAPI loopback for system audio | ✓ Good |
| Factory pattern for platform detection | sys.platform based selection | ✓ Good |
| Hybrid architecture for v3.0 | Local audio/transcription/RAG + backend LLM proxy. Keeps latency low, controls access | — Pending |
| Backend proxy for LLM calls | Users never see API key, access gated by license key | — Pending |
| Basic license key deterrent | Not trying to stop determined crackers, just casual sharing | — Pending |
| RAG stays local | User documents never leave their machine, privacy-friendly | — Pending |

---
*Last updated: 2026-02-16 after v3.0 milestone start*
