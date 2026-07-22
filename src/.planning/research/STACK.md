# Stack Research: v3.0 Backend Proxy, License Gating & Windows Installer

**Domain:** Desktop interview copilot (Python/PyQt6/OpenAI)
**Date:** 2026-02-16
**Confidence Level:** HIGH (cross-verified across multiple authoritative sources)
**Researcher:** Claude Opus 4.6

---

## Current Stack (Baseline)

| Component | Version | Role |
|-----------|---------|------|
| Python | 3.12 | Runtime |
| PyQt6 | >=6.5.0 | Desktop GUI |
| faster-whisper | >=1.0.0,<1.1.0 | Speech-to-text |
| onnxruntime | >=1.14.0,<1.20.0 | Whisper inference engine |
| ChromaDB | >=0.5.0,<1.0.0 | Local vector store (RAG) |
| openai (SDK) | >=1.0.0 | LLM API client |
| rank_bm25 | >=0.2.2 | Sparse retrieval (hybrid search) |
| pdfplumber | >=0.9.0 | PDF ingestion |
| pyyaml | >=6.0.0 | Config files |
| platformdirs | >=4.0.0 | Cross-platform config paths |
| PyAudioWPatch | >=0.2.12 | Windows WASAPI audio capture |

**Key constraint:** Total pipeline latency must stay under 3 seconds. The proxy hop adds ~50-200ms.

**Key architectural fact:** The OpenAI SDK already supports `base_url` override:
```python
client = OpenAI(base_url="https://your-proxy.example.com/v1", api_key="license-key-here")
```
This means the local app can route through the proxy with a one-line change per `OpenAI()` call site. There are currently 5 call sites in `rag.py` and 1 in `ingest.py` that create `OpenAI(api_key=...)` clients.

---

## Core Technologies (New for v3.0)

| Name | Version | Purpose | Why Recommended |
|------|---------|---------|-----------------|
| **FastAPI** | >=0.115.0 (latest on PyPI as of Feb 2026) | Backend proxy server | Native async, OpenAPI docs auto-generated, StreamingResponse for SSE, Pydantic validation built-in. Officially recommended by Starlette >=0.40.0. Installed via `pip install "fastapi[standard]"` which bundles uvicorn. |
| **Uvicorn** | >=0.34.0 | ASGI server for FastAPI | Bundled with `fastapi[standard]`. Production-grade, async event loop, handles SSE streaming. |
| **httpx** | >=0.28.1 | HTTP client (proxy -> OpenAI) | Async + sync dual API, HTTP/2 support (17% faster than HTTP/1.1 in benchmarks), streaming support via `httpx.stream()`, natively used by FastAPI for testing. Preferred over aiohttp (async-only) and requests (sync-only). |
| **SQLModel** | >=0.0.22 | ORM for license key database | Built by FastAPI creator (tiangolo), combines Pydantic + SQLAlchemy, seamless FastAPI integration, type-safe. Official FastAPI docs recommend it. |
| **PostgreSQL** | 16+ | License key storage (backend) | Concurrent access safe (SQLite is not), included free on Railway ($0 extra within usage credits), row-level security, JSONB for flexible metadata. Railway/Fly.io both offer one-click Postgres. |
| **Alembic** | >=1.14.0 | Database migrations | Standard for SQLAlchemy/SQLModel. `target_metadata = SQLModel.metadata` in env.py. Essential for schema evolution without data loss. |
| **PyInstaller** | >=6.19.0 | Bundle Python app to .exe | Works out-of-box with Python 3.8-3.14 and PyQt6. Correctly bundles Qt6. Active maintenance. Must build ON Windows (cross-compilation not supported). |
| **Inno Setup** | 6.7.0 | Windows installer (.exe) | Free, open-source, GUI wizard, dark mode (6.6.0+), mature ecosystem, handles registry, Start Menu, uninstaller. Better UX than NSIS, simpler than WiX. |
| **cryptography** | >=44.0.0 | RSA license key signing | Industry-standard Python crypto library. RSA-PSS signing (private key on server) + verification (public key in client). Maintained by PyCA. |

