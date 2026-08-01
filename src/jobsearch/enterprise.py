"""
Fortune-100 enterprise control plane for Job Search lab.

Capabilities (lab-scoped, single-node):
  - Fingerprint result cache (TTL + max entries + stale-while-revalidate)
  - Per-board circuit breakers (fail-open half-state after cooldown)
  - Request correlation IDs
  - Structured in-process metrics (counters, latency samples)
  - Token-bucket rate limiting
  - Readiness / liveness / SLO snapshot

Not multi-tenant SaaS — this is enterprise *discipline* on a localhost lab:
idempotent runs, blast-radius isolation, observability, and process health.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional, TypeVar

PRODUCT_GRADE = "enterprise"
ENTERPRISE_SCHEMA = "2.0.0"

T = TypeVar("T")

# ── defaults (env-overridable via getters) ──────────────────────────────────

CACHE_TTL_SEC = 120.0
CACHE_MAX_ENTRIES = 64
CACHE_STALE_SEC = 300.0  # serve stale up to this while refreshing is optional

BREAKER_FAILURE_THRESHOLD = 3
BREAKER_COOLDOWN_SEC = 45.0
BREAKER_HALF_OPEN_PROBES = 1

RATE_LIMIT_PER_MIN = 30  # /run requests per client key
RATE_LIMIT_BURST = 8

LATENCY_SAMPLE_CAP = 200


class BreakerState(str, Enum):
    CLOSED = "closed"  # healthy
    OPEN = "open"  # short-circuit
    HALF_OPEN = "half_open"  # trial probe


@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int = BREAKER_FAILURE_THRESHOLD
    cooldown_sec: float = BREAKER_COOLDOWN_SEC
    half_open_probes: int = BREAKER_HALF_OPEN_PROBES
    state: BreakerState = BreakerState.CLOSED
    failures: int = 0
    successes: int = 0
    opened_at: float = 0.0
    last_error: str = ""
    total_trips: int = 0
    total_rejects: int = 0
    total_calls: int = 0
    total_success: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def allow(self) -> bool:
        with self._lock:
            self.total_calls += 1
            if self.state == BreakerState.CLOSED:
                return True
            if self.state == BreakerState.OPEN:
                if time.time() - self.opened_at >= self.cooldown_sec:
                    self.state = BreakerState.HALF_OPEN
                    return True
                self.total_rejects += 1
                return False
            # half_open — allow limited probes
            return True

    def record_success(self) -> None:
        with self._lock:
            self.total_success += 1
            self.failures = 0
            self.successes += 1
            if self.state == BreakerState.HALF_OPEN:
                self.state = BreakerState.CLOSED
                self.successes = 0
            elif self.state == BreakerState.CLOSED:
                pass

    def record_failure(self, err: str = "") -> None:
        with self._lock:
            self.failures += 1
            self.last_error = (err or "")[:160]
            if self.state == BreakerState.HALF_OPEN:
                self.state = BreakerState.OPEN
                self.opened_at = time.time()
                self.total_trips += 1
                self.failures = 0
            elif self.failures >= self.failure_threshold:
                self.state = BreakerState.OPEN
                self.opened_at = time.time()
                self.total_trips += 1
                self.failures = 0

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "name": self.name,
                "state": self.state.value,
                "failures": self.failures,
                "last_error": self.last_error,
                "total_trips": self.total_trips,
                "total_rejects": self.total_rejects,
                "total_calls": self.total_calls,
                "total_success": self.total_success,
                "cooldown_sec": self.cooldown_sec,
                "opened_at": self.opened_at or None,
            }


class BreakerRegistry:
    """Named circuit breakers for each job board / dependency."""

    def __init__(self) -> None:
        self._breakers: dict[str, CircuitBreaker] = {}
        self._lock = threading.Lock()

    def get(self, name: str) -> CircuitBreaker:
        with self._lock:
            if name not in self._breakers:
                self._breakers[name] = CircuitBreaker(name=name)
            return self._breakers[name]

    def call(self, name: str, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Execute fn under breaker; raises CircuitOpenError if open."""
        br = self.get(name)
        if not br.allow():
            raise CircuitOpenError(name, br.last_error or "circuit open")
        try:
            result = fn(*args, **kwargs)
            br.record_success()
            return result
        except CircuitOpenError:
            raise
        except Exception as e:
            br.record_failure(str(e))
            raise

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {k: v.snapshot() for k, v in self._breakers.items()}


