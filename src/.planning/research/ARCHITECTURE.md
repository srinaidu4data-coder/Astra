# Architecture Research: Desktop App + Backend Proxy for LLM API Gating

**Domain:** Desktop interview copilot (Python/PyQt6/OpenAI) with local RAG
**Date:** 2026-02-16
**Confidence Level:** HIGH -- patterns are well-established across production LLM proxy systems, FastAPI documentation, and the OpenAI Python SDK. Multiple independent sources confirm the same architectural approach.

---

## System Overview

```
 CURRENT ARCHITECTURE (v2.x)
 ============================

 +--------------------------------------------------+
 |              User's Windows Machine               |
 |                                                   |
 |  +-----------+    +----------+    +----------+    |        +-----------+
 |  |  Whisper  |--->| Question |    | ChromaDB |    |        |           |
 |  |  (local)  |    | Classify |    |  (local) |    |        |  OpenAI   |
 |  +-----------+    +-----+----+    +-----+----+    |        |    API    |
 |       ^                 |               |         |        |           |
 |   [audio]          [question]      [RAG chunks]   |        +-----------+
 |       |                 |               |         |              ^
 |  +-----------+    +-----v---------------v----+    |              |
 |  |   Audio   |    |        rag.py            |----|--[API key]---+
 |  |  Capture  |    |  Build prompt + call LLM |    |  [prompt]
 |  +-----------+    +--------------------------+    |  [streaming]
 |                                                   |
 +--------------------------------------------------+
       Problem: API key lives on client machine
       Problem: No access control / license gating


 TARGET ARCHITECTURE (v3.0)
 ===========================

 +--------------------------------------------------+       +------------------+       +----------+
 |              User's Windows Machine               |       |  Backend Proxy   |       |          |
 |                                                   |       |  (Railway/Fly)   |       |  OpenAI  |
 |  +-----------+    +----------+    +----------+    |       |                  |       |   API    |
 |  |  Whisper  |--->| Question |--->| ChromaDB |    |       | +------------+  |       |          |
 |  |  (local)  |    | Classify |    |  (local) |    |       | | License    |  |       +----------+
 |  +-----------+    | (local!) |    +-----+----+    |       | | Validation |  |            ^
 |       ^           +----------+          |         |       | +-----+------+  |            |
 |   [audio]                          [RAG chunks]   |       |       |         |            |
 |       |                                 |         |       |  PASS | FAIL    |            |
 |  +-----------+    +---------------------v----+    |       |       v         |            |
 |  |   Audio   |    |        rag.py            |    | HTTPS | +------------+  |   HTTPS    |
 |  |  Capture  |    |  Build prompt locally    |----|------>| | Forwarding |--|----------->|
 |  +-----------+    |  Send to proxy (not OAI) |    |       | |   Layer    |  |            |
 |                   +--------------------------+    |       | +------------+  |            |
 |                                                   |       |                  |            |
 |  What stays LOCAL:                                |       | What proxy does: |            |
 |  - Audio capture & transcription                  |       | - Validate key   |            |
 |  - Question classification (moved local!)         |       | - Add OAI API key|            |
 |  - ChromaDB / document storage                    |       | - Forward request|            |
 |  - RAG retrieval & prompt building                |       | - Stream response|            |
 |  - BM25 + dense hybrid search                     |       | - Rate limit     |            |
 |  - All user documents                             |       | - Usage tracking |            |
 +--------------------------------------------------+       +------------------+            |
                                                                                             |
    Only the ASSEMBLED PROMPT crosses the network ---------------------------------->--------+
    (contains question + RAG context snippets, NOT raw documents)
```

---

## Component Responsibilities

| Component | Location | Responsibility | Data It Handles |
|-----------|----------|---------------|-----------------|
| Audio Capture | Local | System audio via WASAPI/PulseAudio | Raw audio bytes (never leaves machine) |
| Whisper Transcription | Local | Speech-to-text | Audio -> text (never leaves machine) |
| Question Classifier | Local (v3.0 change) | Detect interview questions | Transcribed text (local inference or local LLM call) |
| ChromaDB | Local | Vector store for document chunks | User documents, embeddings (never leaves machine) |
| BM25 Index | Local | Sparse keyword search | Tokenized document corpus (never leaves machine) |
| RAG Module (rag.py) | Local | Retrieve context, build prompt, call proxy | Assembled prompts (sent to proxy) |
| PyQt6 GUI | Local | User interface, display answers | All UI state (local) |
| **Backend Proxy** | **Cloud (Railway/Fly)** | **License validation, request forwarding** | **License keys, assembled prompts (transient, not stored)** |
| OpenAI API | Cloud (OpenAI) | LLM inference | Prompts and completions |

