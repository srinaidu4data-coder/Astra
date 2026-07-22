# Requirements: Astra Interview Copilot

**Defined:** 2026-01-17
**Core Value:** Sub-3-second total response time from silence detection to answer display

## v3.0 Requirements (Active)

Requirements for online distribution with backend LLM proxy and license key gating.

### License Key System

- [ ] **LIC-01**: User can enter license key on a single activation screen (text field + Activate button)
- [x] **LIC-02**: License keys use UUID v4 format, copy-paste friendly from email
- [ ] **LIC-03**: Activation screen shows clear success/failure feedback with specific reason (invalid key, key in use, network error)
- [x] **LIC-04**: Activated license persists locally across app restarts (platformdirs config)
- [x] **LIC-05**: App works offline for 7 days after last successful license validation
- [x] **LIC-06**: License key works immediately after purchase (no manual approval delay)
- [x] **LIC-07**: No account creation required — license key is the only credential
- [x] **LIC-08**: License is bound to machine hardware ID to prevent casual sharing
- [x] **LIC-09**: User can deactivate license from current machine to transfer to a new machine

### Backend API Proxy

- [x] **PROXY-01**: Backend proxy forwards LLM requests to OpenAI with SSE streaming passthrough
- [x] **PROXY-02**: Proxy adds less than 200ms overhead per request
- [x] **PROXY-03**: Proxy maps upstream errors to user-friendly messages (401=bad key, 429=rate limit, 502=OpenAI down)
- [x] **PROXY-04**: All proxy communication uses HTTPS
- [x] **PROXY-05**: Proxy enforces request timeouts (60s for generate, 30s for classify)
- [x] **PROXY-06**: Proxy rate limits per license key (20 RPM completions, 60 RPM classifications)
- [x] **PROXY-07**: Proxy retries once on OpenAI 429/500 errors with 2s backoff before returning error
- [x] **PROXY-08**: Proxy logs usage (requests + tokens) per license key per day
- [x] **PROXY-09**: Proxy enforces model routing server-side (gpt-4o-mini for classify, gpt-4o for answers)

### Desktop App Integration

- [x] **APP-01**: Desktop app routes all LLM calls through backend proxy instead of direct OpenAI
- [x] **APP-02**: OpenAI API key removed from client app entirely (lives on backend only)
- [x] **APP-03**: License key used as authentication token for proxy requests

### First-Run Experience

- [ ] **FRX-01**: Single-screen license activation replaces current API key entry screen
- [ ] **FRX-02**: "Where do I get a key?" link opens purchase page in default browser
- [ ] **FRX-03**: App allows opening without license but blocks LLM features until activated
- [ ] **FRX-04**: Activation persists across app updates and reinstalls
- [ ] **FRX-05**: Distinct error states: success (green), invalid key (red), network error (yellow + retry)

### License Key Management (Backend CLI)

- [x] **MGMT-01**: CLI tool generates license keys in bulk (e.g., `--count 20`)
- [x] **MGMT-02**: CLI tool activates/deactivates individual keys (customer support)
- [x] **MGMT-03**: CLI tool lists keys with status (unused, active, revoked, expired)
- [x] **MGMT-04**: Keys can be revoked (e.g., on refund)

### Windows Installer

- [ ] **INST-01**: Standard Windows install flow (Next > Next > Install > Finish) via Inno Setup
- [ ] **INST-02**: Desktop shortcut option during install
- [ ] **INST-03**: Start Menu entry created during install
- [ ] **INST-04**: Clean uninstall via Add/Remove Programs
- [ ] **INST-05**: Installer size under 100MB (~60-80MB target)
- [ ] **INST-06**: Per-user install (no admin rights required)
- [ ] **INST-07**: Progress bar displayed during installation
- [ ] **INST-08**: User data (ChromaDB, config, prompts) preserved on uninstall/reinstall

### Proxy Reliability

- [x] **REL-01**: Health check endpoint returns server and OpenAI reachability status
- [x] **REL-02**: Request timeouts configured per endpoint (httpx async client)
- [x] **REL-03**: All errors returned as structured JSON with user-friendly messages (no stack traces)
- [x] **REL-04**: Requests logged with timestamp, license key (truncated), endpoint, status, latency, tokens
- [x] **REL-05**: Server validates OpenAI API key on startup, refuses to start if invalid

## v3.1 Requirements (Deferred)

Deferred to post-launch. Tracked but not in current roadmap.

### Post-Launch Improvements

