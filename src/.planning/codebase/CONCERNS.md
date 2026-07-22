# Technical Concerns

**Analysis Date:** 2026-01-17

## Critical Issues

### 1. Exposed API Key in Version Control

**Severity:** CRITICAL
**File:** `.env`

The OpenAI API key is committed to the repository in plaintext.

**Risk:** Anyone with repository access can use the API key for unauthorized calls.

**Action Required:**
1. Revoke the key immediately in OpenAI dashboard
2. Remove from git history using `git filter-branch` or BFG
3. Create `.env.example` with placeholder
4. Verify `.env` is in `.gitignore`

### 2. Missing .env.example

**Severity:** HIGH
**Impact:** New developers don't know required environment variables.

**Action:** Create `.env.example`:
```
OPENAI_API_KEY=your-api-key-here
```

## Code Quality Issues

### 3. Large GUI Module

**Severity:** MEDIUM
**File:** `gui.py` (958 lines)

GUI logic, signal handling, audio control, and threading are mixed in one file.

**Concerns:**
- Hard to maintain and test
- Single responsibility principle violated
- Potential memory leaks with daemon threads

**Suggestion:** Split into `gui_widgets.py`, `gui_signals.py`, `gui_handlers.py`

### 4. Broad Exception Handling

**Severity:** MEDIUM
**Files:** Multiple

`except Exception as e:` used throughout, hiding specific errors:
- `config.py:99`
- `gui.py:91, 434, 510, 666, 717, 762`
- `main.py:22`
- `rag.py:157`
- `ingest.py:238`
- `transcriber.py:152`

**Action:** Replace with specific exception types.

### 5. Silent Failure on Missing Documents

**Severity:** MEDIUM
**File:** `main.py:22`

```python
except Exception:
    return False
```

Exception swallowed with no logging.

## Threading Concerns

### 6. Daemon Threads Without Cleanup

**Severity:** HIGH
**File:** `gui.py:611, 688, 729`

Background threads created as `daemon=True` but never tracked or joined.

**Risks:**
- In-flight API calls lost on app exit
- No graceful shutdown mechanism

**Action:** Store thread references, join on `closeEvent()` with timeout.

### 7. Race Condition in Auto-Answer Mode

**Severity:** HIGH
**File:** `gui.py:603-676`

`self.is_processing` flag checked without lock protection.

**Risk:** Multiple threads can bypass the check simultaneously.

**Action:** Use `threading.Lock()` to protect state changes.

### 8. Thread Reference During Cleanup

**Severity:** LOW
**File:** `transcriber.py:223`

Thread reference could be None during cleanup.

**Action:** Check thread existence before joining.

## Missing Error Handling

### 9. No Timeout on OpenAI API Calls

**Severity:** MEDIUM
**Files:** `rag.py:126-134`, `ingest.py:140-145`

No timeout specified for API calls.

**Risk:** Indefinite hangs if API is slow.

**Action:** Add `timeout=30` to API calls.

### 10. No Retry Logic for API

**Severity:** MEDIUM
**Files:** `rag.py`, `ingest.py`

Single API call with no retry on rate limits or network errors.

**Action:** Implement exponential backoff retry.

### 11. ChromaDB Validation

**Severity:** LOW
**File:** `main.py:16-23`

`collection.count()` could fail if database is corrupted.

## Configuration Issues

### 12. No Pinned Dependencies

**Severity:** HIGH
**File:** `requirements.txt`

No version pins (e.g., `faster-whisper` instead of `faster-whisper==1.0.2`).

**Risk:** Future installs may pull breaking changes.

**Action:** Pin major.minor versions:
```
faster-whisper==1.0.2
chromadb==0.5.0
openai==1.3.0
# etc.
```

### 13. Hardcoded Audio Device

**Severity:** LOW
**File:** `config.py:12`

Machine-specific device name hardcoded.

**Status:** Mitigated by fallback logic, but should be removed.

### 14. Model Names in Multiple Places

**Severity:** LOW
**Files:** `config.py`, `ingest.py`, `rag.py`

Model names repeated without central constant.

**Action:** Consolidate all model names in `config.py`.

## Performance Concerns

### 15. Memory Leak - Whisper Model

**Severity:** LOW
**File:** `transcriber.py:37-52`

Global `_whisper_model` cached but never released.

**Action:** Add cleanup method.

### 16. No Classification Cache

**Severity:** LOW
**File:** `rag.py:97-164`

Similar questions trigger new API calls each time.

**Suggestion:** Implement LRU cache for classifications.

### 17. Inefficient Audio Level

**Severity:** LOW
**File:** `transcriber.py:261-287`

`list(self._buffer)` copies full deque every 100ms.

**Action:** Access buffer slice without copying.

## Documentation Issues

### 18. Complex State Machine Undocumented

**Severity:** MEDIUM
**File:** `gui.py:41-47`

State transitions scattered across methods without documentation.

**Action:** Document state machine with diagram.

### 19. Magic Numbers

**Severity:** LOW
**File:** `gui.py`

Hardcoded values: slider ranges (30-95), font sizes, etc.

**Action:** Move to constants.

## Missing Features

### 20. Incomplete Question Queue

**Severity:** LOW
**File:** `gui.py:77, 673-675`

`self.question_queue` initialized but never used.

**Action:** Implement or remove.

### 21. No Unit Tests

**Severity:** HIGH
**Impact:** Changes can break functionality without detection.

See `TESTING.md` for recommended test coverage.

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Security | 2 | CRITICAL |
| Threading | 3 | HIGH |
| Error Handling | 3 | MEDIUM |
| Configuration | 3 | MEDIUM |
| Code Quality | 3 | MEDIUM |
| Performance | 3 | LOW |
| Documentation | 2 | LOW |
| Missing Features | 2 | LOW |
| **Total** | **21** | |

## Priority Fixes

1. **Revoke exposed API key** - Security breach
2. **Add `.env.example`** - Prevent future leaks
3. **Pin dependencies** - Prevent breakage
4. **Add threading locks** - Prevent race conditions
5. **Add API timeouts** - Prevent hangs
6. **Replace broad exceptions** - Improve debugging

---

*Concerns analysis: 2026-01-17*
*Update after addressing issues*
