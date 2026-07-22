# Feature Research: v3.0 Online Distribution & License Gating

**Domain:** Desktop interview copilot (Python/PyQt6/OpenAI)
**Date:** 2026-02-16
**Confidence Level:** High (cross-verified across multiple authoritative sources)
**Scope:** Solo developer, small-scale distribution, Windows-only initial release

---

## 1. License Key System

### Table Stakes (Users Expect These)

| Feature | Why It Matters | Implementation Notes |
|---------|---------------|---------------------|
| Simple key entry on first launch | Users are trained by Windows/Office/JetBrains pattern | Single text field + "Activate" button. No wizard, no multi-step. |
| Copy-paste friendly key format | Nobody wants to manually type 25 characters | UUID format (8-4-4-4-12 hex) or shorter 5x5 alphanumeric. UUID is easier to generate and validate. |
| Clear success/failure feedback | Users panic when activation is ambiguous | Green checkmark + "License activated" or red error with specific reason ("Invalid key", "Key already in use", "Key expired"). |
| Persistent activation | Users should not re-enter key every launch | Store activation token locally (platformdirs config directory, already used in v2.0). |
| Offline grace period after activation | Internet drops happen; app should not brick | 7-30 day grace period after last successful validation. Microsoft 365 uses 30 days; for a small app, 7 days is reasonable. |
| Key works immediately after purchase | Zero friction between payment and usage | Gumroad/Paddle webhook delivers key instantly via email. Key is pre-generated and mapped to purchase. |

### Differentiators (Competitive Advantage)

| Feature | Why It Helps | Effort |
|---------|-------------|--------|
| No account creation required | Key-only activation is frictionless vs. email/password signup | Low - just validate key against backend |
| Instant activation (no email verification) | Removes a step that causes 10-20% drop-off | Low - key is the credential |
| Machine-binding with easy transfer | Prevents casual sharing but lets user move to new PC | Medium - hash hardware ID, allow deactivation via simple request |
| Grace period notification | "Your license will be verified in X days" is better than sudden lockout | Low - local countdown timer |

### Anti-Features (Avoid These)

| Feature | Why It's Problematic |
|---------|---------------------|
| Phone-home on every launch | Annoying if backend is slow/down; users perceive as spying. Validate periodically (every 7 days), not every launch. |
| Hardware fingerprint that breaks on driver updates | Windows Update can change hardware IDs. Use stable identifiers (motherboard UUID + username hash), not volatile ones. |
| Complex activation wizards | Maltego/UiPath-style multi-step wizards are enterprise UX. Solo dev product should be one screen. |
| DRM that prevents offline use | Your users are in interviews - they NEED the app to work even if WiFi drops. Offline grace period is critical. |
| License tied to Windows installation | Reinstalling Windows should not invalidate the license. Allow reactivation or deactivation-reactivation flow. |
| Obfuscated error messages | "Error code 0x80070005" tells users nothing. Use plain English: "This license key is already active on another computer." |

### Key Format Decision

**Recommendation: UUID v4 (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)**

Rationale:
- Trivial to generate (`uuid.uuid4()`) with zero collision risk
- 36 characters but copy-paste friendly (users never type these manually)
- Standard format that every system handles correctly
- Delivered via email after Gumroad purchase, user pastes into app
- No need for custom key generation algorithms or checksum schemes

Alternative considered: 5x5 alphanumeric (`XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`) is more recognizable but requires custom generation logic and is harder to type without errors. Since keys will be copy-pasted from email, UUID is simpler.

---

## 2. Backend API Proxy

### Table Stakes (Users Expect These)