- **DEFER-01**: Gumroad webhook auto-generates key on purchase
- **DEFER-02**: Usage dashboard (CLI query of usage stats per key)
- **DEFER-03**: Time-limited trial keys (7-day trial for marketing)
- **DEFER-04**: Key tiers (standard/premium with different rate limits)
- **DEFER-05**: Circuit breaker pattern (fail fast when OpenAI is down)
- **DEFER-06**: Cost cap per key per day (prevent abuse)
- **DEFER-07**: Request ID in error response headers
- **DEFER-08**: Microsoft Trusted Signing code certificate ($9.99/mo)
- **DEFER-09**: Silent install option (/SILENT flag)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Web admin dashboard | CLI tools sufficient for <200 customers |
| Customer self-service portal | Handle support via email |
| Multi-device licensing | Start with 1 key = 1 machine |
| Usage-based billing | Fixed price per key is simpler |
| Auto-update on launch | Blocks startup, bad UX during interview prep |
| Multi-region deployment | Single region sufficient for <100 users |
| Multi-provider failover | Different models = different prompt tuning = different quality |
| Response caching | Interview answers are contextual, ~0% cache hit rate |
| Linux/macOS distribution | Windows-only for v3.0 initial release |
| Advanced DRM/anti-piracy | Basic deterrent sufficient, Python app is decompilable regardless |
| Phone-home every launch | Validate periodically (every 7 days), not every startup |

## v1 Requirements (Complete)

Requirements for latency optimization release.

### Audio Pipeline

- [x] **AUDIO-01**: Audio captured directly to numpy array in memory (no temp file)
- [x] **AUDIO-02**: Numpy array passed directly to faster-whisper transcribe()

### Transcription

- [x] **TRANS-01**: Default Whisper model switched to tiny.en (~1s for 30s audio)
- [x] **TRANS-02**: Transcription uses beam_size=1 for faster inference
- [x] **TRANS-03**: VAD filtering enabled (vad_filter=True) to skip silence segments

### Cross-Platform (v1.0)

- [x] **PLAT-02**: Support for Windows audio capture (WASAPI loopback)
- [x] **PLAT-03**: Device-agnostic audio abstraction layer

### Observability (Deferred)

- [ ] **OBS-01**: Status bar displays pipeline timing (capture, transcription, RAG duration)

### Configuration (Deferred)

- [ ] **CONFIG-01**: Config option to select Whisper model (tiny.en, base.en, small.en, etc.)

## v2 Requirements (Complete)

Requirements for GUI improvements and security.

### Startup Screen

- [x] **GUI-01**: Startup screen displayed when app launches
- [x] **GUI-02**: "Ingest Documents" button on startup screen triggers document ingestion
- [x] **GUI-03**: "Start Session" button on startup screen navigates to main session screen

### Document Ingestion

- [x] **INGEST-01**: GUI-based document ingestion (no CLI required)
- [x] **INGEST-02**: Ingestion scans `documents/` folder in project directory
- [x] **INGEST-03**: Progress/status feedback during ingestion process

### Window Layout

- [x] **LAYOUT-01**: Window is resizable (remove fixed size constraint)
- [x] **LAYOUT-02**: Support horizontal layout option for wider screens

### Security

- [x] **SEC-01**: API key loaded from user config folder (not project .env)
- [x] **SEC-02**: No API keys committed to repository
- [x] **SEC-03**: Clear user guidance for API key setup on first run

## v2.1 Requirements (Complete)

Requirements for dual-pane answer display with parallel generation.

### Dual-Pane Layout

- [x] **DUAL-01**: Vertical split layout with two answer panes side by side
- [x] **DUAL-02**: Question displayed at top of answer area (visible in both contexts)
- [x] **DUAL-03**: Left pane displays bullet point summary
- [x] **DUAL-04**: Right pane displays conversational script

### Answer Formats

- [x] **FMT-01**: Bullet point format produces 2-3 key points maximum
- [x] **FMT-02**: Conversational script is humanized and readable aloud
- [x] **FMT-03**: Script tone is configurable (professional, casual, confident)

### Parallel Generation

- [x] **PAR-01**: Both answer formats generated via parallel LLM calls
- [x] **PAR-02**: Total latency remains under 3 seconds (no sequential hit)
- [x] **PAR-03**: Both panes update when their respective response arrives

## v2.2 Requirements (Complete)

Requirements for customizable prompts and settings.

### Customization

- [x] **CUSTOM-01**: YAML config file at ~/.config/astra/prompts.yaml stores all prompts
- [x] **CUSTOM-02**: Job context input in main window affects generated answers
- [x] **CUSTOM-03**: Tone dropdown allows selection (professional, casual, confident)
- [x] **CUSTOM-04**: Reload Config button refreshes settings without restart
- [x] **CUSTOM-05**: Invalid YAML gracefully falls back to defaults

