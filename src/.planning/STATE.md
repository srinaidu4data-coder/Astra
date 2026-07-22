# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Sub-3-second total response time from silence detection to answer display
**Current focus:** Phase 12 in progress — Windows installer packaging (checkpoint pending)

## Current Position

Phase: 12 of 12 (Windows Installer & Distribution)
Plan: 1 of 1 in current phase
Status: In progress (checkpoint: human-verify pending)
Last activity: 2026-02-17 — Executed 12-01-PLAN.md Tasks 1-2, awaiting checkpoint

Progress: ███████████░ 95%

## Performance Metrics

**Velocity:**
- Total plans completed: 19
- Average duration: ~4 min
- Total execution time: ~68 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| v1.0 (Phases 1-4) | 5 | ~12 min | ~2.4 min |
| v2.0 (Phases 1-4) | 4 | ~21 min | ~5.3 min |
| v2.1 (Phases 5-7) | 3 | ~13 min | ~4.3 min |
| v2.2 (Phase 8) | 1 | ~5 min | ~5 min |
| v3.0 (Phase 9) | 2 | ~6 min | ~3 min |
| v3.0 (Phase 10) | 2 | ~6 min | ~3 min |
| v3.0 (Phase 11) | 1 | ~3 min | ~3 min |
| v3.0 (Phase 12) | 1 | ~2 min | ~2 min |

**Recent Trend:**
- Last 5 plans: all successful, stable ~3-4 min/plan
- Trend: Stable

## Accumulated Context

### Decisions

Recent decisions affecting current work:

| Phase | Decision | Rationale |
|-------|----------|-----------|
| v2.0-04 | platformdirs for config | Cross-platform user config directory |
| v2.1-06 | gpt-4o-mini for bullets, gpt-4o for script | Speed vs quality tradeoff per format |
| v2.1-07 | ThreadPoolExecutor for parallel generation | Simpler than asyncio, sync-friendly with OpenAI SDK |
| v2.2-08 | YAML for prompts config | Multi-line prompts more readable |
| v3.0 | Hybrid architecture | Local audio/transcription/RAG + backend LLM proxy |
| v3.0 | Basic license key deterrent | Not trying to stop determined crackers |
| v3.0 | RAG stays local | User documents never leave their machine |
| 09-01 | UUID v4 keys stored plaintext | Hashing adds complexity without meaningful gain for random 128-bit keys |
| 09-01 | SQLite default, Postgres for prod | Simple dev/test setup, swap URL for production |
| 09-01 | hmac.compare_digest for key comparison | Timing-safe validation prevents side-channel attacks |
| 09-02 | Pass-through JSON body to OpenAI SDK | No Pydantic model for proxy request — avoids schema maintenance |
| 09-02 | In-memory rate limiting over Redis | Solo dev, no multi-instance deployment needed |
| 09-02 | Fail-fast on missing/invalid OPENAI_API_KEY | Server refuses to start — prevents silent failures |
| 10-01 | Production proxy default URL in config.py | https://astra-proxy.up.railway.app/v1 — user can override for local dev |
| 10-01 | SHA-256 of /etc/machine-id for hardware ID | Stable, cross-platform, 32-char hex with Windows/fallback strategies |
| 10-01 | _read_env_file/_write_env_file helpers | DRY .env parsing avoids duplicating logic across get/save functions |
| 10-02 | requests library for license HTTP calls | Simpler API than urllib.request for activation/deactivation |
| 10-02 | Offline license entry allowed | Key saved locally, validates when server is reachable |
| 10-02 | _get_openai_client() factory in rag.py | Centralizes proxy client creation for all 5 call sites |
| 11-01 | LicenseActivationScreen replaces QInputDialog | Polished first-run UX with color-coded feedback |
| 11-01 | "Continue without license" skip option | Users can ingest docs without license, LLM features blocked |
| 12-01 | --onedir over --onefile bundling | Avoids AV false positives, faster startup (no temp extraction) |
| 12-01 | UPX disabled | Triggers more AV false positives than size savings justify |
| 12-01 | Per-user install to {localappdata}\Astra | No admin rights required (PrivilegesRequired=lowest) |

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

### Roadmap Evolution

- v1.0 complete: Memory pipeline, transcription, Windows support
- v2.0 complete: Startup screen, GUI ingestion, layout, security
- v2.1 complete: Dual-pane answers with parallel generation
- v2.2 complete: Customizable prompts and settings via YAML
- v3.0 roadmap created: 4 phases (backend proxy -> app integration -> license UI -> installer)
- v3.0 Phase 9 complete: Backend proxy with license keys, SSE streaming, rate limiting, health check
- v3.0 Phase 10 complete: Desktop app routes all LLM calls through proxy, license key activation/deactivation
- v3.0 Phase 11 complete: License activation screen with first-run flow, color-coded feedback, purchase link
- v3.0 Phase 12 in progress: Windows installer packaging (PyInstaller --onedir + Inno Setup), checkpoint pending

## Session Continuity

Last session: 2026-02-17 21:52 UTC
Stopped at: 12-01-PLAN.md Task 3 checkpoint (human-verify) — Tasks 1-2 complete
Resume file: None
