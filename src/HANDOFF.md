# Astra — Session Handoff

**Path:** `C:\Users\montg\OneDrive\Desktop\Astra\src`  
**Last updated:** 2026-07-22 (local)

## Run the app
```bat
cd C:\Users\montg\OneDrive\Desktop\Astra\src
run.bat
```
Or: `venv\Scripts\python.exe main.py`  
Use **Python 3.11 venv** in `src\venv` (not system 3.14).

## What this product is
Desktop **interview copilot** (Final Round / Parakeet style):
- Dark UI + Home Depot orange `#F96302`
- **Live auto answers** (no Generate click required)
- **Stealth ON** = hidden from most screen shares (Windows)
- **Stereo Mix** capture (system audio)
- License temporarily **OFF** (`config.LICENSE_ENABLED = False`) — uses `OPENAI_API_KEY` from `src\.env`

## Important files
| File | Role |
|------|------|
| `gui.py` | Main UI, live VAD, auto pipeline, stealth button |
| `theme.py` | Premium dark + HD orange styles |
| `stealth.py` | `SetWindowDisplayAffinity` exclude from capture |
| `windows_capture.py` | Stereo Mix / sounddevice capture + pre-gain VAD |
| `audio_capture.py` | Ring buffer + factory |
| `transcriber.py` | Whisper + quiet-audio boost |
| `rag.py` | Classify + Best Answer / bullets (direct OpenAI when license off) |
| `config.py` | Thresholds, `LICENSE_ENABLED`, prompts |
| `test_audio/ai_ml_interview_20q.mp3` | 20 AI/ML Qs + 12s gaps (~5.6 min) |
| `generate_interview_audio.py` | Regenerates practice audio |

## Live auto path
Start Session → adaptive VAD (pre-gain) → silence / max 14s → STT → soft classify → stream Best Answer.

## Known notes
- Browser `http://127.0.0.1:8000` is **API only**, not the interview UI.
- Prefer `run.bat` for the desktop copilot.
- Stealth needs Win10 2004+; share a window/app when testing if needed.
- Unit tests: `python -m pytest tests -q` (from `src`, with deps).

## Flip licensing back later
In `config.py`: `LICENSE_ENABLED = True`
