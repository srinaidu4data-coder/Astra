# Pitfalls Research: v3.0 Online Distribution & License Gating

**Domain:** Desktop interview copilot (Python 3.12 / PyQt6 / FastAPI / OpenAI)
**Date:** 2026-02-16
**Confidence Level:** High (based on documented community failures, official issue trackers, and post-mortems)
**Scope:** Backend API proxy, license key system, Windows installer, OpenAI proxying

---

## Critical Pitfalls

### P-01: PyInstaller Bundles Trigger Antivirus False Positives

**What goes wrong:** Windows Defender, Norton, and other AV software flag the PyInstaller-built `.exe` as malware. Users see "Windows protected your PC" SmartScreen warnings. Some AV silently quarantine the exe.

**Why it happens:** PyInstaller's `--onefile` mode extracts a self-modifying archive to a temp directory at runtime. AV heuristics flag this extract-and-execute pattern as trojan-like behavior. The bootloader binary is shared across all PyInstaller apps, so if any malware author uses PyInstaller, all PyInstaller apps inherit bad reputation scores.

**How to avoid:**
- Use `--onedir` mode instead of `--onefile` (no temp extraction = fewer AV triggers)
- Sign the executable with an OV code signing certificate (Certum offers open-source pricing at ~69 EUR/yr; Sectigo at ~$287/yr)
- After signing, distribute to a small trusted group first to build SmartScreen reputation organically (reputation is per-publisher, not per-binary)
- Set EXE checksums (PyInstaller 5.x+ does this automatically)
- Avoid bundling VCRUNTIME140.dll when possible; let PyInstaller's parent process pre-load system copies
- Note: EV certificates no longer grant instant SmartScreen bypass (changed March 2024)

**Warning signs:** First beta tester reports "Windows blocked this app" or AV quarantine. Downloads fail silently.

**Phase to address:** Windows installer phase (late, but must be tested early)

---

### P-02: Hardcoded Secrets in Client Binary Are Trivially Extractable

**What goes wrong:** Developer embeds the OpenAI API key, backend URL signing secret, or license validation bypass in the Python source. Anyone extracts it in minutes.

**Why it happens:** PyInstaller bundles `.pyc` bytecode, not compiled native code. Tools like `pyinstxtractor` + `uncompyle6`/`decompyle3` recover near-original Python source. Even PyInstaller's `--key` encryption flag is useless because the AES key is embedded in the bootloader and recoverable at runtime.

**How to avoid:**
- NEVER embed the OpenAI API key in the client. It lives on the backend proxy only.
- The client should only know: (a) the backend proxy URL, (b) the user's license key. Both are non-secret or per-user.
- For the backend URL, hardcoding is fine (it is public knowledge).
- License validation must happen server-side. The client only sends the key; the server decides if it is valid.
- Accept that all client-side code is readable. Design the security model assuming the client is fully decompiled.

**Warning signs:** "Can I just put the API key in config.py and encrypt it?" thinking. Any secret that ships with the binary.

**Phase to address:** Architecture design (before any code is written)

---

### P-03: OpenAI Streaming SSE Breaks When Proxied Through FastAPI

**What goes wrong:** Streaming responses either (a) arrive as one giant blob instead of token-by-token, (b) silently drop chunks, (c) timeout after 30 seconds, or (d) leak connections in the httpx pool.