### Key v3.0 Change: Question Classification Moves Local

Currently `classify_utterance()` in `rag.py` calls `gpt-4o-mini` directly. For v3.0, this should be **moved to local classification** (rule-based or small local model) to avoid routing every utterance through the proxy. Only answer-generation calls (`generate_star_response`, `generate_bullet_response`, `generate_script_response`) should go through the proxy. This reduces proxy load and latency for the classification hot path.

If local classification is not feasible in v3.0, classification calls can also route through the proxy, but this adds ~100-200ms to the classification step.

---

## Recommended Project Structure

```
astra-mvp/
|-- main.py                     # Desktop app entry point (unchanged)
|-- gui.py                      # PyQt6 GUI (unchanged)
|-- rag.py                      # RAG module (modified: calls proxy instead of OpenAI)
|-- config.py                   # Config (modified: license key storage, proxy URL)
|-- transcriber.py              # Whisper (unchanged)
|-- audio_capture.py            # Audio (unchanged)
|-- ingest.py                   # Document ingestion (unchanged)
|-- api_client.py               # NEW: HTTP client for proxy communication
|
|-- backend/                    # NEW: Backend proxy server (separate deployable)
|   |-- main.py                 # FastAPI app entry point
|   |-- auth.py                 # License key validation logic
|   |-- proxy.py                # OpenAI forwarding logic
|   |-- models.py               # Pydantic request/response models
|   |-- config.py               # Backend configuration (env vars)
|   |-- middleware.py            # Rate limiting, logging, CORS
|   |-- license_manager.py      # License key generation/management CLI tool
|   |-- requirements.txt        # Backend-only dependencies
|   |-- Dockerfile              # Container for deployment
|   |-- Procfile                # Railway/Fly process declaration
|   +-- .env.example            # Template for backend env vars
|
|-- requirements.txt            # Desktop app dependencies (add httpx)
|-- prompts.yaml                # Prompt configuration (unchanged, stays local)
+-- ...
```

### Why a Separate `backend/` Directory

The backend proxy is a **separate deployable unit**. It has its own dependencies (FastAPI, uvicorn), its own Dockerfile, and gets deployed independently from the desktop app. Keeping it in the same repo (monorepo approach) simplifies development while allowing independent deployment.

---

## Architectural Patterns

### Pattern 1: Thin Forwarding Proxy (Primary Pattern)

The proxy does NOT reimplement OpenAI's API. It receives a chat completion request, validates the license key, injects the real OpenAI API key, and forwards the request to OpenAI using the OpenAI Python SDK's `AsyncOpenAI` client. The response streams back through the proxy to the desktop client.

```
Desktop App                    Proxy Server                    OpenAI API
    |                              |                              |
    |-- POST /v1/chat/completions->|                              |
    |   Headers:                   |                              |
    |     X-License-Key: abc123    |                              |
    |   Body:                      |                              |
    |     {model, messages,        |-- Validate license key       |
    |      stream: true}           |                              |
    |                              |-- Add Authorization header   |
    |                              |   Bearer sk-real-openai-key  |
    |                              |                              |
    |                              |-- POST /v1/chat/completions->|
    |                              |   (same body, real API key)  |
    |                              |                              |
    |                              |<-- SSE stream chunks --------|
    |<-- SSE stream chunks --------|                              |
    |   (forwarded as-is)          |                              |
```

**Key insight:** The proxy mirrors OpenAI's `/v1/chat/completions` endpoint shape exactly. This means the desktop app can use the standard `OpenAI` Python SDK with a custom `base_url` pointing to the proxy, requiring minimal code changes.

### Pattern 2: OpenAI SDK `base_url` Redirect (Client-Side Pattern)

The OpenAI Python SDK supports a `base_url` parameter that redirects all API calls to a custom endpoint. This is the **lowest-friction client-side change**.

```python
# BEFORE (v2.x) - Direct OpenAI calls
from openai import OpenAI
client = OpenAI(api_key=user_provided_key)

# AFTER (v3.0) - Route through proxy
from openai import OpenAI
client = OpenAI(
    base_url="https://astra-proxy.railway.app/v1",
    api_key="license-key-abc123",  # License key goes in api_key field
)
# OR use a custom header approach:
client = OpenAI(
    base_url="https://astra-proxy.railway.app/v1",
    api_key="not-used",  # Proxy ignores this
    default_headers={"X-License-Key": "abc123"},
)
```

