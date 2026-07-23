"""JWT session helpers for Google-authenticated users."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from backend.config import settings
from backend.database import get_session
from backend.models import User

security = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"

# Statuses that mean "paid and usable right now"
_ACTIVE_STATUSES = frozenset({"active", "trialing"})
# Statuses that mean "must re-pay"
_DEAD_STATUSES = frozenset({"none", "canceled", "unpaid", "refunded", "incomplete_expired"})


def create_access_token(*, user_id: int, email: str) -> str:
    """Issue a signed JWT for the given user."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.JWT_EXPIRE_HOURS)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def create_oauth_state() -> str:
    """Signed OAuth CSRF state (survives process restarts unlike in-memory sets)."""
    import secrets

    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "google_oauth",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=15)).timestamp()),
        "n": secrets.token_urlsafe(12),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def verify_oauth_state(state: str) -> bool:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=[ALGORITHM])
        return payload.get("purpose") == "google_oauth"
    except jwt.InvalidTokenError:
        return False


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT. Raises HTTPException on failure."""
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "token_expired",
                    "message": "Session expired. Please sign in again.",
                }
            },
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "invalid_token",
                    "message": "Invalid session token.",
                }
            },
        ) from exc


def user_has_active_subscription(user: User) -> bool:
    """True when the user may use paid features.

    Refunds and explicit revocations always block access, even if Stripe status
    lags as 'active' for a moment.
    """
    if settings.AUTH_DEV_BYPASS:
        return True

    if user.access_revoked_reason in ("refund", "payment_failed"):
        # Refund / hard fail always blocks until a new successful sub sync clears it
        return False

    status = (user.subscription_status or "none").lower()
    if status in _DEAD_STATUSES:
        return False
    if status not in _ACTIVE_STATUSES:
        # past_due: still allow a short grace if period not ended? → no, force update card
        if status == "past_due":
            return False
        return False

    if user.subscription_current_period_end is None:
        return True
    end = user.subscription_current_period_end
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return end > datetime.now(timezone.utc)


def user_public_dict(user: User) -> dict[str, Any]:
    """Safe user payload for the frontend."""
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture_url": user.picture_url,
        "subscription_status": user.subscription_status,
        "subscription_active": user_has_active_subscription(user),
        "subscription_current_period_end": (
            user.subscription_current_period_end.isoformat()
            if user.subscription_current_period_end
            else None
        ),
        "access_revoked_reason": user.access_revoked_reason,
        "welcome_email_sent": user.welcome_email_sent,
        "last_email_error": user.last_email_error,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    session: Session = Depends(get_session),
) -> User:
    """Require a valid Bearer JWT and return the User row."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "missing_token",
                    "message": "Sign in with Google to continue.",
                }
            },
        )

    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "invalid_token",
                    "message": "Invalid session token.",
                }
            },
        )

    user = session.get(User, int(user_id))
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "user_not_found",
                    "message": "Account not found. Please sign in again.",
                }
            },
        )
    return user


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    session: Session = Depends(get_session),
) -> User | None:
    """Return user if a valid token is present; otherwise None."""
    if credentials is None or not credentials.credentials:
        return None
    try:
        return await get_current_user(credentials, session)
    except HTTPException:
        return None


async def require_active_subscriber(
    user: User = Depends(get_current_user),
) -> User:
    """Require signed-in user with an active monthly subscription."""
    if settings.AUTH_DEV_BYPASS:
        return user
    if not user_has_active_subscription(user):
        reason = user.access_revoked_reason or user.subscription_status or "none"
        raise HTTPException(
            status_code=402,
            detail={
                "error": {
                    "code": "subscription_required",
                    "message": (
                        "An active subscription is required. "
                        f"Current status: {reason}. Complete checkout or resolve billing."
                    ),
                    "subscription_status": user.subscription_status,
                    "access_revoked_reason": user.access_revoked_reason,
                }
            },
        )
    return user


def token_from_request(request: Request) -> str | None:
    """Extract Bearer token from Authorization header if present."""
    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None
