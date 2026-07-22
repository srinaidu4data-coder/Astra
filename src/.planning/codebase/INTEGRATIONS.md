# External Integrations

**Analysis Date:** 2026-01-17

## APIs

### OpenAI API (via Backend Proxy)

**Authentication:**
- License key as Bearer token via backend proxy
- All calls routed through proxy at `get_proxy_url()` (default: https://astra-proxy.up.railway.app/v1)
- No direct OpenAI API key on desktop client

**Models Used:**
| Model | Purpose | Location |
|-------|---------|----------|
| `gpt-4o` | STAR-format answer generation | `rag.py:203` |
| `gpt-4o-mini` | Fast question classification | `rag.py:18, 127` |
| `text-embedding-3-small` | Text embeddings for RAG | `rag.py:17, 40`, `ingest.py` |

**Integration Points:**
- `rag.py` - Main RAG module
  - `search_context()` - Embeds query for vector search
  - `classify_utterance()` - Classifies utterances as questions
  - `generate_star_response()` - Streams STAR-format answers
- `ingest.py` - Document ingestion
  - `get_embeddings()` - Batch embedding generation for chunks

**Features Used:**
- `openai.embeddings.create()` - Text embeddings
- `openai.chat.completions.create()` - Chat completions
- `stream=True` - Streaming responses for real-time UI updates

## Databases

### ChromaDB (Vector Database)

**Purpose:** Store and retrieve document embeddings for RAG

**Configuration:**
- Storage: Local persistent SQLite at `./chroma_db/`
- Collection: `astra_docs`
- Distance metric: Cosine similarity

**Integration Points:**
- `main.py` - Checks document count on startup
- `rag.py:31-51` - Semantic search queries
- `ingest.py:159-245` - Document storage with embeddings

**Operations:**
- `PersistentClient(path="./chroma_db/")` - Initialize
- `collection.query()` - Vector similarity search
- `collection.add()` - Store embedded documents
- `collection.count()` - Check document count

## System Services

### PulseAudio/PipeWire (Audio)

**Purpose:** Capture system audio output (what you hear)

**Implementation:** `transcriber.py` via `parec` subprocess

**Configuration:**
- Sample rate: 16000 Hz (Whisper requirement)
- Channels: 1 (mono)
- Format: s16le (signed 16-bit little-endian)

**Commands:**
```bash
parec --device=<monitor> --rate=16000 --channels=1 --format=s16le
pactl list sources short  # Device discovery
```

**Integration Points:**
- `config.py:55-99` - Device listing via `pactl`
- `transcriber.py:141-180` - Audio capture via `parec` subprocess

## Local Models

### Faster-Whisper (Speech-to-Text)

**Purpose:** Transcribe audio to text (offline)

**Configuration:**
- Model: `base.en` (English only, ~150MB)
- Device: CPU
- Compute type: int8 quantization

**Integration Point:** `transcriber.py:37-87`

**Features:**
- VAD filtering for speech detection
- Beam size=1 for faster inference
- Language forced to English

## File Processing

### pdfplumber (PDF Extraction)

**Purpose:** Extract text from PDF documents

**Integration Point:** `ingest.py:69-106`

**Features:**
- Page-by-page extraction
- Layout preservation
- Bullet point detection and normalization

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Astra MVP Data Flow                       │
└─────────────────────────────────────────────────────────────────┘

Document Ingestion:
  PDF/TXT/MD → pdfplumber → chunk_text() → OpenAI Embeddings → ChromaDB

Real-time Processing:
  System Audio (PipeWire) → parec subprocess → numpy buffer
       ↓
  Silence Detection → Faster-Whisper (local) → Transcription
       ↓
  classify_utterance() → GPT-4o-mini → Is Interview Question?
       ↓ (if yes)
  search_context() → ChromaDB → Relevant Chunks
       ↓
  generate_star_response() → GPT-4o (streaming) → PyQt6 GUI
```

## Integration Summary

| Service | Type | Location | Required |
|---------|------|----------|----------|
| OpenAI API (via proxy) | Cloud API | `rag.py`, `ingest.py` | Yes (license key) |
| ChromaDB | Local DB | `./chroma_db/` | Auto-created |
| PipeWire/PulseAudio | System | Linux only | Yes |
| Faster-Whisper | Local Model | `transcriber.py` | Auto-download |
| pdfplumber | Library | `ingest.py` | For PDF support |

## Not Used

- No payment processing
- No user authentication
- No cloud storage
- No analytics/telemetry
- No webhooks/callbacks

---

*Integration analysis: 2026-01-17*
*Update after adding external services*