The SDK transparently sends all requests to the proxy URL instead of `api.openai.com`. The proxy extracts the license key, validates it, swaps in the real OpenAI API key, and forwards the request.

**Recommended approach:** Use the `api_key` field to carry the license key. The proxy extracts it from the `Authorization: Bearer <license-key>` header, validates it, then replaces it with the real OpenAI key before forwarding. This requires zero custom header logic and works with the SDK as-is.

### Pattern 3: FastAPI Dependency Injection for Auth (Middleware Pattern)

```python
# backend/auth.py
from fastapi import Security, HTTPException
from fastapi.security import APIKeyHeader

license_key_header = APIKeyHeader(name="Authorization", auto_error=False)

async def validate_license(auth_header: str = Security(license_key_header)) -> str:
    """Validate the license key from the Authorization header."""
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing license key")

    license_key = auth_header.removeprefix("Bearer ")

    if not is_valid_license(license_key):
        raise HTTPException(status_code=403, detail="Invalid or expired license key")

    return license_key

# backend/proxy.py
from fastapi import APIRouter, Depends
router = APIRouter()

@router.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    license_key: str = Depends(validate_license),
):
    # License is already validated by the dependency
    # Forward to OpenAI with real API key
    ...
```

This pattern uses FastAPI's dependency injection to validate the license key before any endpoint logic runs. If validation fails, the request is rejected with a 401/403 before touching OpenAI.

### Pattern 4: HMAC-Based License Key Generation (License Pattern)

For a basic deterrent (not trying to stop determined attackers), use HMAC-SHA256 to generate deterministic license keys from a secret + user identifier.

```python
# backend/license_manager.py
import hmac
import hashlib
import time

SECRET_KEY = "server-side-secret-never-in-client"  # From env var

def generate_license_key(user_id: str, tier: str = "standard") -> str:
    """Generate a license key for a user."""
    payload = f"{user_id}:{tier}:{int(time.time())}"
    signature = hmac.new(
        SECRET_KEY.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()[:16]
    return f"ASTRA-{signature.upper()}-{tier[0].upper()}"

def validate_license_key(key: str) -> bool:
    """Validate against database of issued keys."""
    # Look up in database/dict of valid keys
    return key in VALID_KEYS_DB
```

For v3.0's "basic deterrent" requirement, a simple approach works:
1. Generate keys offline with a CLI tool
2. Store valid keys in a database/dict on the proxy
3. Proxy checks incoming key against the store
4. No need for cryptographic verification on every request -- just a lookup

---

## Data Flow Diagrams

### Request Flow: Answer Generation

```
1. User asks question (audio captured locally)
2. Whisper transcribes locally                          [LOCAL - no network]
3. Question classified locally                          [LOCAL - no network]
4. ChromaDB hybrid search retrieves context chunks      [LOCAL - no network]
5. rag.py builds full prompt with RAG context embedded  [LOCAL - no network]
6. rag.py sends assembled prompt to proxy               [NETWORK - HTTPS]
   +----------------------------------------------------------+
   | POST https://astra-proxy.railway.app/v1/chat/completions |
   | Authorization: Bearer <license-key>                       |
   | Content-Type: application/json                            |
   |                                                           |
   | {                                                         |
   |   "model": "gpt-4o",                                     |
   |   "messages": [                                           |
   |     {"role": "system", "content": "<system prompt>"},     |
   |     {"role": "user", "content": "<RAG context + question>"}|
   |   ],                                                      |
   |   "stream": true,                                         |
   |   "temperature": 0.7                                      |
   | }                                                         |
   +----------------------------------------------------------+
7. Proxy validates license key                          [PROXY]
8. Proxy injects real OpenAI API key                    [PROXY]
9. Proxy forwards to OpenAI                             [PROXY -> OPENAI]
10. OpenAI streams response back through proxy          [OPENAI -> PROXY -> CLIENT]
11. Desktop app displays streamed tokens in GUI         [LOCAL]
```

### License Validation Flow

