"""Email/password signup, login, and Gmail forgot-password reset."""

from __future__ import annotations

import logging
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from backend.config import settings
from backend.database import get_session
from backend.email_service import send_password_reset_email, send_welcome_email
from backend.jwt_auth import create_access_token, promote_admin_if_listed, user_public_dict
from backend.models import User
from backend.passwords import (
    hash_password,
    hash_token,
    new_reset_token,
    validate_password_strength,
    verify_password,
)

logger = logging.getLogger("astra.password_auth")

router = APIRouter(prefix="/v1/auth", tags=["auth-password"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=128)


class TokenUserResponse(BaseModel):
    token: str
    user: dict


class ForgotPasswordRequest(BaseModel):
    email: str


class ForgotPasswordResponse(BaseModel):
    """Always generic — do not reveal whether the email exists."""

    ok: bool = True
    message: str
    # Dev-only fields when SMTP missing + AUTH_DEV_BYPASS (never in prod)
    dev_reset_url: str | None = None
    smtp_error: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(min_length=8, max_length=128)


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


def _require_email_password_enabled() -> None:
    if not settings.EMAIL_PASSWORD_AUTH_ENABLED:
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "code": "password_auth_disabled",
                    "message": "Email/password auth is disabled.",
                }
            },
        )


def _valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email))


@router.post("/register", response_model=TokenUserResponse)
async def register(
    body: RegisterRequest,
    session: Session = Depends(get_session),
) -> TokenUserResponse:
    """Create email/password account (optional alongside Google)."""
    _require_email_password_enabled()
    email = _norm_email(body.email)
    if not _valid_email(email):
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "invalid_email", "message": "Enter a valid email."}},
        )
    pw_err = validate_password_strength(body.password)
    if pw_err:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "weak_password", "message": pw_err}},
        )

    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        if existing.password_hash:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": {
                        "code": "email_taken",
                        "message": "An account with this email already exists. Sign in or use Forgot password.",
                    }
                },
            )
        # Google-only account: attach password so they can also use email login
        existing.password_hash = hash_password(body.password)
        if body.name and not existing.name:
            existing.name = body.name.strip()
        existing.last_login_at = datetime.utcnow()
        session.add(existing)
        session.commit()
        session.refresh(existing)
        token = create_access_token(user_id=int(existing.id), email=existing.email)
        return TokenUserResponse(token=token, user=user_public_dict(existing))

    # google_sub is NOT NULL + UNIQUE on older DBs — use stable local placeholder
    user = User(
        email=email,
        google_sub=f"local:{email}",
        password_hash=hash_password(body.password),
        name=(body.name or "").strip() or None,
        created_at=datetime.utcnow(),
        last_login_at=datetime.utcnow(),
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    # Welcome email (same path as Google signup)
    if settings.WELCOME_EMAIL_ENABLED:
        ok, err = send_welcome_email(to_email=user.email, name=user.name)
        user.welcome_email_sent = ok
        user.last_email_error = None if ok else (err or "send failed")[:500]
        session.add(user)
        session.commit()
        session.refresh(user)

    token = create_access_token(user_id=int(user.id), email=user.email)
    return TokenUserResponse(token=token, user=user_public_dict(user))


@router.post("/login", response_model=TokenUserResponse)
async def login(
    body: LoginRequest,
    session: Session = Depends(get_session),
) -> TokenUserResponse:
    """Email + password login."""
    _require_email_password_enabled()
    email = _norm_email(body.email)
    user = session.exec(select(User).where(User.email == email)).first()

    # Generic error — don't leak which field failed
    bad = HTTPException(
        status_code=401,
        detail={
            "error": {
                "code": "invalid_credentials",
                "message": "Incorrect email or password.",
            }
        },
    )

    if user is None:
        raise bad

    if not user.password_hash:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "google_only_account",
                    "message": (
                        "This account uses Google sign-in only. "
                        "Use Continue with Google, or set a password via Forgot password "
                        "if you already linked one."
                    ),
                }
            },
        )

    if not verify_password(body.password, user.password_hash):
        raise bad

    user.last_login_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    user = promote_admin_if_listed(session, user)

    token = create_access_token(user_id=int(user.id), email=user.email)
    return TokenUserResponse(token=token, user=user_public_dict(user))


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(
    body: ForgotPasswordRequest,
    session: Session = Depends(get_session),
) -> ForgotPasswordResponse:
    """Send Gmail password-reset link. Always returns a generic success message."""
    _require_email_password_enabled()
    email = _norm_email(body.email)
    generic = (
        "If an account exists for that email, we sent a reset link. "
        "Check your inbox and spam folder."
    )

    if not _valid_email(email):
        # Still generic for UX consistency
        return ForgotPasswordResponse(ok=True, message=generic)

    user = session.exec(select(User).where(User.email == email)).first()
    if user is None:
        # Do not reveal missing account
        logger.info("Forgot password for unknown email domain …@%s", email.split("@")[-1])
        return ForgotPasswordResponse(ok=True, message=generic)

    # Google-only with no password: still send email explaining Google sign-in,
    # OR create a reset that lets them SET a password for the first time.
    raw, token_hash, expires = new_reset_token()
    user.password_reset_token_hash = token_hash
    user.password_reset_expires = expires
    session.add(user)
    session.commit()

    frontend = settings.FRONTEND_URL.rstrip("/")
    reset_url = f"{frontend}/#/auth/reset?token={raw}"

    if not settings.smtp_configured:
        logger.error("Forgot password: SMTP not configured — cannot email %s", email)
        # Local/dev escape: surface link only when AUTH_DEV_BYPASS
        if settings.AUTH_DEV_BYPASS:
            return ForgotPasswordResponse(
                ok=True,
                message=generic + " (dev: SMTP missing — reset URL returned once)",
                dev_reset_url=reset_url,
                smtp_error="SMTP not configured (SMTP_USER + SMTP_PASSWORD / Gmail App Password)",
            )
        # Production: still say generic, but record error on user for support
        user.last_email_error = "Password reset email failed: SMTP not configured"
        session.add(user)
        session.commit()
        return ForgotPasswordResponse(
            ok=True,
            message=generic,
            smtp_error="SMTP not configured on server",
        )

    ok, err = send_password_reset_email(
        to_email=user.email,
        name=user.name,
        reset_url=reset_url,
    )
    if not ok:
        user.last_email_error = f"Password reset email failed: {err}"[:500]
        session.add(user)
        session.commit()
        # Still generic to client; include smtp_error for UI diagnostics when same browser session
        return ForgotPasswordResponse(
            ok=True,
            message=generic,
            smtp_error=err,
        )

    user.last_email_error = None
    session.add(user)
    session.commit()
    return ForgotPasswordResponse(ok=True, message=generic)


