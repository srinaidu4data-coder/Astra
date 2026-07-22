# Project Structure

**Analysis Date:** 2026-01-17

## Directory Layout

```
/home/vinay/astra-mvp/
├── main.py                 # Application entry point (82 lines)
├── gui.py                  # PyQt6 GUI application (958 lines)
├── config.py               # Configuration & audio utilities (191 lines)
├── transcriber.py          # Audio capture & STT (379 lines)
├── rag.py                  # RAG pipeline (225 lines)
├── ingest.py               # Document ingestion (262 lines)
│
├── requirements.txt        # Python dependencies
├── .env                    # API keys (git-ignored)
├── .gitignore              # Git ignore rules
│
├── chroma_db/              # ChromaDB persistent storage
│   └── chroma.sqlite3      # Vector database
│
├── documents/              # Documents for ingestion
│   └── *.pdf, *.txt, *.md
│
├── venv/                   # Python virtual environment
│
└── .planning/              # GSD project management
    └── codebase/           # Codebase analysis docs
        ├── STACK.md
        ├── INTEGRATIONS.md
        ├── ARCHITECTURE.md
        ├── STRUCTURE.md    # (this file)
        ├── CONVENTIONS.md
        ├── TESTING.md
        └── CONCERNS.md
```

## Module Overview

| File | Lines | Purpose |
|------|-------|---------|
| `main.py` | 82 | CLI entry point, orchestrates ingest/GUI |
| `gui.py` | 958 | PyQt6 desktop UI, state management |
| `config.py` | 191 | Audio/RAG configuration, device detection |
| `transcriber.py` | 379 | Audio capture, Whisper transcription |
| `rag.py` | 225 | RAG orchestration, question classification |
| `ingest.py` | 262 | Document processing, embedding pipeline |
| **Total** | **2097** | |

## Key Locations

### Entry Points

- **CLI Entry:** `main.py:main()`
- **GUI Entry:** `gui.py:AstraWindow`
- **Ingest Entry:** `ingest.py:ingest_folder()`

### Core Functions

| Function | File:Line | Purpose |
|----------|-----------|---------|
| `transcribe_audio()` | `transcriber.py:55` | Audio → Text |
| `search_context()` | `rag.py:21` | Query → Relevant chunks |
| `classify_utterance()` | `rag.py:97` | Text → Is interview question? |
| `generate_star_response()` | `rag.py:178` | Question + Context → STAR answer |
| `ask()` | `rag.py:216` | End-to-end RAG query |
| `ingest_folder()` | `ingest.py:159` | Folder → ChromaDB |

### Classes

| Class | File:Line | Purpose |
|-------|-----------|---------|
| `AstraWindow` | `gui.py:64` | Main application window |
| `SignalBridge` | `gui.py:51` | Thread-safe Qt signals |
| `ListeningState` | `gui.py:42` | State machine enum |
| `SystemAudioCapture` | `transcriber.py:90` | Audio capture manager |
| `ContinuousTranscriber` | `transcriber.py:295` | Streaming transcription |
| `AudioSource` | `config.py:38` | PulseAudio device info |

### Configuration

| Constant | File:Line | Value |
|----------|-----------|-------|
| `WHISPER_MODEL` | `config.py:17` | `"base.en"` |
| `LLM_MODEL` | `config.py:23` | `"gpt-4o"` |
| `CLASSIFICATION_MODEL` | `config.py:24` | `"gpt-4o-mini"` |
| `EMBEDDING_MODEL` | `config.py:22` | `"text-embedding-3-small"` |
| `COLLECTION_NAME` | `config.py:25` | `"astra_docs"` |
| `SILENCE_THRESHOLD` | `config.py:30` | `0.01` |
| `SILENCE_DURATION` | `config.py:31` | `2.0` |
| `CLASSIFICATION_CONFIDENCE` | `config.py:33` | `0.7` |

## Import Patterns

### Standard → Third-party → Local

```python
# Standard library
import subprocess
import threading
from collections.abc import Generator

# Third-party
from PyQt6.QtWidgets import QMainWindow
from faster_whisper import WhisperModel
import chromadb
from openai import OpenAI

# Local
from transcriber import SystemAudioCapture
from rag import ask, classify_utterance
from config import SILENCE_THRESHOLD
```

### Module Dependencies

```
gui.py
    → transcriber.py
    → rag.py
    → config.py

main.py
    → gui.py
    → ingest.py
    → chromadb

rag.py
    → chromadb
    → openai

ingest.py
    → chromadb
    → openai
    → pdfplumber

transcriber.py
    → faster_whisper
    → numpy
    → config.py

config.py
    → subprocess (pactl)
```

## File Type Support

| Type | Extension | Processor |
|------|-----------|-----------|
| Text | `.txt` | `read_txt_file()` |
| Markdown | `.md` | `read_txt_file()` |
| PDF | `.pdf` | `read_pdf_file()` (pdfplumber) |

## Generated Artifacts

| Path | Purpose | Git-ignored |
|------|---------|-------------|
| `chroma_db/` | Vector database | Yes |
| `venv/` | Virtual environment | Yes |
| `__pycache__/` | Python bytecode | Yes |
| `.env` | API keys | Yes |
| `*.pyc` | Compiled Python | Yes |

---

*Structure analysis: 2026-01-17*
*Update after adding new modules*