---

## Supporting Libraries (Backend)

| Name | Version | Purpose | Notes |
|------|---------|---------|-------|
| **python-dotenv** | >=1.0.0 | Environment variable loading | Already in stack. Load OPENAI_API_KEY on server. |
| **pydantic-settings** | >=2.0.0 | Typed settings from env vars | Better than raw dotenv for FastAPI. Auto-validates types. |
| **passlib[bcrypt]** | >=1.7.4 | Password/key hashing | Hash license keys at rest in DB (never store plaintext). |
| **python-jose[cryptography]** | >=3.3.0 | JWT token creation | Optional: if you want short-lived session tokens after license validation. |
| **slowapi** | >=0.1.9 | Rate limiting for FastAPI | Prevent abuse. Built on `limits` library. Per-key rate limiting. |
| **httpx-sse** | >=0.4.0 | SSE client for streaming | Parse Server-Sent Events from OpenAI streaming responses when proxying. |
| **gunicorn** | >=23.0.0 | Process manager (production) | Run multiple uvicorn workers. Not needed on Railway (single-process is fine for low traffic). |

---

## Supporting Libraries (Desktop Client - additions)

| Name | Version | Purpose | Notes |
|------|---------|---------|-------|
| **httpx** | >=0.28.1 | HTTP client (app -> proxy) | Replace direct OpenAI calls. Sync API for Qt thread compatibility. Supports timeout configuration critical for 3s latency budget. |
| **keyring** | >=25.0.0 | Secure license key storage | Store license key in OS credential manager (Windows Credential Locker). More secure than plaintext .env file. |

---

## Development Tools

| Name | Version | Purpose | Notes |
|------|---------|---------|-------|
| **pytest** | >=8.0.0 | Testing | Backend API tests + client integration tests. |
| **pytest-asyncio** | >=0.24.0 | Async test support | Test FastAPI async endpoints. |
| **httpx** (test client) | >=0.28.1 | FastAPI test client | `from httpx import AsyncClient` for API testing. |
| **ruff** | >=0.8.0 | Linter + formatter | Fast, replaces flake8+black+isort. |
| **pyinstaller-versionfile** | >=3.0.1 | Windows .exe metadata | Generate VERSIONINFO resource from YAML. Company name, version, description in Properties dialog. |
| **auto-py-to-exe** | >=2.44.0 | PyInstaller GUI (optional) | Visual .spec file generator. Useful for debugging bundling issues. |

---

## Installation Commands

### Backend Server (new repository or `server/` subdirectory)

```bash
# Core backend
pip install "fastapi[standard]" uvicorn httpx httpx-sse sqlmodel alembic
pip install psycopg2-binary  # PostgreSQL driver
pip install python-dotenv pydantic-settings
pip install passlib[bcrypt] python-jose[cryptography]
pip install slowapi
pip install cryptography  # RSA key signing for license generation

# Development
pip install pytest pytest-asyncio ruff
```

### Desktop Client (additions to existing requirements.txt)

```bash
# Add to existing requirements.txt:
pip install httpx>=0.28.1
# keyring is optional but recommended for secure license storage
pip install keyring>=25.0.0
```

### Build Tools (Windows build machine only)

```bash
pip install pyinstaller>=6.19.0
pip install pyinstaller-versionfile>=3.0.1

# Inno Setup: Download installer from https://jrsoftware.org/isdl.php
# Version 6.7.0 (released Jan 2026)
# Not a pip package - standalone Windows application
```

---

## Deployment / Hosting Recommendation

### Primary Recommendation: Railway ($5/mo)

