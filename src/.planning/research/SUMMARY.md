# Project Research Summary

**Project:** Astra Interview Copilot
**Domain:** Desktop app online distribution with backend LLM proxy + license gating
**Researched:** 2026-02-16
**Confidence:** HIGH

## Executive Summary

Astra v3.0 transforms the app from a direct-to-OpenAI desktop tool into a commercially distributable product with a backend proxy that gates LLM access behind license keys. The research confirms this is a well-trodden architecture — production LLM proxies (LiteLLM, kaiban-llm-proxy, LLM-API-Key-Proxy) all follow the same thin-forwarding pattern. The critical insight is that the OpenAI Python SDK's `base_url` parameter means the local app can route through the proxy with minimal code changes (5 call sites in `rag.py` + 1 in `ingest.py`).

The recommended approach is a three-component system: (1) a FastAPI proxy on Railway (~$5/mo) that validates license keys and forwards requests to OpenAI with streaming SSE passthrough, (2) a UUID-based license key system with server-side validation on every LLM request and 7-day offline grace period, and (3) a PyInstaller + Inno Setup packaging pipeline for Windows distribution. RAG/ChromaDB stays entirely local — only assembled prompts cross the network.

Key risks are PyInstaller antivirus false positives (use `--onedir` mode, not `--onefile`), SSE streaming breakage through the proxy (requires async generators + connection cleanup), and hosting cold starts blowing past the 3-second latency budget (Railway's always-on $5/mo plan avoids this). All are well-documented with proven mitigations.

## Key Findings

### Recommended Stack

The existing Python 3.12 / PyQt6 / OpenAI SDK stack requires minimal additions. See [STACK.md](STACK.md) for full details.

**Core technologies (new for v3.0):**
- **FastAPI >=0.115.0**: Backend proxy server — native async, SSE streaming, auto-generated docs
- **httpx >=0.28.1**: HTTP client for proxy→OpenAI forwarding — async + sync dual API, HTTP/2
- **PostgreSQL 16+**: License key storage on Railway — free within $5/mo usage credits
- **SQLModel >=0.0.22**: ORM for FastAPI — built by same creator, Pydantic + SQLAlchemy
- **PyInstaller >=6.19.0**: Bundle desktop app to Windows .exe
- **Inno Setup 6.7.0**: Wrap into proper Windows installer with Start Menu/uninstaller

**Key integration fact:** `OpenAI(base_url="https://proxy.railway.app/v1", api_key=license_key)` routes all LLM calls through the proxy with a one-line change per call site.

### Expected Features

See [FEATURES.md](FEATURES.md) for full details.

**Must have (table stakes):**
- Single-screen license key entry on first launch (UUID, copy-paste from email)
- Persistent activation (store locally via platformdirs, already in use)
- 7-day offline grace period (app must work during interviews even without WiFi)
- Streaming response forwarding through proxy (preserve current UX)
- Sub-200ms proxy overhead (thin validation + forward, no queuing)
- Proper error messages mapping proxy/OpenAI failures to plain English
- Rate limiting per license key (20 RPM completions, 60 RPM classifications)

**Should have (competitive):**
- No account creation — key-only activation is frictionless
- Automatic retry on transient OpenAI errors (1 retry, 2s backoff)
- Usage tracking per license key (detect sharing, monitor costs)
- Model routing enforced server-side (gpt-4o-mini for classify, gpt-4o for answers)

**Defer (post-launch):**
- Machine binding with hardware ID (P2 — complexity vs. value tradeoff)
- Web admin dashboard for license management (use CLI tools initially)
- Gumroad webhook auto-generation of keys
- Code signing certificate (~$70-287/yr, add when revenue supports it)

### Architecture Approach

See [ARCHITECTURE.md](ARCHITECTURE.md) for full diagrams and patterns.

The architecture is a thin forwarding proxy between the desktop app and OpenAI:

```
Local App → [HTTPS + license key] → Backend Proxy → [HTTPS + OpenAI key] → OpenAI API
                                         ↓
                                    PostgreSQL
                                  (license keys)
```

**What stays local (privacy):** Audio capture, Whisper transcription, ChromaDB, BM25, RAG retrieval, prompt assembly, all user documents.

**What crosses the network:** Only the assembled prompt (question + RAG context snippets, NOT raw documents) goes to the proxy.

**Major components:**
1. **Backend Proxy (FastAPI)** — License validation middleware → request forwarding → SSE streaming passthrough
2. **License Service** — UUID generation, PostgreSQL storage, per-request validation with in-memory caching
3. **Desktop Client changes** — Replace `OpenAI(api_key=...)` with `OpenAI(base_url=proxy_url, api_key=license_key)`, add license entry UI
4. **Windows Installer** — PyInstaller onedir bundle → Inno Setup installer

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for all 6 critical pitfalls + mitigation strategies.

1. **PyInstaller AV false positives** — Use `--onedir` not `--onefile`, test on fresh Windows VM, plan for SmartScreen warnings without code signing
2. **Hardcoded secrets in client binary** — PyInstaller .pyc is trivially decompilable; OpenAI key must ONLY live on backend; design assuming client is fully readable
3. **SSE streaming breaks through proxy** — Use async generators, single global httpx.AsyncClient, check `request.is_disconnected()`, set `X-Accel-Buffering: no`
4. **Cold starts on cheap hosting** — Railway's $5/mo plan is always-on (no cold starts); Fly.io hobby plan deprecated; add keepalive pings as insurance
5. **License key bypass if validated client-side** — All validation server-side on every LLM request; use `secrets.token_urlsafe(32)` for generation, `hmac.compare_digest()` for comparison
6. **PyInstaller missing DLLs/hidden imports** — Build in clean venv, `--debug=imports`, test on fresh Windows VM, bundle VC++ Redistributable

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Backend Proxy Server
**Rationale:** The proxy is the core new component that everything else depends on. Can be developed and tested independently before touching the desktop app.
**Delivers:** Working FastAPI proxy that validates license keys and forwards LLM calls to OpenAI with SSE streaming.
**Addresses:** Backend proxy server, license key validation endpoint, license key generation tool
**Avoids:** P-03 (SSE streaming breakage) by getting streaming right from the start
**Stack:** FastAPI, httpx, PostgreSQL, SQLModel, Alembic

### Phase 2: Desktop App Integration
**Rationale:** Once the proxy exists, modify the desktop app to route through it. This is the smallest code change — primarily swapping `base_url` in OpenAI client calls.
**Delivers:** Desktop app that routes all LLM calls through the backend proxy using license keys.
**Addresses:** Local app → backend proxy routing, remove user-facing API key requirement
**Avoids:** P-02 (hardcoded secrets) by removing API key from client entirely
**Uses:** OpenAI SDK `base_url` parameter, httpx for non-LLM proxy calls

### Phase 3: License Key UI + First-Run Experience
**Rationale:** With proxy routing working, add the user-facing license entry screen. Replaces the existing API key entry screen.
**Delivers:** First-launch license activation screen, persistent storage, offline grace period.
**Addresses:** Startup license key entry and validation UI
**Avoids:** P-05 (client-side validation bypass) by validating server-side on every request

### Phase 4: Windows Installer + Distribution
**Rationale:** Last phase — package everything into an installable, distributable product. Must be done on Windows.
**Delivers:** Windows installer (.exe) via PyInstaller + Inno Setup, ready for distribution.
**Addresses:** Windows installer/distribution package
**Avoids:** P-01 (AV false positives) by using --onedir mode, P-06 (missing DLLs) by testing on clean VM

### Phase Ordering Rationale

- **Backend first:** The proxy can be developed and deployed independently. It has zero dependencies on desktop app changes. This de-risks the most complex new component early.
- **Desktop integration before UI:** Routing changes are mechanical (swap base_url). Getting the data flow working before adding UI means you can test end-to-end with CLI/manual testing.
- **License UI after routing works:** The UI is a thin layer over already-working license validation. Building UI before the backend works means guessing at error states.
- **Installer last:** Packaging is the final step. Every other change must be stable before bundling. Installer bugs are slow to debug (build cycles).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Backend Proxy):** SSE streaming passthrough is the trickiest part — needs careful implementation of async generators and connection management. Research the specific Railway deployment configuration for SSE.
- **Phase 4 (Windows Installer):** PyInstaller hidden imports for the new dependencies (httpx, keyring) need investigation. The existing `astra.spec` file needs updates.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Desktop Integration):** Well-documented — OpenAI SDK `base_url` override is a one-liner per call site.
- **Phase 3 (License UI):** Standard PyQt6 dialog — similar to existing API key entry screen in v2.0.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | FastAPI + httpx + PostgreSQL is the standard stack for Python API proxies. OpenAI SDK `base_url` verified in official docs. |
| Features | HIGH | License key UX patterns well-established (JetBrains, Windows, Office). Proxy patterns documented in LiteLLM, openai-proxy. |
| Architecture | HIGH | Thin forwarding proxy is the established pattern. Multiple open-source implementations confirm the approach. |
| Pitfalls | HIGH | PyInstaller AV issues, SSE streaming gotchas, and cold start problems all heavily documented with proven mitigations. |