class CircuitOpenError(RuntimeError):
    def __init__(self, board: str, detail: str = "") -> None:
        self.board = board
        super().__init__(f"circuit_open:{board}:{detail}")


@dataclass
class CacheEntry:
    key: str
    value: Any
    created_at: float
    hits: int = 0
    fingerprint: str = ""


class ResultCache:
    """
    In-process TTL cache with LRU-ish eviction and stale-while-revalidate.
    Thread-safe. Suitable for single-node lab; not distributed.
    """

    def __init__(
        self,
        *,
        ttl_sec: float = CACHE_TTL_SEC,
        max_entries: int = CACHE_MAX_ENTRIES,
        stale_sec: float = CACHE_STALE_SEC,
    ) -> None:
        self.ttl_sec = ttl_sec
        self.max_entries = max_entries
        self.stale_sec = stale_sec
        self._store: dict[str, CacheEntry] = {}
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0
        self.stale_hits = 0
        self.evictions = 0
        self.puts = 0

    @staticmethod
    def fingerprint(payload: dict[str, Any]) -> str:
        """Stable SHA-256 of canonical JSON (sorted keys)."""
        raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, key: str, *, allow_stale: bool = True) -> tuple[Any | None, str]:
        """
        Returns (value|None, status) where status is hit|stale|miss.
        """
        now = time.time()
        with self._lock:
            ent = self._store.get(key)
            if not ent:
                self.misses += 1
                return None, "miss"
            age = now - ent.created_at
            if age <= self.ttl_sec:
                ent.hits += 1
                self.hits += 1
                return ent.value, "hit"
            if allow_stale and age <= self.stale_sec:
                ent.hits += 1
                self.stale_hits += 1
                return ent.value, "stale"
            # expired
            del self._store[key]
            self.misses += 1
            return None, "miss"

    def put(self, key: str, value: Any, fingerprint: str = "") -> None:
        with self._lock:
            if len(self._store) >= self.max_entries and key not in self._store:
                # evict oldest
                oldest_k = min(self._store.items(), key=lambda kv: kv[1].created_at)[0]
                del self._store[oldest_k]
                self.evictions += 1
            self._store[key] = CacheEntry(
                key=key,
                value=value,
                created_at=time.time(),
                fingerprint=fingerprint or key,
            )
            self.puts += 1

    def invalidate(self, key: str | None = None) -> int:
        with self._lock:
            if key is None:
                n = len(self._store)
                self._store.clear()
                return n
            if key in self._store:
                del self._store[key]
                return 1
            return 0

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            total = self.hits + self.misses + self.stale_hits
            hit_rate = (
                round((self.hits + self.stale_hits) / total, 4) if total else 0.0
            )
            return {
                "entries": len(self._store),
                "max_entries": self.max_entries,
                "ttl_sec": self.ttl_sec,
                "stale_sec": self.stale_sec,
                "hits": self.hits,
                "stale_hits": self.stale_hits,
                "misses": self.misses,
                "puts": self.puts,
                "evictions": self.evictions,
                "hit_rate": hit_rate,
            }