| Feature | Why It Matters | Implementation Notes |
|---------|---------------|---------------------|
| Streaming response forwarding | App currently streams tokens from OpenAI; proxy must preserve this | FastAPI with `StreamingResponse`, forward SSE chunks. LiteLLM and openai-proxy both demonstrate this pattern. |
| Sub-200ms proxy overhead | Core value is sub-3-second pipeline; proxy adds a network hop | Minimal middleware: validate key, forward request, stream response. No request queuing. |
| Proper error propagation | Users need to know if it's their key, the backend, or OpenAI failing | Map upstream errors to user-friendly messages: 401 = bad key, 429 = rate limit, 502 = OpenAI down, 503 = backend down. |
| HTTPS everywhere | License keys in transit must be encrypted | Default on Railway/Fly.io. TLS termination at the platform level. |
| Request timeout handling | OpenAI can hang; proxy should not hang forever | 60-second timeout for completions, 30-second for classifications. Return 504 with "Request timed out, please try again." |
| Rate limiting per license key | Prevent abuse (one key making 1000 requests/minute) | Token bucket: 20 RPM per key for completions, 60 RPM for classifications. Simple in-memory dict with timestamps. |

### Differentiators

| Feature | Why It Helps | Effort |
|---------|-------------|--------|
| Automatic retry on 429/500 from OpenAI | User never sees transient OpenAI errors | Low - 1 retry with 2s backoff before returning error to client |
| Usage tracking per license key | Know which users are heavy, detect sharing | Low - log request count + token usage per key per day |
| Cost monitoring alerts | Catch runaway usage before bill shock | Low - daily token sum check, alert if > threshold |
| Model routing (gpt-4o-mini for classify, gpt-4o for answers) | Proxy enforces correct model per endpoint, prevents abuse | Low - hardcode model per route, ignore client model parameter |

### Anti-Features (Avoid These)

| Feature | Why It's Problematic |
|---------|---------------------|
| Request caching/memoization | Interview questions are unique; caching adds complexity for zero benefit |
| Multi-region deployment | Overkill for < 100 users. Single region, closest to OpenAI (US East) |
| Load balancer / multiple instances | Single FastAPI instance handles thousands of concurrent connections. Scale when needed, not before. |
| Complex API gateway (Kong, APISIX) | Massive overhead for a proxy that does: validate key, forward to OpenAI. FastAPI middleware is sufficient. |
| WebSocket connections | SSE (Server-Sent Events) is simpler, already works with OpenAI streaming, and HTTP/1.1 compatible |

### Architecture Pattern

```
Desktop App                    Backend Proxy                 OpenAI
+-----------+     HTTPS       +---------------+    HTTPS    +--------+
|           | ─────────────── | FastAPI        | ──────────── | API    |
| PyQt6     |  POST /chat     | 1. Validate   |  POST /v1/ | gpt-4o |
| Client    |  + license_key  |    license key |  chat/comp | gpt-4o |
|           | ◄═══════════════ | 2. Forward req| ◄══════════ | -mini  |
| SSE stream|  SSE chunks     | 3. Stream back |  SSE chunks|        |
+-----------+                 +---------------+             +--------+
                                    │
                              SQLite/Postgres
                              (license keys,
                               usage logs)
```

### Proxy Endpoint Design

```
POST /v1/classify    - Question classification (gpt-4o-mini)
POST /v1/generate    - Answer generation with streaming (gpt-4o)
POST /v1/activate    - License key activation
GET  /v1/health      - Health check (returns 200 + OpenAI status)
```

Do NOT mirror the OpenAI API shape (`/v1/chat/completions`). Custom endpoints let you:
- Enforce the correct model per endpoint
- Include license key validation naturally
- Avoid exposing a generic LLM proxy that could be abused

---

## 3. Windows Installer

### Table Stakes (Users Expect These)

| Feature | Why It Matters | Implementation Notes |
|---------|---------------|---------------------|
| Standard install flow | Next > Next > Install > Finish. Users panic at anything non-standard. | Inno Setup or NSIS. Inno Setup is recommended: mature, well-documented, handles everything. |
| Desktop shortcut option | 90% of Windows users expect this | Inno Setup `[Icons]` section, checkbox on final page |
| Start Menu entry | Required for discoverability | Inno Setup `[Icons]` section, automatic |
| Clean uninstall | Users must be able to remove the app completely | Inno Setup handles Add/Remove Programs entry automatically. Clean up config dir on uninstall (prompt user). |
| Reasonable installer size | Users expect < 100MB for a utility app | PyInstaller one-dir mode + Inno Setup LZMA2 compression. Target: 50-80MB (Python runtime + faster-whisper + PyQt6). |
| No admin rights required (preferred) | Many corporate laptops restrict admin installs | Install to `%LOCALAPPDATA%\AstraInterviewCopilot`. Inno Setup supports per-user installs. |
| Progress bar during install | Visual feedback prevents "is it frozen?" anxiety | Built into Inno Setup, no extra work |