| Aspect | Details |
|--------|---------|
| **Plan** | Hobby Plan: $5/month flat (includes $5 usage credit) |
| **Compute** | Usage-based: vCPU + RAM metered per second |
| **Database** | One-click PostgreSQL, included in usage credits |
| **Deploy** | Git push auto-deploy via Nixpacks (auto-detects Python/FastAPI) |
| **SSL** | Free HTTPS on `*.up.railway.app` |
| **Regions** | US, EU (Amsterdam launched Feb 2025) |
| **Scaling** | Horizontal scaling available on Pro plan ($20/mo) |
| **Latency** | ~50-100ms added hop for US East users |

**Why Railway over alternatives:**
- Simplest DX: `railway up` or git push
- PostgreSQL included (no separate DB hosting)
- $5/mo is cheapest viable option
- Auto-sleep on Hobby plan saves credits when idle (but adds cold start ~2-5s on first request after sleep)

### Alternative: Hetzner VPS (more control, same price)

| Aspect | Details |
|--------|---------|
| **Plan** | CX22: ~$4.50/month (2 vCPU, 4GB RAM, 40GB SSD) |
| **Database** | Self-managed PostgreSQL on same VPS |
| **Deploy** | Manual: Docker or systemd + nginx reverse proxy |
| **SSL** | Certbot/Let's Encrypt (manual setup) |
| **Regions** | EU (Germany, Finland), US (Ashburn, Hillsboro) |
| **Advantage** | No cold starts, always-on, full root access |
| **Disadvantage** | More ops work: updates, backups, monitoring |

### NOT Recommended: Fly.io

- Deprecated Hobby plan; new Pay-As-You-Go pricing
- Managed Postgres starts at $38/month (way over budget)
- More complex setup than Railway for this use case

---

## Latency Budget Analysis

The 3-second total constraint breaks down as follows:

| Stage | Current (direct) | With Proxy | Delta |
|-------|-------------------|------------|-------|
| Silence detection | ~2.0s | ~2.0s | 0ms |
| Audio capture batch | ~0ms | ~0ms | 0ms |
| Whisper transcription | ~0.5-1.0s | ~0.5-1.0s | 0ms |
| Network: client -> proxy | N/A | ~30-80ms | +30-80ms |
| License validation (cached) | N/A | ~1-5ms | +1-5ms |
| Network: proxy -> OpenAI | ~100-300ms | ~100-300ms | 0ms |
| OpenAI processing | ~500-1500ms | ~500-1500ms | 0ms |
| Network: OpenAI -> proxy -> client | ~100-300ms | ~130-380ms | +30-80ms |
| **Total** | **~1.2-3.1s** | **~1.3-3.3s** | **+60-160ms** |

**Mitigation strategies:**
1. Cache license validation result for 5-10 minutes (avoid DB hit per request)
2. Use HTTP/2 with httpx for multiplexed connections (17% faster)
3. Stream responses via SSE to show tokens as they arrive (perceived latency drops)
4. Keep proxy server in same region as OpenAI (US East)
5. Railway cold start concern: use a health-check cron to prevent sleep, or upgrade to Pro for always-on

---

## Architecture: How the Proxy Works

```
Desktop App (PyQt6)                    Backend Proxy (FastAPI)              OpenAI API
+-----------------------+              +------------------------+           +-----------+
| 1. Capture audio      |              |                        |           |           |
| 2. Transcribe (local) |              |                        |           |           |
| 3. RAG search (local) |              |                        |           |           |
| 4. Build prompt       |              |                        |           |           |
| 5. Send to proxy -----|-- HTTPS ---->| 6. Validate license key|           |           |
|    (license key in    |              | 7. Rate limit check    |           |           |
|     Authorization hdr)|              | 8. Forward to OpenAI --|-- HTTPS ->| 9. LLM    |
|                       |              |    (server API key)    |           |           |
| 11. Display answer <--|<-- SSE ------| 10. Stream response <--|<-- SSE ---| response  |
+-----------------------+              +------------------------+           +-----------+
```