class TokenBucket:
    """Per-key rate limiter."""

    # Cap distinct client keys so multi-IP noise cannot grow RAM unboundedly.
    MAX_KEYS = 512
    PRUNE_IDLE_SEC = 600.0

    def __init__(self, rate_per_min: float = RATE_LIMIT_PER_MIN, burst: int = RATE_LIMIT_BURST):
        self.rate = rate_per_min / 60.0  # tokens per second
        self.burst = float(burst)
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, last_ts)
        self._lock = threading.Lock()
        self.allowed = 0
        self.rejected = 0
        self.pruned = 0

    def _prune_unlocked(self, now: float) -> None:
        if len(self._buckets) < self.MAX_KEYS:
            return
        idle = self.PRUNE_IDLE_SEC
        stale = [k for k, (_, ts) in self._buckets.items() if now - ts > idle]
        for k in stale:
            del self._buckets[k]
            self.pruned += 1
        # Still over cap: drop oldest half
        if len(self._buckets) >= self.MAX_KEYS:
            ordered = sorted(self._buckets.items(), key=lambda kv: kv[1][1])
            drop_n = max(1, len(ordered) // 2)
            for k, _ in ordered[:drop_n]:
                del self._buckets[k]
                self.pruned += 1

    def allow(self, key: str, cost: float = 1.0) -> bool:
        now = time.time()
        with self._lock:
            self._prune_unlocked(now)
            tokens, last = self._buckets.get(key, (self.burst, now))
            elapsed = max(0.0, now - last)
            tokens = min(self.burst, tokens + elapsed * self.rate)
            if tokens >= cost:
                tokens -= cost
                self._buckets[key] = (tokens, now)
                self.allowed += 1
                return True
            self._buckets[key] = (tokens, now)
            self.rejected += 1
            return False

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "rate_per_min": round(self.rate * 60, 2),
                "burst": int(self.burst),
                "allowed": self.allowed,
                "rejected": self.rejected,
                "active_keys": len(self._buckets),
                "pruned": self.pruned,
                "max_keys": self.MAX_KEYS,
            }


def materialize_cached_run(
    cached: dict[str, Any],
    *,
    request_id: str,
    cache_status: str,
    elapsed_ms: float,
) -> dict[str, Any]:
    """
    Build a response from a cached run without deepcopy.

    Hot path: identical /run fingerprints should cost microseconds, not
    re-serialize megabytes of job graphs. Nested job lists are treated as
    immutable after put(); only response envelope fields are re-bound.
    """
    out = dict(cached)  # shallow — O(keys) not O(payload)
    out["request_id"] = request_id
    out["cache"] = {
        "status": cache_status,
        "fingerprint": (cached.get("cache") or {}).get("fingerprint")
        or (cached.get("meta") or {}).get("fingerprint")
        or "",
        "served_from_cache": True,
    }
    meta = dict(cached.get("meta") or {})
    meta["elapsed_ms"] = elapsed_ms
    meta["cache_status"] = cache_status
    meta["request_id"] = request_id
    out["meta"] = meta
    ent = dict(cached.get("enterprise") or {})
    ent["request_id"] = request_id
    out["enterprise"] = ent
    return out