### Differentiators

| Feature | Why It Helps | Effort |
|---------|-------------|--------|
| Per-user install (no admin) | Works on corporate laptops where users can't elevate | Low - Inno Setup `PrivilegesRequired=lowest` |
| Silent install option | Power users appreciate `/SILENT` flag | Free with Inno Setup |
| Custom install path | Some users want control | Free with Inno Setup (default behavior) |
| Preserves user data on uninstall | ChromaDB vectors, config, prompts survive reinstall | Medium - separate data dir from install dir |

### Anti-Features (Avoid These)

| Feature | Why It's Problematic |
|---------|---------------------|
| Auto-update on launch | Blocks app startup, infuriating during time-sensitive interview prep. Notify + manual update instead. |
| Bundled VC++ redistributables | Most Windows 10/11 systems have these. Include only if testing shows they're missing. |
| Custom installer UI theme | Looks suspicious/unprofessional. Default Inno Setup theme is clean and trusted. |
| Mandatory reboot | Never required for a Python app. If your installer requests reboot, something is wrong. |
| Browser-based installer (Electron wrapper) | Defeats purpose of desktop app. Native installer only. |

### Code Signing Decision

**Recommendation: Start without code signing, add Microsoft Trusted Signing ($9.99/mo) when revenue justifies it.**

Rationale:
- SmartScreen warnings appear regardless with OV certs until reputation builds (Microsoft changed this in March 2024)
- EV certs cost $250-700/year and no longer bypass SmartScreen instantly
- Microsoft Trusted Signing at $9.99/mo is the new indie-friendly option
- For initial beta/early users, document the "Windows protected your PC" click-through in install instructions
- Add signing when > 50 downloads/month to build SmartScreen reputation organically

### Packaging Pipeline

```
Source Code
    ↓
PyInstaller (--onedir mode)
    ↓
dist/astra/ (folder with .exe + dependencies)
    ↓
Inno Setup Compiler
    ↓
AstraSetup-3.0.0.exe (~60-80MB)
    ↓
Upload to GitHub Releases / Gumroad
```

---

## 4. First-Run Experience

### Table Stakes (Users Expect These)

| Feature | Why It Matters | Implementation Notes |
|---------|---------------|---------------------|
| Single-screen activation | User pastes key, clicks Activate, sees result | Replace current API key entry screen. Same location, different content. |
| "Where do I get a key?" link | Users who got the installer without buying need direction | Hyperlink to purchase page. Opens default browser. |
| Offline-friendly first run | User might install on airplane, activate later | Allow app to open in "trial" or "pending activation" state, but block LLM features. |
| Remember activation across updates | Reinstalling the app should not require reactivation | Store activation in platformdirs config dir (already used for API key). |
| Clear error states | Invalid key, expired key, network error all need different messages | Three distinct states: success (green), invalid key (red), network error (yellow with "retry" button). |

### UX Flow

```
App Launch
    ↓
Check local activation token exists?
    ├── YES → Validate token age (< 7 days since last check?)
    │         ├── YES → Launch app normally
    │         └── NO  → Background revalidation
    │                   ├── Success → Update timestamp, launch app
    │                   └── Fail → Show warning "Offline mode (X days remaining)"
    │                              Launch app normally
    └── NO  → Show License Activation Screen
              ├── [License Key: _______________] [Activate]
              ├── "Don't have a key? Purchase here" (link)
              └── Result:
                  ├── Success → Store token, launch app
                  ├── Invalid key → "This license key is not valid. Check for typos."
                  ├── Key in use → "This key is active on another computer. Deactivate first at [link]."
                  └── Network error → "Can't reach activation server. Check internet connection." [Retry]
```

### Design Principles

1. **Activation screen replaces the current API key entry screen** - same position in app flow, different content.
2. **Never block the UI for validation** - background thread with signal bridge (existing pattern from v2.0).
3. **Local-first after activation** - audio capture, transcription, RAG all work offline. Only LLM calls need backend.
4. **Degrade gracefully** - if backend is unreachable during an active session, show "Connection issue - retrying" rather than crashing.

