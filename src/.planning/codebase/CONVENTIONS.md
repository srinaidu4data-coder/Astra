# Coding Conventions

**Analysis Date:** 2026-01-17

## Naming Conventions

### Functions: `snake_case`

```python
def read_txt_file(file_path: Path) -> str:
def search_context(query: str, top_k: int = 5) -> list[dict]:
def classify_utterance(text: str, min_words: int = 3) -> dict:
def get_default_monitor() -> str | None:
```

### Private Methods: `_leading_underscore`

```python
def _init_ui(self):
def _init_capture(self):
def _connect_signals(self):
def _update_level(self):
def _read_loop(self):
```

### Classes: `PascalCase`

```python
class AstraWindow(QMainWindow):
class SignalBridge(QObject):
class ListeningState:
class SystemAudioCapture:
class AudioSource:
```

### Constants: `UPPER_SNAKE_CASE`

```python
WHISPER_MODEL = "base.en"
AUDIO_SAMPLE_RATE = 16000
SILENCE_THRESHOLD = 0.01
COLLECTION_NAME = "astra_docs"
```

### Files: `lowercase_with_underscores`

```
config.py
transcriber.py
rag.py
ingest.py
gui.py
main.py
```

## Code Style

### Indentation

- 4 spaces (Python standard)
- No tabs

### Quotes

- Double quotes for strings consistently
- Triple double quotes for docstrings

```python
AUDIO_DEVICE = "alsa_output..."
CLASSIFICATION_PROMPT = """You are an interview..."""
```

### Line Length

- Generally follows PEP 8 (~79-100 chars)
- Long strings broken logically

### Imports Organization

1. Standard library
2. Third-party packages
3. Local modules

```python
# Standard
import subprocess
import threading
from pathlib import Path

# Third-party
from PyQt6.QtWidgets import QMainWindow
import chromadb
from openai import OpenAI

# Local
from config import SILENCE_THRESHOLD
from transcriber import SystemAudioCapture
```

## Documentation

### Module Docstrings

All files start with module-level docstring:

```python
#!/usr/bin/env python3
"""
Astra Interview Copilot - Configuration

Audio device configuration for Linux PipeWire/PulseAudio.
"""
```

### Function Docstrings

Google-style with Args/Returns sections:

```python
def search_context(query: str, top_k: int = 5) -> list[dict]:
    """
    Search for relevant document chunks based on a query.

    1. Embed the query using OpenAI text-embedding-3-small
    2. Search ChromaDB for top_k similar chunks
    3. Return list of {text, source_file, similarity_score}
    """
```

```python
def classify_utterance(text: str, min_words: int = 3) -> dict:
    """
    Classify if text is an interview question using GPT-4o-mini.

    Args:
        text: The transcribed text to classify
        min_words: Skip LLM classification if fewer words than this

    Returns:
        {
            "is_interview_question": bool,
            "question_type": "behavioral" | "technical" | ...,
            "confidence": float (0-1),
            "cleaned_question": str
        }
    """
```

### Inline Comments

Used sparingly for non-obvious logic:

```python
# ChromaDB returns cosine distance, convert to similarity
similarity_score = 1 - distance

# Fast path: skip LLM for very short utterances
if len(words) < min_words:
    return {...}
```

## Type Hints

### Function Signatures

```python
def read_file(file_path: Path) -> str:
def chunk_text(text: str, chunk_size: int = 500) -> list[str]:
def generate_star_response(question: str, context_chunks: list[dict]) -> Generator[str, None, None]:
def get_default_monitor() -> str | None:
```

### Generic Types

```python
from collections.abc import Generator

def ask(question: str) -> Generator[str, None, None]:
```

### Union Types (Python 3.10+)

```python
def get_default_monitor() -> str | None:
```

## Patterns

### Error Handling

Try-except with specific exceptions:

```python
try:
    result = json.loads(result_text)
except (json.JSONDecodeError, KeyError) as e:
    print(f"Classification parse error: {e}")
    return default_result
except Exception as e:
    print(f"Classification error: {e}")
    return default_result
```

### Configuration Injection

Constants in `config.py`, imported selectively:

```python
from config import (
    SILENCE_THRESHOLD,
    SILENCE_DURATION,
    CLASSIFICATION_CONFIDENCE,
)
```

### Factory/Lazy Loading

Global singleton with lazy initialization:

```python
_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        _whisper_model = WhisperModel(...)
    return _whisper_model
```

### Thread-Safe UI Updates

Qt signals for cross-thread communication:

```python
class SignalBridge(QObject):
    transcription_ready = pyqtSignal(str)
    answer_token = pyqtSignal(str)
    state_changed = pyqtSignal(str)

# In background thread:
self.signals.answer_token.emit(token)
```

### Resource Management

Context managers for file I/O:

```python
with open(file_path, "r", encoding="utf-8") as f:
    return f.read()

with pdfplumber.open(file_path) as pdf:
    for page in pdf.pages:
        ...
```

### Generator-Based Streaming

Yield tokens as they arrive:

```python
def generate_star_response(...) -> Generator[str, None, None]:
    stream = openai_client.chat.completions.create(..., stream=True)
    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

## Dataclasses

Used for structured data:

```python
from dataclasses import dataclass

@dataclass
class AudioSource:
    """Represents a PulseAudio/PipeWire audio source."""
    index: str
    name: str
    driver: str
    sample_spec: str
    state: str

    @property
    def is_monitor(self) -> bool:
        return ".monitor" in self.name
```

## GUI Conventions

### Stylesheet Formatting

Multi-line CSS-like strings:

```python
self.listen_btn.setStyleSheet("""
    QPushButton {
        background-color: #4a90d9;
        color: white;
        border: none;
        border-radius: 8px;
    }
    QPushButton:hover {
        background-color: #3a7bc8;
    }
""")
```

### Signal Connections

```python
self.listen_btn.clicked.connect(self._on_listen_toggle)
self.signals.transcription_ready.connect(self._on_transcription_ready)
```

---

*Conventions analysis: 2026-01-17*
*Update when establishing new patterns*
