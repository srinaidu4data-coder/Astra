"""Google (Gmail) OAuth sign-in + session endpoints.

Fixes:
- Signed OAuth state (no in-memory CSRF loss on reload)
- Welcome email retries if first SMTP attempt failed
- Auth config exposes SMTP/Stripe readiness for UI diagnostics
- Non-blocking email send path after login
"""

from __future__ import annotations

import logging
from datetime import datetime
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.config import settings
from backend.database import get_session
from backend.email_service import send_welcome_email, smtp_self_check
from backend.jwt_auth import (
    create_access_token,
    create_oauth_state,
    get_current_user,
    promote_admin_if_listed,
    user_has_active_subscription,
    user_public_dict,
    verify_oauth_state,
)
from backend.models import User

logger = logging.getLogger("astra.oauth")

router = APIRouter(prefix="/v1/auth", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


class AuthConfigResponse(BaseModel):
    auth_required: bool
    google_configured: bool
    email_password_enabled: bool
    stripe_configured: bool
    smtp_configured: bool
    forgot_password_ready: bool
    dev_bypass: bool
    frontend_url: str
    public_api_url: str
    diagnostics: dict


class MeResponse(BaseModel):
    user: dict
    subscription_active: bool


@router.get("/config", response_model=AuthConfigResponse)
async def auth_config() -> AuthConfigResponse:
    """Public bootstrap flags for the UI (no secrets)."""
    email_pw = settings.EMAIL_PASSWORD_AUTH_ENABLED
    # Gate when Google OAuth OR email/password is available
    can_sign_in = settings.google_oauth_configured or email_pw
    return AuthConfigResponse(
        auth_required=bool(settings.AUTH_REQUIRED and can_sign_in),
        google_configured=settings.google_oauth_configured,
        email_password_enabled=email_pw,
        stripe_configured=settings.stripe_configured,
        smtp_configured=settings.smtp_configured,
        forgot_password_ready=bool(email_pw and settings.smtp_configured),
        dev_bypass=settings.AUTH_DEV_BYPASS,
        frontend_url=settings.FRONTEND_URL,
        public_api_url=settings.PUBLIC_API_URL,
        diagnostics={
            "env_file_hint": "src/.env",
            "google_redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "smtp": smtp_self_check(),
            "stripe_price_set": bool(
                settings.STRIPE_PRICE_ID.strip()
                or settings.STRIPE_PRICE_PRO_MONTHLY.strip()
                or settings.STRIPE_PRICE_INTERVIEW_PASS.strip()
                or settings.STRIPE_PRICE_INTERVIEW_SPRINT.strip()
            ),
            "stripe_webhook_secret_set": bool(settings.STRIPE_WEBHOOK_SECRET.strip()),
            "jwt_secret_is_default": settings.JWT_SECRET.startswith("change-me"),
            "password_reset_expire_minutes": settings.PASSWORD_RESET_EXPIRE_MINUTES,
            "email_password_auth": email_pw,
        },
    )


@router.get("/google")
async def google_login_start() -> RedirectResponse:
    """Redirect browser to Google consent screen."""
    if not settings.google_oauth_configured:
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "code": "google_not_configured",
                    "message": (
                        "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and "
                        "GOOGLE_CLIENT_SECRET in src/.env"
                    ),
                }
            },
        )

    state = create_oauth_state()
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID.strip(),
        "redirect_uri": settings.GOOGLE_REDIRECT_URI.strip(),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "include_granted_scopes": "true",
        "prompt": "select_account",
        "state": state,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


def _maybe_send_welcome(session: Session, user: User) -> None:
    """Send welcome email if never sent (or last attempt failed). Does not block forever."""
    if user.welcome_email_sent:
        return
    if not settings.WELCOME_EMAIL_ENABLED:
        user.welcome_email_sent = True
        user.last_email_error = None
        session.add(user)
        session.commit()
        return

    ok, err = send_welcome_email(to_email=user.email, name=user.name)
    if ok:
        user.welcome_email_sent = True
        user.last_email_error = None
    else:
        user.welcome_email_sent = False
        user.last_email_error = (err or "unknown")[:500]
        logger.warning("Welcome email failed for %s: %s", user.email, err)
    session.add(user)
    session.commit()


