# Testing

**Analysis Date:** 2026-01-17

## Current State

**No formal test suite exists.**

- No `tests/` directory
- No test files (`*_test.py`, `test_*.py`)
- No test configuration (pytest.ini, tox.ini)
- No CI/CD pipeline

## Manual Testing

### Entry Point Scripts

Each module has `if __name__ == "__main__":` for manual testing:

| File | Purpose |
|------|---------|
| `config.py` | Print audio devices and configuration |
| `transcriber.py` | 5-second audio capture demo |
| `rag.py` | Test RAG query with sample question |
| `ingest.py` | CLI for document ingestion |
| `main.py` | Full application entry point |

### Test Mode (GUI)

`gui.py` includes a classifier test mode:

```bash
python gui.py --test-classifier
```

Tests 12 utterances against question classification:
- Behavioral questions (expected: True)
- Technical questions (expected: True)
- Small talk/statements (expected: False)

**Test Utterances:**
```python
TEST_UTTERANCES = [
    ("Tell me about a time you led a difficult project", True),
    ("What's your experience with Python", True),
    ("Thanks for joining us today", False),
    # ... 9 more test cases
]
```

## Testing Gaps

### Critical Functions Needing Tests

| Function | File | Why Critical |
|----------|------|--------------|
| `classify_utterance()` | `rag.py:97` | JSON parsing, confidence thresholds |
| `chunk_text()` | `ingest.py:121` | Text splitting correctness |
| `search_context()` | `rag.py:21` | Vector search accuracy |
| `clean_pdf_text()` | `ingest.py:32` | Text normalization |
| `get_audio_level()` | `transcriber.py:261` | RMS calculation |

### Edge Cases Not Covered

- Empty audio buffer handling
- ChromaDB connection failures
- OpenAI API rate limits
- Malformed PDF files
- Unicode/encoding issues
- Very long transcriptions
- Concurrent auto-answer triggers

## Recommended Test Structure

```
tests/
├── conftest.py           # Shared fixtures
├── test_config.py        # Audio device utilities
├── test_transcriber.py   # Audio capture, transcription
├── test_rag.py           # Classification, search, generation
├── test_ingest.py        # Document processing, chunking
└── integration/
    ├── test_rag_flow.py  # End-to-end RAG
    └── test_gui.py       # UI state machine
```

## Fixtures Needed

```python
# conftest.py
@pytest.fixture
def sample_audio_bytes():
    """16kHz mono audio sample."""
    ...

@pytest.fixture
def mock_openai_client():
    """Mocked OpenAI API responses."""
    ...

@pytest.fixture
def temp_chromadb():
    """Temporary ChromaDB collection."""
    ...

@pytest.fixture
def sample_pdf():
    """Sample PDF with known content."""
    ...
```

## Testing Tools Recommended

| Tool | Purpose |
|------|---------|
| pytest | Test runner |
| pytest-cov | Coverage reporting |
| pytest-mock | Mocking utilities |
| pytest-qt | PyQt6 testing |
| responses | HTTP mocking for OpenAI |

## Coverage Targets

| Module | Current | Target |
|--------|---------|--------|
| `config.py` | 0% | 80% |
| `transcriber.py` | 0% | 60% |
| `rag.py` | 0% | 90% |
| `ingest.py` | 0% | 85% |
| `gui.py` | 0% | 40% |

## Linting & Formatting

**No tools configured.**

Recommended setup:

```toml
# pyproject.toml
[tool.ruff]
line-length = 100
select = ["E", "F", "I", "N", "W"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-v --cov=. --cov-report=term-missing"
```

---

*Testing analysis: 2026-01-17*
*Update after establishing test suite*
