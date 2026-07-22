---
status: human_needed
verified_at: 2026-02-16
phase: 10
---

# Phase 10 Verification: Desktop App Integration

**Phase Goal (ROADMAP.md):** "Desktop app routes all LLM calls through backend proxy using license key as auth, with no OpenAI API key on client"

## Must-Have 1: All LLM calls route through the backend proxy (no direct OpenAI calls remain)

**Status: PASS**

All OpenAI SDK calls in the desktop app use `base_url=proxy_url` which routes through the backend proxy. No direct `api.openai.com` calls remain.

### Evidence

**rag.py** -- Central OpenAI client factory (line 35-41):
```python
def _get_openai_client() -> OpenAI:
    """Create OpenAI client routed through the backend proxy."""
    license_key = get_license_key()
    if not license_key:
        raise RuntimeError("License key not configured. Please activate your license in the app.")
    proxy_url = get_proxy_url()
    return OpenAI(api_key=license_key, base_url=proxy_url)
```

All 5 LLM/embedding call sites in `rag.py` use `_get_openai_client()`:
- `/home/vinay/astra-mvp/rag.py:177` -- `_search_dense()` embeddings call
- `/home/vinay/astra-mvp/rag.py:436` -- `classify_utterance()` chat completion
- `/home/vinay/astra-mvp/rag.py:722` -- `generate_star_response()` streaming chat completion
- `/home/vinay/astra-mvp/rag.py:788` -- `generate_bullet_response()` streaming chat completion
- `/home/vinay/astra-mvp/rag.py:854` -- `generate_script_response()` streaming chat completion

**ingest.py** -- Embedding call (lines 237-244):
```python
license_key = get_license_key()
...
proxy_url = get_proxy_url()
openai_client = OpenAI(api_key=license_key, base_url=proxy_url)
```

**Backend proxy endpoints** that handle these calls:
- `/home/vinay/astra-mvp/backend/proxy.py:55` -- `POST /v1/chat/completions` (forwards to OpenAI)
- `/home/vinay/astra-mvp/backend/proxy.py:291` -- `POST /v1/embeddings` (forwards to OpenAI)

**Grep verification:** `grep -rn "api.openai.com" *.py` returns zero matches in any Python file.

**Default proxy URL** (`/home/vinay/astra-mvp/config.py:102`):
```python
_DEFAULT_PROXY_URL = "https://astra-proxy.up.railway.app/v1"
```

All OpenAI SDK constructor calls in desktop code (`rag.py:41`, `ingest.py:244`) pass `base_url=proxy_url`, which overrides the default OpenAI endpoint.

---

## Must-Have 2: App contains no OpenAI API key -- license key is the only credential

**Status: PASS (with advisory note)**

The desktop app code contains zero `OPENAI_API_KEY` references. The only credential used is the license key stored via `get_license_key()`.

### Evidence

**Desktop app Python files (no OPENAI_API_KEY):**
- `grep -rn "OPENAI_API_KEY" rag.py ingest.py gui.py config.py main.py transcriber.py` returns **zero matches**
- `grep -rn "get_api_key" rag.py ingest.py gui.py config.py` returns **zero matches**

**OPENAI_API_KEY exists ONLY in backend/ (server-side, intentionally):**
- `/home/vinay/astra-mvp/backend/config.py:11` -- `OPENAI_API_KEY: str = ""` (server env var)
- `/home/vinay/astra-mvp/backend/main.py:35-39` -- Server reads its own API key to forward to OpenAI

This is correct architecture: the backend server holds the real OpenAI key; the desktop app only holds a license key.

**`api_key=license_key` in SDK calls:** The `api_key` parameter in `OpenAI(api_key=license_key, ...)` at `rag.py:41` and `ingest.py:244` is the SDK's parameter name. The **value** passed is the license key (from `get_license_key()`), which the proxy validates as a Bearer token. The SDK sends it in the `Authorization: Bearer <license_key>` header.

### Advisory Note (non-blocking)

The root `.env.example` file (`/home/vinay/astra-mvp/.env.example`) is a stale artifact from Phase 4 that still references `OPENAI_API_KEY`:
```
OPENAI_API_KEY=sk-your-key-here
```
This file is:
- NOT read by any desktop app code (desktop reads `~/.config/astra/.env` via platformdirs)
- Only referenced in `astra.spec` for packaging (line 15), which bundles it as a template
- Listed in `.gitignore` for the actual `.env` (but `.env.example` IS tracked)

Additionally, the root `.env` file (`/home/vinay/astra-mvp/.env`) contains an actual OpenAI API key (`sk-proj-...`). This file is:
- Listed in `.gitignore` (not committed)
- NOT read by any desktop app code
- Only read by `backend/config.py` via Pydantic `SettingsConfigDict(env_file=".env")` when running the backend server locally

