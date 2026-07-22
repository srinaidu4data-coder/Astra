# Architecture

**Analysis Date:** 2026-01-17

## Pattern

**Layered Monolith with Document RAG Pipeline**

Single Python application with clear separation between:
- Presentation (GUI)
- Application/Service (RAG, Transcription)
- Data Access (ChromaDB, OpenAI)
- Configuration

## Layers

### 1. Presentation Layer

**File:** `gui.py` (958 lines)

**Responsibilities:**
- PyQt6 desktop interface
- User interaction handling
- Audio device selection
- Real-time state visualization
- Dual modes: Manual Q&A and Auto-Answer

**Key Classes:**
- `AstraWindow` - Main window with all UI components
- `SignalBridge` - Thread-safe signal emission for background workers
- `ListeningState` - State machine enum (IDLE → LISTENING → HEARING → PROCESSING → GENERATING)

### 2. Application/Service Layer

**Files:**
- `rag.py` (225 lines) - RAG orchestration
- `transcriber.py` (379 lines) - Audio capture and STT
- `ingest.py` (262 lines) - Document processing

**Responsibilities:**
- Question classification
- Context retrieval
- Answer generation
- Audio capture and transcription
- Document chunking and embedding

### 3. Data Access Layer

**Integration Points:**
- ChromaDB - Vector store operations
- OpenAI API - Embeddings and completions
- PulseAudio - System audio capture

### 4. Configuration Layer

**File:** `config.py` (191 lines)

**Responsibilities:**
- Audio device detection
- Model settings (Whisper, OpenAI)
- RAG parameters
- Auto-answer thresholds

## Key Abstractions

### SystemAudioCapture (`transcriber.py`)

Manages PulseAudio capture lifecycle:
- `start_capture()` - Spawns `parec` subprocess
- `get_last_n_seconds()` - Rolling buffer retrieval
- `get_audio_level()` - RMS-based level for UI

### SignalBridge (`gui.py`)

Thread-safe Qt signal emission for background workers:
```python
signals.transcription_ready.emit(text)
signals.answer_token.emit(token)
signals.state_changed.emit(state)
```

### RAG Pipeline (`rag.py`)

- `search_context()` - Semantic search in ChromaDB
- `classify_utterance()` - Question detection with confidence
- `generate_star_response()` - Streaming answer generation

## Data Flow

### Manual Mode

```
User clicks "Get Answer"
    ↓
transcriber.transcribe_audio()
    ↓
rag.search_context(query)
    ↓
rag.generate_star_response(question, chunks)
    ↓
Stream tokens to GUI
```

### Auto-Answer Mode

```
Audio capture running (100ms timer)
    ↓
Silence detected (>2s after speech)
    ↓
get_last_n_seconds() → transcribe_audio()
    ↓
classify_utterance() → gpt-4o-mini
    ↓
If is_interview_question && confidence >= threshold:
    ↓
rag.ask() → Stream answer
```

## Entry Points

| Entry | Command | Purpose |
|-------|---------|---------|
| GUI | `python main.py` | Launch desktop application |
| Ingest | `python main.py --ingest ./docs/` | Ingest documents to ChromaDB |
| Config | `python config.py` | Print audio configuration |
| Transcriber | `python transcriber.py` | Test audio capture |

## Threading Model

```
Main Thread (Qt Event Loop)
    │
    ├── QTimer (100ms) → _update_level()
    │                         ↓
    │                    Auto-answer detection
    │
    └── Background Threads (daemon=True)
            ├── _auto_process_audio()
            ├── _process_audio()
            └── _run_test()
```

**Signal Communication:**
- Background threads emit Qt signals
- Main thread handles UI updates via signal slots

## State Machine (Auto-Answer)

```
         ┌──────────────────────────────────────────┐
         │                                          │
         ▼                                          │
      [IDLE] ─────────────────────────────────────►│
         │ Start Listening                          │
         ▼                                          │
    [LISTENING] ◄─────────────────────────────────►│
         │ Audio detected                           │ Stop
         ▼                                          │ Listening
     [HEARING] ─────────────────────────────────────►│
         │ Silence (2s)                             │
         ▼                                          │
   [PROCESSING] ────────────────────────────────────►│
         │ Question classified                      │
         ▼                                          │
   [GENERATING] ───────────────────────────────────►│
         │ Answer complete                          │
         └──────────► [LISTENING]                   │
                                                    │
                      └─────────────────────────────┘
```

## Dependency Graph

```
main.py
    ├── gui.py (launch_gui)
    │      ├── transcriber.py (SystemAudioCapture, transcribe_audio)
    │      ├── rag.py (ask, classify_utterance)
    │      └── config.py (thresholds, sample rate)
    │
    └── ingest.py (run_ingestion)
           ├── chromadb
           └── openai (embeddings)

rag.py
    ├── chromadb (search)
    └── openai (embeddings, completions)

transcriber.py
    ├── faster_whisper
    ├── numpy
    └── subprocess (parec)
/gsd
config.py
    └── subprocess (pactl)
```

## Design Decisions

1. **Subprocess for Audio** - Uses `parec` rather than direct PulseAudio bindings for simplicity and reliability

2. **Daemon Threads** - Background processing threads are daemon=True to allow clean app exit

3. **Streaming Responses** - OpenAI responses stream token-by-token for responsive UI

4. **Local STT** - Whisper runs locally for privacy; only classified questions hit OpenAI

5. **Single Collection** - All documents in one ChromaDB collection for simplicity

---

*Architecture analysis: 2026-01-17*
*Update after major structural changes*