```
  Desktop App                         Proxy                        Key Store
      |                                 |                              |
      |--- POST /v1/chat/completions -->|                              |
      |    Auth: Bearer ASTRA-ABC123-S  |                              |
      |                                 |--- lookup("ASTRA-ABC123-S")->|
      |                                 |                              |
      |                                 |<-- {valid: true, tier: "std"}|
      |                                 |                              |
      |                        [key valid, proceed]                    |
      |                                 |                              |
      |                                 |--- forward to OpenAI ------->
      |<--- SSE stream response --------|
      |                                 |


  INVALID KEY FLOW:
      |                                 |
      |--- POST /v1/chat/completions -->|
      |    Auth: Bearer INVALID-KEY     |
      |                                 |--- lookup("INVALID-KEY") --->|
      |                                 |<-- {valid: false}            |
      |                                 |                              |
      |<--- 403 {"error": "Invalid     |
      |      or expired license key"}   |
```

### Startup / License Entry Flow

```
  +-------------------+     +------------------+     +------------------+
  | App Launch        |---->| License Key      |---->| Validate with    |
  |                   |     | Entry Screen     |     | Proxy Server     |
  +-------------------+     +--------+---------+     +--------+---------+
                                     |                         |
                              [user enters key]         [POST /v1/validate]
                                     |                         |
                                     v                         v
                            +--------+---------+     +--------+---------+
                            | Store key locally|<----| 200 OK: valid    |
                            | (platformdirs)   |     | OR               |
                            +--------+---------+     | 403: invalid     |
                                     |               +------------------+
                                     v
                            +------------------+
                            | Normal App Flow  |
                            | (main screen)    |
                            +------------------+
```

---

## Backend Proxy: Detailed Implementation Architecture

### Core Proxy Server (FastAPI)

```python
# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from openai import AsyncOpenAI
import os

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize shared OpenAI client
    app.state.openai_client = AsyncOpenAI(
        api_key=os.environ["OPENAI_API_KEY"]
    )
    yield
    # Shutdown: cleanup
    await app.state.openai_client.close()

app = FastAPI(title="Astra Proxy", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Desktop app, not browser - CORS is informational
    allow_methods=["POST"],
    allow_headers=["*"],
)
```

### Streaming Forwarding Endpoint

```python
# backend/proxy.py
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from auth import validate_license

router = APIRouter()

@router.post("/v1/chat/completions")
async def proxy_chat_completions(
    request: Request,
    license_key: str = Depends(validate_license),
):
    body = await request.json()
    openai_client = request.app.state.openai_client
    is_streaming = body.get("stream", False)

    if is_streaming:
        # Streaming: forward SSE chunks
        response = await openai_client.chat.completions.create(**body, stream=True)

        async def stream_generator():
            async for chunk in response:
                yield f"data: {chunk.model_dump_json()}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            stream_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    else:
        # Non-streaming: forward and return
        response = await openai_client.chat.completions.create(**body)
        return response.model_dump()
```

### What the Proxy Does NOT Do

- Does NOT store or log prompts/responses (privacy)
- Does NOT parse or modify the prompt content
- Does NOT run RAG or embeddings (that is local)
- Does NOT serve the desktop app (separate distribution)
- Does NOT manage user accounts (license keys are pre-generated)

---

## Integration Points

### 1. OpenAI API Integration

**Endpoint mirrored:** `/v1/chat/completions`
**SDK compatibility:** The proxy mimics OpenAI's API shape, so the desktop app can use the standard `openai` Python SDK with `base_url` pointed at the proxy.

**What the proxy must support:**
- Streaming responses (SSE) -- used by `generate_star_response`, `generate_script_response`
- Non-streaming responses -- used by `classify_utterance` (if not moved local)
- Models: `gpt-4o`, `gpt-4o-mini`
- Parameters: `messages`, `model`, `stream`, `temperature`, `max_tokens`

**What the proxy does NOT need to support:**
- Embeddings API (`/v1/embeddings`) -- embeddings for RAG happen locally via ChromaDB
- Assistants API, Files API, Images API -- not used
- Function calling -- not currently used

### 2. Hosting Provider (Railway recommended)

**Why Railway over Fly.io for this use case:**
- Simpler deployment (git push or Dockerfile)
- Usage-based pricing fits low-traffic proxy
- Built-in environment variable management
- No need for Fly's edge/multi-region (proxy is latency-tolerant at ~50-200ms)
- $5/month hobby plan is sufficient

**Railway deployment:**
```dockerfile
# backend/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$PORT"]
```