**Recommendation:** Update `.env.example` to reference `LICENSE_KEY` instead of `OPENAI_API_KEY` (or remove it), and update `astra.spec` accordingly. This is a documentation/hygiene issue, not a functional gap.

---

## Must-Have 3: License key persists locally across app restarts (platformdirs config)

**Status: PASS**

### Evidence

**platformdirs dependency** (`/home/vinay/astra-mvp/requirements.txt:10`):
```
platformdirs>=4.0.0
```

**Config directory via platformdirs** (`/home/vinay/astra-mvp/config.py:17-24`):
```python
from platformdirs import user_config_dir

def get_config_dir() -> Path:
    """Get cross-platform user config directory for Astra."""
    config_dir = Path(user_config_dir("astra"))
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir
```

**License key storage** (`/home/vinay/astra-mvp/config.py:69-95`):
- `get_license_key()` reads `LICENSE_KEY` from `~/.config/astra/.env` (Linux), `%APPDATA%/astra/.env` (Windows), `~/Library/Application Support/astra/.env` (macOS)
- `save_license_key(key)` writes `LICENSE_KEY=<key>` to the same file, preserving other entries
- `clear_license_key()` removes the `LICENSE_KEY` line

**Persistence verified in startup flow** (`/home/vinay/astra-mvp/gui.py:1659-1661`):
```python
# Check license key on startup
if not get_license_key():
    self._show_license_key_setup()
```

On first run, the license key dialog appears. After activation, `save_license_key(key)` writes to the platformdirs config file. On subsequent runs, `get_license_key()` reads it back -- no re-entry required.

---

## Must-Have 4: User can deactivate license from current machine to transfer

**Status: PASS (human_needed for visual UI verification)**

### Evidence

**Deactivate button in GUI** (`/home/vinay/astra-mvp/gui.py:830-847`):
```python
self.deactivate_btn = QPushButton("Deactivate License")
self.deactivate_btn.setToolTip("Deactivate license on this machine")
...
self.deactivate_btn.clicked.connect(self._deactivate_license)
```

**Deactivation handler** (`/home/vinay/astra-mvp/gui.py:1601-1636`):
1. Shows confirmation dialog (line 1603-1609)
2. Reads current license key via `get_license_key()` (line 1613)
3. Gets hardware ID via `get_hardware_id()` (line 1619)
4. Sends `POST /v1/license/deactivate` to backend with `license_key` and `hardware_id` (line 1622-1624)
5. On success (200): calls `clear_license_key()` to remove local key, shows confirmation, exits app (lines 1627-1630)
6. On error: shows warning dialog with error message (lines 1631-1636)

**Backend deactivation endpoint** (`/home/vinay/astra-mvp/backend/auth.py:172-208`):
- `POST /v1/license/deactivate` validates the key and hardware ID
- Sets `status = "unused"` and `hardware_id = None` (lines 203-204)
- After deactivation, the key can be activated on another machine

**License activation on new machine** (`/home/vinay/astra-mvp/gui.py:1663-1704`):
- `_show_license_key_setup()` prompts for license key
- Calls `POST /v1/license/activate` with `license_key` and new `hardware_id`
- On success, saves license key locally

### Human Verification Needed

- [ ] Visual confirmation that the "Deactivate License" button is visible and clickable in the running app
- [ ] End-to-end test: deactivate on machine A, activate on machine B

---

## Summary

| Must-Have | Status | Notes |
|-----------|--------|-------|
| 1. All LLM calls route through proxy | PASS | All 6 call sites use `base_url=proxy_url`. Zero direct OpenAI calls. |
| 2. No OpenAI API key on client | PASS | Desktop code has zero `OPENAI_API_KEY` refs. License key is sole credential. Stale `.env.example` is non-functional (advisory). |
| 3. License key persists via platformdirs | PASS | `platformdirs>=4.0.0` in requirements. `get_license_key()`/`save_license_key()` use `~/.config/astra/.env`. |
| 4. Deactivate license to transfer | PASS | "Deactivate License" button in GUI calls backend endpoint, clears local key. Human verification needed for visual/E2E test. |

**Overall Status: human_needed**

All four must-haves are implemented and verified in code. The `human_needed` status is because:
1. Visual UI testing of the deactivation button requires running the app
2. End-to-end license transfer (deactivate on machine A, activate on machine B) requires two machines and a running backend

### Non-blocking Advisory Items
- Root `.env.example` still references `OPENAI_API_KEY` -- should be updated to `LICENSE_KEY` or removed for consistency
- Root `.env` contains an actual OpenAI API key (gitignored, not read by desktop app, but a credential hygiene concern)
