"""Password hashing + reset-token helpers (stdlib only — no bcrypt dependency)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from backend.config import settings

_PBKDF2_ITERS = 210_000
_SALT_BYTES = 16


def hash_password(password: str) -> str:
    """Return `pbkdf2$iterations$salt_hex$hash_hex`."""
    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        _PBKDF2_ITERS,
    )
    return f"pbkdf2${_PBKDF2_ITERS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or not password:
        return False
    try:
        algo, iters_s, salt_hex, hash_hex = stored.split("$", 3)
        if algo != "pbkdf2":
            return False
        iters = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def hash_token(raw_token: str) -> str:
    """One-way hash for password-reset tokens (store hash only)."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def new_reset_token() -> tuple[str, str, datetime]:
    """Return (raw_token, token_hash, expires_at_utc_naive)."""
    raw = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES)
    return raw, hash_token(raw), expires


def validate_password_strength(password: str) -> str | None:
    """Return error message or None if ok."""
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if len(password) > 128:
        return "Password is too long."
    if password.strip() != password:
        return "Password cannot start or end with spaces."
    return None
