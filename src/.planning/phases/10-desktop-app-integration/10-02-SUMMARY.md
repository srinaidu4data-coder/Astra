---
phase: 10-desktop-app-integration
plan: 02
subsystem: api, ui, config
tags: [openai, proxy, license-key, gui, pyqt6, requests, deactivation]

# Dependency graph
requires:
  - phase: 10-desktop-app-integration
    provides: License key config functions, proxy URL, hardware ID, embeddings endpoint
  - phase: 09-backend-proxy-license-service
    provides: FastAPI proxy with license validation, activate/deactivate endpoints
provides:
  - All desktop LLM/embedding calls routed through backend proxy
  - License key activation dialog with backend validation
  - License deactivation from GUI with hardware unbinding
  - Zero direct OpenAI API key references in desktop app
affects: [11-license-key-ui]

# Tech tracking
tech-stack:
  added: [requests]
  patterns:
    - "_get_openai_client() factory for proxy-routed OpenAI SDK clients"
    - "License activation via backend /v1/license/activate with hardware ID"

key-files:
  created: []
  modified:
    - rag.py
    - ingest.py
    - gui.py
    - requirements.txt

key-decisions:
  - "Added requests dependency for license HTTP calls (simpler than urllib)"
  - "Deactivate License button in main window toolbar area (bottom bar)"
  - "Offline license entry allowed -- key saved locally, validates when online"

patterns-established:
  - "_get_openai_client() centralizes proxy client creation in rag.py"
  - "License activation/deactivation uses base URL derived from proxy URL"

# Metrics
duration: 4min
completed: 2026-02-17
---

# Phase 10 Plan 02: Route LLM/Embedding Calls Through Proxy Summary

**All 6 OpenAI call sites routed through backend proxy via license key, GUI updated with license activation dialog and deactivation button, zero direct API key references remain**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-17T01:30:08Z
- **Completed:** 2026-02-17T01:34:01Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- All 5 OpenAI call sites in rag.py use _get_openai_client() factory routed through backend proxy
- ingest.py embedding call uses license key + proxy URL for document ingestion
- GUI prompts for license key on first run with backend activation validation
- Deactivate License button allows transferring license to another machine
- Zero references to get_api_key or OPENAI_API_KEY in any desktop app file

## Task Commits

Each task was committed atomically:

1. **Task 1: Route all OpenAI calls through proxy in rag.py and ingest.py** - `8a30cdf` (feat)
2. **Task 2: Update GUI for license key and add deactivation** - `9ec34a6` (feat)

## Files Created/Modified
- `rag.py` - Added _get_openai_client() helper, updated 5 call sites to use proxy routing
- `ingest.py` - Updated embedding call to use license key + proxy URL
- `gui.py` - Replaced API key setup with license activation dialog, added deactivation button
- `requirements.txt` - Added requests dependency for license HTTP calls

## Decisions Made
- Added `requests` library for license activation/deactivation HTTP calls (simpler API than urllib.request)
- Placed Deactivate License button in the bottom toolbar area next to Focus and layout toggle buttons
- Offline license entry is allowed: key saved locally, validation deferred to when server is reachable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All desktop LLM and embedding calls now route through backend proxy
- License key is the only credential in the desktop app (no OpenAI API key)
- Phase 10 complete, ready for Phase 11 (License Key UI & First-Run Experience)

---
*Phase: 10-desktop-app-integration*
*Completed: 2026-02-17*