```
# backend/Procfile
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

**Environment variables on Railway:**
```
OPENAI_API_KEY=sk-real-openai-key-here
LICENSE_SECRET_KEY=server-side-secret-for-hmac
VALID_LICENSE_KEYS=ASTRA-ABC123-S,ASTRA-DEF456-S  # Or use a database
```

### 3. Client-Side Integration (Desktop App Changes)

**Files that need modification:**

| File | Change | Reason |
|------|--------|--------|
| `rag.py` | Replace `OpenAI(api_key=...)` with `OpenAI(base_url=proxy_url, api_key=license_key)` | Route LLM calls through proxy |
| `config.py` | Add `get_license_key()`, `get_proxy_url()`, remove `get_api_key()` for LLM calls | License key replaces API key |
| `config.py` | Keep `get_api_key()` ONLY for local embeddings if needed | Embeddings stay local |
| NEW `api_client.py` | Centralized proxy client factory | Single place to configure proxy connection |
| `gui.py` | Add license key entry screen at startup | User enters license key before using app |

**Minimal change to rag.py:**
```python
# BEFORE (current)
from config import get_api_key
openai_client = OpenAI(api_key=get_api_key())

# AFTER (v3.0)
from api_client import get_openai_client
openai_client = get_openai_client()  # Returns client configured for proxy
```

```python
# api_client.py (NEW)
from openai import OpenAI
from config import get_license_key, get_proxy_url

_client = None

def get_openai_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            base_url=get_proxy_url(),      # "https://astra-proxy.railway.app/v1"
            api_key=get_license_key(),      # "ASTRA-ABC123-S"
        )
    return _client

def reset_client():
    """Reset client (e.g., after license key change)."""
    global _client
    _client = None
```

---

## Error Handling and Fallback Patterns

### Proxy Failure Modes

| Failure | HTTP Code | Client Behavior |
|---------|-----------|-----------------|
| Invalid license key | 403 | Show "Invalid license key" dialog, prompt re-entry |
| Expired license key | 403 | Show "License expired" with renewal instructions |
| Proxy server down | Connection error | Show "Service temporarily unavailable, retrying..." |
| Proxy timeout | 504 | Retry once, then show timeout message |
| OpenAI API error | 502 (forwarded) | Show OpenAI's error message to user |
| Rate limited (proxy) | 429 | Show "Too many requests, please wait" |
| Rate limited (OpenAI) | 429 (forwarded) | Same -- proxy forwards OpenAI's 429 |

### Client-Side Error Handling

```python
# In rag.py or api_client.py
import httpx
from openai import OpenAI, APIError, APIConnectionError, RateLimitError

def call_with_retry(func, *args, max_retries=2, **kwargs):
    for attempt in range(max_retries + 1):
        try:
            return func(*args, **kwargs)
        except APIConnectionError:
            if attempt == max_retries:
                raise RuntimeError(
                    "Cannot reach Astra server. Check your internet connection."
                )
            time.sleep(1 * (attempt + 1))  # Linear backoff
        except RateLimitError:
            raise RuntimeError("Too many requests. Please wait a moment.")
        except APIError as e:
            if e.status_code == 403:
                raise RuntimeError("Invalid or expired license key.")
            raise
```

### Health Check Endpoint

```python
# backend/main.py
@app.get("/health")
async def health():
    return {"status": "ok", "version": "3.0.0"}

@app.post("/v1/validate")
async def validate_key(license_key: str = Depends(validate_license)):
    """Endpoint for desktop app to validate key at startup without making an LLM call."""
    return {"valid": True, "tier": "standard"}
```

---

## Latency Analysis

```
Current (v2.x):
  Audio -> Whisper -> Classify -> RAG -> OpenAI -> Display
  ~0.5s    ~0.8s     ~0.3s      ~0.1s   ~1.0s    ~0.1s   = ~2.8s total

Target (v3.0):
  Audio -> Whisper -> Classify -> RAG -> Proxy -> OpenAI -> Display
  ~0.5s    ~0.8s     ~0.3s      ~0.1s  +~0.1s   ~1.0s    ~0.1s   = ~2.9s total
                                         ^^^^^
                                    Extra hop: ~50-150ms

  The proxy adds ONE extra network hop. Since the proxy just validates a key
  (hash lookup, <1ms) and forwards the request, the overhead is purely network
  latency: ~50-150ms depending on proxy location relative to user and OpenAI.

  This keeps total latency well under the 3-second budget.
