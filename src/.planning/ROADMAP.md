# Roadmap: Astra Interview Copilot

## Milestones

- ✅ **v1.0 Latency Optimization** - Phases 1-4 (shipped)
- ✅ **v2.0 GUI & Security** - Phases 1-4 (shipped 2026-01-20)
- ✅ **v2.1 Dual-Pane Answers** - Phases 5-7 (shipped 2026-01-21)
- ✅ **v2.2 Customization** - Phase 8 (shipped 2026-01-21)
- 🚧 **v3.0 Online Distribution & License Gating** - Phases 9-12 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (9, 10, 11, 12): Planned v3.0 milestone work
- Decimal phases (9.1, 10.1): Urgent insertions (marked with INSERTED)

- [x] **Phase 9: Backend Proxy & License Service** - FastAPI proxy server with license key validation and management CLI
- [x] **Phase 10: Desktop App Integration** - Route LLM calls through proxy, remove client-side API key
- [x] **Phase 11: License Key UI & First-Run Experience** - Activation screen, error states, offline grace period
- [ ] **Phase 12: Windows Installer & Distribution** - PyInstaller + Inno Setup packaging for Windows

## Phase Details

### Phase 9: Backend Proxy & License Service
**Goal**: Working FastAPI proxy that validates license keys, forwards LLM calls to OpenAI with SSE streaming, and provides CLI management tools
**Depends on**: Nothing (first phase of v3.0)
**Requirements**: PROXY-01, PROXY-02, PROXY-03, PROXY-04, PROXY-05, PROXY-06, PROXY-07, PROXY-08, PROXY-09, REL-01, REL-02, REL-03, REL-04, REL-05, MGMT-01, MGMT-02, MGMT-03, MGMT-04, LIC-02, LIC-05, LIC-06, LIC-08
**Success Criteria** (what must be TRUE):
  1. Proxy forwards LLM requests to OpenAI with SSE streaming passthrough (under 200ms added latency)
  2. License key validation rejects invalid/revoked keys and rate-limits per key
  3. CLI tool can generate, list, activate/deactivate, and revoke license keys
  4. Health check endpoint confirms server and OpenAI reachability
  5. All errors returned as structured JSON with user-friendly messages
**Research**: Likely (SSE streaming passthrough, Railway deployment, PostgreSQL setup)
**Research topics**: FastAPI SSE streaming with httpx async, Railway PostgreSQL + deployment config, connection pooling
**Plans**: TBD

Plans:
- [x] 09-01: Backend foundation & license key management
- [x] 09-02: LLM proxy forwarding & reliability

### Phase 10: Desktop App Integration
**Goal**: Desktop app routes all LLM calls through backend proxy using license key as auth, with no OpenAI API key on client
**Depends on**: Phase 9
**Requirements**: APP-01, APP-02, APP-03, LIC-04, LIC-07, LIC-09
**Success Criteria** (what must be TRUE):
  1. All LLM calls route through the backend proxy (no direct OpenAI calls remain)
  2. App contains no OpenAI API key — license key is the only credential
  3. License key persists locally across app restarts (platformdirs config)
  4. User can deactivate license from current machine to transfer
**Research**: Unlikely (OpenAI SDK `base_url` override is well-documented, mechanical change at 6 call sites)
**Plans**: TBD

Plans:
- [x] 10-01: Embeddings proxy & desktop license config
- [x] 10-02: Route LLM/embedding calls through proxy

### Phase 11: License Key UI & First-Run Experience
**Goal**: First-launch license activation screen with clear feedback, replacing the existing API key entry flow
**Depends on**: Phase 10 (needs proxy routing working to validate keys)
**Requirements**: LIC-01, LIC-03, FRX-01, FRX-02, FRX-03, FRX-04, FRX-05
**Success Criteria** (what must be TRUE):
  1. First launch shows single-screen license activation (text field + Activate button)
  2. Clear success/failure feedback with distinct visual states (green success, red invalid, yellow network error)
  3. App opens without license but blocks LLM features until activated
  4. "Where do I get a key?" link opens purchase page in default browser
**Research**: Unlikely (standard PyQt6 dialog, similar to existing API key entry screen)
**Plans**: TBD

