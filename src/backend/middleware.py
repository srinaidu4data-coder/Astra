"""Rate limiting, request logging, and error handling middleware."""

import logging
import time

from fastapi import Depends, HTTPException

from backend.auth import validate_license
from backend.models import LicenseKey
from backend.rate_limit import (
    enforce_limit,
    RateLimitExceeded,
    reset_rate_limits_for_tests,
)

logger = logging.getLogger("astra.requests")


def _enforce_limit(bucket: str, key_id: int, limit: int) -> None:
    """Raise FastAPI 429 if over RPM."""
    try:
        enforce_limit(bucket, key_id, limit)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=429,
            detail={
                "error": {
                    "code": "rate_limited",
                    "message": "Too many requests. Please wait.",
                    "retry_after": e.retry_after,
                    "bucket": e.bucket,
                }
            },
        ) from e


async def check_rate_limit(
    license_key: LicenseKey = Depends(validate_license),
) -> LicenseKey:
    """Per-key rate limit for chat/completions traffic."""
    from backend.config import settings

    _enforce_limit("completions", license_key.id, settings.RATE_LIMIT_COMPLETIONS_RPM)
    return license_key


async def check_classifications_rate_limit(
    license_key: LicenseKey = Depends(validate_license),
) -> LicenseKey:
    """Higher ceiling for short classification-style chat calls."""
    from backend.config import settings

    _enforce_limit(
        "classifications",
        license_key.id,
        settings.RATE_LIMIT_CLASSIFICATIONS_RPM,
    )
    return license_key


async def check_embeddings_rate_limit(
    license_key: LicenseKey = Depends(validate_license),
) -> LicenseKey:
    """Separate per-key rate limit for embeddings (higher ceiling)."""
    from backend.config import settings

    _enforce_limit("embeddings", license_key.id, settings.RATE_LIMIT_EMBEDDINGS_RPM)
    return license_key


# ---------------------------------------------------------------------------
# Request logging middleware (REL-04)
# ---------------------------------------------------------------------------


class RequestLoggingMiddleware:
    """ASGI middleware that logs every request with structured fields."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.monotonic()
        status_code = 500  # Default — will be overwritten by actual response

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            latency_ms = (time.monotonic() - start) * 1000
            method = scope.get("method", "?")
            path = scope.get("path", "?")

            # Extract truncated license key from headers (first 8 chars for privacy)
            headers = dict(scope.get("headers", []))
            auth_header = headers.get(b"authorization", b"").decode(errors="replace")
            key_preview = "none"
            if auth_header.startswith("Bearer ") and len(auth_header) > 15:
                key_preview = auth_header[7:15] + "..."

            # Choose log level based on status code
            if status_code < 400:
                log_fn = logger.info
            elif status_code < 500:
                log_fn = logger.warning
            else:
                log_fn = logger.error

            log_fn(
                "method=%s path=%s status=%d latency_ms=%.1f key=%s",
                method,
                path,
                status_code,
                latency_ms,
                key_preview,
            )
