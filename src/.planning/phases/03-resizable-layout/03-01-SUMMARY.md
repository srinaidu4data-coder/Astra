---
phase: 03-resizable-layout
plan: 01
subsystem: ui
tags: [pyqt6, qsplitter, layout, responsive]

# Dependency graph
requires:
  - phase: 01-startup-screen
    provides: StartupScreen and AstraWindow widget structure
provides:
  - Resizable windows with minimum size constraints
  - QSplitter-based Question/Answer panel layout
  - Horizontal/vertical layout toggle
affects: [future UI phases, window styling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "QSplitter for user-adjustable panel sizes"
    - "Layout toggle button for switching orientations"

key-files:
  created: []
  modified:
    - gui.py

key-decisions:
  - "QSplitter for panels instead of fixed layouts"
  - "Toggle button in title row for layout switching"

patterns-established:
  - "setMinimumSize() + resize() pattern for resizable windows"
  - "QSplitter with vertical/horizontal toggle"

# Metrics
duration: 2 min
completed: 2026-01-20
---

# Phase 3 Plan 01: Resizable Layout Summary

**Resizable windows with QSplitter for Question/Answer panels and horizontal/vertical layout toggle**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-20T03:09:46Z
- **Completed:** 2026-01-20T03:11:48Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- StartupScreen is now resizable with 350x300 minimum size
- AstraWindow is resizable with 450x600 minimum size
- Question and Answer panels use QSplitter for user-adjustable sizing
- Layout toggle button switches between vertical (default) and horizontal modes
- Horizontal mode shows Question left, Answer right for wide screens

## Task Commits

Each task was committed atomically:

1. **Task 1: Make StartupScreen resizable** - `29f1248` (feat)
2. **Task 2: Make AstraWindow resizable with horizontal layout** - `a19fbd1` (feat)

## Files Created/Modified

- `gui.py` - Added QSplitter/QSizePolicy imports, replaced setFixedSize with setMinimumSize/resize, refactored Question/Answer sections into QSplitter panels, added layout toggle button and methods

## Decisions Made

- **QSplitter for panels:** Allows users to drag divider between Question and Answer sections
- **Toggle button placement:** Added to title row (top right) for easy access without cluttering main UI
- **Initial splitter ratio:** 40% Question / 60% Answer for both vertical and horizontal modes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Layout improvements complete
- Ready for Phase 4 (Secure API Key Handling)
- Existing functionality preserved (audio capture, transcription, RAG)

---
*Phase: 03-resizable-layout*
*Completed: 2026-01-20*