Plans:
- [x] 11-01: License activation screen & first-run flow

### Phase 12: Windows Installer & Distribution
**Goal**: Windows installer (.exe) via PyInstaller + Inno Setup, ready for distribution
**Depends on**: Phase 11 (all features must be stable before packaging)
**Requirements**: INST-01, INST-02, INST-03, INST-04, INST-05, INST-06, INST-07, INST-08
**Success Criteria** (what must be TRUE):
  1. Standard Windows install flow works (Next > Next > Install > Finish)
  2. Desktop shortcut and Start Menu entry created during install
  3. Clean uninstall via Add/Remove Programs preserves user data (ChromaDB, config, prompts)
  4. Installer size under 100MB, per-user install (no admin rights required)
**Research**: Likely (PyInstaller hidden imports for new deps, Inno Setup config, AV false positives)
**Research topics**: PyInstaller hooks for httpx/keyring, --onedir bundling with PyQt6, Inno Setup per-user install, SmartScreen warnings
**Plans**: TBD

Plans:
- [ ] 12-01: Windows installer packaging (checkpoint pending)

## Progress

**Execution Order:**
Phases execute in numeric order: 9 → 10 → 11 → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 9. Backend Proxy & License Service | 2/2 | Complete | 2026-02-17 |
| 10. Desktop App Integration | 2/2 | Complete | 2026-02-17 |
| 11. License Key UI & First-Run | 1/1 | Complete | 2026-02-17 |
| 12. Windows Installer & Distribution | 0/1 | In progress | - |

---

<details>
<summary>✅ v2.1 Dual-Pane Answers + v2.2 Customization (Phases 5-8) - SHIPPED 2026-01-21</summary>

### Phase 5: Dual-Pane Layout
**Goal**: Create vertical split UI with question display and two answer panes
**Requirements**: DUAL-01, DUAL-02, DUAL-03, DUAL-04
**Plans**: 1/1 complete

Plans:
- [x] 05-01: Dual-pane layout implementation

### Phase 6: Answer Formats
**Goal**: Implement bullet point and conversational script generation prompts
**Requirements**: FMT-01, FMT-02, FMT-03
**Plans**: 1/1 complete

Plans:
- [x] 06-01: Answer format prompts and generation

### Phase 7: Parallel Generation
**Goal**: Execute both LLM calls concurrently to maintain latency target
**Requirements**: PAR-01, PAR-02, PAR-03
**Plans**: 1/1 complete

Plans:
- [x] 07-01: Parallel LLM execution

### Phase 8: Customizable Prompts & Settings
**Goal**: Make LLM prompts, job context, and tone configurable via YAML file
**Requirements**: CUSTOM-01, CUSTOM-02, CUSTOM-03, CUSTOM-04, CUSTOM-05
**Plans**: 1/1 complete

Plans:
- [x] 08-01: YAML config and GUI controls

</details>

<details>
<summary>✅ v2.0 GUI & Security (Phases 1-4) - SHIPPED 2026-01-20</summary>

### Phase 1: Startup Screen
**Goal**: Create a startup screen with two clear options for users
**Requirements**: GUI-01, GUI-02, GUI-03
**Plans**: 1/1 complete

### Phase 2: GUI Document Ingestion
**Goal**: Enable document ingestion through the GUI without CLI
**Requirements**: INGEST-01, INGEST-02, INGEST-03
**Plans**: 1/1 complete

### Phase 3: Resizable Layout
**Goal**: Make window resizable with horizontal layout option
**Requirements**: LAYOUT-01, LAYOUT-02
**Plans**: 1/1 complete

### Phase 4: Secure API Key Handling
**Goal**: Move API key storage to user config folder
**Requirements**: SEC-01, SEC-02, SEC-03
**Plans**: 1/1 complete

</details>

<details>
<summary>✅ v1.0 Latency Optimization & Cross-Platform - SHIPPED</summary>

- Phase 1: Memory Audio Pipeline (Complete)
- Phase 2: Transcription Optimization (Complete)
- Phase 3: Observability & Config (Deferred)
- Phase 4: Windows Compatibility & Easy Setup (Complete)

See `.planning/archive/v1.0/` for details.

</details>
