---
phase: 04-secure-api-key-handling
plan: 01
subsystem: auth
tags: [platformdirs, openai, api-key, config, security]

# Dependency graph
requires:
  - phase: 01-startup-screen
    provides: AstraApp controller for adding API key check
provides:
  - get_api_key() function loading from user config dir
  - get_config_path() for displaying path to user
  - First-run API key setup dialog in GUI
  - Cross-platform config location (~/.config/astra/, %APPDATA%/astra/)
affects: [all phases using OpenAI API]

# Tech tracking
tech-stack:
  added: [platformdirs>=4.0.0]
  patterns: [user-config-dir, explicit-api-key-injection]

key-files:
  created: []
  modified: [config.py, rag.py, ingest.py, gui.py, requirements.txt, .env.example]

key-decisions:
  - "Use platformdirs for cross-platform config directory"
  - "Parse .env file manually to avoid python-dotenv dependency for config"
  - "Pass api_key explicitly to OpenAI() client rather than env var"

patterns-established:
  - "API key loading: config.get_api_key() returns str | None"
  - "First-run prompts: Check in AstraApp.__init__, show dialog, allow exit"

# Metrics
duration: 6min
completed: 2026-01-19
---

# Phase 04 Plan 01: Secure API Key Config Summary

**Cross-platform API key storage using platformdirs with first-run setup dialog in GUI**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-19T22:17:00Z
- **Completed:** 2026-01-19T22:23:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- API key now loads from user config dir (~/.config/astra/.env on Linux)
- First-run shows clear setup dialog with path and instructions
- Removed load_dotenv() from rag.py and ingest.py
- All OpenAI clients now receive api_key explicitly

## Task Commits

Each task was committed atomically:

1. **Task 1: Add API key config with platformdirs** - `ee890fe` (feat)
2. **Task 2: Update rag.py and ingest.py** - `9a58bb5` (feat)
3. **Task 3: Add first-run API key setup in GUI** - `6a5ba4e` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified
- `config.py` - Added get_api_key(), get_config_path(), get_config_dir() functions
- `rag.py` - Removed load_dotenv(), use get_api_key() for OpenAI clients
- `ingest.py` - Removed load_dotenv(), use get_api_key(), fixed Callable type hint
- `gui.py` - Added API key check in AstraApp.__init__(), _show_api_key_setup() method
- `requirements.txt` - Added platformdirs>=4.0.0
- `.env.example` - Updated with user config directory instructions

## Decisions Made
- Used platformdirs for cross-platform config directory detection
- Parse .env file manually (simple KEY=value format) to avoid dependency on python-dotenv for config loading
- Pass api_key explicitly to OpenAI() client rather than relying on environment variable
- Show setup dialog in AstraApp.__init__() so it appears before any window

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed callable type hint in ingest.py**
- **Found during:** Task 2 (updating ingest.py)
- **Issue:** `callable | None` type hint used lowercase built-in `callable` instead of `Callable` from typing, causing import error
- **Fix:** Added `from __future__ import annotations` and `from collections.abc import Callable`, changed to `Callable[[dict], None] | None`
- **Files modified:** ingest.py
- **Verification:** Module imports successfully
- **Committed in:** 9a58bb5 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix was necessary for code to run. No scope creep.

## Issues Encountered
None - plan executed as written.

## User Setup Required
None - no external service configuration required beyond the existing OpenAI API key.

## Next Phase Readiness
- All Phase 4 work complete
- Milestone v2.0 is 100% complete (all 4 phases done)
- Ready for `/gsd:complete-milestone`

---
*Phase: 04-secure-api-key-handling*
*Completed: 2026-01-19*
