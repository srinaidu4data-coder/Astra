---
phase: 12-windows-installer-distribution
plan: 01
subsystem: infra
tags: [pyinstaller, inno-setup, windows, installer, packaging]

# Dependency graph
requires:
  - phase: 11-license-key-ui-first-run
    provides: "Complete v3.0 desktop app with license activation UI"
provides:
  - "PyInstaller --onedir spec with all v3.0 hidden imports"
  - "Inno Setup per-user installer script with shortcuts and clean uninstall"
  - "Automated build script chaining PyInstaller and Inno Setup"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "--onedir bundling (EXE + COLLECT) instead of --onefile to avoid AV false positives"
    - "Per-user install via PrivilegesRequired=lowest and {localappdata} directory"

key-files:
  created:
    - "installer/astra_setup.iss"
  modified:
    - "astra.spec"
    - "build_windows.bat"

key-decisions:
  - "--onedir over --onefile: avoids AV false positives, faster startup (no temp extraction)"
  - "UPX disabled: triggers more AV false positives than it saves in size"
  - "Per-user install to {localappdata}\\Astra: no admin rights required"
  - "User data ({localappdata}\\astra\\) preserved on uninstall"

patterns-established:
  - "Build pipeline: PyInstaller --onedir -> Inno Setup -> AstraSetup.exe"

# Metrics
duration: 2min
completed: 2026-02-17
---

# Phase 12 Plan 01: Windows Installer Packaging Summary

**PyInstaller --onedir bundling with all v3.0 hidden imports, Inno Setup per-user installer with shortcuts and user data preservation on uninstall**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-17T21:50:33Z
- **Completed:** 2026-02-17T21:52:26Z
- **Tasks:** 2/2 auto tasks completed (checkpoint pending)
- **Files modified:** 3

## Accomplishments
- Updated astra.spec from --onefile to --onedir (EXE + COLLECT) with all v3.0 hidden imports and chromadb data files
- Created Inno Setup installer script with per-user install, desktop/Start Menu shortcuts, and running-app detection
- Updated build_windows.bat to chain PyInstaller and Inno Setup with error handling at each step

## Task Commits

Each task was committed atomically:

1. **Task 1: Update PyInstaller spec for --onedir and fix hidden imports** - `ec23b45` (feat)
2. **Task 2: Create Inno Setup installer script** - `873f575` (feat)

## Files Created/Modified
- `astra.spec` - Switched to --onedir (EXE + COLLECT), added v3.0 hidden imports (platformdirs, requests, yaml, rank_bm25, audio_capture, dotenv), collect_data_files for chromadb, disabled UPX
- `build_windows.bat` - Chains PyInstaller and Inno Setup, error handling per step, graceful skip if iscc not found
- `installer/astra_setup.iss` - Inno Setup script: per-user install to {localappdata}\Astra, desktop shortcut, Start Menu entries, LZMA2 compression, running-app detection, user data preservation

## Decisions Made
- --onedir over --onefile: avoids AV false positives common with single-exe packing, faster startup since no temp extraction needed
- UPX disabled: triggers more AV false positives than the size savings justify
- Per-user install to {localappdata}\Astra: no admin rights required (PrivilegesRequired=lowest)
- User data in {localappdata}\astra\ (managed by platformdirs) is explicitly preserved on uninstall
- Pascal Script checks for running Astra.exe process before install/uninstall

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Checkpoint pending: user must test full build and install flow on a Windows machine
- After checkpoint approval, Phase 12 and v3.0 milestone will be complete

---
*Phase: 12-windows-installer-distribution*
*Completed: 2026-02-17*
