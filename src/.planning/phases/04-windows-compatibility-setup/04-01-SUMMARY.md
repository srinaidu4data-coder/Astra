---
phase: 04-windows-compatibility-setup
plan: 01
subsystem: audio
tags: [abstraction, refactor, audio-capture, pulseaudio, platform-agnostic]

# Dependency graph
requires:
  - phase: 02-transcription-optimization
    provides: optimized transcription with tiny.en model
provides:
  - Abstract AudioCapture interface
  - LinuxAudioCapture implementation
  - get_audio_capture() factory function
  - Platform detection for audio capture
affects: [04-02-windows-audio, gui.py, any-module-using-audio]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Abstract base class for platform abstraction"
    - "Factory function for platform-specific instantiation"
    - "Lazy imports for deferred dependencies"

key-files:
  created:
    - audio_capture.py
  modified:
    - transcriber.py
    - config.py

key-decisions:
  - "AudioCapture is abstract base class with abstract methods"
  - "Factory function get_audio_capture() handles platform detection"
  - "Device listing functions moved to audio_capture.py alongside capture logic"
  - "Windows raises NotImplementedError until Plan 04-02"

patterns-established:
  - "Platform-specific code isolated in audio_capture.py"
  - "Use factory functions for platform-agnostic instantiation"

# Metrics
duration: 3min
completed: 2026-01-20
---

# Phase 04 Plan 01: Audio Abstraction Layer Summary

**Platform-agnostic AudioCapture interface with abstract base class and Linux implementation; factory function for platform detection**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-20T01:35:09Z
- **Completed:** 2026-01-20T01:37:46Z
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 refactored)

## Accomplishments

- Created abstract AudioCapture base class with platform-agnostic interface
- Implemented LinuxAudioCapture using parec/pactl subprocess
- Added get_audio_capture() factory function with platform detection
- Decoupled transcriber.py from Linux-specific code
- Moved AudioSource dataclass and device listing to audio_capture.py

## Task Commits

Each task was committed atomically:

1. **Task 1: Create audio capture abstraction layer** - `0d41e43` (feat)
2. **Task 2: Refactor transcriber.py to use abstraction** - `2ffd3a9` (refactor)
3. **Task 3: Clean up config.py** - `a864390` (refactor)

**Plan metadata:** (this commit)

## Files Created/Modified

- `audio_capture.py` - New module with AudioCapture abstract base class, LinuxAudioCapture implementation, AudioSource dataclass, device listing functions, and get_audio_capture() factory
- `transcriber.py` - Removed SystemAudioCapture class, now imports from audio_capture module
- `config.py` - Removed AudioSource, list_audio_sources(), list_monitor_devices(); kept configuration constants

## Decisions Made

1. **Abstract base class pattern** - AudioCapture uses ABC with @abstractmethod decorators for clear interface contract
2. **Factory function for platform detection** - get_audio_capture() uses sys.platform to return appropriate implementation
3. **Windows raises NotImplementedError** - Clear error message directing to Plan 04-02 for WASAPI implementation
4. **Device listing in audio_capture.py** - Moved from config.py since it's audio capture functionality, not configuration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed successfully.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Audio abstraction layer complete and tested
- Ready for Plan 04-02: Windows audio backend (WASAPI via PyAudioWPatch)
- LinuxAudioCapture verified working on current system
- transcriber.py decoupled from platform-specific code

---
*Phase: 04-windows-compatibility-setup*
*Completed: 2026-01-20*