**Key design decisions:**
- License key sent as `Authorization: Bearer <license-key>` header
- OpenAI API key lives ONLY on the server (never in client)
- Embeddings API also proxied (used by ingest.py) -- or keep embeddings local with a free model
- RAG/ChromaDB stays entirely local -- documents never leave user's machine
- Proxy is OpenAI-API-compatible: just change `base_url` in OpenAI SDK client

---

## License Key System Design

### Recommended Approach: RSA-Signed Keys (offline-verifiable)

**Why RSA over simple random tokens:**
- Client can verify key format offline (fast rejection of typos)
- Server validates against database for activation/revocation
- No third-party service dependency (unlike Keygen.sh, Cryptolens)
- `cryptography` library is battle-tested, widely used

**Key format:** `ASTRA-XXXXX-XXXXX-XXXXX-XXXXX` (human-readable, typed in UI)

**Flow:**
1. Admin generates key: `python -m server.keygen --email user@example.com`
2. Key stored in PostgreSQL: `license_keys` table (hashed, with metadata)
3. User enters key in desktop app startup screen
4. App sends key with every API request in `Authorization` header
5. Server validates: check hash in DB, check expiry, check active status
6. Cache validation result in-memory (TTL 5 min) to avoid DB hit per request

**Database schema (SQLModel):**
```python
class LicenseKey(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    key_hash: str = Field(index=True, unique=True)       # bcrypt hash
    email: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None
    is_active: bool = Field(default=True)
    max_requests_per_day: int = Field(default=1000)
    requests_today: int = Field(default=0)
    last_request_date: date | None = None
    notes: str | None = None
```

### Alternatives Considered for License Keys

| Option | Verdict | Reason |
|--------|---------|--------|
| **Keygen.sh** (SaaS) | REJECTED | $0.05/validation adds up; external dependency; overkill for basic deterrent |
| **Cryptolens** (SaaS) | REJECTED | Similar concerns; SDK adds complexity; $0/mo free tier is limited |
| **Simple UUID tokens** | ACCEPTABLE but weaker | No offline verification; purely server-validated. Simpler to implement. Fine for MVP. |
| **JWT-based keys** | REJECTED for keys | JWTs are for sessions, not license keys. But could use JWT for short-lived session after key validation. |

**Recommendation:** Start with simple UUID tokens (fastest to build), upgrade to RSA-signed if needed. The server validates anyway, so the offline verification is a nice-to-have, not critical.

---

## Windows Packaging Pipeline

### Step 1: PyInstaller (.exe bundle)

```bash
# On Windows build machine:
pyinstaller astra.spec
```

**Critical `.spec` file additions for v3.0:**
```python
# Add to hiddenimports in existing astra.spec:
hiddenimports += [
    'httpx',
    'httpx._transports',
    'httpx._transports.default',
    'certifi',          # SSL certs for HTTPS to proxy
    'keyring',
    'keyring.backends',
    'keyring.backends.Windows',
]

# Add onnxruntime DLLs (known issue with PyInstaller):
from PyInstaller.utils.hooks import collect_dynamic_libs
binaries += collect_dynamic_libs('onnxruntime')
```

**Known issues:**
- onnxruntime DLL load failures: Use `collect_dynamic_libs('onnxruntime')` and `collect_all('onnxruntime')`
- PyInstaller disallows multiple Qt bindings: ensure only PyQt6 is installed, no PySide6
- Must build on Windows (cross-compilation not supported)
- Add `multiprocessing.freeze_support()` in main.py for frozen app support

### Step 2: Inno Setup (.exe installer)