```

**Optimization:** Deploy the proxy in US-East (Railway default) which is close to OpenAI's API servers, minimizing the proxy-to-OpenAI leg.

---

## Anti-Patterns to Avoid

### 1. Reimplementing OpenAI's API on the Proxy

**Wrong:** Building custom endpoints that parse prompts, manage conversation state, or restructure requests.
**Right:** Mirror OpenAI's `/v1/chat/completions` endpoint exactly. Accept the same JSON body, forward it unchanged.

### 2. Storing Prompts or Responses on the Proxy

**Wrong:** Logging full prompts/responses to a database for analytics.
**Right:** The proxy is a pass-through. It should log metadata only (timestamp, license key, model, token count) -- never content. This respects user privacy and reduces storage/liability.

### 3. Putting RAG on the Server

**Wrong:** Sending raw documents to the server, running embeddings and search there.
**Right:** RAG stays 100% local. Only the assembled prompt (which contains short context snippets) goes over the network. User documents never leave the machine.

### 4. Complex License Systems for v3.0

**Wrong:** Building JWT tokens, refresh flows, OAuth, subscription management.
**Right:** Simple pre-generated keys stored in a lookup table. HMAC-based generation ensures keys can't be guessed, but validation is just a dictionary lookup. Complexity can be added later if the product grows.

### 5. Using `httpx` Directly Instead of the OpenAI SDK

**Wrong:** Making raw HTTP requests to the proxy with `httpx`, manually parsing SSE.
**Right:** Use `OpenAI(base_url=proxy_url)` which handles SSE parsing, retry logic, streaming, and error handling automatically. The SDK does the hard work.

### 6. Embedding the OpenAI API Key in the Desktop App

**Wrong:** Shipping the OpenAI API key in the installer, environment variable, or config file.
**Right:** The API key exists ONLY on the proxy server. The desktop app only knows its license key and the proxy URL.

### 7. Sending Every Utterance Through the Proxy

**Wrong:** Routing question classification calls through the proxy (adds latency to the hot path).
**Right:** Classify locally (rule-based heuristics or the existing LLM call to gpt-4o-mini). Only route the answer-generation calls through the proxy. If classification must use the LLM, consider caching or batching.

### 8. Not Handling Proxy Downtime

**Wrong:** App crashes or hangs when the proxy is unreachable.
**Right:** Graceful degradation with clear error messages. The app should still function for audio capture and transcription even if the proxy is down -- it just cannot generate answers.

---

## Security Considerations

### What This Architecture Protects

- **OpenAI API key:** Never exposed to clients. Lives only on the proxy server as an environment variable.
- **Casual piracy:** License key requirement prevents "just download and use" without a valid key.
- **Cost control:** Rate limiting on the proxy prevents any single key from running up excessive OpenAI bills.

### What This Architecture Does NOT Protect Against

- **Determined reverse engineering:** A skilled attacker could decompile the Python app, find the proxy URL, and craft requests. The license key is the only barrier.
- **Key sharing:** Users can share license keys. This is explicitly accepted as "basic deterrent" per the project requirements.
- **Man-in-the-middle:** HTTPS between client and proxy protects against this in transit.

### Hardening for Future Versions

- Per-key rate limits and usage quotas
- Key revocation endpoint
- Hardware fingerprinting (machine ID tied to license key)
- Short-lived session tokens (license key -> session token at startup)

---

## Embedding API Consideration

The current codebase uses `openai.embeddings.create()` in `_search_dense()` for RAG retrieval. This call currently uses the user's API key directly. For v3.0, there are two options:

**Option A (Recommended): Keep embeddings local with a local embedding model**
- Replace OpenAI embeddings with a local model (e.g., `sentence-transformers`)
- Eliminates the need for any API key on the client for RAG
- ChromaDB supports built-in embedding functions
- Trade-off: Slightly lower embedding quality, but eliminates a network call

**Option B: Route embeddings through the proxy too**
- Add `/v1/embeddings` endpoint to the proxy
- More network calls during RAG retrieval (every search hits the proxy)
- Adds latency to the retrieval step
- Trade-off: Keeps current embedding quality, adds latency

**Option C: Keep user-provided API key for embeddings only**
- Users provide their own key for the one-time embedding step during ingestion
- Or embeddings are computed at ingest time (already the case with ChromaDB)
- Query-time embeddings still need a key
- Trade-off: Partially defeats the "no API key needed" goal

Recommendation: Option A for v3.0. Local embeddings eliminate the embedding API dependency entirely.

---

## Sources

| Source | Confidence | Key Insight |
|--------|------------|-------------|
| [OpenAI Python SDK - GitHub](https://github.com/openai/openai-python) | HIGH | `base_url` parameter for custom proxy endpoints; `AsyncOpenAI` for streaming |
| [FastAPI Security Tools - Official Docs](https://fastapi.tiangolo.com/reference/security/) | HIGH | `APIKeyHeader` + `Security()` dependency injection for auth |
| [OpenAI Community: Forwarding Stream Responses](https://community.openai.com/t/how-to-forward-openais-stream-response-using-fastapi-in-python/963242) | HIGH | `StreamingResponse` + async generator pattern for SSE forwarding |
| [LLM-API-Key-Proxy (GitHub)](https://github.com/Mirrowel/LLM-API-Key-Proxy) | HIGH | Production proxy architecture with key rotation, forwarding, and resilience patterns |
| [Sevalla: Real-time OpenAI Streaming with FastAPI](https://sevalla.com/blog/real-time-openai-streaming-fastapi/) | HIGH | `AsyncOpenAI` + `StreamingResponse` with SSE code examples |
| [Railway: Deploy FastAPI Guide](https://docs.railway.com/guides/fastapi) | HIGH | Dockerfile pattern, `$PORT` env var, deployment steps |
| [Fly.io: Run a FastAPI App](https://fly.io/docs/python/frameworks/fastapi/) | MEDIUM | Alternative deployment platform, container-based |
| [openai-http-proxy (PyPI)](https://pypi.org/project/openai-http-proxy/) | MEDIUM | Reference implementation of OpenAI forwarding proxy with virtual API keys |
| [kaiban-ai/kaiban-llm-proxy (GitHub)](https://github.com/kaiban-ai/kaiban-llm-proxy) | MEDIUM | Proxy pattern for hiding API keys from frontend/client applications |
| [API7: API Gateways Proxy LLM Requests](https://api7.ai/learning-center/api-gateway-guide/api-gateway-proxy-llm-requests) | MEDIUM | Enterprise patterns for LLM request proxying and rate limiting |
| [TrueFoundry: Rate Limiting in AI Gateway](https://www.truefoundry.com/blog/rate-limiting-in-llm-gateway) | MEDIUM | Token-based rate limiting instead of request-based |
| [Python hmac Module - Official Docs](https://docs.python.org/3/library/hmac.html) | HIGH | HMAC-SHA256 for license key generation and `compare_digest()` for timing-safe validation |
| [FastAPI API Key Auth Patterns (Multiple)](https://joshdimella.com/blog/adding-api-key-auth-to-fast-api) | HIGH | Dependency injection patterns for API key validation in FastAPI |
| [fastapi-proxy-lib (PyPI)](https://pypi.org/project/fastapi-proxy-lib/) | LOW | Generic FastAPI proxy library; too heavy for this simple use case |
| [Architecting Scalable AI Backends with FastAPI and OpenAI](https://medium.com/@afolabiifeoluwa06/architecting-scalable-ai-backends-with-fastapi-and-openai-2671cbcb24bb) | MEDIUM | Modular FastAPI project structure for AI backends |

---

## Summary: What Gets Built

| Component | Technology | Effort | Priority |
|-----------|-----------|--------|----------|
| Backend proxy server | FastAPI + AsyncOpenAI + uvicorn | Medium | P0 |
| License validation middleware | FastAPI Security dependency | Small | P0 |
| License key generator CLI | Python script with HMAC | Small | P0 |
| Client API module (`api_client.py`) | OpenAI SDK with `base_url` | Small | P0 |
| rag.py modifications | Replace `OpenAI()` calls with proxy client | Small | P0 |
| config.py modifications | License key + proxy URL storage | Small | P0 |
| License key entry UI | PyQt6 dialog at startup | Medium | P0 |
| Health check / key validation endpoint | FastAPI GET + POST | Small | P1 |
| Rate limiting middleware | FastAPI middleware or dependency | Small | P1 |
| Usage tracking (token counts) | SQLite or in-memory on proxy | Medium | P2 |
| Local embeddings migration | sentence-transformers or ChromaDB built-in | Medium | P2 |

---

*Research completed 2026-02-16. Patterns are stable and well-documented across the Python/FastAPI ecosystem.*