@router.post("/reset-password", response_model=TokenUserResponse)
async def reset_password(
    body: ResetPasswordRequest,
    session: Session = Depends(get_session),
) -> TokenUserResponse:
    """Consume one-time token from Gmail link and set a new password."""
    _require_email_password_enabled()
    pw_err = validate_password_strength(body.new_password)
    if pw_err:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "weak_password", "message": pw_err}},
        )

    token_hash = hash_token(body.token.strip())
    user = session.exec(
        select(User).where(User.password_reset_token_hash == token_hash)
    ).first()

    invalid = HTTPException(
        status_code=400,
        detail={
            "error": {
                "code": "invalid_reset_token",
                "message": "This reset link is invalid or has expired. Request a new one.",
            }
        },
    )

    if user is None:
        raise invalid
    if not user.password_reset_expires or user.password_reset_expires < datetime.utcnow():
        user.password_reset_token_hash = None
        user.password_reset_expires = None
        session.add(user)
        session.commit()
        raise invalid

    user.password_hash = hash_password(body.new_password)
    user.password_reset_token_hash = None
    user.password_reset_expires = None
    user.last_login_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)

    logger.info("Password reset completed for user_id=%s", user.id)
    token = create_access_token(user_id=int(user.id), email=user.email)
    return TokenUserResponse(token=token, user=user_public_dict(user))