Create `installer.iss` script:
```ini
[Setup]
AppName=Astra Interview Copilot
AppVersion=3.0.0
DefaultDirName={autopf}\Astra
DefaultGroupName=Astra
OutputDir=dist
OutputBaseFilename=AstraSetup-3.0.0
Compression=lzma2
SolidCompression=yes
SetupIconFile=assets\astra.ico
UninstallDisplayIcon={app}\Astra.exe

[Files]
Source: "dist\Astra.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\*.dll"; DestDir: "{app}"; Flags: ignoreversion
; Include .env.example for reference
Source: ".env.example"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Astra Interview Copilot"; Filename: "{app}\Astra.exe"
Name: "{commondesktop}\Astra Interview Copilot"; Filename: "{app}\Astra.exe"

[Run]
Filename: "{app}\Astra.exe"; Description: "Launch Astra"; Flags: postinstall nowait
```

### Build Pipeline Summary

```
Source Code
    |
    v
PyInstaller (astra.spec) --> dist/Astra.exe (~150-300MB)
    |
    v
Inno Setup (installer.iss) --> AstraSetup-3.0.0.exe (~80-150MB compressed)
    |
    v
Upload to distribution site (GitHub Releases, S3, etc.)
```

---

## Alternatives Considered

### Backend Framework

| Option | Verdict | Reason |
|--------|---------|--------|
| **FastAPI** | SELECTED | Async-native, auto-docs, Pydantic types, StreamingResponse for SSE |
| Django REST Framework | REJECTED | Too heavy for a proxy; sync-first design adds latency |
| Flask | REJECTED | No async, no auto-docs, more boilerplate for validation |
| LiteLLM Proxy | CONSIDERED | Full-featured LLM proxy, but overkill; adds dependency complexity; harder to customize license logic |
| openai-http-proxy | CONSIDERED | Nice virtual API key system, but takes over too much control; custom license logic harder to integrate |

### HTTP Client (Desktop -> Proxy)

| Option | Verdict | Reason |
|--------|---------|--------|
| **httpx** | SELECTED | Async+sync dual API, HTTP/2, streaming, used by FastAPI internally |
| requests | REJECTED | Sync-only; no HTTP/2; no streaming without extra libraries |
| aiohttp | REJECTED | Async-only; harder to integrate with Qt's thread-based concurrency model (ThreadPoolExecutor) |
| openai SDK (base_url) | ALSO SELECTED | Can simply set `base_url` on existing `OpenAI()` clients -- minimal code change. Use httpx only for non-OpenAI endpoints (license validation, health checks). |

### Database

| Option | Verdict | Reason |
|--------|---------|--------|
| **PostgreSQL** | SELECTED | Concurrent-safe, included free on Railway, production-grade |
| SQLite | REJECTED for production | Not safe for concurrent writes (FastAPI serves multiple requests); fine for local dev/testing |
| Redis | REJECTED as primary | Good for caching validation results, but not for persistent license storage |

### Windows Installer

| Option | Verdict | Reason |
|--------|---------|--------|
| **Inno Setup 6.7.0** | SELECTED | Free, open-source, GUI wizard, dark mode, handles uninstaller/registry cleanly |
| NSIS | REJECTED | More powerful but steep scripting learning curve; overkill for this use case |
| InstallForge | CONSIDERED | Simpler GUI but less mature, fewer features than Inno Setup |
| WiX | REJECTED | MSI-focused; enterprise complexity not needed |
| cx_Freeze | REJECTED as bundler | Less maintained than PyInstaller for PyQt6; PyInstaller has better hooks ecosystem |

### Hosting

| Option | Verdict | Reason |
|--------|---------|--------|
| **Railway** | SELECTED | $5/mo, one-click Postgres, git-push deploy, simplest DX |
| Hetzner CX22 | BACKUP | $4.50/mo, more control, no cold starts, but more ops work |
| Fly.io | REJECTED | No more hobby plan; Managed Postgres $38/mo minimum |
| Render | CONSIDERED | Free tier available but sleeps after 15 min; paid at $7/mo |
| AWS/GCP/Azure | REJECTED | Way over budget and complexity for a single proxy service |

---

## What NOT to Use

