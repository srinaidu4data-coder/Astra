"""In-memory per-key rate limiting (no FastAPI dependency)."""

from __future__ import annotations

import time
from collections import defaultdict

# Structure: {(bucket, license_key_id): [timestamp, ...]}
_rate_limit_store: dict[tuple[str, int], list[float]] = defaultdict(list)


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int, bucket: str):
        self.retry_after = retry_after
        self.bucket = bucket
        super().__init__(f"rate_limited bucket={bucket} retry_after={retry_after}")


def clean_old_entries(bucket: str, key_id: int, window_seconds: float = 60.0) -> None:
    store_key = (bucket, key_id)
    cutoff = time.monotonic() - window_seconds
    _rate_limit_store[store_key] = [
        ts for ts in _rate_limit_store[store_key] if ts > cutoff
    ]


def enforce_limit(bucket: str, key_id: int, limit: int) -> None:
    """Raise RateLimitExceeded if over RPM; otherwise record this hit."""
    now = time.monotonic()
    store_key = (bucket, key_id)
    clean_old_entries(bucket, key_id)
    count = len(_rate_limit_store[store_key])
    if count >= limit:
        oldest = min(_rate_limit_store[store_key]) if _rate_limit_store[store_key] else now
        retry_after = max(1, int(60.0 - (now - oldest)))
        raise RateLimitExceeded(retry_after=retry_after, bucket=bucket)
    _rate_limit_store[store_key].append(now)


def reset_rate_limits_for_tests() -> None:
    _rate_limit_store.clear()
