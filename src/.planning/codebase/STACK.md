# Technology Stack

**Analysis Date:** 2026-01-17

## Languages

**Primary:**
- Python 3.12 - All application code

**Secondary:**
- None

## Runtime

**Environment:**
- Python 3.12.3 (via virtual environment)
- Linux-based platform (PipeWire/PulseAudio audio system)

**Package Manager:**
- pip (via venv)
- Lockfile: `requirements.txt` (no version pinning)

## Frameworks

**Core:**
- PyQt6 - Desktop GUI framework (`gui.py`)

**Testing:**
- None (manual testing only via `if __name__ == "__main__"` blocks)

**Build/Dev:**
- No build tools (pure Python)

## Key Dependencies

**Critical:**
- faster-whisper - Speech-to-text transcription (`transcriber.py`)
- chromadb - Vector database for RAG (`rag.py`, `ingest.py`, `main.py`)
- openai - LLM API client for GPT-4o and embeddings (`rag.py`, `ingest.py`)
- PyQt6 - Desktop GUI framework (`gui.py`)

**Infrastructure:**
- numpy - Audio buffer manipulation and RMS calculations (`transcriber.py`)
- pdfplumber - PDF text extraction with layout preservation (`ingest.py`)
- python-dotenv - Environment variable loading (`.env` file)
- requests - HTTP calls for license activation/deactivation (`gui.py`)

## Configuration

**Environment:**
- `~/.config/astra/.env` for LICENSE_KEY and PROXY_URL (via platformdirs)
- No OpenAI API key on desktop -- all LLM calls route through backend proxy

**Build:**
- `config.py` - Central configuration module with:
  - Audio device settings (AUDIO_DEVICE, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS)
  - Whisper settings (WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE)
  - RAG parameters (EMBEDDING_MODEL, LLM_MODEL, COLLECTION_NAME, CHUNK_SIZE)
  - Auto-answer thresholds (SILENCE_THRESHOLD, SILENCE_DURATION, CLASSIFICATION_CONFIDENCE)

## Platform Requirements

**Development:**
- Linux with PipeWire/PulseAudio (uses `parec` command)
- `portaudio19-dev` system package (for pyaudio)

**Production:**
- Desktop application (not web-deployed)
- Runs locally with OpenAI API access

---

*Stack analysis: 2026-01-17*
*Update after major dependency changes*