| Technology | Reason |
|------------|--------|
| **Django** | Too heavy for a proxy server; adds unnecessary latency and complexity |
| **Flask** | No native async; would need Quart or similar, at which point just use FastAPI |
| **Fly.io** | Pricing no longer competitive for hobby projects; Postgres is $38+/mo |
| **aiohttp (as client)** | Async-only doesn't fit Qt's ThreadPoolExecutor pattern in existing codebase |
| **requests** | No async, no HTTP/2, no streaming -- httpx is strictly superior |
| **Keygen.sh / Cryptolens** | External SaaS dependency for what should be a simple DB lookup; cost adds up |
| **cx_Freeze** | Less maintained PyQt6 hooks than PyInstaller; community is smaller |
| **NSIS** | Scripting complexity not justified; Inno Setup covers all needs with simpler config |
| **MongoDB** | No benefit over PostgreSQL for structured license data; adds operational complexity |
| **Redis as primary DB** | Not persistent enough for license records; fine as a cache layer only |
| **PySide6** | Cannot mix with PyQt6 in PyInstaller (explicitly disallowed); stick with PyQt6 |
| **SQLite on server** | Concurrent write issues with FastAPI async; fine for local dev only |
| **gunicorn on Railway** | Railway manages the process; single uvicorn worker is fine for expected traffic |

---

## Version Compatibility Matrix

| Component | Minimum | Maximum | Tested With |
|-----------|---------|---------|-------------|
| Python | 3.12 | 3.12 | 3.12 (project standard) |
| FastAPI | 0.115.0 | latest | Requires Starlette >=0.40.0 |
| Uvicorn | 0.34.0 | latest | Bundled with fastapi[standard] |
| httpx | 0.28.1 | latest | Latest stable as of Dec 2024 |
| SQLModel | 0.0.22 | latest | Requires SQLAlchemy >=2.0, Pydantic >=2.0 |
| Alembic | 1.14.0 | latest | Must match SQLAlchemy version |
| PostgreSQL | 16 | 17 | Railway provides latest |
| PyInstaller | 6.19.0 | latest | Supports Python 3.8-3.14 |
| Inno Setup | 6.7.0 | 6.7.0 | Latest as of Jan 2026 |
| PyQt6 | 6.5.0 | latest | Already in requirements.txt |
| cryptography | 44.0.0 | latest | RSA-PSS signing |
| passlib | 1.7.4 | latest | bcrypt hashing |

**Known version conflicts to watch:**
- `onnxruntime>=1.20.0` may have DLL issues on Windows (already pinned <1.20.0)
- `numpy>=2.0.0` has breaking changes (already pinned <2.0.0)
- `chromadb>=1.0.0` has breaking API changes (already pinned <1.0.0)
- PyInstaller disallows multiple Qt bindings -- ensure no PySide6 in venv

---

## Implementation Notes

### Minimal Code Change for Proxy Integration

The OpenAI Python SDK supports `base_url` override. The simplest integration:

```python
# Before (current code in rag.py, 5 call sites):
openai_client = OpenAI(api_key=api_key)

# After:
openai_client = OpenAI(
    base_url="https://your-proxy.up.railway.app/v1",
    api_key=license_key,  # License key acts as the "API key" from client perspective
)
```

The proxy server receives the request, validates the license key from the `Authorization: Bearer` header (which the OpenAI SDK sends automatically), then forwards to the real OpenAI API with the actual API key.

### Streaming Proxy Pattern (FastAPI)

```python
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import httpx

@app.post("/v1/chat/completions")
async def proxy_chat(request: Request):
    license_key = request.headers.get("Authorization", "").replace("Bearer ", "")
    validate_license(license_key)  # raises 401 if invalid

    body = await request.json()
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json=body,
            timeout=30.0,
        )
        return StreamingResponse(
            response.aiter_bytes(),
            media_type=response.headers.get("content-type"),
        )
```

### Railway Deployment (Procfile)