## Traceability

Which phases cover which requirements. Updated by create-roadmap.

### v3.0 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIC-01 | Phase 11 | Complete |
| LIC-02 | Phase 9 | Complete |
| LIC-03 | Phase 11 | Complete |
| LIC-04 | Phase 10 | Complete |
| LIC-05 | Phase 9 | Complete |
| LIC-06 | Phase 9 | Complete |
| LIC-07 | Phase 10 | Complete |
| LIC-08 | Phase 9 | Complete |
| LIC-09 | Phase 10 | Complete |
| PROXY-01 | Phase 9 | Complete |
| PROXY-02 | Phase 9 | Complete |
| PROXY-03 | Phase 9 | Complete |
| PROXY-04 | Phase 9 | Complete |
| PROXY-05 | Phase 9 | Complete |
| PROXY-06 | Phase 9 | Complete |
| PROXY-07 | Phase 9 | Complete |
| PROXY-08 | Phase 9 | Complete |
| PROXY-09 | Phase 9 | Complete |
| APP-01 | Phase 10 | Complete |
| APP-02 | Phase 10 | Complete |
| APP-03 | Phase 10 | Complete |
| FRX-01 | Phase 11 | Complete |
| FRX-02 | Phase 11 | Complete |
| FRX-03 | Phase 11 | Complete |
| FRX-04 | Phase 11 | Complete |
| FRX-05 | Phase 11 | Complete |
| MGMT-01 | Phase 9 | Complete |
| MGMT-02 | Phase 9 | Complete |
| MGMT-03 | Phase 9 | Complete |
| MGMT-04 | Phase 9 | Complete |
| INST-01 | Phase 12 | Pending |
| INST-02 | Phase 12 | Pending |
| INST-03 | Phase 12 | Pending |
| INST-04 | Phase 12 | Pending |
| INST-05 | Phase 12 | Pending |
| INST-06 | Phase 12 | Pending |
| INST-07 | Phase 12 | Pending |
| INST-08 | Phase 12 | Pending |
| REL-01 | Phase 9 | Complete |
| REL-02 | Phase 9 | Complete |
| REL-03 | Phase 9 | Complete |
| REL-04 | Phase 9 | Complete |
| REL-05 | Phase 9 | Complete |

**v3.0 Coverage:**
- v3.0 requirements: 43 total
- Mapped to phases: 43
- Unmapped: 0 ✓

### v1–v2.2 Traceability (Historical)

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUDIO-01 | Phase 1 (v1) | Complete |
| AUDIO-02 | Phase 1 (v1) | Complete |
| TRANS-01 | Phase 2 (v1) | Complete |
| TRANS-02 | Phase 2 (v1) | Complete |
| TRANS-03 | Phase 2 (v1) | Complete |
| PLAT-02 | Phase 4 (v1) | Complete |
| PLAT-03 | Phase 4 (v1) | Complete |
| GUI-01 | Phase 1 (v2) | Complete |
| GUI-02 | Phase 1 (v2) | Complete |
| GUI-03 | Phase 1 (v2) | Complete |
| INGEST-01 | Phase 2 (v2) | Complete |
| INGEST-02 | Phase 2 (v2) | Complete |
| INGEST-03 | Phase 2 (v2) | Complete |
| LAYOUT-01 | Phase 3 (v2) | Complete |
| LAYOUT-02 | Phase 3 (v2) | Complete |
| SEC-01 | Phase 4 (v2) | Complete |
| SEC-02 | Phase 4 (v2) | Complete |
| SEC-03 | Phase 4 (v2) | Complete |
| DUAL-01 | Phase 5 | Complete |
| DUAL-02 | Phase 5 | Complete |
| DUAL-03 | Phase 5 | Complete |
| DUAL-04 | Phase 5 | Complete |
| FMT-01 | Phase 6 | Complete |
| FMT-02 | Phase 6 | Complete |
| FMT-03 | Phase 6 | Complete |
| PAR-01 | Phase 7 | Complete |
| PAR-02 | Phase 7 | Complete |
| PAR-03 | Phase 7 | Complete |
| CUSTOM-01 | Phase 8 | Complete |
| CUSTOM-02 | Phase 8 | Complete |
| CUSTOM-03 | Phase 8 | Complete |
| CUSTOM-04 | Phase 8 | Complete |
| CUSTOM-05 | Phase 8 | Complete |

---
*Requirements defined: 2026-01-17*
*Last updated: 2026-02-17 after Phase 11 completion*