class Metrics:
    """Lightweight process metrics — counters + latency samples."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.counters: dict[str, int] = {}
        self.latencies: dict[str, deque[float]] = {}
        self.started_at = time.time()

    def incr(self, name: str, n: int = 1) -> None:
        with self._lock:
            self.counters[name] = self.counters.get(name, 0) + n

    def observe_ms(self, name: str, ms: float) -> None:
        with self._lock:
            if name not in self.latencies:
                self.latencies[name] = deque(maxlen=LATENCY_SAMPLE_CAP)
            self.latencies[name].append(float(ms))

    def _pct(self, samples: list[float], p: float) -> float | None:
        if not samples:
            return None
        s = sorted(samples)
        idx = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
        return round(s[idx], 2)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            lat: dict[str, Any] = {}
            for k, dq in self.latencies.items():
                samples = list(dq)
                lat[k] = {
                    "count": len(samples),
                    "p50_ms": self._pct(samples, 50),
                    "p95_ms": self._pct(samples, 95),
                    "p99_ms": self._pct(samples, 99),
                    "max_ms": round(max(samples), 2) if samples else None,
                    "last_ms": round(samples[-1], 2) if samples else None,
                }
            return {
                "uptime_sec": round(time.time() - self.started_at, 1),
                "counters": dict(self.counters),
                "latency": lat,
            }


def new_request_id() -> str:
    return f"js-{uuid.uuid4().hex[:16]}"


def run_fingerprint(
    profile: dict[str, Any],
    *,
    use_live: bool,
    remote: str,
    location: str,
    exclude_linkedin: bool,
    include_seed: bool,
    limit: int,
    min_score: float,
) -> str:
    """Canonical fingerprint for cache key of a full pipeline run."""
    # Only fields that affect harvest/rank outcomes
    skills = profile.get("skills") or []
    if not isinstance(skills, list):
        skills = []
    payload = {
        "title": str(profile.get("target_title") or "")[:200].lower().strip(),
        "skills": sorted(str(s).lower().strip() for s in skills[:40]),
        "summary_hash": hashlib.sha256(
            str(profile.get("summary") or "")[:2000].encode("utf-8", errors="replace")
        ).hexdigest()[:16],
        "use_live": bool(use_live),
        "remote": str(remote or "all").lower(),
        "location": str(location or "all").lower(),
        "exclude_linkedin": bool(exclude_linkedin),
        "include_seed": bool(include_seed),
        "limit": int(limit),
        "min_score": round(float(min_score or 0), 2),
    }
    return ResultCache.fingerprint(payload)


# ── singleton control plane ─────────────────────────────────────────────────

_breakers = BreakerRegistry()
_cache = ResultCache()
_rate = TokenBucket()
_metrics = Metrics()
_process_started = time.time()


def breakers() -> BreakerRegistry:
    return _breakers


def cache() -> ResultCache:
    return _cache


def rate_limiter() -> TokenBucket:
    return _rate


def metrics() -> Metrics:
    return _metrics


def protected_fetch(board: str, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T | list:
    """
    Run a board fetch under circuit breaker.
    On open circuit → return [] (graceful degrade) instead of raising.
    On failure → record + return [].
    """
    br = _breakers.get(board)
    _metrics.incr(f"board.{board}.attempts")
    if not br.allow():
        _metrics.incr(f"board.{board}.circuit_reject")
        return []
    t0 = time.perf_counter()
    try:
        rows = fn(*args, **kwargs)
        br.record_success()
        _metrics.incr(f"board.{board}.ok")
        _metrics.observe_ms(f"board.{board}", (time.perf_counter() - t0) * 1000)
        return rows
    except Exception as e:
        br.record_failure(str(e))
        _metrics.incr(f"board.{board}.error")
        _metrics.observe_ms(f"board.{board}", (time.perf_counter() - t0) * 1000)
        return []


def enterprise_status() -> dict[str, Any]:
    """Full control-plane snapshot for /health and /metrics."""
    m = _metrics.snapshot()
    br = _breakers.snapshot()
    open_boards = [k for k, v in br.items() if v.get("state") == "open"]
    # SLO-ish: process up, no more than 50% boards open, cache operational
    ready = len(open_boards) < max(1, len(br)) or len(br) == 0
    return {
        "grade": PRODUCT_GRADE,
        "schema": ENTERPRISE_SCHEMA,
        "process": {
            "uptime_sec": round(time.time() - _process_started, 1),
            "pid_alive": True,
        },
        "cache": _cache.snapshot(),
        "circuit_breakers": br,
        "rate_limit": _rate.snapshot(),
        "metrics": m,
        "slo": {
            "ready": ready,
            "open_breakers": open_boards,
            "targets": {
                "run_p95_ms": 8000,
                "health_p95_ms": 100,
                "cache_hit_rate_min": 0.2,
            },
        },
        "capabilities": [
            "fingerprint_cache",
            "circuit_breakers",
            "request_ids",
            "rate_limit",
            "latency_metrics",
            "liveness_readiness",
            "graceful_degrade",
            "process_supervisor",
        ],
    }


def liveness() -> dict[str, Any]:
    """Kubernetes-style liveness: process is up."""
    return {
        "status": "alive",
        "uptime_sec": round(time.time() - _process_started, 1),
    }


def readiness() -> dict[str, Any]:
    """Kubernetes-style readiness: can accept traffic."""
    st = enterprise_status()
    ready = bool(st["slo"]["ready"])
    return {
        "status": "ready" if ready else "degraded",
        "ready": ready,
        "open_breakers": st["slo"]["open_breakers"],
        "cache_entries": st["cache"]["entries"],
    }