```
web: uvicorn server.main:app --host 0.0.0.0 --port $PORT
```

---

## Sources

### HIGH Confidence (official docs, PyPI, first-party)
- [FastAPI Official Documentation - SQL Databases](https://fastapi.tiangolo.com/tutorial/sql-databases/) -- SQLModel integration patterns
- [FastAPI Release Notes](https://fastapi.tiangolo.com/release-notes/) -- Version compatibility, Starlette >=0.40.0
- [PyInstaller 6.19.0 Documentation](https://pyinstaller.org/en/stable/CHANGES.html) -- Python 3.8-3.14 support, Qt binding restrictions
- [httpx on PyPI](https://pypi.org/project/httpx/) -- v0.28.1 latest, HTTP/2 support
- [SQLModel Official](https://sqlmodel.tiangolo.com/) -- Pydantic + SQLAlchemy integration
- [Railway Pricing Plans](https://docs.railway.com/reference/pricing/plans) -- $5/mo Hobby plan details
- [Railway Deploy FastAPI Guide](https://docs.railway.com/guides/fastapi) -- Deployment instructions
- [Inno Setup Official](https://jrsoftware.org/isinfo.php) -- v6.7.0, features list
- [OpenAI Python SDK](https://github.com/openai/openai-python) -- base_url override, custom httpx client
- [cryptography library RSA docs](https://cryptography.io/en/latest/hazmat/primitives/asymmetric/rsa/) -- RSA-PSS signing
- [Fly.io Pricing](https://fly.io/pricing/) -- Hobby plan deprecated, Postgres $38+/mo
- [Hetzner Cloud Pricing](https://costgoat.com/pricing/hetzner) -- CX22 at ~$4.50/mo

### MEDIUM Confidence (tutorials, comparisons, community)
- [Packaging PyQt6 with PyInstaller & InstallForge (pythonguis.com)](https://www.pythonguis.com/tutorials/packaging-pyqt6-applications-windows-pyinstaller/) -- Updated Dec 2025, step-by-step guide
- [HTTPX vs Requests vs AIOHTTP (Oxylabs)](https://oxylabs.io/blog/httpx-vs-requests-vs-aiohttp) -- Performance benchmarks
- [OpenAI Community - Forwarding Stream Response via FastAPI](https://community.openai.com/t/how-to-forward-openais-stream-response-using-fastapi-in-python/963242) -- StreamingResponse pattern
- [Real-time OpenAI Streaming with FastAPI (Sevalla)](https://sevalla.com/blog/real-time-openai-streaming-fastapi/) -- SSE implementation
- [onnxruntime PyInstaller DLL issue (GitHub #25193)](https://github.com/microsoft/onnxruntime/issues/25193) -- collect_dynamic_libs workaround
- [Fly.io vs Railway Comparison (Ritza)](https://ritza.co/articles/gen-articles/cloud-hosting-providers/fly-io-vs-railway/) -- Feature comparison
- [Python Hosting Options Compared 2025](https://www.nandann.com/blog/python-hosting-options-comparison) -- Multi-platform comparison
- [pyinstaller-versionfile](https://pypi.org/project/pyinstaller_versionfile/) -- Windows .exe metadata from YAML
- [Generating License Keys in 2026 (fman)](https://build-system.fman.io/generating-license-keys) -- RSA signing approach
- [NSIS vs Inno Setup (Appmus)](https://appmus.com/vs/nsis-vs-inno-setup) -- Installer tool comparison

### LOW Confidence (blog posts, opinions, older content)
- [Railway vs Render 2026 (Northflank)](https://northflank.com/blog/railway-vs-render) -- General platform comparison
- [Scalable Streaming of OpenAI with FastAPI (Medium)](https://medium.com/@mayvic/scalable-streaming-of-openai-model-responses-with-fastapi-and-asyncio-714744b13dd) -- Architecture patterns

---

*Research complete. Ready for roadmap creation.*