---

## 5. License Key Management (Backend)

### Table Stakes

| Feature | Why It Matters | Implementation Notes |
|---------|---------------|---------------------|
| Generate keys in bulk | Create 10-50 keys before a launch/sale | CLI script: `python manage.py generate-keys --count 20 --tier standard` |
| Activate/deactivate keys | Customer support for "I got a new computer" | CLI script: `python manage.py deactivate-key <key>` |
| Track active vs. unused keys | Know how many licenses are deployed | SQLite table: `keys(id, key, status, activated_at, hardware_id, last_validated)` |
| Revoke keys on refund | Gumroad refund webhook → deactivate key | Webhook endpoint: `POST /webhooks/gumroad` with signature verification |

### Differentiators

| Feature | Why It Helps | Effort |
|---------|-------------|--------|
| Usage dashboard (simple) | See requests/day per key, spot heavy users | Low - query usage_logs table, render in terminal or simple HTML |
| Expiring keys (time-limited trials) | "Try for 7 days" reduces purchase friction | Low - `expires_at` column, check during validation |
| Key tiers (standard/premium) | Premium gets faster model or more requests/day | Low - `tier` column, check during rate limiting |
| Gumroad purchase webhook | Auto-generate key on purchase, email to customer | Medium - webhook receiver + email send |

### Anti-Features (Avoid These)

| Feature | Why It's Problematic |
|---------|---------------------|
| Web admin dashboard | Massive frontend effort for a 50-user product. CLI tools are sufficient. |
| Customer self-service portal | Build when you have > 200 customers, not before. Handle support via email. |
| Multi-device licensing | Adds complexity to activation logic. Start with 1 key = 1 machine. |
| Usage-based billing | Requires metering, invoicing, payment integration. Fixed price per key is simpler. |
| Sophisticated anti-piracy | If someone reverse-engineers your Python app, a license check won't stop them. The goal is preventing casual sharing, not defeating hackers. |

### Database Schema (SQLite for MVP)

```sql
CREATE TABLE license_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT UNIQUE NOT NULL,           -- UUID v4
    tier        TEXT DEFAULT 'standard',        -- standard, premium, trial
    status      TEXT DEFAULT 'unused',          -- unused, active, revoked, expired
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP,
    expires_at  TIMESTAMP,                      -- NULL = perpetual
    hardware_id TEXT,                           -- hashed machine identifier
    email       TEXT,                           -- customer email (from Gumroad)
    last_validated TIMESTAMP
);

CREATE TABLE usage_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL,
    endpoint    TEXT NOT NULL,                  -- classify, generate
    tokens_used INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. Proxy Reliability

### Table Stakes

| Feature | Why It Matters | Implementation Notes |
|---------|---------------|---------------------|
| Health check endpoint | Monitoring and uptime verification | `GET /v1/health` returns `{"status": "ok", "openai": "reachable"}`. Check OpenAI with a lightweight models list call. |
| Timeout handling | OpenAI hangs should not hang the proxy | `httpx.AsyncClient(timeout=60)` for generate, `timeout=30` for classify. Return 504 on timeout. |
| Graceful error messages | Users see "Server is temporarily unavailable" not stack traces | Catch all exceptions at middleware level, return structured JSON errors. |
| Request logging | Debug issues, track usage | Log: timestamp, license_key (truncated), endpoint, status_code, latency_ms, tokens_used. |
| Startup validation | Fail fast if OpenAI key is missing/invalid | Check `OPENAI_API_KEY` on startup, refuse to start if invalid. |

### Differentiators

| Feature | Why It Helps | Effort |
|---------|-------------|--------|
| Retry once on OpenAI 429/500 | Transient errors don't reach the user | Low - wrap OpenAI call in retry with 2s delay |
| Circuit breaker pattern | If OpenAI is down, fail fast instead of queuing requests | Medium - track consecutive failures, trip after 5, reset after 60s |
| Cost cap per day | Prevent bill shock from a bug or abuse | Low - sum daily tokens per key, reject if > limit (e.g., 100K tokens/day) |
| Request ID in error responses | Customer says "I got an error" → you can find the exact request | Low - UUID per request, include in response headers |

### Anti-Features (Avoid These)

| Feature | Why It's Problematic |
|---------|---------------------|
| Multi-provider failover (OpenAI → Anthropic) | Different models = different prompt tuning = different answer quality. Stick with one provider. |
| Response caching | Interview answers are contextual and unique. Cache hit rate would be ~0%. |
| Complex observability stack (Prometheus, Grafana) | Overkill for one server. Structured JSON logs + Railway/Fly.io built-in metrics are sufficient. |
| Request queuing / job system | Adds latency. Direct proxy is faster. Queue only makes sense at > 1000 concurrent users. |

### Error Handling Matrix

| Scenario | HTTP Status | User-Facing Message | Backend Action |
|----------|-------------|---------------------|----------------|
| Invalid license key | 401 | "Invalid license key. Please check and try again." | Log attempt |
| Expired license key | 403 | "Your license has expired. Renew at [link]." | Log attempt |
| Rate limit exceeded (per-key) | 429 | "Too many requests. Please wait a moment." | Log, no retry |
| OpenAI rate limit (429) | 429 | "Service is busy. Retrying..." | Retry once after 2s |
| OpenAI server error (500) | 502 | "AI service temporarily unavailable. Please try again." | Retry once after 2s |
| OpenAI timeout | 504 | "Request timed out. Please try again." | Log timeout |
| Backend internal error | 500 | "Something went wrong. Please try again." | Log full traceback |
| Network unreachable (client-side) | N/A | "Cannot reach server. Check your internet connection." | Client-side detection |

---

## Feature Dependencies

```
Purchase Flow (Gumroad)
    ↓ delivers license key via email
