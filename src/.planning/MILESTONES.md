# Milestones: Astra Interview Copilot

## Completed Milestones

### v1.0 — Latency Optimization & Cross-Platform (2026-01-20)

**Goal:** Sub-3-second response time and Windows support.

**Phases:**
- Phase 1: Memory Audio Pipeline — numpy arrays, no temp files
- Phase 2: Transcription Optimization — tiny.en, VAD, beam_size=1
- Phase 4: Windows Compatibility — WASAPI backend, setup scripts

**Key Deliverables:**
- Cross-platform audio capture abstraction (audio_capture.py)
- Windows WASAPI loopback via PyAudioWPatch
- Linux PulseAudio via parec
- One-click setup scripts (setup_windows.bat, run.bat, run.sh)
- PyInstaller packaging spec

**Skipped:**
- Phase 3: Observability & Config (timing display, model selection) — deferred

---

## Current Milestone

### v2.0 — GUI & Security (In Progress)

**Goal:** GUI-based document ingestion, flexible layout, secure API keys.

**Target Features:**
- Startup screen with "Ingest Documents" / "Start Session" options
- Document ingestion from GUI (documents/ folder)
- Resizable window with horizontal layout
- Secure API key handling

**Status:** Requirements defined, roadmap not yet created.