**Overall confidence:** HIGH

### Gaps to Address

- **Embeddings migration:** Current codebase uses OpenAI embedding API for dense search. May need to migrate to local embeddings (sentence-transformers) to fully remove client-side API key dependency. Research during Phase 2 planning.
- **Question classification routing:** Architecture diagram suggests moving classification local (tiny model), but current code uses gpt-4o-mini via API. Decision needed: proxy classify calls too, or switch to local classification model?
- **Code signing economics:** No code signing for initial release (AV false positives expected). Plan to add when revenue supports ~$70-287/yr certificate cost.
- **Gumroad/payment integration:** License keys will be manually generated initially. Automated webhook integration deferred to post-launch.

## Sources

### Primary (HIGH confidence)
- FastAPI official documentation — streaming, dependencies, deployment
- OpenAI Python SDK documentation — `base_url` parameter
- PyInstaller documentation — PyQt6 bundling, hooks, spec files
- Inno Setup documentation — installer configuration
- Railway documentation — deployment, PostgreSQL, pricing
- httpx documentation — async client, streaming, HTTP/2

### Secondary (MEDIUM confidence)
- GitHub: LLM-API-Key-Proxy, kaiban-llm-proxy — proxy architecture patterns
- OpenAI Community forums — FastAPI streaming proxy implementations
- r/Python, r/learnpython — PyInstaller AV false positive reports
- Stack Overflow — FastAPI SSE streaming, PyInstaller hidden imports

### Tertiary (LOW confidence)
- Fly.io pricing changes (hobby plan status) — may change, verify before Phase 1
- Railway always-on behavior at $5/mo — verify during deployment

---
*Research completed: 2026-02-16*
*Ready for roadmap: yes*