License Key Management (Backend CLI tools)
    ↓ keys stored in database
License Validation Endpoint (Backend API)
    ↓ validates on activation + periodic recheck
First-Run Activation Screen (Desktop App)
    ↓ stores activation token locally
LLM Proxy Endpoints (Backend API)
    ↓ requires valid license key per request
Desktop App LLM Client (replaces direct OpenAI)
    ↓ routes through proxy instead of direct
Windows Installer (PyInstaller + Inno Setup)
    ↓ packages everything for distribution
```

**Critical path:** Backend proxy must exist before desktop client can be modified. License validation must work before activation screen is useful. Installer is the final packaging step.

---

## MVP Definition

### Launch With (v3.0.0)

These are required for the first public release:

1. **Backend proxy server** (FastAPI) with `/classify`, `/generate`, `/activate`, `/health` endpoints
2. **License key validation** - check key exists, is active, matches hardware ID
3. **Rate limiting** - simple per-key RPM limit (in-memory dict)
4. **Desktop license activation screen** - paste key, activate, store locally
5. **Desktop proxy client** - replace direct OpenAI calls with backend proxy calls
6. **Streaming response forwarding** - SSE from OpenAI through proxy to client
7. **Key generation CLI tool** - `generate-keys`, `list-keys`, `revoke-key`
8. **Windows installer** - PyInstaller + Inno Setup, per-user install, no admin required
9. **Offline grace period** - 7-day grace after last successful validation
10. **Error handling** - user-friendly messages for all failure modes
11. **SQLite database** - license keys + usage logs on backend

### Add After Launch (v3.1)

These improve the experience but are not blocking:

1. **Gumroad webhook integration** - auto-generate key on purchase
2. **Usage tracking dashboard** - CLI-based query of usage stats
3. **Key tiers** (standard/premium) - different rate limits or model access
4. **Time-limited trial keys** - 7-day trial for marketing
5. **Retry logic** - automatic retry on OpenAI 429/500 errors
6. **Circuit breaker** - fail fast when OpenAI is down
7. **Cost cap per key per day** - prevent abuse
8. **Microsoft Trusted Signing** - $9.99/mo code signing when revenue supports it

### Future (v3.2+)

These require more users/revenue to justify:

1. **Auto-update notifications** - check for new version, link to download
2. **Machine transfer flow** - deactivate old machine, reactivate on new
3. **Customer self-service portal** - manage own license, view usage
4. **Multi-provider failover** - if OpenAI is down, route to Anthropic
5. **Web admin dashboard** - manage licenses via browser
6. **macOS/Linux distribution** - expand beyond Windows

---

## Feature Prioritization Matrix

| Feature | User Impact | Dev Effort | Risk | Priority |
|---------|------------|------------|------|----------|
| Backend proxy (classify + generate) | Critical | Medium (2-3 days) | Medium - new infra | P0 |
| Streaming SSE forwarding | Critical | Medium (1-2 days) | Medium - tricky to debug | P0 |
| License key validation endpoint | Critical | Low (1 day) | Low | P0 |
| Desktop proxy client (replace OpenAI) | Critical | Medium (1-2 days) | Medium - touches core flow | P0 |
| License activation screen | Critical | Low (1 day) | Low - similar to API key screen | P0 |
| Key generation CLI tool | Critical | Low (0.5 day) | Low | P0 |
| SQLite schema + models | Critical | Low (0.5 day) | Low | P0 |
| Windows installer (PyInstaller + Inno) | Critical | Medium (1-2 days) | High - packaging is fiddly | P0 |
| Offline grace period (7 days) | High | Low (0.5 day) | Low | P0 |
| Error handling + user messages | High | Low (1 day) | Low | P0 |
| Rate limiting (per-key RPM) | High | Low (0.5 day) | Low | P1 |
| Usage logging | Medium | Low (0.5 day) | Low | P1 |
| Retry on OpenAI errors | Medium | Low (0.5 day) | Low | P1 |
| Gumroad webhook | Medium | Medium (1 day) | Medium - external API | P2 |
| Trial keys | Medium | Low (0.5 day) | Low | P2 |
| Code signing | Low (initially) | Low (setup) | Low | P2 |
| Auto-update notification | Low | Medium (1 day) | Low | P3 |
| Circuit breaker | Low | Low (0.5 day) | Low | P3 |
| Admin dashboard | Low | High (3-5 days) | Low | P4 |

---

## Estimated Total Effort

**P0 (Must launch):** ~8-12 days of focused development
**P1 (Should launch):** ~1.5 days additional
**P2 (Nice to launch):** ~2 days additional

**Realistic timeline:** 2-3 weeks for a solid v3.0 launch with P0 + P1 features.

---

## Technology Choices Summary

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Backend framework | FastAPI | Async, streaming support, lightweight, familiar Python |
| Backend database | SQLite | Zero-config, single file, sufficient for < 1000 users |
| Backend hosting | Railway or Fly.io | $5/mo, auto-TLS, easy deploy, good for solo dev |
| License key format | UUID v4 | Trivial generation, copy-paste friendly, no custom algorithm |
| Installer builder | Inno Setup | Free, mature, handles everything, industry standard |
| Packaging tool | PyInstaller (--onedir) | Existing experience from v1.0, proven with this codebase |
| Payment/distribution | Gumroad | Simplest for solo dev, handles payment + file delivery, license key API |
| Code signing | None initially, then Microsoft Trusted Signing ($9.99/mo) | Cost-effective, indie-friendly |

---

## Sources

### License Key Systems
- [Keygen.sh - Software Licensing and Distribution API](https://keygen.sh) - Confidence: High
- [Keygen - Choosing a Licensing Model (Offline)](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/) - Confidence: High
- [LicenseSpring - Offline Software License Validation](https://licensespring.com/blog/guide/how-to-implement-offline-software-license-validation) - Confidence: High
- [LicenseForge - Open Source License Management](https://github.com/AlexArtaud-Dev/LicenseForge) - Confidence: Medium
- [Top License Key Generator Tools 2026](https://licensemanager.at/license-key-generator-tools/) - Confidence: Medium
- [Stronglytyped - Building License Key Activation with Next.js/Supabase](https://stronglytyped.uk/articles/building-license-key-activation-system-nextjs-supabase-stripe) - Confidence: Medium

### Backend API Proxy
- [API7 - How API Gateways Proxy LLM Requests](https://api7.ai/learning-center/api-gateway-guide/api-gateway-proxy-llm-requests) - Confidence: High
- [LiteLLM - Timeout and Retry Documentation](https://docs.litellm.ai/docs/proxy/timeout) - Confidence: High
- [OpenAI - Rate Limits Guide](https://platform.openai.com/docs/guides/rate-limits) - Confidence: High
- [OpenAI - How to Handle Rate Limits](https://developers.openai.com/cookbook/examples/how_to_handle_rate_limits/) - Confidence: High
- [Vellum - LLM Router: Strategies for Failed Requests](https://www.vellum.ai/blog/what-to-do-when-an-llm-request-fails) - Confidence: High
- [TrueFoundry - Rate Limiting in LLM Gateway](https://www.truefoundry.com/blog/rate-limiting-in-llm-gateway) - Confidence: Medium
- [openai-proxy (Flask, SSE streaming)](https://github.com/wujianguo/openai-proxy) - Confidence: Medium
- [lm-proxy (FastAPI, multi-provider)](https://github.com/Nayjest/lm-proxy) - Confidence: Medium

### Windows Installer
- [Microsoft - Windows Application Development Best Practices](https://learn.microsoft.com/en-us/windows/apps/get-started/best-practices) - Confidence: High
- [AhmedSyntax - Creating Professional Installers with Inno Setup 2026](https://ahmedsyntax.com/creating-professional-installers-inno-setup/) - Confidence: High
- [PythonGUIs - Packaging Tkinter Apps with PyInstaller & InstallForge](https://www.pythonguis.com/tutorials/packaging-tkinter-applications-windows-pyinstaller/) - Confidence: Medium
- [Omaha Consulting - Best Update Frameworks for Windows](https://omaha-consulting.com/best-update-framework-for-windows) - Confidence: Medium

### Code Signing
- [SSL Insights - Best Code Signing Certificate for Windows Apps](https://sslinsights.com/best-code-signing-certificate-windows-applications/) - Confidence: High
- [Devas.life - Code Signing Certificate for Indie Developers](https://www.devas.life/code-signing-certificate-for-indie-developers/) - Confidence: High
- [Rick Strahl - Setting up Microsoft Trusted Signing](https://weblog.west-wind.com/posts/2025/Jul/20/Fighting-through-Setting-up-Microsoft-Trusted-Signing) - Confidence: High
- [Microsoft Q&A - SmartScreen Reputation with OV vs EV Certificates](https://learn.microsoft.com/en-us/answers/questions/417016/reputation-with-ov-certificates-and-are-ev-certifi) - Confidence: High

### Payment/Distribution
- [Gumroad - Sell Digital Products](https://gumroad.com) - Confidence: High
- [Indie Hackers - Payment Method to Sell Licenses](https://www.indiehackers.com/post/payment-method-to-sell-licenses-to-an-app-d5ff0ffb26) - Confidence: Medium
- [UserJot - Payment Processor Fees Compared](https://userjot.com/blog/stripe-polar-lemon-squeezy-gumroad-transaction-fees) - Confidence: Medium

### Health Checks & Reliability
- [AWS - Implementing Health Checks](https://aws.amazon.com/builders-library/implementing-health-checks/) - Confidence: High
- [Andrew Klotz - API Health Checks for Graceful Failure](https://klotzandrew.com/blog/api-health-checks-for-graceful-or-cascading-failure/) - Confidence: High
- [Cindy Sridharan - Health Checks in Distributed Systems](https://copyconstruct.medium.com/health-checks-in-distributed-systems-aa8a0e8c1672) - Confidence: High
- [API7 - Error Handling in APIs](https://api7.ai/learning-center/api-101/error-handling-apis) - Confidence: Medium

### Offline Grace Periods
- [Microsoft - Office 365 Offline Grace Period](https://learn.microsoft.com/en-us/deployoffice/overview-licensing-activation-microsoft-365-apps) - Confidence: High
- [Beyond Code - Offline License Key Validation](https://beyondco.de/course/desktop-apps-with-electron/licensing-your-apps/offline-license-key-validation) - Confidence: Medium

---

*Research completed: 2026-02-16*
*Next step: Create roadmap with phases based on this research*
