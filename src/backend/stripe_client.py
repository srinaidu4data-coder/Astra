"""Stripe client factory (StripeClient — not global stripe.api_key).

Uses the official Stripe Python SDK v15+ StripeClient pattern.
Sandbox / live keys come from STRIPE_SECRET_KEY in settings.
"""

from __future__ import annotations

from functools import lru_cache

from fastapi import HTTPException
from stripe import StripeClient

from backend.config import settings


def stripe_not_configured_error(message: str | None = None) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "error": {
                "code": "stripe_not_configured",
                "message": message
                or "Stripe is not configured. Set STRIPE_SECRET_KEY and at least one price id.",
            }
        },
    )


@lru_cache(maxsize=4)
def _client_for_key(api_key: str) -> StripeClient:
    # StripeClient is the supported entry point (not stripe.api_key = …)
    return StripeClient(api_key)


def get_stripe_client() -> StripeClient:
    key = (settings.STRIPE_SECRET_KEY or "").strip()
    if not key:
        raise stripe_not_configured_error()
    return _client_for_key(key)


def clear_stripe_client_cache() -> None:
    """Test helper — drop cached clients after env changes."""
    _client_for_key.cache_clear()