@router.get("/google/callback")
async def google_login_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: Session = Depends(get_session),
) -> RedirectResponse:
    """Handle Google redirect, create/update user, issue JWT to frontend."""
    frontend = settings.FRONTEND_URL.rstrip("/")

    def fail(msg: str) -> RedirectResponse:
        q = urlencode({"error": msg})
        return RedirectResponse(f"{frontend}/#/auth?{q}")

    if error:
        return fail(error)
    if not code or not state:
        return fail("missing_code_or_state")
    if not verify_oauth_state(state):
        return fail("invalid_or_expired_state")

    if not settings.google_oauth_configured:
        return fail("google_not_configured")

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            token_res = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID.strip(),
                    "client_secret": settings.GOOGLE_CLIENT_SECRET.strip(),
                    "redirect_uri": settings.GOOGLE_REDIRECT_URI.strip(),
                    "grant_type": "authorization_code",
                },
            )
            if token_res.status_code >= 400:
                logger.error("Google token exchange failed: %s", token_res.text)
                return fail("token_exchange_failed")
            tokens = token_res.json()
            access_token = tokens.get("access_token")
            if not access_token:
                return fail("no_access_token")

            info_res = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if info_res.status_code >= 400:
                logger.error("Google userinfo failed: %s", info_res.text)
                return fail("userinfo_failed")
            info = info_res.json()
    except Exception:
        logger.exception("Google OAuth callback error")
        return fail("oauth_error")

    google_sub = info.get("sub")
    email = (info.get("email") or "").strip().lower()
    if not google_sub or not email:
        return fail("email_required")
    # Google may omit the key when using some scopes; only reject explicit false
    if info.get("email_verified") is False:
        return fail("email_not_verified")

    name = info.get("name")
    picture = info.get("picture")
    now = datetime.utcnow()

    statement = select(User).where(User.google_sub == google_sub)
    user = session.exec(statement).first()
    if user is None:
        # Link existing email/password account (local:email placeholder) to Google
        by_email = session.exec(select(User).where(User.email == email)).first()
        if by_email:
            user = by_email
            user.google_sub = google_sub
        else:
            user = User(
                email=email,
                google_sub=google_sub,
                name=name,
                picture_url=picture,
                created_at=now,
            )
            session.add(user)

    user.email = email
    user.name = name or user.name
    user.picture_url = picture or user.picture_url
    user.last_login_at = now
    session.add(user)
    session.commit()
    session.refresh(user)
    user = promote_admin_if_listed(session, user)

    # Welcome email: first time OR previous failure (retry)
    try:
        _maybe_send_welcome(session, user)
    except Exception:
        logger.exception("Welcome email path crashed (login still succeeds)")

    jwt_token = create_access_token(user_id=int(user.id), email=user.email)
    q = urlencode({"token": jwt_token})
    return RedirectResponse(f"{frontend}/#/auth/callback?{q}")


@router.get("/me", response_model=MeResponse)
async def auth_me(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> MeResponse:
    """Return the signed-in user and subscription flag."""
    user = promote_admin_if_listed(session, user)
    return MeResponse(
        user=user_public_dict(user),
        subscription_active=user_has_active_subscription(user),
    )


@router.post("/resend-welcome")
async def resend_welcome(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Manually retry welcome email (Settings)."""
    db_user = session.get(User, user.id)
    if db_user is None:
        raise HTTPException(status_code=401, detail="User not found")
    # Force retry
    db_user.welcome_email_sent = False
    session.add(db_user)
    session.commit()
    _maybe_send_welcome(session, db_user)
    session.refresh(db_user)
    return {
        "welcome_email_sent": db_user.welcome_email_sent,
        "last_email_error": db_user.last_email_error,
    }


class DevBypassResponse(BaseModel):
    token: str
    user: dict


@router.post("/dev-bypass", response_model=DevBypassResponse)
async def dev_bypass(session: Session = Depends(get_session)) -> DevBypassResponse:
    """Local-only fake login when AUTH_DEV_BYPASS=true (never in production)."""
    if not settings.AUTH_DEV_BYPASS:
        raise HTTPException(
            status_code=403,
            detail={
                "error": {
                    "code": "dev_bypass_disabled",
                    "message": "Dev bypass is disabled.",
                }
            },
        )

    email = "dev@localhost"
    statement = select(User).where(User.email == email)
    user = session.exec(statement).first()
    if user is None:
        user = User(
            email=email,
            google_sub="dev-bypass",
            name="Dev User",
            subscription_status="active",
            welcome_email_sent=True,
            access_revoked_reason=None,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    else:
        user.subscription_status = "active"
        user.access_revoked_reason = None
        session.add(user)
        session.commit()
        session.refresh(user)

    token = create_access_token(user_id=int(user.id), email=user.email)
    return DevBypassResponse(token=token, user=user_public_dict(user))