**Why it happens:** Multiple compounding issues:
1. FastAPI's `StreamingResponse` buffers if the generator is synchronous or if middleware intercepts the response
2. Reverse proxies (Nginx, Cloudflare, Railway's ingress) buffer SSE by default
3. httpx streaming connections are not returned to the pool until explicitly closed via `Response.aclose()`
4. If the client disconnects mid-stream, the server-side generator keeps running, burning OpenAI tokens and holding connections

**How to avoid:**
- Use `async` generators with `StreamingResponse(media_type="text/event-stream")`
- Use `httpx.AsyncClient` with `client.stream()` as an async context manager to guarantee connection cleanup
- Create a single global `httpx.AsyncClient` in FastAPI's lifespan, not per-request
- Check `await request.is_disconnected()` inside the generator loop to stop on client disconnect
- Set explicit httpx timeouts: `httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0)`
- Disable buffering at hosting layer (Railway/Fly.io): set `X-Accel-Buffering: no` header
- Wrap generator in try/except to catch `asyncio.CancelledError` with cleanup in finally block

**Warning signs:** "It works locally but chunks arrive all at once in production." Token streaming feels laggy. Connection pool exhaustion errors after ~10 concurrent users.

**Phase to address:** Backend proxy phase (core functionality)

---

### P-04: Cold Starts on Cheap Hosting Blow Past 3-Second Latency Budget

**What goes wrong:** First request after inactivity takes 5-60 seconds instead of <200ms. Users see the app "hang" when making their first LLM call.

**Why it happens:** Budget hosting platforms ($5/mo tier) scale to zero after inactivity:
- **Fly.io**: Machines pause after idle period. Cold start can cause 1-minute timeout for first request. FastAPI + Nginx combo is especially bad.
- **Render**: Free tier spins down after 15 min inactivity. Even paid tier can have cold starts.
- **Railway**: Does NOT scale to zero (always-on), eliminating cold starts. Usage-based billing; hobby projects may be de-prioritized during contention.

**How to avoid:**
- **Railway preferred** for always-on at ~$5/mo (no cold starts, usage-based billing)
- If using Fly.io: set `min_machines_running = 1` in fly.toml (costs more but prevents scale-to-zero)
- Implement a client-side health check ping on app startup, before the first real LLM call
- Add a `/health` endpoint on the backend and ping it every 5 minutes via a free cron service (UptimeRobot, cron-job.org) as a keepalive
- Set aggressive timeouts on the client side with retry logic (retry once after 3s timeout)
- Consider Hetzner VPS (~$4/mo) for guaranteed always-on, but requires manual ops

**Warning signs:** "Works great in development, first request in production always fails." Intermittent timeouts only from new users or morning-first-use.

**Phase to address:** Backend proxy phase (hosting selection)

---

### P-05: License Key System Bypassed in Minutes

**What goes wrong:** A single valid key is shared across the internet. OR the key is validated only client-side, so patching out the check takes 5 minutes.

**Why it happens:**
- Key validation happens in client Python code (which is decompilable)
- Keys are not tied to a machine or user identity
- No server-side rate limiting; one key can be used from unlimited IPs simultaneously
- HMAC/signature verification uses a shared secret that ships in the binary

**How to avoid:**
- ALL license validation MUST happen server-side. Client sends key with every LLM request; server validates before forwarding to OpenAI.
- Use cryptographic signatures (Ed25519 preferred, or RSA-2048+): sign license data with private key (server-only), embed public key in client for offline grace periods
- Tie keys to reasonable limits: max N concurrent sessions per key, rate limit per key (e.g., 100 requests/hour)
- Use `hmac.compare_digest()` for all server-side comparisons (prevents timing attacks)
- For offline grace periods: cache a signed validation response locally with an expiry timestamp (e.g., 24h), so app works briefly without network
- Accept the threat model: you are building a basic deterrent, not enterprise DRM. A determined cracker with decompile skills will bypass it. The goal is to prevent casual sharing.
- Use SlowAPI or fastapi-limiter for per-key rate limiting with in-memory storage (Redis is overkill for solo dev)

**Warning signs:** "I'll just check the key format client-side to save a network call." Using `==` instead of `compare_digest()`. No rate limiting per key.

**Phase to address:** License system phase (before backend goes live)

---

### P-06: PyInstaller Missing DLLs / Hidden Imports Crash on User Machines

**What goes wrong:** App runs fine on dev machine, crashes with "ImportError: DLL load failed" or "ModuleNotFoundError" on user machines. Common with PyQt6, chromadb, faster-whisper, numpy.

**Why it happens:**
- PyInstaller's static analysis misses dynamic imports (`__import__()`, `importlib.import_module()`)
- Qt plugins have complex dependency chains; missing plugins cause silent crashes
- Dev machine has system DLLs (Visual C++ runtime, etc.) that user machines lack
- Multiple Qt bindings installed in venv (e.g., PyQt5 + PyQt6) cause conflicts

**How to avoid:**
- Build in a **clean** virtual environment with ONLY production dependencies
- Use `--hidden-import` for known problematic modules: `chromadb`, `faster_whisper`, `tiktoken`
- Explicitly `--exclude-module` any unused Qt bindings (PyQt5, PySide2, PySide6)
- Build with `--debug=imports` and run the exe to find missing imports before release
- Test on a **clean Windows VM** (fresh install, no Python, no dev tools) before every release
- Bundle Visual C++ Redistributable in the installer (check registry first, install silently if missing)
- Use `--onedir` mode for easier debugging (can inspect bundled files)
- Pin PyInstaller version in requirements; new versions occasionally break Qt hooks

**Warning signs:** "Works on my machine." Any `try/except ImportError` that silently hides missing modules. Testing only on the dev machine.

**Phase to address:** Windows installer phase

---

## Technical Debt Patterns

### TD-01: Mixing sync and async in FastAPI

**The trap:** Using synchronous `openai.ChatCompletion.create()` inside async FastAPI endpoints. FastAPI runs sync functions in a threadpool, but this wastes threads and limits concurrency.

**The fix:** Use the async OpenAI client (`AsyncOpenAI`) for all backend LLM calls. The proxy is I/O-bound; asyncio coroutines are far lighter than threads.

### TD-02: Creating httpx.AsyncClient per request

**The trap:** Instantiating a new `httpx.AsyncClient()` inside each request handler. This defeats connection pooling and creates/destroys SSL sessions per request.

**The fix:** Create one `AsyncClient` in FastAPI lifespan, store on `app.state`, and reuse across all requests. Close in lifespan shutdown.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(timeout=httpx.Timeout(60.0))
    yield
    await app.state.http_client.aclose()
```

### TD-03: requirements.txt without version pinning

**The trap:** Current `requirements.txt` has no version pins. A new release of `openai`, `httpx`, or `PyQt6` can break the build silently. The openai library recently broke `proxies` kwarg compatibility with httpx 0.28.

**The fix:** Pin exact versions: `openai==1.x.x`, `httpx==0.27.x`, `PyQt6==6.x.x`. Use `pip freeze > requirements.txt` from a working environment.

### TD-04: No structured error responses from proxy

**The trap:** Backend proxy returns raw Python tracebacks or generic 500 errors. Client has no idea whether it is a license issue, OpenAI rate limit, or server bug.

**The fix:** Define a consistent error response schema from day one:
```json
{"error": {"code": "license_expired", "message": "...", "retry_after": null}}
```

### TD-05: Token counting happens nowhere

**The trap:** No tracking of per-user token consumption. A single user can burn through your entire OpenAI budget in a day. No visibility into costs until the bill arrives.

**The fix:** Extract `usage.prompt_tokens` and `usage.completion_tokens` from OpenAI responses. Log per license key. Set daily/monthly limits per key. Alert when approaching budget thresholds.

---

## Integration Gotchas

### IG-01: OpenAI API — Streaming Response Token Usage

**Gotcha:** When streaming (`stream=True`), the OpenAI API does NOT include `usage` data in chunk responses by default. You must pass `stream_options={"include_usage": True}` and the usage appears only in the final chunk.

**Impact:** Without this, you cannot count tokens for billing/limiting on streaming requests.

### IG-02: OpenAI API — Rate Limits Hit the Proxy, Not Individual Users

**Gotcha:** All users share the same OpenAI API key on the backend. OpenAI rate limits are per-key. 10 concurrent users can exhaust your rate limit, causing 429 errors for everyone.

**Impact:** One power user's long conversation blocks everyone else.

**Mitigation:** Implement per-license-key queuing on your proxy. Use `gpt-4o-mini` for classification (cheaper, higher rate limits). Cache repeated questions. Consider separate OpenAI keys for different tiers.

### IG-03: OpenAI API — Model Version Changes

**Gotcha:** OpenAI periodically deprecates model versions. `gpt-4o` may point to different snapshots. Prompts tuned for one version may degrade on another.

**Impact:** Answer quality silently degrades. Users complain about worse answers.

**Mitigation:** Pin model versions (e.g., `gpt-4o-2024-11-20`). Log model version in responses. Test prompts when switching.

### IG-04: httpx + openai Library Version Conflicts

**Gotcha:** The openai Python library v1.56+ removed the `proxies` keyword argument from the client constructor, breaking compatibility with httpx 0.28+. This is an ongoing source of breakage.

**Impact:** `TypeError: Client.__init__() got an unexpected keyword argument 'proxies'` on install.

**Mitigation:** Pin compatible versions together: `openai>=1.58` with `httpx>=0.28`, or `openai<1.56` with `httpx<0.28`. Test exact version combinations.

### IG-05: Railway / Fly.io — Request Size Limits

**Gotcha:** Hosting platforms have default request body size limits (typically 1-10MB). LLM prompts with large RAG context chunks can exceed these.

**Impact:** Silent request truncation or 413 errors.

**Mitigation:** Keep total prompt payload under 500KB. Compress context on client side. Limit number of RAG chunks sent (top-3 is usually sufficient).

---

## Performance Traps

### PT-01: Double Serialization Latency

**The trap:** Client serializes prompt to JSON -> sends to proxy -> proxy deserializes -> re-serializes for OpenAI -> OpenAI responds -> proxy deserializes -> re-serializes for client. Each step adds 5-20ms.

**Impact:** 50-100ms of pure serialization overhead on top of network latency.

**Mitigation:** Pass the OpenAI request body through as-is where possible (avoid deserializing the full payload). Use `orjson` instead of `json` for 3-5x faster serialization.

### PT-02: DNS Resolution on Every Request

**The trap:** Each LLM call resolves `api.openai.com` DNS. On cheap hosting, DNS resolution can add 20-50ms per request.

**Impact:** 20-50ms added to every LLM call.

**Mitigation:** httpx connection pooling (with a persistent `AsyncClient`) caches DNS. Ensure you are reusing the client, not creating new ones.

### PT-03: TLS Handshake Overhead (Client -> Proxy -> OpenAI)

**The trap:** Two TLS handshakes per request: client-to-proxy and proxy-to-OpenAI. Each handshake is ~50-100ms.

**Impact:** First request in a session adds 100-200ms. Subsequent requests reuse connections if pooling is set up correctly.

**Mitigation:** HTTP/2 with connection reuse on both legs. Ensure `httpx.AsyncClient` is persistent (lifespan-managed). Client-side: use `httpx` or `requests.Session` with connection pooling.

### PT-04: Latency Budget Breakdown

**Target:** < 3 seconds total (silence detection -> answer displayed)

| Component | Budget | Notes |
|-----------|--------|-------|
| Silence detection | ~0ms | Already determined |
| Audio buffer retrieval | ~5ms | In-memory numpy |
| Whisper transcription | ~800ms | tiny.en, CPU |
| Network: client -> proxy | ~50ms | Depends on user location |
| License validation | ~5ms | In-memory lookup |
| Network: proxy -> OpenAI | ~50ms | Proxy near OpenAI (US-East) |
| OpenAI first-token latency | ~500ms | gpt-4o-mini |
| Token streaming | ~1000ms | ~50 tokens at ~20 tokens/sec |
| Network: proxy -> client | ~50ms | Streaming, continuous |
| **Total** | **~2460ms** | Within budget |

**Risk:** Any single component doubling blows the budget. Whisper is the biggest variable.

### PT-05: Client-Side Connection Reuse

**The trap:** Desktop app creates a new HTTP connection for each LLM request. TLS handshake + TCP setup adds 100-200ms each time.

**Impact:** Adds 100-200ms to every request unnecessarily.

**Mitigation:** Use `httpx.Client` (sync) or `httpx.AsyncClient` (async) as a persistent session in the desktop app. Keep it alive for the duration of the app session.

---

## Security Mistakes

### SM-01: No HTTPS on Proxy

**Mistake:** Running the backend proxy without TLS. License keys and LLM prompts (which contain interview answers, resume content) travel in plaintext.

**Fix:** All hosting platforms (Railway, Fly.io, Render) provide automatic HTTPS with free TLS certificates. Just use the provided `*.up.railway.app` domain. Never expose an HTTP-only endpoint.

### SM-02: License Key in URL Query Parameters

**Mistake:** Passing license key as `?key=abc123` in GET requests. URLs are logged in server access logs, proxy logs, browser history, and monitoring tools.

**Fix:** Send license key in the `Authorization` header: `Authorization: Bearer <license-key>`. Use POST for all LLM proxy requests.

### SM-03: No Rate Limiting on License Validation

**Mistake:** Allowing unlimited `/validate` endpoint calls. An attacker brute-forces valid keys by iterating through formats.

**Fix:** Rate limit the validation endpoint aggressively: 5 attempts per IP per minute. Use SlowAPI with in-memory storage. Return identical error messages for "invalid key" and "key not found" (prevents enumeration).

### SM-04: OpenAI API Key Leaks in Error Responses

**Mistake:** An unhandled exception in the proxy includes the OpenAI API key in the traceback that gets returned to the client.

**Fix:** Never return raw tracebacks to clients. Use FastAPI exception handlers. Set `debug=False` in production. Log full errors server-side only.

### SM-05: No Input Validation on Proxy Requests

**Mistake:** Proxy forwards whatever the client sends to OpenAI without validation. A modified client could use your API key for anything: image generation, fine-tuning, etc.

**Fix:** Validate and constrain proxy requests:
- Whitelist allowed models (`gpt-4o`, `gpt-4o-mini` only)
- Limit `max_tokens` (e.g., cap at 1000)
- Validate message format (must have system + user message)
- Reject requests with unexpected fields

### SM-06: License Key Format Leaks Generation Algorithm

**Mistake:** License keys follow an obvious pattern (sequential numbers, predictable prefixes) that lets someone generate valid keys.

**Fix:** Use `secrets.token_urlsafe(32)` for key generation (cryptographically random, no pattern). Store hashed keys server-side (`hashlib.sha256`), never plaintext. Compare with `hmac.compare_digest()`.

---

## UX Pitfalls

### UX-01: SmartScreen Warning Scares Away Users

**Problem:** User downloads the installer, Windows shows "Windows protected your PC" with a scary blue warning. Most users will not click "More info" -> "Run anyway."

**Impact:** 50-80% of non-technical users will abandon installation.

**Mitigation:**
- Code sign the installer and executable (OV certificate minimum)
- Provide clear installation instructions with screenshots showing "this warning is expected for new software"
- Distribute initial builds to trusted users first to build SmartScreen reputation
- Consider MSIX packaging as an alternative (better Windows integration, fewer warnings)

### UX-02: License Key Entry is Annoying

**Problem:** User has to find their email, copy the key, paste it into the app. Key is long and easy to mistype. No feedback on whether it is a license issue or a network issue.

**Impact:** First-run friction causes support tickets and abandonment.

**Mitigation:**
- Support clipboard paste with automatic whitespace trimming
- Show clear, specific error messages: "Invalid key format", "Key expired", "No internet connection"
- Cache the validated key locally so users only enter it once (store in platformdirs config folder, which Astra already uses)
- Provide a "Verify" button that checks the key before proceeding
- Show a link to "Where do I find my license key?" help

### UX-03: Proxy Errors Surface as Generic Failures

**Problem:** Backend is down, or user has no internet, or license expired. App shows "Error generating answer" with no actionable guidance.

**Impact:** User thinks the app is broken. Cannot self-diagnose.

**Mitigation:**
- Map HTTP status codes to user-friendly messages:
  - 401/403: "License key invalid or expired. Check your key in Settings."
  - 429: "Too many requests. Please wait a moment."
  - 500: "Server error. The team has been notified."
  - Timeout: "Could not reach the server. Check your internet connection."
  - Connection refused: "Astra server is temporarily offline. Try again in a few minutes."
- Show a small status indicator (green/yellow/red) in the toolbar for backend connectivity

### UX-04: Installer Requires Admin but Does Not Explain Why

**Problem:** Windows installer requests admin elevation. User on a corporate machine cannot proceed, or gets suspicious and cancels.

**Impact:** Corporate users (the primary market for interview prep) cannot install.

**Mitigation:**
- Install to user-space (`%LOCALAPPDATA%`) by default, which requires NO admin rights
- Only request elevation if the user explicitly chooses "Install for all users"
- Do not bundle Visual C++ Redistributable installation in the main installer flow; check for it and prompt separately if missing

### UX-05: Offline Mode Silently Breaks

**Problem:** User loses internet during an interview. App makes LLM call to proxy, times out after 10 seconds, returns nothing. User is left hanging during a live interview.

**Impact:** Catastrophic UX failure during the most critical moment.

**Mitigation:**
- Detect network state proactively (background health check ping every 30 seconds)
- If offline: show clear "Offline - answers unavailable" indicator BEFORE user asks a question
- Consider a degraded mode: show RAG context chunks directly without LLM formatting (local ChromaDB still works)
- Set aggressive client-side timeout (3 seconds) with immediate fallback behavior rather than hanging

---

## "Looks Done But Isn't" Checklist

These items are easy to forget, pass basic testing, but fail in production:

- [ ] **Tested on clean Windows VM** (not dev machine) -- catches missing DLLs, missing Python, missing VC++ runtime
- [ ] **Tested with real network latency** (not localhost proxy) -- catches timeout issues, buffering, cold starts
- [ ] **Tested with slow/unstable internet** -- catches missing timeouts, no retry logic, no offline handling
- [ ] **Tested with expired license key** -- catches client-side crash instead of graceful error
- [ ] **Tested with invalid license key format** -- catches unhandled exceptions in validation
- [ ] **Tested with concurrent users** (5+) -- catches connection pool exhaustion, rate limit sharing, race conditions
- [ ] **Tested streaming with Cloudflare/proxy in path** -- catches SSE buffering issues
- [ ] **Tested client disconnect mid-stream** -- catches resource leak in generator, OpenAI token waste
- [ ] **Tested after 8+ hours of idle** -- catches cold start on hosting, stale connections, memory leaks
- [ ] **Tested Windows installer on Windows 10 AND 11** -- catches OS-specific path/permission differences
- [ ] **Tested uninstaller** -- catches leftover files, registry entries, config folder not cleaned
- [ ] **Checked binary with VirusTotal** -- catches AV false positives before users encounter them
- [ ] **Verified OpenAI API key is NOT in the binary** -- run pyinstxtractor on your own exe and search for it
- [ ] **Verified error messages don't leak secrets** -- trigger every error path and check responses
- [ ] **Verified token usage logging works** -- send 10 requests and confirm token counts are recorded
- [ ] **Tested key revocation** -- revoke a key and verify it stops working within 1 request (not cached indefinitely)
- [ ] **Tested PyInstaller build with --debug=imports** -- catches hidden import issues before release

---

## Pitfall-to-Phase Mapping

| Phase | Pitfalls to Address | Priority |
|-------|-------------------|----------|
| **Architecture / Design** | P-02 (no secrets in client), SM-05 (input validation design), PT-04 (latency budget), TD-04 (error schema) | Do first |
| **Backend Proxy** | P-03 (SSE streaming), P-04 (cold starts), TD-01 (async), TD-02 (connection pooling), IG-01 (token usage), IG-02 (shared rate limits), PT-01 (serialization), SM-01 (HTTPS), SM-04 (error leaks), SM-05 (input validation) | Core phase |
| **License System** | P-05 (bypass prevention), SM-03 (rate limiting), SM-06 (key format), TD-05 (token counting), UX-02 (key entry UX) | Core phase |
| **Client Routing** | PT-03 (TLS overhead), PT-05 (connection reuse), UX-03 (error mapping), UX-05 (offline mode) | After proxy works |
| **Windows Installer** | P-01 (AV false positives), P-06 (missing DLLs), UX-01 (SmartScreen), UX-04 (admin permissions), TD-03 (version pinning) | Final phase |
| **Pre-Release Testing** | Full "Looks Done But Isn't" checklist | Gate release on this |

---

## Sources

### PyInstaller / Windows Packaging
- [PyInstaller AV False Positives (Issue #6754)](https://github.com/pyinstaller/pyinstaller/issues/6754) -- confidence: high
- [PyQt6 DLL Load Failed (Issue #8890)](https://github.com/pyinstaller/pyinstaller/issues/8890) -- confidence: high
- [Qt6 DLL Load Issues (Issue #7155)](https://github.com/pyinstaller/pyinstaller/issues/7155) -- confidence: high
- [PyInstaller When Things Go Wrong](https://pyinstaller.org/en/stable/when-things-go-wrong.html) -- confidence: high (official docs)
- [PyInstaller Hooks Documentation](https://pyinstaller.org/en/stable/hooks.html) -- confidence: high (official docs)
- [Reverse Engineering PyInstaller Apps](https://corgi.rip/blog/pyinstaller-reverse-engineering/) -- confidence: high
- [pyinstxtractor Tool](https://github.com/extremecoders-re/pyinstxtractor) -- confidence: high
- [Decompile Any Python Binary (WithSecure)](https://www2.withsecure.com/en/expertise/blog-posts/how-to-decompile-any-python-binary) -- confidence: high
- [MSIX Packaging with PyInstaller](https://82phil.github.io/python/2025/04/24/msix_pyinstaller.html) -- confidence: medium
- [Code Signing for SmartScreen](https://github.com/pyinstaller/pyinstaller/issues/6747) -- confidence: high

### FastAPI / Streaming / Proxy
- [FastAPI Client Disconnect Streaming (Issue #1342)](https://github.com/fastapi/fastapi/issues/1342) -- confidence: high
- [Stop Burning CPU on Dead Streams](https://jasoncameron.dev/posts/fastapi-cancel-on-disconnect) -- confidence: high
- [StreamingResponse Not Streaming with httpx (Issue #5600)](https://github.com/fastapi/fastapi/issues/5600) -- confidence: high
- [httpx Connection Pool with Streams (openai #763)](https://github.com/openai/openai-python/issues/763) -- confidence: high
- [OpenAI Proxy Forwarding Discussion](https://community.openai.com/t/how-to-forward-openais-stream-response-using-fastapi-in-python/963242) -- confidence: medium
- [Real-time OpenAI Streaming with FastAPI (Sevalla)](https://sevalla.com/blog/real-time-openai-streaming-fastapi/) -- confidence: medium
- [FastAPI SSE with Python (Medium)](https://medium.com/@nandagopal05/server-sent-events-with-python-fastapi-f1960e0c8e4b) -- confidence: medium
- [SlowAPI Rate Limiter](https://github.com/laurentS/slowapi) -- confidence: high
- [httpx Async Documentation](https://www.python-httpx.org/async/) -- confidence: high (official docs)
- [httpx Timeouts Documentation](https://www.python-httpx.org/advanced/timeouts/) -- confidence: high (official docs)

### License Key Systems
- [Generating License Keys in 2026 (fman)](https://build-system.fman.io/generating-license-keys) -- confidence: high
- [Keygen.sh Offline Licensing Model](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/) -- confidence: high
- [Ed25519 Cryptographic Verification (Keygen)](https://github.com/keygen-sh/example-python-cryptographic-verification) -- confidence: high
- [Microsoft Secure Licensing System (Azure)](https://techcommunity.microsoft.com/blog/appsonazureblog/building-a-cryptographically-secure-product-licensing-system-on-azure-functions-/4351330) -- confidence: medium
- [Python Rate Limiting Broken (GH Gist)](https://gist.github.com/justinvanwinkle/d9f04950083c4554835c1a35f9d22dad) -- confidence: medium

### Hosting / Cold Starts
- [Fly.io Cold Start Timeout (Community)](https://community.fly.io/t/cold-start-causes-1-minute-timeout-for-first-request-fastapi-nginx/25101) -- confidence: high
- [Fly.io 502 Bad Gateway on Cold Start](https://community.fly.io/t/serverless-cold-start-causes-nginx-502-bad-gateway-fastapi-nginx-docker/24457) -- confidence: high
- [Railway vs Fly.io Comparison](https://docs.railway.com/platform/compare-to-fly) -- confidence: high (official docs)
- [Python Hosting Options Compared 2025](https://www.nandann.com/blog/python-hosting-options-comparison) -- confidence: medium

### OpenAI API / Client Library
- [OpenAI proxies Kwarg Removed (Issue #1903)](https://github.com/openai/openai-python/issues/1903) -- confidence: high
- [OpenAI httpx 0.28 Breaking Change](https://community.openai.com/t/client-init-got-an-unexpected-keyword-argument-proxies-with-latest-openai-version-1-57-0-and-httpx-0-27-2/1044503) -- confidence: high
- [OpenAI Token Usage Tracking](https://community.openai.com/t/how-do-i-track-and-limit-api-token-usage-for-users-on-my-website/836605) -- confidence: medium
- [OpenAI Usage API Reference](https://platform.openai.com/docs/api-reference/usage) -- confidence: high (official docs)

### Windows Installer
- [Inno Setup Dependency Installer](https://github.com/DomGries/InnoDependencyInstaller) -- confidence: high
- [NSIS HTTPS Security Issue](https://nsis-dev.github.io/NSIS-Forums/html/t-367574.html) -- confidence: high
- [SmartScreen Reputation Building (MS Q&A)](https://learn.microsoft.com/en-us/answers/questions/2745466/defender-smartscreen-warning) -- confidence: high

---

*Research completed: 2026-02-16*
*Update when new pitfalls are discovered during implementation*
